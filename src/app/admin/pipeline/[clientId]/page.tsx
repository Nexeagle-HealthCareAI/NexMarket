'use client';

import React, { useState, useEffect, use } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useAgentStore } from '@/store/agent-store';
import { getAdminContact, getContactHistory, getPanchayats, updateAdminContact, uploadPhoto, type AdminContactDto, type ContactHistoryEntryDto, type PanchayatDto } from '@/lib/sync/api-client';

type ContactProfile = AdminContactDto;

const RELATIONS = ['Unknown', 'Supporter', 'Neutral', 'Opponent', 'Core Member'];

export default function ContactProfilePage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = use(params);
  const agentId = useAgentStore((s) => s.agentId);

  const [contact, setContact] = useState<ContactProfile | null>(null);
  const [panchayat, setPanchayat] = useState<PanchayatDto | null>(null);
  const [allPanchayats, setAllPanchayats] = useState<PanchayatDto[]>([]);
  const [history, setHistory] = useState<ContactHistoryEntryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editPanchayatId, setEditPanchayatId] = useState('');
  const [isEditingPersonal, setIsEditingPersonal] = useState(false);

  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError('');
      try {
        const [contactDto, panchayats, historyEntries] = await Promise.all([
          getAdminContact(clientId),
          getPanchayats(),
          getContactHistory(clientId),
        ]);
        if (cancelled) return;

        const loaded: ContactProfile = { ...contactDto };
        setContact(loaded);
        setAllPanchayats(panchayats);
        setPanchayat(panchayats.find(p => p.id === contactDto.panchayatId) ?? null);
        setHistory(historyEntries);
        setEditName(loaded.name || '');
        setEditPhone(loaded.phone || '');
        setEditPanchayatId(loaded.panchayatId || '');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load contact.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [clientId, agentId]);

  const handleSavePersonal = async () => {
    if (!contact || !agentId) return;
    try {
      const saved = await updateAdminContact(contact.clientId, {
        name: editName,
        phone: editPhone,
        panchayatId: editPanchayatId
      });
      setContact({ ...contact, ...saved });
      setPanchayat(allPanchayats.find(p => p.id === saved.panchayatId) ?? null);
      setIsEditingPersonal(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save personal details.');
    }
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !contact) return;

    setUploadingPhoto(true);
    try {
      const { url } = await uploadPhoto(file);
      const saved = await updateAdminContact(contact.clientId, { photoUrl: url });
      setContact({ ...contact, photoUrl: saved.photoUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload photo.');
    } finally {
      setUploadingPhoto(false);
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
    <div style={{ paddingBottom: '3rem', minWidth: 0, width: '100%' }}>
      {/* Unified Header Card */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '1.5rem 2rem', marginBottom: '2rem', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
        
        {/* Top Header Row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '2rem' }}>
          <Link
            href="/admin/pipeline"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '40px', height: '40px', background: '#f8fafc', borderRadius: '50%', border: '1px solid #e2e8f0', color: '#64748b', cursor: 'pointer', textDecoration: 'none', transition: 'all 0.2s', flexShrink: 0 }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
          </Link>
          
          <div style={{ position: 'relative', width: '72px', height: '72px', borderRadius: '50%', border: '3px solid white', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', overflow: 'hidden', background: '#f1f5f9', flexShrink: 0, cursor: 'pointer' }} onClick={() => fileInputRef.current?.click()}>
            {contact.photoUrl ? (
              <img src={contact.photoUrl} alt={contact.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '1.75rem', fontWeight: 700 }}>
                {editName ? editName.charAt(0).toUpperCase() : contact.name.charAt(0).toUpperCase()}
              </div>
            )}
            {uploadingPhoto && (
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 16, height: 16, border: '2px solid #4f46e5', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
              </div>
            )}
            <input type="file" ref={fileInputRef} onChange={handlePhotoChange} accept="image/*" style={{ display: 'none' }} />
          </div>

          <div style={{ flex: 1, minWidth: '250px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                {isEditingPersonal ? (
                  <input 
                    value={editName} 
                    onChange={(e) => setEditName(e.target.value)} 
                    style={{ margin: '0 0 0.25rem 0', fontSize: '1.75rem', fontWeight: 800, color: '#0f172a', padding: '0.25rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', width: '300px' }} 
                    placeholder="Contact Name"
                  />
                ) : (
                  <h1 style={{ margin: '0 0 0.25rem 0', fontSize: '1.75rem', fontWeight: 800, color: '#0f172a' }}>{contact.name}</h1>
                )}
                <p style={{ margin: 0, color: '#64748b', fontWeight: 500, fontSize: '0.95rem' }}>ID: {contact.clientId}</p>
              </div>

              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <span style={{ background: '#4f46e520', color: '#4f46e5', padding: '0.5rem 1rem', borderRadius: '20px', fontWeight: 700, fontSize: '0.9rem' }}>
                  {contact.status}
                </span>
                
                {!isEditingPersonal ? (
                  <button onClick={() => setIsEditingPersonal(true)} style={{ background: 'white', border: '1px solid #cbd5e1', padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600, color: '#475569', cursor: 'pointer', transition: 'all 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                    Edit Profile
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button onClick={() => {
                      setIsEditingPersonal(false);
                      setEditName(contact.name || '');
                      setEditPhone(contact.phone || '');
                      setEditPanchayatId(contact.panchayatId || '');
                    }} style={{ background: 'white', border: '1px solid #cbd5e1', padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600, color: '#475569', cursor: 'pointer' }}>Cancel</button>
                    <button onClick={handleSavePersonal} style={{ background: '#4f46e5', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 4px rgba(79,70,229,0.3)' }}>Save</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Personal Details Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '2rem', borderTop: '1px solid #e2e8f0', paddingTop: '1.5rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Phone Number</label>
            {isEditingPersonal ? (
              <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', fontWeight: 600 }} placeholder="Phone" />
            ) : (
              <div style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a' }}>{contact.phone || 'N/A'}</div>
            )}
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Role</label>
            <div style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a', textTransform: 'capitalize' }}>{contact.role.replace('_', ' ')}</div>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Panchayat</label>
            {isEditingPersonal ? (
              <select value={editPanchayatId} onChange={(e) => setEditPanchayatId(e.target.value)} style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', fontWeight: 600, color: '#0f172a' }}>
                <option value="">Select Panchayat...</option>
                {allPanchayats.map(p => (
                  <option key={p.id} value={p.id}>{p.name}, {p.block} ({p.district})</option>
                ))}
              </select>
            ) : (
              <div style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a' }}>
                {panchayat ? `${panchayat.name}, ${panchayat.block} (${panchayat.district})` : contact.panchayatId}
              </div>
            )}
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Assigned Agent</label>
            <div style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a' }}>{contact.agentId}</div>
          </div>
        </div>
      </motion.div>

      {/* Full Width Table */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', maxWidth: '100%' }}>
        <div style={{ padding: '1.25rem 1.5rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>Communication Timeline</h2>
        </div>
        <div style={{ padding: '0', overflowX: 'auto', maxWidth: '100%' }}>
          {history.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b', fontStyle: 'italic' }}>No history available.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '1000px' }}>
              <thead style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                <tr>
                  <th style={{ padding: '1rem 1.5rem', fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Date & Time</th>
                  <th style={{ padding: '1rem 1.5rem', fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Agent</th>
                  <th style={{ padding: '1rem 1.5rem', fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Stage Update</th>
                  <th style={{ padding: '1rem 1.5rem', fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Follow-up</th>
                  <th style={{ padding: '1rem 1.5rem', fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Comments</th>
                  <th style={{ padding: '1rem 1.5rem', fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Issues</th>
                  <th style={{ padding: '1rem 1.5rem', fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Conflicts</th>
                </tr>
              </thead>
              <tbody>
                {history.slice().reverse().map((h) => (
                  <tr key={h.id} style={{ borderBottom: '1px solid #e2e8f0', background: 'white', transition: 'background 0.2s', cursor: 'default' }} onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={(e) => e.currentTarget.style.background = 'white'}>
                    <td style={{ padding: '1rem 1.5rem', fontSize: '0.85rem', color: '#64748b', fontWeight: 600 }}>
                      <div style={{ color: '#0f172a' }}>{new Date(h.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                      <div style={{ fontSize: '0.75rem' }}>{new Date(h.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
                    </td>
                    <td style={{ padding: '1rem 1.5rem', fontSize: '0.9rem', fontWeight: 700, color: '#0f172a' }}>
                      {h.updatedBy}
                    </td>
                    <td style={{ padding: '1rem 1.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.8rem', color: '#64748b', background: '#f1f5f9', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>{h.previousStatus}</span>
                        <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>→</span>
                        <span style={{ fontSize: '0.8rem', color: '#4f46e5', fontWeight: 700, background: '#e0e7ff', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>{h.newStatus}</span>
                      </div>
                    </td>
                    <td style={{ padding: '1rem 1.5rem', fontSize: '0.85rem', color: '#0ea5e9', fontWeight: 600 }}>
                      {h.followUpDate ? new Date(h.followUpDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}
                    </td>
                    <td style={{ padding: '1rem 1.5rem', fontSize: '0.9rem', color: '#334155', maxWidth: '300px', whiteSpace: 'pre-wrap' }}>
                      {h.comments || '-'}
                    </td>
                    <td style={{ padding: '1rem 1.5rem', fontSize: '0.9rem', color: '#ef4444', fontWeight: 500, maxWidth: '200px', whiteSpace: 'pre-wrap' }}>
                      {h.complaints || '-'}
                    </td>
                    <td style={{ padding: '1rem 1.5rem', fontSize: '0.9rem', color: '#c2410c', fontWeight: 500, maxWidth: '200px', whiteSpace: 'pre-wrap' }}>
                      {h.conflicts || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </motion.div>
    </div>
  );
}
