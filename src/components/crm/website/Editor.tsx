'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, ArrowDown, ArrowLeft, ArrowUp, Braces, CalendarClock, Check, ExternalLink, Eye, Globe, History, ImagePlus, Link2, RefreshCw,
  Plus, Rocket, Send, ShieldCheck, Sparkles, Trash2, Undo2, X, FlaskConical,
} from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { ErrorBox, Modal, Pill, Skeleton } from '@/components/crm/ui';
import { GenericFields } from './Fields';
import { ItemSearchCard } from './Growth';
import {
  ACTION, KIND, STATUS, diff, errText, fromLines, fromParas, localInput, nice, shrinkPicture, toLines, toParas, when,
  type Data, type Doc, type One, type Row, type Version,
} from './shared';

export function StatusPills({ r }: { r: Row }) {
  return (
    <span className="ws-pills">
      {r.archived ? <Pill tone="neutral">Archived</Pill> : r.changed
        ? <><Pill tone="ok" dot>On the website</Pill><Pill tone={STATUS[r.status].tone}>{r.status === 'draft' ? 'Changes not published' : `Changes: ${STATUS[r.status].label.toLowerCase()}`}</Pill></>
        : <Pill tone={STATUS[r.status].tone} dot={r.status === 'published'}>{STATUS[r.status].label}</Pill>}
      {r.aiDrafted && !r.live && <Pill tone="accent">AI draft</Pill>}
      {r.publishAt && <Pill tone="info">Goes live {when(r.publishAt)}</Pill>}
      {r.unpublishAt && <Pill tone="warn">Comes off {when(r.unpublishAt)}</Pill>}
      {r.stagedAt && <Pill tone="accent">On staging</Pill>}
    </span>
  );
}

interface EditSection { heading: string; text: string; points: string }

