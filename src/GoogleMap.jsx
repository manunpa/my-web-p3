import { useEffect, useRef, useState } from 'react'
import Supercluster from 'supercluster'
import { GOOGLE_MAPS_KEY, popupHtml } from './mapsData'

/* ---------- load the Google Maps script once ---------- */

let loader = null
let authFailed = false
const authListeners = new Set()

// Safe to call early (e.g. when the maps page opens): loading the script is not a billed map load.
export function preloadGoogleMaps() {
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps)
  if (loader) return loader
  loader = new Promise((resolve, reject) => {
    window.__gmapsReady = () => resolve(window.google.maps)
    // Google calls this when the key is invalid, not enabled, or not allowed on this website.
    window.gm_authFailure = () => { authFailed = true; authListeners.forEach((f) => f()) }
    const s = document.createElement('script')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_KEY)}` +
      '&v=weekly&loading=async&language=th&region=TH&callback=__gmapsReady'
    s.async = true
    s.onerror = () => { loader = null; reject(new Error('โหลด Google Maps ไม่สำเร็จ ตรวจการเชื่อมต่ออินเทอร์เน็ต')) }
    document.head.append(s)
  })
  return loader
}

// Fewer things to draw: hide points of interest and transit everywhere.
const LEAN = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
]

// Dark roadmap that matches the site.
const DARK = [
  ...LEAN,
  { elementType: 'geometry', stylers: [{ color: '#1d1b16' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#a1a1aa' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#111' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#4a4232' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2c2a24' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#5a4a1c' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#facc15' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0b1a26' }] },
]

const MAP_TYPES = { road: 'roadmap', dark: 'roadmap', satellite: 'satellite', hybrid: 'hybrid' }

const clusterSvg = (size) => 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="19" fill="#facc15" fill-opacity=".28"/>
    <circle cx="20" cy="20" r="14" fill="#facc15" stroke="#1a1400" stroke-width="1.5"/></svg>`)

const clusterSize = (n) => (n < 10 ? 34 : n < 100 ? 40 : n < 1000 ? 48 : 56)

/*
 * Instead of creating one Google marker per point (11k+ markers is slow), the points are
 * clustered with Supercluster and only the clusters / points inside the visible area are
 * drawn - usually a few hundred markers at most. Markers are re-used between redraws.
 */
