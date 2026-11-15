/* ------------------------------------------------------------------ */
/* Notifications: alerts forwarded from Telegram (Apps Script API)     */
/* plus how the team has handled each one (Firestore notifActions).    */
/* ------------------------------------------------------------------ */
import {
  collection, doc, onSnapshot, query, serverTimestamp, setDoc, Timestamp, where, writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'
import { decode } from './adasData'
import { norm } from './fleetData'

// Web app URL that returns the Telegram messages (ends with /exec). `limit` = newest N messages.
export const NOTIF_API_URL =
  'https://script.google.com/macros/s/AKfycbyrSPxsAz9pY1Rswe1tIsvyg3sAq3Yh3wbWg2RmZCe6xMeTh4YiakBFWSBDWpgOYAuvIg/exec'
export const NOTIF_LIMIT = 500
export const NOTIF_REFRESH_MS = 60 * 1000

// How each alert has been handled. 'new' = nobody has touched it yet.
export const STATUSES = {
  new: { label: 'ใหม่', color: '#fab219' },
  ack: { label: 'รับทราบ', color: '#3987e5' },
  done: { label: 'ดำเนินการแล้ว', color: '#0ca30c' },
  false: { label: 'แจ้งเตือนผิดพลาด', color: '#898781' },
}

// Column names from the API -> field names (matching ignores spaces, '/', '.', '-', '_' and case).
const FIELDS = {
  id: ['message_id'],
  alarm: ['เวลาปลุก'],
  device: ['ชื่ออุปกรณ์'],
  deviceNo: ['หมายเลขอุปกรณ์'],
  typeTh: ['ประเภทสัญญาณเตือน'],
  typeEn: ['Type'],
  satellites: ['satellites'],
  lat: ['lat'],
  lon: ['lon'],
  link: ['ลิงก์', 'link'],
  sent: ['เวลาส่ง'],
  received: ['received_at'],
}

// "2026-11-15 14:50:31" is Thailand time (UTC+7) whatever the viewer's time zone.
function thaiTime(s) {
  const m = String(s ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) {
    const t = Date.parse(s)
    return isNaN(t) ? null : new Date(t)
  }
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 7, +m[5], +(m[6] || 0)))
}

const num = (s) => {
  const n = parseFloat(String(s ?? '').trim())
  return isNaN(n) ? null : n
}

export function toNotifs(rows) {
  if (!rows.length) return []
  const headers = Object.keys(rows[0])
  const key = {}
  for (const [f, names] of Object.entries(FIELDS)) {
    key[f] = headers.find((h) => names.some((n) => norm(h) === norm(n)))
  }
  const get = (row, f) => (key[f] ? String(row[key[f]] ?? '').trim() : '')
  const out = []
  for (const row of rows) {
    const id = get(row, 'id')
    const at = thaiTime(get(row, 'alarm')) ?? thaiTime(get(row, 'sent')) ?? thaiTime(get(row, 'received'))
    if (!/^[\w-]{1,100}$/.test(id) || !at) continue
    const lat = num(get(row, 'lat')), lon = num(get(row, 'lon'))
    const link = get(row, 'link')
    out.push({
      id,
      at,
      sentAt: thaiTime(get(row, 'sent')),
      receivedAt: thaiTime(get(row, 'received')),
      device: get(row, 'device') || '(ไม่ระบุ)',
      deviceNo: get(row, 'deviceNo'),
      type: get(row, 'typeTh') || get(row, 'typeEn') || '(ไม่ระบุ)',
      typeEn: get(row, 'typeEn'),
      satellites: num(get(row, 'satellites')),
      lat, lon,
      hasPos: lat !== null && lon !== null && !(lat === 0 && lon === 0),
      link: /^https?:\/\//i.test(link) ? link : '',
      raw: row,
    })
  }
  // Newest first; Telegram can resend the same message, keep one per id.
  const seen = new Set()
  return out.sort((a, b) => b.at - a.at).filter((n) => !seen.has(n.id) && seen.add(n.id))
}

export async function loadNotifs() {
  const res = await fetch(`${NOTIF_API_URL}?limit=${NOTIF_LIMIT}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Could not load notifications (HTTP ${res.status}).`)
  const text = await res.text()
  if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('The link returned a web page, not data. Is the script deployed with access "Anyone"?')
  const json = JSON.parse(text)
  if (json?.error) throw new Error(json.error)
  return toNotifs(decode(json))
}

/* ---------- handling status, shared by everyone (Firestore) ---------- */

const COL = 'notifActions'

// Live map of message id -> { status, note, byName, at } for alerts at or after `since`.
export function watchActions(since, onData, onError) {
  const q = query(collection(db, COL), where('alarmAt', '>=', Timestamp.fromDate(since)))
  return onSnapshot(q, (snap) => {
    const m = new Map()
    snap.forEach((d) => {
      const x = d.data()
      m.set(d.id, { status: x.status, note: x.note || '', byName: x.byName || '', at: x.at?.toDate?.() ?? null })
    })
    onData(m)
  }, onError)
}

const entry = (n, user, status, note) => ({
  status,
  note,
  alarmAt: Timestamp.fromDate(n.at),
  by: user.uid,
  byName: (user.displayName || user.email || '').slice(0, 100),
  at: serverTimestamp(),
})

export function saveAction(n, user, status, note) {
  return setDoc(doc(db, COL, n.id), entry(n, user, status, note.slice(0, 500)))
}

// Several alerts at once (max 500 per Firestore batch).
export async function saveActions(list, user, status, notes) {
  for (let i = 0; i < list.length; i += 500) {
    const b = writeBatch(db)
    for (const n of list.slice(i, i + 500)) b.set(doc(db, COL, n.id), entry(n, user, status, notes(n)))
    await b.commit()
  }
}

/* ---------- copy to the Google Sheet row of each alert (doPost in apps-script/telegram-notif-post.gs) ---------- */

// text/plain avoids a CORS preflight, which Apps Script does not answer.
export async function sendToSheet(list, user, status, notes) {
  const by = user.displayName || user.email || ''
  const items = list.map((n) => ({ id: n.id, status: STATUSES[status]?.label ?? status, note: notes(n), by }))
  const res = await fetch(NOTIF_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ source: 'notif-page', items }), // source tells doPost this is not a Telegram update
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('สคริปต์ตอบกลับเป็นหน้าเว็บ ยังไม่ได้ Deploy เวอร์ชันใหม่?')
  const json = JSON.parse(text)
  if (json?.error === 'unauthorized') throw new Error('ยังไม่ได้เพิ่ม handleNotifPost ใน doPost เดิม หรือยังไม่ได้ Deploy เวอร์ชันใหม่')
  if (json?.error) throw new Error(json.error)
  if (json?.notFound?.length) throw new Error(`ไม่พบ message_id ${json.notFound.slice(0, 5).join(', ')} ในชีต`)
  return json
}
