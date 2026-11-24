// ADAS / DMS reports. Titles match the dashboard panels and the numbers use the same
// calculations (src/adasInsights.js), so the table matches what the panel shows.
import { loadAdas } from '../adasData'
import { loadBehavior } from '../behaviorData'
import {
  OUTCOMES, CATEGORIES, outcomeLabel, typeQuality, cameraHealth, CAMERA_FALSE, CAMERA_NO_VIDEO, driverScores,
  categoryMix, fatigueRepeats, weekHeat, weekday, DAYS, hotspots, geofenceSplit, behaviorLink, linkBeforeAfter,
  outcomeMix, isRisky, LINK_FATIGUE,
} from '../adasInsights'

const DAY = 86400000
const NONE = '(ไม่ระบุ)'

// The behavior log is loaded with the camera data, for the link report. Its failure is not fatal.
let behavior = []
async function load() {
  const [{ records }, beh] = await Promise.all([
    loadAdas(),
    loadBehavior().then((b) => b.records.filter((r) => r.start)).catch(() => []),
  ])
  behavior = beh
  return records.map((r) => ({
    ...r,
    outcomeLabel: outcomeLabel(r.outcome),
    place: r.area ? `${r.area} · ${r.province}` : r.province !== NONE ? r.province : r.location,
  }))
}

export const ADAS_DETAIL = [
  { key: 'start', label: 'วันที่ / เวลา', type: 'date' },
  { key: 'plate', label: 'หมายเลขรถ' },
  { key: 'unit', label: 'หน่วยงาน' },
  { key: 'driver', label: 'คนขับ' },
  { key: 'type', label: 'ประเภทการแจ้งเตือน' },
  { key: 'speed', label: 'ความเร็ว', type: 'num' },
  { key: 'note', label: 'ผลการตรวจสอบ' },
  { key: 'outcomeLabel', label: 'กลุ่มผลตรวจ' },
  { key: 'alertStatus', label: 'สถานะแจ้งเตือน' },
  { key: 'geofence', label: 'Geofence' },
  { key: 'place', label: 'พื้นที่' },
]

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
const fmtN = (n) => n.toLocaleString('th-TH')
const count = (l, f) => l.reduce((n, r) => n + (f(r) ? 1 : 0), 0)
const nRisky = (l) => count(l, isRisky)
const nNoise = (l) => count(l, (r) => r.outcome === 'noise')
const nTrue = (l) => count(l, (r) => r.alertStatus === 'TRUE')
const hh = (i) => String(i).padStart(2, '0')
const HOUR_COLS = Array.from({ length: 24 }, (_, i) => ({ key: `h${i}`, label: hh(i), type: 'int' }))
const hourCells = (l) => Object.fromEntries(HOUR_COLS.map((c, i) => [c.key, count(l, (r) => r.hasTime && r.start.getHours() === i)]))
const monthKey = (d) => `${d.getFullYear()}-${hh(d.getMonth() + 1)}`
const monthLabel = (k) => {
  const [y, m] = k.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('th-TH', { month: 'short', year: '2-digit' })
}
const monthsOf = (rows) => [...new Set(rows.map((r) => monthKey(r.start)))].sort()
// Outcome columns: count and % for each group.
const OUT_COLS = OUTCOMES.map((o) => ({ key: `o_${o.id}`, label: o.label, type: 'int' }))
const outCells = (l) => Object.fromEntries(Object.entries(outcomeMix(l)).map(([k, v]) => [`o_${k}`, v]))
const SPEED_BANDS = [
  { label: 'จอด (0)', test: (s) => s === 0 },
  { label: '1–30', test: (s) => s > 0 && s <= 30 },
  { label: '31–60', test: (s) => s > 30 && s <= 60 },
  { label: '61–80', test: (s) => s > 60 && s <= 80 },
  { label: '81–100', test: (s) => s > 80 && s <= 100 },
  { label: 'มากกว่า 100', test: (s) => s > 100 },
]
const OUTCOME_FILTER = { id: 'outcome', label: 'ผลตรวจ', choices: [['', 'ทุกผล'], ...OUTCOMES.map((o) => [o.id, o.label])] }
const byOutcome = (rows, opt) => (opt.outcome ? rows.filter((r) => r.outcome === opt.outcome) : rows)

