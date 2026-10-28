'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

// ─── Formatting ─────────────────────────────────────────────────────────────

export const CONTACT_TYPES: { value: string; label: string }[] = [
  { value: 'rmp_doctor', label: 'RMP' },
  { value: 'asha_worker', label: 'ASHA' },
  { value: 'nursing_home', label: 'Nursing home' },
  { value: 'independent_doctor', label: 'Independent doctor' },
  { value: 'medicine_shop', label: 'Chemist' },
  { value: 'lab', label: 'Lab' },
  { value: 'hospital', label: 'Hospital' },
  { value: 'mukhiya', label: 'Mukhiya' },
  { value: 'ward_member', label: 'Ward member' },
  { value: 'prominent_person', label: 'Prominent person' },
  { value: 'other', label: 'Other' },
];

export function contactTypeLabel(v?: string | null): string {
  if (!v) return '';
  return CONTACT_TYPES.find((t) => t.value === v)?.label ?? v.replace(/_/g, ' ');
}

export function initials(name?: string | null): string {
  const parts = (name ?? '').replace(/^(dr\.?|shri|smt\.?)\s+/i, '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export function rupees(n?: number | null): string {
  return inr.format(Math.round(n ?? 0));
}

const istDate = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
const istDateTime = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const istTime = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const istLong = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });

export const fmt = {
  date: (iso?: string | null) => (iso ? istDate.format(new Date(iso)) : '—'),
  dateTime: (iso?: string | null) => (iso ? istDateTime.format(new Date(iso)) : '—'),
  time: (iso?: string | null) => (iso ? istTime.format(new Date(iso)) : '—'),
  today: () => istLong.format(new Date()),
};

/** "API /x → 400: Pick how the call went." → "Pick how the call went." */
export function friendlyError(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  if (!msg) return fallback;
  if (/→ 403/.test(msg)) return "You don't have access to do this. Ask an admin.";
  if (/→ 401/.test(msg)) return 'Your session has ended. Please sign in again.';
  const m = msg.match(/→ \d{3}: ([\s\S]+)$/);
  if (m) {
    const body = m[1].trim();
    try {
      const j = JSON.parse(body);
      if (typeof j === 'string') return j;
      if (j?.title) return j.title;
    } catch { /* plain text */ }
    return body.replace(/^"|"$/g, '') || fallback;
  }
  if (/Failed to fetch|NetworkError/i.test(msg)) return "Can't reach the server. Check your internet connection.";
  return fallback;
}

// ─── Stage + tone helpers ───────────────────────────────────────────────────

export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad' | 'info';

export const STAGES: { key: string; label: string; tone: Tone }[] = [
  { key: 'pending', label: 'Referred', tone: 'accent' },
  { key: 'arrived', label: 'Arrived', tone: 'info' },
  { key: 'opd', label: 'Seen in OPD', tone: 'info' },
  { key: 'admitted', label: 'Admitted', tone: 'ok' },
  { key: 'procedure', label: 'Procedure done', tone: 'ok' },
  { key: 'discharged', label: 'Discharged', tone: 'ok' },
  { key: 'lost', label: 'Did not come', tone: 'neutral' },
];

export function stageTone(status?: string | null): Tone {
  if (status === 'converted') return 'ok';
  return STAGES.find((s) => s.key === status)?.tone ?? 'neutral';
}

export function stageLabel(status?: string | null): string {
  if (status === 'converted') return 'Admitted';
  return STAGES.find((s) => s.key === status)?.label ?? status ?? '';
}

// ─── Small components ───────────────────────────────────────────────────────

export function Pill({ tone = 'neutral', dot, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`crm-pill tone-${tone}`}>
      {dot && <span className="dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function PageHead({ title, sub, children, badge }: { title: string; sub?: ReactNode; children?: ReactNode; badge?: ReactNode }) {
  return (
    <header className="crm-page-head">
      <div className="crm-page-title">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h1 className="crm-h1">{title}</h1>
          {badge}
        </div>
        {sub && <span className="crm-sub">{sub}</span>}
      </div>
      {children}
    </header>
  );
}

export function Skeleton({ h = 18, w = '100%', style }: { h?: number; w?: number | string; style?: React.CSSProperties }) {
  return <div className="crm-skel" style={{ height: h, width: w, ...style }} aria-hidden="true" />;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="crm-empty">
      <strong style={{ color: 'var(--text)', fontSize: 15 }}>{title}</strong>
      {children}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="crm-error" role="alert" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <span style={{ flex: 1 }}>{message}</span>
      {onRetry && <button type="button" className="crm-btn is-secondary is-sm" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Modal({ title, onClose, children, actions, wide }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="crm-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="crm-modal" role="dialog" aria-modal="true" aria-label={title} ref={ref} style={wide ? { maxWidth: 720 } : undefined}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 className="crm-h2" style={{ marginRight: 'auto' }}>{title}</h2>
          <button type="button" className="crm-btn is-secondary is-sm" aria-label="Close" onClick={onClose} style={{ width: 36, padding: 0 }}><X size={16} /></button>
        </div>
        {children}
        {actions && <div className="crm-modal-actions">{actions}</div>}
      </div>
    </div>
  );
}

/** A small toast at the bottom of the screen. */
export function useToast(): [ReactNode, (msg: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((m: string) => {
    setMsg(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 3200);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return [msg ? <div className="crm-toast" role="status">{msg}</div> : null, show];
}

/** Loads data, exposes reload, and keeps the last good value while reloading. */
export function useLoader<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const d = await loadRef.current();
      setData(d);
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    loadRef.current()
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e) => { if (!cancelled) setError(friendlyError(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload, setData };
}
