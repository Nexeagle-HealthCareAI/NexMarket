import * as SQLite from 'expo-sqlite';
import type { Priority } from '../theme';

/**
 * The phone's own copy of the agent's work. Every write lands here first (with an
 * outbox row) so nothing is lost without signal; the sync engine sends it later.
 */
let _db: SQLite.SQLiteDatabase | null = null;

export function db(): SQLite.SQLiteDatabase {
  if (!_db) {
    _db = SQLite.openDatabaseSync('nexeagle-field.db');
    _db.execSync('PRAGMA journal_mode = WAL;');
    migrate(_db);
  }
  return _db;
}

const SCHEMA_VERSION = 2;

function migrate(d: SQLite.SQLiteDatabase) {
  const row = d.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  const v = row?.user_version ?? 0;
  if (v < 1) {
    d.execSync(`
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT);
      CREATE TABLE IF NOT EXISTS panchayats (
        id TEXT PRIMARY KEY NOT NULL, name TEXT, block TEXT, district TEXT, lat REAL, lng REAL);
      CREATE TABLE IF NOT EXISTS assigned (
        panchayatId TEXT PRIMARY KEY NOT NULL, name TEXT, visited INTEGER DEFAULT 0, lastVisitedAt TEXT,
        lat REAL, lng REAL, source TEXT);
      CREATE TABLE IF NOT EXISTS contacts (
        clientId TEXT PRIMARY KEY NOT NULL, synced INTEGER DEFAULT 0, panchayatId TEXT, role TEXT,
        profession TEXT, name TEXT, phone TEXT, whatsappAdded INTEGER DEFAULT 0, cardGiven INTEGER DEFAULT 0,
        status TEXT DEFAULT 'Lead', priority TEXT DEFAULT 'normal', isImportant INTEGER DEFAULT 0,
        followUpDate TEXT, lat REAL, lng REAL, photoUri TEXT, shiftId TEXT, createdAt TEXT, updatedAt TEXT);
      CREATE INDEX IF NOT EXISTS ix_contacts_follow ON contacts(followUpDate);
      CREATE INDEX IF NOT EXISTS ix_contacts_phone ON contacts(phone);
      CREATE TABLE IF NOT EXISTS notes (
        clientId TEXT PRIMARY KEY NOT NULL, contactId TEXT, text TEXT, source TEXT, createdAt TEXT);
      CREATE INDEX IF NOT EXISTS ix_notes_contact ON notes(contactId);
      CREATE TABLE IF NOT EXISTS shifts (
        clientId TEXT PRIMARY KEY NOT NULL, startTime TEXT, startLat REAL, startLng REAL,
        endTime TEXT, endLat REAL, endLng REAL);
      CREATE TABLE IF NOT EXISTS visits (
        clientId TEXT PRIMARY KEY NOT NULL, panchayatId TEXT, shiftId TEXT, checkInAt TEXT,
        checkInLat REAL, checkInLng REAL, checkOutAt TEXT, checkOutLat REAL, checkOutLng REAL);
      CREATE TABLE IF NOT EXISTS referrals (
        clientId TEXT PRIMARY KEY NOT NULL, contactId TEXT, patientName TEXT, patientAge INTEGER,
        patientSex TEXT, clientPhone TEXT, department TEXT, urgent INTEGER DEFAULT 0, notes TEXT,
        status TEXT DEFAULT 'pending', createdAt TEXT, updatedAt TEXT);
      CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY NOT NULL, questionId TEXT, text TEXT, type TEXT, optionsJson TEXT,
        section TEXT, isOptional INTEGER DEFAULT 0, ord INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS surveys (
        clientId TEXT PRIMARY KEY NOT NULL, contactId TEXT, panchayatId TEXT, answersJson TEXT,
        isSkipped INTEGER DEFAULT 0, skipReason TEXT, createdAt TEXT);
      CREATE TABLE IF NOT EXISTS trajectory (
        clientId TEXT PRIMARY KEY NOT NULL, shiftId TEXT, lat REAL, lng REAL, accuracy REAL,
        recordedAt TEXT, queued INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT, clientId TEXT NOT NULL, type TEXT NOT NULL,
        payload TEXT NOT NULL, createdAt TEXT NOT NULL, attempts INTEGER DEFAULT 0, lastError TEXT);
      CREATE INDEX IF NOT EXISTS ix_outbox_client ON outbox(clientId, type);
    `);
  }
  if (v < 2) {
    // How many times the agent has checked in at each panchayat (revisits count), from the server.
    try { d.execSync('ALTER TABLE assigned ADD COLUMN visitCount INTEGER DEFAULT 0'); } catch { /* already there */ }
  }
  if (v < SCHEMA_VERSION) d.execSync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

// ─── Change notifications: screens re-read when something they show changed. ───
type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;
export function onDbChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function dbVersion(): number {
  return version;
}
export function notifyChange() {
  version++;
  listeners.forEach((l) => {
    try { l(); } catch { /* a screen failing to refresh must not break a write */ }
  });
}

// ─── kv ───
export function kvGet(key: string): string | null {
  return db().getFirstSync<{ value: string | null }>('SELECT value FROM kv WHERE key = ?', key)?.value ?? null;
}
export function kvSet(key: string, value: string | null) {
  if (value == null) db().runSync('DELETE FROM kv WHERE key = ?', key);
  else db().runSync('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}
export function kvJson<T>(key: string, fallback: T): T {
  const s = kvGet(key);
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

// ─── Row types ───
export interface Contact {
  clientId: string;
  synced: number;
  panchayatId: string | null;
  role: string;
  profession: string | null;
  name: string;
  phone: string | null;
  whatsappAdded: number;
  cardGiven: number;
  status: string;
  priority: Priority;
  isImportant: number;
  followUpDate: string | null;
  lat: number | null;
  lng: number | null;
  photoUri: string | null;
  shiftId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface Note { clientId: string; contactId: string; text: string; source: 'note' | 'visit' | 'revisit' | 'call'; createdAt: string }
export interface Shift { clientId: string; startTime: string; startLat: number; startLng: number; endTime: string | null; endLat: number | null; endLng: number | null }
export interface Visit { clientId: string; panchayatId: string; shiftId: string | null; checkInAt: string; checkInLat: number; checkInLng: number; checkOutAt: string | null; checkOutLat: number | null; checkOutLng: number | null }
export interface Referral { clientId: string; contactId: string; patientName: string; patientAge: number | null; patientSex: string | null; clientPhone: string | null; department: string; urgent: number; notes: string | null; status: string; createdAt: string; updatedAt: string | null }
export interface Question { id: string; questionId: string; text: string; type: string; optionsJson: string | null; section: string; isOptional: number; ord: number }
export interface Panchayat { id: string; name: string; block: string; district: string; lat: number | null; lng: number | null }
export interface Assigned { panchayatId: string; name: string; visited: number; lastVisitedAt: string | null; lat: number | null; lng: number | null; source: string | null; visitCount: number | null; localVisits?: number; localLastAt?: string | null }

/** Times checked in here: the server's count, or this phone's own if more are still waiting to sync. */
export function timesVisited(a: Assigned): number {
  return Math.max(a.visitCount ?? 0, a.localVisits ?? 0, a.visited ? 1 : 0);
}
export function lastVisited(a: Assigned): string | null {
  const x = [a.lastVisitedAt, a.localLastAt].filter(Boolean) as string[];
  return x.length ? x.sort()[x.length - 1] : null;
}
export interface OutboxRow { id: number; clientId: string; type: string; payload: string; createdAt: string; attempts: number; lastError: string | null }

// ─── Queries used by screens ───
export const q = {
  contact: (id: string) => db().getFirstSync<Contact>('SELECT * FROM contacts WHERE clientId = ?', id),
  contacts: () => db().getAllSync<Contact>('SELECT * FROM contacts ORDER BY name COLLATE NOCASE'),
  contactsIn: (panchayatId: string) =>
    db().getAllSync<Contact>('SELECT * FROM contacts WHERE panchayatId = ? ORDER BY name COLLATE NOCASE', panchayatId),
  contactByPhone: (digits: string) =>
    db().getAllSync<Contact>("SELECT * FROM contacts WHERE replace(replace(phone, ' ', ''), '-', '') LIKE ?", `%${digits}`),
  notesFor: (contactId: string) =>
    db().getAllSync<Note>('SELECT * FROM notes WHERE contactId = ? ORDER BY createdAt DESC', contactId),
  lastNote: (contactId: string) =>
    db().getFirstSync<Note>('SELECT * FROM notes WHERE contactId = ? ORDER BY createdAt DESC LIMIT 1', contactId),
  referrals: () => db().getAllSync<Referral>('SELECT * FROM referrals ORDER BY createdAt DESC'),
  referralsFor: (contactId: string) =>
    db().getAllSync<Referral>('SELECT * FROM referrals WHERE contactId = ? ORDER BY createdAt DESC', contactId),
  activeShift: () => db().getFirstSync<Shift>('SELECT * FROM shifts WHERE endTime IS NULL ORDER BY startTime DESC LIMIT 1'),
  lastShift: () => db().getFirstSync<Shift>('SELECT * FROM shifts WHERE endTime IS NOT NULL ORDER BY startTime DESC LIMIT 1'),
  activeVisit: () => db().getFirstSync<Visit>('SELECT * FROM visits WHERE checkOutAt IS NULL ORDER BY checkInAt DESC LIMIT 1'),
  visitsSince: (iso: string) => db().getAllSync<Visit>('SELECT * FROM visits WHERE checkInAt >= ?', iso),
  questions: () => db().getAllSync<Question>('SELECT * FROM questions ORDER BY ord, questionId'),
  panchayat: (id: string) => db().getFirstSync<Panchayat>('SELECT * FROM panchayats WHERE id = ?', id),
  assigned: () => db().getAllSync<Assigned>(`SELECT a.*,
      (SELECT COUNT(*) FROM visits v WHERE v.panchayatId = a.panchayatId) AS localVisits,
      (SELECT MAX(checkInAt) FROM visits v WHERE v.panchayatId = a.panchayatId) AS localLastAt
    FROM assigned a ORDER BY a.name COLLATE NOCASE`),
  assignedOne: (id: string) => db().getFirstSync<Assigned>(`SELECT a.*,
      (SELECT COUNT(*) FROM visits v WHERE v.panchayatId = a.panchayatId) AS localVisits,
      (SELECT MAX(checkInAt) FROM visits v WHERE v.panchayatId = a.panchayatId) AS localLastAt
    FROM assigned a WHERE a.panchayatId = ?`, id),
  outbox: () => db().getAllSync<OutboxRow>('SELECT * FROM outbox ORDER BY id'),
  outboxCount: () => db().getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM outbox')?.n ?? 0,
  trajectorySince: (iso: string) =>
    db().getAllSync<{ lat: number; lng: number; recordedAt: string; accuracy: number | null }>(
      'SELECT lat, lng, recordedAt, accuracy FROM trajectory WHERE recordedAt >= ? ORDER BY recordedAt', iso),
  hasSurvey: (contactId: string) =>
    (db().getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM surveys WHERE contactId = ?', contactId)?.n ?? 0) > 0,
};

/** Wipes everything on this phone (used on logout). */
export function wipeAll() {
  db().execSync(`
    DELETE FROM kv; DELETE FROM panchayats; DELETE FROM assigned; DELETE FROM contacts; DELETE FROM notes;
    DELETE FROM shifts; DELETE FROM visits; DELETE FROM referrals; DELETE FROM questions; DELETE FROM surveys;
    DELETE FROM trajectory; DELETE FROM outbox;
  `);
  notifyChange();
}
