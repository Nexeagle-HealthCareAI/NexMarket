'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { contactTypeLabel, fmt, friendlyError, initials, Pill, Skeleton, STAGES, stageTone, useLoader } from '@/components/crm/ui';

export interface ReferralRow {
  id: string; clientId: string; contactId: string; contactName: string; contactRole?: string | null; block?: string | null;
  agentId: string; agentName: string; patientName: string; patientAge?: number | null; patientSex?: string | null; urgent: boolean;
  department: string; notes?: string | null; clientPhone?: string | null; referralDate?: string | null; status: string; stageLabel: string;
  arrivedAt?: string | null; admittedAt?: string | null; createdAt: string;
}

interface HistoryItem { status: string; label: string; note?: string | null; by: string; at: string }

export function ReferralCard({ r, editable, onUpdated }: { r: ReferralRow; editable: boolean; onUpdated: (r: ReferralRow, label: string) => void }) {
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
          <span className="crm-sub">{[r.patientSex, r.patientAge ? `${r.patientAge} yrs` : null, r.clientPhone, r.block].filter(Boolean).join(' · ') || 'No patient details'}</span>
        </div>
        {r.urgent && <Pill tone="bad">Urgent</Pill>}
        <Pill tone={stageTone(r.status)} dot>{r.stageLabel}</Pill>
      </div>

      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <Info label="Department" value={r.department || '—'} />
        <Info label="Referred by" value={`${r.contactName}${r.contactRole ? ` (${contactTypeLabel(r.contactRole)})` : ''}`} />
        <Info label="Field agent" value={r.agentName} />
        <Info label="Referred on" value={fmt.dateTime(r.createdAt)} />
      </dl>
      {r.notes && <div className="crm-note" style={{ whiteSpace: 'pre-line' }}>{r.notes}</div>}

      {editable ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Update stage · the agent and partner are notified</span>
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
