'use client';

import { useState } from 'react';
import { crm } from '@/lib/sync/api-client';
import { Empty, ErrorBox, rupees, Skeleton, useLoader } from '@/components/crm/ui';

interface ContentRow {
  id: string; code?: string | null; name: string; kind: string; channel: string; topic?: string | null; publishedOn?: string | null; broadcast: boolean;
  leads: number; firstTouch: number; came: number; admitted: number; cost?: number | null; perLead?: number | null; perPatient?: number | null;
}
interface ContentRes {
  days: number; rows: ContentRow[];
  blind: { leads: number; unknown: number; byWay: { way: string; leads: number; unknown: number }[] };
}

const KIND_SHORT: Record<string, string> = { reel: 'Reel', post: 'Post', story: 'Story', video: 'Video', ad: 'Ad', template: 'Template', page: 'Page', poster: 'Poster', place: 'Place', broadcast: 'Broadcast' };
const SORTS = [{ key: 'came', label: 'Patients' }, { key: 'leads', label: 'Leads' }, { key: 'perPatient', label: 'Cost per patient' }] as const;

/**
 * What each piece of content brought: leads (any touch and as the first one), patients who came, admissions and cost.
 * Under it, the blind spot: the share of leads that came with nothing to say where from, by how they reached the hospital.
 */
export function ContentReport({ days }: { days: number }) {
  const data = useLoader(() => crm.get<ContentRes>(`/api/v1/lead-sources/content?days=${days}`), [days]);
  const [sort, setSort] = useState<typeof SORTS[number]['key']>('came');
  const d = data.data;
  const rows = d ? [...d.rows].filter((r) => r.leads > 0).sort((a, b) => sort === 'perPatient'
    ? (a.perPatient ?? Number.MAX_SAFE_INTEGER) - (b.perPatient ?? Number.MAX_SAFE_INTEGER)
    : (b[sort] - a[sort]) || (b.leads - a.leads)) : [];
  const blindPct = d && d.blind.leads > 0 ? Math.round((100 * d.blind.unknown) / d.blind.leads) : 0;

  return (
    <>
      <section className="crm-card is-flush" aria-labelledby="ls-content-h">
        <div className="crm-card-head">
          <div>
            <h2 id="ls-content-h" className="crm-h2">What each piece of content brought</h2>
            <p className="crm-sub" style={{ margin: '4px 0 0' }}>Leads that came through a reel, post, ad, broadcast, page or place, and how many became patients. “First” counts leads it brought in for the first time.</p>
          </div>
          <div className="crm-chips" role="group" aria-label="Sort by">
            {SORTS.map((s) => <button key={s.key} type="button" className="crm-chip" aria-pressed={sort === s.key} onClick={() => setSort(s.key)}>{s.label}</button>)}
          </div>
        </div>
        {data.error && <div style={{ padding: '0 22px 16px' }}><ErrorBox message={data.error} onRetry={data.reload} /></div>}
        {!d ? <div style={{ padding: '0 22px 16px' }}><Skeleton h={160} /></div> : rows.length === 0 ? (
          <Empty title="No content has brought leads in this period yet"><span className="crm-sub">Add reels, posts and ads above before they go out, and use their links and caption line.</span></Empty>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table" style={{ minWidth: 820 }}>
              <thead><tr><th>Content</th><th className="num">Leads</th><th className="num">First</th><th className="num">Came</th><th className="num">Admitted</th><th className="num">Cost per patient</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.broadcast ? 'b' : 'c'}-${r.id}`}>
                    <td>
                      <div className="crm-cell-main">{r.name}</div>
                      <div className="crm-cell-sub"><span className={`ls-kind is-${r.kind}`}>{KIND_SHORT[r.kind] ?? r.kind}</span>{r.code ? <> <code className="ls-code">{r.code}</code></> : null}{r.topic ? ` · ${r.topic}` : ''}{r.publishedOn ? ` · ${new Date(r.publishedOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}</div>
                    </td>
                    <td className="num">{r.leads}</td>
                    <td className="num">{r.firstTouch}</td>
                    <td className="num"><strong>{r.came}</strong></td>
                    <td className="num">{r.admitted}</td>
                    <td className="num">{r.perPatient != null ? rupees(r.perPatient) : r.cost ? '–' : <span className="crm-sub">add cost</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {d && d.blind.leads > 0 && (
        <section className="crm-card is-flush" aria-labelledby="ls-blind-h">
          <div className="crm-card-head">
            <div>
              <h2 id="ls-blind-h" className="crm-h2">Leads with no known source: {blindPct}%</h2>
              <p className="crm-sub" style={{ margin: '4px 0 0' }}>{d.blind.unknown} of {d.blind.leads} leads came with no code, ad, broadcast, page or partner. Shrink it with caption lines, ig.me links and asking callers how they heard.</p>
            </div>
          </div>
          <div className="ls-blind">
            {d.blind.byWay.map((w) => (
              <div key={w.way} className="ls-blind-row">
                <span>{w.way}</span>
                <span className="ls-blind-bar" role="img" aria-label={`${w.unknown} of ${w.leads} unknown`}><span style={{ width: `${w.leads ? Math.round((100 * w.unknown) / w.leads) : 0}%` }} /></span>
                <strong>{w.unknown} of {w.leads} unknown</strong>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
