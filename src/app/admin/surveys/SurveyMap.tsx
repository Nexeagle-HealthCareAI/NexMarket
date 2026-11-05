'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import PanchayatChoropleth, { NO_DATA, type ChoroplethItem } from '@/components/crm/geo/PanchayatChoropleth';
import { crm } from '@/lib/sync/api-client';
import { Empty, ErrorBox, fmt, Skeleton, useLoader } from '@/components/crm/ui';
import { addRange, rangeLabel, type DateRangeValue } from '@/components/crm/DateRange';

/** Survey answers on a map, one shape per panchayat, coloured by what the person picks. */

interface QMeta { questionId: string; title: string; options: { full: string; label: string }[] }
interface PUnit {
  id: string; lgd?: string | null; name: string; sub: string; responses: number; skipped: number; agents: number; lastAt?: string | null;
  lat?: number | null; lng?: number | null; answered: Record<string, number>; counts: Record<string, Record<string, number>>;
}
interface MapRes { blocks: { district: string; block: string }[]; questions: QMeta[]; units: PUnit[]; ranged?: boolean }
// Magnitude: one hue, light → dark (blue steps 250 → 650).
const SEQ = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'];
// Identity: fixed order, follows the answer's place in the question, never its rank. Answers past 7 fold into "Other".
const CAT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'];
const OTHER = '#8f8d87';
const MIN_N = 3;

const short = (s: string) => {
  const cut = [s.indexOf(' ('), s.indexOf(': ')].filter((i) => i > 3);
  const t = cut.length ? s.slice(0, Math.min(...cut)) : s;
  return t.length > 42 ? `${t.slice(0, 40)}…` : t;
};
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

type Metric = { kind: 'count' } | { kind: 'top'; q: string } | { kind: 'share'; q: string; a: string };
interface Paint { color: string; value: string; rank: number; faint: boolean }
interface LegendItem { color: string; label: string }

/** Count bins that fit the data: 1, then four even steps up to the busiest panchayat. */
function countBins(max: number): number[] {
  if (max <= 5) return [1, 2, 3, 4, 5].slice(0, Math.max(1, max));
  const step = max / 5;
  const t = [1, ...[1, 2, 3, 4].map((i) => Math.max(2, Math.round(step * i)))];
  return [...new Set(t)].sort((a, b) => a - b);
}

