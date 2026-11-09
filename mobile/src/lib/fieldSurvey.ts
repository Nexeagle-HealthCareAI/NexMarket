import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { api, get, post } from './api';
import { db, kvGet, kvJson, kvSet, notifyChange } from './db';
import { haversineM, nowIso, uuid } from './util';

/**
 * Occasional field surveys ("Field mapping"): an area the office drew, which the agent covers while the app traces the
 * route (each stretch tagged with its road type) and marks spots (chowks, crossroads, banner places…) with a photo,
 * plus a separate set of questions. Everything is saved on the phone first and sent when there is signal.
 */

export type QType = 'text' | 'number' | 'yesno' | 'choice' | 'multi';
export interface FsQuestion { id: string; text: string; type: QType; options?: string[] | null; required: boolean }
export interface FsConfig {
  id: string; title: string; instructions?: string | null; status: string; dueDate?: string | null;
  /** [[lng, lat], …] as drawn in the CRM. */
  area: [number, number][]; spotTypes: string[]; roadTypes: string[]; questions: FsQuestion[];
}
export interface FsItem { config: FsConfig; myStatus: string; startedAt?: string | null; submittedAt?: string | null; answers?: Record<string, unknown> | null; km: number; spots: number }
export interface FsSpot {
  clientId: string; surveyId: string; type: string; name: string | null; roadType: string | null; lat: number; lng: number; acc: number | null;
  note: string | null; photoUri: string | null; takenAt: string; removed: number; synced: number; photoSynced: number;
}
export interface FsSegment { clientId: string; surveyId: string; roadType: string | null; startedAt: string; endedAt: string | null }
export interface Recording { surveyId: string; segId: string; roadType: string | null }

const LIST_KEY = 'fsList';
const REC_KEY = 'fsRecording';
export const FIELD_TASK = 'nexeagle-field-route';
/** Points kept: within 50 m accuracy, and 8 m or 15 s from the previous one. */
const MAX_ACC = 50, MIN_M = 8, MIN_MS = 15000;

let made = false;
function d() {
  const x = db();
  if (!made) {
    x.execSync(`
      CREATE TABLE IF NOT EXISTS fs_segments (clientId TEXT PRIMARY KEY NOT NULL, surveyId TEXT, roadType TEXT, startedAt TEXT, endedAt TEXT, endSynced INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS fs_points (id INTEGER PRIMARY KEY AUTOINCREMENT, segId TEXT, surveyId TEXT, lat REAL, lng REAL, acc REAL, t INTEGER, synced INTEGER DEFAULT 0);
      CREATE INDEX IF NOT EXISTS ix_fs_points_seg ON fs_points(segId, t);
      CREATE TABLE IF NOT EXISTS fs_spots (clientId TEXT PRIMARY KEY NOT NULL, surveyId TEXT, type TEXT, name TEXT, roadType TEXT, lat REAL, lng REAL, acc REAL,
        note TEXT, photoUri TEXT, takenAt TEXT, removed INTEGER DEFAULT 0, synced INTEGER DEFAULT 0, photoSynced INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS fs_answers (surveyId TEXT PRIMARY KEY NOT NULL, json TEXT, synced INTEGER DEFAULT 0, submit INTEGER DEFAULT 0);
    `);
    made = true;
  }
  return x;
}

// ─── The list of my surveys (kept on the phone) ───

export function myFieldSurveys(): FsItem[] {
  return kvJson<{ items: FsItem[] }>(LIST_KEY, { items: [] }).items;
}
export function fieldSurvey(id: string): FsItem | null {
  return myFieldSurveys().find((x) => x.config.id === id) ?? null;
}
export async function refreshFieldSurveys(): Promise<void> {
  const r = await get<{ items: FsItem[] }>('/api/v1/me/field-surveys');
  kvSet(LIST_KEY, JSON.stringify({ items: r.items, at: nowIso() }));
  notifyChange();
}

// ─── Recording the route ───

export function recording(): Recording | null {
  return kvJson<Recording | null>(REC_KEY, null);
}

