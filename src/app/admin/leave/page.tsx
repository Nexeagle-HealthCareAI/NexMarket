'use client';

import { useCallback, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { useLiveEvents } from '@/lib/crm/live';
import { Empty, ErrorBox, friendlyError, initials, Modal, PageHead, Pill, Skeleton, useLoader, useToast } from '@/components/crm/ui';

type DayStatus = 'worked' | 'leave' | 'absent' | 'off' | 'today' | 'future';

interface Board {
  month: string;
  allowance: number;
  canDecide: boolean;
  kpis: { onShiftToday: number; totalAgents: number; onLeaveToday: number; pending: number; urgentPending: number; avgDaysWorked: number; workingDaysSoFar: number; noShowDays: number };
  requests: { id: string; agentId: string; name: string; block?: string; type: 'urgent' | 'holiday'; fromDate: string; toDate: string; halfDay: boolean; days: number; reason: string; createdAt: string; remaining: number; followUpsAffected: number }[];
  away: { id: string; agentId: string; name: string; block?: string; type: string; fromDate: string; toDate: string; days: number; now: boolean; decidedBy?: string | null }[];
  team: { agentId: string; name: string; block?: string; days: { date: string; status: DayStatus; leaveType?: string | null }[]; worked: number; leave: number; absent: number }[];
}

const DAY_COLOR: Record<DayStatus, { bg: string; border?: string; label: string }> = {
  worked: { bg: '#0f8a5f', label: 'Worked' },
  leave: { bg: '#f5b544', label: 'Leave' },
  absent: { bg: '#ffffff', border: '#b42318', label: 'No shift, no leave' },
  off: { bg: '#e3e6ee', label: 'Sunday / holiday' },
  today: { bg: '#ffffff', border: '#0a72d6', label: 'Today' },
  future: { bg: '#f4f6fa', label: 'Upcoming' },
};

const dayFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
function range(from: string, to: string) {
  const a = dayFmt.format(new Date(`${from}T00:00:00Z`));
  return from === to ? a : `${a} – ${dayFmt.format(new Date(`${to}T00:00:00Z`))}`;
}
function shiftMonth(month: string, by: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const thisMonth = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 7);

export default function LeavePage() {
  const [month, setMonth] = useState(thisMonth);
  const board = useLoader(() => crm.get<Board>(`/api/v1/leave/board?month=${month}`), [month]);
  const [toast, showToast] = useToast();
  const [deciding, setDeciding] = useState<{ id: string; approve: boolean; name: string } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const onEvent = useCallback((e: { kind: string }) => { if (e.kind === 'leave') void board.reload(); }, [board]);
  useLiveEvents(onEvent);

  const b = board.data;
  const dayNumbers = useMemo(() => (b?.team[0]?.days ?? []).map((d) => Number(d.date.slice(8))), [b]);

  const decide = async () => {
    if (!deciding) return;
    setBusy(true);
    try {
      const res = await crm.put<{ status: string; followUpsMoved: number }>(`/api/v1/leave/requests/${deciding.id}/decision`, { approve: deciding.approve, note });
      showToast(deciding.approve
        ? `Approved for ${deciding.name}.${res.followUpsMoved ? ` ${res.followUpsMoved} follow-up${res.followUpsMoved === 1 ? '' : 's'} moved to after the leave.` : ''}`
        : `Rejected — ${deciding.name} will see it in the app.`);
      setDeciding(null);
      setNote('');
      void board.reload();
    } catch (e) {
      showToast(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="crm-page">
      <PageHead title="Attendance & leave" sub={`Days worked come from shifts in the agent app. ${b ? `Each agent gets ${b.allowance} leave days a year (urgent and holiday together).` : ''}`}>
        <div className="crm-chips" style={{ alignItems: 'center' }}>
          <button type="button" className="crm-btn is-secondary" aria-label="Previous month" style={{ width: 44, padding: 0 }} onClick={() => setMonth((m) => shiftMonth(m, -1))}><ChevronLeft size={18} aria-hidden /></button>
          <span style={{ fontWeight: 700, minWidth: 130, textAlign: 'center' }}>{monthFmt.format(new Date(`${month}-01T00:00:00Z`))}</span>
          <button type="button" className="crm-btn is-secondary" aria-label="Next month" style={{ width: 44, padding: 0 }} disabled={month >= thisMonth()} onClick={() => setMonth((m) => shiftMonth(m, 1))}><ChevronRight size={18} aria-hidden /></button>
        </div>
      </PageHead>

      {board.error && <ErrorBox message={board.error} onRetry={board.reload} />}

      {!b ? <Skeleton h={120} /> : (
        <div className="crm-kpis">
          <div className="crm-card crm-kpi"><span className="crm-kpi-label">On shift today</span><span className="crm-kpi-value">{b.kpis.onShiftToday}<span className="crm-kpi-unit">of {b.kpis.totalAgents}</span></span></div>
          <div className="crm-card crm-kpi"><span className="crm-kpi-label">On leave today</span><span className="crm-kpi-value" style={{ color: 'var(--warn-ink)' }}>{b.kpis.onLeaveToday}</span></div>
          <div className="crm-card crm-kpi" style={b.kpis.pending ? { background: 'var(--warn-soft)', borderColor: '#f0c98a' } : undefined}>
            <span className="crm-kpi-label">Requests waiting</span>
            <span className="crm-kpi-value" style={{ color: b.kpis.pending ? 'var(--warn-ink)' : undefined }}>{b.kpis.pending}{b.kpis.urgentPending > 0 && <span className="crm-kpi-unit">· {b.kpis.urgentPending} urgent</span>}</span>
          </div>
          <div className="crm-card crm-kpi"><span className="crm-kpi-label">Avg days worked</span><span className="crm-kpi-value">{b.kpis.avgDaysWorked}<span className="crm-kpi-unit">of {b.kpis.workingDaysSoFar}</span></span></div>
          <div className="crm-card crm-kpi"><span className="crm-kpi-label">No-show days</span><span className="crm-kpi-value" style={{ color: b.kpis.noShowDays ? 'var(--bad)' : undefined }}>{b.kpis.noShowDays}</span></div>
        </div>
      )}

      <div className="crm-row">
        <section className="crm-card grow-2" aria-labelledby="req-h">
          <div className="crm-card-head">
            <h2 id="req-h" className="crm-h2">Leave requests</h2>
            {b && !b.canDecide && <span className="crm-sub" style={{ fontSize: 13 }}>Only an admin or marketing manager can approve.</span>}
          </div>
          {!b ? <Skeleton h={180} /> : b.requests.length === 0 ? <Empty title="Nothing waiting">New requests from the app appear here straight away.</Empty> : (
            <ul className="crm-list">
              {b.requests.map((r) => (
                <li key={r.id} style={{ flexWrap: 'wrap' }}>
                  <span className="crm-initials">{initials(r.name)}</span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '1 1 260px', minWidth: 0 }}>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong>{r.name}</strong>
                      <Pill tone={r.type === 'urgent' ? 'bad' : 'accent'}>{r.type === 'urgent' ? 'Urgent' : 'Holiday'}</Pill>
                      {r.block && <span className="crm-cell-sub">{r.block}</span>}
                    </span>
                    <span style={{ fontSize: 14 }}>{range(r.fromDate, r.toDate)} · <strong>{r.days} day{r.days === 1 ? '' : 's'}</strong>{r.halfDay ? ' (half day)' : ''}</span>
                    <span className="crm-cell-sub">“{r.reason}” · {r.remaining} days left this year{r.followUpsAffected ? ` · ${r.followUpsAffected} follow-up${r.followUpsAffected === 1 ? '' : 's'} will move` : ''}</span>
                  </span>
                  {b.canDecide && (
                    <span style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="crm-btn is-danger is-sm" onClick={() => setDeciding({ id: r.id, approve: false, name: r.name })}>Reject</button>
                      <button type="button" className="crm-btn is-ok is-sm" onClick={() => setDeciding({ id: r.id, approve: true, name: r.name })}>Approve</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="crm-card grow-1" aria-labelledby="away-h" style={{ flexBasis: 320 }}>
          <div className="crm-card-head"><h2 id="away-h" className="crm-h2">Who&apos;s away</h2></div>
          {!b ? <Skeleton h={160} /> : b.away.length === 0 ? <Empty title="Everyone is in">No approved leave today or coming up.</Empty> : (
            <ul className="crm-list">
              {b.away.map((a) => (
                <li key={a.id}>
                  <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <strong style={{ fontSize: 14 }}>{a.name}</strong>
                    <span className="crm-cell-sub">{range(a.fromDate, a.toDate)} · {a.type}{a.now && a.block ? ` · ${a.block} uncovered` : ''}</span>
                  </span>
                  <Pill tone={a.now ? 'bad' : 'accent'}>{a.now ? 'Away now' : `${a.days} day${a.days === 1 ? '' : 's'}`}</Pill>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      <section className="crm-card" aria-labelledby="grid-h" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="crm-card-head" style={{ flexWrap: 'wrap', gap: 12 }}>
          <h2 id="grid-h" className="crm-h2">Team attendance</h2>
          <div className="crm-chips" style={{ fontSize: 12 }}>
            {(['worked', 'leave', 'absent', 'off'] as DayStatus[]).map((s) => (
              <span key={s} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: DAY_COLOR[s].bg, border: DAY_COLOR[s].border ? `2px solid ${DAY_COLOR[s].border}` : undefined, boxSizing: 'border-box' }} />{DAY_COLOR[s].label}
              </span>
            ))}
          </div>
        </div>
        {!b ? <Skeleton h={220} /> : b.team.length === 0 ? <Empty title="No field agents" /> : (
          <div className="crm-table-wrap">
            <table className="crm-table" style={{ minWidth: 980 }}>
              <thead>
                <tr>
                  <th style={{ width: 170 }}>Agent</th>
                  <th>
                    <span style={{ display: 'grid', gridTemplateColumns: `repeat(${dayNumbers.length}, minmax(0, 1fr))`, gap: 3, textAlign: 'center', fontSize: 10 }}>
                      {dayNumbers.map((n) => <span key={n}>{n}</span>)}
                    </span>
                  </th>
                  <th style={{ textAlign: 'right' }}>Worked</th>
                  <th style={{ textAlign: 'right' }}>Leave</th>
                  <th style={{ textAlign: 'right' }}>No-show</th>
                </tr>
              </thead>
              <tbody>
                {b.team.map((t) => (
                  <tr key={t.agentId}>
                    <td><span className="crm-cell-main" style={{ fontWeight: 600 }}>{t.name}</span>{t.block && <span className="crm-cell-sub" style={{ display: 'block' }}>{t.block}</span>}</td>
                    <td>
                      <span style={{ display: 'grid', gridTemplateColumns: `repeat(${t.days.length}, minmax(0, 1fr))`, gap: 3 }}>
                        {t.days.map((d) => (
                          <span key={d.date} title={`${d.date} · ${DAY_COLOR[d.status].label}${d.leaveType ? ` (${d.leaveType})` : ''}`}
                            style={{ height: 22, borderRadius: 4, background: DAY_COLOR[d.status].bg, border: DAY_COLOR[d.status].border ? `2px solid ${DAY_COLOR[d.status].border}` : undefined, boxSizing: 'border-box' }} />
                        ))}
                      </span>
                    </td>
                    <td className="num" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--ok-ink)' }}>{t.worked}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{t.leave}</td>
                    <td className="num" style={{ textAlign: 'right', color: t.absent ? 'var(--bad)' : undefined }}>{t.absent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {deciding && (
        <Modal title={deciding.approve ? `Approve leave for ${deciding.name}?` : `Reject leave for ${deciding.name}?`} onClose={() => setDeciding(null)}
          actions={<>
            <button type="button" className="crm-btn is-secondary" onClick={() => setDeciding(null)}>Cancel</button>
            <button type="button" className={`crm-btn ${deciding.approve ? 'is-ok' : 'is-danger'}`} disabled={busy} onClick={decide}>{busy ? 'Saving…' : deciding.approve ? 'Approve' : 'Reject'}</button>
          </>}>
          <p className="crm-sub" style={{ margin: 0 }}>
            {deciding.approve ? 'Their follow-ups during the leave move to the next working day. They see the decision in the app.' : 'They see the decision and your note in the app.'}
          </p>
          <label className="crm-field">Note for the agent (optional)
            <textarea className="crm-textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder={deciding.approve ? 'e.g. Ravi will cover Dighalbank' : 'e.g. Camp on those dates — please pick another week'} />
          </label>
        </Modal>
      )}
      {toast}
    </main>
  );
}
