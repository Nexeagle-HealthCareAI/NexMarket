'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import {
  ArrowRight, AtSign, CalendarCheck, CheckCircle2, ChevronRight, ClipboardList, Columns3, Inbox, LayoutDashboard, MessageCircle, PhoneCall, RefreshCw, Sparkles, Star, Tent, UserPlus, Users, Wallet,
} from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { canView, useAccess } from '@/lib/crm/access';
import { timeAgo, useLiveEvents, useNow, type LiveEvent } from '@/lib/crm/live';
import { Pager, usePaged } from '@/components/crm/Pager';
import { PageTabs, usePageTab, type PageTab } from '@/components/crm/PageTabs';
import { openVita } from '@/components/crm/VitaChat';
import {
  contactTypeLabel, ErrorBox, Empty, fmt, initials, PageHead, Pill, rupees, Skeleton, stageTone, useLoader,
} from '@/components/crm/ui';

interface Summary {
  generatedAt: string;
  kpis: { agentsOnShift: number; totalAgents: number; visitsToday: number; referralsToday: number; arrivedMonth: number; admissionsMonth: number; admissionsLastMonth: number };
  funnel: { stage: string; count: number }[];
  lost: number;
  alerts: { notArrived48: number; overdueFollowUps: number; needsVisit: number; openEscalations: number };
  latestReferrals: {
    clientId: string; patientName: string; patientAge?: number | null; patientSex?: string | null; department: string; urgent: boolean; createdAt: string;
    status: string; stageLabel: string; waitingHours: number; partner?: string | null; partnerType?: string | null; block?: string | null; agent: string;
  }[];
  topPartners: { clientId: string; name: string; type?: string | null; important: boolean; referred: number; admitted: number }[];
  fieldForce: { agentId: string; name: string; block: string; status: string; tone: 'on' | 'idle' | 'off'; visits: number; referrals: number }[];
  work: {
    calls: { cycle: number; due: number; done: number; retry: number; cycleTotal: number; cycleCalled: number };
    desk: { expected: number; arrivedToday: number; late: number };
    payments: { toPay: number; waitingApproval: number; overdue: number };
    whatsapp: { connected: boolean; scheduled: number; lastTitle?: string | null; lastReadPct?: number | null; lastReplies?: number | null };
  };
}

/** The rest of the picture (leads, inboxes, camps, tasks, leave, spend, trends) — loaded alongside the summary. */
interface Overview {
  trend: { days: string[]; visits: number[]; referrals: number[]; leads: number[]; arrived: number[]; admitted: number[] };
  leads: {
    today: number; yesterday: number; month: number; waiting: number; targetMinutes: number; medianReplyMinutes: number | null;
    appointments: number; won: number; lost: number; sources: { source: string; label: string; count: number; won: number }[];
  };
  inbox: { waUnread: number; waWaiting: number; socialUnread: number; socialWaiting: number; formLeadsToday: number; formLeadsMonth: number };
  camps: {
    upcoming: { id: string; title: string; date: string; block?: string | null; venue?: string | null; status: string; booked: number; target: number; daysAway: number }[];
    doneThisMonth: number; attendedThisMonth: number; referredThisMonth: number; atRisk: number;
  };
  tasks: { open: number; overdue: number; doneToday: number };
  leave: { pending: number; onLeaveToday: number };
  waSpend: { spent: number; budget: number; alertPercent: number; currency: string; at?: string | null } | null;
  departments: { name: string; referrals: number; leads: number; admitted: number }[];
}

type Access = ReturnType<typeof useAccess>['access'];
const canLeads = (a: Access) => canView(a, 'desk') || canView(a, 'whatsapp');

interface FeedItem extends LiveEvent { key: string; fresh?: boolean }

const KIND_STYLE: Record<string, { tag: string; tone: string }> = {
  visit: { tag: 'VIS', tone: 'accent' },
  referral: { tag: 'REF', tone: 'warn' },
  arrived: { tag: 'ARR', tone: 'info' },
  opd: { tag: 'OPD', tone: 'info' },
  admit: { tag: 'ADM', tone: 'ok' },
  discharged: { tag: 'DIS', tone: 'ok' },
  lost: { tag: 'LOST', tone: 'neutral' },
  partner: { tag: 'NEW', tone: 'neutral' },
  shift: { tag: 'ON', tone: 'accent' },
  call: { tag: 'CALL', tone: 'accent' },
  payment: { tag: '₹', tone: 'warn' },
  broadcast: { tag: 'WA', tone: 'ok' },
};

const TONE_BG: Record<string, [string, string]> = {
  accent: ['var(--accent-soft)', 'var(--accent-ink)'],
  warn: ['var(--warn-soft)', 'var(--warn-ink)'],
  info: ['var(--info-soft)', 'var(--info-ink)'],
  ok: ['var(--ok-soft)', 'var(--ok-ink)'],
  bad: ['var(--bad-soft)', 'var(--bad)'],
  neutral: ['var(--grey-soft)', 'var(--text-3)'],
};

/** Which KPI tile glows for each live event kind. */
const KIND_KPI: Record<string, string> = { visit: 'visits', referral: 'refs', arrived: 'arrived', admit: 'admissions', shift: 'agents' };

export default function CommandCentrePage() {
  return (
    <Suspense fallback={<main className="crm-page"><Skeleton h={520} /></main>}>
      <CommandCentre />
    </Suspense>
  );
}

type CcTab = 'overview' | 'referrals' | 'leads' | 'field';
const TAB_LABEL: Record<CcTab, string> = { overview: 'Overview', referrals: 'Referrals', leads: 'Leads & channels', field: 'Field team' };
const TAB_ICON: Record<CcTab, PageTab['icon']> = { overview: LayoutDashboard, referrals: Columns3, leads: UserPlus, field: Users };

