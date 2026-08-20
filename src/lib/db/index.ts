/**
 * Dexie instance + useLiveQuery hooks
 *
 * Rule: ONLY this module (and outbox.ts) may import from schema.ts directly.
 * Components call these hooks — never db.* directly.
 */

'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { v4 as uuidv4 } from 'uuid';
import { db } from './schema';
import type {
  LocalContact,
  LocalPanchayat,
  LocalReferral,
  LocalShift,
  LocalVisit,
} from './schema';

export { db };

// ─── Panchayats ───────────────────────────────────────────────────────────────

export function usePanchayats(district?: string) {
  return useLiveQuery(async () => {
    if (district) {
      return db.panchayats
        .where('district')
        .equals(district)
        .sortBy('name');
    }
    return db.panchayats.orderBy('name').toArray();
  }, [district]);
}

export function usePanchayat(id: string | undefined) {
  return useLiveQuery(
    async () => (id ? db.panchayats.get(id) : undefined),
    [id],
  );
}

// ─── Contacts ─────────────────────────────────────────────────────────────────

export function useContacts(agentId?: string) {
  return useLiveQuery(async () => {
    if (agentId) {
      return db.contacts
        .where('agentId')
        .equals(agentId)
        .reverse()
        .sortBy('createdAt');
    }
    return db.contacts.orderBy('createdAt').reverse().toArray();
  }, [agentId]);
}

export function useContactsByPanchayat(panchayatId: string | undefined) {
  return useLiveQuery(
    async () =>
      panchayatId
        ? db.contacts.where('panchayatId').equals(panchayatId).toArray()
        : [],
    [panchayatId],
  );
}

export function useContact(clientId: string | undefined) {
  return useLiveQuery(
    async () => (clientId ? (await db.contacts.toArray()).find(c => c.clientId === clientId) : undefined),
    [clientId],
  );
}

export function useContactDocuments(contactClientId: string | undefined) {
  return useLiveQuery(
    async () => (contactClientId ? db.contactDocuments.where('contactId').equals(contactClientId).toArray() : undefined),
    [contactClientId],
  );
}

export function useFlaggedDuplicates() {
  return useLiveQuery(() =>
    db.contacts
      .filter((c) => !!(c.potentialDuplicateOf && c.potentialDuplicateOf.length > 0))
      .toArray(),
  );
}

// ─── Visits ───────────────────────────────────────────────────────────────────

export function useVisits(agentId?: string) {
  return useLiveQuery(async () => {
    if (agentId) {
      return db.visits
        .where('agentId')
        .equals(agentId)
        .reverse()
        .sortBy('checkInAt');
    }
    return db.visits.orderBy('checkInAt').reverse().toArray();
  }, [agentId]);
}

export function useActiveVisit(agentId: string | undefined) {
  return useLiveQuery(
    async () =>
      agentId
        ? db.visits
            .where('agentId')
            .equals(agentId)
            .filter((v) => !v.checkOutAt)
            .first()
        : undefined,
    [agentId],
  );
}

export function useVisit(clientId: string | undefined) {
  return useLiveQuery(
    async () => (clientId ? db.visits.where('clientId').equals(clientId).first() : undefined),
    [clientId],
  );
}

// ─── Shifts ───────────────────────────────────────────────────────────────────

export function useActiveShift(agentId: string | undefined) {
  return useLiveQuery(
    async () =>
      agentId
        ? db.shifts
            .where('agentId')
            .equals(agentId)
            .filter((s) => !s.endAt)
            .first()
        : undefined,
    [agentId],
  );
}

export function useShifts(agentId?: string) {
  return useLiveQuery(async () => {
    if (agentId) {
      return db.shifts.where('agentId').equals(agentId).reverse().sortBy('startAt');
    }
    return db.shifts.orderBy('startAt').reverse().toArray();
  }, [agentId]);
}

// ─── Referrals ────────────────────────────────────────────────────────────────

export function useReferrals(contactId?: string) {
  return useLiveQuery(async () => {
    if (contactId) {
      return db.referrals.where('contactId').equals(contactId).toArray();
    }
    return db.referrals.toArray();
  }, [contactId]);
}

// ─── Sync Outbox ──────────────────────────────────────────────────────────────

export function useOutboxCount() {
  return useLiveQuery(() => db.syncOutbox.count());
}

// ─── Sync State ───────────────────────────────────────────────────────────────

export async function getSyncStateValue(key: string): Promise<string | undefined> {
  const entry = await db.syncState.get(key);
  return entry?.value;
}

export async function setSyncStateValue(key: string, value: string): Promise<void> {
  await db.syncState.put({ key, value });
}

/**
 * A device identity is a per-installation concept for the [clientId+deviceId]
 * offline idempotency key, so it must be generated and persisted on the
 * client — never re-issued by the server on every login, or previously
 * synced data would orphan under a stale id on the next sign-in.
 */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await getSyncStateValue('deviceId');
  if (existing) return existing;

  const deviceId = uuidv4();
  await setSyncStateValue('deviceId', deviceId);
  return deviceId;
}

// ─── TTL Sweep — removes synced trajectory points older than 7 days ──────────

export async function pruneOldTrajectoryPoints(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const toDelete = await db.trajectoryPoints
    .where('syncedAt')
    .below(cutoff)
    .primaryKeys();
  await db.trajectoryPoints.bulkDelete(toDelete as number[]);
  return toDelete.length;
}

// ─── Reinstall Recovery: check if DB is empty (first login or after wipe) ────

export async function isLocalDatabaseEmpty(): Promise<boolean> {
  const contactCount = await db.contacts.count();
  const visitCount = await db.visits.count();
  return contactCount === 0 && visitCount === 0;
}
