// Converts delivery plans in any layout (BPK daily report, SRC OrderUpdate, SCN monthly plan,
// or a file already in the standard layout) into the standard "ตัวอย่าง แผนงานจัดส่ง" layout.
// Everything runs in the browser: files are never uploaded anywhere.

export const OUT_HEAD = [
  'ลำดับ', 'วัน/เดือน/ปี', 'ผู้ขนส่ง', 'คลังต้นทาง(คลังที่โหลด)', 'ลูกค้าปลายทาง', 'วัน/เวลา ที่ต้องถึงลูกค้า',
  'ระยะทางขาไป (กม.)', 'วัน/เวลา ที่ต้องออกเดินทาง', 'เวลาที่ต้องมาเริ่มงาน', 'ทะเบียนหัว', 'พขร.1', 'TRIP', 'TRIP_DROP',
]
const OUT_WIDTH = [13, 13, 13, 13, 33.7, 14.9, 13, 14.9, 14, 15, 13.1, 9.7, 13] // same as the template
const START_BEFORE_DEPART_MIN = 30 // template: start work 30 minutes before departure

// Which input field a header cell means. Order matters: the first match wins.
const HEADER_RULES = [
  ['ignore', /พขร\.?ถึง/], // actual arrival time, filled in later
  ['tripDrop', /TRIP_DROP/i],
  ['trip', /^TRIP$|^เที่ยว/i],
  ['tail', /ทะเบียนหาง/],
  ['plate', /ทะเบียน|VEHICLE/i],
  ['code', /รหัส/],
  ['surname', /^นามสกุล/],
  ['driver2', /พขร\.?\s*2|ฝึกงาน|HELPER/i],
  ['driver', /พขร|DRIVER|พนักงานขับรถ|คนขับ/i],
  ['start', /เริ่มงาน/],
  ['depart', /ออกเดินทาง/],
  ['arrive', /ถึงลูกค้า|ถึงปลายทาง/],
  ['distance', /ระยะทาง/],
  ['depot', /สถานที่โหลด|คลังต้นทาง|คลังที่โหลด/],
  ['customer', /ลูกค้า|CUSTOMER|SHIPTO/i],
  ['qty', /ปริมาณ|QTY/i],
  ['order', /ออเดอร์|ORDER/i],
  ['note', /หมายเหตุ|REMARK/i],
  ['seq', /^ลำดับ$|^NO\.?$/i],
  ['date', /วัน\/เดือน|^วันที่$|^DATE$/i],
  ['carrier', /ผู้ขนส่ง|CARRIER/i],
]

export const FIELD_LABEL = {
  plate: 'ทะเบียน', driver: 'พขร.', customer: 'ลูกค้า', arrive: 'เวลาถึงลูกค้า', depart: 'เวลาออกเดินทาง',
  start: 'เวลาเริ่มงาน', depot: 'คลังที่โหลด', trip: 'เที่ยว', distance: 'ระยะทาง', qty: 'ปริมาณ',
}

const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม',
  'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']

// ---------- small helpers ----------

const clean = (v) => {
  if (v == null) return null
  if (typeof v !== 'string') return v
  const s = v.replace(/[ \t]/g, ' ').replace(/[ ]{2,}/g, ' ').trim()
  return s === '' ? null : s
}
const text = (v) => (v == null ? null : String(v))
const num = (v) => {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && /^\s*[\d,]+(\.\d+)?\s*$/.test(v)) return Number(v.replace(/,/g, ''))
  return null
}
const pad = (n) => String(n).padStart(2, '0')

// 2-digit years are Buddhist (69 -> 2569 -> 2026); 4-digit years above 2400 are Buddhist too.
const toCE = (y) => {
  y = Number(y)
  if (y < 100) y += 2500
  return y > 2400 ? y - 543 : y
}
const validYMD = (y, m, d) => y > 1990 && y < 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31

// Excel serial day -> {y, m, d}
const serialDate = (n) => {
  const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}
const serialTime = (n) => {
  const mins = Math.round((n - Math.floor(n)) * 1440) % 1440
  return { h: Math.floor(mins / 60), mi: mins % 60 }
}

