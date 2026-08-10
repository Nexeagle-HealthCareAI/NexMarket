'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { getPanchayats, createPanchayat, updatePanchayatMarketingStatus, type PanchayatDto } from '@/lib/sync/api-client';

export default function AdminPanchayatsPage() {
  const [activeTab, setActiveTab] = useState<'all' | 'manage'>('all');
  const [panchayats, setPanchayats] = useState<PanchayatDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [filterDistrict, setFilterDistrict] = useState('');
  const [filterBlock, setFilterBlock] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [district, setDistrict] = useState('');
  const [block, setBlock] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Manage Panchayat tab
  const [manageDistrict, setManageDistrict] = useState('');
  const [manageBlock, setManageBlock] = useState('');
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [manageSaving, setManageSaving] = useState(false);
  const [manageError, setManageError] = useState('');
  const [manageSuccess, setManageSuccess] = useState('');

  const load = () => {
    setLoading(true);
    setLoadError('');
    getPanchayats()
      .then(setPanchayats)
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load panchayats.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // District/Block dropdown options are sourced from existing panchayats
  // rather than a hardcoded list — the real LGD data spans more districts
  // than any fixed union would stay in sync with, and it keeps "Add
  // Panchayat" from letting a typo'd district/block ever get created.
  const uniqueDistricts = useMemo(
    () => Array.from(new Set(panchayats.map((p) => p.district))).sort(),
    [panchayats],
  );
  const uniqueBlocksForFilter = useMemo(
    () => Array.from(new Set(panchayats.filter((p) => !filterDistrict || p.district === filterDistrict).map((p) => p.block))).sort(),
    [panchayats, filterDistrict],
  );
  const uniqueBlocksForAdd = useMemo(
    () => Array.from(new Set(panchayats.filter((p) => p.district === district).map((p) => p.block))).sort(),
    [panchayats, district],
  );
  const uniqueBlocksForManage = useMemo(
    () => Array.from(new Set(panchayats.filter((p) => p.district === manageDistrict).map((p) => p.block))).sort(),
    [panchayats, manageDistrict],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return panchayats.filter((p) => {
      if (filterDistrict && p.district !== filterDistrict) return false;
      if (filterBlock && p.block !== filterBlock) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.block.toLowerCase().includes(q) ||
        p.district.toLowerCase().includes(q)
      );
    });
  }, [panchayats, search, filterDistrict, filterBlock]);

  const managePanchayats = useMemo(
    () => panchayats
      .filter((p) => p.district === manageDistrict && p.block === manageBlock)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [panchayats, manageDistrict, manageBlock],
  );

  // Reset the checklist to match the server's current state whenever the
  // selected block changes (or the underlying data reloads).
  useEffect(() => {
    setCheckedIds(new Set(managePanchayats.filter((p) => p.isActiveForMarketing).map((p) => p.id)));
    setManageSuccess('');
    setManageError('');
  }, [manageDistrict, manageBlock, panchayats]);

  const resetAddForm = () => {
    setShowAdd(false);
    setName('');
    setDistrict('');
    setBlock('');
    setSaveError('');
  };

  const handleAdd = async () => {
    if (!name.trim() || !district || !block) {
      setSaveError('Name, district and block are all required.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const created = await createPanchayat({ name: name.trim(), district, block });
      setPanchayats((prev) => [...prev, created]);
      resetAddForm();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to add panchayat.');
    } finally {
      setSaving(false);
    }
  };

  const toggleChecked = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSaveMarketingStatus = async () => {
    const toActivate = managePanchayats.filter((p) => checkedIds.has(p.id) && !p.isActiveForMarketing).map((p) => p.id);
    const toDeactivate = managePanchayats.filter((p) => !checkedIds.has(p.id) && p.isActiveForMarketing).map((p) => p.id);

    if (toActivate.length === 0 && toDeactivate.length === 0) {
      setManageSuccess('Nothing to save — already matches this selection.');
      return;
    }

    setManageSaving(true);
    setManageError('');
    setManageSuccess('');
    try {
      if (toActivate.length > 0) await updatePanchayatMarketingStatus({ panchayatIds: toActivate, isActive: true });
      if (toDeactivate.length > 0) await updatePanchayatMarketingStatus({ panchayatIds: toDeactivate, isActive: false });

      const activatedSet = new Set(toActivate);
      const deactivatedSet = new Set(toDeactivate);
      setPanchayats((prev) => prev.map((p) => {
        if (activatedSet.has(p.id)) return { ...p, isActiveForMarketing: true };
        if (deactivatedSet.has(p.id)) return { ...p, isActiveForMarketing: false };
        return p;
      }));
      setManageSuccess(`Saved — ${toActivate.length} activated, ${toDeactivate.length} deactivated.`);
    } catch (e) {
      setManageError(e instanceof Error ? e.message : 'Failed to save changes.');
    } finally {
      setManageSaving(false);
    }
  };

  const activeCountInBlock = managePanchayats.filter((p) => checkedIds.has(p.id)).length;

  return (
    <div style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '0.5rem', color: '#0f172a' }}>Panchayats</h1>
          <p style={{ color: '#64748b' }}>{panchayats.length} panchayats — including any agents have added from the field</p>
        </div>
        {activeTab === 'all' && (
          <button
            onClick={() => { setShowAdd(true); setSaveError(''); }}
            style={{ background: '#4f46e5', color: 'white', padding: '0.6rem 1.2rem', borderRadius: '8px', fontWeight: 600, border: 'none', cursor: 'pointer' }}
          >
            + Add Panchayat
          </button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '2px solid #e2e8f0', marginBottom: '1.5rem' }}>
        <button
          onClick={() => setActiveTab('all')}
          style={{
            background: 'none', border: 'none', padding: '0.75rem 1.25rem', cursor: 'pointer',
            fontSize: '0.95rem', fontWeight: 700, color: activeTab === 'all' ? '#4f46e5' : '#64748b',
            borderBottom: activeTab === 'all' ? '3px solid #4f46e5' : '3px solid transparent', marginBottom: '-2px',
          }}
        >
          📍 All Panchayats
        </button>
        <button
          onClick={() => setActiveTab('manage')}
          style={{
            background: 'none', border: 'none', padding: '0.75rem 1.25rem', cursor: 'pointer',
            fontSize: '0.95rem', fontWeight: 700, color: activeTab === 'manage' ? '#4f46e5' : '#64748b',
            borderBottom: activeTab === 'manage' ? '3px solid #4f46e5' : '3px solid transparent', marginBottom: '-2px',
          }}
        >
          🎯 Manage Panchayat
        </button>
      </div>

      {loading && <p>Loading panchayats...</p>}
      {loadError && <p style={{ color: '#b91c1c' }}>{loadError}</p>}

      {!loading && !loadError && activeTab === 'all' && (
        <>
          {/* Filter Bar */}
          <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 220px', minWidth: '220px' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.35rem' }}>Search</label>
              <input
                placeholder="Search by name, block or district..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: '100%', padding: '0.6rem 0.85rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ minWidth: '180px' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.35rem' }}>District</label>
              <select
                value={filterDistrict}
                onChange={(e) => { setFilterDistrict(e.target.value); setFilterBlock(''); }}
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
                onChange={(e) => setFilterBlock(e.target.value)}
                style={{ width: '100%', padding: '0.6rem 0.85rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', background: 'white' }}
              >
                <option value="">All Blocks</option>
                {uniqueBlocksForFilter.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            {(filterDistrict || filterBlock || search) && (
              <button
                onClick={() => { setFilterDistrict(''); setFilterBlock(''); setSearch(''); }}
                style={{ background: 'none', border: '1px solid #cbd5e1', color: '#64748b', padding: '0.6rem 1rem', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' }}
              >
                Clear Filters
              </button>
            )}
          </div>

          <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  <tr>
                    <th style={{ padding: '1rem', fontWeight: 700, color: '#334155' }}>Name</th>
                    <th style={{ padding: '1rem', fontWeight: 700, color: '#334155' }}>Block</th>
                    <th style={{ padding: '1rem', fontWeight: 700, color: '#334155' }}>District</th>
                    <th style={{ padding: '1rem', fontWeight: 700, color: '#334155' }}>LGD Code</th>
                    <th style={{ padding: '1rem', fontWeight: 700, color: '#334155' }}>Marketing Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>No panchayats match your filters.</td></tr>
                  ) : (
                    filtered.map((p) => (
                      <tr key={p.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                        <td style={{ padding: '1rem', fontWeight: 600, color: '#0f172a' }}>{p.name}</td>
                        <td style={{ padding: '1rem', color: '#334155' }}>{p.block}</td>
                        <td style={{ padding: '1rem', color: '#334155' }}>{p.district}</td>
                        <td style={{ padding: '1rem', color: '#64748b' }}>
                          {p.lgdCode || <span style={{ fontStyle: 'italic', color: '#cbd5e1' }}>Added manually</span>}
                        </td>
                        <td style={{ padding: '1rem' }}>
                          <span style={{
                            fontSize: '0.72rem', fontWeight: 700, padding: '0.2rem 0.6rem', borderRadius: '20px',
                            background: p.isActiveForMarketing ? 'rgba(16,185,129,0.15)' : 'rgba(148,163,184,0.15)',
                            color: p.isActiveForMarketing ? '#10b981' : '#64748b',
                          }}>
                            {p.isActiveForMarketing ? '✅ Active' : '⏸ Inactive'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!loading && !loadError && activeTab === 'manage' && (
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', padding: '1.5rem' }}>
          <p style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '1.25rem', maxWidth: '640px' }}>
            Choose which panchayats in a block are actually part of the current marketing effort. Only panchayats marked
            <strong> Active</strong> here show up when that district/block is assigned to an agent (My Task, check-in).
            Everything defaults to active, so nothing changes until you curate a block.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem', maxWidth: '640px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.35rem' }}>District</label>
              <select
                value={manageDistrict}
                onChange={(e) => { setManageDistrict(e.target.value); setManageBlock(''); }}
                style={{ width: '100%', padding: '0.6rem 0.85rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', background: 'white', boxSizing: 'border-box' }}
              >
                <option value="">Select District...</option>
                {uniqueDistricts.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.35rem' }}>Block</label>
              <select
                value={manageBlock}
                onChange={(e) => setManageBlock(e.target.value)}
                disabled={!manageDistrict}
                style={{ width: '100%', padding: '0.6rem 0.85rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', background: manageDistrict ? 'white' : '#f1f5f9', boxSizing: 'border-box' }}
              >
                <option value="">{manageDistrict ? 'Select Block...' : 'Select a district first'}</option>
                {uniqueBlocksForManage.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          </div>

          {manageDistrict && manageBlock && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                <span style={{ fontSize: '0.85rem', color: '#334155', fontWeight: 600 }}>
                  {activeCountInBlock} / {managePanchayats.length} panchayats selected as active
                </span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => setCheckedIds(new Set(managePanchayats.map((p) => p.id)))}
                    style={{ background: 'white', border: '1px solid #cbd5e1', color: '#334155', padding: '0.4rem 0.85rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem' }}
                  >
                    Select All
                  </button>
                  <button
                    onClick={() => setCheckedIds(new Set())}
                    style={{ background: 'white', border: '1px solid #cbd5e1', color: '#334155', padding: '0.4rem 0.85rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem' }}
                  >
                    Clear All
                  </button>
                </div>
              </div>

              <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', maxHeight: '360px', overflowY: 'auto', marginBottom: '1.25rem' }}>
                {managePanchayats.length === 0 ? (
                  <p style={{ padding: '1.5rem', textAlign: 'center', color: '#94a3b8', margin: 0 }}>No panchayats found for this block.</p>
                ) : (
                  managePanchayats.map((p) => (
                    <label
                      key={p.id}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                    >
                      <input
                        type="checkbox"
                        checked={checkedIds.has(p.id)}
                        onChange={() => toggleChecked(p.id)}
                        style={{ width: '1.1rem', height: '1.1rem', cursor: 'pointer' }}
                      />
                      <span style={{ flex: 1, fontSize: '0.9rem', color: '#0f172a', fontWeight: 500 }}>{p.name}</span>
                      {!p.isActiveForMarketing && (
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', background: 'rgba(148,163,184,0.15)', padding: '0.15rem 0.5rem', borderRadius: '10px' }}>
                          Currently inactive
                        </span>
                      )}
                    </label>
                  ))
                )}
              </div>

              {manageError && <p style={{ color: '#b91c1c', fontSize: '0.85rem', marginBottom: '1rem' }}>{manageError}</p>}
              {manageSuccess && <p style={{ color: '#10b981', fontSize: '0.85rem', marginBottom: '1rem', fontWeight: 600 }}>{manageSuccess}</p>}

              <button
                onClick={handleSaveMarketingStatus}
                disabled={manageSaving || managePanchayats.length === 0}
                style={{
                  background: manageSaving ? '#a5b4fc' : '#4f46e5', color: 'white', padding: '0.65rem 1.5rem',
                  borderRadius: '8px', fontWeight: 600, border: 'none',
                  cursor: (manageSaving || managePanchayats.length === 0) ? 'not-allowed' : 'pointer',
                }}
              >
                {manageSaving ? 'Saving…' : 'Save Marketing Status'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Add Panchayat Drawer */}
      <AnimatePresence>
        {showAdd && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !saving && resetAddForm()}
              style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)', backdropFilter: 'blur(2px)', zIndex: 9998 }}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
              style={{
                position: 'fixed', top: 0, right: 0, bottom: 0, width: '100%', maxWidth: 460,
                background: 'white', boxShadow: '-8px 0 32px rgba(0,0,0,0.25)', zIndex: 9999,
                overflowY: 'auto', padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1.25rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontSize: '1.3rem', color: '#0f172a', margin: 0 }}>+ Add Panchayat</h2>
                <button type="button" onClick={resetAddForm} disabled={saving} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '1.25rem', cursor: 'pointer' }}>✖</button>
              </div>
              <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0 }}>
                For a panchayat missing from the seeded LGD list. District and block must match an existing one — pick the
                nearest match if this panchayat&apos;s exact block isn&apos;t listed yet.
              </p>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.35rem' }}>Panchayat Name</label>
                <input
                  placeholder="Panchayat name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.35rem' }}>District</label>
                <select
                  value={district}
                  onChange={(e) => { setDistrict(e.target.value); setBlock(''); }}
                  style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', background: 'white', boxSizing: 'border-box' }}
                >
                  <option value="">Select District...</option>
                  {uniqueDistricts.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.35rem' }}>Block</label>
                <select
                  value={block}
                  onChange={(e) => setBlock(e.target.value)}
                  disabled={!district}
                  style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', background: district ? 'white' : '#f1f5f9', boxSizing: 'border-box' }}
                >
                  <option value="">{district ? 'Select Block...' : 'Select a district first'}</option>
                  {uniqueBlocksForAdd.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>

              {saveError && <p style={{ color: '#b91c1c', fontSize: '0.85rem', margin: 0 }}>{saveError}</p>}

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid #e2e8f0' }}>
                <button
                  onClick={resetAddForm}
                  disabled={saving}
                  style={{ flex: 1, background: 'white', border: '1px solid #cbd5e1', color: '#475569', padding: '0.65rem', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleAdd}
                  disabled={saving}
                  style={{ flex: 1.5, background: saving ? '#a5b4fc' : '#4f46e5', color: 'white', padding: '0.65rem 1.25rem', borderRadius: '8px', fontWeight: 600, border: 'none', cursor: saving ? 'not-allowed' : 'pointer' }}
                >
                  {saving ? 'Saving…' : 'Save Panchayat'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
