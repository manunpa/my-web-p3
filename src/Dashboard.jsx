import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, Bell, ShieldAlert, XCircle, Timer, RefreshCw, Search,
  CheckCircle2, Clock3, AlertTriangle,
} from 'lucide-react'
import { loadAlerts, API_URL, REFRESH_MS } from './fleetData'
import { STOP_TYPE_NAMES, OTHER_TYPE } from './stopType'
import {
  hotspots, noise, noiseByMonth, response, longStops, rejected as rejectedOf, weekHeat, SHORT_MIN, LONG_MIN,
} from './leoInsights'
import { Panel, Kpi, LineChart, Donut, RankBars, HourBars, HourHeat, MonthBars, Empty, nf } from './charts'
import {
  DAY, times, dShort, dDay, dTime, hm, startOfDay, pctChange, countBy, toInput, rangeFor, monthly,
  DashTabs, PeriodPicker, RangeBar, usePointerGlow,
} from './dashShared'

// Alert types: 3 validated categorical colors, the rest folded into a neutral "อื่นๆ".
const TYPE_COLORS = ['#3987e5', '#d95926', '#199e70']
const OTHER_COLOR = '#898781'

// Release outcome uses the reserved status colors, always with an icon + label.
const STAGES = {
  approved: { label: 'อนุมัติ', icon: CheckCircle2 },
  rejected: { label: 'ไม่อนุมัติ', icon: XCircle },
  pending: { label: 'รอพิจารณา', icon: Clock3 },
  open: { label: 'ยังไม่ขอปลด', icon: AlertTriangle },
}

const RANKS = [
  { id: 'driver', label: 'คนขับ' },
  { id: 'plate', label: 'ทะเบียนรถ' },
  { id: 'province', label: 'จังหวัด' },
  { id: 'releasedBy', label: 'ผู้ปลด' },
]

function fmtMin(m) {
  if (m === null || m === undefined || isNaN(m)) return '–'
  if (m < 60) return `${Math.round(m)} นาที`
  const h = Math.floor(m / 60)
  const mm = Math.round(m % 60)
  return mm ? `${nf.format(h)} ชม. ${mm} นาที` : `${nf.format(h)} ชม.`
}

// Stop types use their own colors (categorical slots 4, 5, 7: yellow, magenta, violet), so they are
// never mistaken for the alert types above, which use slots 1-3 on the same page.
const STOP_COLORS = ['#c98500', '#d55181', '#9085e9']

function stopPalette(records) {
  const top = countBy(records, 'stopType').filter((t) => t.name !== OTHER_TYPE).slice(0, 3).map((t) => t.name)
  return {
    top,
    split: (rows) => {
      const counts = new Map(top.map((n) => [n, 0]))
      let other = 0
      for (const r of rows) counts.has(r.stopType) ? counts.set(r.stopType, counts.get(r.stopType) + 1) : other++
      return [...[...counts].map(([name, value], i) => ({ name, value, color: STOP_COLORS[i] })),
        { name: 'ประเภทอื่น', value: other, color: OTHER_COLOR }]
    },
  }
}

const avg = (rows) => (rows.length ? rows.reduce((s, r) => s + (r.minutes || 0), 0) / rows.length : 0)

// Colors follow the alert type, not its rank in the current range:
// the 3 most common types overall get the 3 categorical colors; the rest are "อื่นๆ".
function typePalette(records) {
  const top = countBy(records, 'status').slice(0, 3).map((t) => t.name)
  return { top, color: (name) => TYPE_COLORS[top.indexOf(name)] ?? OTHER_COLOR }
}

function splitTypes(rows, palette) {
  const counts = new Map(palette.top.map((n) => [n, 0]))
  let other = 0
  for (const r of rows) {
    if (counts.has(r.status)) counts.set(r.status, counts.get(r.status) + 1)
    else other++
  }
  const parts = [...counts].map(([name, value]) => ({ name, value, color: palette.color(name) }))
  parts.push({ name: 'อื่นๆ', value: other, color: OTHER_COLOR })
  return parts
}

