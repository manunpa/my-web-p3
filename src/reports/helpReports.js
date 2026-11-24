// Help-button (ปุ่มช่วยเหลือ) reports. The numbers use the same calculations as the dashboard
// (src/helpInsights.js), so a table matches the panel it is linked from.
import { loadHelp, PROVIDERS, ACTIONS } from '../helpData'
import {
  NONE, ACTION_IDS, REPEAT_MIN, BURST_MIN, pctOf, groupBy, sorted, actionMix, mixText, topOf, topText,
  actionByCause, weekHeat, repeatPlates, bursts, hotspots, placeKey, spread, SPREAD_MAIN, SPEED_BANDS, speedBand, QUALITY,
  missingText, highlights, summaryText,
} from '../helpInsights'

const DAY = 86400000
const fmtN = (n) => n.toLocaleString('th-TH')
const hh = (i) => String(i).padStart(2, '0')
const HOUR_COLS = Array.from({ length: 24 }, (_, i) => ({ key: `h${i}`, label: hh(i), type: 'int' }))
const monthKey = (d) => `${d.getFullYear()}-${hh(d.getMonth() + 1)}`
const monthLabel = (k) => {
  const [y, m] = k.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('th-TH', { month: 'short', year: '2-digit' })
}
const dayText = (t) => new Date(t).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
const ACTION_COLS = ACTION_IDS.map((a) => ({ key: a, label: ACTIONS[a].label, type: 'int' }))
const change = (now, before) => (before ? pctOf(now - before, before) : null)

async function load() {
  const { records } = await loadHelp()
  return records.map((r) => ({
    ...r,
    kind: r.test ? 'test' : 'real',
    actionLabel: ACTIONS[r.action].label,
    place: r.area ? `${r.area} · ${r.province}` : r.province !== NONE ? r.province : r.location,
    speedLabel: speedBand(r),
    missing: missingText(r),
  }))
}

export const HELP_DETAIL = [
  { key: 'start', label: 'วันที่ / เวลา', type: 'date' },
  { key: 'provider', label: 'ผู้ให้บริการ' },
  { key: 'plate', label: 'หมายเลขรถ' },
  { key: 'driver', label: 'คนขับ' },
  { key: 'unit', label: 'หน่วยงาน' },
  { key: 'alert', label: 'แจ้งเตือน', wrap: true },
  { key: 'cause', label: 'สาเหตุ', wrap: true },
  { key: 'detail', label: 'รายละเอียด', wrap: true },
  { key: 'speed', label: 'ความเร็ว' },
  { key: 'place', label: 'พื้นที่', wrap: true },
  { key: 'actionLabel', label: 'การดำเนินการ' },
]

// A month row: presses and what was done about them.
const monthRows = (rows) => [...new Set(rows.map((r) => monthKey(r.start)))].sort().map((m) => {
  const l = rows.filter((r) => monthKey(r.start) === m)
  return { m, l, mix: actionMix(l) }
})

