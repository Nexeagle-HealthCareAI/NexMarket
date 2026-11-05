'use client';

import { useState } from 'react';
import { BarChart3, Download, PencilLine, Sparkles, Table2, Trash2 } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { canEdit, useAccess } from '@/lib/crm/access';
import AnalystPanel from '@/components/crm/AnalystPanel';
import { DateRangeBar } from '@/components/crm/DateRange';
import { Pager } from '@/components/crm/Pager';
import { Empty, ErrorBox, friendlyError, Modal, Skeleton, useLoader } from '@/components/crm/ui';
import { DiseaseEntry } from './DiseaseEntry';
import { DiseasePatterns } from './DiseasePatterns';
import { filterQuery, NO_FILTERS, SEX_LABEL, type DiseaseOptions, type Filters } from './shared';

type View = 'patterns' | 'records' | 'add' | 'ai';

/** Disease data on the Health camps board: add it, see every row, find patterns, and ask the AI analyst. */
export function DiseaseBoard({ toast }: { toast: (m: string) => void }) {
  const { access } = useAccess();
  const editable = canEdit(access, 'camps');
  const opts = useLoader(() => crm.get<DiseaseOptions>('/api/v1/camps/disease/options'), []);
  const [view, setView] = useState<View>('patterns');
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [version, setVersion] = useState(0);
  const o = opts.data;

  if (opts.error) return <ErrorBox message={opts.error} onRetry={opts.reload} />;
  if (!o) return <Skeleton h={420} />;
  const blocks = (f.district ? o.districts.filter((d) => d.name === f.district) : o.districts).flatMap((d) => d.blocks.map((b) => b.name));
  const views: { k: View; l: string; icon: typeof BarChart3; show: boolean }[] = [
    { k: 'patterns', l: 'Patterns', icon: BarChart3, show: true },
    { k: 'records', l: 'All records', icon: Table2, show: true },
    { k: 'add', l: 'Add data', icon: PencilLine, show: editable },
    { k: 'ai', l: 'AI analyst', icon: Sparkles, show: true },
  ];

  return (
    <div className="dz">
      <div className="pt-seg dz-views" role="group" aria-label="Disease data views">
        {views.filter((v) => v.show).map((v) => (
          <button key={v.k} type="button" aria-pressed={view === v.k} onClick={() => setView(v.k)}>
            <v.icon size={14} aria-hidden style={{ verticalAlign: -2, marginRight: 6 }} />{v.l}
          </button>
        ))}
      </div>

      {(view === 'patterns' || view === 'records') && (
        <div className="dz-filters">
          <DateRangeBar value={f.range} onChange={(range) => setF({ ...f, range })} id="dz-date" />
          <div className="crm-chips" style={{ alignItems: 'center', margin: 0 }}>
            <label className="crm-sr" htmlFor="dz-fd">District</label>
            <select id="dz-fd" className="crm-select" style={{ width: 'auto' }} value={f.district} onChange={(e) => setF({ ...f, district: e.target.value, block: '' })}>
              <option value="">All districts</option>{o.districts.map((d) => <option key={d.name}>{d.name}</option>)}
            </select>
            <label className="crm-sr" htmlFor="dz-fb">Block</label>
            <select id="dz-fb" className="crm-select" style={{ width: 'auto' }} value={f.block} onChange={(e) => setF({ ...f, block: e.target.value })}>
              <option value="">All blocks</option>{blocks.map((b) => <option key={b}>{b}</option>)}
            </select>
            <label className="crm-sr" htmlFor="dz-fdis">Disease</label>
            <select id="dz-fdis" className="crm-select" style={{ width: 'auto', maxWidth: 220 }} value={f.disease} onChange={(e) => setF({ ...f, disease: e.target.value })}>
              <option value="">All diseases</option>
              {f.disease.startsWith('txt:') && <option value={f.disease}>{f.disease.slice(4)}</option>}
              {o.conditions.map((c) => <option key={c.code} value={c.code}>{c.en}</option>)}
            </select>
            <label className="crm-sr" htmlFor="dz-fs">Gender</label>
            <select id="dz-fs" className="crm-select" style={{ width: 'auto' }} value={f.sex} onChange={(e) => setF({ ...f, sex: e.target.value })}>
              <option value="">All genders</option><option value="F">Female</option><option value="M">Male</option><option value="O">Other</option><option value="U">Not noted</option>
            </select>
            <label className="crm-sr" htmlFor="dz-fa">Age group</label>
            <select id="dz-fa" className="crm-select" style={{ width: 'auto' }} value={f.ageBand} onChange={(e) => setF({ ...f, ageBand: e.target.value })}>
              <option value="">All ages</option>{o.ageBands.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}<option value="unknown">Age not noted</option>
            </select>
            {JSON.stringify(f) !== JSON.stringify(NO_FILTERS) && <button type="button" className="crm-btn is-ghost is-sm" onClick={() => setF(NO_FILTERS)}>Clear filters</button>}
          </div>
        </div>
      )}

      {view === 'patterns' && <DiseasePatterns filters={f} version={version} onDisease={(disease) => setF({ ...f, disease })} />}
      {view === 'records' && <Records filters={f} version={version} editable={editable} toast={toast} onChanged={() => setVersion((v) => v + 1)} />}
      {view === 'add' && editable && <DiseaseEntry options={o} toast={toast} onSaved={() => setVersion((v) => v + 1)} />}
      {view === 'ai' && (
        <AnalystPanel scope="health"
          intro="The analyst reads the disease register (counts only, no names) next to admissions by department and the community survey, finds patterns by place, age, gender and season, and turns them into a camp plan and business plan. It writes a new briefing every week."
          suggestions={[
            'Which diseases are most common in each block, and which camps should we hold where next month?',
            'Which department should we promote in which block, based on disease patterns and admissions?',
            'What seasonal patterns do you see, and how should we plan for the next three months?',
            'Draft a business plan: which services or packages would bring the most patients, and where is demand we can\'t meet yet?',
          ]} />
      )}
    </div>
  );
}

