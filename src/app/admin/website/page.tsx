'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, ArrowDown, ArrowLeft, ArrowUp, Check, ExternalLink, FileText, Globe, History, ImagePlus, MessageCircleQuestion,
  Plus, Rocket, Send, Sparkles, Trash2, Undo2, X,
} from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { Empty, ErrorBox, friendlyError, Modal, PageHead, Pill, Skeleton, useToast, type Tone } from '@/components/crm/ui';

type Kind = 'article' | 'faq' | 'site';
type Status = 'draft' | 'review' | 'approved' | 'publishing' | 'published' | 'unpublished';
interface Row {
  id: string; type: Kind; key: string; title: string; status: Status; live: boolean; changed: boolean; version: number; sortOrder: number;
  aiDrafted: boolean; archived: boolean; note?: string | null; department?: string | null; category?: string | null;
  submittedByName?: string | null; reviewedByName?: string | null; reviewedAt?: string | null; publishedAt?: string | null;
  firstPublishedOn?: string | null; hasPicture: boolean; createdByName: string; updatedByName: string; updatedAt: string;
}
interface Job {
  id: string; title: string; status: 'queued' | 'checking' | 'merging' | 'deploying' | 'live' | 'failed' | 'deploy_failed'; note?: string | null;
  prUrl?: string | null; prNumber?: number | null; branch?: string | null; startedByName: string; startedAt: string; finishedAt?: string | null;
  running: boolean; log?: string | null; files?: string[] | null;
}
interface Setup {
  connected: boolean; imported: boolean; siteUrl?: string | null; repo?: string | null; reviewTypes: string[]; departments: string[]; ai: boolean;
  repoOwner?: string | null; repoName?: string | null; branch?: string | null; contentDir?: string | null; mediaDir?: string | null; appId?: string | null;
  privateKey?: string | null; token?: string | null; connectedAt?: string | null; importedAt?: string | null; keyUnreadable?: boolean;
}
interface Data {
  me: { write: boolean; review: boolean; publish: boolean; develop: boolean }; setup: Setup; aiOn: boolean; items: Row[]; publishes: Job[];
  faqCategories: string[]; siteFields: { key: string; label: string }[]; limits: { title: number; excerptMin: number; excerptMax: number };
}
interface Section { heading: string; paragraphs: string[]; points?: string[] }
interface Doc {
  slug?: string; title?: string; excerpt?: string; departmentId?: string; author?: string; image?: { src?: string; alt?: string };
  sections?: Section[]; references?: { label: string; url: string }[];
  id?: string; question?: string; answer?: string; category?: string; [k: string]: unknown;
}
interface One {
  item: Row; data: Doc; published?: Doc | null; problems: string[]; warnings: string[]; needsReview: boolean; address?: string | null;
  versions: { id: string; version: number; action: string; note?: string | null; byName: string; at: string }[];
}
type Tab = 'content' | 'review' | 'publish' | 'site' | 'developer' | 'setup';

const errText = (e: unknown) => {
  const m = e instanceof Error ? e.message : '';
  const i = m.indexOf(': {');
  if (i >= 0) { try { return (JSON.parse(m.slice(i + 2)) as { message?: string }).message ?? friendlyError(e); } catch { /* fall through */ } }
  return friendlyError(e);
};
const when = (d?: string | null) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const nice = (s: string) => s.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const KIND: Record<Kind, string> = { article: 'Article', faq: 'Question', site: 'Hospital details' };
const STATUS: Record<Status, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' }, review: { label: 'Waiting for review', tone: 'warn' }, approved: { label: 'Ready to publish', tone: 'info' },
  publishing: { label: 'Publishing…', tone: 'accent' }, published: { label: 'On the website', tone: 'ok' }, unpublished: { label: 'Taken down', tone: 'neutral' },
};
const ACTION: Record<string, string> = {
  created: 'Created', saved: 'Saved', submitted: 'Sent for review', approved: 'Approved', sent_back: 'Sent back', published: 'Published',
  unpublished: 'Taken down', imported: 'Brought in from the website', failed: 'Publishing failed',
};

function StatusPills({ r }: { r: Row }) {
  return (
    <span className="ws-pills">
      {r.archived ? <Pill tone="neutral">Archived</Pill> : r.changed
        ? <><Pill tone="ok" dot>On the website</Pill><Pill tone={STATUS[r.status].tone}>{r.status === 'draft' ? 'Changes not published' : `Changes: ${STATUS[r.status].label.toLowerCase()}`}</Pill></>
        : <Pill tone={STATUS[r.status].tone} dot={r.status === 'published'}>{STATUS[r.status].label}</Pill>}
      {r.aiDrafted && !r.live && <Pill tone="accent">AI draft</Pill>}
    </span>
  );
}

