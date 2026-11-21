'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Check, Copy, Download, GitPullRequestArrow, KeyRound, Languages, Link2, Plus, Search, Send, Share2, Sparkles, Webhook, X } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { ErrorBox, Modal, Pill, Skeleton } from '@/components/crm/ui';
import { KIND, dayText, errText, when, type Doc, type Kind } from './shared';

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
function Change({ now, before }: { now: number; before: number }) {
  if (!before && !now) return null;
  if (!before) return <span className="ws-up">new</span>;
  const pct = Math.round(((now - before) / before) * 100);
  if (Math.abs(pct) < 5) return <span className="crm-sub">same</span>;
  return pct > 0 ? <span className="ws-up"><ArrowUpRight size={12} aria-hidden />{pct}%</span> : <span className="ws-down"><ArrowDownRight size={12} aria-hidden />{-pct}%</span>;
}

interface InsightRow { path: string; itemId?: string | null; title?: string | null; type?: Kind | null; clicks: number; prevClicks: number; impressions: number; position: number; views: number; enquiries: number; admitted: number; calls: number; whatsapp: number; bookings: number }
interface Fix { kind: 'losing' | 'almost' | 'competing'; path: string; title: string; detail: string; paths?: string[] | null; query?: string | null; itemId?: string | null }
interface Insights { period: { from: string; to: string }; searchConsole: { connected: boolean; error?: string | null }; analytics: boolean; rows: InsightRow[]; fixes: Fix[] }