export function Editor({ id, data, embedded, onBack, onOpen, onChanged, say }: { id: string; data: Data; embedded?: boolean; onBack: () => void; onOpen?: (id: string) => void; onChanged: () => void; say: (m: string) => void }) {
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
  const [checks, setChecks] = useState<Checks | null>(null);
  const [planning, setPlanning] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [raw, setRaw] = useState<string | null>(null);
  const [compare, setCompare] = useState<{ v: Version; data: Doc } | null>(null);
  const [autoAt, setAutoAt] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const saving = useRef(false);
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

  // Autosave: a few seconds after the last change, the draft is saved without leaving the page.
  const canWrite = !!one && me.write && !one.item.archived && one.item.status !== 'publishing';
  useEffect(() => {
    if (!dirty || !one || !canWrite) return;
    const t = setTimeout(async () => {
      if (saving.current) return;
      saving.current = true;
      try {
        const res = await crm.put<{ version: number; status: Row['status'] }>(`/api/v1/website/${id}`, { data: built, version: one.item.version });
        setOne((o) => (o ? { ...o, item: { ...o.item, version: res.version, status: res.status } } : o));
        setDirty(false); setAutoAt(new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }));
      } catch (e) { setErr(errText(e)); } finally { saving.current = false; }
    }, 4000);
    return () => clearTimeout(t);
  }, [dirty, built, one, canWrite, id]);

  if (!one) return err ? <ErrorBox message={err} onRetry={() => void load()} /> : <Skeleton h={420} />;
  const r = one.item; const type = r.type; const kind = one.kind;
  const locked = r.archived || r.status === 'publishing' || !me.write;
  const set = (k: string, v: unknown) => { setDoc((d) => ({ ...d, [k]: v })); setDirty(true); };
  const setSec = (i: number, k: keyof EditSection, v: string) => { setSecs((a) => a.map((s, n) => (n === i ? { ...s, [k]: v } : s))); setDirty(true); };
  const refs = doc.references ?? [];
  const setRef = (i: number, k: 'label' | 'url', v: string) => set('references', refs.map((x, n) => (n === i ? { ...x, [k]: v } : x)));

  const run = async (name: string, fn: () => Promise<string | void>) => {
    setBusy(name); setErr(null);
    try { const m = await fn(); await load(); onChanged(); if (m) say(m); } catch (e) { setErr(errText(e)); } finally { setBusy(null); }
  };
  const saveNow = async () => { if (dirty) { await crm.put(`/api/v1/website/${id}`, { data: built, version: r.version }); setDirty(false); } };
  const save = () => run('save', async () => { await saveNow(); return 'Saved.'; });
  const submit = () => run('submit', async () => { await saveNow(); await crm.post(`/api/v1/website/${id}/submit`); return one.needsReview ? 'Sent for review.' : 'Marked ready to publish.'; });
  const approve = () => run('approve', async () => { await crm.post(`/api/v1/website/${id}/approve`); return 'Approved. Your name will show on the article as its reviewer.'; });
  const back = () => run('back', async () => { await crm.post(`/api/v1/website/${id}/send-back`, { note }); setSendBack(false); setNote(''); return 'Sent back to the writer.'; });
  const publish = (action: 'publish' | 'unpublish') => run(action, async () => { await crm.post('/api/v1/website/publish', { items: [{ id, action }] }); return action === 'publish' ? 'Sent to the website. It is live in a few minutes if the checks pass.' : 'Taking it down. It leaves the website in a few minutes.'; });
  const archive = (undo: boolean) => run('archive', async () => { await crm.post(`/api/v1/website/${id}/archive${undo ? '?undo=true' : ''}`); return undo ? 'Brought back.' : 'Archived. It is kept, and can be brought back.'; });
  const restore = (vid: string) => run('restore', async () => { await crm.post(`/api/v1/website/${id}/restore/${vid}`); setHistory(false); return 'That version is the draft now.'; });
  const upload = (f: File) => run('picture', async () => {
    await saveNow();
    const small = await shrinkPicture(f);
    const form = new FormData(); form.append('file', new File([small.blob], `picture.${small.type.split('/')[1]}`, { type: small.type }));
    await crm.upload(`/api/v1/website/${id}/picture`, form); return 'Picture added.';
  });
  const publishNow = () => run('now', async () => { await saveNow(); await crm.post(`/api/v1/website/${id}/submit`); await crm.post('/api/v1/website/publish', { items: [{ id, action: 'publish' }] }); return 'Sent to the website. It is live in a few minutes if the checks pass.'; });
  const stage = () => run('stage', async () => { await crm.post('/api/v1/website/publish', { items: [{ id, action: 'publish' }], target: 'staging' }); return 'Sent to the staging site.'; });
  const refresh = () => run('refresh', async () => { await saveNow(); await crm.post(`/api/v1/website/${id}/refresh-from-crm`); return 'Copied the CRM record\'s current details.'; });
  const rollback = (vid: string, v: number) => run('rollback', async () => { await crm.post(`/api/v1/website/${id}/rollback/${vid}`); setHistory(false); setCompare(null); return `Putting version ${v} back on the website.`; });
  const openPreview = async () => {
    const w = window.open('', '_blank');
    setBusy('preview'); setErr(null);
    try { await saveNow(); const res = await crm.post<{ url: string }>(`/api/v1/website/${id}/preview`); if (w) w.location.href = res.url; else window.location.href = res.url; }
    catch (e) { w?.close(); setErr(errText(e)); } finally { setBusy(null); }
  };
  const runChecks = async () => { setBusy('checks'); setErr(null); try { setChecks(await crm.post<Checks>(`/api/v1/website/${id}/check`, { data: built })); } catch (e) { setErr(errText(e)); } finally { setBusy(null); } };
  const openCompare = async (v: Version) => { try { const x = await crm.get<{ data: Doc }>(`/api/v1/website/${id}/versions/${v.id}`); setHistory(false); setCompare({ v, data: x.data }); } catch (e) { setErr(errText(e)); } };
  const saveRaw = () => run('raw', async () => {
    let parsed: Doc;
    try { parsed = JSON.parse(raw ?? '{}') as Doc; } catch { throw new Error('API x: {"message":"That isn\'t valid JSON. Check the commas and quotes."}'); }
    await crm.put(`/api/v1/website/${id}`, { data: parsed, version: r.version }); setRaw(null); return 'Saved.';
  });
  const suggest = async () => { setBusy('suggest'); setErr(null); try { setIdeas(await crm.post('/api/v1/website/ai/suggest', { data: built })); } catch (e) { setErr(errText(e)); } finally { setBusy(null); } };
  const check = async () => { setBusy('claims'); setErr(null); try { setClaims((await crm.post<{ claims: { text: string; why: string }[] }>('/api/v1/website/ai/claims', { data: built })).claims); } catch (e) { setErr(errText(e)); } finally { setBusy(null); } };

  const count = (n: number, max: number, min = 0) => <span className={`ws-count${n > max || (n > 0 && n < min) ? ' is-off' : ''}`}>{n} / {max}</span>;
  const canSubmit = me.write && !r.archived && (r.status === 'draft' || r.status === 'unpublished' || dirty || (!!one.dueForReview && r.status === 'published'));
  const takeChain = () => run('chain', async () => { await saveNow(); const x = await crm.post<{ kept: string[] }>(`/api/v1/website/${id}/chain-update`); return x.kept.length ? `Took the head office's version. Kept your own: ${x.kept.join(', ')}.` : "Took the head office's version."; });
  const share = (on: boolean) => run('share', async () => { await crm.post(`/api/v1/website/${id}/share${on ? '' : '?off=true'}`); return on ? 'Shared with the branches.' : 'No longer shared. Branches keep what they adopted.'; });

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
      {one.dueForReview && r.status === 'published' && <div className="ws-banner" role="status">Due for review again: last reviewed {one.reviewedOn ? `on ${one.reviewedOn}` : '(no date recorded)'}. Read it, update anything out of date, and send it for review.</div>}
      {one.chain && <div className="ws-banner ws-chain" role="status"><span>Adopted from the head office (their version {one.chain.version}). Your changes here stay when you take a newer version.</span>{me.write && !locked && <button type="button" className="crm-btn is-secondary is-sm" disabled={!!busy} onClick={() => void takeChain()}>{busy === 'chain' ? 'Taking…' : "Take the head office's latest"}</button>}</div>}
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
            <h2 className="ws-h2">Related reading</h2>
            <p className="crm-sub" style={{ margin: 0 }}>Other pages on this website to read next. The Search &amp; results box suggests some.</p>
            {((doc.related as { label: string; href: string }[] | undefined) ?? []).map((x, i, all) => (
              <div key={i} className="ws-ref">
                <input className="crm-input" aria-label={`Name of related page ${i + 1}`} value={x.label} disabled={locked} onChange={(e) => set('related', all.map((y, n) => (n === i ? { ...y, label: e.target.value } : y)))} placeholder="Name" />
                <input className="crm-input" aria-label={`Address of related page ${i + 1}`} value={x.href} disabled={locked} onChange={(e) => set('related', all.map((y, n) => (n === i ? { ...y, href: e.target.value } : y)))} placeholder="/blogs/…" />
                {!locked && <button type="button" className="crm-btn is-secondary is-sm" aria-label="Remove related page" onClick={() => set('related', all.filter((_, n) => n !== i))}><X size={14} aria-hidden /></button>}
              </div>
            ))}
            {!locked && <button type="button" className="crm-btn is-secondary" onClick={() => set('related', [...((doc.related as { label: string; href: string }[] | undefined) ?? []), { label: '', href: '' }])}><Plus size={16} aria-hidden /> Add a related page</button>}
          </>)}
          {type === 'faq' && <>
            <label className="crm-field">Question<input className="crm-input ws-big" value={doc.question ?? ''} disabled={locked} maxLength={300} onChange={(e) => set('question', e.target.value)} /></label>
            <label className="crm-field">Answer<textarea className="crm-textarea" rows={6} value={doc.answer ?? ''} disabled={locked} onChange={(e) => set('answer', e.target.value)} /></label>
            <label className="crm-field">What it is about<select className="crm-input" value={doc.category ?? ''} disabled={locked} onChange={(e) => set('category', e.target.value)}>{data.faqCategories.map((c) => <option key={c} value={c}>{nice(c)}</option>)}</select></label>
          </>}
          {kind.key !== 'article' && kind.key !== 'faq' && kind.key !== 'site' && <>
            <p className="crm-sub" style={{ margin: 0 }}>{kind.help}</p>
            <GenericFields fields={kind.fields} doc={doc} set={set} locked={locked || (type === 'redirect' && false)} />
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
            {one.address && type !== 'site' && <p className="crm-sub ws-addr">{one.address.replace(/^https:\/\//, '')}{r.live && <> <a href={one.address} target="_blank" rel="noreferrer" aria-label="Open on the website"><ExternalLink size={13} aria-hidden /></a></>}</p>}
            {type === 'article' && me.write && !locked && <button type="button" className="ws-link" onClick={() => setRenaming(true)}><Link2 size={13} aria-hidden /> Change web address</button>}
            {r.aiDrafted && <p className="ws-ai-note"><Sparkles size={15} aria-hidden /> First draft written by AI. Check every fact.</p>}
            {r.reviewedByName && <p className="crm-sub" style={{ margin: 0 }}>Reviewed by {r.reviewedByName}{r.reviewedAt ? `, ${when(r.reviewedAt)}` : ''}</p>}
            <div className="ws-actions">
              {me.write && !r.archived && r.status !== 'publishing' && <button type="button" className="crm-btn is-secondary" disabled={!dirty || !!busy} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : dirty ? 'Save draft' : autoAt ? `Saved automatically, ${autoAt}` : 'Saved'}</button>}
              {canSubmit && !one.needsReview && me.publish && r.status !== 'publishing' && one.problems.length === 0 && <button type="button" className="crm-btn" disabled={!!busy} onClick={() => void publishNow()}><Rocket size={16} aria-hidden /> {busy === 'now' ? 'Sending…' : 'Publish now'}</button>}
              {canSubmit && r.status !== 'publishing' && <button type="button" className="crm-btn" disabled={!!busy} onClick={() => void submit()}><Send size={16} aria-hidden /> {busy === 'submit' ? 'Sending…' : one.needsReview ? 'Send for review' : 'Mark ready to publish'}</button>}
              {r.status === 'review' && !dirty && (me.review ? <>
                <button type="button" className="crm-btn" disabled={!!busy} onClick={() => void approve()}><Check size={16} aria-hidden /> {busy === 'approve' ? 'Approving…' : 'Approve'}</button>
                <button type="button" className="crm-btn is-secondary" disabled={!!busy} onClick={() => setSendBack(true)}><Undo2 size={16} aria-hidden /> Send back</button>
              </> : <p className="crm-sub" style={{ margin: 0 }}>Waiting for a reviewer to read and approve it.</p>)}
              {r.status === 'approved' && !dirty && (me.publish
                ? <button type="button" className="crm-btn" disabled={!!busy} onClick={() => void publish('publish')}><Rocket size={16} aria-hidden /> {busy === 'publish' ? 'Sending…' : 'Publish to the website'}</button>
                : <p className="crm-sub" style={{ margin: 0 }}>Ready. Someone with the publish right puts it on the website.</p>)}
              {r.status === 'approved' && !dirty && me.publish && data.setup.hasStaging && <button type="button" className="crm-btn is-secondary" disabled={!!busy} onClick={() => void stage()}><FlaskConical size={16} aria-hidden /> {busy === 'stage' ? 'Sending…' : r.stagedAt ? 'Put on staging again' : 'Put on staging first'}</button>}
              {r.status === 'approved' && !dirty && me.review && one.needsReview && <button type="button" className="crm-btn is-secondary" disabled={!!busy} onClick={() => setSendBack(true)}><Undo2 size={16} aria-hidden /> Send back</button>}
              {r.status === 'publishing' && <p className="crm-sub" style={{ margin: 0 }}>Being published now. Progress shows on the Website page.</p>}
            </div>
            <div className="ws-actions">
              {type !== 'redirect' && <button type="button" className="crm-btn is-secondary is-sm" disabled={!!busy} onClick={() => void openPreview()}><Eye size={15} aria-hidden /> {busy === 'preview' ? 'Opening…' : 'Preview on the website'}</button>}
              <button type="button" className="crm-btn is-secondary is-sm" disabled={!!busy} onClick={() => void runChecks()}><ShieldCheck size={15} aria-hidden /> {busy === 'checks' ? 'Checking links…' : 'Check before publishing'}</button>
              {me.publish && type !== 'site' && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setPlanning(true)}><CalendarClock size={15} aria-hidden /> {r.publishAt || r.unpublishAt ? 'Change the schedule' : 'Schedule'}</button>}
              {(type === 'doctor' || type === 'camp') && r.linked && me.write && !locked && <button type="button" className="crm-btn is-secondary is-sm" disabled={!!busy} onClick={() => void refresh()}><RefreshCw size={15} aria-hidden /> {busy === 'refresh' ? 'Copying…' : 'Update from the CRM record'}</button>}
              {me.develop && me.write && !locked && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setRaw(JSON.stringify(built, null, 2))}><Braces size={15} aria-hidden /> Edit as JSON</button>}
            </div>
            {type === 'article' && <button type="button" className="ws-link" onClick={() => setPreview((p) => !p)}>{preview ? 'Back to editing' : 'Quick look at the text'}</button>}
          </section>

          {checks && <ChecksCard checks={checks} pic={pic} onClose={() => setChecks(null)} />}

          {type !== 'site' && type !== 'redirect' && type !== 'notice' && type !== 'testimonial' && <ItemSearchCard id={id} type={type} aiOn={data.aiOn} canWrite={me.write && !locked} doc={built} say={say}
            onAddRelated={(x) => set('related', [...((doc.related as { label: string; href: string }[] | undefined) ?? []), x])}
            onAddQuestion={(q) => { setSecs((a) => [...a, { heading: q.charAt(0).toUpperCase() + q.slice(1).replace(/\?*$/, '?'), text: '', points: '' }]); setDirty(true); }}
            onTranslated={(x) => (onOpen ? onOpen(x) : undefined)} />}
          {me.publish && !one.chain && type !== 'site' && type !== 'redirect' && data.setup.branches && data.setup.branches.length > 0 && (
            <section className="crm-card ws-card"><label className="ws-check"><input type="checkbox" checked={!!one.shared} disabled={!!busy} onChange={(e) => void share(e.target.checked)} /> Share with the branches</label><span className="crm-sub">Branches can adopt it and change it for their own website.</span></section>
          )}

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
                {r.live && kind.canUnpublish && me.publish && r.status !== 'publishing' && <button type="button" className="crm-btn is-secondary is-sm" disabled={!!busy} onClick={() => { if (window.confirm(`Take "${r.title}" off the website? It stays here and can be published again.`)) void publish('unpublish'); }}><Globe size={15} aria-hidden /> Take off the website</button>}
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
                <div><strong>{ACTION[v.action] ?? v.action}</strong> <span className="crm-sub">version {v.version}, {v.byName}, {when(v.at)}{v.reviewedByName ? `, approved by ${v.reviewedByName}` : ''}</span>{v.note && <div className="ws-note">{v.note}</div>}</div>
                <span className="ws-history-actions">
                  <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void openCompare(v)}>Compare</button>
                  {me.write && !locked && v.version !== r.version && <button type="button" className="crm-btn is-secondary is-sm" disabled={!!busy} onClick={() => { if (window.confirm(`Make version ${v.version} the draft again? The current text stays in the history.`)) void restore(v.id); }}>Put back as draft</button>}
                  {me.publish && !locked && ['published', 'imported', 'changed_on_github'].includes(v.action) && <button type="button" className="crm-btn is-secondary is-sm" disabled={!!busy} onClick={() => { if (window.confirm(`Put version ${v.version} back on the website now?${v.reviewedByName ? ` It was approved by ${v.reviewedByName}.` : ''}`)) void rollback(v.id, v.version); }}><Undo2 size={14} aria-hidden /> Roll back the website to this</button>}
                </span>
              </li>
            ))}
          </ul>
        </Modal>
      )}
      {compare && (
        <Modal title={`Version ${compare.v.version} compared with the draft now`} wide onClose={() => { setCompare(null); setHistory(true); }} actions={<button type="button" className="crm-btn" onClick={() => { setCompare(null); setHistory(true); }}>Back to history</button>}>
          {(() => {
            const rows = diff(compare.data, built);
            return rows.length === 0 ? <p className="crm-sub">They are the same.</p> : (
              <div className="crm-table-wrap"><table className="crm-table ws-diff">
                <thead><tr><th>Field</th><th>Version {compare.v.version}</th><th>Now</th></tr></thead>
                <tbody>{rows.map((d) => <tr key={d.field}><td className="crm-sub">{d.field}</td><td><del>{d.before}</del></td><td><ins>{d.after}</ins></td></tr>)}</tbody>
              </table></div>
            );
          })()}
        </Modal>
      )}
      {planning && <ScheduleForm row={r} onClose={() => setPlanning(false)} onSaved={(m) => { setPlanning(false); void load(); onChanged(); say(m); }} />}
      {renaming && <RenameForm row={r} siteUrl={data.setup.siteUrl} onClose={() => setRenaming(false)} onSaved={(m) => { setRenaming(false); void load(); onChanged(); say(m); }} />}
      {raw !== null && (
        <Modal title="Edit as JSON" wide onClose={() => setRaw(null)} actions={<>
          <button type="button" className="crm-btn is-secondary" onClick={() => setRaw(null)}>Cancel</button>
          <button type="button" className="crm-btn" disabled={!!busy} onClick={() => void saveRaw()}>{busy === 'raw' ? 'Saving…' : 'Save'}</button>
        </>}>
          <p className="crm-sub" style={{ margin: 0 }}>The draft in the shape the website reads. Unknown fields are dropped; the same checks run as in the form; the id stays the same. {one.needsReview ? 'A change sends it back to draft, so it needs review again.' : ''}</p>
          <textarea className="crm-textarea ws-mono" rows={22} value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false} aria-label="Content as JSON" />
        </Modal>
      )}
    </div>
  );
}

