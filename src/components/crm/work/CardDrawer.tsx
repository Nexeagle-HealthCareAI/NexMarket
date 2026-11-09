'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore, CalendarDays, Check, CheckCircle2, CornerDownRight, ExternalLink, FileText, Link2, Plus, Repeat as RepeatIcon, Send, Trash2, X } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { friendlyError, Skeleton } from '@/components/crm/ui';
import { avatarColor, DOC_KIND, dueLabel, initials, istToday, labelColors, parseQuick, PRIORITY, REPEAT_LABEL, type BoardRes, type Card, type CheckItem, type DocRow, type Person, type Priority, type Repeat, type Status } from './shared';

interface Note { id: string; kind: 'comment' | 'activity'; agentId: string; text: string; at: string }
type LinkedDoc = Pick<DocRow, 'id' | 'title' | 'kind' | 'updatedAt' | 'updatedBy'>;
interface CardRes { card: Card; notes: Note[]; subtasks: Card[]; docs: LinkedDoc[] }

const when = (iso: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
const rid = () => Math.random().toString(36).slice(2, 10);

export function Avatar({ p, id, size = 26 }: { p?: Person; id: string; size?: number }) {
  return (
    <span className="wk-av" title={p?.name ?? id} style={{ width: size, height: size, fontSize: size * 0.42, background: avatarColor(id) }}>{initials(p?.name ?? id)}</span>
  );
}

/** One card in full: everything about it can be changed here, and the team talks about it in the comments. */
export function CardDrawer({ id, board, onClose, onSaved, toast, onOpen, onOpenDoc }: {
  id: string; board: BoardRes; onClose: () => void; onSaved: (c: Card, extra?: Card | null) => void; toast: (m: string) => void;
  onOpen: (id: string) => void; onOpenDoc: (id: string) => void;
}) {
  const [card, setCard] = useState<Card | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [subs, setSubs] = useState<Card[]>([]);
  const [docs, setDocs] = useState<LinkedDoc[]>([]);
  const [newSub, setNewSub] = useState('');
  const [addingSub, setAddingSub] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [comment, setComment] = useState('');
  const [newCheck, setNewCheck] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [pickPeople, setPickPeople] = useState(false);
  const [busy, setBusy] = useState(false);
  const people = board.people;
  const byId = (a: string) => people.find((p) => p.agentId === a);
  const panel = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await crm.get<CardRes>(`/api/v1/work/cards/${id}`);
      setCard(r.card); setNotes(r.notes); setTitle(r.card.title); setDesc(r.card.description ?? ''); setSubs(r.subtasks ?? []); setDocs(r.docs ?? []);
    } catch (e) { toast(friendlyError(e)); onClose(); }
  }, [id, onClose, toast]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);

  const save = async (patch: Record<string, unknown>) => {
    if (!card) return;
    try {
      const c = await crm.put<Card>(`/api/v1/work/cards/${card.id}`, patch);
      setCard(c); onSaved(c);
      const r = await crm.get<CardRes>(`/api/v1/work/cards/${card.id}`);
      setNotes(r.notes); setSubs(r.subtasks ?? []);
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
    try { const c = await crm.post<Card>(`/api/v1/work/cards/${card.id}/archive${undo ? '?undo=true' : ''}`); onSaved(c); toast(undo ? 'Back on the board.' : 'Archived. Find it under “Archive”.'); onClose(); }
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

  /** A sub-task in one line, like quick add: "Book the tent @imran fri". */
  const addSub = async () => {
    if (!card || !newSub.trim()) return;
    const p = parseQuick(newSub, people);
    if (!p.title.trim()) return;
    setAddingSub(true);
    try {
      const s = await crm.post<Card>('/api/v1/work/cards', {
        title: p.title, parentId: card.id, status: p.status ?? 'todo', assignees: p.assignees, dueDate: p.dueDate ?? '',
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

  if (!card) return <><div className="wk-scrim" onClick={onClose} /><aside className="wk-drawer" ref={panel}><Skeleton h={400} /></aside></>;
  const pr = PRIORITY[card.priority];

  return (
    <>
      <div className="wk-scrim" onClick={onClose} />
      <aside className="wk-drawer" ref={panel} role="dialog" aria-label={`Card #${card.number}`}>
        <header className="wk-dr-head">
          <span className="crm-sub">#{card.number}{card.archived ? ' · archived' : ''}</span>
          <span className="sp-actions">
            {card.archived
              ? <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void archive(true)}><ArchiveRestore size={14} aria-hidden /> Bring back</button>
              : <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void archive(false)}><Archive size={14} aria-hidden /> Archive</button>}
            <button type="button" className="wk-x" aria-label="Close" onClick={onClose}><X size={18} aria-hidden /></button>
          </span>
        </header>

        <div className="wk-dr-body">
          {card.parent && (
            <button type="button" className="wk-parent-link" onClick={() => onOpen(card.parent!.id)}>
              <CornerDownRight size={14} aria-hidden /> Sub-task of <strong>#{card.parent.number} {card.parent.title}</strong>
            </button>
          )}
          <textarea className="wk-title-in" rows={2} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)}
            onBlur={() => { if (title.trim() && title.trim() !== card.title) void save({ title }); }} aria-label="Title" />

          <div className="wk-status-row" role="group" aria-label="Column">
            {board.columns.map((c) => (
              <button key={c.key} type="button" className={`wk-st wk-st-${c.key}`} aria-pressed={card.status === c.key} onClick={() => card.status !== c.key && void move(c.key)}>
                {c.key === 'done' && <Check size={13} aria-hidden />}{c.label}
              </button>
            ))}
          </div>

          <dl className="wk-props">
            <dt>People</dt>
            <dd>
              <div className="wk-people">
                {card.assignees.map((a) => (
                  <span key={a} className="wk-person-chip"><Avatar id={a} p={byId(a)} size={22} />{byId(a)?.name ?? a}
                    <button type="button" aria-label={`Remove ${byId(a)?.name ?? a}`} onClick={() => void save({ assignees: card.assignees.filter((x) => x !== a) })}><X size={12} aria-hidden /></button></span>
                ))}
                <button type="button" className="wk-add-mini" onClick={() => setPickPeople((v) => !v)}><Plus size={13} aria-hidden /> {card.assignees.length ? 'Add' : 'Give to someone'}</button>
                {!card.assignees.includes(board.me) && <button type="button" className="wa-link" onClick={() => void save({ assignees: [...card.assignees, board.me] })}>I&apos;ll do it</button>}
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
            <dt>Due</dt>
            <dd className="wk-inline">
              <CalendarDays size={15} aria-hidden />
              <input type="date" className="crm-input wk-date" value={card.dueDate ?? ''} onChange={(e) => void save({ dueDate: e.target.value })} aria-label="Due date" />
              {[['Today', istToday()], ['Tomorrow', istToday(1)]].map(([l, d]) => <button key={l} type="button" className="crm-chip" aria-pressed={card.dueDate === d} onClick={() => void save({ dueDate: d })}>{l}</button>)}
              {card.dueDate && <button type="button" className="wa-link" onClick={() => void save({ dueDate: '' })}>Clear</button>}
              {card.overdue && <span className="wk-late">Late</span>}
            </dd>
            <dt>Priority</dt>
            <dd className="wk-inline">
              {(Object.keys(PRIORITY) as Priority[]).map((k) => (
                <button key={k} type="button" className="crm-chip" aria-pressed={card.priority === k} onClick={() => void save({ priority: k })}>
                  <span className="wk-pdot" style={{ background: PRIORITY[k].color }} aria-hidden />{PRIORITY[k].label}
                </button>
              ))}
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
              {card.repeat !== 'none' && <span className="crm-sub">When it&apos;s done, the next one appears in To do.</span>}
            </dd>
            <dt>Link</dt>
            <dd className="wk-inline">
              <Link2 size={15} aria-hidden />
              <input className="crm-input wk-small-in" style={{ flex: 1 }} defaultValue={card.link ?? ''} placeholder="A page in NexMarket, a Google Doc, a design…"
                onBlur={(e) => { if ((e.target.value.trim() || null) !== (card.link ?? null)) void save({ link: e.target.value }); }} />
              {card.link && <a className="wa-link" href={card.link} target={card.link.startsWith('/admin/') ? undefined : '_blank'} rel="noreferrer"><ExternalLink size={14} aria-hidden /> Open</a>}
            </dd>
          </dl>

          <section className="wk-sec">
            <h3>Notes</h3>
            <textarea className="crm-input" rows={4} value={desc} maxLength={8000} placeholder="What exactly needs doing, who to talk to, where…" onChange={(e) => setDesc(e.target.value)}
              onBlur={() => { if (desc !== (card.description ?? '')) void save({ description: desc }); }} />
          </section>

          {!card.parentId && (
            <section className="wk-sec">
              <h3>Sub-tasks {subs.length > 0 && <span className="crm-sub">{subs.filter((s) => s.status === 'done').length}/{subs.length}</span>}</h3>
              <p className="crm-sub wk-sec-hint">Each sub-task is its own card: give it to someone, set a date, move it on the board.</p>
              {subs.length > 0 && <div className="wk-bar"><span style={{ width: `${(subs.filter((s) => s.status === 'done').length / subs.length) * 100}%` }} /></div>}
              <ul className="wk-subs">
                {subs.map((s) => (
                  <li key={s.id} className={s.status === 'done' ? 'is-done' : undefined}>
                    <button type="button" className={`wk-tick${s.status === 'done' ? ' is-on' : ''}`} aria-label={s.status === 'done' ? 'Mark not done' : 'Mark done'} onClick={() => void toggleSub(s)}><CheckCircle2 size={18} aria-hidden /></button>
                    <button type="button" className="wk-sub-title" onClick={() => onOpen(s.id)}><span className="crm-sub">#{s.number}</span> {s.title}</button>
                    {s.status !== 'done' && s.status !== 'todo' && <span className="wk-sub-st">{board.columns.find((c) => c.key === s.status)?.label}</span>}
                    {s.dueDate && <span className={`wk-due${s.overdue ? ' is-late' : s.dueDate === istToday() ? ' is-today' : ''}`}><CalendarDays size={12} aria-hidden />{dueLabel(s.dueDate)}</span>}
                    <span className="wk-avs">{s.assignees.slice(0, 3).map((a) => <Avatar key={a} id={a} p={byId(a)} size={20} />)}</span>
                  </li>
                ))}
              </ul>
              <form className="wk-sub-add" onSubmit={(e) => { e.preventDefault(); void addSub(); }}>
                <input className="crm-input" value={newSub} placeholder="Add a sub-task: Book the tent @name fri" maxLength={200} onChange={(e) => setNewSub(e.target.value)} aria-label="New sub-task" />
                <button type="submit" className="crm-btn is-sm" disabled={addingSub || !newSub.trim()}><Plus size={14} aria-hidden /> Add</button>
              </form>
            </section>
          )}

          <section className="wk-sec">
            <h3>Plans</h3>
            {docs.length > 0 && (
              <ul className="wk-docs-mini">
                {docs.map((d) => (
                  <li key={d.id}><button type="button" onClick={() => onOpenDoc(d.id)}><FileText size={15} aria-hidden /> <strong>{d.title}</strong> <span className="crm-sub">{DOC_KIND[d.kind]} · {byId(d.updatedBy)?.name ?? d.updatedBy} · {when(d.updatedAt)}</span></button></li>
                ))}
              </ul>
            )}
            <button type="button" className="wk-add-mini" onClick={() => void newPlan()}><Plus size={13} aria-hidden /> Write a plan for this card</button>
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
            <h3>Comments and history</h3>
            <ul className="wk-notes">
              {notes.map((n) => n.kind === 'comment' ? (
                <li key={n.id} className="wk-comment"><Avatar id={n.agentId} p={byId(n.agentId)} size={26} />
                  <div><strong>{byId(n.agentId)?.name ?? n.agentId}</strong> <span className="crm-sub">{when(n.at)}</span><p>{n.text}</p></div></li>
              ) : (
                <li key={n.id} className="wk-activity"><span>{n.agentId === 'system' ? 'NexMarket' : byId(n.agentId)?.name ?? n.agentId} {n.text}</span> <span className="crm-sub">· {when(n.at)}</span></li>
              ))}
            </ul>
            <div className="wk-comment-box">
              <textarea className="crm-input" rows={2} value={comment} maxLength={4000} placeholder="Write a comment. People on the card are told." onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send(); }} />
              <button type="button" className="crm-btn is-sm" disabled={busy || !comment.trim()} onClick={() => void send()}><Send size={14} aria-hidden /> Send</button>
            </div>
          </section>
          <p className="crm-sub" style={{ margin: 0 }}>Made by {byId(card.createdBy)?.name ?? card.createdBy} on {when(card.createdAt)}{card.doneAt ? ` · done ${when(card.doneAt)}${card.doneBy ? ` by ${byId(card.doneBy)?.name ?? card.doneBy}` : ''}` : ''} · <span style={{ color: pr.color }}>{pr.label} priority</span></p>
        </div>
      </aside>
    </>
  );
}