/** Keeps a point for the stretch being recorded (from the screen's live position or the background task). */
export function addPoint(lat: number, lng: number, acc: number | null, t: number) {
  const r = recording();
  if (!r) return;
  if (acc != null && acc > MAX_ACC) return;
  const x = d();
  const last = x.getFirstSync<{ lat: number; lng: number; t: number }>('SELECT lat, lng, t FROM fs_points WHERE segId = ? ORDER BY t DESC LIMIT 1', r.segId);
  if (last) {
    if (t <= last.t) return;
    if (haversineM(last, { lat, lng }) < MIN_M && t - last.t < MIN_MS) return;
  }
  x.runSync('INSERT INTO fs_points (segId, surveyId, lat, lng, acc, t) VALUES (?, ?, ?, ?, ?, ?)', r.segId, r.surveyId, lat, lng, acc, t);
  notifyChange();
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(FIELD_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  try {
    for (const l of data.locations) addPoint(l.coords.latitude, l.coords.longitude, l.coords.accuracy ?? null, l.timestamp);
  } catch { /* the next update tries again */ }
});

function newSegment(surveyId: string, roadType: string | null): Recording {
  const segId = uuid();
  d().runSync('INSERT INTO fs_segments (clientId, surveyId, roadType, startedAt) VALUES (?, ?, ?, ?)', segId, surveyId, roadType, nowIso());
  const r = { surveyId, segId, roadType };
  kvSet(REC_KEY, JSON.stringify(r));
  return r;
}

function endSegment(r: Recording) {
  d().runSync('UPDATE fs_segments SET endedAt = ? WHERE clientId = ? AND endedAt IS NULL', nowIso(), r.segId);
}

/** Start tracing (or carry on after a pause). Returns whether the background (screen-off) tracking could start. */
export async function startRecording(surveyId: string, roadType: string | null, title: string, body: string): Promise<boolean> {
  const cur = recording();
  if (cur) endSegment(cur);
  newSegment(surveyId, roadType);
  notifyChange();
  let bg = await Location.getBackgroundPermissionsAsync().catch(() => null);
  if (!bg?.granted) bg = await Location.requestBackgroundPermissionsAsync().catch(() => null);
  if (!bg?.granted) return false;
  try {
    if (!(await Location.hasStartedLocationUpdatesAsync(FIELD_TASK).catch(() => false))) {
      await Location.startLocationUpdatesAsync(FIELD_TASK, {
        accuracy: Location.Accuracy.BestForNavigation, timeInterval: 5000, distanceInterval: 8,
        pausesUpdatesAutomatically: false, activityType: Location.ActivityType.OtherNavigation, showsBackgroundLocationIndicator: true,
        foregroundService: { notificationTitle: title, notificationBody: body, notificationColor: '#0a72d6', killServiceOnDestroy: false },
      });
    }
    return true;
  } catch { return false; }
}

/** Road type changed: the current stretch ends and a new one starts on the new road type. */
export function switchRoad(roadType: string) {
  const cur = recording();
  if (!cur || cur.roadType === roadType) { if (!cur) return; }
  else { endSegment(cur); newSegment(cur.surveyId, roadType); }
  notifyChange();
}

export async function stopRecording() {
  const cur = recording();
  if (cur) endSegment(cur);
  kvSet(REC_KEY, null);
  notifyChange();
  if (await Location.hasStartedLocationUpdatesAsync(FIELD_TASK).catch(() => false)) await Location.stopLocationUpdatesAsync(FIELD_TASK).catch(() => undefined);
  void syncFieldSurveys().catch(() => undefined);
}

/** The road type to pre-select: the one being recorded, else the last one used in this survey. */
export function lastRoadType(surveyId: string): string | null {
  const r = recording();
  if (r?.surveyId === surveyId && r.roadType) return r.roadType;
  return d().getFirstSync<{ roadType: string | null }>('SELECT roadType FROM fs_segments WHERE surveyId = ? ORDER BY startedAt DESC LIMIT 1', surveyId)?.roadType ?? null;
}

// ─── What is on the phone for one survey ───

export function localLines(surveyId: string): { segId: string; roadType: string | null; points: [number, number][] }[] {
  const segs = d().getAllSync<FsSegment>('SELECT clientId, surveyId, roadType, startedAt, endedAt FROM fs_segments WHERE surveyId = ? ORDER BY startedAt', surveyId);
  return segs.map((s) => ({
    segId: s.clientId, roadType: s.roadType,
    points: d().getAllSync<{ lat: number; lng: number }>('SELECT lat, lng FROM fs_points WHERE segId = ? ORDER BY t', s.clientId).map((p) => [p.lat, p.lng] as [number, number]),
  }));
}

export function localKm(surveyId: string): number {
  let m = 0;
  for (const l of localLines(surveyId)) for (let i = 1; i < l.points.length; i++) m += haversineM({ lat: l.points[i - 1][0], lng: l.points[i - 1][1] }, { lat: l.points[i][0], lng: l.points[i][1] });
  return m / 1000;
}

