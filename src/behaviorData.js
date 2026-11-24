/* ------------------------------------------------------------------ */
/* Data source for the driver behavior dashboard (บันทึกพฤติกรรม พขร.)   */
/* ------------------------------------------------------------------ */
import { norm, parseDate, provinceOf } from './fleetData'
import { fetchProtectedJson } from './protectedFetch'

// Web app URL from apps-script/driver-behavior.gs (ends with /exec). Leave '' to show sample data.
// The script only answers signed-in users: the Firebase ID token is sent in a POST body.
export const BEHAVIOR_API_URL =
  'https://script.google.com/macros/s/AKfycbybNbKmgyu8krqHAAa334UxWZoiQ1w65zCEqPhweyDvLh0u92FMXlahmyMMdQOrbH29/exec'

export const REFRESH_MS = 5 * 60 * 1000

// Shared by the dashboard and the Reports page, so both count the same way.
export const LATE_DAYS = 7 // a case waiting longer than this counts as overdue
export const AGE_BANDS = [
  { label: '0–3 วัน', test: (d) => d <= 3 },
  { label: '4–7 วัน', test: (d) => d > 3 && d <= 7 },
  { label: '8–14 วัน', test: (d) => d > 7 && d <= 14 },
  { label: '15–30 วัน', test: (d) => d > 14 && d <= 30 },
  { label: 'มากกว่า 30 วัน', test: (d) => d > 30 },
]
export const SPEED_BANDS = [
  { label: 'ไม่เกิน 60', test: (s) => s <= 60 },
  { label: '61–80', test: (s) => s > 60 && s <= 80 },
  { label: '81–90', test: (s) => s > 80 && s <= 90 },
  { label: '91–100', test: (s) => s > 90 && s <= 100 },
  { label: 'มากกว่า 100', test: (s) => s > 100 },
]
// Days from the record's date to now.
export const ageDays = (r) => Math.max(0, Math.floor((Date.now() - r.start) / 86400000))

// Column names in the sheet -> field names. Matching ignores spaces, '/', '.', '-', '_', case
// and doubled Thai vowel marks. Common misspellings are listed too.
const FIELDS = {
  unit: ['หน่วยงาน', 'หน่วยงานต้นสังกัด'],
  driver: ['พขร', 'พนักงานขับรถ', 'ชื่อพขร', 'ชื่อคนขับ'],
  plate: ['ทะเบียน', 'ทะเบียนรถ', 'หมายเลขรถ'],
  location: ['สถานที่'],
  subdistrict: ['ตำบล'],
  district: ['อำเภอ'],
  province: ['จังหวัด'],
  date: ['วันที่', 'วันที่เกิดเหตุ', 'วันเวลา', 'ช่วงเวลา'],
  time: ['เวลา', 'เวลาเกิดเหตุ'],
  duration: ['ระยะเวลา'],
  offenseStatusType: ['ประเภทสถานะความผิด'],
  behavior: ['ประเภทพฤติกรรม'],
  risk: ['ระดับความเสี่ยง'],
  offense: ['ชนิดความผิด', 'ชนิดควาผิด'],
  ppe: ['อุปกรณ์ที่ไม่ได้สวมใส่', 'อุปกรณ์ที่ไม่สวมใส่', 'อุปกรณ์ที่ไม่ส่วมใส่'],
  extra: ['เพิ่มเติม'],
  detail: ['รายละเอียด'],
  count: ['จำนวนครั้ง'],
  maxSpeed: ['ความเร็วสูงสุด'],
  startSpeed: ['ความเร็วเริ่มต้น'],
  endSpeed: ['ความเร็วปลาย'],
  gforce: ['ค่าแรงโน้มถ่วง'],
  penalty: ['บทลงโทษ'],
  offenseStatus: ['สถานะความผิด'],
  photo: ['รูประหว่างการสอบสวน', 'รูประหว่างสอบสวน'],
  notice: ['หนังสือแจ้งความผิด'],
  vr: ['ใบVR'],
  cause: ['สาเหตุกระทำความผิด', 'สาเหตุการกระทำความผิด'],
  nearMiss: ['NearMiss'],
  status: ['สถานะ'],
  workDays: ['จำนวนวันทำงานในแต่ละกรณี/วัน', 'จำนวนวันทำงาน'],
  reason: ['เหตุผล', 'เหตผล'],
  reasonOther: ['เหตุผลอื่นๆ', 'เหตุผลอื่น'],
  recorder: ['ผู้บันทึกข้อมูล'],
  penaltyRecorder: ['ผู้บันทึกบทลงโทษ'],
  rsc: ['ผู้ตรวจสอบRSC', 'ผู้ตรวจRSC'],
  vrid: ['VRID'],
}
const REQUIRED = ['unit', 'driver', 'date', 'vr']

// Strip doubled Thai vowel/tone marks too (e.g. "ข้อมููล").
const key = (s) => norm(s).replace(/([ัิ-ฺ็-๎])\1+/g, '$1')

