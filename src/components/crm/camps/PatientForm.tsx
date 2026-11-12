'use client';

import { useState } from 'react';
import { AlertTriangle, Hospital } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { friendlyError, Modal } from '@/components/crm/ui';
import type { CampOptions, CampPatient } from './shared';
import { place } from '@/lib/crm/access';

type Mode = 'book' | 'register' | 'screen';

/**
 * One form for the camp desk: book someone in before the day, register a walk-in, or screen a person (symptoms,
 * readings, what the doctor suspects, and whether they should come to the hospital).
 */
export function PatientForm({ campId, patient, mode, options, departments, onClose, onSaved }: {
  campId: string; patient?: CampPatient | null; mode: Mode; options: CampOptions | null; departments: string[];
  onClose: () => void; onSaved: (msg: string) => void;
}) {
  const p = patient;
  const [f, setF] = useState({
    name: p?.name ?? '', phone: p?.phone ? p.phone.slice(-10) : '', age: p?.age != null ? String(p.age) : '', sex: p?.sex ?? '', village: p?.village ?? '',
    source: p?.source ?? (mode === 'book' ? 'prebooked' : 'walk_in'), slot: p?.slot ?? '', complaint: p?.complaint ?? '',
    bpS: p?.bpSystolic != null ? String(p.bpSystolic) : '', bpD: p?.bpDiastolic != null ? String(p.bpDiastolic) : '', sugar: p?.sugar != null ? String(p.sugar) : '',
    weight: p?.weightKg != null ? String(p.weightKg) : '', spo2: p?.spo2 != null ? String(p.spo2) : '', advice: p?.advice ?? '', department: p?.department ?? '',
  });
  const [symptoms, setSymptoms] = useState<string[]>(p?.symptoms ?? []);
  const [conditions, setConditions] = useState<string[]>(p?.conditions ?? []);
  const [refer, setRefer] = useState(p?.referToHospital ?? false);
  const [urgent, setUrgent] = useState(p?.urgent ?? false);
  const [consent, setConsent] = useState(p?.consent ?? false);
  const [lang, setLang] = useState<'en' | 'hi'>('hi');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const toggle = (list: string[], setList: (v: string[]) => void, c: string) => setList(list.includes(c) ? list.filter((x) => x !== c) : [...list, c]);
  const n = (s: string) => (s.trim() === '' ? undefined : Number(s));
  const screening = mode === 'screen';

  // Readings that point to a condition (same rules as the server).
  const bpS = n(f.bpS), bpD = n(f.bpD), sugar = n(f.sugar), spo2 = n(f.spo2);
  const flags = [
    (bpS ?? 0) >= 140 || (bpD ?? 0) >= 90 ? 'hypertension' : null,
    (sugar ?? 0) >= 200 ? 'diabetes' : null,
    spo2 != null && spo2 > 0 && spo2 < 94 ? 'asthma_copd' : null,
  ].filter((x): x is string => !!x && !conditions.includes(x));
  const label = (code: string, kind: 'c' | 's') => {
    const o = kind === 'c' ? options?.conditions.find((x) => x.code === code) : options?.symptoms.find((x) => x.code === code);
    return o ? (lang === 'hi' ? o.hi : o.en) : code;
  };
  const suggestedDept = options?.conditions.find((x) => conditions.includes(x.code))?.dept;

  const save = async () => {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      name: f.name, phone: f.phone, age: n(f.age), sex: f.sex, village: f.village, source: f.source, slot: f.slot, complaint: f.complaint, consent,
    };
    if (mode === 'register') body.status = 'attended';
    if (screening) Object.assign(body, {
      status: 'attended', symptoms, conditions, bpSystolic: bpS, bpDiastolic: bpD, sugar, weightKg: n(f.weight), spo2,
      advice: f.advice, referToHospital: refer, department: refer ? (f.department || suggestedDept || '') : '', urgent: refer && urgent,
    });
    try {
      if (p) {
        const r = await crm.patch<{ leadId?: string | null }>(`/api/v1/camps/patients/${p.id}`, body);
        onSaved(refer && r.leadId && !p.leadId ? `${f.name} saved and sent to the Leads inbox for follow-up.` : `${f.name} saved.`);
      } else {
        const r = await crm.post<{ token: number; existed: boolean }>(`/api/v1/camps/${campId}/patients`, body);
        onSaved(r.existed ? `${f.name} was already booked (token ${r.token}).` : `${f.name} added · token ${r.token}.`);
      }
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  };

  const title = screening ? `Screening: ${p?.name ?? ''}${p ? ` · token ${p.token}` : ''}` : mode === 'book' ? 'Book someone in' : p ? `Edit ${p.name}` : 'Register a walk-in';
  return (
    <Modal title={title} onClose={onClose} wide
      actions={<>
        <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="crm-btn" disabled={busy || !f.name.trim()} onClick={() => void save()}>{busy ? 'Saving…' : screening ? 'Save screening' : 'Save'}</button>
      </>}>
      <div className="cp-form">
        <label className="crm-field cp-span2">Name<input className="crm-input" value={f.name} onChange={set('name')} maxLength={120} autoFocus={!screening} /></label>
        <label className="crm-field">Mobile<input className="crm-input" value={f.phone} onChange={set('phone')} inputMode="tel" placeholder="10 digits" /></label>
        <div className="cp-two">
          <label className="crm-field">Age<input type="number" min={0} max={120} className="crm-input" value={f.age} onChange={set('age')} /></label>
          <label className="crm-field">Sex
            <select className="crm-select" value={f.sex} onChange={set('sex')}><option value="">—</option><option value="F">Female</option><option value="M">Male</option><option value="O">Other</option></select>
          </label>
        </div>
        <label className="crm-field">Village<input className="crm-input" value={f.village} onChange={set('village')} maxLength={80} /></label>
        {mode === 'book' ? (
          <label className="crm-field">Time slot (optional)<input type="time" className="crm-input" value={f.slot} onChange={set('slot')} /></label>
        ) : (
          <label className="crm-field">How they came
            <select className="crm-select" value={f.source} onChange={set('source')}>
              <option value="walk_in">Walked in</option><option value="prebooked">Booked by desk</option><option value="whatsapp">WhatsApp</option><option value="partner">Brought by a partner</option><option value="agent">Field agent</option>
            </select>
          </label>
        )}
        <label className="crm-field cp-span2">What they came for (in their words)
          <input className="crm-input" value={f.complaint} onChange={set('complaint')} maxLength={500} placeholder="e.g. घुटने में दर्द 6 महीने से" />
        </label>
      </div>

      {screening && (
        <>
          <div className="cp-sec-head">
            <strong>Symptoms</strong>
            <div className="crm-chips cp-lang">
              <button type="button" className="crm-chip" aria-pressed={lang === 'hi'} onClick={() => setLang('hi')}>हिंदी</button>
              <button type="button" className="crm-chip" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
            </div>
          </div>
          <div className="crm-chips cp-codes">
            {(options?.symptoms ?? []).map((s) => <button key={s.code} type="button" className="crm-chip" aria-pressed={symptoms.includes(s.code)} onClick={() => toggle(symptoms, setSymptoms, s.code)}>{label(s.code, 's')}</button>)}
          </div>

          <strong className="cp-sec-head">Readings</strong>
          <div className="cp-vitals">
            <label className="crm-field">BP upper<input type="number" className="crm-input" value={f.bpS} onChange={set('bpS')} placeholder="120" /></label>
            <label className="crm-field">BP lower<input type="number" className="crm-input" value={f.bpD} onChange={set('bpD')} placeholder="80" /></label>
            <label className="crm-field">Sugar (random)<input type="number" className="crm-input" value={f.sugar} onChange={set('sugar')} placeholder="mg/dL" /></label>
            <label className="crm-field">Weight (kg)<input type="number" step="0.1" className="crm-input" value={f.weight} onChange={set('weight')} /></label>
            <label className="crm-field">SpO2 (%)<input type="number" className="crm-input" value={f.spo2} onChange={set('spo2')} placeholder="98" /></label>
          </div>
          {flags.length > 0 && (
            <div className="cp-flag"><AlertTriangle size={16} aria-hidden />
              <span>The readings suggest {flags.map((c) => label(c, 'c')).join(' and ')}.</span>
              <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setConditions((c) => [...c, ...flags])}>Add</button>
            </div>
          )}

          <strong className="cp-sec-head">What the doctor suspects</strong>
          <div className="crm-chips cp-codes">
            {(options?.conditions ?? []).map((c) => <button key={c.code} type="button" className="crm-chip is-soft" aria-pressed={conditions.includes(c.code)} onClick={() => toggle(conditions, setConditions, c.code)}>{label(c.code, 'c')}</button>)}
          </div>
          <label className="crm-field">Advice given<textarea className="crm-textarea" rows={2} value={f.advice} onChange={set('advice')} maxLength={1000} placeholder={`Medicines, tests, diet, when to come to the ${place()}`} /></label>

          <div className={`cp-refer${refer ? ' is-on' : ''}`}>
            <label className="wau-switch"><input type="checkbox" checked={refer} onChange={(e) => setRefer(e.target.checked)} /> <Hospital size={16} aria-hidden /> Needs to come to the {place()}</label>
            {refer && (
              <div className="cp-two" style={{ alignItems: 'end' }}>
                <label className="crm-field">Department
                  <input className="crm-input" list="cp-dept-list" value={f.department || suggestedDept || ''} onChange={set('department')} />
                  <datalist id="cp-dept-list">{departments.map((d) => <option key={d} value={d} />)}</datalist>
                </label>
                <label className="wau-switch" style={{ height: 44 }}><input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgent</label>
              </div>
            )}
            {refer && <span className="crm-sub" style={{ fontSize: 12.5 }}>They&apos;ll be added to the Leads inbox so the desk calls them and books the visit. Needs a mobile number and their consent.</span>}
          </div>
        </>
      )}

      <label className="cp-consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span><strong>They agree</strong> to the {place()} keeping these details and contacting them about their health. <span className="crm-sub">Ask before noting health details. मरीज़ की सहमति लें।</span></span>
      </label>
      {screening && refer && !consent && <span className="wl-err">Without consent they won&apos;t be added to the Leads inbox.</span>}
      {error && <div className="crm-error" role="alert">{error}</div>}
    </Modal>
  );
}
