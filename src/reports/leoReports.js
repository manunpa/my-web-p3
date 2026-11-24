// LEO System reports. Each title is the same as the dashboard panel it comes from, and the numbers
// use the same calculations (src/leoInsights.js), so the table matches what the panel shows.
import { loadAlerts } from '../fleetData'
import { STOP_TYPE_NAMES } from '../stopType'
import {
  hotspots, response, rejectMatrix, rejectWeeks, stopShares, weekHeat, median, SHORT_TYPES, SHORT_MIN, SHIFTS, MIN_DECIDED,
} from '../leoInsights'

const STAGE = { approved: 'อนุมัติ', rejected: 'ไม่อนุมัติ', pending: 'รอพิจารณา', open: 'ยังไม่ขอปลด' }
const DAY = 86400000

// Records with the extra fields the tables show.
async function load() {
  const { records } = await loadAlerts()
  return records.map((r) => ({ ...r, place: r.area || r.province, stageLabel: STAGE[r.stage] || r.stage }))
}

export const LEO_DETAIL = [
  { key: 'start', label: 'เริ่ม', type: 'date' },
  { key: 'caseNo', label: 'Case No' },
  { key: 'plate', label: 'ทะเบียน' },
  { key: 'driver', label: 'คนขับ (ผู้โหลด)' },
  { key: 'stopType', label: 'ประเภทการจอด' },
  { key: 'minutes', label: 'รวมเวลา', type: 'min' },
  { key: 'place', label: 'พื้นที่' },
  { key: 'province', label: 'จังหวัด' },
  { key: 'stageLabel', label: 'ผล' },
  { key: 'releasedBy', label: 'ผู้ปลด' },
  { key: 'releasedAt', label: 'เวลาปลด', type: 'date' },
  { key: 'reason', label: 'สาเหตุที่ปลด', wrap: true },
]

const groupBy = (rows, key) => {
  const m = new Map()
  for (const r of rows) {
    const k = typeof key === 'function' ? key(r) : r[key]
    if (!k) continue
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(r)
  }
  return m
}
const avg = (l) => (l.length ? l.reduce((s, r) => s + (r.minutes || 0), 0) / l.length : null)
const pctOf = (n, d) => (d ? (n / d) * 100 : null)
const lag = (r) => {
  if (!r.releasedAt || !r.end) return null
  const m = (r.releasedAt - r.end) / 60000
  return m >= 0 && m < 7 * 24 * 60 ? m : null
}
const hh = (i) => String(i).padStart(2, '0')
const HOUR_COLS = Array.from({ length: 24 }, (_, i) => ({ key: `h${i}`, label: hh(i), type: 'int' }))
const monthKey = (d) => `${d.getFullYear()}-${hh(d.getMonth() + 1)}`
const monthLabel = (k) => {
  const [y, m] = k.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('th-TH', { month: 'short', year: '2-digit' })
}

