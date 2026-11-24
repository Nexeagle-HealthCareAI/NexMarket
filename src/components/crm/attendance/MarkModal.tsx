'use client';

import { useState } from 'react';
import { crm } from '@/lib/sync/api-client';
import { friendlyError, Modal } from '@/components/crm/ui';
import { cellOf, detailOf, LEAVE_TYPES, MARKS, rangeLabel, timeOf, type Day, type MarkStatus, type Person } from './shared';

export interface MarkTarget {
  people: Person[];
  from: string;
  to?: string;
  status?: MarkStatus;
  /** The day as recorded, when marking one person for one day. */
  day?: Day;
}

/**
 * Mark one or more people for a day or a run of days: present, half day, absent, leave (with its kind), day off, or
 * back to what the app and the CRM recorded. A range skips weekly days off and holidays unless ticked.
 */
export function MarkModal({ target, today, canMark, onClose, onSaved }: {
  target: MarkTarget; today: string; canMark: boolean; onClose: () => void; onSaved: (msg: string) => void;
}) {
  const { people, day } = target;
  const [status, setStatus] = useState<MarkStatus | 'clear'>(target.status ?? (day?.mark ?? 'present'));
  const [from, setFrom] = useState(target.from);
  const [to, setTo] = useState(target.to ?? target.from);
  const [leaveType, setLeaveType] = useState(day?.leaveType ?? 'casual');
  const [note, setNote] = useState(day?.note ?? '');
  const [includeOff, setIncludeOff] = useState(false);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const single = people.length === 1;
  const ahead = to > today || from > today;
  const blockedAhead = ahead && (status === 'present' || status === 'half' || status === 'absent');
  const title = single ? people[0].name : `${people.length} people`;

  const save = async () => {
    setBusy(true); setErr('');
    try {
      const res = await crm.put<{ changed: number; days: number; people: number }>('/api/v1/attendance/marks', {
        agentIds: people.map((p) => p.agentId), from, to, status, leaveType: status === 'leave' ? leaveType : undefined,
        note: note.trim() || undefined, notify: notify && (status === 'absent' || status === 'leave' || status === 'half'), includeOffDays: includeOff,
      });
      const what = status === 'clear' ? 'back to automatic' : status === 'leave' ? `${LEAVE_TYPES.find((l) => l.key === leaveType)?.label.toLowerCase()} leave` : MARKS.find((m) => m.key === status)?.label.toLowerCase();
      onSaved(`${title}: ${what} for ${rangeLabel(from, to)}${res.days > 1 ? ` (${res.days} days)` : ''}.`);
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <Modal title={canMark ? `Mark ${title}` : title} onClose={onClose}
      actions={canMark ? <>
        <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="crm-btn" disabled={busy || blockedAhead || !from} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </> : undefined}>
      {day && single && (
        <div className="at-recorded">
          <span className={`at-cell ${cellOf(day).cls}`} aria-hidden>{cellOf(day).code}</span>
          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <strong style={{ fontSize: 14 }}>{rangeLabel(day.date, day.date)} · {cellOf(day).label}{day.late ? ' · late' : ''}</strong>
            <span className="crm-cell-sub">
              {day.source === 'mark'
                ? `Marked by ${day.markedBy ?? 'the office'}${day.note ? ` — “${day.note}”` : ''}. ${day.auto ? `The ${day.auto === 'shift' ? 'app' : 'CRM'} recorded them${day.inAt ? ` from ${timeOf(day.inAt)}` : ''}${day.outAt ? ` to ${timeOf(day.outAt)}` : ''}.` : 'Nothing was recorded by the app or the CRM.'}`
                : day.source === 'shift' ? `${detailOf(day)} (shift in the app).`
                  : day.source === 'crm' ? `${detailOf(day)} (had the CRM open).`
                    : day.source === 'leave' ? 'Approved leave request from the app.'
                      : day.status === 'absent' ? 'No shift, no CRM and no leave that day.' : detailOf(day)}
            </span>
          </span>
        </div>
      )}
      {!single && (
        <p className="crm-sub" style={{ margin: 0 }}>{people.slice(0, 6).map((p) => p.name).join(', ')}{people.length > 6 ? ` and ${people.length - 6} more` : ''}</p>
      )}
      {canMark && <>
        <div role="radiogroup" aria-label="Mark as" className="at-seg">
          {MARKS.map((m) => (
            <button key={m.key} type="button" role="radio" aria-checked={status === m.key} className={`at-seg-btn at-k-${m.key}`} onClick={() => setStatus(m.key)}>
              <span className="at-seg-code" aria-hidden>{m.short}</span>{m.label}
            </button>
          ))}
          {(day?.mark || !day) && (
            <button type="button" role="radio" aria-checked={status === 'clear'} className="at-seg-btn at-k-clear" onClick={() => setStatus('clear')}>
              <span className="at-seg-code" aria-hidden>↺</span>Automatic
            </button>
          )}
        </div>
        {status === 'clear' && <p className="crm-sub" style={{ margin: 0, fontSize: 13 }}>Removes the hand-set mark, so the day goes back to what the app or the CRM recorded.</p>}
        {status === 'leave' && (
          <div className="crm-chips" role="radiogroup" aria-label="Kind of leave">
            {LEAVE_TYPES.map((l) => (
              <button key={l.key} type="button" role="radio" aria-checked={leaveType === l.key} className="crm-chip is-soft at-radio-chip" onClick={() => setLeaveType(l.key)}>{l.label}</button>
            ))}
          </div>
        )}
        <div className="crm-form-grid at-dates">
          <label className="crm-field">From
            <input type="date" className="crm-input" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} />
          </label>
          <label className="crm-field">To
            <input type="date" className="crm-input" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        {blockedAhead && <p className="at-warn" role="alert">Present, half day and absent can only be marked for today or earlier. For days ahead, use leave or day off.</p>}
        {from !== to && (
          <label className="at-check"><input type="checkbox" checked={includeOff} onChange={(e) => setIncludeOff(e.target.checked)} /> Include weekly days off and holidays</label>
        )}
        <label className="crm-field">Note (optional)
          <input className="crm-input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)}
            placeholder={status === 'absent' ? 'e.g. Didn’t come, phone off' : status === 'leave' ? 'e.g. Told the office on the phone' : status === 'present' ? 'e.g. At the camp all day, app wasn’t working' : 'e.g. Reason'} />
        </label>
        {(status === 'absent' || status === 'leave' || status === 'half') && (
          <label className="at-check"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Tell {single ? 'them' : 'each person'} in the app</label>
        )}
        {err && <p className="crm-error" role="alert" style={{ margin: 0 }}>{err}</p>}
      </>}
    </Modal>
  );
}
