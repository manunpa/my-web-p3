import { Fragment, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Search, ArrowUp, ArrowDown } from 'lucide-react'
import { cellText } from './reportExport'

const PAGE = 100
const DETAIL_PAGE = 50
const num = (t) => ['int', 'num', 'pct', 'min', 'pp'].includes(t)

// cols: [{ key, label, type: text|int|num|pct|pp|min|date }]
// rows: objects; a row with `_detail` (records) can be expanded to show them with detailCols.
export default function ReportTable({ cols, rows, total, detailCols }) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState(null) // { key, dir }
  const [open, setOpen] = useState(() => new Set())
  const [limit, setLimit] = useState(PAGE)

  useEffect(() => { setOpen(new Set()); setLimit(PAGE); setSort(null) }, [rows])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    let list = s ? rows.filter((r) => cols.some((c) => cellText(c, r).toLowerCase().includes(s))) : rows
    if (sort) {
      const c = cols.find((x) => x.key === sort.key)
      const v = (r) => {
        const x = r[sort.key]
        if (x instanceof Date) return x.getTime()
        return num(c?.type) ? (Number.isFinite(x) ? x : -Infinity) : String(x ?? '')
      }
      list = [...list].sort((a, b) => {
        const x = v(a), y = v(b)
        return (typeof x === 'number' ? x - y : x.localeCompare(y, 'th')) * sort.dir
      })
    }
    return list
  }, [rows, cols, q, sort])

  const toggleSort = (key) => setSort((s) => (s?.key === key ? (s.dir === -1 ? { key, dir: 1 } : null) : { key, dir: -1 }))
  const toggle = (i) => setOpen((o) => { const n = new Set(o); n.has(i) ? n.delete(i) : n.add(i); return n })
  const expandable = rows.some((r) => r._detail?.length)

  return (
    <div className="rep-table">
      <div className="rep-tools">
        <label className="f search">
          <Search size={15} />
          <input type="search" placeholder="ค้นหาในตาราง…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหาในตาราง" />
        </label>
        <span className="muted">{shown.length.toLocaleString('th-TH')} แถว{expandable && ' · กดแถวเพื่อดูรายการเคส'}</span>
      </div>
      <div className="table-scroll">
        <table className="orders report">
          <thead>
            <tr>
              {expandable && <th aria-label="กางดู" />}
              {cols.map((c) => (
                <th key={c.key} className={num(c.type) ? 'num' : ''}>
                  <button type="button" className="th-sort" onClick={() => toggleSort(c.key)}>
                    {c.label}
                    {sort?.key === c.key && (sort.dir === -1 ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map((r, i) => {
              const can = !!r._detail?.length
              const isOpen = open.has(r._key ?? i)
              return (
                <Fragment key={r._key ?? i}>
                  <tr className={`${can ? 'can-open' : ''}${isOpen ? ' open' : ''}`} onClick={can ? () => toggle(r._key ?? i) : undefined}>
                    {expandable && <td className="rep-caret">{can && (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}</td>}
                    {cols.map((c) => (
                      <td key={c.key} className={`${num(c.type) ? 'num' : ''}${c.wrap ? ' wrap' : ' nowrap'}`}>{cellText(c, r)}</td>
                    ))}
                  </tr>
                  {isOpen && (
                    <tr className="rep-detail-row">
                      <td colSpan={cols.length + (expandable ? 1 : 0)}>
                        <Detail cols={detailCols} rows={r._detail} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
          {total && (
            <tfoot>
              <tr>
                {expandable && <td />}
                {cols.map((c, i) => (
                  <td key={c.key} className={num(c.type) ? 'num' : ''}>
                    {i === 0 ? 'รวม' : total[c.key] === undefined ? '' : cellText(c, total)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {limit < shown.length && (
        <div className="table-foot">
          <span className="muted">แสดง {limit.toLocaleString('th-TH')} จาก {shown.length.toLocaleString('th-TH')} แถว (ไฟล์ที่ส่งออกมีครบทุกแถว)</span>
          <button type="button" className="more" onClick={() => setLimit((l) => l + PAGE)}>แสดงเพิ่ม</button>
        </div>
      )}
    </div>
  )
}

function Detail({ cols, rows }) {
  const [limit, setLimit] = useState(DETAIL_PAGE)
  if (!cols?.length) return null
  return (
    <div className="rep-detail">
      <table className="orders report sub">
        <thead><tr>{cols.map((c) => <th key={c.key} className={num(c.type) ? 'num' : ''}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.slice(0, limit).map((r, i) => (
            <tr key={r.id ?? i}>
              {cols.map((c) => <td key={c.key} className={`${num(c.type) ? 'num' : ''}${c.wrap ? ' wrap' : ' nowrap'}`}>{cellText(c, r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {limit < rows.length && (
        <button type="button" className="more small" onClick={(e) => { e.stopPropagation(); setLimit((l) => l + DETAIL_PAGE) }}>
          แสดงเพิ่ม ({rows.length - limit} เคส)
        </button>
      )}
    </div>
  )
}
