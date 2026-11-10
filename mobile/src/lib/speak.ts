import * as Speech from 'expo-speech';
import type { Lang } from '../i18n';
import { getPrefs } from './prefs';

/**
 * Read text aloud with the phone's own voice, in the app's language (Hinglish is read with the Hindi voice).
 * A new call stops whatever was being read before.
 */
const VOICE: Record<Lang, string> = { en: 'en-IN', hi: 'hi-IN', hinglish: 'hi-IN', bn: 'bn-IN' };

export function speak(text: string, lang: Lang) {
  const s = text.trim();
  try {
    void Speech.stop();
    if (s) Speech.speak(s, { language: VOICE[lang] ?? 'en-IN', rate: 0.9 });
  } catch { /* no voice on this phone */ }
}

export function stopSpeaking() {
  try { void Speech.stop(); } catch { /* ignore */ }
}

// Screens already explained this app session.
const explained = new Set<string>();

/** When "Read screens aloud" is on, reads a screen's explanation the first time it opens this session. */
export function explainOnce(key: string, text: string, lang: Lang) {
  if (!getPrefs().readAloud || !text.trim() || explained.has(key)) return;
  explained.add(key);
  speak(text, lang);
}