function paintFor(units: PUnit[], m: Metric, qs: QMeta[]): { paint: Map<string, Paint>; legend: LegendItem[]; note?: string } {
  const paint = new Map<string, Paint>();
  if (m.kind === 'count') {
    const max = Math.max(0, ...units.map((u) => u.responses));
    const bins = countBins(max);
    const idx = (n: number) => { let i = 0; for (let k = 0; k < bins.length; k++) if (n >= bins[k]) i = k; return i; };
    const colors = SEQ.slice(SEQ.length - bins.length);
    for (const u of units) paint.set(u.id, u.responses === 0
      ? { color: NO_DATA, value: 'No answers', rank: 0, faint: false }
      : { color: colors[idx(u.responses)], value: `${u.responses} answer${u.responses === 1 ? '' : 's'}`, rank: u.responses, faint: false });
    const legend = bins.map((b, i) => ({ color: colors[i], label: i === bins.length - 1 ? `${b}+` : bins[i + 1] - 1 > b ? `${b}–${bins[i + 1] - 1}` : `${b}` }));
    return { paint, legend: [{ color: NO_DATA, label: 'None' }, ...legend] };
  }
  const q = qs.find((x) => x.questionId === m.q);
  if (!q) return { paint, legend: [] };
  if (m.kind === 'top') {
    const used = new Set<number>();
    for (const u of units) {
      const n = u.answered[q.questionId] ?? 0;
      const top = Object.entries(u.counts[q.questionId] ?? {})[0];
      if (!n || !top) { paint.set(u.id, { color: NO_DATA, value: 'No answers', rank: 0, faint: false }); continue; }
      const i = q.options.findIndex((o) => o.full === top[0]);
      const slot = i >= 0 && i < CAT.length ? i : -1;
      if (slot >= 0) used.add(slot);
      paint.set(u.id, { color: slot >= 0 ? CAT[slot] : OTHER, value: `${short(top[0])} · ${top[1]} of ${n}`, rank: pct(top[1], n) + n / 1000, faint: n < MIN_N });
    }
    const legend = q.options.map((o, i) => ({ i, o })).filter(({ i }) => used.has(i)).map(({ i, o }) => ({ color: CAT[i], label: short(o.label || o.full) }));
    if ([...paint.values()].some((p) => p.color === OTHER)) legend.push({ color: OTHER, label: 'Other answers' });
    legend.push({ color: NO_DATA, label: 'No answers' });
    return { paint, legend, note: `Pale: fewer than ${MIN_N} answers.` };
  }
  for (const u of units) {
    const n = u.answered[q.questionId] ?? 0;
    if (!n) { paint.set(u.id, { color: NO_DATA, value: 'No answers', rank: -1, faint: false }); continue; }
    const c = u.counts[q.questionId]?.[m.a] ?? 0;
    const p = pct(c, n);
    paint.set(u.id, { color: SEQ[Math.min(4, Math.floor(p / 20))], value: `${p}% · ${c} of ${n}`, rank: p + n / 1000, faint: n < MIN_N });
  }
  const legend = ['0–19%', '20–39%', '40–59%', '60–79%', '80–100%'].map((l, i) => ({ color: SEQ[i], label: l }));
  return { paint, legend: [...legend, { color: NO_DATA, label: 'No answers' }], note: `Pale: fewer than ${MIN_N} answers.` };
}

