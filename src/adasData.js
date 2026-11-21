/* ------------------------------------------------------------------ */
/* Data source for the ADAS / DMS (Songdee) alert dashboard             */
/* ------------------------------------------------------------------ */
import { norm, parseDate, provinceOf } from './fleetData'
import { fetchProtectedJson } from './protectedFetch'

// Web app URL from apps-script/adas-dms.gs (ends with /exec). Leave '' to show sample data.
// The script only answers signed-in users: the Firebase ID token is sent in a POST body.
export const ADAS_API_URL =
  'https://script.google.com/macros/s/AKfycbzWSLqS08_jAeqdecNhTe7VHIPKj19hpIWe2YajpG004vBEr6SSPiqBX8CG6-u9pq0NMg/exec'

export const REFRESH_MS = 5 * 60 * 1000

// Column names in the sheet -> field names. Matching ignores spaces, '/', '.', '-', '_' and case.
const FIELDS = {
  plate: ['หมายเลขรถ', 'ทะเบียนรถ', 'ทะเบียน'],
  unit: ['หน่วยงาน'],
  driver: ['ชื่อคนขับ', 'คนขับ'],
  type: ['ประเภทการเตือน', 'ประเภทการแจ้งเตือน', 'ประเภทแจ้งเตือน', 'ประเภท'],
  date: ['วันที่'],
  time: ['เวลา', 'เวลาแจ้งเตือน'],
  location: ['สถานที่'],
  speed: ['ความเร็ว'],
  note: ['หมายเหตุโฆษณา', 'หมายเหตุ'],
  review: ['สถานะการตรวจสอบ', 'สถานะตรวจสอบ'],
  alertStatus: ['สถานะแจ้งเตือน', 'สถานะการแจ้งเตือน'],
}
const REQUIRED = ['plate', 'driver', 'type', 'date']

