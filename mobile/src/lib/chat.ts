import { useEffect, useState } from 'react';
import { api, ApiError, OfflineError } from './api';
import { kvGet, kvJson, kvSet } from './db';
import { lastKnown } from './location';
import { uuid } from './util';

/**
 * Chat with the office (and the Field team group). Messages go straight to the server when there's
 * signal; without it they wait on the phone (kv "chatQueue") and are sent by the sync loop.
 * The last messages of each chat are kept on the phone so they can be read offline.
 */

export interface ChatThread { id: string; kind: 'agent' | 'team'; title: string; sub?: string | null; lastMessageAt?: string | null; lastPreview?: string | null; unread: number }
export interface ChatFile { name: string; mime: string; size?: number | null; url: string; localUri?: string }
export interface ChatMsg {
  id: string; clientId: string; threadId: string; senderId: string; senderName: string; fromOffice: boolean; mine: boolean;
  text?: string | null; contact?: { id: string; name: string } | null; file?: ChatFile | null;
  replyTo?: { id: string; senderName: string; text?: string | null; fileName?: string | null } | null;
  createdAt: string; state?: 'pending' | 'failed';
}
interface Pending {
  clientId: string; threadId: string; text?: string; contactId?: string; contactName?: string;
  replyTo?: ChatMsg['replyTo']; replyToId?: string; file?: { uri: string; name: string; mime: string; size?: number | null };
  lat?: number | null; lng?: number | null; createdAt: string; failed?: string;
}

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
  return [...server, ...pend.filter((p) => !have.has(p.clientId))].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export const otherMarks = (threadId: string) => kvJson<{ readAt: string | null; seenAt: string | null }>(`chatMarks:${threadId}`, { readAt: null, seenAt: null });

function storeMessages(threadId: string, incoming: ChatMsg[]) {
  const map = new Map(kvJson<ChatMsg[]>(`chat:${threadId}`, []).map((m) => [m.clientId, m]));
  for (const m of incoming) {
    const old = map.get(m.clientId);
    // Keep the phone's own copy of a file we sent, so it opens without downloading again.
    map.set(m.clientId, old?.file?.localUri && m.file ? { ...m, file: { ...m.file, localUri: old.file.localUri } } : m);
  }
  const all = [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-KEEP);
  kvSet(`chat:${threadId}`, JSON.stringify(all));
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

export async function refreshUnread(): Promise<void> {
  try {
    const r = await api<{ total: number }>('/api/v1/chat/unread', { timeoutMs: 10000 });
    if (String(r.total) !== kvGet('chatUnread')) { kvSet('chatUnread', String(r.total)); changed(); }
  } catch { /* offline: keep the last count */ }
}

/** New messages since the newest one on the phone (or the latest page the first time). */
export async function refreshMessages(threadId: string): Promise<void> {
  const have = kvJson<ChatMsg[]>(`chat:${threadId}`, []);
  const last = have[have.length - 1]?.createdAt;
  const r = await api<{ messages: ChatMsg[]; otherReadAt?: string | null; otherSeenAt?: string | null }>(
    `/api/v1/chat/threads/${threadId}/messages${last ? `?after=${encodeURIComponent(last)}` : ''}`, { timeoutMs: 15000 });
  if (r.messages.length) storeMessages(threadId, r.messages);
  const marks = { readAt: r.otherReadAt ?? null, seenAt: r.otherSeenAt ?? null };
  const old = otherMarks(threadId);
  if (r.messages.length || marks.readAt !== old.readAt || marks.seenAt !== old.seenAt) {
    kvSet(`chatMarks:${threadId}`, JSON.stringify(marks));
    changed();
  }
}

export async function olderMessages(threadId: string): Promise<boolean> {
  const have = kvJson<ChatMsg[]>(`chat:${threadId}`, []);
  if (!have.length) return false;
  const r = await api<{ messages: ChatMsg[]; hasMore: boolean }>(`/api/v1/chat/threads/${threadId}/messages?before=${encodeURIComponent(have[0].createdAt)}`);
  const all = [...r.messages, ...have];
  kvSet(`chat:${threadId}`, JSON.stringify(all));
  changed();
  return r.hasMore;
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
    replyTo: p.replyTo ?? null, createdAt: p.createdAt, state: p.failed ? 'failed' : 'pending',
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
  saveQueue(queue().map((p) => (p.clientId === clientId ? { ...p, failed: undefined } : p)));
  changed();
  void flushChat();
}

let flushing = false;
/** Sends what's waiting, oldest first. Called after each send and by the sync loop. */
export async function flushChat(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (const p of queue()) {
      if (p.failed) continue;
      try {
        let m: ChatMsg;
        if (p.file) {
          const form = new FormData();
          form.append('file', { uri: p.file.uri, name: p.file.name, type: p.file.mime } as unknown as Blob);
          form.append('clientId', p.clientId);
          if (p.text) form.append('text', p.text);
          if (p.contactId) form.append('contactClientId', p.contactId);
          if (p.replyToId) form.append('replyToId', p.replyToId);
          if (p.lat != null && p.lng != null) { form.append('lat', String(p.lat)); form.append('lng', String(p.lng)); }
          m = await api<ChatMsg>(`/api/v1/chat/threads/${p.threadId}/files`, { method: 'POST', body: form, timeoutMs: 180000 });
          m = { ...m, file: m.file ? { ...m.file, localUri: p.file.uri } : m.file };
        } else {
          m = await api<ChatMsg>(`/api/v1/chat/threads/${p.threadId}/messages`, {
            method: 'POST', timeoutMs: 20000,
            body: JSON.stringify({ clientId: p.clientId, text: p.text, contactClientId: p.contactId, replyToId: p.replyToId, lat: p.lat, lng: p.lng }),
          });
        }
        storeMessages(p.threadId, [m]);
        saveQueue(queue().filter((x) => x.clientId !== p.clientId));
        changed();
      } catch (e) {
        if (e instanceof OfflineError) break; // no signal: try again later
        // The server said no (e.g. file too big, partner not synced yet): show it, let the agent retry.
        const why = e instanceof ApiError ? e.message : 'Not sent';
        saveQueue(queue().map((x) => (x.clientId === p.clientId ? { ...x, failed: why } : x)));
        changed();
      }
    }
  } finally {
    flushing = false;
  }
}

export const failedReason = (clientId: string) => queue().find((p) => p.clientId === clientId)?.failed ?? null;
export const pendingCount = () => queue().filter((p) => !p.failed).length;
