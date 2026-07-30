'use client';

import React, { useState, useEffect, use } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useAgentStore } from '@/store/agent-store';
import { getAdminContact, getContactHistory, getPanchayats, updateAdminContact, type AdminContactDto, type ContactHistoryEntryDto, type PanchayatDto } from '@/lib/sync/api-client';

type ContactProfile = AdminContactDto;

const RELATIONS = ['Unknown', 'Supporter', 'Neutral', 'Opponent', 'Core Member'];

export default function ContactProfilePage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = use(params);
  const token = useAgentStore((s) => s.jwtToken);

  const [contact, setContact] = useState<ContactProfile | null>(null);
  const [panchayat, setPanchayat] = useState<PanchayatDto | null>(null);
  const [history, setHistory] = useState<ContactHistoryEntryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Edit states for engagement
  const [editRelation, setEditRelation] = useState('Unknown');
  const [editComplaints, setEditComplaints] = useState('');
  const [editConflicts, setEditConflicts] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError('');
      try {
        const [contactDto, panchayats, historyEntries] = await Promise.all([
          getAdminContact(token, clientId),
          getPanchayats(token),
          getContactHistory(token, clientId),
        ]);
        if (cancelled) return;

        const loaded: ContactProfile = { ...contactDto };
        setContact(loaded);
        setPanchayat(panchayats.find(p => p.id === contactDto.panchayatId) ?? null);
        setHistory(historyEntries);
        setEditRelation(loaded.relation || 'Unknown');
        setEditComplaints(loaded.complaints || '');
        setEditConflicts(loaded.conflicts || '');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load contact.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [clientId, token]);

  const handleSave = async () => {
    if (!contact || !token) return;
    try {
      const saved = await updateAdminContact(token, contact.clientId, {
        status: contact.status,
        followUpDate: contact.followUpDate,
        comments: contact.comments ?? undefined,
        relation: editRelation,
        complaints: editComplaints,
        conflicts: editConflicts
      });
      setContact({ ...contact, ...saved });
      setIsEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save engagement details.');
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#64748b' }}>
        Loading Profile...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#ef4444' }}>{error}</div>
    );
  }

  if (!contact) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#ef4444' }}>Contact not found.</div>
    );
  }

  return (
    <div style={{ paddingBottom: '3rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <Link
          href="/admin/pipeline"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '40px', height: '40px', background: 'white', borderRadius: '50%', border: '1px solid #e2e8f0', color: '#64748b', cursor: 'pointer', textDecoration: 'none', transition: 'all 0.2s' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        </Link>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 800, color: '#0f172a' }}>{contact.name}</h1>
          <p style={{ margin: 0, color: '#64748b', fontWeight: 500, fontSize: '0.95rem' }}>ID: {contact.clientId} • {contact.role.replace('_', ' ').toUpperCase()}</p>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <span style={{ background: '#4f46e520', color: '#4f46e5', padding: '0.5rem 1rem', borderRadius: '20px', fontWeight: 700, fontSize: '0.9rem' }}>
            {contact.status}
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.5rem', alignItems: 'start' }}>

        {/* Left Column: Personal Info */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
          <div style={{ padding: '1.25rem 1.5rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>Personal Details</h2>
          </div>
          <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Phone Number</label>
              <div style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a' }}>{contact.phone || 'N/A'}</div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Role</label>
              <div style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a', textTransform: 'capitalize' }}>{contact.role.replace('_', ' ')}</div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Panchayat</label>
              <div style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a' }}>
                {panchayat ? `${panchayat.name}, ${panchayat.block} (${panchayat.district})` : contact.panchayatId}
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Assigned Agent</label>
              <div style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a' }}>{contact.agentId}</div>
            </div>
          </div>
        </motion.div>

        {/* Middle Column: Engagement Insights */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
          <div style={{ padding: '1.25rem 1.5rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>Engagement Insights</h2>
            {!isEditing ? (
              <button onClick={() => setIsEditing(true)} style={{ background: 'transparent', border: '1px solid #cbd5e1', padding: '0.25rem 0.75rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>Edit</button>
            ) : (
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={() => setIsEditing(false)} style={{ background: 'transparent', border: '1px solid #cbd5e1', padding: '0.25rem 0.75rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                <button onClick={handleSave} style={{ background: '#4f46e5', color: 'white', border: 'none', padding: '0.25rem 0.75rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>Save</button>
              </div>
            )}
          </div>
          <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Relationship with Us</label>
              {isEditing ? (
                <select value={editRelation} onChange={(e) => setEditRelation(e.target.value)} style={{ width: '100%', padding: '0.75rem', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', fontWeight: 600, color: '#0f172a' }}>
                  {RELATIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              ) : (
                <div style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a' }}>{contact.relation || 'Unknown'}</div>
              )}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Complaints / Issues</label>
              {isEditing ? (
                <textarea rows={3} value={editComplaints} onChange={(e) => setEditComplaints(e.target.value)} style={{ width: '100%', padding: '0.75rem', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', resize: 'vertical', fontWeight: 500, color: '#0f172a' }} />
              ) : (
                <div style={{ fontSize: '0.95rem', fontWeight: 500, color: '#334155', minHeight: '60px', background: '#f8fafc', padding: '0.75rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  {contact.complaints || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>No complaints recorded.</span>}
                </div>
              )}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Conflicts</label>
              {isEditing ? (
                <textarea rows={3} value={editConflicts} onChange={(e) => setEditConflicts(e.target.value)} style={{ width: '100%', padding: '0.75rem', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', resize: 'vertical', fontWeight: 500, color: '#0f172a' }} />
              ) : (
                <div style={{ fontSize: '0.95rem', fontWeight: 500, color: '#334155', minHeight: '60px', background: '#f8fafc', padding: '0.75rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                  {contact.conflicts || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>No conflicts recorded.</span>}
                </div>
              )}
            </div>
          </div>
        </motion.div>

        {/* Right Column: Timeline / History */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
          <div style={{ padding: '1.25rem 1.5rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>Communication Timeline</h2>
          </div>
          <div style={{ padding: '1.5rem', maxHeight: '500px', overflowY: 'auto' }}>
            {history.length === 0 ? (
              <p style={{ color: '#64748b', fontStyle: 'italic', margin: 0 }}>No history available.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'relative' }}>
                {/* Vertical Line connecting timeline */}
                <div style={{ position: 'absolute', left: '16px', top: '10px', bottom: '10px', width: '2px', background: '#e2e8f0', zIndex: 0 }} />

                {history.slice().reverse().map((h) => (
                  <div key={h.id} style={{ display: 'flex', gap: '1rem', position: 'relative', zIndex: 1 }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#4f46e5', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.7rem', flexShrink: 0, border: '4px solid white' }}>
                      {h.updatedBy.charAt(0)}
                    </div>
                    <div style={{ flex: 1, background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                        <span style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.9rem' }}>{h.updatedBy}</span>
                        <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>
                          {new Date(h.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} at {new Date(h.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, background: '#e2e8f0', padding: '0.1rem 0.5rem', borderRadius: '4px' }}>{h.previousStatus}</span>
                        <span style={{ color: '#94a3b8' }}>→</span>
                        <span style={{ fontSize: '0.75rem', color: '#4f46e5', fontWeight: 700, background: '#e0e7ff', padding: '0.1rem 0.5rem', borderRadius: '4px' }}>{h.newStatus}</span>
                        {h.followUpDate && (
                          <span style={{ fontSize: '0.75rem', color: '#0ea5e9', fontWeight: 600, background: '#e0f2fe', padding: '0.1rem 0.5rem', borderRadius: '4px' }}>
                            📅 {new Date(h.followUpDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {h.comments && (
                          <p style={{ margin: 0, fontSize: '0.9rem', color: '#334155', background: 'white', padding: '0.75rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                            <strong style={{ display: 'block', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', marginBottom: '0.25rem' }}>Comment</strong>
                            {h.comments}
                          </p>
                        )}
                        {h.complaints && (
                          <p style={{ margin: 0, fontSize: '0.9rem', color: '#b91c1c', background: '#fef2f2', padding: '0.75rem', borderRadius: '8px', border: '1px solid #fecaca' }}>
                            <strong style={{ display: 'block', fontSize: '0.75rem', textTransform: 'uppercase', color: '#ef4444', marginBottom: '0.25rem' }}>Complaint / Issue</strong>
                            {h.complaints}
                          </p>
                        )}
                        {h.conflicts && (
                          <p style={{ margin: 0, fontSize: '0.9rem', color: '#c2410c', background: '#fff7ed', padding: '0.75rem', borderRadius: '8px', border: '1px solid #fed7aa' }}>
                            <strong style={{ display: 'block', fontSize: '0.75rem', textTransform: 'uppercase', color: '#f97316', marginBottom: '0.25rem' }}>Conflict</strong>
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
    </div>
  );
}
