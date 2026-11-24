import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, LifeBuoy, Headset, Truck, CircleSlash, RefreshCw, Search, AlertTriangle, FlaskConical,
  Table2, Lightbulb, Check, MessageSquareText,
} from 'lucide-react'
import { loadHelp, PROVIDERS, ACTIONS, REFRESH_MS } from './helpData'
import { Panel, Kpi, LineChart, Donut, RankBars, HourBars, HourHeat, MonthBars, Empty, nf } from './charts'
import {
  DAY, times, dShort, dDay, dTime, hm, startOfDay, pctChange, countBy, toInput, rangeFor, monthly,
  DashTabs, PeriodPicker, RangeBar, usePointerGlow, reportHref,
} from './dashShared'
import { highlights, summaryText, weekHeat, repeatPlates, mixText, REPEAT_MIN } from './helpInsights'

const ACTION_IDS = Object.keys(ACTIONS)
const PROVIDER_COLOR = Object.fromEntries(PROVIDERS.map((p) => [p.id, p.color]))

const RANKS = [
  { id: 'cause', label: 'สาเหตุ' },
  { id: 'unit', label: 'หน่วยงาน' },
  { id: 'plate', label: 'หมายเลขรถ' },
  { id: 'driver', label: 'คนขับ' },
  { id: 'province', label: 'จังหวัด' },
]

const pct = (n, total) => (total ? `${((n / total) * 100).toFixed(n / total < 0.1 ? 1 : 0)}%` : '0%')
const byProvider = (rows) => PROVIDERS.map((p) => ({ name: p.id, value: rows.filter((r) => r.provider === p.id).length, color: p.color }))
const byAction = (rows) => ACTION_IDS.map((a) => ({ name: ACTIONS[a].label, value: rows.filter((r) => r.action === a).length, color: ACTIONS[a].color }))

function analyse(records, range) {
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

  const n = (a) => rows.filter((r) => r.action === a).length
  const spark = (a) => tail.map((d) => d.rows.filter((r) => r.action === a).length)
  const count = (v) => nf.format(Math.round(v))

  const dayY = (t) => new Date(t).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })

  return {
    rows, hours,
    highlights: highlights(rows, prev, to),
    summary: (scope) => summaryText(rows, prev, `${dayY(from)} – ${dayY(Math.min(to, Date.now()) - 1)}`, scope, to),
    heat: weekHeat(rows),
    repeats: repeatPlates(rows),
    daily: days.map((d) => ({ date: d.date, value: d.rows.length })),
    providers: PROVIDERS.map((p) => {
      const pr = rows.filter((r) => r.provider === p.id)
      return { ...p, total: pr.length, parts: byAction(pr) }
    }),
    actions: byAction(rows).filter((a) => a.value > 0),
    ranks: Object.fromEntries(RANKS.map((k) => [k.id, countBy(rows, k.id)])),
    kpis: [
      {
        label: 'การกดปุ่มทั้งหมด', icon: LifeBuoy, value: rows.length, format: count,
        delta: prev ? pctChange(rows.length, prev.length) : null, upIsGood: false, sub: compare,
        spark: tail.map((d) => d.rows.length),
      },
      {
        label: 'RSC action', icon: Headset, value: n('rsc'), format: count,
        sub: `${pct(n('rsc'), rows.length)} ของทั้งหมด`, spark: spark('rsc'),
      },
      {
        label: 'Operation action', icon: Truck, value: n('operation'), format: count,
        sub: `${pct(n('operation'), rows.length)} ของทั้งหมด`, spark: spark('operation'),
      },
      {
        label: 'No action', icon: CircleSlash, value: n('none'), format: count,
        sub: `${pct(n('none'), rows.length)} ของทั้งหมด${n('unknown') ? ` · ไม่ระบุ ${nf.format(n('unknown'))}` : ''}`,
        spark: spark('none'),
      },
    ],
  }
}

/* ---------- per-provider action split ---------- */

