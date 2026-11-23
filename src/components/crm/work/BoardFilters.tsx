'use client';

import { useEffect, useRef, useState } from 'react';
import { Bookmark, Trash2, X } from 'lucide-react';
import { TypeIcon } from './Issues';
import { ISSUE_TYPES, PRIORITY, TYPE_META, type BoardRes, type Card, type IssueType, type Priority } from './shared';

export type Due = '' | 'late' | 'today' | 'week' | 'none';

/** Everything the board, list and their toolbar filter by. */
export interface Filters {
  q: string;
  /** '' everyone · '-' nobody yet · an agent id */
  person: string;
  types: IssueType[];
  labels: string[];
  priorities: Priority[];
  due: Due;
  /** '' all · 'active' the running sprint · 'backlog' · a sprint id */
  sprint: string;
  /** '' any · an epic's id */
  epic: string;
  project: string;
}
export const NO_FILTERS: Filters = { q: '', person: '', types: [], labels: [], priorities: [], due: '', sprint: '', epic: '', project: '' };

const DUE_LABEL: Record<Exclude<Due, ''>, string> = { late: 'Late', today: 'Due today', week: 'Due in 7 days', none: 'No date' };
const PRI_KEYS: Priority[] = ['urgent', 'high', 'normal', 'low'];

/** The epic a card sits under (itself for an epic), walking up at most a few levels. */
export function epicOf(c: Card, all: Map<string, Card>): string | null {
  let x: Card | undefined = c;
  for (let i = 0; x && i < 5; i++) {
    if (x.type === 'epic') return x.id;
    x = x.parentId ? all.get(x.parentId) : undefined;
  }
  return null;
}

/** Does a card pass the filters? `showEpics` keeps epics in when no type is picked (the list shows them, the board doesn't). */
export function passes(c: Card, f: Filters, opts: { showEpics: boolean; subs: boolean; activeSprint?: string; all: Map<string, Card> }) {
  const s = f.q.trim().toLowerCase();
  const t = isoToday(), w = isoToday(7);
  if (f.person && (f.person === '-' ? c.assignees.length > 0 : !c.assignees.includes(f.person))) return false;
  if (f.types.length ? !f.types.includes(c.type ?? 'task') : !opts.showEpics && c.type === 'epic') return false;
  if (!opts.subs && c.type === 'subtask' && !f.types.includes('subtask')) return false;
  if (f.sprint && (f.sprint === 'backlog' ? !!c.sprintId : f.sprint === 'active' ? !opts.activeSprint || c.sprintId !== opts.activeSprint : c.sprintId !== f.sprint)) return false;
  if (f.labels.length && !f.labels.some((l) => c.labels.includes(l))) return false;
  if (f.priorities.length && !f.priorities.includes(c.priority)) return false;
  if (f.project && c.project !== f.project) return false;
  if (f.epic && epicOf(c, opts.all) !== f.epic) return false;
  if (s && !(c.title.toLowerCase().includes(s) || `#${c.number}` === s || (c.description ?? '').toLowerCase().includes(s))) return false;
  if (f.due === 'late' && !c.overdue) return false;
  if (f.due === 'today' && c.dueDate !== t) return false;
  if (f.due === 'week' && !(c.dueDate && c.dueDate <= w && c.status !== 'done')) return false;
  if (f.due === 'none' && c.dueDate) return false;
  return true;
}
const isoToday = (add = 0) => new Date(Date.now() + 5.5 * 3600e3 + add * 864e5).toISOString().slice(0, 10);

/** How many filters sit behind the Filters button (search, people and the Late / This week chips show on their own). */
export function panelCount(f: Filters) {
  return (f.types.length ? 1 : 0) + (f.labels.length ? 1 : 0) + (f.priorities.length ? 1 : 0) + (f.sprint ? 1 : 0) + (f.epic ? 1 : 0)
    + (f.project ? 1 : 0) + (f.due === 'today' || f.due === 'none' ? 1 : 0) + (f.person === '-' ? 1 : 0);
}

