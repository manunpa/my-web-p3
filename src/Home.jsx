import { lazy, Suspense, useState } from 'react'
import {
  LayoutDashboard, Map as MapIcon, FileText, BarChart3, Settings, Bell, LogOut,
} from 'lucide-react'
import { signOut } from 'firebase/auth'
import { auth } from './firebase'
import { useTilt, ripple } from './useTilt'
import OrbitImages from './orbit-images/OrbitImages'

const MenuShards = lazy(() => import('./MenuShards'))

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

// The menu as planets circling the title on a tilted ring: hover stops them, drag spins them, click opens.
const ORBIT = LINKS.map(({ label, hint, icon: Icon }) => ({
  alt: `${label}: ${hint}`,
  node: (
    <span className="orb" title={hint}>
      <Icon size={22} />
      <strong>{label}</strong>
    </span>
  ),
}))
const open = (i) => { location.hash = LINKS[i].href }

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
      <Suspense fallback={null}><MenuShards /></Suspense>
      <main className="card wide in" ref={card}>
        <p className="sub">Signed in as {user.displayName ? `${name} · ${user.email}` : user.email}</p>

        <nav className="orbit-menu" aria-label="Main menu">
          <OrbitImages images={ORBIT} onItemClick={open} clickToFront={false}
            shape="ellipse" baseWidth={1000} radiusX={400} radiusY={200} itemSize={230} rotation={-10} depth={0.7}
            duration={45} hoverSpeed={0} hoverScale={1.1} itemRadius="50%" shadow={0}
            showPath pathColor="rgb(var(--glow) / .55)" pathWidth={2}
            centerContent={<h1 className="sun">SCC <b>Fleet</b></h1>} />
        </nav>

        <button type="button" className="out" onClick={logout} disabled={busy}>
          <LogOut size={15} /> {busy ? 'Signing out…' : 'Sign out'}
        </button>
      </main>
    </div>
  )
}
