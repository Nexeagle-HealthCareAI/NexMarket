import { api, get, post, ApiError, OfflineError } from './api';
import { kvJson, kvSet, notifyChange } from './db';
import { nowIso, uuid } from './util';
import type { ReadingInput } from './repo';

/**
 * Health camps in the field app. Every agent sees every upcoming camp and can book a person into it; the hospital's
 * WhatsApp sends them their token by itself. On the camp day anyone can find a person (name, mobile, panchayat or
 * token) and mark them arrived or not come; the office's CRM shows the same list.
 *
 * Works without signal: a booking or a mark waits on the phone (in order) and goes when there is signal. The camp-day
 * list is kept on the phone too, so search and marking keep working in a hall with no network.
 */

export interface Camp {
  id: string; title: string; code: string; typeLabel: string; date: string; startTime: string; endTime: string;
  venue: string | null; block: string | null; district: string | null; panchayatId: string | null; status: string;
  capacity: number; booked: number; arrived: number; noShow: number; mine: number; placesLeft: number;
}
export interface CampVitals {
  bpSystolic: number | null; bpDiastolic: number | null; pulse: number | null; tempF: number | null; spo2: number | null;
  weightKg: number | null; sugar: number | null; sugarKind: string | null;
}
export type CampStatus = 'booked' | 'attended' | 'no_show';
/** A person I booked into a camp. Before it reaches the office it has no id or token yet (`pending`). */
export interface CampBooking {
  id: string | null; clientId: string | null; campId: string; campTitle: string; campDate: string; startTime: string; endTime: string; place: string;
  token: number | null; name: string; age: number | null; sex: string | null; phone: string | null; village: string | null; panchayatId: string | null;
  status: CampStatus; arrivedAt: string | null; complaint: string | null; waStatus: string | null; waError: string | null; createdAt: string;
  vitals: CampVitals | null; pending?: boolean; error?: string | null;
}
/** One person in a camp's list on the camp day. */
export interface CampPerson {
  id: string; token: number; name: string; age: number | null; sex: string | null; phone: string | null; village: string | null;
  status: CampStatus; arrivedAt: string | null; statusAt: string | null; statusVia: string | null; statusBy: string | null;
  source: string; byMe: boolean; bookedBy: string | null; complaint: string | null; vitals: CampVitals | null; unsent?: boolean;
}
export interface CampDay {
  camp: { id: string; title: string; date: string; startTime: string; endTime: string; place: string; capacity: number; isToday: boolean };
  counts: { waiting: number; arrived: number; noShow: number };
  places: { name: string; n: number }[];
  items: CampPerson[];
  at: string;
}
interface CampList { today: string; camps: Camp[]; bookings: CampBooking[] }

export interface BookingInput {
  campId: string; name: string; age: number; sex: string; phone: string; panchayatId: string | null; village: string | null; complaint: string;
  vitals?: Partial<CampVitals> | null;
  /** A walk-in at the camp: mark them arrived as soon as the booking reaches the office. */
  arrived?: boolean;
}
type MarkBody = { status?: CampStatus; complaint?: string } & Partial<CampVitals>;
type Op =
  | { opId: string; kind: 'book'; clientId: string; input: BookingInput; createdAt: string; error?: string | null; camp?: Pick<Camp, 'title' | 'date' | 'startTime' | 'endTime' | 'venue' | 'block'> }
  | { opId: string; kind: 'mark'; personId: string; campId: string; body: MarkBody; createdAt: string; error?: string | null };

const K_LIST = 'camps.list';
const K_QUEUE = 'camps.queue';
const kDay = (id: string) => `camps.day.${id}`;

export const campList = (): CampList | null => kvJson<CampList | null>(K_LIST, null);
const queue = (): Op[] => kvJson<Op[]>(K_QUEUE, []);
const saveQueue = (q: Op[]) => { kvSet(K_QUEUE, q.length ? JSON.stringify(q) : null); notifyChange(); };
export const campOpsWaiting = (): number => queue().length;

export async function refreshCamps(): Promise<void> {
  const r = await get<CampList>('/api/v1/me/camps');
  kvSet(K_LIST, JSON.stringify(r));
  notifyChange();
}

