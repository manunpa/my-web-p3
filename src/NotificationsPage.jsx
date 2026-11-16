import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowLeft, Bell, BellRing, CheckCheck, ChevronDown, Cigarette, Eye, EyeOff, ExternalLink,
  Filter, Gauge, MapPin, RefreshCw, Route, Satellite, ScanEye, Search, Siren, Smartphone, StickyNote, User, Users, Video, X,
} from 'lucide-react'
import {
  loadNotifs, watchActions, saveAction, saveActions, sendToSheet, SOURCES, STATUSES, NOTIF_REFRESH_MS,
} from './notifData'
import { Panel, Kpi, Empty, nf } from './charts'
import { DAY, dDay, dTime, hm, startOfDay, usePointerGlow } from './dashShared'

const PAGE = 30
const count = (v) => nf.format(Math.round(v))

// Buttons that set how an alert was handled. Pressing the active one again puts it back to "ใหม่".
const HANDLE = [
  { id: 'ack', label: 'รับทราบ', icon: Eye },
  { id: 'done', label: 'ดำเนินการแล้ว', icon: CheckCheck },
  { id: 'false', label: 'แจ้งเตือนผิดพลาด', icon: X },
]

function typeIcon(n) {
  const t = `${n.type} ${n.sub}`
  if (/emergency|ฉุกเฉิน|sos/i.test(t)) return Siren
  if (/route|เส้นทาง/i.test(t)) return Route
  if (/eye|ปิดตา|หลับ|yawn|หาว|ง่วง|fatigue/i.test(t)) return EyeOff
  if (/phone|โทรศัพท์/i.test(t)) return Smartphone
  if (/smok|บุหรี่/i.test(t)) return Cigarette
  if (/distract|ไม่ตั้งใจ|มอง/i.test(t)) return ScanEye
  return AlertTriangle
}

function ago(d, now) {
  const m = Math.floor((now - d) / 60000)
  if (m < 1) return 'เมื่อสักครู่'
  if (m < 60) return `${m} นาทีที่แล้ว`
  if (m < 24 * 60) return `${Math.floor(m / 60)} ชม.ที่แล้ว`
  return dTime(d)
}

function dayLabel(d, now) {
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / DAY)
  return diff === 0 ? 'วันนี้' : diff === 1 ? 'เมื่อวาน' : dDay(d)
}

// Last alert time seen, per feed. PMS keeps the original key so its "ใหม่" tags carry on.
const seenKey = (id) => (id === 'pms' ? 'notif:lastSeen' : `notif:lastSeen:${id}`)
const store = {
  get: (id) => { try { return Number(localStorage.getItem(seenKey(id))) || null } catch { return null } },
  set: (id, v) => { try { localStorage.setItem(seenKey(id), String(v)) } catch { /* private mode */ } },
}

const dbError = (err) => (err?.code === 'permission-denied'
  ? 'ฐานข้อมูลยังไม่อนุญาตให้บันทึกสถานะ: คัดลอก firestore.rules ไปวางใน Firebase Console → Firestore → Rules แล้วกด Publish'
  : `บันทึกหรือโหลดสถานะไม่สำเร็จ (${err?.message || err})`)

const sheetError = (err) => `บันทึกในเว็บแล้ว แต่ส่งเข้า Google Sheet ไม่สำเร็จ (${err?.message || err})`

/* ---------- one notification ---------- */

