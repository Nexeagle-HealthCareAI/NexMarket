'use client';

import { useCallback, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { canEdit, useAccess } from '@/lib/crm/access';
import { useLiveEvents } from '@/lib/crm/live';
import { ReferralCard, type ReferralRow } from '@/components/crm/ReferralCard';
import { Empty, ErrorBox, initials, Modal, PageHead, Pill, Skeleton, STAGES, useLoader, useToast } from '@/components/crm/ui';

const COLUMN_COLORS: Record<string, string> = {
  pending: 'var(--accent)', arrived: 'var(--info)', opd: '#2b8de0', admitted: 'var(--ok)', procedure: 'var(--ok)', discharged: '#34a37a', lost: '#8c96ab',
};

export default function ReferralPipelinePage() {
  const { access } = useAccess();
  const editable = canEdit(access, 'pipeline') || canEdit(access, 'desk');
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState<string>('');
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [open, setOpen] = useState<ReferralRow | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [toast, showToast] = useToast();

  const { data, error, loading, reload, setData } = useLoader(
    () => crm.get<{ totalCount: number; items: ReferralRow[] }>(`/api/v1/referrals?pageSize=500${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}`),
    [search],
  );

  const onEvent = useCallback((e: { kind: string }) => {
    if (['referral', 'arrived', 'opd', 'admit', 'discharged', 'lost'].includes(e.kind)) void reload();
  }, [reload]);
  useLiveEvents(onEvent);

  const items = useMemo(() => data?.items ?? [], [data]);
  const departments = useMemo(() => Array.from(new Set(items.map((r) => r.department).filter(Boolean))).sort(), [items]);
  const visible = items.filter((r) => (!dept || r.department === dept) && (!urgentOnly || r.urgent));

  const columns = STAGES.map((s) => ({
    ...s,
    cards: visible.filter((r) => r.status === s.key || (s.key === 'admitted' && r.status === 'converted')),
  }));

  const move = async (r: ReferralRow, key: string) => {
    if (r.status === key) return;
    const label = STAGES.find((s) => s.key === key)?.label ?? key;
    const before = data;
    setData(data ? { ...data, items: data.items.map((x) => (x.clientId === r.clientId ? { ...x, status: key, stageLabel: label } : x)) } : data);
    try {
      await crm.put(`/api/v1/referrals/${encodeURIComponent(r.clientId)}/status`, { status: key });
      showToast(`${r.patientName} moved to ${label.toLowerCase()}.`);
    } catch {
      setData(before);
      showToast('Could not move the card. Please try again.');
    }
  };

  return (
    <main className="crm-page" style={{ maxWidth: 'none' }}>
      <PageHead title="Referral pipeline" sub={`${visible.filter((r) => !['discharged', 'lost'].includes(r.status)).length} open referrals${editable ? ' · drag a card to the next stage, or tap it' : ''}`}>
        <label className="crm-search">
          <Search size={16} color="#5a6478" aria-hidden />
          <span className="crm-sr">Search referrals</span>
          <input type="search" placeholder="Patient name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </PageHead>

      <div className="crm-chips" aria-label="Filters">
        <button type="button" className="crm-chip" aria-pressed={!dept} onClick={() => setDept('')}>All departments</button>
        {departments.map((d) => (
          <button key={d} type="button" className="crm-chip" aria-pressed={dept === d} onClick={() => setDept(dept === d ? '' : d)}>{d}</button>
        ))}
        <button type="button" className="crm-chip" aria-pressed={urgentOnly} onClick={() => setUrgentOnly((u) => !u)}
          style={urgentOnly ? undefined : { background: 'var(--warn-soft)', color: 'var(--warn-ink)', borderColor: 'transparent' }}>Urgent only</button>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}

      {loading && !data ? (
        <div style={{ display: 'flex', gap: 14 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={360} w={260} />)}</div>
      ) : items.length === 0 ? (
        <div className="crm-card"><Empty title="No referrals yet">Referrals logged by field agents appear here.</Empty></div>
      ) : (
        <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 12, scrollSnapType: 'x proximity' }}>
          {columns.map((col) => (
            <section key={col.key} aria-label={col.label}
              onDragOver={(e) => { if (editable && dragging) e.preventDefault(); }}
              onDrop={(e) => {
                e.preventDefault();
                const r = items.find((x) => x.clientId === dragging);
                setDragging(null);
                if (r) void move(r, col.key);
              }}
              style={{ width: 268, flexShrink: 0, background: '#eceef3', borderRadius: 16, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, scrollSnapAlign: 'start', minHeight: 200 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 4px 2px' }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: COLUMN_COLORS[col.key] }} />
                <h2 style={{ fontSize: 14, fontWeight: 700 }}>{col.label}</h2>
                <span style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 600 }}>{col.cards.length}</span>
              </div>
              {col.cards.slice(0, 60).map((r) => {
                const hours = Math.floor((Date.now() - new Date(r.createdAt).getTime()) / 3600000);
                const age = hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} days`;
                const late = r.status === 'pending' && hours >= 48;
                return (
                  <article key={r.clientId} draggable={editable} onDragStart={() => setDragging(r.clientId)} onDragEnd={() => setDragging(null)}
                    style={{ background: '#fff', borderRadius: 12, border: '1px solid var(--border)', boxShadow: 'var(--shadow)', opacity: dragging === r.clientId ? 0.5 : 1, cursor: editable ? 'grab' : 'pointer' }}>
                    <button type="button" onClick={() => setOpen(r)} style={{ all: 'unset', display: 'flex', flexDirection: 'column', gap: 10, padding: 14, width: '100%', boxSizing: 'border-box', cursor: 'pointer' }}>
                      <span style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{r.patientName}</span>
                          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{[r.patientSex, r.patientAge, r.block].filter(Boolean).join(' · ')}</span>
                        </span>
                        {r.urgent && <span style={{ marginLeft: 'auto' }}><Pill tone="bad">Urgent</Pill></span>}
                      </span>
                      {r.department && <span style={{ alignSelf: 'flex-start', fontSize: 12, fontWeight: 600, color: 'var(--accent-ink)', background: 'var(--accent-soft)', padding: '3px 8px', borderRadius: 6 }}>{r.department}</span>}
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
                        <span style={{ width: 26, height: 26, borderRadius: 999, background: '#e9ebf1', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)', flexShrink: 0 }} title={r.agentName}>{initials(r.agentName)}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>via {r.contactName}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: late ? 'var(--bad)' : 'var(--text-2)', flexShrink: 0 }}>{age}</span>
                      </span>
                    </button>
                  </article>
                );
              })}
              {col.cards.length > 60 && <span className="crm-sub" style={{ fontSize: 12, textAlign: 'center' }}>+{col.cards.length - 60} more — use search</span>}
            </section>
          ))}
        </div>
      )}

      {open && (
        <Modal title="Referral" onClose={() => setOpen(null)} wide>
          <ReferralCard r={open} editable={editable} onUpdated={(r, label) => {
            setData(data ? { ...data, items: data.items.map((x) => (x.clientId === r.clientId ? r : x)) } : data);
            setOpen(r);
            showToast(`${r.patientName}: ${label.toLowerCase()}.`);
          }} />
        </Modal>
      )}
      {toast}
    </main>
  );
}
