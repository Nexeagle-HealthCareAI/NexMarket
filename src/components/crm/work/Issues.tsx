'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark, Bug, CalendarDays, CheckSquare, ChevronRight, CornerDownRight, Flag, Layers, Pencil, Play, Plus, Search, Zap,
} from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { useLiveEvents } from '@/lib/crm/live';
import { friendlyError, Modal, Skeleton } from '@/components/crm/ui';
import {
  avatarColor, canParent, dueLabel, initials, ISSUE_TYPES, istToday, PRIORITY, SEVERITY, TYPE_META,
  type BoardRes, type Card, type IssueType, type Priority, type Severity, type Sprint, type Status,
} from './shared';

// ─── Type icons ─────────────────────────────────────────────────────────────────

const TYPE_ICON: Record<IssueType, typeof Zap> = { epic: Zap, feature: Layers, story: Bookmark, task: CheckSquare, bug: Bug, subtask: CornerDownRight };

/** The issue type as a small coloured square with its icon (with the name for screen readers). */
export function TypeIcon({ type = 'task', size = 16 }: { type?: IssueType; size?: number }) {
  const m = TYPE_META[type];
  const I = TYPE_ICON[type];
  return (
    <span className="wk-type" style={{ background: m.color, width: size, height: size }} title={m.label} role="img" aria-label={m.label}>
      <I size={size - 5} strokeWidth={2.6} aria-hidden />
    </span>
  );
}

export const STATUS_LABEL: Record<Status, string> = { idea: 'Ideas', todo: 'To do', doing: 'Doing', review: 'Check', done: 'Done' };
export function StatusPill({ status }: { status: Status }) {
  return <span className={`wk-stpill is-${status}`}>{STATUS_LABEL[status]}</span>;
}

