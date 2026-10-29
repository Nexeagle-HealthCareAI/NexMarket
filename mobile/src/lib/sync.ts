import { AppState, type NativeEventSubscription } from 'react-native';
import * as Network from 'expo-network';
import { ApiError, get, OfflineError, post } from './api';
import { db, kvGet, kvJson, kvSet, notifyChange, q, type OutboxRow } from './db';
import { SYNC_INTERVAL_MS } from './config';
import { errorMessage, nowIso, uuid } from './util';
import { me } from './repo';
import { refreshTasks } from './tasks';

/**
 * The sync engine. Pushes the outbox in order (oldest first), then pulls what changed
 * on the server. Runs on app open, when the network comes back, every 2 minutes while a
 * shift is on, and when the agent taps "Send now". Only one run at a time.
 */

const MAX_BATCH_BYTES = 1_500_000; // photos are base64; keep each request well under server limits
const MAX_BATCH_ITEMS = 50;
const TRAJ_BATCH = 200;

export interface SyncState {
  running: boolean;
  lastOkAt: string | null;
  lastError: string | null;
  online: boolean;
}

let state: SyncState = { running: false, lastOkAt: null, lastError: null, online: true };
const stateListeners = new Set<(s: SyncState) => void>();
export function syncState(): SyncState {
  return state;
}
export function onSyncState(l: (s: SyncState) => void): () => void {
  stateListeners.add(l);
  return () => stateListeners.delete(l);
}
function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  stateListeners.forEach((l) => l(state));
}

let running: Promise<void> | null = null;
let failures = 0;
let nextAllowedAt = 0;

/** Run a sync now (or join the one already running). `force` ignores the retry backoff. */
export function syncNow(force = false): Promise<void> {
  if (running) return running;
  if (!force && Date.now() < nextAllowedAt) return Promise.resolve();
  running = run().finally(() => { running = null; });
  return running;
}

async function run() {
  if (!kvGet('agentId')) return;
  setState({ running: true });
  try {
    queueTrajectory();
    await push();
    await pull();
    // Tasks from the manager: never let them fail the main sync.
    await refreshTasks().catch(() => undefined);
    failures = 0;
    nextAllowedAt = 0;
    const at = nowIso();
    kvSet('lastSyncAt', at);
    setState({ lastOkAt: at, lastError: null, online: true });
  } catch (e) {
    failures++;
    // 15 s, 30 s, 1 min, 2 min, … capped at 10 min.
    nextAllowedAt = Date.now() + Math.min(600_000, 15_000 * 2 ** (failures - 1));
    setState({ lastError: e instanceof OfflineError ? null : errorMessage(e), online: !(e instanceof OfflineError) });
  } finally {
    setState({ running: false });
    notifyChange();
  }
}

// ─── Trajectory: points the background task stored become outbox batches. ───

export function queueTrajectory() {
  const d = db();
  for (;;) {
    const pts = d.getAllSync<{ clientId: string; lat: number; lng: number; accuracy: number | null; recordedAt: string }>(
      'SELECT clientId, lat, lng, accuracy, recordedAt FROM trajectory WHERE queued = 0 ORDER BY recordedAt LIMIT ?', TRAJ_BATCH);
    if (!pts.length) return;
    const { agentId, deviceId } = me();
    const clientId = uuid();
    d.withTransactionSync(() => {
      d.runSync('INSERT INTO outbox (clientId, type, payload, createdAt) VALUES (?, ?, ?, ?)', clientId, 'trajectory_batch',
        JSON.stringify({
          clientId, deviceId, agentId,
          points: pts.map((p) => ({ clientId: p.clientId, lat: p.lat, lng: p.lng, recordedAt: p.recordedAt, accuracyM: p.accuracy })),
        }), nowIso());
      const marks = pts.map(() => '?').join(',');
      d.runSync(`UPDATE trajectory SET queued = 1 WHERE clientId IN (${marks})`, ...pts.map((p) => p.clientId));
    });
    if (pts.length < TRAJ_BATCH) return;
  }
}

// ─── Push ───

interface SyncResult { clientId: string; serverId: string; status: string; errorMessage?: string | null }

