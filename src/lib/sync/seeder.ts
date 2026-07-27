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
import type { LocalPanchayat } from '../db/schema';

export async function seedPanchayatsIfEmpty(token: string): Promise<void> {
  const count = await db.panchayats.count();
  if (count > 0) return; // Already seeded

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000'}/api/panchayats`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!response.ok) {
    throw new Error(`Failed to seed panchayats: ${response.status}`);
  }

  const panchayats: LocalPanchayat[] = await response.json();
  await db.panchayats.bulkPut(panchayats);
}
