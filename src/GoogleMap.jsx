import { useEffect, useRef, useState } from 'react'
import { MarkerClusterer } from '@googlemaps/markerclusterer'
import { GOOGLE_MAPS_KEY, popupHtml } from './mapsData'

/* ---------- load the Google Maps script once ---------- */

let loader = null
let authFailed = false
const authListeners = new Set()

function loadGoogleMaps() {
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

// Dark roadmap that matches the site.
const DARK = [
  { elementType: 'geometry', stylers: [{ color: '#1d1b16' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#a1a1aa' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#111' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#4a4232' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2c2a24' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#5a4a1c' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#facc15' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0b1a26' }] },
]

const MAP_TYPES = { road: 'roadmap', dark: 'roadmap', satellite: 'satellite', hybrid: 'hybrid' }

const clusterSvg = (size) => 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="19" fill="#facc15" fill-opacity=".28"/>
    <circle cx="20" cy="20" r="14" fill="#facc15" stroke="#1a1400" stroke-width="1.5"/></svg>`)

const renderer = {
  render({ count, position }) {
    const size = count < 10 ? 34 : count < 100 ? 40 : count < 1000 ? 48 : 56
    return new window.google.maps.Marker({
      position,
      icon: { url: clusterSvg(size), scaledSize: new window.google.maps.Size(size, size), anchor: new window.google.maps.Point(size / 2, size / 2) },
      label: { text: count >= 1000 ? (count / 1000).toFixed(1) + 'k' : String(count), color: '#1a1400', fontWeight: '700', fontSize: '12px' },
      zIndex: 1000 + count,
    })
  },
}

export default function GoogleMap({ points, colorOf, selected, onSelect, type, view, onView, fitKey }) {
  const box = useRef(null)
  const map = useRef(null)
  const clusterer = useRef(null)
  const markers = useRef(new Map())
  const highlight = useRef(null)
  const info = useRef(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(authFailed ? 'auth' : null)
  const cb = useRef({ onSelect, onView })
  cb.current = { onSelect, onView }

  // load script + create map once
  useEffect(() => {
    let live = true
    const onAuth = () => live && setError('auth')
    authListeners.add(onAuth)
    loadGoogleMaps().then((gm) => {
      if (!live) return
      const m = new gm.Map(box.current, {
        center: { lat: view.lat, lng: view.lng }, zoom: view.zoom,
        disableDefaultUI: true, zoomControl: true, scaleControl: true, fullscreenControl: false,
        gestureHandling: 'greedy', clickableIcons: false,
      })
      m.addListener('idle', () => {
        const c = m.getCenter(), b = m.getBounds()
        if (!b) return
        const ne = b.getNorthEast(), sw = b.getSouthWest()
        cb.current.onView({ lat: c.lat(), lng: c.lng(), zoom: m.getZoom() },
          { south: sw.lat(), west: sw.lng(), north: ne.lat(), east: ne.lng() })
      })
      info.current = new gm.InfoWindow()
      clusterer.current = new MarkerClusterer({ map: m, renderer })
      map.current = m
      setReady(true)
    }).catch((e) => live && setError(e.message))
    return () => {
      live = false
      authListeners.delete(onAuth)
      clusterer.current?.clearMarkers()
      highlight.current?.setMap(null)
      markers.current.clear()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // map type
  useEffect(() => {
    if (!ready) return
    map.current.setOptions({ mapTypeId: MAP_TYPES[type] ?? 'roadmap', styles: type === 'dark' ? DARK : null })
  }, [ready, type])

  // markers
  useEffect(() => {
    if (!ready) return
    const gm = window.google.maps
    const list = points.map((p) => {
      let mk = markers.current.get(p.id)
      if (!mk) {
        mk = new gm.Marker({
          position: { lat: p.lat, lng: p.lng }, title: p.name,
          icon: { path: gm.SymbolPath.CIRCLE, scale: 6, fillColor: colorOf(p.supplier), fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1.5 },
        })
        mk.addListener('click', () => cb.current.onSelect(p))
        markers.current.set(p.id, mk)
      }
      return mk
    })
    clusterer.current.clearMarkers()
    clusterer.current.addMarkers(list)
  }, [ready, points, colorOf])

  useEffect(() => {
    if (!ready || !fitKey || !points.length) return
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
    map.current.panTo(pos)
    if (map.current.getZoom() < 16) map.current.setZoom(17)
    info.current.setContent(popupHtml(selected, colorOf(selected.supplier)))
    info.current.open({ map: map.current, anchor: highlight.current })
  }, [ready, selected, colorOf])

  return (
    <div className="map-canvas">
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
