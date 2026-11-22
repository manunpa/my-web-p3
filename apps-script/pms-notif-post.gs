/**
 * Notifications page <-> Google Sheet (ไฟล์ notifPost ในโปรเจกต์ Apps Script ของแต่ละฟีดแจ้งเตือน)
 *
 *  1. handleNotifRead  : หน้าเว็บอ่านข้อมูลแจ้งเตือน (POST { source: 'notif-read', idToken, limit })
 *                        ต้องล็อกอินเว็บ my-web-p3 (ตรวจ Firebase ID token)
 *  2. handleNotifPost  : หน้าเว็บบันทึกสถานะการจัดการ (POST { source: 'notif-page', idToken, items })
 *                        ตอน NOTIF_OPEN = false ต้องมี token ที่ใช้ได้
 *  ข้อความจาก Telegram / wialon_forwarder.py ไม่มี source เหล่านี้ จึงทำงานตามโค้ดเดิมใน doPost ทุกอย่าง
 *
 * ในไฟล์หลัก (Code.gs) ต้องมี
 *   - บรรทัดแรกสุดใน doPost:
 *       const read = handleNotifRead(e)
 *       if (read) return read
 *       const notif = handleNotifPost(e)
 *       if (notif) return notif
 *   - บรรทัดแรกสุดใน doGet:
 *       if (!NOTIF_OPEN) return json({ error: 'unauthorized' })
 *   - function readSheet(limit) ที่คืน { headers, values, rows }
 *
 * ทำ 2 รอบ (ไม่มีช่วงที่เว็บใช้ไม่ได้)
 *   รอบ 1: NOTIF_OPEN = true  -> เปิดทั้งทางเดิม (GET) และทางใหม่ (ต้องล็อกอิน) แล้วเปลี่ยนเว็บไปใช้ทางใหม่
 *   รอบ 2: NOTIF_OPEN = false -> ปิดทางเดิม
 * แต่ละรอบ: Deploy -> Manage deployments -> ดินสอ -> Version: New version (ห้ามสร้างลิงก์ใหม่
 *   เพราะโปรแกรมส่งแจ้งเตือนส่งเข้าลิงก์เดิม)
 * หลังวางโค้ดครั้งแรก: เลือก authorize -> เรียกใช้ -> ตรวจสอบสิทธิ์ -> อนุญาต
 */

const NOTIF_SHEET_NAME = 'VSS Alerts' // PMS: same tab as SHEET_NAME in Code.gs
const NOTIF_ID_HEADER = 'message_id'
const NOTIF_SOURCE = 'notif-page' // must match the website's request
const NOTIF_READ_SOURCE = 'notif-read' // website reading the alerts

// รอบ 1 = true (ทางเดิมยังเปิด), รอบ 2 = false (ต้องล็อกอินเท่านั้น)
const NOTIF_OPEN = true
// The 4 columns written: status, note, who, when. Missing ones are added at the end of the header row.
// เครื่อง 2 (PMS: แท็บ SCC Evidence, NGV: CCTV NGV Monitoring, OB: SCA OB, TTT: SCA TOYOTA, BSRC: BSRC COC) ใช้ค่านี้เหมือนกัน
// ห้ามเปลี่ยนเป็น ผลตรวจสอบ/ผู้ตรวจสอบ/เวลาตรวจสอบ เพราะจะเขียนทับผลที่คนกรอกไว้ ให้ตั้งแค่ NOTIF_SHEET_NAME
const NOTIF_COLUMNS = ['สถานะการจัดการ', 'หมายเหตุการจัดการ', 'ผู้ดำเนินการ', 'เวลาดำเนินการ']

