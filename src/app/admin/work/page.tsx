'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Archive, CalendarDays, CheckCircle2, CheckSquare, Columns3, LayoutList, MessageSquare, Plus, Repeat as RepeatIcon, Search, Sun, X } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { useLiveEvents } from '@/lib/crm/live';
import { ErrorBox, friendlyError, PageHead, Skeleton, useToast } from '@/components/crm/ui';
import { Avatar, CardDrawer } from '@/components/crm/work/CardDrawer';
import {
  COLUMN_COLOR, COLUMN_HINT, dueLabel, istToday, labelColors, parseQuick, PRIORITY,
  type BoardRes, type Card, type Status,
} from '@/components/crm/work/shared';

type View = 'board' | 'day' | 'list';
type Due = '' | 'late' | 'today' | 'week' | 'none';

export default function WorkWrap() {
  return (
    <Suspense fallback={<main className="crm-page"><Skeleton h={600} /></main>}>
      <WorkBoard />
    </Suspense>
  );
}

const PRI_RANK = { urgent: 0, high: 1, normal: 2, low: 3 } as const;

/** One card on the board or in a list. */
function Tile({ c, board, onOpen, onDone, draggable, onDragStart }: {
  c: Card; board: BoardRes; onOpen: () => void; onDone: () => void; draggable?: boolean; onDragStart?: (e: React.DragEvent) => void;
}) {
  const byId = (a: string) => board.people.find((p) => p.agentId === a);
  const p = PRIORITY[c.priority];
  return (
    <article className={`wk-tile${c.status === 'done' ? ' is-done' : ''}`} draggable={draggable} onDragStart={onDragStart} onClick={onOpen}
      style={{ borderLeftColor: c.priority === 'normal' || c.priority === 'low' ? 'transparent' : p.color }} tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }} aria-label={`#${c.number} ${c.title}`}>
      <div className="wk-tile-top">
        <button type="button" className={`wk-tick${c.status === 'done' ? ' is-on' : ''}`} aria-label={c.status === 'done' ? 'Done' : 'Mark done'} title={c.status === 'done' ? 'Done' : 'Mark done'}
          onClick={(e) => { e.stopPropagation(); if (c.status !== 'done') onDone(); }}>
          <CheckCircle2 size={18} aria-hidden />
        </button>
        <span className="wk-tile-title">{c.title}</span>
      </div>
      {(c.labels.length > 0 || c.project) && (
        <div className="wk-tile-labels">
          {c.project && <span className="wk-proj">{c.project}</span>}
          {c.labels.map((l) => { const lc = labelColors(l); return <span key={l} className="wk-label" style={{ background: lc.bg, color: lc.fg }}>#{l}</span>; })}
        </div>
      )}
      <div className="wk-tile-meta">
        {(c.priority === 'urgent' || c.priority === 'high') && <span className="wk-pri" style={{ color: p.color }}>{p.label}</span>}
        {c.dueDate && <span className={`wk-due${c.overdue ? ' is-late' : c.dueDate === istToday() ? ' is-today' : ''}`}><CalendarDays size={12} aria-hidden />{dueLabel(c.dueDate)}</span>}
        {c.checkTotal > 0 && <span className={`wk-meta${c.checkDone === c.checkTotal ? ' is-ok' : ''}`}><CheckSquare size={12} aria-hidden />{c.checkDone}/{c.checkTotal}</span>}
        {c.comments > 0 && <span className="wk-meta"><MessageSquare size={12} aria-hidden />{c.comments}</span>}
        {c.repeat !== 'none' && <span className="wk-meta" title="Repeats"><RepeatIcon size={12} aria-hidden /></span>}
        <span className="wk-avs">{c.assignees.slice(0, 3).map((a) => <Avatar key={a} id={a} p={byId(a)} size={22} />)}{c.assignees.length > 3 && <span className="crm-sub">+{c.assignees.length - 3}</span>}</span>
      </div>
    </article>
  );
}

/**
 * The team board: plan, do and finish the office team's work on one page. Type a task in one line, drag cards across
 * the columns, see your own day, and open a card for its checklist, comments and history.
 */
function WorkBoard() {
  const params = useSearchParams();
  const router = useRouter();
  const [board, setBoard] = useState<BoardRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>(() => (params.get('v') as View) || 'board');
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState('');
  const [person, setPerson] = useState('');
  const [label, setLabel] = useState('');
  const [project, setProject] = useState('');
  const [due, setDue] = useState<Due>('');
  const [quick, setQuick] = useState('');
  const [adding, setAdding] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ col: Status; index: number } | null>(null);
  const [colAdd, setColAdd] = useState<Status | null>(null);
  const [colText, setColText] = useState('');
  const [toast, showToast] = useToast();
  const open = params.get('card');
  const quickRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try { setBoard(await crm.get<BoardRes>(`/api/v1/work${archived ? '?archived=true' : ''}`)); setError(null); } catch (e) { setError(friendlyError(e)); }
  }, [archived]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  useLiveEvents(useCallback((e) => { if (e.kind === 'work') void load(); }, [load]));
  // "N" anywhere on the page jumps to quick add.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) { e.preventDefault(); quickRef.current?.focus(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const setParam = (key: string, val: string | null) => {
    const sp = new URLSearchParams(params.toString());
    if (val) sp.set(key, val); else sp.delete(key);
    router.replace(`/admin/work${sp.size ? `?${sp}` : ''}`, { scroll: false });
  };
  const openCard = (id: string | null) => setParam('card', id);
  const pickView = (v: View) => { setView(v); setParam('v', v === 'board' ? null : v); };

  const parsed = useMemo(() => (board && quick.trim() ? parseQuick(quick, board.people) : null), [quick, board]);

  const merge = useCallback((c: Card, extra?: Card | null) => {
    setBoard((b) => {
      if (!b) return b;
      let cards = b.cards.some((x) => x.id === c.id) ? b.cards.map((x) => (x.id === c.id ? c : x)) : [...b.cards, c];
      if (c.archived !== archived) cards = cards.filter((x) => x.id !== c.id);
      if (extra && !cards.some((x) => x.id === extra.id)) cards = [...cards, extra];
      return { ...b, cards };
    });
  }, [archived]);

  const add = async (text: string, status?: Status) => {
    if (!board) return;
    const p = parseQuick(text, board.people);
    if (!p.title.trim()) { showToast('Write what needs doing.'); return; }
    setAdding(true);
    try {
      const c = await crm.post<Card>('/api/v1/work/cards', {
        title: p.title, status: status ?? p.status ?? 'todo', assignees: p.assignees.length ? p.assignees : (person ? [person] : []), labels: p.labels.length ? p.labels : (label ? [label] : []),
        priority: p.priority ?? 'normal', dueDate: p.dueDate ?? '', project: project || undefined,
      });
      merge(c);
      showToast(`Added #${c.number}.`);
    } catch (e) { showToast(friendlyError(e)); } finally { setAdding(false); }
  };

  const move = async (id: string, status: Status, beforeId?: string | null, afterId?: string | null) => {
    if (!board) return;
    const prev = board;
    // Show it moved straight away; the server confirms.
    setBoard({ ...board, cards: board.cards.map((x) => (x.id === id ? { ...x, status } : x)) });
    try {
      const r = await crm.post<{ card: Card; repeated?: Card | null }>(`/api/v1/work/cards/${id}/move`, { status, before: beforeId ?? null, after: afterId ?? null });
      merge(r.card, r.repeated);
      if (status === 'done') showToast(r.repeated ? `Done. The next one is in To do, due ${dueLabel(r.repeated.dueDate!)}.` : 'Done. Well done!');
    } catch (e) { setBoard(prev); showToast(friendlyError(e)); }
  };

  const filtered = useMemo(() => {
    if (!board) return [];
    const s = q.trim().toLowerCase();
    const t = istToday(), w = istToday(7);
    return board.cards.filter((c) => (!person || (person === '-' ? c.assignees.length === 0 : c.assignees.includes(person)))
      && (!label || c.labels.includes(label)) && (!project || c.project === project)
      && (!s || c.title.toLowerCase().includes(s) || `#${c.number}` === s || (c.description ?? '').toLowerCase().includes(s))
      && (due === '' || (due === 'late' ? c.overdue : due === 'today' ? c.dueDate === t : due === 'week' ? !!c.dueDate && c.dueDate <= w && c.status !== 'done' : !c.dueDate)));
  }, [board, q, person, label, project, due]);

  if (error && !board) return <main className="crm-page"><ErrorBox message={error} onRetry={load} /></main>;
  if (!board) return <main className="crm-page"><Skeleton h={600} /></main>;
  const byCol = (s: Status) => filtered.filter((c) => c.status === s).sort((a, b) => a.order - b.order);
  const st = board.stats;
  const me = board.me;
  const nameOf = (a: string) => board.people.find((p) => p.agentId === a)?.name ?? a;
  const anyFilter = !!(q || person || label || project || due);

  // My day: what's late, what's due today, what I'm doing, what's next — for me (or the person picked).
  const who = person && person !== '-' ? person : me;
  const mine = board.cards.filter((c) => c.assignees.includes(who) && c.status !== 'done' && c.status !== 'idea');
  const t0 = istToday();
  const groups: { key: string; title: string; cards: Card[] }[] = [
    { key: 'late', title: 'Late', cards: mine.filter((c) => c.overdue) },
    { key: 'today', title: 'Today', cards: mine.filter((c) => c.dueDate === t0) },
    { key: 'doing', title: 'Doing now', cards: mine.filter((c) => c.status === 'doing' && !c.overdue && c.dueDate !== t0) },
    { key: 'next', title: 'Coming up', cards: mine.filter((c) => !c.overdue && c.dueDate !== t0 && c.status !== 'doing').sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || PRI_RANK[a.priority] - PRI_RANK[b.priority]) },
  ];
  const doneToday = board.cards.filter((c) => c.status === 'done' && c.assignees.includes(who) && c.doneAt && new Date(new Date(c.doneAt).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10) === t0);

  const onDrop = (col: Status) => {
    if (!dragId) return;
    const list = byCol(col).filter((c) => c.id !== dragId);
    const i = dropAt?.col === col ? Math.min(dropAt.index, list.length) : list.length;
    void move(dragId, col, list[i]?.id ?? null, list[i - 1]?.id ?? null);
    setDragId(null); setDropAt(null);
  };

  return (
    <main className="crm-page wk-page">
      <PageHead title="Team board" sub="Plan, do and finish the team's work in one place. Press N to add a card." />

      <div className="wk-stats">
        <button type="button" className="wk-stat" onClick={() => { setDue(''); setPerson(''); }}><strong>{st.open}</strong><span>open</span></button>
        <button type="button" className="wk-stat" onClick={() => pickView('board')}><strong style={{ color: COLUMN_COLOR.doing }}>{st.doing}</strong><span>being done</span></button>
        <button type="button" className={`wk-stat${st.overdue ? ' is-bad' : ''}`} onClick={() => { setDue('late'); pickView('list'); }}><strong>{st.overdue}</strong><span>late</span></button>
        <button type="button" className="wk-stat" onClick={() => { setDue('today'); pickView('list'); }}><strong>{st.dueToday}</strong><span>due today</span></button>
        <div className="wk-stat is-ok"><strong>{st.doneThisWeek}</strong><span>done this week</span></div>
        <div className="wk-load" aria-label="Open cards per person">
          {st.load.sort((a, b) => b.open - a.open).slice(0, 8).map((l) => (
            <button key={l.agentId} type="button" className="wk-load-p" aria-pressed={person === l.agentId} onClick={() => setPerson(person === l.agentId ? '' : l.agentId)} title={`${nameOf(l.agentId)}: ${l.open} open, ${l.doing} doing, ${l.overdue} late`}>
              <Avatar id={l.agentId} p={board.people.find((p) => p.agentId === l.agentId)} size={28} />
              <span>{l.open}{l.overdue > 0 && <em>{l.overdue} late</em>}</span>
            </button>
          ))}
        </div>
      </div>

      <form className="wk-quick" onSubmit={(e) => { e.preventDefault(); if (quick.trim()) void add(quick).then(() => setQuick('')); }}>
        <Plus size={18} aria-hidden />
        <input ref={quickRef} className="wk-quick-in" value={quick} onChange={(e) => setQuick(e.target.value)} maxLength={300}
          placeholder="Add a card: Print camp banners @rahul #camp !high fri" aria-label="Quick add" />
        <button type="submit" className="crm-btn is-sm" disabled={adding || !parsed?.title}>{adding ? 'Adding…' : 'Add'}</button>
      </form>
      {parsed && (
        <div className="wk-quick-preview">
          <span className="crm-sub">Will add:</span> <strong>{parsed.title || '…'}</strong>
          {parsed.assignees.map((a) => <span key={a} className="wk-chip"><Avatar id={a} p={board.people.find((p) => p.agentId === a)} size={18} />{nameOf(a)}</span>)}
          {parsed.labels.map((l) => <span key={l} className="wk-label" style={labelColors(l).bg ? { background: labelColors(l).bg, color: labelColors(l).fg } : undefined}>#{l}</span>)}
          {parsed.priority && <span className="wk-chip" style={{ color: PRIORITY[parsed.priority].color }}>{PRIORITY[parsed.priority].label}</span>}
          {parsed.dueDate && <span className="wk-chip"><CalendarDays size={12} aria-hidden /> {dueLabel(parsed.dueDate)}</span>}
          {parsed.status && <span className="wk-chip">→ {board.columns.find((c) => c.key === parsed.status)?.label}</span>}
          {parsed.unknown.map((u) => <span key={u} className="wk-chip is-bad">{u}? not found</span>)}
          <span className="crm-sub wk-help">@person · #label · !high · today, tomorrow, fri, 12/11 · /idea /doing</span>
        </div>
      )}

      <div className="wk-bar-row">
        <div className="crm-chips" role="tablist" aria-label="View">
          <button type="button" className="crm-chip" aria-pressed={view === 'board'} onClick={() => pickView('board')}><Columns3 size={14} aria-hidden /> Board</button>
          <button type="button" className="crm-chip" aria-pressed={view === 'day'} onClick={() => pickView('day')}><Sun size={14} aria-hidden /> My day</button>
          <button type="button" className="crm-chip" aria-pressed={view === 'list'} onClick={() => pickView('list')}><LayoutList size={14} aria-hidden /> List</button>
        </div>
        <label className="crm-search wk-search"><Search size={15} aria-hidden /><span className="crm-sr">Search cards</span>
          <input className="crm-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search or #12" /></label>
        <select className="crm-input wk-sel" value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Person">
          <option value="">Everyone</option><option value={me}>Me</option><option value="-">Nobody yet</option>
          {board.people.filter((p) => p.agentId !== me).map((p) => <option key={p.agentId} value={p.agentId}>{p.name}</option>)}
        </select>
        <select className="crm-input wk-sel" value={due} onChange={(e) => setDue(e.target.value as Due)} aria-label="Due">
          <option value="">Any date</option><option value="late">Late</option><option value="today">Due today</option><option value="week">Due in 7 days</option><option value="none">No date</option>
        </select>
        {board.labels.length > 0 && (
          <select className="crm-input wk-sel" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Label">
            <option value="">All labels</option>{board.labels.map((l) => <option key={l} value={l}>#{l}</option>)}
          </select>
        )}
        {board.projects.length > 0 && (
          <select className="crm-input wk-sel" value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
            <option value="">All projects</option>{board.projects.map((p) => <option key={p.name} value={p.name}>{p.name} ({p.open} open)</option>)}
          </select>
        )}
        {anyFilter && <button type="button" className="wa-link" onClick={() => { setQ(''); setPerson(''); setLabel(''); setProject(''); setDue(''); }}><X size={13} aria-hidden /> Clear</button>}
        <button type="button" className={`crm-chip wk-arch`} aria-pressed={archived} onClick={() => setArchived((a) => !a)}><Archive size={14} aria-hidden /> Archive</button>
      </div>
      {archived && <div className="ld-banner"><span><strong>Showing the archive.</strong> Open a card and press &ldquo;Bring back&rdquo; to put it on the board again.</span></div>}

      {view === 'board' && (
        <div className="wk-board" onDragEnd={() => { setDragId(null); setDropAt(null); }}>
          {board.columns.map((col) => {
            const cards = byCol(col.key);
            return (
              <section key={col.key} className={`wk-col${dropAt?.col === col.key ? ' is-over' : ''}`} aria-label={col.label}
                onDragOver={(e) => { if (!dragId) return; e.preventDefault(); if (dropAt?.col !== col.key) setDropAt({ col: col.key, index: cards.length }); }}
                onDrop={(e) => { e.preventDefault(); onDrop(col.key); }}>
                <header className="wk-col-h">
                  <span className="wk-col-dot" style={{ background: COLUMN_COLOR[col.key] }} aria-hidden />
                  <strong>{col.label}</strong><span className="wk-count">{cards.length}</span>
                  {col.key === 'done' && board.isAdmin && cards.length > 0 && !archived && (
                    <button type="button" className="wa-link wk-col-act" title="Archive cards done more than a week ago"
                      onClick={() => void crm.post<{ archived: number }>('/api/v1/work/archive-done').then((r) => { showToast(r.archived ? `Archived ${r.archived} old cards.` : 'Nothing older than a week.'); void load(); }).catch((e) => showToast(friendlyError(e)))}>Tidy</button>
                  )}
                </header>
                <p className="wk-col-hint">{COLUMN_HINT[col.key]}</p>
                <div className="wk-col-body">
                  {cards.map((c, i) => (
                    <div key={c.id} onDragOver={(e) => { if (!dragId) return; e.preventDefault(); e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); const idx = e.clientY < r.top + r.height / 2 ? i : i + 1; if (dropAt?.col !== col.key || dropAt.index !== idx) setDropAt({ col: col.key, index: idx }); }}>
                      {dropAt?.col === col.key && dropAt.index === i && dragId && dragId !== c.id && <div className="wk-drop-line" />}
                      <Tile c={c} board={board} onOpen={() => openCard(c.id)} onDone={() => void move(c.id, 'done')} draggable={!archived}
                        onDragStart={(e) => { setDragId(c.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.id); }} />
                    </div>
                  ))}
                  {dropAt?.col === col.key && dropAt.index >= cards.length && dragId && <div className="wk-drop-line" />}
                  {!archived && (colAdd === col.key ? (
                    <form className="wk-col-add" onSubmit={(e) => { e.preventDefault(); if (colText.trim()) void add(colText, col.key).then(() => setColText('')); }}>
                      <input className="crm-input" autoFocus value={colText} onChange={(e) => setColText(e.target.value)} placeholder="What needs doing? (@, #, dates work)" onBlur={() => { if (!colText.trim()) setColAdd(null); }}
                        onKeyDown={(e) => { if (e.key === 'Escape') { setColAdd(null); setColText(''); } }} />
                    </form>
                  ) : (
                    <button type="button" className="wk-col-addbtn" onClick={() => { setColAdd(col.key); setColText(''); }}><Plus size={14} aria-hidden /> Add a card</button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {dragId && <div className="wk-drag-hint" onDragOver={(e) => e.preventDefault()}>Drop on a column to move it · Esc to cancel</div>}

      {view === 'day' && (
        <div className="wk-day">
          <div className="wk-day-h">
            <h2 className="crm-h2" style={{ margin: 0 }}>{who === me ? 'My day' : `${nameOf(who)}'s day`}</h2>
            <span className="crm-sub">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })} · {doneToday.length} done today</span>
          </div>
          {groups.every((g) => g.cards.length === 0) && <section className="crm-card"><p className="crm-sub" style={{ margin: 0 }}>Nothing given to {who === me ? 'you' : nameOf(who)} yet. Add a card above with @{who === me ? 'yourname' : nameOf(who).split(' ')[0].toLowerCase()}, or pick cards on the board and press &ldquo;I&apos;ll do it&rdquo;.</p></section>}
          {groups.filter((g) => g.cards.length).map((g) => (
            <section key={g.key} className={`wk-day-g is-${g.key}`}>
              <h3>{g.title} <span className="wk-count">{g.cards.length}</span></h3>
              <div className="wk-day-list">{g.cards.map((c) => <Tile key={c.id} c={c} board={board} onOpen={() => openCard(c.id)} onDone={() => void move(c.id, 'done')} />)}</div>
            </section>
          ))}
          {doneToday.length > 0 && (
            <section className="wk-day-g is-done">
              <h3>Done today <span className="wk-count">{doneToday.length}</span></h3>
              <div className="wk-day-list">{doneToday.map((c) => <Tile key={c.id} c={c} board={board} onOpen={() => openCard(c.id)} onDone={() => undefined} />)}</div>
            </section>
          )}
        </div>
      )}

      {view === 'list' && (
        <section className="crm-card">
          {filtered.length === 0 ? <p className="crm-sub" style={{ margin: 0 }}>No cards match.</p> : (
            <div className="crm-table-wrap">
              <table className="crm-table wk-table">
                <thead><tr><th scope="col" style={{ width: 36 }} /><th scope="col">Card</th><th scope="col">Column</th><th scope="col">People</th><th scope="col">Due</th><th scope="col">Priority</th><th scope="col">Progress</th></tr></thead>
                <tbody>
                  {[...filtered].sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || PRI_RANK[a.priority] - PRI_RANK[b.priority]).map((c) => (
                    <tr key={c.id} className="fs-row" onClick={() => openCard(c.id)}>
                      <td><button type="button" className={`wk-tick${c.status === 'done' ? ' is-on' : ''}`} aria-label="Mark done" onClick={(e) => { e.stopPropagation(); if (c.status !== 'done') void move(c.id, 'done'); }}><CheckCircle2 size={18} aria-hidden /></button></td>
                      <td><span className="crm-sub">#{c.number}</span> <span className={c.status === 'done' ? 'wk-strike' : undefined}>{c.title}</span>
                        {c.labels.length > 0 && <span style={{ marginLeft: 6 }}>{c.labels.map((l) => <span key={l} className="wk-label" style={{ background: labelColors(l).bg, color: labelColors(l).fg, marginRight: 4 }}>#{l}</span>)}</span>}</td>
                      <td><span className="wk-col-dot" style={{ background: COLUMN_COLOR[c.status] }} aria-hidden /> {board.columns.find((x) => x.key === c.status)?.label}</td>
                      <td><span className="wk-avs">{c.assignees.map((a) => <Avatar key={a} id={a} p={board.people.find((p) => p.agentId === a)} size={22} />)}</span></td>
                      <td>{c.dueDate ? <span className={`wk-due${c.overdue ? ' is-late' : c.dueDate === istToday() ? ' is-today' : ''}`}>{dueLabel(c.dueDate)}</span> : '—'}</td>
                      <td style={{ color: PRIORITY[c.priority].color }}>{PRIORITY[c.priority].label}</td>
                      <td>{c.checkTotal ? `${c.checkDone}/${c.checkTotal}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {open && <CardDrawer key={open} id={open} board={board} onClose={() => openCard(null)} onSaved={merge} toast={showToast} />}
      {toast}
    </main>
  );
}
