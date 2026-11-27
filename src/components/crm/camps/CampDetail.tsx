'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity, ArrowLeft, CalendarDays, CheckCircle2, ClipboardList, MapPin, Megaphone, Pencil, Plus, QrCode, Search, Stethoscope, UserPlus, Users, CreditCard, Trash2,
} from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { Pager } from '@/components/crm/Pager';
import { PageTabs, usePageTab } from '@/components/crm/PageTabs';
import { QrPosterModal } from '@/components/crm/QrPoster';
import { Empty, ErrorBox, friendlyError, Modal, Pill, rupees, Skeleton } from '@/components/crm/ui';
import { useAccess } from '@/lib/crm/access';
import { CampForm } from './CampForm';
import { PatientForm } from './PatientForm';
import { BookedVia, CHANNELS } from './BookedVia';
import { IssueCard } from '@/components/crm/cards/IssueCard';
import { FEATURES } from '@/lib/crm/features';
import { CardView } from '@/components/crm/cards/CardView';
import { CampMoney } from './CampMoney';
import { CampDisease } from './CampDisease';
import {
  CAMP_STATUS, campDate, daysTo, PATIENT_STATUS, pct, PHASES,
  type CampDetail as Detail, type CampOptions, type CampPatient, type ChecklistItem,
} from './shared';
import { place } from '@/lib/crm/access';

interface PatientsRes { items: CampPatient[]; total: number; counts: Record<string, number>; referred: number; byAgents?: number; bySource?: Record<string, number> }

export function CampDetail({ id, options, canEdit, onBack, toast }: { id: string; options: CampOptions | null; canEdit: boolean; onBack: () => void; toast: (m: string) => void }) {
  const [tab, setTab] = usePageTab(['people', 'disease', 'plan'] as const, 'people', 'view');
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
        <Kpi label="Booked / registered" value={s.booked} sub={`${pct(s.booked, c.capacity)}% of ${c.capacity} slots · ${s.prebooked} pre-booked${s.byAgents ? ` · ${s.byAgents} by field agents` : ''}`} />
        <Kpi label="Seen" value={s.attended} sub={`Target ${c.targetRegistrations}${s.noShow ? ` · ${s.noShow} didn't come` : ''}`} tone={s.attended >= c.targetRegistrations && s.attended > 0 ? 'ok' : undefined} />
        <Kpi label={`Sent to ${place()}`} value={s.referred} sub={`Target ${c.targetReferrals} · ${pct(s.referred, s.attended)}% of seen`} />
        <Kpi label={`Came to ${place()}`} value={s.arrived} sub={`${pct(s.arrived, s.referred)}% of referred`} tone={s.arrived > 0 ? 'ok' : undefined} />
        <Kpi label="Spent" value={rupees(c.spent)} sub={s.costPerArrival ? `${rupees(s.costPerArrival)} per ${place()} visit` : c.budget ? `Budget ${rupees(c.budget)}` : undefined} />
      </section>

      <CampMoney campId={c.id} campTitle={c.title} campDate={c.date} campBudget={c.budget} project={d.project} canEdit={canEdit} onChanged={() => void load()} toast={toast} />

      <PageTabs label="Camp views" value={tab} onChange={setTab} tabs={[
        { key: 'people', label: 'Bookings & check-ups', icon: Users, count: s.booked },
        { key: 'disease', label: 'Disease data', icon: Activity, count: d.conditions.reduce((a, x) => a + x.n, 0) || undefined },
        { key: 'plan', label: 'Marketing plan', icon: ClipboardList, count: d.checklist.filter((i) => !i.done).length },
      ]} />

      {tab === 'people' && <People camp={d} options={options} canEdit={canEdit} onChanged={load} toast={toast} />}
      {tab === 'disease' && <CampDisease d={d} options={options} canEdit={canEdit} toast={toast} />}
      {tab === 'plan' && <Checklist campId={id} items={d.checklist} canEdit={canEdit} onSaved={load} toast={toast} />}

      {editing && <CampForm camp={c} options={options} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); toast('Camp saved.'); void load(); }} />}
      {qr && <QrPosterModal onClose={() => setQr(false)} info={{ title: c.title, sub: `${campDate(c.date)} · ${[c.venue, c.block].filter(Boolean).join(', ')}`, waLink: d.link.waLink, message: d.link.message, webLink: typeof window !== 'undefined' ? `${window.location.origin}/c/${c.code}` : null, displayPhone: d.link.displayPhone, hospital: d.link.hospital }}
        intro={<p className="crm-sub" style={{ margin: 0 }}>Put this poster up at the PHC, shops and the school. People who scan it open a booking page on their phone, fill a short form and get their token number on the screen. They show under People straight away.</p>} />}
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
      <span className="crm-sub" style={{ marginTop: -6 }}>{done} of {list.length} done. The steps that bring people in and turn them into {place()} visits.</span>
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

