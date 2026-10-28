'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, Inbox, MessageCircle, PhoneCall, Star, Wallet } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { canView, useAccess } from '@/lib/crm/access';
import { timeAgo, useLiveEvents, useNow, type LiveEvent } from '@/lib/crm/live';
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
  const { access } = useAccess();
  const now = useNow(1000);
  const { data, error, loading, reload } = useLoader(() => crm.get<Summary>('/api/v1/dashboard/summary'));
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

      <section aria-label="Today at a glance" className="crm-kpis">
        {!data && loading
          ? Array.from({ length: 5 }).map((_, i) => <div key={i} className="crm-card"><Skeleton h={14} w="60%" /><Skeleton h={30} w="40%" style={{ marginTop: 12 }} /></div>)
          : k && (
            <>
              <Kpi label="Agents on shift" value={k.agentsOnShift} unit={`of ${k.totalAgents}`} flash={flashing('agents')}
                note={k.totalAgents - k.agentsOnShift > 0 ? `${k.totalAgents - k.agentsOnShift} not checked in` : 'Everyone is out'} tone={k.totalAgents - k.agentsOnShift > 0 ? 'bad' : 'ok'} />
              <Kpi label="Visits today" value={k.visitsToday} flash={flashing('visits')} />
              <Kpi label="Referrals today" value={k.referralsToday} flash={flashing('refs')} />
              <Kpi label="Arrived this month" value={k.arrivedMonth} flash={flashing('arrived')}
                note={referredTotal > 0 ? `${Math.round((arrivedCount / referredTotal) * 100)}% of referred` : undefined} tone="ok" />
              <Kpi label="Admissions this month" value={k.admissionsMonth} flash={flashing('admissions')}
                note={admissionsDelta !== null ? `${admissionsDelta >= 0 ? '+' : ''}${admissionsDelta}% vs last month` : undefined}
                tone={admissionsDelta !== null && admissionsDelta < 0 ? 'bad' : 'ok'} />
            </>
          )}
      </section>

      {data && <TodaysWork work={data.work} access={access} />}

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

        <section className="crm-card grow-1" aria-labelledby="attn-h">
          <div className="crm-card-head"><h2 id="attn-h" className="crm-h2">Needs attention</h2></div>
          {!data ? <Skeleton h={160} /> : (
            <ul className="crm-list">
              <Alert count={data.alerts.notArrived48} tone="warn" title="Referrals not arrived in 48 h" sub="Call the patient or the partner" href={canView(access, 'desk') ? '/admin/desk' : undefined} />
              <Alert count={data.alerts.overdueFollowUps} tone="accent" title="Overdue partner calls" sub="Past their call date" href={canView(access, 'calls') ? '/admin/calls' : undefined} />
              <Alert count={data.alerts.needsVisit} tone="bad" title="Partners who need a visit" sub="3 calls missed in a row" href={canView(access, 'calls') ? '/admin/calls?filter=needs_visit' : undefined} />
              <Alert count={data.alerts.openEscalations} tone="neutral" title="Open escalations from agents" sub="Waiting for a reply" href={canView(access, 'partners') ? '/admin/pipeline' : undefined} />
            </ul>
          )}
        </section>
      </div>

      <div className="crm-row">
        <section className="crm-card is-flush grow-2" aria-labelledby="ref-h">
          <div className="crm-card-head">
            <h2 id="ref-h" className="crm-h2">Latest referrals</h2>
            {canView(access, 'pipeline') && <Link href="/admin/referrals" style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 600 }}>Open pipeline</Link>}
          </div>
          {!data ? <div style={{ padding: '0 22px' }}><Skeleton h={220} /></div> : data.latestReferrals.length === 0 ? (
            <Empty title="No referrals yet" />
          ) : (
            <div className="crm-table-wrap">
              <table className="crm-table" style={{ minWidth: 640 }}>
                <thead>
                  <tr><th>Patient</th><th>Department</th><th>Referred by</th><th>Agent</th><th>Stage</th></tr>
                </thead>
                <tbody>
                  {data.latestReferrals.map((r) => (
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
          )}
        </section>

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

      <div className="crm-row">
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
    </main>
  );
}

function Kpi({ label, value, unit, note, tone = 'ok', flash }: { label: string; value: number; unit?: string; note?: string; tone?: 'ok' | 'bad'; flash?: boolean }) {
  return (
    <div className={`crm-card crm-kpi${flash ? ' is-flash' : ''}`}>
      <span className="crm-kpi-label">{label}</span>
      <span className="crm-kpi-value">{value.toLocaleString('en-IN')}{unit && <span className="crm-kpi-unit">{unit}</span>}</span>
      {note && <span style={{ alignSelf: 'flex-start' }}><Pill tone={tone === 'bad' ? 'bad' : 'ok'}>{note}</Pill></span>}
    </div>
  );
}

function Alert({ count, tone, title, sub, href }: { count: number; tone: string; title: string; sub: string; href?: string }) {
  const [bg, fg] = TONE_BG[count > 0 ? tone : 'neutral'];
  const body = (
    <>
      <span className="crm-badge-count" style={{ background: bg, color: fg }}>{count}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{title}</span>
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{sub}</span>
      </span>
      {href && <ChevronRight size={16} color="#8c96ab" style={{ marginLeft: 'auto', flexShrink: 0 }} aria-hidden />}
    </>
  );
  return (
    <li style={{ padding: 0 }}>
      {href ? <Link href={href} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 0', width: '100%' }}>{body}</Link>
        : <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 0', width: '100%' }}>{body}</div>}
    </li>
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

function TodaysWork({ work, access }: { work: Summary['work']; access: ReturnType<typeof useAccess>['access'] }) {
  const cards: React.ReactNode[] = [];
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
      <WorkCard key="desk" href="/admin/desk" icon={<Inbox size={18} aria-hidden />} title="Referral desk"
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
    cards.push(
      <WorkCard key="wa" href="/admin/broadcasts" icon={<MessageCircle size={18} aria-hidden />} title="WhatsApp"
        big={work.whatsapp.scheduled > 0 ? `${work.whatsapp.scheduled} scheduled` : 'Nothing scheduled'}
        sub={!work.whatsapp.connected ? 'Not connected yet' : work.whatsapp.lastTitle ? `Last: ${work.whatsapp.lastTitle}` : 'No broadcasts sent yet'}
        pct={work.whatsapp.lastReadPct ?? 0} color="var(--ok)" tag={work.whatsapp.lastReadPct != null ? `${work.whatsapp.lastReadPct}% read` : undefined} tagTone="ok" />,
    );
  }
  if (cards.length === 0) return null;
  return (
    <section aria-labelledby="work-h" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 id="work-h" className="crm-h2">Today&apos;s work</h2>
      <div className="crm-work">{cards}</div>
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
      <span className="crm-bar"><span style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }} /></span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{sub}</span>
        {tag && <span style={{ marginLeft: 'auto' }}><Pill tone={tagTone}>{tag}</Pill></span>}
      </span>
    </Link>
  );
}
