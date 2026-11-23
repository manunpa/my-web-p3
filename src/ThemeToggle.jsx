import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'

// Light (default) or dark gold. Only an explicit choice is saved; with none saved the page is light.
// index.html applies the same rule before the page paints.
const KEY = 'theme'

export function applyTheme(theme) {
  if (theme === 'light') document.documentElement.dataset.theme = 'light'
  else delete document.documentElement.dataset.theme
}

const saved = () => {
  try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light' } catch { return 'light' }
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState(saved)
  const next = theme === 'light' ? 'dark' : 'light'
  const toggle = () => {
    applyTheme(next)
    setTheme(next)
    try { localStorage.setItem(KEY, next) } catch { /* private mode: still switches for this visit */ }
  }
  return (
    <button type="button" className="theme-btn" onClick={toggle}
      aria-label={next === 'light' ? 'เปลี่ยนเป็นโทนสว่าง' : 'เปลี่ยนเป็นโทนมืด'} title={next === 'light' ? 'โทนสว่าง' : 'โทนมืดทอง'}>
      {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
    </button>
  )
}
