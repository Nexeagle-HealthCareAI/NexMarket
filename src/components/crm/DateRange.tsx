'use client';

import { CalendarDays } from 'lucide-react';

/** Date filter for boards: All, Today, Yesterday, last 7/30 days, this month, or a custom range (India time). */
export type DateRangeKey = '' | 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom';
export interface DateRangeValue { key: DateRangeKey; from: string; to: string }

const ist = (n = 0) => new Date(Date.now() + 5.5 * 3600 * 1000 - n * 864e5).toISOString().slice(0, 10);
export const istToday = () => ist(0);

export const DATE_RANGES: { k: DateRangeKey; l: string }[] = [
  { k: '', l: 'All' }, { k: 'today', l: 'Today' }, { k: 'yesterday', l: 'Yesterday' },
  { k: '7d', l: 'Last 7 days' }, { k: '30d', l: 'Last 30 days' }, { k: 'month', l: 'This month' }, { k: 'custom', l: 'Custom' },
];

/** The yyyy-MM-dd days the range covers (both included), or null for All. */
export function rangeDays(v: DateRangeValue): { from: string; to: string } | null {
  const t = ist(0);
  switch (v.key) {
    case 'today': return { from: t, to: t };
    case 'yesterday': return { from: ist(1), to: ist(1) };
    case '7d': return { from: ist(6), to: t };
    case '30d': return { from: ist(29), to: t };
    case 'month': return { from: `${t.slice(0, 8)}01`, to: t };
    case 'custom': return v.from || v.to ? { from: v.from, to: v.to } : null;
    default: return null;
  }
}

/** Adds from/to to a query when a range is picked. */
export function addRange(sp: URLSearchParams, v: DateRangeValue) {
  const r = rangeDays(v);
  if (r?.from) sp.set('from', r.from);
  if (r?.to) sp.set('to', r.to);
}

/** "Today", "1 Nov – 5 Nov", "since 1 Nov"… for a sentence such as "Answers from …". */
export function rangeLabel(v: DateRangeValue): string {
  if (!v.key) return 'all time';
  if (v.key !== 'custom') return DATE_RANGES.find((r) => r.k === v.key)!.l.toLowerCase();
  const f = (d: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(`${d}T00:00:00`));
  if (v.from && v.to) return v.from === v.to ? f(v.from) : `${f(v.from)} – ${f(v.to)}`;
  if (v.from) return `since ${f(v.from)}`;
  if (v.to) return `up to ${f(v.to)}`;
  return 'all time';
}

export function DateRangeBar({ value, onChange, id = 'dr' }: { value: DateRangeValue; onChange: (v: DateRangeValue) => void; id?: string }) {
  const today = istToday();
  return (
    <div className="pt-dates" role="group" aria-label="Date">
      <CalendarDays size={16} aria-hidden color="var(--text-2)" />
      <div className="pt-seg" role="group" aria-label="Date range">
        {DATE_RANGES.map((r) => (
          <button key={r.k} type="button" aria-pressed={value.key === r.k} onClick={() => {
            if (r.k === 'custom' && !value.from && !value.to) onChange({ key: 'custom', from: ist(6), to: today });
            else onChange({ ...value, key: r.k });
          }}>{r.l}</button>
        ))}
      </div>
      {value.key === 'custom' && (
        <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="crm-sr" htmlFor={`${id}-from`}>From</label>
          <input id={`${id}-from`} type="date" className="crm-input" style={{ width: 160, height: 36 }} value={value.from} max={value.to || today}
            onChange={(e) => onChange({ ...value, from: e.target.value })} />
          <span className="crm-sub">to</span>
          <label className="crm-sr" htmlFor={`${id}-to`}>To</label>
          <input id={`${id}-to`} type="date" className="crm-input" style={{ width: 160, height: 36 }} value={value.to} min={value.from || undefined} max={today}
            onChange={(e) => onChange({ ...value, to: e.target.value })} />
        </span>
      )}
    </div>
  );
}
