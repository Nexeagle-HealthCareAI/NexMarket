'use client';

import { useState } from 'react';
import { Check, Phone, Smartphone } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { useAccess } from '@/lib/crm/access';
import { ReferralMoney } from '@/components/crm/ReferralMoney';
import { ReferralCardBox } from '@/components/crm/cards/ReferralCardBox';
import { contactTypeLabel, fmt, friendlyError, initials, Pill, Skeleton, STAGES, stageTone, useLoader } from '@/components/crm/ui';

export interface ReferralRow {
  id: string; clientId: string; contactId: string; contactName: string; contactRole?: string | null; block?: string | null;
  agentId: string; agentName: string; patientName: string; patientAge?: number | null; patientSex?: string | null; urgent: boolean;
  department: string; notes?: string | null; clientPhone?: string | null; referralDate?: string | null; status: string; stageLabel: string;
  arrivedAt?: string | null; admittedAt?: string | null; createdAt: string;
  updatedAt?: string | null; source?: 'app' | 'leads' | 'crm' | 'camp'; syncDelayMinutes?: number | null; serverReceivedAt?: string | null;
  campId?: string | null; campTitle?: string | null; campDate?: string | null;
  kind?: string | null; panchayat?: string | null; district?: string | null; complaint?: string | null; complaintAt?: string | null;
  readings?: number; lastReading?: Reading | null;
  money?: { billed: number; collected: number; payoutsPaid: number; payoutsOpen: number; payouts: number; incentivesPaid: number; incentivesOpen: number } | null;
}

