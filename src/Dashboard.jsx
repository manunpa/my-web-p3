import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, Bell, ShieldAlert, XCircle, Timer, RefreshCw, Search,
  CheckCircle2, Clock3, AlertTriangle, CalendarRange,
} from 'lucide-react'
import { loadAlerts, API_URL, REFRESH_MS } from './fleetData'
import { Panel, Kpi, LineChart, Donut, RankBars, HourBars, MonthBars, Empty, nf, reduceMotion } from './charts'

const DAY = 86400000

const PERIODS = [
  { id: 7, label: '7 วัน' },
  { id: 30, label: '30 วัน' },
  { id: 90, label: '90 วัน' },
  { id: 0, label: 'ทั้งหมด' },
  { id: 'custom', label: 'กำหนดเอง' },
]

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

const times = (v) => `${nf.format(Math.round(v))} ครั้ง`
const dShort = (d) => d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
const dDay = (d) => d.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' })
const dTime = (d) => (d ? d.toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–')
const hm = (d) => d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })

function fmtMin(m) {
  if (m === null || m === undefined || isNaN(m)) return '–'
  if (m < 60) return `${Math.round(m)} นาที`
  const h = Math.floor(m / 60)
  const mm = Math.round(m % 60)
  return mm ? `${nf.format(h)} ชม. ${mm} นาที` : `${nf.format(h)} ชม.`
}

const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d }
const pctChange = (now, before) => (before ? ((now - before) / before) * 100 : null)
const avg = (rows) => (rows.length ? rows.reduce((s, r) => s + (r.minutes || 0), 0) / rows.length : 0)

function countBy(rows, key) {
  const m = new Map()
  for (const r of rows) {
    const k = r[key] || '(ไม่ระบุ)'
    m.set(k, (m.get(k) || 0) + 1)
  }
  return [...m].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
}

/* ---------- date range ---------- */

const pad = (n) => String(n).padStart(2, '0')
// <input type="datetime-local"> uses "YYYY-MM-DDTHH:MM" in local time.
const toInput = (t) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromInput = (s) => {
  const d = s ? new Date(s) : null
  return d && !isNaN(d) ? d.getTime() : null
}

// Returns { from, to } in ms, `to` exclusive.
function rangeFor(records, period, custom) {
  const end = startOfDay(Date.now()).getTime() + DAY
  if (period === 'custom') {
    const a = fromInput(custom.from), b = fromInput(custom.to)
    if (a === null || b === null) return null
    const [from, to] = a <= b ? [a, b] : [b, a]
    return { from, to: to + 60000, kind: 'custom' } // include the whole "to" minute
  }
  if (period) return { from: end - period * DAY, to: end, kind: 'preset' }
  if (!records.length) return null
  return { from: startOfDay(Math.min(...records.map((r) => r.start))).getTime(), to: end, kind: 'all' }
}

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

function monthly(records, palette, range) {
  const now = new Date()
  const months = []
  for (let k = 11; k >= 0; k--) {
    const start = new Date(now.getFullYear(), now.getMonth() - k, 1)
    const end = new Date(now.getFullYear(), now.getMonth() - k + 1, 1)
    const rows = records.filter((r) => r.start >= start && r.start < end)
    months.push({
      start, end,
      label: start.toLocaleDateString('th-TH', { month: 'short' }),
      full: start.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' }),
      total: rows.length,
      parts: splitTypes(rows, palette),
      active: !range || (start.getTime() < range.to && end.getTime() > range.from),
    })
  }
  return months
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

  return {
    rows, daily, hours, typeSlices,
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
  const [limit, setLimit] = useState(PAGE)

  const stageCounts = useMemo(() => countBy(rows, 'stage'), [rows])
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return rows
      .filter((r) => stage === 'all' || r.stage === stage)
      .filter((r) => !s || [r.caseNo, r.driver, r.driverId, r.plate, r.doNo, r.location, r.status, r.reason, r.releasedBy]
        .some((v) => v && v.toLowerCase().includes(s)))
      .sort((a, b) => b.start - a.start)
  }, [rows, q, stage])

  useEffect(() => setLimit(PAGE), [q, stage, rows])

  return (
    <>
      <div className="tools">
        <label className="f search">
          <Search size={15} />
          <input type="search" placeholder="ค้นหา คนขับ ทะเบียน Case No เลข DO สถานที่ สาเหตุ…"
            value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหาแจ้งเตือน" />
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
                <th>ผล</th><th>ผู้ปลด / เวลา</th><th>สาเหตุที่ปลด</th>
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

  // Background glow follows the pointer, like the other pages.
  useEffect(() => {
    if (reduceMotion()) return
    const move = (e) => {
      stage.current?.style.setProperty('--mx', e.clientX + 'px')
      stage.current?.style.setProperty('--my', e.clientY + 'px')
    }
    addEventListener('pointermove', move)
    return () => removeEventListener('pointermove', move)
  }, [])

  const range = useMemo(() => rangeFor(state.records, period, custom), [state.records, period, custom])
  const palette = useMemo(() => typePalette(state.records), [state.records])
  const data = useMemo(() => analyse(state.records, range, palette, 'เทียบช่วงก่อนหน้าที่ยาวเท่ากัน'), [state.records, range, palette])
  const months = useMemo(() => monthly(state.records, palette, range), [state.records, palette, range])
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
          <div className="seg-ctl" role="radiogroup" aria-label="ช่วงเวลา">
            {PERIODS.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={period === p.id}
                className={period === p.id ? 'on' : ''} onClick={() => choose(p.id)}>
                {p.id === 'custom' && <CalendarRange size={13} />}{p.label}
              </button>
            ))}
          </div>
        </header>

        {period === 'custom' && (
          <section className="range-bar" aria-label="กำหนดช่วงวันและเวลา">
            <label>
              <span>ตั้งแต่</span>
              <input type="datetime-local" value={custom.from} max={custom.to || undefined}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            </label>
            <span className="range-arrow" aria-hidden="true">→</span>
            <label>
              <span>ถึง</span>
              <input type="datetime-local" value={custom.to} min={custom.from || undefined}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </label>
            <p className="range-note">
              {badRange
                ? 'กรุณาเลือกวันและเวลาให้ครบทั้งสองช่อง'
                : `${dTime(new Date(range.from))} – ${dTime(new Date(range.to - 60000))} · ${nf.format(data?.rows.length ?? 0)} รายการ`}
            </p>
          </section>
        )}

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

              <Panel className="span-2" i={8} title="ช่วงเวลาที่เกิดแจ้งเตือน" note="รวมทุกวัน แยกตามชั่วโมงที่เริ่ม (แท่งสว่าง = ช่วงที่เกิดบ่อยสุด)">
                {data.rows.length ? <HourBars key={animKey} counts={data.hours} format={times} /> : <Empty />}
              </Panel>

              <Panel className="span-3" i={9} title="รายการแจ้งเตือน" note="เรียงจากล่าสุด">
                <AlertsTable rows={data.rows} />
              </Panel>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
