'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AdminContactDto, PanchayatDto, ContactUpdateRequest } from '@/lib/sync/api-client';

const STATUSES = ['Lead', 'Contacted', 'Engaged', 'Converted', 'Won', 'Lost'];

interface EditContactDrawerProps {
  contact: AdminContactDto;
  panchayats: PanchayatDto[];
  isOpen: boolean;
  onClose: () => void;
  onSave: (updated: ContactUpdateRequest) => void;
}

export default function EditContactDrawer({ contact, panchayats, isOpen, onClose, onSave }: EditContactDrawerProps) {
  const [editName, setEditName] = useState(contact.name || '');
  const [editPhone, setEditPhone] = useState(contact.phone || '');
  const [editPanchayatId, setEditPanchayatId] = useState(contact.panchayatId || '');
  const [editStatus, setEditStatus] = useState(contact.status || 'Lead');
  const [editFollowUp, setEditFollowUp] = useState(contact.followUpDate ? new Date(contact.followUpDate).toISOString().split('T')[0] : '');
  const [editComments, setEditComments] = useState(contact.comments || '');
  const [editComplaints, setEditComplaints] = useState(contact.complaints || '');
  const [editConflicts, setEditConflicts] = useState(contact.conflicts || '');

  const hasChanges = 
    editName !== (contact.name || '') ||
    editPhone !== (contact.phone || '') ||
    editPanchayatId !== (contact.panchayatId || '') ||
    editStatus !== contact.status || 
    editFollowUp !== (contact.followUpDate ? new Date(contact.followUpDate).toISOString().split('T')[0] : '') ||
    editComments !== (contact.comments || '') ||
    editComplaints !== (contact.complaints || '') ||
    editConflicts !== (contact.conflicts || '');

  const handleSave = () => {
    onSave({
      name: editName,
      phone: editPhone,
      panchayatId: editPanchayatId,
      status: editStatus,
      followUpDate: editFollowUp ? new Date(editFollowUp).toISOString() : null,
      comments: editComments,
      complaints: editComplaints,
      conflicts: editConflicts
    });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', justifyContent: 'flex-end' }}>
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            onClick={onClose}
            style={{ position: 'absolute', inset: 0, background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(2px)' }} 
          />
          
          <motion.div 
            initial={{ x: '100%' }} 
            animate={{ x: 0 }} 
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            style={{ 
              position: 'relative', background: 'white', width: '100%', maxWidth: 450, 
              height: '100%', boxShadow: '-10px 0 25px rgba(0, 0, 0, 0.1)',
              display: 'flex', flexDirection: 'column'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', padding: '1.5rem', background: '#f8fafc' }}>
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>Update Contact</h2>
                <p style={{ color: '#64748b', margin: 0, fontSize: '0.85rem' }}>{contact.name} ({contact.phone || 'No Phone'})</p>
              </div>
              <button onClick={onClose} style={{ background: 'white', border: '1px solid #e2e8f0', width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748b', transition: 'background 0.2s' }}>✕</button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Name</label>
                <input 
                  value={editName} 
                  onChange={e => setEditName(e.target.value)}
                  placeholder="Contact Name"
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', background: 'white', fontWeight: 600, fontSize: '0.9rem', color: '#0f172a', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Phone</label>
                <input 
                  value={editPhone} 
                  onChange={e => setEditPhone(e.target.value)}
                  placeholder="Phone Number"
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', background: 'white', fontWeight: 600, fontSize: '0.9rem', color: '#0f172a', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Panchayat / Location</label>
                <select 
                  value={editPanchayatId} 
                  onChange={e => setEditPanchayatId(e.target.value)}
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', background: 'white', fontWeight: 600, fontSize: '0.9rem', color: '#0f172a', boxSizing: 'border-box' }}
                >
                  <option value="">Select Panchayat...</option>
                  {panchayats.map(p => (
                    <option key={p.id} value={p.id}>{p.name}, {p.block} ({p.district})</option>
                  ))}
                </select>
              </div>

              <div style={{ height: '1px', background: '#e2e8f0', margin: '0.5rem 0' }} />

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Stage (Result)</label>
                <select 
                  value={editStatus} 
                  onChange={e => setEditStatus(e.target.value)}
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', background: 'white', fontWeight: 600, fontSize: '0.9rem', color: '#0f172a', boxSizing: 'border-box' }}
                >
                  {STATUSES.map(col => <option key={col} value={col}>{col}</option>)}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Follow-up Date</label>
                <input 
                  type="date" 
                  value={editFollowUp} 
                  onChange={e => setEditFollowUp(e.target.value)}
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', background: 'white', fontWeight: 600, fontSize: '0.9rem', color: '#0f172a', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Comments / Notes</label>
                <textarea 
                  rows={3}
                  value={editComments} 
                  onChange={e => setEditComments(e.target.value)}
                  placeholder="Add any general notes here..."
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', resize: 'vertical', background: 'white', fontWeight: 500, fontSize: '0.9rem', color: '#0f172a', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Issues / Complaints</label>
                <textarea 
                  rows={3}
                  value={editComplaints} 
                  onChange={e => setEditComplaints(e.target.value)}
                  placeholder="Record any issues..."
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #fecaca', outline: 'none', resize: 'vertical', background: '#fef2f2', fontWeight: 500, fontSize: '0.9rem', color: '#7f1d1d', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#f97316', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Conflicts</label>
                <textarea 
                  rows={3}
                  value={editConflicts} 
                  onChange={e => setEditConflicts(e.target.value)}
                  placeholder="Record any conflicts..."
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #fed7aa', outline: 'none', resize: 'vertical', background: '#fff7ed', fontWeight: 500, fontSize: '0.9rem', color: '#9a3412', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            <div style={{ padding: '1.5rem', borderTop: '1px solid #e2e8f0', background: 'white', display: 'flex', gap: '1rem' }}>
              <button onClick={onClose} style={{ flex: 1, background: 'white', color: '#64748b', border: '1px solid #cbd5e1', padding: '0.75rem', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem' }}>Cancel</button>
              <button onClick={handleSave} disabled={!hasChanges} style={{ flex: 2, background: hasChanges ? '#4f46e5' : '#cbd5e1', color: 'white', border: 'none', padding: '0.75rem', borderRadius: '8px', fontWeight: 600, cursor: hasChanges ? 'pointer' : 'not-allowed', fontSize: '0.9rem' }}>Save Updates</button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
