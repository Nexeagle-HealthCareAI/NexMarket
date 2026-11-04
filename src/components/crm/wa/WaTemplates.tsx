'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Package, Pencil, Plus, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { Empty, ErrorBox, friendlyError, Modal, Pill, Skeleton, type Tone } from '@/components/crm/ui';
import { TemplateBubble, type WaButton, type WaTemplate } from './shared';

interface PackItem { name: string; category: string; header?: string | null; body: string; footer?: string | null; examples: string[]; use?: string | null; installed?: string | null }

const STATUS: Record<string, { label: string; tone: Tone }> = {
  APPROVED: { label: 'Approved', tone: 'ok' }, PENDING: { label: 'Waiting for Meta', tone: 'warn' }, IN_APPEAL: { label: 'In appeal', tone: 'warn' },
  REJECTED: { label: 'Rejected', tone: 'bad' }, PAUSED: { label: 'Paused by Meta', tone: 'bad' }, DISABLED: { label: 'Disabled', tone: 'bad' },
};
const USE_LABEL: Record<string, string> = {
  lead_followup: 'Lead follow-up', doctor_availability: 'Broadcast: doctor available', schedule_change: 'Broadcast: schedule change',
  camp_invite: 'Broadcast: camp invite', general_update: 'Broadcast: general update',
};

