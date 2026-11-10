import { useEffect, useState } from 'react';
import { api, ApiError, OfflineError } from './api';
import { kvGet, kvJson, kvSet } from './db';
import { lastKnown } from './location';
import { uuid } from './util';
import type { Live } from './presence';
import { fileSize, localFileExists } from './chatFiles';
import type { CallNote } from './calls';

/**
 * Chat with the office, the Field team group, and one-to-one ("direct") chats with anyone — an admin,
 * a manager or another field agent. Only the two people in a direct chat can read it. Messages go straight to the server when there's
 * signal; without it they wait on the phone (kv "chatQueue") and are sent by the sync loop.
 * The last messages of each chat are kept on the phone so they can be read offline.
 */

export interface ChatThread {
  id: string; kind: 'agent' | 'team' | 'direct'; title: string; sub?: string | null; lastMessageAt?: string | null; lastPreview?: string | null; unread: number;
  /** Direct chats: the other person, and their photo. */
  agentId?: string | null; photoUrl?: string | null;
  /** Online now, or last seen: the other person, the office, or how many are online in Team. */
  live?: Live | null;
}
/** Someone this person can message directly. */
export interface ChatPerson { agentId: string; name: string; role: string; kind: 'dashboard' | 'field'; block?: string | null; photoUrl?: string | null }
export interface ChatFile { name: string; mime: string; size?: number | null; url: string; localUri?: string }
export interface ChatMsg {
  id: string; clientId: string; threadId: string; senderId: string; senderName: string; fromOffice: boolean; mine: boolean;
  text?: string | null; contact?: { id: string; name: string } | null; file?: ChatFile | null;
  replyTo?: { id: string; senderName: string; text?: string | null; fileName?: string | null } | null;
  /** A call that ended in this chat (a message the server writes: missed, declined, or how long it was). */
  call?: CallNote | null;
  createdAt: string; state?: 'pending' | 'failed';
}
interface Pending {
  clientId: string; threadId: string; text?: string; contactId?: string; contactName?: string;
  replyTo?: ChatMsg['replyTo']; replyToId?: string; file?: { uri: string; name: string; mime: string; size?: number | null };
  lat?: number | null; lng?: number | null; createdAt: string;
  /** Why the server refused it (its own words), or a code the screen translates. */
  failed?: string; failCode?: FailCode;
  /** Uploads that ran out of time; after 3 the file is marked failed. */
  timeouts?: number;
}
/** Reasons the phone gives itself, translated on screen. */
export type FailCode = 'notSent' | 'timeout' | 'missing';

/** Times as numbers: the server trims trailing zeros and the phone writes 3 digits, so strings don't sort. */
export const msTime = (iso: string | null | undefined): number => (iso ? Date.parse(iso) || 0 : 0);
const byTime = (a: { createdAt: string }, b: { createdAt: string }) => msTime(a.createdAt) - msTime(b.createdAt);

