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

/** An agent's newest GPS fix, pushed when their phone syncs. */
export interface LiveLocation {
  agentId: string;
  name: string;
  lat: number;
  lng: number;
  at: string;
  accuracyM?: number | null;
}

/**
 * Subscribes to the dashboard's live feed (SignalR hub /hubs/live, cookie auth).
 * If the socket can't connect, status becomes "polling" — pages then refresh
 * on their own timer instead, so the screen never goes stale.
 */
export function useLiveEvents(onEvent: (e: LiveEvent) => void, onLocation?: (l: LiveLocation) => void): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const handler = useRef(onEvent);
  const locHandler = useRef(onLocation);
  useEffect(() => { handler.current = onEvent; locHandler.current = onLocation; }, [onEvent, onLocation]);

  useEffect(() => {
    let stopped = false;
    let connection: import('@microsoft/signalr').HubConnection | null = null;

    (async () => {
      try {
        const signalR = await import('@microsoft/signalr');
        connection = new signalR.HubConnectionBuilder()
          .withUrl(`${API_ORIGIN}/hubs/live`, { withCredentials: true })
          .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
          .configureLogging(signalR.LogLevel.None)
          .build();
        connection.on('event', (e: LiveEvent) => handler.current(e));
        connection.on('location', (l: LiveLocation) => locHandler.current?.(l));
        connection.onreconnecting(() => !stopped && setStatus('connecting'));
        connection.onreconnected(() => !stopped && setStatus('live'));
        connection.onclose(() => !stopped && setStatus('polling'));
        await connection.start();
        if (!stopped) setStatus('live');
      } catch {
        if (!stopped) setStatus('polling');
      }
    })();

    return () => {
      stopped = true;
      void connection?.stop();
    };
  }, []);

  return status;
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
