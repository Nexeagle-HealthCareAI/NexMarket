'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Archive, Bell, CalendarDays, CheckCircle2, CheckSquare, Clock, CornerDownRight, Filter, ListTree, MessageSquare, Plus, Repeat as RepeatIcon, Search, X } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { useLiveEvents } from '@/lib/crm/live';
import { ErrorBox, friendlyError, Skeleton, useToast } from '@/components/crm/ui';
import { Avatar, CardDrawer } from '@/components/crm/work/CardDrawer';
import { Docs } from '@/components/crm/work/Docs';
import { Backlog, CompleteSprint, CreateIssue, Reports, Timeline, TypeIcon, type NewIssue } from '@/components/crm/work/Issues';
import { MyDay } from '@/components/crm/work/MyDay';
import { UpdatesPanel, useWorkUnread } from '@/components/crm/work/Updates';
import { FilterPanel, filterTags, NO_FILTERS, panelCount, passes, epicOf, type Filters } from '@/components/crm/work/BoardFilters';
import {
  COLUMN_COLOR, COLUMN_HINT, dueLabel, istToday, labelColors, parseQuick, PRIORITY,
  type BoardRes, type Card, type Status,
} from '@/components/crm/work/shared';

type View = 'board' | 'backlog' | 'day' | 'list' | 'timeline' | 'reports' | 'docs';
const VIEWS: View[] = ['day', 'board', 'list', 'backlog', 'timeline', 'reports', 'docs'];
const VIEW_LABEL: Record<View, string> = { day: 'My day', board: 'Board', list: 'List', backlog: 'Backlog', timeline: 'Timeline', reports: 'Reports', docs: 'Plans & docs' };
/** Where a thin divider goes before a tab: My day | Board List Backlog Timeline | Reports Plans & docs */
const GROUP_START = new Set<View>(['board', 'reports']);

export default function WorkWrap() {
  return (
    <Suspense fallback={<main className="crm-page"><Skeleton h={600} /></main>}>
      <WorkBoard />
    </Suspense>
  );
}

const PRI_RANK = { urgent: 0, high: 1, normal: 2, low: 3 } as const;

