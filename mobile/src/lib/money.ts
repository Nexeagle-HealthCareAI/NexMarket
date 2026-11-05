import { get } from './api';
import { kvSet, notifyChange } from './db';
import { dayShort } from './format';
import type { Lang, TFn } from '../i18n';

/** A payment the hospital owes one of my partners, for a service (travel with a patient, camp support…). */
export interface PartnerPayout {
  id: string; contactClientId: string; partner: string; referralClientId?: string | null; patient?: string | null;
  purpose: string; amount: number; status: 'pending_approval' | 'approved' | 'paid'; createdAt: string; approvedAt?: string | null; paidAt?: string | null; reference?: string | null;
}
/** What I (the agent) earn for a patient I referred. */
export interface MyIncentive {
  id: string; referralClientId?: string | null; patient?: string | null; reason: string; amount: number;
  status: 'pending_approval' | 'approved' | 'paid'; createdAt: string; approvedAt?: string | null; paidAt?: string | null; reference?: string | null;
}
export interface MyMoney {
  summary: { partnerPaid: number; partnerWaiting: number; partnerOverdue: number; myPaid: number; myWaiting: number };
  partnerPayments: PartnerPayout[];
  incentives: MyIncentive[];
  at?: string;
}

const KEY = 'myMoney';

/** Fetched with each sync and kept on the phone, so it can be checked without signal. */
export async function refreshMoney(): Promise<void> {
  const m = await get<MyMoney>('/api/v1/me/money');
  kvSet(KEY, JSON.stringify({ ...m, at: new Date().toISOString() }));
  notifyChange();
}

export const MONEY_KEY = KEY;

export const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** One line for a payment's state: paid (date and reference), approved, or waiting for approval. */
export function statusLine(s: { status: string; paidAt?: string | null; reference?: string | null }, t: TFn, lang: Lang): { label: string; tone: 'ok' | 'warn' | 'info' } {
  if (s.status === 'paid') return { label: `${t('moneyPaidOn', { d: s.paidAt ? dayShort(lang, new Date(s.paidAt)) : '' })}${s.reference ? ` · ${s.reference}` : ''}`, tone: 'ok' };
  if (s.status === 'approved') return { label: t('moneyApproved'), tone: 'warn' };
  return { label: t('moneyPending'), tone: 'info' };
}
