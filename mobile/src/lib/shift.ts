import { Linking, Platform } from 'react-native';
import { askLocationPermission, currentPosition, recordPoint, startTracking, stopTracking } from './location';
import { endShift, startShift } from './repo';
import { q } from './db';
import { syncNow } from './sync';
import type { TFn } from '../i18n';

export type BeginResult = 'ok' | 'denied' | 'no-fix';

/** Start the day: permission, a first GPS fix, the shift row, then background tracking. */
export async function beginShift(t: TFn): Promise<BeginResult> {
  const perm = await askLocationPermission();
  if (perm === 'denied') return 'denied';
  const pos = await currentPosition();
  if (!pos) return 'no-fix';
  if (!q.activeShift()) startShift(pos.lat, pos.lng);
  recordPoint(pos.lat, pos.lng, pos.accuracy);
  // Without "Allow all the time" tracking still works while the app is open.
  await startTracking(t('appName'), t('locationNoticeEn')).catch(() => undefined);
  void syncNow(true);
  return 'ok';
}

export async function finishShift() {
  const pos = await currentPosition();
  if (pos) recordPoint(pos.lat, pos.lng, pos.accuracy);
  endShift(pos?.lat ?? null, pos?.lng ?? null);
  await stopTracking();
  void syncNow(true);
}

/** Make sure tracking is running if the app was killed mid-shift and reopened. */
export async function resumeTrackingIfNeeded(t: TFn) {
  if (q.activeShift()) await startTracking(t('appName'), t('locationNoticeEn')).catch(() => undefined);
}

/** Opens this app's system settings page (battery / location permission live there). */
export function openAppSettings() {
  if (Platform.OS === 'android') {
    Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS').catch(() => Linking.openSettings());
  } else {
    void Linking.openSettings();
  }
}
