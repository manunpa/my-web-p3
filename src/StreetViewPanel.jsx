import { useEffect, useRef, useState } from 'react'
import { X, ExternalLink } from 'lucide-react'
import { preloadGoogleMaps, googleAuthFailed, watchGoogleAuth } from './GoogleMap'
import { claimStreetView, STREET_VIEW_MONTHLY_LIMIT } from './streetViewQuota'
import { streetViewLink } from './mapsData'

const nf = new Intl.NumberFormat('th-TH')

/*
 * Street View inside the map area. Opening one panorama counts once against our monthly limit
 * (Google bills Dynamic Street View per panorama opened; looking around afterwards is free).
 * The count is taken BEFORE the panorama is created. If the limit is reached, Google refuses the
 * key, or the count cannot be taken, no panorama is opened and a link to Google's own Street View
 * page is shown instead (free, not counted).
 *
 * `at` is { lat, lng, name?, key }: a new key opens (and counts) a new panorama.
 */
export default function StreetViewPanel({ at, onClose }) {
  const box = useRef(null)
  const [state, setState] = useState({ status: 'loading' }) // loading | ready | limit | blocked | nopano
  const link = streetViewLink(at)

  useEffect(() => {
    let alive = true
    let pano = null
    setState({ status: 'loading' })
    ;(async () => {
      let claim
      try {
        claim = await claimStreetView()
      } catch {
        if (alive) setState({ status: 'blocked', why: 'นับโควต้า Street View ไม่สำเร็จ จึงยังไม่เปิดภาพในหน้านี้ (เพื่อไม่ให้เกินโควต้าฟรี)' })
        return
      }
      if (!alive) return
      if (!claim.ok) { setState({ status: 'limit', used: claim.used }); return }
      if (googleAuthFailed()) { setState({ status: 'blocked', why: 'Google Maps ใช้ไม่ได้ (key ถูกปฏิเสธ)' }); return }
      try {
        const gm = await preloadGoogleMaps()
        if (!alive) return
        pano = new gm.StreetViewPanorama(box.current, {
          position: { lat: at.lat, lng: at.lng },
          pov: { heading: 0, pitch: 0 },
          zoom: 1,
          addressControl: false, fullscreenControl: false, motionTracking: false, motionTrackingControl: false,
          clickToGo: true, linksControl: true, panControl: true, zoomControl: true, enableCloseButton: false,
        })
        pano.addListener('status_changed', () => {
          if (alive && pano.getStatus() === 'ZERO_RESULTS') setState({ status: 'nopano', used: claim.used })
        })
        setState({ status: 'ready', used: claim.used })
      } catch (e) {
        if (alive) setState({ status: 'blocked', why: e.message || 'โหลด Google Maps ไม่สำเร็จ' })
      }
    })()
    const off = watchGoogleAuth(() => alive && setState({ status: 'blocked', why: 'Google Maps ใช้ไม่ได้ (key ถูกปฏิเสธ)' }))
    return () => { alive = false; off(); pano?.setVisible(false) }
  }, [at.key]) // eslint-disable-line react-hooks/exhaustive-deps

  const showMsg = state.status !== 'ready' && state.status !== 'loading'
  return (
    <div className="sv-panel" role="dialog" aria-label="Street View">
      <div className="sv-head">
        <button type="button" className="x" onClick={onClose} aria-label="ปิด Street View"><X size={18} /></button>
        <strong>Street View</strong>
        <span className="sv-name">{at.name || `${at.lat.toFixed(5)}, ${at.lng.toFixed(5)}`}</span>
        <a className="sv-link" href={link} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> เปิดบน Google Maps</a>
      </div>
      <div className="sv-body">
        <div ref={box} className="sv-canvas" hidden={showMsg} />
        {state.status === 'loading' && <div className="sv-msg">กำลังโหลด Street View…</div>}
        {showMsg && (
          <div className="sv-msg">
            {state.status === 'limit' && (
              <>
                <strong>เดือนนี้ใช้ Street View ในหน้านี้ครบ {nf.format(STREET_VIEW_MONTHLY_LIMIT)} ครั้งแล้ว</strong>
                <span>จำกัดไว้เพื่อไม่ให้เกินโควต้าฟรีของ Google นับใหม่ต้นเดือนหน้า ระหว่างนี้เปิดดูบน Google Maps ได้ฟรี</span>
              </>
            )}
            {state.status === 'blocked' && (
              <>
                <strong>ยังเปิด Street View ในหน้านี้ไม่ได้</strong>
                <span>{state.why}</span>
              </>
            )}
            {state.status === 'nopano' && (
              <>
                <strong>ไม่มีภาพ Street View ตรงจุดนี้</strong>
                <span>ลองดูบน Google Maps ซึ่งอาจมีภาพใกล้เคียง</span>
              </>
            )}
            <a className="more" href={link} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> เปิด Street View บน Google Maps</a>
          </div>
        )}
      </div>
      {state.status === 'ready' && (
        <div className="sv-foot">เดือนนี้เปิดไปแล้ว {nf.format(state.used)} / {nf.format(STREET_VIEW_MONTHLY_LIMIT)} ครั้ง (ทุกคนรวมกัน)</div>
      )}
    </div>
  )
}
