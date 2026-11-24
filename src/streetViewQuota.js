import { doc, runTransaction } from 'firebase/firestore'
import { db } from './firebase'

// Google gives 5,000 free Dynamic Street View panoramas a month. We stop at 4,500 to stay under it.
// If you change this number, change it in firestore.rules too (match /streetViewQuota/{month}).
export const STREET_VIEW_MONTHLY_LIMIT = 4500

// This month in Thailand as "YYYYMM" (the Firestore rules check the same thing).
const thisMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' })
  .format(new Date()).replaceAll('-', '').slice(0, 6)

/*
 * Count one Street View panorama for the whole website (all users share one counter).
 * Resolves { ok: true, used } when a panorama may be opened, or { ok: false, used } when this
 * month's limit is already reached. Rejects when Firestore can't be reached or the rule is not
 * published: the caller then does NOT open a panorama (it offers a link to Google Maps instead).
 */
export function claimStreetView() {
  const ref = doc(db, 'streetViewQuota', thisMonth())
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    const used = snap.exists() ? snap.data().count : 0
    if (used >= STREET_VIEW_MONTHLY_LIMIT) return { ok: false, used }
    tx.set(ref, { count: used + 1 })
    return { ok: true, used: used + 1 }
  })
}
