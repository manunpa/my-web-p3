// Calculations for the help-button (ปุ่มช่วยเหลือ) page and its reports, so a dashboard panel and
// its table on the Reports page show the same numbers. Records come from src/helpData.js.
import { ACTIONS } from './helpData'

export const NONE = '(ไม่ระบุ)'
export const DAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์']
export const ACTION_IDS = Object.keys(ACTIONS)
export const REPEAT_MIN = 3 // a plate pressed this many times in the period counts as a repeat
export const BURST_MIN = 60 // presses by one plate this close together (minutes) form one burst
const RISE_MIN = 5 // a cause needs this many presses before it can be called "rising"

export const pctOf = (n, d) => (d ? (n / d) * 100 : null)
export const weekday = (r) => (r.start.getDay() + 6) % 7
export const known = (k) => !!k && k !== NONE
const fmtN = (n) => n.toLocaleString('th-TH')
const hh = (i) => String(i).padStart(2, '0')
export const hourLabel = (h) => `${hh(h)}:00–${hh((h + 1) % 24)}:00`

// Keeps "(ไม่ระบุ)" as its own group, like the dashboard's countBy.
export function groupBy(rows, key) {
  const m = new Map()
  for (const r of rows) {
    const k = (typeof key === 'function' ? key(r) : r[key]) || NONE
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(r)
  }
  return m
}
export const sorted = (m) => [...m].sort((a, b) => b[1].length - a[1].length)

export function actionMix(list) {
  const m = Object.fromEntries(ACTION_IDS.map((a) => [a, 0]))
  for (const r of list) m[r.action]++
  return m
}
// "RSC 3 · No action 1": the actions that happened, for table cells.
export const mixText = (mix) => ACTION_IDS.filter((a) => mix[a]).map((a) => `${ACTIONS[a].label} ${mix[a]}`).join(' · ')

// Most common known value of a field: { name, value } or null.
export function topOf(list, key) {
  let best = null
  for (const [name, l] of groupBy(list, key)) if (name !== NONE && (!best || l.length > best.value)) best = { name, value: l.length }
  return best
}
// "A 5 · B 3 · C 1": the top values of a field.
export const topText = (list, key, n = 3) => sorted(groupBy(list, key)).filter(([k]) => k !== NONE).slice(0, n).map(([k, l]) => `${k} ${l.length}`).join(' · ')
const distinct = (list, key) => new Set(list.map((r) => r[key]).filter(known)).size

/* ---------- 1. action by cause ---------- */

export function actionByCause(rows, prev) {
  const before = prev ? groupBy(prev, 'cause') : null
  return sorted(groupBy(rows, 'cause')).map(([name, list]) => {
    const mix = actionMix(list)
    return {
      name, list, count: list.length, pct: pctOf(list.length, rows.length), mix,
      nonePct: pctOf(mix.none, list.length), prevCount: before ? before.get(name)?.length || 0 : null,
    }
  })
}

/* ---------- 3. day of week x hour (presses with a time only) ---------- */

export function weekHeat(rows) {
  const out = DAYS.map((name) => ({ name, hours: Array(24).fill(0), total: 0, list: [] }))
  for (const r of rows) {
    if (!r.hasTime) continue
    const d = out[weekday(r)]
    d.hours[r.start.getHours()]++
    d.total++
    d.list.push(r)
  }
  return out
}
export function peakSlot(rows) {
  let best = null
  weekHeat(rows).forEach((d, i) => d.hours.forEach((v, h) => {
    if (v && (!best || v > best.count)) best = { day: d.name, dayIndex: i, hour: h, count: v }
  }))
  return best
}

/* ---------- 8. plates pressed again and again ---------- */

export function repeatPlates(rows, min = REPEAT_MIN) {
  return sorted(groupBy(rows, 'plate')).filter(([p, l]) => p !== NONE && l.length >= min).map(([plate, list]) => ({
    plate, list, count: list.length,
    days: new Set(list.map((r) => r.start.toDateString())).size,
    cause: topOf(list, 'cause'), unit: topOf(list, 'unit')?.name || NONE,
    drivers: distinct(list, 'driver'), mix: actionMix(list),
    last: new Date(Math.max(...list.map((r) => r.start))),
  }))
}

/* ---------- 9. bursts: one plate pressing again within a short time ---------- */

// Each run of presses by one plate where every press is within `minutes` of the one before.
export function bursts(rows, minutes = BURST_MIN) {
  const out = []
  for (const [plate, list] of groupBy(rows.filter((r) => r.hasTime), 'plate')) {
    if (plate === NONE) continue
    const l = [...list].sort((a, b) => a.start - b.start)
    let run = [l[0]]
    const flush = () => { if (run.length >= 2) out.push(burst(plate, run)) }
    for (let i = 1; i < l.length; i++) {
      if (l[i].start - l[i - 1].start <= minutes * 60000) run.push(l[i])
      else { flush(); run = [l[i]] }
    }
    flush()
  }
  return out.sort((a, b) => b.first - a.first)
}
function burst(plate, list) {
  const first = list[0].start, last = list.at(-1).start
  return {
    plate, list, count: list.length, first, last, span: (last - first) / 60000,
    causes: [...new Set(list.map((r) => r.cause).filter(known))].join(', '),
    unit: topOf(list, 'unit')?.name || NONE, driver: topOf(list, 'driver')?.name || NONE, mix: actionMix(list),
  }
}

