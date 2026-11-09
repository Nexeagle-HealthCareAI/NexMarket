'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, Download, Lock, Pencil, Unlock, X } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { Empty, ErrorBox, friendlyError, Pill, Skeleton } from '@/components/crm/ui';
import FieldMap, { type FieldSpot, type FieldTrack } from './FieldMap';
import { colorOf, Q_LABEL, roleLabel, STATUS_LABEL, type FQuestion, type QType } from './shared';

interface Res {
  survey: { id: string; title: string; instructions?: string | null; status: string; dueDate?: string | null; createdAt: string; closedAt?: string | null; createdBy: string; area: [number, number][]; spotTypes: string[]; roadTypes: string[]; questions: FQuestion[] };
  totals: { assigned: number; started: number; submitted: number; km: number; spots: number; photos: number; outsideArea: number };
  people: { agentId: string; name: string; role?: string | null; status: string; startedAt?: string | null; submittedAt?: string | null; lastSyncAt?: string | null; answered: boolean; km: number; spots: number }[];
  spotsByType: { type: string; count: number }[];
  roadKm: { roadType: string; km: number }[];
  tracks: { id: string; agentId: string; roadType?: string | null; km: number; points: [number, number][] }[];
  spots: { id: string; agentId: string; person: string; type: string; name?: string | null; roadType?: string | null; lat: number; lng: number; accuracy?: number | null; note?: string | null; hasPhoto: boolean; takenAt: string; inside: boolean }[];
  answers: { id: string; text: string; type: QType; answers: number; counts?: { answer: string; count: number }[] | null; list?: { person: string; answer: string }[] | null }[];
}

const n1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });
const at = (iso?: string | null) => iso ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(iso)) : '—';
const tone = (s: string) => (s === 'submitted' ? 'ok' : s === 'started' ? 'info' : s === 'closed' ? 'neutral' : s === 'draft' ? 'warn' : 'accent') as 'ok' | 'info' | 'neutral' | 'warn' | 'accent';

