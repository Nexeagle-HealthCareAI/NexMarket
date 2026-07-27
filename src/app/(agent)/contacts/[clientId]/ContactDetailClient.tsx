'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { v4 as uuidv4 } from 'uuid';
import { useAgentStore } from '@/store/agent-store';
import { useContact, usePanchayats, useReferrals, useActiveVisit, db } from '@/lib/db';
import { addToOutbox } from '@/lib/sync/outbox';
import type { ReferralStatus, LocalReferral } from '@/lib/db/schema';

const STATUS_LABELS: Record<ReferralStatus, { label: string; badgeClass: string; icon: string }> = {
  pending: { label: 'Pending Review', badgeClass: 'badge-pending', icon: '⏳' },
  converted: { label: 'Converted (Active Client Onboarded)', badgeClass: 'badge-online', icon: '✅' },
  lost: { label: 'Lost to Competitor / Inactive', badgeClass: 'badge-dup', icon: '❌' },
};

export default function ContactDetailClient({ clientId }: { clientId: string }) {
  const router = useRouter();
  const deviceId = useAgentStore((s) => s.deviceId);
  const activeVisitClientId = useAgentStore((s) => s.activeVisitClientId);

  const contact = useContact(clientId);
  const panchayats = usePanchayats();
  const referrals = useReferrals(clientId);

  const [showReferralForm, setShowReferralForm] = useState(false);
  const [status, setStatus] = useState<ReferralStatus>('pending');
  const [referralDate, setReferralDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const panchayat = useMemo(() => {
    return panchayats?.find((p) => p.id === contact?.panchayatId);
  }, [panchayats, contact]);

  async function handleAddReferral(e: React.FormEvent) {
    e.preventDefault();
    if (!contact || !deviceId) return;

    setSaving(true);
    setError('');

    const refClientId = uuidv4();
    const now = new Date().toISOString();

    const newReferral: LocalReferral = {
      clientId: refClientId,
      deviceId,
      contactId: contact.clientId,
      visitId: activeVisitClientId ?? undefined,
      referralDate,
      status,
      notes: notes.trim() || undefined,
      createdAt: now,
    };

    try {
      await db.referrals.add(newReferral);
      await addToOutbox(refClientId, deviceId, 'referral', newReferral);
      setShowReferralForm(false);
      setNotes('');
      setStatus('pending');
    } catch {
      setError('Failed to save referral outcome. Try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!contact) {
    return (
      <div className="empty-state" style={{ paddingTop: '4rem' }}>
        <div className="empty-state-icon">👤</div>
        <h2>Contact not found</h2>
        <p style={{ fontSize: '0.85rem' }}>This contact record does not exist or was deleted.</p>
        <button className="btn btn-primary" onClick={() => router.push('/contacts')} style={{ marginTop: '0.5rem' }}>
          Back to Contacts
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            onClick={() => router.back()}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0.25rem' }}
            aria-label="Go back"
          >
            ←
          </button>
          <h1>Contact Profile</h1>
        </div>
      </div>

      {/* Contact Main Card */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
          <div>
            <h2 style={{ fontSize: '1.3rem', color: 'var(--text-primary)', marginBottom: '0.2rem' }}>{contact.name}</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              📍 {panchayat ? `${panchayat.name} (${panchayat.block})` : 'Panchayat loading…'}
            </p>
            {contact.phone && (
              <p style={{ fontSize: '0.9rem', color: 'var(--color-primary-400)', fontWeight: 600, marginTop: '0.35rem' }}>
                📞 <a href={`tel:${contact.phone}`} style={{ color: 'inherit', textDecoration: 'none' }}>+91 {contact.phone}</a>
              </p>
            )}
          </div>
          <span className="badge" style={{ background: 'rgba(99,102,241,0.2)', color: 'var(--color-primary-400)', fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}>
            {contact.role.replace('_', ' ').toUpperCase()}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', paddingTop: '0.5rem', borderTop: '1px solid var(--surface-border)' }}>
          <span className={`badge ${contact.whatsappAdded ? 'badge-online' : 'badge-pending'}`}>
            {contact.whatsappAdded ? '🟢 WhatsApp Added' : '⚪ Not in WhatsApp Group'}
          </span>
          <span className={`badge ${contact.cardGiven ? 'badge-online' : 'badge-pending'}`}>
            {contact.cardGiven ? '🟢 Partner Card Given' : '⚪ No Partner Card'}
          </span>
          {contact.potentialDuplicateOf && contact.potentialDuplicateOf.length > 0 && (
            <span className="badge badge-dup">⚠️ Potential Duplicate</span>
          )}
        </div>

        {contact.notes && (
          <div style={{ marginTop: '0.75rem', padding: '0.6rem', background: 'var(--surface-bg)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <strong>Notes:</strong> {contact.notes}
          </div>
        )}
      </div>

      {/* Referrals Header & Button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <h3 style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>Client Referrals ({referrals?.length ?? 0})</h3>
        {!showReferralForm && (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setShowReferralForm(true)}
            id="add-referral-btn"
          >
            + Add Referral Outcome
          </button>
        )}
      </div>

      {/* Inline Referral Form */}
      {showReferralForm && (
        <form onSubmit={handleAddReferral} className="card" style={{ marginBottom: '1.25rem', borderColor: 'var(--color-primary-500)', background: 'rgba(99,102,241,0.04)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h4 style={{ color: 'var(--text-primary)', fontSize: '0.95rem' }}>Log New Client Referral</h4>
            <button
              type="button"
              onClick={() => setShowReferralForm(false)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.1rem' }}
            >
              ✕
            </button>
          </div>

          <div className="field-group" style={{ marginBottom: '0.75rem' }}>
            <label className="field-label" htmlFor="ref-status">Referral Outcome Status *</label>
            <select
              id="ref-status"
              className="field-input"
              value={status}
              onChange={(e) => setStatus(e.target.value as ReferralStatus)}
              required
            >
              <option value="pending">⏳ Pending Review (Client referred, not yet arrived)</option>
              <option value="converted">✅ Converted (Active Client Onboarded)</option>
              <option value="lost">❌ Lost (Declined / Inactive)</option>
            </select>
          </div>

          <div className="field-group" style={{ marginBottom: '0.75rem' }}>
            <label className="field-label" htmlFor="ref-date">Referral Date *</label>
            <input
              id="ref-date"
              className="field-input"
              type="date"
              value={referralDate}
              onChange={(e) => setReferralDate(e.target.value)}
              required
            />
          </div>

          <div className="field-group" style={{ marginBottom: '1rem' }}>
            <label className="field-label" htmlFor="ref-notes">Client Name / Area / Notes</label>
            <textarea
              id="ref-notes"
              className="field-input"
              rows={2}
              placeholder="e.g. Ramesh Kumar, Cardiology consultation..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>{error}</p>}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>
              {saving ? 'Saving…' : '💾 Save Referral'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setShowReferralForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Referrals List */}
      {!referrals || referrals.length === 0 ? (
        <div className="empty-state" style={{ padding: '2rem 1rem' }}>
          <div className="empty-state-icon" style={{ fontSize: '2rem' }}>🏢</div>
          <p style={{ fontSize: '0.85rem' }}>No client referrals logged from this contact yet.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          {referrals.map((ref) => {
            const st = STATUS_LABELS[ref.status];
            return (
              <div key={ref.clientId} className="card" style={{ padding: '0.85rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <span className={`badge ${st.badgeClass}`}>
                    {st.icon} {st.label}
                  </span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    📅 {new Date(ref.referralDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
                {ref.notes ? (
                  <p style={{ fontSize: '0.88rem', color: 'var(--text-primary)', marginTop: '0.35rem' }}>{ref.notes}</p>
                ) : (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '0.25rem' }}>No additional notes provided</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
