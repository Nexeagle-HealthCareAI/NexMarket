import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import { kvGet, kvSet } from './db';

/**
 * Light mode for older and low-memory phones. It switches off the moving parts (the moving background, pulsing dots,
 * Vita floating, sliding screens) and uses a simpler map. Nothing the agent can do changes: only how it looks.
 *
 * 'auto' (the default) turns it on by itself for phones on Android 9 or older, with 3 GB of memory or less, or made
 * before 2018. The agent can force it on or off from Me.
 */
export type PerfMode = 'auto' | 'lite' | 'full';
const KEY = 'perf.mode';

function detectOldPhone(): boolean {
  if (Platform.OS !== 'android') return false;
  try {
    const api = typeof Platform.Version === 'number' ? Platform.Version : Number(Platform.Version);
    if (api > 0 && api < 29) return true; // Android 9 or older
    const mem = Device.totalMemory; // bytes; a "3 GB" phone reports a little under 3 GB
    if (mem != null && mem > 0 && mem < 3.5e9) return true;
    const year = Device.deviceYearClass;
    if (year != null && year < 2018) return true;
  } catch { /* unknown phone: keep the full look */ }
  return false;
}

/** Whether this phone counts as old or low on memory (what 'auto' goes by). */
export const oldPhone = detectOldPhone();

let mode: PerfMode | null = null;
let liteNow = false;
const listeners = new Set<() => void>();

function load() {
  if (mode != null) return;
  let m: string | null = null;
  try { m = kvGet(KEY); } catch { /* database not ready yet */ }
  mode = m === 'lite' || m === 'full' ? m : 'auto';
  liteNow = mode === 'lite' || (mode === 'auto' && oldPhone);
}

/** True when the light look is on. Cheap to call anywhere, including outside React. */
export function lite(): boolean {
  load();
  return liteNow;
}

export function perfMode(): PerfMode {
  load();
  return mode as PerfMode;
}

export function setPerfMode(m: PerfMode) {
  mode = m;
  liteNow = m === 'lite' || (m === 'auto' && oldPhone);
  try { kvSet(KEY, m === 'auto' ? null : m); } catch { /* keep it for this session */ }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Re-renders when light mode turns on or off. */
export function useLite(): boolean {
  return useSyncExternalStore(subscribe, lite);
}

/** The setting itself (auto / on / off), for the settings screen. */
export function usePerfMode(): PerfMode {
  return useSyncExternalStore(subscribe, perfMode);
}
