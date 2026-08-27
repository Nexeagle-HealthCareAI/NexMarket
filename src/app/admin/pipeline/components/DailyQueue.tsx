import React from 'react';
import type { AdminContactDto, PanchayatDto } from '@/lib/sync/api-client';

export interface DailyQueueProps {
  contacts: AdminContactDto[];
  queueGoal: number;
  setQueueGoal: (goal: number) => void;
  setPage: (page: number) => void;
  panchayatsData: PanchayatDto[];
  saveContactMutation: { mutate: (args: any) => void };
}

export function DailyQueue({
  contacts,
  queueGoal,
  setQueueGoal,
  setPage,
  panchayatsData,
  saveContactMutation
}: DailyQueueProps) {
  if (contacts.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem 1rem', background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
        <h2 style={{ fontSize: '2rem', fontWeight: 800, color: '#10b981', marginBottom: '1rem' }}>🎉 Queue Completed!</h2>
        <p style={{ color: '#64748b', fontSize: '1.1rem' }}>You have reached out to all queued contacts for today. Great job!</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white', padding: '1rem 1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>Today's Queue</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
            <p style={{ margin: 0, color: '#64748b', fontSize: '0.85rem', fontWeight: 600 }}>{contacts.length} / {queueGoal} Remaining</p>
            <div style={{ width: '100px', height: '6px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ width: `${Math.max(0, 100 - (contacts.length / queueGoal) * 100)}%`, height: '100%', background: '#10b981', transition: 'width 0.3s ease' }} />
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#475569' }}>Daily Goal:</label>
          <select
            value={queueGoal}
            onChange={(e) => { setQueueGoal(Number(e.target.value)); setPage(1); }}
            style={{ padding: '0.5rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 600, outline: 'none' }}
          >
            <option value={50}>50 Contacts</option>
            <option value={100}>100 Contacts</option>
            <option value={200}>200 Contacts</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {contacts.map(c => {
          const p = panchayatsData.find(p => p.id === c.panchayatId);
          const pInfo = p || { name: 'Unknown', block: 'Unknown' };
          return (
            <div key={c.clientId} style={{ background: 'white', borderRadius: '12px', padding: '1.5rem', border: '1px solid #e2e8f0', display: 'flex', flexWrap: 'wrap', gap: '1.5rem', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
              <div>
                <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.2rem', fontWeight: 800, color: '#0f172a' }}>{c.name}</h3>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.9rem', color: '#475569', fontWeight: 600 }}>📞 {c.phone}</span>
                  <span style={{ fontSize: '0.9rem', color: '#64748b' }}>📍 {pInfo.name}, {pInfo.block}</span>
                  <span style={{ fontSize: '0.8rem', background: '#f1f5f9', padding: '0.1rem 0.5rem', borderRadius: '4px', color: '#64748b', fontWeight: 600 }}>Status: {c.status}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button 
                  onClick={() => saveContactMutation.mutate({ clientId: c.clientId, update: { status: 'Contacted', clearFollowUpDate: true } })}
                  style={{ background: '#10b981', color: 'white', border: 'none', padding: '0.75rem 1.5rem', borderRadius: '8px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: '0 2px 4px rgba(16, 185, 129, 0.2)', transition: 'background 0.2s' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#059669'}
                  onMouseLeave={(e) => e.currentTarget.style.background = '#10b981'}
                >
                  ✅ Contacted
                </button>
                <button 
                  onClick={() => {
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    saveContactMutation.mutate({ clientId: c.clientId, update: { status: 'FollowUp', followUpDate: tomorrow.toISOString() } });
                  }}
                  style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '0.75rem 1.5rem', borderRadius: '8px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: '0 2px 4px rgba(59, 130, 246, 0.2)', transition: 'background 0.2s' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#2563eb'}
                  onMouseLeave={(e) => e.currentTarget.style.background = '#3b82f6'}
                >
                  📅 Call Tomorrow
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
