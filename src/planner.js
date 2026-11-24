// Helpers for the route planner. Pure functions: no network, no map.

export const MAX_STOPS = 9 // Google Maps accepts an origin, a destination and up to 7-9 stops in a link

const KM_PER_DEG = 111.32

/**
 * The points within `maxKm` of a route line, with how far off the line each one is and how far along
 * the route it sits (km from the start), in route order.
 * coords: [[lat, lng], ...] (a driving route), points: [{ lat, lng, ... }]
 * -> { items: [{ p, offKm, atKm }], total } where total is the route length (km) on the same scale as atKm.
 */
export function alongRoute(coords, points, maxKm) {
  if (coords.length < 2) return { items: [], total: 0 }
  const k = Math.cos((coords[Math.floor(coords.length / 2)][0] * Math.PI) / 180)
  const xy = coords.map(([la, lo]) => [lo * k * KM_PER_DEG, la * KM_PER_DEG])
  const cum = [0]
  for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]))
  const lats = coords.map((c) => c[0]), lngs = coords.map((c) => c[1])
  const padLat = maxKm / KM_PER_DEG, padLng = maxKm / (KM_PER_DEG * k)
  const minLat = Math.min(...lats) - padLat, maxLat = Math.max(...lats) + padLat
  const minLng = Math.min(...lngs) - padLng, maxLng = Math.max(...lngs) + padLng

  const out = []
  for (const p of points) {
    if (p.lat < minLat || p.lat > maxLat || p.lng < minLng || p.lng > maxLng) continue
    const px = p.lng * k * KM_PER_DEG, py = p.lat * KM_PER_DEG
    let best = Infinity, at = 0
    for (let i = 1; i < xy.length; i++) {
      const ax = xy[i - 1][0], ay = xy[i - 1][1]
      const dx = xy[i][0] - ax, dy = xy[i][1] - ay
      const len2 = dx * dx + dy * dy
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
      if (d < best) { best = d; at = cum[i - 1] + t * Math.sqrt(len2) }
    }
    if (best <= maxKm) out.push({ p, offKm: best, atKm: at })
  }
  const total = cum[cum.length - 1] || 1
  return { items: out.sort((a, b) => a.atKm - b.atKm), total }
}

/**
 * The visiting order with the least total driving time that starts at stop 0 and ends anywhere
 * (tries every order: fine for up to 9 stops). dur[i][j] = minutes from i to j.
 * -> [0, ...] indexes, or null when a needed pair has no road route.
 */
export function bestOrder(dur) {
  const n = dur.length
  if (n <= 2) return Array.from({ length: n }, (_, i) => i)
  let best = Infinity, bestPath = null
  const used = new Array(n).fill(false)
  used[0] = true
  const path = [0]
  const walk = (cost) => {
    if (cost >= best) return
    if (path.length === n) { best = cost; bestPath = [...path]; return }
    const last = path[path.length - 1]
    for (let j = 1; j < n; j++) {
      if (used[j] || dur[last][j] == null) continue
      used[j] = true; path.push(j)
      walk(cost + dur[last][j])
      path.pop(); used[j] = false
    }
  }
  walk(0)
  return bestPath
}

const ll = (s) => `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`

/** A Google Maps directions link through the stops, in order (free, opens in the Maps app or site). */
export function googleDirections(stops) {
  if (stops.length < 2) return ''
  const u = new URLSearchParams({ api: '1', origin: ll(stops[0]), destination: ll(stops[stops.length - 1]), travelmode: 'driving' })
  if (stops.length > 2) u.set('waypoints', stops.slice(1, -1).map(ll).join('|'))
  return `https://www.google.com/maps/dir/?${u}`
}