function analyse(records, range, palette, compareLabel) {
  if (!records.length || !range) return null
  const { from, to, kind } = range
  const rows = records.filter((r) => r.start >= from && r.start < to)
  const len = to - from
  const prev = kind === 'all' ? null : records.filter((r) => r.start >= from - len && r.start < from)

  // One bucket per day.
  const dayStart = startOfDay(from).getTime()
  const days = []
  for (let d = new Date(dayStart); d.getTime() < to; d.setDate(d.getDate() + 1)) days.push({ date: new Date(d), rows: [] })
  for (const r of rows) {
    const i = Math.round((startOfDay(r.start) - dayStart) / DAY)
    if (days[i]) days[i].rows.push(r)
  }
  const period = kind === 'preset' ? Math.round(len / DAY) : null
  const daily = days.map((d) => ({ date: d.date, value: d.rows.length }))
  const tail = days.slice(-Math.min(days.length, period === 7 ? 7 : 14))

  const approved = rows.filter((r) => r.stage === 'approved').length
  const rejected = rows.filter((r) => r.stage === 'rejected').length
  const pending = rows.filter((r) => r.stage === 'pending' || r.stage === 'open').length
  const prio = rows.filter((r) => r.priority === 'A').length

  const typeSlices = splitTypes(rows, palette).filter((t) => t.value > 0).sort((a, b) => b.value - a.value)
  const compare = prev ? (period ? `เทียบ ${period} วันก่อนหน้า` : compareLabel) : `ตั้งแต่ ${dShort(new Date(from))}`

  const hours = Array(24).fill(0)
  for (const r of rows) hours[r.start.getHours()]++

  // Stop types (from the unlock reason): count, hour of day and average stop time per type.
  const stopTypes = countBy(rows, 'stopType')
  const stopHeat = stopTypes.map(({ name, value }) => {
    const h = Array(24).fill(0)
    for (const r of rows) if (r.stopType === name) h[r.start.getHours()]++
    return { name, hours: h, total: value }
  })
  const stopAvg = stopTypes
    .filter((t) => t.value >= 3) // an average of 1-2 cases says little
    .map(({ name }) => ({ name, value: Math.round(avg(rows.filter((r) => r.stopType === name))) }))
    .sort((a, b) => b.value - a.value)

  return {
    rows, daily, hours, typeSlices,
    stopTypes, stopHeat, stopAvg,
    hot: hotspots(rows), noise: noise(rows), resp: response(rows),
    longs: longStops(rows), rej: rejectedOf(rows), week: weekHeat(rows),
    ranks: Object.fromEntries(RANKS.map((k) => [k.id, countBy(rows.filter((r) => k.id !== 'releasedBy' || r.releasedBy), k.id)])),
    kpis: [
      {
        label: 'แจ้งเตือนทั้งหมด', icon: Bell, value: rows.length, format: (v) => nf.format(Math.round(v)),
        delta: prev ? pctChange(rows.length, prev.length) : null, upIsGood: false,
        sub: compare,
        spark: tail.map((d) => d.rows.length),
      },
      {
        label: 'ความสำคัญระดับ A', icon: ShieldAlert, value: prio, format: (v) => nf.format(Math.round(v)),
        sub: rows.length ? `${((prio / rows.length) * 100).toFixed(0)}% ของทั้งหมด` : '',
        spark: tail.map((d) => d.rows.filter((r) => r.priority === 'A').length),
      },
      {
        label: 'ไม่อนุมัติให้ปลด', icon: XCircle, value: rejected, format: (v) => nf.format(Math.round(v)),
        sub: approved + rejected
          ? `อนุมัติ ${((approved / (approved + rejected)) * 100).toFixed(1)}%${pending ? ` · รอ ${nf.format(pending)}` : ''}`
          : '',
        spark: tail.map((d) => d.rows.filter((r) => r.stage === 'rejected').length),
      },
      {
        label: 'เวลาเฉลี่ยต่อครั้ง', icon: Timer, value: avg(rows), format: fmtMin,
        delta: prev ? pctChange(avg(rows), avg(prev)) : null, upIsGood: false,
        sub: prev ? compare : 'จากคอลัมน์รวมเวลา',
        spark: tail.map((d) => avg(d.rows)),
      },
    ],
  }
}

/* ---------- alerts table ---------- */

const PAGE = 25

