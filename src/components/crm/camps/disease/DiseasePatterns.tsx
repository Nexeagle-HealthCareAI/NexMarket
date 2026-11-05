'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { crm } from '@/lib/sync/api-client';
import { Empty, ErrorBox, Skeleton, useLoader } from '@/components/crm/ui';
import { NO_DATA, type ChoroplethItem } from '@/components/crm/geo/PanchayatChoropleth';
import { filterQuery, type Filters } from './shared';

const PanchayatChoropleth = dynamic(() => import('@/components/crm/geo/PanchayatChoropleth'), { ssr: false, loading: () => <Skeleton h={520} /> });

interface DRow { key: string; label: string; dept: string; n: number }
interface Patterns {
  totals: { cases: number; rows: number; diseases: number; blocks: number; panchayats: number; firstDate?: string | null; lastDate?: string | null; unmatchedPlace: number; unmatchedDisease: number };
  diseases: DRow[];
  top: string[];
  bySex: { key: string; label: string; n: number }[];
  byAge: { key: string; label: string; n: number }[];
  diseaseByAge: { key: string; cells: Record<string, number> }[];
  diseaseBySex: { key: string; cells: Record<string, number> }[];
  months: { month: string; n: number; diseases: Record<string, number> }[];
  blocks: { district: string; block: string; n: number; panchayats: number; diseases: Record<string, number> }[];
  panchayats: { id: string; lgd?: string | null; name: string; block: string; district: string; lat?: number | null; lng?: number | null; n: number; diseases: Record<string, number> }[];
}

