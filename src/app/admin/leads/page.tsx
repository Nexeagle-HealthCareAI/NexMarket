'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle, ArrowLeft, Check, CheckCheck, Clock, FileText, Inbox, Lock, MessageCircle, Phone, PhoneCall, Plus, QrCode, Search, Send,
  StickyNote, UserPlus, X,
} from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { canEdit, orgName, useAccess, place } from '@/lib/crm/access';
import { useLiveEvents, useNow } from '@/lib/crm/live';
import { useAgentStore } from '@/store/agent-store';
import { Pager } from '@/components/crm/Pager';
import { QrPosterModal, type QrPosterInfo } from '@/components/crm/QrPoster';
import { Empty, ErrorBox, friendlyError, initials, Modal, PageHead, Pill, Skeleton, useToast, type Tone } from '@/components/crm/ui';

// ─── Types ───
interface Lead {
  id: string; name: string; phone: string;
  source: string; sourceLabel: string; sourceRef?: string | null;
  partnerClientId?: string | null; partnerName?: string | null;
  department?: string | null; status: string; lostReason?: string | null;
  ownerId?: string | null; ownerName?: string | null;
  note?: string | null; lastMessage?: string | null; unread: number; optOut: boolean;
  createdAt: string; lastActivityAt: string; firstResponseAt?: string | null; lastInboundAt?: string | null;
  windowOpen: boolean;
}
interface ListRes {
  items: Lead[]; total: number; page: number; pageSize: number;
  counts: Record<string, number>; overdue: number; unread: number; replyTargetMinutes: number; whatsappConfigured: boolean;
}
interface Summary {
  today: number; month: number; booked: number; arrived: number; admitted: number; medianReplyMinutes: number | null;
  bySource: { source: string; label: string; n: number; arrived: number }[];
}
interface TimelineItem { id: string; at: string; type: 'activity' | 'message'; kind: string; msgType?: string | null; text: string; status?: string | null; error?: string | null; by?: string | null; byName?: string | null }
interface Detail {
  lead: Lead;
  partner?: { clientId: string; name: string; role: string; phone?: string | null; referralCode?: string | null } | null;
  referral?: { clientId: string; status: string } | null;
  timeline: TimelineItem[];
  windowOpen: boolean; windowClosesAt?: string | null; whatsappConfigured: boolean; templateReady: boolean;
}
interface Person { agentId: string; name: string; role: string; photoUrl?: string | null; open: number }

// ─── Labels ───
const LEAD_STATUSES: { key: string; label: string; tone: Tone }[] = [
  { key: 'new', label: 'New', tone: 'warn' },
  { key: 'contacted', label: 'Contacted', tone: 'info' },
  { key: 'appointment', label: 'Appointment', tone: 'accent' },
  { key: 'arrived', label: 'Arrived', tone: 'ok' },
  { key: 'admitted', label: 'Admitted', tone: 'ok' },
  { key: 'lost', label: 'Not interested', tone: 'neutral' },
];
const statusOf = (k: string) => LEAD_STATUSES.find((s) => s.key === k) ?? LEAD_STATUSES[0];
const TABS = [{ key: 'open', label: 'Open' }, ...LEAD_STATUSES.map((s) => ({ key: s.key, label: s.label })), { key: '', label: 'All' }];
const SOURCES: { key: string; label: string }[] = [
  { key: 'whatsapp', label: 'WhatsApp' }, { key: 'partner_qr', label: 'Partner QR' }, { key: 'partner', label: 'Partner' },
  { key: 'ad', label: 'Ad' }, { key: 'camp', label: 'Camp' }, { key: 'missed_call', label: 'Missed call' },
  { key: 'desk', label: 'Call to desk' }, { key: 'walk_in', label: 'Walk-in' }, { key: 'agent', label: 'Field agent' }, { key: 'web', label: 'Website' },
  { key: 'fb_form', label: 'Facebook form' }, { key: 'ig_form', label: 'Instagram form' }, { key: 'facebook', label: 'Facebook message' }, { key: 'instagram', label: 'Instagram message' },
  { key: 'google_listing', label: 'Google search / Maps' }, { key: 'google_ads', label: 'Google ad' },
];
const LOST_REASONS = ['Went elsewhere', 'Too far / travel', 'Cost', 'Not reachable', 'Only an enquiry', 'Wrong number'];

const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const dayFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
const istDay = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
function when(iso: string) {
  const today = istDay(new Date().toISOString());
  return istDay(iso) === today ? timeFmt.format(new Date(iso)) : dayFmt.format(new Date(iso));
}
function mins(n: number) {
  if (n < 1) return 'under a minute';
  if (n < 60) return `${Math.round(n)} min`;
  if (n < 1440) return `${Math.floor(n / 60)} h ${Math.round(n % 60)} min`;
  return `${Math.round(n / 1440)} days`;
}
const showPhone = (p: string) => (p.length === 12 && p.startsWith('91') ? `+91 ${p.slice(2, 7)} ${p.slice(7)}` : p);