interface RecRow {
  id: string; date: string; disease: string; matched: boolean; ageBand: string; age: string; sex: string; district?: string | null; block?: string | null;
  panchayat?: string | null; panchayatMatched: boolean; count: number; camp?: string | null; source: string; batchId?: string | null; by: string; at: string;
}
interface RecRes { total: number; cases: number; page: number; pageSize: number; items: RecRow[] }

function Records({ filters, version, editable, toast, onChanged }: { filters: Filters; version: number; editable: boolean; toast: (m: string) => void; onChanged: () => void }) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);
  const [removing, setRemoving] = useState<RecRow | null>(null);
  const [busy, setBusy] = useState(false);
  const fk = JSON.stringify(filters);
  const [seen, setSeen] = useState(fk);
  if (seen !== fk) { setSeen(fk); setPage(1); }
  const data = useLoader(() => {
    const sp = filterQuery(filters); sp.set('page', String(page)); sp.set('pageSize', String(size));
    return crm.get<RecRes>(`/api/v1/camps/disease/rows?${sp}`);
  }, [fk, page, size, version]);
  const d = data.data;

  const exportCsv = async () => {
    try { await crm.download(`/api/v1/camps/disease/export.csv?${filterQuery(filters)}`, 'disease-register.csv'); }
    catch (e) { toast(friendlyError(e)); }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try { await crm.post(`/api/v1/camps/disease/rows/${removing.id}/remove`, {}); toast('Row removed from the counts.'); setRemoving(null); onChanged(); }
    catch (e) { toast(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <section className="crm-card" aria-labelledby="dz-rec-h" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="crm-card-head" style={{ padding: '16px 20px 8px' }}>
        <div style={{ flex: 1 }}>
          <h2 id="dz-rec-h" className="crm-h2">All records</h2>
          <span className="crm-sub" style={{ fontSize: 13 }}>{d ? `${d.total.toLocaleString('en-IN')} rows · ${d.cases.toLocaleString('en-IN')} people` : ' '}</span>
        </div>
        <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void exportCsv()} disabled={!d?.total}><Download size={15} aria-hidden /> Export CSV</button>
      </div>
      {data.error ? <ErrorBox message={data.error} onRetry={data.reload} /> : !d ? <div style={{ padding: 20 }}><Skeleton h={300} /></div> : d.items.length === 0 ? (
        <Empty title="No rows match">Add data, or clear a filter.</Empty>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className="crm-table dz-rec">
              <thead>
                <tr>
                  <th scope="col">Date</th><th scope="col">Disease</th><th scope="col">Age</th><th scope="col">Gender</th>
                  <th scope="col">Place</th><th scope="col" className="wb-num">Count</th><th scope="col">Added</th>
                  {editable && <th scope="col"><span className="crm-sr">Remove</span></th>}
                </tr>
              </thead>
              <tbody>
                {d.items.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${r.date}T00:00:00`))}</td>
                    <td>{r.disease}{!r.matched && <span className="crm-cell-sub" style={{ display: 'block' }}>as typed</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.ageBand === 'unknown' ? '—' : r.age}</td>
                    <td>{r.sex === 'U' ? '—' : SEX_LABEL[r.sex]}</td>
                    <td>
                      {r.panchayat ?? <span className="crm-cell-sub">No panchayat</span>}{r.panchayat && !r.panchayatMatched && <span className="crm-cell-sub"> (as typed)</span>}
                      <span className="crm-cell-sub" style={{ display: 'block' }}>{[r.block, r.district].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td className="wb-num"><strong>{r.count.toLocaleString('en-IN')}</strong></td>
                    <td className="crm-cell-sub">{r.by}{r.source === 'upload' ? ' · upload' : ''}{r.camp ? <span style={{ display: 'block' }}>{r.camp}</span> : null}</td>
                    {editable && <td><button type="button" className="crm-btn is-ghost is-sm" onClick={() => setRemoving(r)} aria-label={`Remove ${r.disease}, ${r.date}`}><Trash2 size={14} aria-hidden /></button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '0 20px 12px' }}>
            <Pager page={page} pages={Math.max(1, Math.ceil(d.total / size))} total={d.total} size={size} onPage={setPage} onSize={(n) => { setSize(n); setPage(1); }} noun="rows" />
          </div>
        </>
      )}
      {removing && (
        <Modal title="Remove this row?" onClose={() => setRemoving(null)} actions={<>
          <button type="button" className="crm-btn is-ghost" onClick={() => setRemoving(null)}>Keep it</button>
          <button type="button" className="crm-btn is-danger" onClick={() => void remove()} disabled={busy}>{busy ? 'Removing…' : 'Remove'}</button>
        </>}>
          <p>{removing.count} × {removing.disease}, {removing.ageBand === 'unknown' ? 'age not noted' : removing.age}, {SEX_LABEL[removing.sex].toLowerCase()}, {[removing.panchayat, removing.block].filter(Boolean).join(', ')} on {removing.date}.</p>
          <p className="crm-sub">It stops counting in the patterns. The row is kept in the history, not deleted.</p>
        </Modal>
      )}
    </section>
  );
}
