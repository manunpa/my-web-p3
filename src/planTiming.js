// "Calculate the times" mode of the Plan Converter.
//
// For each trip, from the first drop's arrival time and distance:
//   leave the depot (วัน/เวลา ที่ต้องออกเดินทาง) = arrive at the customer − distance ÷ speed
//   start work (เวลาที่ต้องมาเริ่มงาน)           = arrive at the depot = leave the depot − G2G of that depot
//   leave the home unit (shown only)          = start work − run time unit → depot
// A trip whose first drop has no distance keeps the plan's own times (with a note).
//
// Same rules as PlanCheck (SC Carrier) when a plan has no departure time.
// The values below are a copy of PlanCheck's settings screens (คลัง / เวลาโหลด G2G, เวลาวิ่ง หน่วยงาน → คลัง,
// รถ / Fleet) as of 24/11/2569. Change them here when those screens change.

export const SPEED = { '10W': 53, SEMI: 43 } // km/h
export const TYPE_LABEL = { '10W': 'สิบล้อ', SEMI: 'หัวลาก+หาง' }
const NO_G2G_MIN = 30 // no G2G (BPK โหลดเก็บ, or no loading depot known): start 30 min before leaving, like the template

// Depots: G2G minutes per vehicle type, opening hours, loading counted from, no-driving windows.
export const DEPOTS = {
  'PTT NSW': { g2g: { '10W': 90, SEMI: 90 }, open: '08:00', close: '16:00', count: '09:00', note: 'ได้คิวโหลดที่ 2-3 (9:00+)' },
  PCT: { g2g: { '10W': 90, SEMI: 90 }, open: '06:00', close: '17:00' },
  BPK: { g2g: null, note: 'โหลดเก็บ · หน่วยงานกับคลังอยู่ที่เดียวกัน' },
  BSRC: { g2g: { '10W': 120, SEMI: 120 }, open: '00:00', close: '24:00' },
  'PTT Tank': { g2g: { '10W': 120, SEMI: 120 }, noDrive: [['07:00', '08:00'], ['16:30', '17:30']] },
  IRPC: { g2g: { '10W': 150, SEMI: 150 } },
}
// Home units (หน่วยงานต้นทาง), where the trucks are based. They are not loading depots, except BPK
// which is both. A plan that names one of these as its depot does not say where the truck loads.
export const UNITS = ['BPK', 'BRP', 'SRC', 'SCN']
// Names in plans -> depot key above.
const DEPOT_ALIAS = [
  [/NSW|นครสวรรค์/i, 'PTT NSW'],
  [/PCT|พิจิตร|phichit/i, 'PCT'],
  [/PTT\s*Tank|ปตท\.?\s*แทงค์|tank/i, 'PTT Tank'],
  [/IRPC|ไออาร์พีซี/i, 'IRPC'],
  [/BSRC|บางจาก/i, 'BSRC'],
  [/BPK|บางปะกง/i, 'BPK'],
  [/BRP/i, 'BRP'],
  [/SRC|ศรีราชา/i, 'SRC'],
  [/SCN|นครชุม/i, 'SCN'],
]
export const depotKey = (s) => DEPOT_ALIAS.find(([re]) => re.test(String(s ?? '')))?.[1] ?? null

// Run time from the home unit to a depot, minutes [10W, SEMI].
const ROUTES = [
  ['SCN', 'PTT NSW', 119, '2:20', '2:50'],
  ['SCN', 'PCT', 90, '1:50', '2:10'],
  ['BPK', 'BSRC', 77, '1:30', '1:50'],
  ['BRP', 'BSRC', 25, '0:30', '0:40'],
  ['BPK', 'PTT Tank', 130, '2:30', '3:10'],
  ['BRP', 'PTT Tank', 56, '1:10', '1:20'],
  ['BPK', 'IRPC', 131, '2:30', '3:10'],
  ['BRP', 'IRPC', 65, '1:20', '1:40'],
  ['SRC', 'BSRC', 12, '0:15', '0:20'],
]
const hmToMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0) }
const route = (unit, depot, type) => {
  const r = ROUTES.find((x) => x[0] === unit && x[1] === depot)
  return r ? { km: r[2], min: hmToMin(type === 'SEMI' ? r[4] : r[3]) } : null
}

