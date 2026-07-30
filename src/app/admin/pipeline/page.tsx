'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useAgentStore } from '@/store/agent-store';
import { getAdminContacts, updateAdminContact, getContactHistory, getPanchayats, type AdminContactDto, type ContactHistoryEntryDto, type PanchayatDto } from '@/lib/sync/api-client';

// The columns for our statuses
const STATUSES = ['Lead', 'Contacted', 'FollowUp', 'Converted', 'Closed'];
const PAGE_SIZE = 50;
// Matches the server-side cap in ContactsController.GetAllContacts — large enough
// to act as "everything matching these filters" for CSV export.
const EXPORT_PAGE_SIZE = 2000;

type Contact = AdminContactDto;

export default function PipelinePage() {
  const token = useAgentStore((s) => s.jwtToken);
  const name = useAgentStore((s) => s.name);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [historyModalContact, setHistoryModalContact] = useState<Contact | null>(null);
  const [activeTab, setActiveTab] = useState<'worklist' | 'historical'>('worklist');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'yesterday' | 'custom'>('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  // Filter States
  const [panchayatsData, setPanchayatsData] = useState<PanchayatDto[]>([]);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [selectedBlocks, setSelectedBlocks] = useState<string[]>([]);
  const [selectedPanchayats, setSelectedPanchayats] = useState<string[]>([]);

  useEffect(() => {
    if (token) getPanchayats(token).then(setPanchayatsData).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    let startDate: string | undefined = undefined;
    let endDate: string | undefined = undefined;
    const now = new Date();
    if (dateFilter === 'today') {
      const d = new Date(now.setHours(0,0,0,0));
      startDate = d.toISOString();
      const end = new Date(now.setHours(23,59,59,999));
      endDate = end.toISOString();
    } else if (dateFilter === 'yesterday') {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      const d = new Date(y.setHours(0,0,0,0));
      startDate = d.toISOString();
      const end = new Date(y.setHours(23,59,59,999));
      endDate = end.toISOString();
    } else if (dateFilter === 'custom') {
      if (customStartDate) {
        const d = new Date(customStartDate);
        d.setHours(0,0,0,0);
        startDate = d.toISOString();
      }
      if (customEndDate) {
        const d = new Date(customEndDate);
        d.setHours(23,59,59,999);
        endDate = d.toISOString();
      }
    }

    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await getAdminContacts(token, {
          page,
          pageSize: PAGE_SIZE,
          districts: selectedCities,
          blocks: selectedBlocks,
          panchayats: selectedPanchayats,
          statuses: activeTab === 'worklist' ? ['Lead', 'Contacted', 'FollowUp'] : undefined,
          startDate,
          endDate,
        });
        if (cancelled) return;
        setContacts(res.items);
        setTotalCount(res.totalCount);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load pipeline data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [token, page, selectedCities, selectedBlocks, selectedPanchayats, activeTab, dateFilter, customStartDate, customEndDate]);

  const handleSaveContact = async (updatedContact: Contact) => {
    if (!token) return;

    try {
      const saved = await updateAdminContact(token, updatedContact.clientId, {
        status: updatedContact.status,
        followUpDate: updatedContact.followUpDate,
        comments: updatedContact.comments ?? undefined
      });

      setContacts(prev => prev.map(c => c.clientId === updatedContact.clientId
        ? { ...c, ...saved, lastUpdatedAt: new Date().toISOString(), lastUpdatedBy: name || 'Admin' }
        : c));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save changes.');
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

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const exportToCsv = async () => {
    if (!token) return;
    setExporting(true);
    setError('');

    let startDate: string | undefined = undefined;
    let endDate: string | undefined = undefined;
    const now = new Date();
    if (dateFilter === 'today') {
      startDate = new Date(now.setHours(0,0,0,0)).toISOString();
      endDate = new Date(now.setHours(23,59,59,999)).toISOString();
    } else if (dateFilter === 'yesterday') {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      startDate = new Date(y.setHours(0,0,0,0)).toISOString();
      endDate = new Date(y.setHours(23,59,59,999)).toISOString();
    } else if (dateFilter === 'custom') {
      if (customStartDate) startDate = new Date(new Date(customStartDate).setHours(0,0,0,0)).toISOString();
      if (customEndDate) endDate = new Date(new Date(customEndDate).setHours(23,59,59,999)).toISOString();
    }

    try {
      const res = await getAdminContacts(token, {
        page: 1,
        pageSize: EXPORT_PAGE_SIZE,
        districts: selectedCities,
        blocks: selectedBlocks,
        panchayats: selectedPanchayats,
        statuses: activeTab === 'worklist' ? ['Lead', 'Contacted', 'FollowUp'] : undefined,
        startDate,
        endDate,
      });
      if (res.totalCount > EXPORT_PAGE_SIZE) {
        setError(`Export is capped at ${EXPORT_PAGE_SIZE} rows — narrow the filters to export everything matching (${res.totalCount} total).`);
      }

      const headers = ['Name', 'Phone', 'Role', 'Status', 'Follow-Up Date', 'Comments', 'City', 'Block', 'Panchayat', 'Added By', 'Date Added'];
      const rows = res.items.map(c => {
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
          `"${pInfo.name}"`,
          `"${(c.agentName || c.agentId).replace(/"/g, '""')}"`,
          `"${new Date(c.createdAt).toLocaleDateString()}"`
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
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to export CSV.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>Contact Management</h1>
          <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Manage active leads and historical contact data</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={exportToCsv}
          disabled={exporting}
          style={{
            display: 'flex', gap: '0.5rem', alignItems: 'center',
            background: 'white', color: '#0f172a', border: '1px solid #e2e8f0',
            padding: '0.5rem 1rem', borderRadius: '8px', fontWeight: 600,
            boxShadow: '0 2px 4px rgba(0,0,0,0.02)', cursor: exporting ? 'not-allowed' : 'pointer',
            opacity: exporting ? 0.6 : 1
          }}
        >
          <span>📥</span> {exporting ? 'Exporting...' : 'Export to CSV'}
        </motion.button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '1rem', borderBottom: '2px solid #e2e8f0', marginBottom: '1.5rem' }}>
        <button
          onClick={() => { setActiveTab('worklist'); setPage(1); }}
          style={{
            background: 'none', border: 'none', padding: '0.75rem 1.5rem', cursor: 'pointer',
            fontSize: '1rem', fontWeight: 700, color: activeTab === 'worklist' ? '#4f46e5' : '#64748b',
            borderBottom: activeTab === 'worklist' ? '3px solid #4f46e5' : '3px solid transparent',
            marginBottom: '-2px', transition: 'all 0.2s'
          }}
        >
          📝 Worklist
        </button>
        <button
          onClick={() => { setActiveTab('historical'); setPage(1); }}
          style={{
            background: 'none', border: 'none', padding: '0.75rem 1.5rem', cursor: 'pointer',
            fontSize: '1rem', fontWeight: 700, color: activeTab === 'historical' ? '#4f46e5' : '#64748b',
            borderBottom: activeTab === 'historical' ? '3px solid #4f46e5' : '3px solid transparent',
            marginBottom: '-2px', transition: 'all 0.2s'
          }}
        >
          🗄️ Historical Data
        </button>
      </div>

      {/* Filters Section */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap', zIndex: 20, position: 'relative' }}>
        <div style={{ flex: 1, minWidth: '180px' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date Filter</label>
          <select 
            value={dateFilter} 
            onChange={(e) => { setDateFilter(e.target.value as any); setPage(1); }}
            style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: 'white', fontWeight: 600, color: '#0f172a', outline: 'none' }}
          >
            <option value="all">All Dates</option>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="custom">Custom Range</option>
          </select>
        </div>
        
        {dateFilter === 'custom' && (
          <>
            <div style={{ minWidth: '130px' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Start Date</label>
              <input type="date" value={customStartDate} onChange={e => { setCustomStartDate(e.target.value); setPage(1); }} style={{ width: '100%', padding: '0.7rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', background: 'white', fontWeight: 600, color: '#0f172a' }} />
            </div>
            <div style={{ minWidth: '130px' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>End Date</label>
              <input type="date" value={customEndDate} onChange={e => { setCustomEndDate(e.target.value); setPage(1); }} style={{ width: '100%', padding: '0.7rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', background: 'white', fontWeight: 600, color: '#0f172a' }} />
            </div>
          </>
        )}

        <div style={{ flex: 1, minWidth: '180px' }}>
          <MultiSelectDropdown
            label="City (District)"
            placeholder="All Cities"
            options={uniqueCities}
            selected={selectedCities}
            onChange={(val) => { setSelectedCities(val); setSelectedBlocks([]); setSelectedPanchayats([]); setPage(1); }}
          />
        </div>
        <div style={{ flex: 1, minWidth: '220px' }}>
          <MultiSelectDropdown
            label="Block"
            placeholder="All Blocks"
            options={uniqueBlocks}
            selected={selectedBlocks}
            onChange={(val) => { setSelectedBlocks(val); setSelectedPanchayats([]); setPage(1); }}
            disabled={selectedCities.length === 0 && uniqueBlocks.length === 0}
          />
        </div>
        <div style={{ flex: 1, minWidth: '220px' }}>
          <MultiSelectDropdown
            label="Panchayat"
            placeholder="All Panchayats"
            options={uniquePanchayats}
            selected={selectedPanchayats}
            onChange={(val) => { setSelectedPanchayats(val); setPage(1); }}
            disabled={selectedBlocks.length === 0 && uniquePanchayats.length === 0}
          />
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: '1rem', padding: '0.85rem 1rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#b91c1c', fontSize: '0.85rem', fontWeight: 600 }}>
          {error}
        </div>
      )}

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
                  <th style={{ padding: '1rem', fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Location (Village)</th>
                  {activeTab === 'worklist' && (
                    <>
                      <th style={{ padding: '1rem', fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', width: '160px' }}>Stage (Result)</th>
                      <th style={{ padding: '1rem', fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Follow-up Date</th>
                    </>
                  )}
                  <th style={{ padding: '1rem', fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Added By</th>
                  {activeTab === 'worklist' && (
                    <th style={{ padding: '1rem', fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Comments</th>
                  )}
                  <th style={{ padding: '1rem', fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Last Updated</th>
                  <th style={{ padding: '1rem', fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map(c => {
                  const pInfo = panchayatsData.find(p => p.id === c.panchayatId);
                  return (
                    <ContactRow
                      key={c.clientId}
                      contact={c}
                      panchayatName={pInfo?.name}
                      blockName={pInfo?.block}
                      showStageAndFollowUp={activeTab === 'worklist'}
                      showComments={activeTab === 'worklist'}
                      onSave={handleSaveContact}
                      onViewHistory={() => setHistoryModalContact(c)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.85rem 1.25rem', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
            <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
              {totalCount === 0 ? 'No contacts' : `Page ${page} of ${totalPages} · ${totalCount} total`}
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                style={{ background: 'white', color: page <= 1 ? '#cbd5e1' : '#0f172a', border: '1px solid #e2e8f0', padding: '0.4rem 0.9rem', borderRadius: '6px', fontWeight: 600, fontSize: '0.8rem', cursor: page <= 1 ? 'not-allowed' : 'pointer' }}
              >
                Previous
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                style={{ background: 'white', color: page >= totalPages ? '#cbd5e1' : '#0f172a', border: '1px solid #e2e8f0', padding: '0.4rem 0.9rem', borderRadius: '6px', fontWeight: 600, fontSize: '0.8rem', cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      <AnimatePresence>
        {historyModalContact && token && (
          <HistoryModal
            contact={historyModalContact}
            token={token}
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
function ContactRow({ contact, panchayatName, blockName, showStageAndFollowUp, showComments, onSave, onViewHistory }: { contact: Contact, panchayatName?: string, blockName?: string, showStageAndFollowUp: boolean, showComments: boolean, onSave: (c: Contact) => void, onViewHistory: () => void }) {
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
  const lastUpdatedTime = contact.lastUpdatedAt
    ? new Date(contact.lastUpdatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' }) + ' IST'
    : 'Never';
  const lastUpdatedBy = contact.lastUpdatedBy || 'N/A';

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
        <div style={{ fontWeight: 600, color: '#334155', fontSize: '0.85rem' }}>{panchayatName || '-'}</div>
        <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>{blockName || '-'} Block</div>
        {contact.latitude && contact.longitude && (
          <a
            href={`https://www.google.com/maps?q=${contact.latitude},${contact.longitude}`}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
              fontSize: '0.7rem', fontWeight: 600, color: '#059669',
              textDecoration: 'none', background: '#d1fae5', padding: '0.15rem 0.4rem', borderRadius: '4px'
            }}
          >
            📍 Map
          </a>
        )}
      </td>
      {showStageAndFollowUp && (
        <>
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
        </>
      )}
      <td style={{ padding: '1rem' }}>
        <div style={{ fontWeight: 600, color: '#334155', fontSize: '0.85rem' }}>{contact.agentName || contact.agentId || 'Agent'}</div>
        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{new Date(contact.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
      </td>
      {showComments && (
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
      )}
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
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
            <button onClick={() => setIsEditing(true)} style={{ background: 'transparent', color: '#0f172a', border: '1px solid #e2e8f0', padding: '0.4rem 0.8rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem', boxShadow: '0 1px 2px rgba(0,0,0,0.05)', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              Edit
            </button>
            <Link href={`/admin/pipeline/${contact.clientId}`} style={{ background: '#0f172a', color: 'white', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem', textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
              Profile
            </Link>
          </div>
        )}
      </td>
    </tr>
  );
}

// -------------------------------------------------------------------------------------------------
// History Modal Component
// -------------------------------------------------------------------------------------------------
function HistoryModal({ contact, token, onClose }: { contact: Contact, token: string, onClose: () => void }) {
  const [history, setHistory] = useState<ContactHistoryEntryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const h = await getContactHistory(token, contact.clientId);
        if (!cancelled) setHistory(h);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load history.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [contact.clientId, token]);

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
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8', textDecoration: 'line-through' }}>{h.previousStatus}</span>
                      <span style={{ fontSize: '0.8rem' }}>➔</span>
                      <span style={{ fontSize: '0.75rem', color: '#4f46e5', fontWeight: 700, background: '#e0e7ff', padding: '0.1rem 0.5rem', borderRadius: '4px' }}>{h.newStatus}</span>
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
