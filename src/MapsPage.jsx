import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, Search, RefreshCw, MapPin, Layers, Crosshair, X, Copy, Check, ExternalLink, AlertTriangle,
  LocateFixed, Navigation, Fuel, Car, Bus, Bike,
} from 'lucide-react'
import {
  loadGeofences, cachedGeofences, googleMapsLink, navLink, parseCoords, OTHER_SUPPLIER_COLOR,
  distanceKm, nearestTo, formatDist, loadStations, cachedStations, fuelInk,
} from './mapsData'
import { useMyLocation, ACC_CIRCLE_MAX_M } from './myLocation'
import { GOOGLE_MAPS_DAILY_LIMIT } from './mapsQuota'
import LeafletMap from './LeafletMap'
import GoogleMap, { preloadGoogleMaps } from './GoogleMap'

const ENGINES = [
  { id: 'osm', label: 'OpenStreetMap' },
  { id: 'google', label: 'Google Maps' },
]

const TYPES = {
  osm: [
    { id: 'road', label: 'แผนที่' },
    { id: 'dark', label: 'แผนที่มืด' },
    { id: 'satellite', label: 'ดาวเทียม' },
    { id: 'terrain', label: 'ภูมิประเทศ' },
  ],
  google: [
    { id: 'road', label: 'แผนที่' },
    { id: 'dark', label: 'แผนที่มืด' },
    { id: 'satellite', label: 'ดาวเทียม' },
    { id: 'hybrid', label: 'ไฮบริด' },
    { id: 'terrain', label: 'ภูมิประเทศ' },
  ],
}

// Extra Google layers. They are part of the normal map (no extra map loads, no extra cost).
const GOOGLE_OVERLAYS = [
  { id: 'traffic', label: 'การจราจร', Icon: Car },
  { id: 'transit', label: 'ขนส่งสาธารณะ', Icon: Bus },
  { id: 'bike', label: 'จักรยาน', Icon: Bike },
]

const PAGE = 100
const nf = new Intl.NumberFormat('th-TH')

const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
}

const distKm = distanceKm

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true } catch {
    // fallback for browsers that block the clipboard API
    const ta = document.createElement('textarea')
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.append(ta); ta.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch { /* blocked */ }
    ta.remove()
    return ok
  }
}

