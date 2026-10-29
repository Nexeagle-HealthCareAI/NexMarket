'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowDown, ArrowLeft, ArrowUp, Search, Sparkles } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import AnalystPanel from '@/components/crm/AnalystPanel';
import { contactTypeLabel, Empty, ErrorBox, fmt, friendlyError, Modal, PageHead, Pill, Skeleton, useLoader, useToast } from '@/components/crm/ui';

// ─── Types ──────────────────────────────────────────────────────────────────
interface QMeta { id: string; questionId: string; title: string; text: string; type: string; options: { full: string; label: string }[] }
interface Unit {
  id: string; name: string; sub: string; responses: number; lastAt?: string | null; score: number;
  topSpecialist?: string | null; topSpecialistWeHave: boolean; topDestination?: string | null;
  answered: Record<string, number>; counts: Record<string, Record<string, number>>;
}
interface InsightsRes {
  unit: 'block' | 'panchayat'; district?: string | null; block?: string | null;
  blocks: { district: string; block: string }[]; departments: string[]; questions: QMeta[];
  totals: { responses: number; places: number; placesWithAnswers: number; panchayats: number; panchayatsWithAnswers: number; thisMonth: number; skippedThisMonth: number };
  units: Unit[];
}
interface RespRow { id: string; kind: string; contactId?: string | null; contactName?: string | null; contactType?: string | null; panchayat?: string | null; block?: string | null; agentId: string; agent: string; createdAt: string; answered: number; answerCount: number; skipReason?: string | null }
interface RespList { counts: { current: number; skipped: number; older: number }; total: number; page: number; pageSize: number; asked: number; canEdit: boolean; agents: { agentId: string; agent: string }[]; blocks: string[]; rows: RespRow[] }
interface RespDetail {
  id: string; kind: string; contact?: { clientId: string; name: string; type: string } | null; panchayat?: string | null; block?: string | null; agent: string; createdAt: string; skipReason?: string | null;
  canEdit: boolean; canDelete: boolean;
  questions: { questionId: string; title: string; text: string; type: string; options: { full: string; label: string }[]; values: string[]; labels: string[] }[];
  extra: { questionId: string; value: string }[];
  history: { action: string; summary?: string | null; by: string; at: string }[];
}
interface QRow { id: string; questionId: string; title: string; text: string; type: string; order: number; options: string[]; answers: number }
interface QRes { canEdit: boolean; asked: QRow[]; retired: QRow[] }

type Tab = 'insights' | 'responses' | 'questions' | 'ai';
const TABS: { k: Tab; l: string }[] = [{ k: 'insights', l: 'Panchayat insights' }, { k: 'responses', l: 'Responses' }, { k: 'questions', l: 'Questions' }, { k: 'ai', l: 'AI analyst' }];
const shortLabel = (s: string) => {
  const cut = [s.indexOf(' ('), s.indexOf(': ')].filter((i) => i > 3);
  const t = cut.length ? s.slice(0, Math.min(...cut)) : s;
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
};
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);

export default function SurveysWrap() {
  return (
    <Suspense fallback={<main className="crm-page"><Skeleton h={120} /></main>}>
      <SurveysPage />
    </Suspense>
  );
}

function SurveysPage() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = (TABS.find((t) => t.k === params.get('tab'))?.k ?? 'insights') as Tab;
  const go = (t: Tab) => router.replace(t === 'insights' ? '/admin/surveys' : `/admin/surveys?tab=${t}`, { scroll: false });
  const [toast, showToast] = useToast();

  return (
    <main className="crm-page">
      <PageHead title="Surveys" sub="Agents ask six questions to every new contact. Here they add up to a picture of each panchayat: what people fall ill with, which doctors they lack and where they go today." />
      <div className="crm-tabs" role="tablist" aria-label="Survey views">
        {TABS.map((t) => (
          <button key={t.k} type="button" role="tab" className="crm-tab" aria-selected={tab === t.k} onClick={() => go(t.k)}>
            {t.k === 'ai' && <Sparkles size={14} aria-hidden style={{ verticalAlign: -2, marginRight: 6 }} />}{t.l}
          </button>
        ))}
      </div>
      {tab === 'insights' && <Insights />}
      {tab === 'responses' && <Responses showToast={showToast} />}
      {tab === 'questions' && <Questions showToast={showToast} />}
      {tab === 'ai' && (
        <AnalystPanel scope="surveys"
          intro="The analyst reads every survey answer, matches the needs to the hospital's departments and admissions, and checks whether the survey is being done properly. It writes a new survey briefing every week."
          suggestions={[
            'Which block should get our next health camp, and for which specialty?',
            'Where are we losing patients to Siliguri or Purnea, and why?',
            'Which agents are skipping the survey or adding contacts without one?',
            'What do families say about paying, and what package should we offer?',
          ]} />
      )}
      {toast}
    </main>
  );
}

