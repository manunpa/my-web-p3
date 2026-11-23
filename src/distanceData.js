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

// Distance (and the depot it is from) for a customer -> { distance, depot } or null.
// Prefers a row of the same depot (or a tab named after it); without a depot match it is used
// only when every row for that customer gives the same distance.
export function findMatch(index, customer, depot) {
  const list = index?.byName.get(normName(customer)) ?? index?.byName.get(normName(stripNote(customer)))
  if (!list?.length) return null
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
