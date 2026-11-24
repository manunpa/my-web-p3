// How the site looks for each user: light / dark mode, a ready-made theme or free custom colors.
// Only looks: nothing here touches data or how the system works.
//
// The team theme (gold on black / gold on white) is the CSS in style.css itself. Every other theme is
// a set of CSS variables put on <html>, worked out from a few colors by themeVars().
// The choice is kept per account in Firestore (users/{uid}.prefs) and copied to this device, so the
// page can paint in the right colors before anyone has signed in (see index.html).
import { useSyncExternalStore } from 'react'
import { doc, getDoc, getDocFromServer, setDoc } from 'firebase/firestore'
import { db } from './firebase'

export const DEFAULT_PREFS = Object.freeze({ v: 1, mode: 'light', preset: 'team', custom: null })
export const MODES = [['light', 'สว่าง'], ['dark', 'มืด'], ['system', 'ตามเครื่อง']]
export const GLASS_DEFAULT = { dark: 62, light: 80 } // card opacity (%) when custom glass is left on auto

// Ready-made themes. bg: page background for each mode. The team theme uses the CSS as written.
export const PRESETS = [
  { id: 'team', name: 'ทอง', note: 'ค่าเริ่มต้นของทีม', accent: '#facc15', bg: { dark: '#07070a', light: '#f7f4ec' } },
  { id: 'midnight', name: 'ฟ้ามิดไนต์', accent: '#3b82f6', bg: { dark: '#060912', light: '#f1f5fb' } },
  { id: 'forest', name: 'เขียวป่า', accent: '#22c55e', bg: { dark: '#050a07', light: '#f1f7f2' } },
  { id: 'rose', name: 'ชมพูกุหลาบ', accent: '#f43f5e', bg: { dark: '#0c0608', light: '#fbf2f4' } },
  { id: 'violet', name: 'ม่วงลาเวนเดอร์', accent: '#8b5cf6', bg: { dark: '#08060f', light: '#f5f2fc' } },
  { id: 'sunset', name: 'ส้มพระอาทิตย์ตก', accent: '#f97316', bg: { dark: '#0b0604', light: '#fbf3ec' } },
  { id: 'ocean', name: 'ฟ้าทะเล', accent: '#06b6d4', bg: { dark: '#04090b', light: '#eff8f9' } },
  { id: 'graphite', name: 'เทากราไฟต์', accent: '#a1a1aa', bg: { dark: '#0a0a0b', light: '#f4f4f5' } },
]
const presetOf = (id) => PRESETS.find((p) => p.id === id) || PRESETS[0]

/* ---------- color math ---------- */

