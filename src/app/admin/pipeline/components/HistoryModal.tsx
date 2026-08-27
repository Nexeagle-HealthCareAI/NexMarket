import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getContactHistory, type AdminContactDto, type ContactHistoryEntryDto } from '@/lib/sync/api-client';

export function HistoryModal({ contact, onClose }: { contact: AdminContactDto, onClose: () => void }) {
  const [history, setHistory] = useState<ContactHistoryEntryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const h = await getContactHistory(contact.clientId);
        if (!cancelled) setHistory(h);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load history.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [contact.clientId]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <motion.div 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        exit={{ opacity: 0 }} 
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)' }} 
      />
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }} 
        animate={{ opacity: 1, scale: 1 }} 
        exit={{ opacity: 0, scale: 0.95 }}
        style={{ 
          position: 'relative', background: 'white', padding: '2rem', 
          borderRadius: '16px', width: '100%', maxWidth: 600, 
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          maxHeight: '85vh', display: 'flex', flexDirection: 'column'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>Follow-up History</h2>
            <p style={{ color: '#64748b', margin: 0, fontSize: '0.85rem' }}>{contact.name} ({contact.phone})</p>
          </div>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748b', transition: 'background 0.2s' }}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, paddingRight: '0.5rem' }}>
          {loading ? (
            <p style={{ color: '#64748b', textAlign: 'center', padding: '2rem' }}>Loading history...</p>
          ) : error ? (
            <p style={{ color: '#b91c1c', textAlign: 'center', padding: '2rem' }}>{error}</p>
          ) : history.length === 0 ? (
            <p style={{ color: '#64748b', textAlign: 'center', padding: '2rem' }}>No history recorded.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Reverse history to show newest first */}
              {[...history].reverse().map((h, i) => (
                <div key={h.id} style={{ display: 'flex', gap: '1rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#4f46e5', marginTop: '0.25rem' }} />
                    {i !== history.length - 1 && <div style={{ width: 2, flex: 1, background: '#e2e8f0', marginTop: '0.5rem' }} />}
                  </div>
                  <div style={{ flex: 1, background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <span style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.9rem' }}>{h.updatedBy}</span>
                      <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>
                        {new Date(h.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8', textDecoration: 'line-through' }}>{h.previousStatus}</span>
                      <span style={{ fontSize: '0.8rem' }}>➔</span>
                      <span style={{ fontSize: '0.75rem', color: '#4f46e5', fontWeight: 700, background: '#e0e7ff', padding: '0.1rem 0.5rem', borderRadius: '4px' }}>{h.newStatus}</span>
                      {h.followUpDate && (
                        <span style={{ fontSize: '0.75rem', color: '#0ea5e9', fontWeight: 600, background: '#e0f2fe', padding: '0.1rem 0.5rem', borderRadius: '4px' }}>
                          📅 {new Date(h.followUpDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {h.comments && (
                        <p style={{ margin: 0, fontSize: '0.85rem', color: '#334155', background: 'white', padding: '0.75rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                          <strong style={{ display: 'block', fontSize: '0.7rem', textTransform: 'uppercase', color: '#64748b', marginBottom: '0.1rem' }}>Comment</strong>
                          {h.comments}
                        </p>
                      )}
                      {h.complaints && (
                        <p style={{ margin: 0, fontSize: '0.85rem', color: '#b91c1c', background: '#fef2f2', padding: '0.75rem', borderRadius: '8px', border: '1px solid #fecaca' }}>
                          <strong style={{ display: 'block', fontSize: '0.7rem', textTransform: 'uppercase', color: '#ef4444', marginBottom: '0.1rem' }}>Issue</strong>
                          {h.complaints}
                        </p>
                      )}
                      {h.conflicts && (
                        <p style={{ margin: 0, fontSize: '0.85rem', color: '#c2410c', background: '#fff7ed', padding: '0.75rem', borderRadius: '8px', border: '1px solid #fed7aa' }}>
                          <strong style={{ display: 'block', fontSize: '0.7rem', textTransform: 'uppercase', color: '#f97316', marginBottom: '0.1rem' }}>Conflict</strong>
                          {h.conflicts}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