function AlertsTable({ rows }) {
  const [q, setQ] = useState('')
  const [stage, setStage] = useState('all')
  const [type, setType] = useState('')
  const [limit, setLimit] = useState(PAGE)

  const stageCounts = useMemo(() => countBy(rows, 'stage'), [rows])
  const typeCounts = useMemo(() => {
    const m = new Map(countBy(rows, 'stopType').map((t) => [t.name, t.value]))
    return STOP_TYPE_NAMES.filter((n) => m.has(n)).map((n) => ({ name: n, value: m.get(n) }))
  }, [rows])
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return rows
      .filter((r) => stage === 'all' || r.stage === stage)
      .filter((r) => !type || r.stopType === type)
      .filter((r) => !s || [r.caseNo, r.driver, r.driverId, r.plate, r.doNo, r.location, r.status, r.reason, r.releasedBy]
        .some((v) => v && v.toLowerCase().includes(s)))
      .sort((a, b) => b.start - a.start)
  }, [rows, q, stage, type])

  useEffect(() => setLimit(PAGE), [q, stage, type, rows])

  return (
    <>
      <div className="tools">
        <label className="f search">
          <Search size={15} />
          <input type="search" placeholder="ค้นหา คนขับ ทะเบียน Case No เลข DO สถานที่ สาเหตุ…"
            value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหาแจ้งเตือน" />
        </label>
        <label className="f type-pick">
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="ประเภทการจอด">
            <option value="">ทุกประเภทการจอด</option>
            {typeCounts.map((t) => <option key={t.name} value={t.name}>{t.name} ({nf.format(t.value)})</option>)}
          </select>
        </label>
        <div className="chips" role="radiogroup" aria-label="ผลการพิจารณา">
          <button type="button" role="radio" aria-checked={stage === 'all'} className={stage === 'all' ? 'on' : ''}
            onClick={() => setStage('all')}>ทั้งหมด <em>{nf.format(rows.length)}</em></button>
          {stageCounts.map(({ name, value }) => (
            <button key={name} type="button" role="radio" aria-checked={stage === name}
              className={stage === name ? 'on' : ''} onClick={() => setStage(name)}>
              {STAGES[name].label} <em>{nf.format(value)}</em>
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? <Empty>ไม่พบรายการที่ตรงกับการค้นหา</Empty> : (
        <div className="table-scroll">
          <table className="orders alerts">
            <thead>
              <tr>
                <th>Case No</th><th>เริ่ม</th><th>คนขับ</th><th>ทะเบียน</th><th>สถานะรถ</th>
                <th>สำคัญ</th><th className="num">รวมเวลา</th><th>สถานที่</th><th>เลข DO</th>
                <th>ผล</th><th>ผู้ปลด / เวลา</th><th>สาเหตุที่ปลด</th><th>ประเภทการจอด</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, limit).map((r, i) => {
                const S = STAGES[r.stage]
                return (
                  <tr key={r.id} style={{ '--i': Math.min(i, 12) }}>
                    <td className="mono nowrap">{r.caseNo || '–'}</td>
                    <td className="nowrap">{dTime(r.start)}</td>
                    <td className="nowrap" title={r.driverId}>{r.driver}</td>
                    <td className="nowrap">{r.plate}</td>
                    <td className="clip" title={r.status}>{r.status}</td>
                    <td><span className={`prio p-${r.priority || 'x'}`}>{r.priority || '–'}</span></td>
                    <td className="num nowrap">{fmtMin(r.minutes)}</td>
                    <td className="clip" title={r.location}>{r.province !== '(ไม่ระบุ)' ? r.province : r.location || '–'}</td>
                    <td className="mono nowrap">
                      {r.doNo || '–'}
                      {r.doBroken && (
                        <span className="do-warn" title="ในชีตมีเลข DO มากกว่า 1 เลขในช่องเดียว และ Google Sheets แปลงเป็นตัวเลขจนเลขถัดไปเสียหาย แสดงเฉพาะเลขแรก">+?</span>
                      )}
                    </td>
                    <td><span className={`status ${r.stage}`}><S.icon size={13} />{S.label}</span></td>
                    <td className="nowrap">{r.releasedBy || '–'}<small>{r.releasedAt ? dTime(r.releasedAt) : ''}</small></td>
                    <td className="clip wide" title={r.reason}>{r.reason || '–'}</td>
                    <td className="nowrap"><span className={`stop-type${r.stopType === OTHER_TYPE ? ' other' : ''}`}>{r.stopType}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="table-foot">
        <span className="muted">แสดง {nf.format(Math.min(limit, filtered.length))} จาก {nf.format(filtered.length)} รายการ</span>
        {limit < filtered.length && (
          <button type="button" className="more" onClick={() => setLimit((l) => l + PAGE * 2)}>แสดงเพิ่ม</button>
        )}
      </div>
    </>
  )
}

/* ---------- extra analyses ---------- */

const pct = (v) => `${(v ?? 0).toFixed(v >= 10 || v === 0 ? 0 : 1)}%`

function Hotspots({ data }) {
  if (!data.length) return <Empty />
  const max = data[0].count
  return (
    <div className="table-scroll">
      <table className="orders insight">
        <thead><tr><th>#</th><th>พื้นที่</th><th className="num">เคส</th><th>ประเภทที่พบมากสุด</th><th className="num">จอดเฉลี่ย</th><th className="num">คนขับ</th></tr></thead>
        <tbody>
          {data.map((h, i) => (
            <tr key={h.name} style={{ '--i': Math.min(i, 12) }}>
              <td className="muted">{i + 1}</td>
              <td className="nowrap">{h.name}{h.name !== h.province && <small>{h.province}</small>}</td>
              <td className="num">
                <span className="cell-bar"><i style={{ width: `${(h.count / max) * 100}%` }} /></span>{nf.format(h.count)}
              </td>
              <td className="nowrap">
                <span className={`stop-type${h.top?.name === OTHER_TYPE ? ' other' : ''}`}>{h.top?.name}</span>
                <small>{nf.format(h.top?.value ?? 0)} เคส ({pct((h.top?.value / h.count) * 100)})</small>
              </td>
              <td className="num nowrap">{fmtMin(h.avg)}</td>
              <td className="num">{nf.format(h.drivers)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function NoisePanel({ data, months }) {
  const max = Math.max(1, ...months.map((m) => m.pct ?? 0))
  return (
    <div className="insight-hero">
      <div className="hero-num">{pct(data.pct)}</div>
      <p className="muted">
        {nf.format(data.count)} จาก {nf.format(data.total)} แจ้งเตือน เป็นไฟแดงหรือจราจรที่จอดไม่เกิน {SHORT_MIN} นาที
      </p>
      <ul className="mini-list">
        {data.byType.map((t) => <li key={t.name}><span>{t.name}</span><b>{nf.format(t.value)}</b></li>)}
      </ul>
      <h4>สัดส่วนรายเดือน</h4>
      <ul className="mini-bars">
        {months.map((m) => (
          <li key={m.label} title={m.total ? `${m.short} จาก ${m.total} แจ้งเตือน` : 'ไม่มีข้อมูล'}>
            <span>{m.label}</span>
            <span className="cell-bar"><i style={{ width: `${((m.pct ?? 0) / max) * 100}%` }} /></span>
            <b>{m.pct === null ? '–' : pct(m.pct)}</b>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ResponsePanel({ data }) {
  return (
    <div className="insight-hero">
      <div className="hero-num">{data.median === null ? '–' : fmtMin(data.median)}</div>
      <p className="muted">ค่ากลางจากเวลาสิ้นสุดเคสถึงเวลาปลด ({nf.format(data.count)} เคส)</p>
      <h4>แยกตามกะ (เวลาสิ้นสุดเคส)</h4>
      <ul className="mini-list">
        {data.shifts.map((s) => (
          <li key={s.name}><span>{s.name}</span><b>{s.count ? fmtMin(s.value) : '–'}</b><small>{nf.format(s.count)} เคส</small></li>
        ))}
      </ul>
      <h4>แยกตามผู้ปลด <small>(ค่ากลาง นาที · ≥ 5 เคส)</small></h4>
      <RankBars data={data.people} format={fmtMin} />
    </div>
  )
}

function RejectedPanel({ data }) {
  return (
    <div className="insight-hero">
      <div className="hero-num">{nf.format(data.count)}</div>
      <p className="muted">เคสไม่อนุมัติ · {pct(data.rate)} ของเคสที่พิจารณาแล้ว</p>
      <h4>ตามประเภทการจอด</h4>
      {data.byType.length ? <RankBars data={data.byType} format={times} total={data.count} /> : <Empty>ไม่มีเคสไม่อนุมัติ</Empty>}
      <h4>ตามผู้ปลด <small>(≥ 5 เคส)</small></h4>
      <ul className="mini-list">
        {data.people.map((p) => (
          <li key={p.name}><span>{p.name}</span><b>{pct(p.rate)}</b><small>{nf.format(p.rejected)} / {nf.format(p.total)}</small></li>
        ))}
      </ul>
    </div>
  )
}

function LongStops({ rows }) {
  const [limit, setLimit] = useState(10)
  useEffect(() => setLimit(10), [rows])
  if (!rows.length) return <Empty>ไม่มีเคสจอดนานที่ต้องตามต่อ</Empty>
  return (
    <>
      <div className="table-scroll">
        <table className="orders insight">
          <thead><tr><th>เริ่ม</th><th>คนขับ</th><th>ทะเบียน</th><th>ประเภท</th><th className="num">รวมเวลา</th><th>พื้นที่</th><th>สาเหตุที่ปลด</th></tr></thead>
          <tbody>
            {rows.slice(0, limit).map((r, i) => (
              <tr key={r.id} style={{ '--i': Math.min(i, 12) }}>
                <td className="nowrap">{dTime(r.start)}</td>
                <td className="nowrap">{r.driver}</td>
                <td className="nowrap">{r.plate}</td>
                <td className="nowrap"><span className={`stop-type${r.stopType === OTHER_TYPE ? ' other' : ''}`}>{r.stopType}</span></td>
                <td className="num nowrap long">{fmtMin(r.minutes)}</td>
                <td className="nowrap">{r.area || r.province}</td>
                <td className="clip wide" title={r.reason}>{r.reason || '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-foot">
        <span className="muted">แสดง {nf.format(Math.min(limit, rows.length))} จาก {nf.format(rows.length)} เคส</span>
        {limit < rows.length && <button type="button" className="more" onClick={() => setLimit((l) => l + 20)}>แสดงเพิ่ม</button>}
      </div>
    </>
  )
}

/* ---------- page ---------- */

export default function Dashboard() {
  const [state, setState] = useState({ status: 'loading', records: [], error: null, at: null, sample: false, missing: [] })
  const [busy, setBusy] = useState(false)
  const [period, setPeriod] = useState(30)
  const [rank, setRank] = useState('driver')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const stage = useRef(null)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const { records, missing, sample } = await loadAlerts()
      setState({ status: 'ready', records, missing, sample, error: null, at: new Date() })
    } catch (err) {
      setState((s) => ({ ...s, status: s.records.length ? 'ready' : 'error', error: err.message || String(err) }))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    load()
    if (!API_URL) return
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
  }, [load])

  usePointerGlow(stage)

  const range = useMemo(() => rangeFor(state.records, period, custom), [state.records, period, custom])
  const palette = useMemo(() => typePalette(state.records), [state.records])
  const data = useMemo(() => analyse(state.records, range, palette, 'เทียบช่วงก่อนหน้าที่ยาวเท่ากัน'), [state.records, range, palette])
  const months = useMemo(() => monthly(state.records, (rows) => splitTypes(rows, palette), range), [state.records, palette, range])
  const noiseMonths = useMemo(() => noiseByMonth(state.records), [state.records])
  const stopPal = useMemo(() => stopPalette(state.records), [state.records])
  const stopMonths = useMemo(() => monthly(state.records, stopPal.split, range), [state.records, stopPal, range])
  const [drillType, setDrillType] = useState('')
  const [drillBy, setDrillBy] = useState('driver')
  const drillOptions = data ? data.stopTypes : []
  const drill = drillType && drillOptions.some((t) => t.name === drillType) ? drillType : drillOptions[0]?.name ?? ''
  const drillRows = useMemo(
    () => (data ? countBy(data.rows.filter((r) => r.stopType === drill), drillBy).slice(0, 10) : []),
    [data, drill, drillBy],
  )
  const animKey = `${range?.from}:${range?.to}:${state.at?.getTime()}`

  const choose = (id) => {
    if (id === 'custom' && period !== 'custom') {
      // Start the custom range from whatever is on screen now.
      const r = range ?? rangeFor(state.records, 30, custom)
      setCustom({ from: toInput(r.from), to: toInput(Math.min(r.to, Date.now()) - 60000) })
    }
    setPeriod(id)
  }

  const pickMonth = (i) => {
    const mo = months[i]
    setCustom({ from: toInput(mo.start), to: toInput(mo.end.getTime() - 60000) })
    setPeriod('custom')
  }

  const badRange = period === 'custom' && !range

  return (
    <div className="stage scroll" ref={stage}>
      <main className="dash">
        <DashTabs current="#/dashboard" />
        <header className="dash-head">
          <a href="#/" className="back"><ArrowLeft size={16} /> เมนู</a>
          <div className="dash-title">
            <h1>แจ้งเตือน<b>รถขนส่ง</b></h1>
            <p className="sub">
              {state.sample ? 'ข้อมูลตัวอย่าง' : 'ข้อมูลจาก Google Sheet'}
              {state.at && ` · อัปเดต ${hm(state.at)} น.`}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={load} disabled={busy} aria-label="โหลดข้อมูลใหม่" title="โหลดข้อมูลใหม่">
            <RefreshCw size={16} className={busy ? 'spin' : ''} />
          </button>
          <PeriodPicker period={period} onChoose={choose} />
        </header>

        {period === 'custom' && <RangeBar custom={custom} setCustom={setCustom} range={range} count={data?.rows.length ?? 0} />}

        {state.error && state.status === 'ready' && (
          <p className="banner" role="alert">โหลดข้อมูลล่าสุดไม่สำเร็จ ({state.error}) กำลังแสดงข้อมูลชุดก่อนหน้า</p>
        )}
        {state.missing.length > 0 && (
          <p className="banner" role="alert">ไม่พบคอลัมน์: {state.missing.join(', ')} ตรวจชื่อหัวคอลัมน์ใน Google Sheet</p>
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
            <div className="kpis">
              {data.kpis.map((k, i) => <Kpi key={k.label} {...k} i={i} animKey={animKey} />)}
            </div>

            <div className="dash-grid">
              <Panel className="span-2" i={4} title="จำนวนแจ้งเตือนรายวัน"
                note={`${nf.format(data.rows.length)} ครั้ง · ${dShort(data.daily[0].date)} – ${dShort(data.daily.at(-1).date)}`}>
                {data.rows.length ? (
                  <LineChart data={data.daily} animKey={animKey} format={times} integer
                    dateLabel={dShort} tipDate={dDay} ariaLabel="จำนวนแจ้งเตือนรายวัน" />
                ) : <Empty />}
              </Panel>

              <Panel i={5} title="ประเภทการแจ้งเตือน" note="จากคอลัมน์สถานะรถ">
                <Donut data={data.typeSlices} animKey={animKey} unit="ครั้ง" />
              </Panel>

              <Panel className="span-3" i={6} title="สถิติรายเดือน"
                note="12 เดือนล่าสุด แยกตามประเภท · เดือนในช่วงที่เลือกแสดงสีเข้ม · คลิกแท่งเพื่อดูเดือนนั้น">
                <MonthBars months={months} active={(i) => months[i].active} onPick={pickMonth}
                  format={times} animKey={state.at?.getTime()} />
                <ul className="legend inline">
                  {months[0].parts.map((p) => (
                    <li key={p.name}><i style={{ background: p.color }} /><span>{p.name}</span></li>
                  ))}
                </ul>
              </Panel>

              <Panel i={7} title="อันดับสูงสุด" note="จำนวนแจ้งเตือน (10 อันดับ)"
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

              <Panel className="span-2" i={8} title="ประเภทการจอด" note="แยกจากคำในสาเหตุที่ปลดล็อค">
                <RankBars key={animKey} data={data.stopTypes} format={times} total={data.rows.length} />
              </Panel>

              <Panel className="span-3" i={9} title="ประเภทการจอดรายเดือน"
                note={`12 เดือนล่าสุด · 3 ประเภทที่พบบ่อยสุด แยกสี ที่เหลือรวมเป็น "ประเภทอื่น" · คลิกแท่งเพื่อดูเดือนนั้น`}>
                <MonthBars months={stopMonths} active={(i) => stopMonths[i].active} onPick={pickMonth}
                  format={times} animKey={state.at?.getTime()} />
                <ul className="legend inline">
                  {stopMonths[0].parts.map((p) => (
                    <li key={p.name}><i style={{ background: p.color }} /><span>{p.name}</span></li>
                  ))}
                </ul>
              </Panel>

              <Panel className="span-2" i={10} title="ประเภทการจอด × ช่วงเวลา"
                note="แต่ละช่อง = จำนวนเคสของประเภทนั้นในชั่วโมงที่เริ่ม (สีเข้ม = บ่อย)">
                <HourHeat key={animKey} rows={data.stopHeat} format={times} />
              </Panel>

              <Panel i={11} title="เวลาจอดเฉลี่ยตามประเภท" note="นาทีต่อเคส · เฉพาะประเภทที่มีอย่างน้อย 3 เคส">
                <RankBars key={animKey} data={data.stopAvg} format={fmtMin} />
              </Panel>

              <Panel className="span-2" i={12} title="ช่วงเวลาที่เกิดแจ้งเตือน" note="รวมทุกวัน แยกตามชั่วโมงที่เริ่ม (แท่งสว่าง = ช่วงที่เกิดบ่อยสุด)">
                {data.rows.length ? <HourBars key={animKey} counts={data.hours} format={times} /> : <Empty />}
              </Panel>

              <Panel i={13} title="เจาะลึกประเภทการจอด" note={drill ? `ใครเกิด "${drill}" บ่อยสุด (10 อันดับ)` : ''}
                actions={(
                  <div className="drill-ctl">
                    <label className="f type-pick small">
                      <select value={drill} onChange={(e) => setDrillType(e.target.value)} aria-label="เลือกประเภทการจอด">
                        {drillOptions.map((t) => <option key={t.name} value={t.name}>{t.name} ({nf.format(t.value)})</option>)}
                      </select>
                    </label>
                    <div className="seg-ctl small" role="radiogroup" aria-label="จัดอันดับตาม">
                      {RANKS.slice(0, 3).map((r) => (
                        <button key={r.id} type="button" role="radio" aria-checked={drillBy === r.id}
                          className={drillBy === r.id ? 'on' : ''} onClick={() => setDrillBy(r.id)}>{r.label}</button>
                      ))}
                    </div>
                  </div>
                )}>
                <RankBars key={drill + drillBy + animKey} data={drillRows} format={times}
                  total={data.stopTypes.find((t) => t.name === drill)?.value} />
              </Panel>

              <Panel className="span-2" i={14} title="จุดที่เกิดซ้ำ"
                note="12 พื้นที่ (ตำบล · อำเภอ) ที่มีเคสมากสุดในช่วงที่เลือก · ไม่มีตำบลในที่อยู่จะนับรวมเป็นจังหวัด">
                <Hotspots data={data.hot} />
              </Panel>

              <Panel i={15} title="แจ้งเตือนที่ไม่ต้องตรวจจริง" note={`ไฟแดง/จราจร ที่จอดไม่เกิน ${SHORT_MIN} นาที`}>
                <NoisePanel data={data.noise} months={noiseMonths} />
              </Panel>

              <Panel className="span-2" i={16} title="วันในสัปดาห์ × ช่วงเวลา"
                note="แต่ละช่อง = จำนวนเคสที่เริ่มในวันและชั่วโมงนั้น (สีเข้ม = หนาแน่น) ใช้ดูการจัดคนเข้ากะ">
                <HourHeat key={animKey} rows={data.week} format={times} />
              </Panel>

              <Panel i={17} title="เวลาตอบสนองของผู้ปลด" note="ยิ่งน้อยยิ่งเร็ว">
                <ResponsePanel data={data.resp} />
              </Panel>

              <Panel className="span-2" i={18} title="เคสจอดนานที่ควรตามต่อ"
                note={`จอดเกิน ${LONG_MIN} นาที และไม่ใช่อยู่ลูกค้า คลัง/หน่วยงาน ซ่อมบำรุง เรือ จุดลงเวลา หรือรถไม่ได้วิ่งงาน · เรียงจากนานสุด`}>
                <LongStops rows={data.longs} />
              </Panel>

              <Panel i={19} title="เคสไม่อนุมัติ">
                <RejectedPanel data={data.rej} />
              </Panel>

              <Panel className="span-3" i={20} title="รายการแจ้งเตือน" note="เรียงจากล่าสุด">
                <AlertsTable rows={data.rows} />
              </Panel>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
