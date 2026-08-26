'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useAgentStore } from '@/store/agent-store';
import { Pin, FilterIcon } from 'lucide-react';
import { getAdminContacts, updateAdminContact, deleteAdminContact, getContactHistory, getPanchayats, type AdminContactDto, type ContactHistoryEntryDto, type PanchayatDto, type ContactUpdateRequest } from '@/lib/sync/api-client';
import EditContactDrawer from '@/components/admin/EditContactDrawer';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// The columns for our statuses
const STATUSES = ['Lead', 'Contacted', 'FollowUp', 'Converted', 'Closed'];
const PAGE_SIZE = 10;
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
  const pinnedContactIds = useAgentStore((s) => s.pinnedContactIds || []);
  const togglePinContact = useAgentStore((s) => s.togglePinContact);

  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'daily_queue' | 'worklist' | 'recent' | 'historical'>('daily_queue');
  const [queueGoal, setQueueGoal] = useState<number>(100);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [historyModalContact, setHistoryModalContact] = useState<Contact | null>(null);
  const [editDrawerContact, setEditDrawerContact] = useState<Contact | null>(null);
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'yesterday' | 'custom'>('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [sortBy, setSortBy] = useState<string | undefined>('followupdate');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | undefined>('asc');

  useEffect(() => {
    if (activeTab === 'worklist') {
      setSortBy('followupdate');
      setSortOrder('asc');
    } else if (activeTab === 'daily_queue') {
      setSortBy('lastupdated');
      setSortOrder('asc'); // Oldest first for round-robin
    } else {
      setSortBy('lastupdated');
      setSortOrder('desc');
    }
    setPage(1);
  }, [activeTab]);
  const [showEscalatedOnly, setShowEscalatedOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [draggedContactId, setDraggedContactId] = useState<string | null>(null);
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);

  // Filter States
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [selectedBlocks, setSelectedBlocks] = useState<string[]>([]);
  const [selectedPanchayats, setSelectedPanchayats] = useState<string[]>([]);

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
      pageSize: isDailyQueue ? queueGoal : (isWorklist ? 200 : PAGE_SIZE),
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
  }, [page, activeTab, dateFilter, customStartDate, customEndDate, selectedCities, selectedBlocks, selectedPanchayats, showEscalatedOnly, searchQuery, sortBy, sortOrder]);

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
    onError: (err: any) => setError(err.message || 'Failed to save changes.')
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
    onError: (err: any) => setError(err.message || 'Failed to delete contact.')
  });

  const handleDeleteContact = async (clientId: string) => {
    if (!agentId) return;
    if (!window.confirm('Are you sure you want to permanently delete this contact and all its history? This cannot be undone.')) {
      return;
    }
    deleteContactMutation.mutate(clientId);
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

  const currentPageSize = activeTab === 'worklist' ? 200 : PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(totalCount / currentPageSize));

  useEffect(() => {
    if (totalPages > 0 && page > totalPages) {
      setPage(totalPages);
    }
  }, [totalPages, page]);

  const sortedContacts = React.useMemo(() => {
    return [...contacts].sort((a, b) => {
      const aPinned = pinnedContactIds.includes(a.clientId);
      const bPinned = pinnedContactIds.includes(b.clientId);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return 0;
    });
  }, [contacts, pinnedContactIds]);

  const exportToCsv = async () => {
    if (!agentId) return;
    setExporting(true);
    setError('');

    let startDate: string | undefined = undefined;
    let endDate: string | undefined = undefined;
    const now = new Date();
    if (dateFilter === 'today') {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      startDate = start.toISOString();
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      endDate = end.toISOString();
    } else if (dateFilter === 'yesterday') {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const start = new Date(y);
      start.setHours(0, 0, 0, 0);
      startDate = start.toISOString();
      const end = new Date(y);
      end.setHours(23, 59, 59, 999);
      endDate = end.toISOString();
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

  const handleDragStart = (e: React.DragEvent, contactId: string) => {
    e.dataTransfer.setData('text/plain', contactId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedContactId(contactId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    const contactId = e.dataTransfer.getData('text/plain');
    setDraggedContactId(null);
    
    const contact = contacts.find(c => c.clientId === contactId);
    if (!contact || contact.status === newStatus) return;

    saveContactMutation.mutate({ clientId: contactId, update: { status: newStatus } });
  };

  const handleStatusChange = (contactId: string, newStatus: string) => {
    saveContactMutation.mutate({ clientId: contactId, update: { status: newStatus } });
  };

  const renderKanbanBoard = () => {
    const columns = [
      { id: 'Lead', title: 'Leads', color: '#94a3b8' },
      { id: 'Contacted', title: 'Contacted', color: '#eab308' },
      { id: 'FollowUp', title: 'Follow-Up', color: '#3b82f6' }
    ];

    return (
      <div style={{ display: 'flex', gap: '1.5rem', flex: 1, overflowX: 'auto', padding: '1rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', minHeight: '600px' }}>
        {columns.map(col => (
          <div 
            key={col.id} 
            style={{ 
              flex: '0 0 320px', 
              display: 'flex', 
              flexDirection: 'column', 
              background: '#f1f5f9', 
              borderRadius: '12px',
              height: '100%',
              border: '1px solid #e2e8f0'
            }}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, col.id)}
          >
            <div style={{ padding: '1rem', borderBottom: '2px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: col.color }} />
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#1e293b' }}>{col.title}</h3>
              </div>
              <span style={{ background: '#e2e8f0', color: '#64748b', fontSize: '0.75rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '12px' }}>
                {contacts.filter(c => c.status === col.id).length}
              </span>
            </div>
            <div style={{ padding: '0.75rem', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {contacts.filter(c => c.status === col.id).map(c => (
                <KanbanCard 
                  key={c.clientId} 
                  contact={c} 
                  panchayatsData={panchayatsData}
                  isDragging={draggedContactId === c.clientId}
                  onDragStart={(e: any) => handleDragStart(e, c.clientId)}
                  onDragEnd={() => setDraggedContactId(null)}
                  onEdit={() => setEditDrawerContact(c)}
                  onStatusChange={handleStatusChange}
                />
              ))}
              {contacts.filter(c => c.status === col.id).length === 0 && (
                <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#94a3b8', fontSize: '0.85rem', fontWeight: 600, border: '2px dashed #cbd5e1', borderRadius: '8px' }}>
                  Drop contacts here
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };
  const renderDailyQueue = () => {
    if (contacts.length === 0) {
      return (
        <div style={{ textAlign: 'center', padding: '4rem 1rem', background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
          <h2 style={{ fontSize: '2rem', fontWeight: 800, color: '#10b981', marginBottom: '1rem' }}>🎉 Queue Completed!</h2>
          <p style={{ color: '#64748b', fontSize: '1.1rem' }}>You have reached out to all queued contacts for today. Great job!</p>
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white', padding: '1rem 1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>Today's Queue</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
              <p style={{ margin: 0, color: '#64748b', fontSize: '0.85rem', fontWeight: 600 }}>{contacts.length} / {queueGoal} Remaining</p>
              <div style={{ width: '100px', height: '6px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: `${Math.max(0, 100 - (contacts.length / queueGoal) * 100)}%`, height: '100%', background: '#10b981', transition: 'width 0.3s ease' }} />
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#475569' }}>Daily Goal:</label>
            <select
              value={queueGoal}
              onChange={(e) => { setQueueGoal(Number(e.target.value)); setPage(1); }}
              style={{ padding: '0.5rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontWeight: 600, outline: 'none' }}
            >
              <option value={50}>50 Contacts</option>
              <option value={100}>100 Contacts</option>
              <option value={200}>200 Contacts</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {contacts.map(c => {
            const p = panchayatsData.find((p: any) => p.id === c.panchayatId);
            const pInfo = p || { name: 'Unknown', block: 'Unknown' };
            return (
              <div key={c.clientId} style={{ background: 'white', borderRadius: '12px', padding: '1.5rem', border: '1px solid #e2e8f0', display: 'flex', flexWrap: 'wrap', gap: '1.5rem', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                <div>
                  <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.2rem', fontWeight: 800, color: '#0f172a' }}>{c.name}</h3>
                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.9rem', color: '#475569', fontWeight: 600 }}>📞 {c.phone}</span>
                    <span style={{ fontSize: '0.9rem', color: '#64748b' }}>📍 {pInfo.name}, {pInfo.block}</span>
                    <span style={{ fontSize: '0.8rem', background: '#f1f5f9', padding: '0.1rem 0.5rem', borderRadius: '4px', color: '#64748b', fontWeight: 600 }}>Status: {c.status}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <button 
                    onClick={() => saveContactMutation.mutate({ clientId: c.clientId, update: { status: 'Contacted', clearFollowUpDate: true } })}
                    style={{ background: '#10b981', color: 'white', border: 'none', padding: '0.75rem 1.5rem', borderRadius: '8px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: '0 2px 4px rgba(16, 185, 129, 0.2)', transition: 'background 0.2s' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#059669'}
                    onMouseLeave={(e) => e.currentTarget.style.background = '#10b981'}
                  >
                    ✅ Contacted
                  </button>
                  <button 
                    onClick={() => {
                      const tomorrow = new Date();
                      tomorrow.setDate(tomorrow.getDate() + 1);
                      saveContactMutation.mutate({ clientId: c.clientId, update: { status: 'FollowUp', followUpDate: tomorrow.toISOString() } });
                    }}
                    style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '0.75rem 1.5rem', borderRadius: '8px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: '0 2px 4px rgba(59, 130, 246, 0.2)', transition: 'background 0.2s' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#2563eb'}
                    onMouseLeave={(e) => e.currentTarget.style.background = '#3b82f6'}
                  >
                    📅 Call Tomorrow
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0, width: '100%' }}>
      <style>{`
        @media (max-width: 768px) {
          .mobile-only {
            display: block !important;
          }
          .filters-container {
            display: none !important;
          }
          .filters-container.open {
            display: flex !important;
          }
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

      {/* Mobile Filter Toggle */}
      <div className="mobile-only" style={{ marginBottom: '1rem', display: 'none' }}>
        <button
          onClick={() => setIsFilterDrawerOpen(!isFilterDrawerOpen)}
          style={{ width: '100%', padding: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: 600, color: '#334155' }}
        >
          <FilterIcon size={16} />
          {isFilterDrawerOpen ? 'Hide Filters' : 'Show Filters'}
        </button>
      </div>

      {/* Filters Section */}
      <div className={`filters-container ${isFilterDrawerOpen ? 'open' : ''}`} style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap', zIndex: 20, position: 'relative' }}>
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
        <div style={{ flex: 1, minWidth: '200px' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Search</label>
          <input
            type="search"
            placeholder="Name or Phone..."
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
            style={{ width: '100%', padding: '0.7rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', background: 'white', fontWeight: 600, color: '#0f172a' }}
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
        
        {/* Escalation Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: showEscalatedOnly ? '#fef2f2' : 'white', border: `1px solid ${showEscalatedOnly ? '#fca5a5' : '#cbd5e1'}`, padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.2s', marginTop: 'auto' }} onClick={() => { setShowEscalatedOnly(!showEscalatedOnly); setPage(1); }}>
          <div style={{ width: 40, height: 22, background: showEscalatedOnly ? '#ef4444' : '#cbd5e1', borderRadius: 11, position: 'relative', transition: 'background 0.2s' }}>
            <div style={{ position: 'absolute', top: 2, left: showEscalatedOnly ? 20 : 2, width: 18, height: 18, background: 'white', borderRadius: '50%', transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }} />
          </div>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: showEscalatedOnly ? '#b91c1c' : '#475569' }}>
            🚨 Escalations Only
          </span>
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
        renderKanbanBoard()
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

          {/* Pagination — shared across all three tabs */}
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

// -------------------------------------------------------------------------------------------------
// Contact Row Component (Handles inline editing state)
// -------------------------------------------------------------------------------------------------
function ContactRow({ contact, isPinned, onTogglePin, panchayatName, blockName, showStageAndFollowUp, showComments, onEdit, onViewHistory, onLogCall, showQuickActions, onDelete }: { contact: Contact, isPinned?: boolean, onTogglePin?: () => void, panchayatName?: string, blockName?: string, showStageAndFollowUp: boolean, showComments: boolean, onEdit: () => void, onViewHistory: () => void, onLogCall?: (reason: string) => void, showQuickActions?: boolean, onDelete?: () => void }) {
  const lastUpdatedTime = contact.lastUpdatedAt
    ? new Date(contact.lastUpdatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' }) + ' IST'
    : 'Never';
  const lastUpdatedBy = contact.lastUpdatedBy || 'N/A';

  const gapDays = contact.lastUpdatedAt 
    ? Math.floor((new Date().getTime() - new Date(contact.lastUpdatedAt).getTime()) / (1000 * 3600 * 24))
    : null;

  const statusColor = contact.status === 'Lead' ? '#94a3b8' :
                      contact.status === 'Contacted' ? '#eab308' :
                      contact.status === 'FollowUp' ? '#3b82f6' :
                      contact.status === 'Converted' ? '#22c55e' : '#ef4444';

  return (
    <tr style={{ borderBottom: '1px solid #e2e8f0', background: 'white', transition: 'background 0.2s' }}>
      <td data-label="Contact Details" style={{ padding: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '50%', overflow: 'hidden', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {contact.photoUrl ? (
              <img src={contact.photoUrl} alt={contact.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ fontWeight: 700, color: '#64748b', fontSize: '1.2rem' }}>{contact.name.charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ fontWeight: 700, color: '#0f172a' }}>{contact.name}</div>
              <button 
                onClick={onTogglePin} 
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: isPinned ? '#4f46e5' : '#cbd5e1', display: 'flex', alignItems: 'center', padding: '0.1rem' }}
                title={isPinned ? 'Unpin' : 'Pin to top'}
              >
                {isPinned ? <Pin size={16} fill="currentColor" /> : <Pin size={16} />}
              </button>
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, textTransform: 'capitalize', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <span>{contact.role.replace('_', ' ')}</span>
              {contact.phone && (
                <>
                  <span style={{ color: '#cbd5e1' }}>•</span>
                  <span style={{ color: '#4f46e5' }}>{contact.phone}</span>
                </>
              )}
            </div>
            {contact.agentEscalated && (
              <div style={{ marginTop: '0.35rem' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: '0.7rem', fontWeight: 700, padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                  🚨 ESCALATED
                </span>
                {contact.agentEscalationNote && (
                  <div style={{ fontSize: '0.75rem', color: '#991b1b', marginTop: '0.25rem', background: '#fef2f2', padding: '0.35rem 0.5rem', borderRadius: '4px', borderLeft: '3px solid #ef4444' }}>
                    {contact.agentEscalationNote}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </td>
      <td data-label="Location (Village)" style={{ padding: '1rem' }}>
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
          <td data-label="Stage (Result)" style={{ padding: '1rem' }}>
            <span style={{ 
              background: `${statusColor}20`, color: statusColor, 
              padding: '0.25rem 0.75rem', borderRadius: '20px', fontWeight: 700, fontSize: '0.8rem' 
            }}>
              {contact.status}
            </span>
          </td>
          <td data-label="Follow-up Date" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.85rem', color: '#334155', fontWeight: 600 }}>
              {contact.followUpDate ? new Date(contact.followUpDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}
            </div>
          </td>
        </>
      )}
      <td data-label="Added By" style={{ padding: '1rem' }}>
        <div style={{ fontWeight: 600, color: '#334155', fontSize: '0.85rem' }}>{contact.agentName || contact.agentId || 'Agent'}</div>
        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{new Date(contact.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
      </td>
      {showComments && (
        <>
          <td data-label="Comments" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.85rem', color: '#475569', maxWidth: '250px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={contact.comments || ''}>
              {contact.comments || '-'}
            </div>
          </td>
          <td data-label="Issues" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.85rem', color: '#ef4444', maxWidth: '150px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }} title={contact.complaints || ''}>
              {contact.complaints || '-'}
            </div>
          </td>
          <td data-label="Conflicts" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.85rem', color: '#f97316', maxWidth: '150px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }} title={contact.conflicts || ''}>
              {contact.conflicts || '-'}
            </div>
          </td>
        </>
      )}
      <td data-label="Last Updated" style={{ padding: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155' }}>{lastUpdatedTime}</div>
            <div style={{ fontSize: '0.7rem', color: '#64748b' }}>By {lastUpdatedBy}</div>
            {gapDays !== null && (
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: gapDays > 7 ? '#ef4444' : gapDays > 3 ? '#f59e0b' : '#10b981', marginTop: '0.25rem', background: gapDays > 7 ? '#fef2f2' : gapDays > 3 ? '#fffbeb' : '#ecfdf5', padding: '0.1rem 0.3rem', borderRadius: '4px', display: 'inline-block' }}>
                {gapDays === 0 ? 'Updated today' : `${gapDays} days ago`}
              </div>
            )}
          </div>
          <button onClick={onViewHistory} style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '0.25rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, color: '#4f46e5', transition: 'background 0.2s' }}>
            History
          </button>
        </div>
      </td>
      <td data-label="Actions" style={{ padding: '1rem', textAlign: 'center', minWidth: '220px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
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
          {showQuickActions && onLogCall && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.5rem', width: '100%', background: '#f8fafc', padding: '0.5rem', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', textAlign: 'center' }}>Log Unanswered Call</span>
              <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                <button onClick={() => onLogCall('No Answer')} title="Push follow-up to tomorrow" style={{ background: 'white', border: '1px solid #cbd5e1', padding: '0.25rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>No Answer</button>
                <button onClick={() => onLogCall('Busy')} title="Push follow-up to tomorrow" style={{ background: 'white', border: '1px solid #cbd5e1', padding: '0.25rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>Busy</button>
                <button onClick={() => onLogCall('Switched Off')} title="Push follow-up to tomorrow" style={{ background: 'white', border: '1px solid #cbd5e1', padding: '0.25rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>Off</button>
                <button onClick={() => onLogCall('Invalid Number')} title="Remove follow-up date" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '0.25rem 0.4rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#fee2e2'} onMouseLeave={e => e.currentTarget.style.background = '#fef2f2'}>Invalid</button>
              </div>
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
// Kanban Card Component
// -------------------------------------------------------------------------------------------------
function KanbanCard({ contact, panchayatsData, isDragging, onDragStart, onDragEnd, onEdit, onStatusChange }: any) {
  const pInfo = panchayatsData.find((p: any) => p.id === contact.panchayatId);
  const isEscalated = contact.agentEscalated;
  
  return (
    <div 
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={{ 
        background: 'white', 
        borderRadius: '8px', 
        padding: '1rem', 
        boxShadow: isDragging ? '0 8px 16px rgba(0,0,0,0.1)' : '0 1px 3px rgba(0,0,0,0.1)', 
        border: '1px solid #e2e8f0',
        borderLeft: isEscalated ? '4px solid #ef4444' : '1px solid #e2e8f0',
        cursor: 'grab',
        opacity: isDragging ? 0.5 : 1,
        transition: 'box-shadow 0.2s',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#0f172a' }}>{contact.name}</h4>
          <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, textTransform: 'capitalize' }}>{contact.role.replace('_', ' ')}</span>
        </div>
        {contact.photoUrl ? (
          <img src={contact.photoUrl} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8' }}>
            {contact.name.charAt(0)}
          </div>
        )}
      </div>

      <div style={{ fontSize: '0.8rem', color: '#475569', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span>📞</span> {contact.phone || 'No Phone'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span>📍</span> {pInfo ? pInfo.name : 'Unknown Village'}
        </div>
      </div>

      {contact.followUpDate && (
        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.35rem', background: '#f8fafc', padding: '0.25rem 0.5rem', borderRadius: '4px', border: '1px solid #e2e8f0', width: 'fit-content' }}>
          🗓️ Due: {new Date(contact.followUpDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
        </div>
      )}

      {isEscalated && (
        <div style={{ fontSize: '0.7rem', color: '#b91c1c', background: '#fef2f2', padding: '0.25rem 0.5rem', borderRadius: '4px', border: '1px solid #fecaca' }}>
          🚨 {contact.agentEscalationNote || 'Escalated'}
        </div>
      )}

      {/* MOBILE ONLY QUICK ACTIONS */}
      <style>{`
        .kanban-mobile-actions { display: none; }
        @media (max-width: 768px) {
          .kanban-mobile-actions { display: flex; }
        }
      `}</style>
      {onStatusChange && (
        <div className="kanban-mobile-actions" style={{ gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ width: '100%', fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Move to:</span>
          {contact.status !== 'Lead' && (
            <button onClick={() => onStatusChange(contact.clientId, 'Lead')} style={{ flex: 1, padding: '0.35rem', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 600, color: '#475569', cursor: 'pointer' }}>Lead</button>
          )}
          {contact.status !== 'Contacted' && (
            <button onClick={() => onStatusChange(contact.clientId, 'Contacted')} style={{ flex: 1, padding: '0.35rem', background: '#fef9c3', border: '1px solid #fde047', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 600, color: '#854d0e', cursor: 'pointer' }}>Contacted</button>
          )}
          {contact.status !== 'FollowUp' && (
            <button onClick={() => onStatusChange(contact.clientId, 'FollowUp')} style={{ flex: 1, padding: '0.35rem', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 600, color: '#1d4ed8', cursor: 'pointer' }}>Follow-Up</button>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
        <button onClick={onEdit} style={{ flex: 1, padding: '0.35rem', background: 'transparent', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600, color: '#334155', cursor: 'pointer', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
          Edit
        </button>
        <Link href={`/admin/pipeline/${contact.clientId}`} style={{ flex: 1, padding: '0.35rem', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600, color: '#0f172a', textAlign: 'center', textDecoration: 'none', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#e2e8f0'} onMouseLeave={e => e.currentTarget.style.background = '#f1f5f9'}>
          Profile
        </Link>
      </div>
    </div>
  );
}

// --- EOF ---