async function push() {
  const { agentId, deviceId } = me();
  for (let round = 0; round < 40; round++) {
    const rows = q.outbox();
    if (!rows.length) return;
    const batch: OutboxRow[] = [];
    let bytes = 0;
    for (const r of rows) {
      if (batch.length && (bytes + r.payload.length > MAX_BATCH_BYTES || batch.length >= MAX_BATCH_ITEMS)) break;
      batch.push(r);
      bytes += r.payload.length;
    }
    const res = await post<{ results: SyncResult[] }>('/api/v1/sync/batch', {
      agentId, deviceId,
      items: batch.map((r) => ({
        id: String(r.id), clientId: r.clientId, deviceId, agentId, type: r.type, payload: r.payload, timestamp: r.createdAt,
      })),
    }, 120_000);
    const results = res?.results ?? [];
    // Results come back one per item, in order. Fall back to matching by clientId.
    const byIndex = results.length === batch.length;
    const d = db();
    let progressed = false;
    let firstError: string | null = null;
    d.withTransactionSync(() => {
      batch.forEach((r, i) => {
        const out = byIndex ? results[i] : results.find((x) => x.clientId === r.clientId);
        const status = out?.status ?? 'error';
        if (status === 'created' || status === 'already_exists' || status === 'conflict') {
          // 'conflict' = the server already holds a newer version; the next pull brings it.
          // If the agent edited this record while it was in flight, the row now holds a newer
          // payload: keep it (as an update) for the next round instead of deleting it.
          const changed = d.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM outbox WHERE id = ? AND payload != ?', r.id, r.payload)?.n;
          if (changed) {
            if (r.type === 'contact_new') d.runSync("UPDATE outbox SET type = 'contact_update' WHERE id = ?", r.id);
          } else {
            d.runSync('DELETE FROM outbox WHERE id = ?', r.id);
          }
          if (r.type === 'contact_new' && status !== 'conflict') d.runSync('UPDATE contacts SET synced = 1 WHERE clientId = ?', r.clientId);
          progressed = true;
        } else {
          const msg = out?.errorMessage || 'Not accepted';
          firstError ??= msg;
          if (r.attempts + 1 >= 3) {
            // An item the server keeps rejecting must not block the queue: it moves to the
            // back and stays visible (with its error) in Me → sync.
            d.runSync('INSERT INTO outbox (clientId, type, payload, createdAt, attempts, lastError) VALUES (?, ?, ?, ?, ?, ?)',
              r.clientId, r.type, r.payload, r.createdAt, r.attempts + 1, msg);
            d.runSync('DELETE FROM outbox WHERE id = ?', r.id);
          } else {
            d.runSync('UPDATE outbox SET attempts = attempts + 1, lastError = ? WHERE id = ?', msg, r.id);
          }
        }
      });
    });
    notifyChange();
    if (!progressed) throw new ApiError(422, firstError ?? 'Not accepted');
  }
}

// ─── Pull ───

interface PullResponse {
  hasMore: boolean;
  contacts: {
    clientId: string; panchayatId: string; role: string; name: string; phone: string; whatsappAdded: boolean;
    cardGiven: boolean; createdAt: string; updatedAt: string; isImportant: boolean; priority?: string | null; followUpDate?: string | null;
  }[];
  visits: { clientId: string; panchayatId: string; checkInAt: string; checkInLat: number; checkInLng: number; checkOutAt: string | null; checkOutLat: number | null; checkOutLng: number | null }[];
  shifts: { clientId: string; startAt: string; endAt: string | null }[];
  contactNotes: { clientId: string; contactId: string; text: string; source: string; createdAt: string }[];
  referrals: { clientId: string; contactId: string; status: string; notes: string | null; createdAt: string; patientName?: string; department?: string; urgent?: boolean; updatedAt?: string }[];
  surveys: { clientId: string; contactId: string; panchayatId: string; answersJson: string; createdAt: string }[];
}

function pending(): Set<string> {
  return new Set(db().getAllSync<{ clientId: string }>('SELECT DISTINCT clientId FROM outbox').map((r) => r.clientId));
}

