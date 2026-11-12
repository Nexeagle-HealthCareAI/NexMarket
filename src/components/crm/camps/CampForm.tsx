'use client';

import { useEffect, useState } from 'react';
import { crm } from '@/lib/sync/api-client';
import { friendlyError, Modal } from '@/components/crm/ui';
import type { CampDetail, CampOptions } from './shared';
import { place } from '@/lib/crm/access';

interface PartnerHit { clientId: string; name: string; type: string; panchayat?: string | null }

/** Plan a new camp, or change one. */
export function CampForm({ camp, options, onClose, onSaved }: {
  camp?: CampDetail['camp'] | null; options: CampOptions | null; onClose: () => void; onSaved: (id: string) => void;
}) {
  const [f, setF] = useState({
    title: camp?.title ?? '', campType: camp?.campType ?? 'general', date: camp?.date ?? '', startTime: camp?.startTime ?? '09:00', endTime: camp?.endTime ?? '14:00',
    district: camp?.district ?? '', block: camp?.block ?? '', venue: camp?.venue ?? '', status: camp?.status ?? 'planned',
    departments: (camp?.departments ?? []).join(', '), doctors: (camp?.doctors ?? []).join(', '),
    capacity: String(camp?.capacity ?? 150), targetRegistrations: String(camp?.targetRegistrations ?? 100), targetReferrals: String(camp?.targetReferrals ?? 15),
    budget: String(camp?.budget ?? 0), spent: String(camp?.spent ?? 0), notes: camp?.notes ?? '', outcome: camp?.outcome ?? '',
  });
  const [host, setHost] = useState<{ clientId: string; name: string } | null>(camp?.hostPartnerClientId ? { clientId: camp.hostPartnerClientId, name: 'Current host' } : null);
  const [pq, setPq] = useState('');
  const [hits, setHits] = useState<PartnerHit[]>([]);
  const [depts, setDepts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  useEffect(() => { crm.get<{ name: string; isActive?: boolean }[]>('/api/v1/departments').then((d) => setDepts(d.filter((x) => x.isActive !== false).map((x) => x.name))).catch(() => undefined); }, []);
  useEffect(() => {
    const s = pq.trim();
    if (s.length < 2) return;
    let alive = true;
    const t = setTimeout(() => {
      crm.get<{ rows: PartnerHit[] }>(`/api/v1/partners?tab=all&pageSize=6&q=${encodeURIComponent(s)}`).then((r) => { if (alive) setHits(r.rows); }).catch(() => alive && setHits([]));
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [pq]);
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

  const save = async () => {
    setBusy(true);
    setError(null);
    const body = {
      title: f.title, campType: f.campType, date: f.date, startTime: f.startTime, endTime: f.endTime, district: f.district, block: f.block, venue: f.venue,
      status: f.status, departments: list(f.departments), doctors: list(f.doctors), capacity: num(f.capacity), targetRegistrations: num(f.targetRegistrations),
      targetReferrals: num(f.targetReferrals), budget: num(f.budget), spent: num(f.spent), notes: f.notes, outcome: f.outcome, hostPartnerClientId: host?.clientId ?? '',
    };
    try {
      if (camp) { await crm.put(`/api/v1/camps/${camp.id}`, body); onSaved(camp.id); }
      else { const r = await crm.post<{ id: string }>('/api/v1/camps', body); onSaved(r.id); }
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  };

  return (
    <Modal title={camp ? 'Edit camp' : 'Plan a health camp'} onClose={onClose} wide
      actions={<>
        <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="crm-btn" disabled={busy || !f.title.trim() || !f.date} onClick={() => void save()}>{busy ? 'Saving…' : camp ? 'Save' : 'Create camp'}</button>
      </>}>
      <div className="cp-form">
        <label className="crm-field cp-span2">Name
          <input className="crm-input" value={f.title} onChange={set('title')} maxLength={120} placeholder="e.g. Free bone & joint camp, Kasba" autoFocus />
        </label>
        <label className="crm-field">Type
          <select className="crm-select" value={f.campType} onChange={set('campType')}>
            {(options?.types ?? [{ key: 'general', label: 'General health' }]).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>
        <label className="crm-field">Status
          <select className="crm-select" value={f.status} onChange={set('status')}>
            <option value="planned">Planned</option><option value="confirmed">Confirmed</option><option value="done">Done</option><option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className="crm-field">Date<input type="date" className="crm-input" value={f.date} onChange={set('date')} /></label>
        <div className="cp-two">
          <label className="crm-field">From<input type="time" className="crm-input" value={f.startTime} onChange={set('startTime')} /></label>
          <label className="crm-field">To<input type="time" className="crm-input" value={f.endTime} onChange={set('endTime')} /></label>
        </div>
        <label className="crm-field">District<input className="crm-input" value={f.district} onChange={set('district')} placeholder="Kishanganj" /></label>
        <label className="crm-field">Block<input className="crm-input" value={f.block} onChange={set('block')} placeholder="Kochadhaman" /></label>
        <label className="crm-field cp-span2">Venue<input className="crm-input" value={f.venue} onChange={set('venue')} placeholder="Panchayat bhawan, school, PHC…" /></label>
        <div className="crm-field cp-span2">Hosted with (optional)
          {host ? (
            <span className="ld-picked">{host.name}<button type="button" onClick={() => setHost(null)} aria-label="Remove host">×</button></span>
          ) : (
            <>
              <input className="crm-input" value={pq} onChange={(e) => setPq(e.target.value)} placeholder="Mukhiya, ASHA, school, RMP who helps run it" />
              {pq.trim().length >= 2 && hits.length > 0 && (
                <ul className="ld-hits">{hits.map((h) => <li key={h.clientId}><button type="button" onClick={() => { setHost({ clientId: h.clientId, name: h.name }); setPq(''); }}>{h.name} <span className="crm-sub">{[h.type, h.panchayat].filter(Boolean).join(' · ')}</span></button></li>)}</ul>
              )}
            </>
          )}
        </div>
        <div className="crm-field cp-span2">Departments
          {depts.length > 0 ? (
            <div className="crm-chips">
              {depts.map((d) => {
                const on = list(f.departments).includes(d);
                return <button key={d} type="button" className="crm-chip" aria-pressed={on}
                  onClick={() => setF((x) => ({ ...x, departments: (on ? list(x.departments).filter((y) => y !== d) : [...list(x.departments), d]).join(', ') }))}>{d}</button>;
              })}
            </div>
          ) : <input className="crm-input" value={f.departments} onChange={set('departments')} placeholder="Orthopaedics, General Medicine" />}
        </div>
        <label className="crm-field cp-span2">Doctors<input className="crm-input" value={f.doctors} onChange={set('doctors')} placeholder="Dr. Ahmad, Dr. Kumari" /></label>
        <div className="cp-three cp-span2">
          <label className="crm-field">Booking slots<input type="number" min={0} className="crm-input" value={f.capacity} onChange={set('capacity')} /></label>
          <label className="crm-field">Target: people seen<input type="number" min={0} className="crm-input" value={f.targetRegistrations} onChange={set('targetRegistrations')} /></label>
          <label className="crm-field">Target: to {place()}<input type="number" min={0} className="crm-input" value={f.targetReferrals} onChange={set('targetReferrals')} /></label>
        </div>
        <div className="cp-two cp-span2">
          <label className="crm-field">Budget (₹)<input type="number" min={0} className="crm-input" value={f.budget} onChange={set('budget')} /></label>
          <label className="crm-field">Spent (₹)<input type="number" min={0} className="crm-input" value={f.spent} onChange={set('spent')} /></label>
        </div>
        <label className="crm-field cp-span2">Notes<textarea className="crm-textarea" rows={2} value={f.notes} onChange={set('notes')} placeholder="Tent, chairs, mic, banner, lunch for the team…" /></label>
        {camp && <label className="crm-field cp-span2">After the camp: what worked, what to change<textarea className="crm-textarea" rows={2} value={f.outcome} onChange={set('outcome')} /></label>}
      </div>
      {!camp && <p className="crm-sub" style={{ margin: 0, fontSize: 13 }}>The camp gets a code for its WhatsApp QR poster, and a marketing checklist to follow.</p>}
      {error && <div className="crm-error" role="alert">{error}</div>}
    </Modal>
  );
}
