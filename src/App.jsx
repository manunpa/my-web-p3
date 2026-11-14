import { useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from './firebase'
import LoginV7 from './LoginV7'
import Home from './Home'
import { saveUser } from './saveUser'

// Signed out -> login page. Signed in -> home page.
export default function App() {
  const [user, setUser] = useState(undefined) // undefined = still checking
  const [, setTick] = useState(0)

  // Runs on every sign-in, sign-up (email, Google, Apple) and page reload while signed in.
  useEffect(() => onAuthStateChanged(auth, (u) => {
    setUser(u)
    if (u) saveUser(u)
  }), [])

  // A new account's display name is saved just after it is created; re-render so Home shows it.
  const refresh = () => setTick((t) => t + 1)

  if (user === undefined) return <div className="stage" />
  return user ? <Home user={user} /> : <LoginV7 onProfileUpdated={refresh} />
}
