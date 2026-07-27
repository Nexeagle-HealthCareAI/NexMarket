/**
 * Panchayat seeder
 *
 * Called once on first login. Downloads the Seemanchal panchayat master list
 * from the server (which seeds from LGD Bihar data) and populates Dexie.
 *
 * This list is ~2500 rows / ~500 KB — fast to fetch once on WiFi, then
 * fully available offline forever.
 */

import { db } from '../db';
import { getPanchayats } from './api-client';

export async function seedPanchayatsIfEmpty(token: string): Promise<void> {
  const count = await db.panchayats.count();
  if (count > 0) return; // Already seeded

  const panchayats = await getPanchayats(token);
  await db.panchayats.bulkPut(
    panchayats.map((p) => ({
      ...p,
      centroidLat: p.centroidLat ?? undefined,
      centroidLng: p.centroidLng ?? undefined,
    })),
  );
}