export const LEO_REPORTS = [
  {
    id: 'leo-shares',
    title: 'สัดส่วนแจ้งเตือนตามประเภทการจอด',
    desc: 'แต่ละประเภทการจอดคิดเป็นกี่ % เทียบงวดก่อน และเวลาจอดเฉลี่ย',
    build({ rows, prev }) {
      const s = stopShares(rows, prev)
      const by = groupBy(rows, 'stopType')
      const out = s.rows.map((r) => ({
        _key: r.name, _detail: by.get(r.name) || [],
        type: r.name, count: r.count, pct: r.pct, delta: r.delta, avg: avg(by.get(r.name) || []),
        rejected: (by.get(r.name) || []).filter((x) => x.stage === 'rejected').length,
      }))
      const top = out[0]
      return {
        cols: [
          { key: 'type', label: 'ประเภทการจอด' },
          { key: 'count', label: 'เคส', type: 'int' },
          { key: 'pct', label: 'สัดส่วน', type: 'pct' },
          ...(prev ? [{ key: 'delta', label: 'เทียบงวดก่อน (จุด %)', type: 'pp' }] : []),
          { key: 'avg', label: 'จอดเฉลี่ย', type: 'min' },
          { key: 'rejected', label: 'ไม่อนุมัติ', type: 'int' },
        ],
        rows: out,
        total: { count: rows.length, pct: 100, avg: avg(rows), rejected: rows.filter((x) => x.stage === 'rejected').length },
        notes: top ? [`ประเภทที่พบมากสุดคือ ${top.type} ${top.count.toLocaleString('th-TH')} เคส (${top.pct.toFixed(0)}%)`] : [],
      }
    },
  },
  {
    id: 'leo-type-month',
    title: 'ประเภทการจอดรายเดือน',
    desc: 'จำนวนเคสแต่ละประเภทในแต่ละเดือนของช่วงที่เลือก',
    build({ rows }) {
      const months = [...new Set(rows.map((r) => monthKey(r.start)))].sort()
      const types = STOP_TYPE_NAMES.filter((t) => rows.some((r) => r.stopType === t))
      const by = groupBy(rows, 'stopType')
      const out = types.map((t) => {
        const l = by.get(t) || []
        const o = { _key: t, _detail: l, type: t, total: l.length }
        for (const m of months) o[m] = l.filter((r) => monthKey(r.start) === m).length
        return o
      }).sort((a, b) => b.total - a.total)
      const total = { total: rows.length }
      for (const m of months) total[m] = rows.filter((r) => monthKey(r.start) === m).length
      return {
        cols: [{ key: 'type', label: 'ประเภทการจอด' }, ...months.map((m) => ({ key: m, label: monthLabel(m), type: 'int' })), { key: 'total', label: 'รวม', type: 'int' }],
        rows: out,
        total,
      }
    },
  },
  {
    id: 'leo-hotspots',
    title: 'จุดที่เกิดซ้ำ',
    desc: 'พื้นที่ที่เกิดเคสมากสุด พร้อมประเภทหลักและเวลาจอดเฉลี่ย',
    options: [{ id: 'level', label: 'รวมระดับ', choices: [['district', 'อำเภอ'], ['area', 'ตำบล']] }],
    build({ rows, opt }) {
      const level = opt.level || 'district'
      const list = hotspots(rows, level, Infinity)
      const keyOf = level === 'district'
        ? (r) => (r.area ? `${r.area.split(' · ').pop()}|${r.province}` : r.province)
        : (r) => r.area || r.province
      const by = groupBy(rows, keyOf)
      const out = list.map((h) => {
        const k = level === 'district' && h.name !== h.province ? `${h.name}|${h.province}` : h.name
        return {
          _key: k, _detail: by.get(k) || [],
          name: h.name, province: h.province, count: h.count, top: h.top?.name, topPct: pctOf(h.top?.value, h.count),
          avg: h.avg, drivers: h.drivers,
          subs: h.subs.length > 1 ? h.subs.slice(0, 4).map((s) => `${s.name || 'ไม่ระบุ'} ${s.value}`).join(' · ') : '',
        }
      })
      return {
        cols: [
          { key: 'name', label: level === 'district' ? 'อำเภอ / เขต' : 'ตำบล · อำเภอ' },
          { key: 'province', label: 'จังหวัด' },
          { key: 'count', label: 'เคส', type: 'int' },
          { key: 'top', label: 'ประเภทที่พบมากสุด' },
          { key: 'topPct', label: '% ของพื้นที่', type: 'pct' },
          { key: 'avg', label: 'จอดเฉลี่ย', type: 'min' },
          { key: 'drivers', label: 'จำนวนคนขับ', type: 'int' },
          ...(level === 'district' ? [{ key: 'subs', label: 'ตำบลที่เกิดบ่อย', wrap: true }] : []),
        ],
        rows: out,
        total: { count: rows.length, avg: avg(rows) },
        notes: out[0] ? [`${out[0].name} เกิดมากสุด ${out[0].count.toLocaleString('th-TH')} เคส ส่วนใหญ่เป็น ${out[0].top} (${out[0].topPct.toFixed(0)}%)`] : [],
      }
    },
  },
  {
    id: 'leo-type-hour',
    title: 'ประเภทการจอด × ช่วงเวลา',
    desc: 'จำนวนเคสแต่ละประเภท แยกตามชั่วโมงที่เริ่ม (00–23)',
    build({ rows }) {
      const by = groupBy(rows, 'stopType')
      const out = [...by].map(([t, l]) => {
        const o = { _key: t, _detail: l, type: t, total: l.length }
        HOUR_COLS.forEach((c, i) => { o[c.key] = l.filter((r) => r.start.getHours() === i).length })
        return o
      }).sort((a, b) => b.total - a.total)
      const total = { total: rows.length }
      HOUR_COLS.forEach((c, i) => { total[c.key] = rows.filter((r) => r.start.getHours() === i).length })
      return { cols: [{ key: 'type', label: 'ประเภทการจอด' }, ...HOUR_COLS, { key: 'total', label: 'รวม', type: 'int' }], rows: out, total }
    },
  },
  {
    id: 'leo-week-hour',
    title: 'วันในสัปดาห์ × ช่วงเวลา',
    desc: 'จำนวนเคสที่เริ่มในแต่ละวันและชั่วโมง ใช้ดูการจัดคนเข้ากะ',
    build({ rows }) {
      const w = weekHeat(rows)
      const out = w.map((d, i) => {
        const o = { _key: d.name, _detail: rows.filter((r) => (r.start.getDay() + 6) % 7 === i), day: d.name, total: d.total }
        d.hours.forEach((v, h) => { o[`h${h}`] = v })
        return o
      })
      const total = { total: rows.length }
      HOUR_COLS.forEach((c, i) => { total[c.key] = rows.filter((r) => r.start.getHours() === i).length })
      return { cols: [{ key: 'day', label: 'วัน' }, ...HOUR_COLS, { key: 'total', label: 'รวม', type: 'int' }], rows: out, total }
    },
  },
  {
    id: 'leo-noise',
    title: 'แจ้งเตือนที่ไม่ต้องตรวจจริง',
    desc: `ไฟแดง/จราจร ที่จอดไม่เกิน ${SHORT_MIN} นาที แยกรายเดือน`,
    build({ rows }) {
      const short = (r) => SHORT_TYPES.includes(r.stopType) && r.minutes > 0 && r.minutes <= SHORT_MIN
      const months = [...new Set(rows.map((r) => monthKey(r.start)))].sort()
      const out = months.map((m) => {
        const l = rows.filter((r) => monthKey(r.start) === m)
        const s = l.filter(short)
        return {
          _key: m, _detail: s, month: monthLabel(m), total: l.length, short: s.length, pct: pctOf(s.length, l.length),
          red: s.filter((r) => r.stopType === SHORT_TYPES[0]).length, traffic: s.filter((r) => r.stopType === SHORT_TYPES[1]).length,
        }
      })
      const s = rows.filter(short)
      return {
        cols: [
          { key: 'month', label: 'เดือน' },
          { key: 'total', label: 'แจ้งเตือนทั้งหมด', type: 'int' },
          { key: 'short', label: 'ไม่ต้องตรวจจริง', type: 'int' },
          { key: 'pct', label: 'สัดส่วน', type: 'pct' },
          { key: 'red', label: 'ไฟแดง', type: 'int' },
          { key: 'traffic', label: 'จราจร', type: 'int' },
        ],
        rows: out,
        total: { total: rows.length, short: s.length, pct: pctOf(s.length, rows.length), red: s.filter((r) => r.stopType === SHORT_TYPES[0]).length, traffic: s.filter((r) => r.stopType === SHORT_TYPES[1]).length },
        notes: [`${pctOf(s.length, rows.length)?.toFixed(0) ?? 0}% ของแจ้งเตือนในช่วงนี้เป็นไฟแดงหรือจราจรที่จอดไม่เกิน ${SHORT_MIN} นาที`],
      }
    },
  },
  {
    id: 'leo-response',
    title: 'เวลาตอบสนองของผู้ปลด',
    desc: 'เวลาจากเคสจบถึงเวลาปลด (ค่ากลาง) แยกตามผู้ปลดหรือกะ',
    options: [{ id: 'by', label: 'แยกตาม', choices: [['person', 'ผู้ปลด'], ['shift', 'กะ']] }],
    build({ rows, opt }) {
      const done = rows.filter((r) => lag(r) !== null)
      const groups = opt.by === 'shift'
        ? SHIFTS.map((s) => [s.label, done.filter((r) => s.test(r.end.getHours()))])
        : [...groupBy(done, 'releasedBy')].sort((a, b) => b[1].length - a[1].length)
      const out = groups.filter(([, l]) => l.length).map(([name, l]) => {
        const lags = l.map(lag)
        return {
          _key: name, _detail: l, name, count: l.length, median: median(lags),
          within1h: pctOf(lags.filter((x) => x <= 60).length, l.length),
          over4h: pctOf(lags.filter((x) => x > 240).length, l.length),
        }
      })
      const all = done.map(lag)
      return {
        cols: [
          { key: 'name', label: opt.by === 'shift' ? 'กะ (เวลาสิ้นสุดเคส)' : 'ผู้ปลด' },
          { key: 'count', label: 'เคส', type: 'int' },
          { key: 'median', label: 'ค่ากลาง', type: 'min' },
          { key: 'within1h', label: 'ปลดภายใน 1 ชม.', type: 'pct' },
          { key: 'over4h', label: 'เกิน 4 ชม.', type: 'pct' },
        ],
        rows: out,
        total: { count: done.length, median: median(all), within1h: pctOf(all.filter((x) => x <= 60).length, all.length), over4h: pctOf(all.filter((x) => x > 240).length, all.length) },
        notes: ['ไม่นับเคสที่ปลดช้ากว่า 7 วัน หรือเวลาปลดก่อนเวลาสิ้นสุดเคส'],
      }
    },
  },
  {
    id: 'leo-reject-matrix',
    title: 'เกณฑ์การไม่อนุมัติของผู้ปลด แยกตามประเภท',
    desc: 'ประเภทเดียวกัน ผู้ปลดแต่ละคนไม่อนุมัติกี่ %',
    build({ rows }) {
      const m = rejectMatrix(rows)
      const decided = rows.filter((r) => r.stage === 'rejected' || r.stage === 'approved')
      const out = m.types.map((t) => {
        const o = {
          _key: t.name, _detail: decided.filter((r) => r.stopType === t.name),
          type: t.name, flag: t.mismatch ? 'เกณฑ์ไม่ตรงกัน' : '', all: t.rate, allN: `${t.rejected}/${t.total}`,
        }
        for (const p of m.people) {
          const c = t.cells[p]
          o[`p_${p}`] = c.total ? c.rate : null
          o[`n_${p}`] = c.total ? `${c.rejected}/${c.total}` : ''
        }
        return o
      })
      return {
        cols: [
          { key: 'type', label: 'ประเภทการจอด' },
          { key: 'flag', label: '' },
          { key: 'all', label: 'รวม % ไม่อนุมัติ', type: 'pct' },
          { key: 'allN', label: 'รวม (ไม่อนุมัติ/ทั้งหมด)' },
          ...m.people.flatMap((p) => [{ key: `p_${p}`, label: `${p} %`, type: 'pct' }, { key: `n_${p}`, label: `${p} (n)` }]),
        ],
        rows: out,
        notes: m.mismatches.length
          ? m.mismatches.map((t) => `เกณฑ์ไม่ตรงกัน: ${t.name} · ${t.mismatch.strict.map((p) => `${p} ไม่อนุมัติ ${t.cells[p].rate.toFixed(0)}%`).join(', ')} แต่ ${t.mismatch.lenient.join(', ')} อนุมัติทุกเคส`)
          : ['ไม่พบประเภทที่ผู้ปลดใช้เกณฑ์ต่างกันชัดเจน'],
        footnote: `ป้ายเกณฑ์ไม่ตรงกัน: คนหนึ่งไม่อนุมัติ ≥ 50% แต่อีกคน 0% (ทั้งคู่ ≥ ${MIN_DECIDED} เคส)`,
      }
    },
  },
  {
    id: 'leo-rejected',
    title: 'รายการเคสไม่อนุมัติ',
    desc: 'ทุกเคสที่ไม่อนุมัติในช่วงที่เลือก เรียงจากล่าสุด',
    detailOnly: true,
    build({ rows }) {
      const l = rows.filter((r) => r.stage === 'rejected').sort((a, b) => b.start - a.start)
      return {
        cols: [
          { key: 'start', label: 'เริ่ม', type: 'date' },
          { key: 'releasedBy', label: 'ผู้ปลด' },
          { key: 'stopType', label: 'ประเภทการจอด' },
          { key: 'minutes', label: 'รวมเวลา', type: 'min' },
          { key: 'place', label: 'พื้นที่' },
          { key: 'plate', label: 'ทะเบียน' },
          { key: 'reason', label: 'สาเหตุที่ปลด', wrap: true },
        ],
        rows: l,
        notes: [`ไม่อนุมัติ ${l.length.toLocaleString('th-TH')} เคส`],
      }
    },
  },
  {
    id: 'leo-reject-weeks',
    title: 'ไม่อนุมัติรายสัปดาห์',
    desc: 'จำนวนและ % ไม่อนุมัติของเคสที่พิจารณาแต่ละสัปดาห์',
    build({ rows, range }) {
      const w = rejectWeeks(rows, range.from, range.to)
      let d = new Date(range.from); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
      const out = w.map((x) => {
        const s = d.getTime()
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7)
        return { _key: x.label, _detail: rows.filter((r) => r.stage === 'rejected' && r.start >= s && r.start < d), week: x.label, rejected: x.rejected, total: x.total, rate: x.rate }
      })
      const rej = rows.filter((r) => r.stage === 'rejected').length
      const dec = rows.filter((r) => r.stage === 'rejected' || r.stage === 'approved').length
      return {
        cols: [
          { key: 'week', label: 'สัปดาห์ (จ.–อา.)' },
          { key: 'rejected', label: 'ไม่อนุมัติ', type: 'int' },
          { key: 'total', label: 'พิจารณาแล้ว', type: 'int' },
          { key: 'rate', label: '% ไม่อนุมัติ', type: 'pct' },
        ],
        rows: out,
        total: { rejected: rej, total: dec, rate: pctOf(rej, dec) },
      }
    },
  },
  {
    id: 'leo-rank',
    title: 'อันดับสูงสุด',
    desc: 'จัดอันดับจำนวนเคส ตามคนขับ ทะเบียน จังหวัด หรือผู้ปลด',
    options: [
      { id: 'by', label: 'จัดอันดับตาม', choices: [['plate', 'ทะเบียน'], ['driver', 'คนขับ'], ['province', 'จังหวัด'], ['releasedBy', 'ผู้ปลด']] },
      { id: 'type', label: 'ประเภทการจอด', choices: [['', 'ทุกประเภท'], ...STOP_TYPE_NAMES.map((t) => [t, t])] },
    ],
    build({ rows, opt }) {
      const by = opt.by || 'plate'
      const src = opt.type ? rows.filter((r) => r.stopType === opt.type) : rows
      const g = [...groupBy(src, by)].sort((a, b) => b[1].length - a[1].length)
      const label = { plate: 'ทะเบียน', driver: 'คนขับ (ผู้โหลด)', province: 'จังหวัด', releasedBy: 'ผู้ปลด' }[by]
      return {
        cols: [
          { key: 'rank', label: '#', type: 'int' },
          { key: 'name', label },
          { key: 'count', label: 'เคส', type: 'int' },
          { key: 'pct', label: 'สัดส่วน', type: 'pct' },
          { key: 'avg', label: 'จอดเฉลี่ย', type: 'min' },
          { key: 'top', label: 'ประเภทที่พบมากสุด' },
        ],
        rows: g.map(([name, l], i) => {
          const t = [...groupBy(l, 'stopType')].sort((a, b) => b[1].length - a[1].length)[0]
          return { _key: name, _detail: l, rank: i + 1, name, count: l.length, pct: pctOf(l.length, src.length), avg: avg(l), top: t ? `${t[0]} (${t[1].length})` : '' }
        }),
        total: { count: src.length, pct: 100, avg: avg(src) },
        notes: by === 'driver' ? ['ชื่อคนขับในระบบ LEO คือผู้ที่นำรถเข้าโหลด ทริปไกลที่เปลี่ยนมือขับจะยังเป็นชื่อเดิม'] : [],
      }
    },
  },
  {
    id: 'leo-daily',
    title: 'จำนวนแจ้งเตือนรายวัน',
    desc: 'แจ้งเตือนต่อวัน พร้อมผลพิจารณาและเวลาจอดเฉลี่ย',
    build({ rows, range }) {
      const out = []
      for (let t = range.from; t < range.to; t += DAY) {
        const d = new Date(t)
        const l = rows.filter((r) => r.start >= t && r.start < t + DAY)
        if (!l.length && range.kind === 'all') continue
        out.push({
          _key: t, _detail: l, day: d, count: l.length,
          approved: l.filter((r) => r.stage === 'approved').length,
          rejected: l.filter((r) => r.stage === 'rejected').length,
          waiting: l.filter((r) => r.stage === 'pending' || r.stage === 'open').length,
          avg: avg(l),
        })
      }
      return {
        cols: [
          { key: 'day', label: 'วันที่', type: 'day' },
          { key: 'count', label: 'แจ้งเตือน', type: 'int' },
          { key: 'approved', label: 'อนุมัติ', type: 'int' },
          { key: 'rejected', label: 'ไม่อนุมัติ', type: 'int' },
          { key: 'waiting', label: 'รอ', type: 'int' },
          { key: 'avg', label: 'จอดเฉลี่ย', type: 'min' },
        ],
        rows: out.reverse(),
        total: { count: rows.length, approved: rows.filter((r) => r.stage === 'approved').length, rejected: rows.filter((r) => r.stage === 'rejected').length, waiting: rows.filter((r) => r.stage === 'pending' || r.stage === 'open').length, avg: avg(rows) },
      }
    },
  },
  {
    id: 'leo-cases',
    title: 'รายการแจ้งเตือน',
    desc: 'ทุกเคสในช่วงที่เลือก พร้อมประเภทการจอดและพื้นที่',
    detailOnly: true,
    build({ rows }) {
      return { cols: LEO_DETAIL, rows: [...rows].sort((a, b) => b.start - a.start) }
    },
  },
]

export const LEO_SOURCE = { id: 'leo', label: 'LEO System', dashboard: '#/dashboard', load, detailCols: LEO_DETAIL }
