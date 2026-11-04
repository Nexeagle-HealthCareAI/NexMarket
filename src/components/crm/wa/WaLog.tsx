'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, RotateCcw, Search } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { Pager } from '@/components/crm/Pager';
import { Empty, ErrorBox, friendlyError, Pill, Skeleton, type Tone } from '@/components/crm/ui';
import { showPhone, sourceLabel, when } from './shared';

interface Row {
  id: string; at: string; phone: string; name?: string | null; direction: string; type: string; source: string; template?: string | null;
  text: string; status: string; error?: string | null; byName?: string | null; leadId?: string | null; canResend: boolean;
}
interface Res { items: Row[]; total: number; week: { sent: number; delivered: number; read: number; failed: number; blocked: number; received: number } }

const STATUS: Record<string, { label: string; tone: Tone }> = {
  received: { label: 'Received', tone: 'info' }, sent: { label: 'Sent', tone: 'neutral' }, delivered: { label: 'Delivered', tone: 'accent' },
  read: { label: 'Read', tone: 'ok' }, failed: { label: 'Failed', tone: 'bad' }, blocked: { label: 'Not sent', tone: 'warn' },
};
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');

/** Every WhatsApp message in and out: broadcasts, replies, automatic messages, with delivery status and resend. */
export function WaLog({ onOpen, toast, canManage }: { onOpen: (phone: string) => void; toast: (m: string) => void; canManage: boolean }) {
  const [direction, setDirection] = useState('');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);
  const [data, setData] = useState<Res | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setQd(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const qs = useMemo(() => {
    const sp = new URLSearchParams({ page: String(page), pageSize: String(size) });
    if (direction) sp.set('direction', direction);
    if (status) sp.set('status', status);
    if (source) sp.set('source', source);
    if (qd) sp.set('q', qd);
    return sp.toString();
  }, [direction, status, source, qd, page, size]);
  const load = useCallback(async () => {
    try { setData(await crm.get<Res>(`/api/v1/whatsapp/messages?${qs}`)); setError(null); } catch (e) { setError(friendlyError(e)); }
  }, [qs]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  const reset = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(1); };
  const resend = async (r: Row) => {
    setBusy(r.id);
    try { await crm.post(`/api/v1/whatsapp/messages/${r.id}/resend`); toast('Sent again.'); await load(); }
    catch (e) { toast(friendlyError(e)); } finally { setBusy(null); }
  };
  const w = data?.week;

  return (
    <div className="wl-wrap">
      <section className="ld-kpis" aria-label="Last 7 days">
        <Stat label="Received" value={w?.received} />
        <Stat label="Sent" value={w?.sent} />
        <Stat label="Delivered" value={w ? pct(w.delivered, w.sent) : undefined} sub={w ? `${w.delivered} messages` : undefined} />
        <Stat label="Read" value={w ? pct(w.read, w.sent) : undefined} sub={w ? `${w.read} messages` : undefined} tone="ok" />
        <Stat label="Failed or not sent" value={w ? w.failed + w.blocked : undefined} tone={w && w.failed + w.blocked > 0 ? 'bad' : undefined}
          onClick={() => { setStatus('problem'); setPage(1); }} />
      </section>
      <span className="crm-sub" style={{ marginTop: -10 }}>Last 7 days.</span>

      <div className="crm-card wl-card">
        <div className="wl-filters">
          <label className="ch-search" style={{ margin: 0, flex: '1 1 220px' }}>
            <Search size={16} aria-hidden />
            <span className="crm-sr">Search messages</span>
            <input value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder="Text, number or template" />
          </label>
          <select className="crm-select" value={direction} onChange={(e) => reset(setDirection)(e.target.value)} aria-label="Direction">
            <option value="">In and out</option><option value="in">Received</option><option value="out">Sent</option>
          </select>
          <select className="crm-select" value={status} onChange={(e) => reset(setStatus)(e.target.value)} aria-label="Status">
            <option value="">Any status</option><option value="problem">Failed or not sent</option><option value="sent">Sent</option>
            <option value="delivered">Delivered</option><option value="read">Read</option><option value="received">Received</option>
          </select>
          <select className="crm-select" value={source} onChange={(e) => reset(setSource)(e.target.value)} aria-label="Sent by">
            <option value="">Any source</option><option value="broadcast">Broadcasts</option><option value="inbox">Inbox replies</option>
            <option value="lead">Leads inbox</option><option value="auto">Instant replies</option><option value="rule">Keyword replies</option>
            <option value="followup">Follow-ups</option><option value="resend">Sent again</option>
          </select>
        </div>
        {error && <ErrorBox message={error} onRetry={load} />}
        {!data ? <Skeleton h={360} /> : data.items.length === 0 ? <Empty title="No messages match" /> : (
          <div className="crm-table-wrap">
            <table className="crm-table wl-table">
              <thead><tr><th>When</th><th>Who</th><th>Message</th><th>Sent by</th><th>Status</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {data.items.map((r) => {
                  const st = STATUS[r.status] ?? { label: r.status, tone: 'neutral' as Tone };
                  return (
                    <tr key={r.id}>
                      <td className="wl-when">
                        <span className={`wl-dir is-${r.direction}`} aria-label={r.direction === 'in' ? 'Received' : 'Sent'}>{r.direction === 'in' ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}</span>
                        {when(r.at)}
                      </td>
                      <td><button type="button" className="wa-link wl-who" onClick={() => onOpen(r.phone)}>{r.name ?? showPhone(r.phone)}</button>
                        {r.name && <span className="crm-cell-sub wl-sub">{showPhone(r.phone)}</span>}</td>
                      <td><span className="wl-text">{r.template && <span className="wl-tpl">{r.template}</span>}{r.text}</span></td>
                      <td>{r.direction === 'in' ? '—' : <>{sourceLabel(r.source)}{r.byName && <span className="crm-cell-sub wl-sub">{r.byName}</span>}</>}</td>
                      <td><Pill tone={st.tone}>{st.label}</Pill>{r.error && <span className="wl-err">{r.error}</span>}</td>
                      <td>{r.canResend && canManage && (
                        <button type="button" className="crm-btn is-secondary is-sm" disabled={busy === r.id} onClick={() => void resend(r)}><RotateCcw size={14} aria-hidden /> Send again</button>
                      )}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pager page={page} pages={Math.max(1, Math.ceil(data.total / size))} total={data.total} size={size} onPage={setPage} onSize={(n) => { setSize(n); setPage(1); }} noun="messages" />}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone, onClick }: { label: string; value?: number | string; sub?: string; tone?: 'ok' | 'bad'; onClick?: () => void }) {
  const inner = (
    <>
      <span className="crm-kpi-label">{label}</span>
      {value === undefined ? <Skeleton h={28} w={70} /> : <span className="ld-kpi-value">{value}</span>}
      {sub && <span className="ld-kpi-sub">{sub}</span>}
    </>
  );
  return onClick
    ? <button type="button" className={`crm-card ld-kpi wl-stat-btn${tone ? ` is-${tone}` : ''}`} onClick={onClick}>{inner}</button>
    : <div className={`crm-card ld-kpi${tone ? ` is-${tone}` : ''}`}>{inner}</div>;
}
