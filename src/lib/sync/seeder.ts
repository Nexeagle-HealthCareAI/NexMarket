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
import { getPanchayats, getReferenceData } from './api-client';

export async function seedPanchayatsIfEmpty(): Promise<void> {
  const count = await db.panchayats.count();
  if (count > 0) return; // Already seeded

  const panchayats = await getPanchayats();
  await db.panchayats.bulkPut(
    panchayats.map((p) => ({
      ...p,
      centroidLat: p.centroidLat ?? undefined,
      centroidLng: p.centroidLng ?? undefined,
    })),
  );
}

/**
 * Refreshes panchayats + the active questionnaire unconditionally (upsert,
 * not seed-if-empty) — call on every login and periodically while the app is
 * open, so admin-side reference-data changes reach devices that already
 * finished onboarding, not just brand-new installs.
 */
export async function refreshReferenceData(): Promise<void> {
  const { panchayats, surveyQuestions } = await getReferenceData();

  await db.panchayats.bulkPut(
    panchayats.map((p) => ({
      ...p,
      centroidLat: p.centroidLat ?? undefined,
      centroidLng: p.centroidLng ?? undefined,
    })),
  );

  await db.transaction('rw', db.surveyQuestions, async () => {
    await db.surveyQuestions.clear();
    await db.surveyQuestions.bulkPut(surveyQuestions);
  });
}