// Finds a date inside text: "23/11/2569", "24.11.69", "23 / 11 / 2026", "23 พฤศจิกายน 2569".
export function findDate(s) {
  if (!s) return null
  s = String(s)
  let m = s.match(/(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2,4})/)
  if (m) {
    const r = { y: toCE(m[3]), m: +m[2], d: +m[1] }
    if (validYMD(r.y, r.m, r.d)) return r
  }
  m = s.match(new RegExp(`(\\d{1,2})\\s*(${THAI_MONTHS.join('|')})\\s*(\\d{4})`))
  if (m) return { y: toCE(m[3]), m: THAI_MONTHS.indexOf(m[2]) + 1, d: +m[1] }
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (m && validYMD(+m[1], +m[2], +m[3])) return { y: +m[1], m: +m[2], d: +m[3] }
  return null
}

// Reads a date and/or time from a cell: Excel numbers, "14:00 น.", "11:00:น.", "10;30", "16.00น.",
// "ออกเวลา 5.00น.", "12/11/2569 06.00 น.".
export function parseWhen(v) {
  v = clean(v)
  if (v == null) return null
  if (typeof v === 'number') {
    if (v < 0) return null
    if (v < 1) return { time: serialTime(v) }
    const date = serialDate(v)
    return v % 1 ? { date, time: serialTime(v) } : { date }
  }
  let s = String(v)
  const date = findDate(s)
  if (date) s = s.replace(/(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2,4})/, ' ')
  let time = null
  let m = s.match(/(\d{1,2})\s*[:.;]\s*(\d{2})/)
  if (m && +m[1] < 24 && +m[2] < 60) time = { h: +m[1], mi: +m[2] }
  else if ((m = s.match(/(?:^|\D)(\d{1,2})\s*(?:น|โมง)/)) && +m[1] < 24) time = { h: +m[1], mi: 0 }
  return date || time ? { date, time } : null
}

const at = (ymd, time) => new Date(ymd.y, ymd.m - 1, ymd.d, time?.h ?? 0, time?.mi ?? 0)
const ymdOf = (dt) => ({ y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() })
const be = (dt) => `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear() + 543}`
const fmtArrive = (dt) => `${be(dt)} ${pad(dt.getHours())}.${pad(dt.getMinutes())} น.` // template uses a dot here
const fmtDepart = (dt) => `${be(dt)} ${pad(dt.getHours())}:${pad(dt.getMinutes())} น.`
export const toInputDate = (ymd) => `${ymd.y}-${pad(ymd.m)}-${pad(ymd.d)}`
export const fromInputDate = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '')
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null
}

// "scc501 / 62-4245" -> "62-4245", "60-0702/73-6476 " -> "60-0702", "66-0756(รถ8ตัน)" -> "66-0756"
const cleanPlate = (v) => {
  const s = text(clean(v))
  if (!s) return null
  const m = s.match(/\d{1,3}\s*-\s*\d{3,4}/)
  return m ? m[0].replace(/\s/g, '') : s
}

// Name only: first line, no employee code, no phone number.
const cleanName = (s) => {
  s = text(s)
  if (!s) return null
  s = s.split(/\n/)[0]
    .replace(/\d{2,3}-?\d{3}-?\d{3,4}/g, ' ')
    .replace(/^\s*\d+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return s || null
}

const tripNumber = (v) => {
  const n = num(v) ?? (typeof v === 'string' ? Number((v.match(/^\s*(\d{1,2})/) || [])[1]) : NaN)
  return n >= 1 && n <= 20 ? n : null
}

const depotName = (s) => {
  s = text(clean(s))
  if (!s) return null
  if (/บางปะกง/.test(s)) return 'BPK'
  return s
}
// "โหลดคลังพิจิตร" -> "พิจิตร"
const depotFromNote = (s) => {
  const m = text(s)?.match(/โหลด(?:ที่)?คลัง\s*([^\s/,]+)/)
  return m ? depotName(m[1]) : null
}

// Guess the depot code from a file name or sheet title.
export function guessDepot(...texts) {
  const s = texts.filter(Boolean).join(' ')
  if (/BPK|บางปะกง/i.test(s)) return 'BPK'
  for (const code of ['BRP', 'SRC', 'SCN']) if (new RegExp(code, 'i').test(s)) return code
  return ''
}

// ---------- header detection ----------

function classify(cell) {
  const s = text(clean(cell))
  if (!s || s.length > 40) return null
  const k = s.replace(/\s+/g, '')
  for (const [field, re] of HEADER_RULES) if (re.test(k)) return field
  return 'other'
}

export function findHeader(rows) {
  let best = null
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const cols = {}
    const bounds = []
    ;(rows[r] || []).forEach((cell, c) => {
      const f = classify(cell)
      if (!f) return
      bounds.push(c)
      if (f !== 'other' && cols[f] == null) cols[f] = c
    })
    if (cols.customer == null || (cols.plate == null && cols.driver == null)) continue
    const score = Object.keys(cols).length
    if (!best || score > best.score) best = { row: r, cols, bounds, score }
  }
  return best
}

