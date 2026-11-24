import { useEffect, useRef, useState } from 'react'
import Supercluster from 'supercluster'
import {
  GOOGLE_MAPS_KEY, pointPopupHtml, pinPopupHtml, myPopupHtml, PIN_SVG, nearStyle, labelT, formatDist, stationSvg, platformSvg, areaPopupHtml,
} from './mapsData'
import { areaColor, PLATFORM_COLOR } from './offshoreData'
import { GOOGLE_MAPS_DAILY_LIMIT, takeGoogleMapLoad, consumeGoogleMapLoad } from './mapsQuota'
import { createGlide, ACC_CIRCLE_MAX_M } from './myLocation'
import { radarTileElement } from './rainRadar'

// Distance label drawn as a small SVG pill (Google marker labels cannot have a background).
const distIcon = (gm, text, i) => {
  const s = nearStyle(i)
  const w = Math.round(text.length * 6.6 + 14), h = 18
  const bg = i < 2 ? s.color : '#ffffff'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`
    + `<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="8" fill="${bg}" stroke="${s.color}"/>`
    + `<text x="${w / 2}" y="13" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" font-weight="600" fill="${s.text}">${text}</text></svg>`
  return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg), scaledSize: new gm.Size(w, h), anchor: new gm.Point(w / 2, h / 2) }
}

const DASH_PERIOD_PX = 12 // length of one dash + gap on the nearest-station lines

const myIcon =(gm, heading) => (heading === null
  ? { path: gm.SymbolPath.CIRCLE, scale: 8, fillColor: '#1a73e8', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 }
  : { path: gm.SymbolPath.FORWARD_CLOSED_ARROW, scale: 6, rotation: heading, fillColor: '#1a73e8', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 })

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

