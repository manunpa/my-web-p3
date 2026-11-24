import { useEffect, useRef, useState } from 'react'
import { Clock } from 'lucide-react'

const WARN_MS = 5 * 60 * 1000

// 1:59:30 when an hour or more is left, 59:30 below that.
const fmt = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const p = (n) => String(n).padStart(2, '0')
  const h = Math.floor(s / 3600)
  return h ? `${h}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}` : `${Math.floor(s / 60)}:${p(s % 60)}`
}

// Shows the time left in the session and calls onExpire once when it reaches zero.
// Works from the deadline (not by counting ticks), so it stays correct when the tab
// sleeps in the background.
export default function SessionTimer({ deadline, onExpire }) {
  const [left, setLeft] = useState(() => deadline - Date.now())
  const fired = useRef(false)
  const expire = useRef(onExpire)
  expire.current = onExpire

  useEffect(() => {
    fired.current = false
    const tick = () => {
      const ms = deadline - Date.now()
      setLeft(ms)
      if (ms <= 0 && !fired.current) {
        fired.current = true
        expire.current()
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [deadline])

  return (
    <div className={`session${left <= WARN_MS ? ' warn' : ''}`} role="timer" aria-live="off"
      title="Time left before you are signed out automatically">
      <Clock size={14} />
      <span>Session {fmt(left)}</span>
    </div>
  )
}
