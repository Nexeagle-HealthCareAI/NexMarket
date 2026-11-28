'use client';

import { crm } from '@/lib/sync/api-client';
import { Empty, ErrorBox, Skeleton, useLoader } from '@/components/crm/ui';
import { num } from './shared';

interface AreasRes {
  departments: string[]; fromPlanner: boolean;
  rows: { district: string; searches: number; enquiries: number; came: number; per100?: number | null; cells: number[]; topTopics: { id: string; name: string; searches: number }[] }[];
}

/** Shades from light to dark blue; text colour flips on the dark ones so it stays readable. */
function shade(v: number, max: number): { background: string; color: string } {
  const t = max > 0 ? v / max : 0;
  if (v === 0) return { background: 'var(--grey-soft, #f3f5f8)', color: 'var(--text-2)' };
  if (t > 0.66) return { background: '#0a4e94', color: '#fff' };
  if (t > 0.4) return { background: '#0a72d6', color: '#fff' };
  if (t > 0.2) return { background: '#8cc0f0', color: '#0e1525' };
  if (t > 0.08) return { background: '#c3dcf6', color: '#0e1525' };
  return { background: '#e4effb', color: '#0e1525' };
}

/** Demand by district and department, against the enquiries each district sends: where people search but don't come. */
export function Areas({ onOpen, onPlanCamp }: { onOpen: (id: string) => void; onPlanCamp: (district: string) => void }) {
  const data = useLoader(() => crm.get<AreasRes>('/api/v1/keywords/areas'));
  const d = data.data;
  if (data.error) return <ErrorBox message={data.error} onRetry={data.reload} />;
  if (!d) return <Skeleton h={420} />;
  if (d.rows.length === 0) return <Empty title="No district figures yet">Press Refresh volumes once Google Ads is connected: Keyword Planner gives searches per district. Until then, only keywords that name a district are counted.</Empty>;
  const max = Math.max(1, ...d.rows.flatMap((r) => r.cells));
  const rated = d.rows.filter((r) => r.searches >= 50 && r.per100 != null);
  const bestRate = Math.max(0.1, ...rated.map((r) => r.per100 ?? 0));
  const weakest = [...rated].sort((a, b) => (a.per100 ?? 0) - (b.per100 ?? 0))[0];

  return (
    <div className="kw-stack">
      <section className="crm-card kw-card" aria-labelledby="kw-heat">
        <div className="kw-card-head">
          <div>
            <h2 id="kw-heat" className="crm-h2">Demand by district</h2>
            <p className="crm-sub">Searches a month for each department. Darker means more.{d.fromPlanner ? '' : ' Only keywords that name a district are counted until Keyword Planner runs.'}</p>
          </div>
        </div>
        <div className="crm-table-wrap">
          <table className="kw-heat">
            <thead><tr><th scope="col">District</th>{d.departments.map((x) => <th key={x} scope="col">{x}</th>)}</tr></thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.district}>
                  <th scope="row">{r.district}</th>
                  {r.cells.map((v, i) => <td key={d.departments[i]} style={shade(v, max)}>{v ? num(v) : '—'}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="kw-two">
        <section className="crm-card kw-card kw-pad" aria-labelledby="kw-gap">
          <h3 id="kw-gap" className="crm-h2">Searching, but not coming to you</h3>
          <p className="crm-sub" style={{ margin: 0 }}>Enquiries in the last 90 days for every 100 searches a month. A district is known from the partner who sent the lead, the camp they came from, or the place in their message.</p>
          <ul className="kw-gap-list">
            {d.rows.map((r) => (
              <li key={r.district}>
                <div className="kw-gap-top"><strong>{r.district}</strong><span>{num(r.searches)} searches · {r.enquiries} enquiries · {r.came} came{r.per100 != null ? ` · ${r.per100} per 100` : ''}</span></div>
                <span className="kw-bar is-wide" aria-hidden><span style={{ width: `${r.per100 != null ? Math.min(100, Math.round(((r.per100 ?? 0) / bestRate) * 100)) : 0}%` }} /></span>
              </li>
            ))}
          </ul>
        </section>
        {weakest && (
          <section className="crm-card kw-card kw-pad" aria-labelledby="kw-weak">
            <h3 id="kw-weak" className="crm-h2">Suggested for {weakest.district}</h3>
            <p className="crm-sub" style={{ margin: 0 }}>Fewest enquiries for its searches. What people there search for most:</p>
            <ul className="kw-action-list">
              {weakest.topTopics.map((t) => (
                <li key={t.id}>
                  <span><button type="button" className="kw-topic-link" onClick={() => onOpen(t.id)}>{t.name}</button><span className="kw-meta">{num(t.searches)} searches a month</span></span>
                </li>
              ))}
            </ul>
            <p className="crm-sub" style={{ margin: 0 }}>A camp, partner visits with a tracked link, or an ad group limited to {weakest.district} can bring these people in.</p>
            <button type="button" className="crm-btn" onClick={() => onPlanCamp(weakest.district)}>Plan a camp in {weakest.district}</button>
          </section>
        )}
      </div>
    </div>
  );
}