interface Checks {
  links: { url: string; ok: boolean; note: string }[]; paths: { url: string; ok: boolean; note: string }[];
  card?: { title: string; description: string; url?: string | null; site: string; image: string } | null; titleBest: number; descriptionBest: number; redirectNote?: string | null;
}

/** Links and pictures, and how the page shows in Google and in a WhatsApp message. */
function ChecksCard({ checks, pic, onClose }: { checks: Checks; pic: string | null; onClose: () => void }) {
  const bad = [...checks.links, ...checks.paths].filter((x) => !x.ok);
  const c = checks.card;
  const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
  return (
    <section className="crm-card ws-card" aria-label="Checks before publishing">
      <div className="ws-card-head"><h3 className="ws-h3"><ShieldCheck size={15} aria-hidden /> Checks before publishing</h3><button type="button" className="ws-x" onClick={onClose} aria-label="Close checks"><X size={15} /></button></div>
      {checks.links.length + checks.paths.length === 0 ? <p className="crm-sub" style={{ margin: 0 }}>No links or pictures to check.</p>
        : <p className={bad.length ? 'ms-err' : 'crm-sub'} style={{ margin: 0 }}>{bad.length ? `${bad.length} of ${checks.links.length + checks.paths.length} links or pictures don't work.` : `All ${checks.links.length + checks.paths.length} links and pictures work.`}</p>}
      <ul className="ws-checks">{[...checks.links, ...checks.paths].map((x) => <li key={x.url} className={x.ok ? 'is-ok' : 'is-bad'}>{x.ok ? <Check size={15} aria-hidden /> : <X size={15} aria-hidden />}<span><span className="ws-url">{x.url}</span><br /><span className="crm-sub">{x.note}</span></span></li>)}</ul>
      {checks.redirectNote && <p className="crm-sub" style={{ margin: 0 }}>{checks.redirectNote}</p>}
      {c && <>
        <h4 className="ws-h4">In Google</h4>
        <div className="ws-serp">
          <span className="ws-serp-site">{c.site}</span>
          <span className="ws-serp-title">{cut(c.title, checks.titleBest)}</span>
          <span className="ws-serp-desc">{cut(c.description, checks.descriptionBest)}</span>
        </div>
        {c.title.length > checks.titleBest && <p className="crm-sub" style={{ margin: 0 }}>The title is cut: {c.title.length} characters, about {checks.titleBest} fit.</p>}
        <h4 className="ws-h4">Shared on WhatsApp</h4>
        <div className="ws-wa">
          {/* eslint-disable-next-line @next/next/no-img-element -- the page's own picture, or a private one loaded as a blob */}
          {c.image === 'picture' ? (pic ? <img src={pic} alt="" /> : null) : <img src={c.image} alt="" />}
          <div><strong>{cut(c.title, 70)}</strong><span>{cut(c.description, 110)}</span><small>{c.site}</small></div>
        </div>
      </>}
    </section>
  );
}

