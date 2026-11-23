/**
 * ฐานข้อมูลระยะทาง -> หน้าแปลงแผนงาน (Documents) ของ my-web-p3
 * วางในโปรเจกต์ Apps Script ของ Google Sheet ฐานข้อมูลระยะทาง (ส่วนขยาย -> Apps Script) แทนโค้ดเดิมทั้งหมด
 *
 * ส่งข้อมูลให้เฉพาะคนที่ล็อกอินเว็บ my-web-p3 แล้วเท่านั้น:
 *   หน้าเว็บส่ง POST { source: 'distance-read', idToken } -> สคริปต์ให้ Firebase ยืนยัน token ก่อน
 *   ไม่มี token / token หมดอายุ / บัญชีถูกปิด -> ตอบ unauthorized และไม่ส่งข้อมูล
 *   เปิดลิงก์ตรง ๆ ในเบราว์เซอร์ (GET) -> ตอบ unauthorized เสมอ
 *
 * ขั้นตอน:
 *  1. วางโค้ดนี้ -> บันทึก
 *  2. DIST_SHEET_NAME เว้นว่างไว้ = อ่านทุกแท็บที่มีหัวคอลัมน์ลูกค้า + ระยะทาง แล้วรวมกัน
 *  3. เลือกฟังก์ชัน authorize -> เรียกใช้ -> ตรวจสอบสิทธิ์ -> อนุญาต
 *  4. เลือกฟังก์ชัน testData -> เรียกใช้ -> ดูบันทึกการดำเนินการว่าเจอคอลัมน์ถูกต้อง
 *  5. ทำให้ใช้งานได้ -> การทำให้ใช้งานได้รายการใหม่ -> ประเภท: เว็บแอป
 *       เรียกใช้ในฐานะ: ฉัน · ผู้ที่มีสิทธิ์เข้าถึง: ทุกคน
 *     แล้วคัดลอกลิงก์ที่ลงท้ายด้วย /exec ส่งมา
 *  แก้โค้ดครั้งต่อไป: Deploy -> Manage deployments -> ดินสอ -> Version: New version (ลิงก์เดิมใช้ต่อได้)
 */

const DIST_SHEET_NAME = '' // เว้นว่าง = อ่านทุกแท็บ · ใส่ชื่อ (เช่น 'ระยะทาง') = อ่านแท็บเดียว
const DIST_READ_SOURCE = 'distance-read' // ต้องตรงกับที่หน้าเว็บส่งมา

// หัวคอลัมน์ที่รู้จัก (ตัวแรกที่ตรงจะถูกใช้)
const DIST_HEADERS = {
  depot: /คลัง|ต้นทาง|depot|origin|plant/i,
  customer: /ลูกค้า|ปลายทาง|customer|ship.?to|destination/i,
  distance: /ระยะ|กม|km|distance/i,
}

function doGet() {
  return distJson_({ status: 'error', error: 'unauthorized', message: 'ต้องเรียกผ่านหน้าเว็บที่ล็อกอินแล้ว' })
}

function doPost(e) {
  let body
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}') } catch (err) { body = null }
  if (!body || body.source !== DIST_READ_SOURCE) {
    return distJson_({ status: 'error', error: 'bad-request' })
  }
  if (!verifyFirebaseToken_(body.idToken)) {
    return distJson_({ status: 'error', error: 'unauthorized', reason: FAIL_REASON_, message: 'เซสชันหมดอายุหรือไม่มีสิทธิ์ กรุณาล็อกอินใหม่' })
  }
  try {
    return distJson_(readDistances_())
  } catch (err) {
    return distJson_({ status: 'error', error: String((err && err.message) || err) })
  }
}

