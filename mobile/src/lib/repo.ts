import { db, kvGet, notifyChange, q, type Contact, type Referral } from './db';
import { nowIso, uuid, ymd } from './util';
import type { Priority } from '../theme';

/**
 * Every change the agent makes goes through here: write the row on the phone, then
 * queue the same thing in the outbox with the exact payload the server's sync handler
 * reads (see SyncBatchCommandHandler.cs). Nothing waits for the network.
 */

export function me() {
  return { agentId: kvGet('agentId') ?? '', deviceId: kvGet('deviceId') ?? '' };
}

/** Queue an item. For a record not yet sent, a newer version replaces the queued one. */
export function enqueue(type: string, clientId: string, payload: Record<string, unknown>, replaceTypes: string[] = []) {
  const json = JSON.stringify(payload);
  const d = db();
  if (replaceTypes.length) {
    const marks = replaceTypes.map(() => '?').join(',');
    const existing = d.getFirstSync<{ id: number; type: string }>(
      `SELECT id, type FROM outbox WHERE clientId = ? AND type IN (${marks}) ORDER BY id DESC LIMIT 1`,
      clientId, ...replaceTypes);
    if (existing) {
      // createdAt doubles as the edit time the server compares with its own last change.
      d.runSync('UPDATE outbox SET payload = ?, createdAt = ?, attempts = 0, lastError = NULL WHERE id = ?', json, nowIso(), existing.id);
      return;
    }
  }
  d.runSync('INSERT INTO outbox (clientId, type, payload, createdAt) VALUES (?, ?, ?, ?)', clientId, type, json, nowIso());
}

// ─── Shift ─────────────────────────────────────────────────────────────────

export function startShift(lat: number, lng: number): string {
  const { agentId, deviceId } = me();
  const clientId = uuid();
  const at = nowIso();
  db().runSync('INSERT INTO shifts (clientId, startTime, startLat, startLng) VALUES (?, ?, ?, ?)', clientId, at, lat, lng);
  enqueue('shift_start', clientId, {
    clientId, deviceId, agentId, startTime: at, startAt: at, startLat: lat, startLng: lng,
  });
  notifyChange();
  return clientId;
}

export function endShift(lat: number | null, lng: number | null) {
  const s = q.activeShift();
  if (!s) return;
  const { agentId, deviceId } = me();
  const at = nowIso();
  // Close any open visit first so the day's records stay consistent.
  const v = q.activeVisit();
  if (v) checkOut(v.clientId, lat, lng);
  db().runSync('UPDATE shifts SET endTime = ?, endLat = ?, endLng = ? WHERE clientId = ?', at, lat, lng, s.clientId);
  // shift_end is processed as an update of the same clientId, so it must follow shift_start.
  enqueue('shift_end', s.clientId, {
    clientId: s.clientId, deviceId, agentId, startTime: s.startTime, startAt: s.startTime,
    startLat: s.startLat, startLng: s.startLng, endTime: at, endAt: at, endLat: lat, endLng: lng,
  });
  notifyChange();
}

// ─── Visits ────────────────────────────────────────────────────────────────

export function checkIn(panchayatId: string, lat: number, lng: number): string {
  const { agentId, deviceId } = me();
  const shift = q.activeShift();
  const clientId = uuid();
  const at = nowIso();
  db().runSync(
    'INSERT INTO visits (clientId, panchayatId, shiftId, checkInAt, checkInLat, checkInLng) VALUES (?, ?, ?, ?, ?, ?)',
    clientId, panchayatId, shift?.clientId ?? null, at, lat, lng);
  db().runSync('UPDATE assigned SET visited = 1, lastVisitedAt = ? WHERE panchayatId = ?', at, panchayatId);
  enqueue('visit_checkin', clientId, {
    clientId, deviceId, agentId, panchayatId, shiftId: shift?.clientId, checkInAt: at, checkInLat: lat, checkInLng: lng,
  });
  notifyChange();
  return clientId;
}

