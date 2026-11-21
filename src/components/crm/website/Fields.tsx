'use client';

import { useEffect, useState } from 'react';
import { ImagePlus, Plus, X } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { Empty, Modal, Skeleton } from '@/components/crm/ui';
import { errText, fromLines, fromParas, nice, shrinkPicture, toLines, toParas, type Doc, type FieldDef, type Media } from './shared';

/** A library picture, loaded with the session (pictures not on the website yet are private). */
export function MediaThumb({ media, className }: { media: Pick<Media, 'id' | 'version' | 'alt'>; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let made: string | null = null; let gone = false;
    crm.blob(`/api/v1/website/media/${media.id}/file?v=${media.version}`).then((b) => { if (gone) return; made = URL.createObjectURL(b); setUrl(made); }).catch(() => { /* shows the empty frame */ });
    return () => { gone = true; if (made) URL.revokeObjectURL(made); };
  }, [media.id, media.version]);
  // eslint-disable-next-line @next/next/no-img-element -- a private picture loaded as a blob
  return url ? <img className={className ?? 'ws-thumb'} src={url} alt={media.alt} /> : <span className={`${className ?? 'ws-thumb'} is-empty`} aria-hidden />;
}

/** Add a picture to the library: it is made smaller and turned into WebP in the browser before it is sent. */
export function UploadForm({ onClose, onDone, replace }: { onClose: () => void; onDone: (m: Media) => void; replace?: Media }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [alt, setAlt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const live = replace?.usedBy.filter((u) => u.live) ?? [];
  const go = async () => {
    if (!file) { setErr('Pick a picture.'); return; }
    setBusy(true); setErr(null);
    try {
      const keep = replace ? replace.mime : undefined;
      const small = await shrinkPicture(file, keep);
      if (small.blob.size > 2 * 1024 * 1024) throw new Error('Even after making it smaller, the picture is over 2 MB. Pick a smaller one.');
      const form = new FormData();
      form.append('file', new File([small.blob], `picture.${small.type.split('/')[1]}`, { type: small.type }));
      form.append('width', String(small.width)); form.append('height', String(small.height));
      if (replace) { await crm.upload(`/api/v1/website/media/${replace.id}/file`, form); onDone({ ...replace, version: replace.version + 1, onSite: false }); }
      else { form.append('name', name || file.name.replace(/\.[^.]+$/, '')); form.append('alt', alt); onDone(await crm.upload<Media>('/api/v1/website/media', form)); }
    } catch (e) { setErr(e instanceof Error && !e.message.startsWith('API ') ? e.message : errText(e)); setBusy(false); }
  };
  return (
    <Modal title={replace ? `Replace ${replace.name}` : 'Add a picture'} onClose={onClose} actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="crm-btn" onClick={() => void go()} disabled={busy || !file}>{busy ? 'Uploading…' : replace ? 'Replace' : 'Add to the library'}</button>
    </>}>
      <div className="ms-form">
        {replace && live.length > 0 && <p className="ws-banner" style={{ margin: 0 }}>This picture is on the website on: {live.map((u) => u.title).join(', ')}. Those pages show the new one after it is published.</p>}
        <label className="crm-field">Picture (JPG, PNG or WebP)<input className="crm-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f && !name) setName(f.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')); }} /></label>
        {!replace && <>
          <label className="crm-field">Short name (becomes part of its web address)<input className="crm-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. kasba-camp-2026" /></label>
          <label className="crm-field">Describe the picture in a few words<input className="crm-input" value={alt} maxLength={200} onChange={(e) => setAlt(e.target.value)} placeholder="e.g. Doctors checking patients at the Kasba camp" /></label>
        </>}
        <p className="crm-sub" style={{ margin: 0 }}>It is made at most 1600 pixels wide and saved as WebP, so pages stay fast. {replace ? 'The address stays the same.' : ''}</p>
        {err && <p className="ms-err" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

/** Pick a picture from the library (or add one). */
export function MediaPicker({ onClose, onPick }: { onClose: () => void; onPick: (m: Media) => void }) {
  const [items, setItems] = useState<Media[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => { crm.get<{ items: Media[] }>('/api/v1/website/media').then((r) => setItems(r.items.filter((m) => !m.archived))).catch((e) => setErr(errText(e))); }, []);
  const shown = (items ?? []).filter((m) => !q.trim() || (m.name + ' ' + m.alt).toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Modal title="Pick a picture" wide onClose={onClose} actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={() => setAdding(true)}><ImagePlus size={16} aria-hidden /> Add a picture</button>
      <button type="button" className="crm-btn is-secondary" onClick={onClose}>Close</button>
    </>}>
      <label className="crm-sr" htmlFor="ws-pick-q">Search pictures</label>
      <input id="ws-pick-q" className="crm-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or description" />
      {err && <p className="ms-err" role="alert">{err}</p>}
      {!items && !err && <Skeleton h={200} />}
      {items && shown.length === 0 && <Empty title="No pictures yet">Add one with the button below.</Empty>}
      <div className="ws-media-grid is-pick">
        {shown.map((m) => (
          <button key={m.id} type="button" className="ws-media-card" onClick={() => onPick(m)}>
            <MediaThumb media={m} />
            <span className="ws-media-name">{m.name}</span>
            <span className="crm-sub">{m.alt}</span>
          </button>
        ))}
      </div>
      {adding && <UploadForm onClose={() => setAdding(false)} onDone={(m) => { setAdding(false); onPick(m); }} />}
    </Modal>
  );
}

/** One field of a content kind, edited as the kind says (text, list, date, picture…). */
function Field({ f, value, set, locked }: { f: FieldDef; value: unknown; set: (v: unknown) => void; locked: boolean }) {
  const [picking, setPicking] = useState(false);
  const str = typeof value === 'string' ? value : '';
  const count = f.max > 0 && ['text', 'longtext'].includes(f.kind) ? <span className={`ws-count${str.length > f.max ? ' is-off' : ''}`}>{str.length} / {f.max}</span> : null;
  const label = <span className="ws-lab">{f.label}{f.required ? '' : ''}{count}</span>;
  const help = f.help ? <span className="crm-sub ws-help">{f.help}</span> : null;
  switch (f.kind) {
    case 'longtext':
      return <label className="crm-field">{label}<textarea className="crm-textarea" rows={Math.min(10, Math.max(3, Math.ceil(str.length / 80) + 1))} value={str} disabled={locked} onChange={(e) => set(e.target.value)} />{help}</label>;
    case 'paras':
      return <LinesField label={label} help={help} value={value} set={set} locked={locked} paras />;
    case 'lines':
      return <LinesField label={label} help={help} value={value} set={set} locked={locked} />;
    case 'bool':
      return <label className="ws-check"><input type="checkbox" checked={value === true} disabled={locked} onChange={(e) => set(e.target.checked)} /> {f.label}{help}</label>;
    case 'date':
    case 'time':
      return <label className="crm-field">{label}<input className="crm-input" type={f.kind} value={str} disabled={locked} onChange={(e) => set(e.target.value)} />{help}</label>;
    case 'select':
      return <label className="crm-field">{label}<select className="crm-input" value={str} disabled={locked} onChange={(e) => set(e.target.value)}><option value="">{f.required ? 'Pick one' : 'None'}</option>{(f.options ?? []).map((o) => <option key={o} value={o}>{nice(o)}</option>)}</select>{help}</label>;
    case 'image':
      return (
        <div className="crm-field">{label}
          <div className="ws-pick-row">
            {str ? <code className="ws-path">{str}</code> : <span className="crm-sub">No picture.</span>}
            {!locked && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setPicking(true)}><ImagePlus size={15} aria-hidden /> {str ? 'Change' : 'Pick from the library'}</button>}
            {!locked && str && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => set('')}>Remove</button>}
          </div>{help}
          {picking && <MediaPicker onClose={() => setPicking(false)} onPick={(m) => { set(m.path); setPicking(false); }} />}
        </div>
      );
    case 'pairs': {
      const rows = (Array.isArray(value) ? value : []) as Record<string, string>[];
      const put = (i: number, k: string, v: string) => set(rows.map((r, n) => (n === i ? { ...r, [k]: v } : r)));
      return (
        <fieldset className="ms-set"><legend>{f.label}</legend>
          {rows.map((r, i) => (
            <div key={i} className="ws-pair">
              <input className="crm-input" aria-label={`${f.aLabel} ${i + 1}`} value={r[f.a] ?? ''} disabled={locked} onChange={(e) => put(i, f.a, e.target.value)} placeholder={f.aLabel} />
              {f.b === 'answer' || f.b === 'description'
                ? <textarea className="crm-textarea" aria-label={`${f.bLabel} ${i + 1}`} rows={2} value={r[f.b] ?? ''} disabled={locked} onChange={(e) => put(i, f.b, e.target.value)} placeholder={f.bLabel} />
                : <input className="crm-input" aria-label={`${f.bLabel} ${i + 1}`} value={r[f.b] ?? ''} disabled={locked} onChange={(e) => put(i, f.b, e.target.value)} placeholder={f.bLabel} />}
              {!locked && <button type="button" className="crm-btn is-secondary is-sm" aria-label={`Remove ${f.aLabel.toLowerCase()} ${i + 1}`} onClick={() => set(rows.filter((_, n) => n !== i))}><X size={14} aria-hidden /></button>}
            </div>
          ))}
          {!locked && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => set([...rows, { [f.a]: '', [f.b]: '' }])}><Plus size={14} aria-hidden /> Add</button>}
          {help}
        </fieldset>
      );
    }
    default:
      return <label className="crm-field">{label}<input className="crm-input" inputMode={f.kind === 'phone' ? 'numeric' : f.kind === 'url' ? 'url' : undefined} value={str} disabled={locked} maxLength={f.max > 0 ? f.max + 50 : undefined}
        onChange={(e) => set(f.kind === 'phone' ? e.target.value.replace(/\D/g, '').slice(-10) : e.target.value)} placeholder={f.kind === 'url' ? 'https://…' : f.kind === 'path' ? '/…' : undefined} />{help}</label>;
  }
}

