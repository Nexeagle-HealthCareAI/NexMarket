'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArchiveRestore, ClipboardList, Download, FileText, History, Link2, NotebookPen, Paperclip, Pin, PinOff, Plus, Save, Search, Tent, Trash2, Undo2, Unlink, Upload, X } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { friendlyError, Modal, Skeleton } from '@/components/crm/ui';
import { DOC_KIND, MAX_UPLOAD_MB, UPLOAD_ACCEPT, fileSize, type BoardRes, type DocRow } from './shared';
import { EditorContent, ReadOnly, Toolbar, useDocEditor, type JSONContent } from './Editor';
import { PdfView } from './PdfView';

const when = (iso: string) => {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(d);
};

// ─── Templates: a ready outline to start from ────────────────────────────────
type Block = ['h2' | 'p' | 'ul' | 'task', string | string[]];
const text = (t: string): JSONContent[] => (t ? [{ type: 'text', text: t }] : []);
function doc(blocks: Block[]): JSONContent {
  return {
    type: 'doc',
    content: blocks.map(([k, v]) => {
      if (k === 'h2') return { type: 'heading', attrs: { level: 2 }, content: text(v as string) };
      if (k === 'p') return { type: 'paragraph', content: text(v as string) };
      if (k === 'ul') return { type: 'bulletList', content: (v as string[]).map((x) => ({ type: 'listItem', content: [{ type: 'paragraph', content: text(x) }] })) };
      return { type: 'taskList', content: (v as string[]).map((x) => ({ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: text(x) }] })) };
    }),
  };
}
const TEMPLATES: { key: string; label: string; icon: typeof FileText; kind: DocRow['kind']; title: string; content: JSONContent }[] = [
  { key: 'blank', label: 'Blank page', icon: FileText, kind: 'plan', title: 'Untitled plan', content: doc([['p', '']]) },
  { key: 'month', label: 'Monthly marketing plan', icon: ClipboardList, kind: 'plan', title: 'Marketing plan — ', content: doc([
    ['h2', 'Goal this month'], ['p', 'What we want, in numbers: new patients, leads, partners.'],
    ['h2', 'What we will do'], ['ul', ['Camps', 'Partner visits', 'Facebook & Instagram', 'WhatsApp broadcasts', 'Google']],
    ['h2', 'Who does what'], ['task', ['', '']],
    ['h2', 'Budget'], ['p', ''],
    ['h2', 'How we will know it worked'], ['p', ''],
  ]) },
  { key: 'camp', label: 'Health camp plan', icon: Tent, kind: 'plan', title: 'Camp plan — ', content: doc([
    ['h2', 'Where and when'], ['p', 'Place, date, time, panchayat.'],
    ['h2', 'Doctors and staff'], ['ul', ['', '']],
    ['h2', 'Before the camp'], ['task', ['Permission from the mukhiya / school', 'Banners and posters', 'WhatsApp broadcast to the area', 'Tell partners (ASHA, RMP) nearby']],
    ['h2', 'On the day'], ['task', ['Tent, chairs, registration desk', 'Patient register', 'Photos for social media (with consent)']],
    ['h2', 'After the camp'], ['task', ['Follow up patients who need to come in', 'Thank partners', 'Post results']],
  ]) },
  { key: 'notes', label: 'Meeting notes', icon: NotebookPen, kind: 'notes', title: 'Meeting — ', content: doc([
    ['h2', 'Who was there'], ['p', ''], ['h2', 'What we decided'], ['ul', ['']], ['h2', 'Actions'], ['task', ['']],
  ]) },
];

