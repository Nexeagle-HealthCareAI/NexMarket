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
  const initialPanchayat = panchayats.find(p => p.id === contact.panchayatId);
  const [editDistrict, setEditDistrict] = useState(initialPanchayat?.district || '');
  const [editBlock, setEditBlock] = useState(initialPanchayat?.block || '');
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

  const uniqueDistricts = Array.from(new Set(panchayats.map(p => p.district))).sort();
  
  const filteredBlocks = panchayats
    .filter(p => p.district === editDistrict)
    .map(p => p.block);
  const uniqueBlocks = Array.from(new Set(filteredBlocks)).sort();

  const filteredPanchayats = panchayats
    .filter(p => p.district === editDistrict && p.block === editBlock)
    .sort((a, b) => a.name.localeCompare(b.name));

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
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Location</label>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <SearchableSelect
                    value={editDistrict}
                    onChange={val => {
                      setEditDistrict(val);
                      setEditBlock('');
                      setEditPanchayatId('');
                    }}
                    options={uniqueDistricts.map(d => ({ value: d, label: d }))}
                    placeholder="Select District..."
                  />

                  <SearchableSelect
                    value={editBlock}
                    onChange={val => {
                      setEditBlock(val);
                      setEditPanchayatId('');
                    }}
                    options={uniqueBlocks.map(b => ({ value: b, label: b }))}
                    placeholder="Select Block..."
                    disabled={!editDistrict}
                  />

                  <SearchableSelect
                    value={editPanchayatId}
                    onChange={val => setEditPanchayatId(val)}
                    options={filteredPanchayats.map(p => ({ value: p.id, label: p.name }))}
                    placeholder="Select Panchayat..."
                    disabled={!editBlock}
                  />
                </div>
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

// Single-select dropdown with a search box, used for District/Block/Panchayat.
interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
}

function SearchableSelect({ value, onChange, options, placeholder, disabled }: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selectedLabel = options.find(o => o.value === value)?.label;
  const filteredOptions = search.trim()
    ? options.filter(o => o.label.toLowerCase().includes(search.trim().toLowerCase()))
    : options;

  const close = () => {
    setIsOpen(false);
    setSearch('');
  };

  return (
    <div style={{ position: 'relative', opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1',
          background: disabled ? '#f1f5f9' : 'white', cursor: 'pointer', boxSizing: 'border-box'
        }}
      >
        <span style={{ fontSize: '0.9rem', fontWeight: 600, color: value ? '#0f172a' : '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectedLabel || placeholder || 'Select...'}
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginLeft: '0.5rem' }}><polyline points="6 9 12 15 18 9"></polyline></svg>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            style={{
              position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '0.25rem',
              background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px',
              boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', zIndex: 60,
              maxHeight: '280px', display: 'flex', flexDirection: 'column'
            }}
          >
            <div style={{ position: 'fixed', inset: 0, zIndex: -1 }} onClick={close} />

            <div style={{ padding: '0.5rem', borderBottom: '1px solid #e2e8f0' }}>
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                onClick={e => e.stopPropagation()}
                placeholder="Search..."
                style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '0.85rem', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ overflowY: 'auto', padding: '0.35rem' }}>
              {value && (
                <div
                  onClick={() => { onChange(''); close(); }}
                  style={{ padding: '0.5rem 0.75rem', cursor: 'pointer', borderRadius: '4px', fontSize: '0.85rem', color: '#94a3b8', fontStyle: 'italic' }}
                >
                  Clear selection
                </div>
              )}
              {filteredOptions.length === 0 ? (
                <div style={{ padding: '0.75rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>No matches</div>
              ) : (
                filteredOptions.map(opt => (
                  <div
                    key={opt.value}
                    onClick={() => { onChange(opt.value); close(); }}
                    style={{
                      padding: '0.5rem 0.75rem', cursor: 'pointer', borderRadius: '4px', fontSize: '0.85rem',
                      fontWeight: opt.value === value ? 700 : 400,
                      color: opt.value === value ? '#4f46e5' : '#334155',
                      background: opt.value === value ? '#eef2ff' : 'transparent'
                    }}
                    onMouseEnter={e => { if (opt.value !== value) e.currentTarget.style.background = '#f8fafc'; }}
                    onMouseLeave={e => { if (opt.value !== value) e.currentTarget.style.background = opt.value === value ? '#eef2ff' : 'transparent'; }}
                  >
                    {opt.label}
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