export default function WebsitePage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('content');
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ type: Kind; data?: Doc; ai?: boolean } | null>(null);
  const [aiForm, setAiForm] = useState(false);
  const [toast, say] = useToast();

  const load = useCallback(async () => {
    try { setData(await crm.get<Data>('/api/v1/website')); setError(null); } catch (e) { setError(errText(e)); }
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    const t = setTimeout(() => { if (id) setOpen(id); }, 0);
    return () => clearTimeout(t);
  }, []);
  // While a publish is running, keep its progress fresh.
  const running = data?.publishes.some((p) => p.running) ?? false;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [running, load]);

  if (error && !data) return <main className="crm-page"><PageHead title="Website" /><ErrorBox message={error} onRetry={() => void load()} /></main>;
  if (!data) return <main className="crm-page"><PageHead title="Website" /><Skeleton h={480} /></main>;

  const { me, setup } = data;
  const active = data.items.filter((i) => !i.archived);
  const waiting = active.filter((i) => i.status === 'review');
  const ready = active.filter((i) => i.status === 'approved');
  const site = data.items.find((i) => i.type === 'site');

  if (open) {
    return (
      <main className="crm-page">
        <Editor key={open} id={open} data={data} onBack={() => { setOpen(null); void load(); }} say={say} onChanged={() => void load()} />
        {toast}
      </main>
    );
  }

  return (
    <main className="crm-page">
      <PageHead title="Website" sub={<>Write and publish what is on {setup.siteUrl ? <a href={setup.siteUrl} target="_blank" rel="noreferrer">{setup.siteUrl.replace('https://', '')}</a> : 'the website'}: articles, questions and answers, and the hospital&apos;s details. A change goes live only after the website&apos;s own checks pass. Nothing is ever deleted.</>}>
        {me.write && data.aiOn && <button type="button" className="crm-btn is-secondary" onClick={() => setAiForm(true)}><Sparkles size={16} aria-hidden /> Draft with AI</button>}
        {me.write && <button type="button" className="crm-btn is-secondary" onClick={() => setDraft({ type: 'faq' })}><Plus size={16} aria-hidden /> New question</button>}
        {me.write && <button type="button" className="crm-btn" onClick={() => setDraft({ type: 'article' })}><Plus size={16} aria-hidden /> New article</button>}
      </PageHead>

      {!setup.connected && <div className="ws-banner">The website isn&apos;t connected yet, so nothing can be published. You can still write drafts. {me.develop ? <button type="button" className="ws-link" onClick={() => setTab('setup')}>Connect it in Setup</button> : 'A developer connects it once in Setup.'}</div>}
      {setup.connected && !setup.imported && <div className="ws-banner">Connected, but what is on the website now hasn&apos;t been brought in yet. {me.develop ? <button type="button" className="ws-link" onClick={() => setTab('setup')}>Do that in Setup</button> : 'A developer does that in Setup.'}</div>}
      {data.publishes.filter((p) => p.running).map((p) => <Progress key={p.id} job={p} />)}

      <div className="crm-tabs" role="tablist" aria-label="Website views">
        <button type="button" role="tab" className="crm-tab" aria-selected={tab === 'content'} onClick={() => setTab('content')}>Content</button>
        <button type="button" role="tab" className="crm-tab" aria-selected={tab === 'review'} onClick={() => setTab('review')}>Waiting for review{waiting.length ? <span className="an-count">{waiting.length}</span> : null}</button>
        <button type="button" role="tab" className="crm-tab" aria-selected={tab === 'publish'} onClick={() => setTab('publish')}>Publish{ready.length ? <span className="an-count">{ready.length}</span> : null}</button>
        <button type="button" role="tab" className="crm-tab" aria-selected={tab === 'site'} onClick={() => setTab('site')}>Hospital details</button>
        {me.develop && <button type="button" role="tab" className="crm-tab" aria-selected={tab === 'developer'} onClick={() => setTab('developer')}>Developer</button>}
        {me.develop && <button type="button" role="tab" className="crm-tab" aria-selected={tab === 'setup'} onClick={() => setTab('setup')}>Setup</button>}
      </div>

      {tab === 'content' && <ContentTab data={data} onOpen={setOpen} onChanged={() => void load()} say={say} />}
      {tab === 'review' && (waiting.length === 0
        ? <Empty title="Nothing is waiting for review">When a writer sends an article for review, it shows here for the reviewer to read and approve.</Empty>
        : <List rows={waiting} onOpen={setOpen} extra={(r) => <span className="crm-sub">Sent by {r.submittedByName}</span>} />)}
      {tab === 'publish' && <PublishTab data={data} onOpen={setOpen} onChanged={() => void load()} say={say} />}
      {tab === 'site' && (site
        ? <Editor key={site.id} id={site.id} data={data} embedded onBack={() => void load()} say={say} onChanged={() => void load()} />
        : <Empty title="The hospital's details aren't here yet">They come in when the website is connected and its content is brought in (Setup).</Empty>)}
      {tab === 'developer' && me.develop && <DeveloperTab data={data} />}
      {tab === 'setup' && me.develop && <SetupTab setup={setup} onChanged={() => void load()} say={say} />}

      {draft && <NewForm type={draft.type} start={draft.data} ai={draft.ai} data={data} onClose={() => setDraft(null)} onMade={(id) => { setDraft(null); setOpen(id); }} />}
      {aiForm && <AiDraftForm data={data} onClose={() => setAiForm(false)} onDraft={(d) => { setAiForm(false); setDraft({ type: 'article', data: d, ai: true }); }} />}
      {toast}
    </main>
  );
}

/** A publish in progress, left to right: checks, accept, go live. */
function Progress({ job }: { job: Job }) {
  const steps = [['queued', 'Sent to the website'], ['checking', 'Website checks'], ['merging', 'Accepted'], ['deploying', 'Going live'], ['live', 'Live']] as const;
  const at = steps.findIndex(([k]) => k === job.status);
  return (
    <section className="crm-card ws-progress" aria-live="polite">
      <div className="ws-progress-head"><strong>{job.title}</strong><span className="crm-sub">Started by {job.startedByName}, {when(job.startedAt)}. This usually takes 3 to 6 minutes.</span></div>
      <ol className="ws-steps">
        {steps.map(([k, label], i) => <li key={k} className={i < at ? 'is-done' : i === at ? 'is-now' : ''}><span className="ws-step-dot" aria-hidden>{i < at ? <Check size={13} /> : i + 1}</span>{label}</li>)}
      </ol>
      {job.note && <p className="crm-sub" style={{ margin: 0 }}>{job.note}</p>}
    </section>
  );
}

