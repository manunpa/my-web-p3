import { useRef, useState } from 'react'
import {
  ArrowLeft, Palette, SunMoon, Wand2, RotateCcw, Check, Cloud, CloudOff, HardDrive, RefreshCw, AlertTriangle, Truck,
} from 'lucide-react'
import { Panel, Kpi } from './charts'
import { usePointerGlow } from './dashShared'
import {
  useTheme, setPrefs, resetPrefs, isDefault, modeOf, themeVars, readabilityIssues, fixReadability, isHex, isLightColor,
  PRESETS, MODES, GLASS_DEFAULT,
} from './themePrefs'

// The team theme as style.css draws it (for its swatch); other swatches come from themeVars().
const TEAM_SWATCH = {
  dark: { '--bg': '#07070a', '--card': 'rgba(24,24,27,.9)', '--gold': '#facc15', '--text': '#ffffff', '--muted': '#a1a1aa' },
  light: { '--bg': '#f7f4ec', '--card': 'rgba(255,255,255,.9)', '--gold': '#eab308', '--text': '#1c1917', '--muted': '#5c5852' },
}
const swatchVars = (id, mode, custom) => {
  if (id === 'team') return TEAM_SWATCH[mode]
  if (id === 'custom') return custom ? themeVars(isLightColor(custom.bg) ? 'light' : 'dark', custom) : null
  const t = PRESETS.find((p) => p.id === id)
  return themeVars(mode, { accent: t.accent, bg: t.bg[mode] })
}

function Swatch({ vars }) {
  if (!vars) return <span className="sw sw-rainbow" aria-hidden="true"><i /><i /><i /></span>
  return (
    <span className="sw" aria-hidden="true" style={{ background: vars['--bg'] }}>
      <span className="sw-card" style={{ background: vars['--card'] }}>
        <i style={{ background: vars['--text'] }} />
        <i style={{ background: vars['--muted'] }} />
        <b style={{ background: vars['--gold'] }} />
      </span>
    </span>
  )
}

const SYNC = {
  local: { icon: HardDrive, text: 'บันทึกไว้ในเครื่องนี้' },
  loading: { icon: RefreshCw, text: 'กำลังโหลดธีมจากบัญชี…', spin: true },
  saving: { icon: RefreshCw, text: 'กำลังบันทึกเข้าบัญชี…', spin: true },
  saved: { icon: Cloud, text: 'บันทึกในบัญชีของคุณแล้ว · เปิดจากเครื่องไหนก็ได้ธีมนี้' },
  denied: { icon: CloudOff, text: 'ใช้ได้ในเครื่องนี้ แต่ยังบันทึกเข้าบัญชีไม่ได้ (ฐานข้อมูลยังไม่เปิดสิทธิ์ให้เก็บธีม)', warn: true },
  error: { icon: CloudOff, text: 'ใช้ได้ในเครื่องนี้ แต่บันทึกเข้าบัญชีไม่สำเร็จ (ลองใหม่เมื่อมีอินเทอร์เน็ต)', warn: true },
}

/* ---------- custom colors ---------- */

const FIELDS = [
  { key: 'accent', label: 'สีเน้น', hint: 'ปุ่มที่เลือก เส้นกราฟ ไอคอน', required: true },
  { key: 'bg', label: 'พื้นหลัง', hint: 'สีพื้นของทุกหน้า (โหมดมืด/สว่างตามสีนี้)', required: true },
  { key: 'card', label: 'การ์ด', hint: 'กล่องข้อมูลและแผง' },
  { key: 'text', label: 'ตัวอักษร', hint: 'ข้อความหลัก' },
]

function ColorField({ f, value, auto, onChange }) {
  const [draft, setDraft] = useState(null) // hex being typed
  const shown = draft ?? (value || auto)
  const commit = (v) => { if (isHex(v)) onChange(v.toLowerCase()) }
  return (
    <div className={`cfield${value || f.required ? '' : ' is-auto'}`}>
      <div className="cfield-head">
        <strong>{f.label}</strong>
        {!f.required && (
          <label className="cfield-auto">
            <input type="checkbox" checked={!value} onChange={(e) => onChange(e.target.checked ? '' : auto)} /> อัตโนมัติ
          </label>
        )}
      </div>
      <div className="cfield-row">
        <input type="color" value={isHex(value) ? value : auto} aria-label={`เลือก${f.label}`}
          onChange={(e) => { setDraft(null); commit(e.target.value) }} />
        <input type="text" className="hex" value={shown} maxLength={7} spellCheck={false} aria-label={`รหัสสี${f.label}`}
          onChange={(e) => { const v = e.target.value.trim(); setDraft(v); commit(v.startsWith('#') ? v : `#${v}`) }}
          onBlur={() => setDraft(null)} />
      </div>
      <small className="muted">{f.hint}</small>
    </div>
  )
}

