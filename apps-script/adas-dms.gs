/**
 * ADAS / DMS (Songdee) alerts -> JSON API for the dashboard.
 * ส่งข้อมูลให้เฉพาะคนที่ล็อกอินเว็บ my-web-p3 แล้วเท่านั้น (เว็บส่ง Firebase ID token มาแบบ POST)
 * เปิดลิงก์ตรงๆ (GET) จะได้ {"error":"unauthorized"}
 *
 * หลังวางโค้ดครั้งแรก: เลือกฟังก์ชัน authorize → เรียกใช้ → ตรวจสอบสิทธิ์ → อนุญาต
 * แล้วเลือก testData → เรียกใช้ ต้องเห็นจำนวนแถวในบันทึกการดำเนินการ
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

// Firebase โปรเจกต์ที่ยอมรับ: projectId -> Web API key (ค่าจาก src/firebase.js ไม่ใช่ความลับ)
// แยกเป็น 2 ท่อนเพื่อไม่ให้ถูกซ่อนเป็น ••• ตอนคัดลอก
const FIREBASE_PROJECTS = {
  'my-web-p3': ['AIzaSyA5OM2o', 'm_4CnwTuFAixQGwxhtyUUmDjv7Y'].join('')
}

// เว็บเรียกผ่าน POST พร้อม token เท่านั้น
function doPost(e) {
  let body = {}
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}') } catch (err) {}
  if (!verifyFirebaseToken_(body.idToken)) {
    // reason บอกว่าติดตรงไหน (ไม่มีข้อมูลลับ) เช่น lookup:API key not valid = คีย์ในสคริปต์ผิด
    return json({ status: 'error', error: 'unauthorized', reason: FAIL_REASON_, message: 'เซสชันหมดอายุหรือไม่มีสิทธิ์ กรุณาล็อกอินใหม่' })
  }
  try {
    return json(readSheet(body.sheet || SHEET_NAME))
  } catch (err) {
    return json({ error: String(err && err.message || err) })
  }
}

// เปิดลิงก์ตรงๆ ในเบราว์เซอร์ -> ไม่ให้ข้อมูล
function doGet() {
  return json({ status: 'error', error: 'unauthorized', message: 'ต้องเข้าสู่ระบบผ่านเว็บก่อน' })
}

// ทดสอบในหน้า Apps Script: เลือก testData แล้วกด "เรียกใช้" (อ่านชีตตรงๆ ไม่ต้องใช้ token)
function testData() {
  const out = readSheet(SHEET_NAME)
  Logger.log('คอลัมน์: ' + out.headers.length + ' | แถว: ' + out.rows.length)
  Logger.log('หัวคอลัมน์: ' + out.headers.join(', '))
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
