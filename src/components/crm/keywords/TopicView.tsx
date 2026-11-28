'use client';

import { useState } from 'react';
import { ArrowLeft, EyeOff, Pencil, Plus, Sparkles } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { ErrorBox, friendlyError, Modal, rupees, Skeleton, useLoader } from '@/components/crm/ui';
import { ActionModal, type ActionDraft } from './ActionModal';
import {
  INTENT_LABEL, KIND_SHORT, LANG_LABEL, monthName, num, peakText, positionText, SOURCE_LABEL, STAGE_LABEL,
  type ActionKind, type KwActionRow, type Person,
} from './shared';

interface TopicRes {
  topic: {
    id: string; name: string; department?: string | null; intent: string; status: string; ownerId?: string | null; ownerName?: string | null;
    matchTerms: string; note?: string | null; score: number; demand: number; valuePct: number; gapPct: number; bestPosition?: number | null;
    peakMonths?: string | null; isCustom: boolean; scoredAt?: string | null;
  };
  suggest?: { kind: ActionKind; text: string } | null;
  outcome: { enquiries: number; came: number; admitted: number };
  bid?: { low: number; high: number } | null;
  monthly: { month: string; searches: number }[];
  areas: { district: string; searches: number }[];
  keywords: {
    id: string; text: string; lang: string; intent: string; district?: string | null; demand: number; estimated: boolean; position?: number | null;
    impressions: number; clicks: number; gbpViews: number; adClicks: number; adCost: number; chatCount: number; sources: string[]; manual: boolean;
  }[];
  actions: KwActionRow[];
}

const STATUS_LABEL: Record<string, string> = { new: 'New', planned: 'Planned', active: 'Active', dismissed: 'Not for us' };

