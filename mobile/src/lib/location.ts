import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { db, q } from './db';
import { TRACK_DISTANCE_M, TRACK_INTERVAL_MS } from './config';
import { haversineM, uuid } from './util';
import { syncNow } from './sync';

/**
 * Background location, only while a shift is on. Android shows a permanent
 * notification ("NexMarket AI · shift on") for as long as it runs, which is what
 * keeps the OS from killing it. A point is kept every 2 minutes, or sooner after
 * 100 m of movement.
 */
export const LOCATION_TASK = 'nexeagle-shift-location';

let lastSyncKick = 0;

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  try {
    const shift = q.activeShift();
    if (!shift) return;
    const d = db();
    let last = d.getFirstSync<{ lat: number; lng: number; recordedAt: string }>(
      'SELECT lat, lng, recordedAt FROM trajectory WHERE shiftId = ? ORDER BY recordedAt DESC LIMIT 1', shift.clientId);
    for (const loc of data.locations) {
      const { latitude, longitude, accuracy } = loc.coords;
      if (accuracy != null && accuracy > 150) continue; // too vague to be useful
      const at = new Date(loc.timestamp);
      if (last) {
        const dt = at.getTime() - new Date(last.recordedAt).getTime();
        const dist = haversineM(last, { lat: latitude, lng: longitude });
        if (dt < 0 || (dt < TRACK_INTERVAL_MS && dist < TRACK_DISTANCE_M)) continue;
      }
      const recordedAt = at.toISOString();
      d.runSync('INSERT INTO trajectory (clientId, shiftId, lat, lng, accuracy, recordedAt) VALUES (?, ?, ?, ?, ?, ?)',
        uuid(), shift.clientId, latitude, longitude, accuracy ?? null, recordedAt);
      last = { lat: latitude, lng: longitude, recordedAt };
    }
    if (Date.now() - lastSyncKick > TRACK_INTERVAL_MS) {
      lastSyncKick = Date.now();
      await syncNow().catch(() => undefined);
    }
  } catch {
    // Never throw out of a background task; the next update tries again.
  }
});

export type PermissionResult = 'ok' | 'foreground-only' | 'denied';

export async function askLocationPermission(): Promise<PermissionResult> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'denied';
  const bg = await Location.requestBackgroundPermissionsAsync().catch(() => null);
  return bg?.status === 'granted' ? 'ok' : 'foreground-only';
}

export async function locationServicesOn(): Promise<boolean> {
  return Location.hasServicesEnabledAsync().catch(() => true);
}

export async function startTracking(title: string, body: string) {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) return;
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 60_000,
    distanceInterval: 50,
    deferredUpdatesInterval: 60_000,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.OtherNavigation,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: title,
      notificationBody: body,
      notificationColor: '#0a72d6',
      killServiceOnDestroy: false,
    },
  });
}

export async function stopTracking() {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
  }
}

/** A fresh fix for check-in / photos, falling back to the last known one. */
export async function currentPosition(): Promise<{ lat: number; lng: number; accuracy: number | null } | null> {
  try {
    const p = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((r) => setTimeout(() => r(null), 15_000)),
    ]);
    const fix = p ?? (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }));
    if (!fix) return null;
    return { lat: fix.coords.latitude, lng: fix.coords.longitude, accuracy: fix.coords.accuracy ?? null };
  } catch {
    return null;
  }
}

/** Store a point now (e.g. at shift start or check-in) so the route has no gap. */
export function recordPoint(lat: number, lng: number, accuracy: number | null) {
  const shift = q.activeShift();
  if (!shift) return;
  db().runSync('INSERT INTO trajectory (clientId, shiftId, lat, lng, accuracy, recordedAt) VALUES (?, ?, ?, ?, ?, ?)',
    uuid(), shift.clientId, lat, lng, accuracy, new Date().toISOString());
}
