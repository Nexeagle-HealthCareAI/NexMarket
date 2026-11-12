'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArchiveRestore, ClipboardList, FileText, History, Link2, NotebookPen, Pin, PinOff, Plus, Save, Search, Tent, Unlink, X } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { friendlyError, Modal, Skeleton } from '@/components/crm/ui';
import { DOC_KIND, type BoardRes, type DocRow } from './shared';
import { EditorContent, ReadOnly, Toolbar, useDocEditor, type JSONContent } from './Editor';

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
  const [newOpen, setNewOpen] = useState(false);
  const dirtyRef = useRef(false);
  const nameOf = useCallback((a: string) => board.people.find((p) => p.agentId === a)?.name ?? a, [board.people]);

  const load = useCallback(async () => {
    try {
      const sp = new URLSearchParams();
      if (q.trim()) sp.set('q', q.trim());
      if (kind) sp.set('kind', kind);
      if (archived) sp.set('archived', 'true');
      setRows(await crm.get<DocRow[]>(`/api/v1/work/docs${sp.size ? `?${sp}` : ''}`));
    } catch (e) { toast(friendlyError(e)); setRows([]); }
  }, [q, kind, archived, toast]);
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

  return (
    <div className={`wk-docs${docId ? ' has-doc' : ''}`}>
      <aside className="wk-docs-list" aria-label="Plans and documents">
        <div className="wk-docs-top">
          <button type="button" className="crm-btn" onClick={() => setNewOpen(true)}><Plus size={16} aria-hidden /> New plan</button>
          <button type="button" className="crm-chip" aria-pressed={archived} onClick={() => setArchived((a) => !a)}><Archive size={14} aria-hidden /> Archive</button>
        </div>
        <label className="crm-search"><Search size={15} aria-hidden /><span className="crm-sr">Search plans</span>
          <input className="crm-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles and text" /></label>
        <div className="crm-chips" role="tablist" aria-label="Kind">
          {([['', 'All'], ['plan', 'Plans'], ['doc', 'Documents'], ['notes', 'Meeting notes']] as const).map(([k, l]) => (
            <button key={k} type="button" className="crm-chip" aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>
          ))}
        </div>
        {!rows ? <Skeleton h={200} /> : rows.length === 0 ? (
          <p className="crm-sub wk-docs-empty">{q || kind ? 'Nothing matches.' : archived ? 'Nothing archived.' : 'No plans yet. Press “New plan” to write the first one.'}</p>
        ) : (
          <ul>
            {rows.map((d) => (
              <li key={d.id}>
                <button type="button" className="wk-doc-row" aria-current={d.id === docId ? 'true' : undefined} onClick={() => pick(d.id)}>
                  <span className="wk-doc-row-top">
                    {d.pinned && <Pin size={13} aria-label="Pinned" className="wk-pin" />}
                    <strong>{d.title}</strong>
                  </span>
                  <span className="wk-doc-row-meta">{DOC_KIND[d.kind]} · {nameOf(d.updatedBy)} · {when(d.updatedAt)}{d.card ? ` · #${d.card.number}` : ''}</span>
                  {d.preview && <span className="wk-doc-row-prev">{d.preview}</span>}
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
              return d.archived === archived ? [d, ...list].sort((a, b) => Number(b.pinned) - Number(a.pinned)) : list;
            })} />
        ) : (
          <div className="wk-docs-blank">
            <FileText size={30} aria-hidden />
            <strong>Plans and documents for the team</strong>
            <span className="crm-sub">Write plans, camp checklists and meeting notes here. Everyone in the CRM can read and edit them, and every earlier version is kept.</span>
            <div className="wk-tpl-grid">
              {TEMPLATES.map((t) => <button key={t.key} type="button" className="wk-tpl" onClick={() => void create(t)}><t.icon size={20} aria-hidden /><span>{t.label}</span></button>)}
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
function DocEditor({ id, board, toast, openCard, onClose, onSaved, dirtyRef }: {
  id: string; board: BoardRes; toast: (m: string) => void; openCard: (id: string) => void; onClose: () => void;
  onSaved: (d: DocRow) => void; dirtyRef: React.MutableRefObject<boolean>;
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
    <article className="wk-doc">
      <header className="wk-doc-head">
        <button type="button" className="wk-x wk-doc-back" aria-label="Close" onClick={onClose}><X size={18} aria-hidden /></button>
        <select className="crm-input wk-small-in" value={row.kind} onChange={(e) => void setKind(e.target.value as DocRow['kind'])} aria-label="Kind">
          {(Object.keys(DOC_KIND) as DocRow['kind'][]).map((k) => <option key={k} value={k}>{DOC_KIND[k]}</option>)}
        </select>
        {row.card && row.cardId && (
          <span className="wk-doc-card">
            <button type="button" className="wa-link" onClick={() => openCard(row.cardId!)}><Link2 size={13} aria-hidden /> #{row.card.number} {row.card.title}</button>
            <button type="button" className="wk-icon-btn" aria-label="Unlink from the card" title="Unlink from the card" onClick={() => void unlink()}><Unlink size={13} aria-hidden /></button>
          </span>
        )}
        <span className="wk-doc-status" aria-live="polite">
          {conflict ? <span className="wk-late">Not saved</span> : saving ? 'Saving…' : dirty ? 'Unsaved changes' : `Saved · ${nameOf(row.updatedBy)} · ${when(row.updatedAt)}`}
        </span>
        <span className="sp-actions">
          <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setHistOpen(true)}><History size={14} aria-hidden /> History</button>
          <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void flag('pin', row.pinned)}>{row.pinned ? <><PinOff size={14} aria-hidden /> Unpin</> : <><Pin size={14} aria-hidden /> Pin</>}</button>
          <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void flag('archive', row.archived)}>{row.archived ? <><ArchiveRestore size={14} aria-hidden /> Bring back</> : <><Archive size={14} aria-hidden /> Archive</>}</button>
          <button type="button" className="crm-btn is-sm" disabled={saving || (!dirty && !conflict)} onClick={() => void save()}><Save size={14} aria-hidden /> Save</button>
        </span>
      </header>
      {conflict && (
        <div className="ld-banner wk-conflict" role="alert">
          <span><strong>{conflict.by ? nameOf(conflict.by) : 'Someone else'} saved this plan {conflict.at ? when(conflict.at) : ''} while you were editing.</strong> Their version and yours are both kept in History whichever you choose.</span>
          <span className="sp-actions">
            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void reloadTheirs()}>Load their version</button>
            <button type="button" className="crm-btn is-sm" onClick={() => void save(true)}>Save mine on top</button>
          </span>
        </div>
      )}
      <input className="wk-doc-title" value={title} maxLength={200} onChange={(e) => { setTitle(e.target.value); titleRef.current = e.target.value; touched(); }} placeholder="Title" aria-label="Title" />
      <span className="crm-sub wk-doc-sub">Started by {nameOf(row.createdBy)} · {when(row.createdAt)} · {words} words</span>
      <Toolbar editor={editor} />
      {/* A click on the empty space under the text puts the cursor at the end, like paper. */}
      <div className="wk-doc-body" onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('.ProseMirror')) { e.preventDefault(); editor.commands.focus('end'); } }}>
        <EditorContent editor={editor} />
      </div>
      {histOpen && <HistoryModal id={row.id} nameOf={nameOf} onClose={() => setHistOpen(false)} onRestore={(c, t) => {
        titleRef.current = t; setTitle(t); editor.commands.setContent(c); touched(); setHistOpen(false); toast('Earlier version put back. It saves in a moment (the current one stays in History).');
      }} />}
    </article>
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
