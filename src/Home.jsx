import { useState } from 'react'
import {
  LayoutDashboard, Map as MapIcon, FileText, BarChart3, Settings, Bell, ChevronRight, LogOut,
} from 'lucide-react'
import { signOut } from 'firebase/auth'
import { auth } from './firebase'
import { useTilt, ripple } from './useTilt'

// Edit this list to add, remove or rename buttons.
// `href` is where the button goes; '#' means the page is not built yet.
const LINKS = [
  { label: 'Dashboard', hint: 'Overview at a glance', icon: LayoutDashboard, href: '#/dashboard' },
  { label: 'Maps API', hint: 'Customer station map', icon: MapIcon, href: '#/maps' },
  { label: 'Documents', hint: 'Plan file converter', icon: FileText, href: '#/documents' },
  { label: 'Reports', hint: 'Report tables & export', icon: BarChart3, href: '#/reports' },
  { label: 'Notifications', hint: 'Latest updates', icon: Bell, href: '#/notifications' },
  { label: 'Settings', hint: 'Theme & colors', icon: Settings, href: '#/settings' },
]

export default function Home({ user }) {
  const { stage, card } = useTilt()
  const [busy, setBusy] = useState(false)
  const name = user.displayName || user.email.split('@')[0]

  const logout = async (e) => {
    ripple(e)
    setBusy(true)
    try {
      await signOut(auth)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stage" ref={stage}>
      <main className="card wide in" ref={card}>
        <h1>SCC <b>Fleet</b></h1>
        <p className="sub">Signed in as {user.displayName ? `${name} · ${user.email}` : user.email}</p>

        <nav className="tiles" aria-label="Main menu">
          {LINKS.map(({ label, hint, icon: Icon, href }, i) => (
            <a key={label} className="tile" href={href} onClick={ripple} style={{ '--i': i + 2 }}>
              <span className="ic"><Icon size={18} /></span>
              <span className="tx">
                <strong>{label}</strong>
                <small>{hint}</small>
              </span>
              <ChevronRight size={16} className="ar" />
            </a>
          ))}
        </nav>

        <button type="button" className="out" onClick={logout} disabled={busy}>
          <LogOut size={15} /> {busy ? 'Signing out…' : 'Sign out'}
        </button>
      </main>
    </div>
  )
}
