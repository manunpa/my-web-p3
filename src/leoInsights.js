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

/* 4. Share of each stop type (percent of all alerts in the range), and the change against the
      previous range in percentage points (null when there is no previous range or no data in it). */
export function stopShares(rows, prev) {
  const share = (list) => {
    const m = new Map()
    for (const r of list) m.set(r.stopType, (m.get(r.stopType) || 0) + 1)
    return m
  }
  const now = share(rows)
  const before = prev && prev.length ? share(prev) : null
  return {
    total: rows.length,
    rows: [...now]
      .map(([name, count]) => {
        const p = (count / rows.length) * 100
        return { name, count, pct: p, delta: before ? p - ((before.get(name) || 0) / prev.length) * 100 : null }
      })
      .sort((a, b) => b.count - a.count),
  }
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
    list: [...rej].sort((a, b) => b.start - a.start),
  }
}

/* 6b. Do the unlockers judge the same stop type the same way?
       cells[type][person] = { rejected, total, rate }. A type is flagged when, among people with at
       least MIN_DECIDED decided cases of it, one rejects >= 50% while another rejects none. */
export const MIN_DECIDED = 5

export function rejectMatrix(rows) {
  const decided = rows.filter((r) => (r.stage === 'rejected' || r.stage === 'approved') && r.releasedBy)
  const rejectedTypes = new Set(decided.filter((r) => r.stage === 'rejected').map((r) => r.stopType))
  const people = [...groupBy(decided, 'releasedBy')]
    .filter(([, list]) => list.length >= MIN_DECIDED)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([name]) => name)
  const types = [...rejectedTypes]
    .map((t) => ({ name: t, list: decided.filter((r) => r.stopType === t) }))
    .sort((a, b) => b.list.filter((r) => r.stage === 'rejected').length - a.list.filter((r) => r.stage === 'rejected').length)
  const out = types.map(({ name, list }) => {
    const cells = Object.fromEntries(people.map((p) => {
      const mine = list.filter((r) => r.releasedBy === p)
      const n = mine.filter((r) => r.stage === 'rejected').length
      return [p, { rejected: n, total: mine.length, rate: mine.length ? (n / mine.length) * 100 : null }]
    }))
    const solid = people.filter((p) => cells[p].total >= MIN_DECIDED)
    const strict = solid.filter((p) => cells[p].rate >= 50).sort((a, b) => cells[b].rate - cells[a].rate)
    const lenient = solid.filter((p) => cells[p].rate === 0)
    const total = list.length
    const rej = list.filter((r) => r.stage === 'rejected').length
    return {
      name, cells, total, rejected: rej, rate: total ? (rej / total) * 100 : 0,
      mismatch: strict.length && lenient.length ? { strict, lenient } : null,
    }
  })
  return { people, types: out, mismatches: out.filter((t) => t.mismatch) }
}

/* 6c. Rejections per week (Monday-Sunday) across the range. */
export function rejectWeeks(rows, from, to) {
  const monday = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d }
  const out = []
  for (let d = monday(from); d.getTime() < to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7)) {
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7)
    const list = rows.filter((r) => r.start >= d && r.start < end)
    const decided = list.filter((r) => r.stage === 'rejected' || r.stage === 'approved')
    const n = list.filter((r) => r.stage === 'rejected').length
    const last = new Date(end.getTime() - 86400000)
    out.push({
      label: `${d.getDate()} ${d.toLocaleDateString('th-TH', { month: 'short' })}–${last.getDate()} ${last.toLocaleDateString('th-TH', { month: 'short' })}`,
      rejected: n, total: decided.length, rate: decided.length ? (n / decided.length) * 100 : null,
    })
  }
  return out
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
