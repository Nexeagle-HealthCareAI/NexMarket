'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Download, MapPin, Search } from 'lucide-react';
import { canEdit, useAccess } from '@/lib/crm/access';
import { geo, istDate, STATUS_META, type CoverageRow, type CoverageStatus } from '@/lib/crm/geo';
import PanchayatPanel from '@/components/crm/geo/PanchayatPanel';
import { Empty, ErrorBox, fmt, PageHead, Skeleton, useLoader, useToast } from '@/components/crm/ui';

const PERIODS = [
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
  { key: '365', label: '12 months' },
] as const;
const STATUSES: CoverageStatus[] = ['patients', 'partners', 'visited', 'untouched'];
type SortKey = 'name' | 'block' | 'visits' | 'partners' | 'champions' | 'referrals' | 'admitted' | 'lastVisitAt';

export default function CoveragePage() {
  const { access } = useAccess();
  const [toast, showToast] = useToast();
  const [district, setDistrict] = useState('');
  const [block, setBlock] = useState('');
  const [agentId, setAgentId] = useState('');
  const [period, setPeriod] = useState<string>('30');
  const [statuses, setStatuses] = useState<CoverageStatus[]>([]);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'referrals', desc: true });
  const [blockSort, setBlockSort] = useState<'least' | 'patients'>('least');
  const [openId, setOpenId] = useState<string | null>(null);
  const [allBlocks, setAllBlocks] = useState(false);
  const [limit, setLimit] = useState(100);

  const from = istDate(Number(period) - 1);
  const to = istDate(0);
  const data = useLoader(() => geo.coverage({ agentId: agentId || undefined, from, to }), [agentId, from, to]);
  const agents = useLoader(() => geo.live(), []);
  const rows = useMemo(() => data.data?.items ?? [], [data.data]);

  const districts = useMemo(() => [...new Set(rows.map((r) => r.district))].sort(), [rows]);
  const blocks = useMemo(() => [...new Set(rows.filter((r) => !district || r.district === district).map((r) => r.block))].sort(), [rows, district]);
  const scoped = useMemo(() => rows.filter((r) => (!district || r.district === district) && (!block || r.block === block)), [rows, district, block]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = scoped.filter((r) => (statuses.length === 0 || statuses.includes(r.status))
      && (!term || r.name.toLowerCase().includes(term) || r.block.toLowerCase().includes(term)));
    const dir = sort.desc ? -1 : 1;
    return [...list].sort((a, b) => {
      const av = a[sort.key] ?? '';
      const bv = b[sort.key] ?? '';
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return a.name.localeCompare(b.name);
    });
  }, [scoped, statuses, q, sort]);

  const kpi = useMemo(() => {
    const c = { total: scoped.length, covered: 0, partners: 0, patients: 0, champions: 0, surveyed: 0, referrals: 0, admitted: 0 };
    for (const r of scoped) {
      if (r.status !== 'untouched') c.covered++;
      if (r.partners > 0) c.partners++;
      if (r.referrals > 0) c.patients++;
      c.champions += r.champions;
      if (r.surveys > 0) c.surveyed++;
      c.referrals += r.referrals;
      c.admitted += r.admitted;
    }
    return c;
  }, [scoped]);

  const byBlock = useMemo(() => {
    const m = new Map<string, Record<CoverageStatus, number> & { total: number; referrals: number; district: string }>();
    for (const r of scoped) {
      const v = m.get(r.block) ?? { patients: 0, partners: 0, visited: 0, untouched: 0, total: 0, referrals: 0, district: r.district };
      v[r.status]++; v.total++; v.referrals += r.referrals;
      m.set(r.block, v);
    }
    const list = [...m.entries()].map(([name, v]) => ({ name, ...v, pct: v.total ? Math.round(((v.total - v.untouched) / v.total) * 100) : 0 }));
    return blockSort === 'least' ? list.sort((a, b) => a.pct - b.pct) : list.sort((a, b) => b.referrals - a.referrals);
  }, [scoped, blockSort]);

  // Back to the first page whenever the filters change.
  const filterKey = [district, block, statuses.join(), q, agentId, period].join('|');
  const [limitKey, setLimitKey] = useState(filterKey);
  if (limitKey !== filterKey) {
    setLimitKey(filterKey);
    setLimit(100);
  }

  const exportCsv = () => {
    const head = ['Panchayat', 'Block', 'District', 'Status', 'Visits', 'Last visit', 'Agents', 'Partners', 'Important', 'Champions', 'Referrals', 'Admitted', 'Survey answers', 'Location'];
    const lines = filtered.map((r) => [r.name, r.block, r.district, STATUS_META[r.status].label, r.visits, r.lastVisitAt ? fmt.date(r.lastVisitAt) : '', r.agents.join('; '), r.partners, r.important, r.champions, r.referrals, r.admitted, r.surveys, r.source]);
    const csv = [head, ...lines].map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `panchayat-coverage-${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const th = (key: SortKey, label: string, num = false) => (
    <th style={num ? { textAlign: 'right' } : undefined} aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : undefined}>
      <button type="button" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'name' && key !== 'block' }))}>
        {label}{sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  );

  return (
    <main className="crm-page">
      <PageHead title="Panchayat coverage" sub="Every panchayat: visited or not, partners, patients sent, champions and survey answers. Click a row for details.">
        <div className="crm-chips">
          <Link className="crm-btn is-secondary" href="/admin/map"><MapPin size={16} aria-hidden /> Live map</Link>
          <button type="button" className="crm-btn is-secondary" onClick={exportCsv} disabled={!filtered.length}><Download size={16} aria-hidden /> Export</button>
        </div>
      </PageHead>

      <section className="crm-card" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }} aria-label="Filters">
        <select className="crm-select" aria-label="District" value={district} onChange={(e) => { setDistrict(e.target.value); setBlock(''); }} style={{ width: 'auto' }}>
          <option value="">All districts</option>
          {districts.map((d) => <option key={d}>{d}</option>)}
        </select>
        <select className="crm-select" aria-label="Block" value={block} onChange={(e) => setBlock(e.target.value)} style={{ width: 'auto' }}>
          <option value="">All blocks</option>
          {blocks.map((b) => <option key={b}>{b}</option>)}
        </select>
        <select className="crm-select" aria-label="Agent" value={agentId} onChange={(e) => setAgentId(e.target.value)} style={{ width: 'auto' }}>
          <option value="">All agents</option>
          {(agents.data?.agents ?? []).map((a) => <option key={a.agentId} value={a.agentId}>{a.name}</option>)}
        </select>
        <div className="crm-chips" role="group" aria-label="Period">
          {PERIODS.map((p) => <button key={p.key} type="button" className="crm-chip" aria-pressed={period === p.key} onClick={() => setPeriod(p.key)}>{p.label}</button>)}
        </div>
      </section>

      {data.error && <ErrorBox message={data.error} onRetry={data.reload} />}

      <div className="crm-kpis">
        <Kpi label="Panchayats" value={kpi.total} />
        <Kpi label="Covered" value={kpi.total ? Math.round((kpi.covered / kpi.total) * 100) : 0} unit="%" sub={`${kpi.covered} visited or with partners`} />
        <Kpi label="With partners" value={kpi.partners} sub={`${kpi.total - kpi.partners} still without`} />
        <Kpi label="Sending patients" value={kpi.patients} sub={`${kpi.referrals} referrals · ${kpi.admitted} admitted`} />
        <Kpi label="Champions" value={kpi.champions} sub="patient-flow people" />
        <Kpi label="Surveyed" value={kpi.surveyed} sub="panchayats with answers" />
      </div>

      <section className="crm-card" aria-labelledby="blocks-h">
        <div className="crm-card-head">
          <h2 id="blocks-h" className="crm-h2">By block</h2>
          <div className="crm-chips">
            <button type="button" className="crm-chip" aria-pressed={blockSort === 'least'} onClick={() => setBlockSort('least')}>Least covered</button>
            <button type="button" className="crm-chip" aria-pressed={blockSort === 'patients'} onClick={() => setBlockSort('patients')}>Most patients</button>
          </div>
        </div>
        <div className="crm-chips" style={{ fontSize: 12, marginBottom: 8 }}>
          {STATUSES.map((s) => (
            <span key={s} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <span className="geo-swatch" style={{ ['--c' as string]: STATUS_META[s].color }} />{STATUS_META[s].label}
            </span>
          ))}
        </div>
        {!data.data ? <Skeleton h={200} /> : byBlock.length === 0 ? <Empty title="No panchayats" /> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(420px, 100%), 1fr))', columnGap: 28 }}>
            {(allBlocks ? byBlock : byBlock.slice(0, 16)).map((b) => (
              <button key={b.name} type="button" className="geo-block-row" aria-pressed={block === b.name}
                onClick={() => { setDistrict(b.district); setBlock(block === b.name ? '' : b.name); }}
                title={`${b.name}: ${b.patients} sending patients, ${b.partners} with partners, ${b.visited} visited only, ${b.untouched} not visited`}>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name} <span className="crm-cell-sub">· {b.total}</span></span>
                <span className="geo-stack">
                  {STATUSES.map((s) => <span key={s} style={{ width: `${(b[s] / b.total) * 100}%`, ['--c' as string]: STATUS_META[s].color }} />)}
                </span>
                <span style={{ textAlign: 'right', fontWeight: 700 }}>{blockSort === 'least' ? `${b.pct}%` : b.referrals}</span>
              </button>
            ))}
          </div>
        )}
        {byBlock.length > 16 && (
          <button type="button" className="crm-btn is-secondary is-sm" style={{ marginTop: 10 }} onClick={() => setAllBlocks((v) => !v)}>
            {allBlocks ? 'Show fewer' : `Show all ${byBlock.length} blocks`}
          </button>
        )}
      </section>

      <section className="crm-card" style={{ padding: 0 }} aria-labelledby="list-h">
        <div className="crm-card-head" style={{ padding: '18px 22px 6px', flexWrap: 'wrap', gap: 10 }}>
          <h2 id="list-h" className="crm-h2">Panchayats <span className="crm-sub" style={{ fontSize: 14 }}>· {filtered.length}</span></h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="crm-chips">
              {STATUSES.map((s) => (
                <button key={s} type="button" className="crm-chip is-soft" aria-pressed={statuses.includes(s)}
                  onClick={() => setStatuses((v) => (v.includes(s) ? v.filter((x) => x !== s) : [...v, s]))}>
                  <span className="geo-swatch" style={{ ['--c' as string]: STATUS_META[s].color }} /> {STATUS_META[s].label}
                </button>
              ))}
            </div>
            <label className="crm-search">
              <Search size={16} aria-hidden />
              <span className="crm-sr">Search panchayats</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search panchayat or block" />
            </label>
          </div>
        </div>
        {!data.data ? <div style={{ padding: 22 }}><Skeleton h={300} /></div> : filtered.length === 0 ? (
          <div style={{ padding: 22 }}><Empty title="Nothing matches">Try another status or clear the search.</Empty></div>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  {th('name', 'Panchayat')}
                  {th('block', 'Block')}
                  <th>Status</th>
                  {th('visits', 'Visits', true)}
                  {th('lastVisitAt', 'Last visit')}
                  {th('partners', 'Partners', true)}
                  {th('champions', 'Champions', true)}
                  {th('referrals', 'Referrals', true)}
                  {th('admitted', 'Admitted', true)}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, limit).map((r) => <Row key={r.id} r={r} onOpen={() => setOpenId(r.id)} />)}
              </tbody>
            </table>
            {filtered.length > limit && (
              <div style={{ padding: 16, textAlign: 'center' }}>
                <button type="button" className="crm-btn is-secondary" onClick={() => setLimit((l) => l + 200)}>Show more ({filtered.length - limit} left)</button>
              </div>
            )}
          </div>
        )}
      </section>

      {openId && (
        <>
          <div className="geo-drawer-backdrop" onClick={() => setOpenId(null)} />
          <div className="geo-drawer" role="dialog" aria-modal="true" aria-label="Panchayat details">
            <PanchayatPanel id={openId} from={from} to={to}
              canEditField={canEdit(access, 'field')} canEditPartners={canEdit(access, 'partners')}
              onClose={() => setOpenId(null)} showMapLink onToast={showToast} />
          </div>
        </>
      )}
      {toast}
    </main>
  );
}

function Kpi({ label, value, unit, sub }: { label: string; value: number; unit?: string; sub?: string }) {
  return (
    <div className="crm-card crm-kpi">
      <span className="crm-kpi-label">{label}</span>
      <span className="crm-kpi-value">{value.toLocaleString('en-IN')}{unit && <span className="crm-kpi-unit">{unit}</span>}</span>
      {sub && <span className="crm-cell-sub">{sub}</span>}
    </div>
  );
}

function Row({ r, onOpen }: { r: CoverageRow; onOpen: () => void }) {
  return (
    <tr className="is-click" onClick={onOpen} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}>
      <td>
        <span className="crm-cell-main" style={{ fontWeight: 600 }}>{r.name}</span>
        {r.source === 'block' && <span className="crm-cell-sub" style={{ display: 'block' }}>Location approximate</span>}
      </td>
      <td><span>{r.block}</span><span className="crm-cell-sub" style={{ display: 'block' }}>{r.district}</span></td>
      <td>
        <span className="geo-status" style={{ ['--c' as string]: STATUS_META[r.status].color, fontWeight: 600 }}>
          <span className="geo-swatch" aria-hidden="true" />{STATUS_META[r.status].label}
        </span>
      </td>
      <td className="num" style={{ textAlign: 'right' }}>{r.visits}</td>
      <td>{r.lastVisitAt ? fmt.date(r.lastVisitAt) : <span className="crm-cell-sub">—</span>}{r.agents.length > 0 && <span className="crm-cell-sub" style={{ display: 'block' }}>{r.agents.slice(0, 2).join(', ')}{r.agents.length > 2 ? ` +${r.agents.length - 2}` : ''}</span>}</td>
      <td className="num" style={{ textAlign: 'right' }}>{r.partners}{r.newPartners > 0 && <span className="crm-cell-sub" style={{ display: 'block' }}>+{r.newPartners} new</span>}</td>
      <td className="num" style={{ textAlign: 'right' }}>{r.champions > 0 ? `★ ${r.champions}` : '—'}</td>
      <td className="num" style={{ textAlign: 'right', fontWeight: r.referrals ? 700 : 400 }}>{r.referrals}</td>
      <td className="num" style={{ textAlign: 'right' }}>{r.admitted}</td>
    </tr>
  );
}
