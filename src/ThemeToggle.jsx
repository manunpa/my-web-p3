import { Moon, Sun } from 'lucide-react'
import { useTheme, setPrefs, modeOf } from './themePrefs'

// Quick light / dark switch in the corner of every page. The full choice (themes, custom colors)
// is on the Settings page (#/settings). Custom colors set light or dark from their own background,
// so the switch is hidden while they are in use.
export default function ThemeToggle() {
  const { prefs } = useTheme()
  if (prefs.preset === 'custom') return null
  const now = modeOf(prefs)
  const next = now === 'light' ? 'dark' : 'light'
  return (
    <button type="button" className="theme-btn" onClick={() => setPrefs((p) => ({ ...p, mode: next }))}
      aria-label={next === 'light' ? 'เปลี่ยนเป็นโทนสว่าง' : 'เปลี่ยนเป็นโทนมืด'} title={next === 'light' ? 'โทนสว่าง' : 'โทนมืด'}>
      {now === 'light' ? <Moon size={15} /> : <Sun size={15} />}
    </button>
  )
}
