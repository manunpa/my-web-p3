import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Panel, HourBars, Empty, nf } from './charts'
import { times, dTime } from './dashShared'
import {
  PENALTY_STEPS, MIN_JUDGED, WINDOWS, stepLabel, penaltyBeforeAfter, penalizedDrivers, driverTimeline,
} from './behaviorInsights'

const pct = (v) => (v === null || v === undefined ? '–' : `${v.toFixed(v >= 10 || v === 0 ? 0 : 1)}%`)

// Penalty ladder is ordinal: "no offense" neutral grey, then one orange hue light -> dark.
const STEP_COLORS = ['#898781', '#f0b38a', '#e08a52', '#c4622a', '#8f3f14']
const STEP_SHORT = ['ไม่มีความผิด', 'วาจา', 'ลายลักษณ์อักษร', 'พักงาน', 'เลิกจ้าง']

function StepChips({ given, pending }) {
  return (
    <span className="step-chips">
      {PENALTY_STEPS.map((s) => given[s.step] > 0 && (
        <span key={s.step} className="step-chip" title={s.label}>
          <i style={{ background: STEP_COLORS[s.step] }} />{STEP_SHORT[s.step]} {nf.format(given[s.step])}
        </span>
      ))}
      {pending > 0 && <span className="step-chip muted">รอผล {nf.format(pending)}</span>}
    </span>
  )
}

