/**
 * บันทึกพฤติกรรม พขร. -> JSON API for the driver behavior dashboard (#/dashboard/behavior).
 *
 * วิธีติดตั้ง
 *  1. เปิด Google Sheet ที่มีข้อมูลบันทึกพฤติกรรม -> เมนู Extensions (ส่วนขยาย) -> Apps Script
 *  2. ลบโค้ดเดิมใน Code.gs แล้ววางไฟล์นี้ทั้งหมด -> กด Save
 *  3. แก้ SHEET_NAME ด้านล่างให้ตรงกับชื่อแท็บชีต (เว้นว่าง '' = ใช้แท็บแรก)
 *  4. กด Deploy -> New deployment -> เลือกประเภท Web app
 *       Execute as:      Me
 *       Who has access:  Anyone
 *     กด Deploy แล้วอนุญาตสิทธิ์ (Authorize access)
 *  5. คัดลอก Web app URL (ลงท้ายด้วย /exec) ไปใส่ใน BEHAVIOR_API_URL ในไฟล์ src/behaviorData.js
 *
 * ถ้าแก้โค้ดนี้ภายหลัง ต้อง Deploy -> Manage deployments -> แก้ไข (ไอคอนดินสอ) -> Version: New version
 * ลิงก์เดิมถึงจะใช้โค้ดใหม่
 *
 * ผลลัพธ์ (แบบกะทัดรัด ค่าที่ซ้ำกันในคอลัมน์ส่งครั้งเดียว):
 *   { "headers": ["หน่วยงาน", ...],
 *     "values":  [ [ค่าที่ไม่ซ้ำของคอลัมน์ 0], [ค่าที่ไม่ซ้ำของคอลัมน์ 1], ... ],
 *     "rows":    [ [ลำดับของค่าในคอลัมน์ 0, ลำดับในคอลัมน์ 1, ...], ... ] }
 *   ค่าจริงของแถว r คอลัมน์ c = values[c][rows[r][c]]
 * แถวแรกของชีตต้องเป็นหัวคอลัมน์ แถวว่างจะถูกข้าม
 * ช่องวันที่/เวลาส่งเป็น yyyy-MM-dd / HH:mm:ss เสมอ ไม่ว่าจะจัดรูปแบบในชีตไว้อย่างไร
 * คอลัมน์ใน LINK_COLUMNS ที่เป็นลิงก์ (แทรกลิงก์ หรือ =HYPERLINK) จะส่ง URL จริงแทนข้อความที่แสดง
 */

const SHEET_NAME = '' // e.g. 'บันทึกพฤติกรรม'
const SKIP_COLUMNS = ['ลำดับ'] // columns the dashboard does not use
const LINK_COLUMNS = ['ใบVR', 'ใบ VR', 'รูประหว่างสอบสวน', 'รูประหว่างการสอบสวน', 'หนังสือแจ้งความผิด']

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

  const range = sheet.getDataRange()
  const values = range.getValues()
  const tz = ss.getSpreadsheetTimeZone()
  const allHeaders = (values[0] || []).map((h) => String(h).trim())
  const cols = []
  allHeaders.forEach((h, c) => { if (h && SKIP_COLUMNS.indexOf(h) < 0) cols.push(c) })

  // Link columns: read the URL behind the cell text (only these columns, so large sheets stay fast).
  const links = {}
  allHeaders.forEach((h, c) => { if (LINK_COLUMNS.indexOf(h) >= 0) links[c] = linkUrls(sheet, c, values.length) })

  const dicts = cols.map(() => new Map())
  const uniques = cols.map(() => [])
  const rows = []
  for (let r = 1; r < values.length; r++) {
    const src = values[r]
    let empty = true
    const out = new Array(cols.length)
    for (let k = 0; k < cols.length; k++) {
      const c = cols[k]
      let v = cell(src[c], tz)
      if (links[c] && links[c][r] && !/^https?:\/\//i.test(v)) v = links[c][r]
      if (v !== '') empty = false
      let i = dicts[k].get(v)
      if (i === undefined) { i = uniques[k].length; uniques[k].push(v); dicts[k].set(v, i) }
      out[k] = i
    }
    if (!empty) rows.push(out)
  }
  return { headers: cols.map((c) => allHeaders[c]), values: uniques, rows: rows }
}

// URL per row for one column: inserted link first, then =HYPERLINK("url", ...).
function linkUrls(sheet, c, n) {
  const rng = sheet.getRange(1, c + 1, n, 1)
  const rich = rng.getRichTextValues()
  const formulas = rng.getFormulas()
  const out = []
  for (let r = 0; r < n; r++) {
    let url = ''
    const rt = rich[r][0]
    if (rt) {
      url = rt.getLinkUrl() || ''
      if (!url) {
        const run = rt.getRuns().find((x) => x.getLinkUrl())
        if (run) url = run.getLinkUrl()
      }
    }
    if (!url) {
      const m = String(formulas[r][0] || '').match(/HYPERLINK\(\s*"([^"]+)"/i)
      if (m) url = m[1]
    }
    out.push(url)
  }
  return out
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
