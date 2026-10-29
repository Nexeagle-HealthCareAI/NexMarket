'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, MapPin, Plus, User } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { contactTypeLabel, Empty, ErrorBox, fmt, friendlyError, Modal, Pill, Skeleton, useLoader, type Tone } from '@/components/crm/ui';

// ─── Types ────────────────────────────────────────────────────────────────────────────────

export interface AgentTask {
  id: string; groupId: string; agentId: string; agentName: string; title: string; detail?: string | null;
  priority: 'high' | 'normal' | 'low'; dueDate?: string | null; overdue: boolean; district?: string | null; block?: string | null;
  panchayats: { id: string; name: string }[]; partner?: { clientId: string; name: string; type?: string | null } | null;
  aiItemId?: string | null; status: 'open' | 'done' | 'cancelled'; createdBy: string; createdAt: string;
  seenAt?: string | null; doneAt?: string | null; doneNote?: string | null;
}
interface TasksRes { counts: { open: number; overdue: number; doneWeek: number; done: number }; tasks: AgentTask[] }
export interface TaskAgent { agentId: string; name: string; block?: string | null; district?: string | null }
interface BoardLite { agents: TaskAgent[]; blocks: { district: string; block: string }[] }
interface BlockLite { panchayats: { panchayatId: string; name: string; agentId?: string | null }[] }

export interface TaskPreset {
  district?: string | null; block?: string | null; panchayatIds?: string[]; agentIds?: string[];
  title?: string; detail?: string; dueDate?: string | null; aiItemId?: string;
}

const PRIO: Record<string, { label: string; tone: Tone }> = { high: { label: 'Urgent', tone: 'bad' }, normal: { label: 'Normal', tone: 'neutral' }, low: { label: 'When free', tone: 'neutral' } };
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const day = (ymd: string) => fmt.date(`${ymd}T06:00:00Z`);

// ─── New task ─────────────────────────────────────────────────────────────────────────────

