'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, CalendarDays, CheckCircle2, ClipboardList, MapPin, Megaphone, Pencil, Plus, QrCode, Search, Stethoscope, UserPlus, Users,
} from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { Pager } from '@/components/crm/Pager';
import { PageTabs, usePageTab } from '@/components/crm/PageTabs';
import { QrPosterModal } from '@/components/crm/QrPoster';
import { Empty, ErrorBox, friendlyError, Pill, rupees, Skeleton } from '@/components/crm/ui';
import { CampForm } from './CampForm';
import { PatientForm } from './PatientForm';
import {
  CAMP_STATUS, campDate, daysTo, PATIENT_STATUS, pct, PHASES, SOURCE_LABEL,
  type CampDetail as Detail, type CampOptions, type CampPatient, type ChecklistItem, type CountRow,
} from './shared';

interface PatientsRes { items: CampPatient[]; total: number; counts: Record<string, number>; referred: number }

export function CampDetail({ id, options, canEdit, onBack, toast }: { id: string; options: CampOptions | null; canEdit: boolean; onBack: () => void; toast: (m: string) => void }) {
  const [tab, setTab] = usePageTab(['plan', 'people', 'results'] as const, 'plan', 'view');
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [qr, setQr] = useState(false);
  const load = useCallback(async () => {
    try { setD(await crm.get<Detail>(`/api/v1/camps/${id}`)); setError(null); } catch (e) { setError(friendlyError(e)); }
  }, [id]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  if (error && !d) return <ErrorBox message={error} onRetry={load} />;
  if (!d) return <Skeleton h={500} />;
  const c = d.camp, s = d.stats;
  const st = CAMP_STATUS[c.status] ?? CAMP_STATUS.planned;
  const left = daysTo(c.date);

  return (
    <div className="cp-detail">
      <button type="button" className="crm-btn is-secondary is-sm" style={{ alignSelf: 'flex-start' }} onClick={onBack}><ArrowLeft size={16} aria-hidden /> All camps</button>
      <header className="crm-card cp-hero">
        <div className="cp-hero-main">
          <span className="cp-hero-kicker">{c.typeLabel} camp · code <strong>{c.code}</strong></span>
          <h2 className="cp-hero-title">{c.title}</h2>
          <span className="cp-hero-meta">
            <span><CalendarDays size={15} aria-hidden /> {campDate(c.date)}, {c.startTime}–{c.endTime}</span>
            <span><MapPin size={15} aria-hidden /> {[c.venue, c.block, c.district].filter(Boolean).join(', ') || 'Place not set'}</span>
            {c.doctors.length > 0 && <span><Stethoscope size={15} aria-hidden /> {c.doctors.join(', ')}</span>}
            {d.host && <span><Users size={15} aria-hidden /> with <Link href={`/admin/partners?id=${encodeURIComponent(d.host.clientId)}`}>{d.host.name}</Link></span>}
          </span>
        </div>
        <div className="cp-hero-side">
          <Pill tone={st.tone} dot>{st.label}</Pill>
          {c.status !== 'done' && c.status !== 'cancelled' && <span className={`cp-countdown${left <= 3 ? ' is-soon' : ''}`}>{left > 1 ? `in ${left} days` : left === 1 ? 'tomorrow' : left === 0 ? 'today' : `${-left} days ago`}</span>}
          <div className="crm-chips">
            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setQr(true)}><QrCode size={15} aria-hidden /> Booking QR</button>
            <Link className="crm-btn is-secondary is-sm" href="/admin/whatsapp?tab=broadcasts"><Megaphone size={15} aria-hidden /> Invite partners</Link>
            {canEdit && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setEditing(true)}><Pencil size={15} aria-hidden /> Edit</button>}
          </div>
        </div>
      </header>

      <section className="ld-kpis" aria-label="Camp numbers">
        <Kpi label="Booked / registered" value={s.booked} sub={`${pct(s.booked, c.capacity)}% of ${c.capacity} slots · ${s.prebooked} pre-booked`} />
        <Kpi label="Seen" value={s.attended} sub={`Target ${c.targetRegistrations}${s.noShow ? ` · ${s.noShow} didn't come` : ''}`} tone={s.attended >= c.targetRegistrations && s.attended > 0 ? 'ok' : undefined} />
        <Kpi label="Sent to hospital" value={s.referred} sub={`Target ${c.targetReferrals} · ${pct(s.referred, s.attended)}% of seen`} />
        <Kpi label="Came to hospital" value={s.arrived} sub={`${pct(s.arrived, s.referred)}% of referred`} tone={s.arrived > 0 ? 'ok' : undefined} />
        <Kpi label="Spent" value={rupees(c.spent)} sub={s.costPerArrival ? `${rupees(s.costPerArrival)} per hospital visit` : c.budget ? `Budget ${rupees(c.budget)}` : undefined} />
      </section>

      <PageTabs label="Camp views" value={tab} onChange={setTab} tabs={[
        { key: 'plan', label: 'Marketing plan', icon: ClipboardList, count: d.checklist.filter((i) => !i.done).length },
        { key: 'people', label: 'People', icon: Users, count: s.booked },
        { key: 'results', label: 'Findings', icon: Stethoscope, count: d.conditions.reduce((a, x) => a + x.n, 0) },
      ]} />

      {tab === 'plan' && <Checklist campId={id} items={d.checklist} canEdit={canEdit} onSaved={load} toast={toast} />}
      {tab === 'people' && <People camp={d} options={options} canEdit={canEdit} onChanged={load} toast={toast} />}
      {tab === 'results' && <Findings d={d} />}

      {editing && <CampForm camp={c} options={options} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); toast('Camp saved.'); void load(); }} />}
      {qr && <QrPosterModal onClose={() => setQr(false)} info={{ title: c.title, sub: `${campDate(c.date)} · ${[c.venue, c.block].filter(Boolean).join(', ')}`, waLink: d.link.waLink, message: d.link.message, displayPhone: d.link.displayPhone, hospital: d.link.hospital }}
        intro={<p className="crm-sub" style={{ margin: 0 }}>Put this poster up at the PHC, shops and the school. People who scan it are booked into the camp straight away, get their token number on WhatsApp, and show under People.</p>} />}
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: number | string; sub?: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className={`crm-card ld-kpi${tone ? ` is-${tone}` : ''}`}>
      <span className="crm-kpi-label">{label}</span>
      <span className="ld-kpi-value">{value}</span>
      {sub && <span className="ld-kpi-sub">{sub}</span>}
    </div>
  );
}

