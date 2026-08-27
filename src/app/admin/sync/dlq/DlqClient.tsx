'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/db';
import type { SyncDeadLetterQueueEntry } from '@/lib/db/schema';
import { useLiveQuery } from 'dexie-react-hooks';
import { retryDeadLetters } from '@/lib/sync/outbox';

export default function DlqClient() {
  const dlqItems = useLiveQuery(() => db.syncDeadLetterQueue.toArray()) || [];
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState('');

  const handleRetryAll = async () => {
    setRetrying(true);
    setError('');
    try {
      const count = await retryDeadLetters();
      alert(`Successfully moved ${count} items back to the sync queue.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to retry items.');
    } finally {
      setRetrying(false);
    }
  };

  const handleDiscard = async (localId?: number) => {
    if (!localId) return;
    if (!confirm('Are you sure you want to permanently discard this sync item? This cannot be undone.')) return;
    try {
      await db.syncDeadLetterQueue.delete(localId);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to discard item.');
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
      
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1>Dead Letter Queue (DLQ)</h1>
          <p style={{ color: 'var(--text-muted)' }}>Manage sync items that failed permanently on this device.</p>
        </div>
        <div>
          <button 
            className="btn btn-primary" 
            onClick={handleRetryAll} 
            disabled={retrying || dlqItems.length === 0}
          >
            {retrying ? 'Retrying...' : `🔄 Retry All (${dlqItems.length})`}
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: '1.5rem', borderLeft: '4px solid var(--color-danger)', background: 'rgba(239,68,68,0.05)' }}>
          <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem' }}>{error}</p>
        </div>
      )}

      {dlqItems.length === 0 ? (
        <div className="empty-state" style={{ marginTop: '2rem' }}>
          <div className="empty-state-icon">✅</div>
          <h2>Queue Empty</h2>
          <p>There are no permanently failed sync items on this device.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="responsive-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'var(--surface-hover)', borderBottom: '1px solid var(--surface-border)' }}>
                  <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Entity Type</th>
                  <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Error Message</th>
                  <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Failed At</th>
                  <th style={{ padding: '1rem', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {dlqItems.map((item) => (
                  <tr key={item.localId} style={{ borderBottom: '1px solid var(--surface-border)' }}>
                    <td data-label="Entity Type" style={{ padding: '1rem' }}>
                      <span className="badge badge-pending">{item.entityType.toUpperCase()}</span>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem', fontFamily: 'monospace' }}>
                        ID: {item.clientId.substring(0, 8)}...
                      </div>
                    </td>
                    <td data-label="Error Message" style={{ padding: '1rem', color: 'var(--color-danger)', fontSize: '0.85rem', fontWeight: 500, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.errorMessage || 'Unknown Error'}
                    </td>
                    <td data-label="Failed At" style={{ padding: '1rem', fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                      {new Date(item.lastAttemptAt).toLocaleString('en-GB')}
                    </td>
                    <td data-label="Actions" style={{ padding: '1rem', textAlign: 'right' }}>
                      <button 
                        className="btn btn-sm btn-ghost" 
                        style={{ color: 'var(--color-danger)' }}
                        onClick={() => handleDiscard(item.localId)}
                      >
                        🗑️ Discard
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
