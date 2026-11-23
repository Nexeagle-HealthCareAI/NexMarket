'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Archive, ArchiveRestore, CalendarDays, Check, CheckCircle2, ChevronRight, Clock, ExternalLink, Eye, EyeOff, FileText, Link2, Lock, Paperclip, Plus, Repeat as RepeatIcon,
  Send, Trash2, Unlink, X,
} from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { friendlyError, Skeleton } from '@/components/crm/ui';
import {
  avatarColor, canParent, DOC_KIND, duration, dueLabel, initials, ISSUE_TYPES, istToday, labelColors, parseQuick, PRIORITY, REPEAT_LABEL, RESOLUTION, SEVERITY, TYPE_META,
  type BoardRes, type Card, type CheckItem, type DocRow, type IssueType, type Person, type Priority, type Repeat, type Severity, type Status,
} from './shared';
import { IssuePicker, StatusPill, TypeIcon } from './Issues';

interface Note { id: string; kind: 'comment' | 'activity'; agentId: string; text: string; at: string }
interface LinkedDoc { id: string; title: string; kind: DocRow['kind']; updatedAt: string; updatedBy: string; access?: string; fileName?: string | null; planFor?: boolean }
interface IssueLink { id: string; kind: string; label: string; issue: { id: string; number: number; title: string; type: IssueType; status: Status; priority: Priority; assignees: string[]; archived: boolean } }
interface LogEntry { id: string; agentId: string; minutes: number; day: string; note?: string | null; at: string }
interface CardRes {
  card: Card; notes: Note[]; subtasks: Card[]; docs: LinkedDoc[];
  path?: { id: string; number: number; title: string; type: IssueType }[]; links?: IssueLink[]; worklog?: LogEntry[];
  sprint?: { id: string; name: string; status: string } | null;
}