function Checklist({ campId, items, canEdit, onSaved, toast }: { campId: string; items: ChecklistItem[]; canEdit: boolean; onSaved: () => void; toast: (m: string) => void }) {
  const [list, setList] = useState(items);
  const [adding, setAdding] = useState<{ phase: ChecklistItem['phase']; text: string } | null>(null);
  const save = async (next: ChecklistItem[], msg?: string) => {
    setList(next);
    try { await crm.put(`/api/v1/camps/${campId}/checklist`, { items: next }); if (msg) toast(msg); onSaved(); }
    catch (e) { toast(friendlyError(e)); setList(list); }
  };
  const done = list.filter((i) => i.done).length;
  return (
    <div className="cp-plan">
      <div className="cp-progress"><span style={{ width: `${pct(done, list.length)}%` }} /></div>
      <span className="crm-sub" style={{ marginTop: -6 }}>{done} of {list.length} done. The steps that bring people in and turn them into hospital visits.</span>
      <div className="cp-phases">
        {PHASES.map((ph) => {
          const rows = list.filter((i) => i.phase === ph.key);
          return (
            <section key={ph.key} className="crm-card cp-phase">
              <div className="cp-phase-head"><strong>{ph.label}</strong><span className="crm-sub">{ph.hint}</span></div>
              <ul>
                {rows.map((i) => (
                  <li key={i.id} className={i.done ? 'is-done' : undefined}>
                    <label>
                      <input type="checkbox" checked={i.done} disabled={!canEdit} onChange={() => void save(list.map((x) => (x.id === i.id ? { ...x, done: !x.done } : x)))} />
                      <span>{i.text}</span>
                    </label>
                    {canEdit && <button type="button" className="cp-x" aria-label="Remove step" onClick={() => void save(list.filter((x) => x.id !== i.id), 'Step removed.')}>×</button>}
                  </li>
                ))}
              </ul>
              {canEdit && (adding?.phase === ph.key ? (
                <form className="cp-add" onSubmit={(e) => { e.preventDefault(); if (adding.text.trim()) { void save([...list, { id: Math.random().toString(36).slice(2, 10), phase: ph.key, text: adding.text.trim(), done: false }], 'Step added.'); setAdding(null); } }}>
                  <input className="crm-input" autoFocus value={adding.text} maxLength={300} onChange={(e) => setAdding({ ...adding, text: e.target.value })} placeholder="A step for this camp" />
                  <button type="submit" className="crm-btn is-sm">Add</button>
                </form>
              ) : <button type="button" className="nt-link" onClick={() => setAdding({ phase: ph.key, text: '' })}><Plus size={13} aria-hidden /> Add a step</button>)}
            </section>
          );
        })}
      </div>
    </div>
  );
}