const HEX = /^#[0-9a-f]{6}$/i
export const isHex = (s) => HEX.test(String(s || ''))
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const hexOf = (c) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`
export const mix = (a, b, t) => { const x = rgbOf(a), y = rgbOf(b); return hexOf(x.map((v, i) => v + (y[i] - v) * t)) }
const triple = (h) => rgbOf(h).join(' ')
const rgba = (h, a) => `rgba(${rgbOf(h).join(',')},${a})`
function luminance(h) {
  const [r, g, b] = rgbOf(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
export const isLightColor = (h) => luminance(h) > 0.4
// Moves `color` toward `toward` until it reads on `bg` (WCAG 4.5:1 for text), keeping its hue as long as possible.
export function readable(color, bg, toward, min = 4.5) {
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const c = mix(color, toward, t)
    if (contrast(c, bg) >= min) return c
  }
  return toward
}

/* ---------- theme -> CSS variables ---------- */

export const VAR_NAMES = [
  '--bg', '--card', '--line', '--text', '--muted', '--gold', '--field', '--ink', '--gold-text', '--glow', '--glow2', '--shade',
  '--surface', '--surface-2', '--bg-a', '--bg-b', '--bg-c', '--map-bg', '--opt-bg', '--dot-ring', '--strong',
]

// mode 'dark' | 'light'. colors: { accent, bg, text?, card?, glass? } -> { '--bg': ..., ... }
export function themeVars(mode, { accent, bg, text, card, glass }) {
  const dark = mode === 'dark'
  const ink0 = dark ? '#ffffff' : '#1c1917'
  const fg = isHex(text) ? text : readable(ink0, bg, dark ? '#ffffff' : '#000000', 7)
  const alpha = (Number(glass) || GLASS_DEFAULT[mode]) / 100
  const cardBase = isHex(card) ? card : dark ? mix(bg, '#ffffff', 0.09) : '#ffffff'
  const accentOnBg = readable(accent, bg, fg)
  const onAccent = contrast(accent, '#111111') >= contrast(accent, '#ffffff') ? mix(accent, '#000000', 0.9) : '#ffffff'
  return {
    '--bg': bg,
    '--card': rgba(cardBase, alpha),
    '--line': rgba(fg, dark ? 0.12 : 0.14),
    '--text': fg,
    '--muted': readable(mix(fg, bg, dark ? 0.38 : 0.3), bg, fg),
    '--gold': accent,
    '--field': dark ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.75)',
    '--ink': onAccent,
    '--gold-text': accentOnBg,
    '--glow': triple(accent),
    '--glow2': triple(dark ? mix(accent, '#000000', 0.3) : mix(accent, '#ffffff', 0.15)),
    '--shade': dark ? '0 0 0' : triple(mix(accent, '#000000', 0.7)),
    '--surface': triple(mix(bg, '#ffffff', 0.02)),
    '--surface-2': triple(mix(bg, '#ffffff', 0.05)),
    '--bg-a': dark ? mix(bg, '#000000', 0.3) : mix(bg, '#ffffff', 0.4),
    '--bg-b': mix(bg, accent, dark ? 0.12 : 0.06),
    '--bg-c': mix(bg, accent, dark ? 0.18 : 0.06),
    '--map-bg': dark ? mix(bg, '#ffffff', 0.05) : mix(bg, '#000000', 0.07),
    '--opt-bg': dark ? mix(bg, '#ffffff', 0.08) : '#ffffff',
    '--dot-ring': dark ? mix(bg, '#ffffff', 0.06) : '#ffffff',
    '--strong': dark ? mix(accent, '#ffffff', 0.25) : mix(accent, '#000000', 0.2),
  }
}

// Accent fills (selected buttons, chart lines) need less than text; the team's own light gold is 1.7:1.
const ACCENT_MIN = 1.5

// Text that would be hard to read with these custom colors: [{ label, ratio }]
export function readabilityIssues(c) {
  const mode = isLightColor(c.bg) ? 'light' : 'dark'
  const v = themeVars(mode, c)
  const out = []
  const check = (label, fg, bg, min) => { const r = contrast(fg, bg); if (r < min) out.push({ label, ratio: r }) }
  if (isHex(c.text)) check('ตัวอักษรบนพื้นหลัง', c.text, c.bg, 4.5)
  if (isHex(c.text) && isHex(c.card)) check('ตัวอักษรบนการ์ด', c.text, c.card, 4.5)
  check('สีเน้นบนพื้นหลัง (เส้นกราฟ ปุ่มที่เลือก)', c.accent, c.bg, ACCENT_MIN)
  if (v['--gold-text'] !== c.accent && contrast(c.accent, c.bg) < 3) out.push({ label: 'ลิงก์และหัวข้อสีเน้น (ระบบปรับให้เข้มขึ้นแล้ว)', ratio: contrast(c.accent, c.bg), auto: true })
  return out
}
// Fixes the custom colors the user chose so that text reads (only the parts that fail).
export function fixReadability(c) {
  const dark = !isLightColor(c.bg)
  const out = { ...c }
  if (isHex(out.text) && contrast(out.text, out.bg) < 4.5) out.text = readable(out.text, out.bg, dark ? '#ffffff' : '#000000')
  if (isHex(out.text) && isHex(out.card) && contrast(out.text, out.card) < 4.5) out.card = readable(out.card, out.text, dark ? '#000000' : '#ffffff')
  if (contrast(out.accent, out.bg) < ACCENT_MIN) out.accent = readable(out.accent, out.bg, dark ? '#ffffff' : '#000000', ACCENT_MIN + 0.3)
  return out
}

/* ---------- prefs: check, resolve, apply ---------- */

export function sanitize(p) {
  if (!p || typeof p !== 'object') return { ...DEFAULT_PREFS }
  const mode = MODES.some(([m]) => m === p.mode) ? p.mode : DEFAULT_PREFS.mode
  let preset = PRESETS.some((x) => x.id === p.preset) || p.preset === 'custom' ? p.preset : 'team'
  let custom = null
  if (p.custom && isHex(p.custom.accent) && isHex(p.custom.bg)) {
    const g = Math.round(Number(p.custom.glass) || 0)
    custom = {
      accent: p.custom.accent.toLowerCase(), bg: p.custom.bg.toLowerCase(),
      text: isHex(p.custom.text) ? p.custom.text.toLowerCase() : '', card: isHex(p.custom.card) ? p.custom.card.toLowerCase() : '',
      glass: g >= 30 && g <= 100 ? g : 0,
    }
  }
  if (preset === 'custom' && !custom) preset = 'team'
  return { v: 1, mode, preset, custom }
}
export const isDefault = (p) => p.preset === 'team' && p.mode === DEFAULT_PREFS.mode && !p.custom

const systemDark = () => !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches)
// Custom colors decide light / dark from the background; otherwise the chosen mode (or the device's).
export function modeOf(p) {
  if (p.preset === 'custom' && p.custom) return isLightColor(p.custom.bg) ? 'light' : 'dark'
  if (p.mode === 'system') return systemDark() ? 'dark' : 'light'
  return p.mode
}
// The CSS variables for prefs, or null for the team theme (style.css as written).
export function varsOf(p) {
  const mode = modeOf(p)
  if (p.preset === 'custom' && p.custom) return themeVars(mode, p.custom)
  if (p.preset === 'team') return null
  const t = presetOf(p.preset)
  return themeVars(mode, { accent: t.accent, bg: t.bg[mode] })
}

const LS_PREFS = 'themePrefs' // { prefs, uid } — the last choice on this device and whose it is
const LS_PAINT = 'themePaint' // { mode, vars } — read by index.html before the page paints
const LS_LEGACY = 'theme' // old toggle: 'dark' | 'light'

function applyToPage(p) {
  const root = document.documentElement
  const mode = modeOf(p)
  if (mode === 'light') root.dataset.theme = 'light'
  else delete root.dataset.theme
  const vars = varsOf(p)
  for (const k of VAR_NAMES) {
    if (vars) root.style.setProperty(k, vars[k])
    else root.style.removeProperty(k)
  }
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', vars ? vars['--bg'] : mode === 'light' ? '#f7f4ec' : '#07070a')
  try {
    localStorage.setItem(LS_PAINT, JSON.stringify({ mode, vars }))
    localStorage.setItem(LS_LEGACY, mode) // keeps an older cached page in step
  } catch { /* private mode */ }
}

/* ---------- store: one current choice for the whole page ---------- */

function readLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_PREFS) || 'null')
    if (raw && raw.prefs) return { prefs: sanitize(raw.prefs), uid: raw.uid || null }
    // Before this page existed the toggle saved only 'dark' / 'light'.
    return { prefs: { ...DEFAULT_PREFS, mode: localStorage.getItem(LS_LEGACY) === 'dark' ? 'dark' : 'light' }, uid: null }
  } catch {
    return { prefs: { ...DEFAULT_PREFS }, uid: null }
  }
}

const local = readLocal()
let state = { prefs: local.prefs, sync: 'local' } // sync: 'local' | 'loading' | 'saving' | 'saved' | 'error' | 'denied'
let owner = local.uid
let account = null // signed-in uid
const listeners = new Set()
const emit = () => { for (const f of listeners) f() }
const set = (patch) => { state = { ...state, ...patch }; emit() }

export const getTheme = () => state
export function useTheme() {
  return useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f) }, getTheme)
}

function keepLocal(p) {
  try { localStorage.setItem(LS_PREFS, JSON.stringify({ prefs: p, uid: owner })) } catch { /* private mode */ }
}

let timer = null
// Changes the look right away; saves to this device now and to the account a moment later.
export function setPrefs(next) {
  const p = sanitize(typeof next === 'function' ? next(state.prefs) : next)
  if (account) owner = account
  applyToPage(p)
  keepLocal(p)
  set({ prefs: p, sync: account ? 'saving' : 'local' })
  if (!account) return
  clearTimeout(timer)
  const uid = account
  timer = setTimeout(() => saveToAccount(uid, p), 700)
}
export const resetPrefs = () => setPrefs({ ...DEFAULT_PREFS })

async function saveToAccount(uid, p) {
  try {
    await setDoc(doc(db, 'users', uid), { uid, prefs: p }, { merge: true })
    if (account === uid) set({ sync: 'saved' })
  } catch (err) {
    // Firestore rules not opened for "prefs" yet -> permission-denied. The look still works on this device.
    if (account === uid) set({ sync: err?.code === 'permission-denied' ? 'denied' : 'error' })
    console.warn('Could not save theme to the account:', err?.code || err)
  }
}

// After sign-in: use the account's saved look. With none saved, keep this device's choice only if it
// was made by the same person (or before accounts were used); someone else's look is not carried over.
export async function loadForUser(uid) {
  account = uid
  set({ sync: 'loading' })
  let saved
  try {
    // From the server: with the sign-in profile write (saveUser) still pending, a plain getDoc can answer
    // from that local write alone, which has no "prefs" and would look like "nothing saved".
    const ref = doc(db, 'users', uid)
    const snap = await getDocFromServer(ref).catch(() => getDoc(ref)) // offline: whatever is known
    saved = snap.exists() ? snap.data().prefs : undefined
  } catch (err) {
    console.warn('Could not read theme from the account:', err?.code || err)
    if (account === uid) set({ sync: 'error' })
    return
  }
  if (account !== uid) return
  if (saved) {
    owner = uid
    const p = sanitize(saved)
    applyToPage(p)
    keepLocal(p)
    set({ prefs: p, sync: 'saved' })
  } else if (!owner || owner === uid) {
    owner = uid
    keepLocal(state.prefs)
    if (isDefault(state.prefs)) set({ sync: 'saved' })
    else { set({ sync: 'saving' }); saveToAccount(uid, state.prefs) }
  } else {
    owner = uid
    const p = { ...DEFAULT_PREFS }
    applyToPage(p)
    keepLocal(p)
    set({ prefs: p, sync: 'saved' })
  }
}
export function signedOut() {
  account = null
  clearTimeout(timer)
  set({ sync: 'local' })
}

// Paint once with what this device remembers, and follow the device when the mode is "ตามเครื่อง".
applyToPage(state.prefs)
try {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (state.prefs.mode === 'system') applyToPage(state.prefs) })
} catch { /* old browser */ }
