/* ------------------------------------------------------------------ */
/* Data source for the fleet-alert dashboard                             */
/* ------------------------------------------------------------------ */

import { fetchProtectedJson } from './protectedFetch'
import { stopType } from './stopType'

// Google Sheet data link. Set to '' to show sample data instead.
// Supported link types:
//   - Apps Script web app returning JSON (array of objects keyed by column name)  <- current
//   - Sheets API v4:   https://sheets.googleapis.com/v4/spreadsheets/<ID>/values/<Sheet>?key=<KEY>
//   - gviz JSON:       https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:json&sheet=<Sheet>
//   - Published CSV:   https://docs.google.com/spreadsheets/d/e/<...>/pub?output=csv
// The LEO Apps Script only answers signed-in users: the Firebase ID token is checked by
// the script (code: my-website-pm/apps-script/leo.gs, shared with my-website-pm).
export const API_URL =
  'https://script.google.com/macros/s/AKfycbyWoNoFrTC1Ep3j395aio1ZP9E9qrTwubtUei2uydmoHnsIigYk7V8jN29wvl32t84W/exec'

// How often the dashboard re-loads the sheet while open.
export const REFRESH_MS = 5 * 60 * 1000

// Column names in the sheet -> field names in the code.
// Matching ignores spaces, '/', '.', '-' and letter case. Add aliases if a header changes.
const FIELDS = {
  caseNo: ['Case No', 'เลขเคส', 'caseno'],
  driverId: ['รหัสคนขับ', 'driverid'],
  driver: ['ชื่อคนขับ', 'คนขับ', 'พนักงานขับรถ', 'driver'],
  plate: ['ทะเบียนรถ', 'ทะเบียน', 'plate'],
  start: ['วัน/เวลาเริ่ม', 'วัน/เวลาที่เริ่ม', 'เวลาเริ่ม', 'เริ่ม', 'start'],
  end: ['วัน/เวลาสิ้นสุด', 'เวลาสิ้นสุด', 'สิ้นสุด', 'end'],
  duration: ['รวมเวลา', 'ระยะเวลา', 'duration'],
  status: ['สถานะรถ', 'สถานะ', 'status'],
  location: ['สถานที่', 'location'],
  doNo: ['เลข DO', 'เลขที่ DO', 'DO'],
  request: ['ขอปลด', 'request'],
  approval: ['อนุมัติ/ ไม่อนุมัติ', 'ผลอนุมัติ', 'อนุมัติ', 'approval'],
  priority: ['ความสำคัญ', 'priority'],
  releasedAt: ['วันที่ปลด', 'releasedat'],
  releasedBy: ['ผู้ปลด', 'releasedby'],
  reason: ['สาเหตุที่ปลดล็อค', 'สาเหตุที่ปลด', 'สาเหตุ', 'reason'],
  devices: ['จำนวน GPS/CCTV', 'gpscctv'],
}

export const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s/._\-]/g, '')

function mapHeaders(headers) {
  const hs = headers.map(norm)
  const idx = {}
  const used = new Set()
  // Pass 1: exact matches. Pass 2: header contains one of the names.
  for (const exact of [true, false]) {
    for (const [key, names] of Object.entries(FIELDS)) {
      if (key in idx) continue
      const ns = names.map(norm)
      const i = hs.findIndex((h, j) => !used.has(j) && h && (exact ? ns.includes(h) : ns.some((n) => h.includes(n))))
      if (i >= 0) { idx[key] = i; used.add(i) }
    }
  }
  return idx
}

/* ---------- response formats -> 2D table (first row = headers) ---------- */

