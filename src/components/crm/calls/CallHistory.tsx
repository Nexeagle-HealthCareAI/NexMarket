'use client';

import { useEffect, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { DateRangeBar, rangeDays, rangeLabel, type DateRangeValue } from '@/components/crm/DateRange';
import { Pager } from '@/components/crm/Pager';
import { contactTypeLabel, Empty, ErrorBox, friendlyError, Pill, Skeleton, useLoader } from '@/components/crm/ui';

interface HistRow {
  id: string; at: string; contactId: string; name: string; type?: string | null; phone?: string | null; panchayat?: string | null; block?: string | null;
  calledById: string; calledBy: string; outcome: string; outcomeLabel: string; responses: string[]; note?: string | null; attempt: number; callBackAt?: string | null;
}
interface HistRes {
  summary: { calls: number; people: number; connected: number; byOutcome: { key: string; label: string; n: number }[]; byCaller: { id: string; name: string; calls: number; connected: number; people: number }[] };
  total: number; page: number; pageSize: number; items: HistRow[];
}
const TONE: Record<string, 'ok' | 'warn' | 'accent' | 'bad'> = { connected: 'ok', no_answer: 'warn', call_later: 'accent', wrong_number: 'bad' };
const when = (iso: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(iso));

/** Who the call desk contacted: yesterday by default, or any day or range, with who called and what came of it. */
export function CallHistory({ onOpen, toast }: { onOpen: (contactId: string) => void; toast: (m: string) => void }) {
  const [range, setRange] = useState<DateRangeValue>({ key: 'yesterday', from: '', to: '' });
  const [calledBy, setCalledBy] = useState('');
  const [outcome, setOutcome] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);
  useEffect(() => { const t = setTimeout(() => { setQ(search.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);

  const qs = () => {
    const d = rangeDays(range);
    const sp = new URLSearchParams();
    if (d?.from) sp.set('from', d.from);
    if (d?.to) sp.set('to', d.to);
    if (calledBy) sp.set('calledBy', calledBy);
    if (outcome) sp.set('outcome', outcome);
    return sp;
  };
  const data = useLoader(() => {
    const sp = qs(); if (q) sp.set('q', q); sp.set('page', String(page)); sp.set('pageSize', String(size));
    return crm.get<HistRes>(`/api/v1/calls/history?${sp}`);
  }, [range.key, range.from, range.to, calledBy, outcome, q, page, size]);
  const d = data.data;
  const s = d?.summary;
  const reset = () => setPage(1);

  const exportCsv = async () => {
    try { await crm.download(`/api/v1/calls/history/export.csv?${qs()}`, `calls-${rangeDays(range)?.from ?? 'all'}.csv`); }
    catch (e) { toast(friendlyError(e)); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <DateRangeBar value={range} onChange={(r) => { setRange(r); reset(); }} id="ch-date" keys={['yesterday', 'today', '7d', '30d', 'month', 'custom']} />

      <div className="crm-kpis">
        <div className="crm-card crm-kpi"><span className="crm-kpi-label">Calls made · {rangeLabel(range)}</span><span className="crm-kpi-value">{s ? s.calls : '–'}</span></div>
        <div className="crm-card crm-kpi"><span className="crm-kpi-label">Partners contacted</span><span className="crm-kpi-value">{s ? s.people : '–'}</span></div>
        <div className="crm-card crm-kpi"><span className="crm-kpi-label">Connected</span><span className="crm-kpi-value">{s ? s.connected : '–'}<span className="crm-kpi-unit">{s && s.calls ? `${Math.round((s.connected / s.calls) * 100)}%` : ''}</span></span></div>
        <div className="crm-card crm-kpi"><span className="crm-kpi-label">Not reached</span><span className="crm-kpi-value">{s ? s.calls - s.connected : '–'}</span></div>
      </div>

      <div className="crm-row">
        <section className="crm-card grow-1" aria-labelledby="ch-callers" style={{ flexBasis: 280 }}>
          <h2 id="ch-callers" className="crm-h2">By caller</h2>
          <span className="crm-sub" style={{ fontSize: 13 }}>Pick a person to see only their calls.</span>
          {!s ? <Skeleton h={160} /> : s.byCaller.length === 0 ? <Empty title="No calls in this period" /> : (
            <ul className="ch-callers">
              <li><button type="button" aria-pressed={!calledBy} onClick={() => { setCalledBy(''); reset(); }}><span>Everyone</span><strong>{s.calls}</strong></button></li>
              {s.byCaller.map((c) => (
                <li key={c.id}>
                  <button type="button" aria-pressed={calledBy === c.id} onClick={() => { setCalledBy(calledBy === c.id ? '' : c.id); reset(); }}>
                    <span>{c.name}<span className="crm-cell-sub" style={{ display: 'block' }}>{c.people} partners · {c.connected} connected</span></span>
                    <strong>{c.calls}</strong>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="crm-card grow-3" aria-labelledby="ch-h" style={{ padding: 0, overflow: 'hidden', flexBasis: 640 }}>
          <div className="crm-card-head" style={{ padding: '16px 20px 8px', flexWrap: 'wrap', gap: 10 }}>
            <h2 id="ch-h" className="crm-h2" style={{ flex: 1 }}>Who was called</h2>
            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void exportCsv()} disabled={!s?.calls}><Download size={15} aria-hidden /> Export CSV</button>
          </div>
          <div className="crm-chips" style={{ padding: '0 20px 10px', alignItems: 'center' }}>
            <button type="button" className="crm-chip" aria-pressed={!outcome} onClick={() => { setOutcome(''); reset(); }}>All</button>
            {s?.byOutcome.map((o) => (
              <button key={o.key} type="button" className="crm-chip" aria-pressed={outcome === o.key} onClick={() => { setOutcome(o.key); reset(); }}>{o.label} <span style={{ opacity: 0.7 }}>{o.n}</span></button>
            ))}
            <label className="crm-search" style={{ flex: '1 1 200px', minWidth: 180 }}>
              <Search size={16} aria-hidden color="var(--text-2)" />
              <span className="crm-sr">Search</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Partner, phone, panchayat or block" />
            </label>
          </div>
          {data.error ? <ErrorBox message={data.error} onRetry={data.reload} /> : !d ? <div style={{ padding: 20 }}><Skeleton h={300} /></div> : d.items.length === 0 ? (
            <Empty title="Nobody called">No calls match this date range and filter.</Empty>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table className="crm-table">
                  <thead><tr><th scope="col">When</th><th scope="col">Partner</th><th scope="col">Called by</th><th scope="col">Outcome</th><th scope="col">What they said</th></tr></thead>
                  <tbody>
                    {d.items.map((r) => (
                      <tr key={r.id} className="is-clickable" onClick={() => onOpen(r.contactId)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(r.contactId); }}>
                        <td style={{ whiteSpace: 'nowrap' }}>{when(r.at)}{r.attempt > 1 && <span className="crm-cell-sub" style={{ display: 'block' }}>try {r.attempt}</span>}</td>
                        <td>
                          <strong>{r.name}</strong>
                          <span className="crm-cell-sub" style={{ display: 'block' }}>{[r.type ? contactTypeLabel(r.type) : null, r.panchayat, r.block].filter(Boolean).join(' · ')}</span>
                        </td>
                        <td>{r.calledBy}</td>
                        <td><Pill tone={TONE[r.outcome] ?? 'neutral'}>{r.outcomeLabel}</Pill>{r.callBackAt && <span className="crm-cell-sub" style={{ display: 'block' }}>call back {when(r.callBackAt)}</span>}</td>
                        <td style={{ maxWidth: 320 }}>
                          {r.responses.length > 0 && <span style={{ display: 'block', fontSize: 13 }}>{r.responses.join(', ')}</span>}
                          {r.note && <span className="crm-cell-sub" style={{ display: 'block' }}>{r.note}</span>}
                          {!r.responses.length && !r.note && <span className="crm-cell-sub">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: '0 20px 12px' }}>
                <Pager page={page} pages={Math.max(1, Math.ceil(d.total / size))} total={d.total} size={size} onPage={setPage} onSize={(n) => { setSize(n); setPage(1); }} noun="calls" />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
