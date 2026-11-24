'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { friendlyError, Modal } from '@/components/crm/ui';
import { dayLabel, WEEKDAYS, type Config } from './shared';

/** Work start and grace (for "late"), weekly days off, holidays, leave days a year, and whether CRM use counts as present. */
export function SettingsModal({ config, onClose, onSaved }: { config: Config; onClose: () => void; onSaved: () => void }) {
  const [workStart, setWorkStart] = useState(config.workStart);
  const [grace, setGrace] = useState(String(config.graceMinutes));
  const [weeklyOff, setWeeklyOff] = useState<number[]>(config.weeklyOff);
  const [allowance, setAllowance] = useState(String(config.yearlyAllowance));
  const [officeFromCrm, setOfficeFromCrm] = useState(config.officeFromCrm);
  const [holidays, setHolidays] = useState(config.holidays);
  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const addHoliday = () => {
    if (!newDate) return;
    setHolidays((h) => [...h.filter((x) => x.date !== newDate), { date: newDate, name: newName.trim() || 'Holiday' }].sort((a, b) => a.date.localeCompare(b.date)));
    setNewDate(''); setNewName('');
  };
  const save = async () => {
    setBusy(true); setErr('');
    try {
      await crm.put('/api/v1/attendance/settings', { workStart, graceMinutes: Number(grace) || 0, weeklyOff, yearlyAllowance: Number(allowance) || 0, officeFromCrm, holidays });
      onSaved();
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  const year = new Date().getFullYear();
  const shown = holidays.filter((h) => Number(h.date.slice(0, 4)) >= year - 1);

  return (
    <Modal title="Attendance settings" onClose={onClose} wide
      actions={<>
        <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="crm-btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save settings'}</button>
      </>}>
      <div className="crm-form-grid at-set-grid">
        <label className="crm-field">Work starts at
          <input type="time" className="crm-input" value={workStart} onChange={(e) => setWorkStart(e.target.value)} />
        </label>
        <label className="crm-field">Late after (minutes)
          <input type="number" min={0} max={240} className="crm-input" value={grace} onChange={(e) => setGrace(e.target.value)} />
        </label>
        <label className="crm-field">Leave days a year
          <input type="number" min={0} max={365} className="crm-input" value={allowance} onChange={(e) => setAllowance(e.target.value)} />
        </label>
      </div>
      <div className="crm-field">Weekly days off
        <div className="crm-chips" role="group" aria-label="Weekly days off">
          {WEEKDAYS.map((w, i) => (
            <button key={w} type="button" className="crm-chip is-soft" aria-pressed={weeklyOff.includes(i)}
              onClick={() => setWeeklyOff((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i].sort()))}>{w}</button>
          ))}
        </div>
      </div>
      <label className="at-check">
        <input type="checkbox" checked={officeFromCrm} onChange={(e) => setOfficeFromCrm(e.target.checked)} />
        Count the office team present on days they open the CRM (the field team always counts from their shift in the app)
      </label>
      <div className="crm-field">Holidays
        <span className="crm-cell-sub" style={{ fontWeight: 400 }}>Nobody is marked absent on a holiday, and leave doesn’t count them.</span>
        {shown.length > 0 && (
          <ul className="at-hols">
            {shown.map((h) => (
              <li key={h.date}>
                <span><strong>{h.name}</strong> <span className="crm-cell-sub">{dayLabel(h.date)} {h.date.slice(0, 4)}</span></span>
                <button type="button" className="crm-btn is-ghost is-sm" aria-label={`Remove ${h.name}`} onClick={() => setHolidays((x) => x.filter((y) => y.date !== h.date))}><Trash2 size={15} aria-hidden /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="at-hol-add">
          <input type="date" className="crm-input" aria-label="Holiday date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          <input className="crm-input" aria-label="Holiday name" placeholder="e.g. Chhath Puja" value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addHoliday(); }} />
          <button type="button" className="crm-btn is-secondary" disabled={!newDate} onClick={addHoliday}><Plus size={16} aria-hidden /> Add</button>
        </div>
      </div>
      {err && <p className="crm-error" role="alert" style={{ margin: 0 }}>{err}</p>}
    </Modal>
  );
}