/** Upcoming camps, those in my block first (then by date). */
export function sortCamps(camps: Camp[], myBlock: string | null | undefined): Camp[] {
  const b = (myBlock ?? '').trim().toLowerCase();
  return [...camps].sort((x, y) => Number((y.block ?? '').toLowerCase() === b && !!b) - Number((x.block ?? '').toLowerCase() === b && !!b) || x.date.localeCompare(y.date) || x.startTime.localeCompare(y.startTime));
}

/** My bookings: the ones the office has, with those still on the phone on top. */
export function myBookings(): CampBooking[] {
  const list = campList();
  const camps = new Map((list?.camps ?? []).map((c) => [c.id, c]));
  const waiting = queue().filter((o): o is Extract<Op, { kind: 'book' }> => o.kind === 'book').map((o): CampBooking => {
    const c = camps.get(o.input.campId) ?? o.camp;
    return {
      id: null, clientId: o.clientId, campId: o.input.campId, campTitle: c?.title ?? '', campDate: c?.date ?? '', startTime: c?.startTime ?? '', endTime: c?.endTime ?? '',
      place: [c?.venue, c?.block].filter(Boolean).join(', '), token: null, name: o.input.name.trim(), age: o.input.age, sex: o.input.sex, phone: o.input.phone || null,
      village: o.input.village, panchayatId: o.input.panchayatId, status: o.input.arrived ? 'attended' : 'booked', arrivedAt: null, complaint: o.input.complaint || null,
      waStatus: null, waError: null, createdAt: o.createdAt, vitals: o.input.vitals ? { ...EMPTY_VITALS, ...o.input.vitals } : null, pending: true, error: o.error ?? null,
    };
  });
  return [...waiting, ...(list?.bookings ?? []).filter((b) => !waiting.some((w) => w.clientId && w.clientId === b.clientId))];
}

export const bookingByClientId = (clientId: string): CampBooking | null => myBookings().find((b) => b.clientId === clientId) ?? null;

const EMPTY_VITALS: CampVitals = { bpSystolic: null, bpDiastolic: null, pulse: null, tempF: null, spo2: null, weightKg: null, sugar: null, sugarKind: null };

/** Keeps the booking on the phone and tries to send it. Returns its own id (to show the token once it is known). */
export async function bookCamp(input: BookingInput): Promise<string> {
  const clientId = uuid();
  const c = campList()?.camps.find((x) => x.id === input.campId);
  saveQueue([...queue(), { opId: uuid(), kind: 'book', clientId, input, createdAt: nowIso(), camp: c ? { title: c.title, date: c.date, startTime: c.startTime, endTime: c.endTime, venue: c.venue, block: c.block } : undefined }]);
  await flushCamps();
  return clientId;
}

/** Complaint and vitals for a booking still on the phone go with it. */
export function editWaitingBooking(clientId: string, patch: { complaint?: string; vitals?: Partial<CampVitals> }) {
  saveQueue(queue().map((o) => (o.kind === 'book' && o.clientId === clientId
    ? { ...o, input: { ...o.input, ...(patch.complaint != null ? { complaint: patch.complaint } : {}), ...(patch.vitals ? { vitals: { ...(o.input.vitals ?? {}), ...patch.vitals } } : {}) } }
    : o)));
}

export function dropWaitingBooking(clientId: string) { saveQueue(queue().filter((o) => !(o.kind === 'book' && o.clientId === clientId))); }

/**
 * Arrived, didn't come, or undo — and/or the complaint and vitals. Shows at once on the phone; goes to the office now
 * or when there is signal.
 */
