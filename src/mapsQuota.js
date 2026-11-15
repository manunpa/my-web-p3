import { doc, runTransaction } from 'firebase/firestore'
import { db } from './firebase'

// Google gives 10,000 free map loads a month. 300 a day x 31 days = 9,300, so we never go over.
// If you change this number, change it in firestore.rules too (match /mapsQuota/{day}).
export const GOOGLE_MAPS_DAILY_LIMIT = 300

// Today's date in Thailand as "YYYYMMDD" (the Firestore rules check the same thing).
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' })
  .format(new Date()).replaceAll('-', '')

/*
 * Count one Google map load for the whole website (all users share the same counter).
 * Resolves { ok: true, used } when the map may be created, or { ok: false, used } when
 * today's limit is already reached. Rejects if Firestore can't be reached.
 */
async function claim() {
  const ref = doc(db, 'mapsQuota', today())
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    const used = snap.exists() ? snap.data().count : 0
    if (used >= GOOGLE_MAPS_DAILY_LIMIT) return { ok: false, used }
    tx.set(ref, { count: used + 1 })
    return { ok: true, used: used + 1 }
  })
}

// A load that was counted but not used yet (the page closed before the map was created).
// It is handed to the next map instead of counting a second time.
let spare = null

export function takeGoogleMapLoad() {
  spare ??= claim().catch((e) => { spare = null; throw e })
  return spare
}

// Call once the map was actually created (or the claim was refused).
export function consumeGoogleMapLoad() {
  spare = null
}
