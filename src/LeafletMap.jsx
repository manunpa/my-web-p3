import { useEffect, useRef } from 'react'
import L from './leafletGlobal'
import 'leaflet.markercluster'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import {
  pointPopupHtml, pinPopupHtml, myPopupHtml, PIN_SVG, nearStyle, labelT, formatDist, stationSvg, platformSvg, areaPopupHtml,
} from './mapsData'
import { areaColor } from './offshoreData'
import { createGlide, ACC_CIRCLE_MAX_M } from './myLocation'
import { RAIN_SHOW_MAX_ZOOM, RAIN_OPACITY } from './rainRadar'

const TILES = {
  road: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    opts: { subdomains: 'abc', maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' },
  },
  // Standard OSM tiles darkened with a CSS filter (.tiles-dark) - free, no API key.
  dark: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    opts: { subdomains: 'abc', maxZoom: 19, className: 'tiles-dark', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' },
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    opts: { maxZoom: 19, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics' },
  },
  // Free topographic map (contours + hill shading). Its tiles stop at zoom 17; closer zooms enlarge them.
  terrain: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    opts: {
      subdomains: 'abc', maxNativeZoom: 17, maxZoom: 19,
      attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM · Style &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    },
  },
}

// fuel station marker: brand-colored circle with a pump glyph (one icon per color)
const stationIcons = new Map()
const stationIcon = (color) => {
  if (!stationIcons.has(color)) {
    stationIcons.set(color, L.divIcon({ className: 'st-marker', html: stationSvg(color), iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -11] }))
  }
  return stationIcons.get(color)
}

// offshore platform marker: a diamond in the platform color
const platformIcons = new Map()
const platformIcon = (color) => {
  if (!platformIcons.has(color)) {
    platformIcons.set(color, L.divIcon({ className: 'st-marker', html: platformSvg(color), iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -11] }))
  }
  return platformIcons.get(color)
}

// Gold clusters for customer and fuel stations, blue ones (gcluster-plat) for offshore platforms.
const makeClusterIcon = (cls) => (cluster) => {
  const n = cluster.getChildCount()
  const size = n < 10 ? 34 : n < 100 ? 40 : n < 1000 ? 48 : 56
  return L.divIcon({
    html: `<span>${n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n}</span>`,
    className: cls,
    iconSize: [size, size],
  })
}
const clusterIcon = makeClusterIcon('gcluster')
const platClusterIcon = makeClusterIcon('gcluster gcluster-plat')

