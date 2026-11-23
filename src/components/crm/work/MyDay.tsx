'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ChevronDown, ChevronRight, FileText, Plus } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { crmHref } from '@/components/crm/NotificationBell';
import { Avatar } from './CardDrawer';
import { TypeIcon } from './Issues';
import { dueLabel, istToday, parseQuick, type BoardRes, type Card, type DocRow } from './shared';

const PRI_RANK = { urgent: 0, high: 1, normal: 2, low: 3 } as const;

interface Note { id: string; kind: string; title: string; body: string; link?: string | null; createdAt: string; read: boolean }

/** "2 h ago" style, short. */
function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

function greeting() {
  const h = new Date(Date.now() + 5.5 * 3600e3).getUTCHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/**
 * Each person's home on the Team board: what is late, what is for today and the next 7 days, what other people are
 * waiting on them for, their part of the running sprint and the documents they touched last.
 */
export function MyDay({ board, who, setWho, openCard, openDoc, onDone, onAdd, onCreate, onRead }: {
  board: BoardRes; who: string; setWho: (id: string) => void;
  openCard: (id: string) => void; openDoc: (id: string) => void; onDone: (id: string) => void;
  onAdd: (text: string) => Promise<boolean>; onCreate: () => void; onRead?: () => void;
}) {
  const router = useRouter();
  const me = board.me;
  const self = who === me;
  const nameOf = (a: string) => board.people.find((p) => p.agentId === a)?.name ?? a;
  const first = nameOf(who).split(' ')[0];
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [later, setLater] = useState(false);

  // Things waiting for me: unread Team board notifications (comments and mentions on cards and documents, documents
  // shared with me). Reloaded whenever the board changes, so a reply shows up without a refresh.
  useEffect(() => {
    if (!self) return;
    let off = false;
    crm.get<{ items: Note[] }>('/api/v1/notifications?limit=30&unreadOnly=true&kind=work,work_mention')
      .then((r) => { if (!off) setNotes(r.items.filter((n) => n.kind === 'work' || n.kind === 'work_mention')); })
      .catch(() => { if (!off) setNotes([]); });
    return () => { off = true; };
  }, [self, board]);
  useEffect(() => {
    let off = false;
    crm.get<DocRow[]>('/api/v1/work/docs?view=recent')
      .then((r) => { if (!off) setDocs(r.filter((d) => !d.archived).slice(0, 4)); })
      .catch(() => { if (!off) setDocs([]); });
    return () => { off = true; };
  }, []);

  const t0 = istToday(), t7 = istToday(7);
  const g = useMemo(() => {
    const mine = board.cards.filter((c) => c.assignees.includes(who) && c.status !== 'done' && c.status !== 'idea' && c.type !== 'epic');
    const byDate = (a: Card, b: Card) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || PRI_RANK[a.priority] - PRI_RANK[b.priority];
    const late = mine.filter((c) => c.overdue).sort(byDate);
    const today = mine.filter((c) => !c.overdue && (c.dueDate === t0 || (c.status === 'doing' && (!c.dueDate || c.dueDate > t7)))).sort(byDate);
    const used = new Set([...late, ...today].map((c) => c.id));
    const week = mine.filter((c) => !used.has(c.id) && !!c.dueDate && c.dueDate <= t7).sort(byDate);
    week.forEach((c) => used.add(c.id));
    const rest = mine.filter((c) => !used.has(c.id)).sort(byDate);
    const doneToday = board.cards.filter((c) => c.status === 'done' && c.assignees.includes(who) && c.doneAt
      && new Date(new Date(c.doneAt).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10) === t0);
    // Cards someone moved to Check that I asked for (I reported or made them) and am not doing myself.
    const toCheck = board.cards.filter((c) => c.status === 'review' && (c.reporter || c.createdBy) === who && !c.assignees.includes(who))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { late, today, week, rest, doneToday, toCheck };
  }, [board, who, t0, t7]);

  const sprint = board.sprints?.find((s) => s.status === 'active');
  const share = useMemo(() => {
    if (!sprint) return null;
    const cs = board.cards.filter((c) => c.sprintId === sprint.id && c.assignees.includes(who));
    const pts = cs.reduce((a, c) => a + (c.storyPoints ?? 0), 0);
    const ptsDone = cs.filter((c) => c.status === 'done').reduce((a, c) => a + (c.storyPoints ?? 0), 0);
    return { n: cs.length, done: cs.filter((c) => c.status === 'done').length, pts, ptsDone };
  }, [board, sprint, who]);
  const daysLeft = sprint?.endDate ? Math.round((new Date(`${sprint.endDate}T00:00:00Z`).getTime() - new Date(`${t0}T00:00:00Z`).getTime()) / 864e5) : null;

  const parsed = text.trim() ? parseQuick(text, board.people) : null;
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try { if (await onAdd(text)) setText(''); } finally { setBusy(false); }
  };

  const openNote = (n: Note) => {
    void crm.post(`/api/v1/notifications/${n.id}/read`).then(() => onRead?.()).catch(() => undefined);
    setNotes((x) => x?.filter((y) => y.id !== n.id) ?? x);
    const href = crmHref(n.link);
    if (href) router.push(href, { scroll: false });
  };

  const row = (c: Card, meta: string, bad?: boolean) => (
    <li key={c.id} className="wk-drow">
      <button type="button" className="wk-tick" aria-label={`Mark #${c.number} done`} title="Mark done" onClick={() => onDone(c.id)}><CheckCircle2 size={19} aria-hidden /></button>
      <TypeIcon type={c.type} size={16} />
      <span className="wk-drow-key">#{c.number}</span>
      <button type="button" className="wk-drow-t" onClick={() => openCard(c.id)}>{c.title}</button>
      <span className={`wk-drow-meta${bad ? ' is-bad' : ''}`}>{meta}</span>
    </li>
  );
  const metaOf = (c: Card) => (c.status === 'doing' && c.dueDate !== t0 && !c.overdue ? 'Doing' : c.dueDate ? dueLabel(c.dueDate) : c.status === 'review' ? 'In Check' : 'No date');

  const waitingCount = g.toCheck.length + (self ? notes?.length ?? 0 : 0);
  const nothing = !g.late.length && !g.today.length && !g.week.length && !g.rest.length;

  return (
    <div className="wk-myday">
      <div className="wk-md-hello">
        <div style={{ minWidth: 0 }}>
          <h2 className="wk-md-h">{self ? `${greeting()}, ${first}` : `${nameOf(who)}'s day`}</h2>
          <p className="crm-sub" style={{ margin: '4px 0 0' }}>
            {nothing ? 'Nothing given to ' + (self ? 'you' : first) + ' yet.' : <>
              {g.late.length > 0 && <><strong className="wk-md-bad">{g.late.length} late</strong>, </>}
              <strong>{g.today.length} for today</strong>
              {waitingCount > 0 && <> and <strong>{waitingCount} waiting for {self ? 'you' : first}</strong></>}.
              {g.doneToday.length > 0 && <> {g.doneToday.length} done today.</>}
            </>}
          </p>
        </div>
        <label className="wk-md-who"><span className="crm-sr">Whose day</span>
          <select className="crm-input wk-sel" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value={me}>My day</option>
            {board.people.filter((p) => p.agentId !== me).map((p) => <option key={p.agentId} value={p.agentId}>{p.name}&apos;s day</option>)}
          </select>
        </label>
      </div>

      <form className="wk-md-add" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Plus size={18} aria-hidden />
        <input id="wk-day-add" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} aria-label={self ? 'Add something for today' : `Add something for ${first}`}
          placeholder={self ? 'Add something for today: Call Dr Ansari 4pm !high' : `Add something for ${first} (due today)`}
          onKeyDown={(e) => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); onCreate(); } }} />
        <button type="submit" className="crm-btn is-sm" disabled={busy || !parsed?.title}>{busy ? 'Adding…' : 'Add'}</button>
      </form>
      {parsed && (
        <p className="crm-sub wk-md-hint">
          Adds “{parsed.title || '…'}” for {parsed.assignees.length ? parsed.assignees.map(nameOf).join(', ') : self ? 'you' : first}, due {parsed.dueDate ? dueLabel(parsed.dueDate).toLowerCase() : 'today'}
          {parsed.unknown.length > 0 && <span className="wk-md-bad"> · {parsed.unknown.join(', ')}? not found</span>}
        </p>
      )}

      <div className="wk-md-grid">
        <div className="wk-md-col">
          {g.late.length > 0 && (
            <section className="wk-md-panel" aria-labelledby="md-late">
              <h3 id="md-late" className="wk-md-ph is-bad">Late <span className="wk-count">{g.late.length}</span></h3>
              <ul className="wk-dl">{g.late.map((c) => row(c, dueLabel(c.dueDate!), true))}</ul>
            </section>
          )}
          <section className="wk-md-panel" aria-labelledby="md-today">
            <h3 id="md-today" className="wk-md-ph">Today <span className="wk-count">{g.today.length}</span></h3>
            {g.today.length ? <ul className="wk-dl">{g.today.map((c) => row(c, metaOf(c)))}</ul>
              : <p className="crm-sub wk-md-empty">Nothing due today{g.week.length ? ' — pick something from the next 7 days.' : '.'}</p>}
          </section>
          <section className="wk-md-panel" aria-labelledby="md-week">
            <h3 id="md-week" className="wk-md-ph">Next 7 days <span className="wk-count">{g.week.length}</span></h3>
            {g.week.length ? <ul className="wk-dl">{g.week.map((c) => row(c, metaOf(c)))}</ul> : <p className="crm-sub wk-md-empty">Nothing due in the next 7 days.</p>}
            {g.rest.length > 0 && <>
              <button type="button" className="wk-md-more" aria-expanded={later} onClick={() => setLater((v) => !v)}>
                {later ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />} Later or no date ({g.rest.length})
              </button>
              {later && <ul className="wk-dl">{g.rest.map((c) => row(c, metaOf(c)))}</ul>}
            </>}
          </section>
          {g.doneToday.length > 0 && (
            <section className="wk-md-panel is-quiet" aria-labelledby="md-done">
              <h3 id="md-done" className="wk-md-ph is-ok">Done today <span className="wk-count">{g.doneToday.length}</span></h3>
              <ul className="wk-dl">{g.doneToday.map((c) => (
                <li key={c.id} className="wk-drow is-done"><CheckCircle2 size={19} aria-hidden className="wk-md-ok" /><TypeIcon type={c.type} size={16} /><span className="wk-drow-key">#{c.number}</span>
                  <button type="button" className="wk-drow-t" onClick={() => openCard(c.id)}>{c.title}</button></li>
              ))}</ul>
            </section>
          )}
        </div>

        <div className="wk-md-col">
          <section className="wk-md-panel" aria-labelledby="md-wait">
            <h3 id="md-wait" className="wk-md-ph">Waiting for {self ? 'you' : first} <span className="wk-count">{waitingCount}</span></h3>
            <p className="crm-sub wk-md-empty" style={{ marginTop: -4 }}>What other people need from {self ? 'you' : first} before they can carry on.</p>
            {waitingCount === 0 && (self && notes === null ? <p className="crm-sub wk-md-empty">Loading…</p> : <p className="crm-sub wk-md-empty">Nobody is waiting.</p>)}
            <ul className="wk-wl">
              {g.toCheck.map((c) => {
                const by = c.assignees[0];
                return (
                  <li key={c.id}><button type="button" className="wk-wr" onClick={() => openCard(c.id)}>
                    {by ? <Avatar id={by} p={board.people.find((p) => p.agentId === by)} size={30} /> : <span className="wk-wr-ic"><TypeIcon type={c.type} size={16} /></span>}
                    <span className="wk-wr-txt"><strong>#{c.number} {c.title}</strong><span>{by ? `${nameOf(by)} moved it to Check` : 'In Check'} · {ago(c.updatedAt)}</span></span>
                    <span className="wk-wr-act">Check</span>
                  </button></li>
                );
              })}
              {self && notes?.map((n) => (
                <li key={n.id}><button type="button" className="wk-wr" onClick={() => openNote(n)}>
                  <span className="wk-wr-ic">{n.link?.startsWith('doc') ? <FileText size={16} aria-hidden /> : <TypeIcon type="task" size={16} />}</span>
                  <span className="wk-wr-txt"><strong>{n.title}</strong><span>{n.body ? `${n.body} · ` : ''}{ago(n.createdAt)}</span></span>
                  <span className="wk-wr-act">{/shared/i.test(n.title) ? 'Open' : 'Reply'}</span>
                </button></li>
              ))}
            </ul>
          </section>

          {sprint && share && share.n > 0 && (
            <section className="wk-md-panel" aria-labelledby="md-sprint">
              <h3 id="md-sprint" className="wk-md-ph">{self ? 'Your' : `${first}'s`} part of {sprint.name}</h3>
              <div className="wk-md-big">
                <strong>{share.pts ? share.ptsDone : share.done}</strong>
                <span>of {self ? 'your' : 'their'} {share.pts ? `${share.pts} points` : `${share.n} issues`} done{daysLeft != null && daysLeft >= 0 ? ` · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : ''}</span>
              </div>
              <div className="wk-bar" role="img" aria-label={`${Math.round(100 * (share.pts ? share.ptsDone / share.pts : share.done / share.n))}% done`}>
                <span style={{ width: `${100 * (share.pts ? share.ptsDone / share.pts : share.done / share.n)}%` }} />
              </div>
            </section>
          )}

          <section className="wk-md-panel" aria-labelledby="md-docs">
            <h3 id="md-docs" className="wk-md-ph">Recent documents</h3>
            {docs === null ? <p className="crm-sub wk-md-empty">Loading…</p> : docs.length === 0 ? <p className="crm-sub wk-md-empty">No documents yet.</p> : (
              <ul className="wk-wl">{docs.map((d) => (
                <li key={d.id}><button type="button" className="wk-wr is-doc" onClick={() => openDoc(d.id)}>
                  <span className="wk-wr-ic"><FileText size={16} aria-hidden /></span>
                  <span className="wk-wr-txt"><strong>{d.title || 'Untitled'}</strong><span>Changed {ago(d.updatedAt)}</span></span>
                </button></li>
              ))}</ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

