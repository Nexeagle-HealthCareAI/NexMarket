import { q } from './db';
import { checkIn, checkOut } from './repo';
import { currentPosition, quickPosition, recordPoint } from './location';
import { CHECK_IN_RADIUS_M } from './config';
import { haversineM } from './util';

export type CheckInResult = { ok: true; distM: number | null } | { ok: false; why: 'no-fix' } | { ok: false; why: 'far'; distM: number };

/**
 * Checks in at a panchayat (leaving the current one first). Works the same from Start shift and from
 * the panchayat list, and for a first visit or a revisit. Needs to be within reach of the panchayat
 * centre unless only the block centre is known, or the agent chose to check in anyway (`anyDistance`):
 * then the real location is saved with the check-in, so the office sees where they were.
 */
export async function tryCheckIn(panchayatId: string, opts: { anyDistance?: boolean } = {}): Promise<CheckInResult> {
  const pos = (await currentPosition()) ?? (await quickPosition());
  if (!pos) return { ok: false, why: 'no-fix' };
  const a = q.assignedOne(panchayatId);
  const p = q.panchayat(panchayatId);
  const lat = a?.lat ?? p?.lat ?? null, lng = a?.lng ?? p?.lng ?? null;
  const approx = a != null && (a.source ?? 'block') === 'block';
  const distM = lat != null && lng != null ? haversineM(pos, { lat, lng }) : null;
  if (!approx && !opts.anyDistance && distM != null && distM > CHECK_IN_RADIUS_M) return { ok: false, why: 'far', distM };
  const current = q.activeVisit();
  if (current?.panchayatId === panchayatId) return { ok: true, distM };
  if (current) checkOut(current.clientId, pos.lat, pos.lng);
  checkIn(panchayatId, pos.lat, pos.lng);
  recordPoint(pos.lat, pos.lng, pos.accuracy);
  return { ok: true, distM: approx ? null : distM };
}
