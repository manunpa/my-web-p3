/*
 * Which tambon (sub-district), amphoe (district) and province a coordinate is in.
 *
 * It is done on this device with official boundaries (no outside service, no cost, no limits): the
 * Royal Thai Survey Department's administrative boundaries (COD-AB, published by OCHA on HDX under
 * CC BY-IGO), shrunk to a small file (public/data/admin3.json, loaded the first time it is needed).
 * The outlines are simplified, so a point right on a boundary may land in the next area over: treat
 * the result as approximate near the edge of an area.
 *
 * File format (see scripts/build-admin3.mjs):
 *   { v, provinces: [name], districts: [[provinceIndex, name]], subs: [[districtIndex, name]],
 *     f: [[subIndex, minX, minY, maxX, maxY, [polygon, ...]]] }
 * A polygon is [ring, ...] (the first ring is the outside, the others are holes) and a ring is a flat
 * list [x0, y0, x1, y1, ...] with coordinates in 1/10000 degree (x = longitude, y = latitude).
 */

export const ADMIN_CREDIT = 'ขอบเขตการปกครอง: กรมแผนที่ทหาร ผ่าน OCHA/HDX (CC BY-IGO) · ค่าโดยประมาณ ใกล้แนวเขตอาจคลาดเคลื่อน'
const UNIT = 10000
const CELL = 2000 // grid cell = 0.2 degree
const NEAR = 120  // a point not inside any outline but this close to one (about 1 km) still gets that area

let loading = null
let lookup = null

const cellKey = (cx, cy) => cx * 100000 + cy

function inRing(ring, x, y) {
  let inside = false
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const inPolygon = (poly, x, y) => inRing(poly[0], x, y) && !poly.slice(1).some((h) => inRing(h, x, y))

function ringDist2(ring, x, y) {
  let best = Infinity
  for (let i = 0; i < ring.length; i += 2) {
    const dx = ring[i] - x, dy = ring[i + 1] - y
    const d = dx * dx + dy * dy
    if (d < best) best = d
  }
  return best
}

/** Turns the boundary data into a function (lat, lng) -> { t, a, p, near } | null. Exported for tests. */
export function createAdminLookup(d) {
  const grid = new Map()
  d.f.forEach((f, i) => {
    const [, x0, y0, x1, y1] = f
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
        const k = cellKey(cx, cy)
        const g = grid.get(k)
        if (g) g.push(i); else grid.set(k, [i])
      }
    }
  })
  const result = (sub, near) => {
    const [di, t] = d.subs[sub]
    const [pi, a] = d.districts[di]
    return { t, a, p: d.provinces[pi], near }
  }
  return (lat, lng) => {
    const x = Math.round(lng * UNIT), y = Math.round(lat * UNIT)
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL)
    let nearest = null, nearD = NEAR * NEAR
    for (const ox of [0, -1, 1]) {
      for (const oy of [0, -1, 1]) {
        for (const i of grid.get(cellKey(cx + ox, cy + oy)) ?? []) {
          const [sub, x0, y0, x1, y1, polys] = d.f[i]
          if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && polys.some((poly) => inPolygon(poly, x, y))) return result(sub, false)
          if (x >= x0 - NEAR && x <= x1 + NEAR && y >= y0 - NEAR && y <= y1 + NEAR) {
            for (const poly of polys) {
              const dd = ringDist2(poly[0], x, y)
              if (dd < nearD) { nearD = dd; nearest = sub }
            }
          }
        }
      }
    }
    return nearest === null ? null : result(nearest, true)
  }
}

/** Load the boundary file (once). Resolves when lookups can be made, rejects if it cannot be loaded. */
export function loadAdmin() {
  if (lookup) return Promise.resolve()
  loading ??= fetch(`${import.meta.env.BASE_URL}data/admin3.json`)
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
    .then((d) => { if (d.v !== 1) throw new Error('unknown boundary file version'); lookup = createAdminLookup(d) })
    .catch((e) => { loading = null; throw e })
  return loading
}

export const adminReady = () => !!lookup

/** -> { t: tambon, a: amphoe, p: province, near } or null (not loaded yet, or in no known area, e.g. out at sea). */
export const areaOf = (lat, lng) => (lookup ? lookup(lat, lng) : null)

const BKK = 'กรุงเทพมหานคร'

/** "ต.บางนา อ.บางนา จ.ชลบุรี" (in Bangkok: "แขวง… เขต… กรุงเทพมหานคร"). */
export function formatArea(a) {
  if (!a) return ''
  const bkk = a.p === BKK
  const sub = a.t.startsWith('แขวง') || a.t.startsWith('ต.') ? a.t : `${bkk ? 'แขวง' : 'ต.'}${a.t}`
  const dist = a.a.startsWith('เขต') || a.a.startsWith('อ.') ? a.a : `${bkk ? 'เขต' : 'อ.'}${a.a}`
  return `${sub} ${dist} ${bkk ? a.p : `จ.${a.p}`}`
}

/**
 * All the names of an area as one lowercase string for searching, in the ways people write them:
 * "บางนา", "ต.บางนา อ.บางนา จ.ชลบุรี", "ตำบลบางนา อำเภอบางนา จังหวัดชลบุรี" (in Bangkok "แขวงบางนา เขตบางนา").
 */
export function areaSearchText(a) {
  if (!a) return ''
  const bkk = a.p === BKK
  return `${a.t} ${a.a} ${a.p} ${formatArea(a)} ${bkk ? `แขวง${a.t} เขต${a.a}` : `ตำบล${a.t} อำเภอ${a.a} จังหวัด${a.p}`}`.toLowerCase()
}
