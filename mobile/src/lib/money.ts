import { File, Directory, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { accessToken, api, get } from './api';
import { API_URL } from './config';
import type { Photo } from './photo';
import { kvSet, notifyChange } from './db';
import { dayShort } from './format';
import type { Lang, TFn } from '../i18n';

/** A payment the hospital owes one of my partners, for a service (travel with a patient, camp support…). */
export interface PartnerPayout {
  id: string; contactClientId: string; partner: string; referralClientId?: string | null; patient?: string | null;
  purpose: string; amount: number; status: 'pending_approval' | 'approved' | 'paid'; createdAt: string; approvedAt?: string | null; paidAt?: string | null; reference?: string | null;
  method?: string | null; methodLabel?: string; hasProof?: boolean; proofKind?: string | null; proofAt?: string | null; proofIsPdf?: boolean;
  /** This agent was asked to hand it over in cash. */
  cashByMe?: boolean; receivedAt?: string | null;
}
/** What I (the agent) earn for a patient I referred. */
export interface MyIncentive {
  id: string; referralClientId?: string | null; patient?: string | null; reason: string; amount: number;
  status: 'pending_approval' | 'approved' | 'paid'; createdAt: string; approvedAt?: string | null; paidAt?: string | null; reference?: string | null;
}
export interface MyMoney {
  summary: { partnerPaid: number; partnerWaiting: number; partnerOverdue: number; myPaid: number; myWaiting: number; cashToHandOver?: number; cashToHandOverCount?: number; notConfirmed?: number };
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
export function statusLine(s: { status: string; paidAt?: string | null; reference?: string | null; receivedAt?: string | null; cashByMe?: boolean }, t: TFn, lang: Lang): { label: string; tone: 'ok' | 'warn' | 'info' } {
  if (s.status === 'paid' && s.receivedAt) return { label: t('moneyPaidReceived', { d: s.paidAt ? dayShort(lang, new Date(s.paidAt)) : '' }), tone: 'ok' };
  if (s.status === 'approved' && s.cashByMe) return { label: t('moneyCashWithYou'), tone: 'warn' };
  if (s.status === 'paid') return { label: `${t('moneyPaidOn', { d: s.paidAt ? dayShort(lang, new Date(s.paidAt)) : '' })}${s.reference ? ` · ${s.reference}` : ''}`, tone: 'ok' };
  if (s.status === 'approved') return { label: t('moneyApproved'), tone: 'warn' };
  return { label: t('moneyPending'), tone: 'info' };
}

/** The proof picture, loaded with the agent's sign-in. */
export const proofSource = (id: string) => ({ uri: `${API_URL}/api/v1/me/money/payments/${id}/proof`, headers: { Authorization: `Bearer ${accessToken() ?? ''}` } });

/** A PDF receipt: download it and offer "Open with". */
export async function openProofPdf(id: string): Promise<void> {
  const dir = new Directory(Paths.cache, 'proofs');
  dir.create({ idempotent: true, intermediates: true });
  const dest = new File(dir, `payment-${id}.pdf`);
  if (!dest.exists) await File.downloadFileAsync(`${API_URL}/api/v1/me/money/payments/${id}/proof`, dest, { headers: { Authorization: `Bearer ${accessToken() ?? ''}` }, idempotent: true });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(dest.uri, { mimeType: 'application/pdf' });
}

/** Cash handed over: the photo with the person (time and place from the camera) becomes the proof. Needs internet. */
export async function recordCashHandover(id: string, photo: Photo): Promise<void> {
  const form = new FormData();
  form.append('file', { uri: photo.uri, name: `cash-${id}.jpg`, type: 'image/jpeg' } as unknown as Blob);
  form.append('takenAt', photo.takenAt);
  if (photo.lat != null && photo.lng != null) { form.append('lat', String(photo.lat)); form.append('lng', String(photo.lng)); }
  await api(`/api/v1/me/money/payments/${id}/cash`, { method: 'POST', body: form, timeoutMs: 120000 });
  await refreshMoney().catch(() => undefined);
}

/** The partner told the agent they got the money. */
export async function confirmReceived(id: string): Promise<void> {
  await api(`/api/v1/me/money/payments/${id}/received`, { method: 'POST', body: JSON.stringify({}) });
  await refreshMoney().catch(() => undefined);
}