export function checkOut(visitId: string, lat: number | null, lng: number | null) {
  const v = db().getFirstSync<{ clientId: string; panchayatId: string; shiftId: string | null; checkInAt: string; checkInLat: number; checkInLng: number }>(
    'SELECT * FROM visits WHERE clientId = ?', visitId);
  if (!v) return;
  const { agentId, deviceId } = me();
  const at = nowIso();
  db().runSync('UPDATE visits SET checkOutAt = ?, checkOutLat = ?, checkOutLng = ? WHERE clientId = ?', at, lat, lng, visitId);
  enqueue('visit_checkout', visitId, {
    clientId: visitId, deviceId, agentId, panchayatId: v.panchayatId, shiftId: v.shiftId,
    checkInAt: v.checkInAt, checkInLat: v.checkInLat, checkInLng: v.checkInLng,
    checkOutAt: at, checkOutLat: lat, checkOutLng: lng,
  });
  notifyChange();
}

// ─── Contacts ──────────────────────────────────────────────────────────────

function contactPayload(c: Contact, extra: Record<string, unknown> = {}) {
  const { agentId, deviceId } = me();
  return {
    clientId: c.clientId, deviceId, agentId, panchayatId: c.panchayatId ?? '', shiftId: c.shiftId,
    role: c.role, profession: c.profession, name: c.name, phone: c.phone ?? '',
    whatsappAdded: !!c.whatsappAdded, cardGiven: !!c.cardGiven, status: c.status,
    followUpDate: c.followUpDate, lat: c.lat, lng: c.lng,
    isImportant: !!c.isImportant || c.priority === 'very_high', priority: c.priority,
    createdAt: c.createdAt, updatedAt: c.updatedAt,
    ...(c.synced ? { serverId: c.clientId } : {}),
    ...extra,
  };
}

/** Queue the contact's current state: as the not-yet-sent "new" item, or as an update. */
function queueContact(c: Contact, extra: Record<string, unknown> = {}) {
  if (c.synced) {
    enqueue('contact_update', c.clientId, contactPayload(c, extra), ['contact_update']);
  } else {
    // Still unsent: fold the change into the queued contact_new (the server ignores a
    // contact_new for a row it already has, so an update must not be sent before it).
    const pending = db().getFirstSync<{ payload: string }>(
      "SELECT payload FROM outbox WHERE clientId = ? AND type = 'contact_new' ORDER BY id DESC LIMIT 1", c.clientId);
    const keep = pending ? (JSON.parse(pending.payload) as Record<string, unknown>) : {};
    const photo = keep.photoDataUri ? { photoDataUri: keep.photoDataUri } : {};
    enqueue('contact_new', c.clientId, contactPayload(c, { ...photo, ...extra }), ['contact_new']);
  }
}

export interface NewContactInput {
  panchayatId: string;
  role: string;
  name: string;
  phone: string;
  whatsappAdded: boolean;
  cardGiven: boolean;
  lat: number | null;
  lng: number | null;
  photos: { dataUri: string; lat: number | null; lng: number | null; takenAt: string }[];
}

export function addContact(input: NewContactInput): string {
  const clientId = uuid();
  const at = nowIso();
  const shift = q.activeShift();
  const followUp = ymd(new Date(Date.now() + 3 * 86400000));
  db().runSync(
    `INSERT INTO contacts (clientId, synced, panchayatId, role, name, phone, whatsappAdded, cardGiven, status, priority,
       followUpDate, lat, lng, photoUri, shiftId, createdAt, updatedAt)
     VALUES (?, 0, ?, ?, ?, ?, ?, ?, 'Lead', 'normal', ?, ?, ?, ?, ?, ?, ?)`,
    clientId, input.panchayatId, input.role, input.name.trim(), input.phone.trim(), input.whatsappAdded ? 1 : 0,
    input.cardGiven ? 1 : 0, followUp, input.lat, input.lng, input.photos[0]?.dataUri ?? null, shift?.clientId ?? null, at, at);
  const c = q.contact(clientId)!;
  queueContact(c, input.photos[0] ? { photoDataUri: input.photos[0].dataUri } : {});
  // Every photo also goes up as a document carrying where and when it was taken.
  input.photos.forEach((p, i) => addPhoto(clientId, p, i === 0 ? 'Partner photo' : 'Photo'));
  notifyChange();
  return clientId;
}

export function addPhoto(contactId: string, p: { dataUri: string; lat: number | null; lng: number | null; takenAt: string }, label = 'Photo') {
  const { agentId, deviceId } = me();
  const clientId = uuid();
  enqueue('contact_document', clientId, {
    clientId, deviceId, contactId, agentId, dataUri: p.dataUri, mimeType: 'image/jpeg', label,
    exifLat: p.lat, exifLng: p.lng, exifCapturedAt: p.takenAt, createdAt: nowIso(),
  });
  notifyChange();
}

