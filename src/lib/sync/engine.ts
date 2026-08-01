/**
 * Sync Engine — background sync loop
 *
 * Strategy:
 *  1. Foreground polling every 30s (when app is visible)
 *  2. Background Sync API (Chromium Android) — registered in service worker
 *  3. iOS Safari fallback — fires on visibilitychange (app foreground)
 *
 * Batching: max 50 records per POST to handle 2G connections gracefully.
 * Backoff: exponential, starting at 5s, max 5 minutes.
 */

import {
  addToOutbox,
  enqueueTrajectoryBatch,
  getPendingEntries,
  incrementRetry,
  markSynced,
  wireTypeFor,
} from './outbox';
import { syncBatch } from './api-client';
import { getSyncStateValue } from '../db';
import type { SyncOutboxEntry } from '../db/schema';

// ─── State ────────────────────────────────────────────────────────────────────

let _polling: ReturnType<typeof setInterval> | null = null;
let _isSyncing = false;
let _backoffMs = 5_000;
const MAX_BACKOFF_MS = 5 * 60 * 1_000; // 5 minutes

// ─── Main sync function ───────────────────────────────────────────────────────

async function runSync(): Promise<void> {
  if (_isSyncing) return;
  if (typeof window === 'undefined') return;
  if (!navigator.onLine) return;

  _isSyncing = true;

  try {
    const agentId = await getSyncStateValue('agentId');
    const deviceId = await getSyncStateValue('deviceId');

    if (!agentId || !deviceId) {
      _isSyncing = false;
      return;
    }

    // Enqueue any pending trajectory points first
    await enqueueTrajectoryBatch(agentId, deviceId);

    let hasMore = true;
    while (hasMore) {
      const batch = await getPendingEntries(50);
      if (batch.length === 0) {
        hasMore = false;
        break;
      }

      try {
        const response = await syncBatch({
          deviceId,
          agentId,
          items: batch.map((e) => ({
            id: String(e.localId ?? ''),
            clientId: e.clientId,
            deviceId: e.deviceId,
            agentId,
            type: wireTypeFor(e),
            payload: e.payload,
            timestamp: e.lastAttemptAt ?? new Date().toISOString(),
          })),
        });

        for (const result of response.results) {
          const entry = batch.find(
            (e) => e.clientId === result.clientId && e.deviceId === result.deviceId,
          );
          if (!entry?.localId) continue;

          if (result.status === 'created' || result.status === 'already_exists') {
            const pointClientIds =
              entry.entityType === 'trajectory_batch'
                ? ((JSON.parse(entry.payload) as { points?: { clientId: string }[] }).points ?? []).map(
                    (p) => p.clientId,
                  )
                : undefined;

            await markSynced(
              entry.localId,
              result.clientId,
              result.deviceId,
              entry.entityType,
              result.serverId,
              result.syncedAt,
              pointClientIds,
            );
          } else if (result.status === 'error') {
            await incrementRetry(entry.localId, result.errorMessage ?? 'Unknown server error');
          }
          // 'conflict' status: server is newer → client re-fetches in the next pull
        }

        // Reset backoff on success
        _backoffMs = 5_000;

        // If batch was full, there might be more
        hasMore = batch.length === 50;
      } catch (err: unknown) {
        // Network failure — back off and stop this run
        const message = err instanceof Error ? err.message : 'Network error';
        for (const entry of batch) {
          if (entry.localId) await incrementRetry(entry.localId, message);
        }
        _backoffMs = Math.min(_backoffMs * 2, MAX_BACKOFF_MS);
        hasMore = false;
      }
    }
  } finally {
    _isSyncing = false;
  }
}

// ─── Foreground polling ───────────────────────────────────────────────────────

export function startSyncPolling(): void {
  if (_polling) return;

  // Immediate first run
  void runSync();

  // Poll every 30s while app is visible
  _polling = setInterval(() => {
    if (document.visibilityState === 'visible') {
      void runSync();
    }
  }, 30_000);

  // iOS fallback: also fire on app foreground (visibilitychange)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void runSync();
    }
  });

  // Fire immediately when connectivity returns
  window.addEventListener('online', () => {
    _backoffMs = 5_000; // reset backoff when network comes back
    void runSync();
  });
}

export function stopSyncPolling(): void {
  if (_polling) {
    clearInterval(_polling);
    _polling = null;
  }
}

// ─── Manual trigger (for "Sync Now" button) ───────────────────────────────────

export async function triggerManualSync(): Promise<void> {
  _backoffMs = 5_000;
  await runSync();
}

// ─── Register Background Sync (Chromium Android only) ────────────────────────

export async function registerBackgroundSync(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  if (!('SyncManager' in window)) return; // iOS Safari doesn't support

  try {
    const registration = await navigator.serviceWorker.ready;
    // SyncManager (Background Sync API) is Chromium-only and not in the
    // standard lib.dom types — typed via a local cast instead of a
    // suppression directive, since different type-checkers in this project's
    // toolchain disagree on whether `.sync` already resolves.
    const syncRegistration = registration as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
    };
    await syncRegistration.sync?.register('outbox-sync');
  } catch {
    // Background sync not available — polling fallback handles it
  }
}