// ─── Insights ───────────────────────────────────────────────────────────────

function Insights() {
  const [district, setDistrict] = useState('');
  const [block, setBlock] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [cmpQ, setCmpQ] = useState('');
  const data = useLoader(() => {
    const sp = new URLSearchParams();
    if (district) sp.set('district', district);
    if (block) sp.set('block', block);
    return crm.get<InsightsRes>(`/api/v1/surveys/insights?${sp}`);
  }, [district, block]);
  const d = data.data;
  const districts = useMemo(() => [...new Set((d?.blocks ?? []).map((b) => b.district))].sort(), [d]);
  const blockOptions = (d?.blocks ?? []).filter((b) => !district || b.district === district);

  if (data.error) return <ErrorBox message={data.error} onRetry={data.reload} />;
  if (!d) return <Skeleton h={480} />;
  const unitWord = d.unit === 'panchayat' ? 'panchayat' : 'block';
  const withAnswers = d.units.filter((u) => u.responses > 0);
  const cur = d.units.find((u) => u.id === sel) ?? withAnswers[0] ?? null;
  const qCmp = d.questions.find((q) => q.questionId === cmpQ) ?? d.questions.find((q) => q.questionId === 'specialist_deficit') ?? d.questions[0];

  // Average share per answer across the whole scope, for the "compared with" line.
  const scopeShare = (qid: string, label: string) => {
    let n = 0, hit = 0;
    for (const u of d.units) { n += u.answered[qid] ?? 0; hit += u.counts[qid]?.[label] ?? 0; }
    return pct(hit, n);
  };

  return (
    <>
      <div className="crm-chips" style={{ alignItems: 'center' }}>
        <label className="crm-sr" htmlFor="sv-d">District</label>
        <select id="sv-d" className="crm-select" style={{ width: 'auto' }} value={district} onChange={(e) => { setDistrict(e.target.value); setBlock(''); setSel(null); }}>
          <option value="">All districts</option>
          {districts.map((x) => <option key={x}>{x}</option>)}
        </select>
        <label className="crm-sr" htmlFor="sv-b">Block</label>
        <select id="sv-b" className="crm-select" style={{ width: 'auto' }} value={block} onChange={(e) => { setBlock(e.target.value); setSel(null); }}>
          <option value="">All blocks</option>
          {blockOptions.map((b) => <option key={`${b.district}|${b.block}`} value={b.block}>{b.block}</option>)}
        </select>
        <span className="crm-sub" style={{ fontSize: 13 }}>{d.unit === 'panchayat' ? `Showing the panchayats of ${block}` : 'Showing blocks. Pick a block to see its panchayats.'}</span>
      </div>

      <div className="crm-kpis">
        <div className="crm-card crm-kpi"><span className="crm-kpi-label">Contacts surveyed</span><span className="crm-kpi-value">{d.totals.responses.toLocaleString('en-IN')}</span></div>
        <div className="crm-card crm-kpi"><span className="crm-kpi-label">Panchayats with answers</span><span className="crm-kpi-value">{d.totals.panchayatsWithAnswers}<span className="crm-kpi-unit">of {d.totals.panchayats}</span></span></div>
        <div className="crm-card crm-kpi"><span className="crm-kpi-label">Answered this month</span><span className="crm-kpi-value">{d.totals.thisMonth}</span></div>
        <div className="crm-card crm-kpi" style={d.totals.skippedThisMonth ? { background: 'var(--warn-soft)', borderColor: '#f0c98a' } : undefined}>
          <span className="crm-kpi-label">Skipped this month</span><span className="crm-kpi-value" style={{ color: d.totals.skippedThisMonth ? 'var(--warn-ink)' : undefined }}>{d.totals.skippedThisMonth}</span>
        </div>
      </div>

      {withAnswers.length === 0 ? <section className="crm-card"><Empty title="No survey answers here yet">Answers appear as agents survey new contacts.</Empty></section> : (
        <div className="crm-row">
          <section className="crm-card grow-1" aria-labelledby="fz-h" style={{ flexBasis: 320, padding: '18px 0 6px' }}>
            <div style={{ padding: '0 20px 10px' }}>
              <h2 id="fz-h" className="crm-h2">Where to focus</h2>
              <span className="crm-sub" style={{ fontSize: 13 }}>{unitWord === 'block' ? 'Blocks' : 'Panchayats'} that miss a specialist we have and send patients far away today. More answers, more confidence.</span>
            </div>
            <ul className="sv-focus">
              {d.units.map((u) => (
                <li key={u.id}>
                  <button type="button" aria-pressed={cur?.id === u.id} onClick={() => setSel(u.id)} disabled={u.responses === 0}>
                    <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{u.name}</span>
                      <span className="crm-cell-sub" style={{ display: 'block' }}>
                        {u.responses === 0 ? 'No answers yet' : [u.topSpecialist, u.topDestination && `goes to ${u.topDestination}`].filter(Boolean).join(' · ')}
                        {u.responses > 0 && ` · ${u.responses} answer${u.responses === 1 ? '' : 's'}`}
                      </span>
                    </span>
                    {u.responses > 0 && <Pill tone={u.score >= 60 ? 'ok' : u.score >= 35 ? 'accent' : 'neutral'}>{u.score}</Pill>}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {cur && (
            <section className="crm-card grow-3" aria-labelledby="un-h" style={{ flexBasis: 560, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <h2 id="un-h" style={{ fontSize: 20, fontWeight: 800 }}>{cur.name}</h2>
                <span className="crm-sub" style={{ fontSize: 13, flex: 1 }}>{cur.sub} · {cur.responses} contact{cur.responses === 1 ? '' : 's'} answered{cur.lastAt ? ` · last on ${fmt.date(cur.lastAt)}` : ''}</span>
                {d.unit === 'block' && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => { setBlock(cur.name); setSel(null); }}>See its panchayats</button>}
                {d.unit === 'panchayat' && <Link href="/admin/coverage" style={{ fontSize: 13, fontWeight: 600 }}>Open in coverage</Link>}
              </div>
              <Tells u={cur} d={d} />
              <div className="sv-cards">
                {d.questions.map((q) => {
                  const n = cur.answered[q.questionId] ?? 0;
                  const top = Object.entries(cur.counts[q.questionId] ?? {}).slice(0, 4);
                  const lead = top[0];
                  return (
                    <div key={q.questionId} className="sv-card">
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{q.title}</span>
                      {n === 0 ? <span className="crm-cell-sub">Nobody answered this.</span> : top.map(([label, c]) => (
                        <span key={label} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <span style={{ display: 'flex', fontSize: 13, gap: 8 }}><span style={{ flex: 1 }}>{shortLabel(label)}</span><strong>{c} of {n}</strong></span>
                          <span className="crm-bar" style={{ height: 8 }}><span style={{ display: 'block', height: '100%', width: `${pct(c, n)}%`, background: 'var(--accent)' }} /></span>
                        </span>
                      ))}
                      {lead && <span className="crm-cell-sub">Across {d.unit === 'panchayat' ? d.block : 'the region'}: {shortLabel(lead[0])} {scopeShare(q.questionId, lead[0])}%</span>}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}

      {withAnswers.length > 1 && qCmp && (
        <section className="crm-card" aria-labelledby="cmp-h">
          <div className="crm-card-head">
            <h2 id="cmp-h" className="crm-h2" style={{ flex: 1 }}>Compare {unitWord}s</h2>
            <label className="crm-sr" htmlFor="cmp-q">Question</label>
            <select id="cmp-q" className="crm-select" style={{ width: 'auto' }} value={qCmp.questionId} onChange={(e) => setCmpQ(e.target.value)}>
              {d.questions.map((q) => <option key={q.questionId} value={q.questionId}>{q.title}</option>)}
            </select>
          </div>
          <CompareTable d={d} q={qCmp} />
          <span className="crm-cell-sub">Share of contacts in each {unitWord} who gave that answer. Darker means more.</span>
        </section>
      )}
    </>
  );
}

/** Plain-language reading of one place's answers. Rules, not AI: the AI analyst tab goes further. */
function Tells({ u, d }: { u: Unit; d: InsightsRes }) {
  const lines: string[] = [];
  const top = (qid: string) => { const e = Object.entries(u.counts[qid] ?? {})[0]; const n = u.answered[qid] ?? 0; return e ? { label: shortLabel(e[0]), c: e[1], n } : null; };
  const spec = top('specialist_deficit');
  if (spec) lines.push(`${spec.label} is the specialist people miss most (${spec.c} of ${spec.n})${u.topSpecialistWeHave ? ', and the hospital has that department.' : '. Check whether the hospital offers it.'}`);
  const dest = top('treatment_destination');
  if (dest) lines.push(`For serious cases most go to ${dest.label} today (${dest.c} of ${dest.n}).`);
  const dec = top('referral_decision_maker');
  if (dec) lines.push(`${dec.label} usually decides the hospital, so start there.`);
  const pay = top('payment_funding_source');
  if (pay) lines.push(`Most families pay by ${pay.label.toLowerCase()} (${pay.c} of ${pay.n}).`);
  if (u.responses < 5) lines.push(`Only ${u.responses} answer${u.responses === 1 ? '' : 's'} so far, so treat this as a first look.`);
  if (lines.length === 0) return null;
  return (
    <div className="crm-note" style={{ background: 'var(--accent-tint)', color: 'var(--text)', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <strong style={{ color: 'var(--accent-ink)' }}>What this tells us</strong>
      {lines.map((l) => <span key={l}>• {l}</span>)}
      {d.departments.length === 0 && <span className="crm-cell-sub">Add departments under Departments &amp; doctors so this can match needs to what the hospital offers.</span>}
    </div>
  );
}

function CompareTable({ d, q }: { d: InsightsRes; q: QMeta }) {
  const totals = new Map<string, number>();
  for (const u of d.units) for (const [k, v] of Object.entries(u.counts[q.questionId] ?? {})) totals.set(k, (totals.get(k) ?? 0) + v);
  const cols = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
  const rows = d.units.filter((u) => (u.answered[q.questionId] ?? 0) > 0).sort((a, b) => b.responses - a.responses).slice(0, 15);
  if (cols.length === 0) return <span className="crm-cell-sub">No answers to this question yet.</span>;
  return (
    <div className="crm-table-wrap">
      <table className="crm-table sv-heat">
        <thead><tr><th>{d.unit === 'panchayat' ? 'Panchayat' : 'Block'}</th>{cols.map((c) => <th key={c} style={{ textAlign: 'center', whiteSpace: 'normal', minWidth: 110 }}>{shortLabel(c)}</th>)}</tr></thead>
        <tbody>
          {rows.map((u) => {
            const n = u.answered[q.questionId] ?? 0;
            return (
              <tr key={u.id}>
                <td><span className="crm-cell-main">{u.name}</span><div className="crm-cell-sub">{n} answer{n === 1 ? '' : 's'}</div></td>
                {cols.map((c) => {
                  const v = pct(u.counts[q.questionId]?.[c] ?? 0, n);
                  const l = 97 - Math.round(v * 0.55);
                  return <td key={c} style={{ textAlign: 'center' }}><span className="sv-cell" style={{ background: `hsl(210, 80%, ${l}%)`, color: l < 65 ? '#fff' : 'var(--text)' }}>{v}%</span></td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Responses ──────────────────────────────────────────────────────────────

function Responses({ showToast }: { showToast: (m: string) => void }) {
  const [view, setView] = useState<'current' | 'skipped' | 'older'>('current');
  const [block, setBlock] = useState('');
  const [agentId, setAgentId] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => { setQ(search.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);
  const list = useLoader(() => {
    const sp = new URLSearchParams({ view, page: String(page), pageSize: '25' });
    if (block) sp.set('block', block);
    if (agentId) sp.set('agentId', agentId);
    if (q) sp.set('q', q);
    return crm.get<RespList>(`/api/v1/surveys/responses?${sp}`);
  }, [view, block, agentId, q, page]);
  const d = list.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;

  return (
    <>
      <div className="crm-chips" style={{ alignItems: 'center' }}>
        <label className="crm-search" style={{ flex: '1 1 240px' }}>
          <Search size={16} aria-hidden color="var(--text-2)" />
          <span className="crm-sr">Search responses</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Contact, panchayat or agent" style={{ border: 0, outline: 0, flex: 1, font: 'inherit', fontSize: 14, background: 'transparent' }} />
        </label>
        <div className="pt-seg" role="group" aria-label="Show">
          {([['current', 'Six questions'], ['skipped', 'Skipped'], ['older', 'Older questionnaire']] as const).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={view === k} onClick={() => { setView(k); setPage(1); setSel(null); }}>{l}{d ? ` ${d.counts[k].toLocaleString('en-IN')}` : ''}</button>
          ))}
        </div>
        <label className="crm-sr" htmlFor="rs-b">Block</label>
        <select id="rs-b" className="crm-select" style={{ width: 'auto' }} value={block} onChange={(e) => { setBlock(e.target.value); setPage(1); }}>
          <option value="">All blocks</option>
          {d?.blocks.map((b) => <option key={b}>{b}</option>)}
        </select>
        <label className="crm-sr" htmlFor="rs-a">Agent</label>
        <select id="rs-a" className="crm-select" style={{ width: 'auto' }} value={agentId} onChange={(e) => { setAgentId(e.target.value); setPage(1); }}>
          <option value="">All agents</option>
          {d?.agents.map((a) => <option key={a.agentId} value={a.agentId}>{a.agent}</option>)}
        </select>
      </div>
      {view === 'older' && <div className="crm-note" style={{ background: 'var(--accent-tint)', color: 'var(--text)' }}>These answers were given to the longer questionnaire used before the six questions. They are kept as they were and can be read and exported, but they aren&apos;t counted in Panchayat insights.</div>}
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}

      <div className={`crm-row pt-split${sel ? ' has-sel' : ''}`}>
        <section className="crm-card grow-3 pt-list" aria-label="Responses" style={{ padding: 0, overflow: 'hidden' }}>
          {!d ? <div style={{ padding: 20 }}><Skeleton h={300} /></div> : d.rows.length === 0 ? <Empty title="No responses match">Try clearing a filter.</Empty> : (
            <>
              <div className="crm-table-wrap">
                <table className="crm-table">
                  <thead><tr><th>Contact</th><th>Panchayat · block</th><th>Agent</th><th>Date</th><th>Answers</th></tr></thead>
                  <tbody>
                    {d.rows.map((r) => (
                      <tr key={r.id} className={`pt-tr${r.id === sel ? ' is-sel' : ''}`} onClick={() => setSel(r.id)}>
                        <td><button type="button" className="pt-name" onClick={(e) => { e.stopPropagation(); setSel(r.id); }}>{r.contactName ?? 'Unknown contact'}</button><div className="crm-cell-sub">{contactTypeLabel(r.contactType)}</div></td>
                        <td style={{ fontSize: 13 }}>{[r.panchayat, r.block].filter(Boolean).join(' · ') || '—'}</td>
                        <td style={{ fontSize: 13 }}>{r.agent}</td>
                        <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{fmt.date(r.createdAt)}</td>
                        <td>{r.kind === 'skipped' ? <Pill tone="warn">Skipped</Pill> : r.kind === 'older' ? <Pill>{r.answerCount} answers</Pill> : <Pill tone={r.answered >= d.asked ? 'ok' : 'accent'}>{r.answered} of {d.asked}</Pill>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pt-pager">
                <span>{d.total.toLocaleString('en-IN')} response{d.total === 1 ? '' : 's'} · page {page} of {pages}</span>
                <span style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="crm-btn is-secondary is-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
                  <button type="button" className="crm-btn is-secondary is-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
                </span>
              </div>
            </>
          )}
        </section>
        <aside className="crm-card grow-2 pt-panel" aria-label="Response" style={{ flexBasis: 400 }}>
          {sel ? <ResponsePanel key={sel} id={sel} onBack={() => setSel(null)} showToast={showToast} onChanged={() => void list.reload()} onDeleted={() => { setSel(null); void list.reload(); }} />
            : <Empty title="Pick a response">Read the answers, and if you are an admin, correct or remove them.</Empty>}
        </aside>
      </div>
    </>
  );
}

function ResponsePanel({ id, onBack, showToast, onChanged, onDeleted }: { id: string; onBack: () => void; showToast: (m: string) => void; onChanged: () => void; onDeleted: () => void }) {
  const d = useLoader(() => crm.get<RespDetail>(`/api/v1/surveys/responses/${id}`), [id]);
  const [edit, setEdit] = useState<Record<string, string[]> | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);
  if (d.error) return <ErrorBox message={d.error} onRetry={d.reload} />;
  const r = d.data;
  if (!r) return <Skeleton h={380} />;

  const startEdit = () => setEdit(Object.fromEntries(r.questions.map((q) => [q.questionId, q.values.filter((v) => q.options.some((o) => o.full === v))])));
  const toggle = (qid: string, full: string, single: boolean) => setEdit((e) => {
    if (!e) return e;
    const cur = e[qid] ?? [];
    return { ...e, [qid]: single ? [full] : cur.includes(full) ? cur.filter((x) => x !== full) : [...cur, full] };
  });
  const save = async () => {
    if (!edit) return;
    // Only send questions whose choices changed; keep any "Other: …" text the agent typed.
    const changed: Record<string, string[]> = {};
    for (const q of r.questions) {
      const keepOther = q.values.filter((v) => !q.options.some((o) => o.full === v));
      const next = [...(edit[q.questionId] ?? []), ...keepOther];
      if ([...next].sort().join('|') !== [...q.values].sort().join('|')) changed[q.questionId] = next;
    }
    setBusy(true);
    try {
      const res = await crm.put<{ changed: number }>(`/api/v1/surveys/responses/${id}`, { answers: changed });
      setEdit(null);
      await d.reload();
      onChanged();
      showToast(res.changed ? `Saved ${res.changed} change${res.changed === 1 ? '' : 's'}.` : 'Nothing changed.');
    } catch (e) { showToast(friendlyError(e)); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { await crm.del(`/api/v1/surveys/responses/${id}`); showToast('Response deleted. A copy is kept in the change history.'); onDeleted(); }
    catch (e) { showToast(friendlyError(e)); } finally { setBusy(false); setConfirmDel(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <button type="button" className="crm-btn is-secondary is-sm pt-back" onClick={onBack}><ArrowLeft size={16} aria-hidden /> All responses</button>
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 800 }}>{r.contact?.name ?? 'Unknown contact'}</h2>
        <span className="crm-sub" style={{ fontSize: 13, display: 'block' }}>{[contactTypeLabel(r.contact?.type), r.panchayat, r.block].filter(Boolean).join(' · ')}</span>
        <span className="crm-sub" style={{ fontSize: 13, display: 'block' }}>Asked by {r.agent} on {fmt.dateTime(r.createdAt)}</span>
      </div>
      <div className="crm-chips">
        {r.contact && <Link href={`/admin/partners?id=${encodeURIComponent(r.contact.clientId)}`} className="crm-btn is-secondary is-sm">Open partner</Link>}
        {r.canEdit && !edit && <button type="button" className="crm-btn is-sm" onClick={startEdit}>Edit answers</button>}
      </div>
      {r.kind === 'skipped' && <div className="crm-note" style={{ background: 'var(--warn-soft)', color: 'var(--warn-ink)' }}>The agent skipped the survey. Reason: “{r.skipReason || 'none given'}”</div>}

      {!edit ? (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {r.questions.map((q) => (
            <div key={q.questionId} style={{ padding: '10px 0', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)' }}>{q.title}</span>
              {q.labels.length === 0 ? <span className="crm-cell-sub">Not answered</span> : (
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{q.labels.map((l, i) => <span key={i} className="sv-chip">{l}</span>)}</span>
              )}
            </div>
          ))}
          {r.extra.length > 0 && r.extra.map((x) => (
            <div key={x.questionId} style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)' }}>{x.questionId}</span>
              <div style={{ fontSize: 14 }}>{x.value}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {r.questions.map((q) => {
            const single = q.type !== 'multi';
            return (
              <fieldset key={q.questionId} className="sv-fieldset">
                <legend>{q.title}{single ? '' : ' (pick any)'}</legend>
                {q.options.filter((o) => o.full !== 'Other').map((o) => (
                  <label key={o.full} className="sv-opt">
                    <input type={single ? 'radio' : 'checkbox'} name={`q-${q.questionId}`} checked={(edit[q.questionId] ?? []).includes(o.full)} onChange={() => toggle(q.questionId, o.full, single)} />
                    {o.label}
                  </label>
                ))}
                {q.values.filter((v) => !q.options.some((o) => o.full === v)).map((v) => <span key={v} className="crm-cell-sub">Kept as typed: {v}</span>)}
              </fieldset>
            );
          })}
          <span className="crm-cell-sub">Every change is saved with your name and the time.</span>
          <div className="crm-chips" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="crm-btn is-secondary" onClick={() => setEdit(null)}>Cancel</button>
            <button type="button" className="crm-btn is-ok" disabled={busy} onClick={save}>Save changes</button>
          </div>
        </div>
      )}

      {r.canDelete && !edit && (
        confirmDel ? (
          <div className="crm-note" style={{ background: 'var(--bad-soft)', color: 'var(--bad)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ flex: 1 }}>Delete this response? It stops counting in insights. A full copy is kept in the change history.</span>
            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setConfirmDel(false)}>Keep it</button>
            <button type="button" className="crm-btn is-danger is-sm" disabled={busy} onClick={remove}>Delete</button>
          </div>
        ) : <button type="button" className="crm-btn is-danger is-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setConfirmDel(true)}>Delete response</button>
      )}

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Change history</span>
        {r.history.length === 0 ? <span className="crm-cell-sub">No changes since the agent submitted it.</span> : r.history.map((h, i) => (
          <span key={i} style={{ fontSize: 13 }}>{h.summary} <span className="crm-cell-sub" style={{ display: 'inline' }}>· {h.by} · {fmt.dateTime(h.at)}</span></span>
        ))}
      </div>
    </div>
  );
}

// ─── Questions ──────────────────────────────────────────────────────────────

function Questions({ showToast }: { showToast: (m: string) => void }) {
  const data = useLoader(() => crm.get<QRes>('/api/v1/surveys/questions'), []);
  const [selId, setSelId] = useState<string | null>(null);
  const [swapIn, setSwapIn] = useState<QRow | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const [busy, setBusy] = useState(false);
  const d = data.data;
  if (data.error) return <ErrorBox message={data.error} onRetry={data.reload} />;
  if (!d) return <Skeleton h={420} />;
  const sel = d.asked.find((q) => q.id === selId) ?? d.asked[0];

  const move = async (i: number, by: number) => {
    const ids = d.asked.map((q) => q.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setBusy(true);
    try { await crm.post('/api/v1/surveys/questions/order', { ids }); await data.reload(); } catch (e) { showToast(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <>
      {!d.canEdit && <div className="crm-note">Only an admin can change the questions.</div>}
      <div className="crm-row">
        <section className="grow-3" aria-labelledby="ask-h" style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: '3 1 540px', minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <h2 id="ask-h" className="crm-h2" style={{ flex: 1 }}>Asked in the app</h2>
            <span className="crm-sub" style={{ fontSize: 13 }}>{d.asked.length} questions, in this order. Changes reach phones at their next sync.</span>
          </span>
          {d.asked.map((q, i) => (
            <div key={q.id} className="sv-q" data-sel={sel?.id === q.id || undefined}>
              <span className="sv-q-n">{i + 1}</span>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><strong style={{ fontSize: 15 }}>{q.title}</strong><Pill>{q.type === 'multi' ? 'Several answers' : q.type === 'text' ? 'Typed answer' : 'One answer'}</Pill></span>
                <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{q.text}</span>
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{q.options.slice(0, 8).map((o) => <span key={o} className="sv-chip is-line">{shortLabel(o)}</span>)}</span>
                <span className="crm-cell-sub">{q.answers.toLocaleString('en-IN')} answers so far</span>
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setSelId(q.id)}>{d.canEdit ? 'Edit' : 'View'}</button>
                {d.canEdit && (
                  <span style={{ display: 'flex', gap: 4 }}>
                    <button type="button" className="crm-btn is-secondary is-sm" style={{ width: 36, padding: 0 }} aria-label={`Move ${q.title} up`} disabled={busy || i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} aria-hidden /></button>
                    <button type="button" className="crm-btn is-secondary is-sm" style={{ width: 36, padding: 0 }} aria-label={`Move ${q.title} down`} disabled={busy || i === d.asked.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} aria-hidden /></button>
                  </span>
                )}
              </span>
            </div>
          ))}

          <div className="crm-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <strong style={{ flex: 1 }}>Retired questions ({d.retired.length})</strong>
              <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setShowRetired((v) => !v)}>{showRetired ? 'Hide' : 'Show'}</button>
            </span>
            <span className="crm-sub" style={{ fontSize: 13 }}>From the older questionnaire. Their answers are kept under Responses › Older questionnaire. Swapping one in replaces one of the six, so the app always asks six.</span>
            {showRetired && (
              <ul className="crm-list">
                {d.retired.map((q) => (
                  <li key={q.id}>
                    <span style={{ flex: 1, minWidth: 0 }}><span style={{ fontWeight: 600, fontSize: 14 }}>{q.title}</span><div className="crm-cell-sub">{q.answers.toLocaleString('en-IN')} older answers</div></span>
                    {d.canEdit && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setSwapIn(q)}>Swap in</button>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {sel && <QuestionEditor key={sel.id} q={sel} canEdit={d.canEdit} n={d.asked.findIndex((x) => x.id === sel.id) + 1} onSaved={(m) => { showToast(m); void data.reload(); }} showToast={showToast} />}
      </div>
      {swapIn && <SwapModal bringIn={swapIn} asked={d.asked} onClose={() => setSwapIn(null)} onDone={(m) => { setSwapIn(null); showToast(m); void data.reload(); }} />}
    </>
  );
}

function QuestionEditor({ q, n, canEdit, onSaved, showToast }: { q: QRow; n: number; canEdit: boolean; onSaved: (m: string) => void; showToast: (m: string) => void }) {
  const [text, setText] = useState(q.text);
  const [type, setType] = useState(q.type);
  const [newOpt, setNewOpt] = useState('');
  const [adding, setAdding] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const dirty = text.trim() !== q.text || type !== q.type || adding.length > 0;
  const save = async () => {
    setBusy(true);
    try {
      await crm.put(`/api/v1/surveys/questions/${q.id}`, { text: text.trim() !== q.text ? text.trim() : undefined, type: type !== q.type ? type : undefined, addOptions: adding.length ? adding : undefined });
      setAdding([]);
      onSaved('Question saved. Phones pick it up at their next sync.');
    } catch (e) { showToast(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <aside className="crm-card grow-2" aria-label="Edit question" style={{ flexBasis: 400, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}><h2 className="crm-h2" style={{ flex: 1 }}>Question {n}</h2><span className="crm-cell-sub">{q.answers.toLocaleString('en-IN')} answers so far</span></span>
      <label className="crm-field">What the agent reads out
        <textarea className="crm-textarea" rows={4} value={text} disabled={!canEdit} onChange={(e) => setText(e.target.value)} />
      </label>
      {q.type !== 'text' && (
        <fieldset className="sv-fieldset" disabled={!canEdit}>
          <legend>Answer type</legend>
          <label className="sv-opt"><input type="radio" name="qtype" checked={type === 'single'} onChange={() => setType('single')} />One answer</label>
          <label className="sv-opt"><input type="radio" name="qtype" checked={type === 'multi'} onChange={() => setType('multi')} />Several answers</label>
        </fieldset>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Answer choices</span>
        {q.options.map((o) => <span key={o} className="sv-chip is-line" style={{ alignSelf: 'flex-start' }}>{o}</span>)}
        {adding.map((o) => <span key={o} className="sv-chip" style={{ alignSelf: 'flex-start' }}>{o} (new)</span>)}
        {canEdit && (
          <span style={{ display: 'flex', gap: 6 }}>
            <label className="crm-sr" htmlFor="new-opt">New choice</label>
            <input id="new-opt" className="crm-input" value={newOpt} onChange={(e) => setNewOpt(e.target.value)} placeholder="Add a choice" />
            <button type="button" className="crm-btn is-secondary" disabled={!newOpt.trim()} onClick={() => { setAdding((a) => [...a, newOpt.trim()]); setNewOpt(''); }}>Add</button>
          </span>
        )}
        <span className="crm-cell-sub">Existing choices can&apos;t be renamed or removed here, because past answers are stored by their wording and would stop being counted.</span>
      </div>
      <div style={{ background: 'var(--grey-soft)', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="crm-cell-sub" style={{ fontWeight: 600 }}>How it looks in the app</span>
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--border)', padding: 14, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 340 }}>
          <span className="crm-cell-sub">{n} / 6</span>
          <strong style={{ fontSize: 15, lineHeight: 1.4 }}>{text}</strong>
          {[...q.options, ...adding].slice(0, 3).map((o) => <span key={o} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '9px 12px', fontSize: 13 }}>{shortLabel(o)}</span>)}
        </div>
      </div>
      {canEdit && <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button type="button" className="crm-btn" disabled={!dirty || busy} onClick={save}>Save question</button></div>}
    </aside>
  );
}

function SwapModal({ bringIn, asked, onClose, onDone }: { bringIn: QRow; asked: QRow[]; onClose: () => void; onDone: (m: string) => void }) {
  const [retireId, setRetireId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true); setError('');
    try {
      await crm.post('/api/v1/surveys/questions/swap', { retireId, bringInId: bringIn.id });
      onDone(`“${bringIn.title}” is now asked instead of “${asked.find((q) => q.id === retireId)?.title}”.`);
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Swap a question in" onClose={onClose} actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="crm-btn" disabled={!retireId || busy} onClick={go}>Swap</button>
    </>}>
      <span style={{ fontSize: 14 }}>Bring in <strong>{bringIn.title}</strong>. The app keeps asking six, so pick the one it replaces. Answers to the replaced question are kept.</span>
      <fieldset className="sv-fieldset">
        <legend>Replace</legend>
        {asked.map((q) => (
          <label key={q.id} className="sv-opt"><input type="radio" name="retire" checked={retireId === q.id} onChange={() => setRetireId(q.id)} />{q.title} <span className="crm-cell-sub" style={{ display: 'inline' }}>· {q.answers} answers</span></label>
        ))}
      </fieldset>
      {error && <div className="crm-error" role="alert">{error}</div>}
    </Modal>
  );
}
