'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAgentStore } from '@/store/agent-store';
import { getAdminContacts, updateAdminContact, deleteAdminContact, getPanchayats, type AdminContactDto, type PanchayatDto, type ContactUpdateRequest } from '@/lib/sync/api-client';
import EditContactDrawer from '@/components/admin/EditContactDrawer';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FilterDrawer } from './components/FilterDrawer';
import { DailyQueue } from './components/DailyQueue';
import { KanbanBoard } from './components/KanbanBoard';
import { ContactRow } from './components/ContactRow';
import { HistoryModal } from './components/HistoryModal';

const PAGE_SIZE = 10;
const EXPORT_PAGE_SIZE = 2000;

function SortableHeader({ label, columnKey, currentSortBy, currentSortOrder, onSort, width }: { label: string, columnKey: string, currentSortBy?: string, currentSortOrder?: 'asc' | 'desc', onSort: (key: string, order: 'asc' | 'desc') => void, width?: string }) {
  const isActive = currentSortBy === columnKey;
  
  const handleClick = () => {
    if (!isActive) {
      onSort(columnKey, 'asc');
    } else if (currentSortOrder === 'asc') {
      onSort(columnKey, 'desc');
    } else {
      onSort(columnKey, 'asc');
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
  const pinnedContactIds = useAgentStore((s) => s.pinnedContactIds || []);
  const togglePinContact = useAgentStore((s) => s.togglePinContact);
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'daily_queue' | 'worklist' | 'recent' | 'historical'>('daily_queue');
  const [queueGoal, setQueueGoal] = useState<number>(100);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [historyModalContact, setHistoryModalContact] = useState<AdminContactDto | null>(null);
  const [editDrawerContact, setEditDrawerContact] = useState<AdminContactDto | null>(null);
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'yesterday' | 'custom'>('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [sortBy, setSortBy] = useState<string | undefined>('followupdate');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | undefined>('asc');
  const [showEscalatedOnly, setShowEscalatedOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [selectedBlocks, setSelectedBlocks] = useState<string[]>([]);
  const [selectedPanchayats, setSelectedPanchayats] = useState<string[]>([]);

  useEffect(() => {
    if (activeTab === 'worklist') {
      setSortBy('followupdate');
      setSortOrder('asc');
    } else if (activeTab === 'daily_queue') {
      setSortBy('lastupdated');
      setSortOrder('asc');
    } else {
      setSortBy('lastupdated');
      setSortOrder('desc');
    }
    setPage(1);
  }, [activeTab]);

  const { data: panchayatsData = [] } = useQuery({
    queryKey: ['panchayats'],
    queryFn: () => getPanchayats() as Promise<PanchayatDto[]>,
    enabled: !!agentId,
    staleTime: 1000 * 60 * 60,
  });

  const queryFilters = React.useMemo(() => {
    let startDate: string | undefined = undefined;
    let endDate: string | undefined = undefined;
    const now = new Date();
    if (dateFilter === 'today') {
      const start = new Date(now); start.setHours(0, 0, 0, 0); startDate = start.toISOString();
      const end = new Date(now); end.setHours(23, 59, 59, 999); endDate = end.toISOString();
    } else if (dateFilter === 'yesterday') {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      const start = new Date(y); start.setHours(0, 0, 0, 0); startDate = start.toISOString();
      const end = new Date(y); end.setHours(23, 59, 59, 999); endDate = end.toISOString();
    } else if (dateFilter === 'custom') {
      if (customStartDate) startDate = new Date(customStartDate + 'T00:00:00').toISOString();
      if (customEndDate) endDate = new Date(customEndDate + 'T23:59:59.999').toISOString();
    }

    const isWorklist = activeTab === 'worklist';
    const isDailyQueue = activeTab === 'daily_queue';
    const isRecent = activeTab === 'recent';
    
    let maxFollowUpDate: string | undefined = undefined;
    if (isWorklist || isDailyQueue) {
       const d = new Date(); d.setHours(23,59,59,999); maxFollowUpDate = d.toISOString();
    }

    let updatedAfter: string | undefined = undefined;
    if (isRecent) {
       const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(0,0,0,0); updatedAfter = d.toISOString();
    }

    return {
      page,
      // Pass a very large size for Kanban so we don't truncate cards; use standard pagination for list view
      pageSize: isDailyQueue ? queueGoal : (isWorklist ? EXPORT_PAGE_SIZE : PAGE_SIZE),
      districts: selectedCities,
      blocks: selectedBlocks,
      panchayats: selectedPanchayats,
      statuses: isDailyQueue ? ['Lead', 'FollowUp'] : (isWorklist ? ['Lead', 'Contacted', 'FollowUp'] : undefined),
      startDate,
      endDate,
      maxFollowUpDate,
      updatedAfter,
      agentEscalated: showEscalatedOnly ? true : undefined,
      searchQuery: searchQuery.trim() || undefined,
      sortBy,
      sortOrder,
    };
  }, [page, activeTab, dateFilter, customStartDate, customEndDate, selectedCities, selectedBlocks, selectedPanchayats, showEscalatedOnly, searchQuery, sortBy, sortOrder, queueGoal]);

  const { data, isLoading: loading, error: queryError } = useQuery({
    queryKey: ['admin-contacts', queryFilters],
    queryFn: () => getAdminContacts(queryFilters),
    enabled: !!agentId,
    staleTime: 1000 * 60 * 5,
  });

  const contacts = data?.items || [];
  const totalCount = data?.totalCount || 0;
  const [error, setError] = useState('');
  
  useEffect(() => {
    if (queryError) setError(queryError.message);
    else setError('');
  }, [queryError]);

  const saveContactMutation = useMutation({
    mutationFn: ({ clientId, update }: { clientId: string, update: ContactUpdateRequest }) => updateAdminContact(clientId, update),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-contacts'] });
    },
    onError: (err: Error) => setError(err.message || 'Failed to save changes.')
  });

  const handleSaveContact = async (clientId: string, update: ContactUpdateRequest) => {
    if (!agentId) return;
    saveContactMutation.mutate({ clientId, update });
  };

  const deleteContactMutation = useMutation({
    mutationFn: (clientId: string) => deleteAdminContact(clientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-contacts'] });
    },
    onError: (err: Error) => setError(err.message || 'Failed to delete contact.')
  });

  const handleDeleteContact = async (clientId: string) => {
    if (!agentId) return;
    if (!window.confirm('Are you sure you want to permanently delete this contact and all its history? This cannot be undone.')) {
      return;
    }
    deleteContactMutation.mutate(clientId);
  };

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

  const currentPageSize = activeTab === 'worklist' ? EXPORT_PAGE_SIZE : PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(totalCount / currentPageSize));

  useEffect(() => {
    if (totalPages > 0 && page > totalPages) {
      setPage(totalPages);
    }
  }, [totalPages, page]);

  const exportToCsv = async () => {
    if (!agentId) return;
    setExporting(true);
    setError('');

    let startDate: string | undefined = undefined;
    let endDate: string | undefined = undefined;
    const now = new Date();
    if (dateFilter === 'today') {
      const start = new Date(now); start.setHours(0, 0, 0, 0); startDate = start.toISOString();
      const end = new Date(now); end.setHours(23, 59, 59, 999); endDate = end.toISOString();
    } else if (dateFilter === 'yesterday') {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      const start = new Date(y); start.setHours(0, 0, 0, 0); startDate = start.toISOString();
      const end = new Date(y); end.setHours(23, 59, 59, 999); endDate = end.toISOString();
    } else if (dateFilter === 'custom') {
      if (customStartDate) startDate = new Date(customStartDate + 'T00:00:00').toISOString();
      if (customEndDate) endDate = new Date(customEndDate + 'T23:59:59.999').toISOString();
    }

    try {
      const isWorklist = activeTab === 'worklist';
      const isDailyQueue = activeTab === 'daily_queue';
      const isRecent = activeTab === 'recent';
      
      let maxFollowUpDate: string | undefined = undefined;
      if (isWorklist || isDailyQueue) {
         const d = new Date(); d.setHours(23,59,59,999); maxFollowUpDate = d.toISOString();
      }

      let updatedAfter: string | undefined = undefined;
      if (isRecent) {
         const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(0,0,0,0); updatedAfter = d.toISOString();
      }

      const res = await getAdminContacts({
        page: 1,
        pageSize: EXPORT_PAGE_SIZE,
        districts: selectedCities,
        blocks: selectedBlocks,
        panchayats: selectedPanchayats,
        statuses: isDailyQueue ? ['Lead', 'FollowUp'] : (isWorklist ? ['Lead', 'Contacted', 'FollowUp'] : undefined),
        startDate,
        endDate,
        maxFollowUpDate,
        updatedAfter,
        agentEscalated: showEscalatedOnly ? true : undefined,
        searchQuery: searchQuery.trim() || undefined,
        sortBy,
        sortOrder,
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
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0, width: '100%' }}>
      <style>{`
        @media (max-width: 768px) {
          .responsive-table, .responsive-table thead, .responsive-table tbody, .responsive-table th, .responsive-table td, .responsive-table tr {
            display: block;
          }
          .responsive-table thead tr {
            display: none;
          }
          .responsive-table tr {
            margin-bottom: 1rem;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            background: white;
            padding: 0.5rem;
          }
          .responsive-table td {
            border: none !important;
            border-bottom: 1px solid #f1f5f9 !important;
            position: relative;
            padding: 0.75rem 1rem !important;
          }
          .responsive-table td::before {
            content: attr(data-label);
            display: block;
            font-size: 0.7rem;
            text-transform: uppercase;
            color: #64748b;
            font-weight: 700;
            margin-bottom: 0.25rem;
          }
          .responsive-table td:last-child {
            border-bottom: none !important;
          }
        }
      `}</style>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', padding: '0.75rem 1.25rem' }}>
          <div style={{ width: 44, height: 44, borderRadius: '10px', background: 'rgba(79,70,229,0.1)', color: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem', flexShrink: 0 }}>
            👥
          </div>
          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Total Added
              {activeTab === 'worklist' ? ' — Worklist' : activeTab === 'recent' ? ' — Recent Activity' : ' — Historical'}
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>{loading ? '…' : totalCount.toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '1rem', borderBottom: '2px solid #e2e8f0', marginBottom: '1.5rem', overflowX: 'auto', whiteSpace: 'nowrap', paddingBottom: '2px' }}>
        <button
          onClick={() => { setActiveTab('daily_queue'); setPage(1); setSortBy('lastupdated'); setSortOrder('asc'); }}
          style={{
            background: 'none', border: 'none', padding: '0.75rem 1.5rem', cursor: 'pointer',
            fontSize: '1rem', fontWeight: 700, color: activeTab === 'daily_queue' ? '#4f46e5' : '#64748b',
            borderBottom: activeTab === 'daily_queue' ? '3px solid #4f46e5' : '3px solid transparent',
            marginBottom: '-2px', transition: 'all 0.2s'
          }}
        >
          ☎️ Daily Queue
        </button>
        <button
          onClick={() => { setActiveTab('worklist'); setPage(1); setSortBy('followupdate'); setSortOrder('asc'); }}
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
          onClick={() => { setActiveTab('recent'); setPage(1); setSortBy('lastupdated'); setSortOrder('desc'); }}
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
          onClick={() => { setActiveTab('historical'); setPage(1); setSortBy('lastupdated'); setSortOrder('desc'); }}
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

      <FilterDrawer 
        dateFilter={dateFilter} setDateFilter={setDateFilter}
        customStartDate={customStartDate} setCustomStartDate={setCustomStartDate}
        customEndDate={customEndDate} setCustomEndDate={setCustomEndDate}
        selectedCities={selectedCities} setSelectedCities={setSelectedCities} uniqueCities={uniqueCities}
        selectedBlocks={selectedBlocks} setSelectedBlocks={setSelectedBlocks} uniqueBlocks={uniqueBlocks}
        selectedPanchayats={selectedPanchayats} setSelectedPanchayats={setSelectedPanchayats} uniquePanchayats={uniquePanchayats}
        searchQuery={searchQuery} setSearchQuery={setSearchQuery}
        showEscalatedOnly={showEscalatedOnly} setShowEscalatedOnly={setShowEscalatedOnly}
        setPage={setPage}
      />

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
      ) : activeTab === 'daily_queue' ? (
        <DailyQueue 
          contacts={contacts} 
          queueGoal={queueGoal} 
          setQueueGoal={setQueueGoal} 
          setPage={setPage} 
          panchayatsData={panchayatsData} 
          saveContactMutation={saveContactMutation} 
        />
      ) : activeTab === 'worklist' ? (
        <KanbanBoard 
          contacts={contacts} 
          panchayatsData={panchayatsData} 
          saveContactMutation={saveContactMutation} 
          setEditDrawerContact={setEditDrawerContact} 
        />
      ) : (
        <div style={{ flex: 1, background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px rgba(0,0,0,0.02)', overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0, maxWidth: '100%' }}>
          {contacts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
              No contacts found for the selected filters.
            </div>
          ) : (
            <div style={{ overflowX: 'auto', flex: 1, maxWidth: '100%' }}>
              <table className="responsive-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 10 }}>
                  <tr>
                    <SortableHeader label="Contact Details" columnKey="name" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={(k, o) => { setSortBy(k); setSortOrder(o); setPage(1); }} />
                    <SortableHeader label="Location (Village)" columnKey="location" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={(k, o) => { setSortBy(k); setSortOrder(o); setPage(1); }} />
                    {activeTab === 'recent' && (
                      <>
                        <SortableHeader label="Stage (Result)" columnKey="status" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={(k, o) => { setSortBy(k); setSortOrder(o); setPage(1); }} width="160px" />
                        <SortableHeader label="Follow-up Date" columnKey="followupdate" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={(k, o) => { setSortBy(k); setSortOrder(o); setPage(1); }} />
                      </>
                    )}
                    <SortableHeader label="Added By" columnKey="addedby" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={(k, o) => { setSortBy(k); setSortOrder(o); setPage(1); }} />
                    {activeTab === 'historical' && (
                      <>
                        <SortableHeader label="Comments" columnKey="comments" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={(k, o) => { setSortBy(k); setSortOrder(o); setPage(1); }} />
                        <SortableHeader label="Issues" columnKey="complaints" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={(k, o) => { setSortBy(k); setSortOrder(o); setPage(1); }} />
                        <SortableHeader label="Conflicts" columnKey="conflicts" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={(k, o) => { setSortBy(k); setSortOrder(o); setPage(1); }} />
                      </>
                    )}
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
                        showStageAndFollowUp={activeTab === 'recent'}
                        showComments={activeTab === 'historical'}
                        showQuickActions={false}
                        onEdit={() => setEditDrawerContact(c)}
                        onViewHistory={() => setHistoryModalContact(c)}
                        onLogCall={(reason) => {
                          const update: ContactUpdateRequest = {
                            status: 'FollowUp',
                            comments: `${c.comments ? c.comments + '\n' : ''}[Call Attempt: ${reason}]`
                          };
                          if (reason === 'Invalid Number') {
                            update.clearFollowUpDate = true;
                          } else {
                            const nextDate = new Date();
                            nextDate.setDate(nextDate.getDate() + 1);
                            update.followUpDate = nextDate.toISOString();
                          }
                          handleSaveContact(c.clientId, update);
                        }}
                        onDelete={() => handleDeleteContact(c.clientId)}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

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
      {editDrawerContact && (
        <EditContactDrawer
          contact={editDrawerContact}
          panchayats={panchayatsData}
          isOpen={true}
          onClose={() => setEditDrawerContact(null)}
          onSave={(update) => {
            handleSaveContact(editDrawerContact.clientId, update);
            setEditDrawerContact(null);
          }}
        />
      )}
    </div>
  );
}