/** "From the agent's app", and whether it waited on the phone (no signal) before reaching the hospital. */
export function sourceText(r: ReferralRow): string {
  if (r.source === 'camp') return `Sent by the doctor at the health camp${r.campTitle ? ` “${r.campTitle}”` : ''}${r.campDate ? ` (${new Date(`${r.campDate}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})` : ''}`;
  if (r.source === 'leads') return 'From the Leads inbox (QR code / WhatsApp)';
  if (r.source === 'crm') return 'Added in the CRM';
  if (r.kind === 'appointment') {
    const d0 = r.syncDelayMinutes ?? 0;
    return `Appointment booked by ${r.agentName} in the field${d0 >= 60 ? ` · reached us ${d0 >= 1440 ? `${Math.round(d0 / 1440)} day${d0 >= 2880 ? 's' : ''}` : `${Math.round(d0 / 60)} h`} later (no signal)` : ''}`;
  }
  const d = r.syncDelayMinutes ?? 0;
  if (d >= 60) return `From ${r.agentName}'s app · reached us ${d >= 1440 ? `${Math.round(d / 1440)} day${d >= 2880 ? 's' : ''}` : `${Math.round(d / 60)} h`} after it was made (no signal on the phone)`;
  return `From ${r.agentName}'s app · reached us ${d <= 1 ? 'straight away' : `in ${d} min`}`;
}

export interface Reading {
  takenAt: string; bpSystolic?: number | null; bpDiastolic?: number | null; pulse?: number | null; tempF?: number | null; spo2?: number | null; respRate?: number | null;
  weightKg?: number | null; heightCm?: number | null; sugar?: number | null; sugarKind?: string | null; hba1c?: number | null; note?: string | null; bmi?: number | null;
}
const SUGAR: Record<string, string> = { random: 'random', fasting: 'fasting', pp: 'after food' };
/** "BP 150/95 · Pulse 88 · Sugar 210 (fasting)…" for a reading; high values are marked. */
export function readingParts(x: Reading): { text: string; high: boolean }[] {
  const out: { text: string; high: boolean }[] = [];
  if (x.bpSystolic) out.push({ text: `BP ${x.bpSystolic}/${x.bpDiastolic ?? '–'}`, high: x.bpSystolic >= 140 || (x.bpDiastolic ?? 0) >= 90 });
  if (x.pulse) out.push({ text: `Pulse ${x.pulse}`, high: x.pulse > 100 || x.pulse < 50 });
  if (x.tempF) out.push({ text: `Temp ${x.tempF}°F`, high: x.tempF >= 100.4 });
  if (x.spo2) out.push({ text: `SpO2 ${x.spo2}%`, high: x.spo2 < 94 });
  if (x.respRate) out.push({ text: `Breaths ${x.respRate}/min`, high: x.respRate > 24 });
  if (x.sugar) out.push({ text: `Sugar ${x.sugar}${x.sugarKind ? ` (${SUGAR[x.sugarKind] ?? x.sugarKind})` : ''}`, high: x.sugarKind === 'fasting' ? x.sugar >= 126 : x.sugar >= 200 });
  if (x.hba1c) out.push({ text: `HbA1c ${x.hba1c}%`, high: x.hba1c >= 6.5 });
  if (x.weightKg) out.push({ text: `${x.weightKg} kg`, high: false });
  if (x.heightCm) out.push({ text: `${x.heightCm} cm`, high: false });
  if (x.bmi) out.push({ text: `BMI ${x.bmi}`, high: x.bmi >= 30 || x.bmi < 18.5 });
  return out;
}

function Vitals({ clientId, count }: { clientId: string; count: number }) {
  const list = useLoader(() => (count > 0 ? crm.get<{ reading: Reading; by: string }[]>(`/api/v1/referrals/${encodeURIComponent(clientId)}/readings`) : Promise.resolve([])), [clientId, count]);
  if (count === 0) return null;
  return (
    <div className="rf-vitals">
      <h3>Vitals taken by the agent <span className="crm-cell-sub">{count} time{count === 1 ? '' : 's'}</span></h3>
      {!list.data ? <Skeleton h={60} /> : (
        <ul>
          {list.data.map(({ reading, by }, i) => (
            <li key={i}>
              <span className="rf-vitals-when">{fmt.dateTime(reading.takenAt)}<em>{by}</em></span>
              <span className="rf-vitals-vals">
                {readingParts(reading).map((p) => <span key={p.text} className={p.high ? 'is-high' : undefined}>{p.text}</span>)}
                {reading.note && <em>{reading.note}</em>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface HistoryItem { status: string; label: string; note?: string | null; by: string; at: string }

export function ReferralCard({ r, editable, onUpdated }: { r: ReferralRow; editable: boolean; onUpdated: (r: ReferralRow, label: string) => void }) {
  const { access } = useAccess();
  const history = useLoader(() => crm.get<HistoryItem[]>(`/api/v1/referrals/${encodeURIComponent(r.clientId)}/history`), [r.clientId, r.status]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setStage = async (key: string, label: string) => {
    setBusy(key);
    setError(null);
    try {
      await crm.put(`/api/v1/referrals/${encodeURIComponent(r.clientId)}/status`, { status: key, notes: note.trim() || null });
      setNote('');
      onUpdated({ ...r, status: key, stageLabel: label }, label);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <span className="crm-initials" style={{ width: 56, height: 56, borderRadius: 16, fontSize: 19, fontWeight: 800 }}>{initials(r.patientName)}</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, marginRight: 'auto' }}>
          <h2 style={{ fontSize: 22, fontWeight: 800 }}>{r.patientName}</h2>
          <span className="crm-sub">{[r.patientSex, r.patientAge ? `${r.patientAge} yrs` : null, r.clientPhone].filter(Boolean).join(' · ') || 'No patient details'}</span>
          {(r.panchayat || r.block || r.district) && <span className="crm-sub">{[r.panchayat, r.block, r.district].filter(Boolean).join(', ')}</span>}
        </div>
        {r.kind === 'appointment' && <Pill tone="info">Appointment</Pill>}
        {r.urgent && <Pill tone="bad">Urgent</Pill>}
        <Pill tone={stageTone(r.status)} dot>{r.stageLabel}</Pill>
      </div>

      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <Info label="Department" value={r.department || '—'} />
        {r.kind !== 'appointment' && <Info label="Referred by" value={`${r.contactName}${r.contactRole ? ` (${contactTypeLabel(r.contactRole)})` : ''}`} />}
        <Info label={r.source === 'camp' ? 'Came through' : 'Field agent'} value={r.agentName} />
        <Info label={r.kind === 'appointment' ? 'Booked on' : 'Referred on'} value={fmt.dateTime(r.createdAt)} />
        {r.arrivedAt && <Info label="Arrived" value={fmt.dateTime(r.arrivedAt)} />}
        {r.admittedAt && <Info label="Admitted" value={fmt.dateTime(r.admittedAt)} />}
      </dl>
      <div className="rf-source">
        <Smartphone size={15} aria-hidden />
        <span>{sourceText(r)}</span>
        {r.clientPhone && <a className="crm-btn is-secondary is-sm" href={`tel:${r.clientPhone.replace(/[^\d+]/g, '')}`} style={{ marginLeft: 'auto' }}><Phone size={14} aria-hidden /> Call patient</a>}
      </div>
      {r.complaint && <div className="rf-complaint"><strong>Complaint</strong><span>{r.complaint}</span></div>}
      {r.notes && <div className="crm-note" style={{ whiteSpace: 'pre-line' }}>{r.notes}</div>}
      <Vitals clientId={r.clientId} count={r.readings ?? 0} />

      {editable ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{r.source === 'camp' ? 'Update stage · the camp’s lead in the Leads inbox follows' : 'Update stage · the agent gets a notification and sees it in their app'}</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            {STAGES.filter((s) => s.key !== 'pending').map((s) => {
              const current = r.status === s.key || (r.status === 'converted' && s.key === 'admitted');
              return (
                <button key={s.key} type="button" disabled={!!busy || current} onClick={() => setStage(s.key, s.label)} aria-pressed={current}
                  style={{ height: 60, borderRadius: 14, fontSize: 16, fontWeight: 700, cursor: current ? 'default' : 'pointer',
                    border: current ? '2px solid var(--info)' : '1px solid var(--border)', background: current ? 'var(--info-soft)' : '#fff',
                    color: current ? 'var(--info-ink)' : s.key === 'lost' ? 'var(--text-3)' : 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  {current && <Check size={18} aria-hidden />}
                  {busy === s.key ? 'Saving…' : s.label}
                </button>
              );
            })}
          </div>
          <label className="crm-field">Note (optional)
            <input className="crm-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Admitted to ward 3, surgery Friday" />
          </label>
          {error && <div className="crm-error" role="alert">{error}</div>}
        </div>
      ) : <div className="crm-note">You can view referrals but not change their stage.</div>}

      <ReferralCardBox clientId={r.clientId} editable={editable} patient={{ name: r.patientName, phone: r.clientPhone, age: r.patientAge, sex: r.patientSex }} />

      <ReferralMoney clientId={r.clientId} partnerName={r.contactName} editable={editable} isAdmin={!!access?.isAdmin} />

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>History</h3>
        {!history.data ? <Skeleton h={60} /> : (
          <ol className="crm-list">
            {history.data.map((h, i) => (
              <li key={i} style={{ alignItems: 'flex-start' }}>
                <span style={{ width: 96, flexShrink: 0, fontSize: 13, color: 'var(--text-2)' }}>{fmt.dateTime(h.at)}</span>
                <span style={{ fontSize: 14 }}><strong>{h.label}</strong> · {h.by}{h.note ? ` — ${h.note}` : ''}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--bg)', borderRadius: 12, padding: '12px 14px', minWidth: 0 }}>
      <dt style={{ fontSize: 12, color: 'var(--text-2)' }}>{label}</dt>
      <dd style={{ margin: '4px 0 0', fontWeight: 600, overflowWrap: 'anywhere' }}>{value}</dd>
    </div>
  );
}