function parseCSV(text) {
  const rows = []
  let row = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

function fromGviz(text) {
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
  if (json.status === 'error') throw new Error(json.errors?.[0]?.detailed_message || 'Google Sheet returned an error')
  const { cols, rows } = json.table
  const body = rows.map((r) => (r.c || []).map((c) => {
    if (!c) return ''
    if (typeof c.v === 'string' && c.v.startsWith('Date(')) return c.v
    return c.f ?? c.v ?? ''
  }))
  const labels = cols.map((c) => c.label)
  return labels.some(Boolean) ? [labels, ...body] : body // no labels -> first row holds the headers
}

export function toTable(text) {
  const t = text.trim()
  if (t.includes('google.visualization.Query.setResponse')) return fromGviz(t)
  if (t.startsWith('{') || t.startsWith('[')) {
    const j = JSON.parse(t)
    if (Array.isArray(j?.values)) return j.values
    const arr = Array.isArray(j) ? j : (j.data ?? j.rows ?? j.items ?? j.records)
    if (!Array.isArray(arr)) throw new Error('Unrecognised JSON format')
    if (!arr.length || Array.isArray(arr[0])) return arr
    const headers = Object.keys(arr[0])
    return [headers, ...arr.map((o) => headers.map((h) => o[h]))]
  }
  if (/^\s*<(!doctype|html)/i.test(t)) throw new Error('The link returned a web page, not data. Is the sheet / script shared publicly?')
  return parseCSV(t)
}

/* ---------- cell values ---------- */

const yearFix = (y) => (y < 100 ? y + 2000 : y > 2400 ? y - 543 : y) // 2-digit and Thai Buddhist years

export function parseDate(v) {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date) return isNaN(v) ? null : v
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) { // spreadsheet serial day number
      const d = new Date(1899, 11, 30)
      d.setTime(d.getTime() + Math.round(v * 86400000))
      return d
    }
    return null
  }
  const s = String(v).trim()
  let m = s.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/)
  if (m) return new Date(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0))

  const time = (h, mi, sec) => [+(h || 0), +(mi || 0), +(sec || 0)]
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (m && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(yearFix(+m[1]), +m[2] - 1, +m[3], ...time(m[4], m[5], m[6]))

  // Thai sheets: day/month/year [hour:minute[:second]]
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T,]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?/)
  if (m) {
    let [d, mo] = [+m[1], +m[2]]
    if (mo > 12 && d <= 12) [d, mo] = [mo, d] // month/day/year
    return new Date(yearFix(+m[3]), mo - 1, d, ...time(m[4], m[5], m[6]))
  }
  const t = Date.parse(s)
  return isNaN(t) ? null : new Date(t)
}

// Returns minutes.
export function parseDuration(v, start, end) {
  if (typeof v === 'number') return v < 1 ? v * 1440 : v
  const s = String(v ?? '').trim()
  let m = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/)
  if (m) return +m[1] * 60 + +m[2] + (+m[3] || 0) / 60
  if (s) {
    let total = 0, hit = false
    for (const [, n, unit] of s.matchAll(/(\d+(?:\.\d+)?)\s*(วัน|ชั่วโมง|ชม|นาที|day|hour|hr|min)/gi)) {
      hit = true
      const u = unit.toLowerCase()
      total += +n * (u === 'วัน' || u === 'day' ? 1440 : /^(ชั่วโมง|ชม|hour|hr)$/.test(u) ? 60 : 1)
    }
    if (hit) return total
    if (/^\d+(\.\d+)?$/.test(s)) return +s
  }
  if (start && end && end > start) return (end - start) / 60000
  return null
}

const PROVINCES = ('กรุงเทพมหานคร กระบี่ กาญจนบุรี กาฬสินธุ์ กำแพงเพชร ขอนแก่น จันทบุรี ฉะเชิงเทรา ชลบุรี ชัยนาท ' +
  'ชัยภูมิ ชุมพร เชียงราย เชียงใหม่ ตรัง ตราด ตาก นครนายก นครปฐม นครพนม นครราชสีมา นครศรีธรรมราช นครสวรรค์ ' +
  'นนทบุรี นราธิวาส น่าน บึงกาฬ บุรีรัมย์ ปทุมธานี ประจวบคีรีขันธ์ ปราจีนบุรี ปัตตานี พระนครศรีอยุธยา พะเยา พังงา ' +
  'พัทลุง พิจิตร พิษณุโลก เพชรบุรี เพชรบูรณ์ แพร่ ภูเก็ต มหาสารคาม มุกดาหาร แม่ฮ่องสอน ยโสธร ยะลา ร้อยเอ็ด ระนอง ' +
  'ระยอง ราชบุรี ลพบุรี ลำปาง ลำพูน เลย ศรีสะเกษ สกลนคร สงขลา สตูล สมุทรปราการ สมุทรสงคราม สมุทรสาคร สระแก้ว ' +
  'สระบุรี สิงห์บุรี สุโขทัย สุพรรณบุรี สุราษฎร์ธานี สุรินทร์ หนองคาย หนองบัวลำภู อ่างทอง อำนาจเจริญ อุดรธานี ' +
  'อุตรดิตถ์ อุทัยธานี อุบลราชธานี').split(' ')

