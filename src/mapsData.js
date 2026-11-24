/* ------------------------------------------------------------------ */
/* Data + keys for the Maps page                                        */
/* ------------------------------------------------------------------ */

import { fetchProtectedJson } from './protectedFetch'

// Google Sheet (Apps Script) returning [{ Geofence, Latitude, Longitude, Supplier, ... }]
// Only answers signed-in users: the Firebase ID token is checked by the script
// (code: my-website-pm/apps-script/geofence.gs, shared with my-website-pm).
export const GEOFENCE_API_URL =
  'https://script.google.com/macros/s/AKfycbyZFJgBnwq8u-8ND1zQo9T9tJ6XuGX5ZXIAeip2EkI6uNf7eZOhIqAjU435doLMtABf/exec'

// Fuel stations of every brand (Google Sheet stations_all_brands, one tab per brand).
// Same login check (code: my-website-pm/apps-script/stations.gs, shared with my-website-pm).
export const STATIONS_API_URL =
  'https://script.google.com/macros/s/AKfycbx2TJEkaUdHu5gYck2T5YRsqCdfxFob8pTq78ehlhYgXsEV7oxEkYc5Dz3h3AQ1r40zNQ/exec'

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
  let json
  try {
    json = await fetchProtectedJson(GEOFENCE_API_URL)
  } catch (e) {
    throw new Error(`โหลดข้อมูลพิกัดไม่สำเร็จ (${e.message})`)
  }
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

/* ---------- fuel stations ---------- */

// Brand colors (same as the PM maps page). New brands get a spare color.
const BRAND_COLORS = { PTT: '#00a3e0', PT: '#66a80f', Shell: '#f7c600', Caltex: '#b02a37' }
const SPARE_BRAND_COLORS = ['#1098ad', '#d9480f', '#5c940d', '#9c36b5', '#364fc7', '#c92a2a']
export const fuelInk = (color) => (color === '#f7c600' ? '#3d2e00' : '#fff')

// Shell lists its services as English codes -> Thai; '' = not worth showing.
const AMENITY_TH = {
  air_and_water: 'เติมลม/น้ำ', twenty_four_hour: 'เปิด 24 ชม.', full_service: 'มีพนักงานเติมน้ำมัน',
  standard_toilet: 'ห้องน้ำ', disabled_facilities: 'ห้องน้ำผู้พิการ', carwash: 'ล้างรถ', service_bay: 'ช่องบริการรถ',
  quick_lubes: 'เปลี่ยนน้ำมันเครื่อง', high_speed_diesel_pump: 'หัวจ่ายดีเซลความเร็วสูง', motorway_service: 'จุดพักทางหลวง',
  selectshop: 'Shell Select', stop_and_shop: 'ร้านสะดวกซื้อ', clubsmart_shop: 'ร้านค้า ClubSmart', city_market: 'ร้านค้า',
  food_offerings: 'อาหาร', fast_food: 'อาหาร', snack_food: 'อาหาร', deli_cafe: 'คาเฟ่', cafe: 'คาเฟ่',
  atm: 'ATM', atm_in: 'ATM', atm_out: 'ATM',
  clubsmart_card: 'บัตร ClubSmart', go_plus: 'Shell GO+', loyalty_cards: 'บัตรสะสมแต้ม', partner_loyalty_accepted: 'บัตรสะสมแต้มพันธมิตร',
  fuel_card: 'บัตรน้ำมัน', shell_card: 'Shell Card', fleet_card_general: 'บัตร Fleet',
  credit_card: 'บัตรเครดิต', credit_card_general: 'บัตรเครดิต', credit_card_visa: 'Visa', credit_card_mastercard: 'Mastercard',
  credit_card_american_express: 'Amex',
  manned: '', manual: '', loyalty_program: '', other_loyalty_cards: '', parking_lanes: '', type_of_parking: '',
}
const splitList = (v) => String(v ?? '').split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean)
const amenities = (v) => [...new Set(splitList(v).map((k) => (/^[a-z0-9_]+$/.test(k)
  ? (k in AMENITY_TH ? AMENITY_TH[k] : k.replace(/_/g, ' ')) : k)).filter(Boolean))]

// Only loaded when the fuel-station layer is turned on; kept for this visit only
// (about 5,500 stations with details is too big for the browser's saved storage).
let stationsMemory = null
export const cachedStations = () => stationsMemory

