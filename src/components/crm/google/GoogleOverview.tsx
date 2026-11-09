'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Download, MessageSquareWarning, RefreshCw, Star } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { crm } from '@/lib/sync/api-client';
import { Empty, ErrorBox, friendlyError, Skeleton } from '@/components/crm/ui';
import { addRange, type DateRangeValue } from '@/components/crm/DateRange';
import { change, dayLabel, money, n0, n1, SOURCE_COLOR, type GoogleStatus } from './shared';

interface Metric { key: string; label: string; format: 'n' | 'money' | 'pos'; value: number | null; prev: number | null }
interface Card { source: string; label: string; metrics: Metric[]; note?: string | null }
interface Day { date: string; calls?: number | null; directions?: number | null; listingWebsite?: number | null; searchClicks?: number | null; visits?: number | null; ytViews?: number | null; adCost?: number | null }
interface Res {
  range: { from: string; to: string; prevFrom: string; prevTo: string };
  status: GoogleStatus;
  cards: Card[];
  days: Day[];
  crm: { source: string; label: string; leads: number; arrived: number }[];
  reviews: { rating?: number | null; total: number; newInRange: number; newAverage?: number | null; unanswered: number; lowUnanswered: number };
}

const SERIES: { key: keyof Day; label: string; source: string; money?: boolean }[] = [
  { key: 'calls', label: 'Calls from listing', source: 'gbp' },
  { key: 'directions', label: 'Direction requests', source: 'gbp' },
  { key: 'listingWebsite', label: 'Website clicks from listing', source: 'gbp' },
  { key: 'searchClicks', label: 'Search clicks to website', source: 'gsc' },
  { key: 'visits', label: 'Website visits', source: 'ga4' },
  { key: 'ytViews', label: 'YouTube views', source: 'youtube' },
  { key: 'adCost', label: 'Google Ads spend', source: 'google_ads', money: true },
];

