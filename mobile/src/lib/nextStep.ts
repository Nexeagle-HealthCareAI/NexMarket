import { db, q, timesVisited, type Contact } from './db';
import { buildPlan, type PlanItem } from './plan';
import { cachedTasks, type Task } from './tasks';
import { haversineM, startOfDay, ymd } from './util';

/**
 * What the Today screen's one big card asks the agent to do next, worked out from the phone's own data:
 *  1. no shift                         → start the shift (or "day finished" if one already ended today)
 *  2. on shift, not checked in         → check in at the nearest panchayat still to visit
 *  3. checked in, partners due here    → meet the first of them
 *     checked in, nothing recorded yet → work in this panchayat (meet someone / add a partner)
 *  4. follow-ups overdue or due today  → call that partner (not yet talked to today)
 *  5. tasks overdue or due today       → that task
 *  6. everything done                  → finish for today (end shift)
 * Phases for the "2 of 4" bar: start, check in, work (3–5), finish.
 */

type DueContact = Extract<PlanItem, { kind: 'contact' }>;
export interface Place { id: string; name: string; distM: number | null }

export type NextStep =
  | { kind: 'start'; doneToday: boolean }
  | { kind: 'checkin'; place: Place | null; dueHere: number; partnersHere: number }
  | { kind: 'here'; place: Place }
  | { kind: 'meet'; item: DueContact; lastNote: string | null }
  | { kind: 'call'; item: DueContact }
  | { kind: 'task'; task: Task }
  | { kind: 'finish'; next: Place | null };

export const PHASES = 4;
export function phaseOf(s: NextStep): number {
  switch (s.kind) {
    case 'start': return s.doneToday ? PHASES : 1;
    case 'checkin': return 2;
    case 'finish': return 4;
    default: return 3;
  }
}

export interface TodayData {
  step: NextStep;
  /** Follow-ups (overdue / due today, not yet done today) other than the one on the card. */
  followUps: DueContact[];
  /** Open tasks, overdue and due first, other than the one on the card. */
  tasks: Task[];
  planStops: number;
  openTasks: number;
  visitsToday: number;
  partnersToday: number;
  referralsToday: number;
  patientsWeek: number;
  onShift: boolean;
  shiftStart: string | null;
  here: Place | null;
}

function weekStart(): string {
  const d = startOfDay();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d.toISOString();
}

const n = (sql: string, ...args: (string | number)[]) => db().getFirstSync<{ n: number }>(sql, ...args)?.n ?? 0;

/** Reads everything the Today screen shows. Call inside useDb so it re-runs when the phone's data changes. */
export function readToday(pos: { lat: number; lng: number } | null): TodayData {
  const today = startOfDay().toISOString();
  const todayYmd = ymd();
  const shift = q.activeShift();
  const visit = shift ? q.activeVisit() : null;
  const plan = buildPlan(pos);
  const notedToday = new Set(db().getAllSync<{ contactId: string }>('SELECT DISTINCT contactId FROM notes WHERE createdAt >= ?', today).map((r) => r.contactId));
  const due = plan.filter((p): p is DueContact => p.kind === 'contact' && !notedToday.has(p.id));
  const places = plan.filter((p): p is Extract<PlanItem, { kind: 'panchayat' }> => p.kind === 'panchayat');

  const open = cachedTasks().filter((x) => x.status === 'open')
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || (a.priority === 'high' ? -1 : 0) - (b.priority === 'high' ? -1 : 0));
  const dueTasks = open.filter((x) => x.dueDate != null && x.dueDate.slice(0, 10) <= todayYmd);

  const visitsToday = n('SELECT COUNT(*) AS n FROM visits WHERE checkInAt >= ?', today);
  const placeName = (id: string) => q.assignedOne(id)?.name ?? q.panchayat(id)?.name ?? '';
  const here: Place | null = visit ? { id: visit.panchayatId, name: placeName(visit.panchayatId), distM: null } : null;

  // The nearest panchayat still to visit today (or, if all are done, the nearest one at all), not the one the agent is in.
  const nextPlace = (): Place | null => {
    const p = places.find((x) => x.id !== here?.id);
    if (p) return { id: p.id, name: p.panchayat.name, distM: p.distM };
    const dist = (a: { lat: number | null; lng: number | null }) => (pos && a.lat != null && a.lng != null ? haversineM(pos, { lat: a.lat, lng: a.lng }) : null);
    const any = q.assigned().filter((x) => x.panchayatId !== here?.id)
      .sort((a, b) => (dist(a) ?? 1e12) - (dist(b) ?? 1e12) || timesVisited(a) - timesVisited(b) || a.name.localeCompare(b.name))[0];
    return any ? { id: any.panchayatId, name: any.name, distM: dist(any) } : null;
  };

  let step: NextStep;
  let shown: string | null = null; // the card's partner or task, left out of "Also today"
  if (!shift) {
    step = { kind: 'start', doneToday: n('SELECT COUNT(*) AS n FROM shifts WHERE endTime IS NOT NULL AND endTime >= ?', today) > 0 };
  } else if (!visit) {
    const place = nextPlace();
    step = {
      kind: 'checkin', place,
      dueHere: place ? due.filter((c) => c.contact.panchayatId === place.id).length : 0,
      partnersHere: place ? q.contactsIn(place.id).length : 0,
    };
  } else {
    const dueHere = due.find((c) => c.contact.panchayatId === visit.panchayatId);
    // Anything recorded in this panchayat since checking in: a meeting, a note, or a new partner.
    const recorded = n(`SELECT COUNT(*) AS n FROM notes nt JOIN contacts c ON c.clientId = nt.contactId
                         WHERE c.panchayatId = ? AND nt.createdAt >= ?`, visit.panchayatId, visit.checkInAt)
      + n('SELECT COUNT(*) AS n FROM contacts WHERE panchayatId = ? AND createdAt >= ?', visit.panchayatId, visit.checkInAt);
    const callable = due.find((c) => c.contact.panchayatId !== visit.panchayatId);
    if (dueHere) {
      const last = q.lastNote(dueHere.id)?.text.replace(/\s+/g, ' ').trim() ?? null;
      step = { kind: 'meet', item: dueHere, lastNote: last };
      shown = dueHere.id;
    } else if (recorded === 0) {
      step = { kind: 'here', place: here! };
    } else if (callable) {
      step = { kind: 'call', item: callable };
      shown = callable.id;
    } else if (dueTasks[0]) {
      step = { kind: 'task', task: dueTasks[0] };
      shown = dueTasks[0].id;
    } else {
      step = { kind: 'finish', next: nextPlace() };
    }
  }

  return {
    step,
    followUps: due.filter((c) => c.id !== shown),
    tasks: open.filter((x) => x.id !== shown),
    planStops: plan.length,
    openTasks: open.length,
    visitsToday,
    partnersToday: n('SELECT COUNT(*) AS n FROM contacts WHERE createdAt >= ?', today),
    referralsToday: n('SELECT COUNT(*) AS n FROM referrals WHERE createdAt >= ?', today),
    patientsWeek: n('SELECT COUNT(*) AS n FROM referrals WHERE createdAt >= ?', weekStart()),
    onShift: !!shift,
    shiftStart: shift?.startTime ?? null,
    here,
  };
}

export type { Contact };