// points: visible points. colorOf(supplier). selected: point or null. onSelect(point).
// view: { lat, lng, zoom } to start from. onView(view, bounds) on every move.
// me: my GPS position or null. nearest: [{ p, km }] closest to `me` (or to `pin`).
// following: follow mode is on; locked: keep me in the middle. onUnlock() when the user drags.
// focus: { key, pts } -> zoom to show all pts.
export default function LeafletMap({
  points, colorOf, selected, onSelect, type, view, onView, fitKey, active, pin,
  me, nearest, following, locked, onUnlock, focus, rain, areas, route, stops, picked, onPick, areaText, vias, onRouteClick, onViaDrag,
}) {
  const box = useRef(null)
  const map = useRef(null)
  const tiles = useRef(null)
  const cluster = useRef(null)
  const platCluster = useRef(null)
  const markers = useRef(new WeakMap()) // point object -> marker
  const highlight = useRef(null)
  const pinMk = useRef(null)
  const meMk = useRef(null)
  const accC = useRef(null)
  const lines = useRef(null)
  const pairs = useRef([]) // [{ line, label, to, i }]
  const glide = useRef(null)
  const quiet = useRef(false) // true while following moves the map: do not report every frame
  const cursor = useRef(null)
  const cb = useRef({})
  cb.current = { onSelect, onView, active, locked, onUnlock, onPick, areaText, onRouteClick, onViaDrag }

  // Distance labels sit on their line, measured in screen pixels from the start.
  const placeLabels = (from) => {
    const m = map.current
    if (!m || m._animatingZoom) return
    const a = m.latLngToContainerPoint(from)
    for (const pr of pairs.current) {
      const b = m.latLngToContainerPoint(pr.to)
      const t = labelT(a.distanceTo(b), pr.i)
      pr.label.setLatLng(m.containerPointToLatLng(a.add(b.subtract(a).multiplyBy(t))))
    }
  }
  const lineStart = () => glide.current?.pos ?? pin

  // create the map once
  useEffect(() => {
    // maxZoom must be set before the cluster layer is added
    // Double-click picks a place (shows its coordinates and area) instead of zooming in; zoom with the
    // buttons, the wheel or two fingers. On a phone, press and hold does the same.
    const m = L.map(box.current, { zoomControl: false, preferCanvas: true, worldCopyJump: true, minZoom: 3, maxZoom: 19, doubleClickZoom: false })
      .setView([view.lat, view.lng], view.zoom)
    let lastPick = 0
    const pick = (ll) => {
      if (Date.now() - lastPick < 400) return // a long press can raise two events
      lastPick = Date.now()
      cb.current.onPick?.({ lat: ll.lat, lng: ll.lng })
    }
    m.on('dblclick', (e) => pick(e.latlng))
    m.on('contextmenu', (e) => pick(e.latlng))
    let hold = null
    const stopHold = () => { clearTimeout(hold); hold = null }
    box.current.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || e.target.closest('.leaflet-control, .leaflet-marker-icon, .leaflet-popup')) return
      const { clientX, clientY } = e
      stopHold()
      hold = setTimeout(() => { hold = null; pick(m.mouseEventToLatLng({ clientX, clientY })) }, 650)
      const move = (ev) => { if (Math.hypot(ev.clientX - clientX, ev.clientY - clientY) > 10) { stopHold(); off() } }
      const off = () => { stopHold(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', off); window.removeEventListener('pointercancel', off) }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', off)
      window.addEventListener('pointercancel', off)
    })
    L.control.zoom({ position: 'bottomright' }).addTo(m)
    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(m)
    cluster.current = L.markerClusterGroup({
      chunkedLoading: true, showCoverageOnHover: false, maxClusterRadius: 55,
      spiderfyOnMaxZoom: true, iconCreateFunction: clusterIcon,
    }).addTo(m)
    platCluster.current = L.markerClusterGroup({
      chunkedLoading: true, showCoverageOnHover: false, maxClusterRadius: 55,
      spiderfyOnMaxZoom: true, iconCreateFunction: platClusterIcon,
    }).addTo(m)
    lines.current = L.layerGroup().addTo(m)
    const report = () => {
      if (!cb.current.active || quiet.current) return // a hidden map must not overwrite the shared view
      const c = m.getCenter(), b = m.getBounds()
      cb.current.onView({ lat: c.lat, lng: c.lng, zoom: m.getZoom() },
        { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() })
    }
    m.on('moveend', report)
    m.on('dragstart', () => cb.current.onUnlock?.())
    m.on('mousemove', (e) => { if (cursor.current) cursor.current.textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}` })
    m.on('mouseout', () => { if (cursor.current) cursor.current.textContent = '' })
    let relayout = null
    m.on('zoomend moveend resize', () => {
      clearTimeout(relayout)
      relayout = setTimeout(() => { const f = lineStart(); if (f) placeLabels([f.lat, f.lng]) }, 150)
    })
    map.current = m

    // every frame while the blue dot glides: move the dot, the lines, and (when locked) the map
    glide.current = createGlide((pos, done) => {
      const ll = [pos.lat, pos.lng]
      meMk.current?.setLatLng(ll)
      accC.current?.setLatLng(ll)
      for (const pr of pairs.current) pr.line.setLatLngs([ll, pr.to])
      placeLabels(ll)
      if (cb.current.locked && cb.current.active && !m._animatingZoom) {
        quiet.current = !done
        m.panTo(ll, { animate: false })
        quiet.current = false
      }
    })

    report()
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(box.current)
    return () => {
      ro.disconnect(); clearTimeout(relayout); glide.current.stop()
      m.remove(); map.current = null; markers.current = new WeakMap()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // base layer
  useEffect(() => {
    const t = TILES[type] ?? TILES.road
    tiles.current?.remove()
    tiles.current = L.tileLayer(t.url, t.opts).addTo(map.current)
    tiles.current.bringToBack()
  }, [type])

  // rain layer: one tile layer, its URL is swapped for each frame (and when the source changes)
  const rainLayer = useRef(null)
  const rainUrl = rain?.template ?? null
  const rainMax = rain?.maxZoom ?? 7
  const rainCredit = rain?.credit ?? null
  useEffect(() => {
    if (!rainUrl) { rainLayer.current?.remove(); rainLayer.current = null; return }
    const attribution = rainCredit ? `Rain &copy; <a href="${rainCredit.url}">${rainCredit.name}</a>` : ''
    // a new source gets a new layer (the credit shown in the corner of the map is fixed when it is added)
    if (rainLayer.current && rainLayer.current.options.attribution !== attribution) {
      rainLayer.current.remove()
      rainLayer.current = null
    }
    if (rainLayer.current) { rainLayer.current.setUrl(rainUrl); return }
    rainLayer.current = L.tileLayer(rainUrl, {
      opacity: RAIN_OPACITY, maxNativeZoom: rainMax, maxZoom: RAIN_SHOW_MAX_ZOOM, zIndex: 10, attribution,
    }).addTo(map.current)
  }, [rainUrl, rainMax, rainCredit])

  // route planner stops: numbered blue dots (at most 9)
  const stopLayer = useRef(null)
  useEffect(() => {
    stopLayer.current?.remove()
    stopLayer.current = null
    if (!stops?.length) return
    stopLayer.current = L.layerGroup(stops.map((s, i) => L.marker([s.lat, s.lng], {
      zIndexOffset: 5000, title: `${i + 1}. ${s.name}`,
      icon: L.divIcon({ className: 'stop-marker', html: `<span>${i + 1}</span>`, iconSize: [24, 24], iconAnchor: [12, 12] }),
      interactive: false,
    }))).addTo(map.current)
  }, [stops])

  // driving route: a blue line with a white edge, zoomed to fit
  const routeLayer = useRef(null)
  useEffect(() => {
    routeLayer.current?.remove()
    routeLayer.current = null
    if (!route?.coords?.length) return
    const layers = [
      L.polyline(route.coords, { color: '#fff', weight: 9, opacity: 0.85, lineCap: 'round', lineJoin: 'round', interactive: false }),
      L.polyline(route.coords, { color: '#1a73e8', weight: 5, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false }),
    ]
    // A wide invisible line on top: clicking it adds a via point (only for the planner's route).
    if (route.editable) {
      layers.push(L.polyline(route.coords, { color: '#000', weight: 22, opacity: 0, interactive: true, bubblingMouseEvents: false, className: 'route-hit' })
        .on('click', (e) => cb.current.onRouteClick?.({ lat: e.latlng.lat, lng: e.latlng.lng })))
    }
    routeLayer.current = L.layerGroup(layers).addTo(map.current)
    if (!route.keepView && cb.current.active) map.current.fitBounds(L.latLngBounds(route.coords), { padding: [60, 60], maxZoom: 16 })
  }, [route])

  // via points of the planner's route: drag one to make the route go another way
  const viaLayer = useRef(null)
  useEffect(() => {
    viaLayer.current?.remove()
    viaLayer.current = null
    if (!vias?.length) return
    viaLayer.current = L.layerGroup(vias.map((v, i) => L.marker([v.lat, v.lng], {
      draggable: true, zIndexOffset: 6000, title: 'จุดผ่าน: ลากเพื่อปรับเส้นทาง',
      icon: L.divIcon({ className: 'via-marker', html: '<span></span>', iconSize: [18, 18], iconAnchor: [9, 9] }),
    }).on('dragend', (e) => { const p = e.target.getLatLng(); cb.current.onViaDrag?.(i, { lat: p.lat, lng: p.lng }) }))).addTo(map.current)
  }, [vias])

  // concession areas (offshore layer): outlines with a light fill, click for details
  const areaLayer = useRef(null)
  useEffect(() => {
    areaLayer.current?.remove()
    areaLayer.current = null
    if (!areas) return
    areaLayer.current = L.geoJSON(areas, {
      style: (f) => ({ color: areaColor(f.properties), weight: 1.4, dashArray: '6 4', fillColor: areaColor(f.properties), fillOpacity: 0.1 }),
      onEachFeature: (f, layer) => layer.bindPopup(areaPopupHtml(f.properties), { className: 'dark-popup', maxWidth: 300 }),
    }).addTo(map.current)
  }, [areas])

  // markers (created once per point, re-used when filters change)
  useEffect(() => {
    const plats = []
    const layers = []
    for (const p of points) {
      let mk = markers.current.get(p)
      if (!mk) {
        mk = p.kind === 'station'
          ? L.marker([p.lat, p.lng], { icon: stationIcon(colorOf(p.supplier)), title: p.name })
          : p.kind === 'platform'
            ? L.marker([p.lat, p.lng], { icon: platformIcon(colorOf(p.supplier)), title: p.name })
            : L.circleMarker([p.lat, p.lng], {
            radius: 6, weight: 1.5, color: '#fff', fillColor: colorOf(p.supplier), fillOpacity: 1,
          })
        mk.on('click', () => cb.current.onSelect(p))
        markers.current.set(p, mk)
      }
      ;(p.kind === 'platform' ? plats : layers).push(mk)
    }
    cluster.current.clearLayers()
    cluster.current.addLayers(layers)
    platCluster.current.clearLayers()
    platCluster.current.addLayers(plats)
  }, [points, colorOf])

  // when this map becomes the visible one, jump to the shared view
  useEffect(() => {
    if (!active) return
    const m = map.current
    m.invalidateSize()
    m.setView([view.lat, view.lng], Math.round(view.zoom), { animate: false })
  }, [active]) // eslint-disable-line react-hooks/exhaustive-deps

  // zoom to all points when asked (first load)
  useEffect(() => {
    if (!fitKey || !active || !points.length) return
    map.current.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [30, 30] })
  }, [fitKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // zoom to show a set of points (my location + the nearest ones)
  useEffect(() => {
    if (!focus || !active) return
    map.current.flyToBounds(L.latLngBounds(focus.pts.map((p) => [p.lat, p.lng])), { padding: [70, 70], maxZoom: 16, duration: 0.8 })
  }, [focus]) // eslint-disable-line react-hooks/exhaustive-deps

  // selected point: gold ring + popup
  useEffect(() => {
    highlight.current?.remove()
    highlight.current = null
    if (!selected) return
    const m = map.current
    const ll = [selected.lat, selected.lng]
    // A real marker (not canvas) so it sits above the clusters.
    highlight.current = L.marker(ll, {
      zIndexOffset: 10000,
      icon: L.divIcon({
        className: 'hl-marker', iconSize: [26, 26],
        html: `<span style="background:${colorOf(selected.supplier)}"></span>`,
      }),
    }).addTo(m)
    highlight.current.bindPopup(pointPopupHtml(selected, colorOf(selected.supplier), cb.current.areaText?.(selected) ?? ''), { className: 'dark-popup', offset: [0, -10], maxWidth: 300 })
    if (!cb.current.active) return
    m.flyTo(ll, Math.max(m.getZoom(), 16), { duration: 0.9 })
    const t = setTimeout(() => highlight.current?.openPopup(), 950)
    return () => clearTimeout(t)
  }, [selected, colorOf])

  // the boundary file arrived after the popup was built: add the area line to it
  const hasArea = !!areaText
  useEffect(() => {
    if (selected && highlight.current) highlight.current.setPopupContent(pointPopupHtml(selected, colorOf(selected.supplier), areaText?.(selected) ?? ''))
  }, [hasArea]) // eslint-disable-line react-hooks/exhaustive-deps

  // a place picked by double-click / long press: a popup with its coordinates and area
  const pickPopup = useRef(null)
  useEffect(() => {
    const m = map.current
    if (!picked) { pickPopup.current?.remove(); pickPopup.current = null; return }
    if (pickPopup.current && pickPopup.current.__key === picked.key) { pickPopup.current.setContent(picked.html); return }
    pickPopup.current?.remove()
    const pp = L.popup({ className: 'dark-popup', maxWidth: 300, autoPanPadding: [30, 30] }).setLatLng([picked.lat, picked.lng]).setContent(picked.html)
    pp.__key = picked.key
    pp.openOn(m)
    pickPopup.current = pp
  }, [picked])

  // searched coordinate: red pin + popup
  useEffect(() => {
    pinMk.current?.remove()
    pinMk.current = null
    if (!pin) return
    const m = map.current
    const ll = [pin.lat, pin.lng]
    pinMk.current = L.marker(ll, {
      zIndexOffset: 20000,
      icon: L.divIcon({ className: 'pin-marker', html: PIN_SVG, iconSize: [30, 40], iconAnchor: [15, 39], popupAnchor: [0, -36] }),
    }).addTo(m).bindPopup(pinPopupHtml(pin), { className: 'dark-popup' })
    if (!cb.current.active) return
    m.flyTo(ll, Math.max(m.getZoom(), 15), { duration: 0.9 })
    const t = setTimeout(() => pinMk.current?.openPopup(), 950)
    return () => clearTimeout(t)
  }, [pin])

  // keep the pin popup's "nearest" line current
  useEffect(() => { if (pin && pinMk.current) pinMk.current.setPopupContent(pinPopupHtml(pin, nearest[0])) }, [pin, nearest])

  // my location: blue dot + accuracy circle, gliding to each new fix
  useEffect(() => {
    const m = map.current
    if (!me) {
      meMk.current?.remove(); accC.current?.remove()
      meMk.current = accC.current = null
      glide.current.stop()
      return
    }
    if (!meMk.current) {
      accC.current = L.circle([me.lat, me.lng], {
        radius: me.acc, color: '#1a73e8', weight: 1, opacity: 0.5, fillColor: '#1a73e8', fillOpacity: 0.12, interactive: false,
      }).addTo(m)
      meMk.current = L.marker([me.lat, me.lng], {
        zIndexOffset: 30000,
        icon: L.divIcon({ className: '', html: '<div class="mypos"><span class="mypos-arrow"></span></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
      }).addTo(m).bindPopup('', { className: 'dark-popup' })
    }
    accC.current.setRadius(me.acc)
    // A huge circle (no GPS, position guessed from the network) would cover the whole map: hide it.
    const showAcc = me.acc <= ACC_CIRCLE_MAX_M
    accC.current.setStyle({ opacity: showAcc ? 0.5 : 0, fillOpacity: showAcc ? 0.12 : 0 })
    meMk.current.setPopupContent(myPopupHtml(me, following, nearest[0]))
    const el = meMk.current.getElement()?.querySelector('.mypos')
    if (el) {
      el.classList.toggle('moving', me.heading !== null)
      if (me.heading !== null) el.style.setProperty('--hd', `${me.heading}deg`)
    }
    glide.current.set(me, following)
  }, [me, following, nearest])

  // dashed lines to the nearest points, with a distance label on each
  useEffect(() => {
    lines.current.clearLayers()
    pairs.current = []
    const f = lineStart()
    if (!f) return
    const from = [f.lat, f.lng]
    const renderer = L.svg({ padding: 0.5 })
    nearest.forEach(({ p, km }, i) => {
      const s = nearStyle(i), to = [p.lat, p.lng]
      const line = L.polyline([from, to], {
        color: s.color, weight: s.weight, opacity: s.opacity, dashArray: '6 6', interactive: false,
        renderer, className: `nearline ${s.cls}`,
      }).addTo(lines.current)
      const label = L.marker(from, {
        icon: L.divIcon({ className: 'distlabel-wrap', html: `<span class="distlabel ${s.cls}">${formatDist(km)}</span>`, iconSize: null }),
        interactive: false, keyboard: false, zIndexOffset: 900 - i * 20,
      }).addTo(lines.current)
      pairs.current.push({ line, label, to, i })
    })
    // the red and yellow lines on top of the blue ones
    pairs.current[1]?.line.bringToFront()
    pairs.current[0]?.line.bringToFront()
    placeLabels(from)
  }, [nearest, pin, me]) // eslint-disable-line react-hooks/exhaustive-deps

  // pressing "back to me" while following: glide the map back
  useEffect(() => {
    const p = glide.current?.pos
    if (locked && active && p) map.current.panTo([p.lat, p.lng])
  }, [locked]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="map-canvas" hidden={!active}>
      <div ref={box} className="map-fill" />
      <div ref={cursor} className="cursor-coords" aria-hidden="true" />
    </div>
  )
}