// ---------- rows -> trips ----------

// rows: 2-D array of raw cell values (Excel numbers for dates/times).
// opts: { date: {y,m,d}, depot, carrier }
export function convertSheet(rows, opts) {
  const head = findHeader(rows)
  if (!head) return { error: 'ไม่พบหัวตาราง (ต้องมีคอลัมน์ลูกค้า และทะเบียนรถหรือชื่อ พขร.)' }
  const { cols, bounds } = head
  const has = (f) => cols[f] != null
  const get = (row, f) => (has(f) ? clean(row[cols[f]]) : null)
  // A header can cover merged cells ("ชื่อพนักงานขับรถ" spans code, name, surname): read until the next header.
  const span = (row, f) => {
    if (!has(f)) return []
    const from = cols[f]
    const to = bounds.find((c) => c > from) ?? from + 1
    return row.slice(from, to).map(clean).filter((v) => v != null)
  }
  const driverOf = (row) => {
    const parts = span(row, 'driver').filter((v) => typeof v === 'string' && !/^\d+$/.test(v))
    const surname = get(row, 'surname')
    if (surname) parts.push(surname)
    return cleanName(parts.join(' '))
  }

  const trips = []
  const perPlate = new Map()
  let group = null
  let trip = null
  let skipped = 0

  for (let r = head.row + 1; r < rows.length; r++) {
    const row = rows[r] || []
    const plateRaw = get(row, 'plate')
    const isNew = plateRaw != null || (has('seq') && num(get(row, 'seq')) != null)
    if (isNew) {
      const dateCell = parseWhen(get(row, 'date'))
      group = {
        plate: cleanPlate(plateRaw),
        driver: driverOf(row),
        depot: depotName(get(row, 'depot')),
        carrier: text(get(row, 'carrier')),
        date: dateCell?.date || null,
        row: r,
      }
      trip = null
    }
    if (!group) continue

    const customer = text(get(row, 'customer'))
    const qtyCell = get(row, 'qty')
    const qty = num(qtyCell)
    const arrive = parseWhen(get(row, 'arrive'))
    const isDrop = customer && qty !== 0 && (qty > 0 || arrive?.time || get(row, 'order') != null)
    if (!isDrop) {
      if (customer || qty) skipped++
      continue
    }

    const no = tripNumber(get(row, 'trip'))
    if (!trip || (no && no !== trip.no)) {
      const count = (perPlate.get(group.plate) || 0) + 1
      perPlate.set(group.plate, count)
      const whenCell = (f) => {
        const w = parseWhen(get(row, f))
        if (w && !w.date) { // a date written on the line below, e.g. "(22/11/69)"
          const below = rows[r + 1] && clean(rows[r + 1][cols[f]])
          const d = below != null && typeof below === 'string' && !parseWhen(below)?.time ? findDate(below) : null
          if (d) w.date = d
        }
        return w
      }
      trip = {
        plate: group.plate,
        driver: group.driver || driverOf(row),
        carrier: group.carrier,
        depot: depotName(get(row, 'depot')) || group.depot,
        date: group.date,
        depart: whenCell('depart'),
        start: whenCell('start'),
        no: no || count,
        notes: [],
        drops: [],
      }
      trips.push(trip)
    }
    trip.notes.push(get(row, 'note'))
    trip.drops.push({ customer, arrive, distance: num(get(row, 'distance')) })
  }

  for (const t of trips) {
    if (!t.depot) t.depot = t.notes.map(depotFromNote).find(Boolean) || opts.depot || null
    if (!t.carrier) t.carrier = opts.carrier || null
    resolveTimes(t, t.date || opts.date)
  }
  const found = Object.keys(FIELD_LABEL).filter(has)
  return { trips, headerRow: head.row + 1, found, skipped }
}

// Turns the read times into full date-times. The plan date is the departure day; an arrival
// earlier than the previous time of the same trip is the next day.
function resolveTimes(t, base) {
  t.departAt = t.depart?.time ? at(t.depart.date || base, t.depart.time) : null
  t.startAt = t.start?.time
    ? at(t.start.date || base, t.start.time)
    : t.departAt ? new Date(t.departAt.getTime() - START_BEFORE_DEPART_MIN * 60000) : null
  let ref = t.departAt || t.startAt
  for (const d of t.drops) {
    d.at = null
    if (!d.arrive?.time) continue
    let dt = at(d.arrive.date || (ref ? ymdOf(ref) : base), d.arrive.time)
    if (!d.arrive.date && ref && dt < ref) dt = new Date(dt.getTime() + 86400000)
    d.at = dt
    ref = dt
  }
  t.dateYmd = t.departAt ? ymdOf(t.departAt) : t.startAt ? ymdOf(t.startAt) : base
}

