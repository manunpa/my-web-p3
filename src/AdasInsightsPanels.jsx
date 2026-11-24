// Extra panels for the ADAS / DMS page. Calculations are in src/adasInsights.js.
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Panel, Donut, HourHeat, Empty, nf } from './charts'
import { times, dShort } from './dashShared'
import { OUTCOMES, CAMERA_FALSE, CAMERA_NO_VIDEO, LINK_FATIGUE } from './adasInsights'

const pct = (v) => (v === null || v === undefined ? '–' : `${v.toFixed(v >= 10 || v === 0 ? 0 : 1)}%`)
const fmt1 = (v) => (v === null || v === undefined ? '–' : v.toFixed(v >= 10 ? 0 : 1))
// Validated categorical colors, one per behavior category (the last ones repeat the neutral).
const CAT_COLORS = ['#a8323a', '#d95926', '#8f6ae0', '#3987e5', '#e0a321', '#199e70', '#898781']

function OutcomeBar({ mix, total }) {
  return (
    <span className="mix-bar" title={OUTCOMES.map((o) => `${o.label} ${nf.format(mix[o.id])} (${pct((mix[o.id] / total) * 100)})`).join('\n')}>
      {OUTCOMES.map((o) => mix[o.id] > 0 && <i key={o.id} style={{ flexGrow: mix[o.id], background: o.color }} />)}
    </span>
  )
}
// Warning line (amber) or an all-clear line, like the behavior page.
const Callout = ({ warn, children }) => (warn
  ? <p className="beh-warn"><AlertTriangle size={14} /><span>{children}</span></p>
  : <p className="muted mismatch-ok"><CheckCircle2 size={14} /> {children}</p>)

const OutcomeLegend = () => (
  <ul className="legend inline">
    {OUTCOMES.map((o) => <li key={o.id}><i style={{ background: o.color }} /><span>{o.label}</span></li>)}
  </ul>
)

