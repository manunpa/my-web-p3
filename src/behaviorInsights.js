// Extra analyses for the driver behavior page (src/behaviorData.js records).
// Driver names here are keyed in by hand per case, so per-driver views are reliable.

const DAY = 86400000

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

/* ---------- penalties ---------- */

// Penalty text -> step on the ladder. null = no penalty recorded yet.
export const PENALTY_STEPS = [
  { step: 0, label: 'ไม่มีความผิด', test: /ไม่มีความผิด|ไม่ผิด/ },
  { step: 1, label: 'ตักเตือนด้วยวาจา', test: /วาจา/ },
  { step: 2, label: 'ตักเตือนเป็นลายลักษณ์อักษร', test: /ลายลักษณ์/ },
  { step: 3, label: 'พักงาน', test: /พักงาน|พักการ/ },
  { step: 4, label: 'เลิกจ้าง', test: /เลิกจ้าง|ไล่ออก/ },
]
export function penaltyStep(p) {
  const s = String(p ?? '')
  if (!s || s === '(ไม่ระบุ)') return null
  return PENALTY_STEPS.find((x) => x.test.test(s))?.step ?? null
}
const stepLabel = (n) => PENALTY_STEPS.find((x) => x.step === n)?.label ?? '–'

/* 1. Repeat records and whether penalties climb.
      Per driver with 2+ records in the range: how many, how many high risk, the penalties given,
      and a flag when 3+ records got no penalty above a verbal warning. */
export function repeats(rows, limit = 15) {
  return [...groupBy(rows, 'driver')]
    .filter(([, list]) => list.length >= 2)
    .map(([name, list]) => {
      const sorted = [...list].sort((a, b) => a.start - b.start)
      const steps = sorted.map((r) => penaltyStep(r.penalty)).filter((s) => s !== null)
      const given = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }
      for (const s of steps) given[s]++
      const decided = steps.length
      const maxStep = decided ? Math.max(...steps) : null
      const units = [...groupBy(list, 'unit')].sort((a, b) => b[1].length - a[1].length).map(([u]) => u)
      return {
        name,
        unit: units[0] || '(ไม่ระบุ)',
        moreUnits: units.length - 1,
        count: list.length,
        high: list.filter((r) => r.riskLevel >= 3).length,
        decided,
        pending: list.length - decided,
        given,
        maxStep,
        // 3+ records judged, none above a verbal warning: the ladder is not being climbed
        flat: decided >= 3 && maxStep <= 1,
        last: sorted.at(-1).start,
      }
    })
    .sort((a, b) => b.count - a.count || b.high - a.high)
    .slice(0, limit)
}

/* 2. Do units judge alike? Penalty mix per unit for judged records, and a warning when high-risk
      cases get a penalty in one unit but never in another (each with at least MIN_JUDGED). */
export const MIN_JUDGED = 10

export function penaltyByUnit(rows) {
  const judged = rows.filter((r) => penaltyStep(r.penalty) !== null)
  const units = [...groupBy(judged, 'unit')]
    .filter(([, list]) => list.length >= 5)
    .map(([name, list]) => {
      const steps = list.map((r) => penaltyStep(r.penalty))
      const high = list.filter((r) => r.riskLevel >= 3)
      const highPen = high.filter((r) => penaltyStep(r.penalty) >= 1).length
      return {
        name,
        total: list.length,
        mix: PENALTY_STEPS.map((s) => steps.filter((x) => x === s.step).length),
        penalized: steps.filter((x) => x >= 1).length,
        high: high.length,
        highPenalized: highPen,
        highRate: high.length ? (highPen / high.length) * 100 : null,
      }
    })
    .sort((a, b) => b.total - a.total)
  const solid = units.filter((u) => u.high >= MIN_JUDGED)
  const strict = solid.filter((u) => u.highRate >= 20).sort((a, b) => b.highRate - a.highRate)
  const lenient = solid.filter((u) => u.highRate === 0).sort((a, b) => b.high - a.high)
  // Risk level x penalty, all units together
  const byRisk = [3, 2, 1].map((lvl) => {
    const list = judged.filter((r) => (lvl === 3 ? r.riskLevel >= 3 : r.riskLevel === lvl))
    return {
      name: lvl === 3 ? 'สูง' : lvl === 2 ? 'ปานกลาง' : 'ต่ำ',
      total: list.length,
      mix: PENALTY_STEPS.map((s) => list.filter((r) => penaltyStep(r.penalty) === s.step).length),
    }
  })
  return {
    judged: judged.length,
    units,
    byRisk,
    mismatch: strict.length && lenient.length ? { strict, lenient } : null,
  }
}

/* 3. Which penalty works: after a penalty, does the same driver get another record within
      30 / 60 / 90 days? Only penalties old enough to have the full window are counted. */
export const WINDOWS = [30, 60, 90]

