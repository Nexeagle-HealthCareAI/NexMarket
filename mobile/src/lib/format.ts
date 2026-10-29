import { localeTag, type Lang, type TFn } from '../i18n';
import { parseYmd } from './util';

function fmt(lang: Lang, d: Date, o: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat(localeTag(lang), o).format(d);
  } catch {
    return d.toDateString();
  }
}

export const timeOf = (lang: Lang, iso: string) => fmt(lang, new Date(iso), { hour: 'numeric', minute: '2-digit' });
export const dayLong = (lang: Lang, d: Date = new Date()) => fmt(lang, d, { weekday: 'long', day: 'numeric', month: 'long' });
export const dayShort = (lang: Lang, d: Date | string) => fmt(lang, typeof d === 'string' ? parseYmd(d) : d, { day: 'numeric', month: 'short' });
export const monthName = (lang: Lang, d: Date) => fmt(lang, d, { month: 'long', year: 'numeric' });
export const weekday = (lang: Lang, d: Date) => fmt(lang, d, { weekday: 'short' });

export function duration(t: TFn, ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return t('minutes', { n: mins });
  return t('hoursMinutes', { h: Math.floor(mins / 60), m: mins % 60 });
}

export function km(t: TFn, kmValue: number): string {
  return t('km', { n: kmValue < 10 ? kmValue.toFixed(1) : Math.round(kmValue) });
}

/** "today" / "yesterday" / a short date. */
export function relDay(t: TFn, lang: Lang, iso: string): string {
  const d = new Date(iso);
  const a = new Date(); a.setHours(0, 0, 0, 0);
  const b = new Date(d); b.setHours(0, 0, 0, 0);
  const diff = Math.round((a.getTime() - b.getTime()) / 86400000);
  if (diff === 0) return t('today');
  if (diff === 1) return t('yesterday');
  return dayShort(lang, d);
}
