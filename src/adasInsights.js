// Analyses for the ADAS / DMS page (src/adasData.js records), also used by the Reports page.
//
// The review result ("หมายเหตุโฆษณา") tells what the camera really saw. It is grouped into:
//   risky  - the driver did something risky (a behavior category with a weight for the score)
//   normal - the driver did a normal check (speed meter, mirror): not a risk, not a camera fault
//   noise  - the alert cannot be used (false alert, no video, maintenance, storage/camera fault)
//   other  - no result yet, or a result not in the lists below (shown as is, not scored)
// Driver names from the camera are in English and "NA" when unknown, so they cannot be matched
// with the behavior log (Thai names); plates are used to link the two.
import { penaltyStep, PENALTY_STEPS } from './behaviorInsights'

const DAY = 86400000

export const CATEGORIES = [
  { name: 'หลับใน / ง่วง', weight: 5, fatigue: true, test: /micro\s*sleep|fatigue|drows|eye\s*clos/i },
  { name: 'หาว', weight: 3, fatigue: true, test: /yawn/i },
  { name: 'ใช้โทรศัพท์', weight: 3, test: /phone/i },
  { name: 'เสี่ยงชนด้านหน้า', weight: 3, test: /forward\s*collision|fcw/i },
  { name: 'กิน / ดื่ม / สูบ', weight: 2, test: /eat|drink|f&d|smok/i },
  { name: 'ไม่หยุด / ไม่ตอบ / ความเร็ว', weight: 2, test: /did\s*not\s*stop|not\s*answer|overspeed/i },
  { name: 'ไม่มองถนน', weight: 1, test: /distract/i },
]
const NOISE = [
  ['เตือนผิด (False alert)', /false\s*alert/i],
  ['ไม่มีวิดีโอ', /no\s*video/i],
  ['ซ่อมบำรุง', /maintenance/i],
  ['กล้อง / หน่วยความจำขัดข้อง', /storage|camera\s*cover/i],
]
const NORMAL = [['มองมาตรวัด / กระจก (ปกติ)', /speed\s*meter|mirror|normal/i]]

export const OUTCOMES = [
  { id: 'risky', label: 'พฤติกรรมเสี่ยง', color: '#d0605a' },
  { id: 'normal', label: 'พฤติกรรมปกติ', color: '#3987e5' },
  { id: 'noise', label: 'เตือนผิด / ใช้ไม่ได้', color: '#898781' },
  { id: 'other', label: 'อื่นๆ / ยังไม่มีผล', color: '#e0a321' },
]
export const outcomeLabel = (id) => OUTCOMES.find((o) => o.id === id)?.label ?? id

const cache = new Map()
export function classify(note) {
  const s = String(note ?? '').trim()
  if (cache.has(s)) return cache.get(s)
  let out
  const c = CATEGORIES.find((x) => x.test.test(s))
  if (!s) out = { outcome: 'other', category: 'ยังไม่มีผลตรวจ', weight: 0, fatigue: false }
  else if (c) out = { outcome: 'risky', category: c.name, weight: c.weight, fatigue: !!c.fatigue }
  else {
    const n = NOISE.find(([, re]) => re.test(s))
    const m = NORMAL.find(([, re]) => re.test(s))
    out = n ? { outcome: 'noise', category: n[0], weight: 0, fatigue: false }
      : m ? { outcome: 'normal', category: m[0], weight: 0, fatigue: false }
        : { outcome: 'other', category: s, weight: 0, fatigue: false }
  }
  cache.set(s, out)
  return out
}

function groupBy(rows, key) {
  const m = new Map()
  for (const r of rows) {
    const k = typeof key === 'function' ? key(r) : r[key]
    if (!k || k === '(ไม่ระบุ)') continue
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(r)
  }
  return m
}
const pctOf = (n, d) => (d ? (n / d) * 100 : null)
const topOf = (list, key) => {
  const t = [...groupBy(list, key)].sort((a, b) => b[1].length - a[1].length)[0]
  return t ? { name: t[0], value: t[1].length } : null
}
const count = (list, f) => list.reduce((n, r) => n + (f(r) ? 1 : 0), 0)
export const isRisky = (r) => r.outcome === 'risky'
export const isFatigue = (r) => r.fatigue
const isFalse = (r) => /false\s*alert/i.test(r.note)
const isNoVideo = (r) => /no\s*video/i.test(r.note)

