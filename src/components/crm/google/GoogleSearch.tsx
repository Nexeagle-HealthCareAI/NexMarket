'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { Empty, ErrorBox, friendlyError, Skeleton } from '@/components/crm/ui';
import { addRange, type DateRangeValue } from '@/components/crm/DateRange';
import { n0, n1, type GoogleStatus } from './shared';

interface Res {
  status: GoogleStatus;
  queries: { term: string; clicks: number; impressions: number; ctr: number; position?: number | null }[];
  listing: { months: string[]; keywords: { term: string; views: number; under: boolean }[] };
}

const monthFmt = new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** What people type into Google before they find the hospital: on the website (Search Console) and on the listing (Business Profile). */
export function GoogleSearch({ range }: { range: DateRangeValue }) {
  const [data, setData] = useState<Res | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  useEffect(() => { const t = setTimeout(() => setQd(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const qs = useMemo(() => { const sp = new URLSearchParams(); addRange(sp, range); if (qd) sp.set('q', qd); return sp.toString(); }, [range, qd]);
  const load = useCallback(async () => {
    try { setData(await crm.get<Res>(`/api/v1/google/search${qs ? `?${qs}` : ''}`)); setError(null); } catch (e) { setError(friendlyError(e)); }
  }, [qs]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  if (error && !data) return <ErrorBox message={error} onRetry={load} />;
  if (!data) return <Skeleton h={480} />;
  const months = data.listing.months.map((m) => monthFmt.format(new Date(`${m}-01T00:00:00Z`)));

  return (
    <div className="gg-overview">
      <label className="crm-search gg-search">
        <Search size={16} aria-hidden />
        <span className="crm-sr">Find a search term</span>
        <input className="crm-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a word, e.g. cardiologist, kishanganj, delivery" />
      </label>

      <div className="gg-two">
        <section className="crm-card so-card">
          <h2 className="crm-h2" style={{ margin: 0 }}>Searches that showed the Google listing</h2>
          <p className="crm-sub" style={{ margin: 0 }}>What people typed into Google Search or Maps when the hospital&apos;s listing appeared{months.length ? ` (${months.length === 1 ? months[0] : `${months[0]} – ${months[months.length - 1]}`}; Google gives these by month)` : ''}.</p>
          {!data.status.sources.gbp ? <p className="crm-sub">Pick the Business Profile in Setup to see these.</p> : data.listing.keywords.length === 0 ? <Empty title={qd ? 'No term matches' : 'Nothing yet'} /> : (
            <div className="crm-table-wrap">
              <table className="crm-table">
                <thead><tr><th scope="col">Search term</th><th scope="col" className="wb-num">Times shown</th></tr></thead>
                <tbody>
                  {data.listing.keywords.map((k) => (
                    <tr key={k.term}><td>{k.term}</td><td className="wb-num">{k.under ? <span className="crm-sub">under {n0.format(k.views)}</span> : n0.format(k.views)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="crm-card so-card">
          <h2 className="crm-h2" style={{ margin: 0 }}>Searches that brought people to the website</h2>
          <p className="crm-sub" style={{ margin: 0 }}>From Search Console. Position 1 is the top of Google&apos;s first page; 11 and beyond is page two.</p>
          {!data.status.sources.gsc ? <p className="crm-sub">Pick the website in Setup to see these.</p> : data.queries.length === 0 ? <Empty title={qd ? 'No term matches' : 'Nothing yet'} /> : (
            <div className="crm-table-wrap">
              <table className="crm-table">
                <thead><tr><th scope="col">Search term</th><th scope="col" className="wb-num">Clicks</th><th scope="col" className="wb-num">Shown</th><th scope="col" className="wb-num">Click rate</th><th scope="col" className="wb-num">Position</th></tr></thead>
                <tbody>
                  {data.queries.map((x) => (
                    <tr key={x.term}>
                      <td>{x.term}</td><td className="wb-num">{n0.format(x.clicks)}</td><td className="wb-num">{n0.format(x.impressions)}</td>
                      <td className="wb-num">{n1.format(x.ctr)}%</td>
                      <td className="wb-num"><span className={x.position != null && x.position > 10 ? 'gg-low' : undefined}>{x.position != null ? n1.format(x.position) : '—'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="crm-sub" style={{ margin: 0 }}>Terms shown a lot but rarely clicked, or sitting on page two, are the ones a new website page or a doctor&apos;s profile could win.</p>
        </section>
      </div>
    </div>
  );
}
