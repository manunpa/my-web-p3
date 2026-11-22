/**
 * VSS alerts (Telegram "SCC Evidence") -> Google Sheet -> JSON API for the dashboard (หน้าแจ้งเตือน PMS).
 *
 * รับข้อมูล:  wialon_forwarder.py ส่ง POST JSON มาที่ Web app URL -> เพิ่มแถวในชีต (ไม่ซ้ำตาม message_id)
 * ส่งข้อมูล:  หน้าเว็บ POST { source: 'notif-read', idToken, limit } (ต้องล็อกอิน, ดูไฟล์ notifPost)
 *             GET Web app URL -> เปิดได้เฉพาะตอน NOTIF_OPEN = true (รอบ 1) เท่านั้น
 *
 * วิธีติดตั้ง
 *  1. สร้าง Google Sheet ใหม่ (เช่น "VSS Alerts") -> เมนู Extensions (ส่วนขยาย) -> Apps Script
 *  2. ลบโค้ดเดิมใน Code.gs แล้ววางไฟล์นี้ทั้งหมด -> กด Save
 *     และต้องมีไฟล์ notifPost (apps-script/telegram-notif-post.gs) ในโปรเจกต์เดียวกัน
 *  3. Project Settings (ไอคอนเฟือง) -> Script Properties -> Add script property
 *       Property: TOKEN    Value: รหัสลับที่ตั้งเอง (ต้องตรงกับ API_TOKEN ใน wialon_forwarder.py)
 *  4. กด Deploy -> New deployment -> Web app / Execute as: Me / Who has access: Anyone
 *  5. คัดลอก Web app URL (ลงท้ายด้วย /exec) ไปใส่ใน MY_API ใน wialon_forwarder.py
 *
 * ถ้าแก้โค้ดนี้ภายหลัง ต้อง Deploy -> Manage deployments -> แก้ไข (ไอคอนดินสอ) -> Version: New version
 * ห้ามสร้างลิงก์ใหม่ เพราะ wialon_forwarder.py ส่งข้อมูลเข้าลิงก์เดิม
 * ห้ามใส่ค่า TOKEN จริงลงในไฟล์นี้ (repo เป็น Public)
 */

const SHEET_NAME = 'VSS Alerts'
const SKIP_COLUMNS = ['raw_text'] // columns the dashboard does not need

// หัวคอลัมน์ในชีต -> ฟิลด์ใน JSON ที่ wialon_forwarder.py ส่งมา
const COLUMNS = [
  ['message_id',         (p) => p.source_message_id],
  ['เวลาปลุก',            (p) => p.alarm_time],
  ['ชื่ออุปกรณ์',          (p) => p.device_name],
  ['หมายเลขอุปกรณ์',      (p) => p.device_id],
  ['ประเภทสัญญาณเตือน',   (p) => p.alarm_type],
  ['Type',               (p) => (p.detail_parsed || {}).Type],
  ['satellites',         (p) => (p.detail_parsed || {}).satellites],
  ['lat',                (p) => p.lat],
  ['lon',                (p) => p.lon],
  ['ลิงก์',               (p) => p.link_url],
  ['เวลาส่ง',             (p) => p.sent_time],
  ['received_at',        (p) => p.received_at],
  ['raw_text',           (p) => p.raw_text],
]

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
    if (!p.source_message_id) return json({ error: 'missing source_message_id' })

    const lock = LockService.getScriptLock()
    lock.waitLock(20000)
    try {
      const sheet = getSheet()
      const found = sheet.getRange('A:A').createTextFinder(String(p.source_message_id))
        .matchEntireCell(true).findNext()
      if (found) return json({ ok: true, duplicate: true })
      // ใส่ ' นำหน้าเพื่อให้ชีตเก็บเป็นข้อความตามที่ส่งมา (ไม่แปลงวันที่/ตัวเลขเอง)
      sheet.appendRow(COLUMNS.map(([, f]) => {
        const v = f(p)
        return v === undefined || v === null ? '' : typeof v === 'number' ? v : "'" + v
      }))
    } finally {
      lock.releaseLock()
    }
    return json({ ok: true })
  } catch (err) {
    return json({ error: String(err && err.message || err) })
  }
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
  const values = sheet.getDataRange().getDisplayValues()
  const allHeaders = (values[0] || []).map((h) => String(h).trim())
  const cols = []
  allHeaders.forEach((h, c) => { if (h && SKIP_COLUMNS.indexOf(h) < 0) cols.push(c) })

  const first = limit > 0 ? Math.max(1, values.length - limit) : 1
  const dicts = cols.map(() => new Map())
  const uniques = cols.map(() => [])
  const rows = []
  for (let r = first; r < values.length; r++) {
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