const when = (iso: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
const rid = () => Math.random().toString(36).slice(2, 10);
const LINK_KINDS: [string, string][] = [['blocks', 'blocks'], ['blocked_by', 'is blocked by'], ['relates', 'relates to'], ['duplicates', 'duplicates'], ['duplicated_by', 'is duplicated by'], ['clones', 'clones']];

export function Avatar({ p, id, size = 26 }: { p?: Person; id: string; size?: number }) {
  return (
    <span className="wk-av" title={p?.name ?? id} style={{ width: size, height: size, fontSize: size * 0.42, background: avatarColor(id) }}>{initials(p?.name ?? id)}</span>
  );
}

/** A text box that saves when you leave it (if it changed). */
function Field({ value, onSave, rows = 3, placeholder, max = 8000, label }: { value?: string | null; onSave: (v: string) => void; rows?: number; placeholder?: string; max?: number; label: string }) {
  const [v, setV] = useState(value ?? '');
  const [last, setLast] = useState(value ?? '');
  if ((value ?? '') !== last) { setLast(value ?? ''); setV(value ?? ''); }
  return <textarea className="crm-input" rows={rows} value={v} maxLength={max} placeholder={placeholder} aria-label={label} onChange={(e) => setV(e.target.value)}
    onBlur={() => { if (v !== (value ?? '')) onSave(v); }} />;
}

/**
 * One issue in full, laid out like Jira: the work itself on the left (description, acceptance criteria or bug details,
 * child issues, linked issues, documents, checklist, work log, comments and history) and its details on the right.
 */
export function CardDrawer({ id, board, onClose, onSaved, toast, onOpen, onOpenDoc }: {
  id: string; board: BoardRes; onClose: () => void; onSaved: (c: Card, extra?: Card | null) => void; toast: (m: string) => void;
  onOpen: (id: string) => void; onOpenDoc: (id: string) => void;
}) {
  const [card, setCard] = useState<Card | null>(null);
  const [res, setRes] = useState<CardRes | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [subs, setSubs] = useState<Card[]>([]);
  const [docs, setDocs] = useState<LinkedDoc[]>([]);
  const [links, setLinks] = useState<IssueLink[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [newSub, setNewSub] = useState('');
  const [subType, setSubType] = useState<IssueType>('story');
  const [addingSub, setAddingSub] = useState(false);
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const [newCheck, setNewCheck] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [pickPeople, setPickPeople] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);   // the link kind being added
  const [docPick, setDocPick] = useState(false);
  const [parentPick, setParentPick] = useState(false);
  const [logForm, setLogForm] = useState<{ time: string; day: string; note: string } | null>(null);
  const [tab, setTab] = useState<'comments' | 'history' | 'work'>('comments');
  const [busy, setBusy] = useState(false);
  const people = board.people;
  const byId = (a: string) => people.find((p) => p.agentId === a);
  const panel = useRef<HTMLElement | null>(null);

  const apply = useCallback((r: CardRes) => {
    setRes(r); setCard(r.card); setNotes(r.notes); setTitle(r.card.title); setSubs(r.subtasks ?? []); setDocs(r.docs ?? []); setLinks(r.links ?? []); setLog(r.worklog ?? []);
  }, []);
  const load = useCallback(async () => {
    try { apply(await crm.get<CardRes>(`/api/v1/work/cards/${id}`)); }
    catch (e) { toast(friendlyError(e)); onClose(); }
  }, [id, onClose, toast, apply]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);

  const save = async (patch: Record<string, unknown>) => {
    if (!card) return;
    try {
      const c = await crm.put<Card>(`/api/v1/work/cards/${card.id}`, patch);
      setCard(c); onSaved(c);
      apply(await crm.get<CardRes>(`/api/v1/work/cards/${card.id}`));
    } catch (e) { toast(friendlyError(e)); }
  };
  const move = async (status: Status) => {
    if (!card) return;
    try {
      const r = await crm.post<{ card: Card; repeated?: Card | null }>(`/api/v1/work/cards/${card.id}/move`, { status });
      setCard(r.card); onSaved(r.card, r.repeated);
      if (r.repeated) toast(`Done. The next one is in To do, due ${dueLabel(r.repeated.dueDate!)}.`);
      void load();
    } catch (e) { toast(friendlyError(e)); }
  };
  const archive = async (undo: boolean) => {
    if (!card) return;
    try { const c = await crm.post<Card>(`/api/v1/work/cards/${card.id}/archive${undo ? '?undo=true' : ''}`); onSaved(c); toast(undo ? 'Back on the board.' : 'Archived (with everything under it). Find it under “Archive”.'); onClose(); }
    catch (e) { toast(friendlyError(e)); }
  };
  const send = async () => {
    if (!card || !comment.trim()) return;
    setBusy(true);
    try {
      const n = await crm.post<Note>(`/api/v1/work/cards/${card.id}/comments`, { text: comment });
      setNotes((x) => [...x, n]); setComment('');
      const c = { ...card, comments: card.comments + 1 }; setCard(c); onSaved(c);
    } catch (e) { toast(friendlyError(e)); } finally { setBusy(false); }
  };
  const setChecks = (list: CheckItem[]) => void save({ checklist: list });

  const childType = (): IssueType => (card?.type === 'epic' ? subType : card?.type === 'feature' ? (subType === 'feature' ? 'story' : subType) : 'subtask');
  /** A child issue in one line, like quick add: "Book the tent @imran fri". */
  const addSub = async () => {
    if (!card || !newSub.trim()) return;
    const p = parseQuick(newSub, people);
    if (!p.title.trim()) return;
    setAddingSub(true);
    try {
      const s = await crm.post<Card>('/api/v1/work/cards', {
        title: p.title, parentId: card.id, type: childType(), status: p.status ?? 'todo', assignees: p.assignees, dueDate: p.dueDate ?? '',
        priority: p.priority ?? 'normal', ...(p.labels.length ? { labels: p.labels } : {}),
      });
      setSubs((x) => [...x, s]); setNewSub('');
      onSaved(s);
      const c = { ...card, subTotal: card.subTotal + 1 }; setCard(c); onSaved(c);
    } catch (e) { toast(friendlyError(e)); } finally { setAddingSub(false); }
  };
  const toggleSub = async (s: Card) => {
    if (!card) return;
    const to: Status = s.status === 'done' ? 'todo' : 'done';
    try {
      const r = await crm.post<{ card: Card; repeated?: Card | null }>(`/api/v1/work/cards/${s.id}/move`, { status: to });
      setSubs((x) => x.map((y) => (y.id === s.id ? r.card : y)));
      onSaved(r.card);
      const c = { ...card, subDone: card.subDone + (to === 'done' ? 1 : -1) }; setCard(c); onSaved(c);
    } catch (e) { toast(friendlyError(e)); }
  };
  const newPlan = async () => {
    if (!card) return;
    try {
      const d = await crm.post<DocRow>('/api/v1/work/docs', { title: `Plan: ${card.title}`, kind: 'plan', cardId: card.id, project: card.project ?? undefined });
      onOpenDoc(d.id);
    } catch (e) { toast(friendlyError(e)); }
  };
  const linkDoc = async (docId: string) => {
    if (!card) return;
    try { setDocs(await crm.post<LinkedDoc[]>(`/api/v1/work/cards/${card.id}/docs`, { docId })); setDocPick(false); toast('Document linked.'); }
    catch (e) { toast(friendlyError(e)); }
  };
  const unlinkDoc = async (d: LinkedDoc) => {
    if (!card) return;
    try { setDocs(await crm.post<LinkedDoc[]>(`/api/v1/work/cards/${card.id}/docs/${d.id}/remove`)); toast('Document unlinked. It is still in Plans & docs.'); }
    catch (e) { toast(friendlyError(e)); }
  };
  const addLink = async (kind: string, toId: string) => {
    if (!card) return;
    try { setLinks(await crm.post<IssueLink[]>(`/api/v1/work/cards/${card.id}/links`, { kind, toId })); setLinking(null); }
    catch (e) { toast(friendlyError(e)); }
  };
  const removeLink = async (l: IssueLink) => {
    if (!card) return;
    try { setLinks(await crm.post<IssueLink[]>(`/api/v1/work/links/${l.id}/remove?from=${card.id}`)); }
    catch (e) { toast(friendlyError(e)); }
  };
  const logWork = async () => {
    if (!card || !logForm) return;
    try {
      const r = await crm.post<{ entry: LogEntry; spentMinutes: number }>(`/api/v1/work/cards/${card.id}/worklog`, logForm);
      setLog((x) => [r.entry, ...x]); const c = { ...card, spentMinutes: r.spentMinutes }; setCard(c); onSaved(c); setLogForm(null); toast(`Logged ${duration(r.entry.minutes)}.`);
    } catch (e) { toast(friendlyError(e)); }
  };
  const unlog = async (w: LogEntry) => {
    if (!card || !window.confirm(`Take back ${duration(w.minutes)} logged on ${w.day}?`)) return;
    try { const r = await crm.post<{ spentMinutes: number }>(`/api/v1/work/worklog/${w.id}/remove`); setLog((x) => x.filter((y) => y.id !== w.id)); const c = { ...card, spentMinutes: r.spentMinutes }; setCard(c); onSaved(c); }
    catch (e) { toast(friendlyError(e)); }
  };
  const watch = async () => {
    if (!card) return;
    const on = (card.watchers ?? []).includes(board.me);
    try { const r = await crm.post<{ watchers: string[] }>(`/api/v1/work/cards/${card.id}/watch${on ? '?undo=true' : ''}`); setCard({ ...card, watchers: r.watchers }); toast(on ? 'Stopped watching.' : 'Watching: you hear about every change.'); }
    catch (e) { toast(friendlyError(e)); }
  };

  if (!card || !res) return <><div className="wk-scrim" onClick={onClose} /><aside className="wk-drawer is-issue" ref={panel}><Skeleton h={400} /></aside></>;
  const type: IssueType = card.type ?? 'task';
  const isBig = type === 'epic' || type === 'feature';
  const watching = (card.watchers ?? []).includes(board.me);
  const est = card.estimateMinutes ?? 0, spent = card.spentMinutes ?? 0;
  const childLabel = type === 'epic' ? 'Issues in this epic' : type === 'feature' ? 'Issues in this feature' : 'Sub-tasks';
  const canHaveKids = type !== 'subtask';
  const linkGroups = links.reduce<Record<string, IssueLink[]>>((g, l) => { (g[l.label] ??= []).push(l); return g; }, {});
  const rollup = board.rollup?.[card.id];
  const comments = notes.filter((n) => n.kind === 'comment');
  const history = notes.filter((n) => n.kind === 'activity');

  return (
    <>
      <div className="wk-scrim" onClick={onClose} />
      <aside className="wk-drawer is-issue" ref={panel} role="dialog" aria-label={`${TYPE_META[type].label} #${card.number}`}>
        <header className="wk-dr-head">
          <nav className="wk-dr-path" aria-label="Where it sits">
            {(res.path ?? []).map((p) => (
              <span key={p.id}><button type="button" className="wk-dr-crumb" onClick={() => onOpen(p.id)} title={p.title}><TypeIcon type={p.type} size={14} /> #{p.number} {p.title}</button><ChevronRight size={12} aria-hidden /></span>
            ))}
            <span className="wk-dr-me"><TypeIcon type={type} size={16} /> <strong>#{card.number}</strong>{card.archived ? <span className="crm-sub"> · archived</span> : null}</span>
          </nav>
          <span className="sp-actions">
            <button type="button" className="crm-btn is-secondary is-sm" aria-pressed={watching} onClick={() => void watch()} title={watching ? 'Stop watching' : 'Hear about every change'}>
              {watching ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />} {watching ? 'Watching' : 'Watch'}{(card.watchers?.length ?? 0) > 0 ? ` · ${card.watchers!.length}` : ''}
            </button>
            {card.archived
              ? <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void archive(true)}><ArchiveRestore size={14} aria-hidden /> Bring back</button>
              : <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void archive(false)}><Archive size={14} aria-hidden /> Archive</button>}
            <button type="button" className="wk-x" aria-label="Close" onClick={onClose}><X size={18} aria-hidden /></button>
          </span>
        </header>

        <div className="wk-dr-body wk-issue">
          <div className="wk-issue-main">
            <textarea className="wk-title-in" rows={2} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)}
              onBlur={() => { if (title.trim() && title.trim() !== card.title) void save({ title }); }} aria-label="Summary" />

            <div className="wk-status-row" role="group" aria-label="Column">
              {board.columns.map((c) => (
                <button key={c.key} type="button" className={`wk-st wk-st-${c.key}`} aria-pressed={card.status === c.key} onClick={() => card.status !== c.key && void move(c.key)}>
                  {c.key === 'done' && <Check size={13} aria-hidden />}{c.label}
                </button>
              ))}
            </div>

            {isBig && rollup && rollup.total > 0 && (
              <div className="wk-roll">
                <div className="wk-bar"><span style={{ width: `${(rollup.done / rollup.total) * 100}%` }} /></div>
                <span className="crm-sub">{rollup.done} of {rollup.total} issues done{rollup.points ? ` · ${rollup.pointsDone} of ${rollup.points} points` : ''}</span>
              </div>
            )}

            <section className="wk-sec">
              <h3>Description</h3>
              <Field label="Description" rows={5} value={card.description} onSave={(v) => void save({ description: v })} placeholder="What exactly needs doing and why, who to talk to, where, links…" />
            </section>

            {(type === 'story' || isBig) && (
              <section className="wk-sec">
                <h3>Acceptance criteria</h3>
                <Field label="Acceptance criteria" rows={3} value={card.acceptance} onSave={(v) => void save({ acceptance: v })} placeholder={'What “done” means, one per line:\nPatient gets a WhatsApp confirmation'} />
              </section>
            )}

            {type === 'bug' && (
              <section className="wk-sec wk-bugbox">
                <h3>Bug details</h3>
                <label className="crm-field"><span>Steps to make it happen</span><Field label="Steps" rows={3} value={card.steps} onSave={(v) => void save({ steps: v })} placeholder={'1. Open…\n2. Press…'} /></label>
                <div className="wk-create-grid">
                  <label className="crm-field"><span>What should happen</span><Field label="Expected" rows={2} max={4000} value={card.expected} onSave={(v) => void save({ expected: v })} /></label>
                  <label className="crm-field"><span>What happens instead</span><Field label="Actual" rows={2} max={4000} value={card.actual} onSave={(v) => void save({ actual: v })} /></label>
                </div>
                <label className="crm-field"><span>Where it happens</span><Field label="Environment" rows={1} max={1000} value={card.environment} onSave={(v) => void save({ environment: v })} placeholder="Agent app on Android, CRM in Chrome…" /></label>
              </section>
            )}

            {canHaveKids && (
              <section className="wk-sec">
                <h3>{childLabel} {subs.length > 0 && <span className="crm-sub">{subs.filter((s) => s.status === 'done').length}/{subs.length}</span>}</h3>
                {subs.length > 0 && <div className="wk-bar"><span style={{ width: `${(subs.filter((s) => s.status === 'done').length / subs.length) * 100}%` }} /></div>}
                <ul className="wk-subs">
                  {subs.map((s) => (
                    <li key={s.id} className={s.status === 'done' ? 'is-done' : undefined}>
                      <button type="button" className={`wk-tick${s.status === 'done' ? ' is-on' : ''}`} aria-label={s.status === 'done' ? 'Mark not done' : 'Mark done'} onClick={() => void toggleSub(s)}><CheckCircle2 size={18} aria-hidden /></button>
                      <TypeIcon type={s.type} size={15} />
                      <button type="button" className="wk-sub-title" onClick={() => onOpen(s.id)}><span className="crm-sub">#{s.number}</span> {s.title}</button>
                      {s.status !== 'done' && s.status !== 'todo' && <StatusPill status={s.status} />}
                      {s.storyPoints != null && <span className="wk-pts">{s.storyPoints}</span>}
                      {s.dueDate && <span className={`wk-due${s.overdue ? ' is-late' : s.dueDate === istToday() ? ' is-today' : ''}`}><CalendarDays size={12} aria-hidden />{dueLabel(s.dueDate)}</span>}
                      <span className="wk-avs">{s.assignees.slice(0, 3).map((a) => <Avatar key={a} id={a} p={byId(a)} size={20} />)}</span>
                    </li>
                  ))}
                </ul>
                <form className="wk-sub-add" onSubmit={(e) => { e.preventDefault(); void addSub(); }}>
                  {isBig && (
                    <select className="crm-input wk-small-in" value={childType()} onChange={(e) => setSubType(e.target.value as IssueType)} aria-label="Type">
                      {ISSUE_TYPES.filter((t) => canParent(t, type)).map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
                    </select>
                  )}
                  <input className="crm-input" value={newSub} placeholder={isBig ? 'Add an issue: Print banners @name fri' : 'Add a sub-task: Book the tent @name fri'} maxLength={200} onChange={(e) => setNewSub(e.target.value)} aria-label="New child issue" />
                  <button type="submit" className="crm-btn is-sm" disabled={addingSub || !newSub.trim()}><Plus size={14} aria-hidden /> Add</button>
                </form>
              </section>
            )}

            <section className="wk-sec">
              <h3>Linked issues</h3>
              {Object.entries(linkGroups).map(([label, list]) => (
                <div key={label} className="wk-links">
                  <span className="wk-links-label">{label}</span>
                  <ul>
                    {list.map((l) => (
                      <li key={l.id} className={l.issue.status === 'done' ? 'is-done' : undefined}>
                        <TypeIcon type={l.issue.type} size={15} />
                        <button type="button" className="wk-sub-title" onClick={() => onOpen(l.issue.id)}><span className="crm-sub">#{l.issue.number}</span> {l.issue.title}</button>
                        <StatusPill status={l.issue.status} />
                        <button type="button" className="wk-icon-btn" aria-label={`Remove the link with #${l.issue.number}`} title="Remove the link" onClick={() => void removeLink(l)}><Unlink size={14} aria-hidden /></button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {linking ? (
                <div className="wk-link-add">
                  <select className="crm-input wk-small-in" value={linking} onChange={(e) => setLinking(e.target.value)} aria-label="How they are linked">
                    {LINK_KINDS.map(([k, l]) => <option key={k} value={k}>This issue {l}</option>)}
                  </select>
                  <IssuePicker autoFocus exclude={[card.id, ...links.map((l) => l.issue.id)]} onPick={(h) => void addLink(linking, h.id)} />
                  <button type="button" className="wa-link" onClick={() => setLinking(null)}>Cancel</button>
                </div>
              ) : <button type="button" className="wk-add-mini" onClick={() => setLinking('relates')}><Link2 size={13} aria-hidden /> Link an issue</button>}
            </section>

            <section className="wk-sec">
              <h3>Documents</h3>
              {docs.length > 0 && (
                <ul className="wk-docs-mini">
                  {docs.map((d) => (
                    <li key={d.id} className="wk-docs-mini-row">
                      <button type="button" onClick={() => onOpenDoc(d.id)}>{d.kind === 'file' ? <Paperclip size={15} aria-hidden /> : <FileText size={15} aria-hidden />} <strong>{d.title}</strong>
                        {d.access === 'restricted' && <Lock size={12} aria-label="Private" />}
                        <span className="crm-sub">{DOC_KIND[d.kind]} · {byId(d.updatedBy)?.name ?? d.updatedBy} · {when(d.updatedAt)}</span></button>
                      <button type="button" className="wk-icon-btn" aria-label={`Unlink ${d.title}`} title="Unlink (the document stays in Plans & docs)" onClick={() => void unlinkDoc(d)}><Unlink size={14} aria-hidden /></button>
                    </li>
                  ))}
                </ul>
              )}
              {docPick ? <DocPicker exclude={docs.map((d) => d.id)} onPick={(id2) => void linkDoc(id2)} onCancel={() => setDocPick(false)} />
                : (
                  <div className="wk-inline">
                    <button type="button" className="wk-add-mini" onClick={() => setDocPick(true)}><Link2 size={13} aria-hidden /> Link a document</button>
                    <button type="button" className="wk-add-mini" onClick={() => void newPlan()}><Plus size={13} aria-hidden /> Write a plan for it</button>
                  </div>
                )}
            </section>

            <section className="wk-sec">
              <h3>Checklist {card.checkTotal > 0 && <span className="crm-sub">{card.checkDone}/{card.checkTotal}</span>}</h3>
              {card.checkTotal > 0 && <div className="wk-bar"><span style={{ width: `${(card.checkDone / card.checkTotal) * 100}%` }} /></div>}
              <ul className="wk-checks">
                {card.checklist.map((c) => (
                  <li key={c.id}>
                    <label><input type="checkbox" checked={c.done} onChange={() => setChecks(card.checklist.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)))} /> <span className={c.done ? 'is-done' : undefined}>{c.text}</span></label>
                    <button type="button" aria-label="Remove step" onClick={() => setChecks(card.checklist.filter((x) => x.id !== c.id))}><Trash2 size={13} aria-hidden /></button>
                  </li>
                ))}
              </ul>
              <input className="crm-input" value={newCheck} placeholder="Add a step and press Enter" maxLength={300} onChange={(e) => setNewCheck(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && newCheck.trim()) { setChecks([...card.checklist, { id: rid(), text: newCheck.trim(), done: false }]); setNewCheck(''); } }} />
            </section>

            <section className="wk-sec">
              <div className="crm-chips" role="group" aria-label="Activity">
                <button type="button" className="crm-chip" aria-pressed={tab === 'comments'} onClick={() => setTab('comments')}>Comments{comments.length ? ` (${comments.length})` : ''}</button>
                <button type="button" className="crm-chip" aria-pressed={tab === 'history'} onClick={() => setTab('history')}>History</button>
                <button type="button" className="crm-chip" aria-pressed={tab === 'work'} onClick={() => setTab('work')}>Work log{log.length ? ` (${log.length})` : ''}</button>
              </div>
              {tab === 'comments' && (
                <>
                  <ul className="wk-notes">
                    {comments.length === 0 && <li className="crm-sub">No comments yet.</li>}
                    {comments.map((n) => (
                      <li key={n.id} className="wk-comment"><Avatar id={n.agentId} p={byId(n.agentId)} size={26} />
                        <div><strong>{byId(n.agentId)?.name ?? n.agentId}</strong> <span className="crm-sub">{when(n.at)}</span><p>{n.text}</p></div></li>
                    ))}
                  </ul>
                  <div className="wk-comment-box">
                    <textarea className="crm-input" rows={2} value={comment} maxLength={4000} placeholder="Write a comment. The people on it, the reporter and watchers are told." onChange={(e) => setComment(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send(); }} />
                    <button type="button" className="crm-btn is-sm" disabled={busy || !comment.trim()} onClick={() => void send()}><Send size={14} aria-hidden /> Send</button>
                  </div>
                </>
              )}
              {tab === 'history' && (
                <ul className="wk-notes">
                  {history.map((n) => <li key={n.id} className="wk-activity"><span>{n.agentId === 'system' ? 'NexMarket' : byId(n.agentId)?.name ?? n.agentId} {n.text}</span> <span className="crm-sub">· {when(n.at)}</span></li>)}
                </ul>
              )}
              {tab === 'work' && (
                <>
                  {logForm ? (
                    <form className="wk-log-form" onSubmit={(e) => { e.preventDefault(); void logWork(); }}>
                      <label className="crm-field"><span>Time spent</span><input className="crm-input" autoFocus value={logForm.time} onChange={(e) => setLogForm({ ...logForm, time: e.target.value })} placeholder="2h 30m" /></label>
                      <label className="crm-field"><span>Day</span><input type="date" className="crm-input" max={istToday()} value={logForm.day} onChange={(e) => setLogForm({ ...logForm, day: e.target.value })} /></label>
                      <label className="crm-field wk-span2"><span>What was done (optional)</span><input className="crm-input" maxLength={500} value={logForm.note} onChange={(e) => setLogForm({ ...logForm, note: e.target.value })} /></label>
                      <span className="sp-actions"><button type="button" className="crm-btn is-secondary is-sm" onClick={() => setLogForm(null)}>Cancel</button><button type="submit" className="crm-btn is-sm" disabled={!logForm.time.trim()}>Log time</button></span>
                    </form>
                  ) : <button type="button" className="wk-add-mini" onClick={() => setLogForm({ time: '', day: istToday(), note: '' })}><Clock size={13} aria-hidden /> Log time</button>}
                  <ul className="wk-notes">
                    {log.map((w) => (
                      <li key={w.id} className="wk-activity"><span><strong>{duration(w.minutes)}</strong> · {byId(w.agentId)?.name ?? w.agentId} · {new Date(`${w.day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}{w.note ? ` · ${w.note}` : ''}</span>
                        {(w.agentId === board.me || board.isAdmin) && <button type="button" className="wa-link" onClick={() => void unlog(w)}>Take back</button>}</li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>

          <aside className="wk-issue-side" aria-label="Details">
            <dl className="wk-props">
              <dt>Type</dt>
              <dd>
                <select className="crm-input wk-small-in" value={type} onChange={(e) => void save({ type: e.target.value })} aria-label="Type">
                  {ISSUE_TYPES.map((t) => <option key={t} value={t} disabled={!canParent(t, res.path?.length ? res.path[res.path.length - 1].type : null)}>{TYPE_META[t].label}</option>)}
                </select>
              </dd>
              <dt>Assignee</dt>
              <dd>
                <div className="wk-people">
                  {card.assignees.map((a) => (
                    <span key={a} className="wk-person-chip"><Avatar id={a} p={byId(a)} size={22} />{byId(a)?.name ?? a}
                      <button type="button" aria-label={`Remove ${byId(a)?.name ?? a}`} onClick={() => void save({ assignees: card.assignees.filter((x) => x !== a) })}><X size={12} aria-hidden /></button></span>
                  ))}
                  <button type="button" className="wk-add-mini" onClick={() => setPickPeople((v) => !v)}><Plus size={13} aria-hidden /> {card.assignees.length ? 'Add' : 'Assign'}</button>
                  {!card.assignees.includes(board.me) && <button type="button" className="wa-link" onClick={() => void save({ assignees: [...card.assignees, board.me] })}>Assign to me</button>}
                </div>
                {pickPeople && (
                  <ul className="wk-pick">
                    {people.filter((p) => !card.assignees.includes(p.agentId)).map((p) => (
                      <li key={p.agentId}><button type="button" onClick={() => { void save({ assignees: [...card.assignees, p.agentId] }); setPickPeople(false); }}>
                        <Avatar id={p.agentId} p={p} size={22} /> {p.name} <span className="crm-sub">{p.role === 'field_rep' ? 'Field agent' : p.role}</span></button></li>
                    ))}
                  </ul>
                )}
              </dd>
              <dt>Reporter</dt>
              <dd>
                <select className="crm-input wk-small-in" value={card.reporter ?? card.createdBy} onChange={(e) => void save({ reporter: e.target.value })} aria-label="Reporter">
                  {people.map((p) => <option key={p.agentId} value={p.agentId}>{p.name}</option>)}
                </select>
              </dd>
              <dt>Priority</dt>
              <dd>
                <select className="crm-input wk-small-in" value={card.priority} onChange={(e) => void save({ priority: e.target.value })} aria-label="Priority" style={card.priority === 'urgent' || card.priority === 'high' ? { color: PRIORITY[card.priority].color } : undefined}>
                  {(Object.keys(PRIORITY) as Priority[]).map((k) => <option key={k} value={k}>{PRIORITY[k].label}</option>)}
                </select>
              </dd>
              {type === 'bug' && (<>
                <dt>Severity</dt>
                <dd>
                  <select className="crm-input wk-small-in" value={card.severity ?? ''} onChange={(e) => void save({ severity: e.target.value })} aria-label="Severity" style={card.severity ? { color: SEVERITY[card.severity].color } : undefined}>
                    <option value="">Not set</option>{(Object.keys(SEVERITY) as Severity[]).map((s) => <option key={s} value={s}>{SEVERITY[s].label}</option>)}
                  </select>
                </dd>
              </>)}
              {card.status === 'done' && (<>
                <dt>Resolution</dt>
                <dd>
                  <select className="crm-input wk-small-in" value={card.resolution ?? 'done'} onChange={(e) => void save({ resolution: e.target.value })} aria-label="Resolution">
                    {Object.entries(RESOLUTION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </dd>
              </>)}
              {type !== 'epic' && (<>
                <dt>Parent</dt>
                <dd>
                  {parentPick ? (
                    <div className="wk-link-add">
                      <IssuePicker autoFocus types={ISSUE_TYPES.filter((t) => canParent(type, t))} exclude={[card.id]} onPick={(h) => { setParentPick(false); void save({ parentId: h.id }); }} />
                      <button type="button" className="wa-link" onClick={() => setParentPick(false)}>Cancel</button>
                    </div>
                  ) : (
                    <div className="wk-inline">
                      {card.parent ? <button type="button" className="wk-dr-crumb" onClick={() => onOpen(card.parent!.id)}><TypeIcon type={card.parent.type ?? 'task'} size={14} /> #{card.parent.number} {card.parent.title}</button> : <span className="crm-sub">None</span>}
                      <button type="button" className="wa-link" onClick={() => setParentPick(true)}>{card.parent ? 'Change' : 'Choose'}</button>
                      {card.parent && type !== 'subtask' && <button type="button" className="wa-link" onClick={() => void save({ parentId: '00000000-0000-0000-0000-000000000000' })}>Remove</button>}
                    </div>
                  )}
                </dd>
              </>)}
              {type !== 'epic' && (board.sprints?.length ?? 0) + (res.sprint ? 1 : 0) > 0 && (<>
                <dt>Sprint</dt>
                <dd>
                  <select className="crm-input wk-small-in" value={card.sprintId ?? ''} onChange={(e) => void save({ sprintId: e.target.value || '00000000-0000-0000-0000-000000000000' })} aria-label="Sprint">
                    <option value="">Backlog</option>
                    {res.sprint && !board.sprints?.some((s) => s.id === res.sprint!.id) && <option value={res.sprint.id}>{res.sprint.name} (finished)</option>}
                    {board.sprints?.map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === 'active' ? ' (running)' : ''}</option>)}
                  </select>
                </dd>
              </>)}
              {type !== 'epic' && type !== 'subtask' && (<>
                <dt>Story points</dt>
                <dd>
                  <select className="crm-input wk-small-in" value={card.storyPoints ?? ''} onChange={(e) => void save({ storyPoints: e.target.value === '' ? -1 : Number(e.target.value) })} aria-label="Story points">
                    <option value="">Not estimated</option>
                    {[...new Set([0, 1, 2, 3, 5, 8, 13, 21, ...(card.storyPoints != null ? [card.storyPoints] : [])])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </dd>
              </>)}
              <dt>Start date</dt>
              <dd><input type="date" className="crm-input wk-date" value={card.startDate ?? ''} max={card.dueDate ?? undefined} onChange={(e) => void save({ startDate: e.target.value })} aria-label="Start date" /></dd>
              <dt>Due date</dt>
              <dd className="wk-inline">
                <input type="date" className="crm-input wk-date" value={card.dueDate ?? ''} min={card.startDate ?? undefined} onChange={(e) => void save({ dueDate: e.target.value })} aria-label="Due date" />
                {card.overdue && <span className="wk-late">Late</span>}
              </dd>
              <dt>Time</dt>
              <dd>
                <div className="wk-time">
                  <div className="wk-bar"><span style={{ width: `${est ? Math.min(100, (spent / est) * 100) : spent ? 100 : 0}%`, background: est && spent > est ? '#d9822b' : undefined }} /></div>
                  <span className="crm-sub">{duration(spent)} logged{est ? ` of ${duration(est)} estimated${spent > est ? ' (over)' : ` · ${duration(est - spent)} left`}` : ''}</span>
                </div>
                <input className="crm-input wk-small-in" defaultValue={est ? duration(est) : ''} key={est} placeholder="Estimate, e.g. 2h" aria-label="Original estimate"
                  onBlur={(e) => { if (e.target.value.trim() !== (est ? duration(est) : '')) void save({ estimate: e.target.value }); }} />
                <button type="button" className="wa-link" onClick={() => { setTab('work'); setLogForm({ time: '', day: istToday(), note: '' }); }}>Log time</button>
              </dd>
              <dt>Labels</dt>
              <dd className="wk-inline">
                {card.labels.map((l) => { const c = labelColors(l); return (
                  <span key={l} className="wk-label" style={{ background: c.bg, color: c.fg }}>#{l}<button type="button" aria-label={`Remove ${l}`} onClick={() => void save({ labels: card.labels.filter((x) => x !== l) })}><X size={11} aria-hidden /></button></span>
                ); })}
                <input className="crm-input wk-small-in" list="wk-labels" value={newLabel} placeholder="Add label" onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && newLabel.trim()) { void save({ labels: [...card.labels, newLabel.trim()] }); setNewLabel(''); } }} />
                <datalist id="wk-labels">{board.labels.filter((l) => !card.labels.includes(l)).map((l) => <option key={l} value={l} />)}</datalist>
              </dd>
              <dt>Project</dt>
              <dd>
                <input className="crm-input wk-small-in" style={{ width: '100%' }} list="wk-projects" defaultValue={card.project ?? ''} placeholder="e.g. December camps"
                  onBlur={(e) => { if ((e.target.value.trim() || null) !== (card.project ?? null)) void save({ project: e.target.value }); }} />
                <datalist id="wk-projects">{board.projects.map((p) => <option key={p.name} value={p.name} />)}</datalist>
              </dd>
              <dt>Repeats</dt>
              <dd className="wk-inline">
                <RepeatIcon size={15} aria-hidden />
                <select className="crm-input wk-small-in" value={card.repeat} onChange={(e) => void save({ repeat: e.target.value as Repeat })}>
                  {(Object.keys(REPEAT_LABEL) as Repeat[]).map((r) => <option key={r} value={r}>{REPEAT_LABEL[r]}</option>)}
                </select>
              </dd>
              <dt>Link</dt>
              <dd className="wk-inline">
                <input className="crm-input wk-small-in" style={{ flex: 1 }} defaultValue={card.link ?? ''} placeholder="A page, a Google Doc, a design…"
                  onBlur={(e) => { if ((e.target.value.trim() || null) !== (card.link ?? null)) void save({ link: e.target.value }); }} />
                {card.link && <a className="wa-link" href={card.link} target={card.link.startsWith('/admin/') ? undefined : '_blank'} rel="noreferrer"><ExternalLink size={14} aria-hidden /> Open</a>}
              </dd>
            </dl>
            <p className="crm-sub wk-issue-dates">Created {when(card.createdAt)} by {byId(card.createdBy)?.name ?? card.createdBy}<br />Updated {when(card.updatedAt)}{card.doneAt ? <><br />Done {when(card.doneAt)}{card.doneBy ? ` by ${byId(card.doneBy)?.name ?? card.doneBy}` : ''}</> : null}</p>
          </aside>
        </div>
      </aside>
    </>
  );
}

/** Finds a document in Plans & docs (only ones this person can open) to link to the issue. */
function DocPicker({ exclude, onPick, onCancel }: { exclude: string[]; onPick: (id: string) => void; onCancel: () => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<DocRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      const sp = new URLSearchParams(q.trim() ? { q: q.trim() } : { view: 'recent' });
      crm.get<DocRow[]>(`/api/v1/work/docs?${sp}`).then((r) => { if (alive) setRows(r); }).catch(() => { if (alive) setRows([]); });
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);
  const list = (rows ?? []).filter((d) => !exclude.includes(d.id)).slice(0, 12);
  return (
    <div className="wk-ipick">
      <div className="wk-inline">
        <input className="crm-input" style={{ flex: 1 }} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents and files" aria-label="Search documents" />
        <button type="button" className="wa-link" onClick={onCancel}>Cancel</button>
      </div>
      {rows && (
        <ul className="wk-ipick-list">
          {list.length === 0 ? <li className="crm-sub" style={{ padding: 8 }}>{q ? 'No matching documents.' : 'No documents yet.'}</li> : list.map((d) => (
            <li key={d.id}><button type="button" onClick={() => onPick(d.id)}>{d.kind === 'file' ? <Paperclip size={14} aria-hidden /> : <FileText size={14} aria-hidden />} <span className="wk-ipick-t">{d.title}</span>
              {d.access === 'restricted' && <Lock size={12} aria-label="Private" />}<span className="crm-sub">{DOC_KIND[d.kind]}</span></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