export async function loadStations() {
  let json
  try {
    json = await fetchProtectedJson(STATIONS_API_URL)
  } catch (e) {
    throw new Error(`โหลดข้อมูลปั๊มน้ำมันไม่สำเร็จ (${e.message})`)
  }
  const rows = Array.isArray(json) ? json : (json.data ?? json.rows ?? [])
  const txt = (v) => String(v ?? '').trim()
  const points = []
  rows.forEach((r, i) => {
    const lat = num(pick(r, 'lat', 'Latitude')), lng = num(pick(r, 'lng', 'Longitude'))
    if (!(Number.isFinite(lat) && Number.isFinite(lng)
      && lat >= BOUNDS.latMin && lat <= BOUNDS.latMax && lng >= BOUNDS.lngMin && lng <= BOUNDS.lngMax)) return
    const brand = txt(r._sheet) || 'PTT'
    points.push({
      id: `s${i}`, kind: 'station', supplier: brand, lat, lng,
      name: txt(pick(r, 'name')).replace(/\s+/g, ' ') || `ปั๊ม ${brand}`,
      station: {
        type: txt(pick(r, 'type')),
        address: [txt(pick(r, 'address')), txt(pick(r, 'postcode'))].filter(Boolean).join(' ').replace(/\s+/g, ' '),
        where: [txt(pick(r, 'district', 'city')), txt(pick(r, 'province_name', 'province'))].filter(Boolean).join(' · '),
        phone: txt(pick(r, 'phone')),
        hours: txt(pick(r, 'hours')),
        products: splitList(pick(r, 'products', 'fuels')),
        services: amenities(pick(r, 'services', 'amenities')),
        cards: txt(pick(r, 'card_type')),
        link: txt(pick(r, 'link')),
      },
    })
  })
  const counts = new Map()
  for (const p of points) counts.set(p.supplier, (counts.get(p.supplier) || 0) + 1)
  let spare = 0
  const brands = [...counts].sort((a, b) => b[1] - a[1]).map(([name, mapped]) => ({
    name, mapped, color: BRAND_COLORS[name] ?? SPARE_BRAND_COLORS[spare++ % SPARE_BRAND_COLORS.length],
  }))
  stationsMemory = { points, brands, at: Date.now() }
  return stationsMemory
}

// Fuel pump glyph, used inside the brand-colored station markers.
export const FUEL_PATH = 'M5 3h8a1 1 0 0 1 1 1v7h1.5a2 2 0 0 1 2 2v4.5a1 1 0 0 0 2 0V9.2L17.3 7l1.4-1.4 2.6 2.6c.2.2.3.4.3.7v8.6a3 3 0 0 1-6 0V13H14v8H4V4a1 1 0 0 1 1-1zm1 2v5h6V5H6z'
export const stationSvg = (color, size = 22) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">`
  + `<circle cx="12" cy="12" r="11" fill="${color}" stroke="#fff" stroke-width="1.6"/>`
  + `<g transform="translate(5.5 5.5) scale(.54)" fill="${fuelInk(color)}"><path d="${FUEL_PATH}"/></g></svg>`

