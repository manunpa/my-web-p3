/**
 * BSRC alerts (Telegram "แจ้งเตือนจากระบบ BSRC SSK+COC", rscivms_bot) -> Google Sheet -> JSON API.
 *
 * รับข้อมูล:  wialon_forwarder.py ส่ง POST JSON มาที่ Web app URL -> เพิ่มแถวในชีต
 *             ไม่ซ้ำตาม ชื่อรถ + เวลา + สถานะ
 *             ระบบต้นทางส่งแจ้งเตือนเดียวกัน 2 ครั้ง (บางครั้ง)
 *             -> ครั้งที่สองจะเติมช่องที่ยังว่างในแถวเดิม (เช่น ลิงก์วิดีโอ) แทนการเพิ่มแถวใหม่
 * ส่งข้อมูล:  หน้าเว็บ POST { source: 'notif-read', idToken, limit } (ต้องล็อกอิน, ดูไฟล์ notifPost)
 *             GET Web app URL -> เปิดได้เฉพาะตอน NOTIF_OPEN = true (รอบ 1) เท่านั้น
 *
 * วิธีติดตั้ง
 *  1. สร้าง Google Sheet ใหม่ -> เมนู Extensions (ส่วนขยาย) -> Apps Script
 *  2. ลบโค้ดเดิมใน Code.gs แล้ววางไฟล์นี้ทั้งหมด -> กด Save
 *     และต้องมีไฟล์ notifPost (apps-script/telegram-notif-post.gs) ในโปรเจกต์เดียวกัน
 *  3. Project Settings (ไอคอนเฟือง) -> Script Properties -> Add script property
 *       Property: TOKEN    Value: รหัสลับที่ตั้งเอง
 *  4. กด Deploy -> New deployment -> Web app / Execute as: Me / Who has access: Anyone
 *  5. คัดลอก Web app URL (ลงท้ายด้วย /exec) แล้วรัน: python wialon_forwarder.py --setup-api bsrc
 *
 * ถ้าแก้โค้ดนี้ภายหลัง ต้อง Deploy -> Manage deployments -> แก้ไข (ไอคอนดินสอ) -> Version: New version
 * ห้ามสร้างลิงก์ใหม่ เพราะ wialon_forwarder.py ส่งข้อมูลเข้าลิงก์เดิม
 * ห้ามใส่ค่า TOKEN จริงลงในไฟล์นี้
 */

const SHEET_NAME = 'BSRC Alerts'
const SKIP_COLUMNS = ['raw_text'] // columns the dashboard does not need

// หัวคอลัมน์ในชีต -> ฟิลด์ใน JSON ที่ wialon_forwarder.py ส่งมา
// คอลัมน์ B, C, D ใช้กันข้อมูลซ้ำ (ห้ามสลับลำดับ)
const COLUMNS = [
  ['message_id',  (p) => p.source_message_id],
  ['เวลา',         (p) => p.event_time],
  ['ชื่อรถ',        (p) => p.vehicle],
  ['สถานะ',        (p) => p.status],
  ['ประเภท',       (p) => p.category],   // สถานะที่จัดกลุ่มแล้ว
  ['ชื่อกลุ่มรถ',    (p) => p.fleet_group],
  ['พขร',          (p) => p.driver],
  ['เบอร์ซิม',      (p) => p.sim],
  ['สถานที่',       (p) => p.location],
  ['lat',         (p) => p.lat],
  ['lon',         (p) => p.lon],
  ['แผนที่',        (p) => p.map_url],
  ['วิดีโอ mp4',    (p) => p.video_mp4],  // ไฟล์ .mp4 (เปิดเล่นได้ตรง)
  ['วิดีโอ อื่น',    (p) => p.video_page], // ลิงก์วิดีโอที่ไม่ใช่ .mp4 (เช่น minieye / gps.dtc)
  ['received_at', (p) => p.received_at],
  ['raw_text',    (p) => p.raw_text],
]
// เมื่อเจอแจ้งเตือนซ้ำ ให้เติมคอลัมน์เหล่านี้ในแถวเดิมถ้ายังว่าง
const FILL_ON_DUPLICATE = ['วิดีโอ mp4', 'วิดีโอ อื่น', 'เบอร์ซิม', 'พขร']

/* ---------- POST: รับข้อมูลจาก wialon_forwarder.py ---------- */