function CustomPanel({ custom, i }) {
  const mode = isLightColor(custom.bg) ? 'light' : 'dark'
  const auto = themeVars(mode, custom)
  const autoHex = { card: mode === 'dark' ? auto['--opt-bg'] : '#ffffff', text: auto['--text'] }
  const issues = readabilityIssues(custom)
  const fixable = issues.filter((x) => !x.auto)
  const change = (key, v) => setPrefs((p) => ({ ...p, custom: { ...p.custom, [key]: v } }))
  const glass = custom.glass || GLASS_DEFAULT[mode]
  return (
    <Panel className="span-3" i={i} title="กำหนดสีเอง" note={`ปรับได้อิสระ · ตอนนี้เป็นโทน${mode === 'dark' ? 'มืด' : 'สว่าง'}ตามสีพื้นหลัง`}>
      <div className="cfields">
        {FIELDS.map((f) => (
          <ColorField key={f.key} f={f} value={custom[f.key]} auto={autoHex[f.key] || custom[f.key]} onChange={(v) => change(f.key, v)} />
        ))}
      </div>
      <div className="glass-row">
        <label htmlFor="glass"><strong>ความทึบของการ์ด</strong> <span className="muted">{glass}%{!custom.glass && ' (อัตโนมัติ)'}</span></label>
        <input id="glass" type="range" min="30" max="100" step="1" value={glass} onChange={(e) => change('glass', +e.target.value)} />
        {custom.glass > 0 && <button type="button" className="link-btn" onClick={() => change('glass', 0)}>อัตโนมัติ</button>}
      </div>
      {fixable.length > 0 ? (
        <div className="beh-warn read-warn">
          <AlertTriangle size={14} />
          <div>
            <strong>บางส่วนอาจอ่านยาก</strong>
            <ul>{fixable.map((x) => <li key={x.label}>{x.label} · ความต่างของสี {x.ratio.toFixed(1)}:1</li>)}</ul>
            <button type="button" className="more" onClick={() => setPrefs((p) => ({ ...p, custom: fixReadability(p.custom) }))}>
              <Wand2 size={14} /> ปรับให้อ่านออก
            </button>
          </div>
        </div>
      ) : (
        <p className="muted mismatch-ok">
          <Check size={14} /> สีที่เลือกอ่านได้ชัด{issues.length > 0 && ' · ลิงก์และหัวข้อสีเน้นถูกปรับให้เข้มขึ้นอัตโนมัติเพื่อให้อ่านออก'}
        </p>
      )}
    </Panel>
  )
}

/* ---------- live sample ---------- */

function Sample({ i }) {
  const [seg, setSeg] = useState('30')
  return (
    <Panel className="span-3" i={i} title="ตัวอย่าง" note="หน้านี้ทั้งหน้าคือตัวอย่างจริง · กล่องนี้รวมของที่ใช้บ่อยไว้ดูในที่เดียว">
      <div className="sample">
        <div className="sample-kpi">
          <Kpi label="การกดปุ่มทั้งหมด" icon={Truck} value={122} format={(v) => `${Math.round(v)}`} delta={-12} upIsGood={false}
            sub="เทียบ 30 วันก่อนหน้า" spark={[4, 7, 5, 9, 6, 11, 8, 13]} animKey="sample" i={0} />
        </div>
        <div className="sample-body">
          <h3>หัวข้อ <b>สีเน้น</b></h3>
          <p className="muted">ข้อความรองสำหรับคำอธิบายสั้น ๆ</p>
          <div className="seg-ctl small" role="radiogroup" aria-label="ตัวอย่างปุ่มเลือก">
            {['7', '30', '90'].map((d) => (
              <button key={d} type="button" role="radio" aria-checked={seg === d} className={seg === d ? 'on' : ''} onClick={() => setSeg(d)}>{d} วัน</button>
            ))}
          </div>
          <div className="sample-btns">
            <button type="button" className="go">ปุ่มหลัก</button>
            <button type="button" className="more">ปุ่มรอง</button>
            <a href="#/settings" onClick={(e) => e.preventDefault()}>ลิงก์</a>
          </div>
          <p className="beh-warn"><AlertTriangle size={14} /><span>ข้อความเตือนสีเหลือง</span></p>
        </div>
      </div>
    </Panel>
  )
}

