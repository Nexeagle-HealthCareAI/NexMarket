'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { crm } from '@/lib/sync/api-client';
import { Empty, ErrorBox, friendlyError, Skeleton } from '@/components/crm/ui';
import { addRange, type DateRangeValue } from '@/components/crm/DateRange';
import { money, n0, type GoogleStatus } from './shared';

interface Res {
  status: GoogleStatus;
  channels: { channel: string; visits: number; visitors: number; keyEvents: number }[];
  campaigns: { campaign: string; label: string; visits: number; keyEvents: number; leads: number; arrived: number }[];
  ads: { id: string; name: string; cost: number; impressions: number; clicks: number; calls: number; conversions: number; leads: number; arrived: number; costPerLead?: number | null; costPerArrival?: number | null }[];
}

/** Website visits by where they came from and by campaign tag, and Google Ads campaigns, each set against the leads and patients they brought. */
export function GoogleWebsite({ range }: { range: DateRangeValue }) {
  const [data, setData] = useState<Res | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qs = useMemo(() => { const sp = new URLSearchParams(); addRange(sp, range); return sp.toString(); }, [range]);
  const load = useCallback(async () => {
    try { setData(await crm.get<Res>(`/api/v1/google/website${qs ? `?${qs}` : ''}`)); setError(null); } catch (e) { setError(friendlyError(e)); }
  }, [qs]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  if (error && !data) return <ErrorBox message={error} onRetry={load} />;
  if (!data) return <Skeleton h={480} />;
  const cur = money(data.status.currency);
  const totalVisits = data.channels.reduce((a, b) => a + b.visits, 0);

  return (
    <div className="gg-overview">
      {data.status.sources.ads && (
        <section className="crm-card so-card">
          <h2 className="crm-h2" style={{ margin: 0 }}>Google Ads campaigns</h2>
          {data.ads.length === 0 ? <Empty title="No ad spend in these dates" /> : (
            <div className="crm-table-wrap">
              <table className="crm-table">
                <thead><tr>
                  <th scope="col">Campaign</th><th scope="col" className="wb-num">Spent</th><th scope="col" className="wb-num">Clicks</th><th scope="col" className="wb-num">Calls</th>
                  <th scope="col" className="wb-num">Conversions</th><th scope="col" className="wb-num">Leads in CRM</th><th scope="col" className="wb-num">Came in</th>
                  <th scope="col" className="wb-num">Per lead</th><th scope="col" className="wb-num">Per patient</th>
                </tr></thead>
                <tbody>
                  {data.ads.map((a) => (
                    <tr key={a.id}>
                      <td>{a.name}</td><td className="wb-num">{cur.format(a.cost)}</td><td className="wb-num">{n0.format(a.clicks)}</td><td className="wb-num">{n0.format(a.calls)}</td>
                      <td className="wb-num">{n0.format(a.conversions)}</td><td className="wb-num">{n0.format(a.leads)}</td><td className="wb-num">{n0.format(a.arrived)}</td>
                      <td className="wb-num">{a.costPerLead != null ? cur.format(a.costPerLead) : '—'}</td><td className="wb-num">{a.costPerArrival != null ? cur.format(a.costPerArrival) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="crm-sub" style={{ margin: 0 }}>Spend, clicks, calls and conversions come from Google Ads. &ldquo;Leads in CRM&rdquo; counts leads marked <strong>Google ad</strong> whose &ldquo;Which ad?&rdquo; is the campaign&apos;s name.</p>
        </section>
      )}

      {!data.status.sources.ga4 ? (
        <section className="crm-card"><Empty title="No Google Analytics property picked"><span className="crm-sub">Pick the website&apos;s Google Analytics 4 property in Setup to see visits here.</span></Empty></section>
      ) : (
        <div className="gg-two">
          <section className="crm-card so-card">
            <h2 className="crm-h2" style={{ margin: 0 }}>Where website visitors came from</h2>
            {data.channels.length === 0 ? <Empty title="No visits in these dates" /> : (
              <ul className="sp-topics gg-bars">
                {data.channels.map((c) => (
                  <li key={c.channel}>
                    <button type="button" tabIndex={-1}>
                      <span className="sp-topic-l">{c.channel}</span>
                      <span className="sp-topic-bar"><span style={{ width: `${totalVisits ? (c.visits / totalVisits) * 100 : 0}%`, background: '#e37400' }} /></span>
                      <span className="crm-sub" style={{ textAlign: 'right' }}>{n0.format(c.visits)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="crm-sub" style={{ margin: 0 }}>Visits, by Google Analytics&apos; own grouping: Organic Search is Google search, Organic Social is Facebook and Instagram, Direct is typed in or unknown.</p>
          </section>

          <section className="crm-card so-card">
            <h2 className="crm-h2" style={{ margin: 0 }}>Campaign links</h2>
            {data.campaigns.length === 0 ? (
              <p className="crm-sub" style={{ margin: 0 }}>
                No tagged links yet. Add tags to every link you share, for example <code>?utm_source=facebook&amp;utm_campaign=cardiology_nov</code>, and each campaign appears here with its visits, leads and patients.
              </p>
            ) : (
              <div className="crm-table-wrap">
                <table className="crm-table">
                  <thead><tr><th scope="col">Campaign (source)</th><th scope="col" className="wb-num">Visits</th><th scope="col" className="wb-num">Key events</th><th scope="col" className="wb-num">Leads</th><th scope="col" className="wb-num">Came in</th></tr></thead>
                  <tbody>
                    {data.campaigns.map((c) => (
                      <tr key={c.label}><td>{c.label}</td><td className="wb-num">{n0.format(c.visits)}</td><td className="wb-num">{n0.format(c.keyEvents)}</td><td className="wb-num">{n0.format(c.leads)}</td><td className="wb-num">{n0.format(c.arrived)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
