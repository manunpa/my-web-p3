import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Eye, CheckCircle2, Clock3, RefreshCw, Search, AlertTriangle, XCircle, BellRing, ShieldAlert, Building2, Table2 } from 'lucide-react'
import { loadAdas, ADAS_API_URL, REFRESH_MS } from './adasData'
import { loadBehavior } from './behaviorData'
import {
  typeQuality, noiseMonths, cameraHealth, driverScores, categoryMix, fatigueRepeats, weekHeat, hotspots, geofenceSplit,
  behaviorLink, linkBeforeAfter, isRisky,
} from './adasInsights'
import { AdasInsights } from './AdasInsightsPanels'
import { Panel, Kpi, LineChart, Donut, RankBars, HourBars, MonthBars, Empty, nf } from './charts'
import {
  DAY, times, dShort, dDay, dTime, hm, startOfDay, pctChange, countBy, toInput, rangeFor, monthly,
  DashTabs, PeriodPicker, RangeBar, usePointerGlow, reportHref,
} from './dashShared'

// Alert types: the 3 most common get the categorical colors, the rest fold into "อื่นๆ".
const TYPE_COLORS = ['#3987e5', '#d95926', '#199e70']
const STATUS_COLORS = ['#8f6ae0', '#e0a321', '#d0605a']
const OTHER_COLOR = '#898781'

const RANKS = [
  { id: 'driver', label: 'คนขับ' },
  { id: 'plate', label: 'หมายเลขรถ' },
  { id: 'unit', label: 'หน่วยงาน' },
  { id: 'province', label: 'จังหวัด' },
]

const SPEED_BANDS = [
  { label: 'จอด (0)', test: (s) => s === 0 },
  { label: '1–30', test: (s) => s > 0 && s <= 30 },
  { label: '31–60', test: (s) => s > 30 && s <= 60 },
  { label: '61–80', test: (s) => s > 60 && s <= 80 },
  { label: '81–100', test: (s) => s > 80 && s <= 100 },
  { label: 'มากกว่า 100', test: (s) => s > 100 },
]

const pct = (n, total) => (total ? `${((n / total) * 100).toFixed(n / total < 0.1 ? 1 : 0)}%` : '0%')