export default function SurveyMap({ range, onResponses }: { range: DateRangeValue; onResponses: (panchayatId: string) => void }) {
  const [district, setDistrict] = useState('');
  const [block, setBlock] = useState('');
  const [metricQ, setMetricQ] = useState('');      // '' = number of answers
  const [metricA, setMetricA] = useState('');      // '' = most common answer
  const [sel, setSel] = useState<string | null>(null);
  const [find, setFind] = useState('');

  const data = useLoader(() => {
    const sp = new URLSearchParams({ unit: 'panchayat' });
    addRange(sp, range);
    return crm.get<MapRes>(`/api/v1/surveys/insights?${sp}`);
  }, [range.key, range.from, range.to]);
  const d = data.data;

  const districts = useMemo(() => [...new Set((d?.blocks ?? []).map((b) => b.district))].sort(), [d]);
  const blockOptions = (d?.blocks ?? []).filter((b) => !district || b.district === district);
  const units = useMemo(() => (d?.units ?? []).filter((u) => (!block || u.sub === block) && (!district || (d?.blocks ?? []).some((b) => b.block === u.sub && b.district === district))), [d, district, block]);
  const metric: Metric = !metricQ ? { kind: 'count' } : metricA ? { kind: 'share', q: metricQ, a: metricA } : { kind: 'top', q: metricQ };
  const { paint, legend, note } = useMemo(() => paintFor(units, metric, d?.questions ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [units, metricQ, metricA, d]);
  const q = d?.questions.find((x) => x.questionId === metricQ);
  const metricName = !q ? 'Survey answers' : metricA ? `Said “${short(metricA)}”` : `Most common answer: ${q.title}`;

  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const items: ChoroplethItem[] = useMemo(() => {
    const shown = new Set(units.map((u) => u.id));
    return (d?.units ?? []).map((u) => {
      const p = paint.get(u.id);
      return { id: u.id, lgd: u.lgd, lat: u.lat, lng: u.lng, color: p?.color ?? NO_DATA, faint: p?.faint, hidden: !shown.has(u.id), name: `${u.name} · ${u.sub}`, tip: p?.value ?? '' };
    });
  }, [d, units, paint]);

  const pick = (u: PUnit) => { setSel(u.id); setFocus((f) => ({ id: u.id, n: (f?.n ?? 0) + 1 })); };

  if (data.error) return <ErrorBox message={data.error} onRetry={data.reload} />;
  const cur = units.find((u) => u.id === sel) ?? null;
  const ranked = units.filter((u) => (paint.get(u.id)?.rank ?? 0) > 0 && (!find.trim() || u.name.toLowerCase().includes(find.trim().toLowerCase())))
    .sort((a, b) => (paint.get(b.id)?.rank ?? 0) - (paint.get(a.id)?.rank ?? 0));
  const withAnswers = units.filter((u) => u.responses > 0).length;

  return (
    <>
      <div className="crm-chips" style={{ alignItems: 'center' }}>
        <label className="crm-sr" htmlFor="svm-d">District</label>
        <select id="svm-d" className="crm-select" style={{ width: 'auto' }} value={district} onChange={(e) => { setDistrict(e.target.value); setBlock(''); setSel(null); }}>
          <option value="">All districts</option>
          {districts.map((x) => <option key={x}>{x}</option>)}
        </select>
        <label className="crm-sr" htmlFor="svm-b">Block</label>
        <select id="svm-b" className="crm-select" style={{ width: 'auto' }} value={block} onChange={(e) => { setBlock(e.target.value); setSel(null); }}>
          <option value="">All blocks</option>
          {blockOptions.map((b) => <option key={`${b.district}|${b.block}`} value={b.block}>{b.block}</option>)}
        </select>
        <span className="svm-sep" aria-hidden />
        <label className="crm-sub" htmlFor="svm-q" style={{ fontSize: 13, fontWeight: 600 }}>Colour by</label>
        <select id="svm-q" className="crm-select" style={{ width: 'auto', maxWidth: 260 }} value={metricQ} onChange={(e) => { setMetricQ(e.target.value); setMetricA(''); }}>
          <option value="">Number of answers</option>
          {d?.questions.map((x) => <option key={x.questionId} value={x.questionId}>{x.title}</option>)}
        </select>
        {q && (
          <>
            <label className="crm-sr" htmlFor="svm-a">Answer</label>
            <select id="svm-a" className="crm-select" style={{ width: 'auto', maxWidth: 280 }} value={metricA} onChange={(e) => setMetricA(e.target.value)}>
              <option value="">Most common answer</option>
              {q.options.map((o) => <option key={o.full} value={o.full}>Share who said: {short(o.label || o.full)}</option>)}
            </select>
          </>
        )}
      </div>

      <div className="crm-row svm-row">
        <PanchayatChoropleth items={items} selected={sel} onSelect={setSel} fitKey={district || block ? `${district}|${block}` : ''} focus={focus} label={`Map: ${metricName}`}>
          {d && legend.length > 0 && (
            <div className="svm-legend" role="group" aria-label="Legend">
              <strong>{metricName}</strong>
              <span className="svm-sub">{rangeLabel(range) === 'all time' ? 'All time' : `Answers from ${rangeLabel(range)}`}</span>
              <ul>{legend.map((l) => <li key={l.label}><i style={{ background: l.color }} />{l.label}</li>)}</ul>
              {note && <span className="svm-sub">{note}</span>}
            </div>
          )}
        </PanchayatChoropleth>

        <section className="crm-card grow-2 svm-side" aria-label={cur ? cur.name : 'Panchayats'}>
          {!d ? <Skeleton h={420} /> : cur ? (
            <PanchayatDetail u={cur} qs={d.questions} metricQ={metricQ} onBack={() => setSel(null)} onResponses={() => onResponses(cur.id)} />
          ) : (
            <>
              <div>
                <h2 className="crm-h2">Panchayats</h2>
                <span className="crm-sub" style={{ fontSize: 13 }}>
                  {withAnswers} of {units.length} have answers{metric.kind === 'count' ? '' : ', ranked by the colour on the map'}. Pick one on the map or below.
                </span>
              </div>
              <label className="crm-search">
                <Search size={16} aria-hidden color="var(--text-2)" />
                <span className="crm-sr">Find a panchayat</span>
                <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a panchayat" style={{ border: 0, outline: 0, flex: 1, font: 'inherit', fontSize: 14, background: 'transparent' }} />
              </label>
              {ranked.length === 0 ? <Empty title="No panchayats with answers">{range.key ? 'Try a longer date range or All.' : 'Answers appear as agents survey new contacts.'}</Empty> : (
                <ul className="svm-list">
                  {ranked.slice(0, 60).map((u) => {
                    const p = paint.get(u.id)!;
                    return (
                      <li key={u.id}>
                        <button type="button" onClick={() => pick(u)}>
                          <i style={{ background: p.color, opacity: p.faint ? 0.45 : 1 }} aria-hidden />
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ fontWeight: 600, fontSize: 14, display: 'block' }}>{u.name}</span>
                            <span className="crm-cell-sub">{u.sub}</span>
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{p.value}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {ranked.length > 60 && <span className="crm-cell-sub">Showing the top 60. Pick a block or search to see the rest.</span>}
            </>
          )}
        </section>
      </div>
    </>
  );
}

function PanchayatDetail({ u, qs, metricQ, onBack, onResponses }: { u: PUnit; qs: QMeta[]; metricQ: string; onBack: () => void; onResponses: () => void }) {
  // The question used to colour the map comes first.
  const ordered = [...qs].sort((a, b) => (a.questionId === metricQ ? -1 : b.questionId === metricQ ? 1 : 0));
  return (
    <>
      <button type="button" className="crm-btn is-ghost is-sm" onClick={onBack} style={{ alignSelf: 'flex-start' }}><ArrowLeft size={14} aria-hidden /> All panchayats</button>
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 800 }}>{u.name}</h2>
        <span className="crm-sub" style={{ fontSize: 13 }}>{u.sub}{u.lastAt ? ` · last survey ${fmt.date(u.lastAt)}` : ''}</span>
      </div>
      <div className="svm-stats">
        <span><strong>{u.responses}</strong>contacts answered</span>
        <span><strong>{u.agents}</strong>agent{u.agents === 1 ? '' : 's'}</span>
        <span style={u.skipped ? { color: 'var(--warn-ink)' } : undefined}><strong>{u.skipped}</strong>skipped</span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {u.responses + u.skipped > 0 && <button type="button" className="crm-btn is-secondary is-sm" onClick={onResponses}>See its answers</button>}
        <Link className="crm-btn is-ghost is-sm" href="/admin/coverage">Open in coverage</Link>
      </div>
      {u.responses === 0 ? <Empty title="No answers here yet">{u.skipped ? 'Agents skipped the survey here. See its answers for their reasons.' : 'Nobody here has been surveyed in this period.'}</Empty> : (
        <div className="svm-qs">
          {u.responses < MIN_N && <span className="crm-note" style={{ margin: 0 }}>Only {u.responses} answer{u.responses === 1 ? '' : 's'} so far, so treat this as a first look.</span>}
          {ordered.map((q) => {
            const n = u.answered[q.questionId] ?? 0;
            const top = Object.entries(u.counts[q.questionId] ?? {}).slice(0, 4);
            return (
              <div key={q.questionId} className="sv-card" style={q.questionId === metricQ ? { borderColor: 'var(--accent)' } : undefined}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{q.title}</span>
                {n === 0 ? <span className="crm-cell-sub">Nobody answered this.</span> : top.map(([label, c]) => (
                  <span key={label} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ display: 'flex', fontSize: 13, gap: 8 }}><span style={{ flex: 1 }}>{short(label)}</span><strong>{c} of {n}</strong></span>
                    <span className="crm-bar" style={{ height: 8 }}><span style={{ display: 'block', height: '100%', width: `${pct(c, n)}%`, background: 'var(--accent)', borderRadius: 4 }} /></span>
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
