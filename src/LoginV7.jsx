import { useState } from 'react'
import { Mail, Lock, Eye, EyeOff } from 'lucide-react'
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from 'firebase/auth'
import { auth } from './firebase'
import { useTilt, ripple } from './useTilt'

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

// After a successful sign-in, App.jsx sees the new user and switches to the home page.
export default function LoginV7() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [remember, setRemember] = useState(true)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState(null)
  const { stage, card } = useTilt()

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
    } catch (err) {
      setMsg({ type: 'err', text: explain(err.code) })
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

  return (
    <div className="stage" ref={stage}>
      <form className="card in" ref={card} onSubmit={submit} noValidate>
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
      </form>
    </div>
  )
}
