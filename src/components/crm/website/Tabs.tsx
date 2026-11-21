'use client';

import { useEffect, useState } from 'react';
import {
  ArrowDown, ArrowUp, Check, ExternalLink, FileText, FlaskConical, ImagePlus, ListChecks, MessageCircleQuestion, Plus, RefreshCw, Rocket, Sparkles, X,
} from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { Empty, ErrorBox, Modal, Pill, Skeleton, type Tone } from '@/components/crm/ui';
import { StatusPills } from './Editor';
import { MediaThumb, UploadForm } from './Fields';
import { ChainPanel } from './Growth';
import { KIND, dayText, errText, nice, when, type Data, type Doc, type Job, type Kind, type Media, type Row, type Setup } from './shared';

/** A publish in progress, left to right: checks, accept, go live. */
export function Progress({ job }: { job: Job }) {
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

export function List({ rows, onOpen, extra }: { rows: Row[]; onOpen: (id: string) => void; extra?: (r: Row) => React.ReactNode }) {
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

const ORDERED: Kind[] = ['faq', 'doctor', 'testimonial', 'notice'];
const KIND_CHIPS: [Kind | 'all', string][] = [['all', 'Everything'], ['article', 'Articles'], ['faq', 'Questions'], ['doctor', 'Doctors'], ['camp', 'Health camps'], ['notice', 'Notices'], ['testimonial', 'Patient stories'], ['service', 'Service pages'], ['location', 'Areas served'], ['redirect', 'Redirects']];

export function ContentTab({ data, kind, setKind, onOpen, onNew, onChanged, say }: { data: Data; kind: Kind | 'all'; setKind: (k: Kind | 'all') => void; onOpen: (id: string) => void; onNew: (k: Kind) => void; onChanged: () => void; say: (m: string) => void }) {
  const [show, setShow] = useState<'all' | 'draft' | 'live' | 'archived'>('all');
  const [q, setQ] = useState('');
  const type = data.types.find((t) => t.key === kind);
  const rows = data.items.filter((r) => r.type !== 'site')
    .filter((r) => (show === 'archived' ? r.archived : !r.archived))
    .filter((r) => kind === 'all' || r.type === kind)
    .filter((r) => show === 'draft' ? !r.live : show === 'live' ? r.live : true)
    .filter((r) => !q.trim() || r.title.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((x, y) => (kind !== 'all' && ORDERED.includes(kind) ? x.sortOrder - y.sortOrder : kind === 'camp' ? (x.date ?? '').localeCompare(y.date ?? '') : 0));
  const ordered = kind !== 'all' && ORDERED.includes(kind) && show === 'all' && !q.trim();
  const move = async (id: string, by: number) => {
    const ids = rows.map((f) => f.id); const i = ids.indexOf(id); const j = i + by;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await crm.post(`/api/v1/website/order?type=${kind}`, { ids }); onChanged(); say('Order saved. It shows on the website the next time one of these is published.'); } catch (e) { say(errText(e)); }
  };
  return (
    <>
      <div className="ws-filters">
        <div className="crm-chips" role="group" aria-label="Kind">
          {KIND_CHIPS.map(([k, l]) => <button key={k} type="button" className="crm-chip" aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}
        </div>
      </div>
      <div className="ws-filters">
        <div className="crm-chips" role="group" aria-label="Show">
          {([['all', 'All'], ['draft', 'Not on the website'], ['live', 'On the website'], ['archived', 'Archived']] as const).map(([k, l]) => <button key={k} type="button" className="crm-chip" aria-pressed={show === k} onClick={() => setShow(k)}>{l}</button>)}
        </div>
        <label className="crm-sr" htmlFor="ws-q">Search titles</label>
        <input id="ws-q" className="crm-input ws-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" />
        {type && type.canCreate && data.me.write && <button type="button" className="crm-btn is-sm" onClick={() => onNew(type.key)}><Plus size={15} aria-hidden /> New {type.label.toLowerCase()}</button>}
      </div>
      {type && <p className="crm-sub ws-kind-help">{type.help}{type.needsReview ? ' A named reviewer approves each one before it is published.' : ''}</p>}
      {kind === 'all' && <ChainPanel onOpen={onOpen} onChanged={onChanged} say={say} />}
      {(kind === 'doctor' || kind === 'camp') && data.me.write && <CrmPanel kind={kind} onOpen={onOpen} onChanged={onChanged} />}
      {rows.length === 0
        ? <Empty title={show === 'archived' ? 'Nothing is archived' : 'Nothing here yet'}>{show === 'archived' ? null : kind === 'service' ? 'Service pages come in from the website (Setup → Bring in from the website).' : data.me.write ? 'Start with the New button above.' : 'Content shows here once someone writes it.'}</Empty>
        : <List rows={rows} onOpen={onOpen} extra={(r) => <>
            {r.type === 'camp' && r.date && <span className="crm-sub">{dayText(r.date)}</span>}
            {ordered && data.me.write && (
              <span className="ws-order" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="crm-btn is-secondary is-sm" aria-label={`Move "${r.title}" up`} disabled={rows[0]?.id === r.id} onClick={() => void move(r.id, -1)}><ArrowUp size={14} aria-hidden /></button>
                <button type="button" className="crm-btn is-secondary is-sm" aria-label={`Move "${r.title}" down`} disabled={rows[rows.length - 1]?.id === r.id} onClick={() => void move(r.id, 1)}><ArrowDown size={14} aria-hidden /></button>
              </span>)}
          </>} />}
    </>
  );
}

interface CrmRecords {
  doctors: { id: string; name: string; department?: string | null; qualification?: string | null; opd: string; itemId?: string | null }[];
  camps: { id: string; title: string; date: string; startTime: string; endTime: string; place?: string | null; status: string; itemId?: string | null }[];
}

/** The CRM's own doctors (Departments &amp; doctors) or upcoming camps (Health camps), to put on the website in one step. */
function CrmPanel({ kind, onOpen, onChanged }: { kind: 'doctor' | 'camp'; onOpen: (id: string) => void; onChanged: () => void }) {
  const [rec, setRec] = useState<CrmRecords | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open && !rec) crm.get<CrmRecords>('/api/v1/website/crm').then(setRec).catch((e) => setErr(errText(e))); }, [open, rec]);
  const make = async (id: string) => {
    setBusy(id); setErr(null);
    try { const r = await crm.post<{ id: string }>(`/api/v1/website/from-crm/${kind}/${id}`); onChanged(); onOpen(r.id); } catch (e) { setErr(errText(e)); setBusy(null); }
  };
  const list = kind === 'doctor' ? rec?.doctors ?? [] : rec?.camps ?? [];
  return (
    <details className="ws-crm-panel" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>{kind === 'doctor' ? 'From the CRM\'s doctors (Departments & doctors)' : 'From the CRM\'s upcoming health camps'}</summary>
      {err && <p className="ms-err" role="alert">{err}</p>}
      {open && !rec && !err && <Skeleton h={80} />}
      {rec && list.length === 0 && <p className="crm-sub">{kind === 'doctor' ? 'No doctors in the CRM yet.' : 'No upcoming camps in the CRM.'}</p>}
      <ul className="ws-ready">
        {kind === 'doctor' && rec?.doctors.map((d) => (
          <li key={d.id}><span className="ws-grow"><strong>{d.name}</strong> <span className="crm-sub">{[d.department, d.qualification, d.opd].filter(Boolean).join(' · ')}</span></span>
            {d.itemId ? <button type="button" className="ws-link" onClick={() => onOpen(d.itemId!)}>Open on the website list</button> : <button type="button" className="crm-btn is-secondary is-sm" disabled={!!busy} onClick={() => void make(d.id)}>{busy === d.id ? 'Adding…' : 'Add to the website'}</button>}</li>
        ))}
        {kind === 'camp' && rec?.camps.map((c) => (
          <li key={c.id}><span className="ws-grow"><strong>{c.title}</strong> <span className="crm-sub">{dayText(c.date)}, {c.startTime}–{c.endTime}{c.place ? `, ${c.place}` : ''} · {nice(c.status)}</span></span>
            {c.itemId ? <button type="button" className="ws-link" onClick={() => onOpen(c.itemId!)}>Open</button> : <button type="button" className="crm-btn is-secondary is-sm" disabled={!!busy} onClick={() => void make(c.id)}>{busy === c.id ? 'Adding…' : 'Put on the website'}</button>}</li>
        ))}
      </ul>
    </details>
  );
}