export default function LeadsWrap() {
  return (
    <Suspense fallback={<main className="crm-page"><Skeleton h={520} /></main>}>
      <LeadsPage />
    </Suspense>
  );
}

function LeadsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const selected = params.get('id');
  const { access } = useAccess();
  const editable = canEdit(access, 'desk') || canEdit(access, 'whatsapp');

  const [tab, setTab] = useState('open');
  const [source, setSource] = useState('');
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [mine, setMine] = useState(false);
  const [unassigned, setUnassigned] = useState(false);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [list, setList] = useState<ListRes | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ping, setPing] = useState(0);
  const [adding, setAdding] = useState(false);
  const [campQr, setCampQr] = useState(false);
  const [toast, showToast] = useToast();

  useEffect(() => { const t = setTimeout(() => setQDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const qs = useMemo(() => {
    const sp = new URLSearchParams({ page: String(page), pageSize: String(size) });
    if (tab) sp.set('status', tab);
    if (source) sp.set('source', source);
    if (qDebounced) sp.set('q', qDebounced);
    if (mine) sp.set('mine', 'true');
    if (unassigned) sp.set('unassigned', 'true');
    return sp.toString();
  }, [tab, source, qDebounced, mine, unassigned, page, size]);

  const load = useCallback(async () => {
    try {
      const r = await crm.get<ListRes>(`/api/v1/leads?${qs}`);
      setList(r);
      setError(null);
    } catch (e) { setError(friendlyError(e)); }
  }, [qs]);
  const loadSummary = useCallback(() => {
    crm.get<Summary>('/api/v1/leads/summary').then(setSummary).catch(() => undefined);
  }, []);
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => { if (!document.hidden) void load(); }, 20000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [load]);
  useEffect(() => { const t = setTimeout(loadSummary, 0); return () => clearTimeout(t); }, [loadSummary]);

  // A WhatsApp message or a new lead: refresh the list and the open conversation.
  const onEvent = useCallback((e: { kind: string }) => {
    if (e.kind === 'lead') { void load(); loadSummary(); setPing((n) => n + 1); }
  }, [load, loadSummary]);
  useLiveEvents(onEvent);

  const open = (id: string | null) => router.replace(id ? `/admin/leads?id=${id}` : '/admin/leads', { scroll: false });
  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(1); };
  const now = useNow(30000);
  const target = list?.replyTargetMinutes ?? 15;
  const changed = useCallback(() => { void load(); loadSummary(); }, [load, loadSummary]);

  return (
    <main className={`crm-page ld-page${selected ? ' has-sel' : ''}`}>
      <PageHead title="Leads inbox" sub="Everyone who might become a patient: WhatsApp messages, partner QR codes, camps, ads and calls to the desk. Reply fast, give each lead an owner, and follow it until they arrive.">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="crm-btn is-secondary" onClick={() => setCampQr(true)}><QrCode size={16} aria-hidden /> Camp / poster QR</button>
          {editable && <button type="button" className="crm-btn" onClick={() => setAdding(true)}><Plus size={16} aria-hidden /> Add lead</button>}
        </div>
      </PageHead>

      <div className="ld-top">
      {list && !list.whatsappConfigured && (
        <div className="ld-banner">
          <MessageCircle size={18} aria-hidden />
          <span><strong>WhatsApp isn&apos;t connected yet.</strong> Add calls, walk-ins and camp sign-ups here now. Once the {place()}&apos;s WhatsApp Business number is connected, every message to it lands here too, and you can reply from this page.
            {access?.isAdmin ? <> <Link href="/admin/whatsapp?tab=setup" style={{ fontWeight: 700 }}>Set up WhatsApp →</Link></> : ' An admin can connect it in WhatsApp → Setup.'}</span>
        </div>
      )}

      <section className="ld-kpis" aria-label="This month">
        <Kpi label="New today" value={summary?.today} />
        <Kpi label="Leads this month" value={summary?.month} />
        <Kpi label="Booked" value={summary?.booked} sub={summary && summary.month ? `${Math.round((summary.booked / summary.month) * 100)}% of leads` : undefined} />
        <Kpi label="Arrived" value={summary?.arrived} sub={summary && summary.month ? `${Math.round((summary.arrived / summary.month) * 100)}% of leads` : undefined} tone="ok" />
        <Kpi label="Typical first reply" value={summary ? (summary.medianReplyMinutes == null ? '–' : mins(summary.medianReplyMinutes)) : undefined}
          sub={`Target: under ${target} min`} tone={summary?.medianReplyMinutes != null && summary.medianReplyMinutes > target ? 'bad' : undefined} />
      </section>

      {summary && summary.bySource.length > 0 && (
        <div className="crm-chips ld-sources" role="group" aria-label="Filter by source">
          <button type="button" className="crm-chip" aria-pressed={!source} onClick={() => resetPage(setSource)('')}>All sources</button>
          {summary.bySource.map((s) => (
            <button key={s.source} type="button" className="crm-chip" aria-pressed={source === s.source} onClick={() => resetPage(setSource)(source === s.source ? '' : s.source)}
              title={`${s.n} this month, ${s.arrived} arrived`}>
              {s.label} <span className="ld-chip-n">{s.n}</span>
            </button>
          ))}
        </div>
      )}

      {list && list.overdue > 0 && tab !== 'lost' && (
        <button type="button" className="ld-overdue" onClick={() => { setTab('new'); setPage(1); }}>
          <AlertTriangle size={17} aria-hidden />
          <span><strong>{list.overdue} {list.overdue === 1 ? 'lead has' : 'leads have'} waited over {target} minutes</strong> without a reply. People who hear back quickly are far more likely to come.</span>
          <span className="ld-overdue-go">Show them →</span>
        </button>
      )}

      </div>

      {error && <ErrorBox message={error} onRetry={load} />}

      <div className={`ld-shell${selected ? ' has-sel' : ''}`}>
        <aside className="ld-list" aria-label="Leads">
          <div className="crm-tabs ld-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.key || 'all'} type="button" role="tab" className="crm-tab" aria-selected={tab === t.key} onClick={() => { setTab(t.key); setPage(1); }}>
                {t.label}
                {t.key === 'open' && list ? <span className="ld-tab-n">{(list.counts.new ?? 0) + (list.counts.contacted ?? 0) + (list.counts.appointment ?? 0)}</span>
                  : t.key && list?.counts[t.key] ? <span className="ld-tab-n">{list.counts[t.key]}</span> : null}
              </button>
            ))}
          </div>
          <div className="ld-filters">
            <label className="ch-search" style={{ margin: 0, flex: 1 }}>
              <Search size={16} aria-hidden />
              <span className="crm-sr">Search leads</span>
              <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Name, phone, camp or department" />
            </label>
            <button type="button" className="crm-chip" aria-pressed={mine} onClick={() => { setMine(!mine); setUnassigned(false); setPage(1); }}>Mine</button>
            <button type="button" className="crm-chip" aria-pressed={unassigned} onClick={() => { setUnassigned(!unassigned); setMine(false); setPage(1); }}>Nobody&apos;s</button>
          </div>
          {!list ? <div style={{ padding: 12 }}><Skeleton h={320} /></div> : list.items.length === 0 ? (
            <div style={{ padding: 16 }}>
              <Empty title={tab === 'open' && !qDebounced && !source ? 'No open leads' : 'No leads match'}>
                <span className="crm-sub">{list.whatsappConfigured ? 'New WhatsApp messages appear here as they arrive.' : 'Add one with “Add lead”, or share a partner’s QR code.'}</span>
              </Empty>
            </div>
          ) : (
            <ul className="ld-rows">
              {list.items.map((l) => {
                const waiting = l.status === 'new' && !l.firstResponseAt ? (now - new Date(l.createdAt).getTime()) / 60000 : null;
                const st = statusOf(l.status);
                return (
                  <li key={l.id}>
                    <button type="button" className="ld-row" aria-current={l.id === selected ? 'true' : undefined} onClick={() => open(l.id)}>
                      <span className={`ld-av src-${l.source}`} aria-hidden>{l.name.startsWith('+') ? <Phone size={16} /> : initials(l.name)}</span>
                      <span className="ld-row-main">
                        <span className="ld-row-top">
                          <strong>{l.name}</strong>
                          <span className={l.unread ? 'is-unread' : undefined}>{when(l.lastActivityAt)}</span>
                        </span>
                        <span className="ld-row-mid">
                          <span className="ld-preview">{l.lastMessage ?? l.note ?? l.sourceLabel}</span>
                          {l.unread > 0 && <span className="ch-badge" aria-label={`${l.unread} unread`}>{l.unread}</span>}
                        </span>
                        <span className="ld-row-tags">
                          <Pill tone={st.tone}>{st.label}</Pill>
                          <span className="ld-src">{l.partnerName ? `via ${l.partnerName}` : l.sourceLabel}</span>
                          {waiting != null && <span className={`ld-wait${waiting > target ? ' is-late' : ''}`}><Clock size={12} aria-hidden /> {mins(waiting)}</span>}
                          <span className="ld-owner">{l.ownerName ?? 'Nobody yet'}</span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {list && <Pager page={page} pages={Math.max(1, Math.ceil(list.total / size))} total={list.total} size={size} onPage={setPage} onSize={(n) => { setSize(n); setPage(1); }} noun="leads" compact />}
        </aside>
        <section className="ld-pane" aria-label="Lead">
          {selected ? <LeadPane key={selected} id={selected} ping={ping} editable={editable} onBack={() => open(null)} onChanged={changed} toast={showToast} /> : (
            <div className="ch-empty">
              <Inbox size={22} aria-hidden />
              <strong>Pick a lead</strong>
              <span>See their WhatsApp messages, reply, give them an owner and move them along until they arrive at the {place()}.</span>
            </div>
          )}
        </section>
      </div>
      {adding && <AddLead onClose={() => setAdding(false)} onAdded={(id, existed) => { setAdding(false); changed(); open(id); showToast(existed ? 'They were already a lead: added to theirs.' : 'Lead added.'); }} />}
      {campQr && <CampQr onClose={() => setCampQr(false)} />}
      {toast}
    </main>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value?: number | string; sub?: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className={`crm-card ld-kpi${tone ? ` is-${tone}` : ''}`}>
      <span className="crm-kpi-label">{label}</span>
      {value === undefined ? <Skeleton h={28} w={70} /> : <span className="ld-kpi-value">{value}</span>}
      {sub && <span className="ld-kpi-sub">{sub}</span>}
    </div>
  );
}

// ─── One lead ───
function LeadPane({ id, ping, editable, onBack, onChanged, toast }: {
  id: string; ping: number; editable: boolean; onBack: () => void; onChanged: () => void; toast: (m: string) => void;
}) {
  const me = useAgentStore((s) => s.agentId);
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [depts, setDepts] = useState<string[]>([]);
  const [modeRaw, setMode] = useState<'wa' | 'note' | 'call'>('wa');
  const clock = useNow(60000);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [qr, setQr] = useState<QrPosterInfo | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const count = useRef(0);

  const load = useCallback(async () => {
    try {
      const r = await crm.get<Detail>(`/api/v1/leads/${id}`);
      setD(r);
      setError(null);
      if (r.lead.unread > 0) void crm.post(`/api/v1/leads/${id}/read`).then(onChanged).catch(() => undefined);
    } catch (e) { setError(friendlyError(e)); }
  }, [id, onChanged]);
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => { if (!document.hidden) void load(); }, 8000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [load]);
  useEffect(() => { if (ping) { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); } }, [ping, load]);
  useEffect(() => {
    crm.get<Person[]>('/api/v1/leads/people').then(setPeople).catch(() => undefined);
    crm.get<{ name: string; isActive?: boolean }[]>('/api/v1/departments').then((x) => setDepts(x.filter((y) => y.isActive !== false).map((y) => y.name))).catch(() => undefined);
  }, []);
  useEffect(() => {
    const n = d?.timeline.length ?? 0;
    // Scroll the conversation itself (not the page) to the newest message.
    if (n !== count.current) { count.current = n; const el = bodyRef.current; if (el) el.scrollTop = el.scrollHeight; }
  }, [d]);
  // No WhatsApp yet, or they've opted out: start on a note instead.
  const waUsable = !!d && d.whatsappConfigured && !d.lead.optOut;
  const mode = !waUsable && modeRaw === 'wa' ? 'note' : modeRaw;

  const patch = async (body: Record<string, unknown>, ok?: string) => {
    setBusy(true);
    try { await crm.patch(`/api/v1/leads/${id}`, body); await load(); onChanged(); if (ok) toast(ok); }
    catch (e) { toast(friendlyError(e)); }
    finally { setBusy(false); }
  };
  const send = async () => {
    const body = text.trim();
    if (!body && mode !== 'wa') return;
    setBusy(true);
    try {
      if (mode === 'wa') {
        if (!body) return;
        await crm.post(`/api/v1/leads/${id}/whatsapp`, { text: body });
      } else {
        await crm.post(`/api/v1/leads/${id}/notes`, { text: body, kind: mode === 'call' ? 'call' : 'note' });
      }
      setText('');
      await load();
      onChanged();
    } catch (e) { toast(friendlyError(e)); }
    finally { setBusy(false); }
  };
  const template = async () => {
    setBusy(true);
    try { await crm.post(`/api/v1/leads/${id}/whatsapp/template`); await load(); onChanged(); toast('Follow-up sent.'); }
    catch (e) { toast(friendlyError(e)); }
    finally { setBusy(false); }
  };
  const partnerQr = async () => {
    if (!d?.partner) return;
    try {
      const r = await crm.get<{ code: string; name: string; message: string; waLink: string | null; displayPhone?: string | null; hospital: string }>(`/api/v1/partners/${encodeURIComponent(d.partner.clientId)}/referral-link`);
      setQr({ title: r.name, sub: `Referral code ${r.code}`, waLink: r.waLink, message: r.message, displayPhone: r.displayPhone, hospital: r.hospital });
    } catch (e) { toast(friendlyError(e)); }
  };

  if (error && !d) return <div style={{ padding: 16 }}><ErrorBox message={error} onRetry={load} /></div>;
  if (!d) return <div style={{ padding: 16 }}><Skeleton h={420} /></div>;
  const l = d.lead;
  const closesIn = d.windowClosesAt ? Math.max(0, (new Date(d.windowClosesAt).getTime() - clock) / 60000) : 0;

  // Day separators.
  const rows: ({ day: string } | TimelineItem)[] = [];
  let lastDay = '';
  for (const t of d.timeline) {
    const day = istDay(t.at);
    if (day !== lastDay) { rows.push({ day: t.at }); lastDay = day; }
    rows.push(t);
  }

  return (
    <div className="ch-conv">
      <header className="ch-head ld-head">
        <button type="button" className="ch-icon ch-back" onClick={onBack} aria-label="Back to leads"><ArrowLeft size={18} /></button>
        <span className={`ld-av src-${l.source}`} aria-hidden>{l.name.startsWith('+') ? <Phone size={16} /> : initials(l.name)}</span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <strong className="ld-name">{l.name}</strong>
          <span className="crm-cell-sub" style={{ display: 'block' }}>
            {showPhone(l.phone)} · {l.sourceLabel}{l.sourceRef && !l.partnerName ? `: ${l.sourceRef}` : ''} · since {when(l.createdAt)}
          </span>
        </span>
        <a className="ld-head-btn" href={`tel:+${l.phone}`} title="Call"><PhoneCall size={16} aria-hidden /> <span>Call</span></a>
        <a className="ld-head-btn" href={`https://wa.me/${l.phone}`} target="_blank" rel="noreferrer" title="Open in WhatsApp on this computer"><MessageCircle size={16} aria-hidden /> <span>WhatsApp</span></a>
      </header>

      <div className="ld-facts">
        <div className="ld-steps" role="group" aria-label="Status">
          {LEAD_STATUSES.map((s) => (
            <button key={s.key} type="button" className={`ld-step tone-${s.tone}`} aria-pressed={l.status === s.key} disabled={!editable || busy}
              onClick={() => (s.key === 'lost' ? setLostOpen(true) : s.key !== l.status && void patch({ status: s.key }, `Marked ${s.label.toLowerCase()}.`))}>
              {l.status === s.key && <Check size={13} aria-hidden />}{s.label}
            </button>
          ))}
        </div>
        <div className="ld-fact-row">
          <label className="ld-fact">
            <span>Owner</span>
            <select className="crm-select" value={l.ownerId ?? ''} disabled={!editable || busy} onChange={(e) => void patch({ ownerId: e.target.value }, e.target.value ? 'Owner changed.' : 'Unassigned.')}>
              <option value="">Nobody yet</option>
              {people.map((p) => <option key={p.agentId} value={p.agentId}>{p.agentId === me ? `Me (${p.name})` : p.name}{p.open ? ` · ${p.open} open` : ''}</option>)}
              {l.ownerId && !people.some((p) => p.agentId === l.ownerId) && <option value={l.ownerId}>{l.ownerName ?? l.ownerId}</option>}
            </select>
          </label>
          <label className="ld-fact">
            <span>Department</span>
            <input className="crm-input" list="ld-depts" defaultValue={l.department ?? ''} key={l.department ?? ''} disabled={!editable || busy} placeholder="e.g. Orthopaedics"
              onBlur={(e) => { if (e.target.value.trim() !== (l.department ?? '')) void patch({ department: e.target.value.trim() }); }} />
            <datalist id="ld-depts">{depts.map((x) => <option key={x} value={x} />)}</datalist>
          </label>
          <div className="ld-fact">
            <span>Partner</span>
            {d.partner ? (
              <span className="ld-partner">
                <Link href={`/admin/partners?id=${encodeURIComponent(d.partner.clientId)}`}>{d.partner.name}</Link>
                <button type="button" className="nt-link" onClick={() => void partnerQr()} title="This partner's QR code"><QrCode size={14} aria-hidden /></button>
              </span>
            ) : <span className="crm-sub">None</span>}
          </div>
          <div className="ld-fact">
            <span>First reply</span>
            {l.firstResponseAt ? <strong>{mins((new Date(l.firstResponseAt).getTime() - new Date(l.createdAt).getTime()) / 60000)}</strong> : <span className="ld-wait is-late">Not yet</span>}
          </div>
        </div>
        {d.referral && <span className="crm-sub ld-ref-note"><Check size={13} aria-hidden /> On the Referral desk as {d.partner?.name ?? 'the partner'}&apos;s patient · <Link href="/admin/referrals?tab=desk">Open desk</Link></span>}
        {l.status === 'lost' && l.lostReason && <span className="crm-sub">Reason: {l.lostReason}</span>}
      </div>

      <div className="ch-body ld-body" role="log" aria-live="polite" ref={bodyRef}>
        <div className="ch-secure"><Lock size={12} aria-hidden /> {l.optOut ? 'They asked not to get WhatsApp messages. Call them instead.' : d.whatsappConfigured ? `WhatsApp messages with the ${place()}’s number. Everyone on the desk sees this conversation.` : 'Notes and calls about this lead. WhatsApp messages will show here once it’s connected.'}</div>
        {rows.map((r, i) => 'day' in r ? <div key={`d${i}`} className="ch-day"><span>{dayLabelOf(r.day)}</span></div>
          : r.type === 'message' ? <WaBubble key={r.id} m={r} /> : <ActivityLine key={r.id} a={r} />)}
      </div>

      {editable && (
        <footer className="ch-compose ld-compose">
          <div className="ld-modes" role="tablist" aria-label="What to add">
            <button type="button" role="tab" aria-selected={mode === 'wa'} disabled={!waUsable} onClick={() => setMode('wa')}><MessageCircle size={14} aria-hidden /> WhatsApp</button>
            <button type="button" role="tab" aria-selected={mode === 'call'} onClick={() => setMode('call')}><PhoneCall size={14} aria-hidden /> Log a call</button>
            <button type="button" role="tab" aria-selected={mode === 'note'} onClick={() => setMode('note')}><StickyNote size={14} aria-hidden /> Note</button>
            {mode === 'wa' && waUsable && (
              <span className={`ld-window${d.windowOpen ? '' : ' is-closed'}`}>
                <Clock size={13} aria-hidden /> {d.windowOpen ? `Reply window closes in ${mins(closesIn)}` : 'Reply window closed'}
              </span>
            )}
          </div>
          {mode === 'wa' && waUsable && !d.windowOpen ? (
            <div className="ld-closed">
              <span>WhatsApp only lets businesses send a free-text message within 24 hours of the person&apos;s last message. Send the approved follow-up message instead; when they reply, you can chat again.</span>
              <button type="button" className="crm-btn is-sm" disabled={busy || !d.templateReady} onClick={() => void template()}><Send size={15} aria-hidden /> Send follow-up</button>
              {!d.templateReady && <span className="crm-sub" style={{ fontSize: 12 }}>The follow-up template isn&apos;t approved yet.</span>}
            </div>
          ) : (
            <div className="ch-compose-row">
              <label className="crm-sr" htmlFor="ld-input">{mode === 'wa' ? 'WhatsApp message' : mode === 'call' ? 'What happened on the call' : 'Note'}</label>
              <textarea id="ld-input" rows={1} value={text} maxLength={mode === 'wa' ? 4000 : 2000}
                placeholder={mode === 'wa' ? 'Reply on WhatsApp…' : mode === 'call' ? 'e.g. Spoke to her son, coming Monday for knee OPD' : 'Add a note for the desk'}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
              <button type="button" className="ch-send" aria-label={mode === 'wa' ? 'Send on WhatsApp' : 'Save'} disabled={!text.trim() || busy} onClick={() => void send()}>
                {mode === 'wa' ? <Send size={18} /> : <Check size={18} />}
              </button>
            </div>
          )}
          {mode === 'wa' && waUsable && d.windowOpen && (
            <div className="ld-quick" aria-label="Quick replies">
              {quick().map((qr2) => <button key={qr2} type="button" className="crm-chip" onClick={() => setText(qr2)}>{qr2.length > 34 ? qr2.slice(0, 34) + '…' : qr2}</button>)}
            </div>
          )}
        </footer>
      )}

      {lostOpen && <LostModal onClose={() => setLostOpen(false)} onSave={(reason) => { setLostOpen(false); void patch({ status: 'lost', lostReason: reason }, 'Marked not interested.'); }} />}
      {qr && <QrPosterModal info={qr} onClose={() => setQr(null)} />}
    </div>
  );
}

const quick = () => [
  `नमस्ते! हम ${orgName()} से बात कर रहे हैं। आप किस समस्या के लिए दिखाना चाहते हैं?`,
  'OPD सुबह 9 बजे से दोपहर 2 बजे तक है। किस दिन आना ठीक रहेगा?',
  'आपका appointment बुक हो गया है। आते समय पुरानी रिपोर्ट साथ लाएं।',
  'Thank you! Our desk will call you shortly.',
];

function dayLabelOf(iso: string) {
  const d = istDay(iso), today = istDay(new Date().toISOString()), y = istDay(new Date(Date.now() - 864e5).toISOString());
  return d === today ? 'Today' : d === y ? 'Yesterday' : new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
}

function WaBubble({ m }: { m: TimelineItem }) {
  const mine = m.kind === 'out';
  return (
    <div className={`ch-msg${mine ? ' is-mine' : ''}${m.status === 'failed' ? ' is-failed' : ''}`}>
      <div className="ch-bubble">
        {mine && <span className="ch-sender">{m.byName ?? 'Auto-reply'}{m.msgType === 'template' ? ' · template' : ''}</span>}
        {m.msgType && m.msgType !== 'text' && m.msgType !== 'template' && m.msgType !== 'button' && !mine && (
          <span className="ld-media"><FileText size={13} aria-hidden /> They sent {m.msgType === 'image' ? 'a photo' : m.msgType === 'audio' ? 'a voice message' : m.msgType === 'document' ? 'a document' : m.msgType === 'location' ? 'a location' : 'something'}. Open WhatsApp on the desk phone to see it.</span>
        )}
        <span className="ch-text">{m.text}</span>
        <span className="ch-meta">
          {timeFmt.format(new Date(m.at))}
          {mine && (m.status === 'failed' ? <span className="ch-fail" title={m.error ?? undefined}>Not delivered{m.error ? `: ${m.error}` : ''}</span>
            : m.status === 'read' ? <CheckCheck size={15} aria-label="Read" className="is-read" />
              : m.status === 'delivered' ? <CheckCheck size={15} aria-label="Delivered" /> : <Check size={14} aria-label="Sent" />)}
        </span>
      </div>
    </div>
  );
}

function ActivityLine({ a }: { a: TimelineItem }) {
  const isCall = a.kind === 'call', isNote = a.kind === 'note';
  if (isCall || isNote) {
    return (
      <div className={`ld-act-card${isCall ? ' is-call' : ''}`}>
        <span className="ld-act-ic" aria-hidden>{isCall ? <PhoneCall size={14} /> : <StickyNote size={14} />}</span>
        <span className="ld-act-text"><strong>{a.byName ?? 'System'}{isCall ? ' · call' : ''}</strong> {a.text}</span>
        <span className="ld-act-time">{timeFmt.format(new Date(a.at))}</span>
      </div>
    );
  }
  return (
    <div className="ld-act">
      <span>{a.kind === 'created' ? <UserPlus size={12} aria-hidden /> : null}{a.text}{a.byName ? ` · ${a.byName}` : ''} · {timeFmt.format(new Date(a.at))}</span>
    </div>
  );
}

function LostModal({ onClose, onSave }: { onClose: () => void; onSave: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title="Not interested" onClose={onClose}
      actions={<>
        <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="crm-btn" onClick={() => onSave(reason.trim())}>Save</button>
      </>}>
      <p className="crm-sub" style={{ margin: 0 }}>Why? It helps the team see what to fix. If they write again later, the lead opens again by itself.</p>
      <div className="crm-chips">
        {LOST_REASONS.map((r) => <button key={r} type="button" className="crm-chip" aria-pressed={reason === r} onClick={() => setReason(r)}>{r}</button>)}
      </div>
      <label className="crm-field">Or in your words
        <input className="crm-input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
      </label>
    </Modal>
  );
}

interface PartnerHit { clientId: string; name: string; type: string; panchayat?: string | null }

function AddLead({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string, existed: boolean) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [source, setSource] = useState('desk');
  const [sourceRef, setSourceRef] = useState('');
  const [dept, setDept] = useState('');
  const [adNames, setAdNames] = useState<string[] | null>(null);
  // Google Ads campaign names, so "Which ad?" matches the campaign exactly.
  useEffect(() => {
    if (source !== 'google_ads' || adNames) return;
    let live = true;
    crm.get<{ google: string[] }>('/api/v1/leads/ad-campaigns').then((r) => { if (live) setAdNames(r.google); }).catch(() => { if (live) setAdNames([]); });
    return () => { live = false; };
  }, [source, adNames]);
  const [note, setNote] = useState('');
  const [mine, setMine] = useState(true);
  const [partner, setPartner] = useState<PartnerHit | null>(null);
  const [pq, setPq] = useState('');
  const [hits, setHits] = useState<PartnerHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const s = pq.trim();
    if (s.length < 2) return;
    let alive = true;
    const t = setTimeout(() => {
      crm.get<{ rows: PartnerHit[] }>(`/api/v1/partners?tab=all&pageSize=6&q=${encodeURIComponent(s)}`).then((r) => { if (alive) setHits(r.rows); }).catch(() => alive && setHits([]));
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [pq]);
  const digits = phone.replace(/\D/g, '');
  const valid = name.trim().length > 0 && (digits.length === 10 || (digits.length === 12 && digits.startsWith('91')));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await crm.post<{ id: string; existed: boolean }>('/api/v1/leads', {
        name: name.trim(), phone: digits, source, sourceRef: sourceRef.trim() || null, department: dept.trim() || null,
        note: note.trim() || null, partnerClientId: partner?.clientId ?? null, assignToMe: mine,
      });
      onAdded(r.id, r.existed);
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  };
  return (
    <Modal title="Add a lead" onClose={onClose}
      actions={<>
        <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="crm-btn" disabled={!valid || busy} onClick={() => void save()}>{busy ? 'Adding…' : 'Add lead'}</button>
      </>}>
      <div className="ld-form">
        <label className="crm-field">Name
          <input className="crm-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" />
        </label>
        <label className="crm-field">Mobile number
          <input className="crm-input" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="10 digits" maxLength={16} />
        </label>
      </div>
      <div className="crm-field">How did they reach us?
        <div className="crm-chips">
          {SOURCES.filter((s) => s.key !== 'whatsapp' && s.key !== 'partner_qr').map((s) => (
            <button key={s.key} type="button" className="crm-chip" aria-pressed={source === s.key} onClick={() => setSource(s.key)}>{s.label}</button>
          ))}
        </div>
      </div>
      {(source === 'camp' || source === 'ad' || source === 'web' || source === 'google_ads') && (
        <label className="crm-field">{source === 'camp' ? 'Which camp?' : source === 'ad' || source === 'google_ads' ? 'Which ad?' : 'Which page or campaign?'}
          <input className="crm-input" value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} maxLength={80} placeholder={source === 'camp' ? 'e.g. Kasba, 12 Nov' : source === 'google_ads' ? 'Pick the campaign' : ''}
            list={source === 'google_ads' ? 'ld-ad-campaigns' : undefined} />
          {source === 'google_ads' && (
            <>
              <datalist id="ld-ad-campaigns">{(adNames ?? []).map((n) => <option key={n} value={n} />)}</datalist>
              {adNames && adNames.length > 0 && (
                <span className="crm-chips" style={{ marginTop: 6 }}>
                  {adNames.slice(0, 6).map((n) => <button key={n} type="button" className="crm-chip" aria-pressed={sourceRef === n} onClick={() => setSourceRef(n)}>{n}</button>)}
                </span>
              )}
            </>
          )}
        </label>
      )}
      <div className="crm-field">Sent by a partner? (optional)
        {partner ? (
          <span className="ld-picked">{partner.name} <span className="crm-sub">{partner.panchayat}</span>
            <button type="button" onClick={() => setPartner(null)} aria-label="Remove partner"><X size={14} /></button></span>
        ) : (
          <>
            <input className="crm-input" value={pq} onChange={(e) => setPq(e.target.value)} placeholder="Search ASHA, RMP, shop…" />
            {pq.trim().length >= 2 && hits.length > 0 && (
              <ul className="ld-hits">
                {hits.map((h) => <li key={h.clientId}><button type="button" onClick={() => { setPartner(h); setPq(''); setHits([]); }}>{h.name} <span className="crm-sub">{[h.type, h.panchayat].filter(Boolean).join(' · ')}</span></button></li>)}
              </ul>
            )}
          </>
        )}
      </div>
      <div className="ld-form">
        <label className="crm-field">Department (optional)
          <input className="crm-input" value={dept} onChange={(e) => setDept(e.target.value)} maxLength={80} />
        </label>
        <label className="crm-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'end', height: 44 }}>
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> I&apos;ll handle it
        </label>
      </div>
      <label className="crm-field">What do they need?
        <textarea className="crm-textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Knee pain for 2 months, wants to see the orthopaedic doctor" />
      </label>
      {error && <div className="crm-error" role="alert">{error}</div>}
    </Modal>
  );
}

function CampQr({ onClose }: { onClose: () => void }) {
  const [camp, setCamp] = useState('');
  const [info, setInfo] = useState<QrPosterInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const make = async () => {
    try {
      const r = await crm.get<{ message: string; waLink: string | null; displayPhone?: string | null }>(`/api/v1/leads/link${camp.trim() ? `?camp=${encodeURIComponent(camp.trim())}` : ''}`);
      setInfo({ title: camp.trim() || orgName(), sub: camp.trim() ? 'Health camp' : undefined, waLink: r.waLink, message: r.message, displayPhone: r.displayPhone });
    } catch (e) { setError(friendlyError(e)); }
  };
  if (info) return <QrPosterModal info={info} onClose={onClose} intro={<p className="crm-sub" style={{ margin: 0 }}>Everyone who scans this lands in the leads inbox tagged with {camp.trim() ? `“${camp.trim()}”` : 'the poster'}.</p>} />;
  return (
    <Modal title="QR code for a camp or poster" onClose={onClose}
      actions={<>
        <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="crm-btn" onClick={() => void make()}>Make QR code</button>
      </>}>
      <p className="crm-sub" style={{ margin: 0 }}>People scan it and WhatsApp opens with a message to the {place()} already typed. For a partner&apos;s own code, open the partner and choose “WhatsApp QR”.</p>
      <label className="crm-field">Camp or poster name (optional)
        <input className="crm-input" value={camp} onChange={(e) => setCamp(e.target.value)} maxLength={60} placeholder="e.g. Kasba camp 12 Nov" />
      </label>
      {error && <div className="crm-error" role="alert">{error}</div>}
    </Modal>
  );
}