/** Everything from Google on one screen: listing calls and directions, search, website, YouTube, ads, reviews, and the leads Google brought. */
export function GoogleOverview({ range, onTab, onSynced, toast }: {
  range: DateRangeValue; onTab: (t: string) => void; onSynced: () => void; toast: (m: string) => void;
}) {
  const [data, setData] = useState<Res | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [series, setSeries] = useState<keyof Day>('calls');

  const qs = useMemo(() => { const sp = new URLSearchParams(); addRange(sp, range); return sp.toString(); }, [range]);
  const load = useCallback(async () => {
    try { setData(await crm.get<Res>(`/api/v1/google/overview${qs ? `?${qs}` : ''}`)); setError(null); } catch (e) { setError(friendlyError(e)); }
  }, [qs]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await crm.post<{ sources: { label: string; ok: boolean; error?: string | null }[] }>('/api/v1/google/sync');
      const bad = r.sources.filter((s) => !s.ok);
      toast(bad.length ? `Fetched, but ${bad.map((b) => b.label).join(', ')} had a problem. See Setup.` : 'Fetched the latest numbers from Google.');
      await load(); onSynced();
    } catch (e) { toast(friendlyError(e)); } finally { setSyncing(false); }
  };

  const available = useMemo(() => SERIES.filter((s) => data?.days.some((d) => d[s.key] != null)), [data]);
  const active = available.find((s) => s.key === series) ?? available[0];

  if (error && !data) return <ErrorBox message={error} onRetry={load} />;
  if (!data) return <Skeleton h={520} />;
  const cur = money(data.status.currency);
  const fmt = (m: Metric) => m.value == null ? '—' : m.format === 'money' ? cur.format(m.value) : m.format === 'pos' ? n1.format(m.value) : n0.format(m.value);
  const googleLeads = data.crm.reduce((a, b) => a + b.leads, 0);
  const googleArrived = data.crm.reduce((a, b) => a + b.arrived, 0);

  if (!data.status.connected || data.cards.length === 0) {
    return (
      <section className="crm-card">
        <Empty title={data.status.connected ? 'No numbers from Google yet' : 'Google isn’t connected yet'}>
          <span className="crm-sub">
            {data.status.connected
              ? 'Pick the hospital’s Google accounts in Setup, then fetch. The first fetch brings up to 16 months of history.'
              : 'Connect the hospital’s own Google account once. NexMarket then reads the Google listing, website, YouTube and Google Ads numbers directly from Google every morning, with no outside service and no monthly fee.'}
          </span>
          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            {data.status.isAdmin && <button type="button" className="crm-btn is-sm" onClick={() => onTab('setup')}>Open Setup</button>}
            {data.status.connected && <button type="button" className="crm-btn is-secondary is-sm" disabled={syncing} onClick={() => void sync()}><RefreshCw size={14} aria-hidden className={syncing ? 'sp-spin' : undefined} /> Fetch now</button>}
          </span>
        </Empty>
      </section>
    );
  }

  return (
    <div className="gg-overview">
      <div className="sp-bar">
        <span className="crm-sub">Fetched from Google {data.status.syncedAt ? new Date(data.status.syncedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : 'never'} · every morning by itself · compared with {dayLabel(data.range.prevFrom)} – {dayLabel(data.range.prevTo)}</span>
        <div className="sp-actions">
          <button type="button" className="crm-btn is-secondary is-sm" disabled={syncing} onClick={() => void sync()}><RefreshCw size={14} aria-hidden className={syncing ? 'sp-spin' : undefined} /> {syncing ? 'Fetching…' : 'Fetch now'}</button>
          <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void crm.download(`/api/v1/google/export.csv${qs ? `?${qs}` : ''}`, 'google.csv').catch((e) => toast(friendlyError(e)))}><Download size={14} aria-hidden /> Export</button>
        </div>
      </div>
      {data.status.lastSync?.some((s) => !s.ok) && (
        <div className="ld-banner"><span><strong>Some Google accounts couldn&apos;t be read on the last fetch:</strong> {data.status.lastSync.filter((s) => !s.ok).map((s) => s.label).join(', ')}.{' '}
          {data.status.isAdmin ? <button type="button" className="wa-link" style={{ lineHeight: 'inherit' }} onClick={() => onTab('setup')}>See why in Setup →</button> : 'An admin can see why in Setup.'}</span></div>
      )}

      <div className="gg-cards">
        {data.cards.map((c) => (
          <section key={c.source} className="crm-card gg-card" style={{ ['--gg' as string]: SOURCE_COLOR[c.source] }}>
            <h2 className="gg-card-h"><span className="gg-dot" aria-hidden />{c.label}</h2>
            <div className="gg-metrics">
              {c.metrics.map((m) => {
                const ch = m.format === 'pos'
                  ? (m.value != null && m.prev != null && Math.abs(m.prev - m.value) >= 0.1
                    ? { text: `${m.prev > m.value ? '↑' : '↓'} ${n1.format(Math.abs(m.prev - m.value))} places`, good: m.prev > m.value } : null)
                  : change(m.value, m.prev);
                return (
                  <div key={m.key} className="gg-metric">
                    <span className="gg-metric-v">{fmt(m)}</span>
                    <span className="gg-metric-l">{m.label}</span>
                    {ch && <span className={`gg-ch${ch.good === true ? ' is-up' : ch.good === false ? ' is-down' : ''}`}>{ch.text}</span>}
                  </div>
                );
              })}
            </div>
            {c.note && <p className="crm-sub gg-note">{c.note}</p>}
          </section>
        ))}
      </div>

      {active && (
        <section className="crm-card so-card">
          <div className="sp-bar">
            <h2 className="crm-h2" style={{ margin: 0 }}>Day by day</h2>
            <div className="crm-chips" role="group" aria-label="What to show">
              {available.map((s) => <button key={s.key} type="button" className="crm-chip" aria-pressed={active.key === s.key} onClick={() => setSeries(s.key)}>{s.label}</button>)}
            </div>
          </div>
          <div className="gg-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.days} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={dayLabel} tick={{ fontSize: 11, fill: 'var(--text-2)' }} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-2)' }} axisLine={false} tickLine={false} width={44} allowDecimals={!!active.money}
                  tickFormatter={(v: number) => active.money ? cur.format(v) : n0.format(v)} />
                <Tooltip labelFormatter={(l) => dayLabel(String(l))} formatter={(v) => [active.money ? cur.format(Number(v)) : n0.format(Number(v)), active.label]} />
                <Line type="monotone" dataKey={active.key} stroke={SOURCE_COLOR[active.source]} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="crm-sub" style={{ margin: 0 }}>Google sends Business Profile, Search Console and YouTube numbers 2–5 days late, so the last few days always look low.</p>
        </section>
      )}

      <div className="gg-two">
        <section className="crm-card so-card">
          <h2 className="crm-h2" style={{ margin: 0 }}>Patients Google brought</h2>
          <div className="gg-big"><strong>{n0.format(googleLeads)}</strong> leads <ArrowRight size={16} aria-hidden /> <strong>{n0.format(googleArrived)}</strong> came to the hospital</div>
          <ul className="gg-list">
            {data.crm.map((c) => (
              <li key={c.source}><span>{c.label}</span><span className="crm-sub">{n0.format(c.leads)} leads · {n0.format(c.arrived)} came</span></li>
            ))}
          </ul>
          <p className="crm-sub" style={{ margin: 0 }}>
            Counted from the Leads inbox. When someone calls or walks in, ask &ldquo;How did you hear about us?&rdquo; and pick <strong>Google search / Maps</strong> or <strong>Google ad</strong>.
            Website forms that pass the <code>utm_campaign</code> tag as the lead&apos;s &ldquo;Which page or campaign&rdquo; are matched to campaigns in Website &amp; ads.
          </p>
        </section>

        <section className="crm-card so-card">
          <h2 className="crm-h2" style={{ margin: 0 }}>Google reviews</h2>
          {data.reviews.total === 0 && data.reviews.rating == null ? <p className="crm-sub" style={{ margin: 0 }}>Reviews appear here once the Business Profile is picked in Setup.</p> : (
            <>
              <div className="gg-big">
                <Star size={20} aria-hidden fill="#f2a600" color="#f2a600" /> <strong>{data.reviews.rating != null ? n1.format(data.reviews.rating) : '—'}</strong>
                <span className="crm-sub">from {n0.format(data.reviews.total)} reviews · {n0.format(data.reviews.newInRange)} new in these dates{data.reviews.newAverage != null ? ` (average ${n1.format(data.reviews.newAverage)})` : ''}</span>
              </div>
              {data.reviews.unanswered > 0 ? (
                <button type="button" className="gg-alert" onClick={() => onTab('reviews')}>
                  <MessageSquareWarning size={18} aria-hidden />
                  <span><strong>{n0.format(data.reviews.unanswered)} reviews have no reply</strong>{data.reviews.lowUnanswered > 0 ? `, ${n0.format(data.reviews.lowUnanswered)} of them 3 stars or less` : ''}. Reply from here →</span>
                </button>
              ) : <p className="crm-sub" style={{ margin: 0 }}>Every review has a reply.</p>}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