export async function markPerson(campId: string, personId: string, body: MarkBody): Promise<void> {
  const day = campDay(campId);
  if (day) {
    const now = nowIso();
    const items = day.items.map((p) => (p.id === personId ? {
      ...p, ...(body.complaint != null ? { complaint: body.complaint || null } : {}),
      ...(body.status ? { status: body.status, statusAt: now, statusBy: 'me', statusVia: 'app', arrivedAt: body.status === 'attended' ? now : null } : {}),
      ...(hasVitals(body) ? { vitals: { ...(p.vitals ?? EMPTY_VITALS), ...pickVitals(body) } } : {}),
      unsent: true,
    } : p));
    kvSet(kDay(campId), JSON.stringify({ ...day, items, counts: countsOf(items) }));
  }
  // My own bookings list shows it at once too.
  const list = campList();
  if (list?.bookings.some((b) => b.id === personId)) {
    kvSet(K_LIST, JSON.stringify({ ...list, bookings: list.bookings.map((b) => (b.id === personId ? {
      ...b, ...(body.status ? { status: body.status } : {}), ...(body.complaint != null ? { complaint: body.complaint || null } : {}),
      ...(hasVitals(body) ? { vitals: { ...(b.vitals ?? EMPTY_VITALS), ...pickVitals(body) } } : {}),
    } : b)) }));
  }
  saveQueue([...queue(), { opId: uuid(), kind: 'mark', personId, campId, body, createdAt: nowIso() }]);
  await flushCamps();
}

/** Complaint or vitals for one of my bookings: with the booking while it is still on the phone, else to the office. */
export async function saveBookingDetails(b: CampBooking, patch: { complaint?: string; vitals?: Partial<CampVitals> }): Promise<void> {
  if (b.pending || !b.id) { if (b.clientId) editWaitingBooking(b.clientId, patch); return; }
  await markPerson(b.campId, b.id, { ...(patch.complaint != null ? { complaint: patch.complaint } : {}), ...(patch.vitals ?? {}) });
}

const VITAL_KEYS = ['bpSystolic', 'bpDiastolic', 'pulse', 'tempF', 'spo2', 'weightKg', 'sugar', 'sugarKind'] as const;
const hasVitals = (b: Partial<CampVitals>) => VITAL_KEYS.some((k) => b[k] != null);
const pickVitals = (b: Partial<CampVitals>): Partial<CampVitals> => Object.fromEntries(VITAL_KEYS.filter((k) => b[k] != null).map((k) => [k, b[k]]));

/** The vitals sheet's reading, in the fields a camp booking keeps. */
export const campVitals = (v: ReadingInput): Partial<CampVitals> => pickVitals({
  bpSystolic: v.bpSystolic, bpDiastolic: v.bpDiastolic, pulse: v.pulse, tempF: v.tempF, spo2: v.spo2, weightKg: v.weightKg, sugar: v.sugar, sugarKind: v.sugarKind,
});

export function countsOf(items: CampPerson[]): CampDay['counts'] {
  return { waiting: items.filter((p) => p.status === 'booked').length, arrived: items.filter((p) => p.status === 'attended').length, noShow: items.filter((p) => p.status === 'no_show').length };
}

export const campDay = (campId: string): CampDay | null => kvJson<CampDay | null>(kDay(campId), null);

/** The whole camp-day list from the office (marks still on the phone stay shown as made). */
export async function refreshCampDay(campId: string): Promise<CampDay> {
  const r = await get<Omit<CampDay, 'at'>>(`/api/v1/me/camps/${campId}/people`);
  const waiting = queue().filter((o): o is Extract<Op, { kind: 'mark' }> => o.kind === 'mark' && o.campId === campId);
  const items = r.items.map((p) => {
    const mine = waiting.filter((o) => o.personId === p.id);
    if (!mine.length) return p;
    return mine.reduce<CampPerson>((acc, o) => ({
      ...acc, ...(o.body.status ? { status: o.body.status, statusBy: 'me', statusVia: 'app' } : {}), ...(o.body.complaint != null ? { complaint: o.body.complaint } : {}),
      ...(hasVitals(o.body) ? { vitals: { ...(acc.vitals ?? EMPTY_VITALS), ...pickVitals(o.body) } } : {}), unsent: true,
    }), p);
  });
  const day: CampDay = { ...r, items, counts: countsOf(items), at: nowIso() };
  kvSet(kDay(campId), JSON.stringify(day));
  notifyChange();
  return day;
}

