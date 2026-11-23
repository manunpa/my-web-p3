import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ClipboardList, CheckCircle2, Clock3, RefreshCw, Search, AlertTriangle, ShieldAlert, Siren,
  ChevronDown, ExternalLink, Building2,
} from 'lucide-react'
import { loadBehavior, BEHAVIOR_API_URL, REFRESH_MS } from './behaviorData'
import {
  repeats, penaltyEffect, penaltyByUnit, riskScores, nearMissByOffense, causeMatrix, fatigue, harshEvents,
} from './behaviorInsights'
import { BehaviorInsights } from './BehaviorInsightsPanels'
import { Panel, Kpi, LineChart, Donut, RankBars, HourBars, MonthBars, Empty, nf } from './charts'
import {
  DAY, times, dShort, dDay, dTime, hm, startOfDay, pctChange, countBy, toInput, rangeFor, monthly,
  DashTabs, PeriodPicker, RangeBar, usePointerGlow,
} from './dashShared'

const DONE_COLOR = '#199e70'
const WAIT_COLOR = '#e0a321'
const TYPE_COLORS = ['#3987e5', '#d95926', '#8f6ae0']
const OTHER_COLOR = '#898781'
const RISK_COLORS = { 4: '#a8323a', 3: '#d0605a', 2: '#e0a321', 1: '#199e70', 0: OTHER_COLOR }
const LATE_DAYS = 7 // a case waiting longer than this counts as overdue

const RANKS = [
  { id: 'driver', label: 'พขร.' },
  { id: 'plate', label: 'ทะเบียน' },
  { id: 'unit', label: 'หน่วยงาน' },
  { id: 'province', label: 'จังหวัด' },
]

const DETAILS = [
  { id: 'offense', label: 'ชนิดความผิด' },
  { id: 'offenseStatusType', label: 'ประเภทสถานะ' },
  { id: 'offenseStatus', label: 'สถานะความผิด' },
  { id: 'penalty', label: 'บทลงโทษ', onlyDone: true },
  { id: 'cause', label: 'สาเหตุ', onlyDone: true },
  { id: 'ppe', label: 'อุปกรณ์ที่ไม่สวมใส่', skipBlank: true },
]

const AGE_BANDS = [
  { label: '0–3 วัน', test: (d) => d <= 3 },
  { label: '4–7 วัน', test: (d) => d > 3 && d <= 7 },
  { label: '8–14 วัน', test: (d) => d > 7 && d <= 14 },
  { label: '15–30 วัน', test: (d) => d > 14 && d <= 30 },
  { label: 'มากกว่า 30 วัน', test: (d) => d > 30 },
]

const SPEED_BANDS = [
  { label: 'ไม่เกิน 60', test: (s) => s <= 60 },
  { label: '61–80', test: (s) => s > 60 && s <= 80 },
  { label: '81–90', test: (s) => s > 80 && s <= 90 },
  { label: '91–100', test: (s) => s > 90 && s <= 100 },
  { label: 'มากกว่า 100', test: (s) => s > 100 },
]

const pct = (n, total) => (total ? `${((n / total) * 100).toFixed(n / total < 0.1 ? 1 : 0)}%` : '0%')
const ageDays = (r) => Math.max(0, Math.floor((Date.now() - r.start) / DAY))
const isUrl = (s) => /^https?:\/\/\S+$/i.test(s)

// Colors follow the value, not its rank in the current range.
function palette(records, key, colors) {
  const top = countBy(records, key).slice(0, colors.length).map((t) => t.name)
  return (rows) => {
    const counts = new Map(top.map((n) => [n, 0]))
    let other = 0
    for (const r of rows) {
      if (counts.has(r[key])) counts.set(r[key], counts.get(r[key]) + 1)
      else other++
    }
    const parts = [...counts].map(([name, value], i) => ({ name, value, color: colors[i] }))
    parts.push({ name: 'อื่นๆ', value: other, color: OTHER_COLOR })
    return parts
  }
}