/* ---------- page ---------- */

export default function SettingsPage() {
  const { prefs, sync } = useTheme()
  const [confirm, setConfirm] = useState(false)
  const stage = useRef(null)
  usePointerGlow(stage)

  // Swatches of ready-made themes follow the chosen mode (while custom is on, too).
  const swMode = modeOf({ ...prefs, preset: 'team' })
  const s = SYNC[sync] || SYNC.local
  const SyncIcon = s.icon

  const pick = (id) => {
    if (id !== 'custom') return setPrefs((p) => ({ ...p, preset: id }))
    // First time: start from what is on screen now, so nothing jumps.
    setPrefs((p) => {
      if (p.custom) return { ...p, preset: 'custom' }
      const cur = PRESETS.find((t) => t.id === p.preset) || PRESETS[0]
      const m = modeOf(p)
      return { ...p, preset: 'custom', custom: { accent: m === 'light' && cur.id === 'team' ? '#eab308' : cur.accent, bg: cur.bg[m], text: '', card: '', glass: 0 } }
    })
  }
  const reset = () => {
    if (!confirm) { setConfirm(true); setTimeout(() => setConfirm(false), 4000); return }
    setConfirm(false)
    resetPrefs()
  }

  return (
    <div className="stage scroll" ref={stage}>
      <main className="dash settings">
        <header className="dash-head">
          <a href="#/" className="back"><ArrowLeft size={16} /> เมนู</a>
          <div className="dash-title">
            <h1>การ<b>แสดงผล</b></h1>
            <p className="sub">ธีมและสีของหน้าเว็บ · มีผลกับบัญชีของคุณคนเดียว ไม่กระทบผู้ใช้อื่น</p>
          </div>
        </header>

        <p className={`sync-line${s.warn ? ' warn' : ''}`} role="status">
          <SyncIcon size={14} className={s.spin ? 'spin' : ''} /> {s.text}
        </p>

        <div className="dash-grid">
          <Panel className="span-3" i={0} title="โหมด" note={prefs.preset === 'custom' ? 'สีกำหนดเองใช้โหมดตามสีพื้นหลังที่เลือก' : 'ปุ่มพระอาทิตย์/พระจันทร์มุมขวาบนสลับได้ทุกหน้า'}>
            <div className="seg-ctl" role="radiogroup" aria-label="โหมดสี">
              {MODES.map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={prefs.mode === id} disabled={prefs.preset === 'custom'}
                  className={prefs.mode === id && prefs.preset !== 'custom' ? 'on' : ''} onClick={() => setPrefs((p) => ({ ...p, mode: id }))}>
                  {id === 'system' && <SunMoon size={14} />} {label}
                </button>
              ))}
            </div>
          </Panel>

          <Panel className="span-3" i={1} title="ธีม" note="เลือกธีมสำเร็จรูป หรือกำหนดสีเองทั้งหมด">
            <div className="theme-grid" role="radiogroup" aria-label="ธีม">
              {[...PRESETS, { id: 'custom', name: 'กำหนดเอง', note: 'เลือกสีได้อิสระ' }].map((t) => {
                const on = prefs.preset === t.id
                return (
                  <button key={t.id} type="button" role="radio" aria-checked={on} className={`theme-card${on ? ' on' : ''}`} onClick={() => pick(t.id)}>
                    <Swatch vars={swatchVars(t.id, swMode, prefs.custom)} />
                    <span className="theme-name">
                      {t.id === 'custom' ? <Palette size={14} /> : null}
                      <strong>{t.name}</strong>
                      {on && <Check size={14} className="theme-tick" />}
                    </span>
                    {t.note && <small className="muted">{t.note}</small>}
                  </button>
                )
              })}
            </div>
          </Panel>

          {prefs.preset === 'custom' && prefs.custom && <CustomPanel custom={prefs.custom} i={2} />}

          <Sample i={3} />

          <Panel className="span-3" i={4} title="คืนค่าเริ่มต้น" note="กลับเป็นธีมทองโทนสว่าง เหมือนตอนเริ่มใช้งาน (สีที่กำหนดเองจะถูกล้าง)">
            <button type="button" className={`more reset-btn${confirm ? ' armed' : ''}`} onClick={reset} disabled={isDefault(prefs)}>
              <RotateCcw size={14} /> {confirm ? 'กดอีกครั้งเพื่อยืนยัน' : 'คืนค่าเริ่มต้น'}
            </button>
          </Panel>
        </div>
      </main>
    </div>
  )
}
