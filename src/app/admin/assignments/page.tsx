'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { canEdit, useAccess } from '@/lib/crm/access';
import { Empty, ErrorBox, fmt, friendlyError, PageHead, Pill, Skeleton, useLoader, useToast } from '@/components/crm/ui';

interface BoardBlock {
  district: string; block: string; panchayats: number; assigned: number; visited30: number;
  agents: { agentId: string; name: string; panchayats: number; whole: boolean }[];
}
interface Board {
  kpis: { blocks: number; blocksWithAgent: number; panchayats: number; panchayatsAssigned: number; agentsWithoutBlock: number };
  districts: string[];
  blocks: BoardBlock[];
  agents: { agentId: string; name: string; block?: string | null; district?: string | null; partial: boolean }[];
}
interface BlockDetail {
  district: string; block: string;
  panchayats: { panchayatId: string; name: string; agentId?: string | null; agentName?: string | null; lastVisitAt?: string | null; partners: number }[];
}

const key = (b: { district: string; block: string }) => `${b.district}|${b.block}`;
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);

export default function AssignmentsPageWrap() {
  return (
    <Suspense fallback={<main className="crm-page"><Skeleton h={120} /></main>}>
      <AssignmentsPage />
    </Suspense>
  );
}

function AssignmentsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const { access } = useAccess();
  const editable = canEdit(access, 'field');
  const board = useLoader(() => crm.get<Board>('/api/v1/assignments/board'), []);
  const [district, setDistrict] = useState(params.get('district') ?? '');
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [toast, showToast] = useToast();
  const selected = params.get('block');
  const b = board.data;

  const pick = (blk: BoardBlock | null) => {
    const sp = new URLSearchParams();
    if (district) sp.set('district', district);
    if (blk) sp.set('block', key(blk));
    router.replace(`/admin/assignments${sp.toString() ? `?${sp}` : ''}`, { scroll: false });
  };

  const rows = useMemo(() => (b?.blocks ?? [])
    .filter((x) => !district || x.district === district)
    .filter((x) => !onlyEmpty || x.assigned < x.panchayats), [b, district, onlyEmpty]);
  const sel = b?.blocks.find((x) => key(x) === selected) ?? null;

  return (
    <main className="crm-page">
      <PageHead title="Block assignments" sub="Who covers which block. Give a whole block to one agent, or split its panchayats between agents. Agents see the change in the app at their next sync." />

      {board.error && <ErrorBox message={board.error} onRetry={board.reload} />}
      {!b ? <Skeleton h={110} /> : (
        <div className="crm-kpis">
          <div className="crm-card crm-kpi"><span className="crm-kpi-label">Blocks with an agent</span><span className="crm-kpi-value">{b.kpis.blocksWithAgent}<span className="crm-kpi-unit">of {b.kpis.blocks}</span></span></div>
          <div className="crm-card crm-kpi" style={b.kpis.blocks - b.kpis.blocksWithAgent > 0 ? { background: 'var(--warn-soft)', borderColor: '#f0c98a' } : undefined}>
            <span className="crm-kpi-label">Blocks with nobody</span><span className="crm-kpi-value" style={{ color: 'var(--warn-ink)' }}>{b.kpis.blocks - b.kpis.blocksWithAgent}</span>
          </div>
          <div className="crm-card crm-kpi"><span className="crm-kpi-label">Panchayats assigned</span><span className="crm-kpi-value">{b.kpis.panchayatsAssigned}<span className="crm-kpi-unit">of {b.kpis.panchayats}</span></span></div>
          <div className="crm-card crm-kpi"><span className="crm-kpi-label">Agents with no block</span><span className="crm-kpi-value" style={{ color: b.kpis.agentsWithoutBlock ? 'var(--bad)' : undefined }}>{b.kpis.agentsWithoutBlock}</span></div>
        </div>
      )}

      <div className="crm-chips" role="group" aria-label="District">
        <button type="button" className="crm-chip" aria-pressed={district === ''} onClick={() => setDistrict('')}>All districts</button>
        {b?.districts.map((d) => <button key={d} type="button" className="crm-chip" aria-pressed={district === d} onClick={() => setDistrict(d)}>{d}</button>)}
        <button type="button" className="crm-chip is-soft" aria-pressed={onlyEmpty} onClick={() => setOnlyEmpty((v) => !v)} style={{ marginLeft: 'auto' }}>Only blocks with gaps</button>
      </div>

      <div className={`crm-row pt-split${sel ? ' has-sel' : ''}`}>
        <section className="crm-card grow-3 pt-list" aria-label="Blocks" style={{ padding: 0, overflow: 'hidden' }}>
          {!b ? <div style={{ padding: 20 }}><Skeleton h={300} /></div> : rows.length === 0 ? <Empty title="No blocks match">Clear the filter to see every block.</Empty> : (
            <div className="crm-table-wrap">
              <table className="crm-table">
                <thead><tr><th>Block</th><th>Agent</th><th style={{ textAlign: 'right' }}>Panchayats</th><th>Visited in 30 days</th></tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const v = pct(r.visited30, r.panchayats);
                    const gap = r.panchayats - r.assigned;
                    return (
                      <tr key={key(r)} className={`pt-tr${sel && key(sel) === key(r) ? ' is-sel' : ''}`} onClick={() => pick(r)}>
                        <td>
                          <button type="button" className="pt-name" onClick={(e) => { e.stopPropagation(); pick(r); }}>{r.block}</button>
                          <div className="crm-cell-sub">{r.district}</div>
                        </td>
                        <td>
                          {r.agents.length === 0 ? <Pill tone="warn">Nobody assigned</Pill> : (
                            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              {r.agents.map((a) => <span key={a.agentId} style={{ fontSize: 14 }}>{a.name}{!a.whole && <span className="crm-cell-sub" style={{ display: 'inline' }}> · {a.panchayats} panchayats</span>}</span>)}
                              {gap > 0 && <span className="crm-cell-sub" style={{ color: 'var(--warn-ink)', fontWeight: 600 }}>{gap} panchayat{gap === 1 ? '' : 's'} with nobody</span>}
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{r.panchayats}</td>
                        <td>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 140 }}>
                            <span className="crm-bar" style={{ flex: 1, height: 8 }}><span style={{ display: 'block', height: '100%', width: `${v}%`, background: v >= 75 ? 'var(--ok)' : v >= 50 ? 'var(--accent)' : 'var(--warn)' }} /></span>
                            <span style={{ fontSize: 12, width: 36, textAlign: 'right' }}>{v}%</span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="crm-card grow-2 pt-panel" aria-label="Block detail" style={{ flexBasis: 400 }}>
          {sel && b ? (
            <BlockPanel key={key(sel)} blk={sel} agents={b.agents} editable={editable} onBack={() => pick(null)}
              onSaved={(msg) => { showToast(msg); void board.reload(); }} showToast={showToast} />
          ) : <Empty title="Pick a block">See its panchayats and who covers each one.</Empty>}
        </aside>
      </div>
      {toast}
    </main>
  );
}

function BlockPanel({ blk, agents, editable, onBack, onSaved, showToast }: {
  blk: BoardBlock; agents: Board['agents']; editable: boolean; onBack: () => void; onSaved: (m: string) => void; showToast: (m: string) => void;
}) {
  const d = useLoader(() => crm.get<BlockDetail>(`/api/v1/assignments/block?district=${encodeURIComponent(blk.district)}&block=${encodeURIComponent(blk.block)}`), [blk.district, blk.block]);
  const [whole, setWhole] = useState('');
  const [to, setTo] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const agentLabel = (a: Board['agents'][number]) =>
    `${a.name}${!a.block ? ' (no block yet)' : a.block === blk.block && a.district === blk.district ? ' (here now)' : ` (now ${a.block})`}`;
  const nameOf = (id: string) => agents.find((a) => a.agentId === id)?.name ?? 'the agent';

  const save = async (agentId: string, panchayatIds: string[] | null) => {
    const leaving = agents.find((a) => a.agentId === agentId);
    if (leaving?.block && (leaving.block !== blk.block || leaving.district !== blk.district)
      && !window.confirm(`${leaving.name} now covers ${leaving.block}. Moving them here ends that assignment. Continue?`)) return;
    setBusy(true);
    try {
      const res = await crm.post<{ moved: number; whole: boolean }>('/api/v1/assignments/assign', { district: blk.district, block: blk.block, agentId: agentId || null, panchayatIds });
      setChecked(new Set());
      await d.reload();
      onSaved(agentId
        ? `${res.whole ? `All of ${blk.block}` : `${res.moved} panchayat${res.moved === 1 ? '' : 's'}`} now with ${nameOf(agentId)}.`
        : `${res.moved} panchayat${res.moved === 1 ? '' : 's'} now have nobody.`);
    } catch (e) {
      showToast(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const list = d.data?.panchayats ?? [];
  const allOn = list.length > 0 && checked.size === list.length;
  const toggle = (id: string) => setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <button type="button" className="crm-btn is-secondary is-sm pt-back" onClick={onBack}><ArrowLeft size={16} aria-hidden /> All blocks</button>
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 800 }}>{blk.block} block</h2>
        <span className="crm-sub" style={{ fontSize: 13 }}>{blk.district} district · {blk.panchayats} panchayats · {blk.assigned} assigned</span>
      </div>

      {editable && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className="crm-field" style={{ flex: '1 1 220px' }}>Give the whole block to
            <select className="crm-select" value={whole} onChange={(e) => setWhole(e.target.value)}>
              <option value="">Choose agent</option>
              {agents.map((a) => <option key={a.agentId} value={a.agentId}>{agentLabel(a)}</option>)}
            </select>
          </label>
          <button type="button" className="crm-btn" disabled={!whole || busy} onClick={() => save(whole, null)}>Assign block</button>
        </div>
      )}

      <section aria-labelledby="pl-h" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 id="pl-h" style={{ fontSize: 15, fontWeight: 800, flex: 1 }}>{editable ? 'Or split by panchayat' : 'Panchayats'}</h3>
          {editable && list.length > 0 && (
            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setChecked(allOn ? new Set() : new Set(list.map((p) => p.panchayatId)))}>{allOn ? 'Clear' : 'Select all'}</button>
          )}
        </span>
        {d.error ? <ErrorBox message={d.error} onRetry={d.reload} /> : !d.data ? <Skeleton h={240} /> : (
          <ul className="crm-list" style={{ maxHeight: 520, overflowY: 'auto' }}>
            {list.map((p) => (
              <li key={p.panchayatId} style={{ padding: 0, display: 'block' }}>
                <label style={{ display: 'grid', gridTemplateColumns: editable ? '24px minmax(0,1fr) auto' : 'minmax(0,1fr) auto', gap: 10, alignItems: 'center', width: '100%', padding: '9px 0', cursor: editable ? 'pointer' : 'default' }}>
                  {editable && <input type="checkbox" checked={checked.has(p.panchayatId)} onChange={() => toggle(p.panchayatId)} style={{ width: 18, height: 18 }} />}
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</span>
                    <div className="crm-cell-sub">{p.lastVisitAt ? `Last visit ${fmt.date(p.lastVisitAt)}` : 'Never visited'} · {p.partners} partner{p.partners === 1 ? '' : 's'}</div>
                  </span>
                  <span style={{ fontSize: 13, fontWeight: p.agentName ? 500 : 700, color: p.agentName ? 'var(--text-3)' : 'var(--warn-ink)', textAlign: 'right' }}>{p.agentName ?? 'Nobody'}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {editable && checked.size > 0 && (
          <div className="pt-follow" style={{ background: 'var(--accent-tint)' }}>
            <span style={{ fontSize: 14, fontWeight: 600, flex: '1 1 140px' }}>{checked.size} selected go to</span>
            <label className="crm-sr" htmlFor="split-to">Agent</label>
            <select id="split-to" className="crm-select" style={{ width: 'auto', flex: '1 1 180px' }} value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Choose agent</option>
              {agents.map((a) => <option key={a.agentId} value={a.agentId}>{agentLabel(a)}</option>)}
              <option value="__none">Nobody (unassign)</option>
            </select>
            <button type="button" className="crm-btn is-sm" disabled={!to || busy} onClick={() => save(to === '__none' ? '' : to, [...checked])}>Move</button>
          </div>
        )}
      </section>
    </div>
  );
}