function ProviderSplit({ providers }) {
  const all = providers.reduce((s, p) => s + p.total, 0)
  return (
    <div className="psplit">
      {providers.map((p, i) => (
        <div key={p.id} className="psplit-row" style={{ '--i': i }}>
          <div className="psplit-head">
            <i style={{ background: p.color }} />
            <strong>{p.id}</strong>
            <span className="muted">{nf.format(p.total)} ครั้ง · {pct(p.total, all)}</span>
          </div>
          <div className="psplit-bar" role="img"
            aria-label={`${p.id}: ` + p.parts.filter((a) => a.value).map((a) => `${a.name} ${a.value}`).join(', ')}>
            {p.total ? p.parts.filter((a) => a.value).map((a) => (
              <span key={a.name} style={{ flexGrow: a.value, background: a.color }} title={`${a.name}: ${nf.format(a.value)} (${pct(a.value, p.total)})`} />
            )) : <span className="psplit-empty" />}
          </div>
        </div>
      ))}
      <ul className="legend inline">
        {ACTION_IDS.map((a) => <li key={a}><i style={{ background: ACTIONS[a].color }} /><span>{ACTIONS[a].label}</span></li>)}
      </ul>
    </div>
  )
}

/* ---------- "ควรรู้": findings and the copyable summary ---------- */

function HighlightsPanel({ items, text, rep, i }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard blocked: nothing else to do */ }
  }
  return (
    <Panel className="span-3" i={i} title="ควรรู้" note="สรุปอัตโนมัติจากช่วงที่เลือก · ป้ายสีเหลือง = ควรดูต่อ"
      actions={(
        <button type="button" className="more" onClick={copy} title="ข้อความสรุปสั้น ๆ สำหรับวางในไลน์หรือบันทึกการประชุม">
          {copied ? <Check size={14} /> : <MessageSquareText size={14} />} {copied ? 'คัดลอกแล้ว' : 'คัดลอกข้อความสรุป'}
        </button>
      )}>
      {items.length ? (
        <ul className="hl-list">
          {items.map((h) => (
            <li key={h.text} className={h.warn ? 'warn' : ''}>
              {h.warn ? <AlertTriangle size={14} /> : <Lightbulb size={14} />}
              <span>{h.text}</span>
              {h.report && <a className="hl-link" href={rep(h.report)}>ดูตาราง</a>}
            </li>
          ))}
        </ul>
      ) : <Empty />}
    </Panel>
  )
}

/* ---------- plates pressed again and again ---------- */

