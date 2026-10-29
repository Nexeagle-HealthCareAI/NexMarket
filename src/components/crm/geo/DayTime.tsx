'use client';

import { Bike, CheckCircle2, MapPin, MapPinOff, WifiOff } from 'lucide-react';
import type { AgentActivity, DaySegment } from '@/lib/crm/geo';
import { fmt } from '@/components/crm/ui';

/** Minutes as "1 h 25 min" / "40 min". */
export function dur(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const COLOR = { stopIn: '#16a36a', stopOut: '#d9822b', move: '#3d8fe0', gap: '#e5484d' };
const segColor = (g: DaySegment) => (g.kind === 'stop' ? (g.checkedIn ? COLOR.stopIn : COLOR.stopOut) : g.kind === 'move' ? COLOR.move : COLOR.gap);
const label = (g: DaySegment) =>
  g.kind === 'stop' ? `Stop ${g.no}${g.place ? ` · ${g.placeIsNear ? 'near ' : ''}${g.place}` : ''}`
    : g.kind === 'move' ? `Travelling ${g.km} km` : 'No location';

/** The shift as one bar: stops, travel and gaps in proportion, with hour marks. Click a piece to see it on the map. */
export function DayRibbon({ data, selected, onPick }: { data: AgentActivity; selected: DaySegment | null; onPick: (g: DaySegment) => void }) {
  const segs = data.segments ?? [];
  const t = data.time;
  if (!t?.shiftFrom || !t.shiftTo || segs.length === 0) return null;
  const a = new Date(t.shiftFrom).getTime(), b = new Date(t.shiftTo).getTime();
  const span = Math.max(1, b - a);
  const pct = (iso: string) => ((new Date(iso).getTime() - a) / span) * 100;
  // Hour marks in IST.
  const ticks: { at: number; label: string }[] = [];
  const first = new Date(a); first.setUTCMinutes(first.getUTCMinutes() < 30 ? 30 : 90, 0, 0); // next IST full hour (IST = UTC+5:30)
  for (let x = first.getTime(); x < b; x += 3600e3) ticks.push({ at: ((x - a) / span) * 100, label: fmt.time(new Date(x).toISOString()) });
  const total = t.stopMinutes + t.moveMinutes + t.gapMinutes || 1;

  return (
    <section className="crm-card dt-card" aria-labelledby="dt-h">
      <div className="crm-card-head" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h2 id="dt-h" className="crm-h2" style={{ flex: 1 }}>Where the time went</h2>
        <span className="crm-sub" style={{ fontSize: 13 }}>{fmt.time(t.shiftFrom)} – {fmt.time(t.shiftTo)} · {dur(Math.round(span / 60000))}</span>
      </div>
      <div className="dt-ribbon" role="group" aria-label="Shift from start to end">
        {segs.map((g, i) => (
          <button key={i} type="button" className="dt-piece" aria-pressed={selected === g}
            title={`${fmt.time(g.from)}–${fmt.time(g.to)} · ${dur(g.minutes)} · ${label(g)}${g.kind === 'stop' && !g.checkedIn ? ' · no check-in' : ''}`}
            style={{ left: `${pct(g.from)}%`, width: `${Math.max(0.6, pct(g.to) - pct(g.from))}%`, background: segColor(g) }}
            onClick={() => onPick(g)}>
            {g.kind === 'stop' && pct(g.to) - pct(g.from) > 3.5 ? <span>{g.no}</span> : null}
          </button>
        ))}
      </div>
      <div className="dt-ticks" aria-hidden>{ticks.map((k) => <span key={k.at} style={{ left: `${k.at}%` }}>{k.label}</span>)}</div>
      <div className="dt-legend">
        <span><i style={{ background: COLOR.stopIn }} /> At a stop, checked in</span>
        <span><i style={{ background: COLOR.stopOut }} /> Stopped, no check-in</span>
        <span><i style={{ background: COLOR.move }} /> Travelling</span>
        <span><i style={{ background: COLOR.gap }} /> No location</span>
      </div>
      <div className="dt-sum">
        <div><strong>{dur(t.stopMinutes)}</strong><span>at {t.stops} stop{t.stops === 1 ? '' : 's'} · {Math.round((100 * t.stopMinutes) / total)}%</span></div>
        <div><strong>{dur(t.moveMinutes)}</strong><span>travelling · {Math.round((100 * t.moveMinutes) / total)}%</span></div>
        <div className={t.gapMinutes >= 30 ? 'is-bad' : undefined}><strong>{dur(t.gapMinutes)}</strong><span>no location</span></div>
        <div className={t.stopsWithoutCheckIn ? 'is-warn' : undefined}><strong>{t.stopsWithoutCheckIn}</strong><span>stop{t.stopsWithoutCheckIn === 1 ? '' : 's'} of 20+ min with no check-in{t.stopsWithoutCheckIn ? ` · ${dur(t.minutesStoppedWithoutCheckIn)}` : ''}</span></div>
        <div><strong>{dur(t.longestStopMinutes)}</strong><span>longest stop</span></div>
      </div>
    </section>
  );
}

/** Every stop, leg of travel and gap, with times, duration, place and what was done there. */
export function TimeGrid({ data, selected, onPick }: { data: AgentActivity; selected: DaySegment | null; onPick: (g: DaySegment) => void }) {
  const segs = data.segments ?? [];
  if (segs.length === 0) return <div className="crm-sub" style={{ padding: 12 }}>No GPS route recorded for this day, so there is no time breakdown.</div>;
  return (
    <div className="crm-table-wrap">
      <table className="crm-table dt-grid">
        <thead><tr><th>Time</th><th>For</th><th>Where / what</th><th>Done there</th></tr></thead>
        <tbody>
          {segs.map((g, i) => (
            <tr key={i} className={`dt-row is-${g.kind}`} aria-selected={selected === g} onClick={() => onPick(g)}>
              <td style={{ whiteSpace: 'nowrap' }}>
                <span className="dt-bar" style={{ background: segColor(g) }} />
                <strong>{fmt.time(g.from)}</strong>
                <div className="crm-cell-sub">to {fmt.time(g.to)}</div>
              </td>
              <td style={{ whiteSpace: 'nowrap', fontWeight: 700 }}>{dur(g.minutes)}</td>
              <td>
                {g.kind === 'stop' ? (
                  <>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span className="dt-no" style={{ background: segColor(g) }}>{g.no}</span>
                      <strong>{g.place ? `${g.placeIsNear ? 'Near ' : ''}${g.place}` : 'Unknown place'}</strong>
                    </span>
                    <span className="crm-cell-sub" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {g.checkedIn ? <><CheckCircle2 size={12} aria-hidden /> Checked in</> : <><MapPinOff size={12} aria-hidden /> No check-in{g.nearM != null ? ` · ${g.nearM < 1000 ? `${g.nearM} m` : `${(g.nearM / 1000).toFixed(1)} km`} from the panchayat centre` : ''}</>}
                    </span>
                  </>
                ) : g.kind === 'move' ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}><Bike size={16} aria-hidden style={{ flexShrink: 0 }} /> Travelling {g.km} km{g.kmh ? <span className="crm-cell-sub" style={{ display: 'inline' }}>· about {g.kmh} km/h</span> : null}</span>
                ) : (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--bad)' }}><WifiOff size={16} aria-hidden style={{ flexShrink: 0 }} /> No location (phone off, app closed or no signal)</span>
                )}
              </td>
              <td>
                {g.activities.length === 0 ? <span className="crm-cell-sub">{g.kind === 'stop' ? 'Nothing logged' : ''}</span> : (
                  <ul className="dt-acts">{g.activities.map((x, j) => <li key={j}><span className="crm-cell-sub" style={{ display: 'inline' }}>{fmt.time(x.at)}</span> {x.title}</li>)}</ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="crm-cell-sub" style={{ margin: '8px 2px 0', display: 'flex', gap: 4, alignItems: 'center' }}><MapPin size={12} aria-hidden /> A stop is 8+ minutes within about 150 m. Click a row to see it on the map.</p>
    </div>
  );
}