const fmtDay = (d?: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');

// ─── Finding an issue (for links and parents) ───────────────────────────────────

export interface IssueHit { id: string; number: number; title: string; type: IssueType; status: Status }

/** Type a number (#12) or some words; the matching issues are listed to choose from. */
export function IssuePicker({ types, exclude = [], onPick, placeholder = 'Search: #12 or words in the title', autoFocus }: {
  types?: IssueType[]; exclude?: string[]; onPick: (hit: IssueHit) => void; placeholder?: string; autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<IssueHit[] | null>(null);
  const [hi, setHi] = useState(0);
  const typeKey = (types ?? []).join(',');
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      const sp = new URLSearchParams();
      if (q.trim()) sp.set('q', q.trim());
      if (typeKey) sp.set('types', typeKey);
      crm.get<IssueHit[]>(`/api/v1/work/search?${sp}`).then((r) => { if (alive) { setHits(r); setHi(0); } }).catch(() => { if (alive) setHits([]); });
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [q, typeKey]);
  const list = (hits ?? []).filter((h) => !exclude.includes(h.id));
  return (
    <div className="wk-ipick">
      <label className="crm-search"><Search size={15} aria-hidden /><span className="crm-sr">{placeholder}</span>
        <input className="crm-input" value={q} autoFocus={autoFocus} placeholder={placeholder} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, list.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            if (e.key === 'Enter' && list[hi]) { e.preventDefault(); onPick(list[hi]); }
          }} />
      </label>
      {hits && (
        <ul className="wk-ipick-list" role="listbox">
          {list.length === 0 ? <li className="crm-sub" style={{ padding: 8 }}>No matching issues.</li> : list.map((h, i) => (
            <li key={h.id} role="option" aria-selected={i === hi}>
              <button type="button" onClick={() => onPick(h)}><TypeIcon type={h.type} /> <span className="crm-sub">#{h.number}</span> <span className="wk-ipick-t">{h.title}</span> <StatusPill status={h.status} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Create an issue (Jira's "Create" box) ──────────────────────────────────────

export interface NewIssue {
  type: IssueType; title: string; description: string; parent: IssueHit | null; assignees: string[]; reporter: string; priority: Priority;
  labels: string; startDate: string; dueDate: string; storyPoints: string; estimate: string; sprintId: string; status: Status;
  severity: Severity | ''; environment: string; steps: string; expected: string; actual: string; acceptance: string;
}

export function CreateIssue({ board, onClose, onCreated, toast, start }: {
  board: BoardRes; onClose: () => void; onCreated: (c: Card) => void; toast: (m: string) => void; start?: Partial<NewIssue>;
}) {
  const [f, setF] = useState<NewIssue>({
    type: 'task', title: '', description: '', parent: null, assignees: [], reporter: board.me, priority: 'normal', labels: '', startDate: '', dueDate: '',
    storyPoints: '', estimate: '', sprintId: '', status: 'todo', severity: '', environment: '', steps: '', expected: '', actual: '', acceptance: '', ...start,
  });
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [pickParent, setPickParent] = useState(false);
  const set = <K extends keyof NewIssue>(k: K, v: NewIssue[K]) => setF((x) => ({ ...x, [k]: v }));
  const office = board.people;
  const parentOk = !f.parent || canParent(f.type, f.parent.type);
  const needParent = f.type === 'subtask' && !f.parent;
  const ptypes = ISSUE_TYPES.filter((t) => canParent(f.type, t));

  const save = async (again: boolean) => {
    if (!f.title.trim()) { toast('Write a summary.'); return; }
    if (!parentOk || needParent) { toast(needParent ? 'A sub-task needs a story, task or bug above it.' : `A ${TYPE_META[f.type].label.toLowerCase()} can't go under a ${TYPE_META[f.parent!.type].label.toLowerCase()}.`); return; }
    setBusy(true);
    try {
      const c = await crm.post<Card>('/api/v1/work/cards', {
        type: f.type, title: f.title.trim(), description: f.description, parentId: f.parent?.id, assignees: f.assignees, reporter: f.reporter, priority: f.priority,
        labels: f.labels.split(/[\s,]+/).filter(Boolean), startDate: f.startDate, dueDate: f.dueDate, status: f.status,
        storyPoints: f.storyPoints === '' ? undefined : Number(f.storyPoints), estimate: f.estimate || undefined, sprintId: f.sprintId || undefined,
        ...(f.type === 'bug' ? { severity: f.severity, environment: f.environment, steps: f.steps, expected: f.expected, actual: f.actual } : {}),
        ...(f.type === 'story' || f.type === 'feature' || f.type === 'epic' ? { acceptance: f.acceptance } : {}),
      });
      onCreated(c);
      toast(`Created ${TYPE_META[f.type].label.toLowerCase()} #${c.number}.`);
      if (again) setF((x) => ({ ...x, title: '', description: '', steps: '', expected: '', actual: '', acceptance: '', storyPoints: '', estimate: '' }));
      else onClose();
    } catch (e) { toast(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <Modal title="Create issue" wide onClose={onClose} actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="crm-btn is-secondary" disabled={busy} onClick={() => void save(true)}>Create and add another</button>
      <button type="button" className="crm-btn" disabled={busy || !f.title.trim()} onClick={() => void save(false)}>{busy ? 'Creating…' : 'Create'}</button>
    </>}>
      <form className="wk-create" onSubmit={(e) => { e.preventDefault(); void save(false); }}>
        <div className="wk-create-types" role="radiogroup" aria-label="Issue type">
          {ISSUE_TYPES.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={f.type === t} className="wk-create-type" title={TYPE_META[t].hint} onClick={() => set('type', t)}>
              <TypeIcon type={t} size={18} /> {TYPE_META[t].label}
            </button>
          ))}
        </div>
        <p className="crm-sub wk-create-hint">{TYPE_META[f.type].hint}</p>
        <label className="crm-field"><span>Summary</span>
          <input className="crm-input" autoFocus value={f.title} maxLength={200} onChange={(e) => set('title', e.target.value)}
            placeholder={f.type === 'story' ? 'As a patient, I want to book a camp slot on WhatsApp' : f.type === 'bug' ? 'Leads from the website form have no phone number' : f.type === 'epic' ? 'December health camps' : 'What needs doing'} /></label>
        <label className="crm-field"><span>Description</span>
          <textarea className="crm-input crm-textarea" rows={4} value={f.description} maxLength={8000} onChange={(e) => set('description', e.target.value)} placeholder="The details: why, what exactly, who to talk to, links…" /></label>

        {(f.type === 'story' || f.type === 'feature' || f.type === 'epic') && (
          <label className="crm-field"><span>Acceptance criteria <span className="crm-sub">(what “done” means, one per line)</span></span>
            <textarea className="crm-input crm-textarea" rows={3} value={f.acceptance} maxLength={8000} onChange={(e) => set('acceptance', e.target.value)} placeholder={'Patient gets a confirmation on WhatsApp\nThe desk sees the booking in Leads'} /></label>
        )}
        {f.type === 'bug' && (
          <div className="wk-create-grid">
            <label className="crm-field"><span>Severity</span>
              <select className="crm-input" value={f.severity} onChange={(e) => set('severity', e.target.value as Severity | '')}>
                <option value="">Not set</option>{(Object.keys(SEVERITY) as Severity[]).map((s) => <option key={s} value={s}>{SEVERITY[s].label}</option>)}
              </select></label>
            <label className="crm-field"><span>Where it happens</span><input className="crm-input" value={f.environment} maxLength={1000} onChange={(e) => set('environment', e.target.value)} placeholder="Agent app on Android, CRM in Chrome…" /></label>
            <label className="crm-field wk-span2"><span>Steps to make it happen</span><textarea className="crm-input crm-textarea" rows={3} value={f.steps} maxLength={8000} onChange={(e) => set('steps', e.target.value)} placeholder={'1. Open Leads\n2. Press “New lead”\n3. …'} /></label>
            <label className="crm-field"><span>What should happen</span><textarea className="crm-input crm-textarea" rows={2} value={f.expected} maxLength={4000} onChange={(e) => set('expected', e.target.value)} /></label>
            <label className="crm-field"><span>What happens instead</span><textarea className="crm-input crm-textarea" rows={2} value={f.actual} maxLength={4000} onChange={(e) => set('actual', e.target.value)} /></label>
          </div>
        )}

        <div className="wk-create-grid">
          {f.type !== 'epic' && (
            <div className="crm-field wk-span2"><span>{f.type === 'subtask' ? 'Belongs to (story, task or bug)' : 'Belongs to (epic, feature or story — optional)'}</span>
              {f.parent && !pickParent ? (
                <div className="wk-create-parent">
                  <TypeIcon type={f.parent.type} /> <span className="crm-sub">#{f.parent.number}</span> {f.parent.title}
                  {!parentOk && <span className="wk-late">doesn’t fit</span>}
                  <button type="button" className="wa-link" onClick={() => setPickParent(true)}>Change</button>
                  <button type="button" className="wa-link" onClick={() => set('parent', null)}>Remove</button>
                </div>
              ) : pickParent || needParent ? (
                <IssuePicker types={ptypes} onPick={(h) => { set('parent', h); setPickParent(false); }} placeholder={`Find the ${ptypes.map((t) => TYPE_META[t].label.toLowerCase()).join(' or ')}`} />
              ) : <button type="button" className="wk-add-mini" onClick={() => setPickParent(true)}><Plus size={13} aria-hidden /> Choose</button>}
            </div>
          )}
          <label className="crm-field"><span>Assignee</span>
            <select className="crm-input" value={f.assignees[0] ?? ''} onChange={(e) => set('assignees', e.target.value ? [e.target.value] : [])}>
              <option value="">Unassigned</option><option value={board.me}>Me</option>
              {office.filter((p) => p.agentId !== board.me).map((p) => <option key={p.agentId} value={p.agentId}>{p.name}{p.role === 'field_rep' ? ' (field)' : ''}</option>)}
            </select></label>
          <label className="crm-field"><span>Priority</span>
            <select className="crm-input" value={f.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
              {(Object.keys(PRIORITY) as Priority[]).map((k) => <option key={k} value={k}>{PRIORITY[k].label}</option>)}
            </select></label>
          <label className="crm-field"><span>Start date</span><input type="date" className="crm-input" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></label>
          <label className="crm-field"><span>Due date</span><input type="date" className="crm-input" value={f.dueDate} min={f.startDate || undefined} onChange={(e) => set('dueDate', e.target.value)} /></label>
          {f.type !== 'epic' && (board.sprints?.length ?? 0) > 0 && (
            <label className="crm-field"><span>Sprint</span>
              <select className="crm-input" value={f.sprintId} onChange={(e) => set('sprintId', e.target.value)}>
                <option value="">Backlog</option>{board.sprints!.map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === 'active' ? ' (running)' : ''}</option>)}
              </select></label>
          )}
          {f.type !== 'epic' && f.type !== 'subtask' && (
            <label className="crm-field"><span>Story points</span>
              <select className="crm-input" value={f.storyPoints} onChange={(e) => set('storyPoints', e.target.value)}>
                <option value="">Not estimated</option>{[1, 2, 3, 5, 8, 13, 21].map((n) => <option key={n} value={n}>{n}</option>)}
              </select></label>
          )}
        </div>
        <button type="button" className="wa-link" aria-expanded={more} onClick={() => setMore((m) => !m)}><ChevronRight size={13} aria-hidden style={{ transform: more ? 'rotate(90deg)' : undefined }} /> More fields</button>
        {more && (
          <div className="wk-create-grid">
            <label className="crm-field"><span>Reporter</span>
              <select className="crm-input" value={f.reporter} onChange={(e) => set('reporter', e.target.value)}>
                {office.map((p) => <option key={p.agentId} value={p.agentId}>{p.name}</option>)}
              </select></label>
            <label className="crm-field"><span>Column</span>
              <select className="crm-input" value={f.status} onChange={(e) => set('status', e.target.value as Status)}>
                {board.columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select></label>
            <label className="crm-field"><span>Original estimate</span><input className="crm-input" value={f.estimate} onChange={(e) => set('estimate', e.target.value)} placeholder="e.g. 2h 30m, 1d" /></label>
            <label className="crm-field"><span>Labels</span><input className="crm-input" value={f.labels} onChange={(e) => set('labels', e.target.value)} placeholder="camp, social" list="wk-labels-c" />
              <datalist id="wk-labels-c">{board.labels.map((l) => <option key={l} value={l} />)}</datalist></label>
          </div>
        )}
      </form>
    </Modal>
  );
}

// ─── Backlog and sprints ────────────────────────────────────────────────────────

/** One issue as a row in the backlog. */
function Row({ c, board, onOpen, epicOf, selected, onSelect, onDragStart }: {
  c: Card; board: BoardRes; onOpen: () => void; epicOf: (c: Card) => Card | undefined; selected: boolean; onSelect: (multi: boolean) => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const ep = epicOf(c);
  const a = c.assignees[0];
  const p = board.people.find((x) => x.agentId === a);
  return (
    <div className={`wk-bl-row${selected ? ' is-sel' : ''}${c.status === 'done' ? ' is-done' : ''}`} draggable onDragStart={onDragStart}
      onClick={(e) => { if (e.ctrlKey || e.metaKey || e.shiftKey) onSelect(true); else onOpen(); }} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); if (e.key === ' ') { e.preventDefault(); onSelect(true); } }} aria-label={`#${c.number} ${c.title}`}>
      <input type="checkbox" className="wk-bl-check" checked={selected} onClick={(e) => e.stopPropagation()} onChange={() => onSelect(true)} aria-label={`Select #${c.number}`} />
      <TypeIcon type={c.type} />
      <span className="crm-sub wk-bl-num">#{c.number}</span>
      <span className="wk-bl-title">{c.title}</span>
      {ep && <span className="wk-epic-chip" title={`Epic: ${ep.title}`}>{ep.title}</span>}
      {c.dueDate && <span className={`wk-due${c.overdue ? ' is-late' : ''}`}><CalendarDays size={12} aria-hidden />{dueLabel(c.dueDate)}</span>}
      <StatusPill status={c.status} />
      <span className="wk-pts" title="Story points">{c.storyPoints ?? '–'}</span>
      <span className="wk-pdot" style={{ background: PRIORITY[c.priority].color }} title={`${PRIORITY[c.priority].label} priority`} />
      {a ? <span className="wk-av" title={p?.name ?? a} style={{ width: 24, height: 24, fontSize: 10, background: avatarColor(a) }}>{initials(p?.name ?? a)}</span> : <span className="wk-av is-empty" title="Unassigned" />}
    </div>
  );
}

/**
 * The backlog, Jira style: every open sprint (the running one first) and the backlog under them. Drag issues between
 * them (or select several and drag them together), start a sprint, and complete it.
 */
export function Backlog({ board, openCard, toast, reload, onCreate }: {
  board: BoardRes; openCard: (id: string) => void; toast: (m: string) => void; reload: () => void; onCreate: (start: Partial<NewIssue>) => void;
}) {
  const [sprints, setSprints] = useState<Sprint[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [over, setOver] = useState<string | null>(null);
  const [edit, setEdit] = useState<Sprint | null>(null);
  const [closing, setClosing] = useState<Sprint | null>(null);
  const [epic, setEpic] = useState('');
  const [q, setQ] = useState('');
  const load = useCallback(async () => {
    try { setSprints((await crm.get<{ open: Sprint[] }>('/api/v1/work/sprints')).open); } catch (e) { toast(friendlyError(e)); setSprints([]); }
  }, [toast]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  useLiveEvents(useCallback((e) => { if (e.kind === 'work') void load(); }, [load]));

  const byId = useMemo(() => new Map(board.cards.map((c) => [c.id, c])), [board.cards]);
  const epicOf = useCallback((c: Card) => {
    for (let x: Card | undefined = c, i = 0; x && i < 5; x = x.parentId ? byId.get(x.parentId) : undefined, i++) if (x.type === 'epic' && x.id !== c.id) return x;
    return undefined;
  }, [byId]);
  const epics = board.cards.filter((c) => c.type === 'epic' && c.status !== 'done');
  const s = q.trim().toLowerCase();
  const issues = board.cards.filter((c) => c.type !== 'epic' && c.type !== 'subtask' && !c.archived
    && (!epic || epicOf(c)?.id === epic) && (!s || c.title.toLowerCase().includes(s) || `#${c.number}` === s));
  const inSprint = (id: string | null) => issues.filter((c) => (c.sprintId ?? null) === id && (id !== null || c.status !== 'done')).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const pts = (list: Card[]) => list.reduce((n, c) => n + (c.storyPoints ?? 0), 0);

  const plan = async (ids: string[], sprintId: string | null, before?: string | null, after?: string | null) => {
    try { await crm.post('/api/v1/work/plan', { ids, sprintId: sprintId ?? '00000000-0000-0000-0000-000000000000', before, after }); setSel(new Set()); reload(); }
    catch (e) { toast(friendlyError(e)); }
  };
  const dragStart = (e: React.DragEvent, c: Card) => {
    const ids = sel.has(c.id) ? [...sel] : [c.id];
    e.dataTransfer.setData('application/x-wk-issues', JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';
  };
  /** Drop on a list (at its end) or on a row (just above it). */
  const dropProps = (sprintId: string | null, key: string, list: Card[], beforeIdx?: number) => ({
    onDragOver: (e: React.DragEvent) => { if (!e.dataTransfer.types.includes('application/x-wk-issues')) return; e.preventDefault(); e.stopPropagation(); setOver(key); },
    onDragLeave: (e: React.DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver((o) => (o === key ? null : o)); },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault(); e.stopPropagation(); setOver(null);
      try {
        const ids = JSON.parse(e.dataTransfer.getData('application/x-wk-issues')) as string[];
        const rest = list.filter((c) => !ids.includes(c.id));
        const i = beforeIdx == null ? rest.length : rest.findIndex((c) => c.id === list[beforeIdx]?.id);
        const at = i < 0 ? rest.length : i;
        void plan(ids, sprintId, rest[at]?.id ?? null, rest[at - 1]?.id ?? null);
      } catch { /* not ours */ }
    },
  });
  const pick = (id: string) => setSel((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const newSprint = async () => {
    try { await crm.post('/api/v1/work/sprints', {}); void load(); reload(); toast('Sprint added. Drag issues into it, then press Start.'); }
    catch (e) { toast(friendlyError(e)); }
  };
  const start = async (sp: Sprint) => {
    try { await crm.post(`/api/v1/work/sprints/${sp.id}/start`); void load(); reload(); toast(`${sp.name} started. The board shows its issues.`); }
    catch (e) { toast(friendlyError(e)); }
  };

  if (!sprints) return <Skeleton h={400} />;
  const list = (sp: Sprint | null) => {
    const id = sp?.id ?? null;
    const rows = inSprint(id);
    const key = id ?? 'backlog';
    const done = rows.filter((c) => c.status === 'done');
    return (
      <section key={key} className={`wk-bl-sec${over === key ? ' is-over' : ''}${sp?.status === 'active' ? ' is-active' : ''}`} {...dropProps(id, key, rows)}>
        <header className="wk-bl-head">
          {sp ? (
            <>
              <strong>{sp.name}</strong>
              {sp.status === 'active' && <span className="wk-stpill is-doing">Running</span>}
              <span className="crm-sub">{sp.startDate ? `${fmtDay(sp.startDate)} – ${fmtDay(sp.endDate)}` : 'No dates yet'} · {rows.length} issue{rows.length === 1 ? '' : 's'} · {pts(rows)} points{sp.status === 'active' ? ` · ${pts(done)} done` : ''}</span>
              <span className="sp-actions">
                <button type="button" className="wk-icon-btn" aria-label={`Edit ${sp.name}`} title="Name, goal and dates" onClick={() => setEdit(sp)}><Pencil size={14} aria-hidden /></button>
                {sp.status === 'planned' && <button type="button" className="crm-btn is-sm" disabled={sprints.some((x) => x.status === 'active')} title={sprints.some((x) => x.status === 'active') ? 'Complete the running sprint first' : undefined} onClick={() => void start(sp)}><Play size={13} aria-hidden /> Start sprint</button>}
                {sp.status === 'active' && <button type="button" className="crm-btn is-sm" onClick={() => setClosing(sp)}><Flag size={13} aria-hidden /> Complete sprint</button>}
              </span>
            </>
          ) : (
            <>
              <strong>Backlog</strong><span className="crm-sub">{rows.length} issue{rows.length === 1 ? '' : 's'} · {pts(rows)} points</span>
              <span className="sp-actions"><button type="button" className="crm-btn is-secondary is-sm" onClick={() => void newSprint()}><Plus size={13} aria-hidden /> Create sprint</button></span>
            </>
          )}
        </header>
        {sp?.goal && <p className="wk-bl-goal"><strong>Goal:</strong> {sp.goal}</p>}
        <div className="wk-bl-list">
          {rows.length === 0 && <p className="wk-bl-empty">{sp ? 'Drag issues here from the backlog.' : 'The backlog is empty. Create an issue, or drag one back here from a sprint.'}</p>}
          {rows.map((c, i) => (
            <div key={c.id} className={over === `${key}:${c.id}` ? 'wk-bl-drop' : undefined} {...dropProps(id, `${key}:${c.id}`, rows, i)}>
              <Row c={c} board={board} onOpen={() => openCard(c.id)} epicOf={epicOf} selected={sel.has(c.id)} onSelect={() => pick(c.id)} onDragStart={(e) => dragStart(e, c)} />
            </div>
          ))}
          <button type="button" className="wk-col-addbtn" onClick={() => onCreate({ sprintId: id ?? '', ...(epic ? { parent: { id: epic, number: byId.get(epic)!.number, title: byId.get(epic)!.title, type: 'epic', status: 'todo' } } : {}) })}><Plus size={14} aria-hidden /> Create issue</button>
        </div>
      </section>
    );
  };

  return (
    <div className="wk-bl">
      <div className="wk-bl-bar">
        <label className="crm-search wk-search"><Search size={15} aria-hidden /><span className="crm-sr">Search the backlog</span>
          <input className="crm-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search or #12" /></label>
        <select className="crm-input wk-sel" value={epic} onChange={(e) => setEpic(e.target.value)} aria-label="Epic">
          <option value="">All epics</option>{epics.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
        </select>
        {sel.size > 0 && (
          <span className="wk-selbar">
            <strong>{sel.size} selected</strong>
            <select className="crm-input wk-small-in" value="" aria-label="Move the selected issues" onChange={(e) => { if (e.target.value) void plan([...sel], e.target.value === 'backlog' ? null : e.target.value); }}>
              <option value="">Move to…</option>{sprints.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}<option value="backlog">Backlog</option>
            </select>
            <button type="button" className="wa-link" onClick={() => setSel(new Set())}>Clear</button>
          </span>
        )}
        <span className="crm-sub wk-bl-tip">Drag issues between sprints and the backlog · Ctrl-click to select several</span>
      </div>
      {sprints.map((sp) => list(sp))}
      {list(null)}
      {edit && <SprintForm sprint={edit} onClose={() => setEdit(null)} toast={toast} onSaved={() => { setEdit(null); void load(); reload(); }} />}
      {closing && <CompleteSprint sprint={closing} next={sprints.filter((x) => x.status === 'planned')} open={inSprint(closing.id).filter((c) => c.status !== 'done').length}
        done={inSprint(closing.id).filter((c) => c.status === 'done').length} onClose={() => setClosing(null)} toast={toast} onDone={() => { setClosing(null); void load(); reload(); }} />}
    </div>
  );
}

function SprintForm({ sprint, onClose, onSaved, toast }: { sprint: Sprint; onClose: () => void; onSaved: () => void; toast: (m: string) => void }) {
  const [f, setF] = useState({ name: sprint.name, goal: sprint.goal ?? '', startDate: sprint.startDate ?? '', endDate: sprint.endDate ?? '' });
  const save = async () => {
    try { await crm.put(`/api/v1/work/sprints/${sprint.id}`, f); toast('Sprint saved.'); onSaved(); } catch (e) { toast(friendlyError(e)); }
  };
  return (
    <Modal title={`Edit ${sprint.name}`} onClose={onClose} actions={<><button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button><button type="button" className="crm-btn" onClick={() => void save()}>Save</button></>}>
      <div className="wk-create">
        <label className="crm-field"><span>Name</span><input className="crm-input" value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="crm-field"><span>Sprint goal</span><textarea className="crm-input crm-textarea" rows={2} maxLength={500} value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} placeholder="What the team wants to have done by the end" /></label>
        <div className="wk-create-grid">
          <label className="crm-field"><span>Starts</span><input type="date" className="crm-input" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></label>
          <label className="crm-field"><span>Ends</span><input type="date" className="crm-input" value={f.endDate} min={f.startDate || undefined} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></label>
        </div>
      </div>
    </Modal>
  );
}

export function CompleteSprint({ sprint, next, open, done, onClose, onDone, toast }: {
  sprint: Sprint; next: Sprint[]; open: number; done: number; onClose: () => void; onDone: () => void; toast: (m: string) => void;
}) {
  const [to, setTo] = useState(next[0]?.id ?? '');
  const go = async () => {
    try {
      const r = await crm.post<{ done: number; moved: number }>(`/api/v1/work/sprints/${sprint.id}/complete`, { moveTo: to || null });
      toast(`${sprint.name} completed: ${r.done} done${r.moved ? `, ${r.moved} moved on` : ''}.`); onDone();
    } catch (e) { toast(friendlyError(e)); }
  };
  return (
    <Modal title={`Complete ${sprint.name}`} onClose={onClose} actions={<><button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button><button type="button" className="crm-btn" onClick={() => void go()}>Complete sprint</button></>}>
      <p style={{ marginTop: 0 }}><strong>{done}</strong> issue{done === 1 ? '' : 's'} done, <strong>{open}</strong> not finished.</p>
      {open > 0 && (
        <label className="crm-field"><span>Move the unfinished issues to</span>
          <select className="crm-input" value={to} onChange={(e) => setTo(e.target.value)}>
            {next.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}<option value="">The backlog</option>
          </select></label>
      )}
    </Modal>
  );
}

// ─── Timeline (roadmap) ─────────────────────────────────────────────────────────

/**
 * Epics and features (and what is under them, when opened) as bars from their start to their due date, week by week,
 * with today marked. Issues without dates are listed so they can be given some.
 */
export function Timeline({ board, openCard }: { board: BoardRes; openCard: (id: string) => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [weeks, setWeeks] = useState(16);
  const scroller = useRef<HTMLDivElement>(null);
  const today = istToday();
  const DAY = 864e5;
  const toMs = (d: string) => new Date(`${d}T00:00:00Z`).getTime();
  const t0 = toMs(today);
  // From the Monday four weeks ago.
  const mondayOff = (new Date(t0).getUTCDay() + 6) % 7;
  const from = t0 - (mondayOff + 28) * DAY;
  const COL = 84;   // px per week
  const x = (d: string) => ((toMs(d) - from) / DAY) * (COL / 7);
  const kids = (id: string) => board.cards.filter((c) => c.parentId === id && !c.archived);
  const tops = board.cards.filter((c) => (c.type === 'epic' || (c.type === 'feature' && !board.cards.some((p) => p.id === c.parentId && p.type === 'epic'))) && !c.archived);
  // Today in view when the timeline first opens (not again, so it doesn't jump while someone scrolls).
  const todayX = x(today);
  const scrolled = useRef(false);
  useEffect(() => { if (!scrolled.current && scroller.current) { scroller.current.scrollLeft = Math.max(0, todayX - 200); scrolled.current = true; } }, [todayX]);

  const rows: { c: Card; depth: number }[] = [];
  const walk = (c: Card, depth: number) => { rows.push({ c, depth }); if (open.has(c.id)) kids(c.id).filter((k) => k.type !== 'subtask').forEach((k) => walk(k, depth + 1)); };
  tops.sort((a, b) => (a.startDate ?? a.dueDate ?? '9999').localeCompare(b.startDate ?? b.dueDate ?? '9999')).forEach((c) => walk(c, 0));

  return (
    <section className="crm-card wk-tl">
      {tops.length === 0 ? <p className="crm-sub" style={{ margin: 0 }}>No epics yet. Create an epic (for example “December health camps”), give it a start and due date, and put its stories and tasks under it.</p> : (
        <div className="wk-tl-wrap">
          <div className="wk-tl-names">
            <div className="wk-tl-hcell">Epic / feature</div>
            {rows.map(({ c, depth }) => {
              const k = kids(c.id).filter((y) => y.type !== 'subtask');
              const r = board.rollup?.[c.id];
              return (
                <div key={c.id} className="wk-tl-name" style={{ paddingLeft: 8 + depth * 16 }}>
                  {k.length > 0 ? <button type="button" className="wk-tree-tog" aria-expanded={open.has(c.id)} aria-label={open.has(c.id) ? 'Close' : 'Open'}
                    onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}><ChevronRight size={13} aria-hidden style={{ transform: open.has(c.id) ? 'rotate(90deg)' : undefined }} /></button> : <span className="wk-tree-tog" />}
                  <TypeIcon type={c.type} />
                  <button type="button" className="wk-tl-link" onClick={() => openCard(c.id)} title={c.title}>{c.title}</button>
                  {r && r.total > 0 && <span className="crm-sub wk-tl-prog">{Math.round((r.done / r.total) * 100)}%</span>}
                </div>
              );
            })}
          </div>
          <div className="wk-tl-grid" ref={scroller}>
            <div style={{ width: weeks * COL, position: 'relative' }}>
              <div className="wk-tl-weeks">
                {Array.from({ length: weeks }, (_, i) => {
                  const d = new Date(from + i * 7 * DAY);
                  return <div key={i} className="wk-tl-week" style={{ width: COL }}>{d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</div>;
                })}
              </div>
              <div className="wk-tl-today" style={{ left: x(today) }} title="Today" />
              {rows.map(({ c }) => {
                const st = c.startDate ?? c.dueDate;
                const en = c.dueDate ?? c.startDate;
                const r = board.rollup?.[c.id];
                const pct = r && r.total ? r.done / r.total : c.status === 'done' ? 1 : 0;
                return (
                  <div key={c.id} className="wk-tl-row" style={{ width: weeks * COL }}>
                    {st && en ? (
                      <button type="button" className={`wk-tl-bar is-${c.type}${c.overdue ? ' is-late' : ''}`} onClick={() => openCard(c.id)}
                        style={{ left: x(st), width: Math.max(COL / 7, x(en) - x(st) + COL / 7) }}
                        title={`${c.title}: ${fmtDay(c.startDate) || '—'} to ${fmtDay(c.dueDate) || '—'}${r && r.total ? ` · ${r.done} of ${r.total} done` : ''}`}>
                        <span className="wk-tl-fill" style={{ width: `${pct * 100}%` }} />
                        <span className="wk-tl-label">{c.title}</span>
                      </button>
                    ) : <button type="button" className="wk-tl-nodates" onClick={() => openCard(c.id)}>No dates: open to set them</button>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {tops.length > 0 && <div className="wk-tl-foot"><span className="crm-sub">Bars run from the start date to the due date; the darker part is how much is done. The blue line is today.</span>
        <button type="button" className="wa-link" onClick={() => setWeeks((w) => w + 8)}>Show 8 more weeks</button></div>}
    </section>
  );
}

// ─── Reports: burndown and velocity ─────────────────────────────────────────────

interface Report {
  sprint: Sprint; burndown: { day: string; remaining: number | null; ideal: number }[];
  byStatus: { status: Status; issues: number; points: number }[]; byType: { type: IssueType; issues: number }[]; noPoints: number;
  velocity: { name: string; committed: number; completed: number }[];
}

/** A sprint's burndown (points left each day against the ideal line), what is in it, and the team's velocity. */
export function Reports({ board, toast }: { board: BoardRes; toast: (m: string) => void }) {
  const [all, setAll] = useState<Sprint[] | null>(null);
  const [id, setId] = useState('');
  const [r, setR] = useState<Report | null>(null);
  useEffect(() => {
    crm.get<{ open: Sprint[]; closed: Sprint[] }>('/api/v1/work/sprints').then((x) => {
      const list = [...x.open.filter((s) => s.status === 'active'), ...x.closed];
      setAll(list); setId((cur) => cur || list[0]?.id || '');
    }).catch((e) => { toast(friendlyError(e)); setAll([]); });
  }, [toast]);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    crm.get<Report>(`/api/v1/work/sprints/${id}/report`).then((x) => { if (alive) setR(x); }).catch((e) => toast(friendlyError(e)));
    return () => { alive = false; };
  }, [id, toast]);
  void board;
  if (!all) return <Skeleton h={400} />;
  if (all.length === 0) return <section className="crm-card"><p className="crm-sub" style={{ margin: 0 }}>Reports appear once a sprint has started. Open the Backlog, create a sprint, drag issues into it and press Start.</p></section>;
  return (
    <div className="wk-rep">
      <div className="wk-bl-bar">
        <select className="crm-input wk-sel" value={id} onChange={(e) => setId(e.target.value)} aria-label="Sprint">
          {all.map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === 'active' ? ' (running)' : ''}</option>)}
        </select>
        {r?.sprint.goal && <span className="crm-sub">Goal: {r.sprint.goal}</span>}
      </div>
      {!r ? <Skeleton h={300} /> : (
        <div className="wk-rep-grid">
          <section className="crm-card">
            <h3 className="wk-rep-h">Burndown <span className="crm-sub">story points left</span></h3>
            <Burndown data={r.burndown} />
            {r.noPoints > 0 && <p className="crm-sub" style={{ marginBottom: 0 }}>{r.noPoints} issue{r.noPoints === 1 ? ' has' : 's have'} no story points, so {r.noPoints === 1 ? 'it doesn’t' : 'they don’t'} count here.</p>}
          </section>
          <section className="crm-card">
            <h3 className="wk-rep-h">In this sprint</h3>
            <table className="crm-table wk-rep-table">
              <thead><tr><th scope="col">Column</th><th scope="col" className="is-num">Issues</th><th scope="col" className="is-num">Points</th></tr></thead>
              <tbody>{r.byStatus.map((s) => <tr key={s.status}><td><StatusPill status={s.status} /></td><td className="is-num">{s.issues}</td><td className="is-num">{s.points}</td></tr>)}</tbody>
            </table>
            <div className="wk-rep-types">{r.byType.map((t) => <span key={t.type} className="wk-chip"><TypeIcon type={t.type} size={14} /> {t.issues} {TYPE_META[t.type].label.toLowerCase()}{t.issues === 1 ? '' : 's'}</span>)}</div>
          </section>
          <section className="crm-card wk-span2">
            <h3 className="wk-rep-h">Velocity <span className="crm-sub">points committed and completed in each finished sprint</span></h3>
            {r.velocity.length === 0 ? <p className="crm-sub">Shown once a sprint has been completed.</p> : <Velocity data={r.velocity} />}
          </section>
        </div>
      )}
    </div>
  );
}

const INK = { accent: '#0a72d6', muted: '#8a93a6', grid: '#eef0f4', text: '#5a6478' };

function Burndown({ data }: { data: Report['burndown'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 240, L = 36, R = 28, T = 12, B = 28;
  const max = Math.max(1, ...data.map((d) => Math.max(d.ideal, d.remaining ?? 0)));
  const xs = (i: number) => L + (data.length <= 1 ? 0 : (i / (data.length - 1)) * (W - L - R));
  const ys = (v: number) => T + (1 - v / max) * (H - T - B);
  const ideal = data.map((d, i) => `${i ? 'L' : 'M'}${xs(i)},${ys(d.ideal)}`).join(' ');
  const done = data.filter((d) => d.remaining != null);
  const rem = done.map((d, i) => `${i ? 'L' : 'M'}${xs(data.indexOf(d))},${ys(d.remaining!)}`).join(' ');
  const ticks = [0, Math.round(max / 2), max];
  const h = hover != null ? data[hover] : null;
  return (
    <div className="wk-chart">
      <div className="wk-legend"><span><i style={{ background: INK.accent }} /> Points left</span><span><i className="is-dash" /> Ideal</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Burndown chart" onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => { const b = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const px = ((e.clientX - b.left) / b.width) * W; const i = Math.round(((px - L) / (W - L - R)) * (data.length - 1)); setHover(Math.max(0, Math.min(data.length - 1, i))); }}>
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={ys(t)} y2={ys(t)} stroke={INK.grid} /><text x={L - 6} y={ys(t) + 4} textAnchor="end" fontSize="11" fill={INK.text}>{t}</text></g>)}
        {data.map((d, i) => (i % Math.ceil(data.length / 7) === 0 || i === data.length - 1) && <text key={d.day} x={xs(i)} y={H - 8} textAnchor="middle" fontSize="11" fill={INK.text}>{fmtDay(d.day)}</text>)}
        <path d={ideal} fill="none" stroke={INK.muted} strokeWidth="2" strokeDasharray="5 5" />
        {rem && <path d={rem} fill="none" stroke={INK.accent} strokeWidth="2" strokeLinejoin="round" />}
        {done.length > 0 && <circle cx={xs(data.indexOf(done[done.length - 1]))} cy={ys(done[done.length - 1].remaining!)} r="4" fill={INK.accent} stroke="#fff" strokeWidth="2" />}
        {h && <line x1={xs(hover!)} x2={xs(hover!)} y1={T} y2={H - B} stroke="#c3c9d4" />}
      </svg>
      {h && <div className="wk-tip">{fmtDay(h.day)} · {h.remaining == null ? 'still to come' : `${h.remaining} points left`} · ideal {h.ideal}</div>}
      <table className="crm-sr"><caption>Burndown</caption><tbody>{data.map((d) => <tr key={d.day}><th>{d.day}</th><td>{d.remaining ?? ''}</td><td>{d.ideal}</td></tr>)}</tbody></table>
    </div>
  );
}

function Velocity({ data }: { data: Report['velocity'] }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.committed, d.completed)));
  return (
    <div className="wk-chart">
      <div className="wk-legend"><span><i style={{ background: '#c3c9d4' }} /> Committed</span><span><i style={{ background: INK.accent }} /> Completed</span></div>
      <div className="wk-vel">
        {data.map((d) => (
          <div key={d.name} className="wk-vel-g" title={`${d.name}: ${d.committed} committed, ${d.completed} completed`}>
            <div className="wk-vel-bars">
              <span style={{ height: `${(d.committed / max) * 100}%`, background: '#c3c9d4' }}><em>{d.committed}</em></span>
              <span style={{ height: `${(d.completed / max) * 100}%`, background: INK.accent }}><em>{d.completed}</em></span>
            </div>
            <span className="crm-sub">{d.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
