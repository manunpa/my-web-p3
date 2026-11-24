/*
 * Rain radar from RainViewer (free, no key). Terms: credit + link back to rainviewer.com is required,
 * the free tier has tiles up to zoom 7 and the past 2 hours (13 frames, 10 minutes apart).
 * We load the frame list rarely (cached) and the map draws tiles only while the layer is on.
 * If RainViewer is down, blocks us or changes its terms, loadRainFrames() fails and the page simply
 * hides the radar button - nothing else on the map depends on it.
 */

const API = 'https://api.rainviewer.com/public/weather-maps.json'
export const RAIN_MAX_ZOOM = 7       // the free tiles stop here; closer zooms enlarge them
export const RAIN_SHOW_MAX_ZOOM = 12 // beyond this the radar is too coarse to mean anything: hide it
export const RAIN_OPACITY = 0.65
export const RAIN_CREDIT_URL = 'https://www.rainviewer.com/'
const CACHE_MS = 4 * 60 * 1000

let cache = null

// -> { frames: [{ time (ms), template }], credit: { name, url } }, oldest first.
// template is a tile URL with {z}/{x}/{y} (256 px, color scheme 2, smoothed, snow shown).
export async function loadRainFrames() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data
  const res = await fetch(API, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const j = await res.json()
  const frames = (j.radar?.past ?? []).map((f) => ({
    time: f.time * 1000,
    template: `${j.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`,
  }))
  if (!j.host || !frames.length) throw new Error('no radar frames')
  const data = { frames, credit: { name: 'RainViewer', url: RAIN_CREDIT_URL } }
  cache = { at: Date.now(), data }
  return data
}

export const rainTimeLabel = (ms) => new Intl.DateTimeFormat('th-TH', {
  hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok',
}).format(new Date(ms))

/*
 * One Google Maps tile of the radar. Google does not enlarge tiles past the source zoom by itself,
 * so for closer zooms we take the parent tile at zoom 7 and enlarge the right part of it with CSS.
 * `coord` is { x, y } and `zoom` the map zoom; returns the element for that tile.
 */
export function radarTileElement(doc, template, coord, zoom) {
  const div = doc.createElement('div')
  div.style.cssText = `width:256px;height:256px;overflow:hidden;position:relative;pointer-events:none;opacity:${RAIN_OPACITY}`
  const n = 2 ** zoom
  if (zoom > RAIN_SHOW_MAX_ZOOM || coord.y < 0 || coord.y >= n) return div
  const x = ((coord.x % n) + n) % n // the world repeats sideways
  const k = Math.max(0, zoom - RAIN_MAX_ZOOM)
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
