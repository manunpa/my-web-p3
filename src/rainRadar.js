/*
 * Rain layers. Two free sources, no key for either:
 *
 *  - 'radar' = RainViewer weather radar: detailed, nearly live, past 2 hours (13 frames, 10 minutes
 *    apart). Terms: credit + link back to rainviewer.com is required; the free tier has tiles up to
 *    zoom 7 and is meant for personal / community use.
 *  - 'nasa'  = NASA GIBS satellite rain rate (IMERG, 30-minute average): coarse (about 10 km) and
 *    several hours behind, but open data with no usage limits that matter here. Used as the second
 *    choice, and as the automatic fallback when RainViewer cannot be loaded.
 *
 * We load the frame list rarely (cached) and the map draws tiles only while the layer is on.
 * If a source is down, blocks us or changes its terms, loadRainFrames() fails and the page switches
 * to the other one (or turns the layer off) - nothing else on the map depends on it.
 */

const RV_API = 'https://api.rainviewer.com/public/weather-maps.json'
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/IMERG_Precipitation_Rate_30min/default'
const GIBS_STEP_MS = 30 * 60 * 1000
const GIBS_FRAMES = 12 // the last 6 hours

export const RAIN_SOURCES = ['radar', 'nasa']
export const RAIN_SHOW_MAX_ZOOM = 12 // beyond this the data is too coarse to mean anything: hide it
export const RAIN_OPACITY = 0.65
const CACHE_MS = 4 * 60 * 1000

const cache = {}

async function loadRadar() {
  const res = await fetch(RV_API, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const j = await res.json()
  const frames = (j.radar?.past ?? []).map((f) => ({
    time: f.time * 1000,
    // 256 px tiles, color scheme 2, smoothed, snow shown
    template: `${j.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`,
  }))
  if (!j.host || !frames.length) throw new Error('no radar frames')
  return {
    source: 'radar', frames, maxZoom: 7, lagMs: 0,
    credit: { name: 'RainViewer', url: 'https://www.rainviewer.com/' },
  }
}

async function loadNasa() {
  // A tile requested without a time comes from the newest data, and the reply says which time that
  // is (header layer-time-actual, readable from the browser) - so no need to read the big layer list.
  const res = await fetch(`${GIBS}/default/GoogleMapsCompatible_Level6/0/0/0.png`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const latest = Date.parse(res.headers.get('layer-time-actual') ?? '')
  if (!Number.isFinite(latest)) throw new Error('no data time')
  const frames = []
  for (let i = GIBS_FRAMES - 1; i >= 0; i--) {
    const t = latest - i * GIBS_STEP_MS
    frames.push({
      time: t,
      template: `${GIBS}/${new Date(t).toISOString().replace('.000Z', 'Z')}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`,
    })
  }
  return {
    source: 'nasa', frames, maxZoom: 6,
    lagMs: Math.max(0, Date.now() - (latest + GIBS_STEP_MS)), // how far behind the newest frame is
    credit: { name: 'NASA GIBS', url: 'https://www.earthdata.nasa.gov/data/tools/gibs' },
  }
}

/**
 * -> { source, frames: [{ time (ms), template }], maxZoom, lagMs, credit: { name, url } }, oldest first.
 * template is a tile URL with {z}/{x}/{y}; maxZoom is the last zoom the source has tiles for.
 */
export async function loadRainFrames(source = 'radar') {
  const hit = cache[source]
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data
  const data = await (source === 'nasa' ? loadNasa() : loadRadar())
  cache[source] = { at: Date.now(), data }
  return data
}

export const rainTimeLabel = (ms) => new Intl.DateTimeFormat('th-TH', {
  hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok',
}).format(new Date(ms))

// "ข้อมูลช้ากว่าปัจจุบัน ~5 ชม." for sources that run behind; '' when it is (nearly) live.
export function lagLabel(lagMs) {
  const h = lagMs / 3600000
  if (h < 0.5) return ''
  return h < 1 ? `ช้า ~${Math.round(h * 60)} นาที` : `ช้า ~${h < 10 ? h.toFixed(1) : Math.round(h)} ชม.`
}

/*
 * One Google Maps tile of the rain layer. Google does not enlarge tiles past the source zoom by
 * itself, so for closer zooms we take the parent tile at the source's last zoom (maxZoom) and
 * enlarge the right part of it with CSS. `coord` is { x, y } and `zoom` the map zoom.
 */
export function radarTileElement(doc, template, coord, zoom, maxZoom) {
  const div = doc.createElement('div')
  div.style.cssText = `width:256px;height:256px;overflow:hidden;position:relative;pointer-events:none;opacity:${RAIN_OPACITY}`
  const n = 2 ** zoom
  if (zoom > RAIN_SHOW_MAX_ZOOM || coord.y < 0 || coord.y >= n) return div
  const x = ((coord.x % n) + n) % n // the world repeats sideways
  const k = Math.max(0, zoom - maxZoom)
  const s = 2 ** k
  const px = Math.floor(x / s), py = Math.floor(coord.y / s)
  const img = doc.createElement('img')
  img.alt = ''
  img.draggable = false
  img.src = template.replace('{z}', zoom - k).replace('{x}', px).replace('{y}', py)
  img.style.cssText = 'position:absolute;left:0;top:0;width:256px;height:256px;transform-origin:0 0;'
  if (k) img.style.transform = `translate(${-(x - px * s) * 256}px,${-(coord.y - py * s) * 256}px) scale(${s})`
  div.append(img)
  return div
}