const responseSplit = (rows) => {
  const done = rows.filter((r) => r.responded).length
  return [
    { name: 'ตอบกลับแล้ว', value: done, color: DONE_COLOR },
    { name: 'รอตอบกลับ', value: rows.length - done, color: WAIT_COLOR },
  ]
}

function analyse(records, range, behaviorSplit) {
  if (!records.length || !range) return null
  const { from, to, kind } = range
  const rows = records.filter((r) => r.start >= from && r.start < to)
  const len = to - from
  const prev = kind === 'all' ? null : records.filter((r) => r.start >= from - len && r.start < from)

  const dayStart = startOfDay(from).getTime()
  const days = []
  for (let d = new Date(dayStart); d.getTime() < to; d.setDate(d.getDate() + 1)) days.push({ date: new Date(d), rows: [] })
  for (const r of rows) {
    const i = Math.round((startOfDay(r.start) - dayStart) / DAY)
    if (days[i]) days[i].rows.push(r)
  }
  const period = kind === 'preset' ? Math.round(len / DAY) : null
  const tail = days.slice(-Math.min(days.length, period === 7 ? 7 : 14))
  const compare = prev ? (period ? `เทียบ ${period} วันก่อนหน้า` : 'เทียบช่วงก่อนหน้าที่ยาวเท่ากัน') : `ตั้งแต่ ${dShort(new Date(from))}`

  const hours = Array(24).fill(0)
  for (const r of rows) if (r.hasTime) hours[r.start.getHours()]++

  const done = rows.filter((r) => r.responded)
  const waiting = rows.filter((r) => !r.responded)
  const late = waiting.filter((r) => ageDays(r) > LATE_DAYS).length
  const high = (r) => r.riskLevel >= 3
  const highRisk = rows.filter(high).length
  const nearMiss = rows.filter((r) => r.nearMiss).length
  const withSpeed = rows.filter((r) => r.maxSpeed !== null)
  const count = (v) => nf.format(Math.round(v))
  const top = countBy(rows, 'behavior')[0]

  // Response per unit, most waiting first.
  const units = new Map()
  for (const r of rows) {
    const u = units.get(r.unit) || { name: r.unit, done: 0, waiting: 0, late: 0 }
    if (r.responded) u.done++
    else { u.waiting++; if (ageDays(r) > LATE_DAYS) u.late++ }
    units.set(r.unit, u)
  }

  const riskSlices = countBy(rows, 'risk').map((s) => {
    const lvl = rows.find((r) => r.risk === s.name)?.riskLevel ?? 0
    return { ...s, lvl, color: RISK_COLORS[lvl] }
  }).sort((a, b) => b.lvl - a.lvl || b.value - a.value)

  return {
    rows, hours,
    daily: days.map((d) => ({ date: d.date, value: d.rows.length })),
    behaviorSlices: behaviorSplit(rows).filter((t) => t.value > 0).sort((a, b) => b.value - a.value),
    riskSlices,
    units: [...units.values()].sort((a, b) => b.waiting - a.waiting || b.done + b.waiting - a.done - a.waiting),
    ageBands: AGE_BANDS.map((b) => ({ name: b.label, value: waiting.filter((r) => b.test(ageDays(r))).length })),
    waitingCount: waiting.length,
    speedBands: SPEED_BANDS.map((b) => ({ name: b.label, value: withSpeed.filter((r) => b.test(r.maxSpeed)).length })),
    speedCount: withSpeed.length,
    ranks: Object.fromEntries(RANKS.map((k) => [k.id, countBy(rows, k.id)])),
    details: Object.fromEntries(DETAILS.map((k) => {
      let src = k.onlyDone ? done : rows
      if (k.skipBlank) src = src.filter((r) => r[k.id])
      return [k.id, { data: countBy(src, k.id), total: src.length }]
    })),
    kpis: [
      {
        label: 'บันทึกพฤติกรรมทั้งหมด', icon: ClipboardList, value: rows.length, format: count,
        delta: prev ? pctChange(rows.length, prev.length) : null, upIsGood: false,
        sub: top ? `พบบ่อยสุด: ${top.name}` : compare,
        spark: tail.map((d) => d.rows.length),
      },
      {
        label: 'ตอบกลับแล้ว (มีใบ VR)', icon: CheckCircle2, value: done.length, format: count,
        sub: `${pct(done.length, rows.length)} ของทั้งหมด`,
        spark: tail.map((d) => d.rows.filter((r) => r.responded).length),
      },
      {
        label: 'รอหน่วยงานตอบกลับ', icon: Clock3, value: waiting.length, format: count,
        sub: `ค้างเกิน ${LATE_DAYS} วัน ${nf.format(late)} รายการ`,
        spark: tail.map((d) => d.rows.filter((r) => !r.responded).length),
      },
      {
        label: 'ความเสี่ยงสูง', icon: ShieldAlert, value: highRisk, format: count,
        delta: prev ? pctChange(highRisk, prev.filter(high).length) : null, upIsGood: false,
        sub: `${pct(highRisk, rows.length)} ของทั้งหมด`,
        spark: tail.map((d) => d.rows.filter(high).length),
      },
      {
        label: 'Near Miss', icon: Siren, value: nearMiss, format: count,
        sub: `${pct(nearMiss, rows.length)} ของทั้งหมด`,
        spark: tail.map((d) => d.rows.filter((r) => r.nearMiss).length),
      },
    ],
  }
}