/* ---------- 10. places that come back ---------- */

// District level: "อำเภอ|จังหวัด"; area level: "ตำบล · อำเภอ|จังหวัด". Only the province when the address
// says no more.
export const placeKey = (level) => (r) => {
  if (r.area) return `${level === 'area' ? r.area : r.area.split(' · ').pop()}|${r.province}`
  return known(r.province) ? r.province : NONE
}
export function hotspots(rows, level = 'district') {
  return sorted(groupBy(rows, placeKey(level))).filter(([k]) => k !== NONE).map(([key, list]) => {
    const [name, province] = key.includes('|') ? key.split('|') : [key, key]
    return {
      key, name, province, list, count: list.length, cause: topOf(list, 'cause'), plates: distinct(list, 'plate'), mix: actionMix(list),
      subs: level === 'district' ? topText(list, (r) => r.area.split(' · ')[0], 4) : '',
    }
  })
}

/* ---------- 11. is it the person or the truck? ---------- */

// Driver cells that name a test account or a team, not a person ("DTC TEST", "หน้างาน", "ช่าง PMS").
export const NOT_A_DRIVER = /test|ทดสอบ|เทส|หน้างาน|ช่าง|driving\s*license/i
export const isPerson = (name) => known(name) && !NOT_A_DRIVER.test(name)
export const SPREAD_MAIN = 60 // % of presses from one truck (or one driver) that makes it "the main one"

// by 'driver': how many trucks each driver pressed from. by 'plate': how many drivers pressed in each truck.
// mainPct: share of the most common truck (or driver).
export function spread(rows, by) {
  const people = rows.filter((r) => isPerson(r.driver))
  const other = by === 'driver' ? 'plate' : 'driver'
  return sorted(groupBy(people, by)).filter(([n]) => n !== NONE).map(([name, list]) => {
    const main = topOf(list, other)
    return {
      name, list, count: list.length, others: distinct(list, other), detail: topText(list, other, 4), cause: topOf(list, 'cause'),
      main: main?.name || '', mainPct: main ? pctOf(main.value, list.length) : null,
    }
  })
}

/* ---------- 12. speed when the button was pressed ---------- */

export const SPEED_BANDS = [
  { label: 'จอดอยู่ (0)', test: (v) => v === 0 },
  { label: '1–30 กม./ชม.', test: (v) => v > 0 && v <= 30 },
  { label: '31–60 กม./ชม.', test: (v) => v > 30 && v <= 60 },
  { label: '61–80 กม./ชม.', test: (v) => v > 60 && v <= 80 },
  { label: 'มากกว่า 80 กม./ชม.', test: (v) => v > 80 },
]
export const speedBand = (r) => (r.speedNum === null || r.speedNum === undefined ? NONE : SPEED_BANDS.find((b) => b.test(r.speedNum))?.label || NONE)

/* ---------- 14. data quality ---------- */

export const QUALITY = [
  { id: 'cause', label: 'ไม่ระบุสาเหตุ', test: (r) => r.cause === NONE },
  { id: 'action', label: 'ไม่ระบุการดำเนินการ', test: (r) => r.action === 'unknown' },
  { id: 'location', label: 'ไม่มีสถานที่', test: (r) => !r.location },
  { id: 'province', label: 'สถานที่ไม่บอกจังหวัด', test: (r) => !!r.location && r.province === NONE },
  { id: 'time', label: 'ไม่มีเวลาที่กด', test: (r) => !r.hasTime },
  { id: 'plate', label: 'ไม่มีหมายเลขรถ', test: (r) => r.plate === NONE },
  { id: 'driver', label: 'ไม่มีชื่อคนขับ', test: (r) => r.driver === NONE },
  { id: 'unit', label: 'ไม่ระบุหน่วยงาน', test: (r) => r.unit === NONE },
  { id: 'alert', label: 'ไม่ระบุแจ้งเตือน', test: (r) => !r.alert },
]
export const missingText = (r) => QUALITY.filter((q) => q.test(r)).map((q) => q.label).join(', ')

/* ---------- 15–17. highlights and the copyable summary ---------- */

