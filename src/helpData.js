/* ------------------------------------------------------------------ */
/* Data source for the help-button (ปุ่มช่วยเหลือ) dashboard             */
/* ------------------------------------------------------------------ */
import { norm, parseDate, provinceOf } from './fleetData'

// Apps Script web app returning { "<sheet name>": [ { column: value, ... }, ... ], ... }
// One sheet per service provider.
export const HELP_API_URL =
  'https://script.google.com/macros/s/AKfycbw6c8ueZVLvwLiQOg3u0rLNDy1ZsbNPlltNv5cMPSagly5KPpS2jU_LLNFB1Zn6w9w4/exec'

export const REFRESH_MS = 5 * 60 * 1000

// Providers in display order. `sheet` is matched against the sheet names (ignores case/spaces).
export const PROVIDERS = [
  { id: 'Songdee', sheet: 'songdee', color: '#3987e5' },
  { id: 'DTC', sheet: 'dtc', color: '#d95926' },
  { id: 'PMS', sheet: 'pms', color: '#199e70' },
]

// What was done about a help call. The sheet has one column per action, filled when it applies.
export const ACTIONS = {
  rsc: { label: 'RSC action', color: '#8f6ae0' },
  operation: { label: 'Operation action', color: '#e0a321' },
  none: { label: 'No action', color: '#d0605a' },
  unknown: { label: 'ไม่ระบุ', color: '#77756f' },
}

// Column names in the sheets -> field names. Matching ignores spaces, '/', '.', '-', '_' and case.
const FIELDS = {
  plate: ['หมายเลขรถ', 'ทะเบียนรถ', 'ทะเบียน'],
  driver: ['ชื่อคนขับ', 'คนขับ'],
  alert: ['แจ้งเตือน', 'ประเภทแจ้งเตือน'],
  date: ['วันที่'],
  time: ['เวลาแจ้งเตือน', 'เวลา'],
  unit: ['หน่วยงาน'],
  cause: ['สาเหตุ'],
  detail: ['รายละเอียด'],
  location: ['สถานที่'],
  speed: ['ความเร็ว'],
  rsc: ['RSC action', 'RSC_action', 'RSCaction'],
  operation: ['operation action', 'operationaction'],
  none: ['NO action', 'Noaction'],
}

const blank = /^(|-|—|false|#value!|#n\/a|undefined|null)$/i
const val = (v) => {
  const s = String(v ?? '').trim()
  return blank.test(s) ? '' : s
}

// Test presses ("TEST", "ทดสอบ", "เทสระบบ"...) can be hidden on the dashboard.
const TEST = /^(test|ทดสอบ|เทส)/i

function keyMap(row) {
  const byNorm = new Map(Object.keys(row).map((k) => [norm(k), k]))
  const out = {}
  for (const [field, names] of Object.entries(FIELDS)) {
    const k = names.map(norm).map((n) => byNorm.get(n)).find(Boolean)
    if (k) out[field] = k
  }
  return out
}

function toRecords(rows, provider) {
  if (!rows.length) return []
  const keys = keyMap(rows[0])
  const get = (row, f) => (keys[f] ? val(row[keys[f]]) : '')
  const out = []
  rows.forEach((row, i) => {
    const date = get(row, 'date')
    const time = get(row, 'time')
    const start = parseDate(time ? `${date} ${time}` : date)
    if (!start) return
    // A sheet with only an RSC column (PMS): a blank RSC cell counts as No action.
    const rscOnly = !keys.operation && !keys.none
    const action = get(row, 'rsc') ? 'rsc' : get(row, 'operation') ? 'operation'
      : get(row, 'none') || rscOnly ? 'none' : 'unknown'
    const location = get(row, 'location')
    const cause = get(row, 'cause')
    out.push({
      id: `${provider}-${i}`,
      provider,
      plate: get(row, 'plate') || '(ไม่ระบุ)',
      driver: get(row, 'driver') || '(ไม่ระบุ)',
      alert: get(row, 'alert'),
      start,
      hasTime: !!time && /\d:\d/.test(time),
      unit: get(row, 'unit') || '(ไม่ระบุ)',
      cause: cause || '(ไม่ระบุ)',
      detail: get(row, 'detail'),
      location,
      province: provinceOf(location),
      speed: get(row, 'speed'),
      action,
      test: TEST.test(cause),
    })
  })
  return out
}

export async function loadHelp() {
  const res = await fetch(HELP_API_URL, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Could not load the sheet (HTTP ${res.status}).`)
  const text = await res.text()
  if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('The link returned a web page, not data. Is the script shared publicly?')
  const json = JSON.parse(text)
  const sheets = new Map(Object.entries(json).map(([name, rows]) => [norm(name), Array.isArray(rows) ? rows : []]))
  const missing = PROVIDERS.filter((p) => !sheets.has(p.sheet)).map((p) => p.id)
  const records = PROVIDERS.flatMap((p) => toRecords(sheets.get(p.sheet) ?? [], p.id))
  return { records, missing }
}