function handleNotifPost(e) {
  let body
  try { body = JSON.parse((e && e.postData && e.postData.contents) || "{}") } catch (err) { return null }
  if (!body || body.source !== NOTIF_SOURCE) return null // not from the website: let doPost carry on (Telegram)
  if (!NOTIF_OPEN && !verifyFirebaseToken_(body.idToken)) {
    return notifJson({ status: 'error', error: 'unauthorized', reason: FAIL_REASON_, message: 'เซสชันหมดอายุหรือไม่มีสิทธิ์ กรุณาล็อกอินใหม่' })
  }
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

// หน้าเว็บอ่านข้อมูลแจ้งเตือน (ต้องล็อกอินเสมอ) ใช้ readSheet(limit) ของไฟล์หลัก
function handleNotifRead(e) {
  let body
  try { body = JSON.parse((e && e.postData && e.postData.contents) || "{}") } catch (err) { return null }
  if (!body || body.source !== NOTIF_READ_SOURCE) return null // not a read request: let doPost carry on
  if (!verifyFirebaseToken_(body.idToken)) {
    return notifJson({ status: 'error', error: 'unauthorized', reason: FAIL_REASON_, message: 'เซสชันหมดอายุหรือไม่มีสิทธิ์ กรุณาล็อกอินใหม่' })
  }
  try {
    return notifJson(readSheet(parseInt(body.limit || '0', 10) || 0))
  } catch (err) {
    return notifJson({ error: String((err && err.message) || err) })
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

// Firebase โปรเจกต์ที่ยอมรับ: projectId -> Web API key (ค่าจาก src/firebase.js ไม่ใช่ความลับ)
// แยกเป็น 2 ท่อนเพื่อไม่ให้ถูกซ่อนเป็น ••• ตอนคัดลอก
const FIREBASE_PROJECTS = {
  'my-web-p3': ['AIzaSyA5OM2o', 'm_4CnwTuFAixQGwxhtyUUmDjv7Y'].join('')
}

// ครั้งแรกหลังวางโค้ด: เลือก authorize แล้วกด "เรียกใช้" -> ตรวจสอบสิทธิ์ -> อนุญาต
// (ให้สคริปต์ติดต่อ Firebase ได้ — ถ้าไม่ทำ เว็บจะโหลดข้อมูลไม่ได้แม้ล็อกอินแล้ว)
function authorize() {
  UrlFetchApp.fetch('https://www.google.com')
}

/* ---------- ตรวจ Firebase ID token ---------- */

let FAIL_REASON_ = ''
function verifyFirebaseToken_(idToken) {
  FAIL_REASON_ = 'no-token'
  if (typeof idToken !== 'string' || idToken.length < 100 || idToken.length > 4096) return null
  FAIL_REASON_ = 'claims'
  const claims = decodeJwtPayload_(idToken)
  const now = Math.floor(Date.now() / 1000)
  const apiKey = claims && Object.prototype.hasOwnProperty.call(FIREBASE_PROJECTS, claims.aud)
    ? FIREBASE_PROJECTS[claims.aud] : null
  if (!apiKey || claims.iss !== 'https://securetoken.google.com/' + claims.aud || !(claims.exp > now)) return null

  // จำผลไว้ไม่เกิน 5 นาที จะได้ไม่ต้องถาม Firebase ทุกครั้ง
  const cache = CacheService.getScriptCache()
  const key = 'fbtok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken))
  const hit = cache.get(key)
  if (hit) return JSON.parse(hit)

  // ให้ Firebase ยืนยันลายเซ็นและสถานะบัญชีจริง
  const res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + apiKey, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ idToken: idToken }),
    muteHttpExceptions: true
  })
  if (res.getResponseCode() !== 200) {
    let msg = ''
    try { msg = JSON.parse(res.getContentText()).error.message } catch (err) {}
    FAIL_REASON_ = 'lookup:' + String(msg || res.getResponseCode()).slice(0, 80)
    return null
  }
  FAIL_REASON_ = 'account'
  const u = (JSON.parse(res.getContentText()).users || [])[0]
  if (!u || u.disabled || u.localId !== claims.sub) return null

  const user = { project: claims.aud, uid: u.localId, email: String(u.email || '').toLowerCase() }
  const ttl = Math.min(300, claims.exp - now)
  if (ttl > 0) cache.put(key, JSON.stringify(user), ttl)
  return user
}

function decodeJwtPayload_(jwt) {
  try {
    const part = jwt.split('.')[1]
    const pad = part + '==='.slice((part.length + 3) % 4)
    return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(pad)).getDataAsString())
  } catch (err) {
    return null
  }
}
