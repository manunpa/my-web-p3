// Driver behavior (บันทึกพฤติกรรม พขร.) reports. Each title is the same as the dashboard panel it
// comes from, and the numbers use the same calculations (src/behaviorInsights.js, behaviorData.js),
// so the table matches what the panel shows. Driver names are keyed in per case, so per-driver
// tables are reliable here (unlike LEO, where the name is the loader).
import { loadBehavior, LATE_DAYS, AGE_BANDS, SPEED_BANDS, ageDays } from '../behaviorData'
import {
  PENALTY_STEPS, penaltyStep, stepLabel, repeats, penaltyEffect, penaltyBeforeAfter, WINDOWS, penaltyByUnit,
  MIN_JUDGED, riskScores, harshEvents, causeMatrix, causeGroup, isFatigue, fatigueKind, nonCooperation, fatigueByUnit,
  fatigueRepeats, fatigueWeek, fatiguePlaces, nearMissByOffense,
} from '../behaviorInsights'

const DAY = 86400000
const NONE = '(ไม่ระบุ)'

// Dated records with the extra fields the tables show. Undated rows cannot fall in a period.
async function load() {
  const { records } = await loadBehavior()
  return records.filter((r) => r.start).map((r) => ({
    ...r,
    place: r.district ? `${r.district} · ${r.province}` : r.province || r.location,
    vrLabel: r.responded ? 'ตอบกลับแล้ว' : `รอ ${ageDays(r)} วัน`,
    nearMissLabel: r.nearMiss ? 'ใช่' : r.nearMissKnown ? 'ไม่ใช่' : '',
  }))
}

export const BEHAVIOR_DETAIL = [
  { key: 'start', label: 'วันที่ / เวลา', type: 'date' },
  { key: 'unit', label: 'หน่วยงาน' },
  { key: 'driver', label: 'พขร.' },
  { key: 'plate', label: 'ทะเบียน' },
  { key: 'behavior', label: 'ประเภทพฤติกรรม' },
  { key: 'offense', label: 'ชนิดความผิด', wrap: true },
  { key: 'risk', label: 'ความเสี่ยง' },
  { key: 'maxSpeed', label: 'ความเร็วสูงสุด', type: 'num' },
  { key: 'nearMissLabel', label: 'Near miss' },
  { key: 'penalty', label: 'บทลงโทษ' },
  { key: 'cause', label: 'สาเหตุ', wrap: true },
  { key: 'vrLabel', label: 'ใบ VR' },
  { key: 'place', label: 'พื้นที่' },
  { key: 'vrid', label: 'VRID' },
]

// Keeps "(ไม่ระบุ)" as its own group, like the dashboard's countBy.
const groupBy = (rows, key) => {
  const m = new Map()
  for (const r of rows) {
    const k = (typeof key === 'function' ? key(r) : r[key]) || NONE
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(r)
  }
  return m
}
const sorted = (m) => [...m].sort((a, b) => b[1].length - a[1].length)
const pctOf = (n, d) => (d ? (n / d) * 100 : null)
const high = (r) => r.riskLevel >= 3
const nHigh = (l) => l.filter(high).length
const nNear = (l) => l.filter((r) => r.nearMiss).length
const nDone = (l) => l.filter((r) => r.responded).length
const fmtN = (n) => n.toLocaleString('th-TH')
const hh = (i) => String(i).padStart(2, '0')
const HOUR_COLS = Array.from({ length: 24 }, (_, i) => ({ key: `h${i}`, label: hh(i), type: 'int' }))
const hourCells = (l) => Object.fromEntries(HOUR_COLS.map((c, i) => [c.key, l.filter((r) => r.hasTime && r.start.getHours() === i).length]))
const monthKey = (d) => `${d.getFullYear()}-${hh(d.getMonth() + 1)}`
const monthLabel = (k) => {
  const [y, m] = k.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('th-TH', { month: 'short', year: '2-digit' })
}
const monthsOf = (rows) => [...new Set(rows.map((r) => monthKey(r.start)))].sort()
const STEP_COLS = PENALTY_STEPS.map((s) => ({ key: `s${s.step}`, label: s.label, type: 'int' }))
const stepCells = (mix) => Object.fromEntries(PENALTY_STEPS.map((s, i) => [`s${s.step}`, mix[i]]))
const DAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์']
const weekday = (r) => (r.start.getDay() + 6) % 7

// Share of each group now, against the previous period of the same length (percentage points).
function shares(rows, prev, key) {
  const before = prev ? groupBy(prev, key) : null
  return sorted(groupBy(rows, key)).map(([name, l]) => ({
    name, list: l, count: l.length, pct: pctOf(l.length, rows.length),
    delta: before && prev.length ? pctOf(l.length, rows.length) - pctOf(before.get(name)?.length || 0, prev.length) : null,
  }))
}

const DETAIL_BY = [['offense', 'ชนิดความผิด'], ['offenseStatusType', 'ประเภทสถานะ'], ['offenseStatus', 'สถานะความผิด'], ['penalty', 'บทลงโทษ'], ['cause', 'สาเหตุ'], ['ppe', 'อุปกรณ์ที่ไม่สวมใส่']]
const behaviorChoices =(recs) => [['', 'ทุกประเภท'], ...sorted(groupBy(recs, 'behavior')).map(([n]) => [n, n])]

