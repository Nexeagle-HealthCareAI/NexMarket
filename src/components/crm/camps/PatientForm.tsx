'use client';

import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Hospital, Pencil } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { friendlyError, Modal } from '@/components/crm/ui';
import type { CampOptions, CampPatient } from './shared';
import { place } from '@/lib/crm/access';

type Mode = 'book' | 'register' | 'screen';

/** The problems people most often come with: shown first, the rest behind "More". */
const COMMON_SYMPTOMS = ['joint_pain', 'back_pain', 'fever', 'weakness', 'headache', 'acidity', 'vision', 'cough', 'dizziness', 'thirst'];
const COMMON_FOUND = ['hypertension', 'diabetes', 'anaemia', 'arthritis', 'spine', 'cataract', 'eyesight', 'gastric', 'gynae', 'skin'];

/**
 * The camp desk in one quick form.
 * Book: name, mobile, age, gender, village and what they come for. "Book & next" keeps it open for the next person.
 * Walk-in: the same, plus the check-up (readings and what was found) so the disease data is filled in on the spot.
 * Check-up: for someone already booked; their details sit in one line, the readings and findings come first.
 */
export function PatientForm({ campId, patient, mode, options, departments, villages = [], onClose, onSaved }: {
  campId: string; patient?: CampPatient | null; mode: Mode; options: CampOptions | null; departments: string[]; villages?: string[];
  onClose: () => void; onSaved: (msg: string, keepOpen?: boolean) => void;
}) {
  const p = patient;
  const blank = {
    name: '', phone: '', age: '', sex: '', village: '', slot: '', complaint: '', bpS: '', bpD: '', sugar: '', weight: '', spo2: '', advice: '', department: '',
  };
  const fromPatient = p ? {
    name: p.name, phone: p.phone ? p.phone.slice(-10) : '', age: p.age != null ? String(p.age) : '', sex: p.sex ?? '', village: p.village ?? '', slot: p.slot ?? '',
    complaint: p.complaint ?? '', bpS: p.bpSystolic != null ? String(p.bpSystolic) : '', bpD: p.bpDiastolic != null ? String(p.bpDiastolic) : '',
    sugar: p.sugar != null ? String(p.sugar) : '', weight: p.weightKg != null ? String(p.weightKg) : '', spo2: p.spo2 != null ? String(p.spo2) : '',
    advice: p.advice ?? '', department: p.department ?? '',
  } : blank;
  const [f, setF] = useState(fromPatient);
  const [source, setSource] = useState(p?.source ?? (mode === 'book' ? 'prebooked' : 'walk_in'));
  const [symptoms, setSymptoms] = useState<string[]>(p?.symptoms ?? []);
  const [conditions, setConditions] = useState<string[]>(p?.conditions ?? []);
  const [refer, setRefer] = useState(p?.referToHospital ?? false);
  const [urgent, setUrgent] = useState(p?.urgent ?? false);
  const [consent, setConsent] = useState(p?.consent ?? false);
  const [lang, setLang] = useState<'en' | 'hi'>('hi');
  const [allSymptoms, setAllSymptoms] = useState(false);
  const [allFound, setAllFound] = useState(false);
  const [editDetails, setEditDetails] = useState(mode !== 'screen');
  const [showAdvice, setShowAdvice] = useState(!!p?.advice);
  const [showSlot, setShowSlot] = useState(!!p?.slot);
  const [last, setLast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const toggle = (list: string[], setList: (v: string[]) => void, c: string) => setList(list.includes(c) ? list.filter((x) => x !== c) : [...list, c]);
  const n = (s: string) => (s.trim() === '' ? undefined : Number(s));
  const checkup = mode !== 'book';

  // Readings that point to a condition (same rules as the server).
  const bpS = n(f.bpS), bpD = n(f.bpD), sugar = n(f.sugar), spo2 = n(f.spo2);
  const flags = [
    (bpS ?? 0) >= 140 || (bpD ?? 0) >= 90 ? 'hypertension' : null,
    (sugar ?? 0) >= 200 ? 'diabetes' : null,
    spo2 != null && spo2 > 0 && spo2 < 94 ? 'asthma_copd' : null,
  ].filter((x): x is string => !!x && !conditions.includes(x));
  const sLabel = (code: string) => { const o = options?.symptoms.find((x) => x.code === code); return o ? (lang === 'hi' ? o.hi : o.en) : code; };
  const cLabel = (code: string) => { const o = options?.conditions.find((x) => x.code === code); return o ? (lang === 'hi' ? o.hi : o.en) : code; };
  const suggestedDept = options?.conditions.find((x) => conditions.includes(x.code))?.dept;
  const symptomCodes = useMemo(() => {
    const all = (options?.symptoms ?? []).map((s) => s.code);
    return allSymptoms ? all : [...new Set([...COMMON_SYMPTOMS.filter((c) => all.includes(c)), ...symptoms])];
  }, [options, allSymptoms, symptoms]);
  const foundCodes = useMemo(() => {
    const all = (options?.conditions ?? []).map((s) => s.code);
    return allFound ? all : [...new Set([...COMMON_FOUND.filter((c) => all.includes(c)), ...conditions])];
  }, [options, allFound, conditions]);
  const phoneOk = f.phone.trim() === '' || /^\d{10}$/.test(f.phone.replace(/\D/g, '').slice(-10));

  const save = async (next: boolean) => {
    if (!f.name.trim()) { setError('Write their name.'); nameRef.current?.focus(); return; }
    if (!phoneOk) { setError('The mobile number should have 10 digits.'); return; }
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      name: f.name, phone: f.phone, age: n(f.age), sex: f.sex, village: f.village, source, slot: showSlot ? f.slot : '', complaint: f.complaint, symptoms, consent,
    };
    if (checkup) Object.assign(body, {
      status: 'attended', conditions, bpSystolic: bpS, bpDiastolic: bpD, sugar, weightKg: n(f.weight), spo2,
      advice: f.advice, referToHospital: refer, department: refer ? (f.department || suggestedDept || '') : '', urgent: refer && urgent,
    });
    try {
      let msg: string;
      if (p) {
        const r = await crm.patch<{ leadId?: string | null }>(`/api/v1/camps/patients/${p.id}`, body);
        msg = refer && r.leadId && !p.leadId ? `${f.name} saved and sent to the Leads inbox for follow-up.` : `${f.name} saved.`;
      } else {
        const r = await crm.post<{ token: number; existed: boolean }>(`/api/v1/camps/${campId}/patients`, body);
        msg = r.existed ? `${f.name} was already booked · token ${r.token}.` : `${f.name} ${mode === 'book' ? 'booked' : 'added'} · token ${r.token}.`;
      }
      if (next) {
        // Ready for the next person: keep the village and how they came (people come in groups), clear the rest.
        setF({ ...blank, village: f.village });
        setSymptoms([]); setConditions([]); setRefer(false); setUrgent(false); setConsent(false); setShowAdvice(false);
        setLast(msg); setBusy(false);
        onSaved(msg, true);
        nameRef.current?.focus();
        return;
      }
      onSaved(msg);
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  };

  const title = mode === 'screen' ? `Check-up · ${p?.name ?? ''}${p ? ` · token ${p.token}` : ''}` : mode === 'book' ? (p ? `Change booking · ${p.name}` : 'Book a person') : 'Walk-in';
  const nextLabel = mode === 'book' ? 'Book & next' : 'Save & next';
  return (
    <Modal title={title} onClose={onClose} wide
      actions={<>
        <button type="button" className="crm-btn is-secondary" onClick={onClose}>Close</button>
        {!p && <button type="button" className="crm-btn is-secondary" disabled={busy} onClick={() => void save(true)}>{nextLabel}</button>}
        <button type="button" className="crm-btn" disabled={busy} onClick={() => void save(false)}>{busy ? 'Saving…' : mode === 'book' ? (p ? 'Save' : 'Book') : 'Save'}</button>
      </>}>
      {last && <p className="cq-last" role="status"><CheckCircle2 size={16} aria-hidden /> {last} Next person:</p>}

      {!editDetails && p ? (
        <div className="cq-who">
          <span className="rt-num">{p.token}</span>
          <span className="cq-who-main"><strong>{f.name}</strong>
            <span className="crm-cell-sub">{[f.age ? `${f.age} y` : null, f.sex === 'F' ? 'Female' : f.sex === 'M' ? 'Male' : f.sex === 'O' ? 'Other' : null, f.village, f.phone ? `+91 ${f.phone}` : null].filter(Boolean).join(' · ') || 'No details yet'}</span>
            {f.complaint && <span className="crm-cell-sub">“{f.complaint}”</span>}
          </span>
          <button type="button" className="crm-btn is-ghost is-sm" onClick={() => setEditDetails(true)}><Pencil size={14} aria-hidden /> Details</button>
        </div>
      ) : (
        <div className="cq-grid">
          <label className="crm-field cq-name">Name
            <input ref={nameRef} className="crm-input" value={f.name} onChange={set('name')} maxLength={120} autoFocus={mode !== 'screen'} placeholder="Full name" />
          </label>
          <label className="crm-field">Mobile
            <input className={`crm-input${phoneOk ? '' : ' is-bad'}`} value={f.phone} onChange={(e) => setF((x) => ({ ...x, phone: e.target.value.replace(/[^\d]/g, '').slice(0, 10) }))} inputMode="numeric" placeholder="10 digits" />
          </label>
          <label className="crm-field">Age
            <input className="crm-input" value={f.age} onChange={(e) => setF((x) => ({ ...x, age: e.target.value.replace(/\D/g, '').slice(0, 3) }))} inputMode="numeric" placeholder="Years" />
          </label>
          <div className="crm-field">Gender
            <div className="cq-seg" role="radiogroup" aria-label="Gender">
              {[['F', 'Female'], ['M', 'Male'], ['O', 'Other']].map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={f.sex === k} onClick={() => setF((x) => ({ ...x, sex: x.sex === k ? '' : k }))}>{l}</button>
              ))}
            </div>
          </div>
          <label className="crm-field">Village
            <input className="crm-input" value={f.village} onChange={set('village')} maxLength={80} list="cq-villages" placeholder="Village or mohalla" />
            <datalist id="cq-villages">{villages.map((v) => <option key={v} value={v} />)}</datalist>
          </label>
          {mode === 'book' ? (
            showSlot
              ? <label className="crm-field">Time<input type="time" className="crm-input" value={f.slot} onChange={set('slot')} /></label>
              : <div className="crm-field cq-slot-add"><span aria-hidden>&nbsp;</span><button type="button" className="crm-btn is-ghost is-sm" onClick={() => setShowSlot(true)}>+ Give a time</button></div>
          ) : (
            <label className="crm-field">Came by
              <select className="crm-select" value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="walk_in">Walked in</option><option value="prebooked">Booked by desk</option><option value="whatsapp">WhatsApp</option><option value="partner">Brought by a partner</option><option value="agent">Field agent</option>
              </select>
            </label>
          )}
        </div>
      )}

      <div className="cq-sec">
        <div className="cq-sec-head">
          <strong>Comes with</strong>
          <div className="crm-chips cp-lang">
            <button type="button" className="crm-chip" aria-pressed={lang === 'hi'} onClick={() => setLang('hi')}>हिंदी</button>
            <button type="button" className="crm-chip" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
          </div>
        </div>
        <div className="crm-chips cp-codes">
          {symptomCodes.map((c) => <button key={c} type="button" className="crm-chip" aria-pressed={symptoms.includes(c)} onClick={() => toggle(symptoms, setSymptoms, c)}>{sLabel(c)}</button>)}
          {!allSymptoms && <button type="button" className="crm-chip is-more" onClick={() => setAllSymptoms(true)}>More <ChevronDown size={13} aria-hidden /></button>}
        </div>
        {(editDetails || !p) && <input className="crm-input" value={f.complaint} onChange={set('complaint')} maxLength={500} placeholder="In their words (optional), e.g. घुटने में दर्द 6 महीने से" />}
      </div>

      {checkup && (
        <>
          <div className="cq-sec">
            <strong>Readings</strong>
            <div className="cq-vitals">
              <label className="crm-field">BP<span className="cq-bp"><input className="crm-input" inputMode="numeric" aria-label="BP upper" value={f.bpS} onChange={(e) => setF((x) => ({ ...x, bpS: e.target.value.replace(/\D/g, '').slice(0, 3) }))} placeholder="120" />
                <b>/</b><input className="crm-input" inputMode="numeric" aria-label="BP lower" value={f.bpD} onChange={(e) => setF((x) => ({ ...x, bpD: e.target.value.replace(/\D/g, '').slice(0, 3) }))} placeholder="80" /></span></label>
              <label className="crm-field">Sugar<input className="crm-input" inputMode="numeric" value={f.sugar} onChange={(e) => setF((x) => ({ ...x, sugar: e.target.value.replace(/\D/g, '').slice(0, 3) }))} placeholder="mg/dL" /></label>
              <label className="crm-field">SpO2 %<input className="crm-input" inputMode="numeric" value={f.spo2} onChange={(e) => setF((x) => ({ ...x, spo2: e.target.value.replace(/\D/g, '').slice(0, 3) }))} placeholder="98" /></label>
              <label className="crm-field">Weight kg<input className="crm-input" inputMode="decimal" value={f.weight} onChange={(e) => setF((x) => ({ ...x, weight: e.target.value.replace(/[^0-9.]/g, '').slice(0, 5) }))} /></label>
            </div>
            {flags.length > 0 && (
              <div className="cp-flag"><AlertTriangle size={16} aria-hidden />
                <span>The readings suggest {flags.map(cLabel).join(' and ')}.</span>
                <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setConditions((c) => [...c, ...flags])}>Add</button>
              </div>
            )}
          </div>

          <div className="cq-sec cq-found">
            <strong>Disease found <span className="crm-cell-sub">goes into the disease data</span></strong>
            <div className="crm-chips cp-codes">
              {foundCodes.map((c) => <button key={c} type="button" className="crm-chip is-soft" aria-pressed={conditions.includes(c)} onClick={() => toggle(conditions, setConditions, c)}>{cLabel(c)}</button>)}
              {!allFound && <button type="button" className="crm-chip is-more" onClick={() => setAllFound(true)}>More <ChevronDown size={13} aria-hidden /></button>}
            </div>
            {showAdvice
              ? <textarea className="crm-textarea" rows={2} value={f.advice} onChange={set('advice')} maxLength={1000} placeholder={`Advice: medicines, tests, diet, when to come to the ${place()}`} />
              : <button type="button" className="crm-btn is-ghost is-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowAdvice(true)}>+ Advice given</button>}
          </div>

          <div className={`cp-refer${refer ? ' is-on' : ''}`}>
            <label className="wau-switch"><input type="checkbox" checked={refer} onChange={(e) => setRefer(e.target.checked)} /> <Hospital size={16} aria-hidden /> Needs to come to the {place()}</label>
            {refer && (
              <div className="cq-refer-row">
                <label className="crm-field">Department
                  <input className="crm-input" list="cp-dept-list" value={f.department || suggestedDept || ''} onChange={set('department')} />
                  <datalist id="cp-dept-list">{departments.map((d) => <option key={d} value={d} />)}</datalist>
                </label>
                <label className="wau-switch"><input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgent</label>
              </div>
            )}
          </div>
        </>
      )}

      <label className="cp-consent cq-consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span><strong>They agree</strong> to the {place()} keeping these details and calling them. <span className="crm-sub">मरीज़ की सहमति लें।</span></span>
      </label>
      {checkup && refer && !consent && <span className="wl-err">Without their agreement and a mobile number they won&apos;t be added to the Leads inbox.</span>}
      {error && <div className="crm-error" role="alert">{error}</div>}
    </Modal>
  );
}
