'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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
  
  // Tabs: 'current' (pending) | 'history' (resolved)
  const [activeTab, setActiveTab] = useState<'current' | 'history'>('current');

  const load = useCallback(async (tab: 'current' | 'history') => {
    if (!agentId) return;
    setLoading(true);
    setError('');
    try {
      setPairs(await getDuplicates(tab === 'current' ? 'pending' : 'history'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load duplicates.');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load(activeTab);
  }, [load, activeTab]);

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

  const displayedPairs = pairs;

  return (
    <div style={{ paddingBottom: '3rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', color: 'var(--text-primary)', marginBottom: '0.2rem' }}>⚠️ Duplicate Contacts</h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Review and merge potential duplicate channel partners flagged in the field.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', background: 'var(--surface-input)', padding: '0.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--surface-border)' }}>
          <button
            className={`btn btn-sm ${activeTab === 'current' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('current')}
            style={activeTab === 'current' ? {} : { color: 'var(--text-muted)' }}
          >
            ⏳ Current
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'history' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab('history')}
            style={activeTab === 'history' ? {} : { color: 'var(--text-muted)' }}
          >
            ✅ History
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: '1.5rem', borderLeft: '4px solid var(--color-danger)', background: 'rgba(239,68,68,0.05)' }}>
          <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem' }}>{error}</p>
        </div>
      )}

      {localFlagged.length > 0 && activeTab === 'current' && (
        <div className="card" style={{ marginBottom: '1.5rem', borderLeft: '4px solid var(--color-warning)', background: 'rgba(245, 158, 11, 0.05)' }}>
          <h3 style={{ fontSize: '1rem', color: '#f59e0b', marginBottom: '0.25rem' }}>
            📱 Local Device Flagged Contacts ({localFlagged.length})
          </h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            You have {localFlagged.length} contact(s) on this device marked as duplicates during offline collection. They will merge on server push.
          </p>
        </div>
      )}

      {loading ? (
        <div className="empty-state" style={{ padding: '3rem' }}>
          <p style={{ color: 'var(--text-muted)' }}>Loading duplicates…</p>
        </div>
      ) : displayedPairs.length === 0 ? (
        <div className="empty-state" style={{ padding: '3rem' }}>
          <div className="empty-state-icon">{activeTab === 'current' ? '🎉' : '📭'}</div>
          <h2>{activeTab === 'current' ? 'All clear!' : 'No History'}</h2>
          <p style={{ color: 'var(--text-muted)' }}>
            {activeTab === 'current' ? 'No duplicate contacts pending review.' : 'No resolved duplicates yet.'}
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'var(--surface-hover)', borderBottom: '1px solid var(--surface-border)' }}>
                  <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', width: '40%' }}>Original Record (A)</th>
                  <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', width: '40%' }}>Duplicate Candidate (B)</th>
                  <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', textAlign: 'right', width: '20%' }}>
                    {activeTab === 'current' ? 'Quick Actions' : 'Resolution'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayedPairs.map((pair) => {
                  const isActing = actingOn === pair.id;
                  return (
                    <tr key={pair.id} style={{ borderBottom: '1px solid var(--surface-border)', opacity: isActing ? 0.6 : 1, transition: 'opacity 0.2s' }}>
                      {/* Record A */}
                      <td style={{ padding: '1rem', verticalAlign: 'top', borderRight: '1px dashed var(--surface-border)' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.2rem', fontSize: '0.95rem' }}>{pair.recordA.name}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-primary-600)', marginBottom: '0.5rem', fontWeight: 500 }}>
                          {pair.recordA.role.replace('_', ' ').toUpperCase()}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                          <div>📞 {pair.recordA.phone || 'No phone'}</div>
                          <div>📍 {pair.recordA.panchayatName}</div>
                          <div>👤 {pair.recordA.agentName}</div>
                        </div>
                      </td>

                      {/* Record B */}
                      <td style={{ padding: '1rem', verticalAlign: 'top' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.2rem', fontSize: '0.95rem' }}>{pair.recordB.name}</div>
                        <div style={{ fontSize: '0.8rem', color: '#f59e0b', marginBottom: '0.5rem', fontWeight: 500 }}>
                          {pair.recordB.role.replace('_', ' ').toUpperCase()}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                          <div>📞 {pair.recordB.phone || 'No phone'}</div>
                          <div>📍 {pair.recordB.panchayatName}</div>
                          <div>👤 {pair.recordB.agentName}</div>
                        </div>
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '1rem', verticalAlign: 'middle', textAlign: 'right' }}>
                        {activeTab === 'current' && pair.status === 'pending' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
                            <button
                              className="btn btn-sm btn-primary"
                              style={{ width: '100%', background: '#10b981', borderColor: '#10b981' }}
                              onClick={() => handleAction(pair.id, 'merged')}
                              disabled={isActing}
                            >
                              🔗 Merge (Keep A)
                            </button>
                            <button
                              className="btn btn-sm btn-ghost"
                              style={{ width: '100%', fontSize: '0.75rem' }}
                              onClick={() => handleAction(pair.id, 'dismissed')}
                              disabled={isActing}
                            >
                              ✕ Dismiss
                            </button>
                          </div>
                        ) : (
                          <span className="badge" style={{ 
                            background: pair.status === 'merged' ? 'rgba(16,185,129,0.1)' : 'rgba(100,116,139,0.1)', 
                            color: pair.status === 'merged' ? '#10b981' : '#64748b',
                            fontSize: '0.8rem'
                          }}>
                            {pair.status === 'merged' ? '✅ Merged' : '✕ Dismissed'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