function CommandCentre() {
  const { access } = useAccess();
  const now = useNow(1000);
  const { data, error, loading, reload: reloadSummary } = useLoader(() => crm.get<Summary>('/api/v1/dashboard/summary'));
  // The overview is a nice-to-have: if it fails, the rest of the page still works.
  const { data: ov, reload: reloadOverview } = useLoader(() => crm.get<Overview>('/api/v1/dashboard/overview').catch(() => null));
  const reload = useCallback(() => Promise.all([reloadSummary(), reloadOverview()]).then(() => undefined), [reloadSummary, reloadOverview]);
  const refPg = usePaged(data?.latestReferrals ?? [], '', 10);
  const showLeads = canLeads(access) || canView(access, 'social') || canView(access, 'camps');
  const showField = canView(access, 'field') || canView(access, 'calls');
  const keys = (['overview', 'referrals', 'leads', 'field'] as const).filter((k) => (k === 'leads' ? showLeads : k === 'field' ? showField : true));
  const [tab, setTab] = usePageTab(keys, 'overview');
  const actions = data ? buildActions(data, ov ?? null, access) : [];
  const tabs: PageTab<CcTab>[] = keys.map((k) => ({
    key: k,
    label: TAB_LABEL[k],
    icon: TAB_ICON[k],
    count: k === 'overview' ? actions.filter((a) => a.tone === 'bad').length || null
      : k === 'leads' && ov ? (ov.leads.waiting + ov.inbox.waWaiting + ov.inbox.socialWaiting) || null
      : k === 'referrals' && data ? data.alerts.notArrived48 || null
      : k === 'field' && ov ? ov.tasks.overdue || null : null,
    hot: true,
  }));
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [paused, setPaused] = useState(false);
  const [flash, setFlash] = useState<{ kpi: string; at: number } | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number>(() => Date.now());
  const [freshRefs, setFreshRefs] = useState<Set<string>>(new Set());
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const loadFeed = useCallback(async () => {
    try {
      const items = await crm.get<LiveEvent[]>('/api/v1/dashboard/activity?take=12');
      setFeed(items.map((e, i) => ({ ...e, key: `${e.at}-${i}` })));
    } catch { /* feed is a nice-to-have */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    crm.get<LiveEvent[]>('/api/v1/dashboard/activity?take=12')
      .then((items) => { if (!cancelled) setFeed(items.map((e, i) => ({ ...e, key: `${e.at}-${i}` }))); })
      .catch(() => { /* feed is a nice-to-have */ });
    return () => { cancelled = true; };
  }, []);

  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => {
      void reload().then(() => setLastUpdate(Date.now()));
    }, 1500);
  }, [reload]);

  const onEvent = useCallback((e: LiveEvent) => {
    if (pausedRef.current) return;
    setFeed((f) => [{ ...e, key: `${e.at}-${Math.random()}`, fresh: true }, ...f].slice(0, 12));
    const kpi = KIND_KPI[e.kind];
    if (kpi) setFlash({ kpi, at: Date.now() });
    if (e.kind === 'referral' && e.refId) setFreshRefs((s) => new Set(s).add(e.refId!));
    setLastUpdate(Date.now());
    scheduleReload();
  }, [scheduleReload]);

  const status = useLiveEvents(onEvent);

  // Safety net: refresh every 60 s when live, every 30 s when the socket is down.
  useEffect(() => {
    const t = setInterval(() => {
      if (pausedRef.current) return;
      void reload().then(() => setLastUpdate(Date.now()));
      if (status !== 'live') void loadFeed();
    }, status === 'live' ? 60000 : 30000);
    return () => clearInterval(t);
  }, [status, reload, loadFeed]);

  useEffect(() => () => { if (reloadTimer.current) clearTimeout(reloadTimer.current); }, []);

  const flashing = (k: string) => !!flash && flash.kpi === k && now - flash.at < 1800;
  const k = data?.kpis;
  const admissionsDelta = k && k.admissionsLastMonth > 0 ? Math.round(((k.admissionsMonth - k.admissionsLastMonth) / k.admissionsLastMonth) * 100) : null;
  const referredTotal = data?.funnel[0]?.count ?? 0;
  const admittedCount = data?.funnel.find((f) => f.stage === 'Admitted')?.count ?? 0;
  const arrivedCount = data?.funnel.find((f) => f.stage === 'Arrived')?.count ?? 0;

  return (
    <main className="crm-page">
      <PageHead
        title="Command centre"
        badge={
          <span className={`crm-live${status === 'live' ? '' : ' is-polling'}`} title={status === 'live' ? 'Updates arrive as they happen' : 'Refreshing every 30 seconds'}>
            <span className="crm-live-dot" aria-hidden="true" />
            {status === 'live' ? 'LIVE' : status === 'connecting' ? 'CONNECTING' : 'AUTO-REFRESH'}
          </span>
        }
        sub={
          <span aria-live="polite">
            {fmt.today()}
            {k && <> · {k.agentsOnShift} of {k.totalAgents} agents in the field</>}
            {' · '}updated {timeAgo(new Date(lastUpdate).toISOString(), now)}
          </span>
        }
      />

      {error && <ErrorBox message={error} onRetry={reload} />}

      <PageTabs tabs={tabs} value={tab} onChange={setTab} label="Command centre sections" />

      {tab === 'overview' && (
        <>
          <VitaRead key="overview" tab="overview" access={access} />
          {data && <ActionQueue actions={actions} />}

      <section aria-label="Today at a glance" className="crm-kpis cc-kpis">
        {!data && loading
          ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="crm-card"><Skeleton h={14} w="60%" /><Skeleton h={30} w="40%" style={{ marginTop: 12 }} /></div>)
          : k && (
            <>
              <Kpi label="Agents on shift" value={k.agentsOnShift} unit={`of ${k.totalAgents}`} flash={flashing('agents')}
                note={k.totalAgents - k.agentsOnShift > 0 ? `${k.totalAgents - k.agentsOnShift} not checked in` : 'Everyone is out'} tone={k.totalAgents - k.agentsOnShift > 0 ? 'bad' : 'ok'} />
              <Kpi label="Visits today" value={k.visitsToday} flash={flashing('visits')} spark={ov?.trend.visits} color="#0a72d6" />
              <Kpi label="Referrals today" value={k.referralsToday} flash={flashing('refs')} spark={ov?.trend.referrals} color="#d9822b" />
              {ov && canLeads(access) && (
                <Kpi label="New leads today" value={ov.leads.today} spark={ov.trend.leads} color="#7c5cd6"
                  note={ov.leads.yesterday > 0 || ov.leads.today > 0 ? `${ov.leads.yesterday} yesterday` : undefined} tone="neutral" />
              )}
              <Kpi label="Arrived this month" value={k.arrivedMonth} flash={flashing('arrived')} spark={ov?.trend.arrived} color="#0e7490"
                note={referredTotal > 0 ? `${Math.round((arrivedCount / referredTotal) * 100)}% of referred` : undefined} tone="ok" />
              <Kpi label="Admissions this month" value={k.admissionsMonth} flash={flashing('admissions')} spark={ov?.trend.admitted} color="#0f8a5f"
                note={admissionsDelta !== null ? `${admissionsDelta >= 0 ? '+' : ''}${admissionsDelta}% vs last month` : undefined}
                tone={admissionsDelta !== null && admissionsDelta < 0 ? 'bad' : 'ok'} />
            </>
          )}
      </section>
      {ov && <p className="crm-sub cc-spark-note">Small charts show the last 14 days.</p>}

          {data && <TodaysWork work={data.work} ov={ov ?? null} access={access} />}

          <div className="crm-row">
            {canView(access, 'analytics') && <Briefings />}
        <section className="crm-card grow-1" aria-labelledby="live-h">
          <div className="crm-card-head">
            <h2 id="live-h" className="crm-h2">Live activity</h2>
            {status === 'live' && <span className="crm-live-dot" aria-hidden="true" />}
            <button type="button" className="crm-chip" style={{ marginLeft: 'auto', height: 32 }} onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
              {paused ? 'Resume' : 'Pause'}
            </button>
          </div>
          {feed.length === 0 ? <Empty title="Quiet so far">Visits, referrals, calls and arrivals appear here as they happen.</Empty> : (
            <ol className="crm-list" aria-live="polite">
              {feed.map((e) => {
                const ks = KIND_STYLE[e.kind] ?? { tag: '•', tone: 'neutral' };
                const [bg, fg] = TONE_BG[ks.tone];
                return (
                  <li key={e.key} className={e.fresh ? 'crm-feed-item' : undefined} style={{ alignItems: 'flex-start' }}>
                    <span style={{ width: 34, height: 34, borderRadius: 10, background: bg, color: fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, flexShrink: 0 }} aria-hidden="true">{ks.tag}</span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span style={{ fontSize: 13, lineHeight: 1.4 }}>{e.text}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{timeAgo(e.at, now)}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
          </div>
        </>
      )}

      {tab === 'referrals' && (
        <>
          <VitaRead key="referrals" tab="referrals" access={access} />
          <div className="crm-row">
        <section className="crm-card grow-2" aria-labelledby="funnel-h">
          <div className="crm-card-head">
            <h2 id="funnel-h" className="crm-h2">Referral funnel · this month</h2>
            {referredTotal > 0 && <span className="crm-sub" style={{ marginLeft: 'auto', fontSize: 13 }}>{Math.round((admittedCount / referredTotal) * 100)}% of referrals became admissions</span>}
          </div>
          {!data ? <Skeleton h={160} /> : referredTotal === 0 ? (
            <Empty title="No referrals yet this month">They appear here as agents log them in the app.</Empty>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {data.funnel.map((f, i) => {
                const pct = referredTotal ? Math.max(2, Math.round((f.count / referredTotal) * 100)) : 0;
                const colors = ['#0a72d6', '#2b8de0', '#5aa9ea', '#0f8a5f', '#34a37a'];
                return (
                  <div key={f.stage} style={{ display: 'grid', gridTemplateColumns: '112px minmax(0,1fr) 56px', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{f.stage}</span>
                    <div style={{ height: 28, background: '#f1f2f7', borderRadius: 8, overflow: 'hidden' }} role="img" aria-label={`${f.stage}: ${f.count}`}>
                      <div style={{ height: '100%', width: `${pct}%`, background: colors[i] ?? '#0a72d6', borderRadius: 8, transition: 'width 600ms ease' }} />
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 700, textAlign: 'right' }}>{f.count}</span>
                  </div>
                );
              })}
              <div className="crm-sub" style={{ fontSize: 13, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                {referredTotal - arrivedCount > 0
                  ? <>Biggest drop: <strong style={{ color: 'var(--text)' }}>referred → arrived ({Math.round(((referredTotal - arrivedCount) / referredTotal) * 100)}% haven&apos;t reached the hospital)</strong></>
                  : 'Every referred patient has reached the hospital.'}
                {data.lost > 0 && <> · {data.lost} did not come</>}
              </div>
            </div>
          )}
        </section>
        <section className="crm-card grow-1" aria-labelledby="top-h">
          <div className="crm-card-head">
            <h2 id="top-h" className="crm-h2">Top partners</h2>
            <span className="crm-sub" style={{ marginLeft: 'auto', fontSize: 12 }}>Admitted / referred, 90 days</span>
          </div>
          {!data ? <Skeleton h={200} /> : data.topPartners.length === 0 ? <Empty title="No referrals in the last 90 days" /> : (
            <ol className="crm-list">
              {data.topPartners.map((p, i) => (
                <li key={p.clientId}>
                  <span style={{ width: 20, fontSize: 13, color: 'var(--text-2)', fontWeight: 600 }}>{i + 1}</span>
                  <span className="crm-initials">{initials(p.name)}</span>
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {p.name}
                      {p.important && <Star size={13} fill="#d9822b" color="#d9822b" aria-label="Important" />}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{contactTypeLabel(p.type)}</span>
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 700 }}>{p.admitted}<span style={{ color: 'var(--text-2)', fontWeight: 500 }}> / {p.referred}</span></span>
                </li>
              ))}
            </ol>
          )}
        </section>
          </div>
          {ov && ov.departments.length > 0 && (
            <section className="crm-card" aria-labelledby="dept-h">
              <div className="crm-card-head">
                <h2 id="dept-h" className="crm-h2">Departments · this month</h2>
                <span className="crm-sub" style={{ marginLeft: 'auto', fontSize: 12 }}>Referrals and leads asking for each department</span>
              </div>
              <Departments rows={ov.departments} />
            </section>
          )}
          <div className="crm-row">
        <section className="crm-card is-flush grow-2" aria-labelledby="ref-h">
          <div className="crm-card-head">
            <h2 id="ref-h" className="crm-h2">Latest referrals</h2>
            {canView(access, 'pipeline') && <Link href="/admin/referrals?tab=pipeline" style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 600 }}>Open pipeline</Link>}
          </div>
          {!data ? <div style={{ padding: '0 22px' }}><Skeleton h={220} /></div> : data.latestReferrals.length === 0 ? (
            <Empty title="No referrals yet" />
          ) : (
            <><div className="crm-table-wrap">
              <table className="crm-table" style={{ minWidth: 640 }}>
                <thead>
                  <tr><th>Patient</th><th>Department</th><th>Referred by</th><th>Agent</th><th>Stage</th></tr>
                </thead>
                <tbody>
                  {refPg.rows.map((r) => (
                    <tr key={r.clientId} className={freshRefs.has(r.clientId) ? 'is-new' : undefined}>
                      <td>
                        <div className="crm-cell-main">{r.patientName}{r.urgent && <> <Pill tone="bad">Urgent</Pill></>}</div>
                        <div className="crm-cell-sub">{[r.patientSex, r.patientAge].filter(Boolean).join(', ')}{(r.patientSex || r.patientAge) ? ' · ' : ''}{fmt.dateTime(r.createdAt)}</div>
                      </td>
                      <td>{r.department || '—'}</td>
                      <td>
                        <div>{r.partner ?? '—'}</div>
                        <div className="crm-cell-sub">{[contactTypeLabel(r.partnerType), r.block].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td style={{ color: 'var(--text-2)' }}>{r.agent}</td>
                      <td>
                        <Pill tone={r.status === 'pending' && r.waitingHours >= 48 ? 'warn' : stageTone(r.status)} dot>
                          {r.status === 'pending' && r.waitingHours >= 48 ? `Waiting ${Math.floor(r.waitingHours / 24)} days` : r.stageLabel}
                        </Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager {...refPg.pager} noun="referrals" /></>
          )}
        </section>
          </div>
        </>
      )}

      {tab === 'leads' && (
        <>
          <VitaRead key="leads" tab="leads" access={access} />
          {!ov ? <Skeleton h={140} /> : <ChannelKpis ov={ov} access={access} />}
          <div className="crm-row">
        <section className="crm-card grow-1" aria-labelledby="src-h">
          <div className="crm-card-head">
            <h2 id="src-h" className="crm-h2">Where patients come from</h2>
            <span className="crm-sub" style={{ marginLeft: 'auto', fontSize: 12 }}>This month</span>
          </div>
          {!ov ? <Skeleton h={160} /> : ov.leads.sources.length === 0 ? <Empty title="Nothing yet this month">Leads and referrals appear here by where they came from.</Empty> : (
            <Sources rows={ov.leads.sources} />
          )}
        </section>
            {ov && ov.leads.month > 0 && canLeads(access) && (
              <section className="crm-card grow-1" aria-labelledby="lf-h">
                <div className="crm-card-head">
                  <h2 id="lf-h" className="crm-h2">Leads · this month</h2>
                  <Link href="/admin/leads" style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 600 }}>Open inbox</Link>
                </div>
                <LeadStats l={ov.leads} />
              </section>
            )}
            {ov && canView(access, 'camps') && <UpcomingCamps camps={ov.camps} />}
          </div>
        </>
      )}

      {tab === 'field' && (
        <>
          <VitaRead key="field" tab="field" access={access} />
          {data && <FieldKpis data={data} ov={ov ?? null} />}
          <div className="crm-row">
        <section className="crm-card grow-2" aria-labelledby="ff-h">
          <div className="crm-card-head">
            <h2 id="ff-h" className="crm-h2">Field force today</h2>
            {canView(access, 'field') && <Link href="/admin/map" style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 600 }}>Open live map</Link>}
          </div>
          {!data ? <Skeleton h={200} /> : data.fieldForce.length === 0 ? <Empty title="No field agents yet">Onboard agents from Users &amp; roles.</Empty> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
              {data.fieldForce.map((a) => (
                <div key={a.agentId} style={{ border: '1px solid var(--line)', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="crm-initials" style={{ background: '#e9ebf1', color: 'var(--text)' }}>
                      {initials(a.name)}
                      <span className="crm-status-dot" style={{ background: a.tone === 'on' ? 'var(--ok)' : a.tone === 'idle' ? 'var(--warn)' : 'var(--bad)', animation: a.tone === 'on' ? 'crmPulse 1.8s ease-out infinite' : undefined }} />
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{a.name}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{[a.block, a.status].filter(Boolean).join(' · ')}</span>
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Mini value={a.visits} label="visits" />
                    <Mini value={a.referrals} label="referrals" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
          </div>
        </>
      )}
    </main>
  );
}

function Kpi({ label, value, unit, note, tone = 'ok', flash, spark, color = '#0a72d6' }: {
  label: string; value: number; unit?: string; note?: string; tone?: 'ok' | 'bad' | 'neutral'; flash?: boolean; spark?: number[]; color?: string;
}) {
  return (
    <div className={`crm-card crm-kpi${flash ? ' is-flash' : ''}`}>
      <span className="crm-kpi-label">{label}</span>
      <span className="crm-kpi-value">{value.toLocaleString('en-IN')}{unit && <span className="crm-kpi-unit">{unit}</span>}</span>
      {note && <span style={{ alignSelf: 'flex-start' }}><Pill tone={tone}>{note}</Pill></span>}
      {spark && spark.length > 1 && <Spark values={spark} color={color} label={label} />}
    </div>
  );
}

/** A small 14-day line, last day marked. */
function Spark({ values, color, label }: { values: number[]; color: string; label: string }) {
  const W = 140, H = 34, max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - 3 - (v / max) * (H - 8)] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lx, ly] = pts[pts.length - 1];
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <svg className="cc-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${label}: ${total} in the last 14 days`}>
      <polygon points={`0,${H} ${line} ${W},${H}`} fill={color} opacity={0.1} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r={3} fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ─── Needs action now: every module's "waiting on us" in one list, worst first ───

interface Action { key: string; count: number | string; title: string; sub: string; href?: string; tone: 'bad' | 'warn' | 'accent' }
const TONE_RANK = { bad: 0, warn: 1, accent: 2 } as const;

const ACTIONS_SHOWN = 8;

function buildActions(data: Summary, ov: Overview | null, access: Access): Action[] {
  const a: Action[] = [];
  const add = (show: boolean, x: Action) => { if (show) a.push(x); };
  const al = data.alerts;
  const istHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }).format(new Date()));
  if (ov) {
    add(canLeads(access) && ov.leads.waiting > 0, { key: 'leads', count: ov.leads.waiting, tone: 'bad', href: '/admin/leads',
      title: 'New leads not contacted', sub: `No reply within ${ov.leads.targetMinutes} min` });
    add(canLeads(access) && ov.inbox.waWaiting > 0, { key: 'wa', count: ov.inbox.waWaiting, tone: 'bad', href: '/admin/whatsapp?tab=inbox',
      title: 'WhatsApp chats waiting', sub: 'Messaged us, no reply yet' });
    add(canView(access, 'social') && ov.inbox.socialWaiting > 0, { key: 'so', count: ov.inbox.socialWaiting, tone: 'bad', href: '/admin/social?tab=inbox',
      title: 'Facebook & Instagram waiting', sub: 'Messages with no reply yet' });
    const spend = ov.waSpend;
    const pct = spend && spend.budget > 0 ? Math.round((spend.spent / spend.budget) * 100) : 0;
    add(canView(access, 'whatsapp') && !!spend && spend.budget > 0 && pct >= spend.alertPercent, { key: 'spend', count: `${pct}%`, tone: pct >= 100 ? 'bad' : 'warn',
      href: '/admin/whatsapp?tab=billing', title: 'WhatsApp budget', sub: `${rupees(spend?.spent)} of ${rupees(spend?.budget)} spent this month` });
  }
  add(canView(access, 'desk') && al.notArrived48 > 0, { key: 'late', count: al.notArrived48, tone: 'warn', href: '/admin/referrals?tab=desk',
    title: 'Referrals not arrived in 48 h', sub: 'Call the patient or the partner' });
  add(canView(access, 'partners') && al.openEscalations > 0, { key: 'esc', count: al.openEscalations, tone: 'warn', href: '/admin/partners?tab=escalated',
    title: 'Open escalations from agents', sub: 'Waiting for a reply' });
  add(canView(access, 'calls') && al.needsVisit > 0, { key: 'visit', count: al.needsVisit, tone: 'warn', href: '/admin/calls?filter=needs_visit',
    title: 'Partners who need a visit', sub: '3 calls missed in a row' });
  add(canView(access, 'calls') && al.overdueFollowUps > 0, { key: 'calls', count: al.overdueFollowUps, tone: 'accent', href: '/admin/calls',
    title: 'Overdue partner calls', sub: 'Past their call date' });
  add(canView(access, 'payments') && data.work.payments.overdue > 0, { key: 'payo', count: data.work.payments.overdue, tone: 'bad', href: '/admin/payments',
    title: 'Partner payments overdue', sub: 'Approved more than a week ago' });
  add(canView(access, 'payments') && data.work.payments.waitingApproval > 0, { key: 'paya', count: rupees(data.work.payments.waitingApproval), tone: 'accent', href: '/admin/payments',
    title: 'Payments to approve', sub: 'Waiting for your approval' });
  if (ov) {
    const absent = data.kpis.totalAgents - data.kpis.agentsOnShift - ov.leave.onLeaveToday;
    add(canView(access, 'field') && istHour >= 10 && istHour < 19 && absent > 0, { key: 'absent', count: absent, tone: 'warn', href: '/admin/map',
      title: 'Agents not checked in', sub: `After 10 am, not on leave` });
    add(canView(access, 'field') && ov.tasks.overdue > 0, { key: 'tasks', count: ov.tasks.overdue, tone: 'warn', href: '/admin/assignments?view=tasks',
      title: 'Agent tasks overdue', sub: 'Past their due date' });
    add(canView(access, 'field') && ov.leave.pending > 0, { key: 'leave', count: ov.leave.pending, tone: 'accent', href: '/admin/leave',
      title: 'Leave requests to decide', sub: 'Agents are waiting' });
    add(canView(access, 'camps') && ov.camps.atRisk > 0, { key: 'camps', count: ov.camps.atRisk, tone: 'warn', href: '/admin/camps',
      title: 'Camps short of bookings', sub: 'Within 7 days, under half the target' });
  }
  a.sort((x, y) => TONE_RANK[x.tone] - TONE_RANK[y.tone]);
  return a;
}

function ActionQueue({ actions: a }: { actions: Action[] }) {
  const [all, setAll] = useState(false);
  return (
    <section className="crm-card cc-actions" aria-labelledby="act-h">
      <div className="crm-card-head">
        <h2 id="act-h" className="crm-h2">Needs action now</h2>
        {a.length > 0 && <span className="crm-sub" style={{ fontSize: 13 }}>{a.length} {a.length === 1 ? 'thing' : 'things'}, most urgent first</span>}
      </div>
      {a.length === 0 ? (
        <p className="cc-clear"><CheckCircle2 size={18} aria-hidden /> All clear. Nothing is waiting on the team right now.</p>
      ) : (
        <>
        <ul className="cc-act-grid">
          {(all ? a : a.slice(0, ACTIONS_SHOWN)).map((x) => {
            const [bg, fg] = TONE_BG[x.tone];
            const body = (
              <>
                <span className="cc-act-count" style={{ background: bg, color: fg }}>{x.count}</span>
                <span className="cc-act-text">
                  <span className="cc-act-title">{x.title}</span>
                  <span className="cc-act-sub">{x.sub}</span>
                </span>
                {x.href && <ChevronRight size={16} color="#8c96ab" style={{ marginLeft: 'auto', flexShrink: 0 }} aria-hidden />}
              </>
            );
            return <li key={x.key}>{x.href ? <Link href={x.href} className="cc-act">{body}</Link> : <div className="cc-act">{body}</div>}</li>;
          })}
        </ul>
        {a.length > ACTIONS_SHOWN && (
          <button type="button" className="crm-chip" style={{ alignSelf: 'flex-start', height: 34 }} onClick={() => setAll((v) => !v)} aria-expanded={all}>
            {all ? 'Show fewer' : `Show ${a.length - ACTIONS_SHOWN} more`}
          </button>
        )}
        </>
      )}
    </section>
  );
}

function Sources({ rows }: { rows: Overview['leads']['sources'] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="cc-src">
      {rows.slice(0, 8).map((r) => (
        <li key={r.source}>
          <span className="cc-src-top">
            <span className="cc-src-name">{r.label}</span>
            <span className="cc-src-n">{r.count}</span>
          </span>
          <span className="crm-bar"><span style={{ width: `${Math.max(3, Math.round((r.count / max) * 100))}%`, background: r.source === 'field' ? 'var(--warn)' : 'var(--accent)' }} /></span>
          <span className="cc-src-sub">{r.won} reached the hospital{r.count > 0 ? ` · ${Math.round((r.won / r.count) * 100)}%` : ''}</span>
        </li>
      ))}
    </ul>
  );
}

function Departments({ rows }: { rows: Overview['departments'] }) {
  const max = Math.max(1, ...rows.map((r) => r.referrals + r.leads));
  return (
    <div className="crm-table-wrap">
      <table className="crm-table cc-dept" style={{ minWidth: 520 }}>
        <thead><tr><th>Department</th><th style={{ width: '40%' }} aria-label="Share" /><th className="num">Referrals</th><th className="num">Leads</th><th className="num">Admitted</th></tr></thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.name}>
              <td className="crm-cell-main">{d.name}</td>
              <td>
                <span className="cc-stack" role="img" aria-label={`${d.referrals} referrals, ${d.leads} leads`}>
                  <span style={{ width: `${(d.referrals / max) * 100}%`, background: 'var(--warn)' }} />
                  <span style={{ width: `${(d.leads / max) * 100}%`, background: 'var(--accent)' }} />
                </span>
              </td>
              <td className="num">{d.referrals}</td>
              <td className="num">{d.leads}</td>
              <td className="num" style={{ fontWeight: 700, color: 'var(--ok-ink)' }}>{d.admitted}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="cc-legend"><i style={{ background: 'var(--warn)' }} /> Field referrals <i style={{ background: 'var(--accent)' }} /> Leads</p>
    </div>
  );
}

function LeadStats({ l }: { l: Overview['leads'] }) {
  const pct = (n: number) => (l.month ? `${Math.round((n / l.month) * 100)}%` : '—');
  return (
    <div className="cc-leadstats">
      <Mini value={l.month} label="new leads" />
      <Mini value={pct(l.appointments)} label="got an appointment" />
      <Mini value={pct(l.won)} label="reached the hospital" />
      <Mini value={l.medianReplyMinutes == null ? '—' : l.medianReplyMinutes < 60 ? `${l.medianReplyMinutes} min` : `${Math.round(l.medianReplyMinutes / 60)} h`} label={`typical first reply (target ${l.targetMinutes} min)`} />
      {l.lost > 0 && <span className="crm-sub" style={{ fontSize: 12, gridColumn: '1 / -1' }}>{l.lost} marked lost this month</span>}
    </div>
  );
}

function Mini({ value, label }: { value: number | string; label: string }) {
  return (
    <span style={{ flex: 1, background: 'var(--bg)', borderRadius: 10, padding: '8px 10px', display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontSize: 16, fontWeight: 700 }}>{value}</span>
      <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{label}</span>
    </span>
  );
}

function TodaysWork({ work, ov, access }: { work: Summary['work']; ov: Overview | null; access: Access }) {
  const cards: React.ReactNode[] = [];
  if (ov && canLeads(access)) {
    const l = ov.leads;
    cards.push(
      <WorkCard key="leads" href="/admin/leads" icon={<UserPlus size={18} aria-hidden />} title="Leads inbox"
        big={`${l.today} new today`} sub={l.medianReplyMinutes != null ? `Typical first reply ${l.medianReplyMinutes < 60 ? `${l.medianReplyMinutes} min` : `${Math.round(l.medianReplyMinutes / 60)} h`}` : `${l.month} this month`}
        pct={l.month ? Math.round((l.won / l.month) * 100) : 0} color="#7c5cd6" tag={l.waiting > 0 ? `${l.waiting} not contacted` : undefined} tagTone="bad" />,
    );
  }
  if (canView(access, 'calls')) {
    const pct = work.calls.cycleTotal ? Math.round((work.calls.cycleCalled / work.calls.cycleTotal) * 100) : 0;
    cards.push(
      <WorkCard key="calls" href="/admin/calls" icon={<PhoneCall size={18} aria-hidden />} title="Daily calls"
        big={`${work.calls.done} done · ${work.calls.due} due`} sub={`Cycle ${work.calls.cycle} · ${work.calls.cycleCalled} of ${work.calls.cycleTotal} partners`}
        pct={pct} color="var(--accent)" tag={work.calls.retry > 0 ? `${work.calls.retry} retry today` : undefined} tagTone="warn" />,
    );
  }
  if (canView(access, 'desk')) {
    const total = work.desk.expected + work.desk.arrivedToday;
    cards.push(
      <WorkCard key="desk" href="/admin/referrals?tab=desk" icon={<Inbox size={18} aria-hidden />} title="Referral desk"
        big={`${work.desk.expected} patients expected`} sub={`${work.desk.arrivedToday} arrived today`}
        pct={total ? Math.round((work.desk.arrivedToday / total) * 100) : 0} color="var(--info)" tag={work.desk.late > 0 ? `${work.desk.late} late 48 h+` : undefined} tagTone="bad" />,
    );
  }
  if (canView(access, 'payments')) {
    const total = work.payments.toPay + work.payments.waitingApproval;
    cards.push(
      <WorkCard key="pay" href="/admin/payments" icon={<Wallet size={18} aria-hidden />} title="Payments"
        big={`${rupees(work.payments.toPay)} to pay`} sub={`${rupees(work.payments.waitingApproval)} waiting approval`}
        pct={total ? Math.round((work.payments.toPay / total) * 100) : 0} color="var(--warn)" tag={work.payments.overdue > 0 ? `${work.payments.overdue} overdue` : undefined} tagTone="bad" />,
    );
  }
  if (canView(access, 'whatsapp')) {
    const spend = ov?.waSpend;
    const spendPct = spend && spend.budget > 0 ? Math.round((spend.spent / spend.budget) * 100) : null;
    cards.push(
      <WorkCard key="wa" href={ov && ov.inbox.waUnread > 0 ? '/admin/whatsapp?tab=inbox' : '/admin/whatsapp?tab=broadcasts'} icon={<MessageCircle size={18} aria-hidden />} title="WhatsApp"
        big={!work.whatsapp.connected ? 'Not connected yet' : ov ? `${ov.inbox.waUnread} unread ${ov.inbox.waUnread === 1 ? 'chat' : 'chats'}` : work.whatsapp.scheduled > 0 ? `${work.whatsapp.scheduled} scheduled` : 'Nothing scheduled'}
        sub={spend && spend.budget > 0 ? `${rupees(spend.spent)} of ${rupees(spend.budget)} budget` : spend ? `${rupees(spend.spent)} spent this month`
          : work.whatsapp.scheduled > 0 ? `${work.whatsapp.scheduled} broadcasts scheduled` : work.whatsapp.lastTitle ? `Last: ${work.whatsapp.lastTitle}` : 'No broadcasts sent yet'}
        pct={spendPct ?? work.whatsapp.lastReadPct ?? 0} color={spendPct != null && spend && spendPct >= spend.alertPercent ? 'var(--bad)' : 'var(--ok)'}
        tag={work.whatsapp.lastReadPct != null ? `Last broadcast ${work.whatsapp.lastReadPct}% read` : undefined} tagTone="ok" />,
    );
  }
  if (ov && canView(access, 'social')) {
    cards.push(
      <WorkCard key="so" href="/admin/social?tab=inbox" icon={<AtSign size={18} aria-hidden />} title="Facebook & Instagram"
        big={`${ov.inbox.socialUnread} unread ${ov.inbox.socialUnread === 1 ? 'message' : 'messages'}`} sub={`${ov.inbox.formLeadsToday} form leads today · ${ov.inbox.formLeadsMonth} this month`}
        pct={0} color="var(--accent)" tag={ov.inbox.socialWaiting > 0 ? `${ov.inbox.socialWaiting} waiting` : undefined} tagTone="bad" />,
    );
  }
  if (ov && canView(access, 'camps')) {
    const next = ov.camps.upcoming[0];
    const when = (d: number) => (d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`);
    cards.push(
      <WorkCard key="camps" href={next ? `/admin/camps?id=${next.id}` : '/admin/camps'} icon={<Tent size={18} aria-hidden />} title="Health camps"
        big={next ? `${when(next.daysAway)} · ${next.booked} of ${next.target} booked` : 'No camp in the next 2 weeks'}
        sub={next ? [next.title, next.block].filter(Boolean).join(' · ') : ov.camps.doneThisMonth > 0 ? `${ov.camps.doneThisMonth} held this month · ${ov.camps.attendedThisMonth} people seen` : 'Plan one from Health camps'}
        pct={next && next.target ? Math.round((next.booked / next.target) * 100) : 0} color="var(--ok)"
        tag={ov.camps.atRisk > 0 ? `${ov.camps.atRisk} ${ov.camps.atRisk === 1 ? 'camp' : 'camps'} short of bookings` : ov.camps.referredThisMonth > 0 ? `${ov.camps.referredThisMonth} referred this month` : undefined}
        tagTone={ov.camps.atRisk > 0 ? 'warn' : 'ok'} />,
    );
  }
  if (ov && canView(access, 'field')) {
    const t = ov.tasks;
    cards.push(
      <WorkCard key="tasks" href="/admin/assignments?view=tasks" icon={<ClipboardList size={18} aria-hidden />} title="Agent tasks"
        big={`${t.open} open`} sub={`${t.doneToday} done today`} pct={t.open + t.doneToday ? Math.round((t.doneToday / (t.open + t.doneToday)) * 100) : 0} color="var(--accent)"
        tag={t.overdue > 0 ? `${t.overdue} overdue` : undefined} tagTone="bad" />,
      <WorkCard key="leave" href="/admin/leave" icon={<CalendarCheck size={18} aria-hidden />} title="Attendance & leave"
        big={`${ov.leave.onLeaveToday} on leave today`} sub={ov.leave.pending > 0 ? `${ov.leave.pending} ${ov.leave.pending === 1 ? 'request' : 'requests'} to decide` : 'No requests waiting'}
        pct={0} color="var(--accent)" tag={ov.leave.pending > 0 ? 'Decide' : undefined} tagTone="warn" />,
    );
  }
  if (cards.length === 0) return null;
  return (
    <section aria-labelledby="work-h" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 id="work-h" className="crm-h2">Today&apos;s work</h2>
      <div className="crm-work cc-work">{cards}</div>
    </section>
  );
}

function WorkCard({ href, icon, title, big, sub, pct, color, tag, tagTone }: { href: string; icon: React.ReactNode; title: string; big: string; sub: string; pct: number; color: string; tag?: string; tagTone: 'ok' | 'warn' | 'bad' }) {
  return (
    <Link href={href} className="crm-card crm-work-card">
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="crm-work-icon">{icon}</span>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{title}</span>
        <ChevronRight size={16} color="#8c96ab" style={{ marginLeft: 'auto' }} aria-hidden />
      </span>
      <span style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 20, fontWeight: 800 }}>{big}</span>
      {pct > 0 && <span className="crm-bar"><span style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }} /></span>}
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{sub}</span>
        {tag && <span style={{ marginLeft: 'auto' }}><Pill tone={tagTone}>{tag}</Pill></span>}
      </span>
    </Link>
  );
}

// ─── Vita (the AI analyst) on the board ───

type InsightTab = 'overview' | 'referrals' | 'leads' | 'field';
interface InsightRes {
  configured: boolean; tab?: string; at?: string; model?: string; headline?: string; error?: string | null;
  points?: { text: string; tone: 'good' | 'watch' | 'bad' }[];
  actions?: { text: string; owner?: string | null; page?: string | null }[];
}

/** Where each page Vita may point to lives, and who may open it. */
const VITA_PAGES: Record<string, { href: string; label: string; can: (a: Access) => boolean }> = {
  leads: { href: '/admin/leads', label: 'Leads inbox', can: canLeads },
  whatsapp: { href: '/admin/whatsapp?tab=inbox', label: 'WhatsApp', can: (a) => canView(a, 'whatsapp') },
  social: { href: '/admin/social?tab=inbox', label: 'Facebook & Instagram', can: (a) => canView(a, 'social') },
  desk: { href: '/admin/referrals?tab=desk', label: 'Referral desk', can: (a) => canView(a, 'desk') },
  calls: { href: '/admin/calls', label: 'Daily calls', can: (a) => canView(a, 'calls') },
  pipeline: { href: '/admin/referrals?tab=pipeline', label: 'Pipeline', can: (a) => canView(a, 'pipeline') },
  partners: { href: '/admin/partners', label: 'Partners', can: (a) => canView(a, 'partners') },
  payments: { href: '/admin/payments', label: 'Payments', can: (a) => canView(a, 'payments') },
  camps: { href: '/admin/camps', label: 'Health camps', can: (a) => canView(a, 'camps') },
  map: { href: '/admin/map', label: 'Live map', can: (a) => canView(a, 'field') },
  tasks: { href: '/admin/assignments?view=tasks', label: 'Agent tasks', can: (a) => canView(a, 'field') },
  leave: { href: '/admin/leave', label: 'Attendance & leave', can: (a) => canView(a, 'field') },
  agents: { href: '/admin/agents', label: 'Field agents', can: (a) => canView(a, 'field') },
  analytics: { href: '/admin/reports?tab=ai', label: 'AI analyst', can: (a) => canView(a, 'analytics') },
};

/** Questions to hand to Vita's chat from each tab, and which of her areas they are about. */
const VITA_ASK: Record<InsightTab, { area: string; qs: string[] }> = {
  overview: { area: 'business', qs: ['What are the 3 most important things to fix this week?', 'How is this month going compared with last month?'] },
  referrals: { area: 'referrals', qs: ['Where are we losing patients between referral and arrival?', 'Which blocks send patients who actually arrive?'] },
  leads: { area: 'business', qs: ['Which lead sources bring patients who actually come, and which waste our time?', 'How fast are we replying to leads, and where are we slow?'] },
  field: { area: 'field', qs: ['Which agent needs support, and with what?', 'Which assigned panchayats have never been visited?'] },
};

const TONE_DOT: Record<string, string> = { good: 'var(--ok)', watch: 'var(--warn)', bad: 'var(--bad)' };

/**
 * Vita's short read of the tab: a headline, a few points with the numbers, and up to three actions that link to
 * the page where they are done. Written by the AI from this board's totals (no patient details), kept for 45 minutes.
 */
function VitaRead({ tab, access }: { tab: InsightTab; access: Access }) {
  const now = useNow(30000);
  const { data: first, loading } = useLoader(() => crm.get<InsightRes>(`/api/v1/dashboard/insight?tab=${tab}`), [tab]);
  const [fresh, setFresh] = useState<InsightRes | null>(null);
  const [busy, setBusy] = useState(false);
  const r = fresh ?? first;
  const canAsk = canView(access, 'analytics');

  const refresh = async () => {
    setBusy(true);
    try { setFresh(await crm.get<InsightRes>(`/api/v1/dashboard/insight?tab=${tab}&refresh=true`)); }
    catch { /* keep what is shown */ }
    finally { setBusy(false); }
  };

  if (r && !r.configured) {
    if (!access?.isAdmin) return null;
    return (
      <section className="crm-card cc-vita is-off" aria-label="Vita">
        <Image src="/brand/vita/think.webp" alt="" width={40} height={40} unoptimized />
        <p className="crm-sub" style={{ margin: 0 }}>Vita can sum up each tab once the Groq key is added on the server (<code>Groq__ApiKey</code>).</p>
      </section>
    );
  }
  const working = (loading && !r) || busy;
  return (
    <section className="crm-card cc-vita" aria-labelledby={`vita-${tab}`} aria-busy={working}>
      <div className="cc-vita-head">
        <Image src={working ? '/brand/vita/think.webp' : '/brand/vita/ai.webp'} alt="" width={40} height={40} unoptimized />
        <div className="cc-vita-title">
          <h2 id={`vita-${tab}`} className="crm-h2"><Sparkles size={15} aria-hidden /> Vita&apos;s read</h2>
          <span className="crm-sub">
            {working ? 'Reading the numbers…' : r?.at ? <>Written by AI from this board&apos;s numbers · {timeAgo(r.at, now)}</> : 'Written by AI from this board’s numbers'}
          </span>
        </div>
        <button type="button" className="crm-chip cc-vita-refresh" onClick={() => void refresh()} disabled={busy} aria-label="Ask Vita for a fresh read">
          <RefreshCw size={14} aria-hidden className={busy ? 'cc-spin' : undefined} /> Refresh
        </button>
      </div>

      {working && !r?.headline ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><Skeleton h={18} w="70%" /><Skeleton h={14} w="90%" /><Skeleton h={14} w="80%" /></div>
      ) : !r?.headline ? (
        <p className="crm-sub" style={{ margin: 0 }}>{r?.error ?? 'Vita has nothing to say yet.'}</p>
      ) : (
        <>
          <p className="cc-vita-headline">{r.headline}</p>
          <div className="cc-vita-body">
            {r.points && r.points.length > 0 && (
              <ul className="cc-vita-points">
                {r.points.map((p, i) => (
                  <li key={i}><span className="cc-vita-dot" style={{ background: TONE_DOT[p.tone] ?? TONE_DOT.watch }} aria-label={p.tone === 'good' ? 'Going well' : p.tone === 'bad' ? 'Problem' : 'Keep an eye on'} />{p.text}</li>
                ))}
              </ul>
            )}
            {r.actions && r.actions.length > 0 && (
              <div className="cc-vita-actions">
                <span className="cc-vita-label">Do next</span>
                <ol>
                  {r.actions.map((x, i) => {
                    const pg = x.page ? VITA_PAGES[x.page] : undefined;
                    const link = pg && pg.can(access) ? pg : undefined;
                    return (
                      <li key={i}>
                        <span>{x.text}</span>
                        <span className="cc-vita-meta">
                          {x.owner && <span>{x.owner}</span>}
                          {link && <Link href={link.href}>{link.label} <ArrowRight size={12} aria-hidden /></Link>}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
          </div>
          {r.error && <p className="crm-sub" style={{ margin: 0, fontSize: 12 }}>Couldn&apos;t refresh: {r.error}</p>}
        </>
      )}

      {canAsk && (
        <div className="cc-vita-ask">
          <span className="cc-vita-label">Ask Vita</span>
          {VITA_ASK[tab].qs.map((q) => (
            <button key={q} type="button" className="crm-chip" onClick={() => openVita('vita', { area: VITA_ASK[tab].area, question: q })}>{q}</button>
          ))}
          <button type="button" className="crm-chip" onClick={() => openVita('vita', { area: VITA_ASK[tab].area })}>Ask something else…</button>
        </div>
      )}
    </section>
  );
}

interface AreaRow { key: string; label: string; latestAt?: string | null; health?: string | null; summary?: string | null; running: boolean; open: number; overdue: number; high: number }
const HEALTH_PILL: Record<string, { tone: 'ok' | 'warn' | 'bad'; label: string }> = { good: { tone: 'ok', label: 'Good' }, watch: { tone: 'warn', label: 'Watch' }, bad: { tone: 'bad', label: 'Needs work' } };

/** The analyst's own briefings (daily overview, weekly per area) and the issues it is tracking, one line each. */
function Briefings() {
  const now = useNow(60000);
  const { data } = useLoader(() => crm.get<{ configured: boolean; areas: AreaRow[] }>('/api/v1/analytics/analyst/areas'), []);
  if (!data || !data.configured) return null;
  return (
    <section className="crm-card grow-2" aria-labelledby="brief-h">
      <div className="crm-card-head">
        <h2 id="brief-h" className="crm-h2">Vita&apos;s briefings</h2>
        <Link href="/admin/reports?tab=ai" style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 600 }}>Open AI analyst</Link>
      </div>
      <ul className="crm-list cc-brief">
        {data.areas.map((a) => {
          const h = a.health ? HEALTH_PILL[a.health] : undefined;
          return (
            <li key={a.key}>
              <Link href={a.key === 'business' ? '/admin/reports?tab=ai' : `/admin/reports?tab=ai&area=${a.key}`} className="cc-brief-row">
                <span className="cc-brief-name">{a.label}</span>
                <span className="cc-brief-pill">{a.running ? <Pill tone="info">Writing…</Pill> : h ? <Pill tone={h.tone} dot>{h.label}</Pill> : <Pill>Not yet</Pill>}</span>
                <span className="cc-brief-sum">{a.summary ?? 'No briefing yet.'}</span>
                <span className="cc-brief-meta">
                  {a.open > 0 && <span>{a.open} open{a.overdue > 0 ? ` · ${a.overdue} overdue` : ''}</span>}
                  {a.latestAt && <span>{timeAgo(a.latestAt, now)}</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ─── Tab tiles ───

function ChannelKpis({ ov, access }: { ov: Overview; access: Access }) {
  const spend = ov.waSpend;
  const pct = spend && spend.budget > 0 ? Math.round((spend.spent / spend.budget) * 100) : null;
  return (
    <section aria-label="Channels at a glance" className="crm-kpis cc-kpis">
      {canLeads(access) && <Kpi label="New leads today" value={ov.leads.today} spark={ov.trend.leads} color="#7c5cd6" note={`${ov.leads.yesterday} yesterday`} tone="neutral" />}
      {canLeads(access) && <Kpi label="Leads not contacted" value={ov.leads.waiting} note={`Target ${ov.leads.targetMinutes} min`} tone={ov.leads.waiting > 0 ? 'bad' : 'ok'} />}
      {canLeads(access) && <Kpi label="WhatsApp unread" value={ov.inbox.waUnread} note={ov.inbox.waWaiting > 0 ? `${ov.inbox.waWaiting} waiting` : 'All answered'} tone={ov.inbox.waWaiting > 0 ? 'bad' : 'ok'} />}
      {canView(access, 'social') && <Kpi label="Facebook & Instagram unread" value={ov.inbox.socialUnread} note={`${ov.inbox.formLeadsToday} form leads today`} tone="neutral" />}
      {canView(access, 'whatsapp') && spend && (
        <div className="crm-card crm-kpi">
          <span className="crm-kpi-label">WhatsApp spend this month</span>
          <span className="crm-kpi-value" style={{ fontSize: 24 }}>{rupees(spend.spent)}</span>
          {pct != null && (
            <>
              <span className="crm-bar"><span style={{ width: `${Math.min(100, pct)}%`, background: pct >= spend.alertPercent ? 'var(--bad)' : 'var(--ok)' }} /></span>
              <span className="crm-sub" style={{ fontSize: 12 }}>{pct}% of {rupees(spend.budget)} budget</span>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function UpcomingCamps({ camps }: { camps: Overview['camps'] }) {
  const when = (d: number) => (d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`);
  return (
    <section className="crm-card grow-1" aria-labelledby="camps-h">
      <div className="crm-card-head">
        <h2 id="camps-h" className="crm-h2">Health camps</h2>
        <Link href="/admin/camps" style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 600 }}>Open camps</Link>
      </div>
      {camps.upcoming.length === 0 ? <Empty title="No camp in the next 2 weeks" /> : (
        <ul className="crm-list">
          {camps.upcoming.map((c) => {
            const pct = c.target ? Math.round((c.booked / c.target) * 100) : 0;
            const short = c.daysAway <= 7 && c.target > 0 && c.booked * 2 < c.target;
            return (
              <li key={c.id} style={{ padding: 0 }}>
                <Link href={`/admin/camps?id=${c.id}`} className="cc-camp">
                  <span className="cc-camp-top"><strong>{c.title}</strong><span className="crm-sub">{when(c.daysAway)}</span></span>
                  <span className="crm-sub" style={{ fontSize: 12 }}>{[c.block, c.venue].filter(Boolean).join(' · ')}</span>
                  <span className="crm-bar"><span style={{ width: `${Math.min(100, pct)}%`, background: short ? 'var(--warn)' : 'var(--ok)' }} /></span>
                  <span className="crm-sub" style={{ fontSize: 12 }}>{c.booked} of {c.target} booked{short ? ' · short of bookings' : ''}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {camps.doneThisMonth > 0 && <p className="crm-sub" style={{ margin: 0, fontSize: 12 }}>This month: {camps.doneThisMonth} held · {camps.attendedThisMonth} people seen · {camps.referredThisMonth} referred to the hospital</p>}
    </section>
  );
}

function FieldKpis({ data, ov }: { data: Summary; ov: Overview | null }) {
  const k = data.kpis;
  const c = data.work.calls;
  return (
    <section aria-label="Field team at a glance" className="crm-kpis cc-kpis">
      <Kpi label="Agents on shift" value={k.agentsOnShift} unit={`of ${k.totalAgents}`} note={ov && ov.leave.onLeaveToday > 0 ? `${ov.leave.onLeaveToday} on leave` : undefined} tone="neutral" />
      <Kpi label="Visits today" value={k.visitsToday} spark={ov?.trend.visits} color="#0a72d6" />
      <Kpi label="Partner calls today" value={c.done} note={`${c.due} still due`} tone={c.due > 0 ? 'neutral' : 'ok'} />
      {ov && <Kpi label="Open agent tasks" value={ov.tasks.open} note={ov.tasks.overdue > 0 ? `${ov.tasks.overdue} overdue` : `${ov.tasks.doneToday} done today`} tone={ov.tasks.overdue > 0 ? 'bad' : 'ok'} />}
      <Kpi label="Partners needing a visit" value={data.alerts.needsVisit} note={data.alerts.openEscalations > 0 ? `${data.alerts.openEscalations} escalations open` : undefined} tone="bad" />
    </section>
  );
}
