import { useCallback, useEffect, useState } from 'react'
import { MailCheck } from 'lucide-react'
import { sendEmailVerification } from 'firebase/auth'
import { useTilt, ripple } from './useTilt'
import { saveUser } from './saveUser'

// Where the link in the email sends the user back to (this site).
export const verifyLinkSettings = () => ({ url: location.origin + location.pathname })

// Shown to email/password accounts until the user clicks the link in the verification email.
// Firestore rules also refuse unverified accounts, so skipping this page in DevTools gets nothing.
export default function VerifyEmail({ user, onVerified, onSignOut }) {
  const [busy, setBusy] = useState(null) // null | 'check' | 'send'
  const [msg, setMsg] = useState(null)
  const { stage, card } = useTilt()

  // Ask Firebase whether the email is verified now. `quiet` = automatic check, no messages.
  const check = useCallback(async (quiet) => {
    try {
      await user.reload()
      if (!user.emailVerified) {
        if (!quiet) setMsg({ type: 'err', text: 'Not verified yet. Click the link in the email first.' })
        return
      }
      await user.getIdToken(true) // new token carries email_verified, so Firestore lets the user in
      await saveUser(user)
      onVerified()
    } catch (err) {
      if (!quiet) setMsg({ type: 'err', text: 'Could not check right now. Try again.' })
      console.error(err)
    }
  }, [user, onVerified])

  // Check again automatically when the user comes back to this tab, and every 5 seconds.
  useEffect(() => {
    const onFocus = () => check(true)
    addEventListener('focus', onFocus)
    const id = setInterval(() => { if (!document.hidden) check(true) }, 5000)
    return () => { removeEventListener('focus', onFocus); clearInterval(id) }
  }, [check])

  const confirm = async (e) => {
    ripple(e)
    setBusy('check')
    setMsg(null)
    await check(false)
    setBusy(null)
  }

  const resend = async () => {
    setBusy('send')
    setMsg(null)
    try {
      await sendEmailVerification(user, verifyLinkSettings())
      setMsg({ type: 'ok', text: 'A new link is on its way. Check Spam if it is not in your inbox.' })
    } catch (err) {
      setMsg({
        type: 'err',
        text: err.code === 'auth/too-many-requests'
          ? 'Too many emails sent. Wait a few minutes and try again.'
          : 'Could not send the email. Try again.',
      })
    }
    setBusy(null)
  }

  return (
    <div className="stage" ref={stage}>
      <div className="card in" ref={card}>
        <MailCheck size={36} color="#facc15" />
        <h1>Verify your <b>Email</b></h1>
        <p className="sub">
          We sent a link to <b>{user.email}</b>. Open it to activate your account, then come back here.
          Check your Spam folder if you can't find it.
        </p>

        <button className="go" disabled={!!busy} onClick={confirm}>
          {busy === 'check' ? 'Checking…' : "I've verified my email"}
        </button>

        {msg && (
          <p role="alert" style={{ margin: '12px 0 0', fontSize: 12, color: msg.type === 'err' ? '#fca5a5' : '#86efac' }}>
            {msg.text}
          </p>
        )}

        <div className="soc" style={{ marginTop: 16 }}>
          <button type="button" disabled={!!busy} onClick={resend}>
            {busy === 'send' ? 'Sending…' : 'Resend email'}
          </button>
          <button type="button" disabled={!!busy} onClick={onSignOut}>
            Use another email
          </button>
        </div>
      </div>
    </div>
  )
}
