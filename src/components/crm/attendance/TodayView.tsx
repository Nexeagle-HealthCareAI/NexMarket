'use client';

import { useMemo, useState } from 'react';
import { Check, Search, UserX } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { Empty, friendlyError, initials, Modal } from '@/components/crm/ui';
import { Pager, usePaged } from '@/components/crm/Pager';
import { cellOf, dayLabel, detailOf, MARKS, roleLabel, type Board, type MarkStatus, type Person } from './shared';
import type { MarkTarget } from './MarkModal';

type Filter = 'all' | 'present' | 'notin' | 'leave' | 'absent' | 'late';
export type Group = 'all' | 'field' | 'office';

const FILTERS: { key: Filter; label: string; tone: string }[] = [
  { key: 'present', label: 'Present', tone: 'ok' },
  { key: 'notin', label: 'Not in yet', tone: 'accent' },
  { key: 'late', label: 'Late', tone: 'warn' },
  { key: 'leave', label: 'On leave', tone: 'warn' },
  { key: 'absent', label: 'Absent', tone: 'bad' },
];

function matches(p: Person, f: Filter) {
  const s = p.today.status;
  if (f === 'present') return s === 'worked';
  if (f === 'notin') return s === 'today';
  if (f === 'leave') return s === 'leave';
  if (f === 'absent') return s === 'absent';
  if (f === 'late') return p.today.late;
  return true;
}

export function GroupChips({ value, onChange, board }: { value: Group; onChange: (g: Group) => void; board: Board }) {
  const opts: { key: Group; label: string; n: number }[] = [
    { key: 'all', label: 'Everyone', n: board.kpis.total },
    { key: 'field', label: 'Field team', n: board.kpis.field },
    { key: 'office', label: 'Office team', n: board.kpis.office },
  ];
  return (
    <div className="crm-chips" role="group" aria-label="Team">
      {opts.map((o) => (
        <button key={o.key} type="button" className="crm-chip" aria-pressed={value === o.key} onClick={() => onChange(o.key)}>
          {o.label}<span className="ld-chip-n">{o.n}</span>
        </button>
      ))}
    </div>
  );
}

export function Avatar({ p }: { p: Person }) {
  return (
    <span className="crm-initials at-av" aria-hidden>
      {initials(p.name)}
      {p.online && <span className="at-online" title="Online now" />}
    </span>
  );
}

/**
 * Today, for the whole team: who is in (and since when, from the app or the CRM), who isn't yet, who is on leave.
 * One tap marks someone; tick several to mark them together.
 */
