'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle, ArrowRight, BellOff, Columns3, Copy, Inbox, List, Phone, RefreshCw, Search, Smartphone, Wifi, WifiOff,
} from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { canEdit, canView, useAccess } from '@/lib/crm/access';
import { timeAgo, useLiveEvents, useNow } from '@/lib/crm/live';
import { ReferralCard, sourceText, type ReferralRow } from '@/components/crm/ReferralCard';
import { PageTabs, usePageTab, type PageTab } from '@/components/crm/PageTabs';
import { Pager, usePaged } from '@/components/crm/Pager';
import {
  Empty, ErrorBox, fmt, initials, Modal, PageHead, Pill, rupees, Skeleton, STAGES, stageTone, useLoader, useToast,
} from '@/components/crm/ui';

// ─── Types and helpers ───────────────────────────────────────────────────

type BoardTab = 'desk' | 'pipeline' | 'list' | 'app';
interface Summary { expected: number; late: number; referredToday: number; arrivedToday: number; admittedToday: number; inHospital: number; admittedMonth: number; referredMonth: number }
interface AppAgent {
  agentId: string; name: string; block?: string | null; state: 'ok' | 'quiet' | 'offline' | 'never'; lastOnlineAt?: string | null; push: boolean; devices: number;
  referrals30: number; medianDelayMinutes?: number | null; lateSyncs: number; unseenUpdates: number;
}
interface AppLink {
  summary: { agents: number; online: number; quiet: number; offline: number; noPush: number; unseenUpdates: number; lateSyncs: number; lastReferralReceivedAt?: string | null };
  agents: AppAgent[];
}

