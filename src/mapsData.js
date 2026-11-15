/* ------------------------------------------------------------------ */
/* Data + keys for the Maps page                                        */
/* ------------------------------------------------------------------ */

// Google Sheet (Apps Script) returning [{ Geofence, Latitude, Longitude, Supplier, ... }]
export const GEOFENCE_API_URL =
  'https://script.google.com/macros/s/AKfycbxGxDaEkB1IVbzSbMFkMJ08zfx9n9qIRDReGx9Mb-bg2n5C0jh8KuiwDnGjdjTvuVCF/exec'

// Google Maps JavaScript API key. A browser key is always visible to visitors, so it MUST be
// restricted in Google Cloud Console -> Credentials -> this key:
//   Application restrictions: Websites -> manunpa.github.io/* and localhost:5173/*
//   API restrictions: Maps JavaScript API only
export const GOOGLE_MAPS_KEY = 'AIzaSyBX7FmeGhUSMBh_vIUM2x-YS_cp2_LtSh8'

// Rough box around Thailand and neighbours; points outside are listed as invalid.
const BOUNDS = { latMin: 5, latMax: 21, lngMin: 97, lngMax: 106 }

// Supplier colors: fixed categorical order, assigned by supplier size (largest first).
const SUPPLIER_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9', '#0ca30c', '#e66767']
export const OTHER_SUPPLIER_COLOR = '#898781'

const num = (v) => {
  if (typeof v === 'number') return v
  const s = String(v ?? '').replace(/,/g, '').trim()
  return s === '' ? NaN : Number(s)
}

const pick = (row, ...names) => {
  const keys = Object.keys(row)
  for (const n of names) {
    const k = keys.find((x) => x.trim().toLowerCase() === n.toLowerCase())
    if (k) return row[k]
  }
  return ''
}

/* ---------- cache: the Apps Script takes 5-7 s, so show the last result straight away ---------- */

const CACHE_KEY = 'geofences.v1'
let memory = null

// Last loaded data (from this visit, or saved in the browser), or null.
export function cachedGeofences() {
  if (memory) return memory
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) memory = JSON.parse(raw)
  } catch { /* storage blocked or corrupt */ }
  return memory
}

function remember(data) {
  memory = data
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)) } catch { /* quota / private mode */ }
}

export async function loadGeofences() {
  const data = await fetchGeofences()
  remember({ ...data, at: Date.now() })
  return memory
}

async function fetchGeofences() {
  const res = await fetch(GEOFENCE_API_URL, { cache: 'no-store' })
  if (!res.ok) throw new Error(`โหลดข้อมูลพิกัดไม่สำเร็จ (HTTP ${res.status})`)
  const json = await res.json()
  const rows = Array.isArray(json) ? json : (json.data ?? json.rows ?? [])

  const valid = []
  const invalid = []
  rows.forEach((row, id) => {
    const name = String(pick(row, 'Geofence', 'ชื่อสถานี', 'name')).replace(/\s+/g, ' ').trim() || '(ไม่มีชื่อ)'
    const supplier = String(pick(row, 'Supplier', 'ผู้ให้บริการ')).trim() || '(ไม่ระบุ)'
    const lat = num(pick(row, 'Latitude', 'Lat'))
    const lng = num(pick(row, 'Longitude', 'Lng', 'Long', 'Lon'))
    const p = { id, name, supplier, lat, lng, rawLat: pick(row, 'Latitude', 'Lat'), rawLng: pick(row, 'Longitude', 'Lng', 'Long', 'Lon') }
    const ok = Number.isFinite(lat) && Number.isFinite(lng)
      && lat >= BOUNDS.latMin && lat <= BOUNDS.latMax && lng >= BOUNDS.lngMin && lng <= BOUNDS.lngMax
    if (ok) valid.push(p)
    else invalid.push({ ...p, problem: !String(p.rawLat).trim() || !String(p.rawLng).trim() ? 'พิกัดว่าง' : 'พิกัดอยู่นอกพื้นที่' })
  })

  const counts = new Map()
  for (const p of [...valid, ...invalid]) counts.set(p.supplier, (counts.get(p.supplier) || 0) + 1)
  const suppliers = [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([name, total], i) => ({
      name, total,
      mapped: valid.filter((p) => p.supplier === name).length,
      color: SUPPLIER_COLORS[i] ?? OTHER_SUPPLIER_COLOR,
    }))

  return { points: valid, invalid, suppliers }
}

export const googleMapsLink = (p) => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`

export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// Popup / info-window HTML shared by both map engines. Values from the sheet are escaped.
export function popupHtml(p, color) {
  return `<div class="mpop">
    <div class="mpop-sup"><i style="background:${color}"></i>${escapeHtml(p.supplier)}</div>
    <strong>${escapeHtml(p.name)}</strong>
    <code>${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</code>
    <a href="${googleMapsLink(p)}" target="_blank" rel="noopener">เปิดใน Google Maps ↗</a>
  </div>`
}
