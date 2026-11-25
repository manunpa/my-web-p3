import { fetchProtectedJson } from './protectedFetch'

/*
 * One monthly counter of Google map loads and Street View panoramas, shared with the my-website-pm
 * site (both use the same Google key). It lives in an Apps Script (my-website-pm repo:
 * apps-script/maps-quota.gs), which checks the Firebase login of either site.
 * Google gives 10,000 free map loads and 5,000 Street View panoramas a month; the script stops at
 * the limits below. If you change them, change LIMITS in maps-quota.gs too.
 */
export const QUOTA_API_URL = 'https://script.google.com/macros/s/AKfycbymzE6rCfY5nP4uX4K96NH5sQ_nBKwpQ8tUscw3ubO3voQal5CGp38_bH1SltZl2elCnA/exec'
export const GOOGLE_MAPS_MONTHLY_LIMIT = 9000
export const STREET_VIEW_MONTHLY_LIMIT = 4500

/**
 * Count one use. kind: 'map' | 'sv'.
 * Resolves { ok, used, limit }: ok false = this month's limit is reached. Rejects when the counter
 * can't be reached (the caller then does not load Google).
 */
export async function claimQuota(kind) {
  const j = await fetchProtectedJson(QUOTA_API_URL, { kind })
  if (j?.status !== 'ok') throw new Error(j?.message || 'ตัวนับโควตาตอบกลับผิดรูปแบบ')
  return { ok: !!j.ok, used: j.used, limit: j.limit }
}

// A load that was counted but not used yet (the page closed before the map was created).
// It is handed to the next map instead of counting a second time.
let spare = null

export function takeGoogleMapLoad() {
  spare ??= claimQuota('map').catch((e) => { spare = null; throw e })
  return spare
}

// Call once the map was actually created (or the claim was refused).
export function consumeGoogleMapLoad() {
  spare = null
}
