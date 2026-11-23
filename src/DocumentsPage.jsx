import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, Upload, FileSpreadsheet, Download, X, AlertTriangle, Loader2, Plus, Trash2, RotateCcw, Route, RefreshCw,
} from 'lucide-react'
import { loadDistances, findDistance, findMatch } from './distanceData'
import {
  OUT_HEAD, readBook, readSheet, pickSheet, sheetDate, guessDepot, convertSheet, toRows, numberRows,
  writeXlsx, fmtYmd, toInputDate, fromInputDate,
} from './planConvert'

// Input width (characters) per output column.
const COL_SIZE = [0, 10, 6, 10, 30, 17, 6, 17, 17, 9, 18, 3, 0]

const today = () => {
  const d = new Date()
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }
}
let nextId = 1

// Reads a sheet and fills in the settings found in it (date, depot).
async function loadSheet(file, sheet) {
  const rows = await readSheet(file.buf, sheet)
  const date = sheetDate(rows, sheet, file.name) ?? today()
  const title = rows.slice(0, 3).flat().filter((v) => typeof v === 'string').join(' ')
  return { ...file, sheet, rows, date: toInputDate(date), depot: guessDepot(file.name, title), status: 'ready' }
}

export default function DocumentsPage() {
  const [files, setFiles] = useState([])
  const [carrier, setCarrier] = useState('SCC')
  const [drag, setDrag] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const input = useRef(null)

  const update = (id, patch) => setFiles((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)))

  const add = async (list) => {
    setError(null)
    const picked = [...list].filter((f) => /\.(xlsx|xlsm|xls|csv)$/i.test(f.name))
    if (!picked.length) { setError('รองรับไฟล์ Excel (.xlsx, .xls) หรือ .csv'); return }
    fetchDist(true) // ask the distance sheet again, so rows added since the page opened are found
    for (const f of picked) {
      const id = nextId++
      setFiles((fs) => [...fs, { id, name: f.name, status: 'loading' }])
      try {
        const buf = new Uint8Array(await f.arrayBuffer())
        const sheets = await readBook(buf)
        const sheet = await pickSheet(buf, sheets, today())
        const loaded = await loadSheet({ id, name: f.name, buf, sheets }, sheet)
        update(id, loaded)
      } catch (e) {
        update(id, { status: 'error', error: `อ่านไฟล์ไม่ได้: ${e.message}` })
      }
    }
  }

  const changeSheet = async (file, sheet) => {
    update(file.id, { status: 'loading' })
    try {
      update(file.id, await loadSheet(file, sheet))
    } catch (e) {
      update(file.id, { status: 'error', error: `อ่านชีตไม่ได้: ${e.message}` })
    }
  }

  // Convert every loaded file with its own settings, then number the trips across all files.
  const results = useMemo(() => files.map((f) => {
    if (f.status !== 'ready') return null
    const date = fromInputDate(f.date) ?? today()
    return convertSheet(f.rows, { date, depot: f.depot.trim(), carrier: carrier.trim() })
  }), [files, carrier])
  const base = useMemo(
    () => files.flatMap((f, i) => (results[i]?.trips ? toRows(results[i].trips, `${f.id}:`) : [])),
    [files, results],
  )

  // Distance database, loaded when the page opens and again on every upload.
  // While it reloads the previous copy stays in use, so the table does not go blank.
  const [dist, setDist] = useState({ status: 'idle', index: null, error: null })
  const fetchDist = (force) => {
    setDist((d) => ({ ...d, status: 'loading', error: null }))
    loadDistances(force)
      .then((index) => setDist({ status: 'ready', index, error: null }))
      .catch((e) => setDist((d) => ({ ...d, status: 'error', error: e.message })))
  }
  useEffect(() => {
    fetchDist(true) // load on page open (fresh, not a copy from an earlier visit)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Changes made in the table. They are kept by row key, so they survive changing another file's settings.
  const [edits, setEdits] = useState({}) // key -> { column: value }
  const [added, setAdded] = useState([]) // { key, after, start, cells }
  const [removed, setRemoved] = useState(() => new Set())

  const table = useMemo(() => {
    const list = [...base]
    for (const a of added) {
      const at = list.findIndex((r) => r.key === a.after)
      list.splice(at < 0 ? list.length : at + 1, 0, a)
    }
    let depot = null // the depot of the trip a row belongs to
    return list
      .filter((r) => !removed.has(r.key))
      .map((r) => {
        const cells = r.cells.map((v, c) => (edits[r.key] && c in edits[r.key] ? edits[r.key][c] : v))
        const empty = (c) => cells[c] == null || cells[c] === ''
        const typed = (c) => edits[r.key] && c in edits[r.key]
        // Empty depot on a trip's first row -> the depot the distance database found this customer at.
        let autoDepot = false
        if (r.start && empty(3) && !typed(3) && dist.index) {
          const hit = findMatch(dist.index, cells[4], null)
          if (hit?.depot) { cells[3] = hit.depot; autoDepot = true }
        }
        if (r.start) depot = cells[3]
        // Empty distance -> fill from the distance database (a typed value always wins).
        let autoKm = false
        if (!typed(6) && empty(6) && dist.index) {
          const km = findDistance(dist.index, cells[4], depot)
          if (km != null) { cells[6] = km; autoKm = true }
        }
        return { ...r, added: r.key.startsWith('n'), cells, autoKm, autoDepot }
      })
  }, [base, added, removed, edits, dist.index])
  const kmFilled = table.filter((r) => r.autoKm).length
  const depotFilled = table.filter((r) => r.autoDepot).length
  const kmMissing = table.filter((r) => r.cells[4] && (r.cells[6] == null || r.cells[6] === '')).length
  const rows = useMemo(() => numberRows(table), [table])
  const drops = rows.length
  const tripCount = table.filter((r, i) => r.start || i === 0).length
  const changes = Object.values(edits).reduce((n, e) => n + Object.keys(e).length, 0) + added.length + removed.size

  const editCell = (key, col, value) => setEdits((e) => ({ ...e, [key]: { ...e[key], [col]: value } }))
  const addRow = (after, start) => {
    const cells = Array(OUT_HEAD.length).fill(null)
    if (start) {
      const first = files.find((f) => f.status === 'ready')
      cells[1] = fmtYmd(fromInputDate(first?.date) ?? today())
      cells[2] = carrier.trim() || null
      cells[11] = 1
    }
    setAdded((a) => [...a, { key: `n${nextId++}`, after, start, cells }])
  }
  // Removing a trip's first row removes the whole trip, so its drops don't join the trip above.
  const removeRow = (i) => {
    const keys = [table[i].key]
    if (table[i].start) for (let j = i + 1; j < table.length && !table[j].start; j++) keys.push(table[j].key)
    setRemoved((s) => new Set([...s, ...keys]))
  }
  const resetEdits = () => { setEdits({}); setAdded([]); setRemoved(new Set()) }

  const download = async () => {
    setSaving(true)
    setError(null)
    try {
      const buf = await writeXlsx(rows)
      const first = files.find((f) => f.status === 'ready')
      const day = fromInputDate(first?.date) ?? today()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      a.download = `แผนงานจัดส่ง ${fmtYmd(day).replace(/\//g, '-')}.xlsx`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    } catch (e) {
      setError(`สร้างไฟล์ไม่ได้: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const stop = (e) => e.preventDefault() // dropping a file outside the box must not open it in the tab
    addEventListener('dragover', stop)
    addEventListener('drop', stop)
    return () => { removeEventListener('dragover', stop); removeEventListener('drop', stop) }
  }, [])

  return (
    <div className="stage scroll">
      <main className="dash conv">
        <header className="dash-head">
          <a href="#/" className="back"><ArrowLeft size={16} /> เมนู</a>
          <div className="dash-title">
            <h1>แปลง<b>แผนงาน</b></h1>
            <p className="sub">ใส่แผนงานรูปแบบไหนก็ได้ ระบบจะจัดให้เป็นรูปแบบตามไฟล์ตัวอย่าง · ไฟล์ไม่ถูกส่งออกจากเครื่อง</p>
          </div>
        </header>

        <section className="panel" style={{ '--i': 0 }}>
          <div
            className={`drop${drag ? ' on' : ''}`}
            onClick={() => input.current.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files) }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current.click()}
          >
            <Upload size={22} />
            <strong>ลากไฟล์แผนงานมาวาง หรือคลิกเพื่อเลือก</strong>
            <small>.xlsx / .xls · เลือกได้หลายไฟล์ จะรวมเป็นไฟล์เดียว</small>
            <input
              ref={input} type="file" multiple hidden accept=".xlsx,.xlsm,.xls,.csv"
              onChange={(e) => { add(e.target.files); e.target.value = '' }}
            />
          </div>
          <label className="conv-carrier">
            ผู้ขนส่ง
            <input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="เช่น SCC" />
          </label>
          {error && <p className="conv-err"><AlertTriangle size={14} /> {error}</p>}
          <DistanceSource dist={dist} onReload={() => fetchDist(true)} />
        </section>

        {files.length > 0 && (
          <ul className="conv-files">
            {files.map((f, i) => (
              <FileCard
                key={f.id} file={f} result={results[i]}
                onSheet={(s) => changeSheet(f, s)}
                onChange={(patch) => update(f.id, patch)}
                onRemove={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))}
              />
            ))}
          </ul>
        )}

        {files.length > 0 && (
          <section className="panel" style={{ '--i': 2 }}>
            <div className="panel-head">
              <h2>ตรวจและแก้ไขก่อนส่งออก <span className="muted">{tripCount} เที่ยว · {drops} จุดส่ง</span></h2>
              <div className="conv-actions">
                {changes > 0 && (
                  <button type="button" className="conv-btn" onClick={resetEdits} title="ยกเลิกการแก้ไข เพิ่ม และลบทั้งหมด">
                    <RotateCcw size={14} /> ล้างการแก้ไข ({changes})
                  </button>
                )}
                <button type="button" className="conv-dl" onClick={download} disabled={!drops || saving}>
                  {saving ? <Loader2 size={15} className="spin" /> : <Download size={15} />} ดาวน์โหลด Excel
                </button>
              </div>
            </div>
            <p className="muted conv-hint">
              คลิกช่องเพื่อแก้ไข · <Plus size={12} /> เพิ่มจุดส่งใต้แถวนั้น · <Trash2 size={12} /> ลบแถว (ลบแถวแรกของเที่ยว = ลบทั้งเที่ยว)
              · ลำดับและ TRIP_DROP นับให้อัตโนมัติ
            </p>
            <p className={`conv-km${dist.status === 'error' ? ' bad' : ''}`}>
              <Route size={14} />
              {dist.status === 'loading' && 'กำลังโหลดฐานข้อมูลระยะทาง…'}
              {dist.status === 'ready' && (
                <>
                  ระยะทาง: เติมจากฐานข้อมูล {kmFilled} จุด{kmMissing > 0 && ` · ไม่พบ ${kmMissing} จุด (กรอกเองได้)`}
                  {depotFilled > 0 && ` · เติมคลังต้นทาง ${depotFilled} เที่ยว`}
                </>
              )}
              {dist.status === 'error' && `โหลดฐานข้อมูลระยะทางไม่ได้: ${dist.error}`}
              {dist.status !== 'loading' && (
                <button type="button" onClick={() => fetchDist(true)} title="โหลดฐานข้อมูลระยะทางใหม่">
                  <RefreshCw size={12} /> โหลดใหม่
                </button>
              )}
            </p>
            {drops > 0 && (
              <div className="table-scroll">
                <table className="orders conv-table">
                  <thead><tr><th aria-label="จัดการแถว" />{OUT_HEAD.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {table.map((r, i) => (
                      <tr key={r.key} className={`${r.start ? 'first' : ''}${r.added ? ' added' : ''}`}>
                        <td className="conv-row-act">
                          <button type="button" onClick={() => addRow(r.key, false)} title="เพิ่มจุดส่งใต้แถวนี้" aria-label="เพิ่มจุดส่งใต้แถวนี้"><Plus size={14} /></button>
                          <button type="button" className="del" onClick={() => removeRow(i)} title={r.start ? 'ลบทั้งเที่ยว' : 'ลบแถวนี้'} aria-label={r.start ? 'ลบทั้งเที่ยว' : 'ลบแถวนี้'}><Trash2 size={14} /></button>
                        </td>
                        {rows[i].map((v, c) => (c === 0 || c === 12 ? (
                          <td key={c} className="auto">{v ?? ''}</td>
                        ) : (
                          <td key={c} className={edits[r.key] && c in edits[r.key] ? 'edited' : (c === 6 && r.autoKm) || (c === 3 && r.autoDepot) ? 'auto-km' : ''}>
                            <input
                              value={v ?? ''}
                              size={COL_SIZE[c]}
                              onChange={(e) => editCell(r.key, c, e.target.value)}
                              aria-label={`${OUT_HEAD[c]} แถว ${i + 1}`}
                            />
                          </td>
                        )))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button type="button" className="conv-btn conv-add" onClick={() => addRow(table.at(-1)?.key ?? null, true)}>
              <Plus size={14} /> เพิ่มเที่ยวใหม่
            </button>
          </section>
        )}
      </main>
    </div>
  )
}

// The tabs the distance script is set up to read (DIST_CUSTOMER_COLUMN in apps-script/distance-db.gs).
const EXPECTED_TABS = ['Atlas-SRC', 'Atlas-BPK', 'เพิ่มเติม']

// What the distance API returned, tab by tab, so missing data is easy to spot.
function DistanceSource({ dist, onReload }) {
  const ix = dist.index
  const missing = ix ? EXPECTED_TABS.filter((t) => !ix.sheets.some((s) => s.sheet.trim() === t)) : []
  return (
    <div className={`conv-src${dist.status === 'error' ? ' bad' : ''}`}>
      <div className="conv-src-head">
        <Route size={14} />
        <strong>ฐานข้อมูลระยะทาง</strong>
        {dist.status === 'loading' && <span className="muted"><Loader2 size={12} className="spin" /> กำลังโหลด…</span>}
        {dist.status === 'ready' && <span className="muted">{ix.count} แถว · {ix.byName.size} ชื่อลูกค้า</span>}
        {dist.status === 'error' && <span>โหลดไม่ได้: {dist.error}</span>}
        {dist.status !== 'loading' && (
          <button type="button" onClick={onReload}><RefreshCw size={12} /> โหลดใหม่</button>
        )}
      </div>
      {ix && (
        <ul>
          {ix.sheets.map((s) => (
            <li key={s.sheet}>
              <b>{s.sheet}</b> {s.count} แถว
              <span className="muted"> · ชื่อจาก “{s.headers?.customer}” · ระยะทางจาก “{s.headers?.distance}”</span>
            </li>
          ))}
          {missing.map((t) => <li key={t} className="warn"><AlertTriangle size={12} /> ไม่ได้ข้อมูลจากแท็บ {t}</li>)}
          {ix.skipped.length > 0 && <li className="muted">ข้าม (ไม่มีคอลัมน์ลูกค้า + ระยะทาง): {ix.skipped.join(', ')}</li>}
        </ul>
      )}
    </div>
  )
}

function FileCard({ file, result, onSheet, onChange, onRemove }) {
  // Template columns this file has no data for, so they stay blank.
  const has = (k) => result?.found?.includes(k)
  const missing = !result?.found ? [] : [
    !has('depot') && !file.depot.trim() && 'คลังต้นทาง',
    !has('arrive') && 'เวลาถึงลูกค้า',
    !has('depart') && 'เวลาออกเดินทาง',
    !has('depart') && !has('start') && 'เวลาเริ่มงาน',
    !has('distance') && 'ระยะทาง',
  ].filter(Boolean)
  const dropCount = result?.trips?.reduce((n, t) => n + t.drops.length, 0) ?? 0
  return (
    <li className="panel conv-file" style={{ '--i': 1 }}>
      <div className="conv-file-top">
        <span className="ic"><FileSpreadsheet size={18} /></span>
        <strong title={file.name}>{file.name}</strong>
        <button type="button" className="conv-x" onClick={onRemove} aria-label={`เอา ${file.name} ออก`}><X size={16} /></button>
      </div>

      {file.status === 'loading' && <p className="muted"><Loader2 size={13} className="spin" /> กำลังอ่านไฟล์…</p>}
      {file.status === 'error' && <p className="conv-err"><AlertTriangle size={14} /> {file.error}</p>}

      {file.status === 'ready' && (
        <>
          <div className="conv-opts">
            <label>
              ชีต
              <select value={file.sheet} onChange={(e) => onSheet(e.target.value)}>
                {file.sheets.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label>
              วันที่แผนงาน
              <input type="date" value={file.date} onChange={(e) => onChange({ date: e.target.value })} />
            </label>
            <label>
              คลังต้นทาง (ถ้าในไฟล์ไม่มี)
              <input value={file.depot} onChange={(e) => onChange({ depot: e.target.value })} placeholder="เช่น BPK" />
            </label>
          </div>
          {result?.error ? (
            <p className="conv-err"><AlertTriangle size={14} /> {result.error}</p>
          ) : (
            <p className="muted">
              หัวตารางแถวที่ {result.headerRow} · {result.trips.length} เที่ยว · {dropCount} จุดส่ง
              {result.skipped > 0 && ` · ข้าม ${result.skipped} แถวที่ไม่ใช่งานส่ง`}
              {missing.length > 0 && ` · ไม่มีในไฟล์ (เว้นว่าง): ${missing.join(', ')}`}
            </p>
          )}
        </>
      )}
    </li>
  )
}
