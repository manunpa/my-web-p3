import { useEffect, useState } from 'react'
import AeroShards from './aero-shards/AeroShards'

// Drifting shards behind the sign-in card and the home menu, in the theme's colours. Needs WebGPU: without it (or with
// reduced motion) nothing is drawn and the usual page background shows.
const look = () => {
  const root = document.documentElement
  const css = getComputedStyle(root)
  const rgb = (name) => `rgb(${css.getPropertyValue(name).trim().split(/\s+/).join(',')})`
  const light = root.dataset.theme === 'light'
  return {
    lightMode: light,
    shardColor: rgb('--glow2'),
    accentColor: light ? css.getPropertyValue('--strong').trim() : rgb('--glow'),
  }
}

export default function MenuShards() {
  const [ok, setOk] = useState(() => !!navigator.gpu && !matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [colors, setColors] = useState(look)

  useEffect(() => {
    const watch = new MutationObserver(() => setColors(look()))
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] })
    setColors(look())
    return () => watch.disconnect()
  }, [])

  if (!ok) return null
  const phone = innerWidth < 700
  return (
    <AeroShards {...colors} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      count={phone ? 400 : 800} dpr={phone ? 1 : 1.5} speed={0.6} glow={0.25} depthOfField={0.6}
      grain={0} pulseOnClick={false} holdToGather={false} onError={(err) => { console.warn('shards off:', err.message); setOk(false) }} />
  )
}