/** One occasional field survey's results: map of routes and spots, progress per person, totals and answers. */
export function SurveyResults({ id, editable, onEdit, toast }: { id: string; editable: boolean; onEdit: () => void; toast: (m: string) => void }) {
  const [person, setPerson] = useState('');
  const [data, setData] = useState<Res | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await crm.get<Res>(`/api/v1/field-surveys/${id}${person ? `?agent=${encodeURIComponent(person)}` : ''}`)); setError(null); } catch (e) { setError(friendlyError(e)); }
  }, [id, person]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  // Fresh results while people are out in the field.
  useEffect(() => { const t = setInterval(() => { if (!document.hidden) void load(); }, 60000); return () => clearInterval(t); }, [load]);

  const spot = data?.spots.find((s) => s.id === open) ?? null;
  useEffect(() => {
    let url: string | null = null;
    let live = true;
    if (spot?.hasPhoto) crm.blob(`/api/v1/field-surveys/spots/${spot.id}/photo`).then((b) => { url = URL.createObjectURL(b); if (live) setPhoto(url); }).catch(() => { if (live) setPhoto(null); });
    return () => { live = false; if (url) URL.revokeObjectURL(url); setPhoto(null); };
  }, [spot?.id, spot?.hasPhoto]);

  const tracks: FieldTrack[] = useMemo(() => (data?.tracks ?? []).map((t) => ({ id: t.id, color: colorOf(data!.survey.roadTypes, t.roadType), points: t.points })), [data]);
  const spots: FieldSpot[] = useMemo(() => (data?.spots ?? []).filter((s) => !typeFilter || s.type === typeFilter)
    .map((s) => ({ id: s.id, lat: s.lat, lng: s.lng, color: colorOf(data!.survey.spotTypes, s.type), title: `${s.type}${s.name ? `: ${s.name}` : ''}` })), [data, typeFilter]);

  if (error && !data) return <ErrorBox message={error} onRetry={load} />;
  if (!data) return <Skeleton h={600} />;
  const s = data.survey;
  const t = data.totals;
  const setStatus = async (to: 'close' | 'reopen') => {
    if (to === 'close' && !window.confirm('Close this survey? It disappears from the app for people who haven\'t started; everything recorded stays here.')) return;
    try { await crm.post(`/api/v1/field-surveys/${id}/${to}`); await load(); toast(to === 'close' ? 'Closed.' : 'Open again.'); } catch (e) { toast(friendlyError(e)); }
  };
  const maxRoad = Math.max(0.01, ...data.roadKm.map((r) => r.km));
  const maxType = Math.max(1, ...data.spotsByType.map((r) => r.count));

  return (
    <div className="gg-overview">
      <section className="crm-card so-card">
        <div className="sp-bar">
          <div>
            <h2 className="crm-h2" style={{ margin: 0 }}>{s.title} <Pill tone={tone(s.status)}>{STATUS_LABEL[s.status] ?? s.status}</Pill></h2>
            <span className="crm-sub">Made by {s.createdBy} on {at(s.createdAt)}{s.dueDate ? ` · finish by ${new Date(`${s.dueDate}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}</span>
          </div>
          <span className="sp-actions">
            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void crm.download(`/api/v1/field-surveys/${id}/export.csv`, 'field-survey-spots.csv').catch((e) => toast(friendlyError(e)))}><Download size={14} aria-hidden /> Spots (Excel)</button>
            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void crm.download(`/api/v1/field-surveys/${id}/export.geojson`, 'field-survey.geojson').catch((e) => toast(friendlyError(e)))}><Download size={14} aria-hidden /> Map file</button>
            {editable && <button type="button" className="crm-btn is-secondary is-sm" onClick={onEdit}><Pencil size={14} aria-hidden /> Change</button>}
            {editable && (s.status === 'closed'
              ? <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void setStatus('reopen')}><Unlock size={14} aria-hidden /> Open again</button>
              : <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void setStatus('close')}><Lock size={14} aria-hidden /> Close</button>)}
          </span>
        </div>
        {s.instructions && <p className="crm-sub" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{s.instructions}</p>}
      </section>

      <div className="crm-kpis">
        <div className="crm-card crm-kpi"><span className="crm-kpi-label">People</span><span className="crm-kpi-value">{t.submitted}/{t.assigned}</span><span className="crm-sub">submitted · {t.started} started</span></div>
        <div className="crm-card crm-kpi"><span className="crm-kpi-label">Route covered</span><span className="crm-kpi-value">{n1.format(t.km)} km</span><span className="crm-sub">traced in the app</span></div>
        <div className="crm-card crm-kpi"><span className="crm-kpi-label">Spots marked</span><span className="crm-kpi-value">{t.spots}</span><span className="crm-sub">{t.photos} with a photo</span></div>
        <div className="crm-card crm-kpi"><span className="crm-kpi-label">Outside the area</span><span className="crm-kpi-value">{t.outsideArea}</span><span className="crm-sub">spots marked beyond the drawn area</span></div>
      </div>

      <section className="crm-card so-card">
        <div className="sp-bar">
          <h2 className="crm-h2" style={{ margin: 0 }}>Map</h2>
          <span className="sp-actions">
            <select className="crm-input" value={person} onChange={(e) => setPerson(e.target.value)} style={{ maxWidth: 220 }} aria-label="Whose work">
              <option value="">Everyone</option>
              {data.people.map((p) => <option key={p.agentId} value={p.agentId}>{p.name}</option>)}
            </select>
            <select className="crm-input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ maxWidth: 220 }} aria-label="Spot type">
              <option value="">All spot types</option>
              {s.spotTypes.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </span>
        </div>
        <div className="fs-map-wrap">
          <FieldMap area={s.area} tracks={tracks} spots={spots} onSpot={setOpen} height={520} fitKey={`${id}-${person}`} />
          {spot && (
            <aside className="fs-spot-card crm-card">
              <button type="button" className="fs-spot-x" aria-label="Close" onClick={() => setOpen(null)}><X size={16} aria-hidden /></button>
              <span className="fs-dot" style={{ background: colorOf(s.spotTypes, spot.type) }} aria-hidden /> <strong>{spot.type}</strong>
              {spot.name && <div style={{ fontSize: 15, fontWeight: 600 }}>{spot.name}</div>}
              {spot.hasPhoto && (photo ? (
                <a href={photo} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a private blob URL */}
                  <img src={photo} alt={`Photo of ${spot.type}`} className="fs-photo" />
                </a>
              ) : <div className="fs-photo is-loading"><Camera size={18} aria-hidden /></div>)}
              <div className="crm-sub">{spot.roadType ?? 'Road type not set'}</div>
              {spot.note && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{spot.note}</p>}
              <div className="crm-sub">{spot.person} · {at(spot.takenAt)}{spot.accuracy != null ? ` · ±${Math.round(spot.accuracy)} m` : ''}</div>
              {!spot.inside && <Pill tone="warn">Outside the area</Pill>}
              <a className="wa-link" href={`https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lng}`} target="_blank" rel="noreferrer">Open in Google Maps</a>
            </aside>
          )}
        </div>
        <div className="fs-legend">
          <span className="crm-sub">Routes by road type:</span>
          {s.roadTypes.map((r) => <span key={r}><i style={{ background: colorOf(s.roadTypes, r) }} />{r}</span>)}
        </div>
      </section>

      <div className="gg-two">
        <section className="crm-card so-card">
          <h2 className="crm-h2" style={{ margin: 0 }}>Road covered by type</h2>
          {data.roadKm.length === 0 ? <p className="crm-sub" style={{ margin: 0 }}>No route traced yet.</p> : (
            <ul className="gg-starbars fs-bars">
              {data.roadKm.map((r) => <li key={r.roadType}><span>{r.roadType}</span><span className="sp-topic-bar"><span style={{ width: `${(r.km / maxRoad) * 100}%`, background: colorOf(s.roadTypes, r.roadType) }} /></span><span className="crm-sub">{n1.format(r.km)} km</span></li>)}
            </ul>
          )}
        </section>
        <section className="crm-card so-card">
          <h2 className="crm-h2" style={{ margin: 0 }}>Spots by type</h2>
          {data.spotsByType.length === 0 ? <p className="crm-sub" style={{ margin: 0 }}>No spots marked yet.</p> : (
            <ul className="gg-starbars fs-bars">
              {data.spotsByType.map((r) => (
                <li key={r.type}>
                  <button type="button" className="wa-link" style={{ textAlign: 'left' }} onClick={() => setTypeFilter(typeFilter === r.type ? '' : r.type)}>{r.type}</button>
                  <span className="sp-topic-bar"><span style={{ width: `${(r.count / maxType) * 100}%`, background: colorOf(s.spotTypes, r.type) }} /></span><span className="crm-sub">{r.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="crm-card so-card">
        <h2 className="crm-h2" style={{ margin: 0 }}>People</h2>
        {data.people.length === 0 ? <Empty title="Nobody is doing this survey yet" /> : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead><tr><th scope="col">Person</th><th scope="col">Progress</th><th scope="col" className="wb-num">Route</th><th scope="col" className="wb-num">Spots</th><th scope="col">Questions</th><th scope="col">Last synced</th></tr></thead>
              <tbody>
                {data.people.map((p) => (
                  <tr key={p.agentId}>
                    <td><button type="button" className="wa-link" onClick={() => setPerson(person === p.agentId ? '' : p.agentId)}>{p.name}</button><span className="crm-cell-sub" style={{ display: 'block' }}>{p.role ? roleLabel(p.role) : ''}</span></td>
                    <td><Pill tone={tone(p.status)}>{STATUS_LABEL[p.status] ?? p.status}</Pill>{p.submittedAt && <span className="crm-cell-sub" style={{ display: 'block' }}>{at(p.submittedAt)}</span>}</td>
                    <td className="wb-num">{n1.format(p.km)} km</td>
                    <td className="wb-num">{p.spots}</td>
                    <td>{s.questions.length === 0 ? '—' : p.answered ? 'Answered' : 'Not yet'}</td>
                    <td>{at(p.lastSyncAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data.answers.length > 0 && (
        <section className="crm-card so-card">
          <h2 className="crm-h2" style={{ margin: 0 }}>Answers</h2>
          <div className="fs-answers">
            {data.answers.map((a, i) => (
              <div key={a.id} className="fs-answer">
                <div><strong>{i + 1}. {a.text}</strong> <span className="crm-sub">{Q_LABEL[a.type]} · {a.answers} answered</span></div>
                {a.counts && (a.counts.length === 0 ? <span className="crm-sub">No answers yet.</span> : (
                  <ul className="gg-starbars fs-bars">
                    {a.counts.map((c) => <li key={c.answer}><span>{c.answer === 'true' ? 'Yes' : c.answer === 'false' ? 'No' : c.answer}</span><span className="sp-topic-bar"><span style={{ width: `${(c.count / Math.max(1, a.answers)) * 100}%` }} /></span><span className="crm-sub">{c.count}</span></li>)}
                  </ul>
                ))}
                {a.list && (a.list.length === 0 ? <span className="crm-sub">No answers yet.</span> : (
                  <ul className="gg-list">{a.list.map((x, j) => <li key={j}><span>{x.answer}</span><span className="crm-sub">{x.person}</span></li>)}</ul>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="crm-card so-card">
        <h2 className="crm-h2" style={{ margin: 0 }}>All spots <span className="crm-sub">· {spots.length}</span></h2>
        {spots.length === 0 ? <p className="crm-sub" style={{ margin: 0 }}>Spots appear here as people mark them and their phones sync.</p> : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead><tr><th scope="col">Type</th><th scope="col">Name</th><th scope="col">Road</th><th scope="col">Note</th><th scope="col">By</th><th scope="col">When</th></tr></thead>
              <tbody>
                {data.spots.filter((x) => !typeFilter || x.type === typeFilter).map((x) => (
                  <tr key={x.id} className="fs-row" onClick={() => setOpen(x.id)}>
                    <td><span className="fs-dot" style={{ background: colorOf(s.spotTypes, x.type) }} aria-hidden /> {x.type}{x.hasPhoto && <Camera size={13} aria-label="has a photo" style={{ marginLeft: 6, verticalAlign: -2 }} />}</td>
                    <td>{x.name ?? '—'}</td><td>{x.roadType ?? '—'}</td><td className="fs-note">{x.note ?? ''}</td><td>{x.person}</td><td>{at(x.takenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
