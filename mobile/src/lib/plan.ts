import { db, type Assigned, type Contact } from './db';
import { daysFromToday, haversineM, ymd } from './util';

export type PlanItem =
  | { kind: 'contact'; id: string; contact: Contact; panchayatName: string | null; overdueDays: number; lat: number | null; lng: number | null; distM: number | null }
  | { kind: 'panchayat'; id: string; panchayat: Assigned; partners: number; lat: number | null; lng: number | null; distM: number | null };

const PRIO_RANK: Record<string, number> = { very_high: 0, high: 1, normal: 2, low: 3 };

/**
 * Today's plan, in the order the agent should work it:
 *  1. follow-ups that are overdue or due today — most important partner first, then most overdue;
 *  2. assigned panchayats not visited yet — nearest first.
 */
export function buildPlan(here: { lat: number; lng: number } | null): PlanItem[] {
  const today = ymd();
  const d = db();
  const due = d.getAllSync<Contact & { pName: string | null; pLat: number | null; pLng: number | null }>(
    `SELECT c.*, COALESCE(a.name, p.name) AS pName, COALESCE(a.lat, p.lat) AS pLat, COALESCE(a.lng, p.lng) AS pLng
       FROM contacts c LEFT JOIN assigned a ON a.panchayatId = c.panchayatId LEFT JOIN panchayats p ON p.id = c.panchayatId
      WHERE c.followUpDate IS NOT NULL AND c.followUpDate <= ?`, today);
  const dist = (lat: number | null, lng: number | null) => (here && lat != null && lng != null ? haversineM(here, { lat, lng }) : null);

  const contacts: PlanItem[] = due.map((c) => {
    const lat = c.lat ?? c.pLat;
    const lng = c.lng ?? c.pLng;
    return { kind: 'contact' as const, id: c.clientId, contact: c, panchayatName: c.pName, overdueDays: -daysFromToday(c.followUpDate!), lat, lng, distM: dist(lat, lng) };
  });
  contacts.sort((a, b) => {
    const ca = (a as Extract<PlanItem, { kind: 'contact' }>);
    const cb = (b as Extract<PlanItem, { kind: 'contact' }>);
    return (PRIO_RANK[ca.contact.priority] ?? 2) - (PRIO_RANK[cb.contact.priority] ?? 2)
      || cb.overdueDays - ca.overdueDays
      || (ca.distM ?? 1e12) - (cb.distM ?? 1e12);
  });

  const counts = new Map(d.getAllSync<{ panchayatId: string; n: number }>('SELECT panchayatId, COUNT(*) AS n FROM contacts GROUP BY panchayatId').map((r) => [r.panchayatId, r.n]));
  const places: PlanItem[] = d.getAllSync<Assigned>('SELECT * FROM assigned WHERE visited = 0').map((p) => ({
    kind: 'panchayat' as const, id: p.panchayatId, panchayat: p, partners: counts.get(p.panchayatId) ?? 0, lat: p.lat, lng: p.lng, distM: dist(p.lat, p.lng),
  }));
  places.sort((a, b) => (a.distM ?? 1e12) - (b.distM ?? 1e12) || (a.kind === 'panchayat' && b.kind === 'panchayat' ? a.panchayat.name.localeCompare(b.panchayat.name) : 0));

  return [...contacts, ...places];
}

export function formatDist(m: number | null, t: (k: 'km' | 'm', v: { n: string | number }) => string): string {
  if (m == null) return '';
  return m >= 1000 ? t('km', { n: (m / 1000).toFixed(m >= 10000 ? 0 : 1) }) : t('m', { n: Math.round(m / 10) * 10 });
}
