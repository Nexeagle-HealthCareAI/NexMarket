import { api, accessToken, get, post, OfflineError } from './api';
import { API_URL } from './config';
import { kvJson, kvSet, notifyChange } from './db';
import { nowIso, uuid } from './util';
import type { StringKey } from '../i18n';

/**
 * My work expenses (food, petrol, a banner, room rent…) and my balance with the office. An expense is kept on the phone
 * and sent when there is signal; it counts once the office approves it. The office can give money in advance: then
 * what I spend comes off what I hold. If I spend my own money, the office owes it to me until it is settled.
 */
export const SPEND_KINDS = ['food', 'petrol', 'stay', 'banner', 'digital', 'rent', 'other'] as const;
export const SPEND_KEY: Record<string, StringKey> = { food: 'exCatFood', petrol: 'exCatPetrol', stay: 'exCatStay', banner: 'exCatBanner', digital: 'exCatDigital', rent: 'exCatRent', other: 'exCatOther', agents: 'exCatOther' };

export interface SpendBalance { given: number; returned: number; spent: number; pending: number; net: number; holds: number; owed: number }
export interface MyExpense {
  id: string; spentOn: string; category: string; amount: number; note?: string | null;
  status: 'pending' | 'approved' | 'rejected'; rejectReason?: string | null; hasBill: boolean; createdAt: string;
  projectId?: string | null;
}
/** An open Marketing spend project an expense can be put in (the office closes it when the work is over). */
export interface SpendProjectLite { id: string; name: string; color?: string | null }
export interface MoneyMove { id: string; kind: 'given' | 'returned'; amount: number; on: string; mode?: string | null; note?: string | null }
export interface MySpend {
  today: string; daysBack: number; balance: SpendBalance; items: MyExpense[]; moves: MoneyMove[];
  projects?: SpendProjectLite[]; projectNames?: Record<string, string>;
}

/** An expense added on the phone that the server doesn't have yet (or whose bill photo is still to go). */
export interface ExpenseDraft {
  clientId: string; spentOn: string; category: string; amount: number; note: string; photoUri: string | null;
  createdAt: string; serverId?: string | null; error?: string | null; projectId?: string | null;
}

const K_CACHE = 'spend.cache';
const K_QUEUE = 'spend.queue';

export const mySpend = (): MySpend | null => kvJson<MySpend | null>(K_CACHE, null);
export const expenseDrafts = (): ExpenseDraft[] => kvJson<ExpenseDraft[]>(K_QUEUE, []);
const saveDrafts = (d: ExpenseDraft[]) => { kvSet(K_QUEUE, d.length ? JSON.stringify(d) : null); notifyChange(); };

export async function refreshSpend(): Promise<void> {
  const r = await get<MySpend>('/api/v1/me/spend');
  kvSet(K_CACHE, JSON.stringify(r));
  notifyChange();
}

/** Keeps the expense on the phone and tries to send it. Returns true when it reached the office now. */
export async function addExpense(d: Omit<ExpenseDraft, 'clientId' | 'createdAt' | 'serverId' | 'error'>): Promise<boolean> {
  const clientId = uuid();
  saveDrafts([{ ...d, clientId, createdAt: nowIso() }, ...expenseDrafts()]);
  await flushSpend();
  return !expenseDrafts().some((x) => x.clientId === clientId);
}

let flushing: Promise<void> | null = null;
/** Sends the expenses waiting on the phone, then their bill photos. Safe to call often; never throws. */
export function flushSpend(): Promise<void> {
  flushing ??= (async () => {
    let sent = false;
    for (const d of expenseDrafts()) {
      const set = (patch: Partial<ExpenseDraft> | null) =>
        saveDrafts(patch === null ? expenseDrafts().filter((x) => x.clientId !== d.clientId) : expenseDrafts().map((x) => (x.clientId === d.clientId ? { ...x, ...patch } : x)));
      try {
        let id = d.serverId ?? null;
        if (!id) {
          const e = await post<MyExpense>('/api/v1/me/spend', { clientId: d.clientId, spentOn: d.spentOn, category: d.category, amount: d.amount, note: d.note, projectId: d.projectId ?? null }, 30000);
          id = e.id;
          set({ serverId: id, error: null });
        }
        if (d.photoUri) {
          const form = new FormData();
          form.append('file', { uri: d.photoUri, name: `bill-${id}.jpg`, type: 'image/jpeg' } as unknown as Blob);
          await api<MyExpense>(`/api/v1/me/spend/${id}/bill`, { method: 'POST', body: form, timeoutMs: 120000 });
        }
        set(null);
        sent = true;
      } catch (e) {
        if (e instanceof OfflineError) break; // no signal: the rest waits too
        set({ error: e instanceof Error ? e.message : 'Could not send' });
      }
    }
    if (sent) await refreshSpend().catch(() => undefined);
  })().finally(() => { flushing = null; });
  return flushing;
}

/** A draft the server refused (e.g. a day too far back): the agent can remove it from the phone. */
export function dropExpenseDraft(clientId: string) { saveDrafts(expenseDrafts().filter((x) => x.clientId !== clientId)); }

/** Correct an expense the office hasn't decided on yet (needs signal). A new bill photo replaces the old one. */
export async function editExpense(id: string, d: { spentOn: string; category: string; amount: number; note: string; projectId: string | null; photoUri?: string | null }): Promise<void> {
  await api<MyExpense>(`/api/v1/me/spend/${id}`, { method: 'PUT', body: JSON.stringify({ spentOn: d.spentOn, category: d.category, amount: d.amount, note: d.note, projectId: d.projectId }), timeoutMs: 30000 });
  if (d.photoUri) {
    const form = new FormData();
    form.append('file', { uri: d.photoUri, name: `bill-${id}.jpg`, type: 'image/jpeg' } as unknown as Blob);
    await api<MyExpense>(`/api/v1/me/spend/${id}/bill`, { method: 'POST', body: form, timeoutMs: 120000 });
  }
  await refreshSpend();
}

/** The project I used last, so the next expense starts there (if it is still open). */
export const lastProject = (): string | null => kvJson<string | null>('spend.lastProject', null);
export const setLastProject = (id: string | null) => kvSet('spend.lastProject', id ? JSON.stringify(id) : null);

/** Take back an expense the office hasn't decided on yet. */
export async function takeBackExpense(id: string): Promise<void> {
  await post(`/api/v1/me/spend/${id}/remove`, {}, 30000);
  await refreshSpend();
}

export const billPhoto = (id: string) => ({ uri: `${API_URL}/api/v1/me/spend/${id}/bill`, headers: { Authorization: `Bearer ${accessToken() ?? ''}` } });

/** yyyy-mm-dd for `back` days before the given day. */
export function dayBefore(today: string, back: number): string {
  const d = new Date(`${today}T12:00:00`);
  d.setDate(d.getDate() - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Today's date on this phone, for when the server hasn't been reached yet. */
export function phoneToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