const blank = /^(|-|—|#value!|#n\/a|n\/?a|undefined|null)$/i
const val = (v) => {
  const s = String(v ?? '').trim()
  return blank.test(s) ? '' : s
}

// "Not reviewed yet": an empty review cell, or text like รอตรวจสอบ / ยังไม่ตรวจสอบ / pending.
const NOT_REVIEWED = /รอ|ยังไม่|ไม่ได้ตรวจ|pending|wait|false|^no$/i

function keyMap(headers) {
  const byNorm = new Map(headers.map((k) => [norm(k), k]))
  const out = {}
  for (const [field, names] of Object.entries(FIELDS)) {
    const k = names.map(norm).map((n) => byNorm.get(n)).find(Boolean)
      ?? headers.find((h) => names.some((n) => norm(h).includes(norm(n))))
    if (k) out[field] = k
  }
  return out
}

// The same address appears thousands of times; look each one up once.
const provinces = new Map()
const province = (loc) => {
  if (!provinces.has(loc)) provinces.set(loc, provinceOf(loc))
  return provinces.get(loc)
}

// TRUE / FALSE (checkbox) in any letter case -> 'TRUE' / 'FALSE'.
const bool = (s) => (/^(true|false)$/i.test(s) ? s.toUpperCase() : s)

export function toRecords(rows) {
  if (!rows.length) return { records: [], missing: [] }
  const keys = keyMap(Object.keys(rows[0]))
  const missing = REQUIRED.filter((f) => !keys[f])
  const get = (row, f) => (keys[f] ? val(row[keys[f]]) : '')
  const records = []
  rows.forEach((row, i) => {
    const date = get(row, 'date')
    const time = get(row, 'time')
    const dateHasTime = /\d:\d/.test(date)
    const start = parseDate(time && !dateHasTime ? `${date} ${time}` : date)
    if (!start) return
    const speed = parseFloat(get(row, 'speed').replace(/,/g, ''))
    const review = get(row, 'review')
    const location = get(row, 'location')
    records.push({
      id: i,
      plate: get(row, 'plate') || '(ไม่ระบุ)',
      unit: get(row, 'unit') || '(ไม่ระบุ)',
      driver: get(row, 'driver') || '(ไม่ระบุ)',
      type: get(row, 'type') || '(ไม่ระบุ)',
      start,
      hasTime: dateHasTime || /\d:\d/.test(time),
      location,
      province: province(location),
      speed: isNaN(speed) ? null : speed,
      note: get(row, 'note'),
      review: review || 'ยังไม่ตรวจสอบ',
      reviewed: !!review && !NOT_REVIEWED.test(review),
      alertStatus: bool(get(row, 'alertStatus')) || '(ไม่ระบุ)',
    })
  })
  return { records, missing }
}

export async function loadAdas() {
  if (!ADAS_API_URL) return { ...toRecords(sampleRows()), sample: true }
  let json
  try {
    json = await fetchProtectedJson(ADAS_API_URL)
  } catch (e) {
    throw new Error(`Could not load the sheet (${e.message}).`)
  }
  if (json?.error) throw new Error(json.error)
  return { ...toRecords(decode(json)), sample: false }
}

// Compact format from apps-script/adas-dms.gs: { headers, values: [uniques per column], rows: [[index...]] }.
// Also accepts a plain array of row objects, or { sheetName: rows }.
export function decode(json) {
  if (Array.isArray(json?.rows) && Array.isArray(json?.headers)) {
    const { headers, values, rows } = json
    return rows.map((r) => {
      const o = {}
      headers.forEach((h, c) => { o[h] = values[c][r[c]] })
      return o
    })
  }
  return Array.isArray(json) ? json : Object.values(json).filter(Array.isArray).flat()
}

/* ---------- sample data, used while ADAS_API_URL is '' ---------- */

function sampleRows() {
  let a = 20261115
  const rnd = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const pick = (arr, skew = 1) => arr[Math.floor(rnd() ** skew * arr.length)]
  const types = ['ง่วงนอน / หาว', 'ไม่มองถนน', 'ใช้โทรศัพท์', 'ระยะห่างคันหน้าใกล้ (HMW)', 'ออกนอกเลน (LDW)',
    'หลับตา', 'สูบบุหรี่', 'เสี่ยงชนด้านหน้า (FCW)']
  const units = ['SCC-BFPL-LLK', 'SCC-BFPL-SRC', 'SCC-Atlas BPK-BRP', 'SCC-NPM-BRP', 'SCC-BFPL-SRB']
  const drivers = ['Sanya Sornsamdang', 'Adisak Kaewwiset', 'Anirut Phumma', 'Somsak Srisong', 'Nisan Pakdee', 'Prasert Thongkham']
  const plates = ['SCC6801_63-6232', 'SCC9730_64-1396', 'SCC6708_65-3411', 'SCC7810_61-7794', 'SCC7801_61-6258']
  const places = ['ถนนพหลโยธิน ตำบลลำไทร อำเภอวังน้อย จังหวัดพระนครศรีอยุธยา', 'ตำบลหนองขาม อำเภอศรีราชา จังหวัดชลบุรี',
    'ถนนรังสิต นครนายก ตำบลบึงน้ำรัก อำเภอธัญบุรี จังหวัดปทุมธานี', '36 ตำบลทับมา อำเภอเมืองระยอง จังหวัดระยอง']
  const p = (n) => String(n).padStart(2, '0')
  const rows = []
  const now = Date.now()
  for (let i = 0; i < 900; i++) {
    const d = new Date(now - rnd() ** 1.2 * 200 * 86400000)
    const reviewed = rnd() < 0.8
    rows.push({
      'หมายเลขรถ': pick(plates, 1.3), 'หน่วยงาน': pick(units, 1.4), 'ชื่อคนขับ': pick(drivers, 1.5),
      'ประเภทการแจ้งเตือน': pick(types, 2), 'วันที่': `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
      'เวลา': `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`, 'สถานที่': pick(places),
      'ความเร็ว': String(Math.round(rnd() < 0.15 ? 0 : 20 + rnd() * 75)), 'หมายเหตุโฆษณา': '',
      'สถานะการตรวจสอบ': reviewed ? 'ตรวจสอบแล้ว' : 'รอตรวจสอบ',
      'สถานะแจ้งเตือน': reviewed ? (rnd() < 0.75 ? 'แจ้งเตือนจริง' : 'แจ้งเตือนผิดพลาด') : '',
    })
  }
  return rows
}