export const HELP_REPORTS = [
  {
    id: 'help-summary',
    title: 'สรุปภาพรวม (พิมพ์ / ส่งต่อ)',
    desc: 'ตัวเลขหลักเทียบงวดก่อน พร้อมประเด็นที่ควรรู้ และข้อความสรุปไว้คัดลอกลงไลน์',
    build({ rows, prev, range }) {
      const p = prev || []
      const plates = (l) => new Set(l.map((r) => r.plate).filter((x) => x !== NONE)).size
      const units = (l) => new Set(l.map((r) => r.unit).filter((x) => x !== NONE)).size
      const metric = (name, f, l = rows, b = p, share = true) => {
        const now = f(l), before = prev ? f(b) : null
        return { _key: name, name, now, share: share ? pctOf(now, rows.length) : null, before, change: prev ? change(now, before) : null }
      }
      const by = (a) => (l) => l.filter((r) => r.action === a).length
      const out = [
        metric('การกดปุ่มทั้งหมด', (l) => l.length),
        ...ACTION_IDS.map((a) => metric(ACTIONS[a].label, by(a))),
        metric('กดทดสอบ', (l) => l.filter((r) => r.test).length),
        metric('จำนวนรถที่กด (คัน)', plates, rows, p, false),
        metric('จำนวนหน่วยงานที่กด', units, rows, p, false),
        metric(`รถที่กด ≥ ${REPEAT_MIN} ครั้ง (คัน)`, (l) => repeatPlates(l).length, rows, p, false),
        metric(`กดซ้ำภายใน ${BURST_MIN} นาที (ชุด)`, (l) => bursts(l).length, rows, p, false),
        metric('ไม่ระบุสาเหตุ', (l) => l.filter((r) => r.cause === NONE).length),
      ].filter((r) => r.now || r.before)
      const periodText = `${dayText(range.from)} – ${dayText(range.to - 1)}`
      return {
        cols: [
          { key: 'name', label: 'ตัวชี้วัด' },
          { key: 'now', label: 'ช่วงนี้', type: 'int' },
          { key: 'share', label: '% ของการกด', type: 'pct' },
          ...(prev ? [{ key: 'before', label: 'ช่วงก่อนหน้า', type: 'int' }, { key: 'change', label: 'เปลี่ยนแปลง', type: 'pct' }] : []),
        ],
        rows: out,
        notes: highlights(rows, prev, range.to).map((h) => h.text),
        text: summaryText(rows, prev, periodText, '', range.to),
        footnote: prev ? 'ช่วงก่อนหน้า = ช่วงที่ยาวเท่ากันก่อนวันแรกของช่วงนี้' : 'เลือก "ทั้งหมด" จึงไม่มีช่วงก่อนหน้าให้เทียบ',
      }
    },
  },
  {
    id: 'help-daily',
    title: 'จำนวนการกดปุ่มรายวัน',
    desc: 'การกดต่อวัน แยกตามการดำเนินการ',
    build({ rows, range }) {
      const out = []
      for (let t = range.from; t < range.to; t += DAY) {
        const l = rows.filter((r) => r.start >= t && r.start < t + DAY)
        if (!l.length && range.kind === 'all') continue
        out.push({ _key: t, _detail: l, day: new Date(t), count: l.length, ...actionMix(l) })
      }
      return {
        cols: [{ key: 'day', label: 'วันที่', type: 'day' }, { key: 'count', label: 'กดปุ่ม', type: 'int' }, ...ACTION_COLS],
        rows: out.reverse(),
        total: { count: rows.length, ...actionMix(rows) },
      }
    },
  },
  {
    id: 'help-monthly',
    title: 'สถิติรายเดือน',
    desc: 'แต่ละเดือน: การกด การดำเนินการ % No action และแยกตามผู้ให้บริการ',
    build({ rows }) {
      const out = monthRows(rows).map(({ m, l, mix }) => ({
        _key: m, _detail: l, month: monthLabel(m), count: l.length, ...mix, nonePct: pctOf(mix.none, l.length),
        ...Object.fromEntries(PROVIDERS.map((p) => [`p_${p.id}`, l.filter((r) => r.provider === p.id).length])),
      }))
      const mix = actionMix(rows)
      return {
        cols: [
          { key: 'month', label: 'เดือน' }, { key: 'count', label: 'กดปุ่ม', type: 'int' }, ...ACTION_COLS,
          { key: 'nonePct', label: '% No action', type: 'pct' },
          ...PROVIDERS.map((p) => ({ key: `p_${p.id}`, label: p.id, type: 'int' })),
        ],
        rows: out,
        total: {
          count: rows.length, ...mix, nonePct: pctOf(mix.none, rows.length),
          ...Object.fromEntries(PROVIDERS.map((p) => [`p_${p.id}`, rows.filter((r) => r.provider === p.id).length])),
        },
      }
    },
  },
  {
    id: 'help-action-cause',
    title: 'การดำเนินการตามสาเหตุ',
    desc: 'แต่ละสาเหตุจบที่ RSC / Operation / No action กี่ % เทียบงวดก่อน',
    build({ rows, prev }) {
      const list = actionByCause(rows, prev)
      const out = list.map((c) => ({
        _key: c.name, _detail: c.list, name: c.name, count: c.count, pct: c.pct, before: c.prevCount,
        change: prev ? change(c.count, c.prevCount) : null, ...c.mix,
        rscPct: pctOf(c.mix.rsc, c.count), opPct: pctOf(c.mix.operation, c.count), nonePct: c.nonePct,
      }))
      const mix = actionMix(rows)
      const flagged = out.filter((r) => r.count >= 5 && r.nonePct >= 50 && r.name !== NONE)
      return {
        cols: [
          { key: 'name', label: 'สาเหตุ' },
          { key: 'count', label: 'กดปุ่ม', type: 'int' },
          { key: 'pct', label: 'สัดส่วน', type: 'pct' },
          ...(prev ? [{ key: 'before', label: 'งวดก่อน', type: 'int' }, { key: 'change', label: 'เปลี่ยนแปลง', type: 'pct' }] : []),
          ...ACTION_COLS,
          { key: 'rscPct', label: '% RSC', type: 'pct' },
          { key: 'opPct', label: '% Operation', type: 'pct' },
          { key: 'nonePct', label: '% No action', type: 'pct' },
        ],
        rows: out,
        total: {
          count: rows.length, pct: 100, before: prev?.length, change: prev ? change(rows.length, prev.length) : null, ...mix,
          rscPct: pctOf(mix.rsc, rows.length), opPct: pctOf(mix.operation, rows.length), nonePct: pctOf(mix.none, rows.length),
        },
        notes: flagged.length
          ? flagged.slice(0, 5).map((r) => `${r.name}: No action ${r.nonePct.toFixed(0)}% (${fmtN(r.none)} จาก ${fmtN(r.count)} ครั้ง) ควรดูว่าต้องตอบสนองจริงไหม`)
          : ['ไม่มีสาเหตุที่ No action เกินครึ่ง (นับเฉพาะสาเหตุที่กด 5 ครั้งขึ้นไป)'],
      }
    },
  },
  {
    id: 'help-noise',
    title: 'การกดที่ไม่ต้องตอบสนองจริง',
    desc: 'กดทดสอบ และ No action แยกรายเดือน',
    build({ rows }) {
      const noise = (r) => r.test || r.action === 'none'
      const out = monthRows(rows).map(({ m, l }) => {
        const s = l.filter(noise)
        return {
          _key: m, _detail: s, month: monthLabel(m), count: l.length, test: l.filter((r) => r.test).length,
          none: l.filter((r) => r.action === 'none' && !r.test).length, noise: s.length, pct: pctOf(s.length, l.length),
          top: topText(s.filter((r) => !r.test), 'cause', 2),
        }
      })
      const s = rows.filter(noise)
      return {
        cols: [
          { key: 'month', label: 'เดือน' },
          { key: 'count', label: 'กดทั้งหมด', type: 'int' },
          { key: 'test', label: 'กดทดสอบ', type: 'int' },
          { key: 'none', label: 'No action (ไม่ใช่ทดสอบ)', type: 'int' },
          { key: 'noise', label: 'รวมไม่ต้องตอบสนอง', type: 'int' },
          { key: 'pct', label: 'สัดส่วน', type: 'pct' },
          { key: 'top', label: 'สาเหตุหลักของ No action', wrap: true },
        ],
        rows: out,
        total: {
          count: rows.length, test: rows.filter((r) => r.test).length, none: rows.filter((r) => r.action === 'none' && !r.test).length,
          noise: s.length, pct: pctOf(s.length, rows.length), top: topText(s.filter((r) => !r.test), 'cause', 3),
        },
        notes: [`${pctOf(s.length, rows.length)?.toFixed(0) ?? 0}% ของการกดในช่วงนี้เป็นการกดทดสอบหรือจบที่ No action`],
        footnote: 'กดทดสอบ = สาเหตุขึ้นต้นด้วย test / ทดสอบ / เทส',
      }
    },
  },
  {
    id: 'help-week-hour',
    title: 'วันในสัปดาห์ × ช่วงเวลา',
    desc: 'จำนวนการกดในแต่ละวันและชั่วโมง ใช้ดูว่าควรมีคนเฝ้าช่วงไหน',
    build({ rows }) {
      const w = weekHeat(rows)
      const out = w.map((d) => {
        const o = { _key: d.name, _detail: d.list, day: d.name, total: d.total }
        d.hours.forEach((v, h) => { o[`h${h}`] = v })
        return o
      })
      const timed = rows.filter((r) => r.hasTime)
      const total = { total: timed.length }
      HOUR_COLS.forEach((c, i) => { total[c.key] = timed.filter((r) => r.start.getHours() === i).length })
      const busiest = [...w].sort((a, b) => b.total - a.total)[0]
      return {
        cols: [{ key: 'day', label: 'วัน' }, ...HOUR_COLS, { key: 'total', label: 'รวม', type: 'int' }],
        rows: out,
        total,
        notes: [
          ...(busiest?.total ? [`วัน${busiest.name}กดมากสุด ${fmtN(busiest.total)} ครั้ง`] : []),
          ...(rows.length > timed.length ? [`ไม่นับ ${fmtN(rows.length - timed.length)} ครั้งที่ไม่มีเวลาที่กด`] : []),
        ],
      }
    },
  },
  {
    id: 'help-rank',
    title: 'อันดับสูงสุด',
    desc: 'จัดอันดับการกด ตามหมายเลขรถ หน่วยงาน จังหวัด สาเหตุ หรือคนขับ เทียบงวดก่อน',
    options: [{ id: 'by', label: 'จัดอันดับตาม', choices: [['plate', 'หมายเลขรถ'], ['unit', 'หน่วยงาน'], ['province', 'จังหวัด'], ['cause', 'สาเหตุ'], ['driver', 'คนขับ']] }],
    build({ rows, prev, opt }) {
      const by = opt.by || 'plate'
      const before = prev ? groupBy(prev, by) : null
      const label = { plate: 'หมายเลขรถ', unit: 'หน่วยงาน', province: 'จังหวัด', cause: 'สาเหตุ', driver: 'คนขับ' }[by]
      const sub = by === 'cause' ? 'unit' : 'cause'
      const out = sorted(groupBy(rows, by)).map(([name, l], i) => {
        const b = before ? before.get(name)?.length || 0 : null
        const mix = actionMix(l)
        return {
          _key: name, _detail: l, rank: i + 1, name, count: l.length, pct: pctOf(l.length, rows.length),
          before: b, change: before ? change(l.length, b) : null, nonePct: pctOf(mix.none, l.length), top: topText(l, sub, 2),
        }
      })
      const rising = out.filter((r) => r.name !== NONE && r.before !== null && r.count - r.before >= 3).sort((a, b) => (b.count - b.before) - (a.count - a.before))
      return {
        cols: [
          { key: 'rank', label: '#', type: 'int' },
          { key: 'name', label },
          { key: 'count', label: 'กดปุ่ม', type: 'int' },
          { key: 'pct', label: 'สัดส่วน', type: 'pct' },
          ...(prev ? [{ key: 'before', label: 'งวดก่อน', type: 'int' }, { key: 'change', label: 'เปลี่ยนแปลง', type: 'pct' }] : []),
          { key: 'nonePct', label: '% No action', type: 'pct' },
          { key: 'top', label: by === 'cause' ? 'หน่วยงานหลัก' : 'สาเหตุหลัก', wrap: true },
        ],
        rows: out,
        total: { count: rows.length, pct: 100, before: prev?.length, change: prev ? change(rows.length, prev.length) : null, nonePct: pctOf(rows.filter((r) => r.action === 'none').length, rows.length) },
        notes: rising.slice(0, 3).map((r) => `${r.name} เพิ่มจาก ${fmtN(r.before)} เป็น ${fmtN(r.count)} ครั้ง`),
      }
    },
  },
  {
    id: 'help-cause-unit',
    title: 'สาเหตุ × หน่วยงาน',
    desc: 'แต่ละหน่วยงานกดเพราะสาเหตุอะไร (8 สาเหตุที่พบบ่อยสุด)',
    build({ rows }) {
      const top = sorted(groupBy(rows, 'cause')).slice(0, 8).map(([c]) => c)
      const key = (c) => `c_${top.indexOf(c)}`
      const out = sorted(groupBy(rows, 'unit')).map(([unit, l]) => {
        const o = { _key: unit, _detail: l, unit, total: l.length, other: 0, nonePct: pctOf(l.filter((r) => r.action === 'none').length, l.length) }
        for (const c of top) o[key(c)] = 0
        for (const r of l) top.includes(r.cause) ? o[key(r.cause)]++ : o.other++
        o.main = topOf(l, 'cause')?.name || ''
        return o
      })
      const total = { total: rows.length, other: rows.filter((r) => !top.includes(r.cause)).length, nonePct: pctOf(rows.filter((r) => r.action === 'none').length, rows.length) }
      for (const c of top) total[key(c)] = rows.filter((r) => r.cause === c).length
      return {
        cols: [
          { key: 'unit', label: 'หน่วยงาน' },
          ...top.map((c) => ({ key: key(c), label: c, type: 'int' })),
          { key: 'other', label: 'อื่น ๆ', type: 'int' },
          { key: 'total', label: 'รวม', type: 'int' },
          { key: 'nonePct', label: '% No action', type: 'pct' },
        ],
        rows: out,
        total,
        notes: out.filter((r) => r.unit !== NONE).slice(0, 3).map((r) => `${r.unit}: ${fmtN(r.total)} ครั้ง สาเหตุหลัก ${r.main || '–'}`),
      }
    },
  },
  {
    id: 'help-providers',
    title: 'เทียบผู้ให้บริการ',
    desc: 'Songdee / DTC / PMS: การกด การดำเนินการ และความครบของข้อมูล',
    build({ rows }) {
      const out = PROVIDERS.map((p) => {
        const l = rows.filter((r) => r.provider === p.id)
        const mix = actionMix(l)
        const miss = (id) => pctOf(l.filter(QUALITY.find((q) => q.id === id).test).length, l.length)
        return {
          _key: p.id, _detail: l, name: p.id, count: l.length, pct: pctOf(l.length, rows.length), ...mix,
          nonePct: pctOf(mix.none, l.length), noCause: miss('cause'), noPlace: miss('location'), noTime: miss('time'),
          complete: pctOf(l.filter((r) => !r.missing).length, l.length),
        }
      })
      const mix = actionMix(rows)
      const miss = (id) => pctOf(rows.filter(QUALITY.find((q) => q.id === id).test).length, rows.length)
      return {
        cols: [
          { key: 'name', label: 'ผู้ให้บริการ' },
          { key: 'count', label: 'กดปุ่ม', type: 'int' },
          { key: 'pct', label: 'สัดส่วน', type: 'pct' },
          ...ACTION_COLS,
          { key: 'nonePct', label: '% No action', type: 'pct' },
          { key: 'noCause', label: '% ไม่ระบุสาเหตุ', type: 'pct' },
          { key: 'noPlace', label: '% ไม่มีสถานที่', type: 'pct' },
          { key: 'noTime', label: '% ไม่มีเวลา', type: 'pct' },
          { key: 'complete', label: '% ข้อมูลครบทุกช่อง', type: 'pct' },
        ],
        rows: out,
        total: {
          count: rows.length, pct: 100, ...mix, nonePct: pctOf(mix.none, rows.length), noCause: miss('cause'), noPlace: miss('location'),
          noTime: miss('time'), complete: pctOf(rows.filter((r) => !r.missing).length, rows.length),
        },
        footnote: 'PMS มีแค่คอลัมน์ RSC: ช่อง RSC ว่างนับเป็น No action',
      }
    },
  },
  {
    id: 'help-repeat-plates',
    title: 'รถที่กดซ้ำ',
    desc: 'หมายเลขรถที่กดหลายครั้งในช่วงที่เลือก พร้อมสาเหตุหลักและการดำเนินการ',
    options: [{ id: 'min', label: 'กดตั้งแต่', choices: [[String(REPEAT_MIN), `${REPEAT_MIN} ครั้ง`], ['2', '2 ครั้ง'], ['5', '5 ครั้ง']] }],
    build({ rows, opt }) {
      const min = +opt.min || REPEAT_MIN
      const list = repeatPlates(rows, min)
      const out = list.map((p) => ({
        _key: p.plate, _detail: p.list, plate: p.plate, count: p.count, days: p.days, unit: p.unit,
        cause: p.cause ? `${p.cause.name} (${p.cause.value})` : '', drivers: p.drivers, actions: mixText(p.mix), last: p.last,
      }))
      const n = list.reduce((s, p) => s + p.count, 0)
      return {
        cols: [
          { key: 'plate', label: 'หมายเลขรถ' },
          { key: 'count', label: 'กดปุ่ม', type: 'int' },
          { key: 'days', label: 'จำนวนวันที่กด', type: 'int' },
          { key: 'unit', label: 'หน่วยงาน' },
          { key: 'cause', label: 'สาเหตุหลัก', wrap: true },
          { key: 'drivers', label: 'จำนวนคนขับ', type: 'int' },
          { key: 'actions', label: 'การดำเนินการ', wrap: true },
          { key: 'last', label: 'กดล่าสุด', type: 'date' },
        ],
        rows: out,
        total: { count: n },
        notes: list.length
          ? [`${fmtN(list.length)} คันกดตั้งแต่ ${min} ครั้ง รวม ${fmtN(n)} ครั้ง (${pctOf(n, rows.length).toFixed(0)}% ของการกดทั้งหมด)`]
          : [`ไม่มีรถที่กดตั้งแต่ ${min} ครั้งในช่วงนี้`],
      }
    },
  },
  {
    id: 'help-bursts',
    title: 'กดซ้ำในเวลาใกล้กัน',
    desc: 'รถคันเดียวกันกดต่อเนื่องในเวลาสั้น ๆ อาจเป็นปัญหาที่ยังไม่ถูกแก้',
    options: [{ id: 'win', label: 'ห่างกันไม่เกิน', choices: [[String(BURST_MIN), `${BURST_MIN} นาที`], ['180', '3 ชั่วโมง'], ['1440', '24 ชั่วโมง']] }],
    build({ rows, opt }) {
      const win = +opt.win || BURST_MIN
      const list = bursts(rows, win)
      const out = list.map((b, i) => ({
        _key: `${b.plate}-${i}`, _detail: b.list, first: b.first, plate: b.plate, count: b.count, span: b.span,
        unit: b.unit, driver: b.driver, causes: b.causes, actions: mixText(b.mix),
      }))
      const noAction = list.filter((b) => !b.mix.rsc && !b.mix.operation).length
      return {
        cols: [
          { key: 'first', label: 'เริ่มกด', type: 'date' },
          { key: 'plate', label: 'หมายเลขรถ' },
          { key: 'count', label: 'กดกี่ครั้ง', type: 'int' },
          { key: 'span', label: 'ใช้เวลา', type: 'min' },
          { key: 'unit', label: 'หน่วยงาน' },
          { key: 'driver', label: 'คนขับ' },
          { key: 'causes', label: 'สาเหตุ', wrap: true },
          { key: 'actions', label: 'การดำเนินการ', wrap: true },
        ],
        rows: out,
        notes: list.length
          ? [`${fmtN(list.length)} ชุด จาก ${fmtN(new Set(list.map((b) => b.plate)).size)} คัน · ${fmtN(noAction)} ชุดไม่มี RSC หรือ Operation เลย`]
          : ['ไม่มีรถที่กดซ้ำในเวลาใกล้กัน'],
        footnote: 'ชุด = การกดของรถคันเดียวกันที่แต่ละครั้งห่างจากครั้งก่อนไม่เกินเวลาที่เลือก · ไม่นับรายการที่ไม่มีเวลา',
      }
    },
  },
  {
    id: 'help-hotspots',
    title: 'สถานที่ที่กดซ้ำ',
    desc: 'อำเภอหรือตำบลที่มีการกดมากสุด รวมที่อยู่เดียวกันที่เขียนต่างกัน',
    options: [{ id: 'level', label: 'รวมระดับ', choices: [['district', 'อำเภอ'], ['area', 'ตำบล']] }],
    build({ rows, opt }) {
      const level = opt.level || 'district'
      const list = hotspots(rows, level)
      const out = list.map((h) => ({
        _key: h.key, _detail: h.list, name: h.name, province: h.province, count: h.count,
        cause: h.cause ? `${h.cause.name} (${h.cause.value})` : '', plates: h.plates, actions: mixText(h.mix), subs: h.subs,
      }))
      const placed = rows.filter((r) => placeKey(level)(r) !== NONE).length
      return {
        cols: [
          { key: 'name', label: level === 'district' ? 'อำเภอ / เขต' : 'ตำบล · อำเภอ' },
          { key: 'province', label: 'จังหวัด' },
          { key: 'count', label: 'กดปุ่ม', type: 'int' },
          { key: 'cause', label: 'สาเหตุหลัก', wrap: true },
          { key: 'plates', label: 'จำนวนรถ', type: 'int' },
          { key: 'actions', label: 'การดำเนินการ', wrap: true },
          ...(level === 'district' ? [{ key: 'subs', label: 'ตำบลที่กดบ่อย', wrap: true }] : []),
        ],
        rows: out,
        total: { count: placed },
        notes: [
          ...(out[0] ? [`${out[0].name} กดมากสุด ${fmtN(out[0].count)} ครั้ง จาก ${fmtN(out[0].plates)} คัน`] : []),
          ...(rows.length > placed ? [`${fmtN(rows.length - placed)} ครั้งไม่มีสถานที่หรือระบุจังหวัดไม่ได้ จึงไม่อยู่ในตาราง`] : []),
        ],
      }
    },
  },
  {
    id: 'help-spread',
    title: 'ติดที่คนหรือที่รถ',
    desc: 'คนขับคนเดียวกดจากหลายคัน หรือรถคันเดียวมีหลายคนกด',
    options: [{ id: 'by', label: 'ดูตาม', choices: [['driver', 'คนขับ'], ['plate', 'หมายเลขรถ']] }],
    build({ rows, opt }) {
      const by = opt.by === 'plate' ? 'plate' : 'driver'
      const list = spread(rows, by).filter((x) => x.count >= 2)
      const wide = (x) => x.others >= 2 && x.mainPct < SPREAD_MAIN
      const pattern = (x) => {
        if (wide(x)) return by === 'driver' ? 'กระจายหลายคัน: น่าจะเป็นที่คน' : 'หลายคนกด: น่าจะเป็นที่รถ'
        if (x.others >= 2) return by === 'driver' ? 'มีคันหลัก' : 'มีคนขับหลัก'
        return by === 'driver' ? 'คันเดียว' : 'คนเดียว'
      }
      const out = list.map((x) => ({
        _key: x.name, _detail: x.list, name: x.name, count: x.count, others: x.others, detail: x.detail, mainPct: x.mainPct,
        cause: x.cause ? `${x.cause.name} (${x.cause.value})` : '', pattern: pattern(x),
      }))
      const multi = list.filter(wide).length
      return {
        cols: [
          { key: 'name', label: by === 'driver' ? 'คนขับ' : 'หมายเลขรถ' },
          { key: 'count', label: 'กดปุ่ม', type: 'int' },
          { key: 'others', label: by === 'driver' ? 'จำนวนรถ' : 'จำนวนคนขับ', type: 'int' },
          { key: 'detail', label: by === 'driver' ? 'รถที่กด' : 'คนขับที่กด', wrap: true },
          { key: 'mainPct', label: by === 'driver' ? '% จากคันหลัก' : '% จากคนหลัก', type: 'pct' },
          { key: 'cause', label: 'สาเหตุหลัก', wrap: true },
          { key: 'pattern', label: 'รูปแบบ' },
        ],
        rows: out,
        notes: [`${fmtN(multi)} จาก ${fmtN(out.length)} ${by === 'driver' ? 'คนกดกระจายหลายคัน' : 'คันมีหลายคนกดสลับกัน'} (นับเฉพาะที่กด 2 ครั้งขึ้นไป)`],
        footnote: `กระจาย = ไม่มี${by === 'driver' ? 'คัน' : 'คน'}ไหนเกิน ${SPREAD_MAIN}% · ไม่นับชื่อที่เป็นบัญชีทดสอบหรือทีม (TEST, หน้างาน, ช่าง ฯลฯ)`,
      }
    },
  },
  {
    id: 'help-speed',
    title: 'ความเร็วตอนกดปุ่ม',
    desc: 'กดตอนจอดหรือตอนวิ่ง แยกช่วงความเร็ว พร้อมสาเหตุและการดำเนินการ',
    build({ rows }) {
      const names = [...SPEED_BANDS.map((b) => b.label), NONE]
      const by = groupBy(rows, speedBand)
      const out = names.filter((n) => by.has(n)).map((name) => {
        const l = by.get(name)
        const mix = actionMix(l)
        return { _key: name, _detail: l, name, count: l.length, pct: pctOf(l.length, rows.length), ...mix, nonePct: pctOf(mix.none, l.length), top: topText(l, 'cause', 3) }
      })
      const moving = rows.filter((r) => r.speedNum > 0).length
      const withSpeed = rows.filter((r) => r.speedNum !== null).length
      return {
        cols: [
          { key: 'name', label: 'ความเร็ว' },
          { key: 'count', label: 'กดปุ่ม', type: 'int' },
          { key: 'pct', label: 'สัดส่วน', type: 'pct' },
          ...ACTION_COLS,
          { key: 'nonePct', label: '% No action', type: 'pct' },
          { key: 'top', label: 'สาเหตุหลัก', wrap: true },
        ],
        rows: out,
        total: { count: rows.length, pct: 100, ...actionMix(rows), nonePct: pctOf(rows.filter((r) => r.action === 'none').length, rows.length) },
        notes: withSpeed ? [`${pctOf(moving, withSpeed).toFixed(0)}% ของการกดที่มีความเร็ว กดขณะรถวิ่ง`] : ['ชีตไม่มีค่าความเร็วในช่วงนี้'],
      }
    },
  },
  {
    id: 'help-alert-cause',
    title: 'ประเภทแจ้งเตือน × สาเหตุ',
    desc: 'การกดตามหลังแจ้งเตือนแต่ละชนิด มักเป็นสาเหตุอะไร',
    build({ rows }) {
      const out = sorted(groupBy(rows, 'alert')).map(([name, l]) => {
        const mix = actionMix(l)
        return { _key: name, _detail: l, name, count: l.length, pct: pctOf(l.length, rows.length), top: topText(l, 'cause', 3), ...mix, nonePct: pctOf(mix.none, l.length) }
      })
      return {
        cols: [
          { key: 'name', label: 'แจ้งเตือน', wrap: true },
          { key: 'count', label: 'กดปุ่ม', type: 'int' },
          { key: 'pct', label: 'สัดส่วน', type: 'pct' },
          { key: 'top', label: 'สาเหตุที่พบบ่อย', wrap: true },
          ...ACTION_COLS,
          { key: 'nonePct', label: '% No action', type: 'pct' },
        ],
        rows: out,
        total: { count: rows.length, pct: 100, ...actionMix(rows), nonePct: pctOf(rows.filter((r) => r.action === 'none').length, rows.length) },
      }
    },
  },
  {
    id: 'help-quality',
    title: 'ตรวจความครบของข้อมูล',
    desc: 'รายการที่ช่องสำคัญว่าง แยกตามผู้ให้บริการ ใช้ส่งให้ผู้กรอกแก้',
    build({ rows }) {
      const out = QUALITY.map((q) => {
        const l = rows.filter(q.test)
        return {
          _key: q.id, _detail: l, name: q.label, count: l.length, pct: pctOf(l.length, rows.length),
          ...Object.fromEntries(PROVIDERS.map((p) => [`p_${p.id}`, l.filter((r) => r.provider === p.id).length])),
        }
      }).filter((r) => r.count)
      const bad = rows.filter((r) => r.missing)
      return {
        cols: [
          { key: 'name', label: 'ปัญหา' },
          { key: 'count', label: 'รายการ', type: 'int' },
          { key: 'pct', label: '% ของการกด', type: 'pct' },
          ...PROVIDERS.map((p) => ({ key: `p_${p.id}`, label: p.id, type: 'int' })),
        ],
        rows: out,
        notes: [bad.length
          ? `${fmtN(bad.length)} รายการ (${pctOf(bad.length, rows.length).toFixed(0)}%) มีช่องว่างอย่างน้อย 1 ช่อง · ไฟล์ Excel แผ่น "รายละเอียด" มีรายการทั้งหมด`
          : 'ข้อมูลครบทุกช่องในช่วงนี้'],
      }
    },
  },
  {
    id: 'help-incomplete',
    title: 'รายการที่ข้อมูลไม่ครบ',
    desc: 'ทุกรายการที่มีช่องว่าง พร้อมบอกว่าขาดอะไร เรียงจากล่าสุด',
    detailOnly: true,
    build({ rows }) {
      const l = rows.filter((r) => r.missing).sort((a, b) => b.start - a.start)
      return {
        cols: [
          { key: 'start', label: 'วันที่ / เวลา', type: 'date' },
          { key: 'provider', label: 'ผู้ให้บริการ' },
          { key: 'plate', label: 'หมายเลขรถ' },
          { key: 'unit', label: 'หน่วยงาน' },
          { key: 'cause', label: 'สาเหตุ', wrap: true },
          { key: 'missing', label: 'ขาด', wrap: true },
        ],
        rows: l,
        notes: [`${fmtN(l.length)} รายการ`],
      }
    },
  },
  {
    id: 'help-cases',
    title: 'รายการกดปุ่มช่วยเหลือ',
    desc: 'ทุกการกดในช่วงที่เลือก เรียงจากล่าสุด',
    detailOnly: true,
    build({ rows }) {
      return { cols: HELP_DETAIL, rows: [...rows].sort((a, b) => b.start - a.start) }
    },
  },
]

const PROVIDER_FILTER = { id: 'provider', key: 'provider', label: 'ผู้ให้บริการ', choices: [['', 'ทุกผู้ให้บริการ'], ...PROVIDERS.map((p) => [p.id, p.id])] }
const TEST_FILTER = { id: 'tests', key: 'kind', label: 'กดทดสอบ', choices: [['', 'รวม'], ['real', 'ไม่รวม']] }

export const HELP_SOURCE = {
  id: 'help', label: 'ปุ่มช่วยเหลือ', dashboard: '#/dashboard/help', noun: 'ครั้ง',
  load, detailCols: HELP_DETAIL, filters: [PROVIDER_FILTER, TEST_FILTER],
}
