'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, DownloadCloud, Search } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { useLiveEvents } from '@/lib/crm/live';
import { Pager } from '@/components/crm/Pager';
import { Empty, ErrorBox, friendlyError, Pill, Skeleton } from '@/components/crm/ui';
import { LEAD_LABEL, showPhone, when } from './shared';

interface Row {
  id: string; platform: 'fb' | 'ig'; name?: string | null; phone?: string | null; at: string; form?: string | null; campaign?: string | null; ad?: string | null;
  organic: boolean; error?: string | null; answers: { q: string; a: string }[]; leadId?: string | null; leadStatus?: string | null; owner?: string | null;
}
interface Res { items: Row[]; total: number; week: { fb: number; ig: number } }

const SIZE = 25;

/** Everyone who filled a Lead Ads form on Facebook or Instagram, the ad it came from, and where their lead is now. */
export function SocialForms({ canManage, connected, toast }: { canManage: boolean; connected: boolean; toast: (m: string) => void }) {
  const [platform, setPlatform] = useState('');
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Res | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => { const t = setTimeout(() => setQd(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const qs = useMemo(() => new URLSearchParams({ page: String(page), pageSize: String(SIZE), ...(platform ? { platform } : {}), ...(qd ? { q: qd } : {}) }).toString(), [page, platform, qd]);
  const load = useCallback(async () => {
    try { setData(await crm.get<Res>(`/api/v1/social/forms?${qs}`)); setError(null); } catch (e) { setError(friendlyError(e)); }
  }, [qs]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  const onEvent = useCallback((e: { kind: string }) => { if (e.kind === 'lead') void load(); }, [load]);
  useLiveEvents(onEvent);

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await crm.post<{ added: number; warning?: string | null }>('/api/v1/social/forms/sync?days=30');
      toast(r.added ? `${r.added} form ${r.added === 1 ? 'entry' : 'entries'} added.` : 'Nothing new: every form entry from the last 30 days is already here.');
      if (r.warning) toast(r.warning);
      await load();
    } catch (e) { toast(friendlyError(e)); } finally { setSyncing(false); }
  };

  if (error && !data) return <ErrorBox message={error} onRetry={load} />;
  return (
    <section className="crm-card so-card">
      <div className="so-bar">
        <label className="ch-search" style={{ margin: 0, flex: '1 1 240px' }}>
          <Search size={16} aria-hidden />
          <span className="crm-sr">Search form entries</span>
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Name, number, campaign or form" />
        </label>
        <div className="crm-chips">
          {[{ k: '', l: 'Both' }, { k: 'fb', l: `Facebook${data ? ` · ${data.week.fb} this week` : ''}` }, { k: 'ig', l: `Instagram${data ? ` · ${data.week.ig} this week` : ''}` }].map((x) => (
            <button key={x.k} type="button" className="crm-chip" aria-pressed={platform === x.k} onClick={() => { setPlatform(x.k); setPage(1); }}>{x.l}</button>
          ))}
        </div>
        {canManage && connected && (
          <button type="button" className="crm-btn is-secondary is-sm" disabled={syncing} onClick={() => void sync()} title="Fetch form entries from the last 30 days that aren't here yet">
            <DownloadCloud size={15} aria-hidden /> {syncing ? 'Fetching…' : 'Fetch missed entries'}
          </button>
        )}
      </div>
      {!data ? <Skeleton h={360} /> : data.items.length === 0 ? (
        <Empty title={qd ? 'No entry matches' : 'No form entries yet'}>
          <span className="crm-sub">When someone fills a Lead Ads form on Facebook or Instagram, they appear here and in the Leads inbox within seconds.</span>
        </Empty>
      ) : (
        <div className="crm-table-wrap">
          <table className="crm-table so-table">
            <thead><tr><th scope="col" aria-label="Details" /><th scope="col">Person</th><th scope="col">From</th><th scope="col">Campaign / form</th><th scope="col">Lead</th><th scope="col">When</th></tr></thead>
            <tbody>
              {data.items.map((r) => {
                const isOpen = open === r.id;
                const extra = r.answers.filter((a) => !/^(full name|name|first name|last name|phone number|phone|mobile|mobile number|whatsapp number)$/i.test(a.q));
                return (
                  <Fragment key={r.id}>
                    <tr>
                      <td style={{ width: 40 }}>
                        <button type="button" className="so-exp" aria-expanded={isOpen} aria-label={isOpen ? 'Hide answers' : 'Show answers'} onClick={() => setOpen(isOpen ? null : r.id)}>
                          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                      </td>
                      <td>
                        <strong>{r.name ?? 'No name given'}</strong>
                        <span className="crm-cell-sub" style={{ display: 'block' }}>{r.phone ? showPhone(r.phone) : r.error ? <span className="wl-err">Couldn&apos;t read: {r.error}</span> : 'No phone number'}</span>
                      </td>
                      <td><span className={`so-chan is-${r.platform === 'ig' ? 'instagram' : 'messenger'}`}>{r.platform === 'ig' ? 'Instagram' : 'Facebook'}</span>{r.organic && <span className="crm-cell-sub" style={{ display: 'block' }}>Page form (not an ad)</span>}</td>
                      <td>
                        {r.campaign ?? '—'}
                        <span className="crm-cell-sub" style={{ display: 'block' }}>{[r.form, r.ad].filter(Boolean).join(' · ')}</span>
                      </td>
                      <td>
                        {r.leadId ? <Link className="wa-link" style={{ lineHeight: 1.4 }} href={`/admin/leads?id=${r.leadId}`}><Pill tone={r.leadStatus === 'arrived' || r.leadStatus === 'admitted' ? 'ok' : r.leadStatus === 'lost' ? 'neutral' : 'accent'}>{LEAD_LABEL[r.leadStatus ?? ''] ?? r.leadStatus}</Pill></Link> : <span className="crm-sub">Not a lead (no number)</span>}
                        {r.owner && <span className="crm-cell-sub" style={{ display: 'block' }}>{r.owner}</span>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{when(r.at)}</td>
                    </tr>
                    {isOpen && (
                      <tr className="so-answers">
                        <td />
                        <td colSpan={5}>
                          {extra.length === 0 ? <span className="crm-sub">No other answers on this form.</span> : (
                            <dl>{extra.map((a, i) => <div key={i}><dt>{a.q}</dt><dd>{a.a || '—'}</dd></div>)}</dl>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={page} pages={Math.max(1, Math.ceil(data.total / SIZE))} total={data.total} size={SIZE} onPage={setPage} noun="entries" />}
    </section>
  );
}
