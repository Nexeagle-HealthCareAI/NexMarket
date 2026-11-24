'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CalendarX2, Inbox, Settings2, Sun } from 'lucide-react';
import { PageTabs, usePageTab } from '@/components/crm/PageTabs';
import { crm } from '@/lib/sync/api-client';
import { useLiveEvents } from '@/lib/crm/live';
import { Empty, ErrorBox, friendlyError, initials, Modal, PageHead, Pill, Skeleton, useLoader, useToast } from '@/components/crm/ui';
import { thisMonth, type Board as AttBoard, type Person } from '@/components/crm/attendance/shared';
import { TodayView, type Group } from '@/components/crm/attendance/TodayView';
import { RegisterView } from '@/components/crm/attendance/RegisterView';
import { MarkModal, type MarkTarget } from '@/components/crm/attendance/MarkModal';
import { PersonModal } from '@/components/crm/attendance/PersonModal';
import { SettingsModal } from '@/components/crm/attendance/SettingsModal';
import { Pager, usePaged } from '@/components/crm/Pager';

interface Board {
  month: string;
  allowance: number;
  canDecide: boolean;
  kpis: { onShiftToday: number; totalAgents: number; onLeaveToday: number; pending: number; urgentPending: number; avgDaysWorked: number; workingDaysSoFar: number; noShowDays: number };
  requests: { id: string; agentId: string; name: string; block?: string; type: 'urgent' | 'holiday'; fromDate: string; toDate: string; halfDay: boolean; days: number; reason: string; createdAt: string; remaining: number; followUpsAffected: number }[];
  away: { id: string; agentId: string; name: string; block?: string; type: string; fromDate: string; toDate: string; days: number; now: boolean; decidedBy?: string | null }[];
}

const dayFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
function range(from: string, to: string) {
  const a = dayFmt.format(new Date(`${from}T00:00:00Z`));
  return from === to ? a : `${a} – ${dayFmt.format(new Date(`${to}T00:00:00Z`))}`;
}
export default function LeavePageWrap() {
  return <Suspense fallback={<main className="crm-page"><Skeleton h={480} /></main>}><LeavePage /></Suspense>;
}

const TAB_KEYS = ['today', 'register', 'requests', 'away'] as const;

function LeavePage() {
  const [tab, setTab] = usePageTab(TAB_KEYS, 'today');
  const [month, setMonth] = useState(thisMonth);
  const [group, setGroup] = useState<Group>('all');
  const board = useLoader(() => crm.get<Board>('/api/v1/leave/board'), []);
  const att = useLoader(() => crm.get<AttBoard>(`/api/v1/attendance/board?month=${month}`), [month]);
  const [marking, setMarking] = useState<MarkTarget | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [toast, showToast] = useToast();
  const [deciding, setDeciding] = useState<{ id: string; approve: boolean; name: string } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const onEvent = useCallback((e: { kind: string }) => {
    if (e.kind === 'leave') { void board.reload(); void att.reload(); }
    if (e.kind === 'attendance') void att.reload();
  }, [board, att]);
  useLiveEvents(onEvent);
  // Who is in changes all day (shifts start, the CRM opens): refresh every minute while the page is open.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') void att.reload(); }, 60_000);
    return () => clearInterval(t);
  }, [att]);

  const b = board.data;
  const a = att.data;
  const person: Person | null = useMemo(() => (personId && a ? a.people.find((p) => p.agentId === personId) ?? null : null), [personId, a]);
  const saved = (msg: string) => { setMarking(null); showToast(msg); void att.reload(); };
  const reqPg = usePaged(b?.requests ?? [], '', 10);
  const awayPg = usePaged(b?.away ?? [], '', 10);

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
      void att.reload();
    } catch (e) {
      showToast(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="crm-page">
      <PageHead title="Team attendance" sub="Everyone on the team, field and office. Days come from shifts in the app and from the CRM; an admin or marketing manager can mark anyone by hand.">
        {a?.canMark && <button type="button" className="crm-btn is-secondary" onClick={() => setSettings(true)}><Settings2 size={16} aria-hidden /> Settings</button>}
      </PageHead>

      {(att.error || board.error) && <ErrorBox message={(att.error || board.error)!} onRetry={() => { void att.reload(); void board.reload(); }} />}

      <PageTabs label="Team attendance" value={tab} onChange={setTab} tabs={[
        { key: 'today', label: 'Today', icon: Sun },
        { key: 'register', label: 'Month register', icon: CalendarDays },
        { key: 'requests', label: 'Leave requests', icon: Inbox, count: b?.requests.length, hot: !!b?.requests.length },
        { key: 'away', label: 'Who’s away', icon: CalendarX2, count: b?.away.length },
      ]} />

      {tab === 'today' && (!a ? <Skeleton h={360} /> : (
        <TodayView board={a} group={group} setGroup={setGroup} onMark={setMarking} onPerson={(p) => setPersonId(p.agentId)} onSaved={(m) => { showToast(m); void att.reload(); }} />
      ))}

      {tab === 'register' && (
        <RegisterView board={a} loading={att.loading} month={month} setMonth={setMonth} group={group} setGroup={setGroup} onMark={setMarking} onPerson={(p) => setPersonId(p.agentId)} toast={showToast} />
      )}

      {tab === 'requests' && (
        <section className="crm-card" aria-labelledby="req-h">
          <div className="crm-card-head">
            <h2 id="req-h" className="crm-h2">Leave requests</h2>
            {b && !b.canDecide && <span className="crm-sub" style={{ fontSize: 13 }}>Only an admin or marketing manager can approve.</span>}
          </div>
          {!b ? <Skeleton h={180} /> : b.requests.length === 0 ? <Empty title="Nothing waiting">New requests from the app appear here straight away.</Empty> : (
            <ul className="crm-list">
              {reqPg.rows.map((r) => (
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
          {b && <Pager {...reqPg.pager} noun="requests" compact />}
        </section>
      )}

      {tab === 'away' && (
        <section className="crm-card" aria-labelledby="away-h">
          <div className="crm-card-head"><h2 id="away-h" className="crm-h2">Who&apos;s away</h2></div>
          {!b ? <Skeleton h={160} /> : b.away.length === 0 ? <Empty title="Everyone is in">No approved leave today or coming up.</Empty> : (
            <ul className="crm-list">
              {awayPg.rows.map((a) => (
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
          {b && <Pager {...awayPg.pager} noun="people" compact />}
        </section>
      )}

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
      {person && a && <PersonModal person={person} board={a} onClose={() => setPersonId(null)} onMark={(t) => { setPersonId(null); setMarking(t); }} />}
      {marking && a && <MarkModal target={marking} today={a.today} canMark={a.canMark} onClose={() => setMarking(null)} onSaved={saved} />}
      {settings && a && <SettingsModal config={a.config} onClose={() => setSettings(false)} onSaved={() => { setSettings(false); showToast('Settings saved.'); void att.reload(); }} />}
      {toast}
    </main>
  );
}
