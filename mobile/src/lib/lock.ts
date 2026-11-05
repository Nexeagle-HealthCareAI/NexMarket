import { useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';

/**
 * Quick unlock: once signed in with the password, the agent opens the app with a PIN or their fingerprint instead.
 * The session tokens stay in the keystore; this only decides whether the app shows anything. Everything lives in the
 * phone's secure keystore: the PIN as a salted hash, never the PIN itself.
 *
 * Five wrong PINs in a row end quick unlock: the agent must sign in with the password again (data on the phone is kept).
 */

const K_HASH = 'lock.pinHash';
const K_SALT = 'lock.pinSalt';
const K_LEN = 'lock.pinLen';
const K_BIO = 'lock.bio';
const K_AFTER = 'lock.afterMin';
const K_FAILS = 'lock.fails';
const K_ASKED = 'lock.asked';

export const MAX_PIN_TRIES = 5;
export const LOCK_AFTER_CHOICES = [0, 1, 5, 15] as const; // minutes in the background before asking again; 0 = every time

let pinSet = false;
let pinLen = 4;
let bio = false;
let afterMin = 1;
let asked = false;
let locked = false;
let loaded = false;
const listeners = new Set<() => void>();
let snapshot = { pinSet, pinLen, bio, afterMin, asked, locked, loaded };
function emit() {
  snapshot = { pinSet, pinLen, bio, afterMin, asked, locked, loaded };
  listeners.forEach((l) => l());
}

/** Reads the settings once at start-up; the app starts locked when a PIN is set. */
export async function loadLock(): Promise<void> {
  const [h, len, b, a, k] = await Promise.all([
    SecureStore.getItemAsync(K_HASH), SecureStore.getItemAsync(K_LEN), SecureStore.getItemAsync(K_BIO),
    SecureStore.getItemAsync(K_AFTER), SecureStore.getItemAsync(K_ASKED),
  ]);
  pinSet = !!h;
  pinLen = Number(len) || 4;
  bio = pinSet && b === '1';
  afterMin = a != null && !Number.isNaN(Number(a)) ? Number(a) : 1;
  asked = k === '1';
  locked = pinSet;
  loaded = true;
  emit();
}

export function useLock() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => snapshot);
}
export const lockState = () => snapshot;

export function lockNow() {
  if (pinSet && !locked) { locked = true; emit(); }
}
function unlock() {
  locked = false;
  emit();
}

async function hash(pin: string, salt: string): Promise<string> {
  // Many rounds so a copied keystore value can't be tried quickly.
  let h = `${salt}:${pin}`;
  for (let i = 0; i < 200; i++) h = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}${h}`);
  return h;
}

export async function setPin(pin: string): Promise<void> {
  const salt = Crypto.randomUUID();
  await SecureStore.setItemAsync(K_SALT, salt);
  await SecureStore.setItemAsync(K_HASH, await hash(pin, salt));
  await SecureStore.setItemAsync(K_LEN, String(pin.length));
  await SecureStore.deleteItemAsync(K_FAILS);
  await SecureStore.setItemAsync(K_ASKED, '1');
  pinSet = true; pinLen = pin.length; asked = true; locked = false;
  emit();
}

/** Checks a PIN. Returns 'ok', or how many tries are left; 0 left means quick unlock was switched off. */
export async function checkPin(pin: string): Promise<'ok' | number> {
  const [h, salt, f] = await Promise.all([SecureStore.getItemAsync(K_HASH), SecureStore.getItemAsync(K_SALT), SecureStore.getItemAsync(K_FAILS)]);
  if (!h || !salt) return 0;
  if ((await hash(pin, salt)) === h) {
    await SecureStore.deleteItemAsync(K_FAILS);
    unlock();
    return 'ok';
  }
  const fails = (Number(f) || 0) + 1;
  if (fails >= MAX_PIN_TRIES) {
    await clearQuickUnlock();
    return 0;
  }
  await SecureStore.setItemAsync(K_FAILS, String(fails));
  return MAX_PIN_TRIES - fails;
}

/** Removes the PIN and fingerprint (e.g. on sign-out, or after too many wrong PINs). */
export async function clearQuickUnlock(): Promise<void> {
  await Promise.all([K_HASH, K_SALT, K_LEN, K_BIO, K_FAILS].map((k) => SecureStore.deleteItemAsync(k)));
  pinSet = false; bio = false; locked = false;
  emit();
}

export async function setLockAfter(min: number): Promise<void> {
  afterMin = min;
  await SecureStore.setItemAsync(K_AFTER, String(min));
  emit();
}

/** The agent said "not now" to setting up quick unlock; don't ask again after every sign-in. */
export async function markAsked(): Promise<void> {
  asked = true;
  await SecureStore.setItemAsync(K_ASKED, '1');
  emit();
}

// ─── Fingerprint ───

export type BioSupport = 'ready' | 'not_enrolled' | 'none';

/** Whether the phone has a fingerprint (or face) sensor with at least one finger saved. */
export async function bioSupport(): Promise<BioSupport> {
  try {
    if (!(await LocalAuthentication.hasHardwareAsync())) return 'none';
    return (await LocalAuthentication.isEnrolledAsync()) ? 'ready' : 'not_enrolled';
  } catch {
    return 'none';
  }
}

/** Asks the phone for the fingerprint. Only the phone sees it; the app just gets yes or no. */
export async function askBio(prompt: string, cancel: string): Promise<boolean> {
  try {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: prompt, cancelLabel: cancel, disableDeviceFallback: true });
    return r.success;
  } catch {
    return false;
  }
}

export async function setBio(on: boolean): Promise<void> {
  if (on) await SecureStore.setItemAsync(K_BIO, '1'); else await SecureStore.deleteItemAsync(K_BIO);
  bio = on && pinSet;
  emit();
}

/** Fingerprint unlock (the PIN stays as the fallback). */
export async function unlockWithBio(prompt: string, cancel: string): Promise<boolean> {
  if (!bio) return false;
  const ok = await askBio(prompt, cancel);
  if (ok) { await SecureStore.deleteItemAsync(K_FAILS); unlock(); }
  return ok;
}
