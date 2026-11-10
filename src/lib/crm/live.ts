'use client';

import { useEffect, useRef, useState } from 'react';
import { API_ORIGIN } from '@/lib/sync/api-client';

export interface LiveEvent {
  kind: string;
  text: string;
  at: string;
  refId?: string | null;
}

export type LiveStatus = 'connecting' | 'live' | 'polling';

/** One of my notifications, pushed the moment it's created. */
export interface LiveNotification {
  id: string; kind: string; title: string; body: string; link?: string | null; createdAt: string; muted?: boolean;
}

/** An agent's newest GPS fix, pushed when their phone syncs. */
export interface LiveLocation {
  agentId: string;
  name: string;
  lat: number;
  lng: number;
  at: string;
  accuracyM?: number | null;
}

interface Subscriber {
  onEvent: (e: LiveEvent) => void;
  onLocation?: (l: LiveLocation) => void;
  onChat?: (threadId: string) => void;
  onNotify?: (n: LiveNotification) => void;
  onStatus: (s: LiveStatus) => void;
}

// One SignalR connection per tab, shared by every component that listens (the layout and the page).
const subscribers = new Set<Subscriber>();
let connection: import('@microsoft/signalr').HubConnection | null = null;
let starting: Promise<void> | null = null;
let status: LiveStatus = 'connecting';
let stopTimer: ReturnType<typeof setTimeout> | null = null;

function setStatus(s: LiveStatus) {
  status = s;
  subscribers.forEach((x) => x.onStatus(s));
}

function ensureConnection() {
  if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
  if (connection || starting) return;
  starting = (async () => {
    try {
      const signalR = await import('@microsoft/signalr');
      const c = new signalR.HubConnectionBuilder()
        .withUrl(`${API_ORIGIN}/hubs/live`, { withCredentials: true })
        .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
        .configureLogging(signalR.LogLevel.None)
        .build();
      c.on('event', (e: LiveEvent) => subscribers.forEach((x) => x.onEvent(e)));
      c.on('location', (l: LiveLocation) => subscribers.forEach((x) => x.onLocation?.(l)));
      // Chat pings carry only the conversation id; the page fetches what's new with its own access check.
      c.on('chat', (m: { threadId: string }) => subscribers.forEach((x) => x.onChat?.(m.threadId)));
      // My own notifications (sent only to my user group).
      c.on('notify', (n: LiveNotification) => subscribers.forEach((x) => x.onNotify?.(n)));
      c.onreconnecting(() => setStatus('connecting'));
      c.onreconnected(() => setStatus('live'));
      c.onclose(() => { if (connection === c) { connection = null; setStatus('polling'); } });
      connection = c;
      await c.start();
      if (connection === c) setStatus('live');
    } catch {
      connection = null;
      setStatus('polling');
    } finally {
      starting = null;
    }
  })();
}

function releaseConnection() {
  if (subscribers.size > 0 || stopTimer) return;
  // A short grace period, so moving between pages doesn't drop and re-open the socket.
  stopTimer = setTimeout(() => {
    stopTimer = null;
    if (subscribers.size > 0) return;
    const c = connection;
    connection = null;
    status = 'connecting';
    void c?.stop();
  }, 3000);
}

/**
 * Subscribes to the dashboard's live feed (SignalR hub /hubs/live, cookie auth).
 * If the socket can't connect, status becomes "polling" — pages then refresh
 * on their own timer instead, so the screen never goes stale.
 */
export function useLiveEvents(onEvent: (e: LiveEvent) => void, onLocation?: (l: LiveLocation) => void, onChat?: (threadId: string) => void,
  onNotify?: (n: LiveNotification) => void): LiveStatus {
  const [state, setState] = useState<LiveStatus>(status);
  const handler = useRef(onEvent);
  const locHandler = useRef(onLocation);
  const chatHandler = useRef(onChat);
  const notifyHandler = useRef(onNotify);
  useEffect(() => { handler.current = onEvent; locHandler.current = onLocation; chatHandler.current = onChat; notifyHandler.current = onNotify; }, [onEvent, onLocation, onChat, onNotify]);

  useEffect(() => {
    const sub: Subscriber = {
      onEvent: (e) => handler.current(e),
      onLocation: (l) => locHandler.current?.(l),
      onChat: (id) => chatHandler.current?.(id),
      onNotify: (n) => notifyHandler.current?.(n),
      onStatus: setState,
    };
    subscribers.add(sub);
    ensureConnection();
    // The shared socket may have changed state between render and now.
    const sync = setTimeout(() => setState(status), 0);
    return () => {
      clearTimeout(sync);
      subscribers.delete(sub);
      releaseConnection();
    };
  }, []);

  return state;
}

/** Re-renders every `ms` so "2 min ago" labels stay current. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function timeAgo(iso: string | null | undefined, now: number): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}
