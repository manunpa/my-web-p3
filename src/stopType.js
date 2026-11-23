// Stop type of a LEO case, from its unlock reason ("สาเหตุที่ปลดล็อค").
// Same rules as the LEO dashboard in my-website-pm (leo_dashboard.js STOP_TYPES); they come from
// the IFS keyword formula in occ share/z BANKเล็ก/BCP, with the spellings and extra types found in
// 955 real cases (1 Oct - 23 Nov 2569). Checked top to bottom: the first group with a matching
// word wins, ignoring case and spaces (like Excel's SEARCH). Order matters.
export const STOP_TYPES = [
  ['ติดไฟแดง/สัญญาณไฟ', ['ไฟแดง', 'สัญญาณไฟ', 'สัญญานไฟ', 'ติดไฟแยก', 'แยกไฟ', 'รอไฟ', 'รอสัญญาณ', 'รอสัญญาน', 'ทางรถไฟ', 'รางรถไฟ']],
  ['การจราจรติดขัด', ['จราจร', 'รถติด', 'ติดขัด', 'เคลื่อนตัวช้า', 'ชะลอ', 'ชลอ', 'หนาแน่น', 'อุบัติเหตุ']],
  ['เปลี่ยนขับ', ['เปลี่ยนขับ', 'เปลี่ยนคนขับ', 'เปลี่ยนมือขับ', 'เปลี่ยนพขร', 'เปลี่ยนพนักงาน']],
  ['อยู่ลูกค้า', ['ลูกค้า', 'ลงน้ำมัน', 'ส่งน้ำมัน', 'ลงสินค้า']],
  ['เติมน้ำมัน', ['เติมน้ำมัน', 'เติมน้ำ', 'ฟลีตการ์ด', 'ฟลีทการ์ด', 'fleetcard']],
  ['เข้าห้องน้ำ/ส่วนตัว', ['ห้องน้ำ', 'ปัสสาวะ', 'ปัสวะ', 'ปวดท้อง', 'ล้างหน้า', 'ธุระ']],
  ['เรือข้ามฟาก', ['เรือ']],
  ['จอดหน่วยงาน/คลัง', ['หน่วยงาน', 'หน่อยงาน', 'คลัง', 'ฟลีท', 'hub']],
  ['จุดลงเวลา/ด่าน/ทางด่วน', ['ลงเวลา', 'ตัดเวลา', 'ด่าน', 'ค่าผ่านทาง', 'ทางด่วน', 'stopwork']],
  ['พักรถ/ทานข้าว', ['พักรถ', 'จุดพัก', 'จอดพัก', 'ขอพัก', 'กินข้าว', 'ทานข้าว', 'ซื้อข้าว', 'ทานอาหาร']],
  ['ซ่อมบำรุง/ยาง', ['รถเสีย', 'ช่าง', 'hino', 'scania', 'สแกนเนีย', 'ฮีโน่', 'pm', 'ศูนย์', 'ยาง', 'ซ่อม', 'อู่', 'อู๋', 'ความร้อน', 'ลมรั่ว', 'เสียงดัง', 'ตรวจสอบรถ', 'เช็ครถ']],
  ['โทรศัพท์/ติดต่อ', ['โทรศัพท์', 'เส้นทาง', 'ติดต่อ', 'หัวหน้างาน']],
  ['GPS/ระบบ', ['gps', 'ออฟไลน์', 'สัญญาณผิดปกติ', 'ไม่ได้จอด', 'ไม่มีการจอด', 'ไม่พบการจอด']],
  ['รถไม่ได้วิ่งงาน', ['ไม่ได้วิ่ง', 'ไม่มีวิ่งงาน', 'ไม่ได้ใช้วิ่งงาน', 'ไม่มีงาน']],
].map(([name, words]) => [name, words.map((w) => w.toLowerCase().replace(/\s+/g, ''))])

export const OTHER_TYPE = 'อื่นๆ'
export const STOP_TYPE_NAMES = [...STOP_TYPES.map((t) => t[0]), OTHER_TYPE]

export function stopType(reason) {
  const t = String(reason ?? '').toLowerCase().replace(/\s+/g, '')
  if (!t) return OTHER_TYPE
  for (const [name, words] of STOP_TYPES) if (words.some((w) => t.includes(w))) return name
  return OTHER_TYPE
}
