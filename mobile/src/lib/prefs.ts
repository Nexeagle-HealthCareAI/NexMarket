import React, { createContext, createElement, useContext, useSyncExternalStore } from 'react';
import { PermissionsAndroid, Platform, Vibration } from 'react-native';
import { kvGet, kvSet } from './db';
import { applySunlight } from '../theme';

/**
 * "Easy to use" settings from the Me screen: text size, sunlight mode, read screens aloud, vibrate when saved.
 * Kept in kv (so they are ready before the first screen draws); components re-render through usePrefs().
 */
export type TextSize = 'normal' | 'large' | 'xl';
export interface Prefs {
  textSize: TextSize; scale: number; sunlight: boolean; readAloud: boolean; vibrate: boolean;
  /** Calls start with voice only and video stays small: for weak signal and small data packs. */
  dataSaver: boolean;
}

export const TEXT_SCALE: Record<TextSize, number> = { normal: 1, large: 1.15, xl: 1.3 };

function read(): Prefs {
  const get = (k: string) => { try { return kvGet(k); } catch { return null; } };
  const size = get('uxTextSize');
  const textSize: TextSize = size === 'large' || size === 'xl' ? size : 'normal';
  return {
    textSize,
    scale: TEXT_SCALE[textSize],
    sunlight: get('uxSunlight') === '1',
    readAloud: get('uxReadAloud') === '1',
    vibrate: get('uxVibrate') !== '0', // on unless turned off
    dataSaver: get('uxDataSaver') === '1',
  };
}

let prefs: Prefs = read();
const listeners = new Set<() => void>();

export const getPrefs = (): Prefs => prefs;
export function onPrefs(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Change one or more settings; saved at once and every screen redraws. */
export function setPrefs(patch: Partial<Omit<Prefs, 'scale'>>) {
  const next = { ...prefs, ...patch };
  next.scale = TEXT_SCALE[next.textSize];
  try {
    if (patch.textSize !== undefined) kvSet('uxTextSize', next.textSize);
    if (patch.sunlight !== undefined) kvSet('uxSunlight', next.sunlight ? '1' : '0');
    if (patch.readAloud !== undefined) kvSet('uxReadAloud', next.readAloud ? '1' : '0');
    if (patch.vibrate !== undefined) kvSet('uxVibrate', next.vibrate ? '1' : '0');
    if (patch.dataSaver !== undefined) kvSet('uxDataSaver', next.dataSaver ? '1' : '0');
  } catch { /* still applies for this run */ }
  applySunlight(next.sunlight);
  prefs = next;
  listeners.forEach((l) => l());
}

// kv keys that belong to the phone, not the person: they outlive sign-out like the language does.
const PHONE_KEYS = ['uxTextSize', 'uxSunlight', 'uxReadAloud', 'uxVibrate', 'uxDataSaver', 'uxTourSeen'];

/** Read before wipeAll(): the phone's own settings and the "tour seen" flag. */
export function keepPhoneKv(): [string, string][] {
  const out: [string, string][] = [];
  for (const k of PHONE_KEYS) { try { const v = kvGet(k); if (v != null) out.push([k, v]); } catch { /* skip */ } }
  return out;
}
/** Write them back after wipeAll(). */
export function restorePhoneKv(kept: [string, string][]) {
  for (const [k, v] of kept) { try { kvSet(k, v); } catch { /* skip */ } }
}

/** Write the settings back after sign-in / sign-out cleared the kv table, so they belong to the phone. */
export function persistPrefs() {
  const { textSize, sunlight, readAloud, vibrate } = prefs;
  setPrefs({ textSize, sunlight, readAloud, vibrate });
}

// One subscription at the root; every T reads the settings from context (cheaper than one store hook per text).
const Ctx = createContext<Prefs | null>(null);
export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const p = useSyncExternalStore(onPrefs, getPrefs);
  return createElement(Ctx.Provider, { value: p }, children);
}

/** The current settings; the component redraws when they change. */
export function usePrefs(): Prefs {
  return useContext(Ctx) ?? prefs;
}

// Builds without the VIBRATE permission would crash on Vibration, so check once first.
let canVibrate: Promise<boolean> | null = null;
function vibrateAllowed(): Promise<boolean> {
  if (Platform.OS !== 'android') return Promise.resolve(true);
  if (!canVibrate) {
    canVibrate = PermissionsAndroid.check('android.permission.VIBRATE' as never).catch(() => false);
  }
  return canVibrate;
}

/** Call after something is saved: a short buzz when "Vibrate when saved" is on. Never throws. */
export function savedFeedback() {
  if (!prefs.vibrate) return;
  void vibrateAllowed().then((ok) => { if (ok) { try { Vibration.vibrate(35); } catch { /* no vibrator */ } } });
}
