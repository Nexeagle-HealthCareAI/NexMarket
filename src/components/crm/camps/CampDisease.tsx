'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Minus, Plus, Trash2, Undo2 } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { ErrorBox, friendlyError, Skeleton } from '@/components/crm/ui';
import { pct, type CampDetail, type CampOptions } from './shared';
import { place } from '@/lib/crm/access';

interface Res {
  total: number; fromPeople: number; fromSheets: number;
  byDisease: { key: string; code?: string | null; label: string; fromPeople: number; fromSheets: number; total: number; women: number; men: number }[];
  sheets: { id: string; disease: string; ageBand: string; age: string; sex: string; count: number; batchId: string; at: string; by: string }[];
  canAdd: boolean; why?: string | null; ageBands: { key: string; label: string }[];
}

const errText = (e: unknown) => {
  const m = e instanceof Error ? e.message : '';
  const i = m.indexOf(': {');
  if (i >= 0) { try { const j = JSON.parse(m.slice(i + 2)) as { message?: string; errors?: { fields: Record<string, string> }[] }; return [j.message, ...(j.errors?.[0] ? Object.values(j.errors[0].fields) : [])].filter(Boolean).join(' '); } catch { /* fall through */ } }
  return friendlyError(e);
};

/**
 * A camp's disease data. People checked at the camp are counted on their own (from "Disease found"). For camps run on
 * paper, tap a disease to count it: pick who the counts are for (women/men, age group) or leave them as everyone, and save.
 */