function RepeatPlates({ list }) {
  if (!list.length) return <Empty>ไม่มีรถที่กดตั้งแต่ {REPEAT_MIN} ครั้งในช่วงนี้</Empty>
  return (
    <div className="table-scroll">
      <table className="orders insight">
        <thead><tr><th>หมายเลขรถ</th><th className="num">กด</th><th className="num">วัน</th><th>สาเหตุหลัก</th><th>การดำเนินการ</th><th>กดล่าสุด</th></tr></thead>
        <tbody>
          {list.slice(0, 8).map((p, i) => (
            <tr key={p.plate} style={{ '--i': Math.min(i, 12) }}>
              <td className="mono nowrap">{p.plate}<small>{p.unit}</small></td>
              <td className="num"><b>{nf.format(p.count)}</b></td>
              <td className="num">{nf.format(p.days)}</td>
              <td className="clip" title={p.cause?.name}>{p.cause ? <>{p.cause.name}<small>{nf.format(p.cause.value)} ครั้ง</small></> : '–'}</td>
              <td className="clip wide" title={mixText(p.mix)}>{mixText(p.mix)}</td>
              <td className="nowrap">{dTime(p.last)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---------- table ---------- */

const PAGE = 25

function ActionBadge({ action }) {
  const a = ACTIONS[action]
  return <span className="act" style={{ '--c': a.color }}>{a.label}</span>
}

function HelpTable({ rows }) {
  const [q, setQ] = useState('')
  const [action, setAction] = useState('all')
  const [limit, setLimit] = useState(PAGE)

  const counts = useMemo(() => countBy(rows, 'action'), [rows])
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return rows
      .filter((r) => action === 'all' || r.action === action)
      .filter((r) => !s || [r.provider, r.plate, r.driver, r.alert, r.unit, r.cause, r.detail, r.location]
        .some((v) => v && v.toLowerCase().includes(s)))
      .sort((a, b) => b.start - a.start)
  }, [rows, q, action])

  useEffect(() => setLimit(PAGE), [q, action, rows])

  return (
    <>
      <div className="tools">
        <label className="f search">
          <Search size={15} />
          <input type="search" placeholder="ค้นหา หมายเลขรถ คนขับ หน่วยงาน สาเหตุ สถานที่…"
            value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหารายการ" />
        </label>
        <div className="chips" role="radiogroup" aria-label="การดำเนินการ">
          <button type="button" role="radio" aria-checked={action === 'all'} className={action === 'all' ? 'on' : ''}
            onClick={() => setAction('all')}>ทั้งหมด <em>{nf.format(rows.length)}</em></button>
          {ACTION_IDS.map((id) => {
            const c = counts.find((x) => x.name === id)?.value ?? 0
            return c > 0 && (
              <button key={id} type="button" role="radio" aria-checked={action === id}
                className={action === id ? 'on' : ''} onClick={() => setAction(id)}>
                {ACTIONS[id].label} <em>{nf.format(c)}</em>
              </button>
            )
          })}
        </div>
      </div>

      {filtered.length === 0 ? <Empty>ไม่พบรายการที่ตรงกับการค้นหา</Empty> : (
        <div className="table-scroll">
          <table className="orders alerts help">
            <thead>
              <tr>
                <th>ผู้ให้บริการ</th><th>วันที่ / เวลา</th><th>หมายเลขรถ</th><th>คนขับ</th><th>แจ้งเตือน</th>
                <th>หน่วยงาน</th><th>สาเหตุ</th><th>สถานที่</th><th>การดำเนินการ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, limit).map((r, i) => (
                <tr key={r.id} style={{ '--i': Math.min(i, 12) }}>
                  <td className="nowrap"><span className="pv"><i style={{ background: PROVIDER_COLOR[r.provider] }} />{r.provider}</span></td>
                  <td className="nowrap">{r.hasTime ? dTime(r.start) : dShort(r.start)}</td>
                  <td className="mono nowrap">{r.plate}</td>
                  <td className="nowrap">{r.driver}</td>
                  <td className="clip" title={r.alert}>{r.alert || '–'}</td>
                  <td className="nowrap">{r.unit}</td>
                  <td className="clip wide" title={[r.cause, r.detail].filter(Boolean).join(' – ')}>
                    {r.cause}{r.detail && <small>{r.detail}</small>}
                  </td>
                  <td className="clip" title={r.location}>{r.province !== '(ไม่ระบุ)' ? r.province : r.location || '–'}</td>
                  <td><ActionBadge action={r.action} /></td>
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

export default function HelpDashboard() {
  const [state, setState] = useState({ status: 'loading', records: [], error: null, at: null, missing: [] })
  const [busy, setBusy] = useState(false)
  const [period, setPeriod] = useState(30)
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [provider, setProvider] = useState('all')
  const [hideTests, setHideTests] = useState(false)
  const [rank, setRank] = useState('cause')
  const stage = useRef(null)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const { records, missing } = await loadHelp()
      setState({ status: 'ready', records, missing, error: null, at: new Date() })
    } catch (err) {
      setState((s) => ({ ...s, status: s.records.length ? 'ready' : 'error', error: err.message || String(err) }))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
  }, [load])

  usePointerGlow(stage)

  const testCount = useMemo(() => state.records.filter((r) => r.test).length, [state.records])
  const records = useMemo(
    () => state.records.filter((r) => (provider === 'all' || r.provider === provider) && !(hideTests && r.test)),
    [state.records, provider, hideTests],
  )
  const range = useMemo(() => rangeFor(records, period, custom), [records, period, custom])
  const data = useMemo(() => analyse(records, range), [records, range])
  // All providers: stack the months by provider. One provider: stack by action.
  const split = provider === 'all' ? byProvider : byAction
  const months = useMemo(() => monthly(records, split, range), [records, split, range])
  const animKey = `${provider}:${hideTests}:${range?.from}:${range?.to}:${state.at?.getTime()}`

  const choose = (id) => {
    if (id === 'custom' && period !== 'custom') {
      const r = range ?? rangeFor(records, 30, custom)
      setCustom({ from: toInput(r.from), to: toInput(Math.min(r.to, Date.now()) - 60000) })
    }
    setPeriod(id)
  }

  const pickMonth = (i) => {
    const mo = months[i]
    setCustom({ from: toInput(mo.start), to: toInput(mo.end.getTime() - 60000) })
    setPeriod('custom')
  }

  // Panel title -> its table on the Reports page, with this page's period, provider and test filter.
  const rep = (id, opts) => reportHref(id, period, custom, { provider: provider === 'all' ? '' : provider, tests: hideTests ? 'real' : '', ...opts })
  const scope = [provider !== 'all' && provider, hideTests && 'ไม่รวมกดทดสอบ'].filter(Boolean).join(' · ')

  const badRange = period === 'custom' && !range
  const providerCount = (id) => state.records.filter((r) => (id === 'all' || r.provider === id) && !(hideTests && r.test)).length

  return (
    <div className="stage scroll" ref={stage}>
      <main className="dash">
        <DashTabs current="#/dashboard/help" />
        <header className="dash-head">
          <a href="#/" className="back"><ArrowLeft size={16} /> เมนู</a>
          <div className="dash-title">
            <h1>ปุ่ม<b>ช่วยเหลือ</b></h1>
            <p className="sub">
              Songdee · DTC · PMS จาก Google Sheet
              {state.at && ` · อัปเดต ${hm(state.at)} น.`}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={load} disabled={busy} aria-label="โหลดข้อมูลใหม่" title="โหลดข้อมูลใหม่">
            <RefreshCw size={16} className={busy ? 'spin' : ''} />
          </button>
          <a className="rep-btn" href={rep({ src: 'help' })} title="ดูข้อมูลของกล่องในหน้านี้เป็นตาราง และส่งออก Excel / CSV">
            <Table2 size={15} /> รายงาน
          </a>
          <PeriodPicker period={period} onChoose={choose} />
        </header>

        {state.status === 'ready' && (
          <section className="filter-bar" aria-label="ตัวกรอง">
            <div className="seg-ctl" role="radiogroup" aria-label="ผู้ให้บริการ">
              {['all', ...PROVIDERS.map((p) => p.id)].map((id) => (
                <button key={id} type="button" role="radio" aria-checked={provider === id}
                  className={provider === id ? 'on' : ''} onClick={() => setProvider(id)}>
                  {id !== 'all' && <i className="dot" style={{ background: PROVIDER_COLOR[id] }} />}
                  {id === 'all' ? 'ทุกผู้ให้บริการ' : id}
                  <em>{nf.format(providerCount(id))}</em>
                </button>
              ))}
            </div>
            {testCount > 0 && (
              <label className="inview">
                <input type="checkbox" checked={hideTests} onChange={(e) => setHideTests(e.target.checked)} />
                <FlaskConical size={14} /> ซ่อนการกดทดสอบ ({nf.format(testCount)})
              </label>
            )}
          </section>
        )}

        {period === 'custom' && <RangeBar custom={custom} setCustom={setCustom} range={range} count={data?.rows.length ?? 0} />}

        {state.error && state.status === 'ready' && (
          <p className="banner" role="alert">โหลดข้อมูลล่าสุดไม่สำเร็จ ({state.error}) กำลังแสดงข้อมูลชุดก่อนหน้า</p>
        )}
        {state.missing.length > 0 && (
          <p className="banner" role="alert">ไม่พบชีต: {state.missing.join(', ')} ตรวจชื่อชีตใน Google Sheet</p>
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
              <HighlightsPanel i={4} items={data.highlights} text={data.summary(scope)} rep={rep} />

              <Panel className="span-2" i={4} href={rep('help-daily')} title="จำนวนการกดปุ่มรายวัน"
                note={`${nf.format(data.rows.length)} ครั้ง · ${dShort(data.daily[0].date)} – ${dShort(data.daily.at(-1).date)}`}>
                {data.rows.length ? (
                  <LineChart data={data.daily} animKey={animKey} format={times} integer
                    dateLabel={dShort} tipDate={dDay} ariaLabel="จำนวนการกดปุ่มช่วยเหลือรายวัน" />
                ) : <Empty />}
              </Panel>

              <Panel i={5} href={rep('help-action-cause')} title="การดำเนินการ" note="RSC / Operation / No action · ตารางแยกตามสาเหตุ">
                <Donut data={data.actions} animKey={animKey} unit="ครั้ง" />
              </Panel>

              <Panel className="span-3" i={6} href={rep('help-monthly')} title="สถิติรายเดือน"
                note={`12 เดือนล่าสุด แยกตาม${provider === 'all' ? 'ผู้ให้บริการ' : 'การดำเนินการ'} · คลิกแท่งเพื่อดูเดือนนั้น`}>
                <MonthBars months={months} active={(i) => months[i].active} onPick={pickMonth}
                  format={times} animKey={`${provider}:${hideTests}:${state.at?.getTime()}`} />
                <ul className="legend inline">
                  {months[0].parts.map((p) => (
                    <li key={p.name}><i style={{ background: p.color }} /><span>{p.name}</span></li>
                  ))}
                </ul>
              </Panel>

              <Panel className="span-2" i={7} href={rep('help-rank', { by: rank })} title="อันดับสูงสุด" note="จำนวนการกดปุ่ม (10 อันดับ)"
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

              <Panel i={8} href={rep('help-providers')} title="แยกตามผู้ให้บริการ" note="สัดส่วนการดำเนินการ">
                <ProviderSplit providers={data.providers} />
              </Panel>

              <Panel className="span-3" i={9} title="ช่วงเวลาที่กดปุ่ม" note="รวมทุกวัน แยกตามชั่วโมง (แท่งสว่าง = ช่วงที่เกิดบ่อยสุด)">
                {data.hours.some(Boolean) ? <HourBars key={animKey} counts={data.hours} format={times} /> : <Empty />}
              </Panel>

              <Panel className="span-3" i={10} href={rep('help-week-hour')} title="วันในสัปดาห์ × ช่วงเวลา" note="สีเข้ม = กดบ่อย ใช้ดูว่าควรมีคนเฝ้าช่วงไหน">
                {data.heat.some((d) => d.total)
                  ? <HourHeat key={animKey} rows={data.heat} format={times} ariaLabel="จำนวนการกดปุ่มแยกตามวันในสัปดาห์และชั่วโมง" />
                  : <Empty />}
              </Panel>

              <Panel className="span-3" i={11} href={rep('help-repeat-plates')} title="รถที่กดซ้ำ"
                note={`กดตั้งแต่ ${REPEAT_MIN} ครั้งในช่วงที่เลือก · 8 คันแรก (ตารางเต็มในรายงาน)`}>
                <RepeatPlates list={data.repeats} />
              </Panel>

              <Panel className="span-3" i={12} href={rep('help-cases')} title="รายการกดปุ่มช่วยเหลือ" note="เรียงจากล่าสุด">
                <HelpTable rows={data.rows} />
              </Panel>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