export default function GoogleMap({ points, colorOf, selected, onSelect, type, view, onView, fitKey, active }) {
  const box = useRef(null)
  const map = useRef(null)
  const index = useRef(null)
  const byId = useRef(new Map())
  const drawn = useRef(new Map()) // key -> marker currently on the map
  const highlight = useRef(null)
  const info = useRef(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(authFailed ? 'auth' : null)
  const live = useRef({ onSelect, onView, colorOf, active })
  live.current = { onSelect, onView, colorOf, active }

  // Draw the clusters / points for the current view.
  const redraw = () => {
    const m = map.current
    const b = m?.getBounds()
    if (!m || !b || !index.current) return
    const gm = window.google.maps
    const ne = b.getNorthEast(), sw = b.getSouthWest()
    const west = sw.lng(), east = ne.lng()
    const bbox = west <= east ? [west, sw.lat(), east, ne.lat()] : [-180, sw.lat(), 180, ne.lat()]
    const features = index.current.getClusters(bbox, Math.round(m.getZoom()))

    const keep = new Set()
    for (const f of features) {
      const [lng, lat] = f.geometry.coordinates
      const c = f.properties
      const key = c.cluster ? `c${c.cluster_id}:${c.point_count}` : `p${c.id}`
      keep.add(key)
      if (drawn.current.has(key)) continue
      let mk
      if (c.cluster) {
        const n = c.point_count, size = clusterSize(n)
        mk = new gm.Marker({
          position: { lat, lng }, map: m, zIndex: 1000 + n,
          icon: { url: clusterSvg(size), scaledSize: new gm.Size(size, size), anchor: new gm.Point(size / 2, size / 2) },
          label: { text: n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n), color: '#1a1400', fontWeight: '700', fontSize: '12px' },
        })
        const id = c.cluster_id
        mk.addListener('click', () => {
          m.panTo({ lat, lng })
          m.setZoom(Math.min(index.current.getClusterExpansionZoom(id), 18))
        })
      } else {
        const p = byId.current.get(c.id)
        mk = new gm.Marker({
          position: { lat, lng }, map: m, title: p.name,
          icon: { path: gm.SymbolPath.CIRCLE, scale: 6, fillColor: live.current.colorOf(p.supplier), fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1.5 },
        })
        mk.addListener('click', () => live.current.onSelect(p))
      }
      drawn.current.set(key, mk)
    }
    for (const [key, mk] of drawn.current) {
      if (!keep.has(key)) { mk.setMap(null); drawn.current.delete(key) }
    }
  }

  const clearDrawn = () => {
    for (const mk of drawn.current.values()) mk.setMap(null)
    drawn.current.clear()
  }

  // load script + create the map once (it is kept alive while the page is open)
  useEffect(() => {
    let alive = true
    const onAuth = () => alive && setError('auth')
    authListeners.add(onAuth)
    preloadGoogleMaps().then((gm) => {
      if (!alive) return
      const m = new gm.Map(box.current, {
        center: { lat: view.lat, lng: view.lng }, zoom: view.zoom,
        disableDefaultUI: true, zoomControl: true, scaleControl: true,
        gestureHandling: 'greedy', clickableIcons: false, keyboardShortcuts: false,
        isFractionalZoomEnabled: false, styles: LEAN,
      })
      m.addListener('idle', () => {
        redraw()
        if (!live.current.active) return
        const c = m.getCenter(), b = m.getBounds()
        if (!b) return
        const ne = b.getNorthEast(), sw = b.getSouthWest()
        live.current.onView({ lat: c.lat(), lng: c.lng(), zoom: m.getZoom() },
          { south: sw.lat(), west: sw.lng(), north: ne.lat(), east: ne.lng() })
      })
      info.current = new gm.InfoWindow()
      map.current = m
      setReady(true)
    }).catch((e) => alive && setError(e.message))
    return () => {
      alive = false
      authListeners.delete(onAuth)
      clearDrawn()
      highlight.current?.setMap(null)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // map type
  useEffect(() => {
    if (!ready) return
    map.current.setOptions({ mapTypeId: MAP_TYPES[type] ?? 'roadmap', styles: type === 'dark' ? DARK : LEAN })
  }, [ready, type])

  // (re)build the cluster index when the visible set or colors change
  useEffect(() => {
    if (!ready) return
    byId.current = new Map(points.map((p) => [p.id, p]))
    index.current = new Supercluster({ radius: 60, maxZoom: 16 }).load(points.map((p) => ({
      type: 'Feature', properties: { id: p.id }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    })))
    clearDrawn()
    redraw()
  }, [ready, points, colorOf]) // eslint-disable-line react-hooks/exhaustive-deps

  // when this map becomes the visible one, jump to the shared view
  useEffect(() => {
    if (!ready || !active) return
    map.current.setCenter({ lat: view.lat, lng: view.lng })
    map.current.setZoom(Math.round(view.zoom))
  }, [ready, active]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready || !fitKey || !active || !points.length) return
    const b = new window.google.maps.LatLngBounds()
    points.forEach((p) => b.extend({ lat: p.lat, lng: p.lng }))
    map.current.fitBounds(b, 30)
  }, [ready, fitKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // selected point
  useEffect(() => {
    if (!ready) return
    const gm = window.google.maps
    highlight.current?.setMap(null)
    info.current.close()
    if (!selected) return
    const pos = { lat: selected.lat, lng: selected.lng }
    highlight.current = new gm.Marker({
      position: pos, map: map.current, zIndex: 99999,
      icon: { path: gm.SymbolPath.CIRCLE, scale: 11, fillColor: colorOf(selected.supplier), fillOpacity: 1, strokeColor: '#facc15', strokeWeight: 3 },
    })
    if (!active) return
    map.current.panTo(pos)
    if (map.current.getZoom() < 16) map.current.setZoom(17)
    info.current.setContent(popupHtml(selected, colorOf(selected.supplier)))
    info.current.open({ map: map.current, anchor: highlight.current })
  }, [ready, selected, colorOf]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="map-canvas" hidden={!active}>
      <div ref={box} className="map-fill" />
      {!ready && !error && <div className="map-msg">กำลังโหลด Google Maps…</div>}
      {error && (
        <div className="map-msg err">
          {error === 'auth' ? (
            <>
              <strong>Google Maps ปฏิเสธ API key นี้</strong>
              <span>ตรวจใน Google Cloud Console ว่าเปิด Maps JavaScript API และเปิด Billing แล้ว
                และเพิ่มเว็บไซต์นี้ ({location.host}) ไว้ในรายการที่อนุญาตของ key</span>
            </>
          ) : <span>{error}</span>}
        </div>
      )}
    </div>
  )
}