export function CampDisease({ d, options, canEdit, toast }: { d: CampDetail; options: CampOptions | null; canEdit: boolean; toast: (m: string) => void }) {
  const [res, setRes] = useState<Res | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [other, setOther] = useState({ name: '', n: '' });
  const [sex, setSex] = useState('');
  const [age, setAge] = useState('');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ batchId: string; cases: number } | null>(null);
  const [lang, setLang] = useState<'en' | 'hi'>('en');
  const c = d.camp, s = d.stats;

  const load = useCallback(async () => {
    try { setRes(await crm.get<Res>(`/api/v1/camps/${c.id}/disease`)); setErr(null); } catch (e) { setErr(friendlyError(e)); }
  }, [c.id]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  const conditions = useMemo(() => (options?.conditions ?? []).filter((x) => x.code !== 'other'), [options]);
  const picked = Object.entries(counts).filter(([, n]) => n > 0);
  const otherN = Number(other.n) || 0;
  const totalNow = picked.reduce((a, [, n]) => a + n, 0) + (other.name.trim() && otherN > 0 ? otherN : 0);
  const bump = (code: string, by: number) => setCounts((m) => ({ ...m, [code]: Math.max(0, Math.min(9999, (m[code] ?? 0) + by)) }));

  const save = async () => {
    if (totalNow === 0) { toast('Tap a disease to count it first.'); return; }
    setBusy(true);
    const base = { date: c.date, age, sex, district: c.district ?? '', block: c.block ?? '', panchayat: '' };
    const rows = [
      ...picked.map(([code, n]) => ({ ...base, disease: conditions.find((x) => x.code === code)?.en ?? code, count: String(n) })),
      ...(other.name.trim() && otherN > 0 ? [{ ...base, disease: other.name.trim(), count: String(otherN) }] : []),
    ];
    try {
      const r = await crm.post<{ batchId: string; summary: { cases: number } }>('/api/v1/camps/disease/rows', { rows, source: 'grid', campId: c.id });
      setLast({ batchId: r.batchId, cases: r.summary.cases });
      setCounts({}); setOther({ name: '', n: '' });
      toast(`${r.summary.cases} added to the disease data.`);
      await load();
    } catch (e) { toast(errText(e)); } finally { setBusy(false); }
  };
  const undo = async () => {
    if (!last) return;
    try { await crm.post(`/api/v1/camps/disease/batches/${last.batchId}/remove`, {}); toast('Taken back out.'); setLast(null); await load(); } catch (e) { toast(errText(e)); }
  };
  const removeRow = async (id: string) => {
    try { await crm.post(`/api/v1/camps/disease/rows/${id}/remove`, {}); toast('Removed.'); await load(); } catch (e) { toast(errText(e)); }
  };

  if (err && !res) return <ErrorBox message={err} onRetry={load} />;
  if (!res) return <Skeleton h={360} />;
  const max = Math.max(1, ...res.byDisease.map((x) => x.total));

  return (
    <div className="cd-wrap">
      <section className="crm-card cd-sum">
        <div className="cd-head">
          <h3 className="crm-h2">Disease data from this camp</h3>
          <span className="crm-sub">{res.total} in all · {res.fromPeople} from people checked here{res.fromSheets ? ` · ${res.fromSheets} counted from sheets` : ''}</span>
        </div>
        {res.byDisease.length === 0 ? (
          <p className="crm-sub" style={{ margin: 0 }}>Nothing yet. Tick “Disease found” when checking a person, or count from the camp’s sheets below.</p>
        ) : (
          <ul className="cd-bars">
            {res.byDisease.map((x) => (
              <li key={x.key}>
                <span className="cd-bar-l">{x.label}</span>
                <span className="cd-bar" aria-hidden>
                  <span className="is-people" style={{ width: `${pct(x.fromPeople, max)}%` }} />
                  <span className="is-sheets" style={{ width: `${pct(x.fromSheets, max)}%` }} />
                </span>
                <strong>{x.total}</strong>
                <span className="crm-cell-sub cd-split">{x.women ? `${x.women} F` : ''}{x.women && x.men ? ' · ' : ''}{x.men ? `${x.men} M` : ''}</span>
              </li>
            ))}
          </ul>
        )}
        {res.byDisease.length > 0 && <p className="cd-legend"><i className="is-people" aria-hidden /> People checked <i className="is-sheets" aria-hidden /> From sheets</p>}
        <div className="cd-who">
          <span><span>Seen</span><strong>{s.attended}</strong></span>
          <span><span>Women</span><strong>{s.women}</strong></span>
          <span><span>Men</span><strong>{s.men}</strong></span>
          <span><span>Over 60</span><strong>{s.over60}</strong></span>
          <span><span>Children</span><strong>{s.children}</strong></span>
          <span><span>High BP</span><strong>{s.highBp}</strong></span>
          <span><span>High sugar</span><strong>{s.highSugar}</strong></span>
          <span><span>Sent to {place()}</span><strong>{s.referred}</strong></span>
        </div>
      </section>

      {canEdit && (
        <section className="crm-card cd-add">
          <div className="cd-head">
            <h3 className="crm-h2">Count from the camp’s sheets</h3>
            <span className="crm-sub">For people not entered one by one. No names: just how many had each disease.</span>
          </div>
          {!res.canAdd ? <p className="ms-warn" style={{ margin: 0 }}>{res.why}</p> : (
            <>
              <div className="cd-for">
                <div className="cq-seg" role="radiogroup" aria-label="Who these counts are for">
                  {[['', 'Everyone'], ['F', 'Women'], ['M', 'Men']].map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={sex === k} onClick={() => setSex(k)}>{l}</button>)}
                </div>
                <select className="crm-select" aria-label="Age group" value={age} onChange={(e) => setAge(e.target.value)}>
                  <option value="">All ages</option>
                  {res.ageBands.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                </select>
                <div className="crm-chips cp-lang">
                  <button type="button" className="crm-chip" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
                  <button type="button" className="crm-chip" aria-pressed={lang === 'hi'} onClick={() => setLang('hi')}>हिंदी</button>
                </div>
              </div>
              <div className="cd-grid">
                {conditions.map((x) => {
                  const n = counts[x.code] ?? 0;
                  return (
                    <div key={x.code} className={`cd-cell${n > 0 ? ' is-on' : ''}`}>
                      <button type="button" className="cd-tap" onClick={() => bump(x.code, 1)} aria-label={`Add one ${x.en}`}>{lang === 'hi' ? x.hi : x.en}</button>
                      <span className="cd-step">
                        <button type="button" aria-label={`One less ${x.en}`} disabled={n === 0} onClick={() => bump(x.code, -1)}><Minus size={14} aria-hidden /></button>
                        <input inputMode="numeric" aria-label={`${x.en} count`} value={n || ''} placeholder="0"
                          onChange={(e) => { const v = Number(e.target.value.replace(/\D/g, '').slice(0, 4)) || 0; setCounts((m) => ({ ...m, [x.code]: v })); }} />
                        <button type="button" aria-label={`One more ${x.en}`} onClick={() => bump(x.code, 1)}><Plus size={14} aria-hidden /></button>
                      </span>
                    </div>
                  );
                })}
                <div className={`cd-cell cd-other${other.name.trim() && otherN ? ' is-on' : ''}`}>
                  <input className="crm-input" value={other.name} maxLength={80} onChange={(e) => setOther((o) => ({ ...o, name: e.target.value }))} placeholder="Other disease" />
                  <input className="crm-input cd-other-n" inputMode="numeric" value={other.n} onChange={(e) => setOther((o) => ({ ...o, n: e.target.value.replace(/\D/g, '').slice(0, 4) }))} placeholder="0" aria-label="How many" />
                </div>
              </div>
              <div className="cd-foot">
                <span className="crm-sub">{totalNow ? `${totalNow} to add${sex ? ` · ${sex === 'F' ? 'women' : 'men'}` : ''}${age ? ` · ${res.ageBands.find((a) => a.key === age)?.label}` : ''} · dated ${c.date.split('-').reverse().join('/')}` : 'Tap a disease to count it.'}</span>
                {picked.length > 0 && <button type="button" className="crm-btn is-ghost is-sm" onClick={() => setCounts({})}>Clear</button>}
                <button type="button" className="crm-btn" disabled={busy || totalNow === 0} onClick={() => void save()}>{busy ? 'Saving…' : `Add ${totalNow || ''} to disease data`}</button>
              </div>
              {last && <p className="cd-undo" role="status">Added {last.cases}. <button type="button" className="wa-link" onClick={() => void undo()}><Undo2 size={13} aria-hidden /> Undo</button></p>}
            </>
          )}

          {res.sheets.length > 0 && (
            <details className="cd-entries">
              <summary>{res.sheets.length} count{res.sheets.length === 1 ? '' : 's'} added from sheets</summary>
              <ul>
                {res.sheets.map((r) => (
                  <li key={r.id}>
                    <span><strong>{r.count} × {r.disease}</strong><span className="crm-cell-sub"> · {r.sex === 'F' ? 'Women' : r.sex === 'M' ? 'Men' : 'Everyone'} · {r.ageBand === 'unknown' ? 'All ages' : r.age} · {r.by}</span></span>
                    <button type="button" className="crm-btn is-ghost is-sm" aria-label={`Remove ${r.count} ${r.disease}`} onClick={() => void removeRow(r.id)}><Trash2 size={14} aria-hidden /></button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