export function PublishTab({ data, onOpen, onChanged, say }: { data: Data; onOpen: (id: string) => void; onChanged: () => void; say: (m: string) => void }) {
  const ready = data.items.filter((i) => !i.archived && i.status === 'approved');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<Job | null>(null);
  const running = data.publishes.some((p) => p.running);
  const chosen = ready.filter((r) => picked.has(r.id));
  const go = async (target: 'live' | 'staging') => {
    setBusy(true); setErr(null);
    try { await crm.post('/api/v1/website/publish', { items: chosen.map((r) => ({ id: r.id, action: 'publish' })), target }); setPicked(new Set()); say(target === 'staging' ? 'Sent to staging. Progress shows at the top.' : 'Sent to the website. Progress shows at the top.'); onChanged(); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const planned = data.items.filter((i) => !i.archived && (i.publishAt || i.unpublishAt));
  const openJob = async (p: Job) => { try { setView(await crm.get<Job>(`/api/v1/website/publishes/${p.id}`)); } catch { setView(p); } };
  const tone = (s: Job['status']): Tone => (s === 'live' ? 'ok' : s === 'staged' ? 'info' : s === 'failed' || s === 'deploy_failed' ? 'bad' : 'accent');
  const label = (s: Job['status']) => (s === 'live' ? 'Live' : s === 'staged' ? 'On staging' : s === 'failed' ? 'Did not go live' : s === 'deploy_failed' ? 'Accepted, deploy failed' : 'Running');
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
              ? <div className="ws-actions is-row">
                  <button type="button" className="crm-btn" disabled={busy || running || chosen.length === 0} onClick={() => void go('live')}><Rocket size={16} aria-hidden /> {busy ? 'Sending…' : running ? 'A publish is running' : chosen.length ? `Publish ${chosen.length} to the website` : 'Tick what to publish'}</button>
                  {data.setup.hasStaging && <button type="button" className="crm-btn is-secondary" disabled={busy || running || chosen.length === 0} onClick={() => void go('staging')}><FlaskConical size={16} aria-hidden /> Put on staging first</button>}
                </div>
              : <p className="crm-sub" style={{ margin: 0 }}>You can&apos;t publish. Someone with the publish right does this.</p>}
          </>
        )}
      </section>
      {planned.length > 0 && (
        <section className="crm-card ws-card">
          <h2 className="ws-h2">Scheduled</h2>
          <ul className="ws-ready">{planned.map((r) => <li key={r.id}><span className="ws-grow"><strong>{r.title}</strong> <span className="crm-sub">{KIND[r.type]}{r.publishAt ? `, goes live ${when(r.publishAt)}` : ''}{r.unpublishAt ? `, comes off ${when(r.unpublishAt)}` : ''}{r.scheduledByName ? ` (set by ${r.scheduledByName})` : ''}</span></span><button type="button" className="ws-link" onClick={() => onOpen(r.id)}>Open</button></li>)}</ul>
          <p className="crm-sub" style={{ margin: 0 }}>Health camps also come off the website by themselves the day after the camp.</p>
        </section>
      )}
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