export function penaltyEffect(allRecords, rows) {
  const byDriver = groupBy(allRecords, 'driver')
  for (const list of byDriver.values()) list.sort((a, b) => a.start - b.start)
  const now = Date.now()
  return PENALTY_STEPS.map((p) => {
    const given = rows.filter((r) => penaltyStep(r.penalty) === p.step)
    const windows = WINDOWS.map((w) => {
      const eligible = given.filter((r) => now - r.start >= w * DAY)
      const again = eligible.filter((r) => (byDriver.get(r.driver) || [])
        .some((x) => x !== r && x.start > r.start && x.start - r.start <= w * DAY))
      return { days: w, n: eligible.length, again: again.length, rate: eligible.length ? (again.length / eligible.length) * 100 : null }
    })
    return { name: p.label, step: p.step, given: given.length, windows }
  }).filter((p) => p.given > 0)
}

/* 3b. Same driver before vs after: records in the W days before a penalty against the W days
       after it. Comparing a driver with themself removes most of the "worse drivers get harsher
       penalties" effect. Only penalties with full W-day windows on both sides inside the data count.
       "ไม่มีความผิด" works as the baseline: the change seen without any penalty. */
export function penaltyBeforeAfter(allRecords, rows, W) {
  const byDriver = groupBy(allRecords, 'driver')
  const first = Math.min(...allRecords.map((r) => r.start.getTime()))
  const now = Date.now()
  return PENALTY_STEPS.map((p) => {
    const given = rows.filter((r) => penaltyStep(r.penalty) === p.step)
    const ok = given.filter((r) => r.start - first >= W * DAY && now - r.start >= W * DAY)
    let before = 0, after = 0, fewer = 0, more = 0, sameAgain = 0
    for (const r of ok) {
      const list = byDriver.get(r.driver) || []
      const t = r.start.getTime() // a number: Date + number would join as text
      const b = list.filter((x) => x !== r && x.start >= t - W * DAY && x.start < t).length
      const a = list.filter((x) => x !== r && x.start > t && x.start <= t + W * DAY)
      before += b
      after += a.length
      if (a.length < b) fewer++
      else if (a.length > b) more++
      if (a.some((x) => x.offense === r.offense)) sameAgain++
    }
    const n = ok.length
    return {
      name: p.label, step: p.step, given: given.length, n,
      before: n ? before / n : null,
      after: n ? after / n : null,
      change: n && before ? ((after - before) / before) * 100 : null,
      fewer: n ? (fewer / n) * 100 : null,
      more: n ? (more / n) * 100 : null,
      same: n ? (sameAgain / n) * 100 : null,
    }
  }).filter((p) => p.given > 0)
}

// Drivers who received at least one real penalty (verbal warning or more), most penalties first.
export function penalizedDrivers(rows) {
  return [...groupBy(rows.filter((r) => penaltyStep(r.penalty) >= 1), 'driver')]
    .map(([name, l]) => ({ name, value: l.length })).sort((a, b) => b.value - a.value)
}

// One driver's records in time order, for the timeline.
export function driverTimeline(allRecords, name) {
  return allRecords.filter((r) => r.driver === name).sort((a, b) => a.start - b.start)
    .map((r) => ({ id: r.id, start: r.start, step: penaltyStep(r.penalty), offense: r.offense, risk: r.risk, high: r.riskLevel >= 3 }))
}

/* 4. Fatigue: offenses about drowsiness, tiredness or driving too long without a break.
      (The sheet's "จำนวนวันทำงาน" column holds case age / "ปิดงาน", not days worked, so it is not used.) */
const FATIGUE = /ง่วง|เมื่อยล้า|อ่อนเพลีย|หลับ|ขับรถต่อเนื่อง|พักไม่ครบ|จอดพักไม่ครบ/
export const isFatigue = (r) => FATIGUE.test(`${r.offense} ${r.cause}`)

export function fatigue(rows) {
  const list = rows.filter(isFatigue)
  const hours = Array(24).fill(0)
  for (const r of list) if (r.hasTime) hours[r.start.getHours()]++
  const kinds = [...groupBy(list, (r) => (/ขับรถต่อเนื่อง|พักไม่ครบ/.test(r.offense) ? 'ขับต่อเนื่องเกิน 4 ชม.'
    : /ไม่ให้ความร่วมม/.test(r.offense) ? 'ง่วง/เมื่อยล้า และไม่ให้ความร่วมมือหยุดพัก'
      : 'ง่วง/เมื่อยล้า แต่ให้ความร่วมมือหยุดพัก'))]
    .map(([name, l]) => ({ name, value: l.length })).sort((a, b) => b.value - a.value)
  const night = list.filter((r) => r.hasTime && (r.start.getHours() >= 0 && r.start.getHours() < 6)).length
  return { count: list.length, total: rows.length, hours, kinds, night, timed: list.filter((r) => r.hasTime).length }
}

