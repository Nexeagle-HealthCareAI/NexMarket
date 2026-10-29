import { api } from './api';
import { kvJson, kvSet, notifyChange } from './db';
import { ymd } from './util';

/** Today's AI tips, cached on the phone for the day so the home screen can show the first one offline. */
export interface AiTips { greeting: string; tips: { title: string; detail: string }[] }
interface Cached { day: string; lang: string; data: AiTips }

const K = 'aiTips';

export function cachedTips(lang: string): AiTips | null {
  const c = kvJson<Cached | null>(K, null);
  return c && c.day === ymd() && c.lang === lang ? c.data : null;
}

export function saveTips(lang: string, data: AiTips) {
  kvSet(K, JSON.stringify({ day: ymd(), lang, data } satisfies Cached));
  notifyChange();
}

let loading: Promise<void> | null = null;

/** Fetch today's tips once (the server also caches them per agent per day). Failures are silent. */
export function ensureTips(lang: string): Promise<void> {
  if (cachedTips(lang)) return Promise.resolve();
  loading ??= api<AiTips>(`/api/v1/me/assistant/tips?lang=${lang}`, { timeoutMs: 90000 })
    .then((d) => saveTips(lang, d))
    .catch(() => undefined)
    .finally(() => { loading = null; });
  return loading;
}
