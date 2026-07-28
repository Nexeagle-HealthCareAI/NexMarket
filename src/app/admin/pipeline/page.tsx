'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// The columns for our Kanban board
const COLUMNS = ['Lead', 'Contacted', 'FollowUp', 'Converted', 'Closed'];

interface Contact {
  clientId: string;
  name: string;
  phone: string | null;
  role: string;
  panchayatId: string;
  agentId: string;
  status: string;
  followUpDate: string | null;
  comments: string | null;
  createdAt: string;
}

export default function PipelinePage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  
  // Modal state
  const [editStatus, setEditStatus] = useState('');
  const [editFollowUp, setEditFollowUp] = useState('');
  const [editComments, setEditComments] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchContacts();
  }, []);

  const fetchContacts = async () => {
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch('http://localhost:5000/api/v1/admin/contacts', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setContacts(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const openContact = (c: Contact) => {
    setSelectedContact(c);
    setEditStatus(c.status || 'Lead');
    setEditFollowUp(c.followUpDate ? new Date(c.followUpDate).toISOString().split('T')[0] : '');
    setEditComments(c.comments || '');
  };

  const saveContact = async () => {
    if (!selectedContact) return;
    setSaving(true);
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`http://localhost:5000/api/v1/admin/contacts/${selectedContact.clientId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          status: editStatus,
          followUpDate: editFollowUp ? new Date(editFollowUp).toISOString() : null,
          comments: editComments
        })
      });
      
      if (res.ok) {
        // Update local state
        setContacts(prev => prev.map(c => 
          c.clientId === selectedContact.clientId 
            ? { ...c, status: editStatus, followUpDate: editFollowUp ? new Date(editFollowUp).toISOString() : null, comments: editComments }
            : c
        ));
        setSelectedContact(null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const exportToCsv = () => {
    const headers = ['Name', 'Phone', 'Role', 'Status', 'Follow-Up Date', 'Comments'];
    const rows = contacts.map(c => [
      `"${c.name.replace(/"/g, '""')}"`,
      `"${c.phone || ''}"`,
      `"${c.role}"`,
      `"${c.status}"`,
      `"${c.followUpDate ? new Date(c.followUpDate).toLocaleDateString() : ''}"`,
      `"${(c.comments || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Pipeline_Export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const contactsByStatus = COLUMNS.reduce((acc, col) => {
    acc[col] = contacts.filter(c => c.status === col);
    return acc;
  }, {} as Record<string, Contact[]>);

  // Group unknown statuses into 'Lead' just in case
  contacts.forEach(c => {
    if (!COLUMNS.includes(c.status)) {
      contactsByStatus['Lead'].push(c);
    }
  });

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>CRM Pipeline</h1>
          <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Manage outreach contacts and track follow-ups</p>
        </div>
        <motion.button 
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={exportToCsv}
          style={{ 
            display: 'flex', gap: '0.5rem', alignItems: 'center', 
            background: 'white', color: '#0f172a', border: '1px solid #e2e8f0',
            padding: '0.5rem 1rem', borderRadius: '8px', fontWeight: 600,
            boxShadow: '0 2px 4px rgba(0,0,0,0.02)', cursor: 'pointer'
          }}
        >
          <span>📥</span> Export to CSV
        </motion.button>
      </div>

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 40, height: 40, border: '3px solid #e2e8f0', borderTopColor: '#4f46e5', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '1.5rem', overflowX: 'auto', paddingBottom: '1rem', flex: 1, padding: '0.25rem' }}>
          {COLUMNS.map((col) => (
            <div key={col} style={{ 
              minWidth: 340, 
              background: '#f8fafc', 
              borderRadius: '16px', 
              padding: '1.25rem', 
              display: 'flex', 
              flexDirection: 'column',
              border: '1px solid #e2e8f0',
              boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <h3 style={{ fontWeight: 800, color: '#1e293b', fontSize: '1.05rem', letterSpacing: '-0.01em' }}>{col}</h3>
                <span style={{ background: '#e2e8f0', color: '#475569', fontSize: '0.8rem', padding: '0.15rem 0.6rem', borderRadius: '20px', fontWeight: 700 }}>
                  {contactsByStatus[col]?.length || 0}
                </span>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1, overflowY: 'auto', paddingRight: '0.25rem' }}>
                <AnimatePresence>
                  {contactsByStatus[col]?.map((contact) => (
                    <motion.div
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      key={contact.clientId}
                      onClick={() => openContact(contact)}
                      whileHover={{ y: -4, boxShadow: '0 12px 20px -8px rgba(0, 0, 0, 0.15)' }}
                      style={{
                        background: 'white',
                        padding: '1.25rem',
                        borderRadius: '12px',
                        boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -2px rgba(0,0,0,0.025)',
                        cursor: 'pointer',
                        border: '1px solid #f1f5f9',
                        borderTop: `4px solid ${
                          col === 'Lead' ? '#cbd5e1' :
                          col === 'Contacted' ? '#fbbf24' :
                          col === 'FollowUp' ? '#3b82f6' :
                          col === 'Converted' ? '#10b981' : '#ef4444'
                        }`
                      }}
                    >
                      <h4 style={{ fontWeight: 700, color: '#0f172a', marginBottom: '0.25rem', fontSize: '1rem' }}>{contact.name}</h4>
                      <p style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.75rem', fontWeight: 600, letterSpacing: '0.02em' }}>{contact.role.replace('_', ' ').toUpperCase()}</p>
                      
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem' }}>
                        <span style={{ color: '#4f46e5', fontWeight: 600, background: '#eef2ff', padding: '0.2rem 0.5rem', borderRadius: '6px' }}>
                          {contact.phone || 'No phone'}
                        </span>
                        {contact.followUpDate && (
                          <span style={{ background: '#fef2f2', color: '#dc2626', padding: '0.2rem 0.5rem', borderRadius: '6px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <span>🗓</span> {new Date(contact.followUpDate).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}
                          </span>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Contact Modal */}
      <AnimatePresence>
        {selectedContact && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              onClick={() => setSelectedContact(null)}
              style={{ position: 'absolute', inset: 0, background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(8px)' }} 
            />
            
            <motion.div 
              initial={{ opacity: 0, y: 50, scale: 0.95 }} 
              animate={{ opacity: 1, y: 0, scale: 1 }} 
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              style={{ 
                position: 'relative', background: 'white', padding: '2rem', 
                borderRadius: '24px', width: '100%', maxWidth: 480, 
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                border: '1px solid #e2e8f0'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
                <div>
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em', marginBottom: '0.25rem' }}>{selectedContact.name}</h2>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', background: '#f1f5f9', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                      {selectedContact.role.replace('_', ' ').toUpperCase()}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>{selectedContact.phone}</span>
                  </div>
                </div>
                <button onClick={() => setSelectedContact(null)} style={{ background: '#f1f5f9', border: 'none', width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748b', transition: 'background 0.2s' }}>✕</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#334155', marginBottom: '0.5rem' }}>Stage</label>
                  <select 
                    value={editStatus} 
                    onChange={e => setEditStatus(e.target.value)}
                    style={{ width: '100%', padding: '0.85rem', borderRadius: '12px', border: '1px solid #cbd5e1', outline: 'none', background: '#f8fafc', fontWeight: 600, color: '#0f172a' }}
                  >
                    {COLUMNS.map(col => <option key={col} value={col}>{col}</option>)}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#334155', marginBottom: '0.5rem' }}>Follow-Up Date</label>
                  <input 
                    type="date" 
                    value={editFollowUp} 
                    onChange={e => setEditFollowUp(e.target.value)}
                    style={{ width: '100%', padding: '0.85rem', borderRadius: '12px', border: '1px solid #cbd5e1', outline: 'none', background: '#f8fafc', fontWeight: 600, color: '#0f172a' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#334155', marginBottom: '0.5rem' }}>Comments</label>
                  <textarea 
                    rows={4}
                    value={editComments} 
                    onChange={e => setEditComments(e.target.value)}
                    placeholder="Add notes about this contact..."
                    style={{ width: '100%', padding: '0.85rem', borderRadius: '12px', border: '1px solid #cbd5e1', outline: 'none', resize: 'none', background: '#f8fafc', fontWeight: 500, color: '#0f172a' }}
                  />
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
                  <button onClick={() => setSelectedContact(null)} style={{ background: 'transparent', border: 'none', fontWeight: 700, color: '#64748b', cursor: 'pointer', padding: '0.75rem 1rem' }}>Cancel</button>
                  <button onClick={saveContact} disabled={saving} style={{ background: '#4f46e5', color: 'white', border: 'none', fontWeight: 700, borderRadius: '12px', padding: '0.75rem 1.5rem', cursor: 'pointer', boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)' }}>
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