const FILTERS = [{ key: '', label: 'Everyone' }, { key: 'booked', label: 'Waiting' }, { key: 'attended', label: 'Arrived / seen' }, { key: 'no_show', label: "Didn't come" }, { key: 'referred', label: `To ${place()}` }] as const;

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

function People({ camp, options, canEdit, onChanged, toast }: { camp: Detail; options: CampOptions | null; canEdit: boolean; onChanged: () => void; toast: (m: string) => void }) {
  const [filter, setFilter] = useState('');
  const [via, setVia] = useState('');
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [data, setData] = useState<PatientsRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ mode: 'book' | 'register' | 'screen'; p?: CampPatient } | null>(null);
  const [giveCard, setGiveCard] = useState<CampPatient | null>(null);
  const [openCard, setOpenCard] = useState<string | null>(null);
  // Admins can delete a person from the camp (test bookings, duplicates, wrong entries), after a confirmation.
  const isAdmin = !!useAccess().access?.isAdmin;
  const [removing, setRemoving] = useState<CampPatient | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const remove = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await crm.del(`/api/v1/camps/patients/${removing.id}`);
      toast(`Deleted ${removing.name} (token ${removing.token}) from the camp`);
      setRemoving(null); await load(); onChanged();
    } catch (e) { toast(friendlyError(e)); } finally { setRemoveBusy(false); }
  };
  const [depts, setDepts] = useState<string[]>([]);
  useEffect(() => { const t = setTimeout(() => setQd(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { crm.get<{ name: string }[]>('/api/v1/departments').then((x) => setDepts(x.map((y) => y.name))).catch(() => undefined); }, []);
  const qs = useMemo(() => {
    const sp = new URLSearchParams({ page: String(page), pageSize: String(size) });
    if (filter === 'referred') sp.set('referred', 'true'); else if (filter) sp.set('status', filter);
    if (via) sp.set('source', via);
    if (qd) sp.set('q', qd);
    return sp.toString();
  }, [filter, via, qd, page, size]);
  const load = useCallback(async () => {
    try { setData(await crm.get<PatientsRes>(`/api/v1/camps/${camp.camp.id}/patients?${qs}`)); setError(null); } catch (e) { setError(friendlyError(e)); }
  }, [camp.camp.id, qs]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  const mark = async (p: CampPatient, status: string) => {
    try { await crm.patch(`/api/v1/camps/patients/${p.id}`, { status }); await load(); onChanged(); } catch (e) { toast(friendlyError(e)); }
  };
  const condLabel = (c: string) => options?.conditions.find((x) => x.code === c)?.en ?? c;
  // From the camp day on, walk-ins and check-ups are the main work; before it, bookings are.
  const onDay = daysTo(camp.camp.date) <= 0;
  const villages = useMemo(() => [...new Set((data?.items ?? []).map((p) => p.village).filter((v): v is string => !!v))], [data]);
  const count = (k: string) => (k === '' ? Object.values(data?.counts ?? {}).reduce((a, b) => a + b, 0) : k === 'referred' ? data?.referred ?? 0 : data?.counts[k] ?? 0);
  const viaCount = (k: string) => (k === '' ? Object.values(data?.bySource ?? {}).reduce((a, b) => a + b, 0) : data?.bySource?.[k] ?? 0);
  // Channels with nobody yet stay out of the way (the one chosen stays, so it can be cleared).
  const channels = CHANNELS.filter((c) => viaCount(c.key) > 0 || via === c.key);
  // Arrived / didn't come are marked here or in the field app; the camp day and after.
  const live = onDay && camp.camp.status !== 'cancelled';

  return (
    <div className="crm-card cp-people">
      {canEdit && camp.camp.status !== 'cancelled' && (
        <div className="cq-desk">
          <button type="button" className={`crm-btn cq-big${onDay ? ' is-secondary' : ''}`} onClick={() => setForm({ mode: 'book' })}>
            <CalendarDays size={20} aria-hidden /><span><strong>Book a person</strong><em>Name, mobile, age · takes seconds</em></span>
          </button>
          <button type="button" className={`crm-btn cq-big${onDay ? '' : ' is-secondary'}`} onClick={() => setForm({ mode: 'register' })}>
            <UserPlus size={20} aria-hidden /><span><strong>Walk-in</strong><em>Register and check up at once</em></span>
          </button>
        </div>
      )}
      <label className="ch-search" style={{ margin: 0 }}>
        <Search size={16} aria-hidden /><span className="crm-sr">Search people</span>
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Name, mobile, panchayat or token" />
      </label>
      <div className="crm-chips" role="group" aria-label="Where they are">
        {FILTERS.map((f) => <button key={f.key} type="button" className="crm-chip" aria-pressed={filter === f.key} onClick={() => { setFilter(f.key); setPage(1); }}>{f.label}<span className="ld-chip-n">{count(f.key)}</span></button>)}
      </div>
      {/* How people booked: QR code, field agents, WhatsApp, partners, the desk, walk-ins. */}
      {channels.length > 0 && (
        <div className="cp-vias" role="group" aria-label="How they booked">
          <span className="cp-vias-title">Booked by</span>
          <button type="button" className="crm-chip" aria-pressed={via === ''} onClick={() => { setVia(''); setPage(1); }}>Any way<span className="ld-chip-n">{viaCount('')}</span></button>
          {channels.map((c) => {
            const Icon = c.icon;
            return (
              <button key={c.key} type="button" className={`crm-chip cp-via-chip is-${c.tone}`} aria-pressed={via === c.key} onClick={() => { setVia(via === c.key ? '' : c.key); setPage(1); }}>
                <Icon size={14} aria-hidden />{c.label}<span className="ld-chip-n">{viaCount(c.key)}</span>
              </button>
            );
          })}
        </div>
      )}
      {via === 'agent' && (camp.agents?.length ?? 0) > 0 && (
        <div className="cp-agents" aria-label="Field agents">
          {camp.agents!.map((a) => (
            <span key={a.agentId} className="cp-agent"><strong>{a.name}</strong> {a.booked} booked{onDay ? ` · ${a.came} came` : ''}</span>
          ))}
        </div>
      )}
      {error && <ErrorBox message={error} onRetry={load} />}
      {!data ? <Skeleton h={300} /> : data.items.length === 0 ? (
        <Empty title={filter || via || qd ? 'Nobody matches' : 'Nobody booked yet'}><span className="crm-sub">Share the booking QR, or book people in from calls and partner visits.</span></Empty>
      ) : (
        <div className="crm-table-wrap">
          <table className="crm-table cp-table">
            <thead><tr><th>#</th><th>Person</th><th>Booked by</th><th>Came with</th><th>Readings</th><th>Found</th><th>Status</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {data.items.map((p) => {
                const ps = PATIENT_STATUS[p.status] ?? PATIENT_STATUS.booked;
                return (
                  <tr key={p.id}>
                    <td><span className="rt-num">{p.token}</span></td>
                    <td>
                      <strong>{p.name}</strong>
                      {FEATURES.healthCards && p.healthCard && <button type="button" className="hc-badge" onClick={() => setOpenCard(p.healthCard!.id)} title="Hospital health card">{p.healthCard.number}</button>}
                      <span className="crm-cell-sub wl-sub">{[p.age != null ? `${p.age} y` : null, p.sex === 'F' ? 'F' : p.sex === 'M' ? 'M' : null, p.village, p.phone ? `+${p.phone.slice(0, 2)} ${p.phone.slice(2)}` : null].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td><BookedVia p={p} /></td>
                    <td className="cp-cell-text">{p.complaint ?? <span className="crm-cell-sub">—</span>}</td>
                    <td><div className="cp-cell-vitals">
                      {p.bpSystolic ? <span className={p.flags.includes('hypertension') ? 'is-high' : undefined}>BP {p.bpSystolic}/{p.bpDiastolic ?? '–'}</span> : null}
                      {p.sugar ? <span className={p.flags.includes('diabetes') ? 'is-high' : undefined}>Sugar {p.sugar}{p.sugarKind === 'fasting' ? ' (fasting)' : p.sugarKind === 'pp' ? ' (after food)' : ''}</span> : null}
                      {p.spo2 ? <span className={p.flags.includes('asthma_copd') ? 'is-high' : undefined}>SpO2 {p.spo2}%</span> : null}
                      {p.pulse ? <span>Pulse {p.pulse}</span> : null}
                      {p.tempF ? <span className={p.tempF >= 100.4 ? 'is-high' : undefined}>{p.tempF}°F</span> : null}
                      {!p.bpSystolic && !p.sugar && !p.spo2 && !p.pulse && !p.tempF && <span className="crm-cell-sub">—</span>}
                    </div></td>
                    <td className="cp-cell-text">
                      {p.conditions.length ? p.conditions.map(condLabel).join(', ') : <span className="crm-cell-sub">—</span>}
                      {p.referToHospital && <span className="wl-sub"><Pill tone={p.urgent ? 'bad' : 'accent'}>{p.urgent ? 'Urgent · ' : ''}{p.department ?? 'Hospital'}</Pill>
                        {p.leadId && <Link className="wa-link" style={{ lineHeight: 1.6, marginLeft: 6, fontSize: 12 }} href={`/admin/leads?id=${p.leadId}`}>{p.leadStatus === 'arrived' || p.leadStatus === 'admitted' ? 'Came\u00a0✓' : 'Follow-up\u00a0→'}</Link>}</span>}
                    </td>
                    <td>
                      <Pill tone={ps.tone}>{p.status === 'attended' && !p.conditions.length && !p.advice ? 'Arrived' : ps.label}</Pill>
                      {p.status !== 'booked' && (p.statusBy || p.arrivedAt) && (
                        <span className="crm-cell-sub wl-sub">{[p.status === 'attended' && p.arrivedAt ? time(p.arrivedAt) : null, p.statusBy ? `by ${p.statusBy}${p.statusVia === 'app' ? ' (app)' : ''}` : null].filter(Boolean).join(' · ')}</span>
                      )}
                    </td>
                    <td><div className="cp-actions">
                      {canEdit && <>
                        <button type="button" className={`crm-btn is-sm${p.status === 'attended' ? ' is-secondary' : ''}`} onClick={() => setForm({ mode: 'screen', p })}><Stethoscope size={14} aria-hidden /> {p.status === 'attended' ? 'Check-up' : 'Check up'}</button>
                        {p.status === 'booked' && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void mark(p, 'attended')}><CheckCircle2 size={14} aria-hidden /> Arrived</button>}
                        {FEATURES.healthCards && p.status === 'attended' && !p.healthCard && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setGiveCard(p)}><CreditCard size={14} aria-hidden /> Health card</button>}
                        {p.status === 'booked' && (live || camp.camp.status === 'done') && <button type="button" className="nt-link is-muted" onClick={() => void mark(p, 'no_show')}>Didn&apos;t come</button>}
                        {(p.status === 'no_show' || (p.status === 'attended' && !p.conditions.length && !p.advice && !p.healthCard)) && live && (
                          <button type="button" className="nt-link is-muted" title="Marked by mistake: back to waiting" onClick={() => void mark(p, 'booked')}>Undo</button>
                        )}
                      </>}
                      {isAdmin && (
                        <button type="button" className="cp-del" onClick={() => setRemoving(p)} aria-label={`Delete ${p.name} from the camp`} title="Delete from the camp (admin)">
                          <Trash2 size={15} aria-hidden />
                        </button>
                      )}
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={page} pages={Math.max(1, Math.ceil(data.total / size))} total={data.total} size={size} onPage={setPage} onSize={(n) => { setSize(n); setPage(1); }} noun="people" />}
      {removing && (
        <Modal title="Delete from the camp?" onClose={() => !removeBusy && setRemoving(null)}
          actions={<>
            <button type="button" className="crm-btn is-secondary" onClick={() => setRemoving(null)} disabled={removeBusy}>Keep</button>
            <button type="button" className="crm-btn is-danger" onClick={() => void remove()} disabled={removeBusy}><Trash2 size={15} aria-hidden /> {removeBusy ? 'Deleting…' : 'Delete'}</button>
          </>}>
          <p style={{ margin: 0 }}>
            <strong>{removing.name}</strong> (token {removing.token}{removing.village ? `, ${removing.village}` : ''}) and everything recorded for them at this camp — complaint, readings, check-up — will be deleted. This can&apos;t be undone.
          </p>
          {FEATURES.healthCards && removing.healthCard && <p className="crm-sub" style={{ margin: '10px 0 0' }}>Their health card {removing.healthCard.number} stays; it just won&apos;t point to this booking any more.</p>}
          <p className="crm-sub" style={{ margin: '10px 0 0' }}>The activity log keeps who deleted it.</p>
        </Modal>
      )}
      {giveCard && <IssueCard prefill={{ holderName: giveCard.name, phone: giveCard.phone, age: giveCard.age, sex: giveCard.sex, village: giveCard.village, campPatientId: giveCard.id, campId: camp.camp.id, campTitle: camp.camp.title, source: 'camp' }}
        onClose={() => setGiveCard(null)} onIssued={(c) => { setGiveCard(null); toast(`Card ${c.number} given to ${c.holderName}.`); void load(); }} />}
      {openCard && <CardView id={openCard} editable={canEdit} onClose={() => setOpenCard(null)} onChanged={() => void load()} toast={toast} />}
      {form && <PatientForm campId={camp.camp.id} patient={form.p} mode={form.mode} options={options} departments={depts.length ? depts : camp.camp.departments} villages={villages}
        onClose={() => setForm(null)} onSaved={(m, keep) => { if (!keep) setForm(null); toast(m); void load(); onChanged(); }} />}
    </div>
  );
}
