import { fetchProtectedJson } from './protectedFetch'
import { knownDepot } from './planConvert'

// Distance database (Google Sheet, every tab) -> apps-script/distance-db.gs. Answers signed-in users only.
const DISTANCE_URL =
  'https://script.google.com/macros/s/AKfycbwLiYpAcs4NJgdHK-LJYBt8SojMDkxfKbl74DembLWEl8_B646ButysulTIvk__IegJ/exec'

let cached = null // one load per visit; the page's reload button asks again

export function loadDistances(force = false) {
  if (!cached || force) {
    cached = fetchProtectedJson(DISTANCE_URL, { source: 'distance-read' }).then((json) => {
      if (!json || json.status === 'error' || !Array.isArray(json.rows)) {
        throw new Error((json && (json.message || json.error)) || 'อ่านฐานข้อมูลระยะทางไม่ได้')
      }
      return { ...buildIndex(json.rows), sheets: json.sheets || [], skipped: json.skipped || [] }
    })
    cached.catch(() => { cached = null }) // let the next try ask again
  }
  return cached
}

// Names are compared without spaces, punctuation, company words, a leading "ลูกค้า" or Thai
// tone marks / ็ / ์ ฯลฯ, so "ห้างหุ้นส่วนจำกัด ท๊อป แอลพีจี" = "หจก.ท๊อปแอลพีจี" and
// "ลูกค้ากาสะลอง เซรามิคส์" = "บจก.กาสะลองเซรามิคส".
export function normName(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ห้างหุ้นส่วนจำกัด|หจก\.?|บริษัท|บจก\.?|จำกัด|\(มหาชน\)|มหาชน|co\.?,?\s*ltd\.?|ltd\.?/g, '')
    .replace(/^\s*ลูกค้า/, '')
    .replace(/[\s.,'"`()[\]\-_/\\:;]+/g, '')
    .replace(/[็-๎]/g, '') // ็ ่ ้ ๊ ๋ ์ ํ ๎
}
const normDepot = (s) => {
  const t = String(s ?? '').toLowerCase().replace(/\s+/g, '')
  return /บางปะกง/.test(t) ? 'bpk' : t.replace(/^คลัง/, '')
}

function buildIndex(rows) {
  const byName = new Map() // normalized customer -> [{ depot, distance }]
  for (const r of rows) {
    const key = normName(r.customer)
    const km = Number(r.distance)
    if (!key || !Number.isFinite(km)) continue
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key).push({
      depot: normDepot(r.depot), sheet: normDepot(r.sheet), distance: km, code: depotCode(r.depot, r.sheet),
      name: String(r.customer).trim(),
    })
  }
  return { byName, count: rows.length }
}

// The depot code the plan uses for a distance row (see knownDepot in planConvert.js).
// "คลังก๊าซบางปะกง" -> BPK · "คลัง บางจาก ศรีราชา BSRC" -> BSRC · "คลังพิจิตร" -> PCT
// "คลังนครสวรรค์" -> PTT NSW · depot = tab "Atlas-SRC" -> SRC. The depot column wins over the tab name.
export function depotCode(depot, sheet) {
  return knownDepot(depot) || knownDepot(sheet)
    || String(depot ?? '').replace(/^\s*คลัง\s*/, '').trim() || null
}

// A customer cell without a note written after the name, tried when the full cell is not found:
// "หจก. นครการก๊าซไทย (PT) (ถึง 25/11/69)" -> "หจก. นครการก๊าซไทย (PT)"
// "หจก. ลำมาศแก๊ส (ถึงวันที่ 23/11/69) ขา…" -> "หจก. ลำมาศแก๊ส"
// Only a bracket holding "ถึง" or a date counts as a note; "(PT)" stays part of the name.
export function stripNote(s) {
  return String(s ?? '')
    .replace(/\s*[([](?=[^)\]]*(?:ถึง|\d{1,2}\s*[/.-]\s*\d{1,2}))[^)\]]*[)\]].*$/s, '')
    .replace(/\s*\n.*$/s, '')
    .trim()
}