/** Give a task to one or more agents. Pre-fill from a block, selected panchayats or an AI analyst action. */
export function TaskModal({ preset, onClose, onSaved }: { preset: TaskPreset; onClose: () => void; onSaved: (msg: string) => void }) {
  const board = useLoader(() => crm.get<BoardLite>('/api/v1/assignments/board'), []);
  const [blockKey, setBlockKey] = useState(preset.block ? `${preset.district ?? ''}|${preset.block}` : '');
  const [district, block] = blockKey ? blockKey.split('|') : ['', ''];
  const places = useLoader(
    () => (block ? crm.get<BlockLite>(`/api/v1/assignments/block?district=${encodeURIComponent(district)}&block=${encodeURIComponent(block)}`) : Promise.resolve({ panchayats: [] })),
    [district, block],
  );
  // null until someone picks agents by hand; until then the default follows the block / panchayats chosen.
  const [picked, setPicked] = useState<Set<string> | null>(preset.agentIds?.length ? new Set(preset.agentIds) : null);
  const [pids, setPids] = useState<Set<string>>(new Set(preset.panchayatIds ?? []));
  const [title, setTitle] = useState(preset.title ?? '');
  const [detail, setDetail] = useState(preset.detail ?? '');
  const [due, setDue] = useState(preset.dueDate ?? '');
  const [priority, setPriority] = useState<'high' | 'normal' | 'low'>('normal');
  const [partnerQ, setPartnerQ] = useState('');
  const [partner, setPartner] = useState<{ clientId: string; name: string; sub: string } | null>(null);
  const [found, setFound] = useState<{ clientId: string; name: string; sub: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Agents working in the chosen block come first, and are picked for you when nobody is chosen yet.
  const here = useMemo(() => {
    const ids = new Set((places.data?.panchayats ?? []).map((p) => p.agentId).filter(Boolean) as string[]);
    (board.data?.agents ?? []).filter((a) => a.block === block && (a.district ?? '') === district).forEach((a) => ids.add(a.agentId));
    return ids;
  }, [places.data, board.data, block, district]);
  // Default: whoever covers the chosen panchayats, else everyone working in the block.
  const agentIds = useMemo(() => {
    if (picked) return picked;
    const owners = new Set((places.data?.panchayats ?? []).filter((p) => pids.has(p.panchayatId)).map((p) => p.agentId).filter(Boolean) as string[]);
    return owners.size > 0 ? owners : here;
  }, [picked, places.data, pids, here]);
  const setAgentIds = (s: Set<string>) => setPicked(s);

  useEffect(() => {
    if (partnerQ.trim().length < 2) return;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const r = await crm.get<{ rows: { clientId: string; name: string; type?: string; panchayat?: string }[] }>(
          `/api/v1/partners?tab=all&pageSize=8&q=${encodeURIComponent(partnerQ.trim())}${block ? `&block=${encodeURIComponent(block)}` : ''}`);
        if (alive) setFound(r.rows.map((x) => ({ clientId: x.clientId, name: x.name, sub: [contactTypeLabel(x.type), x.panchayat].filter(Boolean).join(' · ') })));
      } catch { /* search is a helper; ignore */ }
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [partnerQ, block]);

  const agents = useMemo(() => [...(board.data?.agents ?? [])].sort((a, b) => Number(here.has(b.agentId)) - Number(here.has(a.agentId)) || a.name.localeCompare(b.name)), [board.data, here]);
  const toggle = (set: Set<string>, id: string, fn: (s: Set<string>) => void) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); fn(n); };

  const save = async () => {
    setError(null);
    if (!title.trim()) { setError('Write what the agent should do.'); return; }
    if (agentIds.size === 0) { setError('Choose at least one agent.'); return; }
    setBusy(true);
    try {
      const r = await crm.post<{ created: number }>('/api/v1/tasks', {
        agentIds: [...agentIds], title: title.trim(), detail: detail.trim() || null, priority, dueDate: due || null,
        district: district || null, block: block || null, panchayatIds: pids.size ? [...pids] : null,
        contactClientId: partner?.clientId ?? null, aiItemId: preset.aiItemId ?? null,
      });
      const names = agents.filter((a) => agentIds.has(a.agentId)).map((a) => a.name);
      onSaved(r.created === 1 ? `Task given to ${names[0]}. It shows in their app at the next sync.` : `Task given to ${r.created} agents. It shows in their app at the next sync.`);
      onClose();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const pl = places.data?.panchayats ?? [];
  return (
    <Modal title="Give a task" onClose={onClose} wide
      actions={<>
        <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="crm-btn" disabled={busy} onClick={save}><ClipboardCheck size={16} aria-hidden /> {busy ? 'Saving…' : agentIds.size > 1 ? `Give to ${agentIds.size} agents` : 'Give task'}</button>
      </>}>
      {board.error && <ErrorBox message={board.error} onRetry={board.reload} />}
      <label className="crm-field">What should they do?
        <input className="crm-input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Visit Dr Shafique's clinic and drop referral kits" />
      </label>
      <label className="crm-field"><span>Details <span className="crm-cell-sub" style={{ display: 'inline' }}>(optional)</span></span>
        <textarea className="crm-textarea" rows={2} style={{ minHeight: 64 }} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Anything that helps: who to meet, what to say, what to bring back." />
      </label>
      <div className="crm-form-grid">
        <label className="crm-field">Due by
          <input type="date" className="crm-input" min={istToday()} value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label className="crm-field">How urgent
          <select className="crm-select" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
            <option value="high">Urgent</option><option value="normal">Normal</option><option value="low">When free</option>
          </select>
        </label>
      </div>
      <label className="crm-field">Block
        <select className="crm-select" value={blockKey} onChange={(e) => { setBlockKey(e.target.value); setPids(new Set()); }}>
          <option value="">Any block</option>
          {(board.data?.blocks ?? []).map((b) => <option key={`${b.district}|${b.block}`} value={`${b.district}|${b.block}`}>{b.block} · {b.district}</option>)}
        </select>
      </label>
      {block && (
        <fieldset className="crm-field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ marginBottom: 6 }}>Panchayats <span className="crm-cell-sub" style={{ display: 'inline' }}>(optional · {pids.size} chosen)</span></legend>
          {places.error ? <ErrorBox message={places.error} onRetry={places.reload} /> : !places.data ? <Skeleton h={60} /> : (
            <div className="crm-chips" style={{ maxHeight: 132, overflowY: 'auto' }}>
              {pl.map((p) => <button key={p.panchayatId} type="button" className="crm-chip" aria-pressed={pids.has(p.panchayatId)} onClick={() => toggle(pids, p.panchayatId, setPids)}>{p.name}</button>)}
            </div>
          )}
        </fieldset>
      )}
      <fieldset className="crm-field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ marginBottom: 6 }}>Agents <span className="crm-cell-sub" style={{ display: 'inline' }}>({agentIds.size} chosen{block ? ' · those working here are listed first' : ''})</span></legend>
        {!board.data ? <Skeleton h={40} /> : (
          <div className="crm-chips">
            {agents.map((a) => (
              <button key={a.agentId} type="button" className="crm-chip" aria-pressed={agentIds.has(a.agentId)} onClick={() => toggle(agentIds, a.agentId, setAgentIds)}>
                {a.name}{a.block ? <span style={{ opacity: 0.7 }}> · {a.block}</span> : null}
              </button>
            ))}
          </div>
        )}
      </fieldset>
      <div className="crm-field"><span>Partner <span className="crm-cell-sub" style={{ display: 'inline' }}>(optional)</span></span>
        {partner ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Pill tone="info">{partner.name}</Pill><span className="crm-cell-sub">{partner.sub}</span>
            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setPartner(null)} style={{ marginLeft: 'auto' }}>Remove</button>
          </span>
        ) : (
          <>
            <input className="crm-input" aria-label="Find a partner" value={partnerQ} onChange={(e) => setPartnerQ(e.target.value)} placeholder="Type a partner's name…" />
            {found.length > 0 && partnerQ.trim().length >= 2 && (
              <ul className="crm-list" style={{ maxHeight: 180, overflowY: 'auto' }}>
                {found.map((f) => (
                  <li key={f.clientId} style={{ padding: 0, display: 'block' }}>
                    <button type="button" className="pt-name" style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 0' }} onClick={() => { setPartner(f); setPartnerQ(''); setFound([]); }}>
                      {f.name} <span className="crm-cell-sub" style={{ display: 'inline' }}>{f.sub}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      {error && <div className="crm-error" role="alert">{error}</div>}
    </Modal>
  );
}

// ─── Task list ────────────────────────────────────────────────────────────────────────────

const FILTERS = [{ k: 'open', l: 'Open' }, { k: 'overdue', l: 'Overdue' }, { k: 'done', l: 'Done' }, { k: 'cancelled', l: 'Cancelled' }] as const;

/** Tasks, everywhere or for one block. */
export function TaskList({ district, block, agents, editable, compact, version, onNew, showToast }: {
  district?: string; block?: string; agents?: TaskAgent[]; editable: boolean; compact?: boolean; version?: number;
  onNew?: () => void; showToast: (m: string) => void;
}) {
  const [status, setStatus] = useState<(typeof FILTERS)[number]['k']>('open');
  const [agentId, setAgentId] = useState('');
  const qs = new URLSearchParams({ status });
  if (agentId) qs.set('agentId', agentId);
  if (block) { qs.set('block', block); if (district) qs.set('district', district); }
  const list = useLoader(() => crm.get<TasksRes>(`/api/v1/tasks?${qs}`), [status, agentId, district, block, version]);
  const [openId, setOpenId] = useState<string | null>(null);

  const setTo = async (t: AgentTask, to: 'open' | 'cancelled') => {
    if (to === 'cancelled' && !window.confirm(`Cancel "${t.title}" for ${t.agentName}? It leaves their app. You can reopen it later.`)) return;
    try {
      await crm.post(`/api/v1/tasks/${t.id}/status?to=${to}`);
      showToast(to === 'cancelled' ? 'Task cancelled.' : 'Task reopened.');
      await list.reload();
    } catch (e) { showToast(friendlyError(e)); }
  };
  const c = list.data?.counts;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="pt-seg" role="group" aria-label="Show tasks">
          {FILTERS.map((f) => (
            <button key={f.k} type="button" aria-pressed={status === f.k} onClick={() => setStatus(f.k)}>
              {f.l}{c && f.k === 'open' ? ` ${c.open}` : c && f.k === 'overdue' && c.overdue ? ` ${c.overdue}` : ''}
            </button>
          ))}
        </div>
        {!compact && agents && (
          <>
            <label className="crm-sr" htmlFor="tk-agent">Agent</label>
            <select id="tk-agent" className="crm-select" style={{ width: 'auto' }} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">All agents</option>
              {agents.map((a) => <option key={a.agentId} value={a.agentId}>{a.name}</option>)}
            </select>
          </>
        )}
        {editable && onNew && <button type="button" className="crm-btn is-sm" style={{ marginLeft: 'auto' }} onClick={onNew}><Plus size={15} aria-hidden /> New task</button>}
      </div>
      {!compact && c && <span className="crm-cell-sub">{c.doneWeek} done in the last 7 days{c.overdue ? ` · ${c.overdue} overdue` : ''}</span>}

      {list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : !list.data ? <Skeleton h={compact ? 80 : 240} /> : list.data.tasks.length === 0 ? (
        <Empty title={status === 'open' ? 'No open tasks' : 'Nothing here'}>{status === 'open' && editable ? `Give an agent something to do${block ? ' in this block' : ''}. It shows at the top of their app's Today screen.` : ''}</Empty>
      ) : (
        <ul className="crm-list">
          {list.data.tasks.map((t) => {
            const isOpen = openId === t.id;
            return (
              <li key={t.id} style={{ display: 'block', padding: '10px 0' }}>
                <button type="button" className="an-item-head" aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? null : t.id)}>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    {t.status === 'done' ? <Pill tone="ok">Done</Pill> : t.status === 'cancelled' ? <Pill tone="neutral">Cancelled</Pill> : t.overdue ? <Pill tone="bad">Overdue</Pill> : null}
                    {t.priority !== 'normal' && t.status === 'open' && <Pill tone={PRIO[t.priority].tone}>{PRIO[t.priority].label}</Pill>}
                    {t.status === 'open' && !t.seenAt && <Pill tone="warn">Not seen yet</Pill>}
                    {t.aiItemId && <Pill tone="info">From AI analyst</Pill>}
                  </span>
                  <strong style={{ fontSize: 15 }}>{t.title}</strong>
                  <span className="crm-cell-sub">
                    {[t.agentName, t.dueDate && (t.status === 'open' ? `due ${day(t.dueDate)}` : null), t.status === 'done' && t.doneAt && `done ${fmt.dateTime(t.doneAt)}`,
                      !block && t.block, t.panchayats.length ? `${t.panchayats.length} panchayat${t.panchayats.length === 1 ? '' : 's'}` : null, t.partner?.name].filter(Boolean).join(' · ')}
                  </span>
                </button>
                {isOpen && (
                  <div className="an-item-body">
                    {t.detail && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{t.detail}</p>}
                    {t.panchayats.length > 0 && (
                      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <MapPin size={14} aria-hidden />{t.panchayats.map((p) => <Pill key={p.id}>{p.name}</Pill>)}
                      </span>
                    )}
                    {t.partner && <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}><User size={14} aria-hidden />{t.partner.name}<span className="crm-cell-sub">{contactTypeLabel(t.partner.type)}</span></span>}
                    {t.status === 'done' && (
                      <div className="crm-note" style={{ background: 'var(--ok-soft)' }}>
                        <CheckCircle2 size={14} aria-hidden style={{ verticalAlign: -2, marginRight: 6 }} />
                        <strong>{t.agentName}:</strong> {t.doneNote || 'Marked done, no note.'}
                      </div>
                    )}
                    <span className="crm-cell-sub">Given by {t.createdBy} on {fmt.dateTime(t.createdAt)}{t.seenAt ? ` · seen in the app ${fmt.dateTime(t.seenAt)}` : ''}</span>
                    {editable && (
                      <div className="crm-chips" style={{ justifyContent: 'flex-end' }}>
                        {t.status === 'open'
                          ? <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setTo(t, 'cancelled')}>Cancel task</button>
                          : <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setTo(t, 'open')}>Reopen</button>}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
