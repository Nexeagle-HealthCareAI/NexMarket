'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import AnalystWorkspace from '@/components/crm/AnalystWorkspace';
import { contactTypeLabel, Empty, ErrorBox, fmt, PageHead, rupees, Skeleton, useLoader } from '@/components/crm/ui';

// ─── Types ──────────────────────────────────────────────────────────────────
interface Funnel { referred: number; arrived: number; admitted: number; discharged: number; lost: number; waiting: number; urgent: number }
interface Row { name: string; referred: number; arrived: number; admitted: number; lost: number; admittedPrev: number; paid: number; partners: number }
interface OverviewRes {
  overview: {
    from: string; to: string; days: number; now: Funnel; previous: Funnel; activePartners: number; activePartnersPrev: number;
    newPartners: number; totalPartners: number; paidToPartners: number; owedToPartners: number; costPerAdmission: number;
    months: { month: string; referred: number; arrived: number; admitted: number }[];
  };
  group: string;
  breakdown: Row[];
  departments: Row[];
  topPartners: { clientId: string; name: string; type: string; panchayat?: string; block?: string; champion: boolean; referred: number; admitted: number; paid: number }[];
  goneQuiet: { clientId: string; name: string; type: string; block?: string; champion: boolean; earlierReferrals: number; lastReferral: string }[];
}
const PERIODS = [{ d: 7, l: '7 days' }, { d: 30, l: '30 days' }, { d: 90, l: '3 months' }, { d: 365, l: '12 months' }];
const GROUPS = [{ k: 'block', l: 'Block' }, { k: 'type', l: 'Partner type' }, { k: 'agent', l: 'Agent' }, { k: 'department', l: 'Department' }];
const monthFmt = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' });
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);

function delta(now: number, prev: number) {
  if (prev === 0) return now === 0 ? '' : 'new this period';
  const d = Math.round(((now - prev) / prev) * 100);
  return d === 0 ? 'same as before' : `${d > 0 ? '+' : '−'}${Math.abs(d)}% vs previous`;
}

export default function AnalyticsWrap() {
  return (
    <Suspense fallback={<main className="crm-page"><Skeleton h={120} /></main>}>
      <AnalyticsPage />
    </Suspense>
  );
}

function AnalyticsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get('tab') === 'ai' ? 'ai' : 'business';
  const [days, setDays] = useState(30);
  const setTab = (t: string) => router.replace(t === 'ai' ? '/admin/reports?tab=ai' : '/admin/reports', { scroll: false });

  return (
    <main className="crm-page">
      <PageHead title="Analytics" sub="What outreach brings the hospital, and an AI analyst that reads the numbers every day and keeps track of what needs doing.">
        {tab === 'business' && (
          <div className="crm-chips" role="group" aria-label="Period">
            {PERIODS.map((p) => <button key={p.d} type="button" className="crm-chip" aria-pressed={days === p.d} onClick={() => setDays(p.d)}>{p.l}</button>)}
          </div>
        )}
      </PageHead>
      <div className="crm-tabs" role="tablist" aria-label="Analytics views">
        <button type="button" role="tab" className="crm-tab" aria-selected={tab === 'business'} onClick={() => setTab('business')}>Business view</button>
        <button type="button" role="tab" className="crm-tab" aria-selected={tab === 'ai'} onClick={() => setTab('ai')}><Sparkles size={14} aria-hidden style={{ verticalAlign: -2, marginRight: 6 }} />AI analyst</button>
      </div>
      {tab === 'business' ? <Business days={days} /> : <AnalystWorkspace />}
    </main>
  );
}

// ─── Business view ─────────────────────────────────────────────────────────