/** One card on the board. */
function Tile({ c, board, epic, onOpen, onDone, draggable, onDragStart }: {
  c: Card; board: BoardRes; epic?: Card; onOpen: () => void; onDone: () => void; draggable?: boolean; onDragStart?: (e: React.DragEvent) => void;
}) {
  const byId = (a: string) => board.people.find((p) => p.agentId === a);
  const p = PRIORITY[c.priority];
  const late = c.overdue, today = c.dueDate === istToday();
  return (
    <article className={`wk-tile${c.status === 'done' ? ' is-done' : ''}`} draggable={draggable} onDragStart={onDragStart} onClick={onOpen}
      tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }} aria-label={`#${c.number} ${c.title}`}>
      <div className="wk-tile-head">
        <TypeIcon type={c.type} size={16} />
        <span className="wk-tile-key">#{c.number}</span>
        {(c.priority === 'urgent' || c.priority === 'high') && <span className="wk-pri" style={{ color: c.priority === 'high' ? '#a85d12' : p.color }}>{p.label}</span>}
        <button type="button" className={`wk-tick${c.status === 'done' ? ' is-on' : ''}`} aria-label={c.status === 'done' ? 'Done' : `Mark #${c.number} done`} title={c.status === 'done' ? 'Done' : 'Mark done'}
          onClick={(e) => { e.stopPropagation(); if (c.status !== 'done') onDone(); }}>
          <CheckCircle2 size={18} aria-hidden />
        </button>
      </div>
      <span className="wk-tile-title">{c.title}</span>
      {c.parent && c.parent.type !== 'epic' && <div className="wk-parent" title={`Under #${c.parent.number} ${c.parent.title}`}><CornerDownRight size={12} aria-hidden /><span>#{c.parent.number} {c.parent.title}</span></div>}
      {(epic || c.labels.length > 0 || c.project) && (
        <div className="wk-tile-labels">
          {epic && <span className="wk-epic-chip" title={`Epic: ${epic.title}`}>{epic.title}</span>}
          {c.project && <span className="wk-proj">{c.project}</span>}
          {c.labels.map((l) => { const lc = labelColors(l); return <span key={l} className="wk-label" style={{ background: lc.bg, color: lc.fg }}>#{l}</span>; })}
        </div>
      )}
      <div className="wk-tile-meta">
        {c.dueDate && <span className={`wk-due${late ? ' is-late' : today ? ' is-today' : ''}`}><CalendarDays size={12} aria-hidden />{late ? `Late · ${dueLabel(c.dueDate)}` : dueLabel(c.dueDate)}</span>}
        {c.subTotal > 0 && <span className={`wk-meta${c.subDone === c.subTotal ? ' is-ok' : ''}`} title={`${c.subDone} of ${c.subTotal} sub-tasks done`}><ListTree size={12} aria-hidden />{c.subDone}/{c.subTotal}</span>}
        {c.checkTotal > 0 && <span className={`wk-meta${c.checkDone === c.checkTotal ? ' is-ok' : ''}`} title="Checklist"><CheckSquare size={12} aria-hidden />{c.checkDone}/{c.checkTotal}</span>}
        {c.comments > 0 && <span className="wk-meta" title="Comments"><MessageSquare size={12} aria-hidden />{c.comments}</span>}
        {c.repeat !== 'none' && <span className="wk-meta" title="Repeats"><RepeatIcon size={12} aria-hidden /></span>}
        <span className="wk-tile-end">
          {c.storyPoints != null && <span className="wk-pts" title="Story points">{c.storyPoints}</span>}
          <span className="wk-avs">{c.assignees.slice(0, 3).map((a) => <Avatar key={a} id={a} p={byId(a)} size={24} />)}{c.assignees.length > 3 && <span className="crm-sub">+{c.assignees.length - 3}</span>}</span>
        </span>
      </div>
    </article>
  );
}

/**
 * The team board: each person's day, the sprint board, list, backlog, timeline, reports and the team's documents.
 * The sprint (goal, days left, progress) sits on top; one short toolbar finds and filters; cards are added in the
 * column they belong in.
 */
function WorkBoard() {
  const params = useSearchParams();
  const router = useRouter();
  const [board, setBoard] = useState<BoardRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>(() => {
    const v = params.get('v') as View | null;
    return v && VIEWS.includes(v) ? v : 'day';
  });
  const [archived, setArchived] = useState(false);
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [subs, setSubs] = useState(true);
  const [panel, setPanel] = useState(false);
  const [dayWho, setDayWho] = useState('');
  const [creating, setCreating] = useState<Partial<NewIssue> | null>(null);
  const [closing, setClosing] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ col: Status; index: number } | null>(null);
  const [colAdd, setColAdd] = useState<Status | null>(null);
  const [colText, setColText] = useState('');
  const [adding, setAdding] = useState(false);
  const [phoneCol, setPhoneCol] = useState(0);
  const [updates, setUpdates] = useState(false);
  const [unread, reloadUnread] = useWorkUnread();
  const [toast, showToast] = useToast();
  const open = params.get('card');
  const boardRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try { setBoard(await crm.get<BoardRes>(`/api/v1/work${archived ? '?archived=true' : ''}`)); setError(null); } catch (e) { setError(friendlyError(e)); }
  }, [archived]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  useLiveEvents(useCallback((e) => { if (e.kind === 'work') void load(); }, [load]));

  const setParam = (key: string, val: string | null) => {
    const sp = new URLSearchParams(params.toString());
    if (val) sp.set(key, val); else sp.delete(key);
    router.replace(`/admin/work${sp.size ? `?${sp}` : ''}`, { scroll: false });
  };
  /** Several address bar changes at once (one replace, so none is lost). */
  const setParams = (changes: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) { if (v) sp.set(k, v); else sp.delete(k); }
    router.replace(`/admin/work${sp.size ? `?${sp}` : ''}`, { scroll: false });
  };
  const openCard = (id: string | null) => setParam('card', id);
  const pickView = (v: View) => { setView(v); setParam('v', v === 'day' ? null : v); };
  /** Opens a plan in Plans & docs (closing any open card). */
  const openDoc = (id: string) => {
    const sp = new URLSearchParams(params.toString());
    sp.set('v', 'docs'); sp.set('doc', id); sp.delete('card');
    setView('docs');
    router.replace(`/admin/work?${sp}`, { scroll: false });
  };

  // "N" anywhere on the page starts a new card: in To do on the board, in the box on My day, the full form elsewhere.
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key.toLowerCase() !== 'n' || e.ctrlKey || e.metaKey || e.altKey || t.isContentEditable || t.closest('[contenteditable]') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      const v = viewRef.current;
      if (v === 'day') document.getElementById('wk-day-add')?.focus();
      else if (v === 'board') { setColAdd('todo'); setColText(''); }
      else setCreating({});
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const merge = useCallback((c: Card, extra?: Card | null) => {
    setBoard((b) => {
      if (!b) return b;
      let cards = b.cards.some((x) => x.id === c.id) ? b.cards.map((x) => (x.id === c.id ? c : x)) : [...b.cards, c];
      if (c.archived !== archived) cards = cards.filter((x) => x.id !== c.id);
      if (extra && !cards.some((x) => x.id === extra.id)) cards = [...cards, extra];
      return { ...b, cards };
    });
  }, [archived]);

  /** Adds a card from one line of text. On My day it goes to that person, due today unless the text says otherwise. */
  const add = async (text: string, status?: Status, forDay?: string): Promise<boolean> => {
    if (!board) return false;
    const p = parseQuick(text, board.people);
    if (!p.title.trim()) { showToast('Write what needs doing.'); return false; }
    setAdding(true);
    try {
      const active = board.sprints?.find((s) => s.status === 'active');
      const c = await crm.post<Card>('/api/v1/work/cards', {
        title: p.title, status: status ?? p.status ?? 'todo',
        assignees: p.assignees.length ? p.assignees : forDay ? [forDay] : (f.person && f.person !== '-' ? [f.person] : []),
        labels: p.labels.length ? p.labels : f.labels.slice(0, 1),
        priority: p.priority ?? 'normal', dueDate: p.dueDate ?? (forDay ? istToday() : ''), project: f.project || undefined,
        type: f.types.length === 1 && f.types[0] !== 'epic' ? f.types[0] : undefined,
        sprintId: !forDay && f.sprint === 'active' && active ? active.id : undefined,
      });
      merge(c);
      showToast(`Added #${c.number}.`);
      return true;
    } catch (e) { showToast(friendlyError(e)); return false; } finally { setAdding(false); }
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

  const all = useMemo(() => new Map((board?.cards ?? []).map((c) => [c.id, c])), [board]);
  const activeSprint = board?.sprints?.find((s) => s.status === 'active');
  const showEpics = view === 'list';
  const filtered = useMemo(() => (board ? board.cards.filter((c) => passes(c, f, { showEpics, subs, activeSprint: activeSprint?.id, all })) : []),
    [board, f, showEpics, subs, activeSprint, all]);
  const baseCount = useMemo(() => (board ? board.cards.filter((c) => passes(c, NO_FILTERS, { showEpics, subs, all })).length : 0), [board, showEpics, subs, all]);

  if (error && !board) return <main className="crm-page"><ErrorBox message={error} onRetry={load} /></main>;
  if (!board) return <main className="crm-page"><Skeleton h={600} /></main>;
  const me = board.me;
  const byCol = (s: Status) => filtered.filter((c) => c.status === s).sort((a, b) => a.order - b.order);
  const nameOf = (a: string) => board.people.find((p) => p.agentId === a)?.name ?? a;
  const upd = (p: Partial<Filters>) => setF((x) => ({ ...x, ...p }));
  const tags = filterTags(f, board);
  const filtering = view === 'board' || view === 'list';

  // The running sprint, for the header.
  const t0 = istToday();
  const sc = activeSprint ? board.cards.filter((c) => c.sprintId === activeSprint.id) : [];
  const ptsAll = sc.reduce((a, c) => a + (c.storyPoints ?? 0), 0);
  const usePts = ptsAll > 0;
  const amount = (cs: Card[]) => (usePts ? cs.reduce((a, c) => a + (c.storyPoints ?? 0), 0) : cs.length);
  const total = usePts ? ptsAll : sc.length;
  const doneAmt = amount(sc.filter((c) => c.status === 'done'));
  const doingAmt = amount(sc.filter((c) => c.status === 'doing' || c.status === 'review'));
  const daysLeft = activeSprint?.endDate ? Math.round((new Date(`${activeSprint.endDate}T00:00:00Z`).getTime() - new Date(`${t0}T00:00:00Z`).getTime()) / 864e5) : null;
  const lateCount = activeSprint ? sc.filter((c) => c.overdue).length : board.stats.overdue;
  const sprintPeople = [...new Set(sc.flatMap((c) => c.assignees))];
  const fmtDay = (d?: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');

  // Faces in the toolbar: me first, then whoever has the most open work.
  const faces = [me, ...[...board.stats.load].sort((a, b) => b.open - a.open).map((l) => l.agentId).filter((a) => a !== me)]
    .filter((a, i, arr) => arr.indexOf(a) === i && board.people.some((p) => p.agentId === a)).slice(0, 6);

  const onDrop = (col: Status) => {
    if (!dragId) return;
    const list = byCol(col).filter((c) => c.id !== dragId);
    const i = dropAt?.col === col ? Math.min(dropAt.index, list.length) : list.length;
    void move(dragId, col, list[i]?.id ?? null, list[i - 1]?.id ?? null);
    setDragId(null); setDropAt(null);
  };
  const toColumn = (i: number) => {
    const el = boardRef.current, col = el?.children[i] as HTMLElement | undefined;
    if (el && col) el.scrollTo({ left: col.offsetLeft - el.offsetLeft, behavior: 'smooth' });
    setPhoneCol(i);
  };
  const colPreview = colText.trim() ? parseQuick(colText, board.people) : null;

  return (
    <main className="crm-page wk-page">
      <header className="wk-hero">
        <div className="wk-hero-top">
          <div className="wk-hero-main">
            {activeSprint ? <>
              <div className="wk-hero-title">
                <h1>{activeSprint.name}</h1>
                <span className="wk-run">Running</span>
              </div>
              {activeSprint.goal && <p className="wk-goal">Goal: {activeSprint.goal}</p>}
              <div className="wk-hero-meta">
                {activeSprint.startDate && activeSprint.endDate && (
                  <span>{fmtDay(activeSprint.startDate)} – {fmtDay(activeSprint.endDate)}{daysLeft != null && <> · <strong>{daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : daysLeft === 0 ? 'ends today' : `${-daysLeft} day${daysLeft === -1 ? '' : 's'} over`}</strong></>}</span>
                )}
                {total > 0 && (
                  <span className="wk-prog">
                    <span className="wk-bar is-split" role="img" aria-label={`${doneAmt} of ${total} ${usePts ? 'points' : 'issues'} done, ${doingAmt} being done`}>
                      <span style={{ width: `${(100 * doneAmt) / total}%` }} className="is-done" />
                      <span style={{ width: `${(100 * doingAmt) / total}%` }} className="is-doing" />
                    </span>
                    <span><strong>{doneAmt} of {total}</strong> {usePts ? 'points' : 'issues'} done{doingAmt > 0 && ` · ${doingAmt} being done`}</span>
                  </span>
                )}
                {lateCount > 0 && <button type="button" className="wk-hero-late" onClick={() => { setF({ ...NO_FILTERS, due: 'late', sprint: 'active' }); pickView('board'); }}><Clock size={15} aria-hidden />{lateCount} late</button>}
              </div>
            </> : <>
              <div className="wk-hero-title"><h1>Team board</h1></div>
              <p className="wk-goal">{board.stats.open} open · {board.stats.doing} being done{board.stats.dueToday ? ` · ${board.stats.dueToday} due today` : ''} · {board.stats.doneThisWeek} done this week</p>
              <div className="wk-hero-meta">
                {board.stats.overdue > 0 && <button type="button" className="wk-hero-late" onClick={() => { setF({ ...NO_FILTERS, due: 'late' }); pickView('board'); }}><Clock size={15} aria-hidden />{board.stats.overdue} late</button>}
                <button type="button" className="wa-link" onClick={() => pickView('backlog')}>Plan a sprint in Backlog</button>
              </div>
            </>}
          </div>
          <div className="wk-hero-acts">
            {activeSprint && sprintPeople.length > 0 && (
              <span className="wk-stack" aria-label={`${sprintPeople.length} people in this sprint: ${sprintPeople.map(nameOf).join(', ')}`}>
                {sprintPeople.slice(0, 4).map((a) => <Avatar key={a} id={a} p={board.people.find((p) => p.agentId === a)} size={30} />)}
                {sprintPeople.length > 4 && <span className="wk-av wk-stack-more">+{sprintPeople.length - 4}</span>}
              </span>
            )}
            <button type="button" className="wk-upd-btn" aria-label={unread ? `Updates, ${unread} unread` : 'Updates'} title="Updates on your work" aria-haspopup="dialog" onClick={() => setUpdates(true)}>
              <Bell size={19} aria-hidden />{unread > 0 && <span className="wk-upd-n">{unread > 99 ? '99+' : unread}</span>}<span className="wk-upd-l">Updates</span>
            </button>
            {activeSprint && <button type="button" className="crm-btn is-secondary wk-complete" onClick={() => setClosing(true)}>Complete sprint</button>}
            <button type="button" className="crm-btn wk-create-btn" onClick={() => setCreating(view === 'board' && f.sprint === 'active' && activeSprint ? { sprintId: activeSprint.id } : {})}
              title="Create an epic, feature, story, task or bug with all its details (N)"><Plus size={16} aria-hidden /> Create</button>
          </div>
        </div>
        <nav className="wk-tabs" aria-label="Team board views">
          {VIEWS.map((v) => (
            <span key={v} className="wk-tab-wrap">
              {GROUP_START.has(v) && <span className="wk-tab-sep" aria-hidden />}
              <button type="button" className="wk-tab" aria-current={view === v ? 'page' : undefined} onClick={() => pickView(v)}>{VIEW_LABEL[v]}</button>
            </span>
          ))}
        </nav>
      </header>

      {filtering && (
        <div className="wk-tools">
          <div className="wk-toolbar" role="toolbar" aria-label="Find and filter">
            <label className="crm-search wk-search"><Search size={15} aria-hidden /><span className="crm-sr">Search issues</span>
              <input className="crm-input" type="search" value={f.q} onChange={(e) => upd({ q: e.target.value })} placeholder="Search or #12" /></label>
            <div className="wk-faces" role="group" aria-label="Show one person's work">
              {faces.map((a) => (
                <button key={a} type="button" className="wk-face" aria-pressed={f.person === a} title={a === me ? 'Only mine' : `Only ${nameOf(a)}'s`}
                  aria-label={a === me ? 'Only mine' : `Only ${nameOf(a)}'s`} onClick={() => upd({ person: f.person === a ? '' : a })}>
                  <Avatar id={a} p={board.people.find((p) => p.agentId === a)} size={30} />
                </button>
              ))}
            </div>
            <span className="wk-tool-sep" aria-hidden />
            <button type="button" className="crm-chip" aria-pressed={f.due === 'late'} onClick={() => upd({ due: f.due === 'late' ? '' : 'late' })}>Late</button>
            <button type="button" className="crm-chip" aria-pressed={f.due === 'week'} onClick={() => upd({ due: f.due === 'week' ? '' : 'week' })}>Due this week</button>
            <div className="wk-fp-anchor">
              <button type="button" className="crm-chip" data-filters-btn aria-pressed={panelCount(f) > 0} aria-expanded={panel} aria-haspopup="dialog" onClick={() => setPanel((v) => !v)}>
                <Filter size={14} aria-hidden /> Filters{panelCount(f) > 0 && ` · ${panelCount(f)}`}
              </button>
              {panel && <FilterPanel board={board} f={f} set={setF} matches={filtered.length} subs={subs} setSubs={setSubs} archived={archived} setArchived={setArchived} onClose={() => setPanel(false)} />}
            </div>
            <div className="wk-tool-end">
              <button type="button" className="crm-chip" aria-pressed={!subs} onClick={() => setSubs((v) => !v)} title="Show or hide sub-tasks as their own cards"><ListTree size={14} aria-hidden /> {subs ? 'Hide sub-tasks' : 'Show sub-tasks'}</button>
              <button type="button" className="crm-chip" aria-pressed={archived} onClick={() => setArchived((a) => !a)} title="Show archived cards instead"><Archive size={14} aria-hidden /> Archive</button>
            </div>
          </div>
          {(tags.length > 0 || f.q) && (
            <div className="wk-tags">
              {tags.map((t) => (
                <span key={t.key} className="wk-tag">{t.text}
                  <button type="button" aria-label={`Remove: ${t.text}`} onClick={() => upd(t.clear)}><X size={13} aria-hidden /></button></span>
              ))}
              <button type="button" className="wa-link" onClick={() => setF(NO_FILTERS)}>Clear all</button>
              <span className="crm-sub">Showing {filtered.length} of {baseCount} issues</span>
            </div>
          )}
          {archived && <div className="ld-banner"><span><strong>Showing the archive.</strong> Open a card and press &ldquo;Bring back&rdquo; to put it on the board again.</span></div>}
        </div>
      )}

      {view === 'board' && <>
        <div className="wk-colpick" role="group" aria-label="Column">
          {board.columns.map((col, i) => (
            <button key={col.key} type="button" className="wk-colpick-b" aria-pressed={phoneCol === i} onClick={() => toColumn(i)}>{col.label} <span>{byCol(col.key).length}</span></button>
          ))}
        </div>
        <div className="wk-board" ref={boardRef} onDragEnd={() => { setDragId(null); setDropAt(null); }}
          onScroll={(e) => { const el = e.currentTarget; const first = el.children[0] as HTMLElement | undefined; if (!first) return; const i = Math.round(el.scrollLeft / (first.offsetWidth + 12)); if (i !== phoneCol) setPhoneCol(Math.max(0, Math.min(i, board.columns.length - 1))); }}>
          {board.columns.map((col) => {
            const cards = byCol(col.key);
            const pts = cards.reduce((a, c) => a + (c.storyPoints ?? 0), 0);
            return (
              <section key={col.key} className={`wk-col${dropAt?.col === col.key ? ' is-over' : ''}`} aria-label={col.label}
                onDragOver={(e) => { if (!dragId) return; e.preventDefault(); if (dropAt?.col !== col.key) setDropAt({ col: col.key, index: cards.length }); }}
                onDrop={(e) => { e.preventDefault(); onDrop(col.key); }}>
                <header className="wk-col-h" title={COLUMN_HINT[col.key]}>
                  <span className="wk-col-dot" style={{ background: COLUMN_COLOR[col.key] }} aria-hidden />
                  <h2>{col.label}</h2><span className="wk-count">{cards.length}</span>
                  {pts > 0 && <span className="wk-col-pts" title="Story points in this column">{pts} pts</span>}
                  {col.key === 'done' && board.isAdmin && cards.length > 0 && !archived && (
                    <button type="button" className="wa-link wk-col-act" title="Archive cards done more than a week ago"
                      onClick={() => void crm.post<{ archived: number }>('/api/v1/work/archive-done').then((r) => { showToast(r.archived ? `Archived ${r.archived} old cards.` : 'Nothing older than a week.'); void load(); }).catch((e) => showToast(friendlyError(e)))}>Tidy</button>
                  )}
                </header>
                <div className="wk-col-body">
                  {cards.length === 0 && colAdd !== col.key && <p className="wk-col-empty">{COLUMN_HINT[col.key]}</p>}
                  {cards.map((c, i) => (
                    <div key={c.id} onDragOver={(e) => { if (!dragId) return; e.preventDefault(); e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); const idx = e.clientY < r.top + r.height / 2 ? i : i + 1; if (dropAt?.col !== col.key || dropAt.index !== idx) setDropAt({ col: col.key, index: idx }); }}>
                      {dropAt?.col === col.key && dropAt.index === i && dragId && dragId !== c.id && <div className="wk-drop-line" />}
                      <Tile c={c} board={board} epic={(() => { const e = epicOf(c, all); return e && e !== c.id ? all.get(e) : undefined; })()} onOpen={() => openCard(c.id)} onDone={() => void move(c.id, 'done')} draggable={!archived}
                        onDragStart={(e) => { setDragId(c.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.id); }} />
                    </div>
                  ))}
                  {dropAt?.col === col.key && dropAt.index >= cards.length && dragId && <div className="wk-drop-line" />}
                  {!archived && (colAdd === col.key ? (
                    <form className="wk-col-add" onSubmit={(e) => { e.preventDefault(); if (colText.trim() && !adding) void add(colText, col.key).then((ok) => { if (ok) setColText(''); }); }}>
                      <label className="crm-sr" htmlFor={`wk-add-${col.key}`}>New card in {col.label}</label>
                      <input id={`wk-add-${col.key}`} className="wk-col-in" autoFocus value={colText} maxLength={300} onChange={(e) => setColText(e.target.value)}
                        placeholder="What needs doing?" onBlur={() => { if (!colText.trim()) setColAdd(null); }}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') { setColAdd(null); setColText(''); }
                          if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); const p = colPreview; setCreating({ title: p?.title ?? colText, status: col.key }); setColAdd(null); setColText(''); }
                        }} />
                      {colPreview && (
                        <div className="wk-col-chips">
                          {colPreview.assignees.map((a) => <span key={a} className="wk-chip"><Avatar id={a} p={board.people.find((p) => p.agentId === a)} size={16} />{nameOf(a)}</span>)}
                          {colPreview.labels.map((l) => <span key={l} className="wk-label" style={labelColors(l).bg ? { background: labelColors(l).bg, color: labelColors(l).fg } : undefined}>#{l}</span>)}
                          {colPreview.priority && <span className="wk-chip" style={{ color: PRIORITY[colPreview.priority].color }}>{PRIORITY[colPreview.priority].label}</span>}
                          {colPreview.dueDate && <span className="wk-chip"><CalendarDays size={12} aria-hidden /> {dueLabel(colPreview.dueDate)}</span>}
                          {colPreview.unknown.map((u) => <span key={u} className="wk-chip is-bad">{u}? not found</span>)}
                        </div>
                      )}
                      <span className="wk-col-help">Enter to add · Shift+Enter for the full form · @person #label !high fri</span>
                    </form>
                  ) : (
                    <button type="button" className="wk-col-addbtn" onClick={() => { setColAdd(col.key); setColText(''); }}><Plus size={15} aria-hidden /> Add a card</button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </>}
      {dragId && <div className="wk-drag-hint" onDragOver={(e) => e.preventDefault()}>Drop on a column to move it · Esc to cancel</div>}

      {view === 'day' && (
        <MyDay board={board} who={dayWho || me} setWho={(id) => setDayWho(id === me ? '' : id)} openCard={(id) => openCard(id)} openDoc={openDoc}
          onDone={(id) => void move(id, 'done')} onAdd={(text) => add(text, undefined, dayWho || me)} onCreate={() => setCreating({ assignees: [dayWho || me], dueDate: istToday() })} onRead={reloadUnread} />
      )}

      {view === 'list' && (
        <section className="crm-card">
          {filtered.length === 0 ? <p className="crm-sub" style={{ margin: 0 }}>No issues match. <button type="button" className="wa-link" onClick={() => setF(NO_FILTERS)}>Clear the filters</button></p> : (
            <div className="crm-table-wrap">
              <table className="crm-table wk-table">
                <thead><tr><th scope="col" style={{ width: 36 }}><span className="crm-sr">Done</span></th><th scope="col">Issue</th><th scope="col">Points</th><th scope="col">Column</th><th scope="col">People</th><th scope="col">Due</th><th scope="col">Priority</th><th scope="col">Progress</th></tr></thead>
                <tbody>
                  {[...filtered].sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || PRI_RANK[a.priority] - PRI_RANK[b.priority]).map((c) => (
                    <tr key={c.id} className="fs-row" onClick={() => openCard(c.id)}>
                      <td><button type="button" className={`wk-tick${c.status === 'done' ? ' is-on' : ''}`} aria-label={`Mark #${c.number} done`} onClick={(e) => { e.stopPropagation(); if (c.status !== 'done') void move(c.id, 'done'); }}><CheckCircle2 size={18} aria-hidden /></button></td>
                      <td><TypeIcon type={c.type} size={15} /> {c.parent && <CornerDownRight size={12} aria-hidden className="wk-sub-ic" />}<span className="crm-sub">#{c.number}</span> <span className={c.status === 'done' ? 'wk-strike' : undefined}>{c.title}</span>
                        {c.parent && <span className="crm-sub"> · in #{c.parent.number}</span>}
                        {c.labels.length > 0 && <span style={{ marginLeft: 6 }}>{c.labels.map((l) => <span key={l} className="wk-label" style={{ background: labelColors(l).bg, color: labelColors(l).fg, marginRight: 4 }}>#{l}</span>)}</span>}</td>
                      <td>{c.storyPoints ?? '—'}</td>
                      <td><span className="wk-col-dot" style={{ background: COLUMN_COLOR[c.status] }} aria-hidden /> {board.columns.find((x) => x.key === c.status)?.label}</td>
                      <td><span className="wk-avs">{c.assignees.map((a) => <Avatar key={a} id={a} p={board.people.find((p) => p.agentId === a)} size={22} />)}</span></td>
                      <td>{c.dueDate ? <span className={`wk-due${c.overdue ? ' is-late' : c.dueDate === istToday() ? ' is-today' : ''}`}>{dueLabel(c.dueDate)}</span> : '—'}</td>
                      <td style={{ color: PRIORITY[c.priority].color }}>{PRIORITY[c.priority].label}</td>
                      <td>{c.subTotal ? `${c.subDone}/${c.subTotal} sub-tasks` : c.checkTotal ? `${c.checkDone}/${c.checkTotal}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {view === 'backlog' && <Backlog board={board} openCard={(id) => openCard(id)} toast={showToast} reload={load} onCreate={(st) => setCreating(st)} />}
      {view === 'timeline' && <Timeline board={board} openCard={(id) => openCard(id)} />}
      {view === 'reports' && <Reports board={board} toast={showToast} />}
      {view === 'docs' && <Docs board={board} toast={showToast} openCard={openCard} docId={params.get('doc')} folderParam={params.get('folder')} commentParam={params.get('c')} setQuery={setParams} />}

      {view !== 'docs' && (
        <button type="button" className="wk-fab" aria-label="Create" onClick={() => setCreating(view === 'day' ? { assignees: [dayWho || me], dueDate: istToday() } : {})}><Plus size={24} aria-hidden /></button>
      )}
      {creating && <CreateIssue board={board} start={creating} toast={showToast} onClose={() => setCreating(null)} onCreated={(c) => { merge(c); void load(); }} />}
      {closing && activeSprint && (
        <CompleteSprint sprint={activeSprint} next={(board.sprints ?? []).filter((x) => x.status === 'planned')} open={sc.filter((c) => c.status !== 'done').length}
          done={sc.filter((c) => c.status === 'done').length} onClose={() => setClosing(false)} toast={showToast} onDone={() => { setClosing(false); void load(); }} />
      )}
      {updates && <UpdatesPanel onClose={() => setUpdates(false)} onChanged={reloadUnread} />}
      {open && <CardDrawer key={open} id={open} board={board} onClose={() => openCard(null)} onSaved={merge} toast={showToast}
        onOpen={(id) => openCard(id)} onOpenDoc={openDoc} />}
      {toast}
    </main>
  );
}