export function stationPopupHtml(p, color) {
  const d = p.station
  const line = (label, v) => (v ? `<span><b>${label}</b> ${escapeHtml(v)}</span>` : '')
  const chips = (list) => (list.length ? `<div class="mpop-chips">${list.map((x) => `<i>${escapeHtml(x)}</i>`).join('')}</div>` : '')
  let host = ''
  try { host = /^https?:\/\//.test(d.link) ? new URL(d.link).hostname.replace(/^www\./, '') : '' } catch { /* bad link */ }
  return `<div class="mpop">
    <div class="mpop-sup"><span class="mpop-brand" style="background:${color};color:${fuelInk(color)}">⛽ ${escapeHtml(p.supplier)}</span>${d.type ? escapeHtml(d.type) : ''}</div>
    <strong>${escapeHtml(p.name)}</strong>
    <code>${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</code>
    ${line('พื้นที่', d.where)}${line('ที่อยู่', d.address)}${line('โทร', d.phone)}${line('เวลาเปิด', d.hours)}
    ${d.products.length ? `<span class="mpop-sec">น้ำมัน / ผลิตภัณฑ์</span>${chips(d.products)}` : ''}
    ${d.services.length ? `<span class="mpop-sec">บริการในสถานี</span>${chips(d.services)}` : ''}
    ${line('บัตรที่รับ', d.cards)}
    ${host ? `<a href="${escapeHtml(d.link)}" target="_blank" rel="noopener">ดูหน้าสถานีบน ${escapeHtml(host)} ↗</a>` : ''}
    ${popupActions(p)}
  </div>`
}

// popup for any point on the map (geofence or fuel station)
export const pointPopupHtml = (p, color) => (p.kind === 'station' ? stationPopupHtml(p, color) : popupHtml(p, color))

export const googleMapsLink = (p) => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`

export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// "13.7563, 100.5018", "13.7563 100.5018", "(13.7, 100.5)" or a Google Maps link -> { lat, lng }, else null.
// A pair given as lng, lat is swapped back.
export function parseCoords(s) {
  const t = String(s).trim()
  const m = t.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/) || t.match(/[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i)
    || t.match(/^\(?\s*(-?\d+(?:\.\d+)?)\s*(?:,|\s)\s*(-?\d+(?:\.\d+)?)\s*\)?$/)
  if (!m) return null
  let lat = +m[1], lng = +m[2]
  if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) [lat, lng] = [lng, lat]
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return null
  return { lat, lng }
}

// Red drop pin for a searched coordinate (both map engines). Tip is at (15, 39).
export const PIN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 30 40">'
  + '<path d="M15 1C7.3 1 1 7.2 1 14.9 1 25.3 15 39 15 39s14-13.7 14-24.1C29 7.2 22.7 1 15 1z" fill="#ef4444" stroke="#fff" stroke-width="2"/>'
  + '<circle cx="15" cy="15" r="5.5" fill="#fff"/></svg>'

// Straight-line distance on the earth's surface in km (haversine).
export function distanceKm(a, b) {
  const r = (d) => d * Math.PI / 180
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

export const formatDist = (km) => (km < 1
  ? `${Math.round(km * 1000).toLocaleString('th-TH')} ม.`
  : `${km.toLocaleString('th-TH', { minimumFractionDigits: km < 10 ? 2 : 1, maximumFractionDigits: km < 10 ? 2 : 1 })} กม.`)

// The n points closest to `from`, nearest first: [{ p, km }].
export function nearestTo(from, points, n = 5) {
  const best = []
  for (const p of points) {
    const km = distanceKm(from, p)
    if (best.length < n || km < best[best.length - 1].km) {
      best.push({ p, km })
      best.sort((a, b) => a.km - b.km)
      if (best.length > n) best.pop()
    }
  }
  return best
}

// Dashed lines to the nearest points: red = 1st, yellow = 2nd, blue = the rest.
const NEAR_STYLE = [
  { color: '#e05260', weight: 3, opacity: 0.9, cls: 'first', text: '#fff' },
  { color: '#f2b705', weight: 3, opacity: 0.95, cls: 'second', text: '#3d2e00' },
  { color: '#4776ff', weight: 2, opacity: 0.55, cls: '', text: '#4776ff' },
]
export const nearStyle = (i) => NEAR_STYLE[Math.min(i, 2)]

// Where along a line (0..1) to put its distance label. Long lines on screen: a fixed number of
// pixels from the start, so labels stay close to you at any zoom; each rank sits a bit further
// out so labels of lines going the same way do not cover each other. Short lines: a fraction.
const LABEL_PX = [70, 105, 140, 175, 210]
const LABEL_FRAC = [0.5, 0.75, 0.3, 0.9, 0.6]
export function labelT(lenPx, i) {
  if (lenPx < 1) return 0
  if (lenPx > 140) return Math.min(0.9, LABEL_PX[i % 5] / lenPx)
  return Math.min(1, Math.max(LABEL_FRAC[i % 5], 28 / lenPx)) // never under the blue dot
}

// Opens Street View on Google's own page (free, not counted by us).
export const streetViewLink = (p) => `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.lat},${p.lng}`

export const navLink = (p) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`

// Copy / navigate buttons for popups. MapsPage handles clicks on [data-copy].
function popupActions(p) {
  const c = `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`
  return `<div class="mpop-actions">
    <button type="button" class="mpop-btn" data-sv="${p.lat},${p.lng}">👁 Street View</button>
    <button type="button" class="mpop-btn" data-copy="${c}">⧉ คัดลอกพิกัด</button>
    <a class="mpop-btn primary" href="${navLink(p)}" target="_blank" rel="noopener">➤ นำทาง</a>
  </div>`
}

const nearLine = (near) => (near ? `<span>ใกล้สุด: <b>${escapeHtml(near.p.name)}</b> · ${formatDist(near.km)}</span>` : '')

export function pinPopupHtml(p, near) {
  return `<div class="mpop">
    <div class="mpop-sup">พิกัดที่ค้นหา</div>
    <code>${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</code>
    ${nearLine(near)}
    ${popupActions(p)}
  </div>`
}

export function myPopupHtml(me, following, near) {
  return `<div class="mpop">
    <div class="mpop-sup">ตำแหน่งของฉัน${following ? ' (ติดตามอยู่)' : ''}</div>
    <code>${me.lat.toFixed(6)}, ${me.lng.toFixed(6)}</code>
    <span>ความแม่นยำ ±${Math.round(me.acc).toLocaleString('th-TH')} ม.</span>
    ${nearLine(near)}
    ${popupActions(me)}
  </div>`
}

// Popup / info-window HTML shared by both map engines. Values from the sheet are escaped.
export function popupHtml(p, color) {
  return `<div class="mpop">
    <div class="mpop-sup"><i style="background:${color}"></i>${escapeHtml(p.supplier)}</div>
    <strong>${escapeHtml(p.name)}</strong>
    <code>${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</code>
    <a href="${googleMapsLink(p)}" target="_blank" rel="noopener">เปิดใน Google Maps ↗</a>
    ${popupActions(p)}
  </div>`
}