/** The few fields needed to start one; the rest is filled in the editor. */
const START: Partial<Record<Kind, { name: string; label: string; kind?: 'longtext' | 'date' | 'select' | 'path'; placeholder?: string; options?: string[]; optional?: boolean }[]>> = {
  doctor: [{ name: 'name', label: 'Name, as shown on the website', placeholder: 'e.g. Dr Aziz Ahmed' }],
  camp: [{ name: 'title', label: 'Title', placeholder: 'e.g. Free kidney check-up camp' }, { name: 'date', label: 'Day', kind: 'date' }, { name: 'place', label: 'Place', placeholder: 'e.g. Kasba Panchayat Bhawan' }],
  notice: [{ name: 'text', label: 'Notice (up to 220 characters)', kind: 'longtext', placeholder: 'e.g. The OPD is closed on Sunday 14 January.' }],
  testimonial: [{ name: 'name', label: 'Name shown (first name and initial)', placeholder: 'e.g. Ramesh K.' }, { name: 'quote', label: 'What the patient said', kind: 'longtext' }],
  redirect: [{ name: 'from', label: 'Old address', kind: 'path', placeholder: '/blogs/old-name' }, { name: 'to', label: 'New address', kind: 'path', placeholder: '/blogs/new-name' }],
  location: [{ name: 'town', label: 'Town or area', placeholder: 'e.g. Kasba' }, { name: 'district', label: 'District (optional)', placeholder: 'e.g. Purnia', optional: true }],
};

