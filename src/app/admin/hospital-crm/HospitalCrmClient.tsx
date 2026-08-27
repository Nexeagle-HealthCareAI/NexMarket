'use client';

import { useEffect, useState, useMemo } from 'react';
import { getHospitalReferrals, updateReferralStatus, type HospitalReferralDto } from '@/lib/sync/api-client';

const STATUS_LABELS: Record<string, { label: string; badge: string; icon: string }> = {
  pending: { label: 'Pending Review', badge: 'badge-pending', icon: '⏳' },
  converted: { label: 'Converted', badge: 'badge-online', icon: '✅' },
  lost: { label: 'Lost / Declined', badge: 'badge-dup', icon: '❌' },
};

export default function HospitalCrmClient() {
  const [referrals, setReferrals] = useState<HospitalReferralDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  
  const [selectedReferral, setSelectedReferral] = useState<HospitalReferralDto | null>(null);
  const [newStatus, setNewStatus] = useState<'pending' | 'converted' | 'lost'>('pending');
  const [adminNotes, setAdminNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getHospitalReferrals(statusFilter === 'all' ? undefined : statusFilter);
      setReferrals(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load referrals.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReferral) return;
    setSaving(true);
    try {
      await updateReferralStatus(selectedReferral.clientId, {
        status: newStatus,
        notes: adminNotes.trim() || undefined,
      });
      setSelectedReferral(null);
      setAdminNotes('');
      await loadData();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to update referral.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ paddingBottom: '3rem' }}>
      <style>{`
        @media (max-width: 768px) {
          .responsive-table, .responsive-table thead, .responsive-table tbody, .responsive-table th, .responsive-table td, .responsive-table tr {
            display: block;
          }
          .responsive-table thead tr {
            display: none;
          }
          .responsive-table tr {
            margin-bottom: 1rem;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            background: white;
            padding: 0.5rem;
          }
          .responsive-table td {
            border: none !important;
            border-bottom: 1px solid #f1f5f9 !important;
            position: relative;
            padding: 0.75rem 1rem !important;
            text-align: left !important;
          }
          .responsive-table td::before {
            content: attr(data-label);
            display: block;
            font-size: 0.7rem;
            text-transform: uppercase;
            color: #64748b;
            font-weight: 700;
            margin-bottom: 0.25rem;
          }
          .responsive-table td:last-child {
            border-bottom: none !important;
          }
        }
      `}</style>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>Hospital CRM</h1>
          <p style={{ color: 'var(--text-muted)' }}>Manage patient referrals from field agents.</p>
        </div>
        <select 
          className="field-input" 
          style={{ width: 200, background: 'var(--surface-input)' }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All Referrals</option>
          <option value="pending">⏳ Pending Review</option>
          <option value="converted">✅ Converted</option>
          <option value="lost">❌ Lost / Declined</option>
        </select>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: '1.5rem', borderLeft: '4px solid var(--color-danger)', background: 'rgba(239,68,68,0.05)' }}>
          <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem' }}>{error}</p>
        </div>
      )}

      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading referrals…</div>
      ) : referrals.length === 0 ? (
        <div className="empty-state" style={{ marginTop: '2rem' }}>
          <div className="empty-state-icon">🏥</div>
          <h2>No Referrals Found</h2>
          <p>There are no referrals matching the current filters.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="responsive-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'var(--surface-hover)', borderBottom: '1px solid var(--surface-border)' }}>
                  <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Patient & Notes</th>
                  <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Agent & Contact</th>
                  <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Date</th>
                  <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Status</th>
                  <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((r) => {
                  const st = STATUS_LABELS[r.status] || STATUS_LABELS.pending;
                  return (
                    <tr key={r.clientId} style={{ borderBottom: '1px solid var(--surface-border)' }}>
                      <td data-label="Patient & Notes" style={{ padding: '1rem' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.patientName || 'Unknown Patient'}</div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--color-primary-600)', marginTop: '0.2rem' }}>📞 {r.clientPhone || 'No Phone'}</div>
                        {r.notes && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.4rem', whiteSpace: 'pre-wrap', maxHeight: 60, overflowY: 'auto' }}>{r.notes}</div>}
                      </td>
                      <td data-label="Agent & Contact" style={{ padding: '1rem' }}>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>{r.contactName}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Ref by: {r.agentName}</div>
                      </td>
                      <td data-label="Date" style={{ padding: '1rem', fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                        {r.referralDate ? new Date(r.referralDate).toLocaleDateString('en-GB') : new Date(r.createdAt).toLocaleDateString('en-GB')}
                      </td>
                      <td data-label="Status" style={{ padding: '1rem' }}>
                        <span className={`badge ${st.badge}`}>{st.icon} {st.label}</span>
                      </td>
                      <td data-label="Actions" style={{ padding: '1rem', textAlign: 'right' }}>
                        <button 
                          className="btn btn-sm btn-secondary" 
                          onClick={() => {
                            setSelectedReferral(r);
                            setNewStatus(r.status);
                            setAdminNotes('');
                          }}
                        >
                          ✏️ Update
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Update Modal */}
      {selectedReferral && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <form onSubmit={handleUpdate} className="card" style={{ width: '100%', maxWidth: 500, padding: '2rem', animation: 'fadeIn 0.2s ease-out' }}>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Update Referral Status</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
              Patient: <strong style={{ color: 'var(--text-primary)' }}>{selectedReferral.patientName || 'Unknown'}</strong><br/>
              Phone: {selectedReferral.clientPhone || 'No Phone'}
            </p>

            <div className="field-group">
              <label className="field-label">Status</label>
              <select 
                className="field-input" 
                value={newStatus} 
                onChange={e => setNewStatus(e.target.value as any)}
              >
                <option value="pending">⏳ Pending Review</option>
                <option value="converted">✅ Converted (Admitted/Consulted)</option>
                <option value="lost">❌ Lost (Declined/No Show)</option>
              </select>
            </div>

            <div className="field-group">
              <label className="field-label">Add Hospital Notes (Optional)</label>
              <textarea 
                className="field-input" 
                rows={3} 
                placeholder="e.g. Patient admitted to Cardiology on 24th Oct."
                value={adminNotes}
                onChange={e => setAdminNotes(e.target.value)}
              />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>These notes will be appended to the existing referral notes.</p>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '2rem' }}>
              <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setSelectedReferral(null)} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