const LIVE_KINDS = ['referral', 'arrived', 'opd', 'admit', 'discharged', 'lost'];
const COLUMN_COLORS: Record<string, string> = {
  pending: 'var(--accent)', arrived: 'var(--info)', opd: '#2b8de0', admitted: 'var(--ok)', procedure: 'var(--ok)', discharged: '#34a37a', lost: '#8c96ab',
};
/** The usual next step, for the one-tap button on a card. */
const NEXT: Record<string, string> = { pending: 'arrived', arrived: 'opd', opd: 'admitted', admitted: 'discharged', procedure: 'discharged' };
const label = (key: string) => STAGES.find((s) => s.key === key)?.label ?? key;
const CLOSED = ['discharged', 'lost'];
const hoursSince = (iso: string, now: number) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 3600000));
const ageText = (h: number) => (h < 1 ? 'just now' : h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`);
const phoneKey = (p?: string | null) => (p ? p.replace(/\D/g, '').slice(-10) : '');

/** Same patient phone referred more than once in what is loaded: "also referred on 3 Nov by Ravi". */
function duplicatesOf(items: ReferralRow[]): Map<string, ReferralRow[]> {
  const byPhone = new Map<string, ReferralRow[]>();
  for (const r of items) {
    const k = phoneKey(r.clientPhone);
    if (k.length < 10) continue;
    byPhone.set(k, [...(byPhone.get(k) ?? []), r]);
  }
  const out = new Map<string, ReferralRow[]>();
  for (const list of byPhone.values()) if (list.length > 1) for (const r of list) out.set(r.clientId, list.filter((x) => x.clientId !== r.clientId));
  return out;
}

// ─── Page ────────────────────────────────────────────────────────────────

export default function ReferralsBoardWrap() {
  return (
    <Suspense fallback={<main className="crm-page"><Skeleton h={520} /></main>}>
      <ReferralsBoard />
    </Suspense>
  );
}

function ReferralsBoard() {
  const { access } = useAccess();
  const params = useSearchParams();
  const router = useRouter();
  const editable = canEdit(access, 'desk') || canEdit(access, 'pipeline');
  const deskFirst = !!access && (access.role === 'HospitalRep' || !canView(access, 'pipeline'));
  const keys: BoardTab[] = ['desk', 'pipeline', 'list', 'app'];
  const [tab, setTab] = usePageTab(keys, deskFirst ? 'desk' : 'pipeline');
  const [q, setQ] = useState('');
  const [days, setDays] = useState(30);
  const [open, setOpen] = useState<ReferralRow | null>(null);
  const [toast, showToast] = useToast();

  const summary = useLoader(() => crm.get<Summary>('/api/v1/referrals/summary'));
  const list = useLoader(
    () => crm.get<{ totalCount: number; items: ReferralRow[] }>(`/api/v1/referrals?pageSize=1000${days ? `&days=${days}` : ''}${q.trim().length >= 2 ? `&search=${encodeURIComponent(q.trim())}` : ''}`),
    [days, q.trim().length >= 2 ? q.trim() : ''],
  );
  const expected = useLoader(() => crm.get<{ arrivedToday: number; items: ReferralRow[] }>('/api/v1/referrals/expected'));
  const appLink = useLoader(() => crm.get<AppLink>('/api/v1/referrals/app-link'));

  const { reload: reloadSummary } = summary, { reload: reloadList, setData: setList } = list, { reload: reloadExpected } = expected;
  const reloadAll = useCallback(() => {
    void reloadSummary(); void reloadList(); void reloadExpected();
  }, [reloadSummary, reloadList, reloadExpected]);
  const onEvent = useCallback((e: { kind: string }) => { if (LIVE_KINDS.includes(e.kind)) reloadAll(); }, [reloadAll]);
  const live = useLiveEvents(onEvent);
  // Safety net when the live connection is down (and for patients added from the Leads inbox).
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) reloadAll(); }, live === 'live' ? 120000 : 45000);
    return () => clearInterval(t);
  }, [live, reloadAll]);

  // ?r=<id> (from a notification) opens that referral.
  const rParam = params.get('r');
  useEffect(() => {
    if (!rParam) return;
    let alive = true;
    crm.get<ReferralRow>(`/api/v1/referrals/${encodeURIComponent(rParam)}`).then((r) => { if (alive) setOpen(r); }).catch(() => undefined);
    return () => { alive = false; };
  }, [rParam]);
  const closeOpen = () => {
    setOpen(null);
    if (rParam) { const sp = new URLSearchParams(params.toString()); sp.delete('r'); router.replace(`/admin/referrals${sp.size ? `?${sp}` : ''}`, { scroll: false }); }
  };

  /** Any stage change, from any tab: patch what is shown, refresh the numbers, say so. */
  const changed = useCallback((r: ReferralRow, lbl: string) => {
    setList((d) => (d ? { ...d, items: d.items.map((x) => (x.clientId === r.clientId ? r : x)) } : d));
    setOpen((o) => (o && o.clientId === r.clientId ? r : o));
    showToast(`${r.patientName}: ${lbl.toLowerCase()} · ${r.agentName.split(' ')[0]} is notified in the app.`);
    void reloadSummary(); void reloadExpected();
  }, [setList, reloadSummary, reloadExpected, showToast]);

  const move = useCallback(async (r: ReferralRow, key: string) => {
    if (r.status === key) return;
    const before = r;
    const next = { ...r, status: key, stageLabel: label(key), updatedAt: new Date().toISOString(),
      arrivedAt: r.arrivedAt ?? (key !== 'pending' && key !== 'lost' ? new Date().toISOString() : null) };
    setList((d) => (d ? { ...d, items: d.items.map((x) => (x.clientId === r.clientId ? next : x)) } : d));
    try {
      await crm.put(`/api/v1/referrals/${encodeURIComponent(r.clientId)}/status`, { status: key });
      changed(next, label(key));
    } catch {
      setList((d) => (d ? { ...d, items: d.items.map((x) => (x.clientId === r.clientId ? before : x)) } : d));
      showToast('Could not change the stage. Please try again.');
    }
  }, [setList, changed, showToast]);

  const s = summary.data;
  const al = appLink.data?.summary;
  const tabs: PageTab<BoardTab>[] = [
    { key: 'desk', label: 'Front desk', icon: Inbox, count: s?.expected ?? null },
    { key: 'pipeline', label: 'Pipeline', icon: Columns3 },
    { key: 'list', label: 'List', icon: List },
    { key: 'app', label: 'App link', icon: Smartphone, count: al ? al.offline || null : null, hot: true },
  ];

  return (
    <main className="crm-page" style={tab === 'pipeline' ? { maxWidth: 'none' } : undefined}>
      <PageHead title="Referrals"
        sub="The front desk and the pipeline in one place. Every stage you set reaches the agent's app."
        badge={<span className={`crm-live${live === 'live' ? '' : ' is-polling'}`}><span className="crm-live-dot" aria-hidden="true" />{live === 'live' ? 'LIVE' : 'AUTO-REFRESH'}</span>}>
        <label className="crm-search rf-search">
          <Search size={16} color="#5a6478" aria-hidden />
          <span className="crm-sr">Find a patient</span>
          <input type="search" placeholder="Patient name, phone or code" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </PageHead>

      <section className="rf-kpis" aria-label="Today">
        <Kpi label="Expected" value={s?.expected} note="referred, not arrived (7 days)" onClick={() => setTab('desk')} />
        <Kpi label="Late 48 h+" value={s?.late} tone={s && s.late > 0 ? 'bad' : undefined} note="call the patient" onClick={() => setTab('desk')} />
        <Kpi label="Arrived today" value={s?.arrivedToday} tone="info" />
        <Kpi label="Admitted today" value={s?.admittedToday} tone="ok" />
        <Kpi label="This month" value={s?.referredMonth} note={s ? `${s.admittedMonth} admitted · ${s.referredMonth ? Math.round((s.admittedMonth / s.referredMonth) * 100) : 0}%` : undefined} />
        <Kpi label="App link" value={al ? `${al.online}/${al.agents}` : undefined} tone={al && al.offline > 0 ? 'warn' : 'ok'}
          note={al ? (al.unseenUpdates > 0 ? `${al.unseenUpdates} updates not yet on phones` : 'agents online now') : undefined} onClick={() => setTab('app')} />
      </section>

      <PageTabs tabs={tabs} value={tab} onChange={setTab} label="Referral views" />

      {tab === 'desk' && <DeskTab q={q} expected={expected} editable={editable} onChanged={changed} />}
      {(tab === 'pipeline' || tab === 'list') && (
        <ListViews view={tab} items={list.data?.items ?? null} error={list.error} reload={list.reload} days={days} setDays={setDays}
          editable={editable} onOpen={setOpen} onMove={move} searching={q.trim().length >= 2} />
      )}
      {tab === 'app' && <AppLinkTab data={appLink.data} error={appLink.error} reload={appLink.reload} />}

      {open && (
        <Modal title="Referral" onClose={closeOpen} wide>
          <ReferralCard key={`${open.clientId}-${open.status}`} r={open} editable={editable} onUpdated={changed} />
        </Modal>
      )}
      {toast}
    </main>
  );
}

function Kpi({ label: l, value, note, tone, onClick }: { label: string; value?: number | string; note?: string; tone?: 'ok' | 'bad' | 'warn' | 'info'; onClick?: () => void }) {
  const body = (
    <>
      <span className="rf-kpi-label">{l}</span>
      <span className={`rf-kpi-value${tone ? ` is-${tone}` : ''}`}>{value ?? '—'}</span>
      {note && <span className="rf-kpi-note">{note}</span>}
    </>
  );
  return onClick ? <button type="button" className="crm-card rf-kpi" onClick={onClick}>{body}</button> : <div className="crm-card rf-kpi">{body}</div>;
}

// ─── Front desk ──────────────────────────────────────────────────────────

function DeskTab({ q, expected, editable, onChanged }: {
  q: string; expected: ReturnType<typeof useLoader<{ arrivedToday: number; items: ReferralRow[] }>>; editable: boolean; onChanged: (r: ReferralRow, l: string) => void;
}) {
  const [rawResults, setResults] = useState<ReferralRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ReferralRow | null>(null);
  const expPg = usePaged(expected.data?.items ?? [], '', 15);
  const term = q.trim();

  useEffect(() => {
    if (term.length < 3) return;
    let alive = true;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const rows = await crm.get<ReferralRow[]>(`/api/v1/referrals/search?q=${encodeURIComponent(term)}`);
        if (!alive) return;
        setResults(rows);
        if (rows.length === 1) setSelected(rows[0]);
      } catch { if (alive) setResults([]); } finally { if (alive) setSearching(false); }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [term]);
  const results = term.length < 3 ? null : rawResults;

  const updated = (r: ReferralRow, l: string) => {
    setSelected(r);
    setResults((list) => list?.map((x) => (x.clientId === r.clientId ? r : x)) ?? null);
    onChanged(r, l);
  };

  return (
    <>
      {term.length > 0 && (
        <section className="crm-card" aria-label="Search results" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="crm-sub" style={{ fontSize: 13 }}>
            {term.length < 3 ? 'Type at least 3 characters — the last digits of the phone number work best.' : searching ? 'Searching…' : `${results?.length ?? 0} match${results?.length === 1 ? '' : 'es'} for “${term}”`}
          </span>
          {results && results.length > 1 && (
            <ul className="crm-list">
              {results.map((r) => (
                <li key={r.clientId}>
                  <button type="button" className="rf-hit" onClick={() => setSelected(r)} aria-current={selected?.clientId === r.clientId ? 'true' : undefined}>
                    <span className="crm-initials">{initials(r.patientName)}</span>
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span style={{ fontWeight: 600 }}>{r.patientName}{r.urgent && <> <Pill tone="bad">Urgent</Pill></>}</span>
                      <span className="crm-cell-sub">{[r.department, r.contactName, r.clientPhone, fmt.date(r.createdAt)].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span style={{ marginLeft: 'auto' }}><Pill tone={stageTone(r.status)}>{r.stageLabel}</Pill></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {results && results.length === 0 && !searching && <Empty title="No referral found">Check the number, or ask the patient who referred them. They may be in the Leads inbox if they came through WhatsApp or a QR code.</Empty>}
        </section>
      )}

      <div className="crm-row">
        <section className="crm-card grow-3" style={{ flexBasis: 560 }} aria-label="Selected referral">
          {selected ? <ReferralCard key={`${selected.clientId}-${selected.status}`} r={selected} editable={editable} onUpdated={updated} />
            : <Empty title="No patient selected">Search at the top (phone, name or referral code), or pick someone from the expected list.</Empty>}
        </section>

        <aside className="crm-card grow-1" aria-labelledby="exp-h" style={{ flexBasis: 360 }}>
          <div className="crm-card-head">
            <h2 id="exp-h" className="crm-h2">Expected</h2>
            {expected.data && <span className="crm-sub" style={{ fontSize: 13 }}>{expected.data.items.length} in the last 7 days · {expected.data.arrivedToday} arrived today</span>}
          </div>
          {expected.error && <ErrorBox message={expected.error} onRetry={expected.reload} />}
          {!expected.data ? <Skeleton h={240} /> : expected.data.items.length === 0 ? <Empty title="Nobody waiting">Every recent referral has arrived.</Empty> : (
            <ul className="crm-list">
              {expPg.rows.map((r) => <ExpectedRow key={r.clientId} r={r} editable={editable} active={selected?.clientId === r.clientId} onOpen={() => setSelected(r)} onUpdated={updated} />)}
            </ul>
          )}
          {expected.data && <Pager {...expPg.pager} noun="patients" compact />}
        </aside>
      </div>
    </>
  );
}

function ExpectedRow({ r, editable, active, onOpen, onUpdated }: { r: ReferralRow; editable: boolean; active: boolean; onOpen: () => void; onUpdated: (r: ReferralRow, l: string) => void }) {
  const [busy, setBusy] = useState(false);
  const now = useNow(60000);
  const waitingDays = Math.floor((now - new Date(r.createdAt).getTime()) / 86400000);
  const markArrived = async () => {
    setBusy(true);
    try {
      await crm.put(`/api/v1/referrals/${encodeURIComponent(r.clientId)}/status`, { status: 'arrived' });
      onUpdated({ ...r, status: 'arrived', stageLabel: 'Arrived', arrivedAt: new Date().toISOString() }, 'Arrived');
    } finally { setBusy(false); }
  };
  return (
    <li className={active ? 'rf-exp is-active' : 'rf-exp'}>
      <button type="button" onClick={onOpen} className="rf-exp-main">
        <span style={{ fontSize: 15, fontWeight: 600, display: 'flex', gap: 6, alignItems: 'center' }}>{r.patientName}{r.urgent && <Pill tone="bad">Urgent</Pill>}</span>
        <span style={{ fontSize: 12, color: waitingDays >= 2 ? 'var(--bad)' : 'var(--text-2)' }}>
          {[r.department, r.block].filter(Boolean).join(' · ')}{waitingDays >= 1 ? ` · waiting ${waitingDays} day${waitingDays === 1 ? '' : 's'}` : ' · today'}
        </span>
      </button>
      {r.clientPhone && <a className="rf-icon-btn" href={`tel:${r.clientPhone.replace(/[^\d+]/g, '')}`} aria-label={`Call ${r.patientName}`} title="Call the patient"><Phone size={15} /></a>}
      {editable && (
        <button type="button" className="crm-btn is-secondary is-sm" disabled={busy} onClick={markArrived} style={{ borderColor: 'var(--info)', color: 'var(--info-ink)', flexShrink: 0 }}>
          {busy ? '…' : 'Arrived'}
        </button>
      )}
    </li>
  );
}

// ─── Pipeline and list ───────────────────────────────────────────────────

function ListViews({ view, items, error, reload, days, setDays, editable, onOpen, onMove, searching }: {
  view: 'pipeline' | 'list'; items: ReferralRow[] | null; error: string | null; reload: () => void; days: number; setDays: (d: number) => void;
  editable: boolean; onOpen: (r: ReferralRow) => void; onMove: (r: ReferralRow, key: string) => void; searching: boolean;
}) {
  const now = useNow(60000);
  const [dept, setDept] = useState('');
  const [agent, setAgent] = useState('');
  const [block, setBlock] = useState('');
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [lateOnly, setLateOnly] = useState(false);
  const [showClosed, setShowClosed] = useState(true);
  const [source, setSource] = useState('');

  const all = useMemo(() => items ?? [], [items]);
  const dups = useMemo(() => duplicatesOf(all), [all]);
  const opts = useMemo(() => ({
    depts: [...new Set(all.map((r) => r.department).filter(Boolean))].sort(),
    agents: [...new Map(all.map((r) => [r.agentId, r.agentName])).entries()].sort((a, b) => a[1].localeCompare(b[1])),
    blocks: [...new Set(all.map((r) => r.block).filter(Boolean) as string[])].sort(),
  }), [all]);
  const visible = all.filter((r) => (!dept || r.department === dept) && (!agent || r.agentId === agent) && (!block || r.block === block)
    && (!urgentOnly || r.urgent) && (!source || (r.source ?? 'app') === source)
    && (!lateOnly || (r.status === 'pending' && hoursSince(r.createdAt, now) >= 48))
    && (showClosed || view === 'list' || !CLOSED.includes(r.status)));
  const active = dept || agent || block || urgentOnly || lateOnly || source || !showClosed;
  const clear = () => { setDept(''); setAgent(''); setBlock(''); setUrgentOnly(false); setLateOnly(false); setSource(''); setShowClosed(true); };

  return (
    <>
      <div className="rf-filters" aria-label="Filters">
        <select className="crm-input rf-sel" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
          <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={0}>All time</option>
        </select>
        <select className="crm-input rf-sel" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
          <option value="">All departments</option>{opts.depts.map((d) => <option key={d}>{d}</option>)}
        </select>
        <select className="crm-input rf-sel" value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Field agent">
          <option value="">All agents</option>{opts.agents.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
        </select>
        {opts.blocks.length > 1 && (
          <select className="crm-input rf-sel" value={block} onChange={(e) => setBlock(e.target.value)} aria-label="Block">
            <option value="">All blocks</option>{opts.blocks.map((b) => <option key={b}>{b}</option>)}
          </select>
        )}
        <select className="crm-input rf-sel" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Came from">
          <option value="">From anywhere</option><option value="app">Agents&apos; app</option><option value="leads">Leads inbox</option>
        </select>
        <button type="button" className="crm-chip" aria-pressed={urgentOnly} onClick={() => setUrgentOnly((u) => !u)}>Urgent</button>
        <button type="button" className="crm-chip" aria-pressed={lateOnly} onClick={() => setLateOnly((u) => !u)}>Late 48 h+</button>
        {view === 'pipeline' && <button type="button" className="crm-chip" aria-pressed={!showClosed} onClick={() => setShowClosed((u) => !u)}>Hide discharged &amp; lost</button>}
        {active && <button type="button" className="rf-link" onClick={clear}>Clear</button>}
        <span className="crm-sub rf-count">{visible.length} of {all.length}{searching ? ' matching the search' : ''}</span>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!items ? (
        <div style={{ display: 'flex', gap: 14 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={360} w={260} />)}</div>
      ) : all.length === 0 ? (
        <div className="crm-card"><Empty title={searching ? 'Nobody matches the search' : 'No referrals in this period'}>Referrals logged in the agents&apos; app appear here as soon as the phone syncs.</Empty></div>
      ) : view === 'pipeline' ? (
        <Pipeline items={visible} all={all} dups={dups} now={now} editable={editable} onOpen={onOpen} onMove={onMove} />
      ) : (
        <Table items={visible} dups={dups} now={now} onOpen={onOpen} />
      )}
    </>
  );
}

function Pipeline({ items, all, dups, now, editable, onOpen, onMove }: {
  items: ReferralRow[]; all: ReferralRow[]; dups: Map<string, ReferralRow[]>; now: number; editable: boolean; onOpen: (r: ReferralRow) => void; onMove: (r: ReferralRow, key: string) => void;
}) {
  const [shown, setShown] = useState<Record<string, number>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const columns = STAGES.map((s) => ({ ...s, cards: items.filter((r) => r.status === s.key || (s.key === 'admitted' && r.status === 'converted')) }));
  return (
    <div className="rf-board">
      {columns.map((col) => {
        const late = col.key === 'pending' ? col.cards.filter((r) => hoursSince(r.createdAt, now) >= 48).length : 0;
        return (
          <section key={col.key} aria-label={col.label} className={`rf-col${over === col.key ? ' is-over' : ''}`}
            onDragOver={(e) => { if (editable && dragging) { e.preventDefault(); setOver(col.key); } }}
            onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
            onDrop={(e) => { e.preventDefault(); const r = all.find((x) => x.clientId === dragging); setDragging(null); setOver(null); if (r) onMove(r, col.key); }}>
            <div className="rf-col-head">
              <span className="rf-dot" style={{ background: COLUMN_COLORS[col.key] }} />
              <h2>{col.label}</h2>
              <span className="rf-col-n">{col.cards.length}</span>
              {late > 0 && <span className="rf-col-late" title="Waiting more than 48 hours">{late} late</span>}
            </div>
            {col.cards.slice(0, shown[col.key] ?? 20).map((r) => (
              <PipeCard key={r.clientId} r={r} dup={dups.get(r.clientId)} now={now} editable={editable} dragging={dragging === r.clientId}
                onDragStart={() => setDragging(r.clientId)} onDragEnd={() => { setDragging(null); setOver(null); }}
                onOpen={() => onOpen(r)} onNext={NEXT[r.status] ? () => onMove(r, NEXT[r.status]) : undefined} />
            ))}
            {col.cards.length === 0 && <span className="rf-col-empty">{editable ? 'Drop a card here' : 'Nobody here'}</span>}
            {col.cards.length > (shown[col.key] ?? 20) && (
              <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setShown((x) => ({ ...x, [col.key]: (x[col.key] ?? 20) + 20 }))}>
                Show {Math.min(20, col.cards.length - (shown[col.key] ?? 20))} more · {col.cards.length - (shown[col.key] ?? 20)} left
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}

function PipeCard({ r, dup, now, editable, dragging, onDragStart, onDragEnd, onOpen, onNext }: {
  r: ReferralRow; dup?: ReferralRow[]; now: number; editable: boolean; dragging: boolean;
  onDragStart: () => void; onDragEnd: () => void; onOpen: () => void; onNext?: () => void;
}) {
  const age = hoursSince(r.createdAt, now);
  const inStage = hoursSince(r.updatedAt ?? r.createdAt, now);
  const late = r.status === 'pending' && age >= 48;
  const slowSync = r.source === 'app' && (r.syncDelayMinutes ?? 0) >= 60;
  return (
    <article className={`rf-card${dragging ? ' is-dragging' : ''}${late ? ' is-late' : ''}`} draggable={editable} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <button type="button" className="rf-card-main" onClick={onOpen}>
        <span className="rf-card-top">
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span className="rf-card-name">{r.patientName}</span>
            <span className="rf-card-sub">{[r.patientSex, r.patientAge, r.block].filter(Boolean).join(' · ')}</span>
          </span>
          {r.urgent && <span style={{ marginLeft: 'auto' }}><Pill tone="bad">Urgent</Pill></span>}
        </span>
        <span className="rf-card-tags">
          {r.department && <span className="rf-tag is-dept">{r.department}</span>}
          {r.source === 'leads' && <span className="rf-tag is-leads" title="Came through WhatsApp or a partner QR code">Leads inbox</span>}
          {slowSync && <span className="rf-tag is-warn" title={sourceText(r)}><WifiOff size={11} aria-hidden /> synced late</span>}
          {dup && dup.length > 0 && <span className="rf-tag is-dup" title={`Also referred: ${dup.map((d) => `${fmt.date(d.createdAt)} by ${d.agentName}`).join('; ')}`}><Copy size={11} aria-hidden /> also referred</span>}
        </span>
        <span className="rf-card-foot">
          <span className="rf-avatar" title={r.agentName}>{initials(r.agentName)}</span>
          <span className="rf-card-via">via {r.contactName}</span>
          <span className={`rf-card-age${late ? ' is-late' : ''}`} title={`Referred ${fmt.dateTime(r.createdAt)}${r.status !== 'pending' ? ` · in this stage ${ageText(inStage)}` : ''}`}>
            {r.status === 'pending' ? ageText(age) : ageText(inStage)}
          </span>
        </span>
      </button>
      {editable && onNext && (
        <button type="button" className="rf-next" onClick={onNext} aria-label={`Move ${r.patientName} to ${label(NEXT[r.status])}`}>
          {label(NEXT[r.status])} <ArrowRight size={13} aria-hidden />
        </button>
      )}
    </article>
  );
}

function Table({ items, dups, now, onOpen }: { items: ReferralRow[]; dups: Map<string, ReferralRow[]>; now: number; onOpen: (r: ReferralRow) => void }) {
  const [sort, setSort] = useState<'new' | 'old' | 'stage'>('new');
  const order = STAGES.map((s) => s.key);
  const sorted = [...items].sort((a, b) => sort === 'new' ? b.createdAt.localeCompare(a.createdAt) : sort === 'old' ? a.createdAt.localeCompare(b.createdAt)
    : order.indexOf(a.status) - order.indexOf(b.status) || b.createdAt.localeCompare(a.createdAt));
  const pg = usePaged(sorted, sort, 25);
  return (
    <section className="crm-card is-flush" aria-label="Referrals">
      <div className="crm-card-head" style={{ padding: '14px 18px 0' }}>
        <span className="crm-sub" style={{ fontSize: 13 }}>Sort</span>
        {(['new', 'old', 'stage'] as const).map((k) => <button key={k} type="button" className="crm-chip" aria-pressed={sort === k} onClick={() => setSort(k)}>{k === 'new' ? 'Newest' : k === 'old' ? 'Oldest' : 'Stage'}</button>)}
      </div>
      <div className="crm-table-wrap">
        <table className="crm-table" style={{ minWidth: 1020 }}>
          <thead><tr><th>Patient</th><th>Department</th><th>Referred by</th><th>Agent</th><th>Referred</th><th>Stage</th><th className="num">Billed</th><th>Partner paid</th><th>Came from</th></tr></thead>
          <tbody>
            {pg.rows.map((r) => {
              const late = r.status === 'pending' && hoursSince(r.createdAt, now) >= 48;
              return (
                <tr key={r.clientId} className="rf-row" onClick={() => onOpen(r)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(r); }}>
                  <td>
                    <div className="crm-cell-main">{r.patientName}{r.urgent && <> <Pill tone="bad">Urgent</Pill></>}{dups.has(r.clientId) && <> <span className="rf-tag is-dup">also referred</span></>}</div>
                    <div className="crm-cell-sub">{[r.patientSex, r.patientAge, r.clientPhone].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td>{r.department || '—'}</td>
                  <td><div>{r.contactName}</div><div className="crm-cell-sub">{r.block ?? ''}</div></td>
                  <td style={{ color: 'var(--text-2)' }}>{r.agentName}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmt.date(r.createdAt)}</td>
                  <td><Pill tone={late ? 'warn' : stageTone(r.status)} dot>{late ? `Waiting ${Math.floor(hoursSince(r.createdAt, now) / 24)} days` : r.stageLabel}</Pill></td>
                  <td className="num">{r.money && r.money.billed > 0 ? <><div>{rupees(r.money.billed)}</div>{r.money.collected < r.money.billed && <div className="crm-cell-sub" style={{ color: 'var(--warn-ink)' }}>{rupees(r.money.billed - r.money.collected)} due</div>}</> : <span className="crm-cell-sub">—</span>}</td>
                  <td>{r.money && r.money.payouts > 0 ? <><div>{rupees(r.money.payoutsPaid)}</div>{r.money.payoutsOpen > 0 && <div className="crm-cell-sub" style={{ color: 'var(--warn-ink)' }}>{rupees(r.money.payoutsOpen)} waiting</div>}</> : <span className="crm-cell-sub">—</span>}</td>
                  <td className="crm-cell-sub">{r.source === 'leads' ? 'Leads inbox' : (r.syncDelayMinutes ?? 0) >= 60 ? <span style={{ color: 'var(--warn-ink)' }}>App · synced late</span> : 'App'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager {...pg.pager} noun="referrals" />
    </section>
  );
}

// ─── App link ────────────────────────────────────────────────────────────

const STATE: Record<AppAgent['state'], { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' }> = {
  ok: { label: 'Online', tone: 'ok' }, quiet: { label: 'Quiet today', tone: 'warn' }, offline: { label: 'Offline 1 day+', tone: 'bad' }, never: { label: 'Never signed in', tone: 'neutral' },
};

function AppLinkTab({ data, error, reload }: { data: AppLink | null; error: string | null; reload: () => Promise<unknown> | void }) {
  const now = useNow(60000);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Skeleton h={320} />;
  const s = data.summary;
  return (
    <>
      <section className="crm-card rf-howto">
        <Smartphone size={20} aria-hidden />
        <div>
          <strong>How the app and the board stay in step</strong>
          <p>A referral made in the agent&apos;s app reaches this board as soon as the phone has signal. When you change a stage, the agent gets a notification at once and the phone shows the new stage, with the time and your note, the next time the app syncs (when it opens, comes back online, or every 2 minutes on shift).</p>
        </div>
        <button type="button" className="crm-btn is-secondary is-sm" onClick={async () => { setBusy(true); await reload(); setBusy(false); }} disabled={busy}><RefreshCw size={14} aria-hidden /> {busy ? 'Checking…' : 'Check again'}</button>
      </section>

      <section className="rf-kpis" aria-label="Connection summary">
        <Kpi label="Online now" value={`${s.online}/${s.agents}`} tone="ok" note="app checked in within 2 hours" />
        <Kpi label="Quiet today" value={s.quiet} tone={s.quiet ? 'warn' : undefined} note="not in the last 2 hours" />
        <Kpi label="Offline" value={s.offline} tone={s.offline ? 'bad' : undefined} note="over a day, or never signed in" />
        <Kpi label="No push" value={s.noPush} tone={s.noPush ? 'warn' : undefined} note="see updates only when the app opens" />
        <Kpi label="Not yet on phones" value={s.unseenUpdates} tone={s.unseenUpdates ? 'warn' : undefined} note="stage changes since the app last synced" />
        <Kpi label="Last referral in" value={s.lastReferralReceivedAt ? timeAgo(s.lastReferralReceivedAt, now) : '—'} note={`${s.lateSyncs} synced over an hour late (30 days)`} />
      </section>

      <section className="crm-card is-flush" aria-label="Agents">
        <div className="crm-table-wrap">
          <table className="crm-table" style={{ minWidth: 820 }}>
            <thead><tr><th>Agent</th><th>App</th><th>Push</th><th className="num">Referrals (30 d)</th><th>Typical sync</th><th className="num">Late syncs</th><th>Updates not on phone</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {data.agents.map((a) => (
                <tr key={a.agentId}>
                  <td><div className="crm-cell-main">{a.name}</div><div className="crm-cell-sub">{[a.block, a.agentId].filter(Boolean).join(' · ')}</div></td>
                  <td>
                    <Pill tone={STATE[a.state].tone} dot>{a.state === 'ok' ? <><Wifi size={11} aria-hidden /> Online</> : STATE[a.state].label}</Pill>
                    <div className="crm-cell-sub">{a.lastOnlineAt ? `last seen ${timeAgo(a.lastOnlineAt, now)}` : 'no sign of the app yet'}{a.devices > 1 ? ` · ${a.devices} phones` : ''}</div>
                  </td>
                  <td>{a.push ? <span style={{ color: 'var(--ok-ink)', fontWeight: 600 }}>On</span> : <span className="rf-nopush" title="Notifications can't reach this phone: they appear when the agent opens the app"><BellOff size={13} aria-hidden /> Off</span>}</td>
                  <td className="num">{a.referrals30}</td>
                  <td>{a.medianDelayMinutes == null ? '—' : a.medianDelayMinutes <= 2 ? 'Instant' : a.medianDelayMinutes < 60 ? `${a.medianDelayMinutes} min` : `${Math.round(a.medianDelayMinutes / 60)} h`}</td>
                  <td className="num" style={{ color: a.lateSyncs ? 'var(--warn-ink)' : undefined }}>{a.lateSyncs}</td>
                  <td>{a.unseenUpdates > 0 ? <span className="rf-unseen"><AlertTriangle size={13} aria-hidden /> {a.unseenUpdates} waiting</span> : <span className="crm-sub">Up to date</span>}</td>
                  <td><Link href="/admin/chat" className="rf-link">Message</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="crm-sub" style={{ fontSize: 12 }}>
        &ldquo;Online&rdquo; means the app signed in, sent a location or synced data within 2 hours. If push is off, ask the agent to allow notifications for NexEagle and open the app once. Late syncs usually mean no signal in the field; nothing is lost, it all arrives once the phone is back online.
      </p>
    </>
  );
}
