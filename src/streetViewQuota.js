import { claimQuota, STREET_VIEW_MONTHLY_LIMIT } from './mapsQuota'

// Street View uses the shared monthly counter in mapsQuota.js (both websites count together).
export { STREET_VIEW_MONTHLY_LIMIT }

/** Count one Street View panorama -> { ok, used, limit }. Rejects when the counter can't be reached. */
export const claimStreetView = () => claimQuota('sv')