/* 5. Cause x offense. The cause cell holds long standard sentences; they are grouped by key words. */
const CAUSES = [
  ['ปัจจัยภายนอก (ฝน พื้นที่แคบ ลูกค้าเร่ง)', /ปัจจัยแทรกแซง|ฝนตก|พื้นที่แคบ|ลูกค้าเร่ง/],
  ['เมื่อยล้า / ง่วง', /เมื่อยล้า|ง่วง|อ่อนเพลีย/],
  ['ใช้โทรศัพท์', /โทรศัพท์/],
  ['เคยชิน (ทำแล้วไม่เป็นอะไร)', /เคยทำแล้วไม่เป็นอะไร|ไม่เกิดเหตุอะไร/],
  ['ไม่รู้ขั้นตอน / มาตรฐาน', /ไม่คุ้นเคย|ไม่รู้|ไม่ทราบ/],
  ['ไม่เคยถูกสื่อสาร / ลงโทษ', /ไม่เคยถูกสื่อสาร/],
  ['ความเร็ว', /ความเร็ว/],
  ['ระยะห่างคันหน้า', /ระยะห่าง/],
  ['ขับต่อเนื่องเกิน 4 ชม.', /ต่อเนื่องเกิน|พักไม่ครบ/],
]
export function causeGroup(c) {
  const s = String(c ?? '').trim()
  if (!s || s === '-' || s === '(ไม่ระบุ)') return null
  return CAUSES.find(([, re]) => re.test(s))?.[0] ?? 'อื่นๆ'
}
const short = (s, n = 46) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function causeMatrix(rows, topOffenses = 6) {
  const withCause = rows.filter((r) => causeGroup(r.cause))
  const causes = [...groupBy(withCause, (r) => causeGroup(r.cause))]
    .map(([name, l]) => ({ name, value: l.length })).sort((a, b) => b.value - a.value)
  const offenses = [...groupBy(withCause, 'offense')]
    .sort((a, b) => b[1].length - a[1].length).slice(0, topOffenses)
    .map(([name, l]) => {
      const counts = Object.fromEntries(causes.map((c) => [c.name, l.filter((r) => causeGroup(r.cause) === c.name).length]))
      const top = causes.map((c) => ({ name: c.name, value: counts[c.name] })).sort((a, b) => b.value - a.value)[0]
      return { name, short: short(name), total: l.length, counts, top }
    })
  return { filled: withCause.length, total: rows.length, causes, offenses }
}

/* 6. Risk points per driver (สูง 3, ปานกลาง 2, ต่ำ 1, ไม่ระบุ 1) in the range, against the previous
      range of the same length, and days since the driver's last record (all records). */
const points = (r) => (r.riskLevel >= 3 ? 3 : r.riskLevel === 2 ? 2 : 1)

export function riskScores(allRecords, rows, prev, limit = 15) {
  const last = new Map()
  for (const r of allRecords) if (!last.has(r.driver) || r.start > last.get(r.driver)) last.set(r.driver, r.start)
  const prevScore = new Map()
  for (const r of prev || []) prevScore.set(r.driver, (prevScore.get(r.driver) || 0) + points(r))
  const list = [...groupBy(rows, 'driver')].map(([name, l]) => ({
    name,
    unit: l[0].unit,
    score: l.reduce((s, r) => s + points(r), 0),
    count: l.length,
    high: l.filter((r) => r.riskLevel >= 3).length,
    before: prev ? prevScore.get(name) || 0 : null,
    quietDays: Math.floor((Date.now() - last.get(name)) / DAY),
  }))
  const top = [...list].sort((a, b) => b.score - a.score || b.high - a.high).slice(0, limit)
  // Improved: had points before, clearly fewer now (at least halved and down by 3+)
  const improved = prev
    ? [...prevScore].map(([name, before]) => {
      const now = list.find((d) => d.name === name)?.score || 0
      return { name, before, now }
    }).filter((d) => d.before >= 6 && d.now <= d.before / 2 && d.before - d.now >= 3)
      .sort((a, b) => b.before - b.now - (a.before - a.now)).slice(0, 8)
    : []
  return { top, improved, drivers: list.length }
}

/* 7. Harsh braking / acceleration records that carry G-force or start/end speeds. */
export function harshEvents(rows) {
  return rows
    .filter((r) => r.gforce !== null || (r.startSpeed !== null && r.endSpeed !== null))
    .map((r) => ({ ...r, drop: r.startSpeed !== null && r.endSpeed !== null ? r.startSpeed - r.endSpeed : null }))
    .sort((a, b) => (b.gforce ?? -1) - (a.gforce ?? -1) || (b.drop ?? 0) - (a.drop ?? 0))
}

/* 9. Near miss share by offense (only records where the Near miss cell was filled in). */
export function nearMissByOffense(rows, minN = 5) {
  const known = rows.filter((r) => r.nearMissKnown)
  const yes = known.filter((r) => r.nearMiss).length
  const list = [...groupBy(known, 'offense')]
    .filter(([, l]) => l.length >= minN)
    .map(([name, l]) => {
      const n = l.filter((r) => r.nearMiss).length
      return { name, short: short(name), total: l.length, yes: n, rate: (n / l.length) * 100 }
    })
    .sort((a, b) => b.rate - a.rate || b.yes - a.yes)
  return { known: known.length, yes, rate: known.length ? (yes / known.length) * 100 : 0, list }
}

export { stepLabel }