function NotifItem({ src, n, a, i, isNew, now, user, onError }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const status = a?.status && STATUSES[a.status] ? a.status : 'new'
  const note = a?.note || ''
  const Icon = typeIcon(n)
  const s = STATUSES[status]

  const save = async (nextStatus, nextNote) => {
    setSaving(true)
    try {
      await saveAction(n, user, nextStatus, nextNote)
      // The sheet copy runs in the background; the page already shows the new status from Firestore.
      sendToSheet(src, [n], user, nextStatus, () => nextNote).catch((err) => onError(sheetError(err)))
      return true
    } catch (err) {
      onError(dbError(err))
      return false
    } finally {
      setSaving(false)
    }
  }

  const setStatus = (id) => save(status === id ? 'new' : id, note)
  const startNote = () => { setDraft(note); setEditing(true) }
  const saveNote = async (e) => {
    e.preventDefault()
    if (await save(status, draft.trim())) setEditing(false)
  }

  return (
    <li className={`notif s-${status}${isNew ? ' fresh' : ''}`} style={{ '--c': s.color, '--i': Math.min(i, 12) }}>
      <span className="notif-ic"><Icon size={18} /></span>
      <div className="notif-body">
        <div className="notif-top">
          <div className="notif-title">
            <strong>{n.type}</strong>
            {n.sub && <small>{n.sub}</small>}
            {isNew && <span className="new-tag">ใหม่</span>}
          </div>
          <span className="act">{s.label}</span>
        </div>

        <p className="notif-meta">
          <span className="mono">{n.device}</span>
          {n.deviceNo && <span>หมายเลข {n.deviceNo}</span>}
          {n.group && <span><Users size={12} /> {n.group}</span>}
          {n.driver && <span><User size={12} /> พขร. {n.driver}</span>}
          <span title={dTime(n.at)}>{ago(n.at, now)} · {hm(n.at)} น.</span>
          {n.speed !== null && <span><Gauge size={12} /> {nf.format(n.speed)} กม./ชม.</span>}
          {n.satellites !== null && <span><Satellite size={12} /> {n.satellites} ดวง</span>}
        </p>
        {n.location && <p className="notif-meta"><span><MapPin size={12} /> {n.location}</span></p>}

        {a && status !== 'new' && a.byName && (
          <p className="notif-by">{s.label}โดย {a.byName}{a.at && ` · ${dTime(a.at)}`}</p>
        )}
        {note && !editing && <p className="notif-note"><StickyNote size={13} /> {note}</p>}

        {editing && (
          <form className="note-edit" onSubmit={saveNote}>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500} rows={2} autoFocus
              placeholder="เช่น โทรแจ้งคนขับแล้ว ให้จอดพักที่ปั๊มถัดไป" aria-label="หมายเหตุ" />
            <div className="note-btns">
              <button type="submit" className="na on" disabled={saving}>{saving ? 'กำลังบันทึก…' : 'บันทึก'}</button>
              <button type="button" className="na" onClick={() => setEditing(false)} disabled={saving}>ยกเลิก</button>
              <span className="muted">{draft.length}/500</span>
            </div>
          </form>
        )}

        <div className="notif-actions">
          <div className="na-group" role="group" aria-label="สถานะการจัดการ">
            {HANDLE.map(({ id, label, icon: I }) => (
              <button key={id} type="button" className={`na${status === id ? ' on' : ''}`} aria-pressed={status === id}
                disabled={saving} onClick={() => setStatus(id)}
                title={status === id ? 'กดอีกครั้งเพื่อย้อนกลับเป็น "ใหม่"' : undefined}>
                <I size={13} /> {label}
              </button>
            ))}
          </div>
          <button type="button" className="na" onClick={startNote} disabled={saving || editing}>
            <StickyNote size={13} /> {note ? 'แก้หมายเหตุ' : 'หมายเหตุ'}
          </button>
          {n.video && <a className="na" href={n.video} target="_blank" rel="noopener noreferrer"><Video size={13} /> ดูวิดีโอ</a>}
          {n.link && <a className="na" href={n.link} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> {n.linkLabel || 'เปิดลิงก์'}</a>}
          {n.mapUrl && <a className="na" href={n.mapUrl} target="_blank" rel="noopener noreferrer"><MapPin size={13} /> แผนที่</a>}
          <button type="button" className="na ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <ChevronDown size={13} className="chev" /> รายละเอียด
          </button>
        </div>

        {open && (
          <dl className="detail-grid notif-detail">
            {Object.entries(n.raw).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{/^https?:\/\//i.test(v) ? <a className="ext" href={v} target="_blank" rel="noopener noreferrer">{v}</a> : String(v || '–')}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </li>
  )
}

/* ---------- page ---------- */

// The feeds, shown as a switch at the top. Each one has its own route in App.jsx.
export const NOTIF_TABS = [
  { id: 'pms', href: '#/notifications' },
  { id: 'pms2', href: '#/notifications/pms2' },
  { id: 'ngv', href: '#/notifications/ngv' },
  { id: 'ob', href: '#/notifications/ob' },
  { id: 'ttt', href: '#/notifications/ttt' },
  { id: 'bsrc', href: '#/notifications/bsrc' },
]

export default function NotificationsPage({ user, source = 'pms' }) {
  const src = SOURCES[source]
  const [state, setState] = useState({ status: 'loading', items: [], error: null, at: null })
  const [busy, setBusy] = useState(false)
  const [actions, setActions] = useState(new Map())
  const [dbErr, setDbErr] = useState(null)
  const [q, setQ] = useState('')
  const [show, setShow] = useState('open')
  const [type, setType] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [prevSeen] = useState(() => store.get(source)) // alerts after this time get the "ใหม่" tag
  const stage = useRef(null)
  usePointerGlow(stage)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const items = await loadNotifs(src)
      setState({ status: 'ready', items, error: null, at: new Date() })
      if (items[0]) store.set(source, Math.max(items[0].at.getTime(), store.get(source) || 0))
    } catch (err) {
      setState((s) => ({ ...s, status: s.items.length ? 'ready' : 'error', error: err.message || String(err) }))
    } finally {
      setBusy(false)
      setNow(Date.now())
    }
  }, [src, source])

  // Reload every minute while the tab is visible, and right away when it becomes visible again.
  useEffect(() => {
    load()
    const id = setInterval(() => { if (!document.hidden) load() }, NOTIF_REFRESH_MS)
    const vis = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', vis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', vis) }
  }, [load])

  // Handling status for the loaded alerts, live from Firestore (changes by teammates show up by themselves).
  const oldest = state.items.at(-1)?.at
  const since = oldest ? startOfDay(oldest).getTime() : null
  useEffect(() => {
    if (since === null) return
    return watchActions(new Date(since), (m) => { setActions(m); setDbErr(null) }, (err) => setDbErr(dbError(err)))
  }, [since])

  const statusOf = useCallback((n) => {
    const s = actions.get(n.key)?.status
    return s && STATUSES[s] ? s : 'new'
  }, [actions])

  const items = state.items
  const counts = useMemo(() => {
    const c = { all: items.length, new: 0, ack: 0, done: 0, false: 0 }
    for (const n of items) c[statusOf(n)]++
    return c
  }, [items, statusOf])

  const types = useMemo(() => {
    const m = new Map()
    for (const n of items) m.set(n.type, (m.get(n.type) || 0) + 1)
    return [...m].sort((a, b) => b[1] - a[1])
  }, [items])

  const kpis = useMemo(() => {
    const today = startOfDay(now).getTime()
    const days = Array.from({ length: 7 }, (_, k) => today - (6 - k) * DAY)
    const perDay = days.map((d) => items.filter((n) => n.at >= d && n.at < d + DAY).length)
    const todayCount = perDay.at(-1)
    const latestNew = items.find((n) => statusOf(n) === 'new')
    return [
      { label: 'แจ้งเตือนวันนี้', icon: Bell, value: todayCount, sub: `จาก ${nf.format(items.length)} รายการล่าสุด`, spark: perDay },
      { label: 'ยังไม่จัดการ', icon: BellRing, value: counts.new, sub: latestNew ? `ล่าสุด ${ago(latestNew.at, now)}` : 'จัดการครบแล้ว' },
      { label: 'รับทราบแล้ว', icon: Eye, value: counts.ack, sub: 'รอดำเนินการต่อ' },
      { label: 'ดำเนินการแล้ว', icon: CheckCheck, value: counts.done, sub: `แจ้งเตือนผิดพลาด ${nf.format(counts.false)}` },
    ]
  }, [items, counts, statusOf, now])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return items.filter((n) => {
      const st = statusOf(n)
      if (show === 'open' ? st !== 'new' && st !== 'ack' : show !== 'all' && st !== show) return false
      if (type && n.type !== type) return false
      if (!s) return true
      const note = actions.get(n.key)?.note || ''
      return [n.type, n.sub, n.device, n.deviceNo, n.group, n.driver, n.location, n.id, note].some((v) => v && v.toLowerCase().includes(s))
    })
  }, [items, q, show, type, statusOf, actions])

  useEffect(() => setLimit(PAGE), [q, show, type])

  const groups = useMemo(() => {
    const out = []
    for (const n of filtered.slice(0, limit)) {
      const label = dayLabel(n.at, now)
      if (out.at(-1)?.label !== label) out.push({ label, items: [] })
      out.at(-1).items.push(n)
    }
    return out
  }, [filtered, limit, now])

  const pendingShown = filtered.filter((n) => statusOf(n) === 'new')
  const ackAll = async () => {
    if (!pendingShown.length) return
    if (!confirm(`ตั้งสถานะ "รับทราบ" ให้แจ้งเตือนใหม่ที่แสดงอยู่ ${nf.format(pendingShown.length)} รายการ?`)) return
    setBulkBusy(true)
    try {
      const notes = (n) => actions.get(n.key)?.note || ''
      await saveActions(pendingShown, user, 'ack', notes)
      sendToSheet(src, pendingShown, user, 'ack', notes).catch((err) => setDbErr(sheetError(err)))
    } catch (err) {
      setDbErr(dbError(err))
    } finally {
      setBulkBusy(false)
    }
  }

  const chips = [
    { id: 'open', label: 'ต้องติดตาม', n: counts.new + counts.ack },
    { id: 'new', label: 'ใหม่', n: counts.new },
    { id: 'ack', label: 'รับทราบ', n: counts.ack },
    { id: 'done', label: 'ดำเนินการแล้ว', n: counts.done },
    { id: 'false', label: 'ผิดพลาด', n: counts.false },
    { id: 'all', label: 'ทั้งหมด', n: counts.all },
  ]
  let idx = 0

  return (
    <div className="stage scroll" ref={stage}>
      <main className="dash">
        <header className="dash-head">
          <a href="#/" className="back"><ArrowLeft size={16} /> เมนู</a>
          <div className="dash-title">
            <h1>รายการแจ้งเตือน <b>{src.label}</b></h1>
            <p className="sub">
              ข้อความจาก Telegram · อัปเดตทุก 1 นาที
              {state.at && ` · ล่าสุด ${hm(state.at)} น.`}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={load} disabled={busy} aria-label="โหลดข้อมูลใหม่" title="โหลดข้อมูลใหม่">
            <RefreshCw size={16} className={busy ? 'spin' : ''} />
          </button>
          <nav className="seg-ctl" aria-label="เลือกชุดแจ้งเตือน">
            {NOTIF_TABS.filter((t) => !SOURCES[t.id].group || SOURCES[t.id].group === t.id).map((t) => {
              const on = (src.group || source) === t.id
              return (
                <a key={t.id} href={t.href} className={`seg-link${on ? ' on' : ''}`}
                  aria-current={on ? 'page' : undefined}>
                  <Bell size={13} /> {SOURCES[t.id].label}
                </a>
              )
            })}
          </nav>
          {src.group && (
            <nav className="seg-ctl small" aria-label={`เลือกเครื่องของ ${SOURCES[src.group].label}`}>
              {NOTIF_TABS.filter((t) => SOURCES[t.id].group === src.group).map((t) => (
                <a key={t.id} href={t.href} className={`seg-link${t.id === source ? ' on' : ''}`}
                  aria-current={t.id === source ? 'page' : undefined}>
                  {SOURCES[t.id].sub}
                </a>
              ))}
            </nav>
          )}
        </header>

        {state.error && state.status === 'ready' && (
          <p className="banner" role="alert">โหลดข้อมูลล่าสุดไม่สำเร็จ ({state.error}) กำลังแสดงข้อมูลชุดก่อนหน้า</p>
        )}
        {dbErr && <p className="banner" role="alert">{dbErr}</p>}

        {state.status === 'loading' && (
          <section className="panel state-card"><RefreshCw size={22} className="spin" /> กำลังโหลดการแจ้งเตือน…</section>
        )}

        {state.status === 'error' && (
          <section className="panel state-card">
            <AlertTriangle size={22} />
            <div>
              <strong>โหลดการแจ้งเตือนไม่สำเร็จ</strong>
              <p className="muted">{state.error}</p>
            </div>
            <button type="button" className="more" onClick={load} disabled={busy}>ลองใหม่</button>
          </section>
        )}

        {state.status === 'ready' && (
          <>
            <div className="kpis">
              {kpis.map((k, i) => <Kpi key={k.label} {...k} format={count} i={i} animKey={state.at?.getTime()} />)}
            </div>

            <Panel i={4} title="การแจ้งเตือน" note="เรียงจากล่าสุด · กดปุ่มสถานะซ้ำเพื่อย้อนกลับเป็น “ใหม่”">
              <div className="tools">
                <label className="f search">
                  <Search size={15} />
                  <input type="search" placeholder={src.group !== 'pms' ? 'ค้นหา ทะเบียนรถ กลุ่มรถ พขร. สถานที่ ประเภท หมายเหตุ…' : 'ค้นหา ชื่ออุปกรณ์ หมายเลข ประเภท หมายเหตุ…'}
                    value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหาแจ้งเตือน" />
                </label>
                <label className="f unit-pick">
                  <Filter size={15} />
                  <select value={type} onChange={(e) => setType(e.target.value)} aria-label="ประเภทสัญญาณเตือน">
                    <option value="">ทุกประเภท</option>
                    {types.map(([t, c]) => <option key={t} value={t}>{t} ({nf.format(c)})</option>)}
                  </select>
                </label>
              </div>
              <div className="tools">
                <div className="chips" role="radiogroup" aria-label="สถานะ">
                  {chips.map((c) => (
                    <button key={c.id} type="button" role="radio" aria-checked={show === c.id}
                      className={show === c.id ? 'on' : ''} onClick={() => setShow(c.id)}>
                      {c.label} <em>{nf.format(c.n)}</em>
                    </button>
                  ))}
                </div>
                <button type="button" className="more bulk" onClick={ackAll} disabled={bulkBusy || !pendingShown.length}>
                  <CheckCheck size={14} /> {bulkBusy ? 'กำลังบันทึก…' : `รับทราบทั้งหมดที่แสดง (${nf.format(pendingShown.length)})`}
                </button>
              </div>

              {filtered.length === 0 ? (
                <Empty>{items.length ? 'ไม่มีการแจ้งเตือนที่ตรงกับตัวกรอง' : 'ยังไม่มีการแจ้งเตือน'}</Empty>
              ) : groups.map((g) => (
                <section key={g.label} className="notif-day">
                  <h3>{g.label}</h3>
                  <ul className="notif-list">
                    {g.items.map((n) => (
                      <NotifItem key={n.id} src={src} n={n} a={actions.get(n.key)} i={idx++} now={now} user={user}
                        isNew={prevSeen !== null && n.at.getTime() > prevSeen && statusOf(n) === 'new'}
                        onError={setDbErr} />
                    ))}
                  </ul>
                </section>
              ))}

              <div className="table-foot">
                <span className="muted">แสดง {nf.format(Math.min(limit, filtered.length))} จาก {nf.format(filtered.length)} รายการ</span>
                {limit < filtered.length && (
                  <button type="button" className="more" onClick={() => setLimit((l) => l + PAGE * 2)}>แสดงเพิ่ม</button>
                )}
              </div>
            </Panel>
          </>
        )}
      </main>
    </div>
  )
}