// Lets other parts of the page (Street View) know when Google refuses the key.
export const googleAuthFailed = () => authFailed
export function watchGoogleAuth(cb) {
  authListeners.add(cb)
  return () => authListeners.delete(cb)
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

const MAP_TYPES = { road: 'roadmap', dark: 'roadmap', satellite: 'satellite', hybrid: 'hybrid', terrain: 'terrain' }

// Gold clusters for customer and fuel stations, blue ones for offshore platforms.
const CLUSTER_STYLE = {
  gold: { fill: '#facc15', stroke: '#1a1400', text: '#1a1400' },
  plat: { fill: PLATFORM_COLOR, stroke: '#0b3a47', text: '#ffffff' },
}
const clusterSvg = (size, kind = 'gold') => 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="19" fill="${CLUSTER_STYLE[kind].fill}" fill-opacity=".28"/>
    <circle cx="20" cy="20" r="14" fill="${CLUSTER_STYLE[kind].fill}" stroke="${CLUSTER_STYLE[kind].stroke}" stroke-width="1.5"/></svg>`)

const clusterSize = (n) => (n < 10 ? 34 : n < 100 ? 40 : n < 1000 ? 48 : 56)

/*
 * Instead of creating one Google marker per point (11k+ markers is slow), the points are
 * clustered with Supercluster and only the clusters / points inside the visible area are
 * drawn - usually a few hundred markers at most. Markers are re-used between redraws.
 */
export default function GoogleMap({
  points, colorOf, selected, onSelect, type, view, onView, fitKey, active, pin,
  me, nearest, following, locked, onUnlock, focus, overlays, onFail, rain, areas,
}) {
  const box = useRef(null)
  const map = useRef(null)
  const index = useRef(null)
  const platIndex = useRef(null)
  const byId = useRef(new Map())
  const drawn = useRef(new Map()) // key -> marker currently on the map
  const highlight = useRef(null)
  const pinMk = useRef(null)
  const info = useRef(null)
  const meMk = useRef(null)
  const accC = useRef(null)
  const pairs = useRef([]) // [{ line, label, to, i }]
  const glide = useRef(null)
  const cursor = useRef(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(authFailed ? 'auth' : null)
  const live = useRef({})
  live.current = { onSelect, onView, colorOf, active, locked, onUnlock, me, following, nearest, onFail }

  // Google Maps cannot be used (daily limit reached, key refused, script or quota check failed):
  // tell the page, which switches to OpenStreetMap by itself.
  useEffect(() => { if (error) live.current.onFail?.(error) }, [error])

  // Distance labels sit on their line, measured in screen pixels from the start.
  const placeLabels = (from) => {
    const m = map.current, proj = m?.getProjection()
    if (!proj) return
    const s = 2 ** m.getZoom(), gm = window.google.maps
    const a = proj.fromLatLngToPoint(from)
    for (const pr of pairs.current) {
      const b = proj.fromLatLngToPoint(pr.to)
      const t = labelT(Math.hypot(b.x - a.x, b.y - a.y) * s, pr.i)
      pr.label.setPosition(proj.fromPointToLatLng(new gm.Point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)))
    }
  }
  const lineStart = () => glide.current?.pos ?? pin

  // Draw the clusters / points for the current view.
  const redraw = () => {
    const m = map.current
    const b = m?.getBounds()
    if (!m || !b || !index.current) return
    const gm = window.google.maps
    const ne = b.getNorthEast(), sw = b.getSouthWest()
    const west = sw.lng(), east = ne.lng()
    const bbox = west <= east ? [west, sw.lat(), east, ne.lat()] : [-180, sw.lat(), 180, ne.lat()]
    const zoom = Math.round(m.getZoom())
    // two indexes: customer / fuel stations ('g') and offshore platforms ('o')
    const sources = [['g', 'gold', index.current], ['o', 'plat', platIndex.current]].filter((s) => s[2])

    const keep = new Set()
    for (const [tag, kind, idx] of sources) for (const f of idx.getClusters(bbox, zoom)) {
      const [lng, lat] = f.geometry.coordinates
      const c = f.properties
      const key = c.cluster ? `${tag}c${c.cluster_id}:${c.point_count}` : `${tag}p${c.id}`
      keep.add(key)
      if (drawn.current.has(key)) continue
      let mk
      if (c.cluster) {
        const n = c.point_count, size = clusterSize(n)
        mk = new gm.Marker({
          position: { lat, lng }, map: m, zIndex: 1000 + n,
          icon: { url: clusterSvg(size, kind), scaledSize: new gm.Size(size, size), anchor: new gm.Point(size / 2, size / 2) },
          label: { text: n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n), color: CLUSTER_STYLE[kind].text, fontWeight: '700', fontSize: '12px' },
        })
        const id = c.cluster_id
        mk.addListener('click', () => {
          m.panTo({ lat, lng })
          m.setZoom(Math.min(idx.getClusterExpansionZoom(id), 18))
        })
      } else {
        const p = byId.current.get(c.id)
        const color = live.current.colorOf(p.supplier)
        mk = new gm.Marker({
          position: { lat, lng }, map: m, title: p.name,
          icon: p.kind === 'station' || p.kind === 'platform'
            ? {
              url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent((p.kind === 'station' ? stationSvg : platformSvg)(color)),
              scaledSize: new gm.Size(22, 22), anchor: new gm.Point(11, 11),
            }
            : { path: gm.SymbolPath.CIRCLE, scale: 6, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1.5 },
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
    Promise.all([preloadGoogleMaps(), takeGoogleMapLoad()]).then(([gm, quota]) => {
      if (!alive) return // keep the counted load for the next time the map opens
      consumeGoogleMapLoad()
      if (!quota.ok) { setError('quota'); return }
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
      m.addListener('dragstart', () => live.current.onUnlock?.())
      m.addListener('mousemove', (e) => { if (cursor.current) cursor.current.textContent = `${e.latLng.lat().toFixed(5)}, ${e.latLng.lng().toFixed(5)}` })
      m.addListener('mouseout', () => { if (cursor.current) cursor.current.textContent = '' })
      m.addListener('zoom_changed', () => { const f = lineStart(); if (f) placeLabels(f) })
      info.current = new gm.InfoWindow()
      map.current = m
      // every frame while the blue dot glides: move the dot, the lines, and (when locked) the map
      glide.current = createGlide((pos) => {
        meMk.current?.setPosition(pos)
        accC.current?.setCenter(pos)
        for (const pr of pairs.current) pr.line.setPath([pos, pr.to])
        placeLabels(pos)
        if (live.current.locked && live.current.active) m.setCenter(pos)
      })
      setReady(true)
    }).catch((e) => alive && setError(e.code === 'permission-denied' || e.code === 'unavailable'
      ? 'ตรวจสอบโควต้า Google Maps ไม่สำเร็จ จึงยังไม่โหลดแผนที่ (เพื่อไม่ให้เกิดค่าใช้จ่าย) ลองใหม่ภายหลัง หรือใช้ OpenStreetMap'
      : e.message))
    return () => {
      alive = false
      authListeners.delete(onAuth)
      clearDrawn()
      glide.current?.stop()
      highlight.current?.setMap(null)
      pinMk.current?.setMap(null)
      meMk.current?.setMap(null)
      accC.current?.setMap(null)
      pairs.current.forEach((pr) => { pr.line.setMap(null); pr.label.setMap(null) })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // map type
  useEffect(() => {
    if (!ready) return
    map.current.setOptions({ mapTypeId: MAP_TYPES[type] ?? 'roadmap', styles: type === 'dark' ? DARK : LEAN })
  }, [ready, type])

  // traffic / transit / bicycling layers (part of the normal map: no extra map loads)
  const layers = useRef(null)
  useEffect(() => {
    if (!ready) return
    const gm = window.google.maps
    layers.current ??= { traffic: new gm.TrafficLayer(), transit: new gm.TransitLayer(), bike: new gm.BicyclingLayer() }
    for (const [id, layer] of Object.entries(layers.current)) {
      const want = overlays?.has(id) ? map.current : null
      if (layer.getMap() !== want) layer.setMap(want)
    }
  }, [ready, overlays])

  // rain radar: a custom tile layer, replaced for each frame
  const rainUrl = rain?.template ?? null
  const rainMax = rain?.maxZoom ?? 7
  useEffect(() => {
    if (!ready) return
    const gm = window.google.maps
    const layers = map.current.overlayMapTypes
    layers.clear()
    if (!rainUrl) return
    layers.push({
      tileSize: new gm.Size(256, 256), minZoom: 0, maxZoom: 19, name: 'rain',
      getTile: (coord, zoom, doc) => radarTileElement(doc, rainUrl, coord, zoom, rainMax),
      releaseTile: () => {},
    })
  }, [ready, rainUrl, rainMax])

  // concession areas (offshore layer): a Data layer with outlines and a light fill, click for details
  const areaData = useRef(null)
  useEffect(() => {
    if (!ready) return
    const gm = window.google.maps
    if (!areaData.current) {
      const d = new gm.Data({ map: map.current })
      d.setStyle((f) => {
        const c = areaColor({ shore: f.getProperty('shore') })
        return { strokeColor: c, strokeWeight: 1.4, strokeOpacity: 0.9, fillColor: c, fillOpacity: 0.1, clickable: true }
      })
      d.addListener('click', (e) => {
        const props = {}
        e.feature.forEachProperty((v, k) => { props[k] = v })
        info.current.setContent(areaPopupHtml(props))
        info.current.setPosition(e.latLng)
        info.current.open({ map: map.current, shouldFocus: false })
      })
      areaData.current = d
    }
    const d = areaData.current
    const old = []
    d.forEach((f) => old.push(f))
    old.forEach((f) => d.remove(f))
    if (areas) d.addGeoJson(areas)
  }, [ready, areas])

  // (re)build the cluster index when the visible set or colors change
  useEffect(() => {
    if (!ready) return
    byId.current = new Map(points.map((p) => [p.id, p]))
    const load = (list) => new Supercluster({ radius: 60, maxZoom: 16 }).load(list.map((p) => ({
      type: 'Feature', properties: { id: p.id }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    })))
    index.current = load(points.filter((p) => p.kind !== 'platform'))
    platIndex.current = load(points.filter((p) => p.kind === 'platform'))
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
    info.current.setContent(pointPopupHtml(selected, colorOf(selected.supplier)))
    info.current.open({ map: map.current, anchor: highlight.current, shouldFocus: false })
  }, [ready, selected, colorOf]) // eslint-disable-line react-hooks/exhaustive-deps

  // searched coordinate: red pin + info window
  useEffect(() => {
    if (!ready) return
    const gm = window.google.maps
    pinMk.current?.setMap(null)
    pinMk.current = null
    if (!pin) return
    const pos = { lat: pin.lat, lng: pin.lng }
    pinMk.current = new gm.Marker({
      position: pos, map: map.current, zIndex: 100000,
      icon: { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(PIN_SVG), scaledSize: new gm.Size(30, 40), anchor: new gm.Point(15, 39) },
    })
    pinMk.current.addListener('click', () => {
      info.current.setContent(pinPopupHtml(pin, live.current.nearest[0]))
      info.current.open({ map: map.current, anchor: pinMk.current, shouldFocus: false })
    })
    if (!active) return
    map.current.panTo(pos)
    if (map.current.getZoom() < 15) map.current.setZoom(15)
    info.current.setContent(pinPopupHtml(pin))
    info.current.open({ map: map.current, anchor: pinMk.current, shouldFocus: false })
  }, [ready, pin]) // eslint-disable-line react-hooks/exhaustive-deps

  // zoom to show a set of points (my location + the nearest ones)
  useEffect(() => {
    if (!ready || !focus || !active) return
    const gm = window.google.maps, m = map.current
    const b = new gm.LatLngBounds()
    focus.pts.forEach((p) => b.extend({ lat: p.lat, lng: p.lng }))
    m.fitBounds(b, 70)
    gm.event.addListenerOnce(m, 'idle', () => { if (m.getZoom() > 16) m.setZoom(16) })
  }, [ready, focus]) // eslint-disable-line react-hooks/exhaustive-deps

  // my location: blue dot (an arrow while driving) + accuracy circle, gliding to each new fix
  useEffect(() => {
    if (!ready) return
    const gm = window.google.maps
    if (!me) {
      meMk.current?.setMap(null); accC.current?.setMap(null)
      meMk.current = accC.current = null
      glide.current.stop()
      return
    }
    if (!meMk.current) {
      accC.current = new gm.Circle({
        map: map.current, center: me, radius: me.acc, clickable: false,
        strokeColor: '#1a73e8', strokeOpacity: 0.5, strokeWeight: 1, fillColor: '#1a73e8', fillOpacity: 0.12,
      })
      meMk.current = new gm.Marker({ map: map.current, position: me, zIndex: 200000 })
      meMk.current.addListener('click', () => {
        const l = live.current
        info.current.setContent(myPopupHtml(l.me, l.following, l.nearest[0]))
        info.current.open({ map: map.current, anchor: meMk.current, shouldFocus: false })
      })
    }
    meMk.current.setIcon(myIcon(gm, me.heading))
    accC.current.setRadius(me.acc)
    accC.current.setVisible(me.acc <= ACC_CIRCLE_MAX_M) // a huge circle (position guessed from the network) would cover the map
    glide.current.set(me, following)
  }, [ready, me, following])

  // dashed lines to the nearest points, with a distance label on each
  useEffect(() => {
    if (!ready) return
    const gm = window.google.maps
    pairs.current.forEach((pr) => { pr.line.setMap(null); pr.label.setMap(null) })
    pairs.current = []
    const from = lineStart()
    if (!from) return
    nearest.forEach(({ p, km }, i) => {
      const s = nearStyle(i), to = { lat: p.lat, lng: p.lng }
      // The dashes are repeated symbols along the line; the flow animation below moves their offset.
      const icon = { path: 'M 0,-1 0,1', strokeColor: s.color, strokeOpacity: s.opacity, scale: s.weight }
      const line = new gm.Polyline({
        map: map.current, path: [from, to], clickable: false, strokeOpacity: 0, zIndex: 50 - i,
        icons: [{ icon, offset: '0px', repeat: DASH_PERIOD_PX + 'px' }],
      })
      const label = new gm.Marker({ map: map.current, position: from, clickable: false, zIndex: 150000 - i, icon: distIcon(gm, formatDist(km), i) })
      pairs.current.push({ line, label, to, i, icon })
    })
    placeLabels(from)
  }, [ready, nearest, pin, me]) // eslint-disable-line react-hooks/exhaustive-deps

  // Flowing dashes, like the OpenStreetMap map: the nearest line runs faster than the others.
  // Runs only while this map is visible and the tab is in front, and not for people who asked for less motion.
  useEffect(() => {
    if (!ready || !active || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0, last = 0
    const frame = (now) => {
      raf = requestAnimationFrame(frame)
      if (document.hidden || now - last < 40) return // about 25 updates a second is plenty
      last = now
      for (const pr of pairs.current) {
        const period = pr.i === 0 ? 700 : 1000 // ms for one dash length
        pr.line.set('icons', [{ icon: pr.icon, offset: `${((now % period) / period) * DASH_PERIOD_PX}px`, repeat: DASH_PERIOD_PX + 'px' }])
      }
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [ready, active])

  // pressing "back to me" while following: move the map back
  useEffect(() => {
    const p = glide.current?.pos
    if (ready && locked && active && p) map.current.panTo(p)
  }, [ready, locked]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="map-canvas" hidden={!active}>
      <div ref={box} className="map-fill" />
      <div ref={cursor} className="cursor-coords" aria-hidden="true" />
      {!ready && !error && <div className="map-msg">กำลังโหลด Google Maps…</div>}
      {error && (
        <div className="map-msg err">
          {error === 'quota' ? (
            <>
              <strong>วันนี้ใช้ Google Maps ครบ {GOOGLE_MAPS_DAILY_LIMIT} ครั้งแล้ว</strong>
              <span>จำกัดไว้เพื่อไม่ให้เกินโควต้าฟรีของ Google ใช้ OpenStreetMap ไปก่อน แล้วเปิดใหม่ได้พรุ่งนี้ (นับใหม่ตอนเที่ยงคืน)</span>
            </>
          ) : error === 'auth' ? (
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
