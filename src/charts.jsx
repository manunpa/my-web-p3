import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/* Reusable chart pieces for the dashboard: hand-drawn SVG, no chart library. */

export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches
export const nf = new Intl.NumberFormat('th-TH')
export const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export function niceScale(max, count = 4, integer = false) {
  const m = Math.max(max, integer ? count : 1e-9)
  const raw = m / count
  const pow = 10 ** Math.floor(Math.log10(raw))
  const steps = integer && pow <= 1 ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10]
  let step = steps.map((s) => s * pow).find((s) => s >= raw)
  if (integer) step = Math.max(1, Math.round(step))
  const top = Math.ceil(m / step) * step
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) }
}

export function useWidth() {
  const ref = useRef(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    setW(ref.current.getBoundingClientRect().width) // measure now; don't wait for the first observer callback
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

// Animates a number from its previous value to `target`.
export function useCountUp(target, ms = 1000) {
  const [v, setV] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    if (reduceMotion()) { setV(target); from.current = target; return }
    const start = performance.now()
    const a = from.current
    let raf
    const step = (t) => {
      const p = Math.min(1, Math.max(0, (t - start) / ms))
      const cur = a + (target - a) * (1 - (1 - p) ** 3)
      setV(cur)
      from.current = cur
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}

// 0 -> 1 over `ms`, restarted whenever `key` changes.
export function useProgress(key, ms = 1100) {
  const [p, setP] = useState(0)
  useEffect(() => {
    if (reduceMotion()) { setP(1); return }
    setP(0)
    const start = performance.now()
    let raf
    const step = (t) => {
      const x = Math.min(1, Math.max(0, (t - start) / ms))
      setP(1 - (1 - x) ** 3)
      if (x < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [key, ms])
  return p
}

// Gold border glow that follows the pointer inside a panel.
const glow = (e) => {
  const r = e.currentTarget.getBoundingClientRect()
  e.currentTarget.style.setProperty('--cx', e.clientX - r.left + 'px')
  e.currentTarget.style.setProperty('--cy', e.clientY - r.top + 'px')
}

export function Panel({ className = '', i = 0, title, note, actions, children }) {
  return (
    <section className={`panel ${className}`} style={{ '--i': i }} onPointerMove={glow}>
      {(title || note || actions) && (
        <div className="panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {note && <span className="muted">{note}</span>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

export function Empty({ children = 'ไม่มีข้อมูลในช่วงเวลานี้' }) {
  return <p className="empty">{children}</p>
}

/* ---------- KPI tile ---------- */

function Sparkline({ values }) {
  const [ref, measured] = useWidth()
  const w = measured || 200, h = 40
  const max = Math.max(...values), min = Math.min(...values)
  const pts = values.map((v, i) => [
    values.length === 1 ? w / 2 : (i / (values.length - 1)) * w,
    h - 3 - ((v - min) / (max - min || 1)) * (h - 6),
  ])
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('')
  return (
    <svg className="spark" ref={ref} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={`${d}L${w},${h}L0,${h}Z`} className="spark-area" />
      <path d={d} className="spark-line" pathLength="1" />
    </svg>
  )
}

// delta: percent change vs previous period (null = hide). upIsGood decides the color.
export function Kpi({ label, icon: Icon, value, format, delta = null, upIsGood = true, sub, spark, animKey, i }) {
  const v = useCountUp(value)
  const up = delta >= 0
  const good = up === upIsGood
  return (
    <Panel className="kpi" i={i}>
      <div className="kpi-head">
        <span className="ic"><Icon size={16} /></span>
        <span>{label}</span>
      </div>
      <div className="kpi-value">{format(v)}</div>
      <div className="kpi-sub">
        {delta !== null && (
          <span className={`delta ${good ? 'good' : 'bad'}`}>
            {up ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
          </span>
        )}
        <span className="vs">{sub}</span>
      </div>
      {spark?.length > 1 && <Sparkline key={animKey} values={spark} />}
    </Panel>
  )
}

/* ---------- line chart with crosshair + tooltip ---------- */

export function LineChart({ data, animKey, format, tickFormat = (v) => compact.format(v), dateLabel, tipDate, ariaLabel, integer }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)
  const h = w > 600 ? 300 : 240
  const m = { t: 16, r: 12, b: 30, l: 44 }
  const iw = Math.max(0, w - m.l - m.r)
  const ih = h - m.t - m.b
  const n = data.length
  const { top, ticks } = niceScale(Math.max(0, ...data.map((d) => d.value)) * 1.08, 4, integer)
  const x = (i) => m.l + (n <= 1 ? iw / 2 : (i * iw) / (n - 1))
  const y = (v) => m.t + ih - (v / top) * ih
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join('')
  const area = `${line}L${x(n - 1)},${m.t + ih}L${x(0)},${m.t + ih}Z`
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 76))))

  const move = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.round(((e.clientX - r.left - m.l) / iw) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }

  return (
    <div className="chart" ref={ref}>
      {w > 0 && n > 0 && (
        <svg width={w} height={h} role="img" aria-label={ariaLabel}
          onPointerMove={move} onPointerLeave={() => setHover(null)}>
          <defs>
            <linearGradient id="line-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#facc15" stopOpacity=".35" />
              <stop offset="100%" stopColor="#facc15" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'grid'} />
              <text x={m.l - 10} y={y(t)} dy="0.32em" textAnchor="end" className="tick">{tickFormat(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const last = i === n - 1
            if (!(last || (i % every === 0 && n - 1 - i >= every / 2))) return null
            return (
              <text key={i} x={x(i)} y={h - 8} className="tick"
                textAnchor={last && n > 1 ? 'end' : i === 0 && n > 1 ? 'start' : 'middle'}>
                {dateLabel(d.date)}
              </text>
            )
          })}
          <g key={animKey}>
            <path d={area} fill="url(#line-fill)" className="area-in" />
            <path d={line} className="rev-line" pathLength="1" />
          </g>
          {hover !== null && (
            <g className="cross">
              <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ih} />
              <circle cx={x(hover)} cy={y(data[hover].value)} r="5" />
            </g>
          )}
          <rect x={m.l} y={m.t} width={iw} height={ih} fill="transparent" />
        </svg>
      )}
      {hover !== null && (
        <div className="tip" style={{ left: Math.max(70, Math.min(w - 70, x(hover))), top: y(data[hover].value) }}>
          <span>{tipDate(data[hover].date)}</span>
          <strong>{format(data[hover].value)}</strong>
        </div>
      )}
      <table className="sr">
        <caption>{ariaLabel}</caption>
        <tbody>{data.map((d) => <tr key={+d.date}><td>{tipDate(d.date)}</td><td>{format(d.value)}</td></tr>)}</tbody>
      </table>
    </div>
  )
}

/* ---------- donut + legend ---------- */

export function Donut({ data, animKey, unit = '' }) {
  const p = useProgress(animKey)
  const [hover, setHover] = useState(null)
  const total = data.reduce((s, d) => s + d.value, 0)
  if (!total) return <Empty />
  const R = 70, SW = 22, C = 2 * Math.PI * R, GAP = data.filter((d) => d.value).length > 1 ? 3 : 0
  let acc = 0
  const segs = data.map((d) => {
    const len = (d.value / total) * C
    const seg = { ...d, start: acc, len }
    acc += len
    return seg
  })
  const shown = hover !== null ? segs[hover] : null
  const pct = (v) => (v / total) * 100

  return (
    <div className="donut-wrap">
      <div className="donut">
        <svg viewBox="0 0 180 180" role="img" aria-label={data.map((d) => `${d.name} ${d.value}`).join(', ')}>
          <g transform="rotate(-90 90 90)">
            <circle cx="90" cy="90" r={R} className="donut-track" strokeWidth={SW} fill="none" />
            {segs.map((s, i) => (
              <circle key={s.name} cx="90" cy="90" r={R} fill="none"
                stroke={s.color} strokeWidth={hover === i ? SW + 6 : SW}
                strokeDasharray={`${Math.max(0, s.len * p - GAP)} ${C}`}
                strokeDashoffset={-s.start * p}
                className="seg"
                style={{ opacity: hover === null || hover === i ? 1 : 0.35 }}
                onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />
            ))}
          </g>
        </svg>
        <div className="donut-center">
          <strong>{shown ? pct(shown.value).toFixed(pct(shown.value) < 10 ? 1 : 0) + '%' : nf.format(total)}</strong>
          <span>{shown ? `${nf.format(shown.value)} ${unit}` : unit}</span>
        </div>
      </div>
      <ul className="legend">
        {segs.map((s, i) => (
          <li key={s.name} className={hover === i ? 'on' : ''} title={s.name}
            onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
            <i style={{ background: s.color }} />
            <span>{s.name}</span>
            <em>{nf.format(s.value)}</em>
            <b>{pct(s.value).toFixed(pct(s.value) < 10 ? 1 : 0)}%</b>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------- ranked horizontal bars ---------- */

export function RankBars({ data, format, total }) {
  const [tip, setTip] = useState(null)
  if (!data.length) return <Empty />
  const max = data[0].value || 1
  const sum = total ?? data.reduce((s, d) => s + d.value, 0)

  const show = (e, d) => {
    const box = e.currentTarget.closest('.bars').getBoundingClientRect()
    setTip({ d, x: e.clientX - box.left, y: e.clientY - box.top })
  }

  return (
    <div className="bars" onPointerLeave={() => setTip(null)}>
      {data.map((d, i) => (
        <div key={d.name} className="bar-row" style={{ '--i': i }} onPointerMove={(e) => show(e, d)}>
          <span className="bar-name" title={d.name}>{d.name}</span>
          <span className="bar-track">
            <span className="bar" style={{ width: `${(d.value / max) * 100}%` }} />
          </span>
          <span className="bar-val">{nf.format(d.value)}</span>
        </div>
      ))}
      {tip && (
        <div className="tip" style={{ left: tip.x, top: tip.y - 8 }}>
          <span>{tip.d.name}</span>
          <strong>{format(tip.d.value)}</strong>
          <span>{((tip.d.value / sum) * 100).toFixed(1)}% ของทั้งหมด</span>
        </div>
      )}
    </div>
  )
}

/* ---------- vertical bars by hour of day ---------- */

export function HourBars({ counts, format }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)
  const h = 220
  const m = { t: 12, r: 4, b: 26, l: 36 }
  const iw = Math.max(0, w - m.l - m.r)
  const ih = h - m.t - m.b
  const { top, ticks } = niceScale(Math.max(0, ...counts) * 1.08, 4, true)
  const slot = iw / 24
  const bw = Math.max(2, slot - 2) // 2px gap between bars
  const y = (v) => m.t + ih - (v / top) * ih
  const peak = counts.indexOf(Math.max(...counts))
  const hh = (i) => String(i).padStart(2, '0')

  return (
    <div className="chart" ref={ref} onPointerLeave={() => setHover(null)}>
      {w > 0 && (
        <svg width={w} height={h} role="img" aria-label="จำนวนแจ้งเตือนแยกตามช่วงเวลาของวัน">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'grid'} />
              <text x={m.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tick">{compact.format(t)}</text>
            </g>
          ))}
          {counts.map((c, i) => {
            const x = m.l + i * slot + (slot - bw) / 2
            const bh = Math.max(0, m.t + ih - y(c))
            return (
              <g key={i} onPointerEnter={() => setHover(i)}>
                <rect x={m.l + i * slot} y={m.t} width={slot} height={ih} fill="transparent" />
                <path className={`hbar${i === peak ? ' peak' : ''}${hover === i ? ' on' : ''}`} style={{ '--i': i }}
                  d={bh > 0 ? roundTop(x, m.t + ih, bw, bh, Math.min(4, bw / 2)) : ''} />
                {i % (w < 500 ? 6 : 3) === 0 && (
                  <text x={x + bw / 2} y={h - 8} textAnchor="middle" className="tick">{hh(i)}</text>
                )}
              </g>
            )
          })}
        </svg>
      )}
      {hover !== null && (
        <div className="tip" style={{ left: Math.max(70, Math.min(w - 70, m.l + (hover + 0.5) * slot)), top: y(counts[hover]) }}>
          <span>{hh(hover)}:00–{hh(hover)}:59 น.</span>
          <strong>{format(counts[hover])}</strong>
        </div>
      )}
    </div>
  )
}

// Bar anchored to the baseline with rounded top corners only.
function roundTop(x, base, w, h, r) {
  const rr = Math.min(r, h)
  return `M${x},${base}V${base - h + rr}Q${x},${base - h} ${x + rr},${base - h}H${x + w - rr}Q${x + w},${base - h} ${x + w},${base - h + rr}V${base}Z`
}

/* ---------- monthly stacked bars ---------- */

// months: [{ label, total, parts: [{ name, value, color }] }]
// active(i): month overlaps the selected range (drawn full strength). onPick(i): click a month.
export function MonthBars({ months, active, onPick, format, animKey }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)
  const h = w > 600 ? 300 : 240
  const m = { t: 22, r: 8, b: 30, l: 40 }
  const iw = Math.max(0, w - m.l - m.r)
  const ih = h - m.t - m.b
  const { top, ticks } = niceScale(Math.max(0, ...months.map((d) => d.total)) * 1.08, 4, true)
  const slot = iw / Math.max(1, months.length)
  const bw = Math.min(56, Math.max(6, slot * 0.62))
  const y = (v) => m.t + ih - (v / top) * ih
  const GAP = 2 // surface gap between stacked segments

  return (
    <div className="chart" ref={ref} onPointerLeave={() => setHover(null)}>
      {w > 0 && (
        <svg width={w} height={h} role="img" aria-label="จำนวนแจ้งเตือนรายเดือน แยกตามประเภท">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'grid'} />
              <text x={m.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tick">{compact.format(t)}</text>
            </g>
          ))}
          <g key={animKey}>
            {months.map((mo, i) => {
              const x = m.l + i * slot + (slot - bw) / 2
              const parts = mo.parts.filter((p) => p.value > 0)
              let base = m.t + ih
              return (
                <g key={mo.label} className={`mbar${active(i) ? '' : ' dim'}${hover === i ? ' on' : ''}`}
                  style={{ '--i': i }} onPointerEnter={() => setHover(i)}
                  onClick={() => mo.total && onPick?.(i)}>
                  <rect x={m.l + i * slot} y={m.t} width={slot} height={ih} fill="transparent" />
                  <g className="mbar-stack">
                    {parts.map((p, j) => {
                      const hh = (p.value / top) * ih
                      const last = j === parts.length - 1
                      const segH = Math.max(0, hh - (last ? 0 : GAP))
                      const yTop = base - hh
                      base = yTop
                      return last
                        ? <path key={p.name} d={roundTop(x, yTop + hh, bw, segH, 4)} fill={p.color} />
                        : <rect key={p.name} x={x} y={yTop + GAP} width={bw} height={segH} fill={p.color} />
                    })}
                  </g>
                  {mo.total > 0 && (
                    <text x={x + bw / 2} y={y(mo.total) - 6} textAnchor="middle" className="mbar-total">
                      {compact.format(mo.total)}
                    </text>
                  )}
                  <text x={x + bw / 2} y={h - 8} textAnchor="middle" className="tick">{mo.label}</text>
                </g>
              )
            })}
          </g>
        </svg>
      )}
      {hover !== null && months[hover] && (
        <div className="tip tip-list" style={{ left: Math.max(90, Math.min(w - 90, m.l + (hover + 0.5) * slot)), top: y(months[hover].total) }}>
          <span>{months[hover].full}</span>
          <strong>{format(months[hover].total)}</strong>
          {months[hover].parts.filter((p) => p.value).map((p) => (
            <span key={p.name} className="tip-row"><i style={{ background: p.color }} />{p.name}<b>{nf.format(p.value)}</b></span>
          ))}
          {months[hover].total > 0 && <span className="tip-hint">คลิกเพื่อดูเดือนนี้</span>}
        </div>
      )}
      <table className="sr">
        <caption>จำนวนแจ้งเตือนรายเดือน</caption>
        <tbody>{months.map((mo) => <tr key={mo.label}><td>{mo.full}</td><td>{format(mo.total)}</td></tr>)}</tbody>
      </table>
    </div>
  )
}
