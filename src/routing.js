/*
 * Driving routes from the public OSRM server (OpenStreetMap roads, free, no key). It is a shared demo
 * server, so we only call it when the user asks (never on every move), at most one call a second and
 * at most DAY_CAP calls a day per browser. If it fails or the cap is reached, the page keeps showing
 * the straight-line distances it always had.
 * The "driving" profile is for cars: a loaded truck is slower, and live traffic is not included.
 */

const BASE = 'https://router.project-osrm.org'
export const OSRM_CREDIT = { name: 'OSRM', url: 'https://project-osrm.org/' }
const MIN_GAP_MS = 1100
const DAY_CAP = 300
const SNAP_MAX_M = 1500 // a point farther than this from any road (e.g. out at sea) gets no route

const USE_KEY = 'maps.route.use'
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())

function takeCall() {
  let u = { d: today(), n: 0 }
  try { const s = JSON.parse(localStorage.getItem(USE_KEY) || 'null'); if (s?.d === u.d) u = s } catch { /* ignore */ }
  if (u.n >= DAY_CAP) throw new Error(`เรียกคำนวณเส้นทางครบ ${DAY_CAP} ครั้งแล้ววันนี้`)
  u.n += 1
  try { localStorage.setItem(USE_KEY, JSON.stringify(u)) } catch { /* private mode */ }
}

let last = 0
async function call(path) {
  const wait = last + MIN_GAP_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  takeCall()
  last = Date.now()
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`บริการเส้นทางตอบกลับ HTTP ${res.status}`)
  const j = await res.json()
  if (j.code !== 'Ok') throw new Error(j.message || j.code)
  return j
}

const lonLat = (p) => `${p.lng},${p.lat}`

/**
 * Driving distance and time from `from` to each of `dests` (one call).
 * -> [{ km, min } | null] in the same order; null when there is no road route to that point.
 */
export async function driveTable(from, dests) {
  if (!dests.length) return []
  const coords = [from, ...dests].map(lonLat).join(';')
  const j = await call(`/table/v1/driving/${coords}?sources=0&annotations=duration,distance`)
  if ((j.sources?.[0]?.distance ?? 0) > SNAP_MAX_M) throw new Error('ตำแหน่งต้นทางอยู่ไกลจากถนนเกินไป')
  return dests.map((_, i) => {
    const d = j.distances?.[0]?.[i + 1], t = j.durations?.[0]?.[i + 1]
    const snap = j.destinations?.[i + 1]?.distance ?? 0
    if (d == null || t == null || snap > SNAP_MAX_M) return null
    return { km: d / 1000, min: t / 60 }
  })
}

/** The driving route from `from` to `to` (one call) -> { km, min, coords: [[lat, lng], ...] }. */
export async function driveRoute(from, to) {
  const j = await call(`/route/v1/driving/${lonLat(from)};${lonLat(to)}?overview=full&geometries=geojson`)
  const r = j.routes?.[0]
  if (!r) throw new Error('ไม่พบเส้นทางถนน')
  if (Math.max(j.waypoints?.[0]?.distance ?? 0, j.waypoints?.[1]?.distance ?? 0) > SNAP_MAX_M) throw new Error('จุดอยู่ไกลจากถนนเกินไป')
  return { km: r.distance / 1000, min: r.duration / 60, coords: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]) }
}

/**
 * Driving time and distance between every pair of `points` (one call).
 * -> { dur: [[min]], dist: [[km]] }, null where there is no road route.
 */
export async function driveMatrix(points) {
  const j = await call(`/table/v1/driving/${points.map(lonLat).join(';')}?annotations=duration,distance`)
  const bad = (j.sources ?? []).findIndex((s) => (s?.distance ?? 0) > SNAP_MAX_M)
  if (bad >= 0) throw new Error(`จุดที่ ${bad + 1} อยู่ไกลจากถนนเกินไป`)
  const conv = (m, f) => (m ?? []).map((row) => row.map((v) => (v == null ? null : v / f)))
  return { dur: conv(j.durations, 60), dist: conv(j.distances, 1000) }
}

/** One route through all `points` in the given order (one call) -> { km, min, coords, legs: [{ km, min }] }. */
export async function driveRouteVia(points) {
  const j = await call(`/route/v1/driving/${points.map(lonLat).join(';')}?overview=full&geometries=geojson`)
  const r = j.routes?.[0]
  if (!r) throw new Error('ไม่พบเส้นทางถนน')
  const bad = (j.waypoints ?? []).findIndex((w) => (w?.distance ?? 0) > SNAP_MAX_M)
  if (bad >= 0) throw new Error(`จุดที่ ${bad + 1} อยู่ไกลจากถนนเกินไป`)
  return {
    km: r.distance / 1000, min: r.duration / 60,
    coords: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    legs: r.legs.map((l) => ({ km: l.distance / 1000, min: l.duration / 60 })),
  }
}

export const formatMin =(min) => (min < 60
  ? `${Math.max(1, Math.round(min))} นาที`
  : `${Math.floor(min / 60)} ชม. ${Math.round(min % 60)} นาที`)
