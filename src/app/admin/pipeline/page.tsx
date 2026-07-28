'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// The columns for our statuses
const STATUSES = ['Lead', 'Contacted', 'FollowUp', 'Converted', 'Closed'];

interface FollowUpHistory {
  id: string;
  timestamp: string; // ISO string
  updatedBy: string;
  previousStage: string;
  newStage: string;
  comments: string;
}

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
  history?: FollowUpHistory[]; // Mocked history
}

export default function PipelinePage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyModalContact, setHistoryModalContact] = useState<Contact | null>(null);

  // Filter States
  const [panchayatsData, setPanchayatsData] = useState<any[]>([]);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [selectedBlocks, setSelectedBlocks] = useState<string[]>([]);
  const [selectedPanchayats, setSelectedPanchayats] = useState<string[]>([]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch panchayats for location mapping
      const panchayatRes = await fetch('/data/panchayats.json');
      if (panchayatRes.ok) {
        const pData = await panchayatRes.json();
        setPanchayatsData(pData);
      }

      // Fetch contacts
      const token = localStorage.getItem('admin_token');
      const res = await fetch('http://localhost:5000/api/v1/admin/contacts', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        const enriched = data.map((c: any) => ({ ...c, history: generateMockHistory(c) }));
        setContacts(enriched);
      } else {
        setContacts(getFallbackMockData());
      }
    } catch (e) {
      console.error(e);
      setContacts(getFallbackMockData());
    } finally {
      setLoading(false);
    }
  };

  const generateMockHistory = (contact: any): FollowUpHistory[] => {
    return [
      {
        id: Math.random().toString(),
        timestamp: new Date(Date.now() - 86400000 * 2).toISOString(),
        updatedBy: 'System',
        previousStage: 'None',
        newStage: 'Lead',
        comments: 'Imported from spreadsheet'
      },
      {
        id: Math.random().toString(),
        timestamp: new Date(Date.now() - 86400000).toISOString(),
        updatedBy: 'Jane Agent',
        previousStage: 'Lead',
        newStage: contact.status || 'Contacted',
        comments: contact.comments || 'Initial call made.'
      }
    ];
  };

  const getFallbackMockData = (): Contact[] => [
    { clientId: '1', name: 'Rahul Sharma', phone: '+91 9876543210', role: 'mukhiya', panchayatId: '00000001-0000-0000-0000-000000000001', agentId: 'A1', status: 'FollowUp', followUpDate: new Date(Date.now() + 86400000).toISOString(), comments: 'Call back tomorrow', createdAt: new Date().toISOString(), history: generateMockHistory({status: 'FollowUp'}) },
    { clientId: '2', name: 'Priya Singh', phone: '+91 9876543211', role: 'ward_member', panchayatId: '00000002-0000-0000-0000-000000000001', agentId: 'A1', status: 'Converted', followUpDate: null, comments: 'Agreed to partnership', createdAt: new Date().toISOString(), history: generateMockHistory({status: 'Converted'}) },
    { clientId: '3', name: 'Amit Kumar', phone: '+91 9876543212', role: 'sarpanch', panchayatId: '00000003-0000-0000-0000-000000000001', agentId: 'A2', status: 'Lead', followUpDate: null, comments: '', createdAt: new Date().toISOString(), history: generateMockHistory({status: 'Lead'}) },
  ];

  const handleSaveContact = async (updatedContact: Contact) => {
    const newLog: FollowUpHistory = {
      id: Math.random().toString(),
      timestamp: new Date().toISOString(),
      updatedBy: 'Admin User',
      previousStage: contacts.find(c => c.clientId === updatedContact.clientId)?.status || '',
      newStage: updatedContact.status,
      comments: updatedContact.comments || ''
    };

    const finalContact = {
      ...updatedContact,
      history: [...(updatedContact.history || []), newLog]
    };

    setContacts(prev => prev.map(c => c.clientId === finalContact.clientId ? finalContact : c));

    try {
      const token = localStorage.getItem('admin_token');
      await fetch(`http://localhost:5000/api/v1/admin/contacts/${updatedContact.clientId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          status: updatedContact.status,
          followUpDate: updatedContact.followUpDate,
          comments: updatedContact.comments
        })
      });
    } catch (e) {
      console.error('Failed to save to backend', e);
    }
  };

  // Derive Location filters based on available data
  const uniqueCities = Array.from(new Set(panchayatsData.map(p => p.district))).filter(Boolean).sort();
  const uniqueBlocks = Array.from(new Set(panchayatsData
    .filter(p => selectedCities.length === 0 || selectedCities.includes(p.district))
    .map(p => p.block)
  )).filter(Boolean).sort();
  const uniquePanchayats = Array.from(new Set(panchayatsData
    .filter(p => (selectedCities.length === 0 || selectedCities.includes(p.district)) && 
                 (selectedBlocks.length === 0 || selectedBlocks.includes(p.block)))
    .map(p => p.name)
  )).filter(Boolean).sort();

  // Filter contacts based on selected location
  const filteredContacts = contacts.filter(contact => {
    if (selectedCities.length === 0 && selectedBlocks.length === 0 && selectedPanchayats.length === 0) return true;
    
    const pInfo = panchayatsData.find(p => p.id === contact.panchayatId);
    if (!pInfo) return false;

    if (selectedCities.length > 0 && !selectedCities.includes(pInfo.district)) return false;
    if (selectedBlocks.length > 0 && !selectedBlocks.includes(pInfo.block)) return false;
    if (selectedPanchayats.length > 0 && !selectedPanchayats.includes(pInfo.name)) return false;

    return true;
  });

  const exportToCsv = () => {
    const headers = ['Name', 'Phone', 'Role', 'Status', 'Follow-Up Date', 'Comments', 'City', 'Block', 'Panchayat'];
    const rows = filteredContacts.map(c => {
      const pInfo = panchayatsData.find(p => p.id === c.panchayatId) || { district: '', block: '', name: '' };
      return [
        `"${c.name.replace(/"/g, '""')}"`,
        `"${c.phone || ''}"`,
        `"${c.role}"`,
        `"${c.status}"`,
        `"${c.followUpDate ? new Date(c.followUpDate).toLocaleDateString() : ''}"`,
        `"${(c.comments || '').replace(/"/g, '""')}"`,
        `"${pInfo.district}"`,
        `"${pInfo.block}"`,
        `"${pInfo.name}"`
      ];
    });
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

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>CRM Pipeline</h1>
          <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Tabular view of all outreach contacts</p>
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

      {/* Filters Section */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap', zIndex: 20, position: 'relative' }}>
        <div style={{ flex: 1, minWidth: '220px' }}>
          <MultiSelectDropdown
            label="City (District)"
            placeholder="All Cities"
            options={uniqueCities}
            selected={selectedCities}
            onChange={(val) => { setSelectedCities(val); setSelectedBlocks([]); setSelectedPanchayats([]); }}
          />
        </div>
        <div style={{ flex: 1, minWidth: '220px' }}>
          <MultiSelectDropdown
            label="Block"
            placeholder="All Blocks"
            options={uniqueBlocks}
            selected={selectedBlocks}
            onChange={(val) => { setSelectedBlocks(val); setSelectedPanchayats([]); }}
            disabled={selectedCities.length === 0 && uniqueBlocks.length === 0}
          />
        </div>
        <div style={{ flex: 1, minWidth: '220px' }}>
          <MultiSelectDropdown
            label="Panchayat"
            placeholder="All Panchayats"
            options={uniquePanchayats}
            selected={selectedPanchayats}
            onChange={(val) => setSelectedPanchayats(val)}
            disabled={selectedBlocks.length === 0 && uniquePanchayats.length === 0}
          />
        </div>
      </div>

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 40, height: 40, border: '3px solid #e2e8f0', borderTopColor: '#4f46e5', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        </div>
      ) : (
        <div style={{ flex: 1, background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px rgba(0,0,0,0.02)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ overflowX: 'auto', flex: 1 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '1rem', fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contact Details</th>
                  <th style={{ padding: '1rem', fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Phone</th>
                  <th style={{ padding: '1rem', fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', width: '160px' }}>Stage (Result)</th>
                  <th style={{ padding: '1rem', fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', width: '160px' }}>Follow-up Date</th>
                  <th style={{ padding: '1rem', fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Comments</th>
                  <th style={{ padding: '1rem', fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Last Updated</th>
                  <th style={{ padding: '1rem', fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredContacts.map(c => (
                  <ContactRow 
                    key={c.clientId} 
                    contact={c} 
                    onSave={handleSaveContact} 
                    onViewHistory={() => setHistoryModalContact(c)} 
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* History Modal */}
      <AnimatePresence>
        {historyModalContact && (
          <HistoryModal 
            contact={historyModalContact} 
            onClose={() => setHistoryModalContact(null)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// -------------------------------------------------------------------------------------------------
// Contact Row Component (Handles inline editing state)
// -------------------------------------------------------------------------------------------------
function ContactRow({ contact, onSave, onViewHistory }: { contact: Contact, onSave: (c: Contact) => void, onViewHistory: () => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editStatus, setEditStatus] = useState(contact.status || 'Lead');
  const [editFollowUp, setEditFollowUp] = useState(contact.followUpDate ? new Date(contact.followUpDate).toISOString().split('T')[0] : '');
  const [editComments, setEditComments] = useState(contact.comments || '');

  const hasChanges = editStatus !== contact.status || 
                     editFollowUp !== (contact.followUpDate ? new Date(contact.followUpDate).toISOString().split('T')[0] : '') ||
                     editComments !== (contact.comments || '');

  const handleSave = () => {
    onSave({
      ...contact,
      status: editStatus,
      followUpDate: editFollowUp ? new Date(editFollowUp).toISOString() : null,
      comments: editComments
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditStatus(contact.status || 'Lead');
    setEditFollowUp(contact.followUpDate ? new Date(contact.followUpDate).toISOString().split('T')[0] : '');
    setEditComments(contact.comments || '');
    setIsEditing(false);
  };

  // Format last updated IST time
  const lastHistory = contact.history && contact.history.length > 0 ? contact.history[contact.history.length - 1] : null;
  const lastUpdatedTime = lastHistory ? new Date(lastHistory.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' }) + ' IST' : 'Never';
  const lastUpdatedBy = lastHistory ? lastHistory.updatedBy : 'N/A';

  const statusColor = editStatus === 'Lead' ? '#94a3b8' :
                      editStatus === 'Contacted' ? '#eab308' :
                      editStatus === 'FollowUp' ? '#3b82f6' :
                      editStatus === 'Converted' ? '#22c55e' : '#ef4444';

  return (
    <tr style={{ borderBottom: '1px solid #e2e8f0', background: isEditing ? '#f8fafc' : 'white', transition: 'background 0.2s' }}>
      <td style={{ padding: '1rem' }}>
        <div style={{ fontWeight: 700, color: '#0f172a' }}>{contact.name}</div>
        <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, textTransform: 'capitalize' }}>{contact.role.replace('_', ' ')}</div>
      </td>
      <td style={{ padding: '1rem', color: '#4f46e5', fontWeight: 600, fontSize: '0.9rem' }}>
        {contact.phone || '-'}
      </td>
      <td style={{ padding: '1rem' }}>
        {isEditing ? (
          <select 
            value={editStatus} 
            onChange={e => setEditStatus(e.target.value)}
            style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: `1px solid ${statusColor}`, outline: 'none', background: 'white', fontWeight: 600, fontSize: '0.85rem' }}
          >
            {STATUSES.map(col => <option key={col} value={col}>{col}</option>)}
          </select>
        ) : (
          <span style={{ 
            background: `${statusColor}20`, color: statusColor, 
            padding: '0.25rem 0.75rem', borderRadius: '20px', fontWeight: 700, fontSize: '0.8rem' 
          }}>
            {contact.status}
          </span>
        )}
      </td>
      <td style={{ padding: '1rem' }}>
        {isEditing ? (
          <input 
            type="date" 
            value={editFollowUp} 
            onChange={e => setEditFollowUp(e.target.value)}
            style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', background: 'white', fontWeight: 600, fontSize: '0.85rem', color: '#0f172a' }}
          />
        ) : (
          <div style={{ fontSize: '0.85rem', color: '#334155', fontWeight: 600 }}>
            {contact.followUpDate ? new Date(contact.followUpDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}
          </div>
        )}
      </td>
      <td style={{ padding: '1rem' }}>
        {isEditing ? (
          <textarea 
            rows={2}
            value={editComments} 
            onChange={e => setEditComments(e.target.value)}
            placeholder="Notes..."
            style={{ width: '100%', minWidth: '180px', padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', resize: 'vertical', background: 'white', fontWeight: 500, fontSize: '0.85rem', color: '#0f172a' }}
          />
        ) : (
          <div style={{ fontSize: '0.85rem', color: '#475569', maxWidth: '250px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={contact.comments || ''}>
            {contact.comments || '-'}
          </div>
        )}
      </td>
      <td style={{ padding: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155' }}>{lastUpdatedTime}</div>
            <div style={{ fontSize: '0.7rem', color: '#64748b' }}>By {lastUpdatedBy}</div>
          </div>
          <button onClick={onViewHistory} style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '0.25rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, color: '#4f46e5', transition: 'background 0.2s' }}>
            History
          </button>
        </div>
      </td>
      <td style={{ padding: '1rem', textAlign: 'center', minWidth: '120px' }}>
        {isEditing ? (
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
            <button onClick={handleSave} disabled={!hasChanges} style={{ background: hasChanges ? '#4f46e5' : '#cbd5e1', color: 'white', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '6px', fontWeight: 600, cursor: hasChanges ? 'pointer' : 'not-allowed', fontSize: '0.8rem' }}>Save</button>
            <button onClick={handleCancel} style={{ background: 'transparent', color: '#64748b', border: '1px solid #cbd5e1', padding: '0.4rem 0.8rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem' }}>Cancel</button>
          </div>
        ) : (
          <button onClick={() => setIsEditing(true)} style={{ background: 'transparent', color: '#0f172a', border: '1px solid #e2e8f0', padding: '0.4rem 1rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
            Edit
          </button>
        )}
      </td>
    </tr>
  );
}

// -------------------------------------------------------------------------------------------------
// History Modal Component
// -------------------------------------------------------------------------------------------------
function HistoryModal({ contact, onClose }: { contact: Contact, onClose: () => void }) {
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
          {(!contact.history || contact.history.length === 0) ? (
            <p style={{ color: '#64748b', textAlign: 'center', padding: '2rem' }}>No history recorded.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Reverse history to show newest first */}
              {[...contact.history].reverse().map((h, i) => (
                <div key={h.id} style={{ display: 'flex', gap: '1rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#4f46e5', marginTop: '0.25rem' }} />
                    {i !== contact.history!.length - 1 && <div style={{ width: 2, flex: 1, background: '#e2e8f0', marginTop: '0.5rem' }} />}
                  </div>
                  <div style={{ flex: 1, background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <span style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.9rem' }}>{h.updatedBy}</span>
                      <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>
                        {new Date(h.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8', textDecoration: 'line-through' }}>{h.previousStage}</span>
                      <span style={{ fontSize: '0.8rem' }}>➔</span>
                      <span style={{ fontSize: '0.75rem', color: '#4f46e5', fontWeight: 700, background: '#e0e7ff', padding: '0.1rem 0.5rem', borderRadius: '4px' }}>{h.newStage}</span>
                    </div>
                    {h.comments && (
                      <p style={{ margin: 0, fontSize: '0.85rem', color: '#334155', background: 'white', padding: '0.75rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        {h.comments}
                      </p>
                    )}
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

// -------------------------------------------------------------------------------------------------
// MultiSelect Dropdown Component
// -------------------------------------------------------------------------------------------------
interface MultiSelectDropdownProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

function MultiSelectDropdown({ label, options, selected, onChange, disabled, placeholder }: MultiSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  const toggleSelection = (opt: string) => {
    if (selected.includes(opt)) {
      onChange(selected.filter((o: string) => o !== opt));
    } else {
      onChange([...selected, opt]);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</label>
      
      <div style={{ position: 'relative' }}>
        {/* Click capture overlay for outside click (simple approach for now) */}
        {isOpen && (
          <div 
            style={{ position: 'fixed', inset: 0, zIndex: 40 }} 
            onClick={() => setIsOpen(false)} 
          />
        )}
        
        <div 
          onClick={() => !disabled && setIsOpen(!isOpen)}
          style={{ 
            width: '100%', padding: '0.75rem', borderRadius: '8px', 
            border: '1px solid #cbd5e1', background: disabled ? '#f1f5f9' : 'white', 
            fontWeight: 600, color: '#0f172a', cursor: disabled ? 'not-allowed' : 'pointer', 
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            position: 'relative', zIndex: 41
          }}
        >
          <span style={{ fontSize: '0.85rem', color: selected.length === 0 ? '#64748b' : '#0f172a' }}>
            {selected.length === 0 ? placeholder : `${selected.length} Selected`}
          </span>
          <span style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', fontSize: '0.8rem' }}>▼</span>
        </div>
        
        <AnimatePresence>
          {isOpen && !disabled && (
            <motion.div 
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.15 }}
              style={{ 
                position: 'absolute', top: '100%', left: 0, right: 0, 
                background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', 
                marginTop: '0.5rem', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)', 
                zIndex: 50, maxHeight: '250px', overflowY: 'auto' 
              }}
            >
              {options.length === 0 ? (
                <div style={{ padding: '1rem', textAlign: 'center', fontSize: '0.85rem', color: '#64748b' }}>No options</div>
              ) : (
                options.map((opt: string) => (
                  <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1rem', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', background: selected.includes(opt) ? '#f8fafc' : 'white' }}>
                    <input 
                      type="checkbox" 
                      checked={selected.includes(opt)} 
                      onChange={() => toggleSelection(opt)} 
                      style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#4f46e5' }} 
                    />
                    <span style={{ fontSize: '0.85rem', fontWeight: selected.includes(opt) ? 700 : 500, color: selected.includes(opt) ? '#4f46e5' : '#334155' }}>
                      {opt}
                    </span>
                  </label>
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