/** Plans & docs: everything the team has written, with search, and a rich editor beside it. */
export function Docs({ board, toast, openCard, docId, setDoc }: {
  board: BoardRes; toast: (m: string) => void; openCard: (id: string) => void; docId: string | null; setDoc: (id: string | null) => void;
}) {
  const [rows, setRows] = useState<DocRow[] | null>(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'' | DocRow['kind']>('');
  const [archived, setArchived] = useState(false);
  const [bin, setBin] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [newOpen, setNewOpen] = useState(false);
  const dirtyRef = useRef(false);
  const nameOf = useCallback((a: string) => board.people.find((p) => p.agentId === a)?.name ?? a, [board.people]);

  const load = useCallback(async () => {
    try {
      const sp = new URLSearchParams();
      if (q.trim()) sp.set('q', q.trim());
      if (kind) sp.set('kind', kind);
      if (bin) sp.set('bin', 'true'); else if (archived) sp.set('archived', 'true');
      setRows(await crm.get<DocRow[]>(`/api/v1/work/docs${sp.size ? `?${sp}` : ''}`));
    } catch (e) { toast(friendlyError(e)); setRows([]); }
  }, [q, kind, archived, bin, toast]);
  useEffect(() => { const t = setTimeout(() => void load(), q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);

  const pick = (id: string | null) => {
    if (dirtyRef.current && !window.confirm('You have unsaved changes. Leave this document without saving?')) return;
    dirtyRef.current = false;
    setDoc(id);
  };
  const create = async (t: (typeof TEMPLATES)[number]) => {
    try {
      const d = await crm.post<DocRow>('/api/v1/work/docs', { title: t.title.endsWith('— ') ? t.title + new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }) : t.title, kind: t.kind, content: t.content, text: '' });
      setNewOpen(false);
      setRows((r) => [d, ...(r ?? [])]);
      pick(d.id);
    } catch (e) { toast(friendlyError(e)); }
  };

  /** Which list a document belongs in now: the Bin, the Archive or the main list. */
  const here = (d: DocRow) => (bin ? !!d.deleted : !d.deleted && d.archived === archived);
  const upload = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_UPLOAD_MB * 1048576) { toast(`Files can be up to ${MAX_UPLOAD_MB} MB. This one is ${fileSize(f.size)}.`); return; }
    if (dirtyRef.current && !window.confirm('You have unsaved changes. Leave this document without saving?')) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', f);
      const d = await crm.upload<DocRow>('/api/v1/work/docs/upload', form);
      if (bin) setBin(false); else if (archived) setArchived(false); else setRows((r) => [d, ...(r ?? [])]);
      dirtyRef.current = false;
      setDoc(d.id);
      toast('Uploaded.');
    } catch (e) { toast(friendlyError(e)); }
    finally { setUploading(false); if (fileInput.current) fileInput.current.value = ''; }
  };

  return (
    <div className={`wk-docs${docId ? ' has-doc' : ''}`}>
      <aside className="wk-docs-list" aria-label="Plans and documents">
        <div className="wk-docs-top">
          <button type="button" className="crm-btn" onClick={() => setNewOpen(true)}><Plus size={16} aria-hidden /> New plan</button>
          <button type="button" className="crm-btn is-secondary" disabled={uploading} onClick={() => fileInput.current?.click()}><Upload size={16} aria-hidden /> {uploading ? 'Uploading…' : 'Upload'}</button>
          <input ref={fileInput} type="file" hidden accept={UPLOAD_ACCEPT} aria-label="Upload a file" onChange={(e) => void upload(e.target.files?.[0])} />
        </div>
        <div className="wk-docs-top">
          <button type="button" className="crm-chip" aria-pressed={archived && !bin} onClick={() => { setBin(false); setArchived((a) => bin ? true : !a); }}><Archive size={14} aria-hidden /> Archive</button>
          <button type="button" className="crm-chip" aria-pressed={bin} onClick={() => setBin((b) => !b)}><Trash2 size={14} aria-hidden /> Bin</button>
        </div>
        <label className="crm-search"><Search size={15} aria-hidden /><span className="crm-sr">Search plans</span>
          <input className="crm-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles and text" /></label>
        <div className="crm-chips" role="tablist" aria-label="Kind">
          {([['', 'All'], ['plan', 'Plans'], ['doc', 'Documents'], ['notes', 'Meeting notes'], ['file', 'Files']] as const).map(([k, l]) => (
            <button key={k} type="button" className="crm-chip" aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>
          ))}
        </div>
        {!rows ? <Skeleton h={200} /> : rows.length === 0 ? (
          <p className="crm-sub wk-docs-empty">{q || kind ? 'Nothing matches.' : bin ? 'The Bin is empty.' : archived ? 'Nothing archived.' : 'No plans yet. Press “New plan” to write the first one, or “Upload” to add a file.'}</p>
        ) : (
          <ul>
            {rows.map((d) => (
              <li key={d.id}>
                <button type="button" className="wk-doc-row" aria-current={d.id === docId ? 'true' : undefined} onClick={() => pick(d.id)}>
                  <span className="wk-doc-row-top">
                    {d.pinned && <Pin size={13} aria-label="Pinned" className="wk-pin" />}
                    {d.kind === 'file' && <Paperclip size={13} aria-hidden className="wk-pin" />}
                    <strong>{d.title}</strong>
                  </span>
                  <span className="wk-doc-row-meta">{d.file ? `${d.file.name.split('.').pop()?.toUpperCase()} · ${fileSize(d.file.size)}` : DOC_KIND[d.kind]} · {nameOf(d.deleted && d.deletedBy ? d.deletedBy : d.updatedBy)} · {when(d.deleted && d.deletedAt ? d.deletedAt : d.updatedAt)}{d.card ? ` · #${d.card.number}` : ''}</span>
                  {d.preview && !d.file && <span className="wk-doc-row-prev">{d.preview}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className="wk-docs-main">
        {docId ? (
          <DocEditor key={docId} id={docId} board={board} toast={toast} openCard={openCard} dirtyRef={dirtyRef}
            onClose={() => pick(null)} onSaved={(d) => setRows((r) => {
              const list = (r ?? []).filter((x) => x.id !== d.id);
              return here(d) ? [d, ...list].sort((a, b) => Number(b.pinned) - Number(a.pinned)) : list;
            })} onGone={(gone) => setRows((r) => (r ?? []).filter((x) => x.id !== gone))} />
        ) : (
          <div className="wk-docs-blank">
            <FileText size={30} aria-hidden />
            <strong>Plans and documents for the team</strong>
            <span className="crm-sub">Write plans, camp checklists and meeting notes here, or upload a PDF, Word file or picture and read it in this page. Everyone in the CRM can read and edit them, and every earlier version is kept.</span>
            <div className="wk-tpl-grid">
              {TEMPLATES.map((t) => <button key={t.key} type="button" className="wk-tpl" onClick={() => void create(t)}><t.icon size={20} aria-hidden /><span>{t.label}</span></button>)}
              <button type="button" className="wk-tpl" disabled={uploading} onClick={() => fileInput.current?.click()}><Upload size={20} aria-hidden /><span>{uploading ? 'Uploading…' : 'Upload a file'}</span></button>
            </div>
          </div>
        )}
      </section>
      {newOpen && (
        <Modal title="New plan" onClose={() => setNewOpen(false)}>
          <p className="crm-sub" style={{ marginTop: 0 }}>Start from a blank page or a ready outline.</p>
          <div className="wk-tpl-grid">
            {TEMPLATES.map((t) => <button key={t.key} type="button" className="wk-tpl" onClick={() => void create(t)}><t.icon size={20} aria-hidden /><span>{t.label}</span></button>)}
          </div>
        </Modal>
      )}
    </div>
  );
}

interface DocRes { doc: DocRow; content: JSONContent }
interface Rev { id: string; version: number; title: string; savedBy: string; savedAt: string }

/** One plan in the editor. Saves by itself a few seconds after you stop typing, or with Ctrl+S. */
function DocEditor({ id, board, toast, openCard, onClose, onSaved, onGone, dirtyRef }: {
  id: string; board: BoardRes; toast: (m: string) => void; openCard: (id: string) => void; onClose: () => void;
  onSaved: (d: DocRow) => void; onGone: (id: string) => void; dirtyRef: React.MutableRefObject<boolean>;
}) {
  const [row, setRow] = useState<DocRow | null>(null);
  const [title, setTitle] = useState('');
  const [dirty, setDirtyState] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<{ by: string; at: string } | null>(null);
  const [histOpen, setHistOpen] = useState(false);
  const [words, setWords] = useState(0);
  const loading = useRef(true);
  const version = useRef(0);
  const nameOf = (a: string) => board.people.find((p) => p.agentId === a)?.name ?? a;
  const setDirty = useCallback((v: boolean) => { dirtyRef.current = v; setDirtyState(v); }, [dirtyRef]);

  // Typing must never wait for, or be undone by, anything else on the page. So everything saving needs is kept in
  // refs: the page can redraw (the list, the board, a toast) without the document being fetched again or the
  // editor being touched.
  const AUTOSAVE_MS = 2500;
  const rowRef = useRef<DocRow | null>(null);
  const titleRef = useRef('');
  const changes = useRef(0);                    // goes up with every edit
  const savingRef = useRef(false);
  const conflictRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef<(force?: boolean) => Promise<void>>(async () => {});
  const out = useRef({ toast, onClose, onSaved });
  useEffect(() => { out.current = { toast, onClose, onSaved }; });
  const putRow = useCallback((d: DocRow) => { rowRef.current = d; setRow(d); }, []);
  const later = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void saveRef.current(); }, ms);
  }, []);
  /** Something changed: mark it, and save once the person pauses. Each new change restarts the wait. */
  const touched = useCallback(() => {
    if (loading.current) return;
    changes.current += 1;
    setDirty(true);
    if (!conflictRef.current) later(AUTOSAVE_MS);
  }, [setDirty, later]);

  const editor = useDocEditor(null, touched);

  // Load once per document. (Not again when the page around it redraws: that used to replace what was being typed.)
  useEffect(() => {
    if (!editor) return;
    let alive = true;
    crm.get<DocRes>(`/api/v1/work/docs/${id}`).then((r) => {
      if (!alive) return;
      loading.current = true;
      editor.commands.setContent(r.content?.type === 'doc' ? r.content : { type: 'doc', content: [{ type: 'paragraph' }] }, { emitUpdate: false });
      loading.current = false;
      version.current = r.doc.version;
      titleRef.current = r.doc.title;
      putRow(r.doc); setTitle(r.doc.title); setWords(editor.getText().split(/\s+/).filter(Boolean).length);
    }).catch((e) => { out.current.toast(friendlyError(e)); out.current.onClose(); });
    return () => { alive = false; };
  }, [editor, id, putRow]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const save = useCallback(async (force = false) => {
    const row = rowRef.current;
    if (!editor || !row || savingRef.current) return;   // a save already running picks up later edits when it ends
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    savingRef.current = true;
    setSaving(true);
    const at = changes.current;
    try {
      const plain = editor.getText({ blockSeparator: '\n' });
      const d = await crm.put<DocRow>(`/api/v1/work/docs/${row.id}${force ? '?force=true' : ''}`, {
        title: titleRef.current.trim() || 'Untitled plan', content: editor.getJSON(), text: plain, version: version.current,
      });
      version.current = d.version;
      conflictRef.current = false;
      putRow(d); setConflict(null); out.current.onSaved(d);
      // Typed while it was saving? Those words are not saved yet: keep "Unsaved changes" and save again after a pause.
      if (changes.current === at) setDirty(false); else later(AUTOSAVE_MS);
    } catch (e) {
      const m = String((e as Error)?.message ?? '');
      if (m.includes('→ 409')) {
        conflictRef.current = true;
        try { const j = JSON.parse(m.slice(m.indexOf(': ') + 2)); setConflict({ by: j.updatedBy ?? '', at: j.updatedAt ?? '' }); } catch { setConflict({ by: '', at: '' }); }
      } else {
        out.current.toast(friendlyError(e));
        later(15000);   // no connection or a server hiccup: try again by itself
      }
    } finally { savingRef.current = false; setSaving(false); }
  }, [editor, putRow, setDirty, later]);
  useEffect(() => { saveRef.current = save; });

  // Word count: after a pause, not on every key (counting a long plan on each keystroke made typing lag).
  useEffect(() => {
    if (!editor) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const count = () => { if (t) clearTimeout(t); t = setTimeout(() => setWords(editor.getText().split(/\s+/).filter(Boolean).length), 600); };
    editor.on('update', count);
    return () => { editor.off('update', count); if (t) clearTimeout(t); };
  }, [editor]);
  // Ctrl+S, and a warning before closing the tab with unsaved changes.
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void saveRef.current(); } };
    const leave = (e: BeforeUnloadEvent) => { if (dirtyRef.current) e.preventDefault(); };
    window.addEventListener('keydown', k);
    window.addEventListener('beforeunload', leave);
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('beforeunload', leave); };
  }, [dirtyRef]);

  // On a phone the document opens below the board's numbers: bring it to the top of the screen once it has loaded.
  const article = useRef<HTMLElement>(null);
  const loaded = !!row;
  useEffect(() => {
    if (loaded && window.innerWidth < 900) article.current?.scrollIntoView({ block: 'start' });
  }, [loaded]);

  // In the Bin it can be read, not changed.
  const inBin = !!row?.deleted;
  useEffect(() => { if (editor) editor.setEditable(!inBin, false); }, [editor, inBin]);

  /** To the Bin. It can be put back from there; nothing is removed. */
  const toBin = async () => {
    if (!row) return;
    try {
      if (dirtyRef.current) await saveRef.current();   // keep the last words before it goes
      const d = await crm.post<DocRow>(`/api/v1/work/docs/${row.id}/delete`);
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      setDirty(false);
      putRow(d); onSaved(d);
      toast('Moved to the Bin. Open “Bin” to put it back.');
      onClose();
    } catch (e) { toast(friendlyError(e)); }
  };
  const putBack = async () => {
    if (!row) return;
    try { const d = await crm.post<DocRow>(`/api/v1/work/docs/${row.id}/delete?undo=true`); putRow(d); onSaved(d); toast('Put back in the list.'); onClose(); }
    catch (e) { toast(friendlyError(e)); }
  };
  const erase = async () => {
    if (!row) return;
    const what = row.file ? 'this file' : 'this document and all its earlier versions';
    if (!window.confirm(`Delete “${row.title}” for ever?\n\nThis removes ${what}. It cannot be undone.`)) return;
    try { await crm.del(`/api/v1/work/docs/${row.id}`); setDirty(false); onGone(row.id); toast('Deleted for ever.'); onClose(); }
    catch (e) { toast(friendlyError(e)); }
  };

  const flag = async (what: 'pin' | 'archive', undo: boolean) => {
    if (!row) return;
    try { const d = await crm.post<DocRow>(`/api/v1/work/docs/${row.id}/${what}${undo ? '?undo=true' : ''}`); putRow(d); onSaved(d); if (what === 'archive') toast(undo ? 'Back in the list.' : 'Archived. Find it under “Archive”.'); }
    catch (e) { toast(friendlyError(e)); }
  };
  const reloadTheirs = async () => {
    if (!editor) return;
    const r = await crm.get<DocRes>(`/api/v1/work/docs/${id}`);
    loading.current = true; editor.commands.setContent(r.content, { emitUpdate: false }); loading.current = false;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    conflictRef.current = false; titleRef.current = r.doc.title;
    version.current = r.doc.version; putRow(r.doc); setTitle(r.doc.title); setDirty(false); setConflict(null);
  };
  const setKind = async (k: DocRow['kind']) => {
    if (!row || !editor) return;
    try { const d = await crm.put<DocRow>(`/api/v1/work/docs/${row.id}`, { kind: k, version: version.current }); version.current = d.version; putRow(d); onSaved(d); }
    catch (e) { toast(friendlyError(e)); }
  };
  const unlink = async () => {
    if (!row) return;
    try { const d = await crm.put<DocRow>(`/api/v1/work/docs/${row.id}`, { cardId: '00000000-0000-0000-0000-000000000000', version: version.current }); version.current = d.version; putRow(d); onSaved(d); }
    catch (e) { toast(friendlyError(e)); }
  };

  if (!editor || !row) return <Skeleton h={480} />;
  return (
    <article className="wk-doc" ref={article}>
      <header className="wk-doc-head">
        <button type="button" className="wk-x wk-doc-back" aria-label="Close" onClick={onClose}><X size={18} aria-hidden /></button>
        {row.kind === 'file' ? <span className="wk-doc-filetag"><Paperclip size={14} aria-hidden /> File</span> : (
          <select className="crm-input wk-small-in" value={row.kind} disabled={inBin} onChange={(e) => void setKind(e.target.value as DocRow['kind'])} aria-label="Kind">
            {(Object.keys(DOC_KIND) as DocRow['kind'][]).filter((k) => k !== 'file').map((k) => <option key={k} value={k}>{DOC_KIND[k]}</option>)}
          </select>
        )}
        {row.card && row.cardId && (
          <span className="wk-doc-card">
            <button type="button" className="wa-link" onClick={() => openCard(row.cardId!)}><Link2 size={13} aria-hidden /> #{row.card.number} {row.card.title}</button>
            <button type="button" className="wk-icon-btn" aria-label="Unlink from the card" title="Unlink from the card" onClick={() => void unlink()}><Unlink size={13} aria-hidden /></button>
          </span>
        )}
        <span className="wk-doc-status" aria-live="polite">
          {inBin ? 'In the Bin' : conflict ? <span className="wk-late">Not saved</span> : saving ? 'Saving…' : dirty ? 'Unsaved changes' : `Saved · ${nameOf(row.updatedBy)} · ${when(row.updatedAt)}`}
        </span>
        {inBin ? (
          <span className="sp-actions">
            <button type="button" className="crm-btn is-sm" onClick={() => void putBack()}><Undo2 size={14} aria-hidden /> Put back</button>
            {row.canErase && <button type="button" className="crm-btn is-secondary is-sm wk-danger" onClick={() => void erase()}><Trash2 size={14} aria-hidden /> Delete for ever</button>}
          </span>
        ) : (
          <span className="sp-actions">
            {row.kind !== 'file' && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setHistOpen(true)}><History size={14} aria-hidden /> History</button>}
            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void flag('pin', row.pinned)}>{row.pinned ? <><PinOff size={14} aria-hidden /> Unpin</> : <><Pin size={14} aria-hidden /> Pin</>}</button>
            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void flag('archive', row.archived)}>{row.archived ? <><ArchiveRestore size={14} aria-hidden /> Bring back</> : <><Archive size={14} aria-hidden /> Archive</>}</button>
            <button type="button" className="crm-btn is-secondary is-sm wk-danger" onClick={() => void toBin()}><Trash2 size={14} aria-hidden /> Delete</button>
            <button type="button" className="crm-btn is-sm" disabled={saving || (!dirty && !conflict)} onClick={() => void save()}><Save size={14} aria-hidden /> Save</button>
          </span>
        )}
      </header>
      {inBin && (
        <div className="ld-banner wk-conflict" role="status">
          <span><strong>This is in the Bin.</strong> {row.deletedBy ? `${nameOf(row.deletedBy)} deleted it` : 'Deleted'}{row.deletedAt ? ` ${when(row.deletedAt)}` : ''}. Put it back to use it again{row.canErase ? ', or delete it for ever.' : '. Only an admin or the person who wrote it can delete it for ever.'}</span>
        </div>
      )}
      {conflict && (
        <div className="ld-banner wk-conflict" role="alert">
          <span><strong>{conflict.by ? nameOf(conflict.by) : 'Someone else'} saved this plan {conflict.at ? when(conflict.at) : ''} while you were editing.</strong> Their version and yours are both kept in History whichever you choose.</span>
          <span className="sp-actions">
            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void reloadTheirs()}>Load their version</button>
            <button type="button" className="crm-btn is-sm" onClick={() => void save(true)}>Save mine on top</button>
          </span>
        </div>
      )}
      <input className="wk-doc-title" value={title} maxLength={200} onChange={(e) => { setTitle(e.target.value); titleRef.current = e.target.value; touched(); }} placeholder="Title" aria-label="Title" readOnly={inBin} />
      {row.kind === 'file' && row.file ? (
        <>
          <span className="crm-sub wk-doc-sub">Uploaded by {nameOf(row.createdBy)} · {when(row.createdAt)} · {row.file.name} · {fileSize(row.file.size)}</span>
          <FileView id={row.id} file={row.file} toast={toast} />
        </>
      ) : (
        <>
      <span className="crm-sub wk-doc-sub">Started by {nameOf(row.createdBy)} · {when(row.createdAt)} · {words} words</span>
      {!inBin && <Toolbar editor={editor} />}
      {/* A click on the empty space under the text puts the cursor at the end, like paper. */}
      <div className="wk-doc-body" onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('.ProseMirror')) { e.preventDefault(); editor.commands.focus('end'); } }}>
        <EditorContent editor={editor} />
      </div>
        </>
      )}
      {histOpen && <HistoryModal id={row.id} nameOf={nameOf} onClose={() => setHistOpen(false)} onRestore={(c, t) => {
        titleRef.current = t; setTitle(t); editor.commands.setContent(c); touched(); setHistOpen(false); toast('Earlier version put back. It saves in a moment (the current one stays in History).');
      }} />}
    </article>
  );
}

