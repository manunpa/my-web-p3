import { createRoot } from 'react-dom/client'
import App from './App'
import './style.css'
import './pwa.js'   // โหมดแอป: Service Worker, ล็อกซูม, ปุ่มติดตั้ง, สีแถบสถานะ

createRoot(document.getElementById('root')).render(<App />)
