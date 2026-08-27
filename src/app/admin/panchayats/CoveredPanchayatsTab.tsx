'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { getCoveredPanchayats, getAdminContacts, type CoveredPanchayatDto, type AdminContactDto } from '@/lib/sync/api-client';

function SortableTh({ label, field, sortField, sortDirection, onSort }: { label: string, field: string, sortField: string, sortDirection: 'asc'|'desc', onSort: (f: string) => void }) {
  return (
    <th 
      onClick={() => onSort(field)}
      style={{ padding: '1rem', fontWeight: 700, color: '#334155', cursor: 'pointer', userSelect: 'none' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
        {label}
        <span style={{ fontSize: '0.75rem', color: sortField === field ? '#4f46e5' : '#cbd5e1' }}>
          {sortField !== field ? '↕' : sortDirection === 'asc' ? '↑' : '↓'}
        </span>
      </div>
    </th>
  );
}

export default function CoveredPanchayatsTab() {
  const [data, setData] = useState<CoveredPanchayatDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [filterDistrict, setFilterDistrict] = useState('');
  const [filterBlock, setFilterBlock] = useState('');

  const [page, setPage] = useState(1);
  const itemsPerPage = 50;
  const [sortField, setSortField] = useState('district');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Drawer state
  const [selectedPanchayat, setSelectedPanchayat] = useState<CoveredPanchayatDto | null>(null);
  const [drawerContacts, setDrawerContacts] = useState<AdminContactDto[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getCoveredPanchayats()
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const uniqueDistricts = useMemo(() => Array.from(new Set(data.map(p => p.district))).sort(), [data]);
  const uniqueBlocks = useMemo(() => Array.from(new Set(data.filter(p => !filterDistrict || p.district === filterDistrict).map(p => p.block))).sort(), [data, filterDistrict]);

  const sortedAndFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let res = data.filter((p) => {
      if (filterDistrict && p.district !== filterDistrict) return false;
      if (filterBlock && p.block !== filterBlock) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.block.toLowerCase().includes(q) || p.district.toLowerCase().includes(q);
    });

    res.sort((a, b) => {
      let aVal = a[sortField as keyof CoveredPanchayatDto] as any;
      let bVal = b[sortField as keyof CoveredPanchayatDto] as any;
      
      if (sortField === 'contactCount') {
         return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
      
      aVal = aVal || '';
      bVal = bVal || '';
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return 0;
    });
    return res;
  }, [data, search, filterDistrict, filterBlock, sortField, sortDirection]);

  const paginated = useMemo(() => {
    return sortedAndFiltered.slice((page - 1) * itemsPerPage, page * itemsPerPage);
  }, [sortedAndFiltered, page]);

  const totalPages = Math.ceil(sortedAndFiltered.length / itemsPerPage);

  useEffect(() => {
    if (totalPages > 0 && page > totalPages) {
      setPage(totalPages);
    }
  }, [totalPages, page]);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const openDrawer = (p: CoveredPanchayatDto) => {
    setSelectedPanchayat(p);
    setDrawerLoading(true);
    setDrawerContacts([]);
    getAdminContacts({ exactPanchayatId: p.id, page: 1, pageSize: 500 })
      .then(res => setDrawerContacts(res.items))
      .catch(e => console.error(e))
      .finally(() => setDrawerLoading(false));
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '2rem' }}>
        {[...Array(5)].map((_, i) => (
          <div key={i} style={{ height: '60px', background: '#f1f5f9', borderRadius: '8px', animation: 'pulse 1.5s infinite ease-in-out' }} />
        ))}
      </div>
    );
  }

  if (error) return <p style={{ color: '#b91c1c' }}>{error}</p>;

  return (
    <div>
      {/* Filter Bar */}
      <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 220px', minWidth: '220px' }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.35rem' }}>Search</label>
          <input
            placeholder="Search by name, block or district..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            style={{ width: '100%', padding: '0.6rem 0.85rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ minWidth: '180px' }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.35rem' }}>District</label>
          <select
            value={filterDistrict}
            onChange={(e) => { setFilterDistrict(e.target.value); setFilterBlock(''); setPage(1); }}
            style={{ width: '100%', padding: '0.6rem 0.85rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', background: 'white' }}
          >
            <option value="">All Districts</option>
            {uniqueDistricts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div style={{ minWidth: '180px' }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.35rem' }}>Block</label>
          <select
            value={filterBlock}
            onChange={(e) => { setFilterBlock(e.target.value); setPage(1); }}
            style={{ width: '100%', padding: '0.6rem 0.85rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', background: 'white' }}
          >
            <option value="">All Blocks</option>
            {uniqueBlocks.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        {(filterDistrict || filterBlock || search) && (
          <button
            onClick={() => { setFilterDistrict(''); setFilterBlock(''); setSearch(''); setPage(1); }}
            style={{ background: 'none', border: '1px solid #cbd5e1', color: '#64748b', padding: '0.6rem 1rem', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' }}
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* Table */}
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
            border: 1px solid #e2e8f0 !important;
            border-radius: 8px;
            background: white;
            padding: 0.5rem;
          }
          .responsive-table td {
            border: none !important;
            border-bottom: 1px solid #e2e8f0 !important;
            position: relative;
            padding: 0.75rem 1rem !important;
            text-align: right;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .responsive-table td::before {
            content: attr(data-label);
            display: block;
            font-size: 0.75rem;
            text-transform: uppercase;
            color: #64748b;
            font-weight: 700;
            text-align: left;
            flex-shrink: 0;
            margin-right: 1rem;
          }
          .responsive-table td:last-child {
            border-bottom: none !important;
          }
        }
      `}</style>
      <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="responsive-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
              <tr>
                <SortableTh label="Name" field="name" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                <SortableTh label="Block" field="block" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                <SortableTh label="District" field="district" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                <SortableTh label="Contacts" field="contactCount" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                <th style={{ padding: '1rem', fontWeight: 700, color: '#334155' }}>Covered By</th>
              </tr>
            </thead>
            <tbody>
              {sortedAndFiltered.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>No covered panchayats found.</td></tr>
              ) : (
                paginated.map((p) => (
                  <tr 
                    key={p.id} 
                    onClick={() => openDrawer(p)}
                    style={{ borderBottom: '1px solid #e2e8f0', background: 'white', cursor: 'pointer' }} 
                    onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'} 
                    onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                  >
                    <td data-label="Name" style={{ padding: '1rem', fontWeight: 600, color: '#0f172a' }}>{p.name}</td>
                    <td data-label="Block" style={{ padding: '1rem', color: '#334155' }}>{p.block}</td>
                    <td data-label="District" style={{ padding: '1rem', color: '#334155' }}>{p.district}</td>
                    <td data-label="Contacts" style={{ padding: '1rem', color: '#334155', fontWeight: 700 }}>
                      <span style={{ background: '#dbeafe', color: '#1e3a8a', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.8rem' }}>
                        {p.contactCount}
                      </span>
                    </td>
                    <td data-label="Covered By" style={{ padding: '1rem', color: '#64748b', fontSize: '0.85rem' }}>
                      {p.coveredByAgents.length > 0 ? p.coveredByAgents.join(', ') : 'Unknown'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div style={{ padding: '1rem', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
            <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
              Showing {(page - 1) * itemsPerPage + 1} to {Math.min(page * itemsPerPage, sortedAndFiltered.length)} of {sortedAndFiltered.length} entries
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button 
                onClick={() => setPage(p => Math.max(1, p - 1))} 
                disabled={page === 1}
                style={{ padding: '0.4rem 0.8rem', background: page === 1 ? '#f1f5f9' : 'white', border: '1px solid #cbd5e1', borderRadius: '6px', color: page === 1 ? '#94a3b8' : '#334155', cursor: page === 1 ? 'not-allowed' : 'pointer' }}
              >
                Previous
              </button>
              <button 
                onClick={() => setPage(p => Math.min(totalPages, p + 1))} 
                disabled={page === totalPages}
                style={{ padding: '0.4rem 0.8rem', background: page === totalPages ? '#f1f5f9' : 'white', border: '1px solid #cbd5e1', borderRadius: '6px', color: page === totalPages ? '#94a3b8' : '#334155', cursor: page === totalPages ? 'not-allowed' : 'pointer' }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Contacts Drawer */}
      <AnimatePresence>
        {selectedPanchayat && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSelectedPanchayat(null)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)', backdropFilter: 'blur(2px)', zIndex: 9998 }}
            />
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
              style={{
                position: 'fixed', top: 0, right: 0, bottom: 0, width: '100%', maxWidth: 500,
                background: 'white', boxShadow: '-8px 0 32px rgba(0,0,0,0.25)', zIndex: 9999,
                overflowY: 'auto', display: 'flex', flexDirection: 'column'
              }}
            >
              <div style={{ padding: '1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: '#f8fafc' }}>
                <div>
                  <h2 style={{ fontSize: '1.25rem', color: '#0f172a', margin: '0 0 0.25rem 0', fontWeight: 800 }}>{selectedPanchayat.name}</h2>
                  <p style={{ margin: 0, color: '#64748b', fontSize: '0.85rem' }}>{selectedPanchayat.block}, {selectedPanchayat.district}</p>
                </div>
                <button type="button" onClick={() => setSelectedPanchayat(null)} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '1.25rem', cursor: 'pointer', padding: '0.25rem' }}>✖</button>
              </div>

              <div style={{ padding: '1.5rem', flex: 1, overflowY: 'auto' }}>
                <h3 style={{ fontSize: '1rem', color: '#334155', margin: '0 0 1rem 0' }}>Associated Contacts</h3>
                
                {drawerLoading ? (
                   <p style={{ color: '#64748b', fontSize: '0.9rem', fontStyle: 'italic' }}>Loading contacts...</p>
                ) : drawerContacts.length === 0 ? (
                   <p style={{ color: '#64748b', fontSize: '0.9rem', fontStyle: 'italic' }}>No contacts found.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {drawerContacts.map(c => (
                      <div key={c.clientId} style={{ padding: '1rem', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <span style={{ fontWeight: 700, color: '#0f172a', display: 'block', fontSize: '1.05rem' }}>{c.name}</span>
                            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{c.clientId}</span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#10b981', background: '#d1fae5', padding: '0.2rem 0.5rem', borderRadius: '12px' }}>{c.status}</span>
                            <a href={`/admin/pipeline/${c.clientId}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem', fontWeight: 700, color: '#4f46e5', textDecoration: 'none', background: '#e0e7ff', padding: '0.25rem 0.6rem', borderRadius: '6px' }}>View Profile →</a>
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.8rem', color: '#475569' }}>
                          <div><strong>Role:</strong> {c.role}</div>
                          {c.phone && <div><strong>Phone:</strong> {c.phone}</div>}
                          <div><strong>Added By:</strong> {c.agentId}</div>
                          <div><strong>Date:</strong> {new Date(c.createdAt).toLocaleDateString()}</div>
                        </div>
                        
                        {/* Status Indicators */}
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', paddingTop: '0.5rem', borderTop: '1px solid #e2e8f0' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '0.2rem 0.5rem', borderRadius: '4px', background: c.whatsappAdded ? '#dcfce7' : '#f1f5f9', color: c.whatsappAdded ? '#166534' : '#94a3b8' }}>
                            {c.whatsappAdded ? '🟢 WhatsApp' : '⚪ No WhatsApp'}
                          </span>
                          <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '0.2rem 0.5rem', borderRadius: '4px', background: c.cardGiven ? '#dcfce7' : '#f1f5f9', color: c.cardGiven ? '#166534' : '#94a3b8' }}>
                            {c.cardGiven ? '🟢 Card Given' : '⚪ No Card'}
                          </span>
                          {c.agentEscalated && (
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.5rem', borderRadius: '4px', background: '#fee2e2', color: '#991b1b' }}>
                              🚨 Escalated
                            </span>
                          )}
                          {c.documents && c.documents.length > 0 && (
                            <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '0.2rem 0.5rem', borderRadius: '4px', background: '#e0e7ff', color: '#3730a3' }}>
                              📎 {c.documents.length} Docs
                            </span>
                          )}
                        </div>
                        
                        {c.comments && (
                          <div style={{ fontSize: '0.8rem', color: '#475569', background: 'white', padding: '0.5rem', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                            <strong>Notes:</strong> {c.comments.length > 100 ? c.comments.substring(0, 100) + '...' : c.comments}
                          </div>
                        )}
                        {c.agentEscalationNote && (
                          <div style={{ fontSize: '0.8rem', color: '#991b1b', background: '#fef2f2', padding: '0.5rem', borderRadius: '4px', border: '1px solid #fecaca' }}>
                            <strong>Escalation Reason:</strong> {c.agentEscalationNote}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
