'use client';

import { useState } from 'react';
import { useAgentStore } from '@/store/agent-store';
import { getDuplicates, mergeDuplicate, dismissDuplicate, type DuplicatePairDto } from '@/lib/sync/api-client';
import { useFlaggedDuplicates } from '@/lib/db';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export default function DuplicatesClient() {
  const agentId = useAgentStore((s) => s.agentId);
  const localFlagged = useFlaggedDuplicates() || [];
  const queryClient = useQueryClient();
  
  // Tabs: 'current' (pending) | 'history' (resolved)
  const [activeTab, setActiveTab] = useState<'current' | 'history'>('current');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const { data: duplicatesData, isLoading: loading, error: queryError } = useQuery({
    queryKey: ['duplicates', activeTab, page, pageSize],
    queryFn: () => getDuplicates(activeTab === 'current' ? 'pending' : 'history', page, pageSize),
    enabled: !!agentId,
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  const pairs = duplicatesData?.items || [];
  const totalCount = duplicatesData?.totalCount || 0;

  const mergeMutation = useMutation({
    mutationFn: (id: string) => mergeDuplicate(id),
    onSuccess: (_, id) => {
      // Optimistically update: remove it from current pending list or mark as merged
      if (activeTab === 'current') {
        queryClient.setQueryData(['duplicates', 'current'], (old: DuplicatePairDto[] | undefined) => 
          old ? old.filter((p) => p.id !== id) : []
        );
      }
      queryClient.invalidateQueries({ queryKey: ['duplicates', 'history'] });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => dismissDuplicate(id),
    onSuccess: (_, id) => {
      // Optimistically update: remove it from current pending list
      if (activeTab === 'current') {
        queryClient.setQueryData(['duplicates', 'current'], (old: DuplicatePairDto[] | undefined) => 
          old ? old.filter((p) => p.id !== id) : []
        );
      }
      queryClient.invalidateQueries({ queryKey: ['duplicates', 'history'] });
    },
  });

  const error = queryError?.message || mergeMutation.error?.message || dismissMutation.error?.message;
  const isActing = mergeMutation.isPending || dismissMutation.isPending;
  const actingOn = mergeMutation.variables || dismissMutation.variables;

  return (
    <div style={{ paddingBottom: '3rem' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', color: 'var(--text-primary)', marginBottom: '0.2rem', fontWeight: 700 }}>⚠️ Duplicate Contacts</h1>
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
      </div>

      {error && (
        <div className="card" style={{ marginBottom: '1.5rem', borderLeft: '4px solid var(--color-danger)', background: 'rgba(239,68,68,0.05)' }}>
          <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', fontWeight: 600 }}>{error}</p>
        </div>
      )}

      {localFlagged.length > 0 && activeTab === 'current' && (
        <div className="card" style={{ marginBottom: '1.5rem', borderLeft: '4px solid var(--color-warning)', background: 'rgba(245, 158, 11, 0.05)' }}>
          <h3 style={{ fontSize: '1rem', color: '#f59e0b', marginBottom: '0.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>📱</span> Local Device Flagged Contacts ({localFlagged.length})
          </h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            You have {localFlagged.length} contact(s) on this device marked as duplicates during offline collection. They will appear for review upon server sync.
          </p>
        </div>
      )}

      {loading ? (
        <div className="empty-state" style={{ padding: '4rem 2rem' }}>
          <div className="spinner" style={{ width: 32, height: 32, border: '3px solid #e2e8f0', borderTopColor: 'var(--color-primary-500)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginBottom: '1rem' }} />
          <p style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Loading duplicates…</p>
        </div>
      ) : pairs.length === 0 ? (
        <div className="empty-state" style={{ padding: '4rem 2rem' }}>
          <div className="empty-state-icon" style={{ fontSize: '3rem', marginBottom: '1rem' }}>{activeTab === 'current' ? '🎉' : '📭'}</div>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>{activeTab === 'current' ? 'All clear!' : 'No History'}</h2>
          <p style={{ color: 'var(--text-muted)' }}>
            {activeTab === 'current' ? 'No duplicate contacts pending review.' : 'No resolved duplicates yet.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {pairs.map((pair) => {
            const isTarget = actingOn === pair.id;
            return (
              <div 
                key={pair.id} 
                className="card" 
                style={{ 
                  padding: 0, 
                  overflow: 'hidden',
                  opacity: isActing && isTarget ? 0.6 : 1,
                  transition: 'opacity 0.2s, transform 0.2s',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)'
                }}
              >
                {/* Responsive Flex Container */}
                <div style={{ display: 'flex', flexWrap: 'wrap', width: '100%' }}>
                  
                  {/* Record A */}
                  <div style={{ flex: '1 1 300px', padding: '1.5rem', borderRight: '1px dashed var(--surface-border)', borderBottom: '1px dashed var(--surface-border)' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>Original Record (A)</div>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.2rem', fontSize: '1.1rem' }}>{pair.recordA.name}</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--color-primary-600)', marginBottom: '0.75rem', fontWeight: 600 }}>
                      {pair.recordA.role.replace('_', ' ').toUpperCase()}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><span>📞</span> <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{pair.recordA.phone || 'No phone'}</span></div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><span>📍</span> <span>{pair.recordA.panchayatName}</span></div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><span>👤</span> <span>{pair.recordA.agentName}</span></div>
                    </div>
                  </div>

                  {/* Record B */}
                  <div style={{ flex: '1 1 300px', padding: '1.5rem', borderRight: '1px dashed var(--surface-border)', borderBottom: '1px dashed var(--surface-border)' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>Duplicate Candidate (B)</div>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.2rem', fontSize: '1.1rem' }}>{pair.recordB.name}</div>
                    <div style={{ fontSize: '0.85rem', color: '#f59e0b', marginBottom: '0.75rem', fontWeight: 600 }}>
                      {pair.recordB.role.replace('_', ' ').toUpperCase()}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><span>📞</span> <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{pair.recordB.phone || 'No phone'}</span></div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><span>📍</span> <span>{pair.recordB.panchayatName}</span></div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><span>👤</span> <span>{pair.recordB.agentName}</span></div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ flex: '1 1 200px', padding: '1.5rem', display: 'flex', flexDirection: 'column', justifyContent: 'center', background: 'var(--surface-hover)' }}>
                    {activeTab === 'current' && pair.status === 'pending' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%' }}>
                        <button
                          className="btn btn-primary"
                          style={{ width: '100%', background: '#10b981', borderColor: '#10b981', fontWeight: 600, padding: '0.75rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}
                          onClick={() => mergeMutation.mutate(pair.id)}
                          disabled={isActing}
                        >
                          {isActing && isTarget ? (
                            <span className="spinner" style={{ width: '1rem', height: '1rem', borderWidth: '2px', borderTopColor: 'white' }}></span>
                          ) : '🔗 Merge (Keep A)'}
                        </button>
                        <button
                          className="btn btn-ghost"
                          style={{ width: '100%', fontSize: '0.85rem', fontWeight: 600, padding: '0.75rem', border: '1px solid #e2e8f0' }}
                          onClick={() => dismissMutation.mutate(pair.id)}
                          disabled={isActing}
                        >
                          ✕ Dismiss
                        </button>
                        <div style={{ textAlign: 'center', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                          Merging discards Record B.
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '0.5rem' }}>
                        <span className="badge" style={{ 
                          background: pair.status === 'merged' ? 'rgba(16,185,129,0.1)' : 'rgba(100,116,139,0.1)', 
                          color: pair.status === 'merged' ? '#10b981' : '#64748b',
                          fontSize: '0.85rem',
                          fontWeight: 700,
                          padding: '0.5rem 1rem'
                        }}>
                          {pair.status === 'merged' ? '✅ Merged' : '✕ Dismissed'}
                        </span>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {activeTab === 'history' && 'Resolved'}
                        </div>
                      </div>
                    )}
                  </div>

                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Controls */}
      {!loading && pairs.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, totalCount)} of {totalCount} duplicates
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <select
              className="input-field"
              style={{ width: 'auto', padding: '0.2rem 1.5rem 0.2rem 0.5rem', fontSize: '0.85rem', minHeight: '32px' }}
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              <option value="10">10 / page</option>
              <option value="50">50 / page</option>
              <option value="100">100 / page</option>
            </select>
            <div style={{ display: 'flex', gap: '0.25rem' }}>
              <button 
                className="btn btn-secondary btn-sm" 
                disabled={page === 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <div style={{ padding: '0.2rem 0.5rem', fontSize: '0.85rem', color: 'var(--text-primary)', border: '1px solid var(--surface-border)', borderRadius: '4px', background: 'var(--surface-hover)' }}>
                Page {page} of {Math.max(1, Math.ceil(totalCount / pageSize))}
              </div>
              <button 
                className="btn btn-secondary btn-sm" 
                disabled={page >= Math.ceil(totalCount / pageSize)}
                onClick={() => setPage(p => Math.min(Math.ceil(totalCount / pageSize), p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