export default function MapsPage() {
  // Show the last saved data immediately (the Apps Script takes several seconds), then refresh.
  const [data, setData] = useState(() => {
    const c = cachedGeofences()
    return c ? { status: 'ready', ...c, error: null } : { status: 'loading', points: [], invalid: [], suppliers: [], error: null }
  })
  const [busy, setBusy] = useState(false)
  const [engine, setEngine] = useState(() => store.get('maps.engine', 'osm'))
  const [type, setType] = useState(() => store.get('maps.type', 'dark'))
  const [hidden, setHidden] = useState(() => new Set())
  const [q, setQ] = useState('')
  const [inView, setInView] = useState(false)
  const [bounds, setBounds] = useState(null)
  const [center, setCenter] = useState(null)
  const [selected, setSelected] = useState(null)
  const [limit, setLimit] = useState(PAGE)
  const [fitKey, setFitKey] = useState(() => (cachedGeofences() ? 1 : 0))
  const fitted = useRef(!!cachedGeofences())
  const [opened, setOpened] = useState(() => new Set([store.get('maps.engine', 'osm')]))
  const [copied, setCopied] = useState(false)
  // Coordinates typed in the search box. Applied after a short pause (or Enter) so the map
  // does not jump to half-typed numbers like "13.75, 1".
  const [pin, setPin] = useState(null)
  const typedPin = useMemo(() => parseCoords(q), [q])
  useEffect(() => {
    const t = setTimeout(() => setPin((p) => (p?.lat === typedPin?.lat && p?.lng === typedPin?.lng ? p : typedPin)), 700)
    return () => clearTimeout(t)
  }, [typedPin])
  useEffect(() => { if (pin) setSelected(null) }, [pin])
  const view = useRef({ lat: 13.6, lng: 100.9, zoom: 6 })

  // short message at the bottom of the map
  const [note, setNote] = useState(null)
  const say = useCallback((text, ms = 4000) => setNote({ text, until: Date.now() + ms }), [])
  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(null), note.until - Date.now())
    return () => clearTimeout(t)
  }, [note])

  // "my location": find once -> follow live -> off. While following, the map keeps me in the
  // middle until the user drags it; then a "back to me" button appears.
  const [focus, setFocus] = useState(null)
  const [locked, setLocked] = useState(true)
  const shownRef = useRef([])
  const loc = useMyLocation({
    onNote: say,
    onFound: (f) => {
      setQ(''); setPin(null); setSelected(null)
      const near = nearestTo(f, shownRef.current, 5)
      setFocus({ key: Date.now(), pts: [f, ...near.map((n) => n.p)] })
      const rough = f.acc > ACC_CIRCLE_MAX_M
      say((near[0] ? `ใกล้ที่สุด: ${near[0].p.name} (${formatDist(near[0].km)})` : 'พบตำแหน่งแล้ว')
        + (rough
          ? ` · ตำแหน่งโดยประมาณ ±${formatDist(f.acc / 1000)} (ไม่มี GPS — บนมือถือจะแม่นกว่า)`
          : ` · แม่นยำ ±${Math.round(f.acc)} ม. — กดปุ่มอีกครั้งเพื่อติดตามแบบเรียลไทม์`), rough ? 9000 : 6000)
    },
  })
  const me = loc.me
  const following = loc.mode === 'follow'
  useEffect(() => { if (following) setLocked(true) }, [following])
  useEffect(() => { if (selected) setLocked(false) }, [selected]) // looking at a station: stop pulling the map back
  // typing a coordinate replaces my location
  useEffect(() => { if (typedPin && me) loc.off() }, [typedPin]) // eslint-disable-line react-hooks/exhaustive-deps

  // copy buttons inside map popups
  useEffect(() => {
    const onClick = async (e) => {
      const btn = e.target.closest?.('.mpop-btn[data-copy]')
      if (!btn) return
      e.preventDefault()
      const ok = await copyText(btn.dataset.copy)
      say(ok ? `คัดลอกพิกัดแล้ว: ${btn.dataset.copy}` : 'คัดลอกไม่สำเร็จ ลองกดค้างที่พิกัดเพื่อคัดลอกเอง', 2500)
      if (ok) { const old = btn.textContent; btn.textContent = '✓ คัดลอกแล้ว'; setTimeout(() => { btn.textContent = old }, 1500) }
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [say])

  // Fuel-station layer (all brands). Off by default; loaded the first time it is turned on.
  const [showSt, setShowSt] = useState(() => store.get('maps.stations', '0') === '1')
  const [st, setSt] = useState(() => {
    const c = cachedStations()
    return c ? { status: 'ready', ...c } : { status: 'idle', points: [], brands: [] }
  })
  const [hiddenBrands, setHiddenBrands] = useState(() => new Set())
  const loadSt = useCallback(async () => {
    setSt((s) => ({ ...s, status: 'loading' }))
    try {
      setSt({ status: 'ready', ...await loadStations() })
    } catch (e) {
      setSt((s) => ({ ...s, status: s.points.length ? 'ready' : 'error' }))
      say(e.message, 6000)
    }
  }, [say])
  useEffect(() => {
    store.set('maps.stations', showSt ? '1' : '0')
    if (showSt && (st.status === 'idle' || st.status === 'error')) loadSt()
  }, [showSt]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const d = await loadGeofences()
      setData({ status: 'ready', ...d, error: null })
      if (!fitted.current) { fitted.current = true; setFitKey(1) } // zoom to all points on the first load only
    } catch (e) {
      setData((s) => ({ ...s, status: s.points.length ? 'ready' : 'error', error: e.message }))
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => { load() }, [load])
  const reload = () => { load(); if (showSt) loadSt() }

  // Fetch the Google Maps script in the background so switching to it is quick.
  // (Loading the script is free; only creating a map counts as a map load.)
  useEffect(() => {
    const t = setTimeout(() => preloadGoogleMaps().catch(() => {}), 1500)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => { store.set('maps.engine', engine); store.set('maps.type', type) }, [engine, type])

  const [overlays, setOverlays] = useState(() => new Set(store.get('maps.overlays', '').split(',').filter(Boolean)))
  useEffect(() => store.set('maps.overlays', [...overlays].join(',')), [overlays])
  const toggleOverlay = (id) => setOverlays((o) => {
    const n = new Set(o)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })

  const switchEngine = (id) => {
    setEngine(id)
    setOpened((o) => (o.has(id) ? o : new Set(o).add(id)))
    if (!TYPES[id].some((t) => t.id === type)) setType('satellite')
    setFitKey(0) // keep the current view when switching
  }

  // Google Maps failed (daily limit reached, key refused, script not loaded, quota check failed):
  // go back to OpenStreetMap right away and keep the Google button off until the page is reloaded.
  const [googleDown, setGoogleDown] = useState(null)
  const onGoogleFail = useCallback((reason) => {
    const why = reason === 'quota' ? `วันนี้ใช้ Google Maps ครบ ${GOOGLE_MAPS_DAILY_LIMIT} ครั้งแล้ว (นับใหม่ตอนเที่ยงคืน)`
      : reason === 'auth' ? 'Google Maps ใช้ไม่ได้ (key ถูกปฏิเสธ)'
        : 'โหลด Google Maps ไม่สำเร็จ'
    setGoogleDown(why)
    setEngine((e) => (e === 'google' ? 'osm' : e))
    setOpened((o) => (o.has('osm') ? o : new Set(o).add('osm'))) // this visit may have started on Google
    setType((t) => (TYPES.osm.some((x) => x.id === t) ? t : 'satellite'))
    say(`${why} — สลับไปใช้ OpenStreetMap ให้อัตโนมัติ`, 8000)
  }, [say])

  const colors = useMemo(() => new Map([...data.suppliers, ...st.brands].map((s) => [s.name, s.color])), [data.suppliers, st.brands])
  const colorOf = useCallback((name) => colors.get(name) ?? OTHER_SUPPLIER_COLOR, [colors])

  const term = typedPin ? '' : q.trim().toLowerCase() // a coordinate search shows every station, nearest first
  const matches = useCallback((p) => !term || p.name.toLowerCase().includes(term) || p.supplier.toLowerCase().includes(term)
    || `${p.lat},${p.lng}`.includes(term)
    || (p.station && `${p.station.where} ${p.station.address}`.toLowerCase().includes(term)), [term])

  // Points drawn on the map: supplier / brand toggles + search.
  const shownGeo = useMemo(() => data.points.filter((p) => !hidden.has(p.supplier) && matches(p)), [data.points, hidden, matches])
  const shownSt = useMemo(() => (showSt ? st.points.filter((p) => !hiddenBrands.has(p.supplier) && matches(p)) : []),
    [showSt, st.points, hiddenBrands, matches])
  const shown = useMemo(() => (shownSt.length ? [...shownGeo, ...shownSt] : shownGeo), [shownGeo, shownSt])

  // The 5 closest customer stations to my location (or the searched coordinate): dashed lines on
  // the map. With every customer station hidden, the 5 closest fuel stations instead. With both
  // layers showing, the closest fuel station is added to the "nearest" bar.
  const nearPool = shownGeo.length ? shownGeo : shownSt
  shownRef.current = nearPool
  const lineFrom = me ?? pin
  const nearest = useMemo(() => (lineFrom ? nearestTo(lineFrom, nearPool, 5) : []), [lineFrom, nearPool])
  const nearestPump = useMemo(() => (lineFrom && shownGeo.length && shownSt.length ? nearestTo(lineFrom, shownSt, 1)[0] : null),
    [lineFrom, shownGeo.length, shownSt])

  // Points listed in the sidebar: same, optionally only inside the visible map area (nearest first).
  // With my location or a searched coordinate, distances are measured from it instead of the map center.
  const origin = me ?? pin ?? (inView ? center : null)
  const listed = useMemo(() => {
    const inside = inView && bounds
      ? shown.filter((p) => p.lat >= bounds.south && p.lat <= bounds.north && p.lng >= bounds.west && p.lng <= bounds.east)
      : shown
    return origin ? [...inside].sort((a, b) => distKm(origin, a) - distKm(origin, b)) : inside
  }, [shown, inView, bounds, origin])

  useEffect(() => setLimit(PAGE), [q, hidden, hiddenBrands, showSt, inView, pin, !me]) // eslint-disable-line react-hooks/exhaustive-deps

  const onView = useCallback((v, b) => { view.current = v; setBounds(b); setCenter({ lat: v.lat, lng: v.lng }) }, [])

  const toggleSupplier = (name) => setHidden((h) => {
    const n = new Set(h)
    n.has(name) ? n.delete(name) : n.add(name)
    return n
  })
  const only = (name) => setHidden(new Set(data.suppliers.map((s) => s.name).filter((s) => s !== name)))
  const toggleBrand = (name) => setHiddenBrands((h) => {
    const n = new Set(h)
    n.has(name) ? n.delete(name) : n.add(name)
    return n
  })
  const onlyBrand = (name) => setHiddenBrands(new Set(st.brands.map((s) => s.name).filter((s) => s !== name)))

  const copy = async (p) => {
    if (!await copyText(`${p.lat}, ${p.lng}`)) { say('คัดลอกไม่สำเร็จ ลองกดค้างที่พิกัดเพื่อคัดลอกเอง', 2500); return }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // tap the "nearest" bar: show that station (while following, stop pulling the map back to me)
  const goNearest = (p) => { setLocked(false); setSelected(p) }

  const mapProps = {
    points: shown, colorOf, selected, onSelect: setSelected, type, view: view.current, onView, fitKey, pin,
    me, nearest, following, locked: following && locked, onUnlock: () => setLocked(false), focus,
  }

  return (
    <div className="stage maps-stage">
      <header className="maps-head">
        <a href="#/" className="back"><ArrowLeft size={16} /> เมนู</a>
        <div className="dash-title">
          <h1>แผนที่<b>สถานีลูกค้า</b></h1>
          <p className="sub">
            {data.status === 'ready'
              ? `${nf.format(data.points.length)} จุดบนแผนที่ · ${data.suppliers.length} ผู้ให้บริการ`
                + (showSt && st.points.length ? ` · ปั๊มน้ำมัน ${nf.format(st.points.length)} แห่ง` : '')
              : 'ข้อมูลพิกัดจาก Google Sheet'}
            {data.at && ` · อัปเดต ${new Date(data.at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`}
          </p>
        </div>
        <div className="map-modes">
          <div className="seg-ctl" role="radiogroup" aria-label="ผู้ให้บริการแผนที่">
            {ENGINES.map((e) => (
              <button key={e.id} type="button" role="radio" aria-checked={engine === e.id}
                disabled={e.id === 'google' && !!googleDown}
                title={e.id === 'google' && googleDown ? `${googleDown} — รีเฟรชหน้าเพื่อลองใหม่` : undefined}
                onPointerEnter={e.id === 'google' && !googleDown ? () => preloadGoogleMaps().catch(() => {}) : undefined}
                className={engine === e.id ? 'on' : ''} onClick={() => switchEngine(e.id)}>{e.label}</button>
            ))}
          </div>
          <div className="seg-ctl" role="radiogroup" aria-label="รูปแบบแผนที่">
            <Layers size={14} className="seg-ic" aria-hidden="true" />
            {TYPES[engine].map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={type === t.id}
                className={type === t.id ? 'on' : ''} onClick={() => setType(t.id)}>{t.label}</button>
            ))}
          </div>
          {engine === 'google' && (
            <div className="seg-ctl" role="group" aria-label="ชั้นข้อมูลเพิ่มเติมของ Google">
              {GOOGLE_OVERLAYS.map(({ id, label, Icon }) => (
                <button key={id} type="button" aria-pressed={overlays.has(id)} className={overlays.has(id) ? 'on' : ''}
                  onClick={() => toggleOverlay(id)} title={`${overlays.has(id) ? 'ซ่อน' : 'แสดง'}${label}`}>
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <div className="maps-body">
        <aside className="panel side" aria-label="รายการพิกัด">
          <div className="side-top">
            <label className="f search">
              <Search size={15} />
              <input type="search" placeholder="ค้นหาชื่อสถานี ผู้ให้บริการ หรือพิกัด เช่น 13.7563, 100.5018" value={q}
                onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setPin(typedPin)}
                aria-label="ค้นหาสถานีหรือพิกัด" />
            </label>
            <button type="button" className="icon-btn" onClick={reload} disabled={busy || st.status === 'loading'}
              title="โหลดข้อมูลใหม่" aria-label="โหลดข้อมูลใหม่">
              <RefreshCw size={16} className={busy || st.status === 'loading' ? 'spin' : ''} />
            </button>
          </div>

          <div className="sup-list" role="group" aria-label="กรองตามผู้ให้บริการ (คลิกเพื่อซ่อน/แสดง, ดับเบิลคลิกเพื่อเลือกเจ้าเดียว)">
            {data.suppliers.map((s) => (
              <button key={s.name} type="button" className={`sup${hidden.has(s.name) ? ' off' : ''}`}
                aria-pressed={!hidden.has(s.name)} onClick={() => toggleSupplier(s.name)} onDoubleClick={() => only(s.name)}
                title="คลิก = ซ่อน/แสดง · ดับเบิลคลิก = ดูเจ้านี้เจ้าเดียว">
                <i style={{ background: s.color }} />
                <span>{s.name}</span>
                <em>{nf.format(s.mapped)}</em>
              </button>
            ))}
            {hidden.size > 0 && (
              <button type="button" className="sup reset" onClick={() => setHidden(new Set())}>แสดงทั้งหมด</button>
            )}
          </div>

          <div className="sup-list st-list" role="group" aria-label="ชั้นปั๊มน้ำมัน (คลิกแบรนด์เพื่อซ่อน/แสดง, ดับเบิลคลิกเพื่อเลือกแบรนด์เดียว)">
            <button type="button" className={`sup st-toggle${showSt ? ' on' : ''}`} aria-pressed={showSt}
              onClick={() => setShowSt((v) => !v)} title={showSt ? 'ซ่อนปั๊มน้ำมัน' : 'แสดงปั๊มน้ำมันทุกแบรนด์บนแผนที่'}>
              <Fuel size={13} />
              <span>ปั๊มน้ำมัน</span>
              <em>{st.status === 'loading' ? 'กำลังโหลด…' : showSt ? 'เปิด' : 'ปิด'}</em>
            </button>
            {showSt && st.brands.map((b) => (
              <button key={b.name} type="button" className={`sup${hiddenBrands.has(b.name) ? ' off' : ''}`}
                aria-pressed={!hiddenBrands.has(b.name)} onClick={() => toggleBrand(b.name)} onDoubleClick={() => onlyBrand(b.name)}
                title="คลิก = ซ่อน/แสดง · ดับเบิลคลิก = ดูแบรนด์นี้แบรนด์เดียว">
                <i className="fuel-dot" style={{ background: b.color, color: fuelInk(b.color) }}>⛽</i>
                <span>{b.name}</span>
                <em>{nf.format(b.mapped)}</em>
              </button>
            ))}
            {showSt && hiddenBrands.size > 0 && (
              <button type="button" className="sup reset" onClick={() => setHiddenBrands(new Set())}>ทุกแบรนด์</button>
            )}
          </div>

          <label className="inview">
            <input type="checkbox" checked={inView} onChange={(e) => setInView(e.target.checked)} />
            <Crosshair size={14} /> เฉพาะจุดในขอบเขตแผนที่ (เรียงจากใกล้กึ่งกลาง)
          </label>

          {pin && !selected && (
            <div className="picked">
              <div className="picked-head">
                <span className="mpop-sup"><MapPin size={13} color="#ef4444" />พิกัดที่ค้นหา</span>
                <button type="button" className="x" onClick={() => setQ('')} aria-label="ล้างพิกัด"><X size={15} /></button>
              </div>
              <code>{pin.lat.toFixed(6)}, {pin.lng.toFixed(6)}</code>
              <div className="picked-actions">
                <button type="button" className="more" onClick={() => copy(pin)}>
                  {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'คัดลอกแล้ว' : 'คัดลอกพิกัด'}
                </button>
              </div>
            </div>
          )}

          {selected && (
            <div className="picked">
              <div className="picked-head">
                <span className="mpop-sup"><i style={{ background: colorOf(selected.supplier) }} />{selected.supplier}</span>
                <button type="button" className="x" onClick={() => setSelected(null)} aria-label="ปิด"><X size={15} /></button>
              </div>
              <strong>{selected.name}</strong>
              <code>{selected.lat.toFixed(6)}, {selected.lng.toFixed(6)}</code>
              <div className="picked-actions">
                <button type="button" className="more" onClick={() => copy(selected)}>
                  {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'คัดลอกแล้ว' : 'คัดลอกพิกัด'}
                </button>
                <a className="more" href={googleMapsLink(selected)} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={14} /> Google Maps
                </a>
                <a className="more" href={navLink(selected)} target="_blank" rel="noopener noreferrer">
                  <Navigation size={14} /> นำทาง
                </a>
              </div>
            </div>
          )}

          <p className="side-count muted">
            {data.status === 'loading' ? 'กำลังโหลดข้อมูล…'
              : `${nf.format(listed.length)} รายการ${me ? ' · เรียงจากใกล้ตำแหน่งของฉัน' : pin ? ' · เรียงจากใกล้พิกัดที่ค้นหา' : ''}`}
          </p>

          <ul className="plist">
            {listed.slice(0, limit).map((p) => (
              <li key={p.id}>
                <button type="button" className={selected?.id === p.id ? 'on' : ''} onClick={() => setSelected(p)}>
                  <i style={{ background: colorOf(p.supplier) }} />
                  <span className="pname">{p.name}</span>
                  <span className="pmeta">
                    {p.supplier} · {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                    {origin && <> · {distKm(origin, p).toFixed(1)} กม.</>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {limit < listed.length && (
            <button type="button" className="more full" onClick={() => setLimit((l) => l + PAGE * 2)}>
              แสดงเพิ่ม ({nf.format(listed.length - limit)} รายการ)
            </button>
          )}
          {data.status === 'ready' && listed.length === 0 && <p className="empty">ไม่พบสถานีที่ตรงกับเงื่อนไข</p>}

          {data.invalid.length > 0 && (
            <details className="invalid">
              <summary><AlertTriangle size={14} /> พิกัดไม่ถูกต้อง {nf.format(data.invalid.length)} จุด (ไม่แสดงบนแผนที่)</summary>
              <ul>
                {data.invalid.map((p) => (
                  <li key={p.id}>
                    <span className="pname">{p.name}</span>
                    <span className="pmeta">{p.supplier} · {p.problem} · lat “{String(p.rawLat)}” lng “{String(p.rawLng)}”</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </aside>

        <section className="map-wrap" aria-label="แผนที่">
          {data.status === 'error' ? (
            <div className="map-msg err">
              <strong>โหลดข้อมูลพิกัดไม่สำเร็จ</strong><span>{data.error}</span>
              <button type="button" className="more" onClick={load}>ลองใหม่</button>
            </div>
          ) : (
            <>
              {/* Both maps stay alive once opened, so switching back and forth is instant. */}
              {opened.has('osm') && <LeafletMap active={engine === 'osm'} {...mapProps} />}
              {opened.has('google') && <GoogleMap active={engine === 'google'} overlays={overlays} onFail={onGoogleFail} {...mapProps} />}

              {me && nearest[0] && (
                <div className={`near-bar${following ? ' following' : ''}`}>
                  <button type="button" className="nb-row" onClick={() => goNearest(nearest[0].p)} title="ไปที่จุดนี้">
                    <span className="nb-dot" />
                    <span className="nb-label">{nearest[0].p.kind === 'station' ? '⛽ ปั๊มใกล้สุด' : 'ใกล้สุด'}</span>
                    <span className="nb-name">{nearest[0].p.kind === 'station' ? `${nearest[0].p.supplier} · ` : ''}{nearest[0].p.name}</span>
                    <span className="nb-dist">{formatDist(nearest[0].km)}</span>
                  </button>
                  {nearestPump && (
                    <button type="button" className="nb-row nb-pump" onClick={() => goNearest(nearestPump.p)} title="ไปที่ปั๊มนี้">
                      <i className="fuel-dot" style={{ background: colorOf(nearestPump.p.supplier), color: fuelInk(colorOf(nearestPump.p.supplier)) }}>⛽</i>
                      <span className="nb-label">ปั๊มใกล้สุด</span>
                      <span className="nb-name">{nearestPump.p.supplier} · {nearestPump.p.name}</span>
                      <span className="nb-dist">{formatDist(nearestPump.km)}</span>
                    </button>
                  )}
                </div>
              )}

              <div className="map-tools">
                {following && !locked && (
                  <button type="button" className="loc-btn recenter" onClick={() => setLocked(true)}
                    title="กลับมาที่ตำแหน่งของฉัน" aria-label="กลับมาที่ตำแหน่งของฉัน">
                    <Navigation size={18} />
                  </button>
                )}
                <button type="button" className={`loc-btn ${loc.mode}`} onClick={loc.click}
                  aria-pressed={loc.mode === 'on' || following}
                  title={loc.mode === 'follow' ? 'กำลังติดตามตำแหน่ง — กดเพื่อปิด'
                    : loc.mode === 'on' ? 'กดเพื่อติดตามตำแหน่งแบบเรียลไทม์' : 'ตำแหน่งของฉัน'}
                  aria-label="ตำแหน่งของฉัน">
                  <LocateFixed size={19} />
                </button>
              </div>
            </>
          )}
          {note && <div className="map-note" role="status">{note.text}</div>}
          {data.status === 'loading' && <div className="map-msg"><MapPin size={18} /> กำลังโหลดพิกัด…</div>}
          {data.error && data.status === 'ready' && <div className="map-toast">โหลดข้อมูลล่าสุดไม่สำเร็จ แสดงข้อมูลชุดก่อนหน้า</div>}
        </section>
      </div>
    </div>
  )
}
