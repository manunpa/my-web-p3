import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { auth } from './firebase'
import LoginV7 from './LoginV7'
import VerifyEmail from './VerifyEmail'
import Home from './Home'
import Dashboard from './Dashboard'
import HelpDashboard from './HelpDashboard'
import AdasDashboard from './AdasDashboard'
import BehaviorDashboard from './BehaviorDashboard'
import NotificationsPage from './NotificationsPage'
import SessionTimer from './SessionTimer'
import ThemeToggle from './ThemeToggle'
import PageErrorBoundary from './PageErrorBoundary'
import { saveUser } from './saveUser'

// The map page pulls in the map libraries, so it is only downloaded when opened.
const MapsPage = lazy(() => import('./MapsPage'))
const DocumentsPage = lazy(() => import('./DocumentsPage'))
const ReportsPage = lazy(() => import('./ReportsPage'))

// How long a sign-in lasts before the user is signed out automatically.
// Keep in sync with duration.value(30, 'm') in firestore.rules.
const SESSION_MS = 30 * 60 * 1000

// Protected pages, by hash: '#/' -> Home. Add new pages here, e.g. '/profile': Profile,
// and link to them with href="#/profile". Every page in this list requires sign-in.
const ROUTES = {
  '/': Home,
  '/dashboard': Dashboard,
  '/dashboard/help': HelpDashboard,
  '/dashboard/adas': AdasDashboard,
  '/dashboard/behavior': BehaviorDashboard,
  '/maps': MapsPage,
  '/documents': DocumentsPage,
  '/reports': ReportsPage,
  '/notifications': NotificationsPage, // opens PMS Desk
  '/notifications/pms': (props) => <NotificationsPage {...props} source="pms" />,
  '/notifications/pms2': (props) => <NotificationsPage {...props} source="pms2" />,
  '/notifications/ngv': (props) => <NotificationsPage {...props} source="ngv" />,
  '/notifications/ngv2': (props) => <NotificationsPage {...props} source="ngv2" />,
  '/notifications/ob': (props) => <NotificationsPage {...props} source="ob" />,
  '/notifications/ob2': (props) => <NotificationsPage {...props} source="ob2" />,
  '/notifications/ttt': (props) => <NotificationsPage {...props} source="ttt" />,
  '/notifications/ttt2': (props) => <NotificationsPage {...props} source="ttt2" />,
  '/notifications/bsrc': (props) => <NotificationsPage {...props} source="bsrc" />,
  '/notifications/bsrc2': (props) => <NotificationsPage {...props} source="bsrc2" />,
}

// "#/reports?r=leo-hotspots&p=30" -> "/reports": the part after "?" belongs to the page itself.
const currentRoute = () => location.hash.replace(/^#/, '').split('?')[0] || '/'

export default function App() {
  return (
    <>
      <ThemeToggle />
      <Screen />
    </>
  )
}

function Screen() {
  const [user, setUser] = useState(undefined) // undefined = still checking
  const [route, setRoute] = useState(currentRoute)
  const [verified, setVerified] = useState(null) // "uid:route" that passed the check
  const [deadline, setDeadline] = useState(null) // ms timestamp when the session ends
  const [notice, setNotice] = useState(null) // message shown on the login page
  const [, setTick] = useState(0)

  const end = useCallback(async (reason) => {
    setNotice(reason)
    await signOut(auth)
  }, [])

  // Runs on every sign-in, sign-up and page reload while signed in.
  useEffect(() => onAuthStateChanged(auth, (u) => {
    setUser(u)
    if (u) {
      setNotice(null)
      if (u.emailVerified) saveUser(u) // unverified accounts are saved by VerifyEmail once confirmed
    } else {
      setVerified(null)
      setDeadline(null)
    }
  }), [])

  useEffect(() => {
    const onHash = () => setRoute(currentRoute())
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  // Session length is measured from the moment the user actually signed in (auth_time in
  // the Firebase ID token), so reloading the page or reopening the tab does not reset it.
  useEffect(() => {
    if (!user) return
    let live = true
    user.getIdTokenResult()
      .then((r) => { if (live) setDeadline(new Date(r.authTime).getTime() + SESSION_MS) })
      .catch(() => end('Your session could not be verified. Please sign in again.'))
    return () => { live = false }
  }, [user, end])

  // Check with Firebase on every page change that the account is still valid
  // (not deleted, not disabled) before showing the page.
  useEffect(() => {
    if (!user) return
    let live = true
    const key = `${user.uid}:${route}`
    user.reload()
      .then(() => { if (live) setVerified(key) })
      .catch((err) => {
        if (!live) return
        if (err.code === 'auth/network-request-failed') setVerified(key) // offline: don't lock out
        else end('Your account could not be verified. Please sign in again.')
      })
    return () => { live = false }
  }, [user, route, end])

  // A new account's display name is saved just after it is created; re-render so Home shows it.
  const refresh = () => setTick((t) => t + 1)

  if (user === undefined) return <div className="stage" />
  if (!user) return <LoginV7 key={notice} notice={notice} onProfileUpdated={refresh} />
  // Email/password accounts must click the link in their email first (Google accounts are already verified).
  if (!user.emailVerified) return <VerifyEmail user={user} onVerified={refresh} onSignOut={() => end(null)} />
  if (verified !== `${user.uid}:${route}` || deadline === null) return <div className="stage" />

  const Page = ROUTES[route] ?? Home
  return (
    <>
      <SessionTimer
        deadline={deadline}
        onExpire={() => end('Your session expired after 30 minutes. Please sign in again.')}
      />
      <PageErrorBoundary key={route}>
        <Suspense fallback={<div className="stage" />}>
          <Page user={user} />
        </Suspense>
      </PageErrorBoundary>
    </>
  )
}