// Counts of each outcome in a list: { risky, normal, noise, other }.
export function outcomeMix(list) {
  const o = { risky: 0, normal: 0, noise: 0, other: 0 }
  for (const r of list) o[r.outcome]++
  return o
}

/* A1. How useful each alert type is: what the review found for each camera alert type. */
export function typeQuality(rows) {
  return [...groupBy(rows, 'type')].map(([name, l]) => {
    const mix = outcomeMix(l)
    return {
      name, total: l.length, mix,
      risky: pctOf(mix.risky, l.length), noise: pctOf(mix.noise, l.length),
      falseAlert: pctOf(count(l, isFalse), l.length), noVideo: pctOf(count(l, isNoVideo), l.length),
      top: topOf(l.filter(isRisky), 'category'),
    }
  }).sort((a, b) => b.total - a.total)
}

/* A1b. Share of alerts that could not be used (noise), by month, last n months. */
export function noiseMonths(records, n = 12) {
  const now = new Date()
  const out = []
  for (let k = n - 1; k >= 0; k--) {
    const start = new Date(now.getFullYear(), now.getMonth() - k, 1)
    const end = new Date(now.getFullYear(), now.getMonth() - k + 1, 1)
    const l = records.filter((r) => r.start >= start && r.start < end)
    const v = count(l, (r) => r.outcome === 'noise')
    out.push({ label: start.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' }), total: l.length, value: v, rate: l.length ? (v / l.length) * 100 : null })
  }
  return out
}

/* A2. Camera health per vehicle: share of false alerts and of alerts with no video.
       Vehicles with at least `min` alerts in the range; flags against fixed limits. */
export const CAMERA_FALSE = 70 // % false alert at or above this: check the camera's setup
export const CAMERA_NO_VIDEO = 10 // % no video at or above this: check the recorder
export function cameraHealth(rows, min = 30) {
  return [...groupBy(rows, 'plate')]
    .filter(([, l]) => l.length >= min)
    .map(([name, l]) => {
      const falseN = count(l, isFalse)
      const noVideo = count(l, isNoVideo)
      const fp = pctOf(falseN, l.length)
      const nv = pctOf(noVideo, l.length)
      const flags = [fp >= CAMERA_FALSE && 'เตือนผิดบ่อย', nv >= CAMERA_NO_VIDEO && 'วิดีโอหายบ่อย'].filter(Boolean)
      return {
        name, unit: topOf(l, 'unit')?.name ?? '(ไม่ระบุ)', total: l.length,
        falseN, falsePct: fp, noVideo, noVideoPct: nv,
        maintenance: count(l, (r) => /maintenance/i.test(r.note)),
        riskyPct: pctOf(count(l, isRisky), l.length),
        topType: topOf(l.filter(isFalse), 'type')?.name ?? '',
        flag: flags.join(' · '),
        bad: flags.length > 0,
      }
    })
    .sort((a, b) => b.bad - a.bad || b.falsePct - a.falsePct || b.noVideoPct - a.noVideoPct)
}

/* B1. Driver risk score: sum of the category weights of their risky events in the range, against
       the previous range of the same length. Events with no driver name ("NA") are left out. */
export function driverScores(rows, prev, limit = 15) {
  const score = (l) => l.reduce((s, r) => s + (r.outcome === 'risky' ? r.weight : 0), 0)
  const before = new Map()
  if (prev) for (const [name, l] of groupBy(prev.filter((r) => !r.noDriver), 'driver')) before.set(name, score(l))
  const list = [...groupBy(rows.filter((r) => !r.noDriver), 'driver')].map(([name, l]) => {
    const risky = l.filter(isRisky)
    return {
      name,
      unit: topOf(l, 'unit')?.name ?? '(ไม่ระบุ)',
      plates: [...new Set(l.map((r) => r.plate))],
      score: score(l),
      alerts: l.length,
      risky: risky.length,
      fatigue: count(risky, isFatigue),
      sleep: count(risky, (r) => r.category === CATEGORIES[0].name),
      phone: count(risky, (r) => r.category === 'ใช้โทรศัพท์'),
      top: topOf(risky, 'category'),
      before: prev ? before.get(name) || 0 : null,
      list: l,
    }
  }).filter((d) => d.score > 0)
  const top = [...list].sort((a, b) => b.score - a.score || b.fatigue - a.fatigue).slice(0, limit)
  const improved = prev
    ? [...before].map(([name, b]) => ({ name, before: b, now: list.find((d) => d.name === name)?.score || 0 }))
      .filter((d) => d.before >= 10 && d.now <= d.before / 2).sort((a, b) => b.before - b.now - (a.before - a.now)).slice(0, 8)
    : []
  const total = list.reduce((s, d) => s + d.score, 0)
  const sorted = list.map((d) => d.score).sort((a, b) => b - a)
  const topTenth = sorted.slice(0, Math.ceil(sorted.length / 10)).reduce((s, v) => s + v, 0)
  return {
    top, improved, drivers: list.length, noName: count(rows, (r) => r.noDriver),
    topTenthShare: pctOf(topTenth, total),
  }
}

/* B1b. Risky events by category. */
export function categoryMix(rows) {
  const risky = rows.filter(isRisky)
  return CATEGORIES.map((c) => ({ name: c.name, weight: c.weight, value: count(risky, (r) => r.category === c.name) }))
    .filter((c) => c.value > 0).sort((a, b) => b.value - a.value)
}

/* B2. Drivers with 2+ fatigue events (หลับใน / ง่วง / หาว) in the range: gaps between them. */
export function fatigueRepeats(rows, limit = 15) {
  return [...groupBy(rows.filter((r) => r.fatigue && !r.noDriver), 'driver')]
    .filter(([, l]) => l.length >= 2)
    .map(([name, l]) => {
      // Gaps between the days it happened (several alerts in one day are one day).
      const t = [...new Set(l.map((r) => new Date(r.start).setHours(0, 0, 0, 0)))].sort((a, b) => a - b)
      const gaps = t.slice(1).map((x, i) => Math.round((x - t[i]) / DAY)).sort((a, b) => a - b)
      return {
        name, unit: topOf(l, 'unit')?.name ?? '(ไม่ระบุ)', plate: topOf(l, 'plate')?.name ?? '',
        count: l.length, sleep: count(l, (r) => r.category === CATEGORIES[0].name),
        days: t.length,
        medianGap: gaps[Math.floor(gaps.length / 2)], within7: count(gaps, (g) => g <= 7),
        night: count(l, (r) => r.hasTime && r.start.getHours() < 6),
        last: l.reduce((m, r) => (r.start > m ? r.start : m), l[0].start), list: l,
      }
    })
    .sort((a, b) => b.sleep * 5 + b.count - (a.sleep * 5 + a.count) || b.days - a.days)
    .slice(0, limit)
}

/* D1. Day of week x hour, Monday first. */
const DAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์']
export const weekday = (r) => (r.start.getDay() + 6) % 7
export function weekHeat(rows) {
  const out = DAYS.map((name) => ({ name, hours: Array(24).fill(0), total: 0 }))
  for (const r of rows) {
    if (!r.hasTime) continue
    const d = weekday(r)
    out[d].hours[r.start.getHours()]++
    out[d].total++
  }
  return out
}
export { DAYS }

/* D2. Places where risky events repeat, on the road only (alerts inside a Geofence such as a
       depot or a customer site are left out). District + province, province alone when unknown. */
export const placeKey = (r) => {
  const d = r.area ? r.area.split(' · ').pop() : ''
  return d ? `${d} · ${r.province}` : r.province
}
export function hotspots(rows, limit = 12) {
  return [...groupBy(rows.filter((r) => isRisky(r) && !r.geofence), placeKey)]
    .map(([name, l]) => ({
      name, count: l.length, fatigue: count(l, isFatigue),
      top: topOf(l, 'category'), drivers: new Set(l.filter((r) => !r.noDriver).map((r) => r.driver)).size,
      plates: new Set(l.map((r) => r.plate)).size, list: l,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

/* D3. Inside a Geofence (named place) vs on the road. */
export function geofenceSplit(rows, limit = 10) {
  const part = (l) => ({ total: l.length, ...outcomeMix(l), maintenance: count(l, (r) => /maintenance/i.test(r.note)) })
  const inside = rows.filter((r) => r.geofence)
  return {
    inside: part(inside),
    road: part(rows.filter((r) => !r.geofence)),
    places: [...groupBy(inside, 'geofence')].map(([name, l]) => ({ name, total: l.length, ...outcomeMix(l), top: topOf(l, 'category'), list: l }))
      .sort((a, b) => b.total - a.total).slice(0, limit),
  }
}

/* B3. Link with the behavior log (src/behaviorData.js) by plate: "SCC9738_67-6192" -> "67-6192". */
export const plateKey = (p) => (String(p ?? '').match(/(\d{1,3})\s*-?\s*(\d{4})\s*$/) || []).slice(1).join('-')

// Per plate: risky DMS events and behavior records in the range. A plate with 3+ fatigue events
// and no behavior record is flagged: the camera saw it but nobody followed it up.
export const LINK_FATIGUE = 3
export function behaviorLink(rows, behavior, range) {
  const beh = (behavior || []).filter((r) => r.start && r.start >= range.from && r.start < range.to)
  const byPlate = groupBy(beh, (r) => plateKey(r.plate))
  const adas = groupBy(rows.filter(isRisky), (r) => plateKey(r.plate))
  const list = [...adas].map(([k, l]) => {
    const b = byPlate.get(k) || []
    const fatigue = count(l, isFatigue)
    return {
      key: k, plate: l[0].plate, unit: topOf(l, 'unit')?.name ?? '(ไม่ระบุ)',
      risky: l.length, fatigue, sleep: count(l, (r) => r.category === CATEGORIES[0].name),
      score: l.reduce((s, r) => s + r.weight, 0),
      dmsDriver: topOf(l.filter((r) => !r.noDriver), 'driver')?.name ?? '',
      records: b.length, high: count(b, (r) => r.riskLevel >= 3),
      penalized: count(b, (r) => penaltyStep(r.penalty) >= 1),
      behDrivers: [...new Set(b.map((r) => r.driver).filter((d) => d && d !== '(ไม่ระบุ)'))],
      flag: fatigue >= LINK_FATIGUE && !b.length,
      list: l, behList: b,
    }
  }).sort((a, b) => b.flag - a.flag || b.score - a.score)
  const matched = count(beh, (r) => adas.has(plateKey(r.plate)))
  return { list, behavior: beh.length, matched, flagged: count(list, (x) => x.flag) }
}

// Same plate, W days before vs after a behavior record that got each result. Windows must fit
// inside the camera data (first..last alert), since the sheet is filled in batches.
export function linkBeforeAfter(allAdas, behavior, range, W = 30) {
  if (!allAdas.length) return []
  let first = Infinity, last = -Infinity
  for (const r of allAdas) { const t = r.start.getTime(); if (t < first) first = t; if (t > last) last = t }
  const byPlate = groupBy(allAdas.filter(isRisky), (r) => plateKey(r.plate))
  for (const l of byPlate.values()) l.sort((a, b) => a.start - b.start)
  const beh = (behavior || []).filter((r) => r.start && r.start >= range.from && r.start < range.to)
  return PENALTY_STEPS.map((p) => {
    const given = beh.filter((r) => penaltyStep(r.penalty) === p.step && byPlate.has(plateKey(r.plate)))
    const ok = given.filter((r) => r.start - first >= W * DAY && last - r.start >= W * DAY)
    let before = 0, after = 0, fewer = 0
    for (const r of ok) {
      const t = r.start.getTime()
      const l = byPlate.get(plateKey(r.plate))
      const b = count(l, (x) => x.start >= t - W * DAY && x.start < t)
      const a = count(l, (x) => x.start > t && x.start <= t + W * DAY)
      before += b; after += a
      if (a < b) fewer++
    }
    const n = ok.length
    return {
      name: p.label, step: p.step, given: given.length, n,
      before: n ? before / n : null, after: n ? after / n : null,
      change: n && before ? ((after - before) / before) * 100 : null,
      fewer: n ? (fewer / n) * 100 : null, list: ok,
    }
  }).filter((p) => p.given > 0)
}