export const BEHAVIOR_REPORTS = [
  {
    id: 'bh-daily',
    title: 'จำนวนบันทึกพฤติกรรมรายวัน',
    desc: 'บันทึกต่อวัน พร้อมความเสี่ยงสูง Near miss และการตอบกลับ',
    build({ rows, range }) {
      const out = []
      for (let t = range.from; t < range.to; t += DAY) {
        const l = rows.filter((r) => r.start >= t && r.start < t + DAY)
        if (!l.length && range.kind === 'all') continue
        out.push({ _key: t, _detail: l, day: new Date(t), count: l.length, high: nHigh(l), near: nNear(l), done: nDone(l), waiting: l.length - nDone(l) })
      }
      return {
        cols: [
          { key: 'day', label: 'วันที่', type: 'day' },
          { key: 'count', label: 'บันทึก', type: 'int' },
          { key: 'high', label: 'ความเสี่ยงสูง', type: 'int' },
          { key: 'near', label: 'Near miss', type: 'int' },
          { key: 'done', label: 'ตอบกลับแล้ว', type: 'int' },
          { key: 'waiting', label: 'รอตอบกลับ', type: 'int' },
        ],
        rows: out.reverse(),
        total: { count: rows.length, high: nHigh(rows), near: nNear(rows), done: nDone(rows), waiting: rows.length - nDone(rows) },
      }
    },
  },
  {
    id: 'bh-risk',
    title: 'ระดับความเสี่ยง',
    desc: 'จำนวนและสัดส่วนแต่ละระดับ เทียบงวดก่อน และได้รับโทษกี่เคส',
    build({ rows, prev }) {
      const out = shares(rows, prev, 'risk').map((s) => ({
        _key: s.name, _detail: s.list, risk: s.name, lvl: s.list[0].riskLevel, count: s.count, pct: s.pct, delta: s.delta,
        done: nDone(s.list), penalized: s.list.filter((r) => penaltyStep(r.penalty) >= 1).length, near: nNear(s.list),
      })).sort((a, b) => b.lvl - a.lvl || b.count - a.count)
      return {
        cols: [
          { key: 'risk', label: 'ระดับความเสี่ยง' },
          { key: 'count', label: 'บันทึก', type: 'int' },
          { key: 'pct', label: 'สัดส่วน', type: 'pct' },
          ...(prev ? [{ key: 'delta', label: 'เทียบงวดก่อน (จุด %)', type: 'pp' }] : []),
          { key: 'done', label: 'ตอบกลับแล้ว', type: 'int' },
          { key: 'penalized', label: 'ได้รับโทษ', type: 'int' },
          { key: 'near', label: 'Near miss', type: 'int' },
        ],
        rows: out,
        total: { count: rows.length, pct: 100, done: nDone(rows), penalized: rows.filter((r) => penaltyStep(r.penalty) >= 1).length, near: nNear(rows) },
        notes: [`ความเสี่ยงสูงขึ้นไป ${fmtN(nHigh(rows))} บันทึก (${(pctOf(nHigh(rows), rows.length) ?? 0).toFixed(0)}%)`],
        footnote: '"ได้รับโทษ" = ตักเตือนด้วยวาจาขึ้นไป',
      }
    },
  },
  {
    id: 'bh-monthly',
    title: 'สถิติรายเดือน',
    desc: 'แต่ละเดือนในช่วงที่เลือก: บันทึก ตอบกลับ ความเสี่ยงสูง Near miss',
    build({ rows }) {
      const out = monthsOf(rows).map((m) => {
        const l = rows.filter((r) => monthKey(r.start) === m)
        return { _key: m, _detail: l, month: monthLabel(m), count: l.length, done: nDone(l), waiting: l.length - nDone(l), pctDone: pctOf(nDone(l), l.length), high: nHigh(l), near: nNear(l) }
      })
      return {
        cols: [
          { key: 'month', label: 'เดือน' },
          { key: 'count', label: 'บันทึก', type: 'int' },
          { key: 'done', label: 'ตอบกลับแล้ว', type: 'int' },
          { key: 'waiting', label: 'รอตอบกลับ', type: 'int' },
          { key: 'pctDone', label: '% ตอบกลับ', type: 'pct' },
          { key: 'high', label: 'ความเสี่ยงสูง', type: 'int' },
          { key: 'near', label: 'Near miss', type: 'int' },
        ],
        rows: out,
        total: { count: rows.length, done: nDone(rows), waiting: rows.length - nDone(rows), pctDone: pctOf(nDone(rows), rows.length), high: nHigh(rows), near: nNear(rows) },
      }
    },
  },
  {
    id: 'bh-unit-response',
    title: 'การตอบกลับรายหน่วยงาน',
    desc: `หน่วยงานไหนตอบกลับ (ใบ VR) แล้วกี่ % ค้างเกิน ${LATE_DAYS} วันกี่รายการ`,
    build({ rows }) {
      const out = [...groupBy(rows, 'unit')].map(([name, l]) => {
        const wait = l.filter((r) => !r.responded)
        return {
          _key: name, _detail: l, name, count: l.length, done: l.length - wait.length, waiting: wait.length,
          pctDone: pctOf(l.length - wait.length, l.length), late: wait.filter((r) => ageDays(r) > LATE_DAYS).length,
          oldest: wait.length ? Math.max(...wait.map(ageDays)) : null,
        }
      }).sort((a, b) => b.waiting - a.waiting || b.count - a.count)
      const wait = rows.filter((r) => !r.responded)
      const late = wait.filter((r) => ageDays(r) > LATE_DAYS).length
      return {
        cols: [
          { key: 'name', label: 'หน่วยงาน' },
          { key: 'count', label: 'บันทึก', type: 'int' },
          { key: 'done', label: 'ตอบกลับแล้ว', type: 'int' },
          { key: 'waiting', label: 'รอตอบกลับ', type: 'int' },
          { key: 'pctDone', label: '% ตอบกลับ', type: 'pct' },
          { key: 'late', label: `ค้างเกิน ${LATE_DAYS} วัน`, type: 'int' },
          { key: 'oldest', label: 'ค้างนานสุด (วัน)', type: 'int' },
        ],
        rows: out,
        total: { count: rows.length, done: rows.length - wait.length, waiting: wait.length, pctDone: pctOf(rows.length - wait.length, rows.length), late },
        notes: [`รอตอบกลับ ${fmtN(wait.length)} รายการ ค้างเกิน ${LATE_DAYS} วัน ${fmtN(late)} รายการ`],
        footnote: 'ตอบกลับแล้ว = มีใบ VR · จำนวนวันนับจากวันที่เกิดเหตุถึงวันนี้',
      }
    },
  },
  {
    id: 'bh-waiting-age',
    title: 'รอตอบกลับมานานเท่าไร',
    desc: 'รายการที่ยังไม่มีใบ VR แยกตามจำนวนวันที่รอ',
    build({ rows }) {
      const wait = rows.filter((r) => !r.responded)
      const out = AGE_BANDS.map((b) => {
        const l = wait.filter((r) => b.test(ageDays(r))).sort((x, y) => x.start - y.start)
        return { _key: b.label, _detail: l, band: b.label, count: l.length, pct: pctOf(l.length, wait.length), units: new Set(l.map((r) => r.unit)).size }
      })
      return {
        cols: [
          { key: 'band', label: 'รอมาแล้ว' },
          { key: 'count', label: 'รายการ', type: 'int' },
          { key: 'pct', label: 'สัดส่วน', type: 'pct' },
          { key: 'units', label: 'จำนวนหน่วยงาน', type: 'int' },
        ],
        rows: out,
        total: { count: wait.length, pct: wait.length ? 100 : null, units: new Set(wait.map((r) => r.unit)).size },
        notes: [wait.length ? `ยังรอตอบกลับ ${fmtN(wait.length)} จาก ${fmtN(rows.length)} รายการ` : 'ตอบกลับครบทุกรายการแล้ว'],
        footnote: 'นับจากวันที่เกิดเหตุถึงวันนี้',
      }
    },
  },
  {
    id: 'bh-rank',
    title: 'อันดับสูงสุด',
    desc: 'จัดอันดับจำนวนบันทึก ตาม พขร. ทะเบียน หน่วยงาน หรือจังหวัด',
    options: [
      { id: 'by', label: 'จัดอันดับตาม', choices: [['driver', 'พขร.'], ['plate', 'ทะเบียน'], ['unit', 'หน่วยงาน'], ['province', 'จังหวัด']] },
      { id: 'behavior', label: 'ประเภทพฤติกรรม', choices: behaviorChoices },
    ],
    build({ rows, opt }) {
      const by = opt.by || 'driver'
      const src = opt.behavior ? rows.filter((r) => r.behavior === opt.behavior) : rows
      const label = { driver: 'พขร.', plate: 'ทะเบียน', unit: 'หน่วยงาน', province: 'จังหวัด' }[by]
      return {
        cols: [
          { key: 'rank', label: '#', type: 'int' },
          { key: 'name', label },
          ...(by === 'driver' || by === 'plate' ? [{ key: 'unit', label: 'หน่วยงาน' }] : []),
          { key: 'count', label: 'บันทึก', type: 'int' },
          { key: 'pct', label: 'สัดส่วน', type: 'pct' },
          { key: 'high', label: 'ความเสี่ยงสูง', type: 'int' },
          { key: 'near', label: 'Near miss', type: 'int' },
          { key: 'pctDone', label: '% ตอบกลับ', type: 'pct' },
          { key: 'top', label: 'ชนิดความผิดที่พบมากสุด', wrap: true },
        ],
        rows: sorted(groupBy(src, by)).map(([name, l], i) => {
          const t = sorted(groupBy(l, 'offense'))[0]
          const u = sorted(groupBy(l, 'unit'))
          return {
            _key: name, _detail: l, rank: i + 1, name, unit: u.length > 1 ? `${u[0][0]} +${u.length - 1}` : u[0][0],
            count: l.length, pct: pctOf(l.length, src.length), high: nHigh(l), near: nNear(l), pctDone: pctOf(nDone(l), l.length),
            top: t ? `${t[0]} (${t[1].length})` : '',
          }
        }),
        total: { count: src.length, pct: 100, high: nHigh(src), near: nNear(src), pctDone: pctOf(nDone(src), src.length) },
      }
    },
  },
  {
    id: 'bh-behavior',
    title: 'ประเภทพฤติกรรม',
    desc: 'แต่ละประเภทคิดเป็นกี่ % เทียบงวดก่อน ความเสี่ยงสูง และชนิดความผิดหลัก',
    build({ rows, prev }) {
      const out = shares(rows, prev, 'behavior').map((s) => {
        const t = sorted(groupBy(s.list, 'offense'))[0]
        return {
          _key: s.name, _detail: s.list, name: s.name, count: s.count, pct: s.pct, delta: s.delta,
          high: nHigh(s.list), near: nNear(s.list), drivers: new Set(s.list.map((r) => r.driver)).size,
          top: t ? `${t[0]} (${t[1].length})` : '',
        }
      })
      return {
        cols: [
          { key: 'name', label: 'ประเภทพฤติกรรม' },
          { key: 'count', label: 'บันทึก', type: 'int' },
          { key: 'pct', label: 'สัดส่วน', type: 'pct' },
          ...(prev ? [{ key: 'delta', label: 'เทียบงวดก่อน (จุด %)', type: 'pp' }] : []),
          { key: 'high', label: 'ความเสี่ยงสูง', type: 'int' },
          { key: 'near', label: 'Near miss', type: 'int' },
          { key: 'drivers', label: 'จำนวน พขร.', type: 'int' },
          { key: 'top', label: 'ชนิดความผิดที่พบมากสุด', wrap: true },
        ],
        rows: out,
        total: { count: rows.length, pct: 100, high: nHigh(rows), near: nNear(rows), drivers: new Set(rows.map((r) => r.driver)).size },
        notes: out[0] ? [`ประเภทที่พบมากสุดคือ ${out[0].name} ${fmtN(out[0].count)} บันทึก (${out[0].pct.toFixed(0)}%)`] : [],
      }
    },
  },
  {
    id: 'bh-detail',
    title: 'รายละเอียดความผิด',
    desc: 'นับตามชนิดความผิด สถานะ บทลงโทษ สาเหตุ หรืออุปกรณ์ที่ไม่สวมใส่',
    options: [{ id: 'by', label: 'แสดงตาม', choices: DETAIL_BY }],
    build({ rows, opt }) {
      const by = opt.by || 'offense'
      const onlyDone = by === 'penalty' || by === 'cause'
      let src = onlyDone ? rows.filter((r) => r.responded) : rows
      if (by === 'ppe') src = src.filter((r) => r.ppe)
      const label = DETAIL_BY.find((c) => c[0] === by)[1]
      return {
        cols: [
          { key: 'rank', label: '#', type: 'int' },
          { key: 'name', label, wrap: true },
          { key: 'count', label: 'บันทึก', type: 'int' },
          { key: 'pct', label: 'สัดส่วน', type: 'pct' },
          { key: 'high', label: 'ความเสี่ยงสูง', type: 'int' },
          { key: 'drivers', label: 'จำนวน พขร.', type: 'int' },
        ],
        rows: sorted(groupBy(src, by)).map(([name, l], i) => ({
          _key: name, _detail: l, rank: i + 1, name, count: l.length, pct: pctOf(l.length, src.length), high: nHigh(l), drivers: new Set(l.map((r) => r.driver)).size,
        })),
        total: { count: src.length, pct: 100, high: nHigh(src), drivers: new Set(src.map((r) => r.driver)).size },
        notes: onlyDone ? [`นับเฉพาะรายการที่ตอบกลับแล้ว ${fmtN(src.length)} จาก ${fmtN(rows.length)} รายการ`] : by === 'ppe' ? [`นับเฉพาะรายการที่กรอกอุปกรณ์ ${fmtN(src.length)} รายการ`] : [],
      }
    },
  },
  {
    id: 'bh-speed',
    title: 'ความเร็วสูงสุด',
    desc: 'จำนวนบันทึกตามช่วงความเร็วสูงสุด (กม./ชม.)',
    build({ rows }) {
      const withSpeed = rows.filter((r) => r.maxSpeed !== null)
      const out = SPEED_BANDS.map((b) => {
        const l = withSpeed.filter((r) => b.test(r.maxSpeed)).sort((x, y) => y.maxSpeed - x.maxSpeed)
        return { _key: b.label, _detail: l, band: b.label, count: l.length, pct: pctOf(l.length, withSpeed.length), high: nHigh(l), drivers: new Set(l.map((r) => r.driver)).size }
      })
      return {
        cols: [
          { key: 'band', label: 'ความเร็วสูงสุด (กม./ชม.)' },
          { key: 'count', label: 'บันทึก', type: 'int' },
          { key: 'pct', label: 'สัดส่วน', type: 'pct' },
          { key: 'high', label: 'ความเสี่ยงสูง', type: 'int' },
          { key: 'drivers', label: 'จำนวน พขร.', type: 'int' },
        ],
        rows: out,
        total: { count: withSpeed.length, pct: withSpeed.length ? 100 : null, high: nHigh(withSpeed), drivers: new Set(withSpeed.map((r) => r.driver)).size },
        notes: [`มีความเร็ว ${fmtN(withSpeed.length)} จาก ${fmtN(rows.length)} รายการ`],
      }
    },
  },
  {
    id: 'bh-hour',
    title: 'ช่วงเวลาที่เกิดเหตุ',
    desc: 'จำนวนบันทึกตามชั่วโมงที่เกิดเหตุ (00–23) แยกตามประเภทพฤติกรรมหรือวันในสัปดาห์',
    options: [{ id: 'by', label: 'แยกตาม', choices: [['behavior', 'ประเภทพฤติกรรม'], ['day', 'วันในสัปดาห์']] }],
    build({ rows, opt }) {
      const timed = rows.filter((r) => r.hasTime)
      const groups = opt.by === 'day'
        ? DAYS.map((d, i) => [d, timed.filter((r) => weekday(r) === i)])
        : sorted(groupBy(timed, 'behavior'))
      return {
        cols: [{ key: 'name', label: opt.by === 'day' ? 'วัน' : 'ประเภทพฤติกรรม' }, ...HOUR_COLS, { key: 'total', label: 'รวม', type: 'int' }],
        rows: groups.map(([name, l]) => ({ _key: name, _detail: l, name, ...hourCells(l), total: l.length })),
        total: { ...hourCells(timed), total: timed.length },
        notes: timed.length < rows.length ? [`ไม่นับ ${fmtN(rows.length - timed.length)} รายการที่ไม่ได้กรอกเวลา`] : [],
      }
    },
  },
  {
    id: 'bh-repeats',
    title: 'ทำผิดซ้ำ และบทลงโทษไล่ระดับไหม',
    desc: 'พขร. ที่มีบันทึก 2 ครั้งขึ้นไป ได้รับโทษระดับไหนบ้าง',
    build({ rows }) {
      const by = groupBy(rows, 'driver')
      const list = repeats(rows, Infinity)
      const out = list.map((d) => ({
        _key: d.name, _detail: [...(by.get(d.name) || [])].sort((a, b) => b.start - a.start),
        name: d.name, unit: d.moreUnits ? `${d.unit} +${d.moreUnits}` : d.unit, count: d.count, high: d.high,
        ...Object.fromEntries(PENALTY_STEPS.map((s) => [`s${s.step}`, d.given[s.step]])),
        pending: d.pending, max: d.maxStep === null ? 'รอผล' : stepLabel(d.maxStep), flag: d.flat ? 'โทษไม่ไล่ระดับ' : '', last: d.last,
      }))
      const flat = list.filter((d) => d.flat).length
      return {
        cols: [
          { key: 'name', label: 'พขร.' },
          { key: 'unit', label: 'หน่วยงาน' },
          { key: 'count', label: 'บันทึก', type: 'int' },
          { key: 'high', label: 'ความเสี่ยงสูง', type: 'int' },
          ...STEP_COLS,
          { key: 'pending', label: 'รอผล', type: 'int' },
          { key: 'max', label: 'โทษสูงสุดที่ได้' },
          { key: 'flag', label: '' },
          { key: 'last', label: 'ครั้งล่าสุด', type: 'date' },
        ],
        rows: out,
        notes: [`${fmtN(list.length)} คนมีบันทึก 2 ครั้งขึ้นไป${flat ? ` · ${fmtN(flat)} คนพิจารณาแล้ว 3 ครั้งขึ้นไปแต่ไม่เคยได้โทษเกินตักเตือนด้วยวาจา` : ''}`],
        footnote: 'ป้าย "โทษไม่ไล่ระดับ": พิจารณาแล้ว 3 ครั้งขึ้นไป แต่โทษสูงสุดยังไม่เกินตักเตือนด้วยวาจา',
      }
    },
  },
  {
    id: 'bh-near-miss',
    title: 'Near miss',
    desc: 'บันทึกที่เกือบเกิดอุบัติเหตุ คิดเป็นกี่ % ของแต่ละชนิดความผิด',
    build({ rows }) {
      const n = nearMissByOffense(rows, 1)
      const by = groupBy(rows.filter((r) => r.nearMiss), 'offense')
      return {
        cols: [
          { key: 'name', label: 'ชนิดความผิด', wrap: true },
          { key: 'total', label: 'บันทึกที่ระบุ Near miss', type: 'int' },
          { key: 'yes', label: 'เป็น Near miss', type: 'int' },
          { key: 'rate', label: '% Near miss', type: 'pct' },
        ],
        rows: n.list.map((x) => ({ _key: x.name, _detail: by.get(x.name) || [], ...x })),
        total: { total: n.known, yes: n.yes, rate: n.rate },
        notes: [`Near miss ${fmtN(n.yes)} จาก ${fmtN(n.known)} บันทึกที่กรอกช่อง Near miss (${n.rate.toFixed(n.rate < 10 ? 1 : 0)}%)`],
        footnote: 'แดชบอร์ดแสดงเฉพาะชนิดความผิดที่มีอย่างน้อย 5 บันทึก ตารางนี้แสดงทุกชนิด',
      }
    },
  },
  {
    id: 'bh-effect-ba',
    title: 'บทลงโทษแบบไหนได้ผล: คนเดิมก่อน–หลัง',
    desc: 'บันทึกเฉลี่ยต่อคนก่อนและหลังได้รับผลพิจารณาแต่ละระดับ',
    options: [{ id: 'w', label: 'ช่วงเทียบ', choices: WINDOWS.map((d) => [String(d), `${d} วัน`]) }],
    build({ rows, all, opt }) {
      const w = +opt.w || WINDOWS[0]
      const ba = penaltyBeforeAfter(all, rows, w)
      const base = ba.find((p) => p.step === 0)
      return {
        cols: [
          { key: 'name', label: 'ผลพิจารณา' },
          { key: 'given', label: 'ให้ไป (ครั้ง)', type: 'int' },
          { key: 'n', label: 'นับได้', type: 'int' },
          { key: 'before', label: `เฉลี่ย ${w} วันก่อน`, type: 'num' },
          { key: 'after', label: `เฉลี่ย ${w} วันหลัง`, type: 'num' },
          { key: 'change', label: 'เปลี่ยนแปลง (%)', type: 'pp' },
          { key: 'fewer', label: 'คนที่ลดลง', type: 'pct' },
          { key: 'more', label: 'คนที่เพิ่มขึ้น', type: 'pct' },
          { key: 'same', label: 'ผิดชนิดเดิมซ้ำ', type: 'pct' },
        ],
        rows: ba.map((p) => ({ _key: p.name, _detail: rows.filter((r) => penaltyStep(r.penalty) === p.step), ...p })),
        notes: [
          `เทียบจำนวนบันทึกของ พขร. คนเดิมใน ${w} วันก่อนกับ ${w} วันหลังวันที่เกิดเหตุที่ได้รับผลนั้น`,
          ...(base && base.change !== null ? [`เกณฑ์เทียบ (ไม่มีความผิด) เปลี่ยน ${base.change > 0 ? '+' : ''}${base.change.toFixed(0)}% · โทษที่ลดได้มากกว่านี้จึงถือว่าได้ผล`] : []),
        ],
        footnote: `นับเฉพาะเคสที่มีข้อมูลครบ ${w} วันทั้งก่อนและหลัง (ดูประวัติทุกหน่วยงาน) · "นับได้" น้อยกว่า 10 ใช้ดูแนวโน้มเท่านั้น`,
      }
    },
  },
  {
    id: 'bh-effect-again',
    title: 'บทลงโทษแบบไหนได้ผล: ทำผิดซ้ำภายในกี่วัน',
    desc: `% ที่ พขร. มีบันทึกใหม่ภายใน ${WINDOWS.join(' / ')} วันหลังได้รับผล`,
    build({ rows, all }) {
      const eff = penaltyEffect(all, rows)
      return {
        cols: [
          { key: 'name', label: 'ผลพิจารณา' },
          { key: 'given', label: 'ให้ไป (ครั้ง)', type: 'int' },
          ...WINDOWS.flatMap((w) => [{ key: `r${w}`, label: `ซ้ำใน ${w} วัน`, type: 'pct' }, { key: `n${w}`, label: `(${w} วัน: ซ้ำ/นับได้)` }]),
        ],
        rows: eff.map((p) => ({
          _key: p.name, _detail: rows.filter((r) => penaltyStep(r.penalty) === p.step), name: p.name, given: p.given,
          ...Object.fromEntries(p.windows.flatMap((x) => [[`r${x.days}`, x.rate], [`n${x.days}`, x.n ? `${x.again}/${x.n}` : '']])),
        })),
        notes: ['ตารางนี้เทียบข้ามคน: คนที่ได้โทษหนักมักผิดบ่อยอยู่แล้ว % จึงสูงตามไปด้วย ดูรายงาน "คนเดิมก่อน–หลัง" ประกอบ'],
        footnote: 'นับเฉพาะครั้งที่ผ่านมาครบช่วงแล้ว · ดูบันทึกใหม่จากทุกหน่วยงาน',
      }
    },
  },
  {
    id: 'bh-unit-penalty',
    title: 'เกณฑ์ลงโทษของแต่ละหน่วยงาน',
    desc: 'ผลพิจารณาของรายการที่ตอบกลับแล้ว แยกตามหน่วยงานหรือระดับความเสี่ยง',
    options: [{ id: 'by', label: 'แยกตาม', choices: [['unit', 'หน่วยงาน'], ['risk', 'ระดับความเสี่ยง']] }],
    build({ rows, opt }) {
      const p = penaltyByUnit(rows)
      const judged = rows.filter((r) => penaltyStep(r.penalty) !== null)
      const jTotal = { total: judged.length, ...stepCells(PENALTY_STEPS.map((s) => judged.filter((r) => penaltyStep(r.penalty) === s.step).length)) }
      if (opt.by === 'risk') {
        const lvl = (r) => (r.riskLevel >= 3 ? 'สูง' : r.riskLevel === 2 ? 'ปานกลาง' : r.riskLevel === 1 ? 'ต่ำ' : '')
        return {
          cols: [{ key: 'name', label: 'ระดับความเสี่ยง' }, { key: 'total', label: 'พิจารณาแล้ว', type: 'int' }, ...STEP_COLS, { key: 'penalized', label: '% มีโทษ', type: 'pct' }],
          rows: p.byRisk.map((x) => ({
            _key: x.name, _detail: judged.filter((r) => lvl(r) === x.name), name: x.name, total: x.total, ...stepCells(x.mix),
            penalized: pctOf(x.total - x.mix[0], x.total),
          })),
          total: { ...jTotal, penalized: pctOf(judged.filter((r) => penaltyStep(r.penalty) >= 1).length, judged.length) },
          footnote: 'ทุกหน่วยงานรวมกัน · ระดับ "ไม่ระบุ" ไม่อยู่ในตารางนี้',
        }
      }
      const strict = new Set(p.mismatch?.strict.map((u) => u.name) || [])
      const lenient = new Set(p.mismatch?.lenient.map((u) => u.name) || [])
      const by = groupBy(judged, 'unit')
      return {
        cols: [
          { key: 'name', label: 'หน่วยงาน' },
          { key: 'flag', label: '' },
          { key: 'total', label: 'พิจารณาแล้ว', type: 'int' },
          ...STEP_COLS,
          { key: 'penalized', label: '% มีโทษ', type: 'pct' },
          { key: 'high', label: 'เคสเสี่ยงสูง', type: 'int' },
          { key: 'highRate', label: '% เสี่ยงสูงที่มีโทษ', type: 'pct' },
        ],
        rows: p.units.map((u) => ({
          _key: u.name, _detail: by.get(u.name) || [], name: u.name,
          flag: strict.has(u.name) ? 'เข้มกว่า' : lenient.has(u.name) ? 'ไม่ลงโทษเคสเสี่ยงสูง' : '',
          total: u.total, ...stepCells(u.mix), penalized: pctOf(u.penalized, u.total), high: u.high, highRate: u.highRate,
        })),
        total: jTotal,
        notes: p.mismatch
          ? [`เกณฑ์ไม่ตรงกัน: ${p.mismatch.strict.map((u) => `${u.name} ลงโทษเคสเสี่ยงสูง ${u.highRate.toFixed(0)}%`).join(', ')} แต่ ${p.mismatch.lenient.map((u) => u.name).join(', ')} ไม่ลงโทษเลย`]
          : ['ไม่พบหน่วยงานที่ใช้เกณฑ์ต่างกันชัดเจน'],
        footnote: `แสดงหน่วยงานที่พิจารณาแล้วอย่างน้อย 5 เคส · ป้ายขึ้นเมื่อหน่วยงานหนึ่งลงโทษเคสเสี่ยงสูง ≥ 20% แต่อีกหน่วยงาน 0% (ทั้งคู่มีเคสเสี่ยงสูง ≥ ${MIN_JUDGED})`,
      }
    },
  },
  {
    id: 'bh-scores',
    title: 'คะแนนความเสี่ยงราย พขร.',
    desc: 'คะแนนรวมตามระดับความเสี่ยง เทียบงวดก่อน และไม่มีบันทึกมากี่วัน',
    build({ rows, prev, all }) {
      const s = riskScores(all, rows, prev, Infinity)
      const by = groupBy(rows, 'driver')
      return {
        cols: [
          { key: 'rank', label: '#', type: 'int' },
          { key: 'name', label: 'พขร.' },
          { key: 'unit', label: 'หน่วยงาน' },
          { key: 'score', label: 'คะแนน', type: 'int' },
          { key: 'count', label: 'บันทึก', type: 'int' },
          { key: 'high', label: 'ความเสี่ยงสูง', type: 'int' },
          ...(prev ? [{ key: 'before', label: 'คะแนนงวดก่อน', type: 'int' }, { key: 'diff', label: 'เปลี่ยน', type: 'int' }] : []),
          { key: 'quietDays', label: 'ไม่มีบันทึกมา (วัน)', type: 'int' },
        ],
        rows: s.top.map((d, i) => ({ _key: d.name, _detail: by.get(d.name) || [], rank: i + 1, ...d, diff: prev ? d.score - d.before : null })),
        total: { score: s.top.reduce((a, d) => a + d.score, 0), count: rows.length, high: nHigh(rows) },
        notes: [
          `${fmtN(s.drivers)} พขร. มีบันทึกในช่วงนี้`,
          ...(s.improved.length ? [`ดีขึ้นชัดเจน: ${s.improved.map((d) => `${d.name} (${d.before} → ${d.now})`).join(', ')}`] : []),
        ],
        footnote: 'คะแนน: ความเสี่ยงสูง 3 · ปานกลาง 2 · ต่ำหรือไม่ระบุ 1 · "ไม่มีบันทึกมา" นับจากบันทึกล่าสุดทุกหน่วยงาน · ดีขึ้นชัดเจน = งวดก่อน ≥ 6 คะแนน และลดลงอย่างน้อยครึ่งหนึ่ง (≥ 3)',
      }
    },
  },
  {
    id: 'bh-harsh',
    title: 'เบรก / เร่งกระชาก',
    desc: 'รายการที่กรอกค่า G หรือความเร็วเริ่มต้น–ปลาย เรียงจากค่า G สูงสุด',
    detailOnly: true,
    build({ rows }) {
      const l = harshEvents(rows)
      return {
        cols: [
          { key: 'start', label: 'วันที่ / เวลา', type: 'date' },
          { key: 'driver', label: 'พขร.' },
          { key: 'unit', label: 'หน่วยงาน' },
          { key: 'plate', label: 'ทะเบียน' },
          { key: 'offense', label: 'ชนิดความผิด', wrap: true },
          { key: 'gforce', label: 'ค่า G', type: 'num' },
          { key: 'startSpeed', label: 'ความเร็วเริ่มต้น', type: 'num' },
          { key: 'endSpeed', label: 'ความเร็วปลาย', type: 'num' },
          { key: 'drop', label: 'ลดลง (กม./ชม.)', type: 'num' },
          { key: 'risk', label: 'ความเสี่ยง' },
          { key: 'penalty', label: 'บทลงโทษ' },
        ],
        rows: l,
        notes: [`${fmtN(l.length)} รายการ`],
      }
    },
  },
  {
    id: 'bh-causes',
    title: 'สาเหตุ × ชนิดความผิด',
    desc: 'ชนิดความผิดแต่ละชนิด เกิดจากสาเหตุกลุ่มไหน',
    build({ rows }) {
      const c = causeMatrix(rows, Infinity)
      const withCause = rows.filter((r) => causeGroup(r.cause))
      const by = groupBy(withCause, 'offense')
      return {
        cols: [
          { key: 'name', label: 'ชนิดความผิด', wrap: true },
          { key: 'total', label: 'มีสาเหตุ', type: 'int' },
          ...c.causes.map((k, i) => ({ key: `c${i}`, label: k.name, type: 'int' })),
          { key: 'top', label: 'สาเหตุหลัก' },
        ],
        rows: c.offenses.map((o) => ({
          _key: o.name, _detail: by.get(o.name) || [], name: o.name, total: o.total,
          ...Object.fromEntries(c.causes.map((k, i) => [`c${i}`, o.counts[k.name]])), top: o.top?.value ? o.top.name : '',
        })),
        total: { total: c.filled, ...Object.fromEntries(c.causes.map((k, i) => [`c${i}`, k.value])) },
        notes: [`กรอกสาเหตุ ${fmtN(c.filled)} จาก ${fmtN(c.total)} รายการ`, ...(c.causes[0] ? [`สาเหตุที่พบมากสุด: ${c.causes[0].name} ${fmtN(c.causes[0].value)} รายการ`] : [])],
        footnote: 'ช่องสาเหตุเป็นประโยคยาว จึงจัดกลุ่มจากคำสำคัญ · แดชบอร์ดแสดง 6 ชนิดที่พบบ่อย ตารางนี้แสดงทุกชนิด',
      }
    },
  },
  {
    id: 'bh-fatigue',
    title: 'ความเหนื่อยล้า',
    desc: 'ง่วง เมื่อยล้า ขับต่อเนื่องเกิน 4 ชม. แยกตามชนิดและชั่วโมงที่เกิดเหตุ',
    build({ rows }) {
      const list = rows.filter(isFatigue)
      const night = (l) => l.filter((r) => r.hasTime && r.start.getHours() < 6).length
      return {
        cols: [
          { key: 'name', label: 'ชนิด' },
          { key: 'total', label: 'บันทึก', type: 'int' },
          { key: 'pct', label: '% ของทั้งหมด', type: 'pct' },
          { key: 'night', label: '00–06 น.', type: 'int' },
          ...HOUR_COLS,
        ],
        rows: sorted(groupBy(list, fatigueKind)).map(([name, l]) => ({ _key: name, _detail: l, name, total: l.length, pct: pctOf(l.length, rows.length), night: night(l), ...hourCells(l) })),
        total: { total: list.length, pct: pctOf(list.length, rows.length), night: night(list), ...hourCells(list) },
        notes: [`ความเหนื่อยล้า ${fmtN(list.length)} จาก ${fmtN(rows.length)} บันทึก · เกิดช่วง 00–06 น. ${fmtN(night(list))} บันทึก`],
        footnote: 'นับจากคำในชนิดความผิดและสาเหตุ: ง่วง เมื่อยล้า อ่อนเพลีย หลับ ขับรถต่อเนื่อง พักไม่ครบ · ช่องชั่วโมงนับเฉพาะที่กรอกเวลา',
      }
    },
  },
  {
    id: 'bh-non-coop',
    title: 'ง่วงแล้วไม่ยอมหยุดพัก',
    desc: 'ทุกเคส ง่วง/เมื่อยล้า และไม่ให้ความร่วมมือ พร้อมผลพิจารณา',
    detailOnly: true,
    build({ rows }) {
      const c = nonCooperation(rows)
      return {
        cols: [
          { key: 'start', label: 'วันที่ / เวลา', type: 'date' },
          { key: 'driver', label: 'พขร.' },
          { key: 'unit', label: 'หน่วยงาน' },
          { key: 'plate', label: 'ทะเบียน' },
          { key: 'outcome', label: 'ผลพิจารณา' },
          { key: 'risk', label: 'ความเสี่ยง' },
          { key: 'place', label: 'พื้นที่' },
          { key: 'cause', label: 'สาเหตุ', wrap: true },
        ],
        rows: c.list,
        notes: [
          `${fmtN(c.list.length)} เคส · ${c.outcomes.map((o) => `${o.name} ${o.value}`).join(' · ') || '–'}`,
          ...(c.noOffense ? [`${fmtN(c.noOffense)} เคสพิจารณาว่า "ไม่มีความผิด" ควรตรวจสอบ`] : []),
          ...(c.repeat.length ? [`ทำซ้ำ: ${c.repeat.map((d) => `${d.name} ${d.value} ครั้ง`).join(', ')}`] : []),
        ],
      }
    },
  },
  {
    id: 'bh-fatigue-units',
    title: 'ความเหนื่อยล้าต่อหน่วยงาน',
    desc: 'บันทึกความเหนื่อยล้าคิดเป็นกี่ % ของบันทึกในหน่วยงานเดียวกัน',
    build({ rows }) {
      const by = groupBy(rows.filter(isFatigue), 'unit')
      const f = rows.filter(isFatigue).length
      return {
        cols: [
          { key: 'name', label: 'หน่วยงาน' },
          { key: 'total', label: 'บันทึกทั้งหมด', type: 'int' },
          { key: 'value', label: 'ความเหนื่อยล้า', type: 'int' },
          { key: 'rate', label: '% ของหน่วยงาน', type: 'pct' },
        ],
        rows: fatigueByUnit(rows, 1).map((u) => ({ _key: u.name, _detail: by.get(u.name) || [], ...u })),
        total: { total: rows.length, value: f, rate: pctOf(f, rows.length) },
        footnote: 'แดชบอร์ดแสดงเฉพาะหน่วยงานที่มีอย่างน้อย 20 บันทึก ตารางนี้แสดงทุกหน่วยงาน (หน่วยงานที่บันทึกน้อย % จะแกว่งง่าย)',
      }
    },
  },
  {
    id: 'bh-fatigue-repeats',
    title: 'พขร. ที่ง่วงซ้ำ',
    desc: 'มีบันทึกความเหนื่อยล้า 2 ครั้งขึ้นไป ห่างกันกี่วัน',
    build({ rows }) {
      const by = groupBy(rows.filter(isFatigue), 'driver')
      return {
        cols: [
          { key: 'name', label: 'พขร.' },
          { key: 'unit', label: 'หน่วยงาน' },
          { key: 'count', label: 'ครั้ง', type: 'int' },
          { key: 'refused', label: 'ไม่ยอมหยุดพัก', type: 'int' },
          { key: 'medianGap', label: 'ห่างกัน (ค่ากลาง, วัน)', type: 'num' },
          { key: 'minGap', label: 'ห่างน้อยสุด (วัน)', type: 'num' },
          { key: 'within7', label: 'ซ้ำภายใน 7 วัน', type: 'int' },
          { key: 'last', label: 'ครั้งล่าสุด', type: 'date' },
        ],
        rows: fatigueRepeats(rows, Infinity).map((d) => ({ _key: d.name, _detail: by.get(d.name) || [], ...d })),
      }
    },
  },
  {
    id: 'bh-fatigue-months',
    title: 'แนวโน้มรายเดือน (ความเหนื่อยล้า)',
    desc: '% ของบันทึกทั้งหมดที่เป็นความเหนื่อยล้า แต่ละเดือนในช่วงที่เลือก',
    build({ rows }) {
      const out = monthsOf(rows).map((m) => {
        const l = rows.filter((r) => monthKey(r.start) === m)
        const f = l.filter(isFatigue)
        return { _key: m, _detail: f, month: monthLabel(m), total: l.length, value: f.length, rate: pctOf(f.length, l.length) }
      })
      const f = rows.filter(isFatigue).length
      return {
        cols: [
          { key: 'month', label: 'เดือน' },
          { key: 'total', label: 'บันทึกทั้งหมด', type: 'int' },
          { key: 'value', label: 'ความเหนื่อยล้า', type: 'int' },
          { key: 'rate', label: 'สัดส่วน', type: 'pct' },
        ],
        rows: out,
        total: { total: rows.length, value: f, rate: pctOf(f, rows.length) },
        footnote: 'แดชบอร์ดแสดง 12 เดือนล่าสุดเสมอ ตารางนี้ใช้เดือนในช่วงที่เลือก (เลือก "ทั้งหมด" เพื่อดูทุกเดือน)',
      }
    },
  },
  {
    id: 'bh-fatigue-week',
    title: 'ความเหนื่อยล้า: วัน × ช่วงเวลา',
    desc: 'จำนวนเคสความเหนื่อยล้าในแต่ละวันและชั่วโมง',
    build({ rows }) {
      const w = fatigueWeek(rows)
      const timed = rows.filter((r) => isFatigue(r) && r.hasTime)
      return {
        cols: [{ key: 'day', label: 'วัน' }, ...HOUR_COLS, { key: 'total', label: 'รวม', type: 'int' }],
        rows: w.map((d, i) => ({
          _key: d.name, _detail: timed.filter((r) => weekday(r) === i), day: d.name, total: d.total,
          ...Object.fromEntries(d.hours.map((v, h) => [`h${h}`, v])),
        })),
        total: { ...hourCells(timed), total: timed.length },
        footnote: 'นับเฉพาะบันทึกที่กรอกเวลา',
      }
    },
  },
  {
    id: 'bh-fatigue-places',
    title: 'จุดที่ง่วงบ่อย',
    desc: 'อำเภอ · จังหวัด ที่เกิดความเหนื่อยล้ามากสุด',
    build({ rows }) {
      const by = groupBy(rows.filter(isFatigue), (r) => (r.district ? `${r.district} · ${r.province}` : r.province))
      const list = fatiguePlaces(rows, Infinity)
      return {
        cols: [
          { key: 'rank', label: '#', type: 'int' },
          { key: 'name', label: 'อำเภอ · จังหวัด' },
          { key: 'value', label: 'เคส', type: 'int' },
          { key: 'drivers', label: 'จำนวน พขร.', type: 'int' },
        ],
        rows: list.map((p, i) => ({ _key: p.name, _detail: by.get(p.name) || [], rank: i + 1, ...p })),
        total: { value: list.reduce((a, p) => a + p.value, 0) },
        footnote: 'ที่อยู่ที่ไม่ระบุอำเภอนับเป็นจังหวัด · ไม่นับบันทึกที่ไม่มีทั้งอำเภอและจังหวัด',
      }
    },
  },
  {
    id: 'bh-cases',
    title: 'รายการบันทึกพฤติกรรม',
    desc: 'ทุกบันทึกในช่วงที่เลือก พร้อมความผิด ความเสี่ยง บทลงโทษ และใบ VR',
    detailOnly: true,
    build({ rows }) {
      return { cols: BEHAVIOR_DETAIL, rows: [...rows].sort((a, b) => b.start - a.start) }
    },
  },
]

// Unit filter for every behavior report (the dashboard has the same picker). Driver history
// (re-offending, days since last record) still uses all units, as on the dashboard.
const UNIT_FILTER = {
  id: 'unit', key: 'unit', label: 'หน่วยงาน',
  choices: (recs) => [['', 'ทุกหน่วยงาน'], ...[...new Set(recs.map((r) => r.unit))].sort((a, b) => a.localeCompare(b, 'th')).map((u) => [u, u])],
}

export const BEHAVIOR_SOURCE = {
  id: 'behavior', label: 'บันทึกพฤติกรรม พขร.', dashboard: '#/dashboard/behavior', noun: 'บันทึก',
  load, detailCols: BEHAVIOR_DETAIL, filters: [UNIT_FILTER],
}
