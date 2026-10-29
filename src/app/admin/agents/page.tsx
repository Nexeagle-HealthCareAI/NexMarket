'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ChevronLeft, ChevronRight, Phone, UserPlus } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { canView, useAccess } from '@/lib/crm/access';
import { timeAgo, useNow } from '@/lib/crm/live';
import { Empty, ErrorBox, fmt, initials, PageHead, Pill, Skeleton, useLoader, type Tone } from '@/components/crm/ui';

type Status = 'shift' | 'leave' | 'off';
type DayStatus = 'worked' | 'leave' | 'absent' | 'off' | 'today' | 'future';
interface AgentRow {
  agentId: string; name: string; block: string; district: string; phone: string; status: Status; lastSeenAt?: string | null;
  visits: number; partners: number; surveys: number; referrals: number; admitted: number;
  daysWorked: number; absent: number; leave: number; panchayats: number; visited30: number;
}
interface TeamRes {
  month: string; workingDaysSoFar: number;
  kpis: { totalAgents: number; onShift: number; onLeave: number; visitsPerDay: number; partners: number; referrals: number; admitted: number; avgDaysWorked: number };
  agents: AgentRow[];
}
interface Detail {
  agentId: string; name: string; phone: string; block: string; district: string; status: Status; shiftStartedAt?: string | null; lastSeenAt?: string | null;
  perf: { visits: number; visitsPrev: number; partners: number; partnersPrev: number; surveys: number; surveysPrev: number; referrals: number; referralsPrev: number; admitted: number; admittedPrev: number };
  weeks: { label: string; visits: number }[];
  days: { date: string; status: DayStatus; leaveType?: string | null }[];
  attendance: { worked: number; absent: number; leave: number; avgShiftMinutes?: number | null; leaveUsedYear: number; leavePendingYear: number; allowance: number };
  coverage: { total: number; visited30: number };
  flags: { tone: Tone; text: string; link: string }[];
}

const STATUS: Record<Status, { label: string; tone: Tone }> = {
  shift: { label: 'On shift', tone: 'ok' },
  leave: { label: 'On leave', tone: 'warn' },
  off: { label: 'Off today', tone: 'neutral' },
};
const SORTS = [
  { key: 'admitted', label: 'Admissions' },
  { key: 'visits', label: 'Visits' },
  { key: 'partners', label: 'New partners' },
  { key: 'daysWorked', label: 'Days worked' },
  { key: 'coverage', label: 'Coverage' },
] as const;
type SortKey = (typeof SORTS)[number]['key'];

const monthFmt = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const thisMonth = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 7);
function shiftMonth(month: string, by: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);

export default function AgentsPageWrap() {
  return (
    <Suspense fallback={<main className="crm-page"><Skeleton h={120} /></main>}>
      <AgentsPage />
    </Suspense>
  );
}

function AgentsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const { access } = useAccess();
  const selected = params.get('id');
  const [month, setMonth] = useState(thisMonth);
  const [sort, setSort] = useState<SortKey>('admitted');
  const team = useLoader(() => crm.get<TeamRes>(`/api/v1/team?month=${month}`), [month]);
  const now = useNow(30000);

  const select = (id: string | null) => router.replace(id ? `/admin/agents?id=${encodeURIComponent(id)}` : '/admin/agents', { scroll: false });

  const rows = useMemo(() => {
    const list = [...(team.data?.agents ?? [])];
    const val = (r: AgentRow) => (sort === 'coverage' ? pct(r.visited30, r.panchayats) : r[sort]);
    return list.sort((a, b) => val(b) - val(a) || a.name.localeCompare(b.name));
  }, [team.data, sort]);
  const t = team.data;

  return (
    <main className="crm-page">
      <PageHead title="Field agents" sub="How each agent is doing this month: visits, new partners, referrals that became admissions, and days worked.">
        <div className="crm-chips" style={{ alignItems: 'center' }}>
          <button type="button" className="crm-btn is-secondary" aria-label="Previous month" style={{ width: 44, padding: 0 }} onClick={() => setMonth((m) => shiftMonth(m, -1))}><ChevronLeft size={18} aria-hidden /></button>
          <span style={{ fontWeight: 700, minWidth: 130, textAlign: 'center' }}>{monthFmt.format(new Date(`${month}-01T00:00:00Z`))}</span>
          <button type="button" className="crm-btn is-secondary" aria-label="Next month" style={{ width: 44, padding: 0 }} disabled={month >= thisMonth()} onClick={() => setMonth((m) => shiftMonth(m, 1))}><ChevronRight size={18} aria-hidden /></button>
          {canView(access, 'users') && <Link href="/admin/users" className="crm-btn is-secondary"><UserPlus size={16} aria-hidden /> Add agent</Link>}
        </div>
      </PageHead>

      {team.error && <ErrorBox message={team.error} onRetry={team.reload} />}

      {!t ? <Skeleton h={110} /> : (
        <div className="crm-kpis">
          <div className="crm-card crm-kpi"><span className="crm-kpi-label">On shift now</span><span className="crm-kpi-value">{t.kpis.onShift}<span className="crm-kpi-unit">of {t.kpis.totalAgents}</span></span></div>
          <div className="crm-card crm-kpi"><span className="crm-kpi-label">Visits per worked day</span><span className="crm-kpi-value">{t.kpis.visitsPerDay}</span></div>
          <div className="crm-card crm-kpi"><span className="crm-kpi-label">New partners</span><span className="crm-kpi-value">{t.kpis.partners}</span></div>
          <div className="crm-card crm-kpi"><span className="crm-kpi-label">Field referrals → admitted</span><span className="crm-kpi-value">{t.kpis.referrals}<span className="crm-kpi-unit" style={{ color: 'var(--ok-ink)', fontWeight: 700 }}>→ {t.kpis.admitted}</span></span></div>
          <div className="crm-card crm-kpi"><span className="crm-kpi-label">Avg days worked</span><span className="crm-kpi-value">{t.kpis.avgDaysWorked}<span className="crm-kpi-unit">of {t.workingDaysSoFar}</span></span></div>
        </div>
      )}

      <div className={`crm-row pt-split${selected ? ' has-sel' : ''}`}>
        <section className="crm-card grow-3 pt-list" aria-label="Agents" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="crm-chips" style={{ padding: '14px 22px', borderBottom: '1px solid var(--line)', alignItems: 'center' }}>
            <span className="crm-sub" style={{ fontSize: 13 }}>Sort by</span>
            {SORTS.map((s) => <button key={s.key} type="button" className="crm-chip" aria-pressed={sort === s.key} onClick={() => setSort(s.key)}>{s.label}</button>)}
          </div>
          {!t ? <div style={{ padding: 20 }}><Skeleton h={300} /></div> : rows.length === 0 ? <Empty title="No field agents yet">Onboard agents from Users &amp; roles.</Empty> : (
            <div className="crm-table-wrap">
              <table className="crm-table">
                <thead><tr><th>Agent</th><th>Now</th><th style={{ textAlign: 'right' }}>Visits</th><th style={{ textAlign: 'right' }}>Refs → adm.</th><th style={{ textAlign: 'right' }}>Days</th></tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const c = pct(r.visited30, r.panchayats);
                    return (
                      <tr key={r.agentId} className={`pt-tr${r.agentId === selected ? ' is-sel' : ''}`} onClick={() => select(r.agentId)}>
                        <td>
                          <span style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 200 }}>
                            <span className="crm-initials">{initials(r.name)}</span>
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <button type="button" className="pt-name" onClick={(e) => { e.stopPropagation(); select(r.agentId); }}>{r.name}</button>
                              <div className="crm-cell-sub">{r.block || 'No block'} · {r.partners} new partner{r.partners === 1 ? '' : 's'}</div>
                              {r.panchayats > 0 && (
                                <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, maxWidth: 220 }} title="Panchayats in their blocks visited in the last 30 days">
                                  <span className="crm-bar" style={{ flex: 1, height: 6 }}><span style={{ display: 'block', height: '100%', width: `${c}%`, background: c >= 75 ? 'var(--ok)' : c >= 50 ? 'var(--accent)' : 'var(--warn)' }} /></span>
                                  <span style={{ fontSize: 11, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{r.visited30}/{r.panchayats} visited</span>
                                </span>
                              )}
                            </span>
                          </span>
                        </td>
                        <td>
                          <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill>
                          {r.lastSeenAt && <div className="crm-cell-sub" style={{ whiteSpace: 'nowrap' }}>seen {timeAgo(r.lastSeenAt, now)}</div>}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{r.visits}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><strong>{r.referrals}</strong> <span style={{ color: 'var(--ok-ink)', fontWeight: 700 }}>→ {r.admitted}</span></td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: r.absent > 2 ? 'var(--bad)' : undefined, whiteSpace: 'nowrap' }}>{r.daysWorked} / {t.workingDaysSoFar}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="crm-card grow-2 pt-panel" aria-label="Agent profile" style={{ flexBasis: 400 }}>
          {selected ? <Profile key={`${selected}-${month}`} id={selected} month={month} onBack={() => select(null)} now={now} /> : (
            <Empty title="Pick an agent">Their month, attendance calendar and what needs attention show here.</Empty>
          )}
        </aside>
      </div>
    </main>
  );
}

