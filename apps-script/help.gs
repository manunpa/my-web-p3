/**
 * Help (ผู้ให้บริการ GPS: Songdee, DTC, PMS, ...) -> JSON API for #/dashboard/help
 * ส่งข้อมูลให้เฉพาะคนที่ล็อกอินเว็บ my-web-p3 แล้วเท่านั้น (เว็บส่ง Firebase ID token มาแบบ POST)
 * เปิดลิงก์ตรงๆ (GET) จะได้ {"error":"unauthorized"}
 *
 * หลังวางโค้ดครั้งแรก: เลือกฟังก์ชัน authorize → เรียกใช้ → ตรวจสอบสิทธิ์ → อนุญาต
 * แล้วเลือก testData → เรียกใช้ ต้องเห็นจำนวนแถวของแต่ละแท็บในบันทึกการดำเนินการ
 *
 * ผลลัพธ์: { "<ชื่อแท็บ>": [ { หัวคอลัมน์: ค่าตามที่เห็นในชีต, ... }, ... ], ... }
 * อ่านทุกแท็บ แถวแรกเป็นหัวคอลัมน์ ข้ามแถวว่าง (การอ่านข้อมูลเหมือนโค้ดเดิมทุกอย่าง)
 */

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
  return json(readAllSheets_())
}

// เปิดลิงก์ตรงๆ ในเบราว์เซอร์ -> ไม่ให้ข้อมูล
function doGet() {
  return json({ status: 'error', error: 'unauthorized', message: 'ต้องเข้าสู่ระบบผ่านเว็บก่อน' })
}

// ทดสอบในหน้า Apps Script: เลือก testData แล้วกด "เรียกใช้" (อ่านชีตตรงๆ ไม่ต้องใช้ token)
function testData() {
  const out = readAllSheets_()
  Object.keys(out).forEach((name) => Logger.log(name + ': ' + out[name].length + ' แถว'))
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

// อ่านทุกแท็บ (เหมือน doGet เดิมทุกอย่าง)
function readAllSheets_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var result = {};

  // วนอ่านทุกชีท (Songdee, DTC)
  ss.getSheets().forEach(function (sheet) {
    var rows = sheet.getDataRange().getDisplayValues();
    if (rows.length < 2) { result[sheet.getName()] = []; return; }

    var headers = rows[0]; // แถวแรกเป็นหัวข้อ (Key)
    var data = [];

    for (var i = 1; i < rows.length; i++) {
      // ข้ามแถวที่ว่างทั้งแถว
      if (rows[i].join('').trim() === '') continue;
      var obj = {};
      for (var j = 0; j < headers.length; j++) {
        obj[headers[j]] = rows[i][j];
      }
      data.push(obj);
    }
    result[sheet.getName()] = data;
  });

  return result;
}

function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON)
}