async function pull() {
  const since = kvGet('pullSince') ?? '2000-01-01T00:00:00Z';
  const startedAt = new Date(Date.now() - 60_000).toISOString(); // overlap a minute for clock drift
  const { agentId, deviceId } = me();
  for (let page = 1; page <= 50; page++) {
    const r = await post<PullResponse>('/api/v1/sync/pull', { agentId, deviceId, since, page, pageSize: 200 }, 60_000);
    applyPull(r);
    if (!r.hasMore) break;
  }
  kvSet('pullSince', startedAt);
  await refreshReference();
}

function applyPull(r: PullResponse) {
  const d = db();
  const skip = pending(); // never overwrite something the agent changed and hasn't sent yet
  d.withTransactionSync(() => {
    for (const c of r.contacts ?? []) {
      if (skip.has(c.clientId)) continue;
      const prio = (['very_high', 'high', 'normal', 'low'].includes(c.priority ?? '') ? c.priority : c.isImportant ? 'very_high' : 'normal') as string;
      d.runSync(
        `INSERT INTO contacts (clientId, synced, panchayatId, role, name, phone, whatsappAdded, cardGiven, priority, isImportant, followUpDate, createdAt, updatedAt)
         VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(clientId) DO UPDATE SET synced = 1, panchayatId = excluded.panchayatId, role = excluded.role, name = excluded.name,
           phone = excluded.phone, whatsappAdded = excluded.whatsappAdded, cardGiven = excluded.cardGiven, priority = excluded.priority,
           isImportant = excluded.isImportant, followUpDate = excluded.followUpDate, updatedAt = excluded.updatedAt`,
        c.clientId, c.panchayatId, c.role, c.name, c.phone, c.whatsappAdded ? 1 : 0, c.cardGiven ? 1 : 0, prio,
        c.isImportant ? 1 : 0, c.followUpDate ? c.followUpDate.slice(0, 10) : null, c.createdAt, c.updatedAt);
    }
    for (const v of r.visits ?? []) {
      if (skip.has(v.clientId)) continue;
      d.runSync(
        `INSERT OR REPLACE INTO visits (clientId, panchayatId, shiftId, checkInAt, checkInLat, checkInLng, checkOutAt, checkOutLat, checkOutLng)
         VALUES (?, ?, (SELECT shiftId FROM visits WHERE clientId = ?), ?, ?, ?, ?, ?, ?)`,
        v.clientId, v.panchayatId, v.clientId, v.checkInAt, v.checkInLat, v.checkInLng, v.checkOutAt, v.checkOutLat, v.checkOutLng);
    }
    for (const s of r.shifts ?? []) {
      if (skip.has(s.clientId)) continue;
      d.runSync(
        `INSERT INTO shifts (clientId, startTime, endTime) VALUES (?, ?, ?)
         ON CONFLICT(clientId) DO UPDATE SET startTime = excluded.startTime, endTime = excluded.endTime`,
        s.clientId, s.startAt, s.endAt);
    }
    // A shift the server has never closed but that started on an earlier day is left
    // open on the phone only if the phone itself opened it.
    for (const n of r.contactNotes ?? []) {
      d.runSync('INSERT OR IGNORE INTO notes (clientId, contactId, text, source, createdAt) VALUES (?, ?, ?, ?, ?)',
        n.clientId, n.contactId, n.text, n.source || 'note', n.createdAt);
    }
    for (const x of r.referrals ?? []) {
      if (skip.has(x.clientId)) continue;
      // The pull doesn't (yet) carry patient name / department: keep what the phone has.
      d.runSync(
        `INSERT INTO referrals (clientId, contactId, patientName, department, urgent, notes, status, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(clientId) DO UPDATE SET status = excluded.status,
           patientName = COALESCE(referrals.patientName, excluded.patientName),
           department = COALESCE(referrals.department, excluded.department),
           updatedAt = excluded.updatedAt`,
        x.clientId, x.contactId, x.patientName ?? null, x.department ?? null, x.urgent ? 1 : 0, x.notes, x.status === 'converted' ? 'admitted' : x.status,
        x.createdAt, x.updatedAt ?? nowIso());
    }
    for (const s of r.surveys ?? []) {
      d.runSync('INSERT OR IGNORE INTO surveys (clientId, contactId, panchayatId, answersJson, createdAt) VALUES (?, ?, ?, ?, ?)',
        s.clientId, s.contactId, s.panchayatId, s.answersJson, s.createdAt);
    }
  });
}

