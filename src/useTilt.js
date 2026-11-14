import { useEffect, useRef } from 'react'

// Shared background glow + card tilt effect used by every page.
export function useTilt() {
  const stage = useRef(null)
  const card = useRef(null)

  useEffect(() => {
    ;[...card.current.children].forEach((c, i) => c.style.setProperty('--i', i))
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const move = (e) => {
      const c = card.current
      if (!c || !stage.current) return
      const r = c.getBoundingClientRect()
      const x = e.clientX - r.left
      const y = e.clientY - r.top
      stage.current.style.setProperty('--mx', e.clientX + 'px')
      stage.current.style.setProperty('--my', e.clientY + 'px')
      c.style.setProperty('--cx', x + 'px')
      c.style.setProperty('--cy', y + 'px')
      c.style.transform = `perspective(900px) rotateY(${(x / r.width - 0.5) * 6}deg) rotateX(${-(y / r.height - 0.5) * 6}deg)`
    }
    const rest = () => { if (card.current) card.current.style.transform = '' }
    addEventListener('pointermove', move)
    addEventListener('pointerup', rest)
    document.addEventListener('pointerleave', rest)
    return () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', rest)
      document.removeEventListener('pointerleave', rest)
    }
  }, [])

  return { stage, card }
}

export function ripple(e) {
  const b = e.currentTarget
  const r = b.getBoundingClientRect()
  const s = document.createElement('span')
  s.className = 'rip'
  s.style.left = e.clientX - r.left + 'px'
  s.style.top = e.clientY - r.top + 'px'
  b.append(s)
  s.onanimationend = () => s.remove()
}
