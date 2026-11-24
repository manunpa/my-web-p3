import { fetchProtectedJson } from './protectedFetch'

// Archive sheet for exported plans -> apps-script/plan-archive.gs. Answers signed-in users only.
// '' = the Excel button only downloads the file.
export const PLAN_ARCHIVE_URL =
  'https://script.google.com/macros/s/AKfycbzmoAP--0zHwGEmFoghz7D12kOF_16sC9l2mk_41XQhn3-Pf2B5mqM5gUpwYOOFqGgIpA/exec'

// Same plan -> same id, so pressing the button twice does not store the plan twice.
export function batchId(rows) {
  const s = JSON.stringify(rows)
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0
  }
  return `p${h1.toString(36)}${h2.toString(36)}`
}

// rows: the 13-column plan rows exactly as exported. Returns { saved, duplicate } or throws.
export async function archivePlan(rows, files) {
  const json = await fetchProtectedJson(PLAN_ARCHIVE_URL, {
    source: 'plan-save',
    batch: batchId(rows),
    files,
    rows: rows.map((r) => r.map((v) => (v instanceof Date ? v.toISOString() : v ?? ''))),
  })
  if (!json || json.status === 'error' || !json.ok) throw new Error((json && (json.message || json.error)) || 'บันทึกไม่สำเร็จ')
  return json
}
