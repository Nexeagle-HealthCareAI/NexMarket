'use client';

import { CalendarRange } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { Modal, Skeleton, useLoader } from '@/components/crm/ui';
import { cellOf, dayLabel, fmtDays, leaveLabel, MARKS, monthLabel, rangeLabel, roleLabel, timeOf, WEEKDAYS, weekdayOf, type Board, type Person } from './shared';
import type { MarkTarget } from './MarkModal';
import { Avatar } from './TodayView';

interface History {
  marks: { date: string; status: string; leaveType?: string | null; note?: string | null; markedBy: string; markedAt: string }[];
  leaves: { id: string; type: string; fromDate: string; toDate: string; days: number; status: string; reason: string }[];
}

const stamp = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

/** One person's month: totals, leave left this year, a calendar with start and finish times, and who marked what. */
export function PersonModal({ person: p, board, onClose, onMark }: { person: Person; board: Board; onClose: () => void; onMark: (t: MarkTarget) => void }) {
  const hist = useLoader(() => crm.get<History>(`/api/v1/attendance/people/${encodeURIComponent(p.agentId)}/history`), [p.agentId]);
  const lead = p.days.length ? weekdayOf(p.days[0].date) : 0;
  const worked = p.days.filter((d) => d.status === 'worked' && d.inAt);
  const avgIn = worked.length ? Math.round(worked.reduce((s, d) => { const t = new Date(new Date(d.inAt!).getTime() + 5.5 * 3600e3); return s + t.getUTCHours() * 60 + t.getUTCMinutes(); }, 0) / worked.length) : null;
  const avgInLabel = avgIn == null ? '–' : timeOf(new Date(Date.UTC(2026, 0, 1, Math.floor(avgIn / 60), avgIn % 60) - 5.5 * 3600e3).toISOString());

  return (
    <Modal title={p.name} onClose={onClose} wide
      actions={board.canMark ? <button type="button" className="crm-btn" onClick={() => onMark({ people: [p], from: board.today, status: 'leave' })}><CalendarRange size={16} aria-hidden /> Mark days</button> : undefined}>
      <div className="at-person-top">
        <Avatar p={p} />
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <strong>{roleLabel(p.role, p.group)} · {p.group === 'office' ? 'Office team' : 'Field team'}</strong>
          <span className="crm-cell-sub">{p.agentId}{p.block ? ` · ${p.block}` : ''}{p.district && p.district !== p.block ? `, ${p.district}` : ''}{p.online ? ' · online now' : ''}</span>
        </span>
      </div>

      <div className="at-stats">
        <span><strong className="is-ok">{fmtDays(p.totals.present)}</strong>present</span>
        <span><strong>{p.totals.leave}</strong>leave</span>
        <span><strong className={p.totals.absent ? 'is-bad' : ''}>{p.totals.absent}</strong>absent</span>
        <span><strong className={p.totals.late ? 'is-warn' : ''}>{p.totals.late}</strong>late</span>
        <span><strong>{avgInLabel}</strong>usual start</span>
        <span><strong>{fmtDays(p.leaveBalance.remaining)}</strong>leave left this year{p.leaveBalance.pending ? ` (${fmtDays(p.leaveBalance.pending)} waiting)` : ''}</span>
      </div>

      <h3 className="at-h3">{monthLabel(board.month)}</h3>
      <div className="at-cal" role="list">
        {WEEKDAYS.map((w) => <span key={w} className="at-cal-wd" aria-hidden>{w}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} aria-hidden />)}
        {p.days.map((d) => {
          const c = cellOf(d);
          return (
            <button key={d.date} type="button" role="listitem" className={`at-cal-day ${c.cls}${d.date === board.today ? ' is-today' : ''}`}
              aria-label={`${dayLabel(d.date)}: ${c.label}${d.inAt ? `, in ${timeOf(d.inAt)}` : ''}${d.late ? ', late' : ''}`}
              onClick={() => onMark({ people: [p], from: d.date, day: d })}>
              <span className="at-cal-n">{Number(d.date.slice(8))}</span>
              <span className="at-cal-s">{d.status === 'worked' && d.inAt ? timeOf(d.inAt) : c.code || (d.status === 'off' && d.holiday ? d.holiday : '')}</span>
              {d.late && <span className="at-cal-late" aria-hidden />}
              {d.source === 'mark' && <span className="at-cal-hand" aria-hidden />}
            </button>
          );
        })}
      </div>

      <h3 className="at-h3">History</h3>
      {!hist.data ? <Skeleton h={80} /> : hist.data.marks.length === 0 && hist.data.leaves.length === 0 ? <p className="crm-sub" style={{ margin: 0 }}>Nothing marked by hand and no leave requests yet.</p> : (
        <ul className="at-hist">
          {hist.data.leaves.slice(0, 6).map((l) => (
            <li key={l.id}><span className={`at-badge ${l.status === 'approved' ? 'is-leave' : l.status === 'pending' ? 'is-notin' : 'is-future'}`}>{l.status}</span>
              <span>{leaveLabel(l.type)} leave request, {rangeLabel(l.fromDate, l.toDate)} ({fmtDays(l.days)} day{l.days === 1 ? '' : 's'}){l.reason ? ` — “${l.reason}”` : ''}</span></li>
          ))}
          {hist.data.marks.slice(0, 12).map((m, i) => (
            <li key={`${m.date}${i}`}><span className={`at-badge ${cellOf({ date: m.date, status: m.status === 'present' || m.status === 'half' ? 'worked' : m.status === 'leave' ? 'leave' : m.status === 'off' ? 'off' : 'absent', half: m.status === 'half', late: false, leaveType: m.leaveType }).cls}`}>{MARKS.find((x) => x.key === m.status)?.label ?? m.status}</span>
              <span>{dayLabel(m.date)}{m.status === 'leave' ? ` · ${leaveLabel(m.leaveType)}` : ''}{m.note ? ` — “${m.note}”` : ''} <span className="crm-cell-sub">· {m.markedBy}, {stamp.format(new Date(m.markedAt))}</span></span></li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
