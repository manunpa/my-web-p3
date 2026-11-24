import { useEffect, useState } from 'react'
import GlowCursor from './glow-cursor/GlowCursor'

// Glowing trail behind the sign-in card, in the theme's own colour. Without WebGL2 (or with
// reduced motion) nothing is drawn here and the CSS glow of .stage::before stays.
const supported = () => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  const gl = document.createElement('canvas').getContext('webgl2')
  const ok = !!gl?.getExtension('EXT_color_buffer_float')
  gl?.getExtension('WEBGL_lose_context')?.loseContext()
  return ok
}

const look = () => {
  const root = document.documentElement
  const css = getComputedStyle(root)
  const light = root.dataset.theme === 'light'
  const color = light
    ? css.getPropertyValue('--strong').trim()
    : `rgb(${css.getPropertyValue('--glow').trim().split(/\s+/).join(',')})`
  return {
    theme: light ? 'light' : 'dark', color,
    intensity: light ? 0.7 : 0.65, hotspot: 0.3, glow: 0.8, trailWidth: 2.5,
  }
}

export default function LoginGlow() {
  const [ok] = useState(supported)
  const [style, setStyle] = useState(look)

  useEffect(() => {
    const watch = new MutationObserver(() => setStyle(look()))
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] })
    setStyle(look())
    return () => watch.disconnect()
  }, [])

  if (!ok) return null
  return (
    <GlowCursor className="login-glow" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      {...style} linger={1.1} quality="medium" maxDevicePixelRatio={1.5} />
  )
}