/* 1. repeat records */
function Repeats({ rows }) {
  if (!rows.length) return <Empty>ไม่มี พขร. ที่มีบันทึก 2 ครั้งขึ้นไปในช่วงนี้</Empty>
  const flat = rows.filter((r) => r.flat).length
  return (
    <>
      {flat > 0 && (
        <p className="beh-warn"><AlertTriangle size={14} />
          {nf.format(flat)} คนในรายการนี้ถูกพิจารณาแล้ว 3 ครั้งขึ้นไป แต่ได้โทษไม่เกินตักเตือนด้วยวาจา (บทลงโทษไม่ไล่ระดับ)
        </p>
      )}
      <div className="table-scroll">
        <table className="orders insight">
          <thead><tr><th>พขร.</th><th className="num">บันทึก</th><th className="num">เสี่ยงสูง</th><th>ผลพิจารณาที่ได้</th><th>โทษสูงสุด</th><th>ล่าสุด</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.name} style={{ '--i': Math.min(i, 12) }} className={r.flat ? 'flag' : ''}>
                <td className="nowrap">{r.flat && <AlertTriangle size={13} className="flag-ic" />}{r.name}
                  <small>{r.unit}{r.moreUnits > 0 && ` +${r.moreUnits} หน่วยงาน`}</small></td>
                <td className="num"><b>{nf.format(r.count)}</b></td>
                <td className="num">{nf.format(r.high)}</td>
                <td><StepChips given={r.given} pending={r.pending} /></td>
                <td className="nowrap">{r.maxStep === null ? <span className="muted">ยังไม่พิจารณา</span> : stepLabel(r.maxStep)}</td>
                <td className="nowrap muted">{dTime(r.last)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/* 2. penalty consistency between units */
function MixBar({ mix, total }) {
  return (
    <span className="mix-bar" title={PENALTY_STEPS.map((s, i) => `${s.label} ${mix[i]}`).filter((_, i) => mix[i]).join(' · ')}>
      {mix.map((n, i) => n > 0 && <i key={i} style={{ flexGrow: n, background: STEP_COLORS[i] }} />)}
      {!total && <i style={{ flexGrow: 1 }} className="empty" />}
    </span>
  )
}

function UnitPenalty({ p }) {
  if (!p.judged) return <Empty>ยังไม่มีรายการที่ลงผลพิจารณาในช่วงนี้</Empty>
  return (
    <>
      {p.mismatch ? (
        <p className="beh-warn"><AlertTriangle size={14} />
          <span><b>เกณฑ์ไม่ตรงกัน:</b> เคสความเสี่ยงสูง{' '}
            {p.mismatch.strict.map((u) => `${u.name} ลงโทษ ${pct(u.highRate)} (${u.highPenalized}/${u.high})`).join(', ')}
            {' '}แต่ {p.mismatch.lenient.map((u) => `${u.name} (0/${u.high})`).join(', ')} พิจารณาเป็นไม่มีความผิดทุกเคส</span>
        </p>
      ) : (
        <p className="muted mismatch-ok"><CheckCircle2 size={14} /> ไม่พบหน่วยงานที่ใช้เกณฑ์ต่างกันชัดเจน (เทียบเฉพาะหน่วยงานที่มีเคสเสี่ยงสูงที่พิจารณาแล้ว ≥ {MIN_JUDGED} เคส)</p>
      )}
      <div className="table-scroll">
        <table className="orders insight">
          <thead><tr><th>หน่วยงาน</th><th className="num">พิจารณาแล้ว</th><th>สัดส่วนผลพิจารณา</th><th className="num">มีโทษ</th><th className="num">เสี่ยงสูงที่มีโทษ</th></tr></thead>
          <tbody>
            {p.units.map((u, i) => {
              const flag = p.mismatch && (p.mismatch.strict.includes(u) || p.mismatch.lenient.includes(u))
              return (
                <tr key={u.name} style={{ '--i': Math.min(i, 12) }} className={flag ? 'flag' : ''}>
                  <td className="nowrap">{flag && <AlertTriangle size={13} className="flag-ic" />}{u.name}</td>
                  <td className="num">{nf.format(u.total)}</td>
                  <td><MixBar mix={u.mix} total={u.total} /></td>
                  <td className="num">{pct((u.penalized / u.total) * 100)}</td>
                  <td className="num nowrap">{u.high ? <>{pct(u.highRate)}<small>{u.highPenalized}/{u.high}</small></> : '–'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <ul className="legend inline">
        {PENALTY_STEPS.slice(0, 4).map((s) => <li key={s.step}><i style={{ background: STEP_COLORS[s.step] }} /><span>{s.label}</span></li>)}
      </ul>
      <h4 className="beh-h4">ระดับความเสี่ยง × ผลพิจารณา (ทุกหน่วยงาน)</h4>
      <ul className="mini-bars mix-rows">
        {p.byRisk.map((r) => (
          <li key={r.name}>
            <span>{r.name}</span>
            <MixBar mix={r.mix} total={r.total} />
            <b>{r.total ? pct(((r.total - r.mix[0]) / r.total) * 100) : '–'}</b>
            <small>มีโทษ · {nf.format(r.total)} เคส</small>
          </li>
        ))}
      </ul>
      <p className="muted share-note">แสดงหน่วยงานที่พิจารณาแล้วอย่างน้อย 5 เคส · ป้ายเตือนขึ้นเมื่อหน่วยงานหนึ่งลงโทษเคสเสี่ยงสูง ≥ 20% แต่อีกหน่วยงานไม่ลงโทษเลย</p>
    </>
  )
}

/* 3. which penalty works */
const fmt1 = (v) => (v === null ? '–' : v.toFixed(v >= 10 ? 0 : 1))

function BeforeAfter({ rows, w }) {
  const max = Math.max(0.1, ...rows.flatMap((p) => [p.before ?? 0, p.after ?? 0]))
  return (
    <div className="table-scroll">
      <table className="orders insight effect ba">
        <thead>
          <tr>
            <th>ผลพิจารณา</th><th className="num">นับได้</th>
            <th>บันทึกเฉลี่ยต่อคน: {w} วันก่อน → {w} วันหลัง</th>
            <th className="num">เปลี่ยนแปลง</th><th className="num">คนที่ลดลง</th><th className="num">ผิดชนิดเดิมซ้ำ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.name} className={p.step === 0 ? 'base' : ''}>
              <td className="nowrap"><i className="dot" style={{ background: STEP_COLORS[p.step] }} />{p.name}
                {p.step === 0 && <small>ใช้เป็นเกณฑ์เทียบ</small>}</td>
              <td className="num">{nf.format(p.n)}<small>จาก {nf.format(p.given)}</small></td>
              <td>
                {p.n ? (
                  <span className="pair" title={`ก่อน ${fmt1(p.before)} · หลัง ${fmt1(p.after)} บันทึกต่อคน`}>
                    <span className="pair-row"><i className="b4" style={{ width: `${(p.before / max) * 100}%` }} /><em>{fmt1(p.before)}</em></span>
                    <span className="pair-row"><i className="af" style={{ width: `${(p.after / max) * 100}%`, background: STEP_COLORS[p.step] }} /><em>{fmt1(p.after)}</em></span>
                  </span>
                ) : <span className="muted">ยังไม่มีเคสที่ผ่านมาครบ {w} วันทั้งก่อนและหลัง</span>}
              </td>
              <td className="num nowrap">{p.change === null ? '–' : <b>{p.change > 0 ? '▲' : p.change < 0 ? '▼' : ''} {Math.abs(p.change).toFixed(0)}%</b>}</td>
              <td className="num">{pct(p.fewer)}</td>
              <td className="num">{pct(p.same)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Timeline({ items, from, to }) {
  const span = Math.max(1, to - from)
  return (
    <div className="tl">
      <div className="tl-track">
        {items.map((r) => (
          <i key={r.id}
            className={`tl-dot${r.step === null ? ' wait' : ''}${r.high ? ' high' : ''}`}
            style={{ left: `${((r.start - from) / span) * 100}%`, background: r.step === null ? undefined : STEP_COLORS[r.step] }}
            title={`${dTime(r.start)}\n${r.offense}\nความเสี่ยง: ${r.risk}\nผล: ${r.step === null ? 'รอผล' : stepLabel(r.step)}`} />
        ))}
      </div>
      <div className="tl-axis"><span>{dTime(new Date(from))}</span><span>{dTime(new Date(to))}</span></div>
    </div>
  )
}

function Effect({ rows, all, inRange }) {
  const [w, setW] = useState(30)
  const [who, setWho] = useState('')
  const ba = useMemo(() => penaltyBeforeAfter(all, inRange, w), [all, inRange, w])
  const people = useMemo(() => penalizedDrivers(inRange), [inRange])
  const driver = people.some((p) => p.name === who) ? who : people[0]?.name ?? ''
  const tl = useMemo(() => (driver ? driverTimeline(all, driver) : []), [all, driver])
  if (!rows.length) return <Empty>ยังไม่มีผลพิจารณาในช่วงนี้</Empty>
  const base = ba.find((p) => p.step === 0)
  const from = Math.min(...all.map((r) => r.start.getTime()))
  return (
    <>
      <div className="effect-head">
        <h4 className="beh-h4">1. คนเดิม ก่อน vs หลังได้รับผล</h4>
        <div className="seg-ctl small" role="radiogroup" aria-label="ช่วงเทียบ">
          {WINDOWS.map((d) => (
            <button key={d} type="button" role="radio" aria-checked={w === d} className={w === d ? 'on' : ''} onClick={() => setW(d)}>{d} วัน</button>
          ))}
        </div>
      </div>
      <BeforeAfter rows={ba} w={w} />
      <p className="muted share-note">
        เทียบจำนวนบันทึกของ พขร. คนเดิมใน {w} วันก่อนกับ {w} วันหลังวันที่เกิดเหตุที่ได้รับผลนั้น จึงไม่โดนผลจาก "คนที่ผิดบ่อยมักโดนโทษหนัก"
        · แถว "ไม่มีความผิด" คือการเปลี่ยนแปลงเมื่อไม่มีโทษ ใช้เป็นเกณฑ์เทียบ{base?.change !== null && base ? ` (${base.change > 0 ? '▲' : '▼'} ${Math.abs(base.change).toFixed(0)}%)` : ''}
        · นับเฉพาะเคสที่มีข้อมูลครบทั้งก่อนและหลัง · จำนวนน้อยกว่า 10 ใช้ดูแนวโน้มเท่านั้น
      </p>

      <h4 className="beh-h4">2. มีบันทึกใหม่ภายในกี่วันหลังได้รับผล</h4>
      <div className="table-scroll">
        <table className="orders insight effect">
          <thead><tr><th>ผลพิจารณา</th>{WINDOWS.map((w) => <th key={w} className="num">ซ้ำใน {w} วัน</th>)}</tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.name}>
                <td className="nowrap"><i className="dot" style={{ background: STEP_COLORS[p.step] }} />{p.name}<small>ให้ไป {nf.format(p.given)} ครั้ง</small></td>
                {p.windows.map((w) => (
                  <td key={w.days} className="num nowrap">
                    {w.n ? <><b>{pct(w.rate)}</b><small>{w.again}/{w.n}</small></> : <span className="muted">–</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted share-note">
        % ที่ พขร. คนเดิมมีบันทึกใหม่ภายในกี่วันหลังได้รับผลนั้น · นับเฉพาะครั้งที่ผ่านมาครบช่วงแล้ว
        · ตารางนี้เทียบข้ามคน: คนที่ได้โทษหนักมักเป็นคนที่ผิดบ่อยอยู่แล้ว % จึงสูงตามไปด้วย ดูข้อ 1 ประกอบ
      </p>

      {people.length > 0 && (
        <>
          <div className="effect-head">
            <h4 className="beh-h4">3. ไทม์ไลน์ราย พขร. ที่เคยได้รับโทษ</h4>
            <label className="f type-pick small">
              <select value={driver} onChange={(e) => setWho(e.target.value)} aria-label="เลือก พขร.">
                {people.map((p) => <option key={p.name} value={p.name}>{p.name} (โทษ {p.value} ครั้ง)</option>)}
              </select>
            </label>
          </div>
          <Timeline items={tl} from={from} to={Date.now()} />
          <ul className="legend inline">
            {PENALTY_STEPS.slice(0, 4).map((s) => <li key={s.step}><i style={{ background: STEP_COLORS[s.step] }} /><span>{s.label}</span></li>)}
            <li><i className="tl-legend-wait" /><span>รอผล</span></li>
            <li><span>จุดขอบหนา = ความเสี่ยงสูง · ชี้ที่จุดเพื่อดูรายละเอียด</span></li>
          </ul>
        </>
      )}
    </>
  )
}

/* 4. fatigue */
function Fatigue({ f }) {
  if (!f.count) return <Empty>ไม่มีบันทึกเรื่องความเหนื่อยล้าในช่วงนี้</Empty>
  return (
    <div className="beh-split">
      <div className="insight-hero">
        <div className="hero-num">{pct((f.count / f.total) * 100)}</div>
        <p className="muted">{nf.format(f.count)} จาก {nf.format(f.total)} บันทึก เกี่ยวกับง่วง เมื่อยล้า หรือขับต่อเนื่องเกิน 4 ชม.</p>
        <ul className="mini-list">
          {f.kinds.map((k) => <li key={k.name}><span title={k.name}>{k.name}</span><b>{nf.format(k.value)}</b><small /></li>)}
        </ul>
        {f.timed > 0 && <p className="muted share-note">ช่วง 00:00–05:59 น. {nf.format(f.night)} เคส ({pct((f.night / f.timed) * 100)})</p>}
      </div>
      <div>{f.timed ? <HourBars counts={f.hours} format={times} /> : <Empty>ไม่มีเวลาเกิดเหตุ</Empty>}</div>
    </div>
  )
}

/* 5. cause x offense */
function Causes({ c }) {
  if (!c.filled) return <Empty>ยังไม่มีการระบุสาเหตุในช่วงนี้</Empty>
  const cols = c.causes.slice(0, 6)
  const max = Math.max(1, ...c.offenses.flatMap((o) => cols.map((k) => o.counts[k.name])))
  return (
    <>
      <div className="table-scroll">
        <table className="orders insight rej-matrix cause-matrix">
          <thead><tr><th>ชนิดความผิด</th><th className="num">ระบุสาเหตุ</th>{cols.map((k) => <th key={k.name} className="num">{k.name}</th>)}</tr></thead>
          <tbody>
            {c.offenses.map((o) => (
              <tr key={o.name}>
                <td title={o.name}>{o.short}</td>
                <td className="num">{nf.format(o.total)}</td>
                {cols.map((k) => {
                  const v = o.counts[k.name]
                  return (
                    <td key={k.name} className="num heat-td" style={v ? { '--a': 0.1 + 0.6 * (v / max) } : undefined}
                      title={`${o.name}\n${k.name}: ${v} เคส`}>
                      {v ? <><b>{nf.format(v)}</b><small>{pct((v / o.total) * 100)}</small></> : <span className="muted">–</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted share-note">
        ระบุสาเหตุแล้ว {nf.format(c.filled)} จาก {nf.format(c.total)} บันทึก · สาเหตุจัดกลุ่มจากคำในช่องสาเหตุกระทำความผิด · สีเข้ม = พบบ่อย
      </p>
    </>
  )
}

/* 6. risk points */
function Scores({ s, compare }) {
  if (!s.top.length) return <Empty />
  return (
    <>
      <div className="table-scroll">
        <table className="orders insight">
          <thead><tr><th>พขร.</th><th className="num">คะแนน</th><th className="num">บันทึก</th><th className="num">เสี่ยงสูง</th>{compare && <th className="num">ช่วงก่อน</th>}<th className="num">ไม่มีบันทึกมาแล้ว</th></tr></thead>
          <tbody>
            {s.top.map((d, i) => (
              <tr key={d.name} style={{ '--i': Math.min(i, 12) }}>
                <td className="nowrap">{d.name}<small>{d.unit}</small></td>
                <td className="num"><b>{nf.format(d.score)}</b></td>
                <td className="num">{nf.format(d.count)}</td>
                <td className="num">{nf.format(d.high)}</td>
                {compare && <td className="num muted nowrap">{d.before === null ? '–' : `${nf.format(d.before)} ${d.score > d.before ? '▲' : d.score < d.before ? '▼' : '='}`}</td>}
                <td className="num nowrap">{d.quietDays} วัน</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {s.improved.length > 0 && (
        <>
          <h4 className="beh-h4">ดีขึ้นชัดเจน <small className="muted">(คะแนนลดลงครึ่งหนึ่งขึ้นไป เทียบ{compare})</small></h4>
          <ul className="mini-list">
            {s.improved.map((d) => <li key={d.name}><span>{d.name}</span><b>{nf.format(d.before)} → {nf.format(d.now)}</b><small /></li>)}
          </ul>
        </>
      )}
      <p className="muted share-note">คะแนน = ความเสี่ยงสูง 3 · ปานกลาง 2 · ต่ำ/ไม่ระบุ 1 รวมทุกบันทึกในช่วงที่เลือก · "ไม่มีบันทึกมาแล้ว" นับจากบันทึกล่าสุดถึงวันนี้</p>
    </>
  )
}

/* 7. harsh events */
function Harsh({ rows }) {
  const [limit, setLimit] = useState(8)
  if (!rows.length) return <Empty>ไม่มีบันทึกที่กรอกค่า G หรือความเร็วเริ่มต้น/ปลาย</Empty>
  return (
    <>
      <div className="table-scroll">
        <table className="orders insight">
          <thead><tr><th>วันที่</th><th>พขร.</th><th className="num">ค่า G</th><th className="num">ความเร็ว</th></tr></thead>
          <tbody>
            {rows.slice(0, limit).map((r) => (
              <tr key={r.id}>
                <td className="nowrap">{dTime(r.start)}</td>
                <td className="nowrap">{r.driver}<small title={r.offense}>{r.offense.length > 28 ? `${r.offense.slice(0, 27)}…` : r.offense}</small></td>
                <td className="num"><b>{r.gforce ?? '–'}</b></td>
                <td className="num nowrap">{r.startSpeed !== null && r.endSpeed !== null ? <>{r.startSpeed}→{r.endSpeed}<small>ลด {r.drop} กม./ชม.</small></> : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-foot">
        <span className="muted">มีข้อมูล {nf.format(rows.length)} รายการ · เรียงจากค่า G สูงสุด</span>
        {limit < rows.length && <button type="button" className="more" onClick={() => setLimit((l) => l + 20)}>แสดงเพิ่ม</button>}
      </div>
    </>
  )
}

/* 9. near miss */
function NearMiss({ n }) {
  if (!n.known) return <Empty>ยังไม่มีการระบุ Near miss ในช่วงนี้</Empty>
  const max = Math.max(1, ...n.list.map((x) => x.rate))
  return (
    <div className="insight-hero">
      <div className="hero-num">{pct(n.rate)}</div>
      <p className="muted">{nf.format(n.yes)} จาก {nf.format(n.known)} บันทึกที่ระบุ เป็น Near miss</p>
      <h4>แยกตามชนิดความผิด <small>(≥ 5 บันทึก)</small></h4>
      <ul className="mini-bars nm">
        {n.list.slice(0, 8).map((x) => (
          <li key={x.name} title={`${x.name}\n${x.yes} จาก ${x.total}`}>
            <span>{x.short}</span>
            <span className="cell-bar rej"><i style={{ width: `${(x.rate / max) * 100}%` }} /></span>
            <b>{pct(x.rate)}</b>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function BehaviorInsights({ d, compare, i0 }) {
  return (
    <>
      <Panel className="span-2" i={i0} title="ทำผิดซ้ำ และบทลงโทษไล่ระดับไหม" note="พขร. ที่มีบันทึก 2 ครั้งขึ้นไปในช่วงที่เลือก (15 อันดับ)">
        <Repeats rows={d.repeats} />
      </Panel>
      <Panel i={i0 + 1} title="Near miss" note="บันทึกที่เกือบเกิดอุบัติเหตุ">
        <NearMiss n={d.nearMiss} />
      </Panel>
      <Panel className="span-3" i={i0 + 2} title="บทลงโทษแบบไหนได้ผล"
        note="ผลพิจารณาที่ให้ในช่วงที่เลือก · ดู 3 มุม: คนเดิมก่อน–หลัง, การทำผิดซ้ำ และไทม์ไลน์รายคน">
        <Effect rows={d.effect} all={d.all} inRange={d.rows} />
      </Panel>
      <Panel className="span-3" i={i0 + 3} title="เกณฑ์ลงโทษของแต่ละหน่วยงาน" note="ผลพิจารณาของรายการที่ตอบกลับแล้ว แยกตามหน่วยงาน">
        <UnitPenalty p={d.unitPenalty} />
      </Panel>
      <Panel className="span-2" i={i0 + 4} title="คะแนนความเสี่ยงราย พขร." note="15 อันดับคะแนนสูงสุดในช่วงที่เลือก">
        <Scores s={d.scores} compare={compare} />
      </Panel>
      <Panel i={i0 + 5} title="เบรก / เร่งกระชาก" note="รายการที่กรอกค่า G หรือความเร็วเริ่มต้น–ปลาย">
        <Harsh rows={d.harsh} />
      </Panel>
      <Panel className="span-3" i={i0 + 6} title="สาเหตุ × ชนิดความผิด" note="ชนิดความผิดที่พบบ่อย 6 อันดับ แยกตามกลุ่มสาเหตุ">
        <Causes c={d.causes} />
      </Panel>
      <Panel className="span-3" i={i0 + 7} title="ความเหนื่อยล้า" note="ง่วง เมื่อยล้า ขับต่อเนื่องเกิน 4 ชม. · แยกตามชั่วโมงที่เกิดเหตุ">
        <Fatigue f={d.fatigue} />
      </Panel>
    </>
  )
}