/** Search & results: how each page does in Google, and which pages bring patients. */
export function SearchTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [d, setD] = useState<Insights | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sort, setSort] = useState<keyof InsightRow>('clicks');
  useEffect(() => { crm.get<Insights>('/api/v1/website/insights').then(setD).catch((e) => setErr(errText(e))); }, []);
  if (err) return <ErrorBox message={err} />;
  if (!d) return <Skeleton h={360} />;
  const rows = [...d.rows].sort((a, b) => Number(b[sort] ?? 0) - Number(a[sort] ?? 0));
  const anyLeads = d.rows.some((r) => r.enquiries || r.calls || r.whatsapp || r.bookings);
  const th = (k: keyof InsightRow, label: string) => <th><button type="button" className="ws-sort" aria-pressed={sort === k} onClick={() => setSort(k)}>{label}</button></th>;
  const FIXK: Record<Fix['kind'], string> = { losing: 'Losing visitors', almost: 'Almost on page 1', competing: 'Competing pages' };
  return (
    <>
      <p className="crm-sub ws-kind-help">The last 28 days with complete figures ({dayText(d.period.from)} to {dayText(d.period.to)}), against the 28 before. Google figures come from Search Console{d.analytics ? ', page views from Google Analytics' : ''}; enquiries and admissions from the Leads inbox.</p>
      {!d.searchConsole.connected && <div className="ws-banner">{d.searchConsole.error ?? 'Search Console isn\'t connected.'} The Google columns stay empty until it is.</div>}
      {d.searchConsole.connected && d.searchConsole.error && <div className="ws-banner">{d.searchConsole.error}</div>}
      {!anyLeads && <div className="ws-banner">No enquiries or clicks are counted per page yet. A developer switches this on in the website&apos;s build (see Developer → Counting per page).</div>}
      <section className="crm-card ws-card">
        <h2 className="ws-h2">What to work on first</h2>
        {d.fixes.length === 0 ? <p className="crm-sub" style={{ margin: 0 }}>{d.searchConsole.connected ? 'Nothing stands out right now.' : 'Shows once Search Console is connected.'}</p> : (
          <ul className="ws-fixes">
            {d.fixes.slice(0, 12).map((f, i) => (
              <li key={i} className={`is-${f.kind}`}>
                <div><Pill tone={f.kind === 'losing' ? 'bad' : f.kind === 'almost' ? 'info' : 'warn'}>{FIXK[f.kind]}</Pill> <strong className="ws-url">{f.path}</strong></div>
                <p>{f.detail}</p>
                {f.itemId && <button type="button" className="ws-link" onClick={() => onOpen(f.itemId!)}>Open it</button>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="crm-card ws-card">
        <h2 className="ws-h2">Every page</h2>
        {rows.length === 0 ? <p className="crm-sub" style={{ margin: 0 }}>No figures yet.</p> : (
          <div className="crm-table-wrap"><table className="crm-table ws-insights">
            <thead><tr><th>Page</th>{th('clicks', 'Visits from Google')}{th('impressions', 'Shown in Google')}{th('position', 'Place')}{d.analytics && th('views', 'Page views')}{th('enquiries', 'Enquiries')}{th('admitted', 'Admitted')}{th('calls', 'Calls')}{th('whatsapp', 'WhatsApp')}{th('bookings', 'Bookings')}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.path}>
                <td>{r.itemId ? <button type="button" className="ws-title" onClick={() => onOpen(r.itemId!)}>{r.title}</button> : <span className="ws-url">{r.path}</span>}{r.itemId && <div className="crm-sub ws-url">{r.path}</div>}</td>
                <td className="ws-num">{fmt(r.clicks)} <Change now={r.clicks} before={r.prevClicks} /></td>
                <td className="ws-num">{fmt(r.impressions)}</td>
                <td className="ws-num">{r.position ? r.position.toFixed(1) : '–'}</td>
                {d.analytics && <td className="ws-num">{fmt(r.views)}</td>}
                <td className="ws-num">{r.enquiries || ''}</td><td className="ws-num">{r.admitted || ''}</td><td className="ws-num">{r.calls || ''}</td><td className="ws-num">{r.whatsapp || ''}</td><td className="ws-num">{r.bookings || ''}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}

interface ItemInsights {
  path?: string | null; error?: string | null;
  figures?: { clicks: number; prevClicks: number; impressions: number; position: number; views: number; enquiries: number; admitted: number; calls: number; whatsapp: number; bookings: number } | null;
  queries: { query: string; clicks: number; impressions: number; position: number; question: boolean }[];
  related: { title: string; path: string; score: number }[];
}

/** In the editor: this page's figures, its searches, questions to answer, and pages to link to. */
export function ItemSearchCard({ id, type, aiOn, canWrite, doc, onAddRelated, onAddQuestion, onTranslated, say }: {
  id: string; type: Kind; aiOn: boolean; canWrite: boolean; doc: Doc; onAddRelated: (r: { label: string; href: string }) => void; onAddQuestion: (q: string) => void; onTranslated: (id: string) => void; say: (m: string) => void;
}) {
  const [d, setD] = useState<ItemInsights | null>(null);
  const [ideas, setIdeas] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { crm.get<ItemInsights>(`/api/v1/website/${id}/insights`).then(setD).catch((e) => setErr(errText(e))); }, [id]);
  const ask = async () => { setBusy('q'); setErr(null); try { setIdeas((await crm.post<{ questions: string[] }>(`/api/v1/website/${id}/ai/questions`)).questions); } catch (e) { setErr(errText(e)); } finally { setBusy(null); } };
  const translate = async (language: 'hi' | 'bn') => {
    setBusy(language); setErr(null);
    try { const r = await crm.post<{ id: string }>(`/api/v1/website/${id}/ai/translate`, { language }); say(language === 'hi' ? 'Hindi draft made. Check it before sending for review.' : 'Bengali draft made. Check it before sending for review.'); onTranslated(r.id); }
    catch (e) { setErr(errText(e)); } finally { setBusy(null); }
  };
  if (!d && !err) return null;
  const f = d?.figures;
  const linked = new Set(((doc.related as { href: string }[] | undefined) ?? []).map((r) => r.href));
  const english = !doc.language;
  return (
    <section className="crm-card ws-card" aria-label="Search and results">
      <h3 className="ws-h3"><Search size={15} aria-hidden /> Search &amp; results <span className="crm-sub">(28 days)</span></h3>
      {err && <p className="ms-err" role="alert">{err}</p>}
      {f && <dl className="ws-figs">
        <div><dt>Visits from Google</dt><dd>{fmt(f.clicks)} <Change now={f.clicks} before={f.prevClicks} /></dd></div>
        <div><dt>Shown in Google</dt><dd>{fmt(f.impressions)}</dd></div>
        <div><dt>Place</dt><dd>{f.position ? f.position.toFixed(1) : '–'}</dd></div>
        <div><dt>Enquiries</dt><dd>{f.enquiries}{f.admitted ? <span className="crm-sub"> · {f.admitted} admitted</span> : null}</dd></div>
        <div><dt>Calls · WhatsApp · Bookings</dt><dd>{f.calls} · {f.whatsapp} · {f.bookings}</dd></div>
      </dl>}
      {d?.error && <p className="crm-sub" style={{ margin: 0 }}>{d.error}</p>}
      {d && d.queries.length > 0 && <>
        <h4 className="ws-h4">What people searched</h4>
        <ul className="ws-queries">{d.queries.slice(0, 10).map((q) => (
          <li key={q.query}><span>{q.question && <Pill tone="info">Question</Pill>} {q.query}</span><span className="crm-sub">{fmt(q.impressions)} · place {q.position.toFixed(0)}</span>
            {q.question && canWrite && type === 'article' && <button type="button" className="ws-link" onClick={() => { onAddQuestion(q.query); say('Added as a new section heading. Write the answer under it.'); }}>Answer it</button>}</li>
        ))}</ul>
      </>}
      {aiOn && canWrite && (type === 'article' || type === 'service') && <>
        <button type="button" className="crm-btn is-secondary is-sm" disabled={!!busy} onClick={() => void ask()}><Sparkles size={14} aria-hidden /> {busy === 'q' ? 'Thinking…' : 'Questions patients ask'}</button>
        {ideas && <ul className="ws-queries">{ideas.map((q) => <li key={q}><span>{q}</span>{type === 'article' && <button type="button" className="ws-link" onClick={() => { onAddQuestion(q); say('Added as a new section heading.'); }}>Answer it</button>}</li>)}</ul>}
      </>}
      {d && d.related.length > 0 && type === 'article' && <>
        <h4 className="ws-h4">Pages to link to</h4>
        <ul className="ws-queries">{d.related.map((r) => <li key={r.path}><span>{r.title} <span className="crm-sub ws-url">{r.path}</span></span>{canWrite && (linked.has(r.path) ? <span className="crm-sub"><Check size={13} aria-hidden /> linked</span> : <button type="button" className="ws-link" onClick={() => onAddRelated({ label: r.title, href: r.path })}><Link2 size={13} aria-hidden /> Add</button>)}</li>)}</ul>
      </>}
      {aiOn && canWrite && type === 'article' && english && <div className="ws-actions is-row">
        <button type="button" className="crm-btn is-secondary is-sm" disabled={!!busy} onClick={() => void translate('hi')}><Languages size={14} aria-hidden /> {busy === 'hi' ? 'Translating…' : 'Hindi version'}</button>
        <button type="button" className="crm-btn is-secondary is-sm" disabled={!!busy} onClick={() => void translate('bn')}><Languages size={14} aria-hidden /> {busy === 'bn' ? 'Translating…' : 'Bengali version'}</button>
      </div>}
    </section>
  );
}

/** Pages whose medical review is older than the set months. */
export function ReReviewList({ onOpen }: { onOpen: (id: string) => void }) {
  const [d, setD] = useState<{ months: number; items: { id: string; title: string; type: Kind; reviewedOn?: string | null; reviewedByName?: string | null }[] } | null>(null);
  useEffect(() => { crm.get<typeof d>('/api/v1/website/rereview').then(setD).catch(() => setD(null)); }, []);
  if (!d || d.items.length === 0) return null;
  return (
    <section className="crm-card ws-card">
      <h2 className="ws-h2">Due for review again</h2>
      <p className="crm-sub" style={{ margin: 0 }}>Medical pages are reviewed again every {d.months} months. Open one, read it, update anything out of date, and send it for review. The new date shows on the website once it is published.</p>
      <ul className="ws-ready">{d.items.map((r) => <li key={r.id}><span className="ws-grow"><strong>{r.title}</strong> <span className="crm-sub">{KIND[r.type]} · {r.reviewedOn ? `last reviewed ${dayText(r.reviewedOn)}${r.reviewedByName ? ` by ${r.reviewedByName}` : ''}` : 'no review date recorded'}</span></span><button type="button" className="ws-link" onClick={() => onOpen(r.id)}>Open</button></li>)}</ul>
    </section>
  );
}

/** Setup as five steps, each marked when done. */
export function SetupSteps() {
  const [steps, setSteps] = useState<{ key: string; label: string; done: boolean; detail: string }[] | null>(null);
  useEffect(() => { crm.get<{ steps: NonNullable<typeof steps> }>('/api/v1/website/steps').then((r) => setSteps(r.steps)).catch(() => setSteps(null)); }, []);
  if (!steps) return null;
  return (
    <section className="crm-card ws-card">
      <h2 className="ws-h2">Getting the website ready</h2>
      <ol className="ws-setup-steps">{steps.map((s, i) => <li key={s.key} className={s.done ? 'is-done' : ''}><span className="ws-step-dot" aria-hidden>{s.done ? <Check size={13} /> : i + 1}</span><span><strong>{s.label}</strong><br /><span className="crm-sub">{s.detail}</span></span></li>)}</ol>
    </section>
  );
}

interface ChainInfo { headOffice?: string | null; headName?: string; branches: string[]; orgs: { key: string; name: string }[]; problem?: string; items: { id: string; type: Kind; title: string; version: number; adoptedId?: string | null; adoptedVersion?: number | null; newer: boolean }[] }

/** Setup: which organisation is this one's head office, and which are its branches. */
export function ChainSettings({ say }: { say: (m: string) => void }) {
  const [d, setD] = useState<ChainInfo | null>(null);
  const [head, setHead] = useState(''); const [branches, setBranches] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { crm.get<ChainInfo>('/api/v1/website/chain').then((x) => { setD(x); setHead(x.headOffice ?? ''); setBranches(x.branches); }).catch((e) => setErr(errText(e))); }, []);
  const save = async () => { setBusy(true); setErr(null); try { await crm.put('/api/v1/website/chain', { headOffice: head, branches: branches.join(',') }); say('Chain saved.'); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } };
  if (!d) return err ? <ErrorBox message={err} /> : null;
  const others = d.orgs;
  return (
    <section className="crm-card ws-card">
      <h2 className="ws-h2"><Share2 size={17} aria-hidden /> Chain <span className="crm-sub">(optional)</span></h2>
      <p className="crm-sub" style={{ margin: 0 }}>For a group of hospitals: the head office marks articles, questions and other content as shared; each branch adopts what it wants, can change it for its own website, and takes the head office&apos;s later updates without losing its own changes. Both sides must agree here.</p>
      {others.length < 2 ? <p className="crm-sub" style={{ margin: 0 }}>There is only one organisation on this platform.</p> : <div className="ms-two">
        <label className="crm-field">This organisation&apos;s head office<select className="crm-input" value={head} onChange={(e) => setHead(e.target.value)}><option value="">None</option>{others.map((o) => <option key={o.key} value={o.key}>{o.name} ({o.key})</option>)}</select></label>
        <fieldset className="ms-set"><legend>Branches allowed to adopt this organisation&apos;s shared content</legend>{others.map((o) => <label key={o.key} className="ws-check"><input type="checkbox" checked={branches.includes(o.key)} onChange={(e) => setBranches(e.target.checked ? [...branches, o.key] : branches.filter((b) => b !== o.key))} /> {o.name}</label>)}</fieldset>
      </div>}
      {d.problem && <p className="crm-sub" style={{ margin: 0 }}>{d.problem}</p>}
      {err && <p className="ms-err" role="alert">{err}</p>}
      {others.length >= 2 && <div className="ws-actions is-row"><button type="button" className="crm-btn is-secondary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save chain'}</button></div>}
    </section>
  );
}

/** Content tab (branch): what the head office shares. */
export function ChainPanel({ onOpen, onChanged, say }: { onOpen: (id: string) => void; onChanged: () => void; say: (m: string) => void }) {
  const [d, setD] = useState<ChainInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { crm.get<ChainInfo>('/api/v1/website/chain').then(setD).catch(() => setD(null)); }, []);
  if (!d?.headOffice) return null;
  const adopt = async (hid: string) => { setBusy(hid); setErr(null); try { const r = await crm.post<{ id: string }>(`/api/v1/website/chain/adopt/${hid}`); say('Adopted as a draft here.'); onChanged(); onOpen(r.id); } catch (e) { setErr(errText(e)); setBusy(null); } };
  return (
    <details className="ws-crm-panel">
      <summary>From the head office{d.headName ? ` (${d.headName})` : ''}{d.items.some((i) => i.newer) ? ' · updates waiting' : ''}</summary>
      {d.problem && <p className="crm-sub">{d.problem}</p>}
      {err && <p className="ms-err" role="alert">{err}</p>}
      {d.items.length === 0 && !d.problem && <p className="crm-sub">The head office shares nothing yet.</p>}
      <ul className="ws-ready">{d.items.map((i) => (
        <li key={i.id}><span className="ws-grow"><strong>{i.title}</strong> <span className="crm-sub">{KIND[i.type]}{i.adoptedId ? (i.newer ? ' · a newer version is waiting' : ' · adopted') : ''}</span></span>
          {i.adoptedId ? <button type="button" className="ws-link" onClick={() => onOpen(i.adoptedId!)}>Open</button> : <button type="button" className="crm-btn is-secondary is-sm" disabled={!!busy} onClick={() => void adopt(i.id)}>{busy === i.id ? 'Adopting…' : 'Adopt'}</button>}</li>
      ))}</ul>
    </details>
  );
}

/** Setup: a starter website for an organisation that has none. */
export function StarterCard({ connected, say }: { connected: boolean; say: (m: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null); const [pr, setPr] = useState<string | null>(null);
  const download = async () => {
    setBusy('zip'); setErr(null);
    try { const b = await crm.blob('/api/v1/website/starter.zip'); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = 'website.zip'; a.click(); setTimeout(() => URL.revokeObjectURL(u), 5000); }
    catch (e) { setErr(errText(e)); } finally { setBusy(null); }
  };
  const open = async () => { setBusy('pr'); setErr(null); try { const r = await crm.post<{ url: string }>('/api/v1/website/starter/pr'); setPr(r.url); say('Pull request opened.'); } catch (e) { setErr(errText(e)); } finally { setBusy(null); } };
  return (
    <section className="crm-card ws-card">
      <h2 className="ws-h2">No website yet? Make a starter website</h2>
      <p className="crm-sub" style={{ margin: 0 }}>A small, fast website made from this organisation&apos;s CRM records: hospital details, doctors, departments, upcoming camps, and anything written here. It reads the same content files, so everything on this page publishes to it. Build it with one command; any static host can serve it.</p>
      {err && <p className="ms-err" role="alert">{err}</p>}
      {pr && <p style={{ margin: 0 }}><a href={pr} target="_blank" rel="noreferrer">Open the pull request on GitHub</a>, check it, then merge.</p>}
      <div className="ws-actions is-row">
        <button type="button" className="crm-btn is-secondary" disabled={!!busy} onClick={() => void download()}><Download size={16} aria-hidden /> {busy === 'zip' ? 'Making…' : 'Download it'}</button>
        <button type="button" className="crm-btn is-secondary" disabled={!!busy || !connected} onClick={() => void open()}><GitPullRequestArrow size={16} aria-hidden /> {busy === 'pr' ? 'Opening…' : 'Put it in the connected repository'}</button>
      </div>
      {!connected && <p className="crm-sub" style={{ margin: 0 }}>To put it straight into GitHub, connect an empty repository in step 2 first.</p>}
    </section>
  );
}

interface Hooks { hooks: { n: number; url: string; secret: string }[]; log: { id: string; hook: number; url: string; event: string; status: string; tries: number; lastError?: string | null; lastStatus?: number | null; createdAt: string; sentAt?: string | null }[] }

/** Developer: webhooks, API keys, and the opt-in counting per page. */
export function IntegrationsCard({ say }: { say: (m: string) => void }) {
  const [h, setH] = useState<Hooks | null>(null);
  const [keys, setKeys] = useState<{ id: string; name: string; last4: string; createdByName: string; createdAt: string; lastUsedAt?: string | null; revokedAt?: string | null }[] | null>(null);
  const [url, setUrl] = useState(''); const [name, setName] = useState('');
  const [shown, setShown] = useState<{ title: string; value: string; note: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { crm.get<Hooks>('/api/v1/website/hooks').then(setH).catch((e) => setErr(errText(e))); crm.get<{ items: NonNullable<typeof keys> }>('/api/v1/website/keys').then((r) => setKeys(r.items)).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  const act = async (fn: () => Promise<unknown>, m?: string) => { setErr(null); try { await fn(); if (m) say(m); load(); } catch (e) { setErr(errText(e)); } };
  const api = process.env.NEXT_PUBLIC_API_URL ?? '';
  const copy = (v: string) => { void navigator.clipboard?.writeText(v); say('Copied.'); };
  return (
    <>
      <section className="crm-card ws-card">
        <h2 className="ws-h2"><Webhook size={17} aria-hidden /> Webhooks</h2>
        <p className="crm-sub" style={{ margin: 0 }}>Tell another system after every publish or take-down. Each call is JSON signed with the webhook&apos;s secret: header <code>X-NexMarket-Signature: sha256=&lt;HMAC of the body&gt;</code>. Only public https addresses; failed calls are tried 5 more times over about 15 hours.</p>
        {err && <p className="ms-err" role="alert">{err}</p>}
        {h?.hooks.map((x) => <div key={x.n} className="ws-hook"><span className="ws-url">{x.url}</span><span className="crm-sub">secret {x.secret}</span><button type="button" className="crm-btn is-secondary is-sm" onClick={() => void act(() => crm.post(`/api/v1/website/hooks/${x.n}/test`), 'A test call is on its way.')}><Send size={13} aria-hidden /> Test</button><button type="button" className="crm-btn is-secondary is-sm" onClick={() => void act(() => crm.post(`/api/v1/website/hooks/${x.n}/remove`), 'Removed.')}><X size={13} aria-hidden /> Remove</button></div>)}
        {(h?.hooks.length ?? 0) < 3 && <div className="ws-hook"><label className="crm-sr" htmlFor="ws-hook-url">Webhook address</label><input id="ws-hook-url" className="crm-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" inputMode="url" />
          <button type="button" className="crm-btn is-secondary is-sm" disabled={!url.trim()} onClick={() => void act(async () => { const r = await crm.post<{ secret: string }>('/api/v1/website/hooks', { url }); setUrl(''); setShown({ title: 'Webhook secret', value: r.secret, note: 'Give this to the system that receives the webhook, to check each call is really from here. It is shown only now.' }); })}><Plus size={13} aria-hidden /> Add</button></div>}
        {h && h.log.length > 0 && <details><summary className="crm-sub">Recent calls ({h.log.length})</summary><ul className="ws-queries">{h.log.map((l) => <li key={l.id}><span>{l.event} → <span className="ws-url">{l.url}</span></span><span className={l.status === 'failed' ? 'ms-err' : 'crm-sub'}>{l.status === 'sent' ? `sent ${when(l.sentAt)}` : l.status === 'failed' ? `failed: ${l.lastError}` : `waiting (tries ${l.tries})${l.lastError ? `: ${l.lastError}` : ''}`}</span></li>)}</ul></details>}
      </section>
      <section className="crm-card ws-card">
        <h2 className="ws-h2"><KeyRound size={17} aria-hidden /> Read API</h2>
        <p className="crm-sub" style={{ margin: 0 }}>For an app or another website to read what is live. <code>GET {api}/api/v1/public/website/content?org=&lt;org&gt;&amp;type=article</code> with header <code>X-Api-Key</code>. A key is shown once; only its fingerprint is kept. Revoke a key to stop it.</p>
        {keys && keys.length > 0 && <ul className="ws-queries">{keys.map((k) => <li key={k.id}><span><strong>{k.name}</strong> <span className="crm-sub">{k.last4} · made by {k.createdByName} {when(k.createdAt)}{k.lastUsedAt ? ` · last used ${when(k.lastUsedAt)}` : ' · not used yet'}</span></span>{k.revokedAt ? <Pill tone="neutral">Revoked</Pill> : <button type="button" className="crm-btn is-secondary is-sm" onClick={() => { if (window.confirm(`Revoke "${k.name}"? Anything using it stops working.`)) void act(() => crm.post(`/api/v1/website/keys/${k.id}/revoke`), 'Revoked.'); }}>Revoke</button>}</li>)}</ul>}
        <div className="ws-hook"><label className="crm-sr" htmlFor="ws-key-name">Key name</label><input id="ws-key-name" className="crm-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="What will use it, e.g. Hospital app" />
          <button type="button" className="crm-btn is-secondary is-sm" disabled={!name.trim()} onClick={() => void act(async () => { const r = await crm.post<{ key: string; org: string }>('/api/v1/website/keys', { name }); setName(''); setShown({ title: 'New API key', value: r.key, note: `Use it with ?org=${r.org || '(your organisation)'}. It is shown only now; keep it somewhere safe.` }); })}><Plus size={13} aria-hidden /> Make a key</button></div>
      </section>
      <section className="crm-card ws-card">
        <h2 className="ws-h2">Counting per page</h2>
        <p className="crm-sub" style={{ margin: 0 }}>For the Search &amp; results tab to show which pages bring patients, set these in the website&apos;s build (its CI variables), then publish anything:</p>
        <pre className="ws-pre">{`VITE_CRM_EVENTS_URL=${api}/api/v1/public/web-event?org=<org>\nVITE_CRM_LEADS_URL=${api}/api/v1/public/web-lead/json?org=<org>`}</pre>
        <p className="crm-sub" style={{ margin: 0 }}>Only the kind of click and the page path are counted: no names, numbers, cookies or addresses. The website&apos;s privacy policy says so once it is switched on. Enquiries go to the Leads inbox with the page they came from.</p>
      </section>
      {shown && (
        <Modal title={shown.title} onClose={() => setShown(null)} actions={<button type="button" className="crm-btn" onClick={() => setShown(null)}>I have saved it</button>}>
          <p className="crm-sub" style={{ margin: 0 }}>{shown.note}</p>
          <div className="ws-hook"><code className="ws-path ws-secret">{shown.value}</code><button type="button" className="crm-btn is-secondary is-sm" onClick={() => copy(shown.value)}><Copy size={13} aria-hidden /> Copy</button></div>
        </Modal>
      )}
    </>
  );
}