/** A list typed one per line; kept as text while typing so empty lines don't vanish under the cursor. */
function LinesField({ label, help, value, set, locked, paras }: { label: React.ReactNode; help: React.ReactNode; value: unknown; set: (v: unknown) => void; locked: boolean; paras?: boolean }) {
  const [text, setText] = useState(paras ? toParas(value) : toLines(value));
  return <label className="crm-field">{label}<textarea className="crm-textarea" rows={Math.min(16, Math.max(3, text.split('\n').length + 1))} value={text} disabled={locked}
    onChange={(e) => { setText(e.target.value); set(paras ? fromParas(e.target.value) : fromLines(e.target.value)); }} />{help}</label>;
}

/** Every field of a content kind except the CRM-only ones, which get their own box. */
export function GenericFields({ fields, doc, set, locked }: { fields: FieldDef[]; doc: Doc; set: (k: string, v: unknown) => void; locked: boolean }) {
  const site = fields.filter((f) => !f.crmOnly);
  const crmOnly = fields.filter((f) => f.crmOnly && !['crmDoctorId', 'campId'].includes(f.name));
  return (
    <>
      {site.map((f) => <Field key={f.name} f={f} value={doc[f.name]} set={(v) => set(f.name, v)} locked={locked} />)}
      {crmOnly.length > 0 && (
        <fieldset className="ws-crm-only"><legend>Kept in the CRM only, never on the website</legend>
          {crmOnly.map((f) => <Field key={f.name} f={f} value={doc[f.name]} set={(v) => set(f.name, v)} locked={locked} />)}
        </fieldset>
      )}
    </>
  );
}