/** The filters that are on, as removable tags under the toolbar. */
export function filterTags(f: Filters, board: BoardRes): { key: string; text: string; clear: Partial<Filters> }[] {
  const out: { key: string; text: string; clear: Partial<Filters> }[] = [];
  const name = (a: string) => board.people.find((p) => p.agentId === a)?.name ?? a;
  if (f.person) out.push({ key: 'person', text: f.person === '-' ? 'Nobody on it yet' : f.person === board.me ? 'Only mine' : `Person: ${name(f.person)}`, clear: { person: '' } });
  if (f.types.length) out.push({ key: 'types', text: `Type: ${f.types.map((t) => TYPE_META[t].label).join(', ')}`, clear: { types: [] } });
  if (f.labels.length) out.push({ key: 'labels', text: `Label: ${f.labels.map((l) => `#${l}`).join(', ')}`, clear: { labels: [] } });
  if (f.priorities.length) out.push({ key: 'pri', text: `Priority: ${f.priorities.map((p) => PRIORITY[p].label).join(', ')}`, clear: { priorities: [] } });
  if (f.due) out.push({ key: 'due', text: DUE_LABEL[f.due], clear: { due: '' } });
  if (f.sprint) {
    const s = board.sprints?.find((x) => x.id === f.sprint);
    out.push({ key: 'sprint', text: f.sprint === 'active' ? 'Running sprint' : f.sprint === 'backlog' ? 'Backlog only' : `Sprint: ${s?.name ?? 'closed sprint'}`, clear: { sprint: '' } });
  }
  if (f.epic) out.push({ key: 'epic', text: `Epic: ${board.cards.find((c) => c.id === f.epic)?.title ?? '…'}`, clear: { epic: '' } });
  if (f.project) out.push({ key: 'project', text: `Project: ${f.project}`, clear: { project: '' } });
  return out;
}

interface Saved { name: string; f: Filters }
const SAVED_KEY = 'wk-saved-filters';
function readSaved(me: string): Saved[] {
  try { const v = JSON.parse(localStorage.getItem(`${SAVED_KEY}:${me}`) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function writeSaved(me: string, list: Saved[]) {
  try { localStorage.setItem(`${SAVED_KEY}:${me}`, JSON.stringify(list)); } catch { /* private window: saved filters just don't stick */ }
}

const plural = (w: string) => (w.endsWith('y') ? `${w.slice(0, -1)}ies` : `${w}s`);

function toggle<T>(list: T[], v: T) { return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]; }

/**
 * The Filters panel: type, due date, label, priority, sprint, epic, project and who; saved filters at the top
 * (kept in this browser, per person). Changes apply straight away; the button shows how many issues match.
 */
export function FilterPanel({ board, f, set, matches, subs, setSubs, archived, setArchived, onClose }: {
  board: BoardRes; f: Filters; set: (f: Filters) => void; matches: number;
  subs: boolean; setSubs: (v: boolean) => void; archived: boolean; setArchived: (v: boolean) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState<Saved[]>(() => readSaved(board.me));
  const [naming, setNaming] = useState<string | null>(null);
  const epics = board.cards.filter((c) => c.type === 'epic' && !c.archived);
  const upd = (p: Partial<Filters>) => set({ ...f, ...p });

  useEffect(() => {
    const box = ref.current;
    box?.querySelector<HTMLElement>('button, input, select')?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const out = (e: MouseEvent) => { const t = e.target as HTMLElement; if (box && !box.contains(t) && !t.closest('[data-filters-btn]')) onClose(); };
    document.addEventListener('keydown', k);
    document.addEventListener('mousedown', out);
    return () => { document.removeEventListener('keydown', k); document.removeEventListener('mousedown', out); };
    // Opened once; onClose only closes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = () => {
    const name = naming?.trim();
    if (!name) return;
    const list = [...saved.filter((s) => s.name !== name), { name, f: { ...f, q: '' } }].slice(-12);
    setSaved(list); writeSaved(board.me, list); setNaming(null);
  };
  const remove = (name: string) => { const list = saved.filter((s) => s.name !== name); setSaved(list); writeSaved(board.me, list); };

  return (
    <>
      <div className="wk-fp-scrim" aria-hidden onClick={onClose} />
      <div className="wk-fp" role="dialog" aria-label="Filters" ref={ref}>
        <div className="wk-fp-h">
          <h2>Filters</h2>
          <span className="crm-sub">{panelCount(f) ? `${panelCount(f)} on` : 'none on'}</span>
          <button type="button" className="wk-fp-x" aria-label="Close filters" onClick={onClose}><X size={18} aria-hidden /></button>
        </div>
        {saved.length > 0 && (
          <div className="wk-fp-saved">
            <span className="crm-sub">Saved filters</span>
            <div>{saved.map((s) => (
              <span key={s.name} className="wk-fp-sv">
                <button type="button" onClick={() => set({ ...s.f, q: f.q })}><Bookmark size={13} aria-hidden /> {s.name}</button>
                <button type="button" aria-label={`Forget saved filter ${s.name}`} title="Forget" onClick={() => remove(s.name)}><Trash2 size={12} aria-hidden /></button>
              </span>
            ))}</div>
          </div>
        )}
        <div className="wk-fp-body">
          <fieldset>
            <legend>Type</legend>
            <div className="wk-fp-checks">
              {ISSUE_TYPES.map((t) => (
                <label key={t} className="wk-fp-opt"><input type="checkbox" checked={f.types.includes(t)} onChange={() => upd({ types: toggle(f.types, t) })} />
                  <TypeIcon type={t} size={16} />{plural(TYPE_META[t].label)}</label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Due</legend>
            <div className="wk-fp-segs">
              {(['', 'late', 'today', 'week', 'none'] as Due[]).map((d) => (
                <button key={d || 'any'} type="button" className="crm-chip" aria-pressed={f.due === d} onClick={() => upd({ due: d })}>{d ? DUE_LABEL[d] : 'Any time'}</button>
              ))}
            </div>
          </fieldset>
          {board.labels.length > 0 && (
            <fieldset>
              <legend>Label</legend>
              <div className="wk-fp-segs">
                {board.labels.map((l) => <button key={l} type="button" className="crm-chip" aria-pressed={f.labels.includes(l)} onClick={() => upd({ labels: toggle(f.labels, l) })}>#{l}</button>)}
              </div>
            </fieldset>
          )}
          <fieldset>
            <legend>Priority</legend>
            <div className="wk-fp-segs">
              {PRI_KEYS.map((p) => <button key={p} type="button" className="crm-chip" aria-pressed={f.priorities.includes(p)} onClick={() => upd({ priorities: toggle(f.priorities, p) })}>{PRIORITY[p].label}</button>)}
            </div>
          </fieldset>
          <fieldset>
            <legend>Belongs to</legend>
            {(board.sprints?.length ?? 0) > 0 && (
              <label className="crm-field"><span>Sprint</span>
                <select className="crm-input" value={f.sprint} onChange={(e) => upd({ sprint: e.target.value })}>
                  <option value="">All sprints</option>
                  {board.sprints!.some((x) => x.status === 'active') && <option value="active">Running sprint</option>}
                  {board.sprints!.filter((x) => x.status !== 'active').map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  <option value="backlog">Backlog only (no sprint)</option>
                </select></label>
            )}
            {epics.length > 0 && (
              <label className="crm-field"><span>Epic</span>
                <select className="crm-input" value={f.epic} onChange={(e) => upd({ epic: e.target.value })}>
                  <option value="">Any epic</option>{epics.map((e) => <option key={e.id} value={e.id}>#{e.number} {e.title}</option>)}
                </select></label>
            )}
            {board.projects.length > 0 && (
              <label className="crm-field"><span>Project</span>
                <select className="crm-input" value={f.project} onChange={(e) => upd({ project: e.target.value })}>
                  <option value="">Any project</option>{board.projects.map((p) => <option key={p.name} value={p.name}>{p.name} ({p.open} open)</option>)}
                </select></label>
            )}
            <label className="crm-field"><span>Who</span>
              <select className="crm-input" value={f.person} onChange={(e) => upd({ person: e.target.value })}>
                <option value="">Everyone</option><option value={board.me}>Me</option><option value="-">Nobody on it yet</option>
                {board.people.filter((p) => p.agentId !== board.me).map((p) => <option key={p.agentId} value={p.agentId}>{p.name}</option>)}
              </select></label>
          </fieldset>
          <fieldset>
            <legend>Also show</legend>
            <label className="wk-fp-opt"><input type="checkbox" checked={subs} onChange={(e) => setSubs(e.target.checked)} /> Sub-tasks as their own cards</label>
            <label className="wk-fp-opt"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archived cards</label>
          </fieldset>
        </div>
        <div className="wk-fp-foot">
          {naming !== null ? (
            <form className="wk-fp-name" onSubmit={(e) => { e.preventDefault(); save(); }}>
              <label className="crm-sr" htmlFor="wk-fp-name">Name for these filters</label>
              <input id="wk-fp-name" className="crm-input" autoFocus value={naming} maxLength={40} placeholder="e.g. My bugs" onChange={(e) => setNaming(e.target.value)} />
              <button type="submit" className="crm-btn is-sm" disabled={!naming.trim()}>Save</button>
              <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setNaming(null)}>Cancel</button>
            </form>
          ) : <>
            <button type="button" className="wa-link" onClick={() => set({ ...NO_FILTERS, q: f.q })}>Clear all</button>
            <button type="button" className="crm-btn is-secondary is-sm" style={{ marginLeft: 'auto' }} disabled={!panelCount(f) && !f.due && !f.person} onClick={() => setNaming('')}>Save as…</button>
            <button type="button" className="crm-btn is-sm" onClick={onClose}>Show {matches}</button>
          </>}
        </div>
      </div>
    </>
  );
}
