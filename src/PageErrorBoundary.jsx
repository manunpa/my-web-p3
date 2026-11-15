import { Component } from 'react'
import { AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react'

// A page file that can't be downloaded: usually a new version was deployed (old file names are gone)
// or the dev server re-bundled its libraries while the page was open. A reload fixes both.
const isChunkError = (e) =>
  /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch|ChunkLoadError/i
    .test(String(e?.message || e))

const RELOAD_KEY = 'page-error-reload-at'

// Shows a message instead of a blank screen when a page crashes.
export default class PageErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    console.error('Page crashed:', error)
    if (!isChunkError(error)) return
    // Reload once automatically; don't loop if the reload doesn't help.
    let last = 0
    try { last = +sessionStorage.getItem(RELOAD_KEY) || 0 } catch { /* storage blocked */ }
    if (Date.now() - last > 30000) {
      try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())) } catch { /* storage blocked */ }
      location.reload()
    }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const chunk = isChunkError(error)
    return (
      <div className="stage">
        <section className="card error-card in" role="alert">
          <span className="err-ic"><AlertTriangle size={22} /></span>
          <h1>เปิดหน้านี้<b>ไม่สำเร็จ</b></h1>
          <p className="sub">
            {chunk
              ? 'โหลดไฟล์ของหน้านี้ไม่ได้ อาจมีการอัปเดตเว็บไซต์เป็นเวอร์ชันใหม่ ลองโหลดหน้าใหม่อีกครั้ง'
              : 'เกิดข้อผิดพลาดระหว่างแสดงหน้านี้'}
          </p>
          <code className="err-msg">{String(error?.message || error).slice(0, 300)}</code>
          <div className="err-actions">
            <button type="button" className="go" onClick={() => location.reload()}>
              <RefreshCw size={16} /> โหลดหน้าใหม่
            </button>
            <a className="more" href="#/" onClick={() => this.setState({ error: null })}>
              <ArrowLeft size={15} /> กลับเมนู
            </a>
          </div>
        </section>
      </div>
    )
  }
}
