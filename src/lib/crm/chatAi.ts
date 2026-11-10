'use client';

import { useSyncExternalStore } from 'react';
import { crm } from '@/lib/sync/api-client';

/**
 * Smart chat (Groq): translation, suggested replies, catch-up summaries, the office digest and tasks spotted in chat.
 * Each feature is switched on by an admin; the server hides phone numbers, ID numbers and patient names before
 * anything goes to the AI. The AI only suggests: sending, making a task or marking one done is always a person's tap.
 */

export interface ChatAiStatus { configured: boolean; translate: boolean; replies: boolean; summary: boolean; tasks: boolean }
interface State { loaded: boolean; status: ChatAiStatus; canManage: boolean }

const OFF: ChatAiStatus = { configured: false, translate: false, replies: false, summary: false, tasks: false };
let state: State = { loaded: false, status: OFF, canManage: false };
const SERVER: State = state;
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

export function useChatAi(): State {
  return useSyncExternalStore(subscribe, () => state, () => SERVER);
}

let loading: Promise<void> | null = null;
export function loadChatAi(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = crm.get<{ status: ChatAiStatus; canManage: boolean }>('/api/v1/chat/ai/status')
    .then((r) => set({ loaded: true, status: r.status ?? OFF, canManage: !!r.canManage }))
    .catch(() => { set({ loaded: true }); loading = null; });
  return loading;
}

export async function saveChatAi(s: Omit<ChatAiStatus, 'configured'>): Promise<void> {
  const r = await crm.put<{ status: ChatAiStatus; canManage: boolean }>('/api/v1/chat/ai/settings', s);
  set({ status: r.status, canManage: r.canManage });
}

/** Written mostly in Hindi or Bangla script: the office gets an English version. (Hinglish is left alone.) */
export function needsEnglish(text?: string | null): boolean {
  if (!text) return false;
  let letters = 0, other = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (/\p{L}/u.test(ch)) { letters++; if (c >= 0x0900 && c <= 0x09ff) other++; }
  }
  return letters > 0 && other * 2 >= letters;
}

export const translateMessages = (threadId: string, ids: string[]) =>
  crm.post<{ items: { id: string; text: string }[] }>(`/api/v1/chat/threads/${threadId}/ai/translate`, { ids, lang: 'en' });

export const suggestReplies = (threadId: string) =>
  crm.post<{ replies: string[]; forMessage?: string }>(`/api/v1/chat/threads/${threadId}/ai/replies`, { lang: 'en' });

export interface ChatSummary { points: string[]; todo: string[]; count: number; from: string; to: string }
export const summarise = (threadId: string, since?: string) =>
  crm.post<ChatSummary>(`/api/v1/chat/threads/${threadId}/ai/summary`, { lang: 'en', since });

export interface DigestRow {
  threadId: string; agentId: string; name: string; block?: string | null; summary: string; urgent: boolean; why?: string | null;
  waiting: boolean; messages: number; lastAt: string;
}
export interface Digest { overview: string; chats: DigestRow[]; count: number; hours: number }
export const digest = (hours: number) => crm.get<Digest>(`/api/v1/chat/ai/digest?hours=${hours}`);

export interface TaskIdea {
  isTask: boolean; title?: string; detail?: string | null; dueDate?: string | null; priority?: 'high' | 'normal';
  agentId?: string; agentName?: string; contactClientId?: string | null; messageId?: string;
}
export const taskIdea = (threadId: string, messageId: string) =>
  crm.post<TaskIdea>(`/api/v1/chat/threads/${threadId}/ai/task`, { messageId });
