// Export a report table: Excel (report sheet laid out like the screen + detail sheet), CSV, or
// tab-separated text for the clipboard (pastes into Excel, Google Sheets or chat as a table).

// Plain value of a cell for files: numbers stay numbers, everything else becomes text.
export function cellValue(col, row) {
  const v = row[col.key]
  if (v === null || v === undefined || v === '') return ''
  if ((col.type === 'date' || col.type === 'day') && v instanceof Date) {
    // Excel has no time zone: write the local wall-clock time as if it were UTC.
    return new Date(v.getTime() - v.getTimezoneOffset() * 60000)
  }
  if (['int', 'num', 'pct', 'min', 'pp'].includes(col.type)) return typeof v === 'number' && Number.isFinite(v) ? v : ''
  return String(v)
}

// Text shown on screen and in CSV / clipboard.
export function cellText(col, row) {
  const v = row[col.key]
  if (v === null || v === undefined || v === '') return col.type === 'text' ? '' : '–'
  switch (col.type) {
    case 'int': return Math.round(v).toLocaleString('th-TH')
    case 'num': return v.toLocaleString('th-TH', { maximumFractionDigits: 1 })
    case 'pct': return `${v.toFixed(v >= 10 || v === 0 ? 0 : 1)}%`
    case 'pp': return `${v > 0 ? '+' : ''}${v.toFixed(1)}`
    case 'min': return fmtMinutes(v)
    case 'date': return v instanceof Date ? v.toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : String(v)
    case 'day': return v instanceof Date ? v.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' }) : String(v)
    default: return String(v)
  }
}

export function fmtMinutes(m) {
  if (m === null || m === undefined || !Number.isFinite(m)) return '–'
  if (m < 60) return `${Math.round(m)} นาที`
  const h = Math.floor(m / 60)
  const mm = Math.round(m % 60)
  return mm ? `${h} ชม. ${mm} นาที` : `${h} ชม.`
}

const safeName = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80)

function save(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

const lines = (cols, rows, total) => [
  cols.map((c) => c.label),
  ...rows.map((r) => cols.map((c) => cellText(c, r))),
  ...(total ? [cols.map((c, i) => (i === 0 ? 'รวม' : total[c.key] === undefined ? '' : cellText(c, total)))] : []),
]

export function toTSV(cols, rows, total) {
  return lines(cols, rows, total).map((l) => l.map((x) => String(x).replace(/[\t\n]+/g, ' ')).join('\t')).join('\n')
}

export function downloadCSV({ title, period, cols, rows, total, fileBase }) {
  const esc = (x) => `"${String(x).replace(/"/g, '""')}"`
  const head = [[title], [period], []]
  const body = [...head, ...lines(cols, rows, total)].map((l) => l.map(esc).join(',')).join('\r\n')
  save(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' }), `${safeName(fileBase)}.csv`)
}

// meta: { title, period, filters, notes[], generated, fileBase }
// detail: { cols, rows } | null — the records behind the numbers, one row each.
export async function downloadXlsx({ meta, cols, rows, total, detail }) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('รายงาน', { views: [{ showGridLines: false }] })
  const n = cols.length
  const gold = 'FFFACC15'
  const thin = { style: 'thin', color: { argb: 'FFD6D3CC' } }

  const titleRow = ws.addRow([meta.title])
  titleRow.font = { bold: true, size: 15 }
  ws.mergeCells(titleRow.number, 1, titleRow.number, Math.max(1, n))
  const sub = [meta.period, meta.filters, `ออกรายงาน ${meta.generated}`].filter(Boolean)
  for (const s of sub) {
    const r = ws.addRow([s])
    r.font = { color: { argb: 'FF5C5852' }, size: 10 }
    ws.mergeCells(r.number, 1, r.number, Math.max(1, n))
  }
  ws.addRow([])

  const head = ws.addRow(cols.map((c) => c.label))
  head.eachCell((c) => {
    c.font = { bold: true }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: gold } }
    c.border = { top: thin, bottom: thin, left: thin, right: thin }
    c.alignment = { vertical: 'middle', wrapText: true }
  })
  const firstData = head.number + 1
  for (const r of rows) ws.addRow(cols.map((c) => cellValue(c, r)))
  if (total) {
    const t = ws.addRow(cols.map((c, i) => (i === 0 ? 'รวม' : total[c.key] === undefined ? '' : cellValue(c, total))))
    t.font = { bold: true }
    t.eachCell((c) => { c.border = { top: { style: 'medium' } } })
  }
  // number formats per column
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1)
    const fmt = { int: '#,##0', num: '#,##0.0', pct: '0.0"%"', pp: '+0.0;-0.0;0.0', min: '#,##0" นาที"', date: 'dd/mm/yyyy hh:mm', day: 'dd/mm/yyyy' }[c.type]
    for (let r = firstData; r <= ws.rowCount; r++) {
      const cell = ws.getCell(r, i + 1)
      if (fmt && cell.value !== '' && cell.value !== null) cell.numFmt = fmt
      cell.border = { bottom: thin }
    }
    const longest = Math.max(c.label.length, ...rows.slice(0, 300).map((r) => cellText(c, r).length))
    col.width = Math.min(50, Math.max(9, longest + 3))
  })
  ws.views = [{ state: 'frozen', ySplit: head.number, showGridLines: false }]

  if (meta.notes?.length) {
    ws.addRow([])
    const h = ws.addRow(['ข้อสังเกต'])
    h.font = { bold: true }
    for (const note of meta.notes) {
      const r = ws.addRow([`• ${note}`])
      ws.mergeCells(r.number, 1, r.number, Math.max(1, n))
      r.alignment = { wrapText: true }
    }
  }

  if (detail?.rows?.length) {
    const ds = wb.addWorksheet('รายละเอียด', { views: [{ state: 'frozen', ySplit: 1 }] })
    const dh = ds.addRow(detail.cols.map((c) => c.label))
    dh.eachCell((c) => { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: gold } } })
    for (const r of detail.rows) ds.addRow(detail.cols.map((c) => cellValue(c, r)))
    detail.cols.forEach((c, i) => {
      const col = ds.getColumn(i + 1)
      if (c.type === 'date') col.numFmt = 'dd/mm/yyyy hh:mm'
      else if (c.type === 'day') col.numFmt = 'dd/mm/yyyy'
      else if (c.type === 'min') col.numFmt = '#,##0" นาที"'
      const longest = Math.max(c.label.length, ...detail.rows.slice(0, 300).map((r) => cellText(c, r).length))
      col.width = Math.min(60, Math.max(9, longest + 2))
    })
    ds.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: detail.cols.length } }
  }

  const buf = await wb.xlsx.writeBuffer()
  save(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safeName(meta.fileBase)}.xlsx`)
}
