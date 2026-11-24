import { ROLE_LABELS } from '@/lib/crm/access';

export type DayStatus = 'worked' | 'leave' | 'absent' | 'off' | 'today' | 'future';
export type MarkStatus = 'present' | 'half' | 'absent' | 'leave' | 'off';

export interface Day {
  date: string;
  status: DayStatus;
  /** shift (app) | crm | mark (by hand) | leave (approved request) */
  source?: 'shift' | 'crm' | 'mark' | 'leave' | null;
  half: boolean;
  late: boolean;
  inAt?: string | null;
  outAt?: string | null;
  leaveType?: string | null;
  mark?: MarkStatus | null;
  note?: string | null;
  markedBy?: string | null;
  /** What the app or the CRM recorded under a hand-set mark. */
  auto?: 'shift' | 'crm' | null;
  holiday?: string | null;
}

export interface Totals { present: number; half: number; leave: number; absent: number; late: number; off: number }

export interface Person {
  agentId: string;
  name: string;
  role: string;
  group: 'field' | 'office';
  block?: string | null;
  district?: string | null;
  photoUrl?: string | null;
  online: boolean;
  lastSeenAt?: string | null;
  onShift: boolean;
  today: Day;
  days: Day[];
  totals: Totals;
  leaveBalance: { used: number; pending: number; remaining: number };
}

export interface Config {
  workStart: string;
  graceMinutes: number;
  weeklyOff: number[];
  yearlyAllowance: number;
  officeFromCrm: boolean;
  holidays: { date: string; name: string }[];
  saved: boolean;
}

export interface Board {
  month: string;
  today: string;
  canMark: boolean;
  config: Config;
  workingDaysSoFar: number;
  holidays: { date: string; name: string }[];
  kpis: { total: number; field: number; office: number; present: number; notIn: number; onLeave: number; absent: number; late: number; off: number; pendingLeave: number; workingToday: boolean };
  people: Person[];
}

export const LEAVE_TYPES: { key: string; label: string }[] = [
  { key: 'casual', label: 'Casual' },
  { key: 'sick', label: 'Sick' },
  { key: 'urgent', label: 'Urgent' },
  { key: 'holiday', label: 'Holiday' },
  { key: 'unpaid', label: 'Unpaid' },
];
export const leaveLabel = (t?: string | null) => LEAVE_TYPES.find((l) => l.key === t)?.label ?? (t ? t[0].toUpperCase() + t.slice(1) : 'Leave');

export const MARKS: { key: MarkStatus; label: string; short: string }[] = [
  { key: 'present', label: 'Present', short: 'P' },
  { key: 'half', label: 'Half day', short: '½' },
  { key: 'absent', label: 'Absent', short: 'A' },
  { key: 'leave', label: 'Leave', short: 'L' },
  { key: 'off', label: 'Day off', short: 'O' },
];

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The cell's look: a class for the colour and a short code. */
export function cellOf(d: Day): { cls: string; code: string; label: string } {
  switch (d.status) {
    case 'worked': return d.half ? { cls: 'is-half', code: '½', label: 'Half day' } : { cls: 'is-present', code: 'P', label: 'Present' };
    case 'leave': return { cls: 'is-leave', code: 'L', label: `${leaveLabel(d.leaveType)} leave` };
    case 'absent': return { cls: 'is-absent', code: 'A', label: 'Absent' };
    case 'off': return { cls: 'is-off', code: '', label: d.holiday ?? 'Day off' };
    case 'today': return { cls: 'is-notin', code: '', label: 'Not in yet' };
    default: return { cls: 'is-future', code: '', label: 'Upcoming' };
  }
}

const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
export const timeOf = (iso?: string | null) => (iso ? timeFmt.format(new Date(iso)).replace(' ', ' ') : '');

const dayFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const shortFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export const dayLabel = (date: string) => dayFmt.format(new Date(`${date}T00:00:00Z`));
export const shortDate = (date: string) => shortFmt.format(new Date(`${date}T00:00:00Z`));
export const rangeLabel = (from: string, to: string) => (from === to ? dayLabel(from) : `${shortDate(from)} – ${shortDate(to)}`);
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** "In 9:42 am – 6:10 pm · app" and the like. */
export function detailOf(d: Day, onShift = false): string {
  const src = (d.source === 'mark' ? d.auto : d.source) === 'shift' ? 'app' : (d.source === 'mark' ? d.auto : d.source) === 'crm' ? 'CRM' : '';
  if (d.status === 'worked' && d.inAt) {
    const out = d.outAt && !onShift ? ` – ${timeOf(d.outAt)}` : onShift ? ', still on shift' : '';
    return `In ${timeOf(d.inAt)}${out}${src ? ` · ${src}` : ''}`;
  }
  if (d.status === 'leave') return `${leaveLabel(d.leaveType)} leave`;
  if (d.status === 'off') return d.holiday ?? 'Day off';
  if (d.status === 'today') return 'Not in yet';
  return '';
}

export const roleLabel = (role: string, group: 'field' | 'office') =>
  ROLE_LABELS[role] ?? (group === 'office' ? role : role.replace(/[_]/g, ' ').replace(/\b\w/, (c) => c.toUpperCase()));

export function shiftMonth(month: string, by: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export const thisMonth = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 7);
const monthFmt = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const monthLabel = (month: string) => monthFmt.format(new Date(`${month}-01T00:00:00Z`));

export const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''));
