// Builds public/data/admin3.json (read by src/geoAdmin.js) from a simplified GeoJSON of the Thai
// administrative boundaries at tambon level (COD-AB, Royal Thai Survey Department via OCHA / HDX,
// CC BY-IGO: https://data.humdata.org/dataset/cod-ab-tha).
//
// How the input was made (the raw download is ~400 MB, so it is shrunk with mapshaper first):
//   mapshaper tha_admbnda_adm3.shp -simplify visvalingam 5% keep-shapes \
//     -proj wgs84 -o admin3_simplified.geojson precision=0.0001 format=geojson
//
// Usage: node scripts/build-admin3.mjs admin3_simplified.geojson [public/data/admin3.json]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const [input, output = 'public/data/admin3.json'] = process.argv.slice(2)
if (!input) { console.error('usage: node scripts/build-admin3.mjs <simplified.geojson> [out.json]'); process.exit(1) }

const UNIT = 10000
const gj = JSON.parse(readFileSync(input, 'utf8'))
const need = ['adm3_name1', 'adm2_name1', 'adm1_name1']

const provinces = [], provIdx = new Map()
const districts = [], distIdx = new Map()
const subs = [], f = []

const idx = (map, list, key, make) => {
  if (!map.has(key)) { map.set(key, list.length); list.push(make()) }
  return map.get(key)
}
const ring = (r) => {
  const out = []
  let px = null, py = null
  for (const [lng, lat] of r) {
    const x = Math.round(lng * UNIT), y = Math.round(lat * UNIT)
    if (x === px && y === py) continue // simplification can leave repeated points
    out.push(x, y); px = x; py = y
  }
  return out
}

let skipped = 0
for (const feat of gj.features) {
  const p = feat.properties ?? {}
  if (need.some((k) => !String(p[k] ?? '').trim()) || !feat.geometry) { skipped++; continue }
  const prov = String(p.adm1_name1).trim(), dist = String(p.adm2_name1).trim(), sub = String(p.adm3_name1).trim()
  const pi = idx(provIdx, provinces, prov, () => prov)
  const di = idx(distIdx, districts, `${pi}|${dist}`, () => [pi, dist])
  const si = subs.length
  subs.push([di, sub])

  const polys = feat.geometry.type === 'Polygon' ? [feat.geometry.coordinates] : feat.geometry.coordinates
  const outPolys = polys.map((poly) => poly.map(ring).filter((r) => r.length >= 6)).filter((poly) => poly.length)
  if (!outPolys.length) { skipped++; subs.pop(); continue }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const poly of outPolys) {
    const r = poly[0]
    for (let i = 0; i < r.length; i += 2) {
      if (r[i] < x0) x0 = r[i]; if (r[i] > x1) x1 = r[i]
      if (r[i + 1] < y0) y0 = r[i + 1]; if (r[i + 1] > y1) y1 = r[i + 1]
    }
  }
  f.push([si, x0, y0, x1, y1, outPolys])
}

mkdirSync(dirname(output), { recursive: true })
const text = JSON.stringify({ v: 1, provinces, districts, subs, f })
writeFileSync(output, text)
console.log(`features ${f.length} (skipped ${skipped}), provinces ${provinces.length}, districts ${districts.length}, size ${(text.length / 1e6).toFixed(2)} MB`)