/** One topic: how many search, in which words and places, where the hospital stands, and what was done and what it brought. */
export function TopicView({ id, people, editable, topics, onBack, toast }: {
  id: string; people: Person[]; editable: boolean; topics: { id: string; name: string }[]; onBack: () => void; toast: (m: string) => void;
}) {
  const data = useLoader(() => crm.get<TopicRes>(`/api/v1/keywords/topics/${id}`), [id]);
  const [draft, setDraft] = useState<ActionDraft | null>(null);
  const [editAction, setEditAction] = useState<KwActionRow | null>(null);
  const [editTopic, setEditTopic] = useState(false);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const d = data.data;

  const brief = async () => {
    setBusy(true);
    try { await crm.post(`/api/v1/keywords/topics/${id}/brief`); toast('Brief written. It’s in the content plan.'); void data.reload(); }
    catch (e) { toast(friendlyError(e)); } finally { setBusy(false); }
  };
  const moveKeyword = async (kid: string, topicId: string) => {
    try { await crm.put(`/api/v1/keywords/list/${kid}`, topicId ? { topicId } : { clearTopic: true }); toast('Moved.'); void data.reload(); }
    catch (e) { toast(friendlyError(e)); }
  };
  const hide = async (kid: string) => {
    try { await crm.put(`/api/v1/keywords/list/${kid}`, { hidden: true }); toast('Hidden. Find it under All keywords → Hidden.'); void data.reload(); }
    catch (e) { toast(friendlyError(e)); }
  };

  if (data.error) return <ErrorBox message={data.error} onRetry={data.reload} />;
  if (!d) return <Skeleton h={480} />;
  const t = d.topic;
  const max = Math.max(1, ...d.monthly.map((m) => m.searches));
  const peaks = new Set((t.peakMonths ?? '').split(',').filter(Boolean).map(Number));
  const kws = d.keywords.filter((k) => !filter || k.text.includes(filter.toLowerCase()));
  const areaMax = Math.max(1, ...d.areas.map((a) => a.searches));

  return (
    <div className="kw-stack">
      <div className="kw-topic-head">
        <button type="button" className="wa-link kw-back" onClick={onBack}><ArrowLeft size={14} aria-hidden /> All opportunities</button>
        <div className="kw-topic-title">
          <div>
            <h2 className="kw-h1">{t.name}</h2>
            <div className="kw-tags">
              {t.department && <span className="kw-tag is-dept">{t.department}</span>}
              <span className="kw-tag is-intent">{INTENT_LABEL[t.intent] ?? t.intent}</span>
              <span className="kw-tag">{STATUS_LABEL[t.status] ?? t.status}</span>
              <span className="kw-tag">{d.keywords.length} keywords · {[...new Set(d.keywords.map((k) => LANG_LABEL[k.lang] ?? k.lang))].join(', ') || 'no words yet'}</span>
              {t.ownerName && <span className="kw-tag">Owner: {t.ownerName}</span>}
            </div>
          </div>
          {editable && (
            <div className="kw-actions-row">
              <button type="button" className="crm-btn is-secondary" onClick={() => setEditTopic(true)}><Pencil size={14} aria-hidden /> Edit topic</button>
              <button type="button" className="crm-btn is-secondary" disabled={busy} onClick={() => void brief()}><Sparkles size={14} aria-hidden /> {busy ? 'Writing…' : 'Write a page brief'}</button>
              <button type="button" className="crm-btn" onClick={() => setDraft({ topicId: t.id, topicName: t.name, kind: d.suggest?.kind ?? 'post', title: t.name })}><Plus size={14} aria-hidden /> Add an action</button>
            </div>
          )}
        </div>
        {d.suggest && <p className="kw-suggest"><strong>Next step:</strong> {d.suggest.text}</p>}
      </div>

      <div className="kw-kpis">
        <div className="crm-card kw-kpi"><span>Searches a month</span><strong>{num(t.demand)}</strong><small>{d.areas.slice(0, 3).map((a) => `${a.district} ${num(a.searches)}`).join(' · ') || 'Across Bihar'}</small></div>
        <div className="crm-card kw-kpi"><span>Your best position</span><strong>{t.bestPosition == null ? '—' : t.bestPosition.toFixed(0)}</strong><small>{positionText(t.bestPosition)} on Google</small></div>
        <div className="crm-card kw-kpi"><span>Ad cost per click</span><strong>{d.bid ? `${rupees(d.bid.low)}–${rupees(d.bid.high)}` : '—'}</strong><small>{d.bid ? 'Keyword Planner’s top-of-page range' : 'Comes with Keyword Planner'}</small></div>
        <div className="crm-card kw-kpi"><span>Patients, 90 days</span><strong>{d.outcome.came} came · {d.outcome.admitted} admitted</strong><small>from {d.outcome.enquiries} enquiries naming it or its links</small></div>
      </div>

      <div className="kw-two">
        <section className="crm-card kw-card kw-pad" aria-labelledby="kw-season">
          <h3 id="kw-season" className="crm-h2">{t.peakMonths ? `Searches peak in ${peakText(t.peakMonths)}` : 'Searches by month'}</h3>
          {d.monthly.length === 0 ? <p className="crm-sub">Monthly figures come from Keyword Planner once Google Ads is connected.</p> : (
            <>
              <div className="kw-bars" role="img" aria-label={`Monthly searches for the last ${d.monthly.length} months`}>
                {d.monthly.map((m) => {
                  const mo = Number(m.month.slice(5, 7));
                  return (
                    <div key={m.month} className="kw-bar-col">
                      <span className="kw-bar-v">{m.searches >= 1000 ? `${(m.searches / 1000).toFixed(1)}k` : m.searches}</span>
                      <span className={`kw-bar-fill${peaks.has(mo) ? ' is-peak' : ''}`} style={{ height: `${Math.max(2, Math.round((m.searches / max) * 140))}px` }} />
                      <span className="kw-bar-m">{monthName(mo)}</span>
                    </div>
                  );
                })}
              </div>
              {t.peakMonths && <p className="crm-sub" style={{ margin: 0 }}>Publish pages and start ads a month before the peak.</p>}
            </>
          )}
        </section>
        <section className="crm-card kw-card kw-pad" aria-labelledby="kw-where">
          <h3 id="kw-where" className="crm-h2">Where people search</h3>
          {d.areas.length === 0 ? <p className="crm-sub">District figures come from Keyword Planner (Refresh volumes).</p> : (
            <ul className="kw-area-list">
              {d.areas.map((a) => (
                <li key={a.district}>
                  <span>{a.district}</span>
                  <span className="kw-bar is-wide" aria-hidden><span style={{ width: `${Math.round((a.searches / areaMax) * 100)}%` }} /></span>
                  <strong>{num(a.searches)}</strong>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="crm-card kw-card" aria-labelledby="kw-words">
        <div className="kw-card-head">
          <h3 id="kw-words" className="crm-h2">Words people use</h3>
          <label className="crm-field kw-inline">Filter
            <input className="crm-input" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="e.g. pathri" />
          </label>
        </div>
        <div className="crm-table-wrap">
          <table className="crm-table kw-table">
            <thead><tr><th scope="col">Keyword</th><th scope="col">Language</th><th scope="col">Searches / month</th><th scope="col">Your position</th><th scope="col">Seen in</th>{editable && <th scope="col"><span className="kw-sr">Change</span></th>}</tr></thead>
            <tbody>
              {kws.map((k) => (
                <tr key={k.id}>
                  <td><strong className="kw-word">{k.text}</strong>{k.district && <span className="kw-meta">{k.district}</span>}</td>
                  <td>{LANG_LABEL[k.lang] ?? k.lang}</td>
                  <td>{k.demand > 0 ? <>{num(k.demand)}{k.estimated && <span className="kw-meta">estimated</span>}</> : '—'}</td>
                  <td>{k.position == null ? '—' : k.position.toFixed(0)}</td>
                  <td className="kw-meta-cell">{k.sources.filter((s) => s !== 'manual').map((s) => SOURCE_LABEL[s] ?? s).join(', ')}{k.chatCount > 0 ? ` (${k.chatCount} messages)` : ''}</td>
                  {editable && (
                    <td>
                      <div className="kw-row-tools">
                        <label className="kw-sr" htmlFor={`mv-${k.id}`}>Move “{k.text}” to topic</label>
                        <select id={`mv-${k.id}`} className="crm-select kw-mini" value={t.id} onChange={(e) => void moveKeyword(k.id, e.target.value)}>
                          {topics.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          <option value="">Let NexMarket decide</option>
                        </select>
                        <button type="button" className="kw-icon" aria-label={`Hide “${k.text}”`} title="Hide" onClick={() => void hide(k.id)}><EyeOff size={15} aria-hidden /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {kws.length === 0 && <tr><td colSpan={6} className="crm-sub">No keywords yet. Add words that belong here in Edit topic, or add seed words under All keywords.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="crm-card kw-card kw-pad" aria-labelledby="kw-done">
        <h3 id="kw-done" className="crm-h2">Actions and what they brought</h3>
        {d.actions.length === 0 ? <p className="crm-sub">Nothing planned yet. Write a page brief or add an action.</p> : (
          <ul className="kw-action-list">
            {d.actions.map((a) => (
              <li key={a.id}>
                <span className="kw-action-main">
                  <span className={`kw-kind is-${a.kind}`}>{KIND_SHORT[a.kind]}</span>
                  <span><strong>{a.title}</strong><span className="kw-meta">{STAGE_LABEL[a.stage]}{a.ownerName ? ` · ${a.ownerName}` : ''}{a.dueOn ? ` · due ${a.dueOn}` : ''}{a.spend ? ` · ${rupees(a.spend)} spent` : ''}</span></span>
                </span>
                <span className="kw-action-result">
                  {a.enquiries != null ? <>{a.enquiries} enquiries · {a.came} came{a.costPerPatient != null && <> · <strong>{rupees(a.costPerPatient)} per patient</strong></>}</> : <span className="crm-sub">Add a tracked link or page to count its patients</span>}
                  {editable && <button type="button" className="crm-btn is-sm is-secondary" onClick={() => setEditAction(a)}>Edit</button>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {draft && <ActionModal draft={draft} people={people} onClose={() => setDraft(null)} onSaved={(m) => { setDraft(null); toast(m); void data.reload(); }} />}
      {editAction && <ActionModal action={{ ...editAction, topicName: t.name }} people={people} onClose={() => setEditAction(null)} onSaved={(m) => { setEditAction(null); toast(m); void data.reload(); }} />}
      {editTopic && <TopicModal topic={t} people={people} onClose={() => setEditTopic(false)} onSaved={(m) => { setEditTopic(false); toast(m); void data.reload(); }} />}
    </div>
  );
}

/** Adds a topic, or edits one: its name, department, intent, status, owner and the words that place keywords in it. */
export function TopicModal({ topic, people, onClose, onSaved }: {
  topic?: TopicRes['topic']; people: Person[]; onClose: () => void; onSaved: (msg: string, id?: string) => void;
}) {
  const [name, setName] = useState(topic?.name ?? '');
  const [dept, setDept] = useState(topic?.department ?? '');
  const [intent, setIntent] = useState(topic?.intent ?? 'visit');
  const [status, setStatus] = useState(topic?.status ?? 'new');
  const [owner, setOwner] = useState(topic?.ownerId ?? '');
  const [terms, setTerms] = useState(topic?.matchTerms ?? '');
  const [note, setNote] = useState(topic?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const body = { name, department: dept, intent, status, ownerId: owner, matchTerms: terms, note };
      if (topic) { await crm.put(`/api/v1/keywords/topics/${topic.id}`, body); onSaved('Saved. Keywords were regrouped.'); }
      else { const r = await crm.post<{ id: string }>('/api/v1/keywords/topics', body); onSaved('Topic added.', r.id); }
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={topic ? 'Edit topic' : 'New topic'} onClose={onClose} wide
      actions={<><button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button><button type="button" className="crm-btn" disabled={busy || name.trim().length < 3} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="kw-form">
        <label className="crm-field">Name<input className="crm-input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cataract surgery" /></label>
        <div className="kw-form-row">
          <label className="crm-field">Department<input className="crm-input" value={dept} maxLength={60} onChange={(e) => setDept(e.target.value)} /></label>
          <label className="crm-field">Intent
            <select className="crm-select" value={intent} onChange={(e) => setIntent(e.target.value)}>{Object.entries(INTENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          {topic && (
            <label className="crm-field">Status
              <select className="crm-select" value={status} onChange={(e) => setStatus(e.target.value)}>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </label>
          )}
          <label className="crm-field">Owner
            <select className="crm-select" value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">Nobody yet</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </label>
        </div>
        <label className="crm-field">Words that belong here <span className="crm-sub">One per line, in any language: English, Hinglish, Hindi, Bangla. A keyword containing one of them joins this topic.</span>
          <textarea className="crm-textarea" rows={7} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder={'cataract\nmotiyabind\nमोतियाबिंद'} />
        </label>
        <label className="crm-field">Note<textarea className="crm-textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {err && <p className="gg-err" role="alert" style={{ margin: 0 }}>{err}</p>}
      </div>
    </Modal>
  );
}