// ─── Change notifications for screens ───
const listeners = new Set<() => void>();
let version = 0;
function changed() { version++; listeners.forEach((l) => { try { l(); } catch { /* keep going */ } }); }
/** Re-renders when chat data on the phone changes. */
export function useChatVersion(): number {
  const [, set] = useState(0);
  useEffect(() => {
    const l = () => set(version);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return version;
}

// ─── Cache ───
const KEEP = 200;
export const cachedThreads = (): ChatThread[] => kvJson<ChatThread[]>('chatThreads', []);
export const cachedUnread = (): number => Number(kvGet('chatUnread') ?? '0') || 0;
/** A manager or admin using the app sees every agent's chat, named by agent. */
export const isOfficeUser = (): boolean => kvGet('chatIsOffice') === '1';
export function cachedMessages(threadId: string): ChatMsg[] {
  const server = kvJson<ChatMsg[]>(`chat:${threadId}`, []);
  const pend = queue().filter((p) => p.threadId === threadId).map(toMsg);
  const have = new Set(server.map((m) => m.clientId));
  return [...server, ...pend.filter((p) => !have.has(p.clientId))].sort(byTime);
}
/** Online / last seen for an open chat (fresher than the chat list). */
export const cachedLive = (threadId: string): Live | null => kvJson<Live | null>(`chatLive:${threadId}`, cachedThreads().find((x) => x.id === threadId)?.live ?? null);
export const otherMarks = (threadId: string) => kvJson<{ readAt: string | null; seenAt: string | null }>(`chatMarks:${threadId}`, { readAt: null, seenAt: null });

/** Chats where older pages were loaded on screen: not trimmed back to KEEP until the screen closes. */
const expanded = new Set<string>();

function storeMessages(threadId: string, incoming: ChatMsg[]) {
  const map = new Map(kvJson<ChatMsg[]>(`chat:${threadId}`, []).map((m) => [m.clientId, m]));
  for (const m of incoming) {
    const old = map.get(m.clientId);
    // The server's copy wins; keep only the phone's own copy of a file we sent, so it opens without downloading again.
    const localUri = old?.file?.localUri ?? m.file?.localUri;
    map.set(m.clientId, localUri && m.file ? { ...m, file: { ...m.file, localUri } } : m);
  }
  const sorted = [...map.values()].sort(byTime);
  const all = expanded.has(threadId) ? sorted : sorted.slice(-KEEP);
  kvSet(`chat:${threadId}`, JSON.stringify(all));
}

/** The chat screen closed: trim the older pages it loaded back to the usual size. */
export function collapse(threadId: string) {
  if (!expanded.delete(threadId)) return;
  const all = kvJson<ChatMsg[]>(`chat:${threadId}`, []);
  if (all.length > KEEP) { kvSet(`chat:${threadId}`, JSON.stringify(all.slice(-KEEP))); changed(); }
}

// ─── Server ───
export async function refreshThreads(): Promise<ChatThread[]> {
  const r = await api<{ threads: ChatThread[]; office?: boolean }>('/api/v1/chat/threads');
  kvSet('chatThreads', JSON.stringify(r.threads));
  kvSet('chatIsOffice', r.office ? '1' : '0');
  kvSet('chatUnread', String(r.threads.reduce((n, t) => n + t.unread, 0)));
  changed();
  return r.threads;
}

export const cachedPeople = (): ChatPerson[] => kvJson<ChatPerson[]>('chatPeople', []);

/** Everyone the agent can message: the office first, then the field team. Kept on the phone for offline browsing. */
export async function refreshPeople(): Promise<ChatPerson[]> {
  const list = await api<ChatPerson[]>('/api/v1/chat/people', { timeoutMs: 15000 });
  kvSet('chatPeople', JSON.stringify(list));
  changed();
  return list;
}

/** Opens the direct chat with this person (creating it the first time); returns the chat's id. Needs signal. */
export async function startDirect(agentId: string): Promise<string> {
  const existing = cachedThreads().find((x) => x.kind === 'direct' && x.agentId === agentId);
  if (existing) return existing.id;
  const r = await api<{ id: string }>('/api/v1/chat/direct', { method: 'POST', body: JSON.stringify({ agentId }), timeoutMs: 15000 });
  try { await refreshThreads(); } catch { /* the chat still opens */ }
  return r.id;
}

export async function refreshUnread(): Promise<void> {
  try {
    const r = await api<{ total: number }>('/api/v1/chat/unread', { timeoutMs: 10000 });
    if (String(r.total) !== kvGet('chatUnread')) { kvSet('chatUnread', String(r.total)); changed(); }
  } catch { /* offline: keep the last count */ }
}

/**
 * New messages since the newest one on the phone — or the latest page, the first time this chat is loaded
 * (even if a message we sent is already stored). The server overlaps `after` by a few seconds; copies are merged by clientId.
 * Returns whether something new from someone else arrived (so the screen knows to mark it read).
 */
export async function refreshMessages(threadId: string): Promise<boolean> {
  const have = kvJson<ChatMsg[]>(`chat:${threadId}`, []);
  const loaded = kvGet(`chatLoaded:${threadId}`) === '1';
  const last = loaded && have.length ? have.reduce((a, m) => (msTime(m.createdAt) > msTime(a) ? m.createdAt : a), have[0].createdAt) : null;
  const r = await api<{ messages: ChatMsg[]; otherReadAt?: string | null; otherSeenAt?: string | null; live?: Live | null }>(
    `/api/v1/chat/threads/${threadId}/messages${last ? `?after=${encodeURIComponent(last)}` : ''}`, { timeoutMs: 15000 });
  if (!loaded) kvSet(`chatLoaded:${threadId}`, '1');
  const known = new Set(have.map((m) => m.clientId));
  const freshFromOthers = r.messages.some((m) => !m.mine && !known.has(m.clientId));
  if (r.messages.length) storeMessages(threadId, r.messages);
  const marks = { readAt: r.otherReadAt ?? null, seenAt: r.otherSeenAt ?? null };
  const old = otherMarks(threadId);
  const live = JSON.stringify(r.live ?? null);
  const liveChanged = live !== (kvGet(`chatLive:${threadId}`) ?? 'null');
  if (liveChanged) kvSet(`chatLive:${threadId}`, live);
  if (r.messages.length || liveChanged || marks.readAt !== old.readAt || marks.seenAt !== old.seenAt) {
    kvSet(`chatMarks:${threadId}`, JSON.stringify(marks));
    changed();
  }
  return freshFromOthers;
}

const loadingOlder = new Set<string>();
/** The page before the oldest message on the phone. Returns whether there is more, or null when it didn't run. */
export async function olderMessages(threadId: string): Promise<boolean | null> {
  if (loadingOlder.has(threadId) || kvGet(`chatLoaded:${threadId}`) !== '1') return null;
  const have = kvJson<ChatMsg[]>(`chat:${threadId}`, []);
  if (!have.length) return null;
  loadingOlder.add(threadId);
  try {
    const r = await api<{ messages: ChatMsg[]; hasMore: boolean }>(
      `/api/v1/chat/threads/${threadId}/messages?before=${encodeURIComponent(have[0].createdAt)}`, { timeoutMs: 15000 });
    expanded.add(threadId);
    if (r.messages.length) { storeMessages(threadId, r.messages); changed(); }
    return r.hasMore;
  } finally {
    loadingOlder.delete(threadId);
  }
}

export async function markRead(threadId: string): Promise<void> {
  try {
    await api(`/api/v1/chat/threads/${threadId}/read`, { method: 'POST', body: '{}', timeoutMs: 10000 });
    const ts = cachedThreads().map((t) => (t.id === threadId ? { ...t, unread: 0 } : t));
    kvSet('chatThreads', JSON.stringify(ts));
    kvSet('chatUnread', String(ts.reduce((n, t) => n + t.unread, 0)));
    changed();
  } catch { /* try again next time */ }
}

// ─── Sending (offline-safe) ───
const queue = (): Pending[] => kvJson<Pending[]>('chatQueue', []);
const saveQueue = (q: Pending[]) => kvSet('chatQueue', JSON.stringify(q));

function toMsg(p: Pending): ChatMsg {
  return {
    id: p.clientId, clientId: p.clientId, threadId: p.threadId, senderId: 'me', senderName: '', fromOffice: false, mine: true,
    text: p.text ?? null, contact: p.contactId ? { id: p.contactId, name: p.contactName ?? '' } : null,
    file: p.file ? { name: p.file.name, mime: p.file.mime, size: p.file.size, url: '', localUri: p.file.uri } : null,
    replyTo: p.replyTo ?? null, createdAt: p.createdAt, state: p.failed || p.failCode ? 'failed' : 'pending',
  };
}

export async function send(threadId: string, input: {
  text?: string; contact?: { id: string; name: string } | null; replyTo?: ChatMsg | null;
  file?: { uri: string; name: string; mime: string; size?: number | null } | null;
}): Promise<void> {
  const here = await lastKnown();
  const p: Pending = {
    clientId: uuid(), threadId, createdAt: new Date().toISOString(),
    text: input.text?.trim() || undefined,
    contactId: input.contact?.id, contactName: input.contact?.name,
    replyToId: input.replyTo?.id,
    replyTo: input.replyTo ? { id: input.replyTo.id, senderName: input.replyTo.senderName, text: input.replyTo.text, fileName: input.replyTo.file?.name } : undefined,
    file: input.file ?? undefined, lat: here?.lat ?? null, lng: here?.lng ?? null,
  };
  saveQueue([...queue(), p]);
  changed();
  void flushChat();
}

export function retry(clientId: string) {
  saveQueue(queue().map((p) => (p.clientId === clientId ? { ...p, failed: undefined, failCode: undefined, timeouts: 0 } : p)));
  changed();
  void flushChat();
}

/** 60 s plus 1 s per 20 KB, at most 15 minutes. */
const uploadTimeout = (bytes: number) => Math.min(15 * 60_000, 60_000 + Math.ceil(bytes / 20_480) * 1000);
/** Worth trying again later: no signal, a timeout, the server busy or restarting, or the session being renewed. */
const retryLater = (e: unknown) =>
  e instanceof OfflineError || (e instanceof ApiError && (e.status >= 500 || e.status === 408 || e.status === 429 || e.status === 401));

function update(clientId: string, patch: Partial<Pending>) {
  saveQueue(queue().map((x) => (x.clientId === clientId ? { ...x, ...patch } : x)));
  changed();
}

let flushing = false;
let again = false;
/**
 * Sends what's waiting, oldest first. Called after each send, by the chat screen and by the sync loop.
 * A call made while a send is running is not lost: the loop goes round again for it.
 */
export async function flushChat(): Promise<void> {
  if (flushing) { again = true; return; }
  flushing = true;
  try {
    do {
      again = false;
      await flushOnce();
    } while (again);
  } finally {
    flushing = false;
  }
}

async function flushOnce(): Promise<void> {
  for (const p of queue()) {
    if (p.failed || p.failCode) continue;
    const started = Date.now();
    let timeoutMs = 20000;
    try {
      let m: ChatMsg;
      if (p.file) {
        if (!localFileExists(p.file.uri)) { update(p.clientId, { failCode: 'missing' }); continue; }
        timeoutMs = uploadTimeout(p.file.size ?? fileSize(p.file.uri) ?? 15 * 1024 * 1024);
        const form = new FormData();
        form.append('file', { uri: p.file.uri, name: p.file.name, type: p.file.mime } as unknown as Blob);
        form.append('clientId', p.clientId);
        if (p.text) form.append('text', p.text);
        if (p.contactId) form.append('contactClientId', p.contactId);
        if (p.replyToId) form.append('replyToId', p.replyToId);
        if (p.lat != null && p.lng != null) { form.append('lat', String(p.lat)); form.append('lng', String(p.lng)); }
        m = await api<ChatMsg>(`/api/v1/chat/threads/${p.threadId}/files`, { method: 'POST', body: form, timeoutMs });
        m = { ...m, file: m.file ? { ...m.file, localUri: p.file.uri } : m.file };
      } else {
        m = await api<ChatMsg>(`/api/v1/chat/threads/${p.threadId}/messages`, {
          method: 'POST', timeoutMs,
          body: JSON.stringify({ clientId: p.clientId, text: p.text, contactClientId: p.contactId, replyToId: p.replyToId, lat: p.lat, lng: p.lng }),
        });
      }
      storeMessages(p.threadId, [m]);
      saveQueue(queue().filter((x) => x.clientId !== p.clientId));
      changed();
    } catch (e) {
      if (retryLater(e)) {
        if (!p.file) return; // no signal (or the server is down): the rest would fail too; try again later
        // A file that ran out of time must not hold up the messages behind it.
        const timedOut = e instanceof OfflineError && Date.now() - started >= timeoutMs * 0.95;
        if (timedOut) {
          const n = (p.timeouts ?? 0) + 1;
          update(p.clientId, n >= 3 ? { timeouts: n, failCode: 'timeout' } : { timeouts: n });
        }
        continue;
      }
      // The server said no (e.g. file type, partner not synced yet): show it, let the agent retry.
      const why = e instanceof ApiError ? e.message : '';
      update(p.clientId, why ? { failed: why } : { failCode: 'notSent' });
    }
  }
}

/** Why a message wasn't sent: the server's words, or a code to translate. */
export function failedReason(clientId: string): { code: FailCode | null; text: string | null } {
  const p = queue().find((x) => x.clientId === clientId);
  return { code: p?.failCode ?? null, text: p?.failed ?? null };
}
export const pendingCount = () => queue().filter((p) => !p.failed && !p.failCode).length;
