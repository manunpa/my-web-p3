/**
 * คลังแผนงานจัดส่ง <- ปุ่ม "ส่งออก Excel" ในหน้าแปลงแผนงาน (Documents) ของ my-web-p3
 * กดส่งออก 1 ครั้ง = ดาวน์โหลดไฟล์ Excel + ส่งแผนงานชุดเดียวกันมาต่อท้ายในชีทนี้ 1 ชุด
 * วางในโปรเจกต์ Apps Script ของ Google Sheet ที่สร้างไว้เก็บแผนงาน (ส่วนขยาย -> Apps Script) แทนโค้ดเดิมทั้งหมด
 *
 * รับข้อมูลเฉพาะคนที่ล็อกอินเว็บ my-web-p3 แล้วเท่านั้น (ตรวจ Firebase token ก่อนเขียน)
 *   เปิดลิงก์ตรง ๆ ในเบราว์เซอร์ (GET) -> ตอบ unauthorized เสมอ
 *
 * ขั้นตอน:
 *  1. วางโค้ดนี้ -> บันทึก
 *  2. เลือกฟังก์ชัน authorize -> เรียกใช้ -> ตรวจสอบสิทธิ์ -> อนุญาต
 *  3. เลือกฟังก์ชัน testSetup -> เรียกใช้ -> จะสร้างแท็บ "แผนงาน" พร้อมหัวตาราง
 *  4. ทำให้ใช้งานได้ -> การทำให้ใช้งานได้รายการใหม่ -> ประเภท: เว็บแอป
 *       เรียกใช้ในฐานะ: ฉัน · ผู้ที่มีสิทธิ์เข้าถึง: ทุกคน
 *     แล้วคัดลอกลิงก์ที่ลงท้ายด้วย /exec ส่งมา
 *  แก้โค้ดครั้งต่อไป: Deploy -> Manage deployments -> ดินสอ -> Version: New version (ลิงก์เดิมใช้ต่อได้)
 */

const PLAN_SHEET_NAME = 'แผนงาน'     // แท็บที่เก็บแผนงาน (สร้างให้เองถ้ายังไม่มี)
const PLAN_SAVE_SOURCE = 'plan-save'  // ต้องตรงกับที่หน้าเว็บส่งมา

// 13 คอลัมน์เดียวกับไฟล์ Excel ที่ส่งออก + คอลัมน์บันทึกการส่ง
// 4 คอลัมน์ท้าย = ส่งครั้งที่เท่าไร (เลขรัน 1, 2, 3 …), ส่งเมื่อไร (เวลาไทย) และใครกดส่ง
const PLAN_HEAD = [
  'ลำดับ', 'วัน/เดือน/ปี', 'ผู้ขนส่ง', 'คลังต้นทาง(คลังที่โหลด)', 'ลูกค้าปลายทาง', 'วัน/เวลา ที่ต้องถึงลูกค้า',
  'ระยะทางขาไป (กม.)', 'วัน/เวลา ที่ต้องออกเดินทาง', 'เวลาที่ต้องมาเริ่มงาน', 'ทะเบียนหัว', 'พขร.1', 'TRIP', 'TRIP_DROP',
  'ไฟล์ต้นทาง', 'รหัสชุด',
  'ส่งครั้งที่ (ID)', 'วันที่ส่ง', 'เวลาที่ส่ง', 'ผู้ส่ง (user)',
]
const PLAN_COLS = 13        // คอลัมน์แผนงาน (ที่เหลือเป็นบันทึกการส่ง)
const BATCH_COL = 15        // คอลัมน์ "รหัสชุด" (ใช้กันบันทึกซ้ำ · ซ่อนไว้)
const SEND_COL = 16         // คอลัมน์ "ส่งครั้งที่ (ID)": ทุกแถวของการส่งครั้งเดียวกันได้เลขเดียวกัน
const TZ = 'Asia/Bangkok'
const MAX_ROWS = 2000       // กันข้อมูลผิดปกติ: แผนงานหนึ่งชุดไม่ควรเกินนี้
const NUMBER_COLS = [0, 6, 11, 12] // ลำดับ, ระยะทาง, TRIP, TRIP_DROP เก็บเป็นตัวเลข

function doGet() {
  return planJson_({ status: 'error', error: 'unauthorized', message: 'ต้องเรียกผ่านหน้าเว็บที่ล็อกอินแล้ว' })
}

function doPost(e) {
  let body
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}') } catch (err) { body = null }
  if (!body || body.source !== PLAN_SAVE_SOURCE) return planJson_({ status: 'error', error: 'bad-request' })
  const user = verifyFirebaseToken_(body.idToken)
  if (!user) {
    return planJson_({ status: 'error', error: 'unauthorized', reason: FAIL_REASON_, message: 'เซสชันหมดอายุหรือไม่มีสิทธิ์ กรุณาล็อกอินใหม่' })
  }
  try {
    return planJson_(savePlan_(body, user))
  } catch (err) {
    return planJson_({ status: 'error', error: String((err && err.message) || err) })
  }
}

