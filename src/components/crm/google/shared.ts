/** Shared types and helpers for the Google page (Business Profile, Search Console, GA4, YouTube, Google Ads). */

export interface SourceRun { source: string; label: string; ok: boolean; rows: number; error?: string | null }
export interface GoogleStatus {
  connected: boolean;
  sources: { gbp: boolean; gsc: boolean; ga4: boolean; youtube: boolean; ads: boolean };
  names: { gbp?: string | null; gsc?: string | null; ga4?: string | null; youtube?: string | null; ads?: string | null };
  currency: string;
  syncedAt?: string | null;
  lastSync?: SourceRun[] | null;
  isAdmin: boolean;
}

export const n0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
export const n1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });

export function money(currency?: string | null) {
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 0 }); }
  catch { return n0; }
}

/** "+12%" / "−8%" against the previous period, or null when there is nothing to compare. For position, lower is better. */
export function change(value: number | null | undefined, prev: number | null | undefined, lowerIsBetter = false): { text: string; good: boolean | null } | null {
  if (value == null || prev == null) return null;
  if (prev === 0) return value === 0 ? null : { text: 'new', good: lowerIsBetter ? null : true };
  const pct = ((value - prev) / Math.abs(prev)) * 100;
  if (Math.abs(pct) < 0.5) return { text: 'same', good: null };
  const up = pct > 0;
  return { text: `${up ? '+' : '−'}${n0.format(Math.abs(pct))}%`, good: lowerIsBetter ? !up : up };
}

export const when = (iso?: string | null) => {
  if (!iso) return 'never';
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(d);
};

export const dayLabel = (ymd: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${ymd}T00:00:00Z`));

export const SOURCE_COLOR: Record<string, string> = { gbp: '#1a73e8', gsc: '#0f8a5f', ga4: '#e37400', youtube: '#d93025', google_ads: '#7b3fe4', reviews: '#f2a600' };
