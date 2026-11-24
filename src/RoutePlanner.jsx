import { useState } from 'react'
import { Route, X, ExternalLink, LocateFixed, Fuel } from 'lucide-react'
import { formatMin, OSRM_CREDIT } from './routing'
import { formatDist, fuelInk } from './mapsData'

const RADII = [2, 5, 10]
const SHOW = 25

/*
 * Route planner, folded away in the side panel (nothing extra on the map except the route line and
 * the fuel stations that are near it). Stops come from the "add to plan" button of a selected point;
 * the first stop is the start.
 */
export default function RoutePlanner({
  stops, open, onToggle, busy, hasMe, onAddMe, onRemove, onClear, onOptimize, onBuild, onFuel,
  route, along, radiusKm, googleLink, onPick, colorOf, fuelLoading,
}) {
  const [limit, setLimit] = useState(SHOW)
  const hasMeStop = stops.some((s) => s.id === 'me')
  return (
    <details className="planner" open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary><Route size={14} /> วางแผนเส้นทาง{stops.length ? ` (${stops.length} จุด)` : ''}</summary>
      <div className="planner-body">
        {stops.length === 0 && (
          <p className="muted planner-hint">
            กด "เพิ่มในแผน" ที่การ์ดของสถานีที่เลือก หรือเพิ่มตำแหน่งของฉันเป็นต้นทาง จุดแรกคือจุดเริ่ม แล้วดูเส้นทางรวมและปั๊มตามทางได้
          </p>
        )}
        <ol className="stops">
          {stops.map((s, i) => (
            <li key={`${s.id}-${i}`}>
              <span className="stop-n">{i + 1}</span>
              <span className="stop-name" title={s.name}>{s.name}</span>
              {route?.legs?.[i - 1] && <em className="stop-leg">{route.legs[i - 1].km.toFixed(1)} กม. · {formatMin(route.legs[i - 1].min)}</em>}
              <button type="button" className="x" onClick={() => onRemove(i)} aria-label={`เอา ${s.name} ออกจากแผน`}><X size={14} /></button>
            </li>
          ))}
        </ol>

        <div className="planner-actions">
          {hasMe && !hasMeStop && (
            <button type="button" className="more" onClick={onAddMe}><LocateFixed size={13} /> ตำแหน่งของฉันเป็นต้นทาง</button>
          )}
          <button type="button" className="more" disabled={busy || stops.length < 3} onClick={onOptimize}
            title="เรียงจุดที่ 2 เป็นต้นไปให้ขับรวมสั้นที่สุด (จุดแรกคงเป็นจุดเริ่ม)">เรียงให้สั้นสุด</button>
          <button type="button" className="more primary" disabled={busy || stops.length < 2} onClick={onBuild}>
            {busy ? 'กำลังคำนวณ…' : 'ดูเส้นทาง'}
          </button>
          <button type="button" className="more" disabled={busy || fuelLoading || !route} onClick={() => onFuel()}
            title={route ? 'หาปั๊มน้ำมันที่อยู่ใกล้เส้นทางนี้' : 'กด "ดูเส้นทาง" ก่อน'}>
            <Fuel size={13} /> {fuelLoading ? 'กำลังโหลดปั๊ม…' : 'ปั๊มตามเส้นทาง'}
          </button>
          {googleLink && (
            <a className="more" href={googleLink} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> เปิดใน Google Maps</a>
          )}
          {stops.length > 0 && <button type="button" className="more" onClick={onClear}>ล้างแผน</button>}
        </div>

        {route && (
          <p className="planner-sum">
            รวม <b>{route.km.toFixed(1)} กม.</b> · <b>{formatMin(route.min)}</b>
            <span className="muted"> (รถยนต์ ไม่รวมรถติด รถบรรทุกจะช้ากว่า) · เส้นทางจาก <a href={OSRM_CREDIT.url} target="_blank" rel="noopener noreferrer">{OSRM_CREDIT.name}</a></span>
          </p>
        )}

        {along && (
          <div className="planner-along">
            <div className="planner-radius" role="radiogroup" aria-label="ระยะห่างจากเส้นทาง">
              <span className="muted">ปั๊มห่างจากเส้นทางไม่เกิน</span>
              {RADII.map((r) => (
                <button key={r} type="button" role="radio" aria-checked={radiusKm === r} className={radiusKm === r ? 'on' : ''}
                  onClick={() => { setLimit(SHOW); onFuel(r) }}>{r} กม.</button>
              ))}
            </div>
            <p className="muted planner-count">
              {along.items.length === 0 ? 'ไม่พบปั๊มในระยะนี้ ลองขยายระยะ' : `พบ ${along.items.length} แห่ง เรียงตามลำดับตลอดเส้นทาง`}
            </p>
            <ul className="along">
              {along.items.slice(0, limit).map(({ p, offKm, atKm }) => (
                <li key={p.id}>
                  <button type="button" onClick={() => onPick(p)}>
                    <i className="fuel-dot" style={{ background: colorOf(p.supplier), color: fuelInk(colorOf(p.supplier)) }}>⛽</i>
                    <span className="pname">{p.supplier} · {p.name}</span>
                    <span className="pmeta">กม.ที่ {Math.round(atKm * along.scale)} · ห่างเส้นทาง {formatDist(offKm)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {limit < along.items.length && (
              <button type="button" className="more full" onClick={() => setLimit((l) => l + SHOW)}>แสดงเพิ่ม ({along.items.length - limit})</button>
            )}
          </div>
        )}
      </div>
    </details>
  )
}