const FILTERS = [{ key: '', label: 'Everyone' }, { key: 'booked', label: 'Booked' }, { key: 'attended', label: 'Seen' }, { key: 'referred', label: 'To hospital' }, { key: 'no_show', label: "Didn't come" }] as const;

function People({ camp, options, canEdit, onChanged, toast }: { camp: Detail; options: CampOptions | null; canEdit: boolean; onChanged: () => void; toast: (m: string) => void }) {
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [data, setData] = useState<PatientsRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ mode: 'book' | 'register' | 'screen'; p?: CampPatient } | null>(null);
  const [depts, setDepts] = useState<string[]>([]);
  useEffect(() => { const t = setTimeout(() => setQd(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { crm.get<{ name: string }[]>('/api/v1/departments').then((x) => setDepts(x.map((y) => y.name))).catch(() => undefined); }, []);
  const qs = useMemo(() => {
    const sp = new URLSearchParams({ page: String(page), pageSize: String(size) });
    if (filter === 'referred') sp.set('referred', 'true'); else if (filter) sp.set('status', filter);
    if (qd) sp.set('q', qd);
    return sp.toString();
  }, [filter, qd, page, size]);
  const load = useCallback(async () => {
    try { setData(await crm.get<PatientsRes>(`/api/v1/camps/${camp.camp.id}/patients?${qs}`)); setError(null); } catch (e) { setError(friendlyError(e)); }
  }, [camp.camp.id, qs]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  const mark = async (p: CampPatient, status: string) => {
    try { await crm.patch(`/api/v1/camps/patients/${p.id}`, { status }); await load(); onChanged(); } catch (e) { toast(friendlyError(e)); }
  };
  const condLabel = (c: string) => options?.conditions.find((x) => x.code === c)?.en ?? c;
  const count = (k: string) => (k === '' ? Object.values(data?.counts ?? {}).reduce((a, b) => a + b, 0) : k === 'referred' ? data?.referred ?? 0 : data?.counts[k] ?? 0);

  return (
    <div className="crm-card cp-people">
      <div className="wl-filters" style={{ borderBottom: 0, padding: 0 }}>
        <label className="ch-search" style={{ margin: 0, flex: '1 1 220px' }}>
          <Search size={16} aria-hidden /><span className="crm-sr">Search people</span>
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Name, mobile, village or token" />
        </label>
        {canEdit && <>
          <button type="button" className="crm-btn is-secondary" onClick={() => setForm({ mode: 'book' })}><CalendarDays size={16} aria-hidden /> Book someone</button>
          <button type="button" className="crm-btn" onClick={() => setForm({ mode: 'register' })}><UserPlus size={16} aria-hidden /> Register walk-in</button>
        </>}
      </div>
      <div className="crm-chips">
        {FILTERS.map((f) => <button key={f.key} type="button" className="crm-chip" aria-pressed={filter === f.key} onClick={() => { setFilter(f.key); setPage(1); }}>{f.label}<span className="ld-chip-n">{count(f.key)}</span></button>)}
      </div>
      {error && <ErrorBox message={error} onRetry={load} />}
      {!data ? <Skeleton h={300} /> : data.items.length === 0 ? (
        <Empty title={filter || qd ? 'Nobody matches' : 'Nobody booked yet'}><span className="crm-sub">Share the booking QR, or book people in from calls and partner visits.</span></Empty>
      ) : (
        <div className="crm-table-wrap">
          <table className="crm-table cp-table">
            <thead><tr><th>#</th><th>Person</th><th>Came with</th><th>Readings</th><th>Found</th><th>Status</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {data.items.map((p) => {
                const ps = PATIENT_STATUS[p.status] ?? PATIENT_STATUS.booked;
                return (
                  <tr key={p.id}>
                    <td><span className="rt-num">{p.token}</span></td>
                    <td>
                      <strong>{p.name}</strong>
                      <span className="crm-cell-sub wl-sub">{[p.age != null ? `${p.age} y` : null, p.sex === 'F' ? 'F' : p.sex === 'M' ? 'M' : null, p.village, p.phone ? `+${p.phone.slice(0, 2)} ${p.phone.slice(2)}` : null].filter(Boolean).join(' · ')}</span>
                      <span className="crm-cell-sub wl-sub">{SOURCE_LABEL[p.source] ?? p.source}{p.partnerName ? ` · via ${p.partnerName}` : ''}{p.slot ? ` · ${p.slot}` : ''}</span>
                    </td>
                    <td className="cp-cell-text">{p.complaint ?? <span className="crm-cell-sub">—</span>}</td>
                    <td><div className="cp-cell-vitals">
                      {p.bpSystolic ? <span className={p.flags.includes('hypertension') ? 'is-high' : undefined}>BP {p.bpSystolic}/{p.bpDiastolic ?? '–'}</span> : null}
                      {p.sugar ? <span className={p.flags.includes('diabetes') ? 'is-high' : undefined}>Sugar {p.sugar}</span> : null}
                      {p.spo2 ? <span className={p.flags.includes('asthma_copd') ? 'is-high' : undefined}>SpO2 {p.spo2}%</span> : null}
                      {!p.bpSystolic && !p.sugar && !p.spo2 && <span className="crm-cell-sub">—</span>}
                    </div></td>
                    <td className="cp-cell-text">
                      {p.conditions.length ? p.conditions.map(condLabel).join(', ') : <span className="crm-cell-sub">—</span>}
                      {p.referToHospital && <span className="wl-sub"><Pill tone={p.urgent ? 'bad' : 'accent'}>{p.urgent ? 'Urgent · ' : ''}{p.department ?? 'Hospital'}</Pill>
                        {p.leadId && <Link className="wa-link" style={{ lineHeight: 1.6, marginLeft: 6, fontSize: 12 }} href={`/admin/leads?id=${p.leadId}`}>{p.leadStatus === 'arrived' || p.leadStatus === 'admitted' ? 'Came\u00a0✓' : 'Follow-up\u00a0→'}</Link>}</span>}
                    </td>
                    <td><Pill tone={ps.tone}>{ps.label}</Pill></td>
                    <td><div className="cp-actions">
                      {canEdit && <>
                        <button type="button" className="crm-btn is-sm" onClick={() => setForm({ mode: 'screen', p })}><Stethoscope size={14} aria-hidden /> {p.status === 'attended' ? 'Screening' : 'Screen'}</button>
                        {p.status === 'booked' && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void mark(p, 'attended')}><CheckCircle2 size={14} aria-hidden /> Arrived</button>}
                        {p.status === 'booked' && camp.camp.status === 'done' && <button type="button" className="nt-link is-muted" onClick={() => void mark(p, 'no_show')}>Didn&apos;t come</button>}
                      </>}
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={page} pages={Math.max(1, Math.ceil(data.total / size))} total={data.total} size={size} onPage={setPage} onSize={(n) => { setSize(n); setPage(1); }} noun="people" />}
      {form && <PatientForm campId={camp.camp.id} patient={form.p} mode={form.mode} options={options} departments={depts.length ? depts : camp.camp.departments}
        onClose={() => setForm(null)} onSaved={(m) => { setForm(null); toast(m); void load(); onChanged(); }} />}
    </div>
  );
}

function Bars({ rows, tone }: { rows: CountRow[]; tone: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (rows.length === 0) return <span className="crm-cell-sub">Nothing recorded yet. Screen people under People.</span>;
  return (
    <div className="cp-bars">
      {rows.map((r) => (
        <div key={r.code} className="cp-bar-row">
          <span>{r.label}</span>
          <span className="crm-bar"><span style={{ width: `${pct(r.n, max)}%`, background: tone }} /></span>
          <strong>{r.n}</strong>
        </div>
      ))}
    </div>
  );
}

function Findings({ d }: { d: Detail }) {
  const s = d.stats;
  return (
    <div className="cp-findings">
      <div className="crm-row">
        <section className="crm-card grow-1" style={{ flexBasis: 360 }}>
          <div className="crm-card-head"><h3 className="crm-h2">What the doctors found</h3></div>
          <Bars rows={d.conditions} tone="var(--accent)" />
        </section>
        <section className="crm-card grow-1" style={{ flexBasis: 360 }}>
          <div className="crm-card-head"><h3 className="crm-h2">What people came with</h3></div>
          <Bars rows={d.symptoms} tone="#7c3aed" />
        </section>
      </div>
      <section className="crm-card">
        <div className="crm-card-head"><h3 className="crm-h2">Who came</h3></div>
        <div className="pt-stats cp-who">
          <span><span>Women</span><strong>{s.women}</strong></span>
          <span><span>Men</span><strong>{s.men}</strong></span>
          <span><span>Over 60</span><strong>{s.over60}</strong></span>
          <span><span>Children</span><strong>{s.children}</strong></span>
          <span><span>High BP</span><strong>{s.highBp}</strong></span>
          <span><span>High sugar</span><strong>{s.highSugar}</strong></span>
          <span><span>Cost per person seen</span><strong>{s.costPerAttendee ? rupees(s.costPerAttendee) : '—'}</strong></span>
        </div>
        <p className="crm-sub" style={{ fontSize: 13, marginTop: 10 }}>
          Use this for the next camp here: the most common findings tell you which department and doctor to bring, and what to say on the invitation.
        </p>
      </section>
    </div>
  );
}