/** Search the camp-day list on the phone: name, mobile (last digits), panchayat, or the token number. */
export function searchPeople(items: CampPerson[], text: string): CampPerson[] {
  const s = text.trim().toLowerCase();
  if (!s) return items;
  const digits = s.replace(/\D/g, '');
  if (digits && digits.length === s.replace(/\s/g, '').length) {
    return items.filter((p) => String(p.token) === digits || (digits.length >= 3 && (p.phone ?? '').replace(/\D/g, '').includes(digits)));
  }
  return items.filter((p) => p.name.toLowerCase().includes(s) || (p.village ?? '').toLowerCase().includes(s));
}

let flushing: Promise<void> | null = null;
/** Sends what waits on the phone, oldest first. Safe to call often; never throws. */
export function flushCamps(): Promise<void> {
  flushing ??= (async () => {
    let sent = false;
    const touched = new Set<string>();
    for (const o of queue()) {
      const done = () => saveQueue(queue().filter((x) => x.opId !== o.opId));
      const fail = (msg: string) => saveQueue(queue().map((x) => (x.opId === o.opId ? { ...x, error: msg } : x)));
      try {
        if (o.kind === 'book') {
          const i = o.input;
          const r = await post<{ existed: boolean; booking: CampBooking }>(`/api/v1/me/camps/${i.campId}/book`, {
            clientId: o.clientId, name: i.name, age: i.age, sex: i.sex, phone: i.phone, panchayatId: i.panchayatId, village: i.village, complaint: i.complaint, ...(i.vitals ?? {}),
          }, 30000);
          // Keep the booking in my list right away (before it leaves the queue), so the token shows at once.
          const list = campList() ?? { today: '', camps: [], bookings: [] };
          kvSet(K_LIST, JSON.stringify({ ...list, bookings: [{ ...r.booking, clientId: o.clientId }, ...list.bookings.filter((b) => b.id !== r.booking.id)] }));
          done();
          if (i.arrived && r.booking.id) saveQueue([{ opId: uuid(), kind: 'mark', personId: r.booking.id, campId: i.campId, body: { status: 'attended' }, createdAt: nowIso() }, ...queue()]);
          touched.add(i.campId);
        } else {
          await api(`/api/v1/me/camps/people/${o.personId}`, { method: 'PATCH', body: JSON.stringify(o.body), timeoutMs: 30000 });
          done();
          touched.add(o.campId);
        }
        sent = true;
      } catch (e) {
        if (e instanceof OfflineError) break; // no signal: the rest waits too, in order
        if (e instanceof ApiError && e.status === 401) break;
        if (e instanceof ApiError && (e.status === 404 || e.status === 400) && o.kind === 'mark') { done(); continue; } // removed or refused at the office: its list shows what stands
        fail(e instanceof Error ? e.message : 'Could not send');
      }
    }
    if (sent) {
      await refreshCamps().catch(() => undefined);
      for (const id of touched) if (campDay(id)) await refreshCampDay(id).catch(() => undefined);
    }
    notifyChange();
  })().finally(() => { flushing = null; });
  return flushing;
}

/** "ok" when the token went on WhatsApp, "wait" when it is still to go, "none" without a mobile, "fail" otherwise. */
export function tokenState(b: Pick<CampBooking, 'phone' | 'waStatus' | 'pending'>): 'ok' | 'wait' | 'none' | 'fail' {
  if (!b.phone) return 'none';
  if (b.pending) return 'wait';
  if (b.waStatus === 'sent' || b.waStatus === 'delivered' || b.waStatus === 'read') return 'ok';
  return b.waStatus ? 'fail' : 'wait';
}

/** Short pieces for the vitals taken at booking: "BP 150/95", "Sugar 210". */
export function vitalBits(v: Partial<CampVitals>): string[] {
  return [
    v.bpSystolic ? `BP ${v.bpSystolic}/${v.bpDiastolic ?? '–'}` : null, v.sugar ? `Sugar ${v.sugar}` : null, v.pulse ? `Pulse ${v.pulse}` : null,
    v.spo2 ? `SpO2 ${v.spo2}%` : null, v.tempF ? `${v.tempF}°F` : null, v.weightKg ? `${v.weightKg} kg` : null,
  ].filter((x): x is string => !!x);
}
