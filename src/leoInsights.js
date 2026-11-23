// Extra analyses for the LEO System page, computed from the alert records (src/fleetData.js).
// Each takes the rows of the selected range unless noted.

const MIN = 60000

export function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y)
  if (!a.length) return null
  const mid = Math.floor(a.length / 2)
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2
}

function groupBy(rows, key) {
  const m = new Map()
  for (const r of rows) {
    const k = typeof key === 'function' ? key(r) : r[key]
    if (!k) continue
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(r)
  }
  return m
}

function topOf(rows, key) {
  let best = null
  for (const [name, list] of groupBy(rows, key)) if (!best || list.length > best.value) best = { name, value: list.length }
  return best
}

const avgMin = (rows) => (rows.length ? rows.reduce((s, r) => s + (r.minutes || 0), 0) / rows.length : 0)

/* 1. Places where cases repeat (province when the address does not say).
      level 'district': one row per district (อำเภอ/เขต), e.g. all of ลำลูกกา together, listing its
      busiest sub-districts. level 'area': one row per sub-district + district. */
const districtOf = (r) => (r.area ? r.area.split(' · ').pop() : '')
const subOf = (r) => (r.area && r.area.includes(' · ') ? r.area.split(' · ')[0] : '')

export function hotspots(rows, level = 'district', limit = 12) {
  const key = level === 'district'
    ? (r) => (districtOf(r) ? `${districtOf(r)}|${r.province}` : r.province)
    : (r) => r.area || r.province
  return [...groupBy(rows, key)]
    .map(([k, list]) => ({
      name: k.split('|')[0],
      province: list[0].province,
      count: list.length,
      top: topOf(list, 'stopType'),
      avg: avgMin(list),
      drivers: new Set(list.map((r) => r.driver)).size,
      subs: level === 'district'
        ? [...groupBy(list, subOf)].map(([name, l]) => ({ name, value: l.length })).sort((a, b) => b.value - a.value)
        : [],
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

/* 2. Alerts that need no follow-up: red light or traffic, stopped 5 minutes or less. */
export const SHORT_TYPES = ['ติดไฟแดง/สัญญาณไฟ', 'การจราจรติดขัด']
export const SHORT_MIN = 5
const isShort = (r) => SHORT_TYPES.includes(r.stopType) && r.minutes > 0 && r.minutes <= SHORT_MIN

export function noise(rows) {
  const short = rows.filter(isShort)
  return {
    count: short.length,
    total: rows.length,
    pct: rows.length ? (short.length / rows.length) * 100 : 0,
    byType: SHORT_TYPES.map((t) => ({ name: t, value: short.filter((r) => r.stopType === t).length })),
  }
}

// Share of short red-light/traffic alerts in each of the last `n` months (all records, not the range).
export function noiseByMonth(records, n = 6) {
  const now = new Date()
  const out = []
  for (let k = n - 1; k >= 0; k--) {
    const start = new Date(now.getFullYear(), now.getMonth() - k, 1)
    const end = new Date(now.getFullYear(), now.getMonth() - k + 1, 1)
    const list = records.filter((r) => r.start >= start && r.start < end)
    out.push({
      label: start.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' }),
      total: list.length,
      short: list.filter(isShort).length,
      pct: list.length ? (list.filter(isShort).length / list.length) * 100 : null,
    })
  }
  return out
}

/* 3. How long after a case ends it is unlocked: by shift and by the person who unlocked it. */
export const SHIFTS = [
  { id: 'morning', label: 'กะเช้า 06:00–13:59', test: (h) => h >= 6 && h < 14 },
  { id: 'afternoon', label: 'กะบ่าย 14:00–21:59', test: (h) => h >= 14 && h < 22 },
  { id: 'night', label: 'กะดึก 22:00–05:59', test: (h) => h >= 22 || h < 6 },
]

const lagOf = (r) => {
  if (!r.releasedAt || !r.end) return null
  const m = (r.releasedAt - r.end) / MIN
  return m >= 0 && m < 7 * 24 * 60 ? m : null // ignore clock mix-ups and cases unlocked days later
}

export function response(rows) {
  const done = rows.map((r) => ({ r, lag: lagOf(r) })).filter((x) => x.lag !== null)
  return {
    count: done.length,
    median: median(done.map((x) => x.lag)),
    shifts: SHIFTS.map((s) => {
      const list = done.filter((x) => s.test(x.r.end.getHours()))
      return { name: s.label, value: Math.round(median(list.map((x) => x.lag)) ?? 0), count: list.length }
    }),
    people: [...groupBy(done, (x) => x.r.releasedBy)]
      .filter(([, list]) => list.length >= 5) // a median of a handful of cases says little
      .map(([name, list]) => ({ name, value: Math.round(median(list.map((x) => x.lag))), count: list.length }))
      .sort((a, b) => b.value - a.value),
  }
}

/* 4. Long stops that are not explained by the job: over 30 minutes, outside customers, depots,
      workshops, ferries, legal rest points or idle trucks. */
export const LONG_MIN = 30
const EXPECTED_LONG = new Set([
  'อยู่ลูกค้า', 'จอดหน่วยงาน/คลัง', 'ซ่อมบำรุง/ยาง', 'เรือข้ามฟาก', 'จุดลงเวลา/ด่าน/ทางด่วน', 'รถไม่ได้วิ่งงาน',
])

export function longStops(rows) {
  return rows.filter((r) => r.minutes > LONG_MIN && !EXPECTED_LONG.has(r.stopType)).sort((a, b) => b.minutes - a.minutes)
}

/* 6. Rejected unlock requests: which stop types, and how often each person rejects. */
export function rejected(rows) {
  const rej = rows.filter((r) => r.stage === 'rejected')
  const decided = rows.filter((r) => r.stage === 'rejected' || r.stage === 'approved')
  return {
    count: rej.length,
    rate: decided.length ? (rej.length / decided.length) * 100 : 0,
    byType: [...groupBy(rej, 'stopType')].map(([name, list]) => ({ name, value: list.length })).sort((a, b) => b.value - a.value),
    people: [...groupBy(decided, 'releasedBy')]
      .map(([name, list]) => {
        const n = list.filter((r) => r.stage === 'rejected').length
        return { name, rejected: n, total: list.length, rate: (n / list.length) * 100 }
      })
      .filter((p) => p.total >= 5)
      .sort((a, b) => b.rate - a.rate || b.total - a.total),
  }
}

/* 7. Day of week x hour of the start. Rows Monday..Sunday. */
const DAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์']
export function weekHeat(rows) {
  const out = DAYS.map((name) => ({ name, hours: Array(24).fill(0), total: 0 }))
  for (const r of rows) {
    const d = (r.start.getDay() + 6) % 7 // Monday = 0
    out[d].hours[r.start.getHours()]++
    out[d].total++
  }
  return out
}