// One hue, light → dark, for magnitude (blue 250 → 650).
const SEQ = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'];
const AGES = ['0-5', '6-14', '15-29', '30-44', '45-59', '60+', 'unknown'];
const AGE_SHORT: Record<string, string> = { '0-5': '0–5', '6-14': '6–14', '15-29': '15–29', '30-44': '30–44', '45-59': '45–59', '60+': '60+', unknown: 'Not noted' };
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const n0 = (n: number) => n.toLocaleString('en-IN');
const monthLabel = (m: string) => new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit' }).format(new Date(`${m}-01T00:00:00`));
const dayLabel = (d?: string | null) => (d ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${d}T00:00:00`)) : '');

function bins(max: number): number[] {
  if (max <= 5) return Array.from({ length: Math.max(1, max) }, (_, i) => i + 1);
  const step = max / 5;
  return [...new Set([1, ...[1, 2, 3, 4].map((i) => Math.max(2, Math.round(step * i)))])].sort((a, b) => a - b);
}

export function DiseasePatterns({ filters, onDisease, version }: { filters: Filters; onDisease: (key: string) => void; version: number }) {
  const data = useLoader(() => crm.get<Patterns>(`/api/v1/camps/disease/patterns?${filterQuery(filters)}`),
    [filters.range.key, filters.range.from, filters.range.to, filters.district, filters.block, filters.disease, filters.sex, filters.ageBand, version]);
  const d = data.data;
  const [mapDisease, setMapDisease] = useState('');
  const [sel, setSel] = useState<string | null>(null);

  const label = useMemo(() => new Map((d?.diseases ?? []).map((x) => [x.key, x.label])), [d]);
  const mapKey = mapDisease && d?.diseases.some((x) => x.key === mapDisease) ? mapDisease : '';
  const { items, legend } = useMemo(() => {
    const pans = d?.panchayats ?? [];
    const val = (p: Patterns['panchayats'][number]) => (mapKey ? p.diseases[mapKey] ?? 0 : p.n);
    const b = bins(Math.max(0, ...pans.map(val)));
    const colors = SEQ.slice(SEQ.length - b.length);
    const idx = (n: number) => { let i = 0; for (let k = 0; k < b.length; k++) if (n >= b[k]) i = k; return i; };
    const items: ChoroplethItem[] = pans.map((p) => {
      const v = val(p);
      const top = Object.entries(p.diseases).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k, n]) => `${label.get(k) ?? k} ${n}`).join(', ');
      return { id: p.id, lgd: p.lgd, lat: p.lat, lng: p.lng, color: v ? colors[idx(v)] : NO_DATA, name: `${p.name} · ${p.block}`,
        tip: mapKey ? `${n0(v)} with ${label.get(mapKey)} · ${n0(p.n)} in all` : `${n0(p.n)} people · ${top}` };
    });
    const legend = b.map((x, i) => ({ color: colors[i], label: i === b.length - 1 ? `${x}+` : b[i + 1] - 1 > x ? `${x}–${b[i + 1] - 1}` : `${x}` }));
    return { items, legend };
  }, [d, mapKey, label]);

  if (data.error) return <ErrorBox message={data.error} onRetry={data.reload} />;
  if (!d) return <Skeleton h={520} />;
  if (d.totals.cases === 0) return <section className="crm-card"><Empty title="No disease data for these filters">Add rows under Add data, or widen the date range.</Empty></section>;

  const t = d.totals;
  const maxD = d.diseases[0]?.n ?? 1;
  const female = d.bySex.find((x) => x.key === 'F')?.n ?? 0, male = d.bySex.find((x) => x.key === 'M')?.n ?? 0;
  const maxMonth = Math.max(1, ...d.months.map((m) => m.n));
  const selP = d.panchayats.find((p) => p.id === sel) ?? null;

  return (
    <>
      <div className="crm-kpis">
        <div className="crm-card crm-kpi"><span className="crm-kpi-label">People seen</span><span className="crm-kpi-value">{n0(t.cases)}</span><span className="crm-kpi-sub">{dayLabel(t.firstDate)}{t.lastDate !== t.firstDate ? ` – ${dayLabel(t.lastDate)}` : ''}</span></div>
        <div className="crm-card crm-kpi"><span className="crm-kpi-label">Diseases recorded</span><span className="crm-kpi-value">{t.diseases}</span><span className="crm-kpi-sub">most common: {d.diseases[0]?.label}</span></div>
        <div className="crm-card crm-kpi"><span className="crm-kpi-label">Places</span><span className="crm-kpi-value">{t.blocks}<span className="crm-kpi-unit">blocks</span></span><span className="crm-kpi-sub">{t.panchayats} panchayats</span></div>
        <div className="crm-card crm-kpi"><span className="crm-kpi-label">Women · men</span><span className="crm-kpi-value">{pct(female, female + male)}%<span className="crm-kpi-unit">women</span></span><span className="crm-kpi-sub">{n0(female)} women · {n0(male)} men</span></div>
      </div>
      {(t.unmatchedDisease > 0 || t.unmatchedPlace > 0) && (
        <span className="crm-cell-sub" style={{ display: 'block', marginTop: -6 }}>
          {t.unmatchedDisease > 0 && `${n0(t.unmatchedDisease)} people have a disease typed in words that isn't one of the known diseases (shown as typed). `}
          {t.unmatchedPlace > 0 && `${n0(t.unmatchedPlace)} people have no matched panchayat, so they show in the block table but not on the map.`}
        </span>
      )}

      <div className="crm-row">
        <section className="crm-card grow-1" aria-labelledby="dz-top-h" style={{ flexBasis: 360 }}>
          <h2 id="dz-top-h" className="crm-h2">Most common</h2>
          <span className="crm-sub" style={{ fontSize: 13 }}>People with each disease. Pick one to filter the whole page.</span>
          <ul className="dz-bars">
            {d.diseases.slice(0, 15).map((x) => (
              <li key={x.key}>
                <button type="button" onClick={() => onDisease(x.key)} title={`${x.label}: ${n0(x.n)} people (${pct(x.n, t.cases)}%) · ${x.dept}`}>
                  <span className="dz-bar-l"><span>{x.label}</span><span className="crm-cell-sub">{x.dept}</span></span>
                  <span className="dz-bar-t"><span style={{ width: `${Math.max(2, (x.n / maxD) * 100)}%` }} /></span>
                  <span className="dz-bar-n">{n0(x.n)}<span className="crm-cell-sub"> {pct(x.n, t.cases)}%</span></span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="crm-card grow-3" aria-labelledby="dz-age-h" style={{ flexBasis: 560, overflowX: 'auto' }}>
          <h2 id="dz-age-h" className="crm-h2">By age group and gender</h2>
          <span className="crm-sub" style={{ fontSize: 13 }}>Each row shows how one disease spreads across ages. Darker means a bigger share of that disease&apos;s people.</span>
          <table className="crm-table dz-heat">
            <thead>
              <tr>
                <th scope="col">Disease</th>
                {AGES.map((a) => <th key={a} scope="col" className="wb-num">{AGE_SHORT[a]}</th>)}
                <th scope="col" className="wb-num">Women</th>
                <th scope="col" className="wb-num">Total</th>
              </tr>
            </thead>
            <tbody>
              {d.diseaseByAge.map((row) => {
                const tot = AGES.reduce((s, a) => s + (row.cells[a] ?? 0), 0);
                const sx = d.diseaseBySex.find((x) => x.key === row.key)?.cells ?? {};
                const fm = (sx.F ?? 0) + (sx.M ?? 0);
                return (
                  <tr key={row.key}>
                    <th scope="row">{label.get(row.key)}</th>
                    {AGES.map((a) => {
                      const v = row.cells[a] ?? 0; const s = tot ? v / tot : 0;
                      return <td key={a} className="wb-num" title={`${label.get(row.key)}, ${AGE_SHORT[a]}: ${v} (${pct(v, tot)}%)`}
                        style={v ? { background: SEQ[Math.min(4, Math.floor(s * 5))], color: s >= 0.4 ? '#fff' : '#0b0b0b' } : { color: 'var(--text-3)' }}>{v || '·'}</td>;
                    })}
                    <td className="wb-num">{fm ? `${pct(sx.F ?? 0, fm)}%` : '—'}</td>
                    <td className="wb-num"><strong>{n0(tot)}</strong></td>
                  </tr>
                );
              })}
              <tr className="dz-total">
                <th scope="row">All diseases</th>
                {AGES.map((a) => <td key={a} className="wb-num">{n0(d.byAge.find((x) => x.key === a)?.n ?? 0)}</td>)}
                <td className="wb-num">{pct(female, female + male)}%</td>
                <td className="wb-num"><strong>{n0(t.cases)}</strong></td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <div className="crm-row svm-row">
        <PanchayatChoropleth items={items} selected={sel} onSelect={setSel} fitKey={filters.district || filters.block ? `${filters.district}|${filters.block}` : ''} label="Map of people seen per panchayat">
          <div className="svm-legend" role="group" aria-label="Legend">
            <strong>{mapKey ? `People with ${label.get(mapKey)}` : 'People seen'}</strong>
            <span className="svm-sub">per panchayat</span>
            <ul>{legend.map((l) => <li key={l.label}><i style={{ background: l.color }} />{l.label}</li>)}<li><i style={{ background: NO_DATA }} />None</li></ul>
          </div>
        </PanchayatChoropleth>
        <section className="crm-card grow-2 svm-side" aria-label="Places">
          <div className="crm-chips" style={{ alignItems: 'center', margin: 0 }}>
            <label className="crm-sub" htmlFor="dz-mapd" style={{ fontSize: 13, fontWeight: 600 }}>Map shows</label>
            <select id="dz-mapd" className="crm-select" style={{ width: 'auto', maxWidth: 240 }} value={mapKey} onChange={(e) => setMapDisease(e.target.value)}>
              <option value="">All diseases</option>
              {d.diseases.slice(0, 30).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          </div>
          {selP ? (
            <div className="dz-place">
              <button type="button" className="crm-btn is-ghost is-sm" onClick={() => setSel(null)} style={{ alignSelf: 'flex-start' }}>← All blocks</button>
              <h3 style={{ fontSize: 18, fontWeight: 800 }}>{selP.name}</h3>
              <span className="crm-sub" style={{ fontSize: 13 }}>{selP.block} · {selP.district} · {n0(selP.n)} people</span>
              <ul className="dz-mini">
                {Object.entries(selP.diseases).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => (
                  <li key={k}><span>{label.get(k) ?? k}</span><span className="dz-bar-t"><span style={{ width: `${pct(v, selP.n)}%` }} /></span><strong>{v}</strong></li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              <h3 className="crm-h2" style={{ fontSize: 16 }}>By block</h3>
              <table className="crm-table dz-blocks">
                <thead><tr><th scope="col">Block</th><th scope="col" className="wb-num">People</th><th scope="col">Most common</th></tr></thead>
                <tbody>
                  {d.blocks.slice(0, 40).map((b) => (
                    <tr key={`${b.district}|${b.block}`}>
                      <th scope="row">{b.block}<span className="crm-cell-sub" style={{ display: 'block' }}>{b.district}</span></th>
                      <td className="wb-num">{n0(mapKey ? b.diseases[mapKey] ?? 0 : b.n)}</td>
                      <td className="crm-cell-sub">{Object.entries(b.diseases).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${label.get(k) ?? k} ${v}`).join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      </div>

      {d.months.length > 1 && (
        <section className="crm-card" aria-labelledby="dz-m-h">
          <h2 id="dz-m-h" className="crm-h2">Month by month</h2>
          <span className="crm-sub" style={{ fontSize: 13 }}>People seen each month, with the most common disease. Look for seasonal rises (fever and diarrhoea in the monsoon, for example).</span>
          <div className="dz-months" role="list">
            {d.months.map((m) => {
              const top = Object.entries(m.diseases).sort((a, b) => b[1] - a[1])[0];
              return (
                <div key={m.month} role="listitem" className="dz-month" title={`${monthLabel(m.month)}: ${n0(m.n)} people${top ? `; most common ${label.get(top[0])} (${top[1]})` : ''}`}>
                  <span className="dz-month-n">{n0(m.n)}</span>
                  <span className="dz-month-bar"><span style={{ height: `${Math.max(3, (m.n / maxMonth) * 100)}%` }} /></span>
                  <span className="dz-month-l">{monthLabel(m.month)}</span>
                  <span className="crm-cell-sub dz-month-top">{top ? label.get(top[0]) : ''}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