// The province is the last province name that appears in the address.
export function provinceOf(location) {
  const s = location.replace(/กรุงเทพฯ|กทม\.?/g, 'กรุงเทพมหานคร')
  let best = null, at = -1
  for (const p of PROVINCES) {
    const i = s.lastIndexOf(p)
    if (i > at || (i >= 0 && i === at && p.length > best.length)) { best = p; at = i }
  }
  return best || '(ไม่ระบุ)'
}

// Sub-district + district of an address, so the same place written two ways counts as one:
//   "ถนนลำลูกกา ตำบลลาดสวาย อำเภอลำลูกกา จังหวัดปทุมธานี ..." and "ลาดสวาย, ลำลูกกา, ปทุมธานี"
//   -> "ลาดสวาย · ลำลูกกา". Returns '' when the address does not say (then only the province is known).
export function areaOf(location) {
  const s = String(location ?? '').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  const clean = (x) => String(x ?? '').replace(/^(ตำบล|แขวง|อำเภอ|เขต|อ\.|ต\.)\s*/, '').replace(/^เมือง(?=\S)/, 'เมือง').trim()
  const tam = s.match(/(?:ตำบล|แขวง|ต\.)\s*([^\s,]+)/)
  const amp = s.match(/(?:อำเภอ|เขต|อ\.)\s*([^\s,]+)/)
  if (tam && amp) return `${clean(tam[1])} · ${clean(amp[1])}`
  // "ท่าตูม, ศรีมหาโพธิ, ปราจีนบุรี" or "หนองขาม ศรีราชา ชลบุรี": sub-district, district, province
  const parts = (s.includes(',') ? s.split(',') : s.split(' '))
    .map((x) => x.replace(/\s*\d{5}$/, '').trim()) // "กรุงเทพมหานคร 10800" -> "กรุงเทพมหานคร"
    .filter((x) => x && !/^\d+$/.test(x))
  const pi = parts.findIndex((x) => PROVINCES.includes(x.replace(/^จังหวัด/, '')) || x === 'กรุงเทพมหานคร')
  if (pi >= 2 && !/\d|ประเทศ/.test(parts[pi - 1] + parts[pi - 2])) return `${clean(parts[pi - 2])} · ${clean(parts[pi - 1])}`
  if (amp) return clean(amp[1])
  return ''
}

// Google Sheets turns a cell like "3100128975,3100128976" (two DO numbers) into one huge number
// shown as "31,001,289,753,100,100,000". Only the first 10 digits survive intact.
function cleanDo(v) {
  const s = String(v ?? '').trim()
  if (!s.includes(',') || !/^[\d,]+$/.test(s)) return { doNo: s, doBroken: false }
  const digits = s.replace(/,/g, '')
  if (digits.length <= 12) return { doNo: digits, doBroken: false } // a single number shown with separators
  return { doNo: digits.slice(0, 10), doBroken: true }
}

const falsy = /^(false|no|n|ไม่|ไม่ขอ|0|-|—)$/i

// approved | rejected | pending (asked, no decision yet) | open (not asked yet)
function stageOf(approval, requested, releasedAt) {
  const a = norm(approval)
  if (a.includes('ไม่อนุมัติ') || /^(reject|rejected|denied|no|false)$/.test(a)) return 'rejected'
  if (a.includes('อนุมัติ') || /^(approve|approved|yes|true|ok)$/.test(a)) return 'approved'
  if (!a && releasedAt) return 'approved'
  if (requested || a.includes('รอ') || a.includes('pending')) return 'pending'
  return 'open'
}

