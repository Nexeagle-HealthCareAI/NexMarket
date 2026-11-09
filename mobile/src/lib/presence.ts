import { AppState, Platform } from 'react-native';
import { api } from './api';
import { relDay, timeOf } from './format';
import type { Lang, TFn } from '../i18n';

/** Online / last seen, as the chat API sends it for a chat's other side. */
export interface Live { online: boolean; lastSeenAt?: string | null; on?: string | null; count: number }

const BEAT_MS = 30_000;
const on = Platform.OS === 'ios' ? 'ios' : 'android';
const send = (active: boolean) => api('/api/v1/me/presence', { method: 'POST', body: JSON.stringify({ active, on }), timeoutMs: 8000 }).catch(() => undefined);

/**
 * Tells the server this person has the app open: a heartbeat every 30 s while it is on screen, and "away"
 * when it goes to the background. That is all "online" and "last seen" in chat are based on — background
 * location or sync does not count as being online. Returns a function that stops it (on sign-out).
 */
export function startPresence(): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  const start = () => {
    if (timer) return;
    void send(true);
    timer = setInterval(() => void send(true), BEAT_MS);
  };
  const stop = (away: boolean) => {
    if (timer) { clearInterval(timer); timer = null; }
    if (away) void send(false);
  };
  if (AppState.currentState === 'active') start();
  const sub = AppState.addEventListener('change', (st) => (st === 'active' ? start() : stop(true)));
  return () => { sub.remove(); stop(true); };
}

/** "last seen today at 3:40 pm" etc. */
export function lastSeen(t: TFn, lang: Lang, iso?: string | null): string | null {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return t('chatSeenNow');
  if (mins < 60) return t('chatSeenMin', { n: mins });
  const d = relDay(t, lang, iso);
  if (d === t('today')) return t('chatSeenToday', { time: timeOf(lang, iso) });
  if (d === t('yesterday')) return t('chatSeenYesterday', { time: timeOf(lang, iso) });
  return t('chatSeenOn', { date: d });
}

/** The chat header line: "online", "last seen …", "Office online", "3 online" (null = show the usual line). */
export function liveLine(t: TFn, lang: Lang, live: Live | null | undefined, kind: 'agent' | 'team' | 'direct', office: boolean): string | null {
  if (!live) return null;
  if (kind === 'team') return live.count > 0 ? t('chatTeamOnline', { n: live.count }) : null;
  if (kind === 'agent' && !office) return live.online ? t('chatOfficeOnline') : null;
  return live.online ? t('chatOnline') : lastSeen(t, lang, live.lastSeenAt);
}
