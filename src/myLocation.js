import { useCallback, useEffect, useRef, useState } from 'react'
import { distanceKm } from './mapsData'

// Moves a displayed position toward each new target over `dur` ms (ease-out), so the blue dot
// glides between GPS fixes instead of jumping. onFrame(pos, done) runs on every animation frame.
export function createGlide(onFrame, dur = 900) {
  let cur = null, from = null, to = null, t0 = 0, raf = 0
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - (1 - k) ** 3
    cur = { lat: from.lat + (to.lat - from.lat) * e, lng: from.lng + (to.lng - from.lng) * e }
    raf = k < 1 ? requestAnimationFrame(step) : 0
    onFrame(cur, k >= 1)
  }
  return {
    get pos() { return cur },
    set(p, animate) {
      cancelAnimationFrame(raf); raf = 0
      if (!cur || !animate || document.hidden) { cur = { lat: p.lat, lng: p.lng }; onFrame(cur, true); return }
      from = cur; to = { lat: p.lat, lng: p.lng }; t0 = performance.now()
      raf = requestAnimationFrame(step)
    },
    stop() { cancelAnimationFrame(raf); raf = 0; cur = null },
  }
}

export const geoErrorText = (err) => (err.code === 1
  ? 'ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง — เปิดสิทธิ์ "ตำแหน่ง" ให้เว็บนี้ในการตั้งค่าเบราว์เซอร์ แล้วลองใหม่'
  : err.code === 3 ? 'หาตำแหน่งนานเกินไป ลองใหม่อีกครั้ง หรือออกไปที่โล่ง'
    : 'หาตำแหน่งไม่สำเร็จ ตรวจสอบว่าเปิด GPS / Location ในมือถือแล้ว')

const MOVING_SPEED = 2.8 // m/s (~10 km/h): slower than this, the heading from GPS is noise
const JITTER_M = 4       // standing still: moves smaller than this are ignored
const JUMP_SPEED = 60    // m/s (~216 km/h): a jump faster than this is a bad fix

function toFix(pos) {
  const c = pos.coords
  const speed = c.speed != null && !Number.isNaN(c.speed) ? c.speed : null
  const heading = c.heading != null && !Number.isNaN(c.heading) ? c.heading : null
  return {
    lat: +c.latitude.toFixed(6), lng: +c.longitude.toFixed(6), acc: c.accuracy || 0,
    heading: speed !== null && speed >= MOVING_SPEED ? heading : null, speed, t: pos.timestamp || Date.now(),
  }
}

/*
 * "My location" button with three states, like the PM maps page:
 *   off -> find me once (on) -> follow live (follow) -> off
 * Following stops by itself when the page is hidden, so the battery is not drained unnoticed.
 */
export function useMyLocation({ onFound, onNote }) {
  const [me, setMe] = useState(null)
  const [mode, setMode] = useState('off') // off | busy | on | follow
  const watch = useRef(null)
  const meRef = useRef(null)
  const lastFix = useRef(0)
  const rejects = useRef(0)
  const cb = useRef({ onFound, onNote })
  cb.current = { onFound, onNote }
  const put = (v) => { meRef.current = v; setMe(v) }

  const stopWatch = () => {
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current)
    watch.current = null
  }

  const off = useCallback(() => { stopWatch(); put(null); setMode('off') }, [])

  const onWatch = (pos) => {
    const now = performance.now()
    if (now - lastFix.current < 1000) return // at most one update per second
    const f = toFix(pos), prev = meRef.current
    if (prev) {
      const m = distanceKm(prev, f) * 1000
      const dt = Math.max(0.2, (f.t - prev.t) / 1000)
      // A jump that is too fast is a bad fix - unless it happens 3 times in a row (left a tunnel).
      if (m / dt > JUMP_SPEED && m > Math.max(40, 2 * f.acc) && ++rejects.current < 3) return
      // Standing still: GPS wobble only updates the accuracy.
      if (m < JITTER_M && (f.speed === null || f.speed < 1)) {
        lastFix.current = now; rejects.current = 0
        put({ ...prev, acc: f.acc, heading: null, t: f.t })
        return
      }
    }
    lastFix.current = now; rejects.current = 0
    put(f)
  }

  const follow = () => {
    setMode('follow')
    lastFix.current = 0
    cb.current.onNote('เปิดติดตามตำแหน่งแบบเรียลไทม์ — กดปุ่มอีกครั้งเพื่อปิด (ใช้แบตมากขึ้น)')
    watch.current = navigator.geolocation.watchPosition(onWatch, (err) => {
      if (err.code === 3) return // this round timed out, wait for the next one
      stopWatch(); setMode('on'); cb.current.onNote(geoErrorText(err))
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 1000 })
  }

  const click = () => {
    if (!('geolocation' in navigator)) { cb.current.onNote('อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับการหาตำแหน่ง'); return }
    if (mode === 'busy') return
    if (mode === 'follow') { off(); cb.current.onNote('ปิดตำแหน่งของฉันแล้ว'); return }
    if (mode === 'on' && meRef.current) { follow(); return }
    setMode('busy')
    cb.current.onNote('กำลังหาตำแหน่งของคุณ…')
    navigator.geolocation.getCurrentPosition((pos) => {
      const f = toFix(pos)
      put(f)
      setMode('on')
      cb.current.onFound(f)
    }, (err) => {
      setMode('off')
      cb.current.onNote(geoErrorText(err))
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 })
  }

  useEffect(() => {
    const onVis = () => {
      if (!document.hidden || watch.current === null) return
      stopWatch(); setMode('on')
      cb.current.onNote('ปิดการติดตามตำแหน่งอัตโนมัติ (ออกจากหน้าจอ) — กดปุ่มเพื่อเริ่มใหม่')
    }
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); stopWatch() }
  }, [])

  return { me, mode, click, off }
}
