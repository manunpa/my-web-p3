import { useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from './firebase'
import LoginV7 from './LoginV7'
import Home from './Home'

// Signed out -> login page. Signed in -> home page.
export default function App() {
  const [user, setUser] = useState(undefined) // undefined = still checking

  useEffect(() => onAuthStateChanged(auth, setUser), [])

  if (user === undefined) return <div className="stage" />
  return user ? <Home user={user} /> : <LoginV7 />
}