// Vehicles in use: plate -> [type, home units].
const T = '10W', S = 'SEMI'
const BB = ['BPK', 'BRP']
export const VEHICLES = Object.fromEntries([
  // SCC-SCN
  ['79-5846', T], ['66-0756', T], ['62-3062', S], ['62-3107', S], ['66-0757', T], ['67-0167', T], ['62-3105', S],
  ['65-8563', S], ['79-0144', T], ['79-0641', T], ['77-4038', S], ['78-1482', S],
].map(([p, t]) => [p, { type: t, units: ['SCN'] }]).concat([
  // SCC-Atlas SRC
  ['62-4247', T], ['62-4246', T], ['62-4060', T], ['62-5209', T], ['62-5570', T], ['62-4061', S], ['62-4245', T],
].map(([p, t]) => [p, { type: t, units: ['SRC'] }])).concat([
  // SCC-Atlas BPK-BRP
  ['68-3732', T], ['65-8565', S], ['79-5584', T], ['79-1961', T], ['78-9103', T], ['60-0702', S], ['77-4043', S],
  ['79-0870', S], ['78-1469', S], ['65-8566', S], ['63-0035', T], ['61-6552', T], ['66-0770', T], ['63-1302', T],
  ['68-3731', T], ['63-0036', T], ['63-0037', T], ['63-1300', T], ['66-0755', T], ['79-0869', S], ['79-0871', S],
  ['60-0709', S], ['60-1037', S], ['77-0410', S], ['79-0841', T], ['61-4783', T], ['61-4778', T], ['79-1830', T],
  ['76-9801', S],
].map(([p, t]) => [p, { type: t, units: BB }])))

const plateKey = (p) => (String(p ?? '').match(/(\d{1,3})\s*-\s*(\d{4})/) || []).slice(1).join('-')
export const vehicleOf = (plate) => VEHICLES[plateKey(plate)] ?? null
export const looksLikePlate = (s) => /\d{1,3}\s*-\s*\d{4}/.test(String(s ?? ''))