/* A1 */
function TypeQuality({ rows }) {
  if (!rows.length) return <Empty />
  return (
    <>
      <div className="table-scroll">
        <table className="orders insight">
          <thead><tr><th>ประเภทการแจ้งเตือน</th><th className="num">ครั้ง</th><th>ผลตรวจ</th><th className="num">เสี่ยงจริง</th><th className="num">เตือนผิด</th><th className="num">ไม่มีวิดีโอ</th><th>พฤติกรรมที่พบมากสุด</th></tr></thead>
          <tbody>
            {rows.map((t, i) => (
              <tr key={t.name} style={{ '--i': Math.min(i, 12) }} className={t.falseAlert >= CAMERA_FALSE ? 'flag' : ''}>
                <td className="nowrap">{t.falseAlert >= CAMERA_FALSE && <AlertTriangle size={13} className="flag-ic" />}{t.name}</td>
                <td className="num">{nf.format(t.total)}</td>
                <td><OutcomeBar mix={t.mix} total={t.total} /></td>
                <td className="num"><b>{pct(t.risky)}</b></td>
                <td className="num">{pct(t.falseAlert)}</td>
                <td className="num">{pct(t.noVideo)}</td>
                <td className="nowrap">{t.top ? <>{t.top.name}<small>{nf.format(t.top.value)} ครั้ง</small></> : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <OutcomeLegend />
      <p className="muted share-note">จัดกลุ่มจากผลตรวจในคอลัมน์หมายเหตุ · ป้ายเตือนขึ้นเมื่อประเภทนั้นเตือนผิด ≥ {CAMERA_FALSE}% ควรพิจารณาปรับความไวของกล้อง</p>
    </>
  )
}

function NoiseMonths({ months }) {
  const max = Math.max(1, ...months.map((m) => m.rate ?? 0))
  return (
    <>
      <ul className="mini-bars weeks">
        {months.map((m) => (
          <li key={m.label} title={m.total ? `${nf.format(m.value)} จาก ${nf.format(m.total)} แจ้งเตือน` : 'ไม่มีข้อมูล'}>
            <span>{m.label}</span>
            <span className="cell-bar"><i style={{ width: `${((m.rate ?? 0) / max) * 100}%` }} /></span>
            <b>{m.rate === null ? '–' : pct(m.rate)}</b>
            <small>{m.total ? nf.format(m.total) : ''}</small>
          </li>
        ))}
      </ul>
      <p className="muted share-note">% ที่เตือนผิด ไม่มีวิดีโอ หรือซ่อมบำรุง · ตัวเลขขวา = แจ้งเตือนทั้งเดือน</p>
    </>
  )
}

/* A2 */
function CameraHealth({ rows }) {
  if (!rows.length) return <Empty>ไม่มีรถที่มีแจ้งเตือนอย่างน้อย 30 ครั้งในช่วงนี้</Empty>
  const bad = rows.filter((r) => r.bad).length
  return (
    <>
      <Callout warn={bad > 0}>
        {bad ? `${nf.format(bad)} จาก ${nf.format(rows.length)} คัน ควรตรวจกล้อง (เตือนผิด ≥ ${CAMERA_FALSE}% หรือวิดีโอหาย ≥ ${CAMERA_NO_VIDEO}%)` : `ทั้ง ${nf.format(rows.length)} คันอยู่ในเกณฑ์`}
      </Callout>
      <div className="table-scroll">
        <table className="orders insight">
          <thead><tr><th>#</th><th>หมายเลขรถ</th><th className="num">แจ้งเตือน</th><th className="num">เตือนผิด</th><th className="num">ไม่มีวิดีโอ</th><th className="num">ซ่อมบำรุง</th><th className="num">เสี่ยงจริง</th><th>เตือนผิดจากประเภท</th><th /></tr></thead>
          <tbody>
            {rows.slice(0, 15).map((r, i) => (
              <tr key={r.name} style={{ '--i': Math.min(i, 12) }} className={r.bad ? 'flag' : ''}>
                <td className="muted">{i + 1}</td>
                <td className="nowrap"><span className="mono">{r.name}</span><small>{r.unit}</small></td>
                <td className="num">{nf.format(r.total)}</td>
                <td className="num nowrap"><span className="cell-bar rej"><i style={{ width: `${r.falsePct}%` }} /></span>{pct(r.falsePct)}</td>
                <td className="num">{pct(r.noVideoPct)}</td>
                <td className="num">{nf.format(r.maintenance)}</td>
                <td className="num">{pct(r.riskyPct)}</td>
                <td className="nowrap">{r.topType || '–'}</td>
                <td className="nowrap">{r.flag && <span className="status rejected"><AlertTriangle size={12} />{r.flag}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted share-note">รถที่มีแจ้งเตือนอย่างน้อย 30 ครั้งในช่วงนี้ เรียงจากคันที่ควรตรวจก่อน (15 คันแรก) · ดูครบทุกคันในรายงาน</p>
    </>
  )
}

/* B1 */
function DriverScores({ s, compare }) {
  if (!s.top.length) return <Empty>ไม่มีพฤติกรรมเสี่ยงที่ระบุชื่อคนขับในช่วงนี้</Empty>
  const max = s.top[0].score
  return (
    <>
      <div className="table-scroll">
        <table className="orders insight">
          <thead><tr><th>#</th><th>คนขับ</th><th className="num">คะแนน</th><th className="num">ครั้ง</th><th className="num">หลับใน/ง่วง</th><th className="num">หาว</th><th className="num">โทรศัพท์</th>{compare && <th className="num">งวดก่อน</th>}<th>พบมากสุด</th></tr></thead>
          <tbody>
            {s.top.map((d, i) => (
              <tr key={d.name} style={{ '--i': Math.min(i, 12) }}>
                <td className="muted">{i + 1}</td>
                <td className="nowrap">{d.name}<small>{d.unit} · {d.plates.length > 1 ? `${d.plates.length} คัน` : d.plates[0]}</small></td>
                <td className="num nowrap"><span className="cell-bar"><i style={{ width: `${(d.score / max) * 100}%` }} /></span><b>{nf.format(d.score)}</b></td>
                <td className="num">{nf.format(d.risky)}</td>
                <td className="num">{d.sleep || '–'}</td>
                <td className="num">{d.fatigue - d.sleep || '–'}</td>
                <td className="num">{d.phone || '–'}</td>
                {compare && <td className="num nowrap">{nf.format(d.before)}<small>{d.score > d.before ? '▲' : d.score < d.before ? '▼' : '='}</small></td>}
                <td className="nowrap">{d.top?.name ?? '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {s.improved.length > 0 && (
        <Callout>ดีขึ้นชัดเจน: {s.improved.map((d) => `${d.name} (${d.before} → ${d.now})`).join(', ')}</Callout>
      )}
      <p className="muted share-note">
        คะแนน = หลับใน/ง่วง 5 · หาว โทรศัพท์ เสี่ยงชน 3 · กิน/ดื่ม/สูบ ไม่หยุด 2 · ไม่มองถนน 1 (นับเฉพาะผลตรวจที่เป็นพฤติกรรมเสี่ยง)
        {s.topTenthShare !== null && ` · คนขับ 10% แรกมีคะแนนรวม ${pct(s.topTenthShare)} ของทั้งหมด`}
        {s.noName > 0 && ` · ไม่นับ ${nf.format(s.noName)} แจ้งเตือนที่ไม่มีชื่อคนขับ (NA)`}
      </p>
    </>
  )
}

/* B2 */
function FatigueRepeats({ rows }) {
  if (!rows.length) return <Empty>ไม่มีคนขับที่ง่วงซ้ำในช่วงนี้</Empty>
  return (
    <div className="table-scroll">
      <table className="orders insight">
        <thead><tr><th>คนขับ</th><th className="num">ครั้ง</th><th className="num">หลับใน/ง่วง</th><th className="num">กี่วัน</th><th className="num">วันที่ซ้ำใน 7 วัน</th><th className="num">ห่างกัน (ค่ากลาง)</th><th className="num">00–06 น.</th><th>ล่าสุด</th></tr></thead>
        <tbody>
          {rows.map((d, i) => (
            <tr key={d.name} style={{ '--i': Math.min(i, 12) }} className={d.sleep ? 'flag' : ''}>
              <td className="nowrap">{d.sleep > 0 && <AlertTriangle size={13} className="flag-ic" />}{d.name}<small>{d.unit} · {d.plate}</small></td>
              <td className="num"><b>{nf.format(d.count)}</b></td>
              <td className="num">{d.sleep || '–'}</td>
              <td className="num">{nf.format(d.days)}</td>
              <td className="num">{d.within7 || '–'}</td>
              <td className="num nowrap">{fmt1(d.medianGap)} วัน</td>
              <td className="num">{d.night || '–'}</td>
              <td className="nowrap">{dShort(d.last)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* D3 */
function Geofence({ g }) {
  const rows = [['ในพื้นที่ Geofence', g.inside], ['บนถนน', g.road]]
  return (
    <>
      <ul className="mini-bars mix-rows geo">
        {rows.map(([name, p]) => (
          <li key={name}>
            <span>{name}</span>
            {p.total ? <OutcomeBar mix={p} total={p.total} /> : <span className="muted">–</span>}
            <b>{pct(p.total ? (p.risky / p.total) * 100 : null)}</b>
            <small>เสี่ยง · {nf.format(p.total)} ครั้ง</small>
          </li>
        ))}
      </ul>
      {g.places.length > 0 && (
        <>
          <h4 className="beh-h4">Geofence ที่มีแจ้งเตือนมากสุด</h4>
          <ul className="mini-bars fu">
            {g.places.slice(0, 6).map((p) => (
              <li key={p.name} title={`${p.name}: ${p.total} ครั้ง · เสี่ยง ${p.risky} · เตือนผิด/ใช้ไม่ได้ ${p.noise}`}>
                <span>{p.name}</span>
                <span className="cell-bar"><i style={{ width: `${(p.total / g.places[0].total) * 100}%` }} /></span>
                <b>{nf.format(p.total)}</b>
                <small>เสี่ยง {nf.format(p.risky)}</small>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted share-note">ในพื้นที่ Geofence (คลัง ลาน ลูกค้า) มักเป็นงานซ่อมหรือรถจอด ซ่อมบำรุง {nf.format(g.inside.maintenance)} ครั้ง · จุดเกิดซ้ำนับเฉพาะบนถนน</p>
    </>
  )
}

/* D2 */
function Hotspots({ rows }) {
  if (!rows.length) return <Empty />
  return (
    <>
      <ul className="mini-bars fu">
        {rows.map((p) => (
          <li key={p.name} title={`${p.name}: ${p.count} ครั้ง · หลับใน/ง่วง/หาว ${p.fatigue} · ${p.drivers} คน ${p.plates} คัน · พบมากสุด ${p.top?.name}`}>
            <span>{p.name}</span>
            <span className="cell-bar"><i style={{ width: `${(p.count / rows[0].count) * 100}%` }} /></span>
            <b>{nf.format(p.count)}</b>
            <small>ง่วง {nf.format(p.fatigue)}</small>
          </li>
        ))}
      </ul>
      <p className="muted share-note">พฤติกรรมเสี่ยงบนถนน (ไม่นับในพื้นที่ Geofence) · อำเภอ · จังหวัด 12 อันดับ</p>
    </>
  )
}

/* B3 */
function BehaviorLink({ link, ba, status }) {
  if (status === 'loading') return <Empty>กำลังโหลดบันทึกพฤติกรรม พขร.…</Empty>
  if (status === 'error') return <Empty>โหลดบันทึกพฤติกรรม พขร. ไม่สำเร็จ</Empty>
  if (!link.list.length) return <Empty />
  return (
    <>
      <Callout warn={link.flagged > 0}>
        {link.flagged
          ? `${nf.format(link.flagged)} คัน กล้องจับง่วง/หาว ${LINK_FATIGUE} ครั้งขึ้นไป แต่ยังไม่มีบันทึกพฤติกรรมในช่วงนี้`
          : 'รถที่กล้องจับง่วงบ่อย มีบันทึกพฤติกรรมแล้วทุกคัน'}
        {` · บันทึกพฤติกรรม ${nf.format(link.matched)} จาก ${nf.format(link.behavior)} รายการจับคู่กับทะเบียนในกล้องได้`}
      </Callout>
      <div className="table-scroll">
        <table className="orders insight">
          <thead><tr><th>หมายเลขรถ</th><th className="num">คะแนน DMS</th><th className="num">เสี่ยง</th><th className="num">ง่วง/หาว</th><th>คนขับ (กล้อง)</th><th className="num">บันทึกพฤติกรรม</th><th>พขร. ในบันทึก</th></tr></thead>
          <tbody>
            {link.list.slice(0, 12).map((x, i) => (
              <tr key={x.key} style={{ '--i': Math.min(i, 12) }} className={x.flag ? 'flag' : ''}>
                <td className="nowrap">{x.flag && <AlertTriangle size={13} className="flag-ic" />}<span className="mono">{x.plate}</span><small>{x.unit}</small></td>
                <td className="num"><b>{nf.format(x.score)}</b></td>
                <td className="num">{nf.format(x.risky)}</td>
                <td className="num">{x.fatigue || '–'}</td>
                <td className="nowrap">{x.dmsDriver || '–'}</td>
                <td className="num">{x.records ? <>{nf.format(x.records)}{x.penalized > 0 && <small>มีโทษ {x.penalized}</small>}</> : <span className="muted">ไม่มี</span>}</td>
                <td className="clip" title={x.behDrivers.join(', ')}>{x.behDrivers.slice(0, 2).join(', ') || '–'}{x.behDrivers.length > 2 && ` +${x.behDrivers.length - 2}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ba.length > 0 && (
        <>
          <h4 className="beh-h4">หลังมีบันทึกพฤติกรรม รถคันเดิมมีพฤติกรรมเสี่ยงจากกล้องลดลงไหม (30 วันก่อน → 30 วันหลัง)</h4>
          <div className="table-scroll">
            <table className="orders insight effect">
              <thead><tr><th>ผลพิจารณา</th><th className="num">นับได้</th><th className="num">เฉลี่ยก่อน</th><th className="num">เฉลี่ยหลัง</th><th className="num">เปลี่ยนแปลง</th><th className="num">คันที่ลดลง</th></tr></thead>
              <tbody>
                {ba.map((p) => (
                  <tr key={p.name}>
                    <td className="nowrap">{p.name}{p.step === 0 && <small>ใช้เป็นเกณฑ์เทียบ</small>}</td>
                    <td className="num">{nf.format(p.n)}<small>จาก {nf.format(p.given)}</small></td>
                    <td className="num">{fmt1(p.before)}</td>
                    <td className="num">{fmt1(p.after)}</td>
                    <td className="num nowrap">{p.change === null ? '–' : <b>{p.change > 0 ? '▲' : p.change < 0 ? '▼' : ''} {Math.abs(p.change).toFixed(0)}%</b>}</td>
                    <td className="num">{pct(p.fewer)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="muted share-note">
        จับคู่ด้วยทะเบียนรถ (ชื่อคนขับในกล้องเป็นภาษาอังกฤษ จับคู่กับบันทึกพฤติกรรมไม่ได้) รถคันเดียวอาจมีหลายคนขับ
        · ช่วงก่อน–หลังต้องอยู่ในช่วงที่มีข้อมูลกล้องครบ 30 วันทั้งสองฝั่ง
      </p>
    </>
  )
}

export function AdasInsights({ d, compare, i0, rep }) {
  return (
    <>
      <Panel className="span-2" i={i0} href={rep('adas-type-quality')} title="คุณภาพการแจ้งเตือนตามประเภท"
        note="กล้องเตือนแต่ละประเภท ตรวจแล้วเป็นพฤติกรรมเสี่ยงจริงกี่ %">
        <TypeQuality rows={d.quality} />
      </Panel>
      <Panel i={i0 + 1} href={rep('adas-noise-months')} title="เตือนผิด / ใช้ไม่ได้ รายเดือน" note="12 เดือนล่าสุด">
        <NoiseMonths months={d.noiseMonths} />
      </Panel>
      <Panel className="span-3" i={i0 + 2} href={rep('adas-camera')} title="สุขภาพกล้องรายคัน"
        note="รถคันไหนเตือนผิดหรือวิดีโอหายบ่อย ควรส่งตรวจ ปรับมุม หรือปรับความไวกล้อง">
        <CameraHealth rows={d.camera} />
      </Panel>
      <Panel className="span-2" i={i0 + 3} href={rep('adas-driver-score')} title="คะแนนความเสี่ยงคนขับ (DMS)"
        note={`นับเฉพาะพฤติกรรมเสี่ยงที่ตรวจยืนยันแล้ว · 15 อันดับ${compare ? ` · เทียบ${compare}` : ''}`}>
        <DriverScores s={d.scores} compare={compare} />
      </Panel>
      <Panel i={i0 + 4} href={rep('adas-categories')} title="พฤติกรรมเสี่ยงแยกกลุ่ม" note="จากผลตรวจ (ไม่นับเตือนผิดและพฤติกรรมปกติ)">
        <Donut data={d.categories.map((c, i) => ({ ...c, color: CAT_COLORS[i] ?? CAT_COLORS.at(-1) }))} animKey={d.animKey} unit="ครั้ง" />
      </Panel>
      <Panel className="span-2" i={i0 + 5} href={rep('adas-fatigue-repeats')} title="คนขับที่ง่วงซ้ำ"
        note="หลับใน / ง่วง / หาว 2 ครั้งขึ้นไปในช่วงที่เลือก (15 อันดับ) · แถวที่มีป้าย = มีหลับในหรือง่วง">
        <FatigueRepeats rows={d.fatigueRepeats} />
      </Panel>
      <Panel i={i0 + 6} href={rep('adas-geofence')} title="ในพื้นที่ Geofence vs บนถนน" note="ผลตรวจแยกตามที่เกิด">
        <Geofence g={d.geofence} />
      </Panel>
      <Panel className="span-2" i={i0 + 7} href={rep('adas-fatigue-week')} title="ง่วงจริง: วัน × ช่วงเวลา"
        note="หลับใน / ง่วง / หาว ที่ตรวจยืนยันแล้ว · สีเข้ม = บ่อย ใช้วางช่วงพักและจัดกะ">
        {d.fatigueWeek.some((x) => x.total) ? <HourHeat rows={d.fatigueWeek} format={times} /> : <Empty />}
      </Panel>
      <Panel i={i0 + 8} href={rep('adas-hotspots')} title="จุดที่เกิดซ้ำ" note="พฤติกรรมเสี่ยงบนถนน">
        <Hotspots rows={d.hotspots} />
      </Panel>
      <Panel className="span-3" i={i0 + 9} href={rep('adas-behavior-link')} title="DMS × บันทึกพฤติกรรม พขร."
        note="รถที่กล้องจับพฤติกรรมเสี่ยงได้ มีการบันทึกพฤติกรรมและลงโทษหรือยัง · เรียงจากคันที่ควรติดตามก่อน">
        <BehaviorLink link={d.link} ba={d.linkBA} status={d.behaviorStatus} />
      </Panel>
    </>
  )
}
