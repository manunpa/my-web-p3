import { useEffect, useRef, useState } from 'react'
import { Mail, Lock, Eye, EyeOff } from 'lucide-react'

export default function LoginV7() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const stage = useRef(null)
  const card = useRef(null)

  useEffect(() => {
    // staggered entrance
    ;[...card.current.children].forEach((c, i) => c.style.setProperty('--i', i))
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return

    // cursor glow + card tilt
    const move = (e) => {
      const c = card.current
      const r = c.getBoundingClientRect()
      const x = e.clientX - r.left
      const y = e.clientY - r.top
      stage.current.style.setProperty('--mx', e.clientX + 'px')
      stage.current.style.setProperty('--my', e.clientY + 'px')
      c.style.setProperty('--cx', x + 'px')
      c.style.setProperty('--cy', y + 'px')
      c.style.transform = `perspective(900px) rotateY(${(x / r.width - 0.5) * 6}deg) rotateX(${-(y / r.height - 0.5) * 6}deg)`
    }
    const rest = () => { card.current.style.transform = '' }
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
    setLoading(true)
    try {
      // TODO: call your real API (the server must verify the credentials)
      // await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
      await new Promise((r) => setTimeout(r, 1500))
    } finally {
      setLoading(false)
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
          <label><input type="checkbox" defaultChecked />Remember me</label>
          <a href="#forgot">Forgot password?</a>
        </div>

        <button className="go" disabled={loading} onClick={ripple}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>

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