// trips -> output rows in the template layout. The first drop of a trip carries the trip details,
// later drops only the customer, arrival time, distance and drop number.
export function toRows(trips) {
  const out = []
  trips.forEach((t, i) => {
    t.drops.forEach((d, j) => {
      const first = j === 0
      out.push([
        first ? i + 1 : null,
        first ? t.dateYmd : null,
        first ? t.carrier : null,
        first ? t.depot : null,
        d.customer,
        d.at ? fmtArrive(d.at) : null,
        d.distance,
        first && t.departAt ? fmtDepart(t.departAt) : null,
        first && t.startAt ? fmtDepart(t.startAt) : null,
        first ? t.plate : null,
        first ? t.driver : null,
        first ? t.no : null,
        j + 1,
      ])
    })
  })
  return out
}

export const fmtYmd = (ymd) => (ymd ? `${pad(ymd.d)}/${pad(ymd.m)}/${ymd.y + 543}` : '')

// ---------- reading and writing files ----------

let xlsxLib
const loadXlsx = () => (xlsxLib ??= import('xlsx'))

export async function readBook(buf) {
  const XLSX = await loadXlsx()
  return XLSX.read(buf, { type: 'array', bookSheets: true }).SheetNames
}

export async function readSheet(buf, name) {
  const XLSX = await loadXlsx()
  const wb = XLSX.read(buf, { type: 'array', sheets: name })
  const ws = wb.Sheets[name]
  if (!ws) return []
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true })
}

// Picks the sheet for a date: "23-11-69", "23.11.2569", "23" (a monthly file with one sheet per day).
export function sheetForDate(names, ymd) {
  const byDate = names.find((n) => {
    const d = findDate(n)
    return d && d.y === ymd.y && d.m === ymd.m && d.d === ymd.d
  })
  return byDate ?? names.find((n) => n.trim() === String(ymd.d)) ?? null
}

// The sheet to convert: the one named after the date, otherwise the one with the most deliveries.
export async function pickSheet(buf, names, ymd) {
  const named = sheetForDate(names, ymd)
  if (named) return named
  let best = names[0]
  let most = -1
  for (const name of names.slice(0, 20)) {
    const res = convertSheet(await readSheet(buf, name), { date: ymd })
    const drops = res.trips ? res.trips.reduce((n, t) => n + t.drops.length, 0) : -1
    if (drops > most) { most = drops; best = name }
  }
  return best
}

// The plan date written in the sheet's title rows, or in the sheet name.
export function sheetDate(rows, sheetName, fileName) {
  for (const row of rows.slice(0, 6)) {
    for (const cell of row || []) {
      const s = text(clean(cell))
      if (s && /วันที่|ประจำ|แผนงาน/.test(s)) {
        const d = findDate(s)
        if (d) return d
      }
    }
  }
  return findDate(sheetName) || findDate(fileName)
}

export async function writeXlsx(rows) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('แผนงานจัดส่ง', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = OUT_WIDTH.map((width) => ({ width }))
  const font = { name: 'Browallia New', size: 11 } // same as the template
  const border = Object.fromEntries(['top', 'left', 'bottom', 'right'].map((k) => [k, { style: 'thin' }]))

  const head = ws.addRow(OUT_HEAD)
  head.height = 33
  head.eachCell((c, i) => {
    c.font = { ...font, bold: true, color: { argb: i === 8 ? 'FFFF0000' : 'FF000000' } }
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    c.border = border
    if (i >= 4 && i <= 8) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }
  })

  for (const r of rows) {
    const values = r.map((v, i) => (i === 1 && v ? new Date(Date.UTC(v.y, v.m - 1, v.d)) : v))
    const row = ws.addRow(values)
    for (let i = 1; i <= OUT_HEAD.length; i++) {
      const c = row.getCell(i)
      c.font = font
      c.border = border
      c.alignment = { vertical: 'middle', horizontal: i === 5 || i === 11 ? 'left' : 'center' }
    }
    row.getCell(2).numFmt = 'd-mmm' // same as the template
  }
  return wb.xlsx.writeBuffer()
}
