import * as Speech from 'expo-speech';
import { get } from './api';
import type { IconName } from '../components/Icon';
import type { Lang, TFn } from '../i18n';

/** In-app navigation: the road route from the server, where the agent is on it, and what to say next. */

export type Profile = 'car' | 'bike' | 'foot';
export interface NavStep { type: string; modifier?: string | null; name?: string | null; exit?: number | null; distanceM: number; durationS: number; lat: number; lng: number }
export interface NavRoute { ok: true; profile: Profile; distanceM: number; durationS: number; coords: [number, number][]; steps: NavStep[] }
type RouteRes = NavRoute | { ok: false; message?: string };

export async function fetchRoute(from: { lat: number; lng: number }, to: { lat: number; lng: number }, profile: Profile): Promise<NavRoute | null> {
  const qs = `fromLat=${from.lat}&fromLng=${from.lng}&toLat=${to.lat}&toLng=${to.lng}&profile=${profile === 'foot' ? 'foot' : 'car'}`;
  try {
    const r = await get<RouteRes>(`/api/v1/route?${qs}`);
    return r.ok && r.coords.length > 1 ? r : null;
  } catch {
    return null;
  }
}

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

export function distM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Compass bearing from a to b, 0–360°. */
export function bearing(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const DIRS = ['dirN', 'dirNE', 'dirE', 'dirSE', 'dirS', 'dirSW', 'dirW', 'dirNW'] as const;
export const compassKey = (deg: number) => DIRS[Math.round(deg / 45) % 8];

/**
 * Where the agent is along the route: the closest point on the line, how far off it they are, and how much of the
 * route is left. Works on a flat local projection, which is accurate enough over a few kilometres.
 */
export interface Progress { offM: number; doneM: number; leftM: number; seg: number }
export function progressOn(coords: [number, number][], here: { lat: number; lng: number }): Progress {
  const k = Math.cos(rad(here.lat)) * 111320, m = 110540;
  const P = (c: [number, number]) => ({ x: c[1] * k, y: c[0] * m });
  const h = { x: here.lng * k, y: here.lat * m };
  let best = { d: Infinity, seg: 0, t: 0 };
  const segLen: number[] = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const a = P(coords[i]), b = P(coords[i + 1]);
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
    segLen.push(Math.sqrt(L2));
    const t = L2 ? Math.max(0, Math.min(1, ((h.x - a.x) * dx + (h.y - a.y) * dy) / L2)) : 0;
    const px = a.x + t * dx, py = a.y + t * dy;
    const d = Math.hypot(h.x - px, h.y - py);
    if (d < best.d) best = { d, seg: i, t };
  }
  const total = segLen.reduce((s, x) => s + x, 0);
  const done = segLen.slice(0, best.seg).reduce((s, x) => s + x, 0) + segLen[best.seg] * best.t;
  return { offM: best.d, doneM: done, leftM: Math.max(0, total - done), seg: best.seg };
}

/** Distance along the route from its start to the point closest to this step's turn. */
export function stepPositions(coords: [number, number][], steps: NavStep[]): number[] {
  return steps.map((s) => progressOn(coords, s).doneM);
}

export function stepIcon(s: NavStep): IconName {
  if (s.type === 'arrive') return 'arrive';
  if (s.type === 'roundabout' || s.type === 'rotary' || s.type === 'roundabout turn') return 'roundabout';
  const m = s.modifier ?? '';
  if (m === 'uturn') return 'uturn';
  if (m === 'sharp left' || m === 'left') return 'turnLeft';
  if (m === 'sharp right' || m === 'right') return 'turnRight';
  if (m === 'slight left') return 'slightLeft';
  if (m === 'slight right') return 'slightRight';
  return 'straight';
}

/** "Turn left onto NH 327E", in the agent's language. */
export function stepText(s: NavStep, t: TFn): string {
  const m = s.modifier ?? 'straight';
  const dir = ({ left: t('navLeft'), right: t('navRight'), 'slight left': t('navSlightLeft'), 'slight right': t('navSlightRight'),
    'sharp left': t('navSharpLeft'), 'sharp right': t('navSharpRight'), uturn: t('navUturn'), straight: t('navStraight') } as Record<string, string>)[m] ?? t('navStraight');
  const onto = s.name ? ` ${t('navOnto', { road: s.name })}` : '';
  switch (s.type) {
    case 'depart': return `${t('navStart')}${onto}`;
    case 'arrive': return t('navArrive');
    case 'roundabout': case 'rotary': case 'roundabout turn':
      return s.exit ? `${t('navRoundaboutExit', { n: s.exit })}${onto}` : `${t('navRoundabout')}${onto}`;
    case 'fork': return `${t('navKeep', { dir })}${onto}`;
    case 'end of road': case 'turn': case 'on ramp': case 'off ramp': case 'merge':
      return m === 'uturn' ? t('navUturn') : m === 'straight' ? `${t('navStraight')}${onto}` : `${t('navTurn', { dir })}${onto}`;
    case 'new name': case 'continue': case 'notification':
      return m === 'straight' ? `${t('navContinue')}${onto}` : `${t('navTurn', { dir })}${onto}`;
    default: return `${t('navContinue')}${onto}`;
  }
}

export function fmtDist(m: number, t: TFn): string {
  if (m < 1000) return t('navMeters', { n: Math.max(10, Math.round(m / 10) * 10) });
  return t('navKm', { n: (m / 1000).toFixed(m < 10000 ? 1 : 0) });
}
export function fmtDur(s: number, t: TFn): string {
  const min = Math.max(1, Math.round(s / 60));
  return min < 60 ? t('navMin', { n: min }) : t('navHourMin', { h: Math.floor(min / 60), m: min % 60 });
}

/** Spoken guidance with the phone's own voice. Hindi and Bangla when the phone has them; Hinglish is read in English. */
const VOICE: Record<Lang, string> = { en: 'en-IN', hi: 'hi-IN', hinglish: 'en-IN', bn: 'bn-IN' };
export function say(text: string, lang: Lang) {
  try { Speech.stop(); Speech.speak(text, { language: VOICE[lang] ?? 'en-IN', rate: 0.95 }); } catch { /* no voice on this phone */ }
}
export function quiet() { try { Speech.stop(); } catch { /* ignore */ } }
