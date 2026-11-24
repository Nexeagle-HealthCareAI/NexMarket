'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { Empty, friendlyError, Skeleton } from '@/components/crm/ui';
import { Pager, usePaged } from '@/components/crm/Pager';
import { cellOf, detailOf, dayLabel, fmtDays, monthLabel, roleLabel, shiftMonth, thisMonth, WEEKDAYS, weekdayOf, type Board, type Person } from './shared';
import type { MarkTarget } from './MarkModal';
import { Avatar, GroupChips, type Group } from './TodayView';

const LEGEND: { cls: string; code: string; label: string }[] = [
  { cls: 'is-present', code: 'P', label: 'Present' },
  { cls: 'is-half', code: '½', label: 'Half day' },
  { cls: 'is-leave', code: 'L', label: 'Leave' },
  { cls: 'is-absent', code: 'A', label: 'Absent' },
  { cls: 'is-off', code: '', label: 'Day off / holiday' },
];

type Sort = 'name' | 'present' | 'absent' | 'late';

/**
 * The month for everyone, a square per day. Tap a square to see what was recorded and to mark it; tap a name for the
 * person's month. Totals count a half day as ½.
 */
export function RegisterView({ board, loading, month, setMonth, group, setGroup, onMark, onPerson, toast }: {
  board: Board | null; loading: boolean; month: string; setMonth: (m: string) => void; group: Group; setGroup: (g: Group) => void;
  onMark: (t: MarkTarget) => void; onPerson: (p: Person) => void; toast: (m: string) => void;
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const people = useMemo(() => {
    if (!board) return [];
    const term = q.trim().toLowerCase();
    const list = board.people.filter((p) => (group === 'all' || p.group === group) && (!term || `${p.name} ${p.agentId} ${p.block ?? ''}`.toLowerCase().includes(term)));
    if (sort === 'present') list.sort((a, b) => b.totals.present - a.totals.present);
    if (sort === 'absent') list.sort((a, b) => b.totals.absent - a.totals.absent);
    if (sort === 'late') list.sort((a, b) => b.totals.late - a.totals.late);
    return list;
  }, [board, group, q, sort]);
  const pg = usePaged(people, `${month}|${group}|${q}|${sort}`, 25);
  const days = board?.people[0]?.days ?? [];
  const holidays = new Map((board?.holidays ?? []).map((h) => [h.date, h.name]));
  const offDays = new Set(board?.config.weeklyOff ?? [0]);

  const exportCsv = async () => {
    try { await crm.download(`/api/v1/attendance/export?month=${month}`, `attendance-${month}.csv`); }
    catch (e) { toast(friendlyError(e)); }
  };

  return (
    <section className="crm-card at-reg" aria-labelledby="at-reg-h">
      <div className="at-head">
        <div className="at-month">
          <button type="button" className="crm-btn is-secondary is-sm" aria-label="Previous month" style={{ width: 40, padding: 0 }} onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={17} aria-hidden /></button>
          <h2 id="at-reg-h" className="crm-h2" style={{ minWidth: 150, textAlign: 'center' }}>{monthLabel(month)}</h2>
          <button type="button" className="crm-btn is-secondary is-sm" aria-label="Next month" style={{ width: 40, padding: 0 }} disabled={month >= thisMonth()} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={17} aria-hidden /></button>
        </div>
        {board && <GroupChips value={group} onChange={setGroup} board={board} />}
      </div>

      <div className="at-tools">
        <label className="crm-search" style={{ flex: '1 1 220px' }}>
          <Search size={16} aria-hidden /><span className="crm-sr">Search the team</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, ID or block" />
        </label>
        <label className="at-sort">Sort
          <select className="crm-select" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="name">Name</option>
            <option value="present">Most days present</option>
            <option value="absent">Most absences</option>
            <option value="late">Most late starts</option>
          </select>
        </label>
        <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void exportCsv()} disabled={!board?.people.length}><Download size={15} aria-hidden /> Export for payroll</button>
      </div>

      <div className="at-legend" aria-label="Key">
        {LEGEND.map((l) => <span key={l.cls}><span className={`at-cell is-mini ${l.cls}`} aria-hidden>{l.code}</span>{l.label}</span>)}
        <span><span className="at-cell is-mini is-present is-late-mark" aria-hidden>P</span>Late</span>
        <span><span className="at-cell is-mini is-present is-hand" aria-hidden>P</span>Marked by hand</span>
        {board && <span className="crm-cell-sub">{board.workingDaysSoFar} working day{board.workingDaysSoFar === 1 ? '' : 's'} so far</span>}
      </div>

      {!board || (loading && board.month !== month) ? <Skeleton h={320} /> : people.length === 0 ? <Empty title="Nobody matches">Clear the search or pick another team.</Empty> : (
        <>
          <div className="crm-table-wrap at-grid-wrap">
            <table className="at-grid">
              <thead>
                <tr>
                  <th scope="col" className="at-name-col">Person</th>
                  <th scope="col" className="at-tot" title="Days present (a half day counts ½)">Pres.</th>
                  <th scope="col" className="at-tot">Leave</th>
                  <th scope="col" className="at-tot">Abs.</th>
                  <th scope="col" className="at-tot at-tot-last">Late</th>
                  {days.map((d) => {
                    const wd = weekdayOf(d.date);
                    const hol = holidays.get(d.date);
                    return (
                      <th key={d.date} scope="col" className={`at-dh${offDays.has(wd) || hol ? ' is-off' : ''}${d.date === board.today ? ' is-today' : ''}`} title={hol ? `${dayLabel(d.date)} · ${hol}` : dayLabel(d.date)}>
                        <span>{WEEKDAYS[wd][0]}</span><strong>{Number(d.date.slice(8))}</strong>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {pg.rows.map((p) => (
                  <tr key={p.agentId}>
                    <th scope="row" className="at-name-col">
                      <button type="button" className="at-who is-compact" onClick={() => onPerson(p)}>
                        <Avatar p={p} />
                        <span className="at-who-t"><strong>{p.name}</strong><span className="crm-cell-sub">{roleLabel(p.role, p.group)}{p.block ? ` · ${p.block}` : ''}</span></span>
                      </button>
                    </th>
                    <td className="at-tot num is-ok">{fmtDays(p.totals.present)}</td>
                    <td className="at-tot num">{p.totals.leave || '–'}</td>
                    <td className={`at-tot num${p.totals.absent ? ' is-bad' : ''}`}>{p.totals.absent || '–'}</td>
                    <td className={`at-tot at-tot-last num${p.totals.late ? ' is-warn' : ''}`}>{p.totals.late || '–'}</td>
                    {p.days.map((d) => {
                      const c = cellOf(d);
                      const more = [detailOf(d), d.late ? 'late' : '', d.source === 'mark' ? `marked by ${d.markedBy}` : '', d.note ? `“${d.note}”` : ''].filter(Boolean).join(' · ');
                      const label = `${p.name}, ${dayLabel(d.date)}: ${c.label}${more ? ` — ${more}` : ''}`;
                      return (
                        <td key={d.date} className="at-dc">
                          <button type="button" className={`at-cell ${c.cls}${d.late ? ' is-late-mark' : ''}${d.source === 'mark' ? ' is-hand' : ''}`}
                            title={label} aria-label={label} onClick={() => onMark({ people: [p], from: d.date, day: d })}>{c.code}</button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager {...pg.pager} noun="people" />
        </>
      )}
    </section>
  );
}