/* ---------- small charts ---------- */

// Bars in a fixed order (age, speed), so not RankBars.
function FixedBars({ bands, total, unit, note, empty }) {
  const max = Math.max(1, ...bands.map((b) => b.value))
  if (!total) return <Empty>{empty}</Empty>
  return (
    <div className="bars">
      {bands.map((b, i) => (
        <div key={b.name} className="bar-row" style={{ '--i': i }} title={`${b.name}: ${nf.format(b.value)} ${unit} (${pct(b.value, total)})`}>
          <span className="bar-name">{b.name}</span>
          <span className="bar-track"><span className="bar" style={{ width: `${(b.value / max) * 100}%` }} /></span>
          <span className="bar-val">{nf.format(b.value)}</span>
        </div>
      ))}
      {note && <p className="muted bars-note">{note}</p>}
    </div>
  )
}

function UnitResponse({ units, onPick }) {
  if (!units.length) return <Empty />
  const max = Math.max(1, ...units.map((u) => u.done + u.waiting))
  return (
    <div className="bars unit-resp">
      {units.slice(0, 12).map((u, i) => {
        const total = u.done + u.waiting
        return (
          <button key={u.name} type="button" className="bar-row" style={{ '--i': i }} onClick={() => onPick(u.name)}
            title={`${u.name}\nตอบกลับแล้ว ${nf.format(u.done)} · รอตอบกลับ ${nf.format(u.waiting)} (ค้างเกิน ${LATE_DAYS} วัน ${nf.format(u.late)})\nคลิกเพื่อดูเฉพาะหน่วยงานนี้`}>
            <span className="bar-name">{u.name}</span>
            <span className="bar-track stack" style={{ width: `${(total / max) * 100}%` }}>
              <i style={{ flex: u.done, background: DONE_COLOR }} />
              <i style={{ flex: u.waiting, background: WAIT_COLOR }} />
            </span>
            <span className="bar-val">{pct(u.done, total)}</span>
          </button>
        )
      })}
      <ul className="legend inline">
        <li><i style={{ background: DONE_COLOR }} /><span>ตอบกลับแล้ว</span></li>
        <li><i style={{ background: WAIT_COLOR }} /><span>รอตอบกลับ</span></li>
        <li><span>ตัวเลขขวา = % ที่ตอบกลับแล้ว</span></li>
      </ul>
    </div>
  )
}

/* ---------- table ---------- */

const PAGE = 25

function Cell({ v }) {
  if (!v) return <span className="muted">–</span>
  if (isUrl(v)) return <a href={v} target="_blank" rel="noopener noreferrer" className="ext">เปิด <ExternalLink size={12} /></a>
  return v
}