export function TodayView({ board, group, setGroup, onMark, onPerson, onSaved }: {
  board: Board; group: Group; setGroup: (g: Group) => void;
  onMark: (t: MarkTarget) => void; onPerson: (p: Person) => void; onSaved: (msg: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRest, setConfirmRest] = useState(false);
  const [err, setErr] = useState('');
  const today = board.today;

  const inGroup = useMemo(() => board.people.filter((p) => group === 'all' || p.group === group), [board, group]);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return inGroup.filter((p) => matches(p, filter) && (!term || `${p.name} ${p.agentId} ${p.block ?? ''} ${roleLabel(p.role, p.group)}`.toLowerCase().includes(term)));
  }, [inGroup, filter, q]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, inGroup.filter((p) => matches(p, f.key)).length])) as Record<Filter, number>, [inGroup]);
  const pg = usePaged(rows, `${group}|${filter}|${q}`, 25);
  const notIn = inGroup.filter((p) => p.today.status === 'today');
  const pickedPeople = board.people.filter((p) => picked.has(p.agentId));

  const quick = async (p: Person, status: MarkStatus) => {
    if (status === 'leave' || status === 'off') { onMark({ people: [p], from: today, status, day: p.today }); return; }
    setBusyId(p.agentId); setErr('');
    try {
      const clear = p.today.mark === status;
      await crm.put('/api/v1/attendance/marks', { agentIds: [p.agentId], from: today, status: clear ? 'clear' : status, notify: status === 'absent' || status === 'half' });
      onSaved(clear ? `${p.name}: back to automatic for today.` : `${p.name}: ${MARKS.find((m) => m.key === status)?.label.toLowerCase()} today.`);
    } catch (e) { setErr(friendlyError(e)); } finally { setBusyId(null); }
  };

  const markRestAbsent = async () => {
    setErr('');
    try {
      await crm.put('/api/v1/attendance/marks', { agentIds: notIn.map((p) => p.agentId), from: today, status: 'absent', notify: true });
      onSaved(`${notIn.length} ${notIn.length === 1 ? 'person' : 'people'} marked absent today.`);
      setConfirmRest(false);
    } catch (e) { setErr(friendlyError(e)); }
  };

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOnPage = pg.rows.length > 0 && pg.rows.every((p) => picked.has(p.agentId));

  return (
    <section className="crm-card at-today" aria-labelledby="at-today-h">
      <div className="at-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <h2 id="at-today-h" className="crm-h2">Today · {dayLabel(today)}</h2>
          <span className="crm-sub" style={{ fontSize: 13 }}>
            {board.kpis.workingToday ? `Work starts ${board.config.workStart}; late after ${board.config.graceMinutes} minutes.` : 'Today is a day off.'}
            {' '}Field team from their shift in the app{board.config.officeFromCrm ? ', office team from the CRM' : ''}.
          </span>
        </div>
        <GroupChips value={group} onChange={setGroup} board={board} />
      </div>

      <div className="at-tiles" role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className={`at-tile tone-${f.tone}`} aria-pressed={filter === f.key} onClick={() => setFilter(filter === f.key ? 'all' : f.key)}>
            <span className="at-tile-n">{counts[f.key]}</span>
            <span className="at-tile-l">{f.label}</span>
          </button>
        ))}
      </div>

      <div className="at-tools">
        <label className="crm-search" style={{ flex: '1 1 240px' }}>
          <Search size={16} aria-hidden /><span className="crm-sr">Search the team</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, ID, block or role" />
        </label>
        {board.canMark && notIn.length > 0 && board.kpis.workingToday && (
          <button type="button" className="crm-btn is-danger is-sm" onClick={() => setConfirmRest(true)}><UserX size={15} aria-hidden /> Mark {notIn.length} not in as absent</button>
        )}
      </div>

      {board.canMark && picked.size > 0 && (
        <div className="at-bulk" role="region" aria-label="Selected people">
          <strong>{picked.size} selected</strong>
          <span className="at-bulk-acts">
            {MARKS.map((m) => (
              <button key={m.key} type="button" className={`crm-btn is-secondary is-sm at-k-${m.key}`}
                onClick={() => onMark({ people: pickedPeople, from: today, status: m.key })}>{m.label}</button>
            ))}
            <button type="button" className="crm-btn is-ghost is-sm" onClick={() => setPicked(new Set())}>Clear</button>
          </span>
        </div>
      )}
      {err && <p className="crm-error" role="alert" style={{ margin: 0 }}>{err}</p>}

      {rows.length === 0 ? <Empty title={q || filter !== 'all' ? 'Nobody matches' : 'Nobody on the team yet'}>{q || filter !== 'all' ? 'Clear the search or pick another box.' : 'People added in Users & roles appear here.'}</Empty> : (
        <ul className="at-list">
          {board.canMark && (
            <li className="at-list-head">
              <label className="at-check"><input type="checkbox" checked={allOnPage} onChange={() => setPicked((s) => { const n = new Set(s); pg.rows.forEach((p) => (allOnPage ? n.delete(p.agentId) : n.add(p.agentId))); return n; })} /> Select all on this page</label>
            </li>
          )}
          {pg.rows.map((p) => {
            const c = cellOf(p.today);
            const detail = detailOf(p.today, p.onShift);
            return (
              <li key={p.agentId} className={`at-row${picked.has(p.agentId) ? ' is-picked' : ''}`}>
                {board.canMark && <input type="checkbox" className="at-pick" aria-label={`Select ${p.name}`} checked={picked.has(p.agentId)} onChange={() => toggle(p.agentId)} />}
                <button type="button" className="at-who" onClick={() => onPerson(p)}>
                  <Avatar p={p} />
                  <span className="at-who-t">
                    <strong>{p.name}</strong>
                    <span className="crm-cell-sub">{roleLabel(p.role, p.group)}{p.block ? ` · ${p.block}` : ''}</span>
                  </span>
                </button>
                <span className="at-state">
                  <span className={`at-badge ${c.cls}`}>{p.today.status === 'worked' && p.onShift ? 'On shift' : c.label}</span>
                  {p.today.late && <span className="at-badge is-late">Late</span>}
                  {p.today.source === 'mark' && <span className="at-badge is-marked" title={`Marked by ${p.today.markedBy ?? 'the office'}`}>Marked</span>}
                  {(detail || p.today.note) && <span className="crm-cell-sub at-detail">{p.today.status === 'worked' || p.today.status === 'today' ? detail : ''}{p.today.note ? `${p.today.status === 'worked' || p.today.status === 'today' ? ' · ' : ''}“${p.today.note}”` : ''}{p.today.source === 'mark' ? ` · by ${p.today.markedBy}` : ''}</span>}
                </span>
                {board.canMark && (
                  <span className="at-quick" role="group" aria-label={`Mark ${p.name} today`}>
                    {MARKS.map((m) => (
                      <button key={m.key} type="button" className={`at-q at-k-${m.key}`} aria-pressed={p.today.mark === m.key} disabled={busyId === p.agentId}
                        title={p.today.mark === m.key ? `${m.label} (tap again to undo)` : m.label} aria-label={`${m.label}${p.today.mark === m.key ? ', marked' : ''}`}
                        onClick={() => void quick(p, m.key)}>
                        {p.today.mark === m.key ? <Check size={14} aria-hidden /> : m.short}
                      </button>
                    ))}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Pager {...pg.pager} noun="people" />

      {confirmRest && (
        <Modal title={`Mark ${notIn.length} not in as absent?`} onClose={() => setConfirmRest(false)}
          actions={<>
            <button type="button" className="crm-btn is-secondary" onClick={() => setConfirmRest(false)}>Cancel</button>
            <button type="button" className="crm-btn is-danger" onClick={() => void markRestAbsent()}>Mark absent</button>
          </>}>
          <p className="crm-sub" style={{ margin: 0 }}>
            Everyone {group === 'all' ? '' : `in the ${group} team `}with no shift, no CRM and no leave today: {notIn.slice(0, 8).map((p) => p.name).join(', ')}{notIn.length > 8 ? ` and ${notIn.length - 8} more` : ''}.
            They’re told in the app. If someone starts later, mark them present or set them back to automatic.
          </p>
        </Modal>
      )}
    </section>
  );
}
