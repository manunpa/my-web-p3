import { useEffect, useRef } from 'react'
import L from './leafletGlobal'
import 'leaflet.markercluster'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import { popupHtml } from './mapsData'

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
}

const clusterIcon = (cluster) => {
  const n = cluster.getChildCount()
  const size = n < 10 ? 34 : n < 100 ? 40 : n < 1000 ? 48 : 56
  return L.divIcon({
    html: `<span>${n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n}</span>`,
    className: 'gcluster',
    iconSize: [size, size],
  })
}

// points: visible points. colorOf(supplier). selected: point or null. onSelect(point).
// view: { lat, lng, zoom } to start from. onView(view, bounds) on every move.
export default function LeafletMap({ points, colorOf, selected, onSelect, type, view, onView, fitKey }) {
  const box = useRef(null)
  const map = useRef(null)
  const tiles = useRef(null)
  const cluster = useRef(null)
  const markers = useRef(new Map())
  const highlight = useRef(null)
  const cb = useRef({ onSelect, onView })
  cb.current = { onSelect, onView }

  // create the map once
  useEffect(() => {
    // maxZoom must be set before the cluster layer is added
    const m = L.map(box.current, { zoomControl: false, preferCanvas: true, worldCopyJump: true, minZoom: 3, maxZoom: 19 })
      .setView([view.lat, view.lng], view.zoom)
    L.control.zoom({ position: 'bottomright' }).addTo(m)
    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(m)
    cluster.current = L.markerClusterGroup({
      chunkedLoading: true, showCoverageOnHover: false, maxClusterRadius: 55,
      spiderfyOnMaxZoom: true, iconCreateFunction: clusterIcon,
    }).addTo(m)
    const report = () => {
      const c = m.getCenter(), b = m.getBounds()
      cb.current.onView({ lat: c.lat, lng: c.lng, zoom: m.getZoom() },
        { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() })
    }
    m.on('moveend', report)
    map.current = m
    report()
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(box.current)
    return () => { ro.disconnect(); m.remove(); map.current = null; markers.current.clear() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // base layer
  useEffect(() => {
    const t = TILES[type] ?? TILES.road
    tiles.current?.remove()
    tiles.current = L.tileLayer(t.url, t.opts).addTo(map.current)
    tiles.current.bringToBack()
  }, [type])

  // markers (created once per point, re-used when filters change)
  useEffect(() => {
    const layers = points.map((p) => {
      let mk = markers.current.get(p.id)
      if (!mk) {
        mk = L.circleMarker([p.lat, p.lng], {
          radius: 6, weight: 1.5, color: '#fff', fillColor: colorOf(p.supplier), fillOpacity: 1,
        })
        mk.on('click', () => cb.current.onSelect(p))
        markers.current.set(p.id, mk)
      }
      return mk
    })
    cluster.current.clearLayers()
    cluster.current.addLayers(layers)
  }, [points, colorOf])

  // zoom to all points when asked (first load)
  useEffect(() => {
    if (!fitKey || !points.length) return
    map.current.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [30, 30] })
  }, [fitKey]) // eslint-disable-line react-hooks/exhaustive-deps

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
    highlight.current.bindPopup(popupHtml(selected, colorOf(selected.supplier)), { className: 'dark-popup', offset: [0, -10] })
    m.flyTo(ll, Math.max(m.getZoom(), 16), { duration: 0.9 })
    const t = setTimeout(() => highlight.current?.openPopup(), 950)
    return () => clearTimeout(t)
  }, [selected, colorOf])

  return <div className="map-canvas" ref={box} />
}
