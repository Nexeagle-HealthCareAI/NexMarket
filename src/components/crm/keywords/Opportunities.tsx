'use client';

import { useState } from 'react';
import { crm } from '@/lib/sync/api-client';
import { Empty, ErrorBox, friendlyError, Skeleton, useLoader } from '@/components/crm/ui';
import { ActionModal, type ActionDraft } from './ActionModal';
import { INTENT_LABEL, LANG_LABEL, num, peakText, positionText, SUGGEST_BUTTON, type OppRes, type OppRow, type Person } from './shared';

/** Topics ranked by demand × value × how much the hospital is missing, with the next step for each. */
export function Opportunities({ people, editable, onOpen, toast }: { people: Person[]; editable: boolean; onOpen: (id: string) => void; toast: (m: string) => void }) {
  const [dept, setDept] = useState('');
  const [district, setDistrict] = useState('');
  const [lang, setLang] = useState('');
  const [intent, setIntent] = useState('');
  const [draft, setDraft] = useState<ActionDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const q = new URLSearchParams();
  if (dept) q.set('department', dept);
  if (district) q.set('district', district);
  if (lang) q.set('lang', lang);
  if (intent) q.set('intent', intent);
  const data = useLoader(() => crm.get<OppRes>(`/api/v1/keywords/opportunities?${q}`), [dept, district, lang, intent]);
  const d = data.data;

  const act = async (r: OppRow) => {
    if (r.suggestKind === 'page') {
      setBusy(r.id);
      try { await crm.post(`/api/v1/keywords/topics/${r.id}/brief`); toast('Brief written. It’s in the content plan.'); void data.reload(); }
      catch (e) { toast(friendlyError(e)); } finally { setBusy(null); }
      return;
    }
    const titles: Record<string, string> = { ad: `Ad group: ${r.name}`, camp: `Camp: ${r.name}`, post: `Post: ${r.name}`, broadcast: `Broadcast: ${r.name}` };
    setDraft({ topicId: r.id, topicName: r.name, kind: r.suggestKind, title: titles[r.suggestKind] ?? r.name });
  };

  return (
    <div className="kw-stack">
      {data.error && <ErrorBox message={data.error} onRetry={data.reload} />}
      {!d ? <Skeleton h={110} /> : (
        <div className="kw-kpis">
          <div className="crm-card kw-kpi"><span>Searches a month</span><strong>{num(d.kpis.demand)}</strong><small>{d.kpis.topics} topics{district ? ` · ${district}` : ''}</small></div>
          <div className="crm-card kw-kpi"><span>Found by you</span><strong>{d.kpis.foundPct == null ? '—' : `${d.kpis.foundPct}%`}</strong><small>of those searches show you on Google’s first page</small></div>
          <div className="crm-card kw-kpi"><span>Patients from topics, 90 days</span><strong>{d.kpis.came}</strong><small>came to the hospital · {d.kpis.admitted} admitted</small></div>
          <div className="crm-card kw-kpi"><span>Peak coming</span><strong className="kw-kpi-sm">{d.kpis.nextPeak ?? 'None in the next 2 months'}</strong><small>{d.kpis.nextPeak ? `searches rise in ${d.kpis.peakInMonths === 1 ? 'about a month' : 'about 2 months'}` : 'from Keyword Planner’s monthly figures'}</small></div>
        </div>
      )}

      <section className="crm-card kw-card" aria-labelledby="kw-opp">
        <div className="kw-card-head">
          <div>
            <h2 id="kw-opp" className="crm-h2">Top opportunities</h2>
            <p className="crm-sub">Ranked by searches × how often that department’s enquiries become patients × how much you are missing.</p>
          </div>
          <div className="kw-filters">
            <label className="crm-field">District
              <select className="crm-select" value={district} onChange={(e) => setDistrict(e.target.value)}>
                <option value="">All districts</option>
                {d?.districts.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
            <label className="crm-field">Language
              <select className="crm-select" value={lang} onChange={(e) => setLang(e.target.value)}>
                <option value="">All</option>
                {Object.entries(LANG_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="crm-field">Intent
              <select className="crm-select" value={intent} onChange={(e) => setIntent(e.target.value)}>
                <option value="">All</option>
                {Object.entries(INTENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>
        </div>
        {d && d.departments.length > 0 && (
          <div className="crm-chips kw-chips" role="group" aria-label="Department">
            <button type="button" className="crm-chip" aria-pressed={dept === ''} onClick={() => setDept('')}>All</button>
            {d.departments.map((x) => <button key={x} type="button" className="crm-chip" aria-pressed={dept === x} onClick={() => setDept(x)}>{x}</button>)}
          </div>
        )}
        {!d ? <Skeleton h={300} /> : d.topics.length === 0 ? (
          <Empty title="No topics with searches yet">Connect Search Console, Business Profile or Google Ads in Google → Setup, then press Refresh. Keyword Planner adds search volumes once Google Ads is connected.</Empty>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table kw-table">
              <thead><tr><th scope="col">Topic</th><th scope="col">Searches / month</th><th scope="col">You today</th><th scope="col">Score</th><th scope="col">Next step</th></tr></thead>
              <tbody>
                {d.topics.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <button type="button" className="kw-topic-link" onClick={() => onOpen(r.id)}>{r.name}</button>
                      <span className="kw-meta">{[r.department, INTENT_LABEL[r.intent], r.example].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td>
                      <strong>{num(r.demand)}</strong>
                      <span className="kw-meta">{r.trend != null ? `${r.trend > 0 ? 'Up' : r.trend < 0 ? 'Down' : 'Flat'} ${Math.abs(r.trend)}% on last year` : r.peakMonths ? `Peaks ${peakText(r.peakMonths)}` : `${r.keywords} keywords`}</span>
                    </td>
                    <td>
                      {positionText(r.bestPosition)}
                      <span className="kw-meta">{r.came > 0 || r.enquiries > 0 ? `${r.enquiries} enquiries · ${r.came} came, 90 days` : 'No patients tracked yet'}</span>
                    </td>
                    <td>
                      <span className="kw-score"><span className="kw-bar" aria-hidden><span style={{ width: `${r.score}%` }} /></span><strong>{r.score}</strong></span>
                    </td>
                    <td>
                      <div className="kw-next">
                        <span>{r.suggest}</span>
                        {editable && <button type="button" className="crm-btn is-sm is-soft" disabled={busy === r.id} onClick={() => void act(r)}>{busy === r.id ? 'Writing…' : SUGGEST_BUTTON[r.suggestKind]}</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {draft && <ActionModal draft={draft} people={people} onClose={() => setDraft(null)} onSaved={(m) => { setDraft(null); toast(m); void data.reload(); }} />}
    </div>
  );
}
