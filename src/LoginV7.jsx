import { useEffect, useRef, useState } from 'react'
import { Mail, Lock, Eye, EyeOff } from 'lucide-react'
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from 'firebase/auth'
import { auth } from './firebase'

const explain = (code) => {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.'
    case 'auth/invalid-email':
      return 'Enter a valid email address.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.'
    case 'auth/user-disabled':
      return 'This account has been disabled.'
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.'
    default:
      return 'Something went wrong. Try again.'
  }
}

export default function LoginV7() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [remember, setRemember] = useState(true)
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState(null)
  const [msg, setMsg] = useState(null)
  const stage = useRef(null)
  const card = useRef(null)

  // keep the signed-in user in sync (also restores the session on reload)
  useEffect(() => onAuthStateChanged(auth, (u) => setUser(u)), [])

  useEffect(() => {
    ;[...card.current.children].forEach((c, i) => c.style.setProperty('--i', i))
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const move = (e) => {
      const c = card.current
      if (!c) return
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

  const ripple = (e) => {
    const b = e.currentTarget
    const r = b.getBoundingClientRect()
    const s = document.createElement('span')
    s.className = 'rip'
    s.style.left = e.clientX - r.left + 'px'
    s.style.top = e.clientY - r.top + 'px'
    b.append(s)
    s.onanimationend = () => s.remove()
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!email || !password) {
      setMsg({ type: 'err', text: 'Enter your email and password.' })
      return
    }
    setLoading(true)
    setMsg(null)
    try {
      await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence)
      await signInWithEmailAndPassword(auth, email.trim(), password)
      setPassword('')
    } catch (err) {
      setMsg({ type: 'err', text: explain(err.code) })
    } finally {
      setLoading(false)
    }
  }

  const forgot = async (e) => {
    e.preventDefault()
    if (!email) {
      setMsg({ type: 'err', text: 'Type your email first, then click Forgot password.' })
      return
    }
    try {
      await sendPasswordResetEmail(auth, email.trim())
      setMsg({ type: 'ok', text: 'If this email has an account, a reset link is on its way.' })
    } catch (err) {
      setMsg({ type: 'err', text: explain(err.code) })
    }
  }

  const logout = async () => {
    await signOut(auth)
    setMsg(null)
  }

  return (
    <div className="stage" ref={stage}>
      <form className="card in" ref={card} onSubmit={submit} noValidate>
        {user ? (
          <>
            <h1>You’re <b>in</b></h1>
            <p className="sub">Signed in as {user.email}</p>
            <button type="button" className="go" onClick={(e) => { ripple(e); logout() }}>
              Sign out
            </button>
          </>
        ) : (
          <>
            <h1>Welcome <b>Back</b></h1>
            <p className="sub">Enter your credentials to access your secure account.</p>

            <label htmlFor="e">Email address</label>
            <div className="f">
              <Mail size={16} />
              <input id="e" type="email" placeholder="name@domain.com" autoComplete="email"
                value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>

            <label htmlFor="p">Password</label>
            <div className="f">
              <Lock size={16} />
              <input id="p" type={show ? 'text' : 'password'} placeholder="••••••••••" autoComplete="current-password"
                value={password} onChange={(e) => setPassword(e.target.value)} required />
              <button type="button" aria-label="Show or hide password" onClick={() => setShow(!show)}>
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            <div className="row">
              <label>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                Remember me
              </label>
              <a href="#forgot" onClick={forgot}>Forgot password?</a>
            </div>

            <button className="go" disabled={loading} onClick={ripple}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>

            {msg && (
              <p role="alert" style={{ margin: '12px 0 0', fontSize: 12, color: msg.type === 'err' ? '#fca5a5' : '#86efac' }}>
                {msg.text}
              </p>
            )}

            <div className="or">or continue with</div>
            <div className="soc">
              <button type="button">Google</button>
              <button type="button">Apple</button>
            </div>

            <p className="foot">Don’t have an account? <a href="#signup">Sign up</a></p>
          </>
        )}
      </form>
    </div>
  )
}