// "16/11/2569 07:00:00" <-> Date (Buddhist year, as the converter writes it).
export function parseCell(s) {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/.exec(String(s ?? ''))
  if (!m) return null
  const y = +m[3] > 2400 ? +m[3] - 543 : +m[3]
  return new Date(y, +m[2] - 1, +m[1], +m[4], +m[5])
}
const pad = (n) => String(n).padStart(2, '0')
export const fmtCell = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear() + 543} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`
export const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
export const dur = (min) => `${Math.floor(min / 60)}:${pad(Math.round(min % 60))}`
const MIN = 60000
const minOfDay = (d) => d.getHours() * 60 + d.getMinutes()
const inWindow = (d, [a, b]) => { const x = minOfDay(d); return x >= hmToMin(a) && x < hmToMin(b) }

// One trip: `rows` are its rows' cells (first drop first), after edits and the distance fill.
// `fileUnit` is the home unit guessed from the file, used when a vehicle belongs to two units.
// `fixedDepart`: the departure cell was typed in the table, so it is used as is.
// Like PlanCheck, start work always follows the departure (departure − G2G), also when the
// departure comes from the plan because the first drop has no distance.
// Returns { depart, start, departFromPlan, notes, warns, drops } or { keep: true, notes, ... }.
export function calcTrip(rows, fileUnit, fixedDepart = false) {
  const first = rows[0]
  const notes = []
  const warns = []
  const drops = rows.map(() => null)
  const arrive = parseCell(first[5])
  const km = Number(first[6])
  const veh = vehicleOf(first[9])
  const type = veh?.type ?? 'SEMI'
  if (!veh) {
    notes.push(looksLikePlate(first[9]) ? 'ไม่พบทะเบียนในข้อมูลรถ คิดแบบหัวลาก (ช้ากว่า เผื่อเวลา)'
      : first[9] ? `ช่องทะเบียนเป็น "${first[9]}" ไม่ใช่ทะเบียน คิดแบบหัวลาก` : 'ไม่มีทะเบียน คิดแบบหัวลาก')
  }
  const speed = SPEED[type]
  const planDepart = parseCell(first[7])
  let depart
  let departFromPlan = false
  if (fixedDepart && planDepart) {
    depart = planDepart
    departFromPlan = true
    notes.push('ใช้เวลาออกที่พิมพ์ไว้')
  } else if (arrive && km > 0) {
    // Run time rounded to the minute, as PlanCheck does (e.g. 125 กม. สิบล้อ = 2:22, due 06:00 -> 03:38).
    const runMin = Math.round((km / speed) * 60)
    depart = new Date(arrive.getTime() - runMin * MIN)
    notes.push(`${TYPE_LABEL[type]} ${speed} กม./ชม. · ${km} กม. ≈ ${dur(runMin)} ชม.`)
  } else if (planDepart) {
    depart = planDepart
    departFromPlan = true
    notes.push(`${arrive ? 'ดรอปแรกไม่มีระยะทาง' : 'ไม่มีเวลาถึงลูกค้า'} · ใช้เวลาออกจากแผน`)
  } else {
    return { keep: true, notes: [...notes, `${arrive ? 'ดรอปแรกไม่มีระยะทาง' : 'ไม่มีเวลาถึงลูกค้า'} และแผนไม่มีเวลาออก · PlanCheck จะคำนวณเองตอนนำเข้าไม่ได้เช่นกัน`], warns, drops }
  }
  const dk = depotKey(first[3])
  const depot = dk ? DEPOTS[dk] : null
  const g2g = depot?.g2g?.[type] ?? null
  const start = new Date(depart.getTime() - (g2g ?? NO_G2G_MIN) * MIN)
  if (g2g) notes.push(`G2G ${dk} ${dur(g2g)}`)
  else if (depot) notes.push(`${dk} ${depot.note || 'ไม่มีค่า G2G'} · เริ่มงานก่อนออก ${NO_G2G_MIN} นาที`)
  else if (UNITS.includes(dk)) warns.push(`${dk} เป็นหน่วยงาน ไม่ใช่คลัง ยังไม่รู้คลังที่โหลด · ใช้เริ่มงานก่อนออก ${NO_G2G_MIN} นาที`)
  else notes.push(`${first[3] ? `ไม่รู้จักคลัง "${first[3]}"` : 'ไม่มีคลังที่โหลด'} · เริ่มงานก่อนออก ${NO_G2G_MIN} นาที`)

  // Leaving the home unit, when the depot is elsewhere and the run time is known.
  if (dk && veh) {
    const units = veh.units.filter((u) => u !== dk && route(u, dk, type))
    const unit = units.includes(fileUnit) ? fileUnit : units[0]
    if (unit && !veh.units.includes(dk)) {
      const r = route(unit, dk, type)
      notes.push(`ออกจาก ${unit} ${hm(new Date(start.getTime() - r.min * MIN))} (วิ่ง ${dur(r.min)})`)
    }
  }

  // Depot hours and no-driving windows.
  if (depot?.open && depot.close !== '24:00') {
    const from = Math.max(hmToMin(depot.open), depot.count ? hmToMin(depot.count) : 0)
    if (minOfDay(start) < from) {
      const ready = new Date(start); ready.setHours(0, from + (g2g ?? 0), 0, 0)
      warns.push(`เข้าคลังก่อนเริ่มโหลด (${depot.count || depot.open}) ออกได้จริงราว ${hm(ready)} อาจไปไม่ทัน`)
    }
    if (depot.close && minOfDay(depart) > hmToMin(depot.close)) warns.push(`โหลดเสร็จหลังคลังปิด (${depot.close})`)
  }
  for (const w of depot?.noDrive || []) if (inWindow(depart, w)) warns.push(`ออกช่วงห้ามเดินรถ ${w[0]}-${w[1]}`)
  if (arrive && start.toDateString() !== arrive.toDateString()) notes.push(`เริ่มงานวันก่อนหน้า (${fmtCell(start).slice(0, 10)})`)

  // Later drops: only checked, when they have a distance and a time.
  for (let i = 1; i < rows.length; i++) {
    const t = parseCell(rows[i][5])
    const d = Number(rows[i][6])
    if (!t || !(d > 0)) continue
    const soonest = new Date(depart.getTime() + (d / speed) * 60 * MIN)
    if (t < soonest) drops[i] = `ดรอปนี้อาจไม่ทัน: ออก ${hm(depart)} ไป ${d} กม. ถึงเร็วสุดราว ${hm(soonest)}`
  }

  if (!departFromPlan && planDepart && Math.abs(planDepart - depart) >= 30 * MIN) notes.push(`แผนเดิมออก ${hm(planDepart)}`)
  return { depart, start, departFromPlan, notes, warns, drops }
}
