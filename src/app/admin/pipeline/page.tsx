'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useAgentStore } from '@/store/agent-store';
import { getAdminContacts, updateAdminContact, deleteAdminContact, getContactHistory, getPanchayats, type AdminContactDto, type ContactHistoryEntryDto, type PanchayatDto } from '@/lib/sync/api-client';

// The columns for our statuses
const STATUSES = ['Lead', 'Contacted', 'FollowUp', 'Converted', 'Closed'];
const PAGE_SIZE = 50;
// Matches the server-side cap in ContactsController.GetAllContacts — large enough
// to act as "everything matching these filters" for CSV export.
const EXPORT_PAGE_SIZE = 2000;

type Contact = AdminContactDto;

function SortableHeader({ label, columnKey, currentSortBy, currentSortOrder, onSort, width }: { label: string, columnKey: string, currentSortBy?: string, currentSortOrder?: 'asc' | 'desc', onSort: (key: string, order: 'asc' | 'desc') => void, width?: string }) {
  const isActive = currentSortBy === columnKey;
  
  const handleClick = () => {
    if (!isActive) {
      onSort(columnKey, 'asc');
    } else if (currentSortOrder === 'asc') {
      onSort(columnKey, 'desc');
    } else {
      onSort(columnKey, 'asc'); // Or clear sort, but toggling is fine
    }
  };

  return (
    <th 
      onClick={handleClick}
      style={{ padding: '1rem', fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer', width, userSelect: 'none' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
        {label}
        <span style={{ color: isActive ? '#4f46e5' : '#cbd5e1', fontSize: '0.9rem' }}>
          {isActive ? (currentSortOrder === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </div>
    </th>
  );
}

export default function PipelinePage() {
  const agentId = useAgentStore((s) => s.agentId);
  const name = useAgentStore((s) => s.name);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [historyModalContact, setHistoryModalContact] = useState<Contact | null>(null);
  const [editDrawerContact, setEditDrawerContact] = useState<Contact | null>(null);
  const [activeTab, setActiveTab] = useState<'worklist' | 'recent' | 'historical'>('worklist');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'yesterday' | 'custom'>('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [sortBy, setSortBy] = useState<string | undefined>(undefined);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | undefined>(undefined);

  // Filter States
  const [panchayatsData, setPanchayatsData] = useState<PanchayatDto[]>([]);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [selectedBlocks, setSelectedBlocks] = useState<string[]>([]);
  const [selectedPanchayats, setSelectedPanchayats] = useState<string[]>([]);

  useEffect(() => {
    if (agentId) getPanchayats().then(setPanchayatsData).catch(() => {});
  }, [agentId]);

  useEffect(() => {
    if (!agentId) return;
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
        const isWorklist = activeTab === 'worklist';
        const isRecent = activeTab === 'recent';
        
        let maxFollowUpDate: string | undefined = undefined;
        if (isWorklist) {
           const d = new Date();
           d.setHours(23,59,59,999);
           maxFollowUpDate = d.toISOString();
        }

        let updatedAfter: string | undefined = undefined;
        if (isRecent) {
           const d = new Date();
           d.setDate(d.getDate() - 1);
           d.setHours(0,0,0,0);
           updatedAfter = d.toISOString();
        }

        const res = await getAdminContacts({
          page,
          pageSize: PAGE_SIZE,
          districts: selectedCities,
          blocks: selectedBlocks,
          panchayats: selectedPanchayats,
          statuses: isWorklist ? ['Lead', 'Contacted', 'FollowUp'] : undefined,
          startDate,
          endDate,
          maxFollowUpDate,
          updatedAfter,
          sortBy,
          sortOrder,
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
  }, [agentId, page, selectedCities, selectedBlocks, selectedPanchayats, activeTab, dateFilter, customStartDate, customEndDate, sortBy, sortOrder]);

  const handleSaveContact = async (updatedContact: Contact) => {
    if (!agentId) return;

    try {
      const saved = await updateAdminContact(updatedContact.clientId, {
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

  const handleDeleteContact = async (clientId: string) => {
    if (!agentId) return;
    if (!window.confirm('Are you sure you want to permanently delete this contact and all its history? This cannot be undone.')) {
      return;
    }

    try {
      await deleteAdminContact(clientId);
      setContacts(prev => prev.filter(c => c.clientId !== clientId));
      setTotalCount(prev => prev - 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete contact.');
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
    if (!agentId) return;
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
      const res = await getAdminContacts({
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
          onClick={() => { setActiveTab('recent'); setPage(1); }}
          style={{
            background: 'none', border: 'none', padding: '0.75rem 1.5rem', cursor: 'pointer',
            fontSize: '1rem', fontWeight: 700, color: activeTab === 'recent' ? '#4f46e5' : '#64748b',
            borderBottom: activeTab === 'recent' ? '3px solid #4f46e5' : '3px solid transparent',
            marginBottom: '-2px', transition: 'all 0.2s'
          }}
        >
          🕒 Recent Activity
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
            onChange={(e) => { setDateFilter(e.target.value as 'all' | 'today' | 'yesterday' | 'custom'); setPage(1); }}
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

      {/* Sorting Controls for Worklist Tab */}
      {activeTab === 'worklist' && !loading && contacts.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem', gap: '0.5rem', zIndex: 10, position: 'relative' }}>
          <select value={sortBy || ''} onChange={e => { setSortBy(e.target.value); setPage(1); }} style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', background: 'white', fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>
            <option value="">Sort By...</option>
            <option value="name">Name</option>
            <option value="status">Stage</option>
            <option value="followupdate">Follow-up Date</option>
            <option value="lastupdated">Last Updated Date</option>
          </select>
          <select value={sortOrder || 'asc'} onChange={e => { setSortOrder(e.target.value as 'asc' | 'desc'); setPage(1); }} style={{ padding: '0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', background: 'white', fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </div>
      )}

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 40, height: 40, border: '3px solid #e2e8f0', borderTopColor: '#4f46e5', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        </div>
      ) : activeTab === 'worklist' ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {contacts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b', background: 'white', borderRadius: '12px', border: '1px dashed #cbd5e1' }}>
              No contacts found for the selected filters.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: '1.25rem', paddingBottom: '1rem', overflowY: 'auto', flex: 1 }}>
              {contacts.map(c => {
                const pInfo = panchayatsData.find(p => p.id === c.panchayatId);
                return (
                  <WorklistCard
                    key={c.clientId}
                    contact={c}
                    panchayatName={pInfo?.name}
                    blockName={pInfo?.block}
                    onEdit={() => setEditDrawerContact(c)}
                    onViewHistory={() => setHistoryModalContact(c)}
                    onQuickFollowUp={(days) => {
                      const nextDate = new Date();
                      nextDate.setDate(nextDate.getDate() + days);
                      handleSaveContact({ ...c, followUpDate: nextDate.toISOString(), status: 'FollowUp' });
                    }}
                  />
                );
              })}
            </div>
          )}
          {/* Pagination */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', marginTop: 'auto', background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px rgba(0,0,0,0.02)' }}>
            <span style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 600 }}>
              {totalCount === 0 ? 'No contacts' : `Page ${page} of ${totalPages} · ${totalCount} total`}
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                style={{ background: 'white', color: page <= 1 ? '#cbd5e1' : '#0f172a', border: '1px solid #e2e8f0', padding: '0.4rem 0.9rem', borderRadius: '6px', fontWeight: 600, fontSize: '0.85rem', cursor: page <= 1 ? 'not-allowed' : 'pointer' }}
              >
                Previous
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                style={{ background: 'white', color: page >= totalPages ? '#cbd5e1' : '#0f172a', border: '1px solid #e2e8f0', padding: '0.4rem 0.9rem', borderRadius: '6px', fontWeight: 600, fontSize: '0.85rem', cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px rgba(0,0,0,0.02)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ overflowX: 'auto', flex: 1 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <SortableHeader label="Contact Details" columnKey="name" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={(k, o) => { setSortBy(k); setSortOrder(o); setPage(1); }} />
                  <SortableHeader label="Location (Village)" columnKey="location" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={(k, o) => { setSortBy(k); setSortOrder(o); setPage(1); }} />
                  <SortableHeader label="Stage (Result)" columnKey="status" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={(k, o) => { setSortBy(k); setSortOrder(o); setPage(1); }} width="160px" />
                  {activeTab === 'recent' && (
                    <SortableHeader label="Follow-up Date" columnKey="followupdate" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={(k, o) => { setSortBy(k); setSortOrder(o); setPage(1); }} />
                  )}
                  <SortableHeader label="Added By" columnKey="addedby" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={(k, o) => { setSortBy(k); setSortOrder(o); setPage(1); }} />
                  <SortableHeader label="Last Updated" columnKey="lastupdated" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={(k, o) => { setSortBy(k); setSortOrder(o); setPage(1); }} />
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
                      showStageAndFollowUp={true}
                      showComments={false}
                      onEdit={() => setEditDrawerContact(c)}
                      onViewHistory={() => setHistoryModalContact(c)}
                      onDelete={() => handleDeleteContact(c.clientId)}
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
        {historyModalContact && (
          <HistoryModal
            contact={historyModalContact}
            onClose={() => setHistoryModalContact(null)}
          />
        )}
      </AnimatePresence>

      {/* Edit Contact Drawer */}
      <AnimatePresence>
        {editDrawerContact && (
          <EditContactDrawer
            contact={editDrawerContact}
            onClose={() => setEditDrawerContact(null)}
            onSave={(updated) => {
              handleSaveContact(updated);
              setEditDrawerContact(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// -------------------------------------------------------------------------------------------------
// Worklist Card Component (For Modern Worklist UI)
// -------------------------------------------------------------------------------------------------
function WorklistCard({ contact, panchayatName, blockName, onEdit, onViewHistory, onQuickFollowUp }: { contact: Contact, panchayatName?: string, blockName?: string, onEdit: () => void, onViewHistory: () => void, onQuickFollowUp: (days: number) => void }) {
  const statusColor = contact.status === 'Lead' ? '#94a3b8' :
                      contact.status === 'Contacted' ? '#eab308' :
                      contact.status === 'FollowUp' ? '#3b82f6' :
                      contact.status === 'Converted' ? '#22c55e' : '#ef4444';
  
  const lastUpdatedTime = contact.lastUpdatedAt
    ? new Date(contact.lastUpdatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' }) + ' IST'
    : 'Never';
  const lastUpdatedBy = contact.lastUpdatedBy || 'N/A';

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2, boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)' }}
      style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem', transition: 'all 0.2s' }}
    >
       {/* Top Row: Name and Status */}
       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
         <div>
           <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>{contact.name}</h3>
           <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600, display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.25rem' }}>
             <span>{contact.role.replace('_', ' ')}</span>
             {contact.phone && <><span style={{color: '#cbd5e1'}}>•</span><span style={{color: '#4f46e5'}}>{contact.phone}</span></>}
           </div>
         </div>
         <span style={{ background: `${statusColor}15`, color: statusColor, padding: '0.25rem 0.6rem', borderRadius: '20px', fontWeight: 700, fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
           {contact.status}
         </span>
       </div>
       
       {/* Details: Location and Follow-up */}
       <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', background: '#f8fafc', padding: '0.75rem', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
         <div style={{ flex: 1, minWidth: '100px' }}>
           <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 700, marginBottom: '0.25rem' }}>Location</div>
           <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>{panchayatName || '-'}</div>
           <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{blockName || '-'} Block</div>
         </div>
         <div style={{ flex: 1, minWidth: '100px' }}>
           <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 700, marginBottom: '0.25rem' }}>Follow Up Date</div>
           <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>{contact.followUpDate ? new Date(contact.followUpDate).toLocaleDateString('en-GB') : '-'}</div>
         </div>
       </div>

       {/* Comments / Issues */}
       {(contact.comments || contact.complaints || contact.conflicts) && (
         <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
           {contact.comments && (
             <div style={{ fontSize: '0.85rem', color: '#475569', background: '#f1f5f9', padding: '0.5rem 0.75rem', borderRadius: '6px', borderLeft: '3px solid #cbd5e1' }}>
               <strong style={{ display: 'block', fontSize: '0.65rem', textTransform: 'uppercase', color: '#64748b', marginBottom: '0.1rem' }}>Comment</strong>
               {contact.comments}
             </div>
           )}
           {contact.complaints && (
             <div style={{ fontSize: '0.85rem', color: '#b91c1c', background: '#fef2f2', padding: '0.5rem 0.75rem', borderRadius: '6px', borderLeft: '3px solid #ef4444' }}>
               <strong style={{ display: 'block', fontSize: '0.65rem', textTransform: 'uppercase', color: '#ef4444', marginBottom: '0.1rem' }}>Issue</strong>
               {contact.complaints}
             </div>
           )}
           {contact.conflicts && (
             <div style={{ fontSize: '0.85rem', color: '#c2410c', background: '#fff7ed', padding: '0.5rem 0.75rem', borderRadius: '6px', borderLeft: '3px solid #f97316' }}>
               <strong style={{ display: 'block', fontSize: '0.65rem', textTransform: 'uppercase', color: '#f97316', marginBottom: '0.1rem' }}>Conflict</strong>
               {contact.conflicts}
             </div>
           )}
         </div>
       )}

       {/* Updates Info */}
       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: '#64748b' }}>
         <div>Updated: {lastUpdatedTime}</div>
         <div>By: {lastUpdatedBy}</div>
       </div>

       {/* Actions */}
       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid #e2e8f0' }}>
         <div style={{ display: 'flex', gap: '0.5rem' }}>
           <button onClick={onEdit} style={{ background: '#f1f5f9', color: '#0f172a', border: '1px solid #e2e8f0', padding: '0.4rem 0.75rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', fontSize: '0.75rem', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#e2e8f0'} onMouseLeave={e => e.currentTarget.style.background = '#f1f5f9'}>Update</button>
           <button onClick={onViewHistory} style={{ background: 'transparent', color: '#4f46e5', border: '1px solid #4f46e5', padding: '0.4rem 0.75rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', fontSize: '0.75rem' }}>History</button>
           <Link href={`/admin/pipeline/${contact.clientId}`} style={{ background: '#0f172a', color: 'white', border: 'none', padding: '0.4rem 0.75rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', fontSize: '0.75rem', textDecoration: 'none' }}>
             Profile
           </Link>
         </div>
         <div style={{ display: 'flex', gap: '0.25rem' }}>
           <button onClick={() => onQuickFollowUp(1)} title="Follow up tomorrow" style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '0.3rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}>+1 Day</button>
           <button onClick={() => onQuickFollowUp(7)} title="Follow up next week" style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '0.3rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}>+1 Wk</button>
         </div>
       </div>
    </motion.div>
  );
}

// -------------------------------------------------------------------------------------------------
// Contact Row Component (Handles inline editing state)
// -------------------------------------------------------------------------------------------------
function ContactRow({ contact, panchayatName, blockName, showStageAndFollowUp, showComments, onEdit, onViewHistory, onQuickFollowUp, showQuickActions, onDelete }: { contact: Contact, panchayatName?: string, blockName?: string, showStageAndFollowUp: boolean, showComments: boolean, onEdit: () => void, onViewHistory: () => void, onQuickFollowUp?: (days: number) => void, showQuickActions?: boolean, onDelete?: () => void }) {
  // Format last updated IST time
  const lastUpdatedTime = contact.lastUpdatedAt
    ? new Date(contact.lastUpdatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' }) + ' IST'
    : 'Never';
  const lastUpdatedBy = contact.lastUpdatedBy || 'N/A';

  const statusColor = contact.status === 'Lead' ? '#94a3b8' :
                      contact.status === 'Contacted' ? '#eab308' :
                      contact.status === 'FollowUp' ? '#3b82f6' :
                      contact.status === 'Converted' ? '#22c55e' : '#ef4444';

  return (
    <tr style={{ borderBottom: '1px solid #e2e8f0', background: 'white', transition: 'background 0.2s' }}>
      <td style={{ padding: '1rem' }}>
        <div style={{ fontWeight: 700, color: '#0f172a' }}>{contact.name}</div>
        <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, textTransform: 'capitalize', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span>{contact.role.replace('_', ' ')}</span>
          {contact.phone && (
            <>
              <span style={{ color: '#cbd5e1' }}>•</span>
              <span style={{ color: '#4f46e5' }}>{contact.phone}</span>
            </>
          )}
        </div>
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
            <span style={{ 
              background: `${statusColor}20`, color: statusColor, 
              padding: '0.25rem 0.75rem', borderRadius: '20px', fontWeight: 700, fontSize: '0.8rem' 
            }}>
              {contact.status}
            </span>
          </td>
          <td style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.85rem', color: '#334155', fontWeight: 600 }}>
              {contact.followUpDate ? new Date(contact.followUpDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}
            </div>
          </td>
        </>
      )}
      <td style={{ padding: '1rem' }}>
        <div style={{ fontWeight: 600, color: '#334155', fontSize: '0.85rem' }}>{contact.agentName || contact.agentId || 'Agent'}</div>
        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{new Date(contact.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
      </td>
      {showComments && (
        <>
          <td style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.85rem', color: '#475569', maxWidth: '250px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={contact.comments || ''}>
              {contact.comments || '-'}
            </div>
          </td>
          <td style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.85rem', color: '#ef4444', maxWidth: '150px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }} title={contact.complaints || ''}>
              {contact.complaints || '-'}
            </div>
          </td>
          <td style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.85rem', color: '#f97316', maxWidth: '150px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }} title={contact.conflicts || ''}>
              {contact.conflicts || '-'}
            </div>
          </td>
        </>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
            <button onClick={onEdit} style={{ background: 'transparent', color: '#0f172a', border: '1px solid #e2e8f0', padding: '0.4rem 0.8rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem', boxShadow: '0 1px 2px rgba(0,0,0,0.05)', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              Update
            </button>
            <Link href={`/admin/pipeline/${contact.clientId}`} style={{ background: '#0f172a', color: 'white', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem', textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
              Profile
            </Link>
            {onDelete && (
              <button onClick={onDelete} style={{ background: 'transparent', color: '#ef4444', border: '1px solid #fecaca', padding: '0.4rem 0.8rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem', boxShadow: '0 1px 2px rgba(0,0,0,0.05)', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                Delete
              </button>
            )}
          </div>
          {showQuickActions && onQuickFollowUp && (
            <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.25rem' }}>
              <button onClick={() => onQuickFollowUp(1)} title="Follow up tomorrow" style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}>
                +1 Day
              </button>
              <button onClick={() => onQuickFollowUp(7)} title="Follow up next week" style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}>
                +1 Wk
              </button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// -------------------------------------------------------------------------------------------------
// History Modal Component
// -------------------------------------------------------------------------------------------------
function HistoryModal({ contact, onClose }: { contact: Contact, onClose: () => void }) {
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
                <div style={{ padding: '0.75rem', color: '#94a3b8', fontSize: '0.85rem', textAlign: 'center' }}>No options</div>
              ) : (
                <div style={{ padding: '0.5rem' }}>
                  {options.map(opt => (
                    <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', cursor: 'pointer', borderRadius: '4px' }} onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <input 
                        type="checkbox" 
                        checked={selected.includes(opt)}
                        onChange={(e) => {
                          if (e.target.checked) onChange([...selected, opt]);
                          else onChange(selected.filter(s => s !== opt));
                        }}
                        style={{ cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '0.85rem', color: '#334155', fontWeight: 500 }}>{opt}</span>
                    </label>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------------------------------
// Edit Contact Drawer Component
// -------------------------------------------------------------------------------------------------
function EditContactDrawer({ contact, onClose, onSave }: { contact: Contact, onClose: () => void, onSave: (c: Contact) => void }) {
  const [editStatus, setEditStatus] = useState(contact.status || 'Lead');
  const [editFollowUp, setEditFollowUp] = useState(contact.followUpDate ? new Date(contact.followUpDate).toISOString().split('T')[0] : '');
  const [editComments, setEditComments] = useState(contact.comments || '');
  const [editComplaints, setEditComplaints] = useState(contact.complaints || '');
  const [editConflicts, setEditConflicts] = useState(contact.conflicts || '');

  const hasChanges = editStatus !== contact.status || 
                     editFollowUp !== (contact.followUpDate ? new Date(contact.followUpDate).toISOString().split('T')[0] : '') ||
                     editComments !== (contact.comments || '') ||
                     editComplaints !== (contact.complaints || '') ||
                     editConflicts !== (contact.conflicts || '');

  const handleSave = () => {
    onSave({
      ...contact,
      status: editStatus,
      followUpDate: editFollowUp ? new Date(editFollowUp).toISOString() : null,
      comments: editComments,
      complaints: editComplaints,
      conflicts: editConflicts
    });
  };

  return (
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
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Stage (Result)</label>
            <select 
              value={editStatus} 
              onChange={e => setEditStatus(e.target.value)}
              style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', background: 'white', fontWeight: 600, fontSize: '0.9rem', color: '#0f172a' }}
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
  );
}
