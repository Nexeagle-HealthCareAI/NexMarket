import { friendlyError } from '@/components/crm/ui';

export interface Balance { given: number; returned: number; spent: number; pending: number; net: number; holds: number; owed: number; received?: number; handedOut?: number; handedBack?: number }
export interface Expense {
  id: string; spentOn: string; category: string; amount: number; note?: string | null; paidBy: 'office' | 'person';
  agentId?: string | null; agentName?: string | null; status: 'pending' | 'approved' | 'rejected'; rejectReason?: string | null;
  hasBill: boolean; fromApp?: boolean; createdByName: string; createdAt: string;
  forAgentId?: string | null; forAgentName?: string | null; salaryMonth?: string | null; payMode?: string | null;
  projectId?: string | null; recurringId?: string | null; period?: string | null;
}
export interface Move {
  id: string; agentId: string; agentName: string; kind: 'given' | 'returned'; amount: number; on: string; mode?: string | null; note?: string | null; createdByName: string;
  fromAgentId?: string | null; fromAgentName?: string | null; projectId?: string | null;
}
export interface Fund {
  id: string; projectId?: string | null; amount: number; on: string; source: string; mode?: string | null; note?: string | null;
  receivedBy?: string | null; receivedByName?: string | null; createdByName: string; createdAt?: string;
}
export interface Person { agentId: string; name: string; role?: string | null; manager?: boolean; balance: Balance }
export interface Staff { agentId: string; name: string; role: string; block?: string | null }
export type Nature = 'constant' | 'variable';
export interface Kind { key: string; label: string; nature: Nature; color: string; archived: boolean; agentCanUse: boolean }
export interface ProjectLite { id: string; name: string; status: 'active' | 'closed'; color: string }
export interface Note { tone: 'bad' | 'warn' | 'info' | 'ok'; title: string; body: string; go?: string | null }
export interface ByProject {
  projectId?: string | null; name: string; color: string; status?: string | null; total: number; constant: number; variable: number;
  budget?: number | null; spentAllTime?: number | null; receivedAllTime?: number | null; left?: number | null; usedPct?: number | null;
}
export interface Commitments {
  month: string; salaryDue: number; salaryPaid: number; salaryLeft: number; salaryLeftEarlier: number;
  constantDue: number; constantPaid: number; constantLeft: number; overdueCount: number; overdueSum: number;
  upcoming: { id: string; title: string; period: string; dueOn: string; left: number; late: boolean }[];
}
export interface Data {
  from: string; to: string; today: string; me: { agentId: string; canHandle: boolean; isManager: boolean; canSetup: boolean };
  categories: Kind[]; modes: string[];
  total: number; prevTotal: number; prevFrom: string; prevTo: string; constant: number; variable: number; fundsIn: number; funds: Fund[];
  byCategory: Record<string, number>; days: { date: string; total: number; constant: number; variable: number; byCategory: Record<string, number> }[];
  byPerson: { agentId: string; name: string; total: number; byCategory: Record<string, number> }[];
  byProject: ByProject[]; commitments: Commitments; notes: Note[]; projects: ProjectLite[];
  items: Expense[]; waiting: Expense[]; people: Person[]; held: number; heldByManagers: number; owed: number; staff: Staff[]; managers: string[];
}

const whole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const paise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Rupees, with paise only when there are any. */
export const rs = (n?: number | null) => { const v = Math.round((n ?? 0) * 100) / 100; return Number.isInteger(v) ? whole.format(v) : paise.format(v); };
/** Short rupees for tight places: ₹12.5k, ₹1.2L. */
export const rsShort = (n: number) => (Math.abs(n) >= 1e5 ? `₹${(n / 1e5).toFixed(n >= 1e6 ? 0 : 1)}L` : Math.abs(n) >= 1e3 ? `₹${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : rs(n));
export const dayText = (d: string, long = false) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', long ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
export const monthText = (m?: string | null, short = false) => (m ? new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', short ? { month: 'short', year: 'numeric' } : { month: 'long', year: 'numeric' }) : '');
export const MODE: Record<string, string> = { cash: 'Cash', upi: 'UPI', bank: 'Bank transfer' };
export type PayStatus = 'none' | 'unpaid' | 'part' | 'full' | 'over';
export const PAY: Record<PayStatus, { label: string; tone: 'neutral' | 'bad' | 'warn' | 'ok' | 'info' }> = {
  none: { label: 'Nothing due', tone: 'neutral' }, unpaid: { label: 'Not paid', tone: 'bad' }, part: { label: 'Partly paid', tone: 'warn' },
  full: { label: 'Fully paid', tone: 'ok' }, over: { label: 'Paid extra', tone: 'info' },
};
export const NATURE: Record<Nature, { label: string; color: string; hint: string }> = {
  constant: { label: 'Constant', color: '#0a72d6', hint: 'Fixed, regular costs: salaries, rent, subscriptions.' },
  variable: { label: 'Variable', color: '#c2610f', hint: 'Costs that change with the work: food, petrol, banners, ads.' },
};
export const PALETTE = ['#0a72d6', '#0e7490', '#d9822b', '#7b3fe4', '#b45309', '#0f8a5f', '#c2185b', '#6b7280', '#a16207', '#4338ca', '#be123c', '#15803d'];
export const EVERY: Record<string, string> = { month: 'Every month', quarter: 'Every 3 months', year: 'Every year' };

/** The server's own message for a refused request, else a friendly one. */
export const errText = (e: unknown) => {
  const m = e instanceof Error ? e.message : '';
  const i = m.indexOf(': {');
  if (i >= 0) { try { return (JSON.parse(m.slice(i + 2)) as { message?: string }).message ?? friendlyError(e); } catch { /* fall through */ } }
  return friendlyError(e);
};

export const thisMonthOf = (today: string) => today.slice(0, 7);
/** A positive amount typed by a person, or null. */
export const money = (s: string) => { const n = Number(s); return s.trim() && Number.isFinite(n) && n > 0 ? n : null; };
