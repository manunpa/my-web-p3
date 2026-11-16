import { useState } from 'react'
import { Mail, Lock, Eye, EyeOff, User } from 'lucide-react'
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithPopup,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from 'firebase/auth'
import { auth } from './firebase'
import { useTilt, ripple } from './useTilt'
import { verifyLinkSettings } from './VerifyEmail'

const explain = (code) => {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.'
    case 'auth/invalid-email':
      return 'Enter a valid email address.'
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Sign in instead.'
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.'
    case 'auth/user-disabled':
      return 'This account has been disabled.'
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.'
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in window was closed before finishing.'
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in window. Allow pop-ups and try again.'
    case 'auth/account-exists-with-different-credential':
      return 'This email is already registered with another sign-in method.'
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled yet.'
    case 'auth/unauthorized-domain':
      return 'This website is not authorised for sign-in yet.'
    default:
      return 'Something went wrong. Try again.'
  }
}

// After a successful sign-in or sign-up, App.jsx sees the new user and switches to the home page.
// `onProfileUpdated` lets App re-render once the new account's display name is saved.
export default function LoginV7({ notice, onProfileUpdated }) {
  const [mode, setMode] = useState('in') // 'in' = sign in, 'up' = sign up
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [remember, setRemember] = useState(true)
  const [loading, setLoading] = useState(null) // null | 'form' | 'google'
  const [msg, setMsg] = useState(notice ? { type: 'err', text: notice } : null)
  const { stage, card } = useTilt()
  const signingUp = mode === 'up'

  const fail = (err) => {
    setMsg({ type: 'err', text: explain(err.code) })
    setLoading(null)
  }

  const switchMode = (e) => {
    ripple(e)
    setMode(signingUp ? 'in' : 'up')
    setMsg(null)
    setPassword('')
    setConfirm('')
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!email || !password || (signingUp && (!name.trim() || !confirm))) {
      setMsg({ type: 'err', text: 'Fill in every field.' })
      return
    }
    if (signingUp && password.length < 6) {
      setMsg({ type: 'err', text: explain('auth/weak-password') })
      return
    }
    if (signingUp && password !== confirm) {
      setMsg({ type: 'err', text: 'Passwords do not match.' })
      return
    }
    setLoading('form')
    setMsg(null)
    try {
      await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence)
      if (signingUp) {
        const { user } = await createUserWithEmailAndPassword(auth, email.trim(), password)
        await updateProfile(user, { displayName: name.trim() })
        // App then shows the "check your email" page; the user is saved to Firestore once verified.
        await sendEmailVerification(user, verifyLinkSettings()).catch((err) => console.error(err))
        onProfileUpdated?.()
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password)
      }
    } catch (err) {
      fail(err)
    }
  }

  // Works for both sign in and sign up: a first-time Google user gets a new account automatically.
  const google = async (e) => {
    ripple(e)
    setLoading('google')
    setMsg(null)
    try {
      await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence)
      await signInWithPopup(auth, new GoogleAuthProvider())
    } catch (err) {
      fail(err)
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
        {signingUp ? (
          <>
            <h1>Create <b>Account</b></h1>
            <p className="sub">Sign up to get access to your secure account.</p>
          </>
        ) : (
          <>
            <h1>Welcome <b>Back</b></h1>
            <p className="sub">Enter your credentials to access your secure account.</p>
          </>
        )}

        {signingUp && (
          <>
            <label htmlFor="n">Name</label>
            <div className="f">
              <User size={16} />
              <input id="n" type="text" placeholder="Your name" autoComplete="name"
                value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          </>
        )}

        <label htmlFor="e">Email address</label>
        <div className="f">
          <Mail size={16} />
          <input id="e" type="email" placeholder="name@domain.com" autoComplete="email"
            value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>

        <label htmlFor="p">Password</label>
        <div className="f">
          <Lock size={16} />
          <input id="p" type={show ? 'text' : 'password'}
            placeholder={signingUp ? 'At least 6 characters' : '••••••••••'}
            autoComplete={signingUp ? 'new-password' : 'current-password'}
            value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button type="button" aria-label="Show or hide password" onClick={() => setShow(!show)}>
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        {signingUp && (
          <>
            <label htmlFor="c">Confirm password</label>
            <div className="f">
              <Lock size={16} />
              <input id="c" type={show ? 'text' : 'password'} placeholder="Type it again" autoComplete="new-password"
                value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </div>
          </>
        )}

        <div className="row">
          <label>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember me
          </label>
          {!signingUp && <a href="#forgot" onClick={forgot}>Forgot password?</a>}
        </div>

        <button className="go" disabled={!!loading} onClick={ripple}>
          {loading === 'form'
            ? (signingUp ? 'Creating account…' : 'Signing in…')
            : (signingUp ? 'Create account' : 'Sign in')}
        </button>

        {msg && (
          <p role="alert" style={{ margin: '12px 0 0', fontSize: 12, color: msg.type === 'err' ? 'var(--err)' : 'var(--ok)' }}>
            {msg.text}
          </p>
        )}

        <div className="or">or continue with</div>
        <div className="soc">
          <button type="button" disabled={!!loading} onClick={google}>
            {loading === 'google' ? 'Opening…' : 'Google'}
          </button>
          <button type="button" disabled={!!loading} onClick={switchMode}>
            {signingUp ? 'Sign in' : 'Sign up'}
          </button>
        </div>
      </form>
    </div>
  )
}
