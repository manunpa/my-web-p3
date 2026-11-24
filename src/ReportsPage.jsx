import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, FileSpreadsheet, FileText, Copy, Printer, RefreshCw, AlertTriangle, Check, LayoutDashboard } from 'lucide-react'
import { Empty } from './charts'
import { PeriodPicker, RangeBar, rangeFor, toInput, usePointerGlow } from './dashShared'
import ReportTable from './ReportTable'
import { downloadXlsx, downloadCSV, toTSV } from './reportExport'
import { LEO_REPORTS, LEO_SOURCE } from './reports/leoReports'

// Report catalog, grouped by the dashboard the reports come from. Add a source here to add a group.
const SOURCES = [{ ...LEO_SOURCE, reports: LEO_REPORTS }]
const ALL = SOURCES.flatMap((s) => s.reports.map((r) => ({ ...r, source: s })))
const byId = (id) => ALL.find((r) => r.id === id)

// "#/reports?r=leo-hotspots&p=30&o.level=area" <-> state, so a report can be linked and shared.
function readHash() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '')
  const p = q.get('p')
  const opts = {}
  for (const [k, v] of q) if (k.startsWith('o.')) opts[k.slice(2)] = v
  return {
    id: byId(q.get('r')) ? q.get('r') : '',
    src: q.get('src') || '',
    period: p === 'custom' ? 'custom' : p !== null && !isNaN(+p) ? +p : 30,
    custom: { from: q.get('from') || '', to: q.get('to') || '' },
    opts,
  }
}
function writeHash({ id, src, period, custom, opts }) {
  const q = new URLSearchParams()
  if (id) q.set('r', id)
  else if (src) q.set('src', src)
  q.set('p', period)
  if (period === 'custom') { if (custom.from) q.set('from', custom.from); if (custom.to) q.set('to', custom.to) }
  for (const [k, v] of Object.entries(opts)) if (v) q.set(`o.${k}`, v)
  history.replaceState(null, '', `#/reports?${q}`)
}

