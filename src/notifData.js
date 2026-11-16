/* ------------------------------------------------------------------ */
/* Notifications: alerts forwarded from Telegram (Apps Script APIs)    */
/* plus how the team has handled each one (Firestore notifActions).    */
/* ------------------------------------------------------------------ */
import {
  collection, doc, onSnapshot, query, serverTimestamp, setDoc, Timestamp, where, writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'
import { decode } from './adasData'
import { norm } from './fleetData'

export const NOTIF_LIMIT = 500
export const NOTIF_REFRESH_MS = 60 * 1000

// How each alert has been handled. 'new' = nobody has touched it yet.
export const STATUSES = {
  new: { label: 'ใหม่', color: '#fab219' },
  ack: { label: 'รับทราบ', color: '#3987e5' },
  done: { label: 'ดำเนินการแล้ว', color: '#0ca30c' },
  false: { label: 'แจ้งเตือนผิดพลาด', color: '#898781' },
}

/* ---------- cell helpers ---------- */

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
const blank = (s) => (/^(-|—|n\/?a|null|undefined)$/i.test(s) ? '' : s)
const url = (s) => (/^https?:\/\//i.test(s) ? s : '')

/* ---------- the alert feeds ---------- */

// Each feed: its API, the column names it uses, and how a row becomes an alert.
// `prefix` keeps Firestore ids apart, because two Telegram chats can reuse the same message_id.
export const SOURCES = {
  pms: {
    label: 'PMS',
    group: 'pms',
    sub: 'Lap',
    url: 'https://script.google.com/macros/s/AKfycbyrSPxsAz9pY1Rswe1tIsvyg3sAq3Yh3wbWg2RmZCe6xMeTh4YiakBFWSBDWpgOYAuvIg/exec',
    prefix: '', // PMS was first; its ids stay as they are so saved statuses keep working
    fields: {
      id: ['message_id'], alarm: ['เวลาปลุก'], sent: ['เวลาส่ง'], received: ['received_at'],
      device: ['ชื่ออุปกรณ์'], deviceNo: ['หมายเลขอุปกรณ์'], typeTh: ['ประเภทสัญญาณเตือน'], typeEn: ['Type'],
      satellites: ['satellites'], lat: ['lat'], lon: ['lon'], link: ['ลิงก์', 'link'],
    },
    build: (get) => ({
      at: thaiTime(get('alarm')) ?? thaiTime(get('sent')) ?? thaiTime(get('received')),
      device: get('device'),
      deviceNo: get('deviceNo'),
      type: get('typeTh') || get('typeEn'),
      sub: get('typeEn'),
      satellites: num(get('satellites')),
      lat: num(get('lat')), lon: num(get('lon')),
      link: url(get('link')),
    }),
  },
  pms2: {
    label: 'PMS 2',
    group: 'pms', // a sub-tab under PMS: the same alerts, logged by the second (24-hour) machine into its own sheet
    sub: 'Desk',
    url: 'https://script.google.com/macros/s/AKfycby2v9rxFWKJUB3t0Q8q75k0Cehb88o-E4cTx7BSSehs1LU6BNKditO3ko-3yRejDgVL/exec?key=2ece0a1e4e69f0c8ddc282d10dfdf1b0',
    prefix: 'pms2_',
    fields: {
      id: ['message_id'], alarm: ['เวลาเกิดเหตุ'], sent: ['เวลาแจ้งเตือน'], received: ['เวลาข้อความ'],
      device: ['ชื่ออุปกรณ์'], deviceNo: ['หมายเลขอุปกรณ์'], typeTh: ['ประเภทสัญญาณเตือน'], typeEn: ['ประเภท (EN)'],
      detail: ['รายละเอียด'], lat: ['ละติจูด', 'lat'], lon: ['ลองจิจูด', 'lon'], map: ['แผนที่'], link: ['ลิงก์หลักฐาน', 'ลิงก์'],
    },
    build: (get) => ({
      at: thaiTime(get('alarm')) ?? thaiTime(get('sent')) ?? thaiTime(get('received')),
      device: get('device'),
      deviceNo: get('deviceNo'),
      type: get('typeTh') || get('typeEn'),
      sub: get('typeEn'),
      satellites: num(get('detail').match(/satellites\s*:\s*(\d+)/i)?.[1]),
      lat: num(get('lat')), lon: num(get('lon')),
      mapUrl: url(get('map')),
      link: url(get('link')),
    }),
  },
  ngv: {
    label: 'NGV',
    group: 'ngv',
    sub: 'Lap',
    url: 'https://script.google.com/macros/s/AKfycbxM29qIRUvgpWTpKeYNxRHWr3BSseuWgYYUunQZ5dyEXn7JrdDLTs0EQgrAwNmtPxshdw/exec',
    prefix: 'ngv_',
    fields: {
      id: ['message_id'], time: ['เวลา'], received: ['received_at'],
      device: ['ชื่อรถ'], status: ['สถานะ'], type: ['ประเภท'], group: ['ชื่อกลุ่มรถ'], driver: ['พขร'],
      sim: ['เบอร์ซิม'], location: ['สถานที่'], lat: ['lat'], lon: ['lon'], map: ['แผนที่'], video: ['วิดีโอ'],
    },
    build: (get) => ({
      at: thaiTime(get('time')) ?? thaiTime(get('received')),
      device: get('device'),
      type: get('type') || get('status'),
      sub: get('status'),
      group: get('group'),
      driver: blank(get('driver')),
      location: get('location'),
      lat: num(get('lat')), lon: num(get('lon')),
      mapUrl: url(get('map')),
      video: url(get('video')),
    }),
  },
  ngv2: {
    label: 'NGV 2',
    group: 'ngv', // the same alerts, logged by the second (24-hour) machine into its own sheet
    sub: 'Desk',
    url: 'https://script.google.com/macros/s/AKfycbz1ggXR9tfhX0zjmUZJjiupcovlWLVv00zS6L8eZ1aVZE4mVUihWqSdpdLafjW7P2ET/exec?key=1a24f9c5ddb6aeec4262ecb8f5e49da3',
    prefix: 'ngv2_',
    fields: {
      id: ['message_id'], time: ['เวลาเกิดเหตุ'], received: ['เวลาข้อความ'],
      device: ['ชื่ออุปกรณ์', 'ชื่อรถ'], type: ['ประเภทสัญญาณเตือน', 'ประเภท'], group: ['กลุ่มรถ', 'ชื่อกลุ่มรถ'],
      driver: ['พนักงานขับรถ', 'พขร'], location: ['สถานที่'], lat: ['ละติจูด', 'lat'], lon: ['ลองจิจูด', 'lon'],
      map: ['แผนที่'], link: ['ลิงก์หลักฐาน'],
    },
    build: (get) => ({
      at: thaiTime(get('time')) ?? thaiTime(get('received')),
      device: get('device'),
      type: get('type'),
      group: get('group'),
      driver: blank(get('driver')),
      location: get('location'),
      lat: num(get('lat')), lon: num(get('lon')),
      mapUrl: url(get('map')),
      link: url(get('link')),
    }),
  },
  ob: {
    label: 'OB',
    group: 'ob',
    sub: 'Lap',
    url: 'https://script.google.com/macros/s/AKfycbwvRpEnb_BhS8klzmtyegScU5knjkFTldWrwHjV0JXJIJIh9gQMRTicy7wVtJ43GN5pzA/exec',
    prefix: 'ob_',
    fields: {
      id: ['message_id'], time: ['เวลา'], received: ['received_at'],
      device: ['ชื่อรถ'], status: ['สถานะ'], type: ['ประเภท'], group: ['ชื่อกลุ่ม', 'ชื่อกลุ่มรถ'], speed: ['ความเร็ว'],
      location: ['สถานที่'], lat: ['lat'], lon: ['lon'], map: ['แผนที่'], video: ['วิดีโอ'],
    },
    build: (get) => ({
      at: thaiTime(get('time')) ?? thaiTime(get('received')),
      device: get('device'),
      type: get('type') || get('status'),
      sub: get('status'),
      group: get('group'),
      speed: num(get('speed')),
      location: get('location'),
      lat: num(get('lat')), lon: num(get('lon')),
      mapUrl: url(get('map')),
      video: url(get('video')),
    }),
  },
  ob2: {
    label: 'OB 2',
    group: 'ob', // the same alerts, logged by the second (24-hour) machine into its own sheet
    sub: 'Desk',
    url: 'https://script.google.com/macros/s/AKfycby_ELUU1hCoba2uL-A4b64J4OxBs6X5E6_HaOu-6vJg_DhrNX5jMUWFgoMJUSgxCh1Kxw/exec?key=e825a6bcf83b639d92dc3157197cfdfc',
    prefix: 'ob2_',
    fields: {
      id: ['message_id'], time: ['เวลาเกิดเหตุ'], received: ['เวลาข้อความ'],
      device: ['ชื่ออุปกรณ์', 'ชื่อรถ'], type: ['ประเภทสัญญาณเตือน', 'ประเภท'], group: ['กลุ่มรถ', 'ชื่อกลุ่ม'],
      speed: ['ความเร็ว (กม./ชม.)', 'ความเร็ว'], location: ['สถานที่'], lat: ['ละติจูด', 'lat'], lon: ['ลองจิจูด', 'lon'],
      map: ['แผนที่'], video: ['ลิงก์หลักฐาน', 'วิดีโอ'],
    },
    build: (get) => ({
      at: thaiTime(get('time')) ?? thaiTime(get('received')),
      device: get('device'),
      type: get('type'),
      group: get('group'),
      speed: num(get('speed')),
      location: get('location'),
      lat: num(get('lat')), lon: num(get('lon')),
      mapUrl: url(get('map')),
      video: url(get('video')),
    }),
  },
  ttt: {
    label: 'TTT',
    group: 'ttt',
    sub: 'Lap',
    url: 'https://script.google.com/macros/s/AKfycbxTiiT_N_xfUx0DkoVcYSk7ee8XHW25CimN48z-TRARi0zoHG7wz-Qn35hs-OmKbUplwQ/exec',
    prefix: 'ttt_',
    fields: {
      id: ['message_id'], time: ['เวลา'], received: ['received_at'],
      device: ['ชื่อรถ'], status: ['สถานะ'], type: ['ประเภท'], group: ['ชื่อกลุ่มรถ', 'ชื่อกลุ่ม'], driver: ['พขร'],
      speed: ['ความเร็ว'], area: ['ชื่อพื้นที่'], station: ['สถานี'], location: ['สถานที่'],
      lat: ['lat'], lon: ['lon'], map: ['แผนที่'], video: ['วิดีโอ mp4', 'วิดีโอ'], dtc: ['วิดีโอ DTC'],
    },
    build: (get) => ({
      at: thaiTime(get('time')) ?? thaiTime(get('received')),
      device: get('device'),
      type: get('type') || get('status'),
      sub: get('status'),
      group: get('group'),
      driver: blank(get('driver').replace(/\s+/g, ' ')),
      speed: num(get('speed')),
      location: [get('area'), get('station'), get('location')].filter(Boolean).join(' · '),
      lat: num(get('lat')), lon: num(get('lon')),
      mapUrl: url(get('map')),
      video: url(get('video')),
      link: url(get('dtc')),
      linkLabel: 'วิดีโอ DTC',
    }),
  },
  ttt2: {
    label: 'TTT 2',
    group: 'ttt', // the same alerts, logged by the second (24-hour) machine into its own sheet
    sub: 'Desk',
    url: 'https://script.google.com/macros/s/AKfycbypAF8-VR3sfHgyvhW8pkrNJpjw7WWEbI5DU4sOv_Xi-IMMFLj9KMKaFySO4UYcrQNn/exec?key=d5a47996fd182ebf52971fd8b7403fd1',
    prefix: 'ttt2_',
    fields: {
      id: ['message_id'], time: ['เวลาเกิดเหตุ'], received: ['เวลาข้อความ'],
      device: ['ชื่ออุปกรณ์', 'ชื่อรถ'], type: ['ประเภทสัญญาณเตือน', 'ประเภท'], group: ['กลุ่มรถ', 'ชื่อกลุ่มรถ'],
      driver: ['พนักงานขับรถ', 'พขร'], speed: ['ความเร็ว (กม./ชม.)', 'ความเร็ว'], area: ['ชื่อพื้นที่'],
      location: ['สถานที่'], lat: ['ละติจูด', 'lat'], lon: ['ลองจิจูด', 'lon'], map: ['แผนที่'], dtc: ['ลิงก์หลักฐาน'],
    },
    build: (get) => ({
      at: thaiTime(get('time')) ?? thaiTime(get('received')),
      device: get('device'),
      type: get('type'),
      group: get('group'),
      driver: blank(get('driver').replace(/\s+/g, ' ')),
      speed: num(get('speed')),
      location: [get('area'), get('location')].filter(Boolean).join(' · '),
      lat: num(get('lat')), lon: num(get('lon')),
      mapUrl: url(get('map')),
      link: url(get('dtc')),
      linkLabel: 'วิดีโอ DTC',
    }),
  },
  bsrc: {
    label: 'BSRC COC',
    group: 'bsrc',
    sub: 'Lap',
    url: 'https://script.google.com/macros/s/AKfycbxLFR1aBglVpt49S33Vsk_H_iF68ePKfjq3UDUdhWEOAaIsEJpG_TMC90Mvs_3uTzm3/exec',
    prefix: 'bsrc_',
    fields: {
      id: ['message_id'], time: ['เวลา'], received: ['received_at'],
      device: ['ชื่อรถ'], status: ['สถานะ'], type: ['ประเภท'], group: ['ชื่อกลุ่มรถ', 'ชื่อกลุ่ม'], driver: ['พขร'],
      speed: ['ความเร็ว'], location: ['สถานที่'], lat: ['lat'], lon: ['lon'], map: ['แผนที่'],
      video: ['วิดีโอ mp4', 'วิดีโอ'], other: ['วิดีโอ อื่น'],
    },
    build: (get) => ({
      at: thaiTime(get('time')) ?? thaiTime(get('received')),
      device: get('device'),
      type: get('type') || get('status'),
      sub: get('status'),
      group: get('group'),
      driver: blank(get('driver').replace(/\s+/g, ' ')),
      speed: num(get('speed')),
      location: get('location'),
      lat: num(get('lat')), lon: num(get('lon')),
      mapUrl: url(get('map')),
      video: url(get('video')),
      link: url(get('other')),
      linkLabel: 'วิดีโออื่น',
    }),
  },
  bsrc2: {
    label: 'BSRC COC 2',
    group: 'bsrc', // the same alerts, logged by the second (24-hour) machine into its own sheet
    sub: 'Desk',
    url: 'https://script.google.com/macros/s/AKfycbx7hgiz_BKEF-m2lfdGmV1LyYOt0-5dWXwgu8IbQzqFecrHnMDw3hj9UGcIBD0Bcqfi/exec?key=cf36d3977ad27f99516ca7619dac3d7e',
    prefix: 'bsrc2_',
    fields: {
      id: ['message_id'], time: ['เวลาเกิดเหตุ'], received: ['เวลาข้อความ'],
      device: ['ชื่ออุปกรณ์', 'ชื่อรถ'], type: ['ประเภทสัญญาณเตือน', 'ประเภท'], group: ['กลุ่มรถ', 'ชื่อกลุ่มรถ'],
      driver: ['พนักงานขับรถ', 'พขร'], location: ['สถานที่'], lat: ['ละติจูด', 'lat'], lon: ['ลองจิจูด', 'lon'],
      map: ['แผนที่'], video: ['ลิงก์หลักฐาน', 'วิดีโอ mp4'],
    },
    build: (get) => ({
      at: thaiTime(get('time')) ?? thaiTime(get('received')),
      device: get('device'),
      type: get('type'),
      group: get('group'),
      driver: blank(get('driver').replace(/\s+/g, ' ')),
      location: get('location'),
      lat: num(get('lat')), lon: num(get('lon')),
      mapUrl: url(get('map')),
      video: url(get('video')),
    }),
  },
}

export function toNotifs(rows, src) {
  if (!rows.length) return []
  const headers = Object.keys(rows[0])
  const key = {}
  for (const [f, names] of Object.entries(src.fields)) {
    key[f] = headers.find((h) => names.some((n) => norm(h) === norm(n)))
  }
  const out = []
  for (const row of rows) {
    const get = (f) => (key[f] ? String(row[key[f]] ?? '').trim() : '')
    const id = get('id')
    if (!/^[\w-]{1,90}$/.test(id)) continue
    const n = src.build(get)
    if (!n.at) continue
    const hasPos = n.lat !== null && n.lon !== null && !(n.lat === 0 && n.lon === 0)
    const type = n.type || '(ไม่ระบุ)'
    out.push({
      deviceNo: '', group: '', driver: '', location: '', satellites: null, speed: null, link: '', video: '', ...n,
      id,
      key: src.prefix + id,
      device: n.device || '(ไม่ระบุ)',
      type,
      sub: n.sub && n.sub !== type ? n.sub : '',
      mapUrl: n.mapUrl || (hasPos ? `https://www.google.com/maps/search/?api=1&query=${n.lat},${n.lon}` : ''),
      raw: row,
    })
  }
  // Newest first; Telegram can resend the same message, keep one per id.
  const seen = new Set()
  return out.sort((a, b) => b.at - a.at).filter((n) => !seen.has(n.id) && seen.add(n.id))
}

export async function loadNotifs(src) {
  const res = await fetch(`${src.url}${src.url.includes('?') ? '&' : '?'}limit=${NOTIF_LIMIT}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Could not load notifications (HTTP ${res.status}).`)
  const text = await res.text()
  if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('The link returned a web page, not data. Is the script deployed with access "Anyone"?')
  const json = JSON.parse(text)
  if (json?.error) throw new Error(json.error)
  return toNotifs(decode(json), src)
}

/* ---------- handling status, shared by everyone (Firestore) ---------- */

const COL = 'notifActions'

// Live map of Firestore id (n.key) -> { status, note, byName, at } for alerts at or after `since`.
// PMS and NGV share the collection; ids from the other feed simply never match.
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
  return setDoc(doc(db, COL, n.key), entry(n, user, status, note.slice(0, 500)))
}

// Several alerts at once (max 500 per Firestore batch).
export async function saveActions(list, user, status, notes) {
  for (let i = 0; i < list.length; i += 500) {
    const b = writeBatch(db)
    for (const n of list.slice(i, i + 500)) b.set(doc(db, COL, n.key), entry(n, user, status, notes(n)))
    await b.commit()
  }
}

/* ---------- copy to the Google Sheet row of each alert (apps-script/telegram-notif-post.gs) ---------- */

// text/plain avoids a CORS preflight, which Apps Script does not answer.
export async function sendToSheet(src, list, user, status, notes) {
  const by = user.displayName || user.email || ''
  const items = list.map((n) => ({ id: n.id, status: STATUSES[status]?.label ?? status, note: notes(n), by }))
  const res = await fetch(src.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ source: 'notif-page', items }), // source tells doPost this is not a Telegram update
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('สคริปต์ตอบกลับเป็นหน้าเว็บ ยังไม่ได้ Deploy เวอร์ชันใหม่?')
  const json = JSON.parse(text)
  if (json?.error === 'unauthorized') throw new Error(`สคริปต์ ${src.label} ยังไม่ได้เพิ่ม handleNotifPost ใน doPost หรือยังไม่ได้ Deploy เวอร์ชันใหม่`)
  if (json?.error) throw new Error(json.error)
  if (json?.notFound?.length) throw new Error(`ไม่พบ message_id ${json.notFound.slice(0, 5).join(', ')} ในชีต`)
  return json
}
