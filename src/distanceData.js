import { fetchProtectedJson } from './protectedFetch'

// Distance database (Google Sheet, every tab) -> apps-script/distance-db.gs. Answers signed-in users only.
const DISTANCE_URL =
  'https://script.google.com/macros/s/AKfycbwLiYpAcs4NJgdHK-LJYBt8SojMDkxfKbl74DembLWEl8_B646ButysulTIvk__IegJ/exec'

let cached = null // one load per visit; the page's reload button asks again

export function loadDistances(force = false) {
  if (!cached || force) {
    cached = fetchProtectedJson(DISTANCE_URL, { source: 'distance-read' }).then((json) => {
      if (!json || json.status === 'error' || !Array.isArray(json.rows)) {
        throw new Error((json && (json.message || json.error)) || 'อ่านฐานข้อมูลระยะทางไม่ได้')
      }
      return buildIndex(json.rows)
    })
    cached.catch(() => { cached = null }) // let the next try ask again
  }
  return cached
}

// Names are compared without spaces, punctuation, company words or a leading "ลูกค้า",
// so "ห้างหุ้นส่วนจำกัด ท๊อป แอลพีจี" and "หจก.ท๊อปแอลพีจี" are the same customer.
export function normName(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ห้างหุ้นส่วนจำกัด|หจก\.?|บริษัท|บจก\.?|จำกัด|\(มหาชน\)|มหาชน|co\.?,?\s*ltd\.?|ltd\.?/g, '')
    .replace(/^\s*ลูกค้า/, '')
    .replace(/[\s.,'"`()[\]\-_/\\:;]+/g, '')
    .replace(/[๊]/g, '')
}
const normDepot = (s) => {
  const t = String(s ?? '').toLowerCase().replace(/\s+/g, '')
  return /บางปะกง/.test(t) ? 'bpk' : t.replace(/^คลัง/, '')
}

function buildIndex(rows) {
  const byName = new Map() // normalized customer -> [{ depot, distance }]
  for (const r of rows) {
    const key = normName(r.customer)
    const km = Number(r.distance)
    if (!key || !Number.isFinite(km)) continue
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key).push({ depot: normDepot(r.depot), sheet: normDepot(r.sheet), distance: km })
  }
  return { byName, count: rows.length }
}

// Distance for a customer from a depot. Prefers a row of the same depot (or a tab named after it);
// without a depot match it is used only when every row for that customer gives the same distance.
export function findDistance(index, customer, depot) {
  const list = index?.byName.get(normName(customer))
  if (!list?.length) return null
  const d = normDepot(depot)
  if (d) {
    const same = list.find((x) => x.depot === d || x.sheet === d || x.depot.includes(d) || (x.depot && d.includes(x.depot)))
    if (same) return same.distance
  }
  return list.every((x) => x.distance === list[0].distance) ? list[0].distance : null
}
