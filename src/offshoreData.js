/*
 * Offshore data of the Department of Mineral Fuels (กรมเชื้อเพลิงธรรมชาติ, DMF): production
 * platforms (points) and petroleum concession blocks (areas). It is a public ArcGIS service
 * (no key, no login, browsers may call it) - the same one behind DMF's own web map.
 * The service name says "2018", so the data may not be the latest.
 */

const BASE = 'https://gis.dmf.go.th/arcgis/rest/services/GIS_Internet/GIS_Internet_2018/MapServer'
export const DMF_CREDIT = 'กรมเชื้อเพลิงธรรมชาติ (DMF) · ชุดข้อมูลปี 2018'

export const PLATFORM_GROUP = 'แท่นผลิตนอกชายฝั่ง'
export const PLATFORM_COLOR = '#0e7490'
export const AREA_OFFSHORE_COLOR = '#0e7490'
export const AREA_ONSHORE_COLOR = '#b45309'

const txt = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()
const dateTh = (ms) => {
  const n = Number(ms)
  return Number.isFinite(n) && n > 0
    ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(n)) : ''
}

async function query(layer, params) {
  const qs = new URLSearchParams({ where: '1=1', outSR: '4326', f: 'geojson', ...params })
  const res = await fetch(`${BASE}/${layer}/query?${qs}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  if (json.error) throw new Error(json.error.message || 'service error') // ArcGIS reports errors with HTTP 200
  if (json.type !== 'FeatureCollection') throw new Error('unexpected reply')
  return json
}

// Kept for this visit only (about 270 KB, loaded the first time the layer is turned on).
let memory = null
export const cachedOffshore = () => memory

/** -> { platforms: [point], areas: GeoJSON FeatureCollection, at } */
export async function loadOffshore() {
  const [pl, ar] = await Promise.all([
    query(1, { outFields: 'OBJECTID,NAME_TYPET,OPERATOR_E,OPERATOR_T,FIELD,LEASE,BLOCK,TYPE,INSTALL_D', geometryPrecision: '5' }),
    // simplified outlines (about 200 m) keep the area layer small
    query(2, { outFields: 'BLOCK,LEASE_NO,SHORE,STATUS,ISSUE_DATE,AREA_KM,OPERATOR_E,OPERATOR_T,OWNER', maxAllowableOffset: '0.002', geometryPrecision: '4' }),
  ])

  const platforms = []
  for (const f of pl.features) {
    const c = f.geometry?.type === 'Point' ? f.geometry.coordinates : null
    if (!c || !(c[1] >= 5 && c[1] <= 21 && c[0] >= 95 && c[0] <= 110)) continue
    const p = f.properties
    platforms.push({
      id: `o${p.OBJECTID}`, kind: 'platform', supplier: PLATFORM_GROUP,
      name: txt(p.NAME_TYPET) || `แท่น ${txt(p.FIELD) || p.OBJECTID}`,
      lat: c[1], lng: c[0],
      platform: {
        operator: txt(p.OPERATOR_T) || txt(p.OPERATOR_E),
        operatorE: txt(p.OPERATOR_E),
        field: txt(p.FIELD), block: txt(p.BLOCK), lease: txt(p.LEASE), type: txt(p.TYPE),
        installed: dateTh(p.INSTALL_D),
      },
    })
  }

  const features = ar.features.filter((f) => f.geometry).map((f) => {
    const p = f.properties
    return {
      type: 'Feature', geometry: f.geometry,
      properties: {
        block: txt(p.BLOCK), lease: txt(p.LEASE_NO), shore: txt(p.SHORE), status: txt(p.STATUS),
        issued: dateTh(p.ISSUE_DATE), areaKm: Number.isFinite(Number(p.AREA_KM)) ? Math.round(Number(p.AREA_KM)) : null,
        operator: txt(p.OPERATOR_T) || txt(p.OPERATOR_E), owner: txt(p.OWNER),
      },
    }
  })

  memory = { platforms, areas: { type: 'FeatureCollection', features }, at: Date.now() }
  return memory
}

export const areaColor = (props) => (props.shore === 'Onshore' ? AREA_ONSHORE_COLOR : AREA_OFFSHORE_COLOR)
