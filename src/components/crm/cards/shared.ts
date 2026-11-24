export interface Plan {
  id: string; name: string; price: number; validMonths: number; maxMembers: number;
  opdDiscountPct: number; ipdDiscountPct: number; labDiscountPct: number; pharmacyDiscountPct: number;
  freeOpdVisits: number; extras?: string | null; color: string; active: boolean; order: number;
}
export interface Member { name: string; age?: number | null; relation?: string | null }
export type CardStatus = 'active' | 'expiring' | 'expired' | 'cancelled';
export interface Card {
  id: string; number: string; planId: string; planName?: string | null; color?: string | null;
  holderName: string; phone?: string | null; age?: number | null; sex?: string | null; village?: string | null; block?: string | null; district?: string | null;
  members: Member[]; issuedOn: string; validTill: string; status: CardStatus; cancelReason?: string | null; renewals: number;
  source: 'camp' | 'agent' | 'desk' | 'other'; campId?: string | null; campTitle?: string | null; campPatientId?: string | null; agentId?: string | null; agentName?: string | null; note?: string | null;
  visits: number; billed: number; discount: number; freeLeft: number; createdByName: string; createdAt: string;
}
export interface Use { id: string; on: string; kind: string; memberName?: string | null; billAmount: number; discount: number; freeVisit: boolean; referralClientId?: string | null; note?: string | null; byName: string }
export interface CardDetail {
  card: Card; plan: Plan | null; uses: Use[];
  payments: { id: string; kind: 'issue' | 'renewal'; amount: number; on: string; mode?: string | null }[];
  referrals: { clientId: string; name: string; department: string; status: string; createdAt: string }[];
}

export const STATUS: Record<CardStatus, { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' }> = {
  active: { label: 'Valid', tone: 'ok' }, expiring: { label: 'Ends soon', tone: 'warn' }, expired: { label: 'Expired', tone: 'bad' }, cancelled: { label: 'Cancelled', tone: 'neutral' },
};
export const SOURCE: Record<string, string> = { camp: 'Health camp', agent: 'Field agent', desk: 'Hospital desk', other: 'Other' };
export const KINDS: { key: string; label: string }[] = [
  { key: 'opd', label: 'OPD' }, { key: 'ipd', label: 'Admission (IPD)' }, { key: 'procedure', label: 'Procedure / surgery' },
  { key: 'lab', label: 'Lab / tests' }, { key: 'pharmacy', label: 'Pharmacy' }, { key: 'other', label: 'Other' },
];
export const kindLabel = (k: string) => KINDS.find((x) => x.key === k)?.label ?? k;
export const MODES: { key: string; label: string }[] = [{ key: 'cash', label: 'Cash' }, { key: 'upi', label: 'UPI' }, { key: 'bank', label: 'Bank' }, { key: 'free', label: 'Free' }];

export const pctOf = (p: Plan, kind: string) =>
  kind === 'opd' ? p.opdDiscountPct : kind === 'ipd' || kind === 'procedure' ? p.ipdDiscountPct : kind === 'lab' ? p.labDiscountPct : kind === 'pharmacy' ? p.pharmacyDiscountPct : 0;

/** "20% off OPD · 10% off admission · 2 free OPD visits" */
export function benefits(p: Plan): string[] {
  const l: string[] = [];
  if (p.freeOpdVisits) l.push(`${p.freeOpdVisits} free OPD visit${p.freeOpdVisits === 1 ? '' : 's'}`);
  if (p.opdDiscountPct) l.push(`${p.opdDiscountPct}% off OPD`);
  if (p.ipdDiscountPct) l.push(`${p.ipdDiscountPct}% off admission and procedures`);
  if (p.labDiscountPct) l.push(`${p.labDiscountPct}% off lab tests`);
  if (p.pharmacyDiscountPct) l.push(`${p.pharmacyDiscountPct}% off pharmacy`);
  (p.extras ?? '').split('\n').map((x) => x.trim()).filter(Boolean).forEach((x) => l.push(x));
  return l;
}

export const dateText = (d: string, year = true) => new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', year ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
export const todayIso = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
export const covers = (p: Plan) => (p.maxMembers === 1 ? 'One person' : `Up to ${p.maxMembers} people`);
export const validity = (m: number) => (m % 12 === 0 ? `${m / 12} year${m === 12 ? '' : 's'}` : `${m} month${m === 1 ? '' : 's'}`);