// ─── Reference data: panchayats, questions, my block, departments ───

interface RefData {
  panchayats: { id: string; name: string; block: string; district: string; centroidLat: number | null; centroidLng: number | null }[];
  surveyQuestions: { id: string; questionId: string; text: string; type: string; optionsJson: string | null; section: string; isOptional: boolean; order: number }[];
}
interface MyAssignment {
  assignmentId?: string;
  district?: string;
  block?: string;
  panchayats?: { panchayatId: string; name: string; visited: boolean; lastVisitedAt: string | null; centroidLat: number | null; centroidLng: number | null; locationSource: string | null; visitCount?: number }[];
}

export async function refreshReference() {
  const [ref, mine, depts] = await Promise.all([
    get<RefData>('/api/v1/sync/reference-data'),
    get<MyAssignment>('/api/v1/assignments/mine').catch((e) => { if (e instanceof OfflineError) throw e; return null; }),
    get<{ name: string; isActive?: boolean }[]>('/api/v1/departments').catch(() => null),
  ]);
  const d = db();
  d.withTransactionSync(() => {
    if (ref?.panchayats) {
      d.runSync('DELETE FROM panchayats');
      for (const p of ref.panchayats) {
        d.runSync('INSERT OR REPLACE INTO panchayats (id, name, block, district, lat, lng) VALUES (?, ?, ?, ?, ?, ?)',
          p.id, p.name, p.block, p.district, p.centroidLat, p.centroidLng);
      }
    }
    if (ref?.surveyQuestions) {
      d.runSync('DELETE FROM questions');
      for (const x of ref.surveyQuestions) {
        d.runSync('INSERT OR REPLACE INTO questions (id, questionId, text, type, optionsJson, section, isOptional, ord) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          x.id, x.questionId, x.text, x.type, x.optionsJson, x.section, x.isOptional ? 1 : 0, x.order ?? 0);
      }
    }
    if (mine) {
      // Keep the "visited" mark for check-ins still on the phone.
      const localVisited = new Set(d.getAllSync<{ panchayatId: string }>('SELECT panchayatId FROM assigned WHERE visited = 1').map((x) => x.panchayatId));
      d.runSync('DELETE FROM assigned');
      for (const p of mine.panchayats ?? []) {
        d.runSync('INSERT INTO assigned (panchayatId, name, visited, lastVisitedAt, lat, lng, source, visitCount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          p.panchayatId, p.name, p.visited || localVisited.has(p.panchayatId) ? 1 : 0, p.lastVisitedAt, p.centroidLat, p.centroidLng, p.locationSource, p.visitCount ?? 0);
      }
    }
  });
  if (mine) kvSet('assignment', JSON.stringify({ district: mine.district ?? null, block: mine.block ?? null }));
  if (depts?.length) kvSet('departments', JSON.stringify(depts.filter((x) => x.isActive !== false).map((x) => x.name)));
  notifyChange();
}

export function departments(): string[] {
  return kvJson<string[]>('departments', []);
}

export function assignment(): { district: string | null; block: string | null } {
  return kvJson('assignment', { district: null, block: null });
}

// ─── Triggers: network regained, and a timer while on shift ───

let timer: ReturnType<typeof setInterval> | null = null;
let netSub: { remove(): void } | null = null;
let appSub: NativeEventSubscription | null = null;

export function startAutoSync() {
  stopAutoSync();
  netSub = Network.addNetworkStateListener((s) => {
    const online = !!s.isConnected && s.isInternetReachable !== false;
    setState({ online });
    if (online) void syncNow(true);
  });
  // Coming back to the app counts as "opening" it.
  appSub = AppState.addEventListener('change', (st) => { if (st === 'active') void syncNow(); });
  timer = setInterval(() => {
    if (q.activeShift() || q.outboxCount() > 0) void syncNow();
  }, SYNC_INTERVAL_MS);
}

export function stopAutoSync() {
  netSub?.remove();
  netSub = null;
  appSub?.remove();
  appSub = null;
  if (timer) clearInterval(timer);
  timer = null;
}

export async function isOnline(): Promise<boolean> {
  try {
    const s = await Network.getNetworkStateAsync();
    return !!s.isConnected && s.isInternetReachable !== false;
  } catch {
    return true;
  }
}
