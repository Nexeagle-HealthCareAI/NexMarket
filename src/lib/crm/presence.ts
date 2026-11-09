'use client';

import { useEffect } from 'react';
import { API_ORIGIN, crm } from '@/lib/sync/api-client';

/** Online / last seen, as the chat API sends it for a chat's other side. */
export interface Live { online: boolean; lastSeenAt?: string | null; on?: string | null; count: number }

const BEAT_MS = 30_000;
const PATH = '/api/v1/me/presence';

/**
 * Tells the server this person has the CRM open: a heartbeat every 30 s while the tab is visible,
 * and "away" when the tab is hidden or closed. That is all "online" and "last seen" in chat are based on.
 */
export function usePresenceBeat(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const beat = () => { if (!document.hidden) void crm.post(PATH, { active: true, on: 'web' }).catch(() => undefined); };
    // Leaving must still reach the server while the page goes away, so it uses a keep-alive request.
    const away = () => {
      try {
        void fetch(`${API_ORIGIN}${PATH}`, {
          method: 'POST', keepalive: true, credentials: 'include',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: false, on: 'web' }),
        }).catch(() => undefined);
      } catch { /* the page is closing */ }
    };
    const onVis = () => (document.hidden ? away() : beat());
    beat();
    const t = setInterval(beat, BEAT_MS);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', away);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', away);
    };
  }, [enabled]);
}

const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);

/** "last seen today at 3:40 pm", "last seen yesterday at 9:05 am", "last seen 5 Nov" — or "last seen just now". */
export function lastSeenText(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 2) return 'last seen just now';
  if (mins < 60) return `last seen ${mins} min ago`;
  const day = istDay(d);
  if (day === istDay(new Date())) return `last seen today at ${timeFmt.format(d)}`;
  if (day === istDay(new Date(Date.now() - 864e5))) return `last seen yesterday at ${timeFmt.format(d)}`;
  return `last seen ${dateFmt.format(d)}`;
}

const ON_LABEL: Record<string, string> = { web: 'on the CRM', android: 'on the app', ios: 'on the app' };

/** The header line for a chat: "online · on the app", "last seen …", "3 online", "office online". */
export function liveText(live: Live | null | undefined, kind: 'agent' | 'team' | 'direct', office: boolean): string | null {
  if (!live) return null;
  if (kind === 'team') return live.count > 0 ? `${live.count} online` : null;
  if (kind === 'agent' && !office) return live.online ? `Office online${live.count > 1 ? ` · ${live.count} people` : ''}` : (lastSeenText(live.lastSeenAt)?.replace('last seen', 'office last seen') ?? null);
  if (live.online) return `online${live.on && ON_LABEL[live.on] ? ` · ${ON_LABEL[live.on]}` : ''}`;
  return lastSeenText(live.lastSeenAt);
}
