'use client';

import { useMemo } from 'react';
import { useAgentStore } from '@/store/agent-store';
import { useVisits, useContacts, useShifts, usePanchayats } from '@/lib/db';

export default function HistoryPage() {
  const agentId = useAgentStore((s) => s.agentId);
  const visits = useVisits(agentId ?? undefined);
  const contacts = useContacts(agentId ?? undefined);
  const shifts = useShifts(agentId ?? undefined);
  const panchayats = usePanchayats();

  const panchayatMap = useMemo(() => {
    const map = new Map<string, string>();
    panchayats?.forEach((p) => map.set(p.id, `${p.name} · ${p.block}`));
    return map;
  }, [panchayats]);

  // Group visits by date
  const visitsByDate = useMemo(() => {
    if (!visits) return {};
    return visits.reduce<Record<string, typeof visits>>((acc, v) => {
      const date = v.checkInAt.slice(0, 10);
      (acc[date] ??= []).push(v);
      return acc;
    }, {});
  }, [visits]);

  return (
    <div>
      <div className="page-header">
        <h1>History</h1>
      </div>

      {/* Summary */}
      <div className="grid-cols-responsive-3" style={{ marginBottom: '1.75rem' }}>
        <div className="card" style={{ textAlign: 'center', padding: '0.875rem' }}>
          <p style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--color-primary-400)' }}>{shifts?.length ?? 0}</p>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Shifts</p>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: '0.875rem' }}>
          <p style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--color-success)' }}>{visits?.length ?? 0}</p>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Visits</p>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: '0.875rem' }}>
          <p style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--color-warning)' }}>{contacts?.length ?? 0}</p>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Contacts</p>
        </div>
      </div>

      {/* Visit timeline */}
      <h3 style={{ marginBottom: '0.75rem', color: 'var(--text-secondary)' }}>Visit Timeline</h3>

      {Object.keys(visitsByDate).length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📅</div>
          <p>No visits recorded yet</p>
        </div>
      ) : (
        Object.entries(visitsByDate)
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([date, dayVisits]) => (
            <div key={date} style={{ marginBottom: '1.25rem' }}>
              <p
                style={{
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: '0.5rem',
                }}
              >
                {new Date(date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}
              </p>

              <div className="grid-cols-responsive-2">
                {dayVisits.map((visit) => {
                  const duration = visit.checkOutAt
                    ? Math.round((new Date(visit.checkOutAt).getTime() - new Date(visit.checkInAt).getTime()) / 60000)
                    : null;

                  return (
                    <div key={visit.clientId} className="card" style={{ marginBottom: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                        <div>
                          <p style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                            📍 {panchayatMap.get(visit.panchayatId) ?? 'Unknown'}
                          </p>
                          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                            {new Date(visit.checkInAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                            {visit.checkOutAt && ` → ${new Date(visit.checkOutAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`}
                            {duration !== null && ` · ${duration} min`}
                          </p>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', alignItems: 'flex-end' }}>
                          {!visit.checkOutAt && (
                            <span className="badge badge-pending">No checkout</span>
                          )}
                          {!visit.syncedAt && (
                            <span className="badge badge-pending">Unsynced</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
      )}
    </div>
  );
}