// แผนงาน 1 ชุด -> ต่อท้ายแท็บ "แผนงาน" · ชุดเดิม (รหัสชุดเดียวกัน) ส่งซ้ำจะไม่ถูกเขียนซ้ำ
function savePlan_(body, user) {
  const rows = body.rows
  if (!Array.isArray(rows) || !rows.length) throw new Error('ไม่มีแถวแผนงาน')
  if (rows.length > MAX_ROWS) throw new Error('แผนงานเกิน ' + MAX_ROWS + ' แถว')
  const batch = String(body.batch || '').slice(0, 40)
  if (!/^[\w-]{6,40}$/.test(batch)) throw new Error('รหัสชุดไม่ถูกต้อง')
  const files = String(body.files || '').slice(0, 300)

  const lock = LockService.getScriptLock()
  lock.waitLock(20000) // คนกดพร้อมกันหลายคน: เขียนทีละชุด
  try {
    const sheet = planSheet_()
    const last = sheet.getLastRow()
    // รหัสชุด + เลขครั้งที่ส่งของแถวที่มีอยู่: ชุดเดิมไม่บันทึกซ้ำ · ครั้งใหม่ = เลขสูงสุด + 1
    let sendNo = 1
    if (last > 1) {
      const old = sheet.getRange(2, BATCH_COL, last - 1, 2).getValues()
      const same = old.find((r) => String(r[0]) === batch)
      if (same) return { ok: true, duplicate: true, saved: 0, batch: batch, sendNo: Number(same[1]) || null }
      sendNo = old.reduce((m, r) => Math.max(m, Number(r[1]) || 0), 0) + 1
    }
    // วันที่ปี พ.ศ. แบบเดียวกับแผนงาน (24/11/2569) · เวลา 24 ชม. · เวลาไทย
    const now = new Date()
    const sentDay = "'" + Utilities.formatDate(now, TZ, 'dd/MM/') + (Number(Utilities.formatDate(now, TZ, 'yyyy')) + 543)
    const sentTime = "'" + Utilities.formatDate(now, TZ, 'HH:mm:ss')
    const values = rows.map((r) => {
      const cells = []
      for (let i = 0; i < PLAN_COLS; i++) cells.push(cell_(Array.isArray(r) ? r[i] : '', i))
      return cells.concat(["'" + files, batch, sendNo, sentDay, sentTime, user.email])
    })
    sheet.getRange(last + 1, 1, values.length, PLAN_HEAD.length).setValues(values)
    return { ok: true, saved: values.length, batch: batch, sendNo: sendNo, sheet: PLAN_SHEET_NAME, sentAt: sentDay.slice(1) + ' ' + sentTime.slice(1), by: user.email }
  } finally {
    lock.releaseLock()
  }
}

// ตัวเลขเก็บเป็นตัวเลข · ข้อความใส่ ' นำหน้าให้ชีตเก็บตามที่ส่งมา (ไม่แปลงวันที่/เวลาเอง)
function cell_(v, i) {
  if (v === null || v === undefined || v === '') return ''
  if (NUMBER_COLS.indexOf(i) >= 0) {
    const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim()) // แก้มือในเว็บจะมาเป็นข้อความ
    if (isFinite(n) && String(v).trim() !== '') return n
  }
  return "'" + String(v).slice(0, 500) // ' นำหน้าเสมอ: กันสูตร (=, +, -, @) และการแปลงวันที่อัตโนมัติ
}

function planSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet()
  let sheet = ss.getSheetByName(PLAN_SHEET_NAME)
  if (!sheet) sheet = ss.insertSheet(PLAN_SHEET_NAME)
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, PLAN_HEAD.length).setValues([PLAN_HEAD]).setFontWeight('bold').setBackground('#fff2cc')
    sheet.getRange(1, SEND_COL, 1, PLAN_HEAD.length - SEND_COL + 1).setBackground('#d9ead3') // คอลัมน์ท้าย: ครั้งที่ ใคร เมื่อไร
    sheet.setFrozenRows(1)
    sheet.hideColumns(BATCH_COL)
  }
  return sheet
}

function planJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)
}

// ทดสอบในหน้า Apps Script: สร้างแท็บ + หัวตาราง (ไม่เขียนข้อมูล)
function testSetup() {
  const sheet = planSheet_()
  Logger.log('แท็บ "' + sheet.getName() + '" พร้อมแล้ว · มีข้อมูล ' + Math.max(0, sheet.getLastRow() - 1) + ' แถว')
}

// ครั้งแรกหลังวางโค้ด: เลือก authorize แล้วกด "เรียกใช้" -> ตรวจสอบสิทธิ์ -> อนุญาต
// (ให้สคริปต์ติดต่อ Firebase และเขียนชีตได้ — ถ้าไม่ทำ เว็บจะบันทึกไม่ได้แม้ล็อกอินแล้ว)
function authorize() {
  UrlFetchApp.fetch('https://www.google.com')
  SpreadsheetApp.getActiveSpreadsheet().getName()
  LockService.getScriptLock()
}

/* ---------- ตรวจ Firebase ID token ---------- */

// Firebase โปรเจกต์ที่ยอมรับ: projectId -> Web API key (ค่าจาก src/firebase.js ไม่ใช่ความลับ)
// แยกเป็น 2 ท่อนเพื่อไม่ให้ถูกซ่อนเป็น ••• ตอนคัดลอก
const FIREBASE_PROJECTS = {
  'my-web-p3': ['AIzaSyA5OM2o', 'm_4CnwTuFAixQGwxhtyUUmDjv7Y'].join('')
}

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