export function localSpots(surveyId: string): FsSpot[] {
  return d().getAllSync<FsSpot>('SELECT * FROM fs_spots WHERE surveyId = ? AND removed = 0 ORDER BY takenAt DESC', surveyId);
}

export function waitingToSend(surveyId: string): number {
  const x = d();
  return (x.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM fs_points WHERE surveyId = ? AND synced = 0', surveyId)?.n ?? 0)
    + (x.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM fs_spots WHERE surveyId = ? AND (synced = 0 OR (photoUri IS NOT NULL AND photoSynced = 0))', surveyId)?.n ?? 0)
    + (x.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM fs_answers WHERE surveyId = ? AND synced = 0', surveyId)?.n ?? 0);
}

export function saveSpot(s: Omit<FsSpot, 'synced' | 'photoSynced' | 'removed'> & { removed?: number }) {
  d().runSync(`INSERT INTO fs_spots (clientId, surveyId, type, name, roadType, lat, lng, acc, note, photoUri, takenAt, removed, synced, photoSynced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
    ON CONFLICT(clientId) DO UPDATE SET type = excluded.type, name = excluded.name, roadType = excluded.roadType, lat = excluded.lat, lng = excluded.lng,
      acc = excluded.acc, note = excluded.note, removed = excluded.removed, synced = 0,
      photoSynced = CASE WHEN fs_spots.photoUri IS excluded.photoUri THEN fs_spots.photoSynced ELSE 0 END, photoUri = excluded.photoUri`,
    s.clientId, s.surveyId, s.type, s.name, s.roadType, s.lat, s.lng, s.acc, s.note, s.photoUri, s.takenAt, s.removed ?? 0);
  notifyChange();
  void syncFieldSurveys().catch(() => undefined);
}

export function removeSpot(clientId: string) {
  d().runSync('UPDATE fs_spots SET removed = 1, synced = 0 WHERE clientId = ?', clientId);
  notifyChange();
  void syncFieldSurveys().catch(() => undefined);
}

export function localAnswers(surveyId: string): { answers: Record<string, unknown>; submitted: boolean } | null {
  const r = d().getFirstSync<{ json: string; submit: number }>('SELECT json, submit FROM fs_answers WHERE surveyId = ?', surveyId);
  if (!r) return null;
  try { return { answers: JSON.parse(r.json) as Record<string, unknown>, submitted: !!r.submit }; } catch { return null; }
}

export function saveAnswers(surveyId: string, answers: Record<string, unknown>, submit: boolean) {
  d().runSync('INSERT INTO fs_answers (surveyId, json, synced, submit) VALUES (?, ?, 0, ?) ON CONFLICT(surveyId) DO UPDATE SET json = excluded.json, synced = 0, submit = MAX(fs_answers.submit, excluded.submit)',
    surveyId, JSON.stringify(answers), submit ? 1 : 0);
  notifyChange();
}

// ─── Sending ───

let sending: Promise<void> | null = null;

/** Sends everything waiting for every survey; safe to call often (it joins a send already running). */
export function syncFieldSurveys(): Promise<void> {
  if (!kvGet('agentId')) return Promise.resolve();
  if (sending) return sending;
  sending = run().finally(() => { sending = null; });
  return sending;
}

async function run() {
  const x = d();
  const surveys = new Set<string>([
    ...x.getAllSync<{ surveyId: string }>('SELECT DISTINCT surveyId FROM fs_points WHERE synced = 0').map((r) => r.surveyId),
    ...x.getAllSync<{ surveyId: string }>('SELECT DISTINCT surveyId FROM fs_segments WHERE endedAt IS NOT NULL AND endSynced = 0').map((r) => r.surveyId),
    ...x.getAllSync<{ surveyId: string }>('SELECT DISTINCT surveyId FROM fs_spots WHERE synced = 0').map((r) => r.surveyId),
    ...x.getAllSync<{ surveyId: string }>('SELECT surveyId FROM fs_answers WHERE synced = 0').map((r) => r.surveyId),
  ]);
  for (const id of surveys) {
    try { await sendOne(id); kvSet('fsLastError', null); }
    catch (e) { kvSet('fsLastError', e instanceof Error ? e.message : String(e)); }
  }
  // Photos go one by one once their spot is on the server.
  const photos = x.getAllSync<{ clientId: string; surveyId: string; photoUri: string }>('SELECT clientId, surveyId, photoUri FROM fs_spots WHERE synced = 1 AND photoUri IS NOT NULL AND photoSynced = 0 AND removed = 0 LIMIT 10');
  for (const p of photos) {
    const form = new FormData();
    form.append('file', { uri: p.photoUri, name: `spot-${p.clientId}.jpg`, type: 'image/jpeg' } as unknown as Blob);
    try {
      await api(`/api/v1/me/field-surveys/${p.surveyId}/spots/${p.clientId}/photo`, { method: 'POST', body: form, timeoutMs: 120000 });
      x.runSync('UPDATE fs_spots SET photoSynced = 1 WHERE clientId = ? AND photoUri = ?', p.clientId, p.photoUri);
    } catch { break; }
  }
  if (surveys.size || photos.length) { await refreshFieldSurveys().catch(() => undefined); notifyChange(); }
}

async function sendOne(surveyId: string) {
  const x = d();
  const points = x.getAllSync<{ id: number; segId: string; lat: number; lng: number; acc: number | null; t: number }>(
    'SELECT id, segId, lat, lng, acc, t FROM fs_points WHERE surveyId = ? AND synced = 0 ORDER BY t LIMIT 4000', surveyId);
  const segIds = new Set(points.map((p) => p.segId));
  x.getAllSync<{ clientId: string }>('SELECT clientId FROM fs_segments WHERE surveyId = ? AND endedAt IS NOT NULL AND endSynced = 0', surveyId).forEach((r) => segIds.add(r.clientId));
  const segs = [...segIds].map((id) => x.getFirstSync<FsSegment>('SELECT clientId, surveyId, roadType, startedAt, endedAt FROM fs_segments WHERE clientId = ?', id)).filter((s): s is FsSegment => !!s);
  const spots = x.getAllSync<FsSpot>('SELECT * FROM fs_spots WHERE surveyId = ? AND synced = 0 LIMIT 300', surveyId);
  const ans = x.getFirstSync<{ json: string; submit: number }>('SELECT json, submit FROM fs_answers WHERE surveyId = ? AND synced = 0', surveyId);
  const body = {
    segments: segs.map((s) => ({
      clientId: s.clientId, roadType: s.roadType, startedAt: s.startedAt, endedAt: s.endedAt,
      points: points.filter((p) => p.segId === s.clientId).map((p) => [p.lat, p.lng, p.acc ?? 0, p.t]),
    })),
    spots: spots.map((s) => ({ clientId: s.clientId, type: s.type, name: s.name, roadType: s.roadType, lat: s.lat, lng: s.lng, accuracy: s.acc, note: s.note, takenAt: s.takenAt, removed: !!s.removed })),
    answers: ans ? (JSON.parse(ans.json) as Record<string, unknown>) : undefined,
    submit: !!ans?.submit,
  };
  await post<{ segments: string[]; spots: string[]; status: string }>(`/api/v1/me/field-surveys/${surveyId}/sync`, body, 60000);
  x.withTransactionSync(() => {
    if (points.length) x.runSync(`UPDATE fs_points SET synced = 1 WHERE id IN (${points.map(() => '?').join(',')})`, ...points.map((p) => p.id));
    segs.filter((s) => s.endedAt).forEach((s) => x.runSync('UPDATE fs_segments SET endSynced = 1 WHERE clientId = ?', s.clientId));
    spots.forEach((s) => x.runSync('UPDATE fs_spots SET synced = 1 WHERE clientId = ? AND synced = 0', s.clientId));
    if (ans) x.runSync('UPDATE fs_answers SET synced = 1 WHERE surveyId = ? AND json = ?', surveyId, ans.json);
  });
}

/** [lng,lat] → [lat,lng] for the map. */
export const areaLatLng = (a: [number, number][]): [number, number][] => a.map(([lng, lat]) => [lat, lng]);

/** Same colours as the CRM, by position in the survey's list. */
const PALETTE = ['#0a72d6', '#d9822b', '#0f8a5f', '#b42318', '#7b3fe4', '#0e7490', '#c2185b', '#6d4c41', '#558b2f', '#f2a600', '#455a64', '#00897b', '#8e24aa', '#5c6bc0'];
export const colorOf = (list: string[], v?: string | null) => {
  const i = v ? list.findIndex((x) => x.toLowerCase() === v.toLowerCase()) : -1;
  return i < 0 ? '#8a93a6' : PALETTE[i % PALETTE.length];
};