// อ่านทุกแท็บที่มีหัวคอลัมน์ลูกค้า + ระยะทาง แล้วรวมกัน -> [{ sheet, depot, customer, distance }]
// แท็บที่ไม่มีหัวคอลัมน์แบบนี้ถูกข้าม · แท็บที่ไม่มีคอลัมน์คลัง ใช้ชื่อแท็บเป็นคลัง
// ข้ามแถวที่ไม่มีลูกค้าหรือระยะทางไม่ใช่ตัวเลข
function readDistances_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet()
  const sheets = DIST_SHEET_NAME ? [ss.getSheetByName(DIST_SHEET_NAME)] : ss.getSheets()
  if (!sheets[0]) throw new Error('ไม่พบแท็บ ' + DIST_SHEET_NAME)

  const rows = []
  const used = [] // แท็บที่อ่าน: { sheet, headers, count }
  const skipped = [] // แท็บที่ไม่มีหัวคอลัมน์ลูกค้า + ระยะทาง
  sheets.forEach((sheet) => {
    const name = sheet.getName()
    const values = sheet.getDataRange().getDisplayValues()
    let h = -1
    let cols = null
    for (let i = 0; i < Math.min(values.length, 10); i++) {
      const c = findCols_(values[i])
      if (c.customer >= 0 && c.distance >= 0) { h = i; cols = c; break }
    }
    if (h < 0) { skipped.push(name); return }

    let count = 0
    for (let r = h + 1; r < values.length; r++) {
      const row = values[r]
      const customer = String(row[cols.customer] || '').trim()
      const distance = parseFloat(String(row[cols.distance] || '').replace(/,/g, ''))
      if (!customer || !isFinite(distance)) continue
      rows.push({
        sheet: name,
        depot: cols.depot >= 0 ? String(row[cols.depot] || '').trim() || name : name,
        customer: customer,
        distance: distance,
      })
      count++
    }
    used.push({
      sheet: name,
      headers: {
        depot: cols.depot >= 0 ? values[h][cols.depot] : '(ชื่อแท็บ)',
        customer: values[h][cols.customer],
        distance: values[h][cols.distance],
      },
      count: count,
    })
  })
  if (!used.length) throw new Error('ไม่พบแท็บที่มีหัวคอลัมน์ลูกค้าและระยะทาง (ดู DIST_HEADERS)')
  return { ok: true, sheets: used, skipped: skipped, count: rows.length, rows: rows }
}

function findCols_(header) {
  const cols = { depot: -1, customer: -1, distance: -1 }
  header.forEach((cell, i) => {
    const s = String(cell || '').replace(/\s+/g, '')
    if (!s) return
    // ตรวจระยะทางก่อน เพราะหัวอย่าง "ระยะทางถึงลูกค้า" มีคำว่าลูกค้าด้วย
    if (cols.distance < 0 && DIST_HEADERS.distance.test(s)) cols.distance = i
    else if (cols.depot < 0 && DIST_HEADERS.depot.test(s)) cols.depot = i
    else if (cols.customer < 0 && DIST_HEADERS.customer.test(s)) cols.customer = i
  })
  return cols
}

function distJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)
}

// ทดสอบในหน้า Apps Script: เลือก testData แล้วกด "เรียกใช้"
function testData() {
  const out = readDistances_()
  Logger.log('รวมทั้งหมด: ' + out.count + ' แถว จาก ' + out.sheets.length + ' แท็บ')
  out.sheets.forEach((s) => Logger.log('แท็บ ' + s.sheet + ': ' + s.count + ' แถว · คอลัมน์ ' + JSON.stringify(s.headers)))
  if (out.skipped.length) Logger.log('ข้าม (ไม่มีหัวคอลัมน์ลูกค้า + ระยะทาง): ' + out.skipped.join(', '))
  Logger.log('ตัวอย่าง: ' + JSON.stringify(out.rows.slice(0, 5)))
}

// ครั้งแรกหลังวางโค้ด: เลือก authorize แล้วกด "เรียกใช้" -> ตรวจสอบสิทธิ์ -> อนุญาต
// (ให้สคริปต์ติดต่อ Firebase ได้ — ถ้าไม่ทำ เว็บจะโหลดข้อมูลไม่ได้แม้ล็อกอินแล้ว)
function authorize() {
  UrlFetchApp.fetch('https://www.google.com')
  SpreadsheetApp.getActiveSpreadsheet().getName()
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