// Data is loaded once per visit and source; the reload button asks again.
const cache = new Map()
function useSource(source) {
  const [state, setState] = useState({ status: 'idle', records: [], error: null, at: null })
  const load = (force) => {
    if (!source) return
    if (!cache.has(source.id) || force) cache.set(source.id, source.load())
    setState((s) => ({ ...s, status: 'loading', error: null }))
    cache.get(source.id)
      .then((records) => setState({ status: 'ready', records, error: null, at: new Date() }))
      .catch((e) => { cache.delete(source.id); setState((s) => ({ ...s, status: 'error', error: e.message || String(e) })) })
  }
  useEffect(() => { load(false) }, [source?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return [state, () => load(true)]
}

const fmtDay = (t) => new Date(t).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
const ymd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export default function ReportsPage() {
  const init = useMemo(readHash, [])
  const [id, setId] = useState(init.id)
  const [src, setSrc] = useState(init.src || (init.id ? byId(init.id).source.id : ''))
  const [period, setPeriod] = useState(init.period)
  const [custom, setCustom] = useState(init.custom)
  const [opts, setOpts] = useState(init.opts)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const stage = useRef(null)
  usePointerGlow(stage)

  const def = id ? byId(id) : null
  const source = def?.source || SOURCES.find((s) => s.id === src) || null
  const [data, reload] = useSource(source)

  useEffect(() => writeHash({ id, src, period, custom, opts }), [id, src, period, custom, opts])
  // Links from a dashboard change only the part after "?": follow them while this page is open.
  useEffect(() => {
    const on = () => {
      const h = readHash()
      setId(h.id); setSrc(h.src || (h.id ? byId(h.id).source.id : '')); setPeriod(h.period); setCustom(h.custom); setOpts(h.opts)
    }
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])

  const range = useMemo(() => (data.status === 'ready' ? rangeFor(data.records, period, custom) : null), [data, period, custom])
  const result = useMemo(() => {
    if (!def || !range) return null
    const rows = data.records.filter((r) => r.start >= range.from && r.start < range.to)
    const len = range.to - range.from
    const prev = range.kind === 'all' ? null : data.records.filter((r) => r.start >= range.from - len && r.start < range.from)
    const opt = Object.fromEntries((def.options || []).map((o) => [o.id, opts[o.id] ?? o.choices[0][0]]))
    return { ...def.build({ rows, prev, all: data.records, range, opt }), count: rows.length, opt }
  }, [def, range, data, opts])

  const choosePeriod = (p) => {
    if (p === 'custom' && period !== 'custom' && range) {
      setCustom({ from: toInput(range.from), to: toInput(Math.min(range.to, Date.now()) - 60000) })
    }
    setPeriod(p)
  }
  const pick = (rid) => { setId(rid); setOpts({}) }

  const periodText = range ? `ช่วง ${fmtDay(range.from)} – ${fmtDay(range.to - 1)}` : ''
  const filterText = def && result ? (def.options || []).map((o) => {
    const c = o.choices.find((x) => x[0] === result.opt[o.id])
    return `${o.label}: ${c ? c[1] : ''}`
  }).join(' · ') : ''
  const generated = new Date().toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
  const fileBase = def && range ? `${def.title} ${ymd(range.from)} ถึง ${ymd(range.to - 1)}` : 'รายงาน'

  // Records behind the table, once each, for the Excel detail sheet.
  const detailRows = () => {
    if (!result) return []
    if (def.detailOnly) return []
    const seen = new Set()
    const out = []
    for (const r of result.rows) for (const x of r._detail || []) if (!seen.has(x.id)) { seen.add(x.id); out.push(x) }
    return out.sort((a, b) => b.start - a.start)
  }

  const exportXlsx = async () => {
    setBusy(true)
    try {
      await downloadXlsx({
        meta: { title: def.title, period: periodText, filters: filterText, generated, notes: [...(result.notes || []), ...(result.footnote ? [result.footnote] : [])], fileBase },
        cols: result.cols, rows: result.rows, total: result.total,
        detail: def.detailOnly ? null : { cols: source.detailCols, rows: detailRows() },
      })
    } finally { setBusy(false) }
  }
  const exportCsv = () => downloadCSV({ title: def.title, period: [periodText, filterText].filter(Boolean).join(' · '), cols: result.cols, rows: result.rows, total: result.total, fileBase })
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toTSV(result.cols, result.rows, result.total))
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard blocked: nothing else to do */ }
  }

  return (
    <div className="stage scroll" ref={stage}>
      <main className="dash reports">
        <header className="dash-head">
          <a href="#/" className="back"><ArrowLeft size={16} /> เมนู</a>
          <div className="dash-title">
            <h1>Report <b>Center</b></h1>
            <p className="sub">ตารางจากกล่องวิเคราะห์ในแดชบอร์ด · เลือกรายงานและช่วงวันที่ แล้วดูหรือส่งออก</p>
          </div>
          {source && (
            <button type="button" className="icon-btn" onClick={reload} disabled={data.status === 'loading'} aria-label="โหลดข้อมูลใหม่" title="โหลดข้อมูลใหม่">
              <RefreshCw size={16} className={data.status === 'loading' ? 'spin' : ''} />
            </button>
          )}
        </header>

        <section className="panel rep-controls" style={{ '--i': 0 }}>
          <label className="rep-field">
            <span>รายงาน</span>
            <select value={id} onChange={(e) => pick(e.target.value)}>
              <option value="">— เลือกรายงาน —</option>
              {SOURCES.map((s) => (
                <optgroup key={s.id} label={s.label}>
                  {s.reports.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="rep-field">
            <span>ช่วงวันที่</span>
            <PeriodPicker period={period} onChoose={choosePeriod} />
          </div>
          {def?.options?.map((o) => (
            <div className="rep-field" key={o.id}>
              <span>{o.label}</span>
              {o.choices.length > 5 ? (
                <select value={result?.opt[o.id] ?? ''} onChange={(e) => setOpts((x) => ({ ...x, [o.id]: e.target.value }))}>
                  {o.choices.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              ) : (
                <div className="seg-ctl small" role="radiogroup" aria-label={o.label}>
                  {o.choices.map(([v, l]) => (
                    <button key={v} type="button" role="radio" aria-checked={result?.opt[o.id] === v}
                      className={result?.opt[o.id] === v ? 'on' : ''} onClick={() => setOpts((x) => ({ ...x, [o.id]: v }))}>{l}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>

        {period === 'custom' && <RangeBar custom={custom} setCustom={setCustom} range={range} count={result?.count ?? 0} />}

        {!def && (
          <div className="rep-catalog">
            {SOURCES.map((s) => (
              <section key={s.id} className="panel" style={{ '--i': 1 }}>
                <div className="panel-head">
                  <div><h2>{s.label}</h2><span className="muted">{s.reports.length} รายงาน · ชื่อเดียวกับกล่องในแดชบอร์ด</span></div>
                  <a className="more" href={s.dashboard}><LayoutDashboard size={14} /> ไปแดชบอร์ด</a>
                </div>
                <div className="rep-cards">
                  {s.reports.map((r) => (
                    <button key={r.id} type="button" className="rep-card" onClick={() => pick(r.id)}>
                      <strong>{r.title}</strong>
                      <span>{r.desc}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {def && data.status === 'loading' && <section className="panel state-card"><RefreshCw size={22} className="spin" /> กำลังโหลดข้อมูล {source.label}…</section>}
        {def && data.status === 'error' && (
          <section className="panel state-card">
            <AlertTriangle size={22} />
            <div><strong>โหลดข้อมูลไม่สำเร็จ</strong><p className="muted">{data.error}</p></div>
            <button type="button" className="more" onClick={reload}>ลองใหม่</button>
          </section>
        )}
        {def && data.status === 'ready' && !range && <section className="panel state-card"><Empty>เลือกวันและเวลาให้ครบทั้งสองช่อง</Empty></section>}

        {def && result && (
          <section className="panel rep-sheet" style={{ '--i': 1 }}>
            <div className="rep-head">
              <div>
                <p className="rep-src">{source.label}</p>
                <h2>{def.title}</h2>
                <p className="muted">{periodText} · {result.count.toLocaleString('th-TH')} แจ้งเตือนในช่วงนี้{filterText && ` · ${filterText}`}</p>
                <p className="muted rep-gen">ออกรายงาน {generated}{data.at && ` · ข้อมูล ณ ${data.at.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`}</p>
              </div>
              <div className="rep-actions">
                <button type="button" className="more" onClick={exportXlsx} disabled={busy || !result.rows.length}><FileSpreadsheet size={14} /> Excel</button>
                <button type="button" className="more" onClick={exportCsv} disabled={!result.rows.length}><FileText size={14} /> CSV</button>
                <button type="button" className="more" onClick={copy} disabled={!result.rows.length}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}</button>
                <button type="button" className="more" onClick={() => print()}><Printer size={14} /> พิมพ์</button>
              </div>
            </div>
            {result.notes?.length > 0 && (
              <ul className="rep-notes">{result.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            )}
            {result.rows.length
              ? <ReportTable cols={result.cols} rows={result.rows} total={result.total} detailCols={source.detailCols} />
              : <Empty />}
            {result.footnote && <p className="muted share-note">{result.footnote}</p>}
            {!def.detailOnly && <p className="muted share-note rep-hint">ไฟล์ Excel มี 2 แผ่น: "รายงาน" ตามตารางนี้ และ "รายละเอียด" รายการเคสที่อยู่เบื้องหลังตัวเลข</p>}
          </section>
        )}
      </main>
    </div>
  )
}