export function NewForm({ type, start, ai, data, onClose, onMade }: { type: Kind; start?: Doc; ai?: boolean; data: Data; onClose: () => void; onMade: (id: string) => void }) {
  const [title, setTitle] = useState(start?.title ?? '');
  const [dept, setDept] = useState(start?.departmentId ?? data.setup.departments[0] ?? '');
  const [cat, setCat] = useState(data.faqCategories[0] ?? '');
  const [answer, setAnswer] = useState('');
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fields = START[type];
  const kindLabel = data.types.find((t) => t.key === type)?.label ?? 'item';
  const save = async () => {
    if (!fields && !title.trim()) { setErr(type === 'faq' ? 'Write the question.' : 'Write the title.'); return; }
    if (fields?.some((f) => !f.optional && !(vals[f.name] ?? '').trim())) { setErr('Fill in each box.'); return; }
    setBusy(true); setErr(null);
    try {
      const body = fields ? { ...vals, ...(type === 'notice' ? { tone: 'info' } : {}), ...(type === 'camp' ? { startTime: '09:00', endTime: '14:00', free: true } : {}) }
        : type === 'faq' ? { question: title, answer, category: cat } : { ...(start ?? {}), title, departmentId: dept, author: start?.author ?? '' };
      const made = await crm.post<{ id: string }>('/api/v1/website', { type, data: body, aiDrafted: !!ai });
      onMade(made.id);
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Modal title={ai ? 'Save the AI draft' : `New ${kindLabel.toLowerCase()}`} onClose={onClose} actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="crm-btn" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save as a draft and open'}</button>
    </>}>
      <div className="ms-form">
        {ai && <p className="ws-ai-note"><Sparkles size={15} aria-hidden /> This is a first draft written by AI. Read every line and correct it before sending it for review. It has no references; add real ones.</p>}
        {fields ? fields.map((f) => (
          <label key={f.name} className="crm-field">{f.label}
            {f.kind === 'longtext'
              ? <textarea className="crm-textarea" rows={3} value={vals[f.name] ?? ''} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })} placeholder={f.placeholder} />
              : <input className="crm-input" type={f.kind === 'date' ? 'date' : 'text'} value={vals[f.name] ?? ''} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })} placeholder={f.placeholder} />}
          </label>
        )) : <>
          <label className="crm-field">{type === 'faq' ? 'The question, as a patient would ask it' : 'Title'}<input className="crm-input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={type === 'faq' ? 'e.g. Do I need an appointment for the OPD?' : 'e.g. Kidney stones: signs and when to see a doctor'} /></label>
          {type === 'faq' ? <>
            <label className="crm-field">Answer<textarea className="crm-textarea" rows={4} value={answer} onChange={(e) => setAnswer(e.target.value)} /></label>
            <label className="crm-field">What it is about<select className="crm-input" value={cat} onChange={(e) => setCat(e.target.value)}>{data.faqCategories.map((c) => <option key={c} value={c}>{nice(c)}</option>)}</select></label>
          </> : (
            <label className="crm-field">Department<select className="crm-input" value={dept} onChange={(e) => setDept(e.target.value)}>{data.setup.departments.map((d) => <option key={d} value={d}>{nice(d)}</option>)}</select></label>
          )}
        </>}
        {type === 'article' && <p className="crm-sub" style={{ margin: 0 }}>The article&apos;s web address is made from the title. It can be changed later; the old address then sends people to the new one.</p>}
        {type === 'testimonial' && <p className="crm-sub" style={{ margin: 0 }}>A story is published only with the patient&apos;s written consent on record, which you note in the editor. Don&apos;t include anything about their health they didn&apos;t agree to share.</p>}
        {err && <p className="ms-err" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

export function AiDraftForm({ data, onClose, onDraft }: { data: Data; onClose: () => void; onDraft: (d: Doc) => void }) {
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

export function DeveloperTab({ data, onChanged, say }: { data: Data; onChanged: () => void; say: (m: string) => void }) {
  const [files, setFiles] = useState<{ path: string; text: string }[] | null>(null);
  const [at, setAt] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const sync = async () => {
    setSyncing(true); setErr(null);
    try { const r = await crm.post<{ changed: number }>('/api/v1/website/sync'); say(r.changed ? `${r.changed} changes made on GitHub were recorded.` : 'Nothing was changed directly on GitHub.'); onChanged(); }
    catch (e) { setErr(errText(e)); } finally { setSyncing(false); }
  };
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
        <h2 className="ws-h2">Changes made directly on GitHub</h2>
        <p className="crm-sub" style={{ margin: 0 }}>Every 10 minutes the CRM reads the content files on {data.setup.branch ?? 'the live branch'}. A change made there by hand is recorded as a new version, so this page always shows what is live. A draft open here is kept, with a note.{data.setup.syncedAt ? ` Last checked ${when(data.setup.syncedAt)}.` : ''}</p>
        <div className="ws-actions is-row"><button type="button" className="crm-btn is-secondary is-sm" disabled={syncing || !data.setup.connected} onClick={() => void sync()}><RefreshCw size={15} aria-hidden /> {syncing ? 'Checking…' : 'Check GitHub now'}</button></div>
      </section>
      <section className="crm-card ws-card">
        <h2 className="ws-h2">Content types</h2>
        <p className="crm-sub" style={{ margin: 0 }}>Each kind of content, its file, and its fields. The website&apos;s <code>src/data/content.ts</code> checks the same rules when it builds. A new kind needs a change in both places.</p>
        <div className="crm-table-wrap"><table className="crm-table ws-types">
          <thead><tr><th>Kind</th><th>File</th><th>Review</th><th>Fields</th></tr></thead>
          <tbody>{data.types.map((t) => (
            <tr key={t.key}>
              <td><strong>{t.plural}</strong><div className="crm-sub">{t.help}</div></td>
              <td><code>{t.file}</code><div className="crm-sub">{t.shape === 'map' ? 'by id' : t.shape === 'single' ? 'one object' : 'a list'}</div></td>
              <td>{t.needsReview ? 'Named reviewer' : 'No'}</td>
              <td className="ws-fields">{t.fields.map((f) => <span key={f.name} className={f.crmOnly ? 'is-crm' : ''} title={f.crmOnly ? 'Kept in the CRM only' : undefined}>{f.name}{f.required ? '*' : ''}</span>)}</td>
            </tr>))}</tbody>
        </table></div>
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

export function SetupTab({ setup, onChanged, say }: { setup: Setup; onChanged: () => void; say: (m: string) => void }) {
  const [f, setF] = useState({
    repo: setup.repoOwner && setup.repoName ? `${setup.repoOwner}/${setup.repoName}` : '', branch: setup.branch ?? 'main', contentDir: setup.contentDir ?? 'content',
    mediaDir: setup.mediaDir ?? 'public/media/blogs', siteUrl: setup.siteUrl ?? '', appId: setup.appId ?? '', privateKey: '', token: '',
    departments: setup.departments.join(', '), review: setup.reviewTypes, ai: setup.ai, stagingBranch: setup.stagingBranch ?? '', scanFiles: setup.scanFiles ?? 'src/data/config.ts', reReviewMonths: String(setup.reReviewMonths ?? 12),
  });
  const [counts, setCounts] = useState<{ type: string; label: string; count: number; found: boolean }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [checks, setChecks] = useState<{ what: string; ok: boolean; detail: string }[] | null>(null);
  const up = (k: keyof typeof f, v: string | boolean | string[]) => setF((x) => ({ ...x, [k]: v }));
  const REVIEWABLE: [string, string][] = [['service', 'Service pages'], ['testimonial', 'Patient stories'], ['faq', 'Questions and answers'], ['doctor', 'Doctors'], ['camp', 'Health camps'], ['notice', 'Notices'], ['site', 'Hospital details']];
  const save = async () => {
    setBusy('save'); setErr(null);
    try {
      await crm.put('/api/v1/website/setup', {
        repoOwner: f.repo, repoName: '', branch: f.branch, contentDir: f.contentDir, mediaDir: f.mediaDir, siteUrl: f.siteUrl, appId: f.appId,
        privateKey: f.privateKey, token: f.token, departments: f.departments.split(',').map((x) => x.trim()).filter(Boolean),
        reviewTypes: ['article', ...f.review.filter((x) => x !== 'article')], ai: f.ai, stagingBranch: f.stagingBranch, scanFiles: f.scanFiles, reReviewMonths: Number(f.reReviewMonths) || 12,
      });
      setF((x) => ({ ...x, privateKey: '', token: '' })); say('Saved.'); onChanged();
    } catch (e) { setErr(errText(e)); } finally { setBusy(null); }
  };
  const test = async () => { setBusy('test'); setErr(null); try { setChecks((await crm.post<{ checks: { what: string; ok: boolean; detail: string }[] }>('/api/v1/website/setup/test')).checks); } catch (e) { setErr(errText(e)); } finally { setBusy(null); } };
  const bringIn = async () => {
    setBusy('import'); setErr(null);
    try {
      const r = await crm.post<{ counts: { type: string; label: string; count: number; found: boolean }[] }>('/api/v1/website/import');
      setCounts(r.counts); say(`Brought in ${r.counts.reduce((n, c) => n + c.count, 0)} new items.`); onChanged();
    }
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
              <div className="ms-two">
                <label className="crm-field">Staging branch (optional)<input className="crm-input" value={f.stagingBranch} onChange={(e) => up('stagingBranch', e.target.value)} placeholder="e.g. staging" /></label>
                <label className="crm-field">Code files to read for missing information<input className="crm-input" value={f.scanFiles} onChange={(e) => up('scanFiles', e.target.value)} /></label>
              </div>
              <label className="crm-field">Instead of an app: a fine-grained token{setup.token ? <span className="crm-sub"> saved, ends {setup.token}</span> : null}<input className="crm-input ws-mono" type="password" value={f.token} onChange={(e) => up('token', e.target.value)} placeholder="Leave empty when using the app" autoComplete="off" /></label>
              <label className="crm-field">Departments an article can belong to (the website&apos;s ids, comma-separated)<input className="crm-input" value={f.departments} onChange={(e) => up('departments', e.target.value)} /></label>
            </div>
          </details>
          <fieldset className="ms-set"><legend>Who must approve before publishing</legend>
            <label className="ws-check"><input type="checkbox" checked disabled /> Articles: always, by a named reviewer</label>
            {REVIEWABLE.map(([k, l]) => <label key={k} className="ws-check"><input type="checkbox" checked={f.review.includes(k)} onChange={(e) => up('review', e.target.checked ? [...f.review, k] : f.review.filter((x) => x !== k))} /> {l}</label>)}
            <label className="crm-field" style={{ marginTop: 8 }}>Review medical pages again every (months)<input className="crm-input" type="number" min={1} max={60} value={f.reReviewMonths} onChange={(e) => up('reReviewMonths', e.target.value)} style={{ maxWidth: 120 }} /></label>
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
        <p className="crm-sub" style={{ margin: 0 }}>Reads the website&apos;s articles, questions, hospital details, doctors, camps, notices, patient stories, redirects and service pages into the CRM as &quot;On the website&quot;, so the first publish from here loses nothing. It only adds what the CRM doesn&apos;t have; it is safe to run again.{setup.importedAt ? ` Last done ${when(setup.importedAt)}.` : ''}</p>
        <div className="ws-actions is-row"><button type="button" className={`crm-btn${setup.imported ? ' is-secondary' : ''}`} disabled={!!busy || !setup.connected} onClick={() => void bringIn()}><MessageCircleQuestion size={16} aria-hidden /> {busy === 'import' ? 'Reading the website…' : setup.imported ? 'Bring in again' : 'Bring in from the website'}</button></div>
        {counts && <ul className="ws-checks">{counts.map((c) => <li key={c.type} className={c.found ? 'is-ok' : ''}>{c.found ? <Check size={15} aria-hidden /> : <X size={15} aria-hidden />}<span><strong>{c.label}</strong> <span className="crm-sub">{c.found ? `${c.count} new` : 'not on the website yet (its file arrives with the next website update)'}</span></span></li>)}</ul>}
      </section>
      <section className="crm-card ws-card">
        <h2 className="ws-h2">4. Say who does what</h2>
        <p className="crm-sub" style={{ margin: 0 }}>In Users &amp; roles there are four rights: Website (write), Website: review, Website: publish and Website: developer. Give &quot;review&quot; to the doctor or hospital person whose name should show on articles as the medical reviewer.</p>
      </section>
    </>
  );
}


/** The media library: every picture, where it is used, and whether the website has it yet. */
export function MediaTab({ data, onChanged, say }: { data: Data; onChanged: () => void; say: (m: string) => void }) {
  const [items, setItems] = useState<Media[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [replace, setReplace] = useState<Media | null>(null);
  const [edit, setEdit] = useState<Media | null>(null);
  const [alt, setAlt] = useState('');
  const [archived, setArchived] = useState(false);
  const load = () => crm.get<{ items: Media[] }>('/api/v1/website/media').then((r) => setItems(r.items)).catch((e) => setErr(errText(e)));
  useEffect(() => { void load(); }, []);
  const act = async (fn: () => Promise<unknown>, m: string) => { setErr(null); try { await fn(); say(m); await load(); onChanged(); } catch (e) { setErr(errText(e)); } };
  const shown = (items ?? []).filter((m) => m.archived === archived);
  const copy = (path: string) => { void navigator.clipboard?.writeText(path); say('Address copied.'); };
  return (
    <>
      <div className="ws-filters">
        <div className="crm-chips" role="group" aria-label="Show"><button type="button" className="crm-chip" aria-pressed={!archived} onClick={() => setArchived(false)}>In use</button><button type="button" className="crm-chip" aria-pressed={archived} onClick={() => setArchived(true)}>Archived</button></div>
        {data.me.write && <button type="button" className="crm-btn is-sm" onClick={() => setAdding(true)}><ImagePlus size={15} aria-hidden /> Add a picture</button>}
      </div>
      <p className="crm-sub ws-kind-help">Pictures for doctors, camps and other pages. Each is made at most 1600 pixels wide and saved as WebP before upload. A picture goes to the website with the first thing published that uses it; after it is replaced, publish something that uses it (or press Send to the website).</p>
      {err && <ErrorBox message={err} />}
      {!items && !err && <Skeleton h={240} />}
      {items && shown.length === 0 && <Empty title={archived ? 'Nothing archived' : 'No pictures yet'}>{archived ? null : 'Add one with the button above.'}</Empty>}
      <div className="ws-media-grid">
        {shown.map((m) => (
          <article key={m.id} className="ws-media-card">
            <MediaThumb media={m} />
            <span className="ws-media-name">{m.name}</span>
            <span className="crm-sub">{m.alt}</span>
            <span className="crm-sub">{m.width && m.height ? `${m.width} × ${m.height}, ` : ''}{Math.round(m.bytes / 1024)} KB · {m.onSite ? 'on the website' : 'not on the website yet'}</span>
            {m.usedBy.length > 0 ? <span className="crm-sub">Used by: {m.usedBy.map((u) => `${u.title}${u.live ? ' (live)' : ''}`).join(', ')}</span> : <span className="crm-sub">Not used yet.</span>}
            <span className="ws-media-actions">
              <button type="button" className="crm-btn is-secondary is-sm" onClick={() => copy(m.path)}>Copy address</button>
              {data.me.write && !m.archived && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => { setEdit(m); setAlt(m.alt); }}>Description</button>}
              {data.me.write && !m.archived && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setReplace(m)}>Replace</button>}
              {data.me.publish && !m.archived && !m.onSite && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void act(() => crm.post('/api/v1/website/publish', { items: [{ id: m.id, action: 'media' }] }), 'Sending the picture to the website.')}>Send to the website</button>}
              {data.me.write && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void act(() => crm.post(`/api/v1/website/media/${m.id}/archive${m.archived ? '?undo=true' : ''}`), m.archived ? 'Brought back.' : 'Archived.')}>{m.archived ? 'Bring back' : 'Archive'}</button>}
            </span>
          </article>
        ))}
      </div>
      {adding && <UploadForm onClose={() => setAdding(false)} onDone={() => { setAdding(false); say('Picture added.'); void load(); }} />}
      {replace && <UploadForm replace={replace} onClose={() => setReplace(null)} onDone={() => { setReplace(null); say('Picture replaced. Publish something that uses it to update the website.'); void load(); }} />}
      {edit && (
        <Modal title={`Describe ${edit.name}`} onClose={() => setEdit(null)} actions={<>
          <button type="button" className="crm-btn is-secondary" onClick={() => setEdit(null)}>Cancel</button>
          <button type="button" className="crm-btn" disabled={!alt.trim()} onClick={() => void act(() => crm.put(`/api/v1/website/media/${edit.id}`, { alt }), 'Saved.').then(() => setEdit(null))}>Save</button>
        </>}>
          <label className="crm-field">Describe the picture in a few words<input className="crm-input" value={alt} maxLength={200} onChange={(e) => setAlt(e.target.value)} /></label>
          <p className="crm-sub" style={{ margin: 0 }}>Pages already using it keep their own description until they are edited.</p>
        </Modal>
      )}
    </>
  );
}

