import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, Search, RefreshCw, MapPin, Layers, Crosshair, X, Copy, Check, ExternalLink, AlertTriangle,
  LocateFixed, Navigation, Fuel, Car, Bus, Bike, Eye, CloudRain, Play, Pause, Anchor, Wind, Route,
} from 'lucide-react'
import { loadOffshore, cachedOffshore, DMF_CREDIT, PLATFORM_GROUP, PLATFORM_COLOR } from './offshoreData'
import { loadRainFrames, rainTimeLabel, lagLabel } from './rainRadar'
import { driveTable, driveRoute, driveMatrix, driveRouteVia, formatMin, OSRM_CREDIT } from './routing'
import { alongRoute, bestOrder, googleDirections, MAX_STOPS } from './planner'
import RoutePlanner from './RoutePlanner'
import StreetViewPanel from './StreetViewPanel'
import {
  loadGeofences, cachedGeofences, googleMapsLink, navLink, windyLink, parseCoords, OTHER_SUPPLIER_COLOR,
  distanceKm, nearestTo, formatDist, loadStations, cachedStations, fuelInk, placePopupHtml,
} from './mapsData'
import { loadAdmin, adminReady, areaOf, formatArea, areaSearchText } from './geoAdmin'
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
const EMPTY = [] // a stable empty list (so memos that depend on it do not run again)

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
      // the nearest station is already in the bar at the top of the map, so keep this note short
      say(rough
        ? `ตำแหน่งโดยประมาณ ±${formatDist(f.acc / 1000)} (ไม่มี GPS — บนมือถือจะแม่นกว่า)`
        : `แม่นยำ ±${Math.round(f.acc)} ม. · กดปุ่มอีกครั้งเพื่อติดตามเรียลไทม์`, rough ? 7000 : 5000)
    },
  })
  const me = loc.me
  const following = loc.mode === 'follow'
  useEffect(() => { if (following) setLocked(true) }, [following])
  useEffect(() => { if (selected) setLocked(false) }, [selected]) // looking at a station: stop pulling the map back
  // typing a coordinate replaces my location
  useEffect(() => { if (typedPin && me) loc.off() }, [typedPin]) // eslint-disable-line react-hooks/exhaustive-deps

  // Rain radar layer: the past 2 hours, 13 frames. Frames are loaded only while the layer is on
  // (and refreshed every 5 minutes); if loading fails the layer turns itself off.
  const [rainOn, setRainOn] = useState(() => store.get('maps.rain', '0') === '1')
  const [rainData, setRainData] = useState(null)
  const [rainIdx, setRainIdx] = useState(0)
  const [rainPlaying, setRainPlaying] = useState(false)
  // Two sources: 'radar' (RainViewer, detailed, 2 hours) and 'nasa' (NASA satellite, coarse, 6 hours,
  // several hours behind). If the radar cannot be loaded the page switches to NASA by itself.
  const [rainSrc, setRainSrc] = useState(() => (store.get('maps.rainSrc', 'radar') === 'nasa' ? 'nasa' : 'radar'))
  useEffect(() => { store.set('maps.rain', rainOn ? '1' : '0') }, [rainOn])
  useEffect(() => { store.set('maps.rainSrc', rainSrc) }, [rainSrc])
  useEffect(() => {
    if (!rainOn) { setRainPlaying(false); return undefined }
    let alive = true
    const pull = async (first) => {
      try {
        const d = await loadRainFrames(rainSrc)
        if (!alive) return
        setRainData(d)
        setRainIdx((i) => (first || i >= d.frames.length ? d.frames.length - 1 : i))
      } catch (e) {
        if (!alive) return
        if (rainSrc === 'radar') {
          try { // RainViewer is down or refuses us: NASA is the second choice
            await loadRainFrames('nasa')
            if (!alive) return
            setRainSrc('nasa') // the effect runs again and loads it
            say(`เรดาร์ RainViewer ใช้ไม่ได้ (${e.message}) — สลับไปใช้ข้อมูลดาวเทียม NASA แทน`, 7000)
            return
          } catch { /* both failed */ }
        }
        if (!alive) return
        setRainOn(false)
        say(`โหลดข้อมูลฝนไม่สำเร็จ (${e.message})`, 6000)
      }
    }
    pull(true)
    const t = setInterval(() => pull(false), 5 * 60 * 1000)
    return () => { alive = false; clearInterval(t) }
  }, [rainOn, rainSrc, say])
  useEffect(() => {
    if (!rainPlaying || !rainData) return undefined
    const t = setInterval(() => setRainIdx((i) => (i + 1) % rainData.frames.length), 700)
    return () => clearInterval(t)
  }, [rainPlaying, rainData])
  const rainReady = rainOn && rainData?.source === rainSrc // false for a moment after the source was switched
  const rainFrame = rainReady ? rainData.frames[Math.min(rainIdx, rainData.frames.length - 1)] : null
  const rain = useMemo(
    () => (rainFrame ? { template: rainFrame.template, maxZoom: rainData.maxZoom, credit: rainData.credit } : null),
    [rainFrame, rainData],
  )
  const pickRainSrc = (s) => { setRainPlaying(false); setRainSrc(s) }

  // Street View panel (opens over the map; each opening is counted by streetViewQuota.js)
  const [sv, setSv] = useState(null)

  // copy / Street View / add-to-plan buttons inside map popups
  const addCoordRef = useRef(null) // the latest addCoordStop (defined further down)
  useEffect(() => {
    const onClick = async (e) => {
      const addBtn = e.target.closest?.('.mpop-btn[data-addxy]')
      if (addBtn) { e.preventDefault(); addCoordRef.current?.(addBtn.dataset.addxy); return }
      const svBtn = e.target.closest?.('.mpop-btn[data-sv]')
      if (svBtn) {
        e.preventDefault()
        const [lat, lng] = svBtn.dataset.sv.split(',').map(Number)
        if (Number.isFinite(lat) && Number.isFinite(lng)) setSv({ lat, lng, key: Date.now() })
        return
      }
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

  // Offshore layer (DMF): production platforms (points) and concession blocks (areas).
  // Off by default; loaded the first time it is turned on. Public service, no login needed.
  const [showOff, setShowOff] = useState(() => store.get('maps.offshore', '0') === '1')
  const [showPlat, setShowPlat] = useState(true)
  const [showAreas, setShowAreas] = useState(true)
  const [off, setOff] = useState(() => {
    const c = cachedOffshore()
    return c ? { status: 'ready', ...c } : { status: 'idle', platforms: [], areas: null }
  })
  const loadOff = useCallback(async () => {
    setOff((s) => ({ ...s, status: 'loading' }))
    try {
      setOff({ status: 'ready', ...await loadOffshore() })
    } catch (e) {
      setOff((s) => ({ ...s, status: s.platforms.length ? 'ready' : 'error' }))
      say(`โหลดข้อมูลแท่นผลิต/แปลงสัมปทานไม่สำเร็จ (${e.message})`, 6000)
    }
  }, [say])
  useEffect(() => {
    store.set('maps.offshore', showOff ? '1' : '0')
    if (showOff && (off.status === 'idle' || off.status === 'error')) loadOff()
  }, [showOff]) // eslint-disable-line react-hooks/exhaustive-deps

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
  const reload = () => { load(); if (showSt) loadSt(); if (showOff) loadOff() }

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

  const colors = useMemo(() => new Map([...data.suppliers, ...st.brands, { name: PLATFORM_GROUP, color: PLATFORM_COLOR }]
    .map((s) => [s.name, s.color])), [data.suppliers, st.brands])
  const colorOf = useCallback((name) => colors.get(name) ?? OTHER_SUPPLIER_COLOR, [colors])

  // Tambon / amphoe / province of any coordinate, from boundary data kept on this device. The file
  // (a few MB) is loaded the first time it is needed: a double-click, a selected station, or a search.
  const [adminOk, setAdminOk] = useState(adminReady())
  const ensureAdmin = useCallback(() => (adminReady() ? Promise.resolve(true)
    : loadAdmin().then(() => { setAdminOk(true); return true }).catch(() => false)), [])
  const areaText = useMemo(() => (adminOk ? (p) => formatArea(areaOf(p.lat, p.lng)) : null), [adminOk])
  // id -> lowercase area names of every customer / fuel station, so a search can match "บางนา" or "ชลบุรี"
  const [areaIdx, setAreaIdx] = useState(null)
  useEffect(() => {
    if (!adminOk) return undefined
    let alive = true
    ;(async () => {
      const m = new Map()
      const all = [...data.points, ...st.points]
      for (let i = 0; i < all.length; i++) {
        m.set(all[i].id, areaSearchText(areaOf(all[i].lat, all[i].lng)))
        if (i % 1500 === 1499) { await new Promise((r) => setTimeout(r)); if (!alive) return } // let the page breathe
      }
      if (alive) setAreaIdx(m)
    })()
    return () => { alive = false }
  }, [adminOk, data.points, st.points])

  const term = typedPin ? '' : q.trim().toLowerCase() // a coordinate search shows every station, nearest first
  const matches = useCallback((p) => !term || p.name.toLowerCase().includes(term) || p.supplier.toLowerCase().includes(term)
    || `${p.lat},${p.lng}`.includes(term)
    || (p.station && `${p.station.where} ${p.station.address}`.toLowerCase().includes(term))
    || (p.platform && `${p.platform.operator} ${p.platform.operatorE} ${p.platform.field} ${p.platform.block} ${p.platform.lease}`.toLowerCase().includes(term))
    || (areaIdx?.get(p.id)?.includes(term) ?? false),
  [term, areaIdx])

  // A place picked on the map (double-click, or press and hold): its coordinates and area.
  const [picked, setPicked] = useState(null)
  const onPick = useCallback(async ({ lat, lng }) => {
    const key = Date.now()
    const base = { key, lat, lng }
    const fill = (status) => {
      const a = status === 'done' ? areaOf(lat, lng) : null
      setPicked((p) => (p?.key === key ? { ...base, status, areaText: a ? formatArea(a) : '', near: !!a?.near } : p))
    }
    setPicked({ ...base, status: adminReady() ? 'done' : 'loading', areaText: adminReady() ? formatArea(areaOf(lat, lng)) : '', near: !!(adminReady() && areaOf(lat, lng)?.near) })
    if (!adminReady()) fill((await ensureAdmin()) ? 'done' : 'error')
  }, [ensureAdmin])
  const pickedWithHtml = useMemo(() => (picked ? { ...picked, html: placePopupHtml(picked) } : null), [picked])

  // Points drawn on the map: supplier / brand toggles + search.
  const shownGeo = useMemo(() => data.points.filter((p) => !hidden.has(p.supplier) && matches(p)), [data.points, hidden, matches])
  const shownSt = useMemo(() => (showSt ? st.points.filter((p) => !hiddenBrands.has(p.supplier) && matches(p)) : []),
    [showSt, st.points, hiddenBrands, matches])
  const shownPlat = useMemo(() => (showOff && showPlat ? off.platforms.filter(matches) : []), [showOff, showPlat, off.platforms, matches])
  // Route planner: stops (the first is the start), the planned route and the fuel stations near it.
  const [plan, setPlan] = useState({ stops: [], route: null, along: null })
  const [planOpen, setPlanOpen] = useState(false)
  const [planBusy, setPlanBusy] = useState(false)
  const [alongLoading, setAlongLoading] = useState(false)
  // Fuel stations near the planned route are drawn even when the fuel layer is off (only those, a few dozen).
  const shownAlong = useMemo(() => (!showSt && plan.along ? plan.along.items.map((i) => i.p) : []), [showSt, plan.along])
  const shownAll = useMemo(
    () => (shownSt.length || shownPlat.length || shownAlong.length ? [...shownGeo, ...shownSt, ...shownPlat, ...shownAlong] : shownGeo),
    [shownGeo, shownSt, shownPlat, shownAlong],
  )
  // With the fuel stations near the route listed, only those and the stops stay on the map (the
  // other thousands of stations are hidden) until the switch in the planner is turned off.
  const [planFocus, setPlanFocus] = useState(true)
  const focusActive = !!plan.along && planFocus
  const shown = useMemo(() => {
    if (!focusActive) return shownAll
    const keep = new Set(plan.along.items.map((i) => i.p.id))
    plan.stops.forEach((s) => keep.add(s.id))
    return shownAll.filter((p) => keep.has(p.id))
  }, [focusActive, shownAll, plan.along, plan.stops])
  // Concession areas are drawn whole (they are not searched or filtered).
  const areas = showOff && showAreas ? off.areas : null

  // The 5 closest customer stations to my location (or the searched coordinate): dashed lines on
  // the map. With every customer station hidden, the 5 closest fuel stations, and with those hidden
  // too, the 5 closest offshore platforms. With both customer and fuel layers showing, the closest
  // fuel station is added to the "nearest" bar.
  // While the route view hides the other stations, the dashed lines to them are hidden too.
  const nearPool = focusActive ? EMPTY : shownGeo.length ? shownGeo : shownSt.length ? shownSt : shownPlat
  shownRef.current = nearPool
  const lineFrom = me ?? pin
  const nearest = useMemo(() => (lineFrom ? nearestTo(lineFrom, nearPool, 5) : []), [lineFrom, nearPool])
  const nearestPump = useMemo(() => (lineFrom && !focusActive && shownGeo.length && shownSt.length ? nearestTo(lineFrom, shownSt, 1)[0] : null),
    [lineFrom, focusActive, shownGeo.length, shownSt])

  // Points listed in the sidebar: same, optionally only inside the visible map area (nearest first).
  // With my location or a searched coordinate, distances are measured from it instead of the map center.
  const origin = me ?? pin ?? (inView ? center : null)
  const listed = useMemo(() => {
    const inside = inView && bounds
      ? shown.filter((p) => p.lat >= bounds.south && p.lat <= bounds.north && p.lng >= bounds.west && p.lng <= bounds.east)
      : shown
    return origin ? [...inside].sort((a, b) => distKm(origin, a) - distKm(origin, b)) : inside
  }, [shown, inView, bounds, origin])

  // A short count of what is inside the map window (shown only with "only points in the map area").
  const viewSum = useMemo(() => {
    if (!inView || !bounds) return null
    const c = new Map()
    for (const p of listed) c.set(p.supplier, (c.get(p.supplier) || 0) + 1)
    return { total: listed.length, parts: [...c].sort((a, b) => b[1] - a[1]).slice(0, 6) }
  }, [inView, bounds, listed])

  // Data to check in the Google Sheet: rows of one supplier at the same coordinates (a real duplicate;
  // the same site listed under different suppliers is normal), and the same name used at places more
  // than 100 m apart.
  const dups = useMemo(() => {
    const byXY = new Map(), byName = new Map()
    const push = (m, k, p) => { const g = m.get(k); if (g) g.push(p); else m.set(k, [p]) }
    for (const p of data.points) {
      push(byXY, `${p.supplier}|${p.lat.toFixed(5)},${p.lng.toFixed(5)}`, p)
      push(byName, p.name.toLowerCase().replace(/\s+/g, ' ').trim(), p)
    }
    const sameXY = [...byXY.values()].filter((g) => g.length > 1)
    const sameName = [...byName.values()].filter((g) => g.length > 1 && g.some((p) => distKm(g[0], p) > 0.1))
    return { sameXY, sameName }
  }, [data.points])

  useEffect(() => setLimit(PAGE), [q, hidden, hiddenBrands, showSt, showOff, showPlat, inView, pin, !me]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // a selected station shows its area too, so the boundary file is loaded when one is selected
  useEffect(() => { if (selected) ensureAdmin() }, [selected, ensureAdmin])

  // tap the "nearest" bar: show that station (while following, stop pulling the map back to me)
  const goNearest = (p) => { setLocked(false); setSelected(p) }

  // Real driving distance / time (OSRM, only when asked). drive = { from, items: { id: { km, min } }, route: { id, name, km, min, coords } | null }
  // It is dropped when my position or the searched coordinate moves more than 300 m, because it no longer fits.
  const [drive, setDrive] = useState(null)
  const [driveBusy, setDriveBusy] = useState(false)
  useEffect(() => {
    setDrive((d) => (d && lineFrom && distKm(d.from, lineFrom) <= 0.3 ? d : null))
  }, [lineFrom?.lat, lineFrom?.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  // Drive time / distance to the 5 nearest (one call), then the route to the quickest one (a second call).
  const driveNearest = async () => {
    const from = lineFrom
    const targets = nearest.filter((n) => n.p.kind !== 'platform')
    if (!from || !targets.length || driveBusy) return
    setDriveBusy(true)
    try {
      const res = await driveTable(from, targets.map((n) => n.p))
      const items = {}
      let best = null
      targets.forEach((n, i) => {
        if (!res[i]) return
        items[n.p.id] = res[i]
        if (!best || res[i].min < best.r.min) best = { p: n.p, r: res[i] }
      })
      if (!best) { say('ไม่พบเส้นทางถนนไปยังจุดใกล้เคียง', 5000); setDrive({ from: { ...from }, items, route: null }); return }
      const rt = await driveRoute(from, best.p)
      setDrive({ from: { ...from }, items, route: { id: best.p.id, name: best.p.name, ...rt } })
      if (best.p.id !== targets[0].p.id) {
        say(`ใกล้สุดเมื่อขับจริงคือ ${best.p.name} (${formatMin(best.r.min)}) ไม่ใช่จุดที่ใกล้สุดแบบเส้นตรง`, 8000)
      }
    } catch (e) {
      say(`คำนวณเส้นทางขับไม่สำเร็จ: ${e.message} (ยังแสดงระยะเส้นตรงตามเดิม)`, 7000)
    } finally {
      setDriveBusy(false)
    }
  }

  // Route to one chosen point (the selected station).
  const driveTo = async (p) => {
    const from = lineFrom
    if (!from || driveBusy) return
    setDriveBusy(true)
    try {
      const rt = await driveRoute(from, p)
      setDrive((d) => ({
        from: { ...from }, items: { ...(d && distKm(d.from, from) <= 0.3 ? d.items : {}), [p.id]: { km: rt.km, min: rt.min } },
        route: { id: p.id, name: p.name, ...rt },
      }))
    } catch (e) {
      say(`คำนวณเส้นทางขับไม่สำเร็จ: ${e.message}`, 7000)
    } finally {
      setDriveBusy(false)
    }
  }

  /* ---- route planner ---- */
  const stopOf = (p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng })
  // Changing the stops makes the planned route and the fuel list out of date, so they are dropped.
  const setStops = (fn) => setPlan((pl) => ({ stops: fn(pl.stops), route: null, along: null }))
  const addStop = (s) => {
    if (plan.stops.length >= MAX_STOPS) { say(`เพิ่มได้สูงสุด ${MAX_STOPS} จุด`, 3500); return }
    if (plan.stops.some((x) => x.id === s.id)) { say('จุดนี้อยู่ในแผนแล้ว', 2500); return }
    setStops((st0) => [...st0, s])
    setPlanOpen(true)
    say(`เพิ่ม "${s.name}" ในแผนเส้นทางแล้ว`, 2500)
  }
  // A stop typed as "lat, lng" (or a Google Maps link). Returns true when it was added.
  const addCoordStop = (text) => {
    const c = parseCoords(text)
    if (!c) { say('พิกัดไม่ถูกต้อง พิมพ์เป็น ละติจูด, ลองจิจูด เช่น 13.7563, 100.5018', 4500); return false }
    if (plan.stops.length >= MAX_STOPS) { say(`เพิ่มได้สูงสุด ${MAX_STOPS} จุด`, 3500); return false }
    addStop({ id: `xy:${c.lat.toFixed(6)},${c.lng.toFixed(6)}`, name: `พิกัด ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`, lat: c.lat, lng: c.lng })
    return true
  }
  addCoordRef.current = addCoordStop
  const addMeStop = () => {
    if (!me || plan.stops.some((x) => x.id === 'me')) return
    setStops((st0) => [{ id: 'me', name: 'ตำแหน่งของฉัน', lat: me.lat, lng: me.lng }, ...st0].slice(0, MAX_STOPS))
    setPlanOpen(true)
  }
  const removeStop = (i) => setStops((st0) => st0.filter((_, k) => k !== i))
  const clearPlan = () => setPlan({ stops: [], route: null, along: null })

  // Put the stops after the first one in the order with the least driving time (one OSRM call).
  const optimizePlan = async () => {
    if (plan.stops.length < 3 || planBusy) return
    setPlanBusy(true)
    try {
      const { dur } = await driveMatrix(plan.stops)
      const order = bestOrder(dur)
      if (!order) { say('ไม่พบลำดับที่ขับถึงครบทุกจุดได้ (บางจุดไม่มีถนนเชื่อมถึงกัน)', 6000); return }
      setStops((st0) => order.map((i) => st0[i]))
      const total = order.slice(1).reduce((s, j, k) => s + dur[order[k]][j], 0)
      say(`เรียงลำดับใหม่แล้ว: ขับรวมประมาณ ${formatMin(total)}`, 5000)
    } catch (e) {
      say(`เรียงลำดับไม่สำเร็จ: ${e.message}`, 6000)
    } finally {
      setPlanBusy(false)
    }
  }

  const buildPlan = async () => {
    if (plan.stops.length < 2 || planBusy) return
    setPlanBusy(true)
    try {
      const rt = await driveRouteVia(plan.stops)
      setPlan((pl) => ({ ...pl, route: rt, along: null }))
      setDrive((d) => (d ? { ...d, route: null } : d)) // one route on the map at a time
    } catch (e) {
      say(`คำนวณเส้นทางไม่สำเร็จ: ${e.message}`, 7000)
    } finally {
      setPlanBusy(false)
    }
  }

  // Fuel stations within radiusKm of the planned route (loads the station list the first time).
  const planFuel = async (radiusKm = plan.along?.radiusKm ?? (plan.route?.km > 200 ? 2 : 5)) => {
    if (!plan.route) return
    setAlongLoading(true)
    try {
      const all = st.status === 'ready' ? st : { status: 'ready', ...(cachedStations() ?? await loadStations()) }
      if (st.status !== 'ready') setSt(all)
      const { items, total } = alongRoute(plan.route.coords, all.points.filter((p) => !hiddenBrands.has(p.supplier)), radiusKm)
      setPlan((pl) => ({ ...pl, along: { items, radiusKm, scale: total ? plan.route.km / total : 1 } }))
    } catch (e) {
      say(`หาปั๊มตามเส้นทางไม่สำเร็จ: ${e.message}`, 6000)
    } finally {
      setAlongLoading(false)
    }
  }

  // Click a fuel station in the planner list: show it (and stop pulling the map back to me).
  const pickAlong = (p) => { setLocked(false); setSelected(p) }

  const shownRoute = plan.route ?? drive?.route ?? null

  const mapProps = {
    points: shown, colorOf, selected, onSelect: setSelected, type, view: view.current, onView, fitKey, pin,
    me, nearest, following, locked: following && locked, onUnlock: () => setLocked(false), focus, rain, areas,
    route: shownRoute, stops: plan.stops, picked: pickedWithHtml, onPick, areaText,
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
                + (showOff && showPlat && off.platforms.length ? ` · แท่นผลิต ${nf.format(off.platforms.length)} แห่ง` : '')
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
                onChange={(e) => { setQ(e.target.value); if (e.target.value.trim().length >= 2) ensureAdmin() }}
                onKeyDown={(e) => e.key === 'Enter' && setPin(typedPin)}
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

          <div className="sup-list st-list" role="group" aria-label="งานออฟชอร์: แท่นผลิตและแปลงสัมปทานปิโตรเลียม">
            <button type="button" className={`sup st-toggle off-toggle${showOff ? ' on' : ''}`} aria-pressed={showOff}
              onClick={() => setShowOff((v) => !v)}
              title={showOff ? 'ซ่อนงานออฟชอร์' : `แสดงแท่นผลิตและแปลงสัมปทานปิโตรเลียม (${DMF_CREDIT})`}>
              <Anchor size={13} />
              <span>งานออฟชอร์</span>
              <em>{off.status === 'loading' ? 'กำลังโหลด…' : showOff ? 'เปิด' : 'ปิด'}</em>
            </button>
            {showOff && off.status === 'ready' && (
              <>
                <button type="button" className={`sup${showPlat ? '' : ' off'}`} aria-pressed={showPlat} onClick={() => setShowPlat((v) => !v)}
                  title="แท่นผลิตปิโตรเลียม (คลิก = ซ่อน/แสดง)">
                  <i className="plat-dot" style={{ background: PLATFORM_COLOR }} />
                  <span>แท่นผลิต</span>
                  <em>{nf.format(off.platforms.length)}</em>
                </button>
                <button type="button" className={`sup${showAreas ? '' : ' off'}`} aria-pressed={showAreas} onClick={() => setShowAreas((v) => !v)}
                  title="แปลงสัมปทานปิโตรเลียม (คลิก = ซ่อน/แสดง)">
                  <i className="area-dot" style={{ borderColor: PLATFORM_COLOR }} />
                  <span>แปลงสัมปทาน</span>
                  <em>{nf.format(off.areas?.features.length ?? 0)}</em>
                </button>
              </>
            )}
          </div>

          <RoutePlanner
            stops={plan.stops} open={planOpen} onToggle={setPlanOpen} busy={planBusy} hasMe={!!me} onAddMe={addMeStop} onAddCoord={addCoordStop}
            focus={planFocus} onFocus={setPlanFocus}
            onRemove={removeStop} onClear={clearPlan} onOptimize={optimizePlan} onBuild={buildPlan} onFuel={planFuel}
            route={plan.route} along={plan.along} radiusKm={plan.along?.radiusKm ?? (plan.route?.km > 200 ? 2 : 5)} googleLink={googleDirections(plan.stops)}
            onPick={pickAlong} colorOf={colorOf} fuelLoading={alongLoading}
          />

          <label className="inview">
            <input type="checkbox" checked={inView} onChange={(e) => setInView(e.target.checked)} />
            <Crosshair size={14} /> เฉพาะจุดในขอบเขตแผนที่ (เรียงจากใกล้กึ่งกลาง)
          </label>
          {viewSum && (
            <p className="view-sum">
              ในจอนี้ <b>{nf.format(viewSum.total)}</b> จุด
              {viewSum.parts.map(([name, n]) => <span key={name}> · {name} {nf.format(n)}</span>)}
            </p>
          )}

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
                {nearest.some((n) => n.p.kind !== 'platform') && (
                  <button type="button" className="more" disabled={driveBusy} onClick={driveNearest}
                    title="คำนวณระยะและเวลาขับจริงไป 5 จุดที่ใกล้ที่สุด (ประมาณการสำหรับรถยนต์)">
                    <Car size={14} /> {driveBusy ? 'กำลังคำนวณ…' : 'ขับจริงไป 5 จุดใกล้สุด'}
                  </button>
                )}
                <button type="button" className="more" onClick={() => addStop({ id: `pin:${pin.lat},${pin.lng}`, name: `พิกัด ${pin.lat.toFixed(4)}, ${pin.lng.toFixed(4)}`, lat: pin.lat, lng: pin.lng })}>
                  <Route size={14} /> เพิ่มในแผน
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
              {areaText && <p className="area-line" title="ขอบเขตการปกครอง: กรมแผนที่ทหาร ผ่าน OCHA/HDX (CC BY-IGO) ค่าโดยประมาณ">📍 {areaText(selected)}</p>}
              <div className="picked-actions">
                <button type="button" className="more" onClick={() => copy(selected)}>
                  {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'คัดลอกแล้ว' : 'คัดลอกพิกัด'}
                </button>
                <a className="more" href={googleMapsLink(selected)} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={14} /> Google Maps
                </a>
                {selected.kind === 'platform' && (
                  <a className="more" href={windyLink(selected)} target="_blank" rel="noopener noreferrer">
                    <Wind size={14} /> ลม/คลื่น (Windy)
                  </a>
                )}
                {selected.kind !== 'platform' && (
                  <button type="button" className="more" onClick={() => addStop(stopOf(selected))}
                    title="เพิ่มจุดนี้ในแผนเส้นทาง (วางแผนเส้นทางหลายจุด ดูปั๊มตามทาง)">
                    <Route size={14} /> เพิ่มในแผน
                  </button>
                )}
                {selected.kind !== 'platform' && ( // no roads or street imagery out at sea
                  <>
                    {lineFrom && (
                      <button type="button" className="more" disabled={driveBusy} onClick={() => driveTo(selected)}
                        title="เส้นทางขับจากตำแหน่งของฉัน/พิกัดที่ค้นหา มาที่จุดนี้ (ประมาณการสำหรับรถยนต์)">
                        <Car size={14} /> {driveBusy ? 'กำลังคำนวณ…' : 'เส้นทางขับ'}
                      </button>
                    )}
                    <a className="more" href={navLink(selected)} target="_blank" rel="noopener noreferrer">
                      <Navigation size={14} /> นำทาง
                    </a>
                    <button type="button" className="more"
                      onClick={() => setSv({ lat: selected.lat, lng: selected.lng, name: selected.name, key: Date.now() })}>
                      <Eye size={14} /> Street View
                    </button>
                  </>
                )}
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
                    {drive?.items[p.id] && <b className="pdrive"> · ขับ {formatMin(drive.items[p.id].min)} ({drive.items[p.id].km.toFixed(1)} กม.)</b>}
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

          {(dups.sameXY.length > 0 || dups.sameName.length > 0) && (
            <details className="invalid dups">
              <summary><AlertTriangle size={14} /> ข้อมูลที่ควรตรวจ: แถวซ้ำ {nf.format(dups.sameXY.length)} กลุ่ม · ชื่อซ้ำแต่อยู่คนละที่ {nf.format(dups.sameName.length)} กลุ่ม</summary>
              {[['ผู้ให้บริการเดียวกัน พิกัดเดียวกัน หลายแถว', dups.sameXY], ['ชื่อเดียวกันแต่ห่างกันเกิน 100 ม.', dups.sameName]].map(([title, groups]) => groups.length > 0 && (
                <div key={title}>
                  <p className="muted dups-title">{title}</p>
                  <ul>
                    {groups.slice(0, 40).map((g) => (
                      <li key={g[0].id}>
                        <button type="button" className="dup-row" onClick={() => setSelected(g[0])}>
                          <span className="pname">{g[0].name}{g.length > 1 ? ` (${g.length} แถว)` : ''}</span>
                          <span className="pmeta">{g.map((p) => p.supplier).filter((s, i, a) => a.indexOf(s) === i).join(', ')} · {g[0].lat.toFixed(5)}, {g[0].lng.toFixed(5)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {groups.length > 40 && <p className="muted dups-title">แสดง 40 จาก {nf.format(groups.length)} กลุ่ม</p>}
                </div>
              ))}
            </details>
          )}

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
                    <span className="nb-label">{nearest[0].p.kind === 'station' ? '⛽ ปั๊มใกล้สุด' : nearest[0].p.kind === 'platform' ? 'แท่นใกล้สุด' : 'ใกล้สุด'}</span>
                    <span className="nb-name">{nearest[0].p.kind === 'station' ? `${nearest[0].p.supplier} · ` : ''}{nearest[0].p.name}</span>
                    <span className="nb-dist">{formatDist(nearest[0].km)}</span>
                    {drive?.items[nearest[0].p.id] && (
                      <span className="nb-drive-info">ขับ {formatMin(drive.items[nearest[0].p.id].min)}</span>
                    )}
                  </button>
                  {nearestPump && (
                    <button type="button" className="nb-row nb-pump" onClick={() => goNearest(nearestPump.p)} title="ไปที่ปั๊มนี้">
                      <i className="fuel-dot" style={{ background: colorOf(nearestPump.p.supplier), color: fuelInk(colorOf(nearestPump.p.supplier)) }}>⛽</i>
                      <span className="nb-label">ปั๊มใกล้สุด</span>
                      <span className="nb-name">{nearestPump.p.supplier} · {nearestPump.p.name}</span>
                      <span className="nb-dist">{formatDist(nearestPump.km)}</span>
                    </button>
                  )}
                  {nearest.some((n) => n.p.kind !== 'platform') && (
                    <button type="button" className="nb-row nb-pump nb-drive-btn" disabled={driveBusy} onClick={driveNearest}
                      title="คำนวณระยะและเวลาขับจริงไป 5 จุดที่ใกล้ที่สุด (ประมาณการสำหรับรถยนต์ ไม่รวมรถติด)">
                      <Car size={13} />
                      {driveBusy ? 'กำลังคำนวณเส้นทางขับ…' : drive ? 'คำนวณเส้นทางขับใหม่' : 'ดูเส้นทางขับจริง ไป 5 จุดใกล้สุด'}
                    </button>
                  )}
                </div>
              )}

              <div className="map-tools">
                <button type="button" className={`loc-btn${rainOn ? ' follow rain-on' : ''}`} aria-pressed={rainOn}
                  onClick={() => setRainOn((v) => !v)} title={rainOn ? 'ปิดเรดาร์ฝน' : 'เรดาร์ฝน (ย้อนหลัง 2 ชั่วโมง)'} aria-label="เรดาร์ฝน">
                  <CloudRain size={19} />
                </button>
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
          {sv && <StreetViewPanel at={sv} onClose={() => setSv(null)} />}
          {/* Bottom-center items stack on their own, so they never sit on top of each other. */}
          <div className="map-stack">
            {note && <div className="map-note" role="status">{note.text}</div>}
            {shownRoute && (
              <div className="route-chip" role="status">
                <Car size={14} />
                <span className="route-text">
                  {plan.route
                    ? <>แผนเส้นทาง {plan.stops.length} จุด · {plan.route.km.toFixed(1)} กม. · {formatMin(plan.route.min)}</>
                    : <>ขับไป <b>{drive.route.name}</b> · {drive.route.km.toFixed(1)} กม. · {formatMin(drive.route.min)}</>}
                </span>
                <span className="route-note" title="คำนวณสำหรับรถยนต์บนถนน OpenStreetMap ไม่รวมรถติด รถบรรทุกจะช้ากว่า">โดยประมาณ</span>
                <a className="route-credit" href={OSRM_CREDIT.url} target="_blank" rel="noopener noreferrer">{OSRM_CREDIT.name}</a>
                <button type="button" className="x" aria-label="ซ่อนเส้นทาง"
                  onClick={() => (plan.route ? setPlan((pl) => ({ ...pl, route: null, along: null })) : setDrive((d) => (d ? { ...d, route: null } : d)))}>
                  <X size={14} />
                </button>
              </div>
            )}
            {rainOn && rainData && (
              <div className="rain-bar" role="group" aria-label="ชั้นฝน">
                <div className="rain-row">
                  <div className="rain-src" role="radiogroup" aria-label="แหล่งข้อมูลฝน">
                    <button type="button" role="radio" aria-checked={rainSrc === 'radar'} className={rainSrc === 'radar' ? 'on' : ''}
                      onClick={() => pickRainSrc('radar')} title="เรดาร์ฝน (RainViewer): ละเอียด เกือบเรียลไทม์ ย้อนหลัง 2 ชั่วโมง">เรดาร์</button>
                    <button type="button" role="radio" aria-checked={rainSrc === 'nasa'} className={rainSrc === 'nasa' ? 'on' : ''}
                      onClick={() => pickRainSrc('nasa')} title="ดาวเทียม NASA: หยาบ (ราว 10 กม.) ช้ากว่าปัจจุบันหลายชั่วโมง ย้อนหลัง 6 ชั่วโมง">ดาวเทียม</button>
                  </div>
                  <a className="rain-credit" href={rainData.credit.url} target="_blank" rel="noopener noreferrer">{rainData.credit.name}</a>
                </div>
                <div className="rain-row">
                  <button type="button" className="rain-play" disabled={!rainFrame} onClick={() => setRainPlaying((p) => !p)}
                    aria-label={rainPlaying ? 'หยุดเล่น' : 'เล่นย้อนหลัง'} title={rainPlaying ? 'หยุดเล่น' : 'เล่นย้อนหลัง'}>
                    {rainPlaying ? <Pause size={15} /> : <Play size={15} />}
                  </button>
                  <input type="range" min={0} max={rainData.frames.length - 1} value={Math.min(rainIdx, rainData.frames.length - 1)}
                    disabled={!rainFrame} onChange={(e) => { setRainPlaying(false); setRainIdx(Number(e.target.value)) }} aria-label="เวลาของข้อมูลฝน" />
                  <span className="rain-time">
                    {rainFrame ? (
                      <>
                        {rainTimeLabel(rainFrame.time)} น.
                        {rainIdx >= rainData.frames.length - 1 ? ` · ล่าสุด${lagLabel(rainData.lagMs) ? ` (${lagLabel(rainData.lagMs)})` : ''}` : ''}
                      </>
                    ) : 'กำลังโหลด…'}
                  </span>
                </div>
              </div>
            )}
          </div>
          {data.status === 'loading' && <div className="map-msg"><MapPin size={18} /> กำลังโหลดพิกัด…</div>}
          {data.error && data.status === 'ready' && <div className="map-toast">โหลดข้อมูลล่าสุดไม่สำเร็จ แสดงข้อมูลชุดก่อนหน้า</div>}
        </section>
      </div>
    </div>
  )
}
