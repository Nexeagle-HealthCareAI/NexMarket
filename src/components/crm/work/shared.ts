/** Types and helpers for the team board. */

export type Status = 'idea' | 'todo' | 'doing' | 'review' | 'done';
export type Priority = 'urgent' | 'high' | 'normal' | 'low';
export type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly';
export interface CheckItem { id: string; text: string; done: boolean }
export interface Card {
  id: string; number: number; title: string; description?: string | null; status: Status; order: number; priority: Priority;
  dueDate?: string | null; assignees: string[]; labels: string[]; project?: string | null; checklist: CheckItem[]; checkDone: number; checkTotal: number;
  link?: string | null; repeat: Repeat; comments: number; archived: boolean; createdBy: string; createdAt: string; updatedAt: string;
  startedAt?: string | null; doneAt?: string | null; doneBy?: string | null; overdue: boolean;
}
export interface Person { agentId: string; name: string; role: string; photo?: string | null }
export interface BoardRes {
  me: string; isAdmin: boolean;
  columns: { key: Status; label: string }[];
  cards: Card[]; people: Person[]; labels: string[];
  projects: { name: string; open: number; done: number }[];
  stats: { open: number; doing: number; overdue: number; dueToday: number; doneThisWeek: number; load: { agentId: string; open: number; overdue: number; doing: number }[] };
}

export const COLUMN_HINT: Record<Status, string> = {
  idea: 'Thoughts to plan later', todo: 'Planned, not started', doing: 'Being worked on now', review: 'Done, needs a check', done: 'Finished',
};
export const COLUMN_COLOR: Record<Status, string> = { idea: '#7b3fe4', todo: '#5a6478', doing: '#0a72d6', review: '#d9822b', done: '#0f8a5f' };
export const PRIORITY: Record<Priority, { label: string; color: string }> = {
  urgent: { label: 'Urgent', color: '#b42318' }, high: { label: 'High', color: '#d9822b' }, normal: { label: 'Normal', color: '#8a93a6' }, low: { label: 'Low', color: '#c3c9d4' },
};
export const REPEAT_LABEL: Record<Repeat, string> = { none: 'Does not repeat', daily: 'Every day', weekdays: 'Every working day (Mon–Sat)', weekly: 'Every week', monthly: 'Every month' };

/** Today in India, yyyy-MM-dd. */
export const istToday = (add = 0) => new Date(Date.now() + 5.5 * 3600e3 + add * 864e5).toISOString().slice(0, 10);

export function dueLabel(d: string): string {
  const t = istToday();
  if (d === t) return 'Today';
  if (d === istToday(1)) return 'Tomorrow';
  if (d === istToday(-1)) return 'Yesterday';
  const dt = new Date(`${d}T00:00:00Z`);
  const days = Math.round((dt.getTime() - new Date(`${t}T00:00:00Z`).getTime()) / 864e5);
  if (days > 1 && days < 7) return dt.toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' });
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]!.toUpperCase()).join('') || '?';
const AV = ['#0a72d6', '#0f8a5f', '#d9822b', '#7b3fe4', '#c2185b', '#0e7490', '#6d4c41', '#558b2f'];
export const avatarColor = (id: string) => AV[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length];
const LB = ['#e6f2fd|#0a4e94', '#e7f6ef|#0b6b4a', '#fff4e0|#8a5100', '#f3ecfd|#5b21b6', '#fdecf3|#9d174d', '#e6f6fa|#0e6178', '#f1f2f5|#4a5263'];
export const labelColors = (l: string) => { const [bg, fg] = LB[[...l].reduce((a, c) => a + c.charCodeAt(0), 0) % LB.length].split('|'); return { bg, fg }; };

const WEEK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export interface Quick { title: string; assignees: string[]; labels: string[]; priority: Priority | null; dueDate: string | null; status: Status | null; unknown: string[] }

/**
 * Quick add: one line becomes a card.
 *   "Print camp banners @rahul #camp !high fri"  →  title, Rahul, label camp, high priority, due Friday
 * Dates: today, tomorrow, mon…sun (the next one), 12/11, 12 nov. Columns: /idea /doing /check.
 */
export function parseQuick(text: string, people: Person[]): Quick {
  const out: Quick = { title: '', assignees: [], labels: [], priority: null, dueDate: null, status: null, unknown: [] };
  const words: string[] = [];
  const toks = text.trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i];
    const lw = w.toLowerCase();
    if (w.startsWith('@') && w.length > 1) {
      const n = lw.slice(1);
      const p = people.find((x) => x.agentId.toLowerCase() === n) ?? people.find((x) => x.name.toLowerCase().split(/\s+/)[0] === n) ?? people.find((x) => x.name.toLowerCase().startsWith(n));
      if (p) { if (!out.assignees.includes(p.agentId)) out.assignees.push(p.agentId); } else out.unknown.push(w);
      continue;
    }
    if (w.startsWith('#') && w.length > 1) { out.labels.push(lw.slice(1)); continue; }
    if (lw === '!urgent' || lw === '!!!') { out.priority = 'urgent'; continue; }
    if (lw === '!high' || lw === '!!') { out.priority = 'high'; continue; }
    if (lw === '!low') { out.priority = 'low'; continue; }
    if (lw === '/idea') { out.status = 'idea'; continue; }
    if (lw === '/doing') { out.status = 'doing'; continue; }
    if (lw === '/check' || lw === '/review') { out.status = 'review'; continue; }
    if (lw === 'today' || lw === 'aaj') { out.dueDate = istToday(); continue; }
    if (lw === 'tomorrow' || lw === 'kal') { out.dueDate = istToday(1); continue; }
    const wd = WEEK.findIndex((d) => lw === d || lw === d + 'day' || (lw.length >= 3 && d.startsWith(lw.slice(0, 3)) && /^(sun|mon|tue|wed|thu|fri|sat)[a-z]*$/.test(lw)));
    if (wd >= 0 && /^(sun|mon|tue|wed|thu|fri|sat)/.test(lw)) {
      const todayW = new Date(`${istToday()}T00:00:00Z`).getUTCDay();
      out.dueDate = istToday(((wd - todayW + 7) % 7) || 7);
      continue;
    }
    const dm = /^(\d{1,2})[/.-](\d{1,2})$/.exec(w);
    if (dm) { out.dueDate = dateOf(Number(dm[1]), Number(dm[2]) - 1); continue; }
    if (/^\d{1,2}$/.test(w) && toks[i + 1] && MONTHS.includes(toks[i + 1].toLowerCase().slice(0, 3))) {
      out.dueDate = dateOf(Number(w), MONTHS.indexOf(toks[i + 1].toLowerCase().slice(0, 3)));
      i++;
      continue;
    }
    words.push(w);
  }
  out.title = words.join(' ');
  return out;
}

/** The next date with that day and month (this year, or next year if it has passed). */
function dateOf(day: number, month: number): string | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const t = istToday();
  const y = Number(t.slice(0, 4));
  let d = new Date(Date.UTC(y, month, day)).toISOString().slice(0, 10);
  if (d < t) d = new Date(Date.UTC(y + 1, month, day)).toISOString().slice(0, 10);
  return d;
}
