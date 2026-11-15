/* Helpers and header pieces shared by the dashboards (fleet alerts, help button). */
import { useEffect } from 'react'
import { Bell, CalendarRange, Eye, LifeBuoy } from 'lucide-react'
import { nf, reduceMotion } from './charts'

export const DAY = 86400000

// The dashboards, shown as tabs at the top of each one. Add new dashboards here and in App.jsx ROUTES.
export const DASHBOARDS = [
  { href: '#/dashboard', label: 'แจ้งเตือนรถขนส่ง', icon: Bell },
  { href: '#/dashboard/help', label: 'ปุ่มช่วยเหลือ', icon: LifeBuoy },
  { href: '#/dashboard/adas', label: 'ADAS / DMS', icon: Eye },
]

export const PERIODS = [
  { id: 7, label: '7 วัน' },
  { id: 30, label: '30 วัน' },
  { id: 90, label: '90 วัน' },
  { id: 0, label: 'ทั้งหมด' },
  { id: 'custom', label: 'กำหนดเอง' },
]

export const times = (v) => `${nf.format(Math.round(v))} ครั้ง`
export const dShort = (d) => d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
export const dDay = (d) => d.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' })
export const dTime = (d) => (d ? d.toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–')
export const hm = (d) => d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })

export const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d }
export const pctChange = (now, before) => (before ? ((now - before) / before) * 100 : null)

export function countBy(rows, key) {
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
export const toInput = (t) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromInput = (s) => {
  const d = s ? new Date(s) : null
  return d && !isNaN(d) ? d.getTime() : null
}

// Returns { from, to } in ms, `to` exclusive. Records need a `start` Date.
export function rangeFor(records, period, custom) {
  const end = startOfDay(Date.now()).getTime() + DAY
  if (period === 'custom') {
    const a = fromInput(custom.from), b = fromInput(custom.to)
    if (a === null || b === null) return null
    const [from, to] = a <= b ? [a, b] : [b, a]
    return { from, to: to + 60000, kind: 'custom' } // include the whole "to" minute
  }
  if (period) return { from: end - period * DAY, to: end, kind: 'preset' }
  if (!records.length) return null
  // reduce, not Math.min(...): spreading tens of thousands of records can overflow the call stack.
  const first = records.reduce((m, r) => Math.min(m, r.start), Infinity)
  return { from: startOfDay(first).getTime(), to: end, kind: 'all' }
}

// Last 12 calendar months. split(rows) -> [{ name, value, color }] for the stacked bars.
export function monthly(records, split, range) {
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
      parts: split(rows),
      active: !range || (start.getTime() < range.to && end.getTime() > range.from),
    })
  }
  return months
}

/* ---------- header pieces ---------- */

export function DashTabs({ current }) {
  return (
    <nav className="dash-tabs" aria-label="เลือกแดชบอร์ด">
      {DASHBOARDS.map(({ href, label, icon: Icon }) => (
        <a key={href} href={href} className={href === current ? 'on' : ''} aria-current={href === current ? 'page' : undefined}>
          <Icon size={15} /> {label}
        </a>
      ))}
    </nav>
  )
}

export function PeriodPicker({ period, onChoose }) {
  return (
    <div className="seg-ctl" role="radiogroup" aria-label="ช่วงเวลา">
      {PERIODS.map((p) => (
        <button key={p.id} type="button" role="radio" aria-checked={period === p.id}
          className={period === p.id ? 'on' : ''} onClick={() => onChoose(p.id)}>
          {p.id === 'custom' && <CalendarRange size={13} />}{p.label}
        </button>
      ))}
    </div>
  )
}

export function RangeBar({ custom, setCustom, range, count }) {
  return (
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
        {!range
          ? 'กรุณาเลือกวันและเวลาให้ครบทั้งสองช่อง'
          : `${dTime(new Date(range.from))} – ${dTime(new Date(range.to - 60000))} · ${nf.format(count)} รายการ`}
      </p>
    </section>
  )
}

// Background glow follows the pointer, like the other pages.
export function usePointerGlow(ref) {
  useEffect(() => {
    if (reduceMotion()) return
    const move = (e) => {
      ref.current?.style.setProperty('--mx', e.clientX + 'px')
      ref.current?.style.setProperty('--my', e.clientY + 'px')
    }
    addEventListener('pointermove', move)
    return () => removeEventListener('pointermove', move)
  }, [ref])
}