function Business({ days }: { days: number }) {
  const [group, setGroup] = useState('block');
  const data = useLoader(() => crm.get<OverviewRes>(`/api/v1/analytics/overview?days=${days}&group=${group}`), [days, group]);
  if (data.error) return <ErrorBox message={data.error} onRetry={data.reload} />;
  const d = data.data;
  if (!d) return <Skeleton h={480} />;
  const o = d.overview;
  const n = o.now, p = o.previous;
  const maxMonth = Math.max(1, ...o.months.map((m) => m.referred));
  const funnel: [string, number, string][] = [
    ['Referred', n.referred, '#c7cbf5'], ['Arrived at hospital', n.arrived, '#8e94f2'], ['Admitted', n.admitted, 'var(--accent)'], ['Discharged', n.discharged, 'var(--accent-ink)'],
  ];
  const maxDept = Math.max(1, ...d.departments.map((x) => x.admitted));

  return (
    <>
      <div className="crm-kpis">
        <Kpi label="Referrals" value={n.referred} sub={delta(n.referred, p.referred)} up={n.referred >= p.referred} />
        <Kpi label="Arrived" value={`${pct(n.arrived, n.referred)}%`} sub={`${n.arrived} patients · was ${pct(p.arrived, p.referred)}%`} up={pct(n.arrived, n.referred) >= pct(p.arrived, p.referred)} />
        <Kpi label="Admitted" value={n.admitted} sub={delta(n.admitted, p.admitted)} up={n.admitted >= p.admitted} />
        <Kpi label="Paid to partners" value={rupees(o.paidToPartners)} sub={o.costPerAdmission ? `${rupees(o.costPerAdmission)} per admission` : `${rupees(o.owedToPartners)} still owed`} />
        <Kpi label="Partners sending patients" value={o.activePartners} sub={`of ${o.totalPartners.toLocaleString('en-IN')} · ${o.newPartners} new`} up={o.activePartners >= o.activePartnersPrev} />
      </div>

      <div className="crm-row">
        <section className="crm-card grow-1" aria-labelledby="fn-h" style={{ flexBasis: 420 }}>
          <div className="crm-card-head"><h2 id="fn-h" className="crm-h2">From referral to discharge</h2></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {funnel.map(([label, v, c], i) => (
              <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ display: 'flex', gap: 8, fontSize: 14 }}>
                  <span style={{ flex: 1, fontWeight: 600 }}>{label}</span><strong>{v}</strong>
                  <span className="crm-cell-sub" style={{ width: 96, textAlign: 'right', marginTop: 0 }}>{i === 0 ? '100%' : `${pct(v, funnel[i - 1][1])}% of previous`}</span>
                </span>
                <span className="crm-bar" style={{ height: 20, borderRadius: 6 }}><span style={{ display: 'block', height: '100%', borderRadius: 6, width: `${pct(v, n.referred)}%`, background: c }} /></span>
              </div>
            ))}
            <div className="crm-note" style={{ background: 'var(--warn-soft)', color: 'var(--warn-ink)' }}>
              <strong>{n.lost}</strong> referred patients never came · <strong>{n.waiting}</strong> still waiting to arrive{n.urgent ? ` · ${n.urgent} were urgent` : ''}.
            </div>
          </div>
        </section>

        <section className="crm-card grow-2" aria-labelledby="tr-h" style={{ flexBasis: 460 }}>
          <div className="crm-card-head">
            <h2 id="tr-h" className="crm-h2" style={{ flex: 1 }}>Referrals and admissions by month</h2>
            <span className="an-leg"><span style={{ background: '#c7cbf5' }} />Referred</span>
            <span className="an-leg"><span style={{ background: 'var(--accent-ink)' }} />Admitted</span>
          </div>
          <div className="an-months" role="img" aria-label={o.months.map((m) => `${m.month}: ${m.referred} referred, ${m.admitted} admitted`).join('; ')}>
            {o.months.map((m) => (
              <span key={m.month} className="an-month">
                <span className="an-pair">
                  <span className="an-col"><span className="an-v">{m.referred}</span><span className="an-bar" style={{ height: Math.round((170 * m.referred) / maxMonth), background: '#c7cbf5' }} /></span>
                  <span className="an-col"><span className="an-v" style={{ fontWeight: 700 }}>{m.admitted}</span><span className="an-bar" style={{ height: Math.round((170 * m.admitted) / maxMonth), background: 'var(--accent-ink)' }} /></span>
                </span>
                <span className="crm-cell-sub" style={{ textAlign: 'center' }}>{monthFmt.format(new Date(`${m.month}-15T00:00:00Z`))}</span>
              </span>
            ))}
          </div>
        </section>
      </div>

      <section className="crm-card" aria-labelledby="bd-h" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="crm-card-head" style={{ padding: '18px 22px 6px' }}>
          <h2 id="bd-h" className="crm-h2" style={{ flex: 1 }}>Where admissions come from</h2>
          <div className="pt-seg" role="group" aria-label="Group by">
            {GROUPS.map((g) => <button key={g.k} type="button" aria-pressed={group === g.k} onClick={() => setGroup(g.k)}>{g.l}</button>)}
          </div>
        </div>
        {d.breakdown.length === 0 ? <Empty title="No referrals in this period" /> : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead><tr><th>{GROUPS.find((g) => g.k === d.group)?.l}</th><th style={{ textAlign: 'right' }}>Referred</th><th style={{ textAlign: 'right' }}>Arrived</th><th style={{ textAlign: 'right' }}>Admitted</th><th>Arrival rate</th><th style={{ textAlign: 'right' }}>Never came</th><th style={{ textAlign: 'right' }}>Paid partners</th></tr></thead>
              <tbody>
                {d.breakdown.map((r) => {
                  const a = pct(r.arrived, r.referred);
                  const change = r.admitted - r.admittedPrev;
                  return (
                    <tr key={r.name}>
                      <td><span className="crm-cell-main">{d.group === 'type' ? contactTypeLabel(r.name) : r.name}</span><div className="crm-cell-sub">{r.partners} partner{r.partners === 1 ? '' : 's'} sending</div></td>
                      <td style={{ textAlign: 'right' }}>{r.referred}</td>
                      <td style={{ textAlign: 'right' }}>{r.arrived}</td>
                      <td style={{ textAlign: 'right' }}><strong>{r.admitted}</strong>{change !== 0 && <div className="crm-cell-sub" style={{ color: change > 0 ? 'var(--ok-ink)' : 'var(--bad)' }}>{change > 0 ? '+' : '−'}{Math.abs(change)} vs before</div>}</td>
                      <td><span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 130 }}><span className="crm-bar" style={{ flex: 1, height: 8 }}><span style={{ display: 'block', height: '100%', width: `${a}%`, background: a >= 70 ? 'var(--ok)' : a >= 50 ? 'var(--accent)' : 'var(--warn)' }} /></span><span style={{ fontSize: 12, width: 34, textAlign: 'right' }}>{a}%</span></span></td>
                      <td style={{ textAlign: 'right', color: r.lost ? 'var(--bad)' : undefined }}>{r.lost}</td>
                      <td style={{ textAlign: 'right' }}>{d.group === 'department' ? '—' : rupees(r.paid)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="crm-row">
        <section className="crm-card grow-1" aria-labelledby="dp-h" style={{ flexBasis: 360 }}>
          <div className="crm-card-head"><h2 id="dp-h" className="crm-h2">Admissions by department</h2></div>
          {d.departments.length === 0 ? <span className="crm-cell-sub">No admissions yet.</span> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {d.departments.map((x) => (
                <div key={x.name} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,150px) minmax(0,1fr) 40px', gap: 10, alignItems: 'center', fontSize: 14 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</span>
                  <span className="crm-bar" style={{ height: 16, borderRadius: 5 }}><span style={{ display: 'block', height: '100%', borderRadius: 5, width: `${pct(x.admitted, maxDept)}%`, background: 'var(--accent)' }} /></span>
                  <strong style={{ textAlign: 'right' }}>{x.admitted}</strong>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="crm-card grow-1" aria-labelledby="tp-h" style={{ flexBasis: 360 }}>
          <div className="crm-card-head"><h2 id="tp-h" className="crm-h2" style={{ flex: 1 }}>Top partners</h2><Link href="/admin/partners" style={{ fontSize: 13, fontWeight: 600 }}>All partners</Link></div>
          {d.topPartners.length === 0 ? <span className="crm-cell-sub">Nobody referred in this period.</span> : (
            <ol className="crm-list">
              {d.topPartners.map((t, i) => (
                <li key={t.clientId}>
                  <span style={{ width: 20, color: 'var(--text-2)', fontWeight: 700 }}>{i + 1}</span>
                  <Link href={`/admin/partners?id=${encodeURIComponent(t.clientId)}`} style={{ flex: 1, minWidth: 0, color: 'var(--text)' }}>
                    <span style={{ fontWeight: 600 }}>{t.name}</span>{t.champion && <span className="pt-champ">Champion</span>}
                    <div className="crm-cell-sub">{[contactTypeLabel(t.type), t.panchayat, t.block].filter(Boolean).join(' · ')}</div>
                  </Link>
                  <span style={{ textAlign: 'right', fontSize: 13 }}><strong>{t.admitted}</strong> adm.<div className="crm-cell-sub">{t.referred} referred</div></span>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className="crm-card grow-1" aria-labelledby="gq-h" style={{ flexBasis: 360 }}>
          <div className="crm-card-head"><h2 id="gq-h" className="crm-h2">Gone quiet</h2></div>
          <span className="crm-sub" style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>Sent patients before, none in this period. Worth a call.</span>
          {d.goneQuiet.length === 0 ? <span className="crm-cell-sub">Nobody has gone quiet.</span> : (
            <ul className="crm-list">
              {d.goneQuiet.map((g) => (
                <li key={g.clientId}>
                  <Link href={`/admin/partners?id=${encodeURIComponent(g.clientId)}`} style={{ flex: 1, minWidth: 0, color: 'var(--text)' }}>
                    <span style={{ fontWeight: 600 }}>{g.name}</span>{g.champion && <span className="pt-champ">Champion</span>}
                    <div className="crm-cell-sub">{[contactTypeLabel(g.type), g.block, `last sent ${fmt.date(g.lastReferral)}`].filter(Boolean).join(' · ')}</div>
                  </Link>
                  <span style={{ fontSize: 13 }}>{g.earlierReferrals} before</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function Kpi({ label, value, sub, up }: { label: string; value: string | number; sub?: string; up?: boolean }) {
  return (
    <div className="crm-card crm-kpi">
      <span className="crm-kpi-label">{label}</span>
      <span className="crm-kpi-value" style={{ fontSize: 26 }}>{value}</span>
      {sub && <span style={{ fontSize: 12, fontWeight: 600, color: up === undefined ? 'var(--text-2)' : up ? 'var(--ok-ink)' : 'var(--bad)' }}>{sub}</span>}
    </div>
  );
}

