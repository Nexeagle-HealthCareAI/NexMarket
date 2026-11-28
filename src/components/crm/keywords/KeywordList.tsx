'use client';

import { useState } from 'react';
import { crm } from '@/lib/sync/api-client';
import { Pager } from '@/components/crm/Pager';
import { ErrorBox, friendlyError, Modal, Skeleton, useLoader } from '@/components/crm/ui';
import { INTENT_LABEL, LANG_LABEL, num, SOURCE_LABEL } from './shared';

interface ListRes {
  total: number; page: number; pageSize: number;
  items: { id: string; text: string; lang: string; intent: string; district?: string | null; topicId?: string | null; topic?: string | null; demand: number; estimated: boolean; position?: number | null; sources: string[]; chatCount: number; hidden: boolean }[];
  topics: { id: string; name: string }[];
}

/** Every keyword NexMarket has seen, to search, place in a topic, hide, or add new ones. */
export function KeywordList({ editable, toast }: { editable: boolean; toast: (m: string) => void }) {
  const [q, setQ] = useState('');
  const [view, setView] = useState<'all' | 'unassigned' | 'hidden'>('all');
  const [lang, setLang] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const params = new URLSearchParams({ page: String(page) });
  if (q.trim()) params.set('q', q.trim());
  if (lang) params.set('lang', lang);
  if (view === 'unassigned') params.set('unassigned', 'true');
  if (view === 'hidden') params.set('hidden', 'true');
  const data = useLoader(() => crm.get<ListRes>(`/api/v1/keywords/list?${params}`), [q, lang, view, page]);
  const d = data.data;

  const update = async (id: string, body: object, msg: string) => {
    try { await crm.put(`/api/v1/keywords/list/${id}`, body); toast(msg); void data.reload(); } catch (e) { toast(friendlyError(e)); }
  };

  return (
    <section className="crm-card kw-card" aria-labelledby="kw-all">
      <div className="kw-card-head">
        <div>
          <h2 id="kw-all" className="crm-h2">All keywords</h2>
          <p className="crm-sub">{d ? `${num(d.total)} keywords` : ' '}. Keywords join a topic when they contain one of its words; you can place them yourself.</p>
        </div>
        {editable && <button type="button" className="crm-btn" onClick={() => setAdding(true)}>Add seed words</button>}
      </div>
      <div className="kw-filters is-row">
        <label className="crm-field kw-inline">Search<input className="crm-input" type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Any word" /></label>
        <label className="crm-field kw-inline">Language
          <select className="crm-select" value={lang} onChange={(e) => { setLang(e.target.value); setPage(1); }}><option value="">All</option>{Object.entries(LANG_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <div className="crm-chips" role="group" aria-label="Show">
          {([['all', 'All'], ['unassigned', 'Not in a topic'], ['hidden', 'Hidden']] as const).map(([k, l]) => (
            <button key={k} type="button" className="crm-chip" aria-pressed={view === k} onClick={() => { setView(k); setPage(1); }}>{l}</button>
          ))}
        </div>
      </div>
      {data.error && <ErrorBox message={data.error} onRetry={data.reload} />}
      {!d ? <Skeleton h={300} /> : (
        <>
          <div className="crm-table-wrap">
            <table className="crm-table kw-table">
              <thead><tr><th scope="col">Keyword</th><th scope="col">Topic</th><th scope="col">Language · intent</th><th scope="col">Searches / month</th><th scope="col">Position</th><th scope="col">Seen in</th>{editable && <th scope="col"><span className="kw-sr">Hide</span></th>}</tr></thead>
              <tbody>
                {d.items.map((k) => (
                  <tr key={k.id}>
                    <td><strong className="kw-word">{k.text}</strong>{k.district && <span className="kw-meta">{k.district}</span>}</td>
                    <td>
                      {editable ? (
                        <>
                          <label className="kw-sr" htmlFor={`kt-${k.id}`}>Topic for “{k.text}”</label>
                          <select id={`kt-${k.id}`} className="crm-select kw-mini" value={k.topicId ?? ''} onChange={(e) => void update(k.id, e.target.value ? { topicId: e.target.value } : { clearTopic: true }, 'Placed.')}>
                            <option value="">{k.topicId ? 'Let NexMarket decide' : 'No topic'}</option>
                            {d.topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </>
                      ) : (k.topic ?? '—')}
                    </td>
                    <td>{LANG_LABEL[k.lang] ?? k.lang} · {INTENT_LABEL[k.intent] ?? k.intent}</td>
                    <td>{k.demand > 0 ? <>{num(k.demand)}{k.estimated && <span className="kw-meta">estimated</span>}</> : '—'}</td>
                    <td>{k.position == null ? '—' : k.position.toFixed(0)}</td>
                    <td className="kw-meta-cell">{k.sources.filter((s) => s !== 'manual').map((s) => SOURCE_LABEL[s] ?? s).join(', ')}{k.chatCount ? ` (${k.chatCount} messages)` : ''}</td>
                    {editable && <td><button type="button" className="crm-btn is-sm is-secondary" onClick={() => void update(k.id, { hidden: !k.hidden }, k.hidden ? 'Shown again.' : 'Hidden.')}>{k.hidden ? 'Show' : 'Hide'}</button></td>}
                  </tr>
                ))}
                {d.items.length === 0 && <tr><td colSpan={7} className="crm-sub">Nothing here.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pager page={page} pages={Math.max(1, Math.ceil(d.total / d.pageSize))} total={d.total} size={d.pageSize} onPage={setPage} noun="keywords" />
        </>
      )}
      {adding && d && <SeedModal topics={d.topics} onClose={() => setAdding(false)} onSaved={(m) => { setAdding(false); toast(m); void data.reload(); }} />}
    </section>
  );
}

function SeedModal({ topics, onClose, onSaved }: { topics: { id: string; name: string }[]; onClose: () => void; onSaved: (m: string) => void }) {
  const [text, setText] = useState('');
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await crm.post<{ added: number; total: number }>('/api/v1/keywords/list', { text, topicId: topic || null });
      onSaved(`${r.added} new keyword${r.added === 1 ? '' : 's'} added. Refresh volumes to get their searches.`);
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add seed words" onClose={onClose}
      actions={<><button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button><button type="button" className="crm-btn" disabled={busy || !text.trim()} onClick={() => void save()}>{busy ? 'Adding…' : 'Add'}</button></>}>
      <div className="kw-form">
        <label className="crm-field">Keywords <span className="crm-sub">One per line, as people would search: “pathri ka operation purnia”, “पथरी का इलाज”.</span>
          <textarea className="crm-textarea" rows={8} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <label className="crm-field">Put them in
          <select className="crm-select" value={topic} onChange={(e) => setTopic(e.target.value)}><option value="">The topic their words match</option>{topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        </label>
        {err && <p className="gg-err" role="alert" style={{ margin: 0 }}>{err}</p>}
      </div>
    </Modal>
  );
}