function List({ rows, onOpen, extra }: { rows: Row[]; onOpen: (id: string) => void; extra?: (r: Row) => React.ReactNode }) {
  return (
    <div className="crm-table-wrap">
      <table className="crm-table">
        <thead><tr><th>Title</th><th>Kind</th><th>Where it is</th><th>Last change</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="ws-row" onClick={() => onOpen(r.id)}>
              <td><button type="button" className="ws-title" onClick={(e) => { e.stopPropagation(); onOpen(r.id); }}>{r.title || 'Untitled'}</button>{extra && <div>{extra(r)}</div>}{r.note && !r.archived && <div className="ws-note">{r.note}</div>}</td>
              <td>{KIND[r.type]}{r.department ? <div className="crm-sub">{nice(r.department)}</div> : r.category ? <div className="crm-sub">{nice(r.category)}</div> : null}</td>
              <td><StatusPills r={r} /></td>
              <td className="crm-sub">{r.updatedByName}<br />{when(r.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContentTab({ data, onOpen, onChanged, say }: { data: Data; onOpen: (id: string) => void; onChanged: () => void; say: (m: string) => void }) {
  const [kind, setKind] = useState<'all' | 'article' | 'faq'>('all');
  const [show, setShow] = useState<'all' | 'draft' | 'live' | 'archived'>('all');
  const [q, setQ] = useState('');
  const rows = data.items.filter((r) => r.type !== 'site')
    .filter((r) => (show === 'archived' ? r.archived : !r.archived))
    .filter((r) => kind === 'all' || r.type === kind)
    .filter((r) => show === 'draft' ? !r.live : show === 'live' ? r.live : true)
    .filter((r) => !q.trim() || r.title.toLowerCase().includes(q.trim().toLowerCase()));
  const faqs = data.items.filter((r) => r.type === 'faq' && !r.archived).sort((a, b) => a.sortOrder - b.sortOrder);
  const move = async (id: string, by: number) => {
    const ids = faqs.map((f) => f.id); const i = ids.indexOf(id); const j = i + by;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await crm.post('/api/v1/website/faq-order', { ids }); onChanged(); say('Order saved. It shows on the website the next time a question is published.'); } catch (e) { say(errText(e)); }
  };
  return (
    <>
      <div className="ws-filters">
        <div className="crm-chips" role="group" aria-label="Kind">
          {([['all', 'Everything'], ['article', 'Articles'], ['faq', 'Questions']] as const).map(([k, l]) => <button key={k} type="button" className="crm-chip" aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}
        </div>
        <div className="crm-chips" role="group" aria-label="Show">
          {([['all', 'All'], ['draft', 'Not on the website'], ['live', 'On the website'], ['archived', 'Archived']] as const).map(([k, l]) => <button key={k} type="button" className="crm-chip" aria-pressed={show === k} onClick={() => setShow(k)}>{l}</button>)}
        </div>
        <label className="crm-sr" htmlFor="ws-q">Search titles</label>
        <input id="ws-q" className="crm-input ws-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles" />
      </div>
      {rows.length === 0
        ? <Empty title={show === 'archived' ? 'Nothing is archived' : 'Nothing here yet'}>{show === 'archived' ? null : data.me.write ? 'Start with New article or New question, at the top.' : 'Articles and questions show here once someone writes them.'}</Empty>
        : kind === 'faq' && show === 'all' && !q.trim()
          ? <List rows={faqs} onOpen={onOpen} extra={(r) => data.me.write ? (
            <span className="ws-order" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="crm-btn is-secondary is-sm" aria-label={`Move "${r.title}" up`} disabled={faqs[0]?.id === r.id} onClick={() => void move(r.id, -1)}><ArrowUp size={14} aria-hidden /></button>
              <button type="button" className="crm-btn is-secondary is-sm" aria-label={`Move "${r.title}" down`} disabled={faqs[faqs.length - 1]?.id === r.id} onClick={() => void move(r.id, 1)}><ArrowDown size={14} aria-hidden /></button>
            </span>) : null} />
          : <List rows={rows} onOpen={onOpen} />}
    </>
  );
}

function PublishTab({ data, onOpen, onChanged, say }: { data: Data; onOpen: (id: string) => void; onChanged: () => void; say: (m: string) => void }) {
  const ready = data.items.filter((i) => !i.archived && i.status === 'approved');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<Job | null>(null);
  const running = data.publishes.some((p) => p.running);
  const chosen = ready.filter((r) => picked.has(r.id));
  const go = async () => {
    setBusy(true); setErr(null);
    try { await crm.post('/api/v1/website/publish', { items: chosen.map((r) => ({ id: r.id, action: 'publish' })) }); setPicked(new Set()); say('Sent to the website. Progress shows at the top.'); onChanged(); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const openJob = async (p: Job) => { try { setView(await crm.get<Job>(`/api/v1/website/publishes/${p.id}`)); } catch { setView(p); } };
  const tone = (s: Job['status']): Tone => (s === 'live' ? 'ok' : s === 'failed' || s === 'deploy_failed' ? 'bad' : 'accent');
  const label = (s: Job['status']) => (s === 'live' ? 'Live' : s === 'failed' ? 'Did not go live' : s === 'deploy_failed' ? 'Accepted, deploy failed' : 'Running');
  return (
    <>
      <section className="crm-card ws-card">
        <h2 className="ws-h2">Ready to publish</h2>
        {ready.length === 0 ? <p className="crm-sub" style={{ margin: 0 }}>Nothing is ready. An article is ready after a reviewer approves it; a question or the hospital&apos;s details after the writer marks it ready.</p> : (
          <>
            <ul className="ws-ready">
              {ready.map((r) => (
                <li key={r.id}>
                  <label><input type="checkbox" checked={picked.has(r.id)} disabled={!data.me.publish} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(r.id); else n.delete(r.id); setPicked(n); }} /> <span>{r.title}</span></label>
                  <span className="crm-sub">{KIND[r.type]}{r.reviewedByName ? `, approved by ${r.reviewedByName}` : ''}</span>
                  <button type="button" className="ws-link" onClick={() => onOpen(r.id)}>Open</button>
                </li>
              ))}
            </ul>
            {err && <p className="ms-err" role="alert">{err}</p>}
            {data.me.publish
              ? <button type="button" className="crm-btn" disabled={busy || running || chosen.length === 0} onClick={() => void go()}><Rocket size={16} aria-hidden /> {busy ? 'Sending…' : running ? 'A publish is running' : chosen.length ? `Publish ${chosen.length} to the website` : 'Tick what to publish'}</button>
              : <p className="crm-sub" style={{ margin: 0 }}>You can&apos;t publish. Someone with the publish right does this.</p>}
          </>
        )}
      </section>
      <section className="crm-card ws-card">
        <h2 className="ws-h2">Publishing history</h2>
        {data.publishes.length === 0 ? <p className="crm-sub" style={{ margin: 0 }}>Nothing has been published from here yet.</p> : (
          <div className="crm-table-wrap"><table className="crm-table">
            <thead><tr><th>What</th><th>Result</th><th>By</th><th><span className="crm-sr">Details</span></th></tr></thead>
            <tbody>{data.publishes.map((p) => (
              <tr key={p.id}>
                <td>{p.title}{p.note && <div className="ws-note">{p.note}</div>}</td>
                <td><Pill tone={tone(p.status)} dot>{label(p.status)}</Pill></td>
                <td className="crm-sub">{p.startedByName}<br />{when(p.startedAt)}</td>
                <td><button type="button" className="crm-btn is-secondary is-sm" onClick={() => void openJob(p)}>Details</button></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
      {view && (
        <Modal title={view.title} onClose={() => setView(null)} wide actions={<button type="button" className="crm-btn" onClick={() => setView(null)}>Close</button>}>
          <div className="ms-form">
            <p style={{ margin: 0 }}><Pill tone={tone(view.status)} dot>{label(view.status)}</Pill> <span className="crm-sub">Started {when(view.startedAt)} by {view.startedByName}{view.finishedAt ? `, finished ${when(view.finishedAt)}` : ''}</span></p>
            {view.note && <p style={{ margin: 0 }}>{view.note}</p>}
            {view.prUrl && <p style={{ margin: 0 }}><a href={view.prUrl} target="_blank" rel="noreferrer">Pull request #{view.prNumber} on GitHub <ExternalLink size={13} aria-hidden /></a></p>}
            {view.files && view.files.length > 0 && <p className="crm-sub" style={{ margin: 0 }}>Files written: {view.files.join(', ')}</p>}
            {view.log && <><h3 className="ws-h3">End of the build log</h3><pre className="ws-pre">{view.log}</pre></>}
          </div>
        </Modal>
      )}
    </>
  );
}

function NewForm({ type, start, ai, data, onClose, onMade }: { type: Kind; start?: Doc; ai?: boolean; data: Data; onClose: () => void; onMade: (id: string) => void }) {
  const [title, setTitle] = useState(start?.title ?? '');
  const [dept, setDept] = useState(start?.departmentId ?? data.setup.departments[0] ?? '');
  const [cat, setCat] = useState(data.faqCategories[0] ?? '');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!title.trim()) { setErr(type === 'faq' ? 'Write the question.' : 'Write the title.'); return; }
    setBusy(true); setErr(null);
    try {
      const body = type === 'faq' ? { question: title, answer, category: cat } : { ...(start ?? {}), title, departmentId: dept, author: start?.author ?? '' };
      const made = await crm.post<{ id: string }>('/api/v1/website', { type, data: body, aiDrafted: !!ai });
      onMade(made.id);
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Modal title={type === 'faq' ? 'New question' : ai ? 'Save the AI draft' : 'New article'} onClose={onClose} actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="crm-btn" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save as a draft and open'}</button>
    </>}>
      <div className="ms-form">
        {ai && <p className="ws-ai-note"><Sparkles size={15} aria-hidden /> This is a first draft written by AI. Read every line and correct it before sending it for review. It has no references; add real ones.</p>}
        <label className="crm-field">{type === 'faq' ? 'The question, as a patient would ask it' : 'Title'}<input className="crm-input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={type === 'faq' ? 'e.g. Do I need an appointment for the OPD?' : 'e.g. Kidney stones: signs and when to see a doctor'} /></label>
        {type === 'faq' ? <>
          <label className="crm-field">Answer<textarea className="crm-textarea" rows={4} value={answer} onChange={(e) => setAnswer(e.target.value)} /></label>
          <label className="crm-field">What it is about<select className="crm-input" value={cat} onChange={(e) => setCat(e.target.value)}>{data.faqCategories.map((c) => <option key={c} value={c}>{nice(c)}</option>)}</select></label>
        </> : (
          <label className="crm-field">Department<select className="crm-input" value={dept} onChange={(e) => setDept(e.target.value)}>{data.setup.departments.map((d) => <option key={d} value={d}>{nice(d)}</option>)}</select></label>
        )}
        {type === 'article' && <p className="crm-sub" style={{ margin: 0 }}>The article&apos;s web address is made from the title and stays the same afterwards, so pick the title with care.</p>}
        {err && <p className="ms-err" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

function AiDraftForm({ data, onClose, onDraft }: { data: Data; onClose: () => void; onDraft: (d: Doc) => void }) {
  const [topic, setTopic] = useState('');
  const [dept, setDept] = useState(data.setup.departments[0] ?? '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try { onDraft((await crm.post<{ data: Doc }>('/api/v1/website/ai/draft', { topic, departmentId: dept, notes })).data); }
    catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Modal title="Draft an article with AI" onClose={onClose} actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="crm-btn" onClick={() => void go()} disabled={busy || topic.trim().length < 4}>{busy ? 'Writing, about 20 seconds…' : 'Write a first draft'}</button>
    </>}>
      <div className="ms-form">
        <label className="crm-field">What is the article about?<input className="crm-input" value={topic} maxLength={200} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Kidney stones: signs, causes and treatment" /></label>
        <label className="crm-field">Department<select className="crm-input" value={dept} onChange={(e) => setDept(e.target.value)}>{data.setup.departments.map((d) => <option key={d} value={d}>{nice(d)}</option>)}</select></label>
        <label className="crm-field">Points to cover (optional)<textarea className="crm-textarea" rows={3} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. drink more water, when surgery is needed, what our hospital offers" /></label>
        <p className="crm-sub" style={{ margin: 0 }}>Only what you type here goes to the AI. Don&apos;t type anything about a patient. The draft is not published: you edit it, and a reviewer approves it.</p>
        {err && <p className="ms-err" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

const toLines = (a?: string[]) => (a ?? []).join('\n');
const fromLines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const toParas = (a?: string[]) => (a ?? []).join('\n\n');
const fromParas = (s: string) => s.split(/\n\s*\n/).map((x) => x.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
interface EditSection { heading: string; text: string; points: string }

function Editor({ id, data, embedded, onBack, onChanged, say }: { id: string; data: Data; embedded?: boolean; onBack: () => void; onChanged: () => void; say: (m: string) => void }) {
  const [one, setOne] = useState<One | null>(null);
  const [doc, setDoc] = useState<Doc>({});
  const [secs, setSecs] = useState<EditSection[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sendBack, setSendBack] = useState(false);
  const [note, setNote] = useState('');
  const [history, setHistory] = useState(false);
  const [preview, setPreview] = useState(false);
  const [ideas, setIdeas] = useState<{ titles: string[]; excerpts: string[] } | null>(null);
  const [claims, setClaims] = useState<{ text: string; why: string }[] | null>(null);
  const [pic, setPic] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { me, limits } = data;

  const load = useCallback(async () => {
    try {
      const o = await crm.get<One>(`/api/v1/website/${id}`);
      setOne(o); setDoc(o.data);
      setSecs((o.data.sections ?? []).map((s) => ({ heading: s.heading, text: toParas(s.paragraphs), points: toLines(s.points) })));
      setDirty(false); setErr(null);
    } catch (e) { setErr(errText(e)); }
  }, [id]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  const picVersion = one?.item.hasPicture ? one.item.version : 0;
  useEffect(() => {
    let url: string | null = null; let gone = false;
    (picVersion ? crm.blob(`/api/v1/website/${id}/picture`) : Promise.resolve(null))
      .then((b) => { if (gone) return; url = b ? URL.createObjectURL(b) : null; setPic(url); }).catch(() => { if (!gone) setPic(null); });
    return () => { gone = true; if (url) URL.revokeObjectURL(url); };
  }, [id, picVersion]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const built = useMemo<Doc>(() => (one?.item.type === 'article'
    ? { ...doc, sections: secs.map((s) => ({ heading: s.heading, paragraphs: fromParas(s.text), points: fromLines(s.points) })) } : doc), [doc, secs, one?.item.type]);

  if (!one) return err ? <ErrorBox message={err} onRetry={() => void load()} /> : <Skeleton h={420} />;
  const r = one.item; const type = r.type;
  const locked = r.archived || r.status === 'publishing' || !me.write;
  const set = (k: string, v: unknown) => { setDoc((d) => ({ ...d, [k]: v })); setDirty(true); };
  const setSec = (i: number, k: keyof EditSection, v: string) => { setSecs((a) => a.map((s, n) => (n === i ? { ...s, [k]: v } : s))); setDirty(true); };
  const refs = doc.references ?? [];
  const setRef = (i: number, k: 'label' | 'url', v: string) => set('references', refs.map((x, n) => (n === i ? { ...x, [k]: v } : x)));

  const run = async (name: string, fn: () => Promise<string | void>) => {
    setBusy(name); setErr(null);
    try { const m = await fn(); await load(); onChanged(); if (m) say(m); } catch (e) { setErr(errText(e)); } finally { setBusy(null); }
  };
  const saveNow = async () => { if (dirty) await crm.put(`/api/v1/website/${id}`, { data: built, version: r.version }); };
  const save = () => run('save', async () => { await saveNow(); return 'Saved.'; });
  const submit = () => run('submit', async () => { await saveNow(); await crm.post(`/api/v1/website/${id}/submit`); return one.needsReview ? 'Sent for review.' : 'Marked ready to publish.'; });
  const approve = () => run('approve', async () => { await crm.post(`/api/v1/website/${id}/approve`); return 'Approved. Your name will show on the article as its reviewer.'; });
  const back = () => run('back', async () => { await crm.post(`/api/v1/website/${id}/send-back`, { note }); setSendBack(false); setNote(''); return 'Sent back to the writer.'; });
  const publish = (action: 'publish' | 'unpublish') => run(action, async () => { await crm.post('/api/v1/website/publish', { items: [{ id, action }] }); return action === 'publish' ? 'Sent to the website. It is live in a few minutes if the checks pass.' : 'Taking it down. It leaves the website in a few minutes.'; });
  const archive = (undo: boolean) => run('archive', async () => { await crm.post(`/api/v1/website/${id}/archive${undo ? '?undo=true' : ''}`); return undo ? 'Brought back.' : 'Archived. It is kept, and can be brought back.'; });
  const restore = (vid: string) => run('restore', async () => { await crm.post(`/api/v1/website/${id}/restore/${vid}`); setHistory(false); return 'That version is the draft now.'; });
  const upload = (f: File) => run('picture', async () => { await saveNow(); const form = new FormData(); form.append('file', f); await crm.upload(`/api/v1/website/${id}/picture`, form); return 'Picture added.'; });
  const suggest = async () => { setBusy('suggest'); setErr(null); try { setIdeas(await crm.post('/api/v1/website/ai/suggest', { data: built })); } catch (e) { setErr(errText(e)); } finally { setBusy(null); } };
  const check = async () => { setBusy('claims'); setErr(null); try { setClaims((await crm.post<{ claims: { text: string; why: string }[] }>('/api/v1/website/ai/claims', { data: built })).claims); } catch (e) { setErr(errText(e)); } finally { setBusy(null); } };

  const count = (n: number, max: number, min = 0) => <span className={`ws-count${n > max || (n > 0 && n < min) ? ' is-off' : ''}`}>{n} / {max}</span>;
  const canSubmit = me.write && !r.archived && (r.status === 'draft' || r.status === 'unpublished' || dirty);

  return (
    <div className="ws-editor">
      {!embedded && (
        <div className="ws-editor-head">
          <button type="button" className="crm-btn is-secondary" onClick={() => { if (!dirty || window.confirm('Leave without saving your changes?')) onBack(); }}><ArrowLeft size={16} aria-hidden /> All content</button>
          <span className="crm-sub">{KIND[type]}</span>
          <StatusPills r={r} />
        </div>
      )}
      {r.note && <div className="ws-banner" role="status">{r.note}</div>}
      {err && <ErrorBox message={err} />}
      <div className="ws-cols">
        <div className="ws-main">
          {type === 'article' && (preview ? <Preview doc={built} pic={pic} reviewer={r.reviewedByName} /> : <>
            <label className="crm-field"><span className="ws-lab">Title {count((doc.title ?? '').length, limits.title)}</span><input className="crm-input ws-big" value={doc.title ?? ''} disabled={locked} maxLength={200} onChange={(e) => set('title', e.target.value)} /></label>
            <label className="crm-field"><span className="ws-lab">Short summary (shown under the title in Google) {count((doc.excerpt ?? '').length, limits.excerptMax, limits.excerptMin)}</span><textarea className="crm-textarea" rows={2} value={doc.excerpt ?? ''} disabled={locked} maxLength={400} onChange={(e) => set('excerpt', e.target.value)} /></label>
            <div className="ms-two">
              <label className="crm-field">Department<select className="crm-input" value={doc.departmentId ?? ''} disabled={locked} onChange={(e) => set('departmentId', e.target.value)}><option value="">Pick one</option>{data.setup.departments.map((d) => <option key={d} value={d}>{nice(d)}</option>)}</select></label>
              <label className="crm-field">Author (shown on the article)<input className="crm-input" value={doc.author ?? ''} disabled={locked} maxLength={120} onChange={(e) => set('author', e.target.value)} placeholder="e.g. Glisan Hospital editorial team" /></label>
            </div>
            <fieldset className="ms-set"><legend>Picture</legend>
              <div className="ws-pic">
                {/* eslint-disable-next-line @next/next/no-img-element -- a private picture loaded as a blob */}
                {pic ? <img src={pic} alt="" /> : doc.image?.src ? <span className="crm-sub">The picture already on the website is kept.</span> : <span className="crm-sub">No picture yet.</span>}
                <div className="ws-pic-side">
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
                  {!locked && <button type="button" className="crm-btn is-secondary is-sm" disabled={!!busy} onClick={() => fileRef.current?.click()}><ImagePlus size={15} aria-hidden /> {busy === 'picture' ? 'Uploading…' : pic || doc.image?.src ? 'Change picture' : 'Add a picture'}</button>}
                  <span className="crm-sub">JPG, PNG or WebP, up to 2 MB. Wide pictures (about 1200 × 630) look best.</span>
                  <label className="crm-field">Describe the picture in a few words<input className="crm-input" value={doc.image?.alt ?? ''} disabled={locked} maxLength={200} onChange={(e) => set('image', { ...(doc.image ?? {}), alt: e.target.value })} placeholder="e.g. A doctor explaining a kidney scan to a patient" /></label>
                </div>
              </div>
            </fieldset>
            <h2 className="ws-h2">Sections</h2>
            {secs.map((s, i) => (
              <fieldset key={i} className="ws-sec">
                <legend className="crm-sr">Section {i + 1}</legend>
                <div className="ws-sec-head">
                  <input className="crm-input" aria-label={`Heading of section ${i + 1}`} value={s.heading} disabled={locked} maxLength={160} onChange={(e) => setSec(i, 'heading', e.target.value)} placeholder={`Heading of section ${i + 1}`} />
                  {!locked && <>
                    <button type="button" className="crm-btn is-secondary is-sm" aria-label="Move section up" disabled={i === 0} onClick={() => { setSecs((a) => { const b = [...a]; [b[i - 1], b[i]] = [b[i], b[i - 1]]; return b; }); setDirty(true); }}><ArrowUp size={14} aria-hidden /></button>
                    <button type="button" className="crm-btn is-secondary is-sm" aria-label="Move section down" disabled={i === secs.length - 1} onClick={() => { setSecs((a) => { const b = [...a]; [b[i + 1], b[i]] = [b[i], b[i + 1]]; return b; }); setDirty(true); }}><ArrowDown size={14} aria-hidden /></button>
                    <button type="button" className="crm-btn is-secondary is-sm" aria-label="Remove section" onClick={() => { if (!s.text.trim() && !s.points.trim() || window.confirm('Remove this section? You can get it back from History after saving.')) { setSecs((a) => a.filter((_, n) => n !== i)); setDirty(true); } }}><Trash2 size={14} aria-hidden /></button>
                  </>}
                </div>
                <label className="crm-field">Text (leave an empty line between paragraphs)<textarea className="crm-textarea" rows={Math.min(14, Math.max(4, Math.ceil(s.text.length / 90) + 1))} value={s.text} disabled={locked} onChange={(e) => setSec(i, 'text', e.target.value)} /></label>
                <label className="crm-field">Bullet points (optional, one per line)<textarea className="crm-textarea" rows={Math.max(2, s.points.split('\n').length)} value={s.points} disabled={locked} onChange={(e) => setSec(i, 'points', e.target.value)} /></label>
              </fieldset>
            ))}
            {!locked && <button type="button" className="crm-btn is-secondary" onClick={() => { setSecs((a) => [...a, { heading: '', text: '', points: '' }]); setDirty(true); }}><Plus size={16} aria-hidden /> Add a section</button>}
            <h2 className="ws-h2">References</h2>
            <p className="crm-sub" style={{ margin: 0 }}>Where the medical facts come from: a guideline, a textbook, a trusted health site. Only add ones you have opened and read.</p>
            {refs.map((x, i) => (
              <div key={i} className="ws-ref">
                <input className="crm-input" aria-label={`Name of reference ${i + 1}`} value={x.label} disabled={locked} onChange={(e) => setRef(i, 'label', e.target.value)} placeholder="Name, e.g. WHO: Kidney health" />
                <input className="crm-input" aria-label={`Link of reference ${i + 1}`} value={x.url} disabled={locked} onChange={(e) => setRef(i, 'url', e.target.value)} placeholder="https://…" inputMode="url" />
                {!locked && <button type="button" className="crm-btn is-secondary is-sm" aria-label="Remove reference" onClick={() => set('references', refs.filter((_, n) => n !== i))}><X size={14} aria-hidden /></button>}
              </div>
            ))}
            {!locked && <button type="button" className="crm-btn is-secondary" onClick={() => set('references', [...refs, { label: '', url: '' }])}><Plus size={16} aria-hidden /> Add a reference</button>}
          </>)}
          {type === 'faq' && <>
            <label className="crm-field">Question<input className="crm-input ws-big" value={doc.question ?? ''} disabled={locked} maxLength={300} onChange={(e) => set('question', e.target.value)} /></label>
            <label className="crm-field">Answer<textarea className="crm-textarea" rows={6} value={doc.answer ?? ''} disabled={locked} onChange={(e) => set('answer', e.target.value)} /></label>
            <label className="crm-field">What it is about<select className="crm-input" value={doc.category ?? ''} disabled={locked} onChange={(e) => set('category', e.target.value)}>{data.faqCategories.map((c) => <option key={c} value={c}>{nice(c)}</option>)}</select></label>
          </>}
          {type === 'site' && <>
            <p className="crm-sub" style={{ margin: 0 }}>These show across the whole website: the header, the contact page, the footer and Google&apos;s information about the hospital.</p>
            {data.siteFields.map((f) => (
              <label key={f.key} className="crm-field">{f.label}{f.key === 'phone' ? ' (10 digits, no +91)' : ''}
                {['description', 'medicalDisclaimer', 'emergencyInfo', 'consultationTimings'].includes(f.key)
                  ? <textarea className="crm-textarea" rows={f.key === 'consultationTimings' ? 2 : 3} value={String(doc[f.key] ?? '')} disabled={locked} onChange={(e) => set(f.key, e.target.value)} />
                  : <input className="crm-input" value={String(doc[f.key] ?? '')} disabled={locked} onChange={(e) => set(f.key, f.key === 'phone' ? e.target.value.replace(/\D/g, '').slice(0, 10) : e.target.value)} />}
              </label>
            ))}
          </>}
        </div>

        <aside className="ws-side">
          <section className="crm-card ws-card">
            {embedded && <StatusPills r={r} />}
            {type === 'article' && <p className="crm-sub ws-addr">{one.address ?? `/blog/${r.key}`}{r.live && one.address && <> <a href={one.address} target="_blank" rel="noreferrer" aria-label="Open on the website"><ExternalLink size={13} aria-hidden /></a></>}</p>}
            {r.aiDrafted && <p className="ws-ai-note"><Sparkles size={15} aria-hidden /> First draft written by AI. Check every fact.</p>}
            {r.reviewedByName && <p className="crm-sub" style={{ margin: 0 }}>Reviewed by {r.reviewedByName}{r.reviewedAt ? `, ${when(r.reviewedAt)}` : ''}</p>}
            <div className="ws-actions">
              {me.write && !r.archived && r.status !== 'publishing' && <button type="button" className="crm-btn is-secondary" disabled={!dirty || !!busy} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : dirty ? 'Save draft' : 'Saved'}</button>}
              {canSubmit && r.status !== 'publishing' && <button type="button" className="crm-btn" disabled={!!busy} onClick={() => void submit()}><Send size={16} aria-hidden /> {busy === 'submit' ? 'Sending…' : one.needsReview ? 'Send for review' : 'Mark ready to publish'}</button>}
              {r.status === 'review' && !dirty && (me.review ? <>
                <button type="button" className="crm-btn" disabled={!!busy} onClick={() => void approve()}><Check size={16} aria-hidden /> {busy === 'approve' ? 'Approving…' : 'Approve'}</button>
                <button type="button" className="crm-btn is-secondary" disabled={!!busy} onClick={() => setSendBack(true)}><Undo2 size={16} aria-hidden /> Send back</button>
              </> : <p className="crm-sub" style={{ margin: 0 }}>Waiting for a reviewer to read and approve it.</p>)}
              {r.status === 'approved' && !dirty && (me.publish
                ? <button type="button" className="crm-btn" disabled={!!busy} onClick={() => void publish('publish')}><Rocket size={16} aria-hidden /> {busy === 'publish' ? 'Sending…' : 'Publish to the website'}</button>
                : <p className="crm-sub" style={{ margin: 0 }}>Ready. Someone with the publish right puts it on the website.</p>)}
              {r.status === 'approved' && !dirty && me.review && one.needsReview && <button type="button" className="crm-btn is-secondary" disabled={!!busy} onClick={() => setSendBack(true)}><Undo2 size={16} aria-hidden /> Send back</button>}
              {r.status === 'publishing' && <p className="crm-sub" style={{ margin: 0 }}>Being published now. Progress shows on the Website page.</p>}
            </div>
            {type === 'article' && <button type="button" className="ws-link" onClick={() => setPreview((p) => !p)}>{preview ? 'Back to editing' : 'Preview how it reads'}</button>}
          </section>

          {(one.problems.length > 0 || one.warnings.length > 0) && !dirty && (
            <section className="crm-card ws-card">
              {one.problems.length > 0 && <><h3 className="ws-h3">To fix before it can go further</h3><ul className="ws-list is-bad">{one.problems.map((p) => <li key={p}>{p}</li>)}</ul></>}
              {one.warnings.length > 0 && <><h3 className="ws-h3">Worth improving for Google</h3><ul className="ws-list">{one.warnings.map((p) => <li key={p}>{p}</li>)}</ul></>}
            </section>
          )}

          {type === 'article' && data.aiOn && (me.write || me.review) && (
            <section className="crm-card ws-card">
              <h3 className="ws-h3"><Sparkles size={15} aria-hidden /> Writing help</h3>
              <div className="ws-actions">
                {me.write && !locked && <button type="button" className="crm-btn is-secondary is-sm" disabled={!!busy} onClick={() => void suggest()}>{busy === 'suggest' ? 'Thinking…' : 'Suggest titles and summaries'}</button>}
                <button type="button" className="crm-btn is-secondary is-sm" disabled={!!busy} onClick={() => void check()}>{busy === 'claims' ? 'Reading…' : 'Find claims that need a source'}</button>
              </div>
              {ideas && <>
                <h4 className="ws-h4">Titles</h4>
                <ul className="ws-ideas">{ideas.titles.map((t) => <li key={t}><span>{t}</span><button type="button" className="ws-link" onClick={() => set('title', t)}>Use</button></li>)}</ul>
                <h4 className="ws-h4">Summaries</h4>
                <ul className="ws-ideas">{ideas.excerpts.map((t) => <li key={t}><span>{t}</span><button type="button" className="ws-link" onClick={() => set('excerpt', t)}>Use</button></li>)}</ul>
              </>}
              {claims && (claims.length === 0 ? <p className="crm-sub" style={{ margin: 0 }}>The AI found no sentence that stands out. A doctor should still read it all.</p>
                : <ul className="ws-claims">{claims.map((c) => <li key={c.text}><q>{c.text}</q><span className="crm-sub">{c.why}</span></li>)}</ul>)}
              <p className="crm-sub" style={{ margin: 0 }}>Suggestions only. The AI can miss things and can be wrong.</p>
            </section>
          )}

          {type !== 'site' && (
            <section className="crm-card ws-card">
              <div className="ws-actions">
                <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setHistory(true)}><History size={15} aria-hidden /> History ({one.versions.length})</button>
                {r.live && me.publish && r.status !== 'publishing' && <button type="button" className="crm-btn is-secondary is-sm" disabled={!!busy} onClick={() => { if (window.confirm(`Take "${r.title}" off the website? It stays here and can be published again.`)) void publish('unpublish'); }}><Globe size={15} aria-hidden /> Take off the website</button>}
                {me.write && !r.live && !r.archived && r.status !== 'publishing' && <button type="button" className="crm-btn is-secondary is-sm" disabled={!!busy} onClick={() => void archive(false)}><Archive size={15} aria-hidden /> Archive</button>}
                {me.write && r.archived && <button type="button" className="crm-btn is-secondary is-sm" disabled={!!busy} onClick={() => void archive(true)}><Undo2 size={15} aria-hidden /> Bring back</button>}
              </div>
            </section>
          )}
          {type === 'site' && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setHistory(true)}><History size={15} aria-hidden /> History ({one.versions.length})</button>}
        </aside>
      </div>

      {sendBack && (
        <Modal title="Send back to the writer" onClose={() => setSendBack(false)} actions={<>
          <button type="button" className="crm-btn is-secondary" onClick={() => setSendBack(false)}>Cancel</button>
          <button type="button" className="crm-btn" disabled={!note.trim() || !!busy} onClick={() => void back()}>{busy === 'back' ? 'Sending…' : 'Send back'}</button>
        </>}>
          <label className="crm-field">What needs changing?<textarea className="crm-textarea" rows={4} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="e.g. The part about surgery is not right for small stones. Please correct it and add a source." /></label>
        </Modal>
      )}
      {history && (
        <Modal title="History" onClose={() => setHistory(false)} wide actions={<button type="button" className="crm-btn" onClick={() => setHistory(false)}>Close</button>}>
          <ul className="ws-history">
            {one.versions.map((v) => (
              <li key={v.id}>
                <div><strong>{ACTION[v.action] ?? v.action}</strong> <span className="crm-sub">version {v.version}, {v.byName}, {when(v.at)}</span>{v.note && <div className="ws-note">{v.note}</div>}</div>
                {me.write && !locked && v.version !== r.version && <button type="button" className="crm-btn is-secondary is-sm" disabled={!!busy} onClick={() => { if (window.confirm(`Make version ${v.version} the draft again? The current text stays in the history.`)) void restore(v.id); }}>Put back</button>}
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}

function Preview({ doc, pic, reviewer }: { doc: Doc; pic: string | null; reviewer?: string | null }) {
  return (
    <article className="ws-preview">
      <p className="crm-sub" style={{ margin: 0 }}>A plain preview of the text. The website adds its own design.</p>
      <h1>{doc.title || 'Untitled'}</h1>
      <p className="ws-preview-meta">{doc.author}{reviewer ? ` · Medically reviewed by ${reviewer}` : ''}</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- a private picture loaded as a blob */}
      {pic && <img src={pic} alt={doc.image?.alt ?? ''} />}
      <p className="ws-preview-lead">{doc.excerpt}</p>
      {(doc.sections ?? []).map((s, i) => (
        <section key={i}><h2>{s.heading}</h2>{s.paragraphs.map((p, n) => <p key={n}>{p}</p>)}{s.points && s.points.length > 0 && <ul>{s.points.map((p, n) => <li key={n}>{p}</li>)}</ul>}</section>
      ))}
      {(doc.references ?? []).length > 0 && <section><h2>References</h2><ol>{(doc.references ?? []).map((x, i) => <li key={i}>{x.label} <span className="crm-sub">{x.url}</span></li>)}</ol></section>}
    </article>
  );
}

function DeveloperTab({ data }: { data: Data }) {
  const [files, setFiles] = useState<{ path: string; text: string }[] | null>(null);
  const [at, setAt] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { crm.get<{ files: { path: string; text: string }[] }>('/api/v1/website/files').then((f) => setFiles(f.files)).catch((e) => setErr(errText(e))); }, []);
  return (
    <>
      <section className="crm-card ws-card">
        <h2 className="ws-h2">How publishing works</h2>
        <ol className="ws-steps is-static">
          <li><span className="ws-step-dot" aria-hidden>1</span>CRM writes the content files on a new branch</li>
          <li><span className="ws-step-dot" aria-hidden>2</span>Pull request; the website&apos;s build and checks run</li>
          <li><span className="ws-step-dot" aria-hidden>3</span>Checks pass: the CRM merges it</li>
          <li><span className="ws-step-dot" aria-hidden>4</span>The website deploys as usual</li>
        </ol>
        <p className="crm-sub" style={{ margin: 0 }}>Repository: {data.setup.repo ?? 'not connected'}{data.setup.branch ? `, branch ${data.setup.branch}` : ''}. If a check fails, the pull request is closed, the live site is unchanged and the reason shows in Publish → Details with the end of the build log. Only the files for the kind of content being published are written.</p>
      </section>
      <section className="crm-card ws-card">
        <h2 className="ws-h2">The files as the website has them</h2>
        <p className="crm-sub" style={{ margin: 0 }}>Built from what is live now, exactly as the CRM writes them. To change the shape of the content, change the website&apos;s <code>src/data/content.ts</code> and these rules together.</p>
        {err && <ErrorBox message={err} />}
        {!files && !err && <Skeleton h={200} />}
        {files && <>
          <div className="crm-chips" role="group" aria-label="File">{files.map((f, i) => <button key={f.path} type="button" className="crm-chip" aria-pressed={at === i} onClick={() => setAt(i)}><FileText size={14} aria-hidden /> {f.path}</button>)}</div>
          <pre className="ws-pre is-tall">{files[at]?.text || '(nothing live of this kind yet)'}</pre>
        </>}
      </section>
    </>
  );
}

function SetupTab({ setup, onChanged, say }: { setup: Setup; onChanged: () => void; say: (m: string) => void }) {
  const [f, setF] = useState({
    repo: setup.repoOwner && setup.repoName ? `${setup.repoOwner}/${setup.repoName}` : '', branch: setup.branch ?? 'main', contentDir: setup.contentDir ?? 'content',
    mediaDir: setup.mediaDir ?? 'public/media/blogs', siteUrl: setup.siteUrl ?? '', appId: setup.appId ?? '', privateKey: '', token: '',
    departments: setup.departments.join(', '), reviewFaq: setup.reviewTypes.includes('faq'), reviewSite: setup.reviewTypes.includes('site'), ai: setup.ai,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [checks, setChecks] = useState<{ what: string; ok: boolean; detail: string }[] | null>(null);
  const up = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy('save'); setErr(null);
    try {
      await crm.put('/api/v1/website/setup', {
        repoOwner: f.repo, repoName: '', branch: f.branch, contentDir: f.contentDir, mediaDir: f.mediaDir, siteUrl: f.siteUrl, appId: f.appId,
        privateKey: f.privateKey, token: f.token, departments: f.departments.split(',').map((x) => x.trim()).filter(Boolean),
        reviewTypes: ['article', ...(f.reviewFaq ? ['faq'] : []), ...(f.reviewSite ? ['site'] : [])], ai: f.ai,
      });
      setF((x) => ({ ...x, privateKey: '', token: '' })); say('Saved.'); onChanged();
    } catch (e) { setErr(errText(e)); } finally { setBusy(null); }
  };
  const test = async () => { setBusy('test'); setErr(null); try { setChecks((await crm.post<{ checks: { what: string; ok: boolean; detail: string }[] }>('/api/v1/website/setup/test')).checks); } catch (e) { setErr(errText(e)); } finally { setBusy(null); } };
  const bringIn = async () => {
    setBusy('import'); setErr(null);
    try { const r = await crm.post<{ articles: number; faqs: number; site: boolean }>('/api/v1/website/import'); say(`Brought in ${r.articles} articles, ${r.faqs} questions${r.site ? ' and the hospital details' : ''}.`); onChanged(); }
    catch (e) { setErr(errText(e)); } finally { setBusy(null); }
  };
  return (
    <>
      <section className="crm-card ws-card">
        <h2 className="ws-h2">1. Create a GitHub App for the CRM <span className="crm-sub">(once, about 5 minutes)</span></h2>
        <ol className="ws-list is-num">
          <li>On GitHub: your organisation → Settings → Developer settings → GitHub Apps → <strong>New GitHub App</strong>.</li>
          <li>Name it (for example &quot;NexMarket Website&quot;). Homepage URL: this CRM&apos;s address. Untick <strong>Webhook → Active</strong>.</li>
          <li>Repository permissions: <strong>Contents</strong> Read and write, <strong>Pull requests</strong> Read and write, <strong>Checks</strong> Read-only, <strong>Actions</strong> Read-only. Nothing else.</li>
          <li>Create it. Copy the <strong>App ID</strong>. Under Private keys press <strong>Generate a private key</strong>; a .pem file downloads.</li>
          <li><strong>Install App</strong> → pick <strong>Only select repositories</strong> → the website&apos;s repository.</li>
        </ol>
        <p className="crm-sub" style={{ margin: 0 }}>The app can only touch that one repository. The private key is stored encrypted here and is never shown again.</p>
      </section>
      <section className="crm-card ws-card">
        <h2 className="ws-h2">2. Connect</h2>
        {setup.keyUnreadable && <div className="ws-banner">The saved key can&apos;t be read any more (the server&apos;s encryption key changed). Paste it again.</div>}
        <div className="ms-form">
          <div className="ms-two">
            <label className="crm-field">Repository (owner/name, or its GitHub address)<input className="crm-input" value={f.repo} onChange={(e) => up('repo', e.target.value)} placeholder="NexEagle-HealthcareAI/Glisan_akbari_web" /></label>
            <label className="crm-field">Website address<input className="crm-input" value={f.siteUrl} onChange={(e) => up('siteUrl', e.target.value)} placeholder="https://glisanhospitalpurnia.in" inputMode="url" /></label>
          </div>
          <div className="ms-two">
            <label className="crm-field">App ID<input className="crm-input" value={f.appId} onChange={(e) => up('appId', e.target.value.trim())} placeholder="e.g. 1234567" /></label>
            <label className="crm-field">Branch the live website is built from<input className="crm-input" value={f.branch} onChange={(e) => up('branch', e.target.value)} /></label>
          </div>
          <label className="crm-field">Private key (.pem){setup.privateKey ? <span className="crm-sub"> saved, ends {setup.privateKey}. Leave empty to keep it.</span> : null}
            <textarea className="crm-textarea ws-mono" rows={4} value={f.privateKey} onChange={(e) => up('privateKey', e.target.value)} placeholder={'-----BEGIN RSA PRIVATE KEY-----\n…\n-----END RSA PRIVATE KEY-----'} autoComplete="off" spellCheck={false} />
          </label>
          <details className="ws-more"><summary>More settings</summary>
            <div className="ms-form" style={{ marginTop: 12 }}>
              <div className="ms-two">
                <label className="crm-field">Content folder<input className="crm-input" value={f.contentDir} onChange={(e) => up('contentDir', e.target.value)} /></label>
                <label className="crm-field">Folder for article pictures<input className="crm-input" value={f.mediaDir} onChange={(e) => up('mediaDir', e.target.value)} /></label>
              </div>
              <label className="crm-field">Instead of an app: a fine-grained token{setup.token ? <span className="crm-sub"> saved, ends {setup.token}</span> : null}<input className="crm-input ws-mono" type="password" value={f.token} onChange={(e) => up('token', e.target.value)} placeholder="Leave empty when using the app" autoComplete="off" /></label>
              <label className="crm-field">Departments an article can belong to (the website&apos;s ids, comma-separated)<input className="crm-input" value={f.departments} onChange={(e) => up('departments', e.target.value)} /></label>
            </div>
          </details>
          <fieldset className="ms-set"><legend>Who must approve before publishing</legend>
            <label className="ws-check"><input type="checkbox" checked disabled /> Articles: always, by a named reviewer</label>
            <label className="ws-check"><input type="checkbox" checked={f.reviewFaq} onChange={(e) => up('reviewFaq', e.target.checked)} /> Questions and answers</label>
            <label className="ws-check"><input type="checkbox" checked={f.reviewSite} onChange={(e) => up('reviewSite', e.target.checked)} /> Hospital details</label>
          </fieldset>
          <fieldset className="ms-set"><legend>Writing help (AI)</legend>
            <label className="ws-check"><input type="checkbox" checked={f.ai} onChange={(e) => up('ai', e.target.checked)} /> Let writers draft articles and get title suggestions with AI</label>
            <p className="crm-sub" style={{ margin: '4px 0 0' }}>Only text meant for the public website is sent. AI drafts are labelled, never published by themselves, and still need the reviewer.</p>
          </fieldset>
          {err && <p className="ms-err" role="alert">{err}</p>}
          <div className="ws-actions is-row">
            <button type="button" className="crm-btn" disabled={!!busy} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
            <button type="button" className="crm-btn is-secondary" disabled={!!busy || !setup.connected} onClick={() => void test()}>{busy === 'test' ? 'Testing…' : 'Test the connection'}</button>
          </div>
          {checks && <ul className="ws-checks">{checks.map((c) => <li key={c.what} className={c.ok ? 'is-ok' : 'is-bad'}>{c.ok ? <Check size={15} aria-hidden /> : <X size={15} aria-hidden />}<span><strong>{c.what}</strong><br /><span className="crm-sub">{c.detail}</span></span></li>)}</ul>}
        </div>
      </section>
      <section className="crm-card ws-card">
        <h2 className="ws-h2">3. Bring in what is on the website now</h2>
        <p className="crm-sub" style={{ margin: 0 }}>Reads the website&apos;s articles, questions and hospital details into the CRM as &quot;On the website&quot;, so the first publish from here loses nothing. It only adds what the CRM doesn&apos;t have; it is safe to run again.{setup.importedAt ? ` Last done ${when(setup.importedAt)}.` : ''}</p>
        <div className="ws-actions is-row"><button type="button" className={`crm-btn${setup.imported ? ' is-secondary' : ''}`} disabled={!!busy || !setup.connected} onClick={() => void bringIn()}><MessageCircleQuestion size={16} aria-hidden /> {busy === 'import' ? 'Reading the website…' : setup.imported ? 'Bring in again' : 'Bring in from the website'}</button></div>
      </section>
      <section className="crm-card ws-card">
        <h2 className="ws-h2">4. Say who does what</h2>
        <p className="crm-sub" style={{ margin: 0 }}>In Users &amp; roles there are four rights: Website (write), Website: review, Website: publish and Website: developer. Give &quot;review&quot; to the doctor or hospital person whose name should show on articles as the medical reviewer.</p>
      </section>
    </>
  );
}