function BehaviorTable({ rows, headers }) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [limit, setLimit] = useState(PAGE)
  const [open, setOpen] = useState(null)

  const done = useMemo(() => rows.filter((r) => r.responded).length, [rows])
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return rows
      .filter((r) => filter === 'all' || (filter === 'done') === r.responded)
      .filter((r) => !s || [r.unit, r.driver, r.plate, r.behavior, r.offense, r.location, r.risk, r.penalty, r.status, r.vrid, r.rsc]
        .some((v) => v && v.toLowerCase().includes(s)))
      .sort((a, b) => (filter === 'pending' ? a.start - b.start : b.start - a.start))
  }, [rows, q, filter])

  useEffect(() => { setLimit(PAGE); setOpen(null) }, [q, filter, rows])

  const chips = [
    { id: 'all', label: 'ทั้งหมด', n: rows.length },
    { id: 'done', label: 'ตอบกลับแล้ว', n: done },
    { id: 'pending', label: 'รอตอบกลับ', n: rows.length - done },
  ]

  return (
    <>
      <div className="tools">
        <label className="f search">
          <Search size={15} />
          <input type="search" placeholder="ค้นหา หน่วยงาน พขร. ทะเบียน พฤติกรรม ชนิดความผิด สถานที่ VRID…"
            value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหาบันทึกพฤติกรรม" />
        </label>
        <div className="chips" role="radiogroup" aria-label="สถานะการตอบกลับ">
          {chips.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={filter === c.id}
              className={filter === c.id ? 'on' : ''} onClick={() => setFilter(c.id)}>
              {c.label} <em>{nf.format(c.n)}</em>
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? <Empty>ไม่พบรายการที่ตรงกับการค้นหา</Empty> : (
        <div className="table-scroll">
          <table className="orders alerts behavior">
            <thead>
              <tr>
                <th aria-label="รายละเอียด" /><th>วันที่ / เวลา</th><th>หน่วยงาน</th><th>พขร.</th><th>ทะเบียน</th>
                <th>ประเภทพฤติกรรม</th><th>ชนิดความผิด</th><th>ความเสี่ยง</th><th className="num">ความเร็วสูงสุด</th>
                <th>บทลงโทษ</th><th>ใบ VR</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, limit).map((r, i) => {
                const isOpen = open === r.id
                return (
                  <Fragment key={r.id}>
                    <tr style={{ '--i': Math.min(i, 12) }} className={`click${isOpen ? ' open' : ''}`}
                      onClick={() => setOpen(isOpen ? null : r.id)}>
                      <td>
                        <button type="button" className="row-toggle" aria-expanded={isOpen} aria-label="ดูรายละเอียดทั้งหมด"
                          onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : r.id) }}>
                          <ChevronDown size={14} />
                        </button>
                      </td>
                      <td className="nowrap">{r.hasTime ? dTime(r.start) : dShort(r.start)}</td>
                      <td className="nowrap">{r.unit}</td>
                      <td className="nowrap">{r.driver}</td>
                      <td className="mono nowrap">{r.plate}</td>
                      <td className="clip" title={r.behavior}>{r.behavior}</td>
                      <td className="clip" title={r.offense}>{r.offense}</td>
                      <td className="nowrap"><span className="risk"><i style={{ background: RISK_COLORS[r.riskLevel] }} />{r.risk}</span></td>
                      <td className="num nowrap">{r.maxSpeed === null ? '–' : nf.format(r.maxSpeed)}</td>
                      <td className="clip" title={r.penalty}>{r.penalty}</td>
                      <td className="nowrap">
                        {r.responded ? (
                          <span className="status approved">
                            <CheckCircle2 size={13} />
                            {isUrl(r.vr)
                              ? <a href={r.vr} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>ตอบกลับแล้ว</a>
                              : 'ตอบกลับแล้ว'}
                          </span>
                        ) : (
                          <span className={`status ${ageDays(r) > LATE_DAYS ? 'rejected' : 'pending'}`}>
                            <Clock3 size={13} />รอ {nf.format(ageDays(r))} วัน
                          </span>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="detail-row">
                        <td colSpan={11}>
                          <dl className="detail-grid">
                            {headers.map((h) => (
                              <div key={h}><dt>{h}</dt><dd><Cell v={String(r.raw[h] ?? '').trim()} /></dd></div>
                            ))}
                          </dl>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="table-foot">
        <span className="muted">แสดง {nf.format(Math.min(limit, filtered.length))} จาก {nf.format(filtered.length)} รายการ · คลิกแถวเพื่อดูข้อมูลทุกคอลัมน์</span>
        {limit < filtered.length && (
          <button type="button" className="more" onClick={() => setLimit((l) => l + PAGE * 2)}>แสดงเพิ่ม</button>
        )}
      </div>
    </>
  )
}

/* ---------- page ---------- */

export default function BehaviorDashboard() {
  const [state, setState] = useState({ status: 'loading', records: [], headers: [], error: null, at: null, sample: false, missing: [], undated: 0 })
  const [busy, setBusy] = useState(false)
  const [period, setPeriod] = useState(30)
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [unit, setUnit] = useState('')
  const [rank, setRank] = useState('driver')
  const [detail, setDetail] = useState('offense')
  const stage = useRef(null)
  const tableRef = useRef(null)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const res = await loadBehavior()
      setState({ status: 'ready', ...res, error: null, at: new Date() })
    } catch (err) {
      setState((s) => ({ ...s, status: s.records.length ? 'ready' : 'error', error: err.message || String(err) }))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    load()
    if (!BEHAVIOR_API_URL) return
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
  }, [load])

  usePointerGlow(stage)

  const dated = useMemo(() => state.records.filter((r) => r.start), [state.records])
  const unitList = useMemo(() => countBy(dated, 'unit').map((u) => u.name).sort((a, b) => a.localeCompare(b, 'th')), [dated])
  const scoped = useMemo(() => (unit ? dated.filter((r) => r.unit === unit) : dated), [dated, unit])
  const behaviorSplit = useMemo(() => palette(dated, 'behavior', TYPE_COLORS), [dated])
  const range = useMemo(() => rangeFor(scoped, period, custom), [scoped, period, custom])
  const data = useMemo(() => analyse(scoped, range, behaviorSplit), [scoped, range, behaviorSplit])
  const months = useMemo(() => monthly(scoped, responseSplit, range), [scoped, range])
  // Extra analyses (src/behaviorInsights.js). "dated" (all units) is used where a driver's whole
  // history matters: re-offending after a penalty and days since the last record.
  const insights = useMemo(() => {
    if (!data || !range) return null
    const { from, to, kind } = range
    const len = to - from
    const prev = kind === 'all' ? null : scoped.filter((r) => r.start >= from - len && r.start < from)
    const rows = data.rows
    return {
      compare: prev ? (period !== 'custom' && period !== 'all' ? `${period} วันก่อนหน้า` : 'ช่วงก่อนหน้าที่ยาวเท่ากัน') : null,
      repeats: repeats(rows),
      effect: penaltyEffect(dated, rows),
      unitPenalty: penaltyByUnit(rows),
      scores: riskScores(dated, rows, prev),
      nearMiss: nearMissByOffense(rows),
      causes: causeMatrix(rows),
      fatigue: fatigue(rows),
      harsh: harshEvents(rows),
    }
  }, [data, range, scoped, dated, period])
  const animKey = `${range?.from}:${range?.to}:${state.at?.getTime()}:${unit}`

  const choose = (id) => {
    if (id === 'custom' && period !== 'custom') {
      const r = range ?? rangeFor(scoped, 30, custom)
      if (r) setCustom({ from: toInput(r.from), to: toInput(Math.min(r.to, Date.now()) - 60000) })
    }
    setPeriod(id)
  }

  const pickMonth = (i) => {
    const mo = months[i]
    setCustom({ from: toInput(mo.start), to: toInput(mo.end.getTime() - 60000) })
    setPeriod('custom')
  }

  const pickUnit = (name) => {
    setUnit(name)
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const badRange = period === 'custom' && !range
  const det = DETAILS.find((d) => d.id === detail)

  return (
    <div className="stage scroll" ref={stage}>
      <main className="dash">
        <DashTabs current="#/dashboard/behavior" />
        <header className="dash-head">
          <a href="#/" className="back"><ArrowLeft size={16} /> เมนู</a>
          <div className="dash-title">
            <h1>บันทึกพฤติกรรม <b>พขร.</b></h1>
            <p className="sub">
              {state.sample ? 'ข้อมูลตัวอย่าง (ยังไม่ได้ใส่ลิงก์ API)' : 'ข้อมูลจาก Google Sheet'}
              {state.at && ` · อัปเดต ${hm(state.at)} น.`}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={load} disabled={busy} aria-label="โหลดข้อมูลใหม่" title="โหลดข้อมูลใหม่">
            <RefreshCw size={16} className={busy ? 'spin' : ''} />
          </button>
          <label className="f unit-pick" title="หน่วยงาน">
            <Building2 size={15} />
            <select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="เลือกหน่วยงาน">
              <option value="">ทุกหน่วยงาน</option>
              {unitList.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <PeriodPicker period={period} onChoose={choose} />
        </header>

        {period === 'custom' && <RangeBar custom={custom} setCustom={setCustom} range={range} count={data?.rows.length ?? 0} />}

        {state.error && state.status === 'ready' && (
          <p className="banner" role="alert">โหลดข้อมูลล่าสุดไม่สำเร็จ ({state.error}) กำลังแสดงข้อมูลชุดก่อนหน้า</p>
        )}
        {state.missing.length > 0 && (
          <p className="banner" role="alert">ไม่พบคอลัมน์: {state.missing.join(', ')} ตรวจชื่อหัวคอลัมน์ใน Google Sheet</p>
        )}
        {state.undated > 0 && (
          <p className="banner" role="alert">
            {nf.format(state.undated)} รายการอ่านวันที่จากคอลัมน์ช่วงเวลาไม่ได้ จึงไม่แสดงในแดชบอร์ด
          </p>
        )}

        {state.status === 'loading' && (
          <section className="panel state-card"><RefreshCw size={22} className="spin" /> กำลังโหลดข้อมูลจาก Google Sheet…</section>
        )}

        {state.status === 'error' && (
          <section className="panel state-card">
            <AlertTriangle size={22} />
            <div>
              <strong>โหลดข้อมูลไม่สำเร็จ</strong>
              <p className="muted">{state.error}</p>
            </div>
            <button type="button" className="more" onClick={load} disabled={busy}>ลองใหม่</button>
          </section>
        )}

        {state.status === 'ready' && !data && !badRange && (
          <section className="panel state-card"><Empty>ยังไม่มีข้อมูลใน Google Sheet</Empty></section>
        )}

        {state.status === 'ready' && data && (
          <>
            <div className="kpis five">
              {data.kpis.map((k, i) => <Kpi key={k.label} {...k} i={i} animKey={animKey} />)}
            </div>

            <div className="dash-grid">
              <Panel className="span-2" i={4} title="จำนวนบันทึกพฤติกรรมรายวัน"
                note={`${nf.format(data.rows.length)} รายการ · ${dShort(data.daily[0].date)} – ${dShort(data.daily.at(-1).date)}`}>
                {data.rows.length ? (
                  <LineChart data={data.daily} animKey={animKey} format={times} integer
                    dateLabel={dShort} tipDate={dDay} ariaLabel="จำนวนบันทึกพฤติกรรม พขร. รายวัน" />
                ) : <Empty />}
              </Panel>

              <Panel i={5} title="ระดับความเสี่ยง">
                <Donut data={data.riskSlices} animKey={animKey} unit="รายการ" />
              </Panel>

              <Panel className="span-3" i={6} title="สถิติรายเดือน"
                note="12 เดือนล่าสุด แยกตามการตอบกลับ · เดือนในช่วงที่เลือกแสดงสีเข้ม · คลิกแท่งเพื่อดูเดือนนั้น">
                <MonthBars months={months} active={(i) => months[i].active} onPick={pickMonth}
                  format={times} animKey={`${state.at?.getTime()}:${unit}`} />
                <ul className="legend inline">
                  {months[0].parts.map((p) => (
                    <li key={p.name}><i style={{ background: p.color }} /><span>{p.name}</span></li>
                  ))}
                </ul>
              </Panel>

              <Panel className="span-2" i={7} title="การตอบกลับรายหน่วยงาน"
                note={unit ? `เฉพาะ ${unit}` : 'เรียงตามจำนวนที่รอตอบกลับ · คลิกเพื่อดูเฉพาะหน่วยงาน'}>
                <UnitResponse key={animKey} units={data.units} onPick={pickUnit} />
              </Panel>

              <Panel i={8} title="รอตอบกลับมานานเท่าไร" note={`${nf.format(data.waitingCount)} รายการที่ยังไม่มีใบ VR`}>
                <FixedBars key={animKey} bands={data.ageBands} total={data.waitingCount} unit="รายการ"
                  note="นับจากวันที่เกิดเหตุถึงวันนี้" empty="ตอบกลับครบทุกรายการแล้ว" />
              </Panel>

              <Panel className="span-2" i={9} title="อันดับสูงสุด" note="จำนวนบันทึก (10 อันดับ)"
                actions={(
                  <div className="seg-ctl small" role="radiogroup" aria-label="จัดอันดับตาม">
                    {RANKS.map((r) => (
                      <button key={r.id} type="button" role="radio" aria-checked={rank === r.id}
                        className={rank === r.id ? 'on' : ''} onClick={() => setRank(r.id)}>{r.label}</button>
                    ))}
                  </div>
                )}>
                <RankBars key={rank + animKey} data={data.ranks[rank].slice(0, 10)} format={times} total={data.rows.length} />
              </Panel>

              <Panel i={10} title="ประเภทพฤติกรรม" note="3 ประเภทที่พบบ่อยสุด">
                <Donut data={data.behaviorSlices} animKey={animKey} unit="รายการ" />
              </Panel>

              <Panel className="span-2" i={11} title="รายละเอียดความผิด"
                note={det.onlyDone ? 'เฉพาะรายการที่ตอบกลับแล้ว (10 อันดับ)' : '10 อันดับ'}
                actions={(
                  <div className="seg-ctl small" role="radiogroup" aria-label="แสดงตาม">
                    {DETAILS.map((d) => (
                      <button key={d.id} type="button" role="radio" aria-checked={detail === d.id}
                        className={detail === d.id ? 'on' : ''} onClick={() => setDetail(d.id)}>{d.label}</button>
                    ))}
                  </div>
                )}>
                <RankBars key={detail + animKey} data={data.details[detail].data.slice(0, 10)} format={times}
                  total={data.details[detail].total} />
              </Panel>

              <Panel i={12} title="ความเร็วสูงสุด" note={`${nf.format(data.speedCount)} รายการที่มีความเร็ว`}>
                <FixedBars key={animKey} bands={data.speedBands} total={data.speedCount} unit="รายการ"
                  note="หน่วย กม./ชม." empty="ไม่มีข้อมูลความเร็ว" />
              </Panel>

              {data.hours.some(Boolean) && (
                <Panel className="span-3" i={13} title="ช่วงเวลาที่เกิดเหตุ" note="รวมทุกวัน แยกตามชั่วโมง (แท่งสว่าง = ช่วงที่เกิดบ่อยสุด)">
                  <HourBars key={animKey} counts={data.hours} format={times} />
                </Panel>
              )}

              {insights && <BehaviorInsights d={insights} compare={insights.compare} i0={14} />}

              <div className="span-3" ref={tableRef}>
                <Panel i={22} title="รายการบันทึกพฤติกรรม" note={unit ? `เฉพาะ ${unit} · เรียงจากล่าสุด` : 'เรียงจากล่าสุด (รอตอบกลับ: เรียงจากค้างนานสุด)'}
                  actions={unit && <button type="button" className="more" onClick={() => setUnit('')}>ดูทุกหน่วยงาน</button>}>
                  <BehaviorTable rows={data.rows} headers={state.headers} />
                </Panel>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