/** Message templates: what's approved, what's waiting, and writing new ones, all sent to Meta from here. */
export function WaTemplates({ canManage, toast }: { canManage: boolean; toast: (m: string) => void }) {
  const [list, setList] = useState<WaTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<WaTemplate | 'new' | null>(null);
  const [packOpen, setPackOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const load = useCallback(async () => {
    try { setList((await crm.get<{ items: WaTemplate[] }>('/api/v1/whatsapp/templates')).items); setError(null); }
    catch (e) { setError(friendlyError(e)); }
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  const shown = (list ?? []).filter((t) => !filter || (filter === 'problem' ? ['REJECTED', 'PAUSED', 'DISABLED'].includes(t.status) : t.status === filter));
  const count = (s: string) => (list ?? []).filter((t) => t.status === s).length;

  return (
    <div className="wt-wrap">
      <div className="wt-bar">
        <div className="crm-chips">
          <button type="button" className="crm-chip" aria-pressed={!filter} onClick={() => setFilter('')}>All{list ? <span className="ld-chip-n">{list.length}</span> : null}</button>
          <button type="button" className="crm-chip" aria-pressed={filter === 'APPROVED'} onClick={() => setFilter('APPROVED')}>Approved<span className="ld-chip-n">{count('APPROVED')}</span></button>
          <button type="button" className="crm-chip" aria-pressed={filter === 'PENDING'} onClick={() => setFilter('PENDING')}>Waiting<span className="ld-chip-n">{count('PENDING')}</span></button>
          <button type="button" className="crm-chip" aria-pressed={filter === 'problem'} onClick={() => setFilter('problem')}>Rejected or paused<span className="ld-chip-n">{count('REJECTED') + count('PAUSED') + count('DISABLED')}</span></button>
        </div>
        <span style={{ flex: 1 }} />
        <button type="button" className="crm-btn is-secondary" onClick={() => void load()}><RefreshCw size={16} aria-hidden /> Refresh</button>
        {canManage && <button type="button" className="crm-btn is-secondary" onClick={() => setPackOpen(true)}><Package size={16} aria-hidden /> NexEagle templates</button>}
        {canManage && <button type="button" className="crm-btn" onClick={() => setEditing('new')}><Plus size={16} aria-hidden /> New template</button>}
      </div>
      {error && <ErrorBox message={error} onRetry={load} />}
      {!list && !error ? <Skeleton h={320} /> : list && shown.length === 0 ? (
        <Empty title={list.length ? 'No templates match' : 'No templates yet'}>
          <span className="crm-sub">Start with the NexEagle set: seven ready-written Hindi templates for follow-ups, broadcasts and appointments, with your hospital&apos;s name filled in.</span>
        </Empty>
      ) : (
        <div className="wt-grid">
          {shown.map((t) => {
            const st = STATUS[t.status] ?? { label: t.status.toLowerCase(), tone: 'neutral' as Tone };
            return (
              <article key={`${t.name}|${t.language}`} className="crm-card wt-card">
                <div className="wt-card-head">
                  <strong className="wt-name">{t.name}</strong>
                  <Pill tone={st.tone} dot>{st.label}</Pill>
                </div>
                <span className="crm-sub wt-meta">{t.language} · {t.category.toLowerCase()} · {t.params} {t.params === 1 ? 'blank' : 'blanks'}</span>
                <TemplateBubble t={t} values={t.examples.length ? t.examples : undefined} />
                {t.reason && <span className="wl-err">Meta&apos;s reason: {t.reason.toLowerCase().replace(/_/g, ' ')}</span>}
                <div className="wt-card-foot">
                  {t.usedFor.length > 0 ? t.usedFor.map((u) => <Pill key={u} tone="accent">{u}</Pill>) : <span className="crm-sub" style={{ fontSize: 12 }}>Not linked to an automatic message</span>}
                  <span style={{ flex: 1 }} />
                  {canManage && t.id && t.status !== 'PENDING' && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setEditing(t)}><Pencil size={14} aria-hidden /> Edit</button>}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <p className="crm-sub" style={{ fontSize: 12.5 }}>Which template each automatic message uses is set by an admin in WhatsApp → Setup. Meta usually reviews new or edited templates within minutes to a day.</p>
      {editing && <Editor t={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); toast(m); void load(); }} />}
      {packOpen && <PackModal onClose={() => setPackOpen(false)} onDone={(m) => { setPackOpen(false); toast(m); void load(); }} />}
    </div>
  );
}

function Editor({ t, onClose, onSaved }: { t: WaTemplate | null; onClose: () => void; onSaved: (m: string) => void }) {
  const [name, setName] = useState(t?.name ?? '');
  const [language, setLanguage] = useState(t?.language ?? 'hi');
  const [category, setCategory] = useState(t?.category ?? 'MARKETING');
  const [header, setHeader] = useState(t?.header ?? '');
  const [body, setBody] = useState(t?.body ?? '');
  const [footer, setFooter] = useState(t?.footer ?? '');
  const [buttons, setButtons] = useState<WaButton[]>(t?.buttons ?? []);
  const [examples, setExamples] = useState<string[]>(t?.examples ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const blanks = Array.from(new Set((body.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).map((x) => x.replace(/\D/g, '')))).length;
  const ex = Array.from({ length: blanks }, (_, i) => examples[i] ?? '');
  const addBlank = () => setBody((b) => `${b}{{${blanks + 1}}}`);
  const save = async () => {
    setBusy(true);
    setError(null);
    const dto = { name: name.trim(), language, category, header: header.trim() || null, body, footer: footer.trim() || null, buttons, examples: ex };
    try {
      if (t?.id) await crm.post(`/api/v1/whatsapp/templates/${t.id}`, dto); else await crm.post('/api/v1/whatsapp/templates', dto);
      onSaved(t ? 'Changes sent to Meta for review.' : 'Template sent to Meta for review.');
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  };
  return (
    <Modal title={t ? `Edit ${t.name}` : 'New template'} onClose={onClose} wide
      actions={<>
        <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="crm-btn" disabled={busy || !body.trim() || (!t && !name.trim())} onClick={() => void save()}>{busy ? 'Sending…' : 'Send to Meta for approval'}</button>
      </>}>
      <div className="wt-editor">
        <div className="wt-editor-form">
          <div className="ld-form">
            <label className="crm-field">Name
              <input className="crm-input" value={name} disabled={!!t} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} placeholder="opd_timing_update" maxLength={100} />
            </label>
            <label className="crm-field">Language
              <select className="crm-select" value={language} disabled={!!t} onChange={(e) => setLanguage(e.target.value)}>
                <option value="hi">Hindi (hi)</option><option value="en">English (en)</option><option value="en_US">English US (en_US)</option><option value="bn">Bengali (bn)</option><option value="ur">Urdu (ur)</option>
              </select>
            </label>
          </div>
          <div className="crm-field">Type
            <div className="crm-chips">
              <button type="button" className="crm-chip" aria-pressed={category === 'MARKETING'} onClick={() => setCategory('MARKETING')}>Marketing</button>
              <button type="button" className="crm-chip" aria-pressed={category === 'UTILITY'} onClick={() => setCategory('UTILITY')}>Utility</button>
            </div>
            <span className="crm-sub" style={{ fontWeight: 400, fontSize: 12 }}>Utility: about something the person asked for (appointment, report). Marketing: offers, camps, news. Meta may change the type when reviewing.</span>
          </div>
          <label className="crm-field">Heading (optional)
            <input className="crm-input" value={header} onChange={(e) => setHeader(e.target.value)} maxLength={60} placeholder="e.g. the hospital's name" />
          </label>
          <label className="crm-field">
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Message <button type="button" className="nt-link" onClick={addBlank}>+ Add a blank {`{{${blanks + 1}}}`}</button></span>
            <textarea className="crm-textarea" rows={6} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1024}
              placeholder={'नमस्ते {{1}}, ...'} />
            <span className="crm-sub" style={{ fontWeight: 400, fontSize: 12 }}>{body.length}/1024. Blanks are filled in when sending, e.g. the person&apos;s name. Don&apos;t start or end with a blank.</span>
          </label>
          {blanks > 0 && (
            <div className="crm-field">Example for each blank (Meta needs these to review it)
              <div className="wt-examples">
                {ex.map((v, i) => <input key={i} className="crm-input" value={v} placeholder={`{{${i + 1}}}`} onChange={(e) => setExamples(() => ex.map((y, j) => (j === i ? e.target.value : y)))} />)}
              </div>
            </div>
          )}
          <label className="crm-field">Footer (optional)
            <input className="crm-input" value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={60} placeholder="संदेश बंद करने के लिए STOP लिखें" />
          </label>
          <div className="crm-field">Buttons (optional, up to 3)
            {buttons.map((b, i) => (
              <div key={i} className="wt-btn-row">
                <select className="crm-select" value={b.type} onChange={(e) => setButtons((x) => x.map((y, j) => (j === i ? { ...y, type: e.target.value } : y)))}>
                  <option value="QUICK_REPLY">Quick reply</option><option value="URL">Open a link</option><option value="PHONE_NUMBER">Call</option>
                </select>
                <input className="crm-input" value={b.text} maxLength={25} placeholder="Button text" onChange={(e) => setButtons((x) => x.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)))} />
                {b.type === 'URL' && <input className="crm-input" value={b.url ?? ''} placeholder="https://…" onChange={(e) => setButtons((x) => x.map((y, j) => (j === i ? { ...y, url: e.target.value } : y)))} />}
                {b.type === 'PHONE_NUMBER' && <input className="crm-input" value={b.phone ?? ''} placeholder="10 digits" onChange={(e) => setButtons((x) => x.map((y, j) => (j === i ? { ...y, phone: e.target.value } : y)))} />}
                <button type="button" className="crm-btn is-secondary is-sm" aria-label="Remove button" onClick={() => setButtons((x) => x.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
              </div>
            ))}
            {buttons.length < 3 && <button type="button" className="crm-btn is-secondary is-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setButtons((x) => [...x, { type: 'QUICK_REPLY', text: '' }])}><Plus size={14} aria-hidden /> Add a button</button>}
          </div>
        </div>
        <div className="wt-editor-preview">
          <span className="crm-sub">How it looks</span>
          <div className="wt-phone"><TemplateBubble t={{ header: header || null, body: body || 'Your message…', footer: footer || null, buttons }} values={ex.some((v) => v.trim()) ? ex : undefined} /></div>
        </div>
      </div>
      {error && <div className="crm-error" role="alert">{error}</div>}
    </Modal>
  );
}

function PackModal({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const [items, setItems] = useState<PackItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ name: string; ok: boolean; outcome: string }[] | null>(null);
  useEffect(() => {
    let alive = true;
    crm.get<PackItem[]>('/api/v1/whatsapp/templates/pack').then((r) => { if (alive) setItems(r); }).catch((e) => { if (alive) setError(friendlyError(e)); });
    return () => { alive = false; };
  }, []);
  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await crm.post<{ results: { name: string; ok: boolean; outcome: string }[]; mapped: number }>('/api/v1/whatsapp/templates/install-pack');
      setResults(r.results);
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  const missing = (items ?? []).filter((x) => !x.installed).length;
  return (
    <Modal title="NexEagle templates" onClose={results ? () => onDone('NexEagle templates sent to Meta.') : onClose} wide
      actions={results
        ? <button type="button" className="crm-btn" onClick={() => onDone('NexEagle templates sent to Meta.')}>Done</button>
        : <>
          <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="crm-btn" disabled={busy || !items || missing === 0} onClick={() => void install()}>{busy ? 'Installing…' : missing ? `Install ${missing} ${missing === 1 ? 'template' : 'templates'}` : 'All installed'}</button>
        </>}>
      <p className="crm-sub" style={{ margin: 0 }}>Ready-written Hindi templates for hospitals, with your hospital&apos;s name filled in. They&apos;re created in your own WhatsApp account and reviewed by Meta, then used automatically for follow-ups and broadcasts (unless an admin chose others).</p>
      {error && <div className="crm-error" role="alert">{error}</div>}
      {results ? (
        <ul className="wt-results">
          {results.map((r) => <li key={r.name}>{r.ok ? <CheckCircle2 size={16} className="is-ok" aria-hidden /> : <XCircle size={16} className="is-bad" aria-hidden />}<strong>{r.name}</strong><span className="crm-sub">{r.outcome}</span></li>)}
        </ul>
      ) : !items ? <Skeleton h={300} /> : (
        <div className="wt-pack">
          {items.map((p) => (
            <div key={p.name} className="wt-pack-item">
              <div className="wt-card-head">
                <strong className="wt-name">{p.name}</strong>
                {p.installed ? <Pill tone={p.installed === 'APPROVED' ? 'ok' : 'warn'}>{p.installed === 'APPROVED' ? 'Installed' : (STATUS[p.installed]?.label ?? p.installed)}</Pill> : <Pill tone="neutral"><Clock size={11} aria-hidden /> Not installed</Pill>}
              </div>
              <span className="crm-sub wt-meta">{p.category.toLowerCase()}{p.use ? ` · ${USE_LABEL[p.use] ?? p.use}` : ''}</span>
              <TemplateBubble t={{ header: p.header, body: p.body, footer: p.footer, buttons: [] }} values={p.examples} />
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
