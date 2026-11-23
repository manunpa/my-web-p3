/* โหมดแอป (PWA) ของ SCC Fleet — ใช้ร่วมทุกหน้า (นำเข้าใน main.jsx)
 * - ลงทะเบียน Service Worker (public/sw.js) เฉพาะเว็บจริง (vite build) · ตอน vite dev ไม่ลงทะเบียน
 * - เปิดจากไอคอนหน้าจอโฮม: ล็อกการซูม (แตะ 2 ที / ถ่าง 2 นิ้ว / iPhone ซูมเองตอนแตะช่องกรอก)
 * - Android: ปุ่ม "ติดตั้งเป็นแอป" เรียกหน้าต่างติดตั้งแอปจริง (WebAPK) แทนการสร้างแค่ทางลัด
 * - theme-color ตามธีมมืด/สว่างที่เลือก (ThemeToggle.jsx ตั้ง data-theme บน <html>)
 */

// ---- Service Worker ----
if (import.meta.env.PROD && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' })
      .then((reg) => {
        // แอปที่เปิดค้างไว้นาน (โดยเฉพาะ iOS) ให้เช็กเวอร์ชันใหม่ทุกครั้งที่กลับมาเปิด
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}) })
      })
      .catch((err) => console.warn('[PWA] ลงทะเบียน Service Worker ไม่สำเร็จ', err))
  })
}

// ---- เปิดเป็นแอปอยู่หรือไม่ ----
const mq = (q) => !!(window.matchMedia && window.matchMedia(q).matches)
export const isApp = mq('(display-mode: standalone)') || mq('(display-mode: fullscreen)') || navigator.standalone === true

if (isApp) {
  document.documentElement.classList.add('pwa-app')   // style.css: touch-action แตะ 2 ทีไม่ซูม
  const vp = document.querySelector('meta[name="viewport"]')
  if (vp && !/maximum-scale/.test(vp.content)) vp.setAttribute('content', vp.content + ', maximum-scale=1, user-scalable=no')
  // iOS ไม่สน user-scalable=no → กันท่าถ่าง 2 นิ้วซูมทั้งหน้า (แผนที่ Leaflet/Google ยังซูมแผนที่เองได้)
  ;['gesturestart', 'gesturechange'].forEach((ev) => document.addEventListener(ev, (e) => e.preventDefault(), { passive: false }))
}

// ---- theme-color ตามธีม ----
const THEME = { dark: '#07070a', light: '#f7f4ec' }
function syncThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', document.documentElement.dataset.theme === 'light' ? THEME.light : THEME.dark)
}
syncThemeColor()
try { new MutationObserver(syncThemeColor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }) } catch (_) { /* เบราว์เซอร์เก่า */ }

// ---- ปุ่ม "ติดตั้งเป็นแอป" (Android: Chrome / Samsung Internet) ----
// แสดงเมื่อเบราว์เซอร์ยืนยันว่าติดตั้งได้ · เฉพาะหน้าแรก (เข้าสู่ระบบ/หน้าหลัก) · ติดตั้งแล้ว/เปิดเป็นแอป = ไม่แสดง · × ซ่อน 7 วัน
const HIDE_KEY = 'pwaInstallHideUntil'
let installEvt = null, installBtn = null
const onHome = () => (location.hash.replace(/^#/, '') || '/') === '/'
const hiddenByUser = () => { try { return Date.now() < +(localStorage.getItem(HIDE_KEY) || 0) } catch (_) { return false } }
function hideInstall() { if (installBtn) { installBtn.remove(); installBtn = null } }
function showInstall() {
  if (isApp || !installEvt || !onHome() || installBtn || hiddenByUser() || !document.body) return
  const b = document.createElement('div')
  b.setAttribute('role', 'region'); b.setAttribute('aria-label', 'ติดตั้งแอป')
  b.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom));z-index:2147483000;' +
    'display:flex;align-items:center;gap:4px;padding:6px 6px 6px 8px;border-radius:999px;background:#18181b;color:#fff;border:1px solid rgba(250,204,21,.45);' +
    'box-shadow:0 8px 24px rgba(0,0,0,.45);font:600 15px/1.2 system-ui,sans-serif;max-width:calc(100vw - 32px)'
  b.innerHTML = '<button type="button" data-act="install" style="all:unset;cursor:pointer;display:flex;align-items:center;gap:10px;padding:4px 8px">' +
    '<img src="./icons/icon-192.png" alt="" width="32" height="32" style="border-radius:8px;flex:none">' +
    '<span style="white-space:nowrap">ติดตั้งเป็นแอป</span></button>' +
    '<button type="button" data-act="close" aria-label="ไม่ใช่ตอนนี้" style="all:unset;cursor:pointer;width:32px;height:32px;display:grid;place-items:center;border-radius:50%;color:#a1a1aa;font-size:18px">×</button>'
  b.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return
    if (t.dataset.act === 'close') { try { localStorage.setItem(HIDE_KEY, String(Date.now() + 7 * 864e5)) } catch (_) {} hideInstall(); return }
    const ev = installEvt; if (!ev) return
    installEvt = null; hideInstall()
    ev.prompt(); ev.userChoice.then(() => {}, () => {})
  })
  document.body.appendChild(b); installBtn = b
}
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; showInstall() })
addEventListener('appinstalled', () => { installEvt = null; hideInstall() })
addEventListener('hashchange', () => { if (onHome()) showInstall(); else hideInstall() })