// ---------- close (not exact) names ----------
// Field plans add notes ("ลำมาศแก๊ส ขาเข้า") or drop a letter ("นครการก๊าซไท"). When no exact name is
// found, the closest sheet name is used if it is clearly the one meant. Safety rules:
//  · the numbers in both names must be the same ("เชียงใหม่ 3" never becomes "เชียงใหม่ 7")
//  · either one name contains the other (≥ 5 letters and at least half of the longer one), or they
//    differ by at most ~15% of the letters
//  · the best candidate must be clearly better than the next one, otherwise nothing is filled
// Such a match is returned with fuzzy: true and the sheet's name, so the page can flag it for checking.
const digitsOf = (k) => (k.match(/\d+/g) || []).join(',')
const noBrackets = (s) => String(s ?? '').replace(/\s*[([][^)\]]*[)\]]/g, ' ')

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 6) return 99
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

// Score 0..1 for how surely sheet name `k` is plan name `p` (both normalized), 0 = not this one.
// `digits` are the plan name's numbers, taken before brackets are dropped ("(PLANT3)" still counts).
function closeness(p, k, digits) {
  if (k.length < 5 || p.length < 5 || digits !== digitsOf(k)) return 0
  const cover = Math.min(p.length, k.length) / Math.max(p.length, k.length)
  if ((p.includes(k) || k.includes(p)) && cover >= 0.5) return 0.9 + 0.1 * cover // name + a short note
  const sim = 1 - editDistance(p, k) / Math.max(p.length, k.length)
  return sim >= 0.85 ? sim : 0
}

function closestKey(index, customer) {
  index.fuzzy ??= new Map() // remember answers: the same names repeat in a plan
  if (index.fuzzy.has(customer)) return index.fuzzy.get(customer)
  const base = stripNote(customer)
  const digits = digitsOf(normName(base))
  const forms = [...new Set([base, noBrackets(base)].map(normName))].filter(Boolean)
  let best = null
  let second = 0
  for (const k of index.byName.keys()) {
    const score = Math.max(...forms.map((p) => closeness(p, k, digits)))
    if (!score) continue
    if (!best || score > best.score) { second = best?.score ?? second; best = { key: k, score } } else if (score > second) second = score
  }
  const hit = best && best.score - second >= 0.04 ? best.key : null
  index.fuzzy.set(customer, hit)
  return hit
}

// Distance (and the depot it is from) for a customer -> { distance, depot, fuzzy, name } or null.
// Prefers a row of the same depot (or a tab named after it); without a depot match it is used
// only when every row for that customer gives the same distance.
export function findMatch(index, customer, depot) {
  if (!index || !String(customer ?? '').trim()) return null
  let list = index.byName.get(normName(customer)) ?? index.byName.get(normName(stripNote(customer)))
  let fuzzy = false
  if (!list?.length) {
    const key = closestKey(index, customer)
    list = key && index.byName.get(key)
    fuzzy = true
  }
  if (!list?.length) return null
  const hit = pickRow(list, depot)
  return hit && { ...hit, fuzzy, name: list[0].name }
}

function pickRow(list, depot) {
  const d = normDepot(depot)
  const want = knownDepot(depot) // "PCT" in the plan matches "คลังพิจิตร" in the sheet
  if (d) {
    // Tab "Atlas-BPK" belongs to depot BPK, "Atlas-SRC" to SRC.
    const same = list.find((x) => (want && x.code === want) || x.depot === d || x.sheet === d || x.depot.includes(d) || x.sheet.includes(d)
      || (x.depot && d.includes(x.depot)))
    if (same) return { distance: same.distance, depot: same.code }
  }
  if (!list.every((x) => x.distance === list[0].distance)) return null
  // Same distance everywhere: name the depot only when every row agrees on it.
  const codes = new Set(list.map((x) => x.code))
  return { distance: list[0].distance, depot: codes.size === 1 ? list[0].code : null }
}

export function findDistance(index, customer, depot) {
  return findMatch(index, customer, depot)?.distance ?? null
}
