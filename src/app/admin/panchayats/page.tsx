'use client';

import { useEffect, useMemo, useState } from 'react';
import { getPanchayats, createPanchayat, type PanchayatDto } from '@/lib/sync/api-client';

export default function AdminPanchayatsPage() {
  const [panchayats, setPanchayats] = useState<PanchayatDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [district, setDistrict] = useState('');
  const [block, setBlock] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const load = () => {
    setLoading(true);
    setLoadError('');
    getPanchayats()
      .then(setPanchayats)
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load panchayats.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return panchayats;
    return panchayats.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.block.toLowerCase().includes(q) ||
      p.district.toLowerCase().includes(q)
    );
  }, [panchayats, search]);

  const handleAdd = async () => {
    if (!name.trim() || !district.trim() || !block.trim()) {
      setSaveError('Name, district and block are all required.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const created = await createPanchayat({ name: name.trim(), district: district.trim(), block: block.trim() });
      setPanchayats(prev => [...prev, created]);
      setName(''); setDistrict(''); setBlock(''); setShowAdd(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to add panchayat.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '0.5rem', color: '#0f172a' }}>Panchayats</h1>
          <p style={{ color: '#64748b' }}>{panchayats.length} panchayats — including any agents have added from the field</p>
        </div>
        <button
          onClick={() => { setShowAdd(v => !v); setSaveError(''); }}
          style={{ background: '#4f46e5', color: 'white', padding: '0.6rem 1.2rem', borderRadius: '8px', fontWeight: 600, border: 'none', cursor: 'pointer' }}
        >
          {showAdd ? 'Cancel' : '+ Add Panchayat'}
        </button>
      </div>

      {showAdd && (
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: '#0f172a' }}>Add a missing panchayat</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
            <input placeholder="Panchayat name" value={name} onChange={e => setName(e.target.value)} style={{ padding: '0.6rem 0.85rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none' }} />
            <input placeholder="Block" value={block} onChange={e => setBlock(e.target.value)} style={{ padding: '0.6rem 0.85rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none' }} />
            <input placeholder="District" value={district} onChange={e => setDistrict(e.target.value)} style={{ padding: '0.6rem 0.85rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none' }} />
          </div>
          {saveError && <p style={{ color: '#b91c1c', fontSize: '0.85rem', marginBottom: '0.75rem' }}>{saveError}</p>}
          <button
            onClick={handleAdd}
            disabled={saving}
            style={{ background: saving ? '#a5b4fc' : '#4f46e5', color: 'white', padding: '0.55rem 1.25rem', borderRadius: '8px', fontWeight: 600, border: 'none', cursor: saving ? 'not-allowed' : 'pointer' }}
          >
            {saving ? 'Saving…' : 'Save Panchayat'}
          </button>
        </div>
      )}

      <div style={{ marginBottom: '1rem' }}>
        <input
          placeholder="Search by name, block or district..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', maxWidth: '400px', padding: '0.6rem 0.85rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none' }}
        />
      </div>

      {loading && <p>Loading panchayats...</p>}
      {loadError && <p style={{ color: '#b91c1c' }}>{loadError}</p>}

      {!loading && !loadError && (
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                <tr>
                  <th style={{ padding: '1rem', fontWeight: 700, color: '#334155' }}>Name</th>
                  <th style={{ padding: '1rem', fontWeight: 700, color: '#334155' }}>Block</th>
                  <th style={{ padding: '1rem', fontWeight: 700, color: '#334155' }}>District</th>
                  <th style={{ padding: '1rem', fontWeight: 700, color: '#334155' }}>LGD Code</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={4} style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>No panchayats match your search.</td></tr>
                ) : (
                  filtered.map(p => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '1rem', fontWeight: 600, color: '#0f172a' }}>{p.name}</td>
                      <td style={{ padding: '1rem', color: '#334155' }}>{p.block}</td>
                      <td style={{ padding: '1rem', color: '#334155' }}>{p.district}</td>
                      <td style={{ padding: '1rem', color: '#64748b' }}>
                        {p.lgdCode || <span style={{ fontStyle: 'italic', color: '#cbd5e1' }}>Added manually</span>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
