import { q } from './db';
import { checkIn, checkOut } from './repo';
import { currentPosition, recordPoint } from './location';
import { CHECK_IN_RADIUS_M } from './config';
import { haversineM } from './util';

export type CheckInResult = { ok: true } | { ok: false; why: 'no-fix' } | { ok: false; why: 'far'; distM: number };

/**
 * Checks in at a panchayat (leaving the current one first). Works the same from Start shift and from
 * the panchayat list, and for a first visit or a revisit. Needs to be within reach of the panchayat
 * centre unless only the block centre is known.
 */
export async function tryCheckIn(panchayatId: string): Promise<CheckInResult> {
  const pos = await currentPosition();
  if (!pos) return { ok: false, why: 'no-fix' };
  const a = q.assignedOne(panchayatId);
  const p = q.panchayat(panchayatId);
  const lat = a?.lat ?? p?.lat ?? null, lng = a?.lng ?? p?.lng ?? null;
  const approx = a != null && (a.source ?? 'block') === 'block';
  if (!approx && lat != null && lng != null) {
    const distM = haversineM(pos, { lat, lng });
    if (distM > CHECK_IN_RADIUS_M) return { ok: false, why: 'far', distM };
  }
  const current = q.activeVisit();
  if (current?.panchayatId === panchayatId) return { ok: true };
  if (current) checkOut(current.clientId, pos.lat, pos.lng);
  checkIn(panchayatId, pos.lat, pos.lng);
  recordPoint(pos.lat, pos.lng, pos.accuracy);
  return { ok: true };
}
