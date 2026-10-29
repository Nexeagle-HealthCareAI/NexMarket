import * as Crypto from 'expo-crypto';

export const uuid = (): string => Crypto.randomUUID();

export function nowIso(): string {
  return new Date().toISOString();
}

/** Local calendar date (the phone is on IST) as yyyy-MM-dd. */
export function ymd(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfDay(d: Date = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Whole days from today to the given date (negative = in the past). */
export function daysFromToday(dateStr: string): number {
  const ms = startOfDay(parseYmd(dateStr)).getTime() - startOfDay().getTime();
  return Math.round(ms / 86400000);
}

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2
    + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
}

export function digitsOnly(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '');
}

/** Distance of a route in km, skipping GPS jumps no bike can make. */
export function routeKm(points: { lat: number; lng: number; recordedAt: string }[]): number {
  let m = 0;
  for (let i = 1; i < points.length; i++) {
    const d = haversineM(points[i - 1], points[i]);
    const hours = Math.max((Date.parse(points[i].recordedAt) - Date.parse(points[i - 1].recordedAt)) / 3600000, 1 / 3600);
    if (d < 30 || d / 1000 / hours > 90) continue;
    m += d;
  }
  return Math.round(m / 100) / 10;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
