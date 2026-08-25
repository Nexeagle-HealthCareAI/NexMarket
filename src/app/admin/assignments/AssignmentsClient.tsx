'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAgentStore } from '@/store/agent-store';
import {
  getAgents,
  getAssignments,
  createAssignment,
  updateAssignmentStatus,
  getPanchayats,
  getCoveredPanchayats,
  type AdminAgentDto,
  type AssignmentSummaryDto,
  type PanchayatDto,
  type CoveredPanchayatDto,
} from '@/lib/sync/api-client';

export default function AssignmentsClient() {
  const agentId = useAgentStore((s) => s.agentId);

  const [agents, setAgents] = useState<AdminAgentDto[]>([]);
  const [assignments, setAssignments] = useState<AssignmentSummaryDto[]>([]);
  const [panchayats, setPanchayats] = useState<PanchayatDto[]>([]);
  const [coveredPanchayats, setCoveredPanchayats] = useState<CoveredPanchayatDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Active' | 'Completed' | 'Cancelled'>('all');

  // Create form state
  const [formAgentId, setFormAgentId] = useState('');
  const [formDistrict, setFormDistrict] = useState('');
  const [formBlock, setFormBlock] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const loadAll = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    setError('');
    try {
      const [agentsData, assignmentsData, panchayatsData, coveredData] = await Promise.all([
        getAgents(),
        getAssignments(),
        getPanchayats(),
        getCoveredPanchayats(),
      ]);
      setAgents(agentsData);
      setAssignments(assignmentsData);
      setPanchayats(panchayatsData);
      setCoveredPanchayats(coveredData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load assignments.');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const uniqueDistricts = useMemo(
    () => Array.from(new Set(panchayats.map((p) => p.district))).filter(Boolean).sort(),
    [panchayats]
  );
  
  const blockCoverage = useMemo(() => {
    const coverage: Record<string, { total: number; covered: number }> = {};
    for (const p of panchayats) {
      if (!coverage[p.block]) coverage[p.block] = { total: 0, covered: 0 };
      coverage[p.block].total++;
    }
    for (const cp of coveredPanchayats) {
      // getCoveredPanchayats returns panchayats that have contacts, we count them as covered
      if (coverage[cp.block]) {
        coverage[cp.block].covered++;
      }
    }
    return coverage;
  }, [panchayats, coveredPanchayats]);

  const availableBlocks = useMemo(
    () => Array.from(new Set(panchayats.filter((p) => !formDistrict || p.district === formDistrict).map((p) => p.block))).filter(Boolean).sort(),
    [panchayats, formDistrict]
  );

  const filteredAssignments = useMemo(
    () => (statusFilter === 'all' ? assignments : assignments.filter((a) => a.status === statusFilter)),
    [assignments, statusFilter]
  );

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!agentId || !formAgentId || !formDistrict || !formBlock) return;
    setCreating(true);
    setCreateError('');
    try {
      await createAssignment({
        agentId: formAgentId,
        district: formDistrict,
        block: formBlock,
        notes: formNotes.trim() || undefined,
      });
      setFormAgentId('');
      setFormDistrict('');
      setFormBlock('');
      setFormNotes('');
      void loadAll();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create assignment.');
    } finally {
      setCreating(false);
    }
  }

  async function handleStatusChange(id: string, status: 'Completed' | 'Cancelled') {
    if (!agentId) return;
    try {
      await updateAssignmentStatus(id, status);
      void loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update assignment.');
    }
  }

  const nonAdminAgents = agents.filter((a) => a.role.toLowerCase() !== 'admin');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 0.25rem 0' }}>
          Task & Block Assignments
        </h1>
        <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.9rem' }}>
          Assign a block to a field agent — they'll see it and a panchayat-by-panchayat visit checklist in the app.
        </p>
      </div>

      {error && (
        <div className="card" style={{ borderLeft: '4px solid var(--color-danger)', background: 'rgba(239,68,68,0.05)' }}>
          <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem' }}>{error}</p>
        </div>
      )}

      <style>{`
        .tasks-grid {
          display: grid;
          grid-template-columns: 360px 1fr;
          gap: 1.5rem;
          align-items: start;
        }
        @media (max-width: 768px) {
          .tasks-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
      <div className="tasks-grid">
        {/* Create Assignment */}
        <form onSubmit={handleCreate} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h2 style={{ fontSize: '1.05rem', color: 'var(--text-primary)', margin: 0 }}>➕ Assign a Block</h2>

          <div className="field-group" style={{ margin: 0 }}>
            <label className="field-label">Agent</label>
            <select className="field-input" value={formAgentId} onChange={(e) => setFormAgentId(e.target.value)} required>
              <option value="">Select an agent…</option>
              {nonAdminAgents.map((a) => (
                <option key={a.agentId} value={a.agentId}>{a.name} ({a.agentId})</option>
              ))}
            </select>
          </div>

          <div className="field-group" style={{ margin: 0 }}>
            <label className="field-label">District</label>
            <select className="field-input" value={formDistrict} onChange={(e) => { setFormDistrict(e.target.value); setFormBlock(''); }} required>
              <option value="">Select district…</option>
              {uniqueDistricts.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          <div className="field-group" style={{ margin: 0 }}>
            <label className="field-label">Block</label>
            <select className="field-input" value={formBlock} onChange={(e) => setFormBlock(e.target.value)} required disabled={!formDistrict}>
              <option value="">Select block…</option>
              {availableBlocks.map((b) => {
                const cov = blockCoverage[b];
                const pct = cov && cov.total > 0 ? Math.round((cov.covered / cov.total) * 100) : 0;
                return (
                  <option key={b} value={b}>
                    {b} — {pct}% Covered ({cov?.covered || 0}/{cov?.total || 0})
                  </option>
                );
              })}
            </select>
          </div>

          <div className="field-group" style={{ margin: 0 }}>
            <label className="field-label">Notes (optional)</label>
            <textarea className="field-input" rows={2} value={formNotes} onChange={(e) => setFormNotes(e.target.value)} placeholder="e.g. Prioritize mukhiya visits this week" />
          </div>

          {createError && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', margin: 0 }}>{createError}</p>}

          <button type="submit" className="btn btn-primary" style={{ background: 'var(--color-primary-600)' }} disabled={creating}>
            {creating ? 'Assigning…' : '⚡ Assign Block'}
          </button>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>
            Assigning a new block automatically marks the agent's previous active assignment as Completed.
          </p>
        </form>

        {/* Assignments List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {(['all', 'Active', 'Completed', 'Cancelled'] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setStatusFilter(s)}
              >
                {s === 'all' ? 'All' : s}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Loading assignments…</div>
          ) : filteredAssignments.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>No assignments yet.</div>
          ) : (
            <AnimatePresence>
              {filteredAssignments.map((a) => {
                const pct = a.totalPanchayats > 0 ? Math.round((a.visitedPanchayats / a.totalPanchayats) * 100) : 0;
                return (
                  <motion.div
                    key={a.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="card"
                    style={{ borderLeft: `4px solid ${a.status === 'Active' ? 'var(--color-primary-500)' : a.status === 'Completed' ? '#10b981' : '#94a3b8'}` }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                      <div>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '1rem' }}>{a.agentName}</div>
                        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{a.block}, {a.district}</div>
                      </div>
                      <span
                        className="badge"
                        style={{
                          background: a.status === 'Active' ? 'rgba(99,102,241,0.15)' : a.status === 'Completed' ? 'rgba(16,185,129,0.15)' : 'rgba(148,163,184,0.15)',
                          color: a.status === 'Active' ? 'var(--color-primary-600)' : a.status === 'Completed' ? '#10b981' : '#64748b',
                        }}
                      >
                        {a.status}
                      </span>
                    </div>

                    <div style={{ marginBottom: '0.75rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                        <span>Panchayats visited</span>
                        <span>{a.visitedPanchayats} / {a.totalPanchayats} ({pct}%)</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-input)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--color-primary-500)', transition: 'width 0.3s' }} />
                      </div>
                    </div>

                    {a.notes && <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>{a.notes}</p>}

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        Assigned {new Date(a.assignedAt).toLocaleDateString('en-GB')}
                        {a.completedAt ? ` · Completed ${new Date(a.completedAt).toLocaleDateString('en-GB')}` : ''}
                      </span>
                      {a.status === 'Active' && (
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => handleStatusChange(a.id, 'Completed')}>✅ Mark Complete</button>
                          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-danger)' }} onClick={() => handleStatusChange(a.id, 'Cancelled')}>✖ Cancel</button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  );
}