// Colors follow the value, not its rank in the current range.
function palette(records, key, colors) {
  const top = countBy(records, key).slice(0, colors.length).map((t) => t.name)
  const split = (rows) => {
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
  return { split }
}

function analyse(records, range, types, statuses) {
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

  const withSpeed = rows.filter((r) => r.speed !== null)
  const reviewed = rows.filter((r) => r.reviewed).length
  const pending = rows.length - reviewed
  // Review results grouped in src/adasInsights.js: risky behavior / normal check / unusable alert.
  const isNoise = (r) => r.outcome === 'noise'
  const risky = rows.filter(isRisky)
  const noise = rows.filter(isNoise).length
  const falseAlerts = rows.filter((r) => /false\s*alert/i.test(r.note)).length
  const noVideo = rows.filter((r) => /no\s*video/i.test(r.note)).length
  const sleep = risky.filter((r) => r.fatigue).length
  const isTrue = (r) => r.alertStatus === 'TRUE'
  const alertTrue = rows.filter(isTrue).length
  const alertFalse = rows.filter((r) => r.alertStatus === 'FALSE').length
  const count = (v) => nf.format(Math.round(v))
  const top = countBy(rows, 'type')[0]

  return {
    rows, hours,
    daily: days.map((d) => ({ date: d.date, value: d.rows.length })),
    typeSlices: types.split(rows).filter((t) => t.value > 0).sort((a, b) => b.value - a.value),
    statusSlices: statuses.split(rows).filter((t) => t.value > 0).sort((a, b) => b.value - a.value),
    notes: countBy(rows.filter((r) => r.note), 'note'),
    noteCount: rows.filter((r) => r.note).length,
    speedBands: SPEED_BANDS.map((b) => ({ name: b.label, value: withSpeed.filter((r) => b.test(r.speed)).length })),
    speedCount: withSpeed.length,
    ranks: Object.fromEntries(RANKS.map((k) => [k.id, countBy(rows, k.id)])),
    kpis: [
      {
        label: 'แจ้งเตือนทั้งหมด', icon: Eye, value: rows.length, format: count,
        delta: prev ? pctChange(rows.length, prev.length) : null, upIsGood: false,
        sub: top ? `พบบ่อยสุด: ${top.name}` : compare,
        spark: tail.map((d) => d.rows.length),
      },
      {
        label: 'พฤติกรรมเสี่ยง (ตรวจยืนยัน)', icon: ShieldAlert, value: risky.length, format: count,
        delta: prev ? pctChange(risky.length, prev.filter(isRisky).length) : null, upIsGood: false,
        sub: `${pct(risky.length, rows.length)} ของแจ้งเตือน · ง่วง/หาว ${nf.format(sleep)}`,
        spark: tail.map((d) => d.rows.filter(isRisky).length),
      },
      {
        label: 'เตือนผิด / ใช้ไม่ได้', icon: XCircle, value: noise, format: count,
        sub: `${pct(noise, rows.length)} · False alert ${nf.format(falseAlerts)} · ไม่มีวิดีโอ ${nf.format(noVideo)}`,
        spark: tail.map((d) => d.rows.filter(isNoise).length),
      },
      {
        label: 'ยังไม่ตรวจสอบ', icon: Clock3, value: pending, format: count,
        sub: `ตรวจแล้ว ${pct(reviewed, rows.length)} ของทั้งหมด`,
        spark: tail.map((d) => d.rows.filter((r) => !r.reviewed).length),
      },
      {
        label: 'สถานะแจ้งเตือน TRUE', icon: BellRing, value: alertTrue, format: count,
        sub: `${pct(alertTrue, rows.length)} ของทั้งหมด · FALSE ${nf.format(alertFalse)}`,
        spark: tail.map((d) => d.rows.filter(isTrue).length),
      },
    ],
  }
}

/* ---------- speed bands (fixed order, so not RankBars) ---------- */

function SpeedBands({ bands, total }) {
  const max = Math.max(1, ...bands.map((b) => b.value))
  if (!total) return <Empty>ไม่มีข้อมูลความเร็ว</Empty>
  return (
    <div className="bars">
      {bands.map((b, i) => (
        <div key={b.name} className="bar-row" style={{ '--i': i }} title={`${b.name} กม./ชม.: ${nf.format(b.value)} ครั้ง (${pct(b.value, total)})`}>
          <span className="bar-name">{b.name}</span>
          <span className="bar-track"><span className="bar" style={{ width: `${(b.value / max) * 100}%` }} /></span>
          <span className="bar-val">{nf.format(b.value)}</span>
        </div>
      ))}
      <p className="muted bars-note">หน่วย กม./ชม.</p>
    </div>
  )
}

/* ---------- table ---------- */

const PAGE = 25

function AdasTable({ rows }) {
  const [q, setQ] = useState('')
  const [review, setReview] = useState('all')
  const [limit, setLimit] = useState(PAGE)

  const reviewed = useMemo(() => rows.filter((r) => r.reviewed).length, [rows])
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return rows
      .filter((r) => review === 'all' || (review === 'done') === r.reviewed)
      .filter((r) => !s || [r.plate, r.unit, r.driver, r.type, r.location, r.note, r.review, r.alertStatus]
        .some((v) => v && v.toLowerCase().includes(s)))
      .sort((a, b) => b.start - a.start)
  }, [rows, q, review])

  useEffect(() => setLimit(PAGE), [q, review, rows])

  const chips = [
    { id: 'all', label: 'ทั้งหมด', n: rows.length },
    { id: 'done', label: 'ตรวจสอบแล้ว', n: reviewed },
    { id: 'pending', label: 'ยังไม่ตรวจสอบ', n: rows.length - reviewed },
  ]

  return (
    <>
      <div className="tools">
        <label className="f search">
          <Search size={15} />
          <input type="search" placeholder="ค้นหา หมายเลขรถ คนขับ หน่วยงาน ประเภท สถานที่ หมายเหตุ…"
            value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหาแจ้งเตือน" />
        </label>
        <div className="chips" role="radiogroup" aria-label="สถานะการตรวจสอบ">
          {chips.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={review === c.id}
              className={review === c.id ? 'on' : ''} onClick={() => setReview(c.id)}>
              {c.label} <em>{nf.format(c.n)}</em>
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? <Empty>ไม่พบรายการที่ตรงกับการค้นหา</Empty> : (
        <div className="table-scroll">
          <table className="orders alerts">
            <thead>
              <tr>
                <th>วันที่ / เวลา</th><th>หมายเลขรถ</th><th>หน่วยงาน</th><th>คนขับ</th><th>ประเภทการแจ้งเตือน</th>
                <th className="num">ความเร็ว</th><th>สถานที่</th><th>ผลการตรวจสอบ</th><th>การตรวจสอบ</th><th>สถานะแจ้งเตือน</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, limit).map((r, i) => (
                <tr key={r.id} style={{ '--i': Math.min(i, 12) }}>
                  <td className="nowrap">{r.hasTime ? dTime(r.start) : dShort(r.start)}</td>
                  <td className="mono nowrap">{r.plate}</td>
                  <td className="nowrap">{r.unit}</td>
                  <td className="nowrap">{r.driver}</td>
                  <td className="clip" title={r.type}>{r.type}</td>
                  <td className="num nowrap">{r.speed === null ? '–' : nf.format(r.speed)}</td>
                  <td className="clip" title={r.location}>{r.province !== '(ไม่ระบุ)' ? r.province : r.location || '–'}</td>
                  <td className="clip" title={r.note}>{r.note || '–'}</td>
                  <td>
                    <span className={`status ${r.reviewed ? 'approved' : 'pending'}`}>
                      {r.reviewed ? <CheckCircle2 size={13} /> : <Clock3 size={13} />}{r.review}
                    </span>
                  </td>
                  <td className="nowrap">{r.alertStatus}</td>
                </tr>
              ))}
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

export default function AdasDashboard() {
  const [state, setState] = useState({ status: 'loading', records: [], error: null, at: null, sample: false, missing: [] })
  const [busy, setBusy] = useState(false)
  const [period, setPeriod] = useState(30)
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [rank, setRank] = useState('driver')
  const [unit, setUnit] = useState('')
  // The behavior log, for linking by plate. Loaded once; the page works without it.
  const [beh, setBeh] = useState({ status: 'loading', records: [] })
  const stage = useRef(null)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const { records, missing, sample } = await loadAdas()
      setState({ status: 'ready', records, missing, sample, error: null, at: new Date() })
    } catch (err) {
      setState((s) => ({ ...s, status: s.records.length ? 'ready' : 'error', error: err.message || String(err) }))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    loadBehavior().then(({ records }) => setBeh({ status: 'ready', records: records.filter((r) => r.start) }))
      .catch(() => setBeh({ status: 'error', records: [] }))
  }, [])

  useEffect(() => {
    load()
    if (!ADAS_API_URL) return
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
  }, [load])

  usePointerGlow(stage)

  const types = useMemo(() => palette(state.records, 'type', TYPE_COLORS), [state.records])
  const statuses = useMemo(() => palette(state.records, 'alertStatus', STATUS_COLORS), [state.records])
  const unitList = useMemo(() => countBy(state.records, 'unit').map((u) => u.name).sort((a, b) => a.localeCompare(b, 'th')), [state.records])
  const scoped = useMemo(() => (unit ? state.records.filter((r) => r.unit === unit) : state.records), [state.records, unit])
  const range = useMemo(() => rangeFor(scoped, period, custom), [scoped, period, custom])
  const data = useMemo(() => analyse(scoped, range, types, statuses), [scoped, range, types, statuses])
  const months = useMemo(() => monthly(scoped, types.split, range), [scoped, types, range])
  const animKey = `${range?.from}:${range?.to}:${state.at?.getTime()}:${unit}`
  // Extra analyses (src/adasInsights.js), same range and unit as the rest of the page.
  const insights = useMemo(() => {
    if (!data || !range) return null
    const { from, to, kind } = range
    const prev = kind === 'all' ? null : scoped.filter((r) => r.start >= from - (to - from) && r.start < from)
    const rows = data.rows
    return {
      animKey,
      quality: typeQuality(rows),
      noiseMonths: noiseMonths(scoped),
      camera: cameraHealth(rows),
      scores: driverScores(rows, prev),
      categories: categoryMix(rows),
      fatigueRepeats: fatigueRepeats(rows),
      geofence: geofenceSplit(rows),
      fatigueWeek: weekHeat(rows.filter((r) => isRisky(r) && r.fatigue)),
      hotspots: hotspots(rows),
      link: behaviorLink(rows, beh.records, range),
      linkBA: linkBeforeAfter(scoped, beh.records, range),
      behaviorStatus: beh.status,
    }
  }, [data, range, scoped, beh, animKey])
  const compareText = range && range.kind !== 'all' ? (period !== 'custom' ? `${period} วันก่อนหน้า` : 'ช่วงก่อนหน้าที่ยาวเท่ากัน') : null
  // Panel title -> its table on the Reports page, with this page's period, unit and the panel's choices.
  const rep = (id, opts) => reportHref(id, period, custom, { unit, ...opts })

  const choose = (id) => {
    if (id === 'custom' && period !== 'custom') {
      const r = range ?? rangeFor(scoped, 30, custom)
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
        <DashTabs current="#/dashboard/adas" />
        <header className="dash-head">
          <a href="#/" className="back"><ArrowLeft size={16} /> เมนู</a>
          <div className="dash-title">
            <h1>ADAS / DMS <b>Songdee</b></h1>
            <p className="sub">
              {state.sample ? 'ข้อมูลตัวอย่าง (ยังไม่ได้ใส่ลิงก์ API)' : 'ข้อมูลจาก Google Sheet'}
              {state.at && ` · อัปเดต ${hm(state.at)} น.`}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={load} disabled={busy} aria-label="โหลดข้อมูลใหม่" title="โหลดข้อมูลใหม่">
            <RefreshCw size={16} className={busy ? 'spin' : ''} />
          </button>
          <a className="rep-btn" href={rep({ src: 'adas' })} title="ดูข้อมูลของกล่องในหน้านี้เป็นตาราง และส่งออก Excel / CSV">
            <Table2 size={15} /> รายงาน
          </a>
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

        {state.status === 'loading' && (
          <section className="panel state-card"><RefreshCw size={22} className="spin" /> กำลังโหลดข้อมูลจาก Google Sheet… (ข้อมูลหลายหมื่นแถว อาจใช้เวลาสักครู่)</section>
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
              <Panel className="span-2" i={4} href={rep('adas-daily')} title="จำนวนแจ้งเตือนรายวัน"
                note={`${nf.format(data.rows.length)} ครั้ง · ${dShort(data.daily[0].date)} – ${dShort(data.daily.at(-1).date)}`}>
                {data.rows.length ? (
                  <LineChart data={data.daily} animKey={animKey} format={times} integer
                    dateLabel={dShort} tipDate={dDay} ariaLabel="จำนวนแจ้งเตือน ADAS / DMS รายวัน" />
                ) : <Empty />}
              </Panel>

              <Panel i={5} href={rep('adas-type-quality')} title="ประเภทการแจ้งเตือน" note="3 ประเภทที่พบบ่อยสุด">
                <Donut data={data.typeSlices} animKey={animKey} unit="ครั้ง" />
              </Panel>

              <Panel className="span-3" i={6} href={rep('adas-monthly')} title="สถิติรายเดือน"
                note="12 เดือนล่าสุด แยกตามประเภท · เดือนในช่วงที่เลือกแสดงสีเข้ม · คลิกแท่งเพื่อดูเดือนนั้น">
                <MonthBars months={months} active={(i) => months[i].active} onPick={pickMonth}
                  format={times} animKey={state.at?.getTime()} />
                <ul className="legend inline">
                  {months[0].parts.map((p) => (
                    <li key={p.name}><i style={{ background: p.color }} /><span>{p.name}</span></li>
                  ))}
                </ul>
              </Panel>

              <Panel className="span-2" i={7} href={rep('adas-rank', { by: rank })} title="อันดับสูงสุด" note="จำนวนแจ้งเตือน (10 อันดับ)"
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

              <Panel i={8} href={rep('adas-speed')} title="ความเร็วขณะแจ้งเตือน" note={`${nf.format(data.speedCount)} รายการที่มีความเร็ว`}>
                <SpeedBands key={animKey} bands={data.speedBands} total={data.speedCount} />
              </Panel>

              <Panel className="span-2" i={9} href={rep('adas-notes')} title="ผลการตรวจสอบ" note="จากคอลัมน์หมายเหตุ (10 อันดับ)">
                <RankBars key={'note' + animKey} data={data.notes.slice(0, 10)} format={times} total={data.noteCount} />
              </Panel>

              <Panel i={10} href={rep('adas-status')} title="สถานะแจ้งเตือน">
                <Donut data={data.statusSlices} animKey={animKey} unit="ครั้ง" />
              </Panel>

              <Panel className="span-3" i={11} href={rep('adas-hour')} title="ช่วงเวลาที่เกิดแจ้งเตือน" note="รวมทุกวัน แยกตามชั่วโมง (แท่งสว่าง = ช่วงที่เกิดบ่อยสุด)">
                {data.hours.some(Boolean) ? <HourBars key={animKey} counts={data.hours} format={times} /> : <Empty />}
              </Panel>

              {insights && <AdasInsights d={insights} compare={compareText} i0={12} rep={rep} />}

              <Panel className="span-3" i={22} href={rep('adas-cases')} title="รายการแจ้งเตือน" note={unit ? `เฉพาะ ${unit} · เรียงจากล่าสุด` : 'เรียงจากล่าสุด'}>
                <AdasTable rows={data.rows} />
              </Panel>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
