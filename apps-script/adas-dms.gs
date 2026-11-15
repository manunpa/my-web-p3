/**
 * ADAS / DMS (Songdee) alerts -> JSON API for the dashboard.
 *
 * วิธีติดตั้ง
 *  1. เปิด Google Sheet ที่มีข้อมูล -> เมนู Extensions (ส่วนขยาย) -> Apps Script
 *  2. ลบโค้ดเดิมใน Code.gs แล้ววางไฟล์นี้ทั้งหมด -> กด Save
 *  3. แก้ SHEET_NAME ด้านล่างให้ตรงกับชื่อแท็บชีต (เว้นว่าง '' = ใช้แท็บแรก)
 *  4. กด Deploy -> New deployment -> เลือกประเภท Web app
 *       Execute as:      Me
 *       Who has access:  Anyone
 *     กด Deploy แล้วอนุญาตสิทธิ์ (Authorize access)
 *  5. คัดลอก Web app URL (ลงท้ายด้วย /exec) ไปใส่ใน ADAS_API_URL ในไฟล์ src/adasData.js
 *
 * ถ้าแก้โค้ดนี้ภายหลัง ต้อง Deploy -> Manage deployments -> แก้ไข (ไอคอนดินสอ) -> Version: New version
 * ลิงก์เดิมถึงจะใช้โค้ดใหม่
 *
 * ผลลัพธ์ (แบบกะทัดรัด เพราะชีตมีหลายหมื่นแถว):
 *   { "headers": ["หมายเลขรถ", ...],
 *     "values":  [ [ค่าที่ไม่ซ้ำของคอลัมน์ 0], [ค่าที่ไม่ซ้ำของคอลัมน์ 1], ... ],
 *     "rows":    [ [ลำดับของค่าในคอลัมน์ 0, ลำดับในคอลัมน์ 1, ...], ... ] }
 *   ค่าจริงของแถว r คอลัมน์ c = values[c][rows[r][c]]
 * แถวแรกของชีตต้องเป็นหัวคอลัมน์ แถวว่างจะถูกข้าม
 * ช่องวันที่/เวลาส่งเป็น yyyy-MM-dd / HH:mm:ss เสมอ ไม่ว่าจะจัดรูปแบบในชีตไว้อย่างไร
 */

const SHEET_NAME = '' // e.g. 'ADAS DMS'
const SKIP_COLUMNS = ['ลำดับ'] // columns the dashboard does not use

function doGet(e) {
  try {
    const name = (e && e.parameter && e.parameter.sheet) || SHEET_NAME
    return json(readSheet(name))
  } catch (err) {
    return json({ error: String(err && err.message || err) })
  }
}

function readSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet()
  const sheet = name ? ss.getSheetByName(name) : ss.getSheets()[0]
  if (!sheet) throw new Error('ไม่พบชีตชื่อ "' + name + '"')

  // getValues only: getDisplayValues doubles the read time on large sheets.
  const values = sheet.getDataRange().getValues()
  const tz = ss.getSpreadsheetTimeZone()
  const allHeaders = (values[0] || []).map((h) => String(h).trim())
  const cols = []
  allHeaders.forEach((h, c) => { if (h && SKIP_COLUMNS.indexOf(h) < 0) cols.push(c) })

  const dicts = cols.map(() => new Map())
  const uniques = cols.map(() => [])
  const rows = []
  for (let r = 1; r < values.length; r++) {
    const src = values[r]
    let empty = true
    const out = new Array(cols.length)
    for (let k = 0; k < cols.length; k++) {
      const v = cell(src[cols[k]], tz)
      if (v !== '') empty = false
      let i = dicts[k].get(v)
      if (i === undefined) { i = uniques[k].length; uniques[k].push(v); dicts[k].set(v, i) }
      out[k] = i
    }
    if (!empty) rows.push(out)
  }
  return { headers: cols.map((c) => allHeaders[c]), values: uniques, rows: rows }
}

/* ---------- cell -> text ---------- */

const pad = (n) => (n < 10 ? '0' : '') + n

// Offset of the sheet's time zone from UTC, looked up once per day (Utilities.formatDate is slow).
const offsets = {}
function offsetMs(d, tz) {
  const day = Math.floor(d.getTime() / 86400000)
  if (offsets[day] === undefined) {
    const p = Utilities.formatDate(d, tz, 'yyyy,MM,dd,HH,mm,ss').split(',').map(Number)
    const local = Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4], p[5])
    offsets[day] = local - Math.floor(d.getTime() / 1000) * 1000
  }
  return offsets[day]
}

function cell(v, tz) {
  if (v === null || v === undefined || v === '') return ''
  if (!(v instanceof Date)) return String(v).trim()
  if (isNaN(v)) return ''
  const t = new Date(v.getTime() + offsetMs(v, tz)) // read with getUTC* = sheet local time
  const time = pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes()) + ':' + pad(t.getUTCSeconds())
  if (t.getUTCFullYear() < 1901) return time // time-only cell
  const date = t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate())
  return time === '00:00:00' ? date : date + ' ' + time
}

function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON)
}