function ScheduleForm({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: (m: string) => void }) {
  const [on, setOn] = useState(localInput(row.publishAt));
  const [off, setOff] = useState(localInput(row.unpublishAt));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async (clear = false) => {
    setBusy(true); setErr(null);
    try {
      await crm.post(`/api/v1/website/${row.id}/schedule`, clear ? {} : { publishAt: on ? new Date(on).toISOString() : null, unpublishAt: off ? new Date(off).toISOString() : null });
      onSaved(clear ? 'Schedule removed.' : 'Schedule saved.');
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Modal title="Schedule" onClose={onClose} actions={<>
      {(row.publishAt || row.unpublishAt) && <button type="button" className="crm-btn is-secondary" disabled={busy} onClick={() => void go(true)}>Remove schedule</button>}
      <button type="button" className="crm-btn is-secondary" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="crm-btn" onClick={() => void go()} disabled={busy || (!on && !off)}>{busy ? 'Saving…' : 'Save'}</button>
    </>}>
      <div className="ms-form">
        {!row.live && <label className="crm-field">Go live at<input className="crm-input" type="datetime-local" value={on} onChange={(e) => setOn(e.target.value)} /></label>}
        <label className="crm-field">Come off the website at (optional)<input className="crm-input" type="datetime-local" value={off} onChange={(e) => setOff(e.target.value)} /></label>
        <p className="crm-sub" style={{ margin: 0 }}>It goes live at that time only if it is ready to publish by then (approved, where a review is needed). Times are your computer&apos;s time. Publishing takes a few minutes after the time.</p>
        {err && <p className="ms-err" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

function RenameForm({ row, siteUrl, onClose, onSaved }: { row: Row; siteUrl?: string | null; onClose: () => void; onSaved: (m: string) => void }) {
  const [slug, setSlug] = useState(row.key);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try { const r = await crm.post<{ redirect: boolean }>(`/api/v1/website/${row.id}/rename`, { slug }); onSaved(r.redirect ? 'Address changed. When it is published, the old address sends people to the new one.' : 'Address changed.'); }
    catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Modal title="Change web address" onClose={onClose} actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="crm-btn" onClick={() => void go()} disabled={busy || !slug.trim() || slug === row.key}>{busy ? 'Saving…' : 'Change'}</button>
    </>}>
      <div className="ms-form">
        <label className="crm-field">New address<input className="crm-input" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'))} /></label>
        <p className="crm-sub" style={{ margin: 0 }}>{(siteUrl ?? '').replace('https://', '')}/blogs/{slug}</p>
        {row.live && <p className="crm-sub" style={{ margin: 0 }}>It is on the website now, so publishing it leaves a redirect from the old address: links already shared keep working, and Google moves to the new one.</p>}
        {err && <p className="ms-err" role="alert">{err}</p>}
      </div>
    </Modal>
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