export function updateContact(clientId: string, patch: Partial<Pick<Contact, 'priority' | 'followUpDate' | 'status' | 'isImportant'>>) {
  const c = q.contact(clientId);
  if (!c) return;
  const next: Contact = { ...c, ...patch, updatedAt: nowIso() };
  if (patch.priority) next.isImportant = patch.priority === 'very_high' ? 1 : c.isImportant && patch.priority !== 'low' ? c.isImportant : 0;
  db().runSync(
    'UPDATE contacts SET priority = ?, followUpDate = ?, status = ?, isImportant = ?, updatedAt = ? WHERE clientId = ?',
    next.priority, next.followUpDate, next.status, next.isImportant, next.updatedAt, clientId);
  queueContact(next);
  notifyChange();
}

export function setPriority(clientId: string, priority: Priority) {
  updateContact(clientId, { priority });
}

export function setFollowUp(clientId: string, date: string | null) {
  updateContact(clientId, { followUpDate: date });
}

export function addNote(contactId: string, text: string, source: 'note' | 'visit' | 'call' = 'note') {
  const t = text.trim();
  if (!t) return;
  const { agentId, deviceId } = me();
  const clientId = uuid();
  const at = nowIso();
  db().runSync('INSERT INTO notes (clientId, contactId, text, source, createdAt) VALUES (?, ?, ?, ?, ?)', clientId, contactId, t, source, at);
  enqueue('contact_note', clientId, { clientId, deviceId, agentId, contactId, text: t, source, createdAt: at });
  notifyChange();
}

// ─── Referrals ─────────────────────────────────────────────────────────────

export interface NewReferralInput {
  contactId: string;
  patientName: string;
  patientAge: number | null;
  patientSex: 'M' | 'F' | 'O' | null;
  clientPhone: string;
  department: string;
  urgent: boolean;
  notes: string;
}

export function addReferral(input: NewReferralInput): string {
  const { agentId, deviceId } = me();
  const clientId = uuid();
  const at = nowIso();
  db().runSync(
    `INSERT INTO referrals (clientId, contactId, patientName, patientAge, patientSex, clientPhone, department, urgent, notes, status, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    clientId, input.contactId, input.patientName.trim(), input.patientAge, input.patientSex, input.clientPhone.trim() || null,
    input.department, input.urgent ? 1 : 0, input.notes.trim() || null, at);
  enqueue('referral_new', clientId, {
    clientId, deviceId, agentId, contactId: input.contactId, patientName: input.patientName.trim(),
    department: input.department, notes: input.notes.trim(), clientPhone: input.clientPhone.trim() || null,
    referralDate: ymd(), status: 'pending', patientAge: input.patientAge, patientSex: input.patientSex,
    urgent: input.urgent, consent: true, createdAt: at,
  });
  notifyChange();
  return clientId;
}

export type { Referral };

// ─── Survey ────────────────────────────────────────────────────────────────

export function saveSurvey(contactId: string, panchayatId: string | null, answers: Record<string, string>, skipReason?: string) {
  const { agentId, deviceId } = me();
  const clientId = uuid();
  const at = nowIso();
  const answersJson = JSON.stringify(answers);
  db().runSync(
    'INSERT INTO surveys (clientId, contactId, panchayatId, answersJson, isSkipped, skipReason, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    clientId, contactId, panchayatId, answersJson, skipReason ? 1 : 0, skipReason ?? null, at);
  enqueue('survey', clientId, {
    clientId, deviceId, agentId, contactId, panchayatId: panchayatId ?? undefined,
    isSkipped: !!skipReason, skipReason: skipReason ?? '', answersJson, createdAt: at,
  });
  notifyChange();
}

/** An agent's escalation: carried on the contact so the admin's escalation queue picks it up. */
export function raiseIssue(contactId: string, note: string) {
  const c = q.contact(contactId);
  if (!c) return;
  queueContact({ ...c, updatedAt: nowIso() }, { agentEscalated: true, agentEscalationNote: note.trim() });
  addNote(contactId, note, 'note');
}