const DAY_STYLE: Record<DayStatus, React.CSSProperties> = {
  worked: { background: 'var(--ok)', color: '#fff' },
  leave: { background: '#f5b544', color: '#3d2600' },
  absent: { background: '#fff', color: 'var(--bad)', border: '2px solid var(--bad)' },
  off: { background: '#e3e6ee', color: 'var(--text-3)' },
  today: { background: '#fff', color: 'var(--accent-ink)', border: '2px solid var(--accent)' },
  future: { background: '#f4f6fa', color: '#8c96ab' },
};
const DAY_LABEL: Record<DayStatus, string> = { worked: 'Worked', leave: 'Leave', absent: 'No shift, no leave', off: 'Sunday / holiday', today: 'Today', future: 'Upcoming' };

function delta(now: number, prev: number) {
  if (prev === 0 && now === 0) return { text: 'same as last month', tone: 'var(--text-2)' };
  const d = now - prev;
  if (d === 0) return { text: 'same as last month', tone: 'var(--text-2)' };
  return { text: `${d > 0 ? '+' : '−'}${Math.abs(d)} vs last month`, tone: d > 0 ? 'var(--ok-ink)' : 'var(--bad)' };
}

function Profile({ id, month, onBack, now }: { id: string; month: string; onBack: () => void; now: number }) {
  const d = useLoader(() => crm.get<Detail>(`/api/v1/team/${encodeURIComponent(id)}?month=${month}`), [id, month]);
  if (d.error) return <ErrorBox message={d.error} onRetry={d.reload} />;
  const a = d.data;
  if (!a) return <Skeleton h={420} />;

  const perf = [
    { label: 'Visits', v: a.perf.visits, p: a.perf.visitsPrev },
    { label: 'New partners', v: a.perf.partners, p: a.perf.partnersPrev },
    { label: 'Surveys done', v: a.perf.surveys, p: a.perf.surveysPrev },
    { label: 'Referrals', v: a.perf.referrals, p: a.perf.referralsPrev },
    { label: 'Admitted', v: a.perf.admitted, p: a.perf.admittedPrev, sub: a.perf.referrals ? `${pct(a.perf.admitted, a.perf.referrals)}% of referrals` : undefined },
  ];
  const max = Math.max(1, ...a.weeks.map((w) => w.visits));
  const firstDow = a.days.length ? (new Date(`${a.days[0].date}T00:00:00Z`).getUTCDay() + 6) % 7 : 0;
  const shift = a.attendance.avgShiftMinutes;
  const tel = a.phone?.replace(/\D/g, '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <button type="button" className="crm-btn is-secondary is-sm pt-back" onClick={onBack}><ArrowLeft size={16} aria-hidden /> All agents</button>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span className="crm-initials" style={{ width: 52, height: 52, fontSize: 18 }}>{initials(a.name)}</span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 20, fontWeight: 800 }}>{a.name}</h2>
            <Pill tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Pill>
          </span>
          <span className="crm-sub" style={{ fontSize: 13 }}>{[a.block && `${a.block} block`, a.district].filter(Boolean).join(' · ') || 'No block assigned'}</span>
          <span className="crm-sub" style={{ fontSize: 13 }}>
            {a.status === 'shift' && a.shiftStartedAt ? `On shift since ${fmt.time(a.shiftStartedAt)}` : 'Not on shift'}
            {a.lastSeenAt ? ` · last location ${timeAgo(a.lastSeenAt, now)}` : ''}
          </span>
        </span>
      </div>
      <div className="crm-chips">
        {tel && <a href={`tel:${tel}`} className="crm-btn is-ok" style={{ color: '#fff' }}><Phone size={16} aria-hidden /> Call</a>}
        <Link href={`/admin/activity?agent=${encodeURIComponent(a.agentId)}`} className="crm-btn is-secondary">Today&apos;s activity</Link>
        <Link href={`/admin/map?agentId=${encodeURIComponent(a.agentId)}`} className="crm-btn is-secondary">On the map</Link>
        <Link href={`/admin/agents/${encodeURIComponent(a.agentId)}`} className="crm-btn is-secondary">Profile details</Link>
      </div>

      <section aria-labelledby="perf-h" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 id="perf-h" style={{ fontSize: 16, fontWeight: 800 }}>Performance · {monthFmt.format(new Date(`${month}-01T00:00:00Z`))}</h3>
        <div className="ag-perf">
          {perf.map((p) => {
            const dl = delta(p.v, p.p);
            return (
              <span key={p.label}>
                <span className="ag-perf-l">{p.label}</span>
                <strong>{p.v}</strong>
                <span style={{ fontSize: 12, fontWeight: 600, color: p.sub ? 'var(--text-2)' : dl.tone }}>{p.sub ?? dl.text}</span>
              </span>
            );
          })}
          <span>
            <span className="ag-perf-l">Panchayats visited</span>
            <strong>{a.coverage.visited30}<span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-2)' }}> / {a.coverage.total}</span></strong>
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>last 30 days</span>
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Visits by week</span>
          <div className="ag-weeks" role="img" aria-label={`Visits by week: ${a.weeks.map((w) => `${w.label} ${w.visits}`).join(', ')}`}>
            {a.weeks.map((w) => (
              <span key={w.label}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{w.visits}</span>
                <span className="ag-week-bar" style={{ height: Math.max(4, Math.round((64 * w.visits) / max)) }} />
                <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{w.label}</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="att-h" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 id="att-h" style={{ fontSize: 16, fontWeight: 800, flex: 1 }}>Attendance</h3>
          <Link href="/admin/leave" style={{ fontSize: 13, fontWeight: 600 }}>Leave board</Link>
        </span>
        <div className="ag-cal">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x, i) => <span key={i} className="ag-cal-h">{x}</span>)}
          {Array.from({ length: firstDow }).map((_, i) => <span key={`b${i}`} />)}
          {a.days.map((day) => (
            <span key={day.date} className="ag-cal-d" style={DAY_STYLE[day.status]} title={`${fmt.date(`${day.date}T06:00:00Z`)} · ${DAY_LABEL[day.status]}${day.leaveType ? ` (${day.leaveType})` : ''}`}>
              {Number(day.date.slice(8))}
            </span>
          ))}
        </div>
        <div className="crm-chips" style={{ gap: 12, fontSize: 12 }}>
          {(['worked', 'leave', 'absent', 'off'] as DayStatus[]).map((k) => (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 11, height: 11, borderRadius: 3, boxSizing: 'border-box', ...DAY_STYLE[k] }} />{DAY_LABEL[k]}</span>
          ))}
        </div>
        <div className="pt-stats">
          <span><span>Days worked</span><strong style={{ fontSize: 18 }}>{a.attendance.worked}</strong></span>
          <span><span>Leave used this year</span><strong style={{ fontSize: 18 }}>{a.attendance.leaveUsedYear}<span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-2)' }}> of {a.attendance.allowance}</span></strong></span>
          <span><span>Average shift</span><strong style={{ fontSize: 18 }}>{shift ? `${Math.floor(shift / 60)}h ${String(shift % 60).padStart(2, '0')}m` : '—'}</strong></span>
        </div>
      </section>

      <section aria-labelledby="flags-h" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3 id="flags-h" style={{ fontSize: 16, fontWeight: 800 }}>Needs attention</h3>
        {a.flags.length === 0 ? <span className="crm-cell-sub">Nothing right now.</span> : a.flags.map((f) => (
          <div key={f.text} className="ag-flag" data-tone={f.tone}>
            <span style={{ flex: 1, fontSize: 14 }}>{f.text}</span>
            <Link href={f.link} style={{ fontSize: 13, fontWeight: 600 }}>Open</Link>
          </div>
        ))}
      </section>
    </div>
  );
}
