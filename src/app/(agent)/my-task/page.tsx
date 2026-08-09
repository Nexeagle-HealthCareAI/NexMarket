'use client';

import { useEffect, useState } from 'react';
import { useAgentStore } from '@/store/agent-store';
import { getMyAssignment, type MyAssignmentDto } from '@/lib/sync/api-client';
import { getSyncStateValue, setSyncStateValue } from '@/lib/db';
import TaskMap from './TaskMap';

const CACHE_KEY_PREFIX = 'lastAssignment_';

export default function MyTaskPage() {
  const agentId = useAgentStore((s) => s.agentId);
  const [assignment, setAssignment] = useState<MyAssignmentDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isStale, setIsStale] = useState(false);
  const [filter, setFilter] = useState<'all' | 'visited' | 'pending'>('all');
  const [selectedPanchayatId, setSelectedPanchayatId] = useState<string | null>(null);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    setLoading(true);
    // Scoped per agent — devices get reused/shared between agents in the
    // field, and an unscoped cache key would show whoever used this device
    // last's assigned block/panchayats to the next agent if they go offline
    // before their own first successful fetch.
    const cacheKey = CACHE_KEY_PREFIX + agentId;

    getMyAssignment()
      .then((data) => {
        if (cancelled) return;
        setAssignment(data);
        setIsStale(false);
        void setSyncStateValue(cacheKey, JSON.stringify(data));
      })
      .catch(async (e) => {
        if (cancelled) return;
        // Every other page in this app is Dexie-backed and works offline —
        // this one was a bare network call with no fallback, so it just
        // errored out while offline instead of showing whatever was last
        // fetched (which is exactly the situation an agent checking their
        // task list before heading into a low-signal area needs).
        const cached = await getSyncStateValue(cacheKey);
        if (cached) {
          try {
            setAssignment(JSON.parse(cached) as MyAssignmentDto);
            setIsStale(true);
            return;
          } catch {
            // fall through to the error state below
          }
        }
        setError(e instanceof Error ? e.message : 'Failed to load your assignment.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [agentId]);

  if (loading) {
    return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading your task…</div>;
  }

  if (error) {
    return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-danger)' }}>{error}</div>;
  }

  if (!assignment || !assignment.block) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center' }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>📋</div>
        <h2 style={{ fontSize: '1.1rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>No active task assigned</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Your admin hasn't assigned you a block yet.</p>
      </div>
    );
  }

  const total = assignment.panchayats.length;
  const visited = assignment.panchayats.filter((p) => p.visited).length;
  const pct = total > 0 ? Math.round((visited / total) * 100) : 0;
  const visible = assignment.panchayats.filter((p) => filter === 'all' || (filter === 'visited') === p.visited);

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <h1 style={{ fontSize: '1.3rem', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>My Task</h1>
      {isStale && (
        <div style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: 'var(--radius-md)', padding: '0.6rem 0.85rem', marginBottom: '0.85rem', fontSize: '0.8rem', color: '#b45309', fontWeight: 600 }}>
          ⚠️ Offline — showing your last downloaded task list, may not reflect recent changes.
        </div>
      )}
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
        Assigned {assignment.assignedAt ? new Date(assignment.assignedAt).toLocaleDateString('en-GB') : ''}
      </p>

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Assigned Block</div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>{assignment.block}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{assignment.district}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-primary-600)' }}>{pct}%</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{visited} / {total} visited</div>
          </div>
        </div>
        <div style={{ height: 8, borderRadius: 4, background: 'var(--surface-input)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: 'var(--color-primary-500)', transition: 'width 0.3s' }} />
        </div>
        {assignment.notes && (
          <p style={{ marginTop: '0.85rem', fontSize: '0.85rem', color: 'var(--text-secondary)', background: 'var(--surface-input)', padding: '0.65rem', borderRadius: 'var(--radius-sm)' }}>
            📝 {assignment.notes}
          </p>
        )}
      </div>

      <TaskMap
        panchayats={assignment.panchayats}
        selectedPanchayatId={selectedPanchayatId}
        onSelectPanchayat={setSelectedPanchayatId}
      />

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        {(['all', 'pending', 'visited'] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setFilter(f)}
            style={{ textTransform: 'capitalize' }}
          >
            {f}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {visible.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
            Nothing to show for this filter.
          </div>
        ) : (
          visible.map((p) => {
            const isSelected = p.panchayatId === selectedPanchayatId;
            const canRoute = p.centroidLat != null && p.centroidLng != null;
            return (
              <div
                key={p.panchayatId}
                className="card"
                onClick={() => canRoute && setSelectedPanchayatId(isSelected ? null : p.panchayatId)}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.85rem 1rem',
                  cursor: canRoute ? 'pointer' : 'default',
                  borderColor: isSelected ? '#3b82f6' : undefined,
                  boxShadow: isSelected ? '0 0 0 2px rgba(59,130,246,0.25)' : undefined,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.92rem' }}>{p.name}</div>
                  {p.lastVisitedAt && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      Last visited {new Date(p.lastVisitedAt).toLocaleDateString('en-GB')}
                    </div>
                  )}
                  {canRoute && (
                    <div style={{ fontSize: '0.72rem', color: '#3b82f6', fontWeight: 600, marginTop: '0.15rem' }}>
                      {isSelected ? '🧭 Routing shown above' : '🧭 Tap to route'}
                    </div>
                  )}
                </div>
                <span
                  style={{
                    fontSize: '0.75rem', fontWeight: 700, padding: '0.25rem 0.6rem', borderRadius: '20px',
                    background: p.visited ? 'rgba(16,185,129,0.15)' : 'rgba(148,163,184,0.15)',
                    color: p.visited ? '#10b981' : '#64748b',
                  }}
                >
                  {p.visited ? '✅ Visited' : '⏳ Pending'}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
