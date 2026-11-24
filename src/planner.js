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

/* ---- via points: dragging the route to make it go where a truck can really drive ---- */

export const MAX_VIAS = 10

/**
 * The stops with the via points in between, in driving order.
 * vias: [{ lat, lng, leg }] where leg = the index of the stop the via point comes after, listed in
 * driving order inside each leg. -> { pts: [{ lat, lng }], isVia: [boolean] }
 */
export function waypointsOf(stops, vias) {
  const pts = [], isVia = []
  stops.forEach((s, i) => {
    pts.push({ lat: s.lat, lng: s.lng }); isVia.push(false)
    for (const v of vias) if (v.leg === i && i < stops.length - 1) { pts.push({ lat: v.lat, lng: v.lng }); isVia.push(true) }
  })
  return { pts, isVia }
}

/** The route legs (one per pair of neighbouring waypoints) summed up per leg between two real stops. */
export function mainLegs(legs, isVia) {
  const out = []
  let cur = null
  legs.forEach((l, i) => {
    cur = cur ? { km: cur.km + l.km, min: cur.min + l.min } : { km: l.km, min: l.min }
    if (!isVia[i + 1]) { out.push(cur); cur = null } // the waypoint this leg ends at is a real stop
  })
  return out
}

/**
 * Where on the route a point is: { sub, atKm } with sub = the index of the leg (between two
 * neighbouring waypoints) it falls in. coords: the route line, legsKm: length of each leg.
 */
export function locateOnRoute(coords, totalKm, legsKm, lat, lng) {
  const { items, total } = alongRoute(coords, [{ lat, lng }], 1e6)
  if (!items.length || !total) return { sub: 0, atKm: 0 }
  const atKm = items[0].atKm * (totalKm / total)
  let acc = 0, sub = legsKm.length - 1
  for (let k = 0; k < legsKm.length; k++) {
    acc += legsKm[k]
    if (atKm <= acc) { sub = k; break }
  }
  return { sub, atKm }
}

/** Leg `sub` of the route cut in two at atKm (km from the start), so the legs still match the waypoints after a via point was added. */
export function splitLeg(legs, sub, atKm) {
  const before = legs.slice(0, sub).reduce((s, l) => s + l.km, 0)
  const l = legs[sub]
  const first = Math.min(Math.max(atKm - before, 0), l.km)
  const r = l.km ? first / l.km : 0.5
  return [...legs.slice(0, sub), { km: first, min: l.min * r }, { km: l.km - first, min: l.min * (1 - r) }, ...legs.slice(sub + 1)]
}

/** A new via point put into the list of via points after waypoint `sub` of the current route. */
export function insertVia(stops, vias, sub, pt) {
  const { isVia } = waypointsOf(stops, vias)
  const upto = isVia.slice(0, sub + 1)
  const leg = upto.filter((v) => !v).length - 1 // the stop this via point comes after
  const lastStop = upto.lastIndexOf(false)
  const pos = upto.slice(lastStop + 1).length // how many via points of this leg come before it
  const before = vias.filter((v) => v.leg < leg).length
  const next = vias.slice()
  next.splice(before + pos, 0, { lat: pt.lat, lng: pt.lng, leg })
  return next
}

const ll = (s) => `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`

/** A Google Maps directions link through the stops, in order (free, opens in the Maps app or site). */
export function googleDirections(stops) {
  if (stops.length < 2) return ''
  const u = new URLSearchParams({ api: '1', origin: ll(stops[0]), destination: ll(stops[stops.length - 1]), travelmode: 'driving' })
  if (stops.length > 2) u.set('waypoints', stops.slice(1, -1).map(ll).join('|'))
  return `https://www.google.com/maps/dir/?${u}`
}