const blank = /^(|-|—|#value!|#n\/a|n\/?a|undefined|null)$/i
const val = (v) => {
  const s = String(v ?? '').trim()
  return blank.test(s) ? '' : s
}
// "No" in a yes/no cell.
const NO = /^(false|no|n|0|ไม่|ไม่ใช่|ไม่มี|ยังไม่มี|ยังไม่ได้|ไม่พบ)$/i

const num = (s) => {
  const m = String(s).replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  return m ? parseFloat(m[0]) : null
}

// Risk level text -> 4 very high, 3 high, 2 medium, 1 low, 0 unknown. Used for color and sort order.
export function riskLevel(s) {
  if (/สูงมาก|วิกฤต|critical|very\s*high/i.test(s)) return 4
  if (/สูง|high|^h$|ร้ายแรง/i.test(s)) return 3
  if (/กลาง|medium|^m$/i.test(s)) return 2
  if (/ต่ำ|น้อย|low|^l$/i.test(s)) return 1
  return 0
}

function keyMap(headers) {
  const byKey = new Map(headers.map((h) => [key(h), h]))
  const out = {}
  for (const [field, names] of Object.entries(FIELDS)) {
    const h = names.map((n) => byKey.get(key(n))).find(Boolean)
    if (h) out[field] = h
  }
  return out
}

const provinces = new Map()
const province = (loc) => {
  if (!provinces.has(loc)) provinces.set(loc, provinceOf(loc))
  return provinces.get(loc)
}

// Date + optional time. "ช่วงเวลา" may be a range like "01/11/2026 08:10 - 08:25": the start is used.
function when(date, time) {
  const dateHasTime = /\d[:.]\d\d/.test(date)
  const t = time.match(/\d{1,2}[:.]\d{2}(?:[:.]\d{2})?/)?.[0]
  const start = parseDate(t && !dateHasTime ? `${date} ${t.replace(/\./g, ':')}` : date)
  return { start, hasTime: !!start && (dateHasTime || !!t) }
}

export function toRecords(rows) {
  if (!rows.length) return { records: [], headers: [], missing: [], undated: 0 }
  const headers = Object.keys(rows[0])
  const keys = keyMap(headers)
  const missing = REQUIRED.filter((f) => !keys[f]).map((f) => FIELDS[f][0])
  const get = (row, f) => (keys[f] ? val(row[keys[f]]) : '')
  const records = []
  let undated = 0
  rows.forEach((row, i) => {
    // Rows with only overflow text (e.g. just รายละเอียด) and no case data are not cases.
    if (!['unit', 'driver', 'plate', 'date', 'vrid'].some((f) => get(row, f))) return
    const { start, hasTime } = when(get(row, 'date'), get(row, 'time'))
    if (!start) undated++
    const vr = get(row, 'vr')
    const nm = get(row, 'nearMiss')
    const location = get(row, 'location')
    const risk = get(row, 'risk')
    records.push({
      id: i,
      start,
      hasTime,
      unit: get(row, 'unit') || '(ไม่ระบุ)',
      driver: get(row, 'driver') || '(ไม่ระบุ)',
      plate: get(row, 'plate') || '(ไม่ระบุ)',
      location,
      province: get(row, 'province') || province(location),
      district: get(row, 'district'),
      behavior: get(row, 'behavior') || '(ไม่ระบุ)',
      risk: risk || '(ไม่ระบุ)',
      riskLevel: riskLevel(risk),
      offense: get(row, 'offense') || '(ไม่ระบุ)',
      offenseStatusType: get(row, 'offenseStatusType') || '(ไม่ระบุ)',
      offenseStatus: get(row, 'offenseStatus') || '(ไม่ระบุ)',
      ppe: get(row, 'ppe'),
      penalty: get(row, 'penalty') || '(ไม่ระบุ)',
      cause: get(row, 'cause') || '(ไม่ระบุ)',
      status: get(row, 'status'),
      maxSpeed: num(get(row, 'maxSpeed')),
      startSpeed: num(get(row, 'startSpeed')),
      endSpeed: num(get(row, 'endSpeed')),
      gforce: num(get(row, 'gforce')),
      nearMiss: !!nm && !NO.test(nm),
      nearMissKnown: !!nm, // the Near miss cell was filled in (yes or no)
      vr,
      responded: !!vr && !NO.test(vr),
      vrid: get(row, 'vrid'),
      rsc: get(row, 'rsc'),
      raw: row,
    })
  })
  return { records, headers, missing, undated }
}

export async function loadBehavior() {
  if (!BEHAVIOR_API_URL) return { ...toRecords(sampleRows()), sample: true }
  let json
  try {
    json = await fetchProtectedJson(BEHAVIOR_API_URL)
  } catch (e) {
    throw new Error(`Could not load the sheet (${e.message}).`)
  }
  if (json?.error) throw new Error(json.error)
  return { ...toRecords(decode(json)), sample: false }
}

// Compact format from the Apps Script: { headers, values: [uniques per column], rows: [[index...]] }.
// Also accepts a plain array of row objects, or { sheetName: rows }.
function decode(json) {
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

/* ---------- sample data, used while BEHAVIOR_API_URL is '' ---------- */

function sampleRows() {
  let a = 20261115
  const rnd = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const pick = (arr, skew = 1) => arr[Math.floor(rnd() ** skew * arr.length)]
  const units = ['SCC-BFPL-LLK', 'SCC-BFPL-SRC', 'SCC-Atlas BPK-BRP', 'SCC-NPM-BRP', 'SCC-BFPL-SRB']
  const drivers = ['สัญญา ศรสำแดง', 'อดิศักดิ์ แก้ววิเศษ', 'อนิรุทธ์ ภูมมา', 'สมศักดิ์ ศรีสง่า', 'นิสันต์ ภักดี', 'ประเสริฐ ทองคำ']
  const plates = ['63-6232', '64-1396', '65-3411', '61-7794', '61-6258']
  const places = ['ถนนพหลโยธิน ตำบลลำไทร อำเภอวังน้อย จังหวัดพระนครศรีอยุธยา', 'ตำบลหนองขาม อำเภอศรีราชา จังหวัดชลบุรี',
    'ถนนรังสิต นครนายก ตำบลบึงน้ำรัก อำเภอธัญบุรี จังหวัดปทุมธานี', '36 ตำบลทับมา อำเภอเมืองระยอง จังหวัดระยอง']
  const behaviors = ['ขับเร็วเกินกำหนด', 'เบรกกะทันหัน', 'ออกตัวกระชาก', 'เลี้ยวกระชาก', 'ใช้โทรศัพท์ขณะขับ', 'ไม่สวมอุปกรณ์ PPE', 'ง่วงนอน']
  const offenses = ['ความเร็วเกิน 80 กม./ชม.', 'ความเร็วเกิน 60 กม./ชม. ในชุมชน', 'Harsh braking', 'Harsh acceleration', 'ไม่คาดเข็มขัด']
  const risks = ['สูง', 'กลาง', 'ต่ำ']
  const penalties = ['ตักเตือนด้วยวาจา', 'ตักเตือนเป็นลายลักษณ์อักษร', 'อบรมซ้ำ', 'พักงาน']
  const causes = ['เร่งรีบส่งงาน', 'ไม่ทราบกฎ', 'สภาพถนน', 'อ่อนเพลีย', 'อื่นๆ']
  const p = (n) => String(n).padStart(2, '0')
  const rows = []
  const now = Date.now()
  for (let i = 0; i < 640; i++) {
    const d = new Date(now - rnd() ** 1.15 * 200 * 86400000)
    const age = (now - d) / 86400000
    const responded = rnd() < Math.min(0.95, age / 12)
    const behavior = pick(behaviors, 1.6)
    const speed = 40 + Math.round(rnd() * 70)
    rows.push({
      'หน่วยงาน': pick(units, 1.4), 'พขร.': pick(drivers, 1.5), 'ทะเบียน': pick(plates, 1.3), 'สถานที่': pick(places),
      'ช่วงเวลา': `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:00`,
      'ระยะเวลา': `${1 + Math.floor(rnd() * 15)} นาที`, 'ประเภทสถานะความผิด': rnd() < 0.7 ? 'ความผิดครั้งแรก' : 'ความผิดซ้ำ',
      'ประเภทพฤติกรรม': behavior, 'ระดับความเสี่ยง': pick(risks, 0.9), 'ชนิดความผิด': pick(offenses, 1.4),
      'อุปกรณ์ที่ไม่สวมใส่': behavior === 'ไม่สวมอุปกรณ์ PPE' ? pick(['หมวกนิรภัย', 'เสื้อสะท้อนแสง', 'รองเท้านิรภัย']) : '',
      'เพิ่มเติม': '', 'รายละเอียด': '', 'จำนวนครั้ง': String(1 + Math.floor(rnd() ** 3 * 5)),
      'ความเร็วสูงสุด': String(speed), 'ความเร็วเริ่มต้น': String(speed - 20), 'ความเร็วปลาย': String(speed - 35),
      'ค่าแรงโน้มถ่วง': (0.2 + rnd() * 0.5).toFixed(2), 'บทลงโทษ': responded ? pick(penalties, 1.6) : '',
      'สถานะความผิด': responded ? 'ยืนยันความผิด' : 'รอสอบสวน', 'รูประหว่างสอบสวน': '', 'หนังสือแจ้งความผิด': '',
      'ใบVR': responded ? `https://example.com/vr/${1000 + i}.pdf` : '', 'สาเหตุกระทำความผิด': responded ? pick(causes, 1.3) : '',
      'NearMiss': rnd() < 0.08 ? 'TRUE' : 'FALSE', 'สถานะ': responded ? 'ปิดเคส' : 'รอหน่วยงานตอบกลับ',
      'จำนวนวันทำงานในแต่ละกรณี/วัน': '', 'เหตุผล': '', 'เหตุผลอื่นๆ': '', 'ผู้บันทึกข้อมูล': 'RSC',
      'ผู้บันทึกบทลงโทษ': responded ? 'หัวหน้างาน' : '', 'ผู้ตรวจRSC': 'RSC-01', 'VRID': responded ? `VR${1000 + i}` : '',
    })
  }
  return rows
}
