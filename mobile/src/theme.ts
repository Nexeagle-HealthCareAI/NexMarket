import { kvGet } from './lib/db';

// NexEagle field app — colours and sizes from the design canvas.
export const C = {
  ink: '#0e1525',
  ink2: '#1a2236',
  inkLine: '#3a4560',
  sideText: '#aeb7ca',
  bg: '#f4f6fa',
  card: '#ffffff',
  border: '#e3e6ee',
  borderStrong: '#d5dbe6',
  line: '#eef0f4',
  text: '#0f172a',
  text2: '#5a6478',
  text3: '#3a4252',
  muted: '#8a93a6',
  blue: '#0a72d6',
  blueInk: '#0a4e94',
  blueSoft: '#e6f2fd',
  mint: '#38f6a9',
  ok: '#0f8a5f',
  okInk: '#0b6b4a',
  okSoft: '#e7f6ef',
  warn: '#d9822b',
  warnInk: '#8a5100',
  warnSoft: '#fff4e0',
  bad: '#b42318',
  badSoft: '#fdecea',
  info: '#0e7490',
  infoInk: '#0e6178',
  infoSoft: '#e6f6fa',
  purple: '#5b3fb8',
  purpleSoft: '#efeafd',
  star: '#e2a400',
  starSoft: '#fff8e1',
};

// ─── Sunlight mode: darker secondary text and stronger borders for outdoors ───
type SunKey = 'text2' | 'text3' | 'muted' | 'border' | 'borderStrong' | 'line';
const NORMAL: Record<SunKey, string> = { text2: C.text2, text3: C.text3, muted: C.muted, border: C.border, borderStrong: C.borderStrong, line: C.line };
const SUN: Record<SunKey, string> = { text2: '#2f3746', text3: '#1d2330', muted: '#4f586b', border: '#b9c1d0', borderStrong: '#8f99ad', line: '#d9dde6' };

/** Normal ↔ sunlight colour pairs, so text styles made before a switch can be swapped while drawing. */
const TO_SUN = new Map<string, string>();
const TO_NORMAL = new Map<string, string>();
for (const k of Object.keys(NORMAL) as SunKey[]) {
  TO_SUN.set(NORMAL[k], SUN[k]);
  TO_NORMAL.set(SUN[k], NORMAL[k]);
}

let sunlit = false;
/** True once sunlight colours have been used this run (styles may then hold either set). */
let mixed = false;

/** Switches C.* in place. Styles built after this read the new colours; T swaps older ones while drawing. */
export function applySunlight(on: boolean) {
  if (on === sunlit) return;
  sunlit = on;
  mixed = true;
  Object.assign(C, on ? SUN : NORMAL);
}
export const isSunlit = () => sunlit;
/** False until sunlight mode has been used this run: no colour swapping needed. */
export const colorsMixed = () => mixed;

/** The colour to draw for a colour written in a style: maps between the normal and sunlight sets. */
export function liveColor(c: string): string {
  if (!mixed) return c;
  return (sunlit ? TO_SUN.get(c) : TO_NORMAL.get(c)) ?? c;
}

// Read the saved setting before any screen builds its styles, so they start in the right colours.
try { if (kvGet('uxSunlight') === '1') applySunlight(true); } catch { /* database not ready: normal colours */ }

export const R = { sm: 10, md: 14, lg: 18, xl: 24 };

export type Priority = 'very_high' | 'high' | 'normal' | 'low';

export const PRIORITY_COLOR: Record<Priority, { fg: string; bg: string; dot: string }> = {
  very_high: { fg: C.bad, bg: C.badSoft, dot: C.bad },
  high: { fg: C.warnInk, bg: C.warnSoft, dot: C.warn },
  normal: { fg: C.blueInk, bg: C.blueSoft, dot: C.blue },
  low: { fg: C.text2, bg: '#f1f2f5', dot: C.muted },
};
