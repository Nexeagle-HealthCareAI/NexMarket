import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/**
 * Shows the app over the lock screen while a call screen is up (Android). Elsewhere (web preview, an older build without
 * the native part) it does nothing.
 */
const Native = Platform.OS === 'android' ? requireOptionalNativeModule<{ setOverLock(on: boolean): boolean }>('LockScreen') : null;

export function setOverLock(on: boolean): void {
  try { Native?.setOverLock(on); } catch { /* not available */ }
}

let holds = 0;
/**
 * Keeps the app over the lock screen while at least one call screen holds it (the incoming screen hands over to the call
 * screen without a gap). Returns the release.
 */
export function holdOverLock(): () => void {
  holds += 1;
  if (holds === 1) setOverLock(true);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
    if (holds === 0) setTimeout(() => { if (holds === 0) setOverLock(false); }, 300);
  };
}