export const ADAS_REPORTS = [
  {
    id: 'adas-daily',
    title: 'จำนวนแจ้งเตือนรายวัน',
    desc: 'แจ้งเตือนต่อวัน แยกผลตรวจ: พฤติกรรมเสี่ยง ปกติ เตือนผิด และสถานะ TRUE',
    build({ rows, range }) {
      const out = []
      for (let t = range.from; t < range.to; t += DAY) {
        const l = rows.filter((r) => r.start >= t && r.start < t + DAY)
        if (!l.length && range.kind === 'all') continue
        out.push({ _key: t, _detail: l, day: new Date(t), count: l.length, ...outCells(l), riskyPct: pctOf(nRisky(l), l.length), true: nTrue(l) })
      }
      return {
        cols: [{ key: 'day', label: 'วันที่', type: 'day' }, { key: 'count', label: 'แจ้งเตือน', type: 'int' }, ...OUT_COLS,
          { key: 'riskyPct', label: '% เสี่ยง', type: 'pct' }, { key: 'true', label: 'สถานะ TRUE', type: 'int' }],
        rows: out.reverse(),
        total: { count: rows.length, ...outCells(rows), riskyPct: pctOf(nRisky(rows), rows.length), true: nTrue(rows) },
      }
    },
  },
  {
    id: 'adas-type-quality',
    title: 'คุณภาพการแจ้งเตือนตามประเภท',
    desc: 'กล้องเตือนแต่ละประเภท ตรวจแล้วเป็นพฤติกรรมเสี่ยงจริง ปกติ หรือเตือนผิดกี่ %',
    build({ rows }) {
      const by = groupBy(rows, 'type')
      const q = typeQuality(rows)
      return {
        cols: [
          { key: 'name', label: 'ประเภทการแจ้งเตือน' },
          { key: 'flag', label: '' },
          { key: 'total', label: 'ครั้ง', type: 'int' },
          ...OUT_COLS,
          { key: 'risky', label: '% เสี่ยงจริง', type: 'pct' },
          { key: 'falseAlert', label: '% เตือนผิด', type: 'pct' },
          { key: 'noVideo', label: '% ไม่มีวิดีโอ', type: 'pct' },
          { key: 'top', label: 'พฤติกรรมที่พบมากสุด' },
        ],
        rows: q.map((t) => ({
          _key: t.name, _detail: by.get(t.name) || [], ...t, ...Object.fromEntries(Object.entries(t.mix).map(([k, v]) => [`o_${k}`, v])),
          flag: t.falseAlert >= CAMERA_FALSE ? 'เตือนผิดบ่อย' : '', top: t.top ? `${t.top.name} (${fmtN(t.top.value)})` : '',
        })),
        total: { total: rows.length, ...outCells(rows), risky: pctOf(nRisky(rows), rows.length) },
        notes: q.filter((t) => t.falseAlert >= CAMERA_FALSE).map((t) => `${t.name} เตือนผิด ${t.falseAlert.toFixed(0)}% เป็นพฤติกรรมเสี่ยงจริงเพียง ${t.risky.toFixed(t.risky < 10 ? 1 : 0)}% ควรพิจารณาปรับความไว`),
        footnote: 'จัดกลุ่มจากผลตรวจในคอลัมน์หมายเหตุ: เตือนผิด/ใช้ไม่ได้ = False alert, ไม่มีวิดีโอ, ซ่อมบำรุง, กล้องขัดข้อง · ปกติ = มองมาตรวัด/กระจก',
      }
    },
  },
  {
    id: 'adas-noise-months',
    title: 'เตือนผิด / ใช้ไม่ได้ รายเดือน',
    desc: 'แต่ละเดือนในช่วงที่เลือก: แจ้งเตือนทั้งหมด เตือนผิด ไม่มีวิดีโอ ซ่อมบำรุง',
    build({ rows }) {
      const row = (l) => ({
        total: l.length, noise: nNoise(l), pct: pctOf(nNoise(l), l.length),
        falseAlert: count(l, (r) => /false\s*alert/i.test(r.note)), noVideo: count(l, (r) => /no\s*video/i.test(r.note)),
        maintenance: count(l, (r) => /maintenance/i.test(r.note)), risky: nRisky(l),
      })
      return {
        cols: [
          { key: 'month', label: 'เดือน' }, { key: 'total', label: 'แจ้งเตือน', type: 'int' }, { key: 'noise', label: 'เตือนผิด / ใช้ไม่ได้', type: 'int' },
          { key: 'pct', label: 'สัดส่วน', type: 'pct' }, { key: 'falseAlert', label: 'False alert', type: 'int' }, { key: 'noVideo', label: 'ไม่มีวิดีโอ', type: 'int' },
          { key: 'maintenance', label: 'ซ่อมบำรุง', type: 'int' }, { key: 'risky', label: 'พฤติกรรมเสี่ยง', type: 'int' },
        ],
        rows: monthsOf(rows).map((m) => {
          const l = rows.filter((r) => monthKey(r.start) === m)
          return { _key: m, _detail: l.filter((r) => r.outcome === 'noise'), month: monthLabel(m), ...row(l) }
        }),
        total: row(rows),
        footnote: 'แดชบอร์ดแสดง 12 เดือนล่าสุดเสมอ ตารางนี้ใช้เดือนในช่วงที่เลือก',
      }
    },
  },
  {
    id: 'adas-monthly',
    title: 'สถิติรายเดือน',
    desc: 'แจ้งเตือนแต่ละประเภทในแต่ละเดือนของช่วงที่เลือก',
    build({ rows }) {
      const months = monthsOf(rows)
      const out = sorted(groupBy(rows, 'type')).map(([t, l]) => {
        const o = { _key: t, _detail: l, type: t, total: l.length, risky: nRisky(l) }
        for (const m of months) o[m] = count(l, (r) => monthKey(r.start) === m)
        return o
      })
      const total = { total: rows.length, risky: nRisky(rows) }
      for (const m of months) total[m] = count(rows, (r) => monthKey(r.start) === m)
      return {
        cols: [{ key: 'type', label: 'ประเภทการแจ้งเตือน' }, ...months.map((m) => ({ key: m, label: monthLabel(m), type: 'int' })),
          { key: 'total', label: 'รวม', type: 'int' }, { key: 'risky', label: 'เป็นพฤติกรรมเสี่ยง', type: 'int' }],
        rows: out,
        total,
      }
    },
  },
  {
    id: 'adas-rank',
    title: 'อันดับสูงสุด',
    desc: 'จัดอันดับแจ้งเตือนตามคนขับ หมายเลขรถ หน่วยงาน หรือจังหวัด เลือกผลตรวจได้',
    options: [
      { id: 'by', label: 'จัดอันดับตาม', choices: [['driver', 'คนขับ'], ['plate', 'หมายเลขรถ'], ['unit', 'หน่วยงาน'], ['province', 'จังหวัด']] },
      OUTCOME_FILTER,
    ],
    build({ rows, opt }) {
      const by = opt.by || 'driver'
      const src = byOutcome(rows, opt)
      const label = { driver: 'คนขับ', plate: 'หมายเลขรถ', unit: 'หน่วยงาน', province: 'จังหวัด' }[by]
      return {
        cols: [
          { key: 'rank', label: '#', type: 'int' }, { key: 'name', label },
          ...(by === 'driver' || by === 'plate' ? [{ key: 'unit', label: 'หน่วยงาน' }] : []),
          { key: 'count', label: 'แจ้งเตือน', type: 'int' }, { key: 'pct', label: 'สัดส่วน', type: 'pct' },
          { key: 'risky', label: 'พฤติกรรมเสี่ยง', type: 'int' }, { key: 'fatigue', label: 'ง่วง / หาว', type: 'int' },
          { key: 'noisePct', label: '% เตือนผิด', type: 'pct' }, { key: 'top', label: 'ประเภทที่พบมากสุด' },
        ],
        rows: sorted(groupBy(src, by)).map(([name, l], i) => {
          const t = sorted(groupBy(l, 'type'))[0]
          const u = sorted(groupBy(l, 'unit'))
          return {
            _key: name, _detail: l, rank: i + 1, name, unit: u.length > 1 ? `${u[0][0]} +${u.length - 1}` : u[0][0],
            count: l.length, pct: pctOf(l.length, src.length), risky: nRisky(l), fatigue: count(l, (r) => isRisky(r) && r.fatigue),
            noisePct: pctOf(nNoise(l), l.length), top: t ? `${t[0]} (${fmtN(t[1].length)})` : '',
          }
        }),
        total: { count: src.length, pct: 100, risky: nRisky(src), fatigue: count(src, (r) => isRisky(r) && r.fatigue), noisePct: pctOf(nNoise(src), src.length) },
        notes: by === 'driver' ? [`"NA" และช่องว่าง = กล้องไม่รู้ชื่อคนขับ (${fmtN(count(src, (r) => r.noDriver))} แจ้งเตือน)`] : [],
      }
    },
  },
  {
    id: 'adas-speed',
    title: 'ความเร็วขณะแจ้งเตือน',
    desc: 'จำนวนแจ้งเตือนตามช่วงความเร็ว แยกผลตรวจ',
    build({ rows }) {
      const w = rows.filter((r) => r.speed !== null)
      const out = SPEED_BANDS.map((b) => {
        const l = w.filter((r) => b.test(r.speed))
        return { _key: b.label, _detail: l, band: b.label, count: l.length, pct: pctOf(l.length, w.length), ...outCells(l), riskyPct: pctOf(nRisky(l), l.length) }
      })
      return {
        cols: [{ key: 'band', label: 'ความเร็ว (กม./ชม.)' }, { key: 'count', label: 'แจ้งเตือน', type: 'int' }, { key: 'pct', label: 'สัดส่วน', type: 'pct' },
          ...OUT_COLS, { key: 'riskyPct', label: '% เสี่ยง', type: 'pct' }],
        rows: out,
        total: { count: w.length, pct: 100, ...outCells(w), riskyPct: pctOf(nRisky(w), w.length) },
        notes: [`มีความเร็ว ${fmtN(w.length)} จาก ${fmtN(rows.length)} แจ้งเตือน`],
      }
    },
  },
  {
    id: 'adas-notes',
    title: 'ผลการตรวจสอบ',
    desc: 'ผลตรวจแต่ละแบบ (หมายเหตุ) อยู่กลุ่มไหน และสถานะ TRUE กี่ %',
    build({ rows }) {
      return {
        cols: [
          { key: 'rank', label: '#', type: 'int' }, { key: 'name', label: 'ผลการตรวจสอบ' }, { key: 'group', label: 'กลุ่ม' },
          { key: 'category', label: 'หมวดพฤติกรรม' }, { key: 'count', label: 'ครั้ง', type: 'int' }, { key: 'pct', label: 'สัดส่วน', type: 'pct' },
          { key: 'true', label: 'สถานะ TRUE', type: 'int' }, { key: 'truePct', label: '% TRUE', type: 'pct' },
        ],
        rows: sorted(groupBy(rows, (r) => r.note || '(ยังไม่มีผลตรวจ)')).map(([name, l], i) => ({
          _key: name, _detail: l, rank: i + 1, name, group: outcomeLabel(l[0].outcome), category: l[0].outcome === 'risky' ? l[0].category : '',
          count: l.length, pct: pctOf(l.length, rows.length), true: nTrue(l), truePct: pctOf(nTrue(l), l.length),
        })),
        total: { count: rows.length, pct: 100, true: nTrue(rows), truePct: pctOf(nTrue(rows), rows.length) },
      }
    },
  },
  {
    id: 'adas-status',
    title: 'สถานะแจ้งเตือน',
    desc: 'TRUE / FALSE แยกตามกลุ่มผลตรวจ',
    build({ rows }) {
      return {
        cols: [{ key: 'name', label: 'สถานะแจ้งเตือน' }, { key: 'count', label: 'ครั้ง', type: 'int' }, { key: 'pct', label: 'สัดส่วน', type: 'pct' }, ...OUT_COLS],
        rows: sorted(groupBy(rows, 'alertStatus')).map(([name, l]) => ({ _key: name, _detail: l, name, count: l.length, pct: pctOf(l.length, rows.length), ...outCells(l) })),
        total: { count: rows.length, pct: 100, ...outCells(rows) },
      }
    },
  },
  {
    id: 'adas-hour',
    title: 'ช่วงเวลาที่เกิดแจ้งเตือน',
    desc: 'จำนวนแจ้งเตือนตามชั่วโมง (00–23) แยกตามประเภท กลุ่มผลตรวจ หรือวันในสัปดาห์',
    options: [{ id: 'by', label: 'แยกตาม', choices: [['type', 'ประเภท'], ['outcome', 'กลุ่มผลตรวจ'], ['day', 'วันในสัปดาห์']] }, OUTCOME_FILTER],
    build({ rows, opt }) {
      const timed = byOutcome(rows, opt).filter((r) => r.hasTime)
      const groups = opt.by === 'day' ? DAYS.map((d, i) => [d, timed.filter((r) => weekday(r) === i)])
        : opt.by === 'outcome' ? OUTCOMES.map((o) => [o.label, timed.filter((r) => r.outcome === o.id)]).filter(([, l]) => l.length)
          : sorted(groupBy(timed, 'type'))
      return {
        cols: [{ key: 'name', label: { day: 'วัน', outcome: 'กลุ่มผลตรวจ' }[opt.by] || 'ประเภท' }, ...HOUR_COLS, { key: 'total', label: 'รวม', type: 'int' }],
        rows: groups.map(([name, l]) => ({ _key: name, _detail: l, name, ...hourCells(l), total: l.length })),
        total: { ...hourCells(timed), total: timed.length },
      }
    },
  },
  {
    id: 'adas-camera',
    title: 'สุขภาพกล้องรายคัน',
    desc: 'รถคันไหนเตือนผิดหรือวิดีโอหายบ่อย ควรส่งตรวจหรือปรับกล้อง',
    options: [{ id: 'min', label: 'แจ้งเตือนอย่างน้อย', choices: [['30', '30 ครั้ง'], ['10', '10 ครั้ง'], ['1', 'ทุกคัน']] }],
    build({ rows, opt }) {
      const by = groupBy(rows, 'plate')
      const list = cameraHealth(rows, +opt.min || 30)
      const bad = list.filter((r) => r.bad).length
      return {
        cols: [
          { key: 'name', label: 'หมายเลขรถ' }, { key: 'unit', label: 'หน่วยงาน' }, { key: 'total', label: 'แจ้งเตือน', type: 'int' },
          { key: 'falseN', label: 'เตือนผิด', type: 'int' }, { key: 'falsePct', label: '% เตือนผิด', type: 'pct' },
          { key: 'noVideo', label: 'ไม่มีวิดีโอ', type: 'int' }, { key: 'noVideoPct', label: '% ไม่มีวิดีโอ', type: 'pct' },
          { key: 'maintenance', label: 'ซ่อมบำรุง', type: 'int' }, { key: 'riskyPct', label: '% เสี่ยงจริง', type: 'pct' },
          { key: 'topType', label: 'เตือนผิดจากประเภท' }, { key: 'flag', label: 'ควรตรวจ' },
        ],
        rows: list.map((r) => ({ _key: r.name, _detail: (by.get(r.name) || []).filter((x) => x.outcome === 'noise'), ...r })),
        notes: [`${fmtN(bad)} จาก ${fmtN(list.length)} คัน ควรตรวจกล้อง`],
        footnote: `เกณฑ์: เตือนผิด ≥ ${CAMERA_FALSE}% หรือไม่มีวิดีโอ ≥ ${CAMERA_NO_VIDEO}% · กดแถวเพื่อดูแจ้งเตือนที่ใช้ไม่ได้ของคันนั้น`,
      }
    },
  },
  {
    id: 'adas-driver-score',
    title: 'คะแนนความเสี่ยงคนขับ (DMS)',
    desc: 'คะแนนรวมจากพฤติกรรมเสี่ยงที่ตรวจยืนยันแล้ว เทียบงวดก่อน',
    build({ rows, prev }) {
      const s = driverScores(rows, prev, Infinity)
      return {
        cols: [
          { key: 'rank', label: '#', type: 'int' }, { key: 'name', label: 'คนขับ' }, { key: 'unit', label: 'หน่วยงาน' }, { key: 'plates', label: 'หมายเลขรถ' },
          { key: 'score', label: 'คะแนน', type: 'int' }, { key: 'risky', label: 'พฤติกรรมเสี่ยง', type: 'int' },
          { key: 'sleep', label: 'หลับใน / ง่วง', type: 'int' }, { key: 'yawn', label: 'หาว', type: 'int' }, { key: 'phone', label: 'โทรศัพท์', type: 'int' },
          ...(prev ? [{ key: 'before', label: 'คะแนนงวดก่อน', type: 'int' }, { key: 'diff', label: 'เปลี่ยน', type: 'int' }] : []),
          { key: 'top', label: 'พบมากสุด' }, { key: 'alerts', label: 'แจ้งเตือนทั้งหมด', type: 'int' },
        ],
        rows: s.top.map((d, i) => ({
          _key: d.name, _detail: d.list.filter(isRisky), rank: i + 1, ...d, plates: d.plates.join(', '),
          yawn: d.fatigue - d.sleep, top: d.top?.name ?? '', diff: prev ? d.score - d.before : null,
        })),
        notes: [
          `${fmtN(s.drivers)} คนขับมีพฤติกรรมเสี่ยงในช่วงนี้${s.topTenthShare !== null ? ` · 10% แรกมีคะแนนรวม ${s.topTenthShare.toFixed(0)}% ของทั้งหมด` : ''}`,
          ...(s.noName ? [`ไม่นับ ${fmtN(s.noName)} แจ้งเตือนที่ไม่มีชื่อคนขับ (NA)`] : []),
          ...(s.improved.length ? [`ดีขึ้นชัดเจน: ${s.improved.map((d) => `${d.name} (${d.before} → ${d.now})`).join(', ')}`] : []),
        ],
        footnote: `คะแนน: ${CATEGORIES.map((c) => `${c.name} ${c.weight}`).join(' · ')} · ดีขึ้นชัดเจน = งวดก่อน ≥ 10 คะแนน และลดลงอย่างน้อยครึ่งหนึ่ง`,
      }
    },
  },
  {
    id: 'adas-categories',
    title: 'พฤติกรรมเสี่ยงแยกกลุ่ม',
    desc: 'จำนวนพฤติกรรมเสี่ยงแต่ละกลุ่ม เทียบงวดก่อน และจำนวนคนขับ',
    build({ rows, prev }) {
      const risky = rows.filter(isRisky)
      const before = prev ? groupBy(prev.filter(isRisky), 'category') : null
      const by = groupBy(risky, 'category')
      return {
        cols: [
          { key: 'name', label: 'กลุ่มพฤติกรรม' }, { key: 'weight', label: 'คะแนนต่อครั้ง', type: 'int' }, { key: 'value', label: 'ครั้ง', type: 'int' },
          { key: 'pct', label: 'สัดส่วน', type: 'pct' }, ...(prev ? [{ key: 'before', label: 'งวดก่อน', type: 'int' }] : []),
          { key: 'drivers', label: 'จำนวนคนขับ', type: 'int' }, { key: 'plates', label: 'จำนวนรถ', type: 'int' },
        ],
        rows: categoryMix(rows).map((c) => {
          const l = by.get(c.name) || []
          return {
            _key: c.name, _detail: l, ...c, pct: pctOf(c.value, risky.length), before: before ? before.get(c.name)?.length || 0 : null,
            drivers: new Set(l.filter((r) => !r.noDriver).map((r) => r.driver)).size, plates: new Set(l.map((r) => r.plate)).size,
          }
        }),
        total: { value: risky.length, pct: 100, before: prev ? nRisky(prev) : undefined },
      }
    },
  },
  {
    id: 'adas-fatigue-repeats',
    title: 'คนขับที่ง่วงซ้ำ',
    desc: 'หลับใน / ง่วง / หาว 2 ครั้งขึ้นไปในช่วงที่เลือก ห่างกันกี่วัน',
    build({ rows }) {
      return {
        cols: [
          { key: 'name', label: 'คนขับ' }, { key: 'unit', label: 'หน่วยงาน' }, { key: 'plate', label: 'หมายเลขรถ' },
          { key: 'count', label: 'ครั้ง', type: 'int' }, { key: 'sleep', label: 'หลับใน / ง่วง', type: 'int' }, { key: 'days', label: 'จำนวนวัน', type: 'int' },
          { key: 'within7', label: 'วันที่ซ้ำภายใน 7 วัน', type: 'int' }, { key: 'medianGap', label: 'ห่างกัน (ค่ากลาง, วัน)', type: 'num' },
          { key: 'night', label: '00–06 น.', type: 'int' }, { key: 'last', label: 'ครั้งล่าสุด', type: 'date' },
        ],
        rows: fatigueRepeats(rows, Infinity).map((d) => ({ _key: d.name, _detail: d.list, ...d })),
        footnote: 'นับเฉพาะผลตรวจที่เป็นหลับใน ง่วง หรือหาว และมีชื่อคนขับ · ครั้ง = ทุกแจ้งเตือน ส่วนจำนวนวัน ห่างกัน และซ้ำภายใน 7 วัน นับเป็นวัน',
      }
    },
  },
  {
    id: 'adas-fatigue-week',
    title: 'ง่วงจริง: วัน × ช่วงเวลา',
    desc: 'หลับใน / ง่วง / หาว ที่ตรวจยืนยัน แยกตามวันและชั่วโมง',
    build({ rows }) {
      const f = rows.filter((r) => isRisky(r) && r.fatigue && r.hasTime)
      return {
        cols: [{ key: 'day', label: 'วัน' }, ...HOUR_COLS, { key: 'total', label: 'รวม', type: 'int' }],
        rows: weekHeat(f).map((d, i) => ({ _key: d.name, _detail: f.filter((r) => weekday(r) === i), day: d.name, total: d.total, ...Object.fromEntries(d.hours.map((v, h) => [`h${h}`, v])) })),
        total: { ...hourCells(f), total: f.length },
      }
    },
  },
  {
    id: 'adas-hotspots',
    title: 'จุดที่เกิดซ้ำ',
    desc: 'อำเภอ · จังหวัด ที่มีพฤติกรรมเสี่ยงบนถนนมากสุด',
    build({ rows }) {
      const list = hotspots(rows, Infinity)
      return {
        cols: [
          { key: 'rank', label: '#', type: 'int' }, { key: 'name', label: 'อำเภอ · จังหวัด' }, { key: 'count', label: 'พฤติกรรมเสี่ยง', type: 'int' },
          { key: 'fatigue', label: 'ง่วง / หาว', type: 'int' }, { key: 'top', label: 'พบมากสุด' }, { key: 'drivers', label: 'จำนวนคนขับ', type: 'int' }, { key: 'plates', label: 'จำนวนรถ', type: 'int' },
        ],
        rows: list.map((p, i) => ({ _key: p.name, _detail: p.list, rank: i + 1, ...p, top: p.top ? `${p.top.name} (${fmtN(p.top.value)})` : '' })),
        total: { count: list.reduce((s, p) => s + p.count, 0), fatigue: list.reduce((s, p) => s + p.fatigue, 0) },
        footnote: 'ไม่นับแจ้งเตือนในพื้นที่ Geofence · ที่อยู่ที่ไม่ระบุอำเภอนับเป็นจังหวัด',
      }
    },
  },
  {
    id: 'adas-geofence',
    title: 'ในพื้นที่ Geofence vs บนถนน',
    desc: 'ผลตรวจของแจ้งเตือนในแต่ละ Geofence เทียบกับบนถนน',
    build({ rows }) {
      const g = geofenceSplit(rows, Infinity)
      const road = rows.filter((r) => !r.geofence)
      return {
        cols: [{ key: 'name', label: 'Geofence' }, { key: 'total', label: 'แจ้งเตือน', type: 'int' }, ...OUT_COLS,
          { key: 'riskyPct', label: '% เสี่ยง', type: 'pct' }, { key: 'top', label: 'พฤติกรรมที่พบมากสุด' }],
        rows: [
          { _key: '(road)', _detail: [], name: '(บนถนน · ไม่อยู่ใน Geofence)', total: road.length, ...outCells(road), riskyPct: pctOf(nRisky(road), road.length) },
          ...g.places.map((p) => ({ _key: p.name, _detail: p.list, name: p.name, total: p.total, ...outCells(p.list), riskyPct: pctOf(p.risky, p.total), top: p.top?.name ?? '' })),
        ],
        total: { total: rows.length, ...outCells(rows), riskyPct: pctOf(nRisky(rows), rows.length) },
        notes: [`ในพื้นที่ Geofence ${fmtN(g.inside.total)} แจ้งเตือน ซ่อมบำรุง ${fmtN(g.inside.maintenance)} · บนถนน ${fmtN(g.road.total)}`],
      }
    },
  },
  {
    id: 'adas-behavior-link',
    title: 'DMS × บันทึกพฤติกรรม พขร.',
    desc: 'รถที่กล้องจับพฤติกรรมเสี่ยงได้ มีบันทึกพฤติกรรมและลงโทษหรือยัง (จับคู่ด้วยทะเบียน)',
    options: [{ id: 'view', label: 'มุมมอง', choices: [['plate', 'รายคัน'], ['effect', 'ก่อน–หลังบันทึกพฤติกรรม']] }, { id: 'w', label: 'ช่วงเทียบ', choices: [['30', '30 วัน'], ['60', '60 วัน']] }],
    build({ rows, scoped, range, opt }) {
      if (opt.view === 'effect') {
        const W = +opt.w || 30
        const ba = linkBeforeAfter(scoped, behavior, range, W)
        return {
          cols: [
            { key: 'name', label: 'ผลพิจารณา (บันทึกพฤติกรรม)' }, { key: 'given', label: 'บันทึกที่จับคู่ได้', type: 'int' }, { key: 'n', label: 'นับได้', type: 'int' },
            { key: 'before', label: `เสี่ยงเฉลี่ย ${W} วันก่อน`, type: 'num' }, { key: 'after', label: `เสี่ยงเฉลี่ย ${W} วันหลัง`, type: 'num' },
            { key: 'change', label: 'เปลี่ยนแปลง (%)', type: 'pp' }, { key: 'fewer', label: 'คันที่ลดลง', type: 'pct' },
          ],
          rows: ba.map((p) => ({ _key: p.name, _detail: [], ...p })),
          notes: [`นับพฤติกรรมเสี่ยงจากกล้องของรถคันเดิม ${W} วันก่อนกับ ${W} วันหลังวันที่ในบันทึกพฤติกรรม · แถว "ไม่มีความผิด" ใช้เป็นเกณฑ์เทียบ`],
          footnote: 'ช่วงก่อน–หลังต้องอยู่ในช่วงที่มีข้อมูลกล้องครบทั้งสองฝั่ง · รถคันเดียวอาจมีหลายคนขับ · "นับได้" น้อยกว่า 10 ใช้ดูแนวโน้มเท่านั้น',
        }
      }
      const link = behaviorLink(rows, behavior, range)
      return {
        cols: [
          { key: 'plate', label: 'หมายเลขรถ' }, { key: 'unit', label: 'หน่วยงาน' }, { key: 'score', label: 'คะแนน DMS', type: 'int' },
          { key: 'risky', label: 'พฤติกรรมเสี่ยง', type: 'int' }, { key: 'fatigue', label: 'ง่วง / หาว', type: 'int' }, { key: 'sleep', label: 'หลับใน / ง่วง', type: 'int' },
          { key: 'dmsDriver', label: 'คนขับ (กล้อง)' }, { key: 'records', label: 'บันทึกพฤติกรรม', type: 'int' }, { key: 'high', label: 'เสี่ยงสูง', type: 'int' },
          { key: 'penalized', label: 'มีโทษ', type: 'int' }, { key: 'behDrivers', label: 'พขร. ในบันทึก', wrap: true }, { key: 'flagText', label: 'ควรติดตาม' },
        ],
        rows: link.list.map((x) => ({ _key: x.key, _detail: x.list, ...x, behDrivers: x.behDrivers.join(', '), flagText: x.flag ? 'ยังไม่มีบันทึกพฤติกรรม' : '' })),
        notes: [
          `${fmtN(link.flagged)} คัน กล้องจับง่วง/หาว ${LINK_FATIGUE} ครั้งขึ้นไป แต่ยังไม่มีบันทึกพฤติกรรมในช่วงนี้`,
          `บันทึกพฤติกรรม ${fmtN(link.matched)} จาก ${fmtN(link.behavior)} รายการในช่วงนี้จับคู่กับทะเบียนในกล้องได้`,
        ],
        footnote: 'จับคู่ด้วยทะเบียนรถ เพราะชื่อคนขับในกล้องเป็นภาษาอังกฤษ · กดแถวเพื่อดูพฤติกรรมเสี่ยงจากกล้องของคันนั้น',
      }
    },
  },
  {
    id: 'adas-cases',
    title: 'รายการแจ้งเตือน',
    desc: 'ทุกแจ้งเตือนในช่วงที่เลือก พร้อมผลตรวจและกลุ่มผลตรวจ',
    detailOnly: true,
    options: [OUTCOME_FILTER],
    build({ rows, opt }) {
      return { cols: ADAS_DETAIL, rows: [...byOutcome(rows, opt)].sort((a, b) => b.start - a.start) }
    },
  },
]

const UNIT_FILTER = {
  id: 'unit', key: 'unit', label: 'หน่วยงาน',
  choices: (recs) => [['', 'ทุกหน่วยงาน'], ...[...new Set(recs.map((r) => r.unit))].sort((a, b) => a.localeCompare(b, 'th')).map((u) => [u, u])],
}

export const ADAS_SOURCE = {
  id: 'adas', label: 'ADAS / DMS', dashboard: '#/dashboard/adas', noun: 'แจ้งเตือน',
  load, detailCols: ADAS_DETAIL, filters: [UNIT_FILTER],
}