/** Shows an uploaded file in the page: PDFs, pictures, text and Word files open here; anything else is a download. */
function FileView({ id, file, toast }: { id: string; file: { name: string; mime: string; size: number }; toast: (m: string) => void }) {
  type View = { kind: 'pdf'; data: ArrayBuffer } | { kind: 'image'; url: string } | { kind: 'text'; text: string; cut: boolean } | { kind: 'word'; html: string } | { kind: 'none' } | { kind: 'error'; message: string };
  const [view, setView] = useState<View | null>(null);
  const path = `/api/v1/work/docs/${id}/file`;
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();

  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    (async () => {
      try {
        if (file.mime !== 'application/pdf' && !file.mime.startsWith('image/') && !file.mime.startsWith('text/') && ext !== 'docx') { setView({ kind: 'none' }); return; }
        const blob = await crm.blob(path);
        if (!alive) return;
        if (file.mime === 'application/pdf') {
          const data = await blob.arrayBuffer();
          if (alive) setView({ kind: 'pdf', data });
        } else if (file.mime.startsWith('image/')) {
          url = URL.createObjectURL(blob);
          setView({ kind: 'image', url });
        } else if (file.mime.startsWith('text/')) {
          const t = await blob.text();
          if (alive) setView({ kind: 'text', text: t.slice(0, 300000), cut: t.length > 300000 });
        } else {
          // Word (.docx): turned into a simple page here in the browser. It is shown in a locked frame: nothing in it can run.
          const mammoth = await import('mammoth');
          const out = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
          if (alive) setView({ kind: 'word', html: out.value });
        }
      } catch (e) { if (alive) setView({ kind: 'error', message: friendlyError(e) }); }
    })();
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [path, file.mime, ext]);

  const download = () => { void crm.download(`${path}?download=true`, file.name).catch((e) => toast(friendlyError(e))); };
  const wordPage = (html: string) => `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font:15.5px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1d2433;margin:24px;max-width:820px}
    img{max-width:100%;height:auto}table{border-collapse:collapse;margin:12px 0}td,th{border:1px solid #d6dbe4;padding:6px 8px;vertical-align:top}
    h1{font-size:1.7em}h2{font-size:1.35em}h3{font-size:1.12em}a{color:#0a5cc2}</style></head><body>${html}</body></html>`;

  return (
    <div className="wk-file">
      <div className="wk-file-bar">
        <button type="button" className="crm-btn is-secondary is-sm" onClick={download}><Download size={14} aria-hidden /> Download</button>
        {view?.kind === 'word' && <span className="crm-sub">Shown as plain reading text. Download it to see the exact layout.</span>}
      </div>
      {!view ? <Skeleton h={420} />
        : view.kind === 'pdf' ? <PdfView data={view.data} name={file.name} onFail={() => setView({ kind: 'error', message: 'This PDF could not be opened here. It may be damaged or locked with a password. Download it to open it.' })} />
        : view.kind === 'image' ? (
          <div className="wk-file-img">
            {/* A private file fetched with the session, shown from memory: next/image cannot load it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={view.url} alt={file.name} />
          </div>
        )
        : view.kind === 'text' ? <pre className="wk-file-text" tabIndex={0}>{view.text}{view.cut ? '\n\n… the rest is not shown. Download the file to read all of it.' : ''}</pre>
        : view.kind === 'word' ? <iframe className="wk-file-frame" sandbox="" srcDoc={wordPage(view.html)} title={file.name} />
        : view.kind === 'error' ? <p className="wk-file-none" role="alert">{view.message}</p>
        : (
          <div className="wk-file-none">
            <FileText size={28} aria-hidden />
            <strong>{ext.toUpperCase()} files can’t be shown in the page.</strong>
            <span className="crm-sub">Download it to open it in {ext.startsWith('xls') ? 'Excel' : ext.startsWith('ppt') ? 'PowerPoint' : 'Word'}. PDF, Word (.docx), pictures and text files open here.</span>
            <button type="button" className="crm-btn is-sm" onClick={download}><Download size={14} aria-hidden /> Download</button>
          </div>
        )}
    </div>
  );
}

function HistoryModal({ id, nameOf, onClose, onRestore }: { id: string; nameOf: (a: string) => string; onClose: () => void; onRestore: (c: JSONContent, title: string) => void }) {
  const [list, setList] = useState<Rev[] | null>(null);
  const [sel, setSel] = useState<(Rev & { content: JSONContent }) | null>(null);
  useEffect(() => { void crm.get<Rev[]>(`/api/v1/work/docs/${id}/history`).then(setList).catch(() => setList([])); }, [id]);
  const open = async (r: Rev) => { try { setSel(await crm.get<Rev & { content: JSONContent }>(`/api/v1/work/docs/${id}/history/${r.id}`)); } catch { /* keep the list */ } };
  const content = useMemo(() => sel?.content ?? null, [sel]);
  return (
    <Modal title="Earlier versions" onClose={onClose} wide actions={sel ? <>
      <button type="button" className="crm-btn is-secondary" onClick={() => setSel(null)}>Back to the list</button>
      <button type="button" className="crm-btn" onClick={() => onRestore(sel.content, sel.title)}>Put this version back</button>
    </> : undefined}>
      {!list ? <Skeleton h={160} /> : sel && content ? (
        <div className="wk-hist-view">
          <p className="crm-sub" style={{ marginTop: 0 }}>Version {sel.version} · saved by {nameOf(sel.savedBy)} · {when(sel.savedAt)}</p>
          <h2 className="wk-doc-title is-static">{sel.title}</h2>
          <div className="wk-doc-body"><ReadOnly content={content} /></div>
        </div>
      ) : list.length === 0 ? <p className="crm-sub">No earlier versions yet. One is kept every time the plan is saved again.</p> : (
        <ul className="wk-hist">
          {list.map((r) => (
            <li key={r.id}><button type="button" onClick={() => void open(r)}><strong>Version {r.version}</strong> <span>{r.title}</span> <span className="crm-sub">{nameOf(r.savedBy)} · {when(r.savedAt)}</span></button></li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