function doPost(e) {
  // หน้าเว็บอ่านข้อมูล (ต้องล็อกอิน) / บันทึกสถานะการจัดการ — ดูไฟล์ notifPost
  const read = handleNotifRead(e)
  if (read) return read
  const notif = handleNotifPost(e)
  if (notif) return notif

  try {
    const p = JSON.parse((e && e.postData && e.postData.contents) || '{}')
    const token = PropertiesService.getScriptProperties().getProperty('TOKEN')
    if (!token || p.token !== token) return json({ error: 'unauthorized' })
    if (!p.vehicle || !p.event_time) return json({ error: 'missing vehicle / event_time' })

    const lock = LockService.getScriptLock()
    lock.waitLock(20000)
    try {
      const sheet = getSheet()
      const row = findDuplicate(sheet, String(p.event_time), String(p.vehicle), String(p.status || ''))
      if (row) return json({ ok: true, duplicate: true, updated: fillEmpty(sheet, row, p) })
      // ใส่ ' นำหน้าเพื่อให้ชีตเก็บเป็นข้อความตามที่ส่งมา (ไม่แปลงวันที่/ตัวเลข/เบอร์โทรเอง)
      sheet.appendRow(COLUMNS.map(([, f]) => cellValue(f(p))))
    } finally {
      lock.releaseLock()
    }
    return json({ ok: true })
  } catch (err) {
    return json({ error: String(err && err.message || err) })
  }
}

function cellValue(v) {
  return v === undefined || v === null ? '' : typeof v === 'number' ? v : "'" + v
}

// B = เวลา, C = ชื่อรถ, D = สถานะ -> คืนเลขแถว หรือ 0
function findDuplicate(sheet, time, vehicle, status) {
  const hits = sheet.getRange('B:B').createTextFinder(time).matchEntireCell(true).findAll()
  for (const cell of hits) {
    const r = cell.getRow()
    const v = sheet.getRange(r, 3, 1, 2).getDisplayValues()[0]
    if (String(v[0]).trim() === vehicle && String(v[1]).trim() === status) return r
  }
  return 0
}

function fillEmpty(sheet, row, p) {
  let updated = false
  COLUMNS.forEach(([h, f], i) => {
    if (FILL_ON_DUPLICATE.indexOf(h) < 0) return
    const v = f(p)
    if (v === undefined || v === null || v === '') return
    const cell = sheet.getRange(row, i + 1)
    if (cell.getDisplayValue() === '') { cell.setValue(cellValue(v)); updated = true }
  })
  return updated
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet()
  let sheet = ss.getSheetByName(SHEET_NAME)
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME)
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS.map(([h]) => h))
    sheet.setFrozenRows(1)
  }
  return sheet
}

/* ---------- GET: ส่งข้อมูลให้หน้าเว็บ (เปิดเฉพาะรอบ 1) ---------- */

function doGet(e) {
  if (!NOTIF_OPEN) return json({ error: 'unauthorized' }) // รอบ 2: ต้องอ่านผ่าน POST + token เท่านั้น
  try {
    const limit = parseInt((e && e.parameter && e.parameter.limit) || '0', 10)
    return json(readSheet(limit))
  } catch (err) {
    return json({ error: String(err && err.message || err) })
  }
}

// ทดสอบในหน้า Apps Script: เลือก testData แล้วกด "เรียกใช้" (อ่าน 5 แถวล่าสุด ไม่ต้องใช้ token)
function testData() {
  const out = readSheet(5)
  Logger.log('คอลัมน์: ' + out.headers.length + ' | แถว: ' + out.rows.length)
  Logger.log('หัวคอลัมน์: ' + out.headers.join(', '))
}

// { headers: [...], values: [[ค่าไม่ซ้ำของคอลัมน์ 0], ...], rows: [[index, ...], ...] }
// ค่าจริงของแถว r คอลัมน์ c = values[c][rows[r][c]]  (เรียงจากเก่าไปใหม่)
function readSheet(limit) {
  const sheet = getSheet()
  const lastRow = sheet.getLastRow()
  const lastCol = sheet.getLastColumn()
  const allHeaders = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map((h) => String(h).trim())
  // อ่านเฉพาะแถวที่ต้องใช้ (ชีตนี้โตเร็ว ~130 แถว/วัน)
  const first = limit > 0 ? Math.max(2, lastRow - limit + 1) : 2
  const values = lastRow >= first ? sheet.getRange(first, 1, lastRow - first + 1, lastCol).getDisplayValues() : []
  const cols = []
  allHeaders.forEach((h, c) => { if (h && SKIP_COLUMNS.indexOf(h) < 0) cols.push(c) })

  const dicts = cols.map(() => new Map())
  const uniques = cols.map(() => [])
  const rows = []
  for (let r = 0; r < values.length; r++) {
    const src = values[r]
    let empty = true
    const out = new Array(cols.length)
    for (let k = 0; k < cols.length; k++) {
      const v = String(src[cols[k]]).trim()
      if (v !== '') empty = false
      let i = dicts[k].get(v)
      if (i === undefined) { i = uniques[k].length; uniques[k].push(v); dicts[k].set(v, i) }
      out[k] = i
    }
    if (!empty) rows.push(out)
  }
  return { headers: cols.map((c) => allHeaders[c]), values: uniques, rows: rows }
}

function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON)
}
