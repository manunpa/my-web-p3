import { auth } from './firebase'

/* ------------------------------------------------------------------ */
/* Apps Script endpoints that only answer signed-in users               */
/* ------------------------------------------------------------------ */
// The script checks the Firebase ID token before reading the sheet, so the
// data is not open to anyone who finds the /exec URL. The token goes in a
// text/plain POST body: never in the URL, and no CORS preflight.
// The script answers { status: 'error', error: 'unauthorized' } for a bad or
// expired token; we then force a fresh token and try once more.

// `extra` is merged into the POST body (e.g. { source: 'notif-read', limit: 500 }).
export async function fetchProtectedJson(url, extra = {}) {
  await auth.authStateReady()
  const user = auth.currentUser
  if (!user) throw new Error('ยังไม่ได้เข้าสู่ระบบ')

  for (let attempt = 0; attempt < 2; attempt++) {
    const idToken = await user.getIdToken(attempt > 0)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...extra, idToken }),
      cache: 'no-store',
      redirect: 'follow',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    if (json && !Array.isArray(json) && json.status === 'error' && json.error === 'unauthorized') {
      if (attempt === 0) continue
      throw new Error(json.message || 'ไม่มีสิทธิ์เข้าถึงข้อมูล กรุณาล็อกอินใหม่')
    }
    return json
  }
}