// Short findings for the "ควรรู้" card and the summary report. warn = worth a look.
// report: the Reports page table that shows the numbers behind it.
// until: end of the selected range; a long gap before it usually means the sheet has not been filled in.
export function highlights(rows, prev, until = Date.now()) {
  const out = []
  const n = rows.length
  if (!n) return out
  const lastAt = Math.max(...rows.map((r) => r.start))
  const quiet = Math.floor((Math.min(until, Date.now()) - lastAt) / 86400000)
  if (quiet >= 3) {
    out.push({
      text: `ไม่มีการกดปุ่มเลยตั้งแต่ ${new Date(lastAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} (${fmtN(quiet)} วัน) ข้อมูลในชีตอาจยังไม่อัปเดต ตัวเลขเทียบงวดก่อนจึงอาจต่ำกว่าจริง`,
      warn: true, report: 'help-daily',
    })
  }
  if (prev && prev.length) {
    const ch = pctOf(n - prev.length, prev.length)
    out.push({
      text: `กดปุ่ม ${fmtN(n)} ครั้ง ${Math.round(ch) === 0 ? 'เท่าเดิม' : `${ch > 0 ? 'เพิ่มขึ้น' : 'ลดลง'} ${Math.abs(ch).toFixed(0)}%`} จากช่วงก่อนหน้า (${fmtN(prev.length)} ครั้ง)`,
      warn: ch >= 20, report: 'help-daily',
    })
  } else out.push({ text: `กดปุ่ม ${fmtN(n)} ครั้ง`, report: 'help-daily' })

  const none = rows.filter((r) => r.action === 'none').length
  const nonePct = pctOf(none, n)
  let t = `No action ${fmtN(none)} ครั้ง (${nonePct.toFixed(0)}% ของทั้งหมด)`
  if (prev && prev.length) {
    const d = nonePct - pctOf(prev.filter((r) => r.action === 'none').length, prev.length)
    if (Math.abs(d) >= 1) t += ` ${d > 0 ? 'เพิ่มขึ้น' : 'ลดลง'} ${Math.abs(d).toFixed(0)} จุด %`
  }
  out.push({ text: t, warn: nonePct >= 40, report: 'help-noise' })

  // Test presses are counted on their own line below, so they never show up as the main cause.
  const real = (l) => l && l.filter((r) => !r.test)
  const causes = actionByCause(real(rows), real(prev)).filter((c) => c.name !== NONE)
  if (causes[0]) out.push({ text: `สาเหตุที่พบมากสุด (ไม่นับกดทดสอบ): ${causes[0].name} ${fmtN(causes[0].count)} ครั้ง (${causes[0].pct.toFixed(0)}%)`, report: 'help-action-cause' })
  if (prev) {
    const up = causes
      .filter((c) => c.count >= RISE_MIN && c.count >= c.prevCount * 1.5 && c.count - c.prevCount >= 3)
      .sort((a, b) => (b.count - b.prevCount) - (a.count - a.prevCount))[0]
    if (up) out.push({ text: `สาเหตุที่เพิ่มขึ้นชัด: ${up.name} จาก ${fmtN(up.prevCount)} เป็น ${fmtN(up.count)} ครั้ง`, warn: true, report: 'help-action-cause' })
  }

  const peak = peakSlot(rows)
  if (peak && peak.count >= 2) out.push({ text: `ช่วงที่กดบ่อยสุด: วัน${peak.day} ${hourLabel(peak.hour)} (${fmtN(peak.count)} ครั้ง)`, report: 'help-week-hour' })

  const rep = repeatPlates(rows)
  if (rep.length) out.push({ text: `${fmtN(rep.length)} คันกดตั้งแต่ ${REPEAT_MIN} ครั้งขึ้นไป · มากสุด ${rep[0].plate} ${fmtN(rep[0].count)} ครั้ง`, warn: true, report: 'help-repeat-plates' })

  const b = bursts(rows)
  if (b.length) {
    const cars = new Set(b.map((x) => x.plate)).size
    out.push({ text: `รถคันเดียวกันกดซ้ำภายใน ${BURST_MIN} นาที ${fmtN(b.length)} ชุด (${fmtN(cars)} คัน)`, warn: true, report: 'help-bursts' })
  }

  const h = hotspots(rows)[0]
  if (h && h.count >= 3) out.push({ text: `พื้นที่ที่กดบ่อยสุด: ${h.name}${h.name !== h.province ? ` ${h.province}` : ''} ${fmtN(h.count)} ครั้ง`, report: 'help-hotspots' })

  const noCause = rows.filter((r) => r.cause === NONE).length
  if (pctOf(noCause, n) >= 5) out.push({ text: `${pctOf(noCause, n).toFixed(0)}% ไม่ระบุสาเหตุ (${fmtN(noCause)} ครั้ง)`, warn: true, report: 'help-quality' })

  const tests = rows.filter((r) => r.test).length
  if (tests) out.push({ text: `กดทดสอบ ${fmtN(tests)} ครั้ง`, report: 'help-noise' })
  return out
}

// Plain text for LINE / a meeting note.
export function summaryText(rows, prev, periodText, scope = '', until) {
  const mix = actionMix(rows)
  const hl = highlights(rows, prev, until).map((h) => `• ${h.text}`)
  const actions = `• RSC ${fmtN(mix.rsc)} · Operation ${fmtN(mix.operation)} · No action ${fmtN(mix.none)}${mix.unknown ? ` · ไม่ระบุ ${fmtN(mix.unknown)}` : ''}`
  return [`สรุปปุ่มช่วยเหลือ ${periodText}${scope ? ` (${scope})` : ''}`, ...hl.slice(0, 1), actions, ...hl.slice(1)].join('\n')
}
