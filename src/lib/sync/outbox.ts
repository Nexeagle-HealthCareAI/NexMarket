/**
 * Sync Outbox helpers
 *
 * All write operations in the app call addToOutbox() after writing to Dexie.
 * This is the only entry point into the sync queue.
 */

import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import type { EntityType, SyncOutboxEntry } from '../db/schema';

const MAX_RETRIES = 7;

// ─── Wire type mapping ─────────────────────────────────────────────────────────

/**
 * Maps a local (coarse) EntityType + its payload to the granular type string
 * the server's sync handler switches on. Inferred from the payload rather than
 * threaded through every call site, since the payload shape already encodes
 * the distinction (e.g. an endAt means "shift_end", not "shift_start").
 */
export function wireTypeFor(entry: SyncOutboxEntry): string {
  const payload = JSON.parse(entry.payload) as Record<string, unknown>;
  switch (entry.entityType) {
    case 'shift':
      return payload.endAt ? 'shift_end' : 'shift_start';
    case 'visit':
      return payload.checkOutAt ? 'visit_checkout' : 'visit_checkin';
    case 'contact':
      return 'contact_new'; // no edit-existing-contact flow exists yet
    case 'referral':
      return 'referral_new';
    case 'trajectory_batch':
      return 'trajectory_batch';
    case 'survey':
      return 'survey';
  }
}

// ─── Enqueue ──────────────────────────────────────────────────────────────────

/**
 * Add a record to the sync outbox.
 * Called immediately after every successful Dexie write.
 */
export async function addToOutbox<T extends object>(
  clientId: string,
  deviceId: string,
  entityType: EntityType,
  payload: T,
): Promise<void> {
  const entry: SyncOutboxEntry = {
    clientId,
    deviceId,
    entityType,
    payload: JSON.stringify(payload),
    attemptCount: 0,
    createdAt: new Date().toISOString(),
  };
  await db.syncOutbox.add(entry);
}

// ─── Read pending entries ──────────────────────────────────────────────────────

/**
 * Returns entries eligible for sync — sorted by localId (insertion order),
 * skipping entries that have exceeded MAX_RETRIES.
 */
export async function getPendingEntries(limit = 50): Promise<SyncOutboxEntry[]> {
  return db.syncOutbox
    .filter((e) => e.attemptCount < MAX_RETRIES)
    .limit(limit)
    .toArray();
}

// ─── Mark synced ──────────────────────────────────────────────────────────────

/**
 * Remove a successfully synced entry from the outbox and write serverId
 * back to its parent record.
 */
export async function markSynced(
  localId: number,
  clientId: string,
  deviceId: string,
  entityType: EntityType,
  serverId: string,
  syncedAt: string,
  trajectoryPointClientIds?: string[],
): Promise<void> {
  await db.transaction('rw', [
    db.syncOutbox,
    db.contacts,
    db.visits,
    db.shifts,
    db.referrals,
    db.trajectoryPoints,
  ], async () => {
    // Remove from outbox
    await db.syncOutbox.delete(localId);

    // Write serverId back to the originating table
    const filter = (r: { clientId: string; deviceId: string }) =>
      r.clientId === clientId && r.deviceId === deviceId;

    switch (entityType) {
      case 'contact':
        await db.contacts
          .filter(filter)
          .modify({ serverId, syncedAt });
        break;
      case 'visit':
        await db.visits
          .filter(filter)
          .modify({ serverId, syncedAt });
        break;
      case 'shift':
        await db.shifts
          .filter(filter)
          .modify({ serverId, syncedAt });
        break;
      case 'referral':
        await db.referrals
          .filter(filter)
          .modify({ serverId, syncedAt });
        break;
      case 'survey':
        await db.surveyResponses
          .filter(filter)
          .modify({ serverId, syncedAt });
        break;
      case 'trajectory_batch': {
        // The batch itself has its own synthetic clientId — the points inside
        // it each have their own, so they must be matched by that list, not
        // by the batch's clientId (which no point row ever carries).
        const ids = trajectoryPointClientIds ?? [];
        if (ids.length > 0) {
          await db.trajectoryPoints
            .filter((p) => p.deviceId === deviceId && ids.includes(p.clientId))
            .modify({ syncedAt });
        }
        break;
      }
    }
  });
}

// ─── Mark failed ─────────────────────────────────────────────────────────────

export async function incrementRetry(
  localId: number,
  errorMessage: string,
): Promise<void> {
  await db.syncOutbox
    .where({ localId })
    .modify((entry) => {
      entry.attemptCount += 1;
      entry.lastAttemptAt = new Date().toISOString();
      entry.errorMessage = errorMessage;
    });
}

// ─── Dead letter count ────────────────────────────────────────────────────────

export async function getDeadLetterCount(): Promise<number> {
  return db.syncOutbox.filter((e) => e.attemptCount >= MAX_RETRIES).count();
}

// Items that hit MAX_RETRIES are excluded from getPendingEntries forever —
// silently, with nothing in the UI ever telling the agent or admin they
// exist. This puts them back in the normal sync queue so the next poll
// picks them up again, instead of them sitting stuck with zero visibility.
export async function retryDeadLetters(): Promise<number> {
  return db.syncOutbox
    .filter((e) => e.attemptCount >= MAX_RETRIES)
    .modify((entry) => {
      entry.attemptCount = 0;
      entry.errorMessage = undefined;
    });
}

// ─── Trajectory batch helper ──────────────────────────────────────────────────

/**
 * Pull up to `limit` unsynced trajectory points and package them as a single
 * outbox entry (batch upload to avoid one-row-per-POST on 2G).
 */
export async function enqueueTrajectoryBatch(
  agentId: string,
  deviceId: string,
  limit = 200,
): Promise<void> {
  const points = await db.trajectoryPoints
    .filter((p) => !p.syncedAt && p.agentId === agentId && p.deviceId === deviceId)
    .limit(limit)
    .toArray();

  if (points.length === 0) return;

  // Use the first point's clientId as the batch ID
  const batchClientId = uuidv4();
  await addToOutbox(batchClientId, deviceId, 'trajectory_batch', {
    agentId,
    points: points.map((p) => ({
      clientId: p.clientId,
      deviceId: p.deviceId,
      shiftId: p.shiftId,
      visitId: p.visitId,
      lat: p.lat,
      lng: p.lng,
      accuracyM: p.accuracyM,
      recordedAt: p.recordedAt,
    })),
  });
}