/** Everything still waiting for real information on the website. */
export function GapsCard({ onOpen }: { onOpen: (id: string) => void }) {
  const [gaps, setGaps] = useState<{ where: string; what: string; itemId?: string | null; file?: string | null; line?: number | null }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { crm.get<{ items: typeof gaps }>('/api/v1/website/gaps').then((r) => setGaps(r.items ?? [])).catch((e) => setErr(errText(e))); }, []);
  const content = (gaps ?? []).filter((g) => g.itemId); const code = (gaps ?? []).filter((g) => !g.itemId);
  return (
    <section className="crm-card ws-card">
      <h2 className="ws-h2"><ListChecks size={17} aria-hidden /> Missing information</h2>
      <p className="crm-sub" style={{ margin: 0 }}>Text still marked as a placeholder on the website. Each one shows as a gap to visitors until it is filled.</p>
      {err && <ErrorBox message={err} />}
      {!gaps && !err && <Skeleton h={80} />}
      {gaps && gaps.length === 0 && <p className="crm-sub" style={{ margin: 0 }}>Nothing is missing.</p>}
      {content.length > 0 && <><h3 className="ws-h3">You can fill these here</h3><ul className="ws-gaps">{content.map((g, i) => <li key={i}><span><strong>{g.what}</strong> <span className="crm-sub">{g.where}</span></span><button type="button" className="ws-link" onClick={() => onOpen(g.itemId!)}>Fill in</button></li>)}</ul></>}
      {code.length > 0 && <><h3 className="ws-h3">In the website&apos;s code (a developer fills these)</h3><ul className="ws-gaps">{code.map((g, i) => <li key={i}><span><strong>{g.what}</strong> <span className="crm-sub">{g.file}:{g.line}</span></span></li>)}</ul></>}
    </section>
  );
}
