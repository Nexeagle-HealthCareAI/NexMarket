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
    <div style={{ paddingBottom: '3rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <Link
          href="/admin/pipeline"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '40px', height: '40px', background: 'white', borderRadius: '50%', border: '1px solid #e2e8f0', color: '#64748b', cursor: 'pointer', textDecoration: 'none', transition: 'all 0.2s' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        </Link>
        <div style={{ position: 'relative', width: '64px', height: '64px', borderRadius: '50%', border: '2px solid #e2e8f0', overflow: 'hidden', background: '#f1f5f9', flexShrink: 0, cursor: 'pointer' }} onClick={() => fileInputRef.current?.click()}>
          {contact.photoUrl ? (
            <img src={contact.photoUrl} alt={contact.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '1.5rem', fontWeight: 700 }}>
              {contact.name.charAt(0).toUpperCase()}
            </div>
          )}
          {uploadingPhoto && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 16, height: 16, border: '2px solid #4f46e5', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            </div>
          )}
          <input type="file" ref={fileInputRef} onChange={handlePhotoChange} accept="image/*" style={{ display: 'none' }} />
        </div>
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1.5rem', alignItems: 'start' }}>

        {/* Left Column: Personal Info */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
          <div style={{ padding: '1.25rem 1.5rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>Personal Details</h2>
            {!isEditingPersonal ? (
              <button onClick={() => setIsEditingPersonal(true)} style={{ background: 'transparent', border: '1px solid #cbd5e1', padding: '0.25rem 0.75rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>Edit</button>
            ) : (
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={() => {
                  setIsEditingPersonal(false);
                  setEditName(contact.name || '');
                  setEditPhone(contact.phone || '');
                  setEditPanchayatId(contact.panchayatId || '');
                }} style={{ background: 'transparent', border: '1px solid #cbd5e1', padding: '0.25rem 0.75rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                <button onClick={handleSavePersonal} style={{ background: '#4f46e5', color: 'white', border: 'none', padding: '0.25rem 0.75rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>Save</button>
              </div>
            )}
          </div>
          <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Name</label>
              {isEditingPersonal ? (
                <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none' }} />
              ) : (
                <div style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a' }}>{contact.name || 'N/A'}</div>
              )}
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Phone Number</label>
              {isEditingPersonal ? (
                <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none' }} />
              ) : (
                <div style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a' }}>{contact.phone || 'N/A'}</div>
              )}
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Role</label>
              <div style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a', textTransform: 'capitalize' }}>{contact.role.replace('_', ' ')}</div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Panchayat</label>
              {isEditingPersonal ? (
                <select value={editPanchayatId} onChange={(e) => setEditPanchayatId(e.target.value)} style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none' }}>
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
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Assigned Agent</label>
              <div style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a' }}>{contact.agentId}</div>
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
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '800px' }}>
                  <thead style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                    <tr>
                      <th style={{ padding: '0.75rem', fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Date & Time</th>
                      <th style={{ padding: '0.75rem', fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Agent</th>
                      <th style={{ padding: '0.75rem', fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Stage Update</th>
                      <th style={{ padding: '0.75rem', fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Follow-up</th>
                      <th style={{ padding: '0.75rem', fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Comments</th>
                      <th style={{ padding: '0.75rem', fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Issues</th>
                      <th style={{ padding: '0.75rem', fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Conflicts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.slice().reverse().map((h) => (
                      <tr key={h.id} style={{ borderBottom: '1px solid #e2e8f0', background: 'white' }}>
                        <td style={{ padding: '0.75rem', fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
                          <div>{new Date(h.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                          <div style={{ fontSize: '0.7rem' }}>{new Date(h.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
                        </td>
                        <td style={{ padding: '0.75rem', fontSize: '0.85rem', fontWeight: 700, color: '#0f172a' }}>
                          {h.updatedBy}
                        </td>
                        <td style={{ padding: '0.75rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.7rem', color: '#64748b', background: '#f1f5f9', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>{h.previousStatus}</span>
                            <span style={{ color: '#94a3b8', fontSize: '0.7rem' }}>→</span>
                            <span style={{ fontSize: '0.75rem', color: '#4f46e5', fontWeight: 700, background: '#e0e7ff', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>{h.newStatus}</span>
                          </div>
                        </td>
                        <td style={{ padding: '0.75rem', fontSize: '0.8rem', color: '#0ea5e9', fontWeight: 600 }}>
                          {h.followUpDate ? new Date(h.followUpDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}
                        </td>
                        <td style={{ padding: '0.75rem', fontSize: '0.85rem', color: '#334155', maxWidth: '200px', whiteSpace: 'pre-wrap' }}>
                          {h.comments || '-'}
                        </td>
                        <td style={{ padding: '0.75rem', fontSize: '0.85rem', color: '#b91c1c', fontWeight: 500, maxWidth: '150px', whiteSpace: 'pre-wrap' }}>
                          {h.complaints || '-'}
                        </td>
                        <td style={{ padding: '0.75rem', fontSize: '0.85rem', color: '#c2410c', fontWeight: 500, maxWidth: '150px', whiteSpace: 'pre-wrap' }}>
                          {h.conflicts || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </motion.div>

      </div>
    </div>
  );
}
