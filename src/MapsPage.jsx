import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, Search, RefreshCw, MapPin, Layers, Crosshair, X, Copy, Check, ExternalLink, AlertTriangle,
} from 'lucide-react'
import { loadGeofences, cachedGeofences, googleMapsLink, parseCoords, OTHER_SUPPLIER_COLOR } from './mapsData'
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
  ],
  google: [
    { id: 'road', label: 'แผนที่' },
    { id: 'dark', label: 'แผนที่มืด' },
    { id: 'satellite', label: 'ดาวเทียม' },
    { id: 'hybrid', label: 'ไฮบริด' },
  ],
}

const PAGE = 100
const nf = new Intl.NumberFormat('th-TH')

const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
}

// Rough distance in km, good enough for sorting nearby points.
const distKm = (a, b) => {
  const x = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180)
  const y = b.lat - a.lat
  return Math.sqrt(x * x + y * y) * 111.32
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

  // Fetch the Google Maps script in the background so switching to it is quick.
  // (Loading the script is free; only creating a map counts as a map load.)
  useEffect(() => {
    const t = setTimeout(() => preloadGoogleMaps().catch(() => {}), 1500)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => { store.set('maps.engine', engine); store.set('maps.type', type) }, [engine, type])

  const switchEngine = (id) => {
    setEngine(id)
    setOpened((o) => (o.has(id) ? o : new Set(o).add(id)))
    if (!TYPES[id].some((t) => t.id === type)) setType('satellite')
    setFitKey(0) // keep the current view when switching
  }

  const colors = useMemo(() => new Map(data.suppliers.map((s) => [s.name, s.color])), [data.suppliers])
  const colorOf = useCallback((name) => colors.get(name) ?? OTHER_SUPPLIER_COLOR, [colors])

  const term = typedPin ? '' : q.trim().toLowerCase() // a coordinate search shows every station, nearest first
  const matches = useCallback((p) => !term || p.name.toLowerCase().includes(term) || p.supplier.toLowerCase().includes(term)
    || `${p.lat},${p.lng}`.includes(term), [term])

  // Points drawn on the map: supplier toggles + search.
  const shown = useMemo(() => data.points.filter((p) => !hidden.has(p.supplier) && matches(p)), [data.points, hidden, matches])

  // Points listed in the sidebar: same, optionally only inside the visible map area (nearest first).
  // With a searched coordinate, distances are measured from it instead of the map center.
  const origin = pin ?? (inView ? center : null)
  const listed = useMemo(() => {
    const inside = inView && bounds
      ? shown.filter((p) => p.lat >= bounds.south && p.lat <= bounds.north && p.lng >= bounds.west && p.lng <= bounds.east)
      : shown
    return origin ? [...inside].sort((a, b) => distKm(origin, a) - distKm(origin, b)) : inside
  }, [shown, inView, bounds, origin])

  useEffect(() => setLimit(PAGE), [q, hidden, inView, pin])

  const onView = useCallback((v, b) => { view.current = v; setBounds(b); setCenter({ lat: v.lat, lng: v.lng }) }, [])

  const toggleSupplier = (name) => setHidden((h) => {
    const n = new Set(h)
    n.has(name) ? n.delete(name) : n.add(name)
    return n
  })
  const only = (name) => setHidden(new Set(data.suppliers.map((s) => s.name).filter((s) => s !== name)))

  const copy = async (p) => {
    try {
      await navigator.clipboard.writeText(`${p.lat}, ${p.lng}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked */ }
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
              : 'ข้อมูลพิกัดจาก Google Sheet'}
            {data.at && ` · อัปเดต ${new Date(data.at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`}
          </p>
        </div>
        <div className="map-modes">
          <div className="seg-ctl" role="radiogroup" aria-label="ผู้ให้บริการแผนที่">
            {ENGINES.map((e) => (
              <button key={e.id} type="button" role="radio" aria-checked={engine === e.id}
                onPointerEnter={e.id === 'google' ? () => preloadGoogleMaps().catch(() => {}) : undefined}
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
            <button type="button" className="icon-btn" onClick={load} disabled={busy} title="โหลดข้อมูลใหม่" aria-label="โหลดข้อมูลใหม่">
              <RefreshCw size={16} className={busy ? 'spin' : ''} />
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
              </div>
            </div>
          )}

          <p className="side-count muted">
            {data.status === 'loading' ? 'กำลังโหลดข้อมูล…' : `${nf.format(listed.length)} รายการ${pin ? ' · เรียงจากใกล้พิกัดที่ค้นหา' : ''}`}
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
              {opened.has('osm') && (
                <LeafletMap active={engine === 'osm'} points={shown} colorOf={colorOf} selected={selected}
                  onSelect={setSelected} type={type} view={view.current} onView={onView} fitKey={fitKey} pin={pin} />
              )}
              {opened.has('google') && (
                <GoogleMap active={engine === 'google'} points={shown} colorOf={colorOf} selected={selected}
                  onSelect={setSelected} type={type} view={view.current} onView={onView} fitKey={fitKey} pin={pin} />
              )}
            </>
          )}
          {data.status === 'loading' && <div className="map-msg"><MapPin size={18} /> กำลังโหลดพิกัด…</div>}
          {data.error && data.status === 'ready' && <div className="map-toast">โหลดข้อมูลล่าสุดไม่สำเร็จ แสดงข้อมูลชุดก่อนหน้า</div>}
        </section>
      </div>
    </div>
  )
}
