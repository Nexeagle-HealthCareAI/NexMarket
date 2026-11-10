import { get, post } from './api';
import { kvJson, kvSet } from './db';
import type { Lang } from '../i18n';

/**
 * Smart chat (Groq, through the NexMarket server): office messages in the agent's own language, suggested replies, and
 * "is this task done?" when the agent writes that something is done. An admin switches each one on in the CRM. The server
 * hides phone numbers, ID numbers and patient names before anything goes to the AI. The AI only suggests: the agent
 * still presses send, and still confirms before a task is marked done.
 */

export interface ChatAiStatus { configured: boolean; translate: boolean; replies: boolean; summary: boolean; tasks: boolean }
const OFF: ChatAiStatus = { configured: false, translate: false, replies: false, summary: false, tasks: false };

export const chatAiStatus = (): ChatAiStatus => kvJson<ChatAiStatus>('chatAiStatus', OFF);

let lastStatus = 0;
/** Refreshes the switches at most every 10 minutes (kept on the phone, so offline uses the last known). */
export async function refreshChatAi(force = false): Promise<ChatAiStatus> {
  if (!force && Date.now() - lastStatus < 10 * 60_000) return chatAiStatus();
  try {
    const r = await get<{ status: ChatAiStatus }>('/api/v1/chat/ai/status');
    lastStatus = Date.now();
    kvSet('chatAiStatus', JSON.stringify(r.status ?? OFF));
    return r.status ?? OFF;
  } catch { return chatAiStatus(); }
}

// ─── Translations, kept on the phone so they show offline ───

const TR_KEY = (lang: Lang) => `chatTr:${lang}`;
type TrCache = Record<string, string | null>; // message id → translation (null: nothing to translate)

export const cachedTranslations = (lang: Lang): TrCache => kvJson<TrCache>(TR_KEY(lang), {});

function count(text: string, from: number, to: number) {
  let n = 0;
  for (const ch of text) { const c = ch.codePointAt(0)!; if (c >= from && c <= to) n++; }
  return n;
}
/** Plainly written in the reader's language already (by its script), so no need to ask. */
export function alreadyIn(text: string, lang: Lang): boolean {
  let letters = 0, latin = 0;
  for (const ch of text) { if (/\p{L}/u.test(ch)) { letters++; if (ch.codePointAt(0)! < 0x250) latin++; } }
  if (letters === 0) return true;
  if (lang === 'hi') return count(text, 0x0900, 0x097f) * 2 >= letters;
  if (lang === 'bn') return count(text, 0x0980, 0x09ff) * 2 >= letters;
  if (lang === 'en') return latin * 2 >= letters && !/\b(hai|nahi|kya|kal|aap|bhej|karo|kijiye|hoga|gaya|mein)\b/i.test(text);
  return false; // Hinglish: the server decides
}

const asking = new Set<string>();
/** Translates these messages (ids) into the app language; the answers are cached. Returns how many came back. */
export async function translate(threadId: string, items: { id: string; text: string }[], lang: Lang): Promise<number> {
  const cache = cachedTranslations(lang);
  const want = items.filter((m) => !(m.id in cache) && !asking.has(`${lang}:${m.id}`)).slice(-30);
  if (want.length === 0) return 0;
  // Nothing to do for these: remember that without asking.
  const need = want.filter((m) => !alreadyIn(m.text, lang));
  for (const m of want) if (!need.includes(m)) cache[m.id] = null;
  if (need.length === 0) { save(lang, cache); return 0; }
  for (const m of need) asking.add(`${lang}:${m.id}`);
  try {
    const r = await post<{ items: { id: string; text: string }[] }>(`/api/v1/chat/threads/${threadId}/ai/translate`, { ids: need.map((m) => m.id), lang }, 30_000);
    const fresh = cachedTranslations(lang);
    for (const m of need) fresh[m.id] = null;
    for (const it of r.items ?? []) fresh[it.id] = it.text;
    save(lang, fresh);
    return r.items?.length ?? 0;
  } finally {
    for (const m of need) asking.delete(`${lang}:${m.id}`);
  }
}

function save(lang: Lang, cache: TrCache) {
  // Keep the newest 600: plenty for the chats on the phone.
  const keys = Object.keys(cache);
  const trimmed = keys.length > 600 ? Object.fromEntries(keys.slice(-600).map((k) => [k, cache[k]])) : cache;
  kvSet(TR_KEY(lang), JSON.stringify(trimmed));
}

// ─── Suggested replies ───

export async function suggestReplies(threadId: string, lang: Lang): Promise<{ forMessage?: string; replies: string[] }> {
  return post(`/api/v1/chat/threads/${threadId}/ai/replies`, { lang }, 20_000);
}

// ─── "Is this task done?" ───

const DONE_WORDS = /\b(done|completed?|finished|delivered|submitted|sent|given|ho\s?gaya|ho\s?gya|kar\s?diya|kr\s?diya|de\s?diya|bhej\s?diya|pahuncha\s?diya)\b|✅|👍|हो गया|कर दिया|दे दिया|भेज दिया|পাঠিয়ে দিয়েছি|হয়ে গেছে|করে দিয়েছি|দিয়ে দিয়েছি/i;
/** Worth asking about: the agent says it's done, or sends a photo. */
export const looksDone = (text: string | null | undefined, photo: boolean) => photo || DONE_WORDS.test(text ?? '');

export async function doneTask(threadId: string, clientId: string): Promise<{ id: string; title: string } | null> {
  const r = await post<{ task: { id: string; title: string } | null }>(`/api/v1/chat/threads/${threadId}/ai/done`, { clientId }, 20_000);
  return r.task ?? null;
}
