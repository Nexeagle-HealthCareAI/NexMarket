'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { Empty, ErrorBox, friendlyError, Skeleton } from '@/components/crm/ui';
import { moneyFmt } from './shared';

interface Row {
  id: string; name: string; spend: number; impressions: number; reach: number; clicks: number; metaLeads: number; chats: number;
  crmLeads: number; arrived: number; costPerLead?: number | null; costPerArrival?: number | null;
}
interface Res {
  from: string; to: string; currency?: string | null; error?: string | null; rows: Row[];
  totals: { spend: number; impressions: number; clicks: number; metaLeads: number; chats: number; crmLeads: number; arrived: number };
  costPerLead?: number | null; costPerArrival?: number | null;
}

const ymd = (d: Date) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
function range(key: string): { from: string; to: string } {
  const now = new Date();
  const today = ymd(now);
  const ago = (n: number) => ymd(new Date(now.getTime() - n * 864e5));
  const ist = new Date(now.getTime() + 5.5 * 3600e3);
  const y = ist.getUTCFullYear(), m = ist.getUTCMonth();
  const iso = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm, dd)).toISOString().slice(0, 10);
  switch (key) {
    case '7': return { from: ago(6), to: today };
    case 'month': return { from: iso(y, m, 1), to: today };
    case 'last': return { from: iso(y, m - 1, 1), to: iso(y, m, 0) };
    case '90': return { from: ago(89), to: today };
    default: return { from: ago(29), to: today };
  }
}
const PRESETS = [{ k: '7', l: 'Last 7 days' }, { k: '30', l: 'Last 30 days' }, { k: 'month', l: 'This month' }, { k: 'last', l: 'Last month' }, { k: '90', l: 'Last 90 days' }];
const n0 = new Intl.NumberFormat('en-IN');

/** Ad spend per campaign from the ad account, against the leads it brought into the CRM and the patients who came. */
export function SocialAds({ hasAds, isAdmin, onSetup }: { hasAds: boolean; isAdmin: boolean; onSetup: () => void }) {
  const [preset, setPreset] = useState('30');
  const [data, setData] = useState<Res | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const r = useMemo(() => range(preset), [preset]);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await crm.get<Res>(`/api/v1/social/ads?from=${r.from}&to=${r.to}`)); setError(null); } catch (e) { setError(friendlyError(e)); } finally { setLoading(false); }
  }, [r]);
  useEffect(() => { if (!hasAds) return; const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load, hasAds]);

  if (!hasAds) {
    return (
      <section className="crm-card">
        <Empty title="No ad account connected">
          <span className="crm-sub">Connect the hospital&apos;s Meta ad account to see what each campaign spent, how many leads it brought and how many of them came to the hospital.</span>
          {isAdmin && <button type="button" className="crm-btn is-sm" onClick={onSetup}>Open Setup</button>}
        </Empty>
      </section>
    );
  }
  if (error && !data) return <ErrorBox message={error} onRetry={load} />;
  const money = moneyFmt(data?.currency);
  const money0 = moneyFmt(data?.currency, 0);
  const t = data?.totals;

  return (
    <div className="so-ads">
      <div className="so-bar">
        <div className="crm-chips">
          {PRESETS.map((p) => <button key={p.k} type="button" className="crm-chip" aria-pressed={preset === p.k} onClick={() => setPreset(p.k)}>{p.l}</button>)}
        </div>
        <button type="button" className="crm-btn is-secondary is-sm" disabled={loading} onClick={() => void load()}><RefreshCw size={14} aria-hidden /> Refresh</button>
        <a className="wa-link so-ext" href="https://adsmanager.facebook.com/" target="_blank" rel="noopener noreferrer">Open Ads Manager <ExternalLink size={13} aria-hidden /></a>
      </div>
      {data?.error && <div className="ld-banner"><span><strong>Couldn&apos;t read the ad account.</strong> {data.error}</span></div>}
      {!data || !t ? <Skeleton h={420} /> : (
        <>
          <div className="crm-kpis">
            <div className="crm-card crm-kpi"><span className="crm-kpi-label">Spent</span><span className="crm-kpi-value">{money0.format(t.spend)}</span><span className="crm-sub">{n0.format(t.impressions)} views · {n0.format(t.clicks)} clicks</span></div>
            <div className="crm-card crm-kpi"><span className="crm-kpi-label">Leads</span><span className="crm-kpi-value">{n0.format(Math.max(t.metaLeads, t.crmLeads))}</span><span className="crm-sub">{n0.format(t.crmLeads)} reached the CRM{t.chats ? ` · ${n0.format(t.chats)} chats started` : ''}</span></div>
            <div className="crm-card crm-kpi"><span className="crm-kpi-label">Cost per lead</span><span className="crm-kpi-value">{data.costPerLead != null ? money.format(data.costPerLead) : '—'}</span><span className="crm-sub">Spend ÷ leads</span></div>
            <div className="crm-card crm-kpi"><span className="crm-kpi-label">Came to the hospital</span><span className="crm-kpi-value">{n0.format(t.arrived)}</span><span className="crm-sub">{data.costPerArrival != null ? `${money.format(data.costPerArrival)} per patient` : 'From form leads marked arrived or admitted'}</span></div>
          </div>

          <section className="crm-card so-card">
            <h2 className="crm-h2">By campaign</h2>
            {data.rows.length === 0 ? <Empty title="No spend in these dates"><span className="crm-sub">Campaigns that ran in these dates appear here.</span></Empty> : (
              <div className="crm-table-wrap">
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th scope="col">Campaign</th><th scope="col" className="wb-num">Spent</th><th scope="col" className="wb-num">Clicks</th>
                      <th scope="col" className="wb-num">Leads</th><th scope="col" className="wb-num">In CRM</th><th scope="col" className="wb-num">Came in</th>
                      <th scope="col" className="wb-num">Per lead</th><th scope="col" className="wb-num">Per patient</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((x) => (
                      <tr key={x.id}>
                        <td>{x.name}{x.chats > 0 && <span className="crm-cell-sub" style={{ display: 'block' }}>{n0.format(x.chats)} chats started</span>}</td>
                        <td className="wb-num">{money0.format(x.spend)}</td>
                        <td className="wb-num">{n0.format(x.clicks)}</td>
                        <td className="wb-num">{n0.format(x.metaLeads)}</td>
                        <td className="wb-num">{n0.format(x.crmLeads)}</td>
                        <td className="wb-num">{n0.format(x.arrived)}</td>
                        <td className="wb-num">{x.costPerLead != null ? money.format(x.costPerLead) : '—'}</td>
                        <td className="wb-num">{x.costPerArrival != null ? money.format(x.costPerArrival) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="crm-sub" style={{ margin: 0 }}>
              Spend, clicks and leads come from Meta. &ldquo;In CRM&rdquo; and &ldquo;Came in&rdquo; count Lead Ads form entries from each campaign and where their leads are now.
              Click-to-WhatsApp ads show as chats started; those leads are in the Leads inbox as &ldquo;Ad&rdquo;.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
