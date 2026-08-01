'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAgentStore } from '@/store/agent-store';
import { getDuplicates, mergeDuplicate, dismissDuplicate, type DuplicatePairDto } from '@/lib/sync/api-client';
import { useFlaggedDuplicates } from '@/lib/db';

export default function DuplicatesClient() {
  const agentId = useAgentStore((s) => s.agentId);
  const localFlagged = useFlaggedDuplicates() || [];
  const [pairs, setPairs] = useState<DuplicatePairDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actingOn, setActingOn] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    setError('');
    try {
      setPairs(await getDuplicates());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load duplicates.');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAction(id: string, action: 'merged' | 'dismissed') {
    if (!agentId) return;
    setActingOn(id);
    setError('');
    try {
      if (action === 'merged') {
        await mergeDuplicate(id);
      } else {
        await dismissDuplicate(id);
      }
      setPairs((prev) => prev.map((p) => (p.id === id ? { ...p, status: action } : p)));
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action === 'merged' ? 'merge' : 'dismiss'} record.`);
    } finally {
      setActingOn(null);
    }
  }

  const pendingCount = pairs.filter((p) => p.status === 'pending').length;
  const resolvedCount = pairs.filter((p) => p.status !== 'pending').length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', color: 'var(--text-primary)', marginBottom: '0.2rem' }}>⚠️ Duplicate Contact Resolution</h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Review potential duplicate channel partners, key accounts, and local reps flagged across agents and panchayats.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <span className="badge badge-dup" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}>
            ⏳ {pendingCount} Pending Review
          </span>
          <span className="badge badge-online" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}>
            ✅ {resolvedCount} Resolved
          </span>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: '1.5rem', borderLeft: '4px solid var(--color-danger)', background: 'rgba(239,68,68,0.05)' }}>
          <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem' }}>{error}</p>
        </div>
      )}

      {localFlagged.length > 0 && (
        <div className="card" style={{ marginBottom: '1.5rem', borderLeft: '4px solid var(--color-warning)', background: 'rgba(245, 158, 11, 0.05)' }}>
          <h3 style={{ fontSize: '1rem', color: '#f59e0b', marginBottom: '0.25rem' }}>
            📱 Local Device Flagged Contacts ({localFlagged.length})
          </h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            You have {localFlagged.length} contact(s) on this device marked with <code>potential_duplicate_of</code> during offline field collection. They will merge cleanly on server push.
          </p>
        </div>
      )}

      {loading ? (
        <div className="empty-state" style={{ padding: '3rem' }}>
          <p style={{ color: 'var(--text-muted)' }}>Loading duplicates…</p>
        </div>
      ) : pairs.length === 0 ? (
        <div className="empty-state" style={{ padding: '3rem' }}>
          <p style={{ color: 'var(--text-muted)' }}>No duplicate contacts flagged yet.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {pairs.map((pair) => {
            const isPending = pair.status === 'pending';
            const isActing = actingOn === pair.id;
            return (
              <div
                key={pair.id}
                className="card"
                style={{
                  borderTop: `4px solid ${isPending ? 'var(--color-danger)' : pair.status === 'merged' ? '#10b981' : '#64748b'}`,
                  opacity: isPending ? 1 : 0.75,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--surface-border)' }}>
                  <div>
                    <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Flagged as a potential duplicate
                    </span>
                  </div>
                  <div>
                    {!isPending ? (
                      <span className="badge" style={{ background: pair.status === 'merged' ? 'rgba(16,185,129,0.2)' : 'rgba(100,116,139,0.2)', color: pair.status === 'merged' ? '#10b981' : '#94a3b8', padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
                        {pair.status === 'merged' ? '✅ MERGED AS PRIMARY / ALIAS' : '✕ MARKED AS DISTINCT RECORDS'}
                      </span>
                    ) : (
                      <span className="badge badge-pending">⏳ ACTION REQUIRED</span>
                    )}
                  </div>
                </div>

                {/* Side by Side Comparison Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.25rem' }}>
                  {/* Record A */}
                  <div style={{ padding: '1rem', borderRadius: 'var(--radius-sm)', background: 'var(--surface-card-hover)', border: '1px solid var(--surface-border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-primary-600)', fontWeight: 700 }}>RECORD A (ORIGINAL)</span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>ID: {pair.recordA.clientId.slice(0, 8)}</span>
                    </div>
                    <h3 style={{ fontSize: '1.1rem', color: 'var(--text-primary)', marginBottom: '0.35rem' }}>{pair.recordA.name}</h3>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                      Role: <strong style={{ color: 'var(--color-primary-600)' }}>{pair.recordA.role.replace('_', ' ').toUpperCase()}</strong>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)', background: 'var(--surface-input)', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--surface-border)' }}>
                      <div>📞 Phone: <strong>{pair.recordA.phone || 'None'}</strong></div>
                      <div>📍 Panchayat: <strong>{pair.recordA.panchayatName}</strong></div>
                      <div>👤 Logged by: <strong>{pair.recordA.agentName}</strong></div>
                      <div>📅 Time: <strong>{new Date(pair.recordA.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</strong></div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                      <span className={`badge ${pair.recordA.whatsappAdded ? 'badge-online' : 'badge-pending'}`} style={{ fontSize: '0.7rem' }}>
                        {pair.recordA.whatsappAdded ? '🟢 WhatsApp' : '⚪ No WhatsApp'}
                      </span>
                      <span className={`badge ${pair.recordA.cardGiven ? 'badge-online' : 'badge-pending'}`} style={{ fontSize: '0.7rem' }}>
                        {pair.recordA.cardGiven ? '🟢 Card Given' : '⚪ No Card'}
                      </span>
                    </div>
                  </div>

                  {/* Record B */}
                  <div style={{ padding: '1rem', borderRadius: 'var(--radius-sm)', background: 'var(--surface-card-hover)', border: '1px solid var(--surface-border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.75rem', color: '#f59e0b', fontWeight: 700 }}>RECORD B (DUPLICATE CANDIDATE)</span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>ID: {pair.recordB.clientId.slice(0, 8)}</span>
                    </div>
                    <h3 style={{ fontSize: '1.1rem', color: 'var(--text-primary)', marginBottom: '0.35rem' }}>{pair.recordB.name}</h3>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                      Role: <strong style={{ color: '#f59e0b' }}>{pair.recordB.role.replace('_', ' ').toUpperCase()}</strong>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)', background: 'var(--surface-input)', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--surface-border)' }}>
                      <div>📞 Phone: <strong>{pair.recordB.phone || 'None'}</strong></div>
                      <div>📍 Panchayat: <strong>{pair.recordB.panchayatName}</strong></div>
                      <div>👤 Logged by: <strong>{pair.recordB.agentName}</strong></div>
                      <div>📅 Time: <strong>{new Date(pair.recordB.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</strong></div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                      <span className={`badge ${pair.recordB.whatsappAdded ? 'badge-online' : 'badge-pending'}`} style={{ fontSize: '0.7rem' }}>
                        {pair.recordB.whatsappAdded ? '🟢 WhatsApp' : '⚪ No WhatsApp'}
                      </span>
                      <span className={`badge ${pair.recordB.cardGiven ? 'badge-online' : 'badge-pending'}`} style={{ fontSize: '0.7rem' }}>
                        {pair.recordB.cardGiven ? '🟢 Card Given' : '⚪ No Card'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                {isPending && (
                  <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', paddingTop: '0.75rem', borderTop: '1px solid var(--surface-border)' }}>
                    <button
                      className="btn btn-ghost"
                      onClick={() => handleAction(pair.id, 'dismissed')}
                      disabled={isActing}
                      style={{ borderColor: 'var(--surface-border)', fontSize: '0.85rem' }}
                    >
                      ✕ Mark as Distinct (Not a Duplicate)
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={() => handleAction(pair.id, 'merged')}
                      disabled={isActing}
                      style={{ background: '#10b981', borderColor: '#10b981', fontSize: '0.85rem' }}
                    >
                      {isActing ? 'Working…' : '🔗 Merge Records (Keep A as Primary, link B as alias)'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