export function toRecords(table) {
  const [headers = [], ...body] = table
  const idx = mapHeaders(headers)
  const missing = ['driver', 'plate', 'start', 'status'].filter((k) => !(k in idx))
  const get = (row, k) => (k in idx ? row[idx[k]] ?? '' : '')
  const text = (row, k) => String(get(row, k)).trim()

  const records = body
    .filter((row) => row.some((c) => String(c ?? '').trim() !== ''))
    .map((row, i) => {
      const start = parseDate(get(row, 'start'))
      const end = parseDate(get(row, 'end'))
      const releasedAt = parseDate(get(row, 'releasedAt'))
      const req = text(row, 'request')
      const requested = !!req && !falsy.test(req)
      const approval = text(row, 'approval')
      const location = text(row, 'location')
      return {
        id: i,
        caseNo: text(row, 'caseNo'),
        driverId: text(row, 'driverId'),
        driver: text(row, 'driver') || '(ไม่ระบุ)',
        plate: text(row, 'plate') || '(ไม่ระบุ)',
        start, end,
        minutes: parseDuration(get(row, 'duration'), start, end),
        status: text(row, 'status') || '(ไม่ระบุ)',
        location,
        province: provinceOf(location),
        area: areaOf(location),
        ...cleanDo(get(row, 'doNo')),
        requested,
        approval,
        stage: stageOf(approval, requested, releasedAt),
        priority: text(row, 'priority').toUpperCase(),
        releasedAt,
        releasedBy: text(row, 'releasedBy'),
        reason: text(row, 'reason'),
        stopType: stopType(text(row, 'reason')),
        devices: text(row, 'devices'),
      }
    })
    .filter((r) => r.start)

  return { records, missing }
}

export async function loadAlerts() {
  if (!API_URL) return { ...toRecords(sampleTable()), sample: true }
  let json
  try {
    json = await fetchProtectedJson(API_URL)
  } catch (e) {
    throw new Error(`Could not load the sheet (${e.message}).`)
  }
  return { ...toRecords(toTable(JSON.stringify(json))), sample: false }
}

/* ---------- sample data, shaped like the real sheet (used when API_URL is '') ---------- */

function sampleTable() {
  let a = 20261114
  const rnd = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const pick = (arr, skew = 1) => arr[Math.floor(rnd() ** skew * arr.length)]
  const drivers = ['นายสมชาย ใจดี', 'นายประเสริฐ ทองคำ', 'นายวิชัย แสงทอง', 'นายสมศักดิ์ มั่นคง', 'นายอนุชา ศรีสุข', 'นายธนพล วงศ์ใหญ่']
  const plates = ['701234กท', '705521กท', '710088กท', '709142กท', '723307กท']
  const statuses = ['จอดนอกจุด', 'ขับต่อเนื่องเกิน 4 ชั่วโมง', 'พักผ่อนน้อยกว่า 8 ชั่วโมง', 'ขับเร็วเกินกำหนด']
  const places = ['บางนาเหนือ, บางนา, กรุงเทพมหานคร', 'ลาดสวาย, ลำลูกกา, ปทุมธานี', 'ถนนพหลโยธิน ตำบลลำไทร อำเภอวังน้อย จังหวัดพระนครศรีอยุธยา']
  const reasons = ['จอดติดไฟแดง', 'การจราจรติดขัด', 'รอขึ้นสินค้า', 'ลงน้ำมัน']
  const p = (n) => String(n).padStart(2, '0')
  const fmt = (d) => `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${d.getHours()}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  const headers = Object.keys(FIELDS).map((k) => FIELDS[k][0])
  const rows = [headers]
  const now = Date.now()
  for (let i = 0; i < 400; i++) {
    const start = new Date(now - rnd() ** 1.3 * 90 * 86400000)
    const mins = Math.round(2 + rnd() ** 2 * 300)
    const end = new Date(start.getTime() + mins * 60000)
    const ok = rnd() < 0.985
    const row = {
      caseNo: `PK-${i}`, driverId: `SCC${p(i % 60)}`, driver: pick(drivers, 1.5), plate: pick(plates, 1.3),
      start: fmt(start), end: fmt(end), duration: `${Math.floor(mins / 60)}:${p(mins % 60)}:00`,
      status: pick(statuses, 2.2), location: pick(places), doNo: String(3100000000 + i), request: 'พิจารณาแล้ว',
      approval: ok ? 'อนุมัติ' : 'ไม่อนุมัติ', priority: rnd() < 0.68 ? 'A' : 'B',
      releasedAt: fmt(new Date(end.getTime() + rnd() * 4 * 3600000)), releasedBy: pick(['SCK', 'KNM', 'PTK']),
      reason: pick(reasons), devices: '2 (1/1)',
    }
    rows.push(Object.keys(FIELDS).map((k) => row[k]))
  }
  return rows
}
