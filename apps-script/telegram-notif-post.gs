/**
 * Notifications page -> Google Sheet: saves how each Telegram alert was handled.
 *
 * วิธีติดตั้ง (เพิ่มในโปรเจกต์ Apps Script เดิมของลิงก์แจ้งเตือน Telegram)
 *  1. เปิด Apps Script ของชีตข้อความ Telegram
 *  2. กด + ข้าง Files -> Script -> ตั้งชื่อ เช่น notifPost แล้ววางไฟล์นี้ทั้งหมด -> Save
 *  3. สคริปต์เดิมมี function doPost (รับข้อความจาก Telegram) อยู่แล้ว ห้ามสร้าง doPost ใหม่
 *     ให้เพิ่ม 2 บรรทัดนี้เป็นบรรทัดแรกสุดภายใน doPost เดิม (ก่อนการเช็กสิทธิ์ใดๆ):
 *
 *       const notif = handleNotifPost(e)
 *       if (notif) return notif
 *
 *     ข้อความจาก Telegram จะไม่มี source: 'notif-page' จึงทำงานตามโค้ดเดิมทุกอย่าง
 *  4. Deploy -> Manage deployments -> แก้ไข (ไอคอนดินสอ) -> Version: New version -> Deploy
 *     ลิงก์ /exec เดิมจะใช้โค้ดใหม่ ไม่ต้องแก้ลิงก์ในเว็บ
 *
 * สิ่งที่ทำ
 *  - หาแท็บแรกที่แถวหัวคอลัมน์มี "message_id" (หรือกำหนด NOTIF_SHEET_NAME เอง)
 *  - ใช้ไฟล์เดียวกันนี้ได้ทุกสคริปต์ (PMS/NGV/OB เครื่อง 1 และ 2, TTT, BSRC) เครื่อง 2 ให้ตั้ง NOTIF_SHEET_NAME เป็นชื่อแท็บ
 *  - เพิ่มคอลัมน์ท้ายตารางให้อัตโนมัติถ้ายังไม่มี: สถานะการจัดการ, หมายเหตุการจัดการ, ผู้ดำเนินการ, เวลาดำเนินการ
 *  - หาแถวที่ message_id ตรงกัน แล้วเขียนทับ 4 ช่องนั้น
 *
 * ข้อมูลที่เว็บส่งมา (POST, body เป็น JSON):
 *   { "source": "notif-page", "items": [ { "id": "52106", "status": "รับทราบ", "note": "...", "by": "ชื่อผู้ใช้" }, ... ] }
 * ตอบกลับ: { "ok": true, "updated": 1, "notFound": [] }  หรือ  { "error": "..." }
 */

const NOTIF_SHEET_NAME = '' // tab name, e.g. 'VSS Alerts'; '' or a missing tab = use the first tab with a message_id column
const NOTIF_ID_HEADER = 'message_id'
const NOTIF_SOURCE = 'notif-page' // must match the website's request
// The 4 columns written: status, note, who, when. Missing ones are added at the end of the header row.
// เครื่อง 2 (PMS: แท็บ SCC Evidence, NGV: CCTV NGV Monitoring, OB: SCA OB, TTT: SCA TOYOTA) ใช้ค่านี้เหมือนกัน
// ห้ามเปลี่ยนเป็น ผลตรวจสอบ/ผู้ตรวจสอบ/เวลาตรวจสอบ เพราะจะเขียนทับผลที่คนกรอกไว้ ให้ตั้งแค่ NOTIF_SHEET_NAME
const NOTIF_COLUMNS = ['สถานะการจัดการ', 'หมายเหตุการจัดการ', 'ผู้ดำเนินการ', 'เวลาดำเนินการ']

function handleNotifPost(e) {
  let body
  try { body = JSON.parse((e && e.postData && e.postData.contents) || "{}") } catch (err) { return null }
  if (!body || body.source !== NOTIF_SOURCE) return null // not from the website: let doPost carry on (Telegram)
  const lock = LockService.getScriptLock()
  try {
    lock.waitLock(20000)
    const items = Array.isArray(body.items) ? body.items : [body]
    return notifJson(saveNotifActions(items))
  } catch (err) {
    return notifJson({ error: String((err && err.message) || err) })
  } finally {
    lock.releaseLock()
  }
}

function saveNotifActions(items) {
  const ss = SpreadsheetApp.getActiveSpreadsheet()
  const sheet = findNotifSheet(ss)
  const tz = ss.getSpreadsheetTimeZone()
  const lastCol = sheet.getLastColumn()
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map((h) => String(h).trim())

  const idCol = headers.indexOf(NOTIF_ID_HEADER) + 1
  if (!idCol) throw new Error('ไม่พบคอลัมน์ ' + NOTIF_ID_HEADER)

  // Add the 4 result columns at the end of the header row if they are missing.
  const cols = NOTIF_COLUMNS.map((name) => {
    let c = headers.indexOf(name) + 1
    if (!c) {
      headers.push(name)
      c = headers.length
      sheet.getRange(1, c).setValue(name).setFontWeight('bold')
    }
    return c
  })

  // message_id -> row number, read once.
  const lastRow = sheet.getLastRow()
  const ids = lastRow > 1 ? sheet.getRange(2, idCol, lastRow - 1, 1).getDisplayValues() : []
  const rowOf = {}
  ids.forEach((r, i) => { rowOf[String(r[0]).trim()] = i + 2 })

  const now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss')
  const notFound = []
  let updated = 0
  items.forEach((it) => {
    const id = String((it && it.id) || '').trim()
    const row = rowOf[id]
    if (!row) { notFound.push(id); return }
    const values = [
      String(it.status || '').slice(0, 50),
      String(it.note || '').slice(0, 500),
      String(it.by || '').slice(0, 100),
      now,
    ]
    // The 4 columns are usually next to each other, but write each one in case they are not.
    cols.forEach((c, k) => sheet.getRange(row, c).setValue(values[k]))
    updated++
  })
  return { ok: true, updated: updated, notFound: notFound }
}

function findNotifSheet(ss) {
  if (NOTIF_SHEET_NAME) {
    const s = ss.getSheetByName(NOTIF_SHEET_NAME)
    if (s) return s
  }
  const found = ss.getSheets().find((s) => {
    const n = s.getLastColumn()
    if (!n) return false
    return s.getRange(1, 1, 1, n).getValues()[0].some((h) => String(h).trim() === NOTIF_ID_HEADER)
  })
  if (!found) throw new Error('ไม่พบแท็บที่มีคอลัมน์ ' + NOTIF_ID_HEADER)
  return found
}

function notifJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)
}
