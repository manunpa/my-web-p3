import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Upload, FileSpreadsheet, Download, X, AlertTriangle, Loader2 } from 'lucide-react'
import {
  OUT_HEAD, readBook, readSheet, pickSheet, sheetDate, guessDepot, convertSheet, toRows,
  writeXlsx, fmtYmd, toInputDate, fromInputDate,
} from './planConvert'

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
  const trips = results.flatMap((r) => r?.trips ?? [])
  const rows = useMemo(() => toRows(trips), [results]) // eslint-disable-line react-hooks/exhaustive-deps
  const drops = rows.length

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
              <h2>ตัวอย่างผลลัพธ์ <span className="muted">{trips.length} เที่ยว · {drops} จุดส่ง</span></h2>
              <button type="button" className="conv-dl" onClick={download} disabled={!drops || saving}>
                {saving ? <Loader2 size={15} className="spin" /> : <Download size={15} />} ดาวน์โหลด Excel
              </button>
            </div>
            {drops ? (
              <div className="table-scroll">
                <table className="orders conv-table">
                  <thead><tr>{OUT_HEAD.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className={r[0] ? 'first' : ''}>
                        {r.map((v, j) => <td key={j}>{j === 1 ? fmtYmd(v) : v ?? ''}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">ยังไม่มีรายการที่แปลงได้</p>
            )}
          </section>
        )}
      </main>
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
