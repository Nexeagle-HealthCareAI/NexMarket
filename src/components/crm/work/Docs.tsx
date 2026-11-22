'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, ArchiveRestore, Check, ChevronRight, ClipboardList, Clock, Copy as CopyIcon, Download, FileText, Folder, FolderInput, FolderPlus, History, Home, Link2, Lock,
  MessageSquare, MessageSquarePlus, MoreHorizontal, NotebookPen, Paperclip, Pencil, Pin, PinOff, Plus, Printer, Save, Search, Share2, Star, Tent, Trash2, Undo2, Unlink, Upload, Users, X,
} from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { friendlyError, Modal, Skeleton } from '@/components/crm/ui';
import { canEdit, DOC_KIND, FOLDER_COLORS, MAX_UPLOAD_MB, UPLOAD_ACCEPT, fileSize, type BoardRes, type DocRow, type FolderRow } from './shared';
import { useLiveEvents } from '@/lib/crm/live';
import { COMMENT_PICK, CommentsPanel, selectionAnchor } from './DocComments';
import { MoveModal, ShareModal } from './DocShare';
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

type Place = { t: 'folder'; id: string | null } | { t: 'starred' | 'shared' | 'private' | 'recent' | 'archive' | 'bin' };
const PLACES: { t: Exclude<Place['t'], 'folder'>; label: string; icon: typeof FileText }[] = [
  { t: 'recent', label: 'Recent', icon: Clock },
  { t: 'starred', label: 'Starred', icon: Star },
  { t: 'shared', label: 'Shared with me', icon: Users },
  { t: 'private', label: 'Only me (private)', icon: Lock },
  { t: 'archive', label: 'Archive', icon: Archive },
  { t: 'bin', label: 'Bin', icon: Trash2 },
];
const DRAG = 'application/x-nexmarket-docs';
type Drag = { docs: string[]; folders: string[] };
const loadOpen = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem('wk-docs-open') ?? '[]') as string[]); } catch { return new Set(); } };

/**
 * Plans & docs: folders (inside folders), drag and drop, private and shared documents, stars, search, and a rich editor
 * with Google Docs–style comments beside it.
 */
export function Docs({ board, toast, openCard, docId, folderParam, commentParam, setQuery }: {
  board: BoardRes; toast: (m: string) => void; openCard: (id: string) => void; docId: string | null;
  folderParam: string | null; commentParam: string | null; setQuery: (changes: Record<string, string | null>) => void;
}) {
  const [place, setPlace] = useState<Place>(() => ({ t: 'folder', id: folderParam }));
  const [rows, setRows] = useState<DocRow[] | null>(null);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [binFolders, setBinFolders] = useState<FolderRow[]>([]);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'' | DocRow['kind']>('');
  const [sort, setSort] = useState<'updated' | 'name' | 'created'>('updated');
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newPrivate, setNewPrivate] = useState(false);
  const [folderForm, setFolderForm] = useState<{ id?: string; name: string; color: string; private: boolean } | null>(null);
  const [share, setShare] = useState<{ kind: 'doc' | 'folder'; id: string; title: string; addFirst?: string[] } | null>(null);
  const [moving, setMoving] = useState<Drag | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [over, setOver] = useState<string | null>(null);        // a drop target under the pointer ('root', a folder id, or 'list')
  const [openNodes, setOpenNodes] = useState<Set<string>>(() => (typeof window === 'undefined' ? new Set() : loadOpen()));
  const [menu, setMenu] = useState(false);
  const [tick, setTick] = useState(0);                          // a live change from someone else: reload
  const dirtyRef = useRef(false);
  const nameOf = useCallback((a: string) => board.people.find((p) => p.agentId === a)?.name ?? a, [board.people]);
  const folderId = place.t === 'folder' ? place.id : null;
  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const here = place.t === 'folder' ? (folderId ? byId.get(folderId) : null) : null;
  const canAddHere = place.t !== 'folder' || !folderId || (here ? canEdit(here.role) : false);

  useEffect(() => { try { localStorage.setItem('wk-docs-open', JSON.stringify([...openNodes])); } catch { /* private window */ } }, [openNodes]);
  // A link to a folder (from a notification or "Copy link").
  const [lastParam, setLastParam] = useState(folderParam);
  if (folderParam !== lastParam) { setLastParam(folderParam); if (folderParam) setPlace({ t: 'folder', id: folderParam }); }

  const loadFolders = useCallback(async () => {
    try { setFolders(await crm.get<FolderRow[]>('/api/v1/work/docs/folders')); } catch { /* the list still works */ }
  }, []);
  const load = useCallback(async () => {
    try {
      const sp = new URLSearchParams();
      if (q.trim()) sp.set('q', q.trim());
      if (kind) sp.set('kind', kind);
      if (sort !== 'updated') sp.set('sort', sort);
      if (place.t === 'bin') sp.set('bin', 'true');
      else if (place.t === 'archive') sp.set('archived', 'true');
      else if (place.t === 'folder') sp.set('folder', place.id ?? 'root');
      else sp.set('view', place.t);
      setRows(await crm.get<DocRow[]>(`/api/v1/work/docs?${sp}`));
      if (place.t === 'bin') setBinFolders(await crm.get<FolderRow[]>('/api/v1/work/docs/folders?bin=true'));
    } catch (e) { toast(friendlyError(e)); setRows([]); }
  }, [q, kind, sort, place, toast]);
  useEffect(() => { const t = setTimeout(() => void load(), q ? 300 : 0); return () => clearTimeout(t); }, [load, q, tick]);
  useEffect(() => { const t = setTimeout(() => void loadFolders(), 0); return () => clearTimeout(t); }, [loadFolders, tick]);
  // Someone else changed something: refresh (after a moment, so a burst of saves is one reload).
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLiveEvents(useCallback((e) => {
    if (e.kind !== 'work') return;
    if (liveTimer.current) clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(() => setTick((t) => t + 1), 1200);
  }, []));

  const pick = (id: string | null) => {
    if (dirtyRef.current && !window.confirm('You have unsaved changes. Leave this document without saving?')) return;
    dirtyRef.current = false;
    setQuery({ doc: id, c: null });
  };
  const go = (p: Place) => {
    setPlace(p); setQ(''); setSelected(new Set());
    setQuery({ folder: p.t === 'folder' ? p.id : null });
  };
  const openFolder = (id: string | null) => {
    go({ t: 'folder', id });
    if (id) setOpenNodes((s) => { const n = new Set(s); for (let f = byId.get(id); f?.parentId; f = byId.get(f.parentId)) n.add(f.parentId); return n; });
  };

  const create = async (t: (typeof TEMPLATES)[number]) => {
    try {
      const title = t.title.endsWith('— ') ? t.title + new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }) : t.title;
      const d = await crm.post<DocRow>('/api/v1/work/docs', { title, kind: t.kind, content: t.content, text: '', folderId: canAddHere ? folderId ?? undefined : undefined, access: newPrivate ? 'restricted' : 'team' });
      setNewOpen(false); setNewPrivate(false);
      if (place.t === 'folder' && (d.folderId ?? null) === folderId) setRows((r) => [d, ...(r ?? [])]); else setTick((x) => x + 1);
      pick(d.id);
    } catch (e) { toast(friendlyError(e)); }
  };

  /** Uploads files one after another into a folder (the one open, or the one they were dropped on). */
  const uploadMany = async (files: File[], into: string | null) => {
    if (files.length === 0) return;
    const big = files.find((f) => f.size > MAX_UPLOAD_MB * 1048576);
    if (big) { toast(`Files can be up to ${MAX_UPLOAD_MB} MB. “${big.name}” is ${fileSize(big.size)}.`); return; }
    const ok: DocRow[] = [];
    for (const [i, f] of files.entries()) {
      setUploading(files.length > 1 ? `Uploading ${i + 1} of ${files.length}…` : 'Uploading…');
      try {
        const form = new FormData();
        form.append('file', f);
        if (into) form.append('folderId', into);
        if (place.t === 'private') form.append('access', 'restricted');
        ok.push(await crm.upload<DocRow>('/api/v1/work/docs/upload', form));
      } catch (e) { toast(`${f.name}: ${friendlyError(e)}`); }
    }
    setUploading(null);
    if (ok.length === 0) return;
    setTick((x) => x + 1);
    toast(ok.length === 1 ? 'Uploaded.' : `Uploaded ${ok.length} files.`);
    return ok;
  };

  const move = async (what: Drag, to: string | null) => {
    try {
      const r = await crm.post<{ moved: number; skipped: string[] }>('/api/v1/work/docs/move', { docs: what.docs, folders: what.folders, to });
      const dest = to ? byId.get(to)?.name ?? 'the folder' : 'All documents';
      toast(r.skipped.length ? `Moved ${r.moved}. Not moved (you can’t change them): ${r.skipped.join(', ')}.` : `Moved to “${dest}”.`);
      setSelected(new Set()); setMoving(null); setTick((x) => x + 1);
    } catch (e) { toast(friendlyError(e)); }
  };

  // ─── Drag and drop: documents and folders onto folders; files from the computer onto the list or a folder ───
  const dragStart = (e: React.DragEvent, d: Drag) => {
    e.dataTransfer.setData(DRAG, JSON.stringify(d));
    e.dataTransfer.effectAllowed = 'move';
  };
  // One set of handlers for every drop target; each target says what it is in data-drop ("" = the top level) and data-key.
  const targetOf = (el: HTMLElement) => ({ target: el.dataset.drop || null, key: el.dataset.key ?? '' });
  const onTargetOver = (e: React.DragEvent<HTMLElement>) => {
    const t = e.dataTransfer.types;
    if (!t.includes(DRAG) && !t.includes('Files')) return;
    const { target, key } = targetOf(e.currentTarget);
    const f = target ? byId.get(target) : null;
    if (f && !canEdit(f.role)) return;   // can't add there: no drop
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = t.includes('Files') ? 'copy' : 'move';
    setOver(key);
  };
  const onTargetLeave = (e: React.DragEvent<HTMLElement>) => {
    const { key } = targetOf(e.currentTarget);
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === key ? null : o));
  };
  const onTargetDrop = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault(); e.stopPropagation(); setOver(null);
    const { target } = targetOf(e.currentTarget);
    if (e.dataTransfer.files.length > 0) { void uploadMany([...e.dataTransfer.files], target); return; }
    try {
      const d = JSON.parse(e.dataTransfer.getData(DRAG)) as Drag;
      if (target && d.folders.includes(target)) return;   // dropped on itself
      void move(d, target);
    } catch { /* not ours */ }
  };
  const dropOn = (target: string | null, key: string) => ({
    'data-drop': target ?? '', 'data-key': key, onDragOver: onTargetOver, onDragLeave: onTargetLeave, onDrop: onTargetDrop,
  });
  const listDrop = {
    'data-drop': place.t === 'folder' ? folderId ?? '' : '', 'data-key': 'list',
    onDragOver: (e: React.DragEvent<HTMLElement>) => { if (e.dataTransfer.types.includes('Files') && canAddHere) onTargetOver(e); },
    onDragLeave: onTargetLeave,
    onDrop: (e: React.DragEvent<HTMLElement>) => { if (e.dataTransfer.files.length > 0) onTargetDrop(e); },
  };

  // ─── Folders ───
  const saveFolder = async () => {
    if (!folderForm) return;
    try {
      if (folderForm.id) await crm.put(`/api/v1/work/docs/folders/${folderForm.id}`, { name: folderForm.name, color: folderForm.color });
      else {
        const f = await crm.post<FolderRow>('/api/v1/work/docs/folders', { name: folderForm.name, color: folderForm.color, parentId: place.t === 'folder' && canAddHere ? folderId ?? undefined : undefined, access: folderForm.private ? 'restricted' : 'team' });
        if (f.parentId) setOpenNodes((s) => new Set(s).add(f.parentId!));
      }
      setFolderForm(null); void loadFolders();
    } catch (e) { toast(friendlyError(e)); }
  };
  const deleteFolder = async (f: FolderRow, undo = false) => {
    if (!undo && !window.confirm(`Move “${f.name}” and everything in it to the Bin?\n\nIt can be put back from the Bin. Anything inside that you can’t change stays out of the Bin.`)) return;
    try {
      const r = await crm.post<{ deleted?: number; keptOut?: number; restored?: number; movedToTop?: boolean }>(`/api/v1/work/docs/folders/${f.id}/delete${undo ? '?undo=true' : ''}`);
      if (undo) toast(r.movedToTop ? 'Put back at the top level (the folder it was in is in the Bin).' : 'Folder put back.');
      else { toast(r.keptOut ? `Moved to the Bin. ${r.keptOut} item(s) you can’t change were moved out of it instead.` : 'Folder moved to the Bin. Open “Bin” to put it back.'); if (folderId === f.id) go({ t: 'folder', id: f.parentId ?? null }); }
      setTick((x) => x + 1);
    } catch (e) { toast(friendlyError(e)); }
  };

  const kids = (pid: string | null) => folders.filter((f) => (f.parentId ?? null) === pid && f.inTree);
  const path = useMemo(() => {
    const out: FolderRow[] = [];
    for (let f = folderId ? byId.get(folderId) : undefined; f; f = f.parentId ? byId.get(f.parentId) : undefined) { out.unshift(f); if (out.length > 30) break; }
    return out;
  }, [folderId, byId]);
  const subfolders = place.t === 'folder' && !q.trim() ? (kind ? [] : kids(folderId))
    : place.t === 'shared' && !q.trim() ? folders.filter((f) => f.shared)
    : place.t === 'private' && !q.trim() ? folders.filter((f) => f.owner === board.me && f.access === 'restricted')
    : place.t === 'bin' ? binFolders : [];
  const sorted = (list: FolderRow[]) => [...list].sort((a, b) => (sort === 'name' || sort === 'updated' ? a.name.localeCompare(b.name) : b.createdAt.localeCompare(a.createdAt)));

  const treeNode = (f: FolderRow, depth: number): React.ReactNode => {
    const ch = kids(f.id);
    const isOpen = openNodes.has(f.id);
    const current = place.t === 'folder' && folderId === f.id;
    return (
      <li key={f.id}>
        <div className={`wk-tree-row${current ? ' is-current' : ''}${over === `t:${f.id}` ? ' is-over' : ''}`} style={{ paddingLeft: 4 + depth * 14 }} {...dropOn(f.id, `t:${f.id}`)}>
          {ch.length > 0 ? (
            <button type="button" className="wk-tree-tog" aria-label={isOpen ? `Close ${f.name}` : `Open ${f.name}`} aria-expanded={isOpen}
              onClick={() => setOpenNodes((s) => { const n = new Set(s); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; })}>
              <ChevronRight size={13} aria-hidden style={{ transform: isOpen ? 'rotate(90deg)' : undefined }} />
            </button>
          ) : <span className="wk-tree-tog" />}
          <button type="button" className="wk-tree-name" aria-current={current ? 'true' : undefined} onClick={() => openFolder(f.id)}
            draggable={canEdit(f.role)} onDragStart={(e) => dragStart(e, { docs: [], folders: [f.id] })}>
            <Folder size={15} aria-hidden style={{ color: FOLDER_COLORS[f.color ?? ''] }} fill={f.color ? FOLDER_COLORS[f.color] : 'none'} fillOpacity={0.18} />
            <span>{f.name}</span>{f.access === 'restricted' && <Lock size={11} aria-label="Private" />}
          </button>
        </div>
        {isOpen && ch.length > 0 && <ul>{ch.map((c) => treeNode(c, depth + 1))}</ul>}
      </li>
    );
  };

  const docIcons = (d: DocRow) => (
    <>
      {d.access === 'restricted' && <span className="wk-doc-ico" title={d.people ? `Private · shared with ${d.people}` : 'Private: only you'}><Lock size={12} aria-label="Private" /></span>}
      {d.access !== 'restricted' && !!d.people && <span className="wk-doc-ico" title={`Shared with ${d.people}`}><Users size={12} aria-label="Shared" /></span>}
      {!!d.openComments && <span className="wk-doc-ico is-cmt" title={`${d.openComments} open comment(s)`}><MessageSquare size={12} aria-hidden />{d.openComments}</span>}
    </>
  );
  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const star = async (d: DocRow) => {
    try { const r = await crm.post<DocRow>(`/api/v1/work/docs/${d.id}/star${d.starred ? '?undo=true' : ''}`); setRows((x) => (x ?? []).map((y) => (y.id === r.id ? { ...y, starred: r.starred } : y)).filter((y) => place.t !== 'starred' || y.starred)); }
    catch (e) { toast(friendlyError(e)); }
  };
  const placeTitle = place.t === 'folder' ? (here?.name ?? 'All documents') : PLACES.find((p) => p.t === place.t)!.label;

  return (
    <div className={`wk-docs${docId ? ' has-doc' : ''}`}>
      <aside className="wk-docs-list" aria-label="Plans and documents">
        <div className="wk-docs-top">
          <button type="button" className="crm-btn" onClick={() => setNewOpen(true)} disabled={!canAddHere}><Plus size={16} aria-hidden /> New</button>
          <button type="button" className="crm-btn is-secondary" disabled={!!uploading || !canAddHere} onClick={() => fileInput.current?.click()}><Upload size={16} aria-hidden /> {uploading ?? 'Upload'}</button>
          <button type="button" className="crm-btn is-secondary" disabled={!canAddHere} title="New folder" aria-label="New folder" onClick={() => setFolderForm({ name: '', color: '', private: place.t === 'private' })}><FolderPlus size={16} aria-hidden /></button>
          <input ref={fileInput} type="file" hidden multiple accept={UPLOAD_ACCEPT} aria-label="Upload files" onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            void uploadMany(files, place.t === 'folder' ? folderId : null).then((ok) => { if (ok?.length === 1 && files.length === 1) pick(ok[0].id); });
          }} />
        </div>
        <label className="crm-search"><Search size={15} aria-hidden /><span className="crm-sr">Search documents</span>
          <input className="crm-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search all folders" /></label>

        <nav className="wk-tree" aria-label="Folders">
          <div className={`wk-tree-row${place.t === 'folder' && !folderId ? ' is-current' : ''}${over === 't:root' ? ' is-over' : ''}`} {...dropOn(null, 't:root')}>
            <span className="wk-tree-tog" />
            <button type="button" className="wk-tree-name" aria-current={place.t === 'folder' && !folderId ? 'true' : undefined} onClick={() => openFolder(null)}><Home size={15} aria-hidden /><span>All documents</span></button>
          </div>
          <ul>{kids(null).map((f) => treeNode(f, 1))}</ul>
          <div className="wk-tree-views">
            {PLACES.map((p) => (
              <button key={p.t} type="button" className="wk-tree-view" aria-current={place.t === p.t ? 'true' : undefined} onClick={() => go({ t: p.t } as Place)}><p.icon size={15} aria-hidden /> {p.label}</button>
            ))}
          </div>
        </nav>

        <div className={`wk-docs-pane${over === 'list' ? ' is-over' : ''}`} {...listDrop}>
          <div className="wk-crumbs">
            {place.t === 'folder' ? (
              <>
                <button type="button" className={`wk-crumb${over === 'c:root' ? ' is-over' : ''}`} onClick={() => openFolder(null)} {...dropOn(null, 'c:root')}>All documents</button>
                {path.map((f) => (
                  <span key={f.id} className="wk-crumb-wrap"><ChevronRight size={12} aria-hidden />
                    <button type="button" className={`wk-crumb${over === `c:${f.id}` ? ' is-over' : ''}`} aria-current={f.id === folderId ? 'true' : undefined} onClick={() => openFolder(f.id)} {...dropOn(f.id, `c:${f.id}`)}>{f.name}</button>
                  </span>
                ))}
              </>
            ) : <strong className="wk-crumb is-static">{placeTitle}</strong>}
            {here && (
              <span className="wk-menu-wrap wk-crumb-menu">
                <button type="button" className="wk-icon-btn" aria-label="Folder actions" aria-expanded={menu} onClick={() => setMenu((m) => !m)}><MoreHorizontal size={16} aria-hidden /></button>
                {menu && (
                  <span className="wk-menu" role="menu" onClick={() => setMenu(false)}>
                    <button type="button" role="menuitem" onClick={() => setShare({ kind: 'folder', id: here.id, title: here.name })}><Share2 size={14} aria-hidden /> Share</button>
                    {canEdit(here.role) && <button type="button" role="menuitem" onClick={() => setFolderForm({ id: here.id, name: here.name, color: here.color ?? '', private: here.access === 'restricted' })}><Pencil size={14} aria-hidden /> Rename or colour</button>}
                    {canEdit(here.role) && <button type="button" role="menuitem" onClick={() => setMoving({ docs: [], folders: [here.id] })}><FolderInput size={14} aria-hidden /> Move to…</button>}
                    {canEdit(here.role) && <button type="button" role="menuitem" className="wk-danger" onClick={() => void deleteFolder(here)}><Trash2 size={14} aria-hidden /> Delete folder</button>}
                  </span>
                )}
              </span>
            )}
          </div>
          {here && (here.access === 'restricted' || here.shared) && (
            <p className="crm-sub wk-folder-note"><Lock size={12} aria-hidden /> {here.access === 'restricted' ? (here.owner === board.me ? `Private folder${here.people ? `, shared with ${here.people}` : ': only you'}` : `Shared with you by ${nameOf(here.owner)}`) : `Shared with you by ${nameOf(here.owner)}`}</p>
          )}

          <div className="wk-docs-filters">
            <select className="crm-input wk-small-in" value={kind} onChange={(e) => setKind(e.target.value as '' | DocRow['kind'])} aria-label="Kind">
              <option value="">Everything</option><option value="plan">Plans</option><option value="doc">Documents</option><option value="notes">Meeting notes</option><option value="file">Files</option>
            </select>
            <select className="crm-input wk-small-in" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort by">
              <option value="updated">Last changed</option><option value="name">Name</option><option value="created">Newest</option>
            </select>
          </div>

          {selected.size > 0 && (
            <div className="wk-selbar" role="status">
              <strong>{selected.size} selected</strong>
              <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setMoving({ docs: [...selected], folders: [] })}><FolderInput size={14} aria-hidden /> Move to…</button>
              <button type="button" className="wa-link" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          )}

          {!rows ? <Skeleton h={200} /> : rows.length === 0 && subfolders.length === 0 ? (
            <p className="crm-sub wk-docs-empty">{q || kind ? 'Nothing matches.' : place.t === 'bin' ? 'The Bin is empty.' : place.t === 'archive' ? 'Nothing archived.'
              : place.t === 'starred' ? 'Nothing starred yet. Press the star on a document to find it here.' : place.t === 'shared' ? 'Nothing has been shared with you yet.'
              : place.t === 'private' ? 'Nothing private yet. Make a document “Only me” when you create it, or from Share.'
              : canAddHere ? 'This folder is empty. Press “New”, upload a file, or drag files here from your computer.' : 'This folder is empty.'}</p>
          ) : (
            <ul>
              {sorted(subfolders).map((f) => (
                <li key={f.id}>
                  {place.t === 'bin' ? (
                    <div className="wk-doc-row is-folder">
                      <span className="wk-doc-row-top"><Folder size={14} aria-hidden /><strong>{f.name}</strong></span>
                      <span className="wk-doc-row-meta">Folder · {f.deletedBy ? nameOf(f.deletedBy) : ''} · {f.deletedAt ? when(f.deletedAt) : ''}</span>
                      <button type="button" className="crm-btn is-sm is-secondary" onClick={() => void deleteFolder(f, true)}><Undo2 size={14} aria-hidden /> Put back</button>
                    </div>
                  ) : (
                    <button type="button" className={`wk-doc-row is-folder${over === `f:${f.id}` ? ' is-over' : ''}`} onClick={() => openFolder(f.id)}
                      draggable={canEdit(f.role)} onDragStart={(e) => dragStart(e, { docs: [], folders: [f.id] })} {...dropOn(f.id, `f:${f.id}`)}>
                      <span className="wk-doc-row-top">
                        <Folder size={15} aria-hidden style={{ color: FOLDER_COLORS[f.color ?? ''] }} fill={f.color ? FOLDER_COLORS[f.color] : 'none'} fillOpacity={0.18} />
                        <strong>{f.name}</strong>
                        {f.access === 'restricted' && <span className="wk-doc-ico"><Lock size={12} aria-label="Private" /></span>}
                        {f.access !== 'restricted' && !!f.people && <span className="wk-doc-ico"><Users size={12} aria-label="Shared" /></span>}
                      </span>
                      <span className="wk-doc-row-meta">Folder · {f.items} item{f.items === 1 ? '' : 's'}{f.shared ? ` · from ${nameOf(f.owner)}` : ''}</span>
                    </button>
                  )}
                </li>
              ))}
              {rows.map((d) => (
                <li key={d.id} className={`wk-doc-li${selected.has(d.id) ? ' is-sel' : ''}`}>
                  {place.t !== 'bin' && canEdit(d.role) && (
                    <input type="checkbox" className="wk-doc-check" checked={selected.has(d.id)} onChange={() => toggleSel(d.id)} aria-label={`Select ${d.title}`} />
                  )}
                  <button type="button" className="wk-doc-row" aria-current={d.id === docId ? 'true' : undefined}
                    onClick={(e) => { if ((e.ctrlKey || e.metaKey) && canEdit(d.role)) { e.preventDefault(); toggleSel(d.id); } else pick(d.id); }}
                    draggable={place.t !== 'bin' && canEdit(d.role)} onDragStart={(e) => dragStart(e, { docs: selected.has(d.id) ? [...selected] : [d.id], folders: [] })}>
                    <span className="wk-doc-row-top">
                      {d.pinned && <Pin size={13} aria-label="Pinned" className="wk-pin" />}
                      {d.kind === 'file' && <Paperclip size={13} aria-hidden className="wk-pin" />}
                      <strong>{d.title}</strong>
                      {docIcons(d)}
                    </span>
                    <span className="wk-doc-row-meta">{d.file ? `${d.file.name.split('.').pop()?.toUpperCase()} · ${fileSize(d.file.size)}` : DOC_KIND[d.kind]} · {nameOf(d.deleted && d.deletedBy ? d.deletedBy : d.updatedBy)} · {when(d.deleted && d.deletedAt ? d.deletedAt : d.updatedAt)}{d.card ? ` · #${d.card.number}` : ''}
                      {(q.trim() || place.t !== 'folder') && d.folderId && byId.get(d.folderId) ? ` · in ${byId.get(d.folderId)!.name}` : ''}</span>
                    {d.preview && !d.file && <span className="wk-doc-row-prev">{d.preview}</span>}
                  </button>
                  {place.t !== 'bin' && (
                    <button type="button" className={`wk-star${d.starred ? ' is-on' : ''}`} aria-label={d.starred ? `Unstar ${d.title}` : `Star ${d.title}`} aria-pressed={!!d.starred} onClick={() => void star(d)}>
                      <Star size={15} aria-hidden fill={d.starred ? 'currentColor' : 'none'} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {over === 'list' && <div className="wk-drop-hint" aria-hidden><Upload size={18} /> Drop to upload into “{placeTitle}”</div>}
        </div>
      </aside>
      <section className="wk-docs-main">
        {docId ? (
          <DocEditor key={docId} id={docId} board={board} toast={toast} openCard={openCard} dirtyRef={dirtyRef} folders={folders}
            focusComment={commentParam} onOpenFolder={(id) => { openFolder(id); }}
            onShare={(d, addFirst) => setShare({ kind: 'doc', id: d.id, title: d.title, addFirst })}
            onMove={(d) => setMoving({ docs: [d.id], folders: [] })}
            onCopied={(d) => { setTick((x) => x + 1); pick(d.id); toast('Copy made. You are now in the copy.'); }}
            tick={tick}
            onClose={() => pick(null)} onSaved={(d) => setRows((r) => (r ?? []).map((x) => (x.id === d.id ? { ...x, ...d } : x)))}
            onGone={() => setTick((x) => x + 1)} />
        ) : (
          <div className="wk-docs-blank">
            <FileText size={30} aria-hidden />
            <strong>Plans and documents for the team</strong>
            <span className="crm-sub">Keep plans, checklists, meeting notes and files in folders. Drag documents onto a folder to move them, or drag files in from your computer. Make anything private, share it with chosen people, and comment on it like in Google Docs. Every earlier version is kept.</span>
            <div className="wk-tpl-grid">
              {TEMPLATES.map((t) => <button key={t.key} type="button" className="wk-tpl" disabled={!canAddHere} onClick={() => void create(t)}><t.icon size={20} aria-hidden /><span>{t.label}</span></button>)}
              <button type="button" className="wk-tpl" disabled={!canAddHere} onClick={() => { setNewPrivate(true); setNewOpen(true); }}><Lock size={20} aria-hidden /><span>Private note (only me)</span></button>
              <button type="button" className="wk-tpl" disabled={!!uploading || !canAddHere} onClick={() => fileInput.current?.click()}><Upload size={20} aria-hidden /><span>{uploading ?? 'Upload files'}</span></button>
            </div>
          </div>
        )}
      </section>
      {newOpen && (
        <Modal title={newPrivate ? 'New private note' : 'New plan'} onClose={() => { setNewOpen(false); setNewPrivate(false); }}>
          <p className="crm-sub" style={{ marginTop: 0 }}>Start from a blank page or a ready outline{place.t === 'folder' && here ? `, in “${here.name}”` : ''}.</p>
          <div className="wk-tpl-grid">
            {TEMPLATES.map((t) => <button key={t.key} type="button" className="wk-tpl" onClick={() => void create(t)}><t.icon size={20} aria-hidden /><span>{t.label}</span></button>)}
          </div>
          <label className="wk-check-line"><input type="checkbox" checked={newPrivate} onChange={(e) => setNewPrivate(e.target.checked)} /> Only me (private). You can share it with chosen people later.</label>
        </Modal>
      )}
      {folderForm && (
        <Modal title={folderForm.id ? 'Rename folder' : 'New folder'} onClose={() => setFolderForm(null)} actions={<>
          <button type="button" className="crm-btn is-secondary" onClick={() => setFolderForm(null)}>Cancel</button>
          <button type="button" className="crm-btn" disabled={!folderForm.name.trim()} onClick={() => void saveFolder()}>{folderForm.id ? 'Save' : 'Make folder'}</button>
        </>}>
          <form className="wk-folder-form" onSubmit={(e) => { e.preventDefault(); if (folderForm.name.trim()) void saveFolder(); }}>
            <label className="crm-field"><span>Name</span><input className="crm-input" value={folderForm.name} maxLength={80} autoFocus onChange={(e) => setFolderForm({ ...folderForm, name: e.target.value })} placeholder="e.g. Camps 2026" /></label>
            <div className="wk-colors" role="radiogroup" aria-label="Colour">
              {Object.entries(FOLDER_COLORS).map(([k, v]) => (
                <button key={k || 'none'} type="button" role="radio" aria-checked={folderForm.color === k} aria-label={k || 'No colour'} className="wk-color" style={{ background: v }} onClick={() => setFolderForm({ ...folderForm, color: k })}>
                  {folderForm.color === k && <Check size={14} aria-hidden />}
                </button>
              ))}
            </div>
            {!folderForm.id && <label className="wk-check-line"><input type="checkbox" checked={folderForm.private} onChange={(e) => setFolderForm({ ...folderForm, private: e.target.checked })} /> Only me (private): nobody else sees this folder or what is in it unless you share it.</label>}
            {!folderForm.id && place.t === 'folder' && here && <p className="crm-sub">It goes inside “{here.name}”.</p>}
          </form>
        </Modal>
      )}
      {share && <ShareModal kind={share.kind} id={share.id} title={share.title} people={board.people} me={board.me} toast={toast} addFirst={share.addFirst}
        onClose={() => setShare(null)} onSaved={() => setTick((x) => x + 1)} />}
      {moving && <MoveModal folders={folders} current={moving.folders.length === 1 ? (byId.get(moving.folders[0])?.parentId ?? null) : (rows?.find((r) => r.id === moving.docs[0])?.folderId ?? null)}
        exclude={moving.folders} onClose={() => setMoving(null)} onMove={(to) => void move(moving, to)} />}
    </div>
  );
}

interface DocRes { doc: DocRow; content: JSONContent; path?: { id: string; name: string; open: boolean }[] }
interface Rev { id: string; version: number; title: string; savedBy: string; savedAt: string }

/** Prints a written document (or saves it as a PDF from the print box). */
function printDoc(title: string, html: string) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  f.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font:12pt/1.55 system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#111;margin:18mm}
    h1.t{font-size:22pt;margin:0 0 12pt}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:4pt 6pt;vertical-align:top}
    ul[data-type=taskList]{list-style:none;padding-left:0}ul[data-type=taskList] li{display:flex;gap:6pt}ul[data-type=taskList] label{flex:none}
    blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:10pt;color:#444}pre{background:#f4f4f4;padding:8pt;white-space:pre-wrap}
    </style></head><body><h1 class="t">${esc(title)}</h1>${html}</body></html>`;
  f.onload = () => { f.contentWindow?.focus(); f.contentWindow?.print(); setTimeout(() => f.remove(), 60000); };
}

const ROLE_NOTE: Record<string, string> = {
  view: 'You can read this document. Ask its owner if you need to comment or edit.',
  comment: 'You can read and comment on this document, but not change it.',
};

/** One plan in the editor. Saves by itself a few seconds after you stop typing, or with Ctrl+S. */
function DocEditor({ id, board, toast, openCard, onClose, onSaved, onGone, dirtyRef, folders, focusComment, onOpenFolder, onShare, onMove, onCopied, tick }: {
  id: string; board: BoardRes; toast: (m: string) => void; openCard: (id: string) => void; onClose: () => void;
  onSaved: (d: DocRow) => void; onGone: (id: string) => void; dirtyRef: React.MutableRefObject<boolean>;
  folders: FolderRow[]; focusComment: string | null; onOpenFolder: (id: string | null) => void;
  onShare: (d: DocRow, addFirst?: string[]) => void; onMove: (d: DocRow) => void; onCopied: (d: DocRow) => void; tick: number;
}) {
  const [row, setRow] = useState<DocRow | null>(null);
  const [path, setPath] = useState<{ id: string; name: string; open: boolean }[]>([]);
  const [title, setTitle] = useState('');
  const [dirty, setDirtyState] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<{ by: string; at: string } | null>(null);
  const [histOpen, setHistOpen] = useState(false);
  const [words, setWords] = useState(0);
  const [more, setMore] = useState(false);
  const [showCmts, setShowCmts] = useState(!!focusComment);
  const [cmtFocus, setCmtFocus] = useState<string | null>(focusComment);
  const [pending, setPending] = useState<{ quote: string; nth: number } | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [hasSel, setHasSel] = useState(false);
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

  const editor = useDocEditor(null, touched, true);
  // A click on highlighted words opens their comment.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const onPick = (e: Event) => { const cid = (e as CustomEvent<string>).detail; if (cid) { setShowCmts(true); setCmtFocus(cid); } };
    dom.addEventListener(COMMENT_PICK, onPick);
    return () => dom.removeEventListener(COMMENT_PICK, onPick);
  }, [editor]);

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
      putRow(r.doc); setTitle(r.doc.title); setPath(r.path ?? []); setWords(editor.getText().split(/\s+/).filter(Boolean).length);
      if ((r.doc.openComments ?? 0) > 0 && window.innerWidth >= 1200) setShowCmts(true);
    }).catch((e) => { out.current.toast(friendlyError(e)); out.current.onClose(); });
    return () => { alive = false; };
  }, [editor, id, putRow]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  // Is any text selected? (The "Comment" button needs some.)
  useEffect(() => {
    if (!editor) return;
    const s = () => setHasSel(!editor.state.selection.empty);
    editor.on('selectionUpdate', s);
    return () => { editor.off('selectionUpdate', s); };
  }, [editor]);

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

  const role = row?.role ?? 'edit';
  const inBin = !!row?.deleted;
  const editable = canEdit(role) && !inBin;
  const canComment = role !== 'view' && !inBin;
  /** Start a comment on the selected words (Ctrl+Alt+M), or on the whole document when nothing is selected. */
  const startComment = useCallback(() => {
    if (!editor || !canComment) return;
    const a = selectionAnchor(editor.state);
    setShowCmts(true);
    if (a) setPending(a); else toast('Select some words first, or comment on the whole document at the bottom of the comments.');
  }, [editor, canComment, toast]);
  // Ctrl+S, Ctrl+Alt+M, and a warning before closing the tab with unsaved changes.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void saveRef.current(); }
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'm') { e.preventDefault(); startComment(); }
    };
    const leave = (e: BeforeUnloadEvent) => { if (dirtyRef.current) e.preventDefault(); };
    window.addEventListener('keydown', k);
    window.addEventListener('beforeunload', leave);
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('beforeunload', leave); };
  }, [dirtyRef, startComment]);

  // On a phone the document opens below the board's numbers: bring it to the top of the screen once it has loaded.
  const article = useRef<HTMLElement>(null);
  const loaded = !!row;
  useEffect(() => {
    if (loaded && window.innerWidth < 900) article.current?.scrollIntoView({ block: 'start' });
  }, [loaded]);

  // In the Bin, or without edit rights, it can be read (and maybe commented on), not changed.
  useEffect(() => { if (editor) editor.setEditable(editable, false); }, [editor, editable]);

  /** To the Bin. It can be put back from there; nothing is removed. */
  const toBin = async () => {
    if (!row) return;
    try {
      if (dirtyRef.current) await saveRef.current();   // keep the last words before it goes
      const d = await crm.post<DocRow>(`/api/v1/work/docs/${row.id}/delete`);
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      setDirty(false);
      putRow(d); onGone(d.id);
      toast('Moved to the Bin. Open “Bin” to put it back.');
      onClose();
    } catch (e) { toast(friendlyError(e)); }
  };
  const putBack = async () => {
    if (!row) return;
    try {
      const r = await crm.post<DocRow | { doc: DocRow; movedToTop: boolean }>(`/api/v1/work/docs/${row.id}/delete?undo=true`);
      const d = 'doc' in r ? r.doc : r;
      putRow(d); onGone(d.id);
      toast('doc' in r ? 'Put back at the top level (its folder is in the Bin).' : 'Put back in the list.');
      onClose();
    } catch (e) { toast(friendlyError(e)); }
  };
  const erase = async () => {
    if (!row) return;
    const what = row.file ? 'this file' : 'this document, its comments and all its earlier versions';
    if (!window.confirm(`Delete “${row.title}” for ever?\n\nThis removes ${what}. It cannot be undone.`)) return;
    try { await crm.del(`/api/v1/work/docs/${row.id}`); setDirty(false); onGone(row.id); toast('Deleted for ever.'); onClose(); }
    catch (e) { toast(friendlyError(e)); }
  };

  const flag = async (what: 'pin' | 'archive' | 'star', undo: boolean) => {
    if (!row) return;
    try {
      const d = await crm.post<DocRow>(`/api/v1/work/docs/${row.id}/${what}${undo ? '?undo=true' : ''}`);
      putRow(d); onSaved(d);
      if (what === 'archive') toast(undo ? 'Back in the list.' : 'Archived. Find it under “Archive”.');
      if (what === 'star') toast(undo ? 'Unstarred.' : 'Starred. Find it under “Starred”.');
    } catch (e) { toast(friendlyError(e)); }
  };
  const copy = async () => {
    if (!row) return;
    try { if (dirtyRef.current) await saveRef.current(); onCopied(await crm.post<DocRow>(`/api/v1/work/docs/${row.id}/copy`)); }
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
  // Where it is: the folder path follows a move made from the list.
  const folderNow = row?.folderId ?? null;
  const livePath = useMemo(() => {
    if (!row) return path;
    const byId = new Map(folders.map((f) => [f.id, f]));
    if (folderNow && !byId.has(folderNow)) return path;
    const outp: { id: string; name: string; open: boolean }[] = [];
    for (let f = folderNow ? byId.get(folderNow) : undefined; f; f = f.parentId ? byId.get(f.parentId) : undefined) { outp.unshift({ id: f.id, name: f.name, open: true }); if (outp.length > 30) break; }
    return outp;
  }, [row, folders, folderNow, path]);
  // A move from the list: pick up the new folder.
  useEffect(() => {
    if (!row || tick === 0) return;
    let alive = true;
    crm.get<DocRes>(`/api/v1/work/docs/${row.id}`).then((r) => { if (alive && r.doc.folderId !== rowRef.current?.folderId) putRow({ ...rowRef.current!, folderId: r.doc.folderId }); }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  if (!editor || !row) return <Skeleton h={480} />;
  const isFile = row.kind === 'file';
  return (
    <article className="wk-doc" ref={article}>
      <header className="wk-doc-head">
        <button type="button" className="wk-x wk-doc-back" aria-label="Close" onClick={onClose}><X size={18} aria-hidden /></button>
        {isFile ? <span className="wk-doc-filetag"><Paperclip size={14} aria-hidden /> File</span> : (
          <select className="crm-input wk-small-in" value={row.kind} disabled={!editable} onChange={(e) => void setKind(e.target.value as DocRow['kind'])} aria-label="Kind">
            {(Object.keys(DOC_KIND) as DocRow['kind'][]).filter((k) => k !== 'file').map((k) => <option key={k} value={k}>{DOC_KIND[k]}</option>)}
          </select>
        )}
        {row.card && row.cardId && (
          <span className="wk-doc-card">
            <button type="button" className="wa-link" onClick={() => openCard(row.cardId!)}><Link2 size={13} aria-hidden /> #{row.card.number} {row.card.title}</button>
            {editable && <button type="button" className="wk-icon-btn" aria-label="Unlink from the card" title="Unlink from the card" onClick={() => void unlink()}><Unlink size={13} aria-hidden /></button>}
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
            <button type="button" className={`wk-star${row.starred ? ' is-on' : ''}`} aria-label={row.starred ? 'Unstar' : 'Star'} aria-pressed={!!row.starred} title={row.starred ? 'Unstar' : 'Star: keep it under “Starred”'} onClick={() => void flag('star', !!row.starred)}>
              <Star size={17} aria-hidden fill={row.starred ? 'currentColor' : 'none'} />
            </button>
            <button type="button" className="crm-btn is-secondary is-sm" aria-pressed={showCmts} onClick={() => setShowCmts((s) => !s)}>
              <MessageSquare size={14} aria-hidden /> Comments{(showCmts ? openCount : row.openComments ?? 0) > 0 ? ` (${showCmts ? openCount : row.openComments})` : ''}
            </button>
            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => onShare(row)}>
              {row.access === 'restricted' ? <Lock size={14} aria-hidden /> : <Share2 size={14} aria-hidden />} Share
            </button>
            {editable && <button type="button" className="crm-btn is-sm" disabled={saving || (!dirty && !conflict)} onClick={() => void save()}><Save size={14} aria-hidden /> Save</button>}
            <span className="wk-menu-wrap">
              <button type="button" className="crm-btn is-secondary is-sm" aria-label="More" aria-expanded={more} onClick={() => setMore((m) => !m)}><MoreHorizontal size={16} aria-hidden /></button>
              {more && (
                <span className="wk-menu is-right" role="menu" onClick={() => setMore(false)}>
                  {!isFile && <button type="button" role="menuitem" onClick={() => setHistOpen(true)}><History size={14} aria-hidden /> Earlier versions</button>}
                  {editable && <button type="button" role="menuitem" onClick={() => onMove(row)}><FolderInput size={14} aria-hidden /> Move to…</button>}
                  {!isFile && <button type="button" role="menuitem" onClick={() => void copy()}><CopyIcon size={14} aria-hidden /> Make a copy</button>}
                  {!isFile && <button type="button" role="menuitem" onClick={() => printDoc(titleRef.current || row.title, editor.getHTML())}><Printer size={14} aria-hidden /> Print or save as PDF</button>}
                  {editable && <button type="button" role="menuitem" onClick={() => void flag('pin', row.pinned)}>{row.pinned ? <><PinOff size={14} aria-hidden /> Unpin</> : <><Pin size={14} aria-hidden /> Pin to the top</>}</button>}
                  {editable && <button type="button" role="menuitem" onClick={() => void flag('archive', row.archived)}>{row.archived ? <><ArchiveRestore size={14} aria-hidden /> Bring back</> : <><Archive size={14} aria-hidden /> Archive</>}</button>}
                  {editable && <button type="button" role="menuitem" className="wk-danger" onClick={() => void toBin()}><Trash2 size={14} aria-hidden /> Delete</button>}
                </span>
              )}
            </span>
          </span>
        )}
      </header>
      {inBin && (
        <div className="ld-banner wk-conflict" role="status">
          <span><strong>This is in the Bin.</strong> {row.deletedBy ? `${nameOf(row.deletedBy)} deleted it` : 'Deleted'}{row.deletedAt ? ` ${when(row.deletedAt)}` : ''}. Put it back to use it again{row.canErase ? ', or delete it for ever.' : '. Only an admin or the person who wrote it can delete it for ever.'}</span>
        </div>
      )}
      {!inBin && ROLE_NOTE[role] && <div className="ld-banner wk-role-note" role="status"><span>{ROLE_NOTE[role]} {row.owner ? `Owner: ${nameOf(row.owner)}.` : ''}</span></div>}
      {conflict && (
        <div className="ld-banner wk-conflict" role="alert">
          <span><strong>{conflict.by ? nameOf(conflict.by) : 'Someone else'} saved this plan {conflict.at ? when(conflict.at) : ''} while you were editing.</strong> Their version and yours are both kept in History whichever you choose.</span>
          <span className="sp-actions">
            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void reloadTheirs()}>Load their version</button>
            <button type="button" className="crm-btn is-sm" onClick={() => void save(true)}>Save mine on top</button>
          </span>
        </div>
      )}
      <nav className="wk-doc-path" aria-label="Where it is">
        <button type="button" className="wa-link" onClick={() => onOpenFolder(null)}><Home size={12} aria-hidden /> All documents</button>
        {livePath.map((p) => <span key={p.id}><ChevronRight size={11} aria-hidden /> {p.open ? <button type="button" className="wa-link" onClick={() => onOpenFolder(p.id)}>{p.name}</button> : <span>{p.name}</span>}</span>)}
        {row.access === 'restricted' && <span className="wk-doc-private"><Lock size={12} aria-hidden /> {row.owner === board.me ? (row.people ? `Private · shared with ${row.people}` : 'Private: only you') : `Shared with you by ${nameOf(row.owner ?? '')}`}</span>}
        {row.access !== 'restricted' && !!row.people && <span className="wk-doc-private is-team"><Users size={12} aria-hidden /> Also shared with {row.people}</span>}
      </nav>
      <div className={`wk-doc-split${showCmts ? ' has-cmts' : ''}`}>
        <div className="wk-doc-col">
          <input className="wk-doc-title" value={title} maxLength={200} onChange={(e) => { setTitle(e.target.value); titleRef.current = e.target.value; touched(); }} placeholder="Title" aria-label="Title" readOnly={!editable} />
          {isFile && row.file ? (
            <>
              <span className="crm-sub wk-doc-sub">Uploaded by {nameOf(row.createdBy)} · {when(row.createdAt)} · {row.file.name} · {fileSize(row.file.size)}</span>
              <FileView id={row.id} file={row.file} toast={toast} />
            </>
          ) : (
            <>
              <span className="crm-sub wk-doc-sub">Started by {nameOf(row.createdBy)} · {when(row.createdAt)} · {words} words</span>
              {editable ? <Toolbar editor={editor} onComment={startComment} canComment={hasSel} />
                : canComment && (
                  <div className="wk-tb is-comment-only" role="toolbar" aria-label="Comment">
                    <button type="button" className="crm-btn is-secondary is-sm" disabled={!hasSel} onMouseDown={(e) => e.preventDefault()} onClick={startComment}><MessageSquarePlus size={14} aria-hidden /> Comment on the selected words</button>
                  </div>
                )}
              {/* A click on the empty space under the text puts the cursor at the end, like paper. */}
              <div className="wk-doc-body" onMouseDown={(e) => { if (editable && !(e.target as HTMLElement).closest('.ProseMirror')) { e.preventDefault(); editor.commands.focus('end'); } }}>
                <EditorContent editor={editor} />
              </div>
            </>
          )}
        </div>
        {showCmts && (
          <CommentsPanel docId={row.id} editor={isFile ? null : editor} people={board.people} me={board.me} canComment={canComment}
            pending={pending} onPendingDone={() => setPending(null)} focus={cmtFocus} onFocus={setCmtFocus} onClose={() => { setShowCmts(false); setPending(null); }}
            toast={toast} reloadKey={tick} onCount={setOpenCount} onCannotOpen={(ids) => { if (DocRoleCanShare(row)) onShare(row, ids); }} />
        )}
      </div>
      {histOpen && <HistoryModal id={row.id} nameOf={nameOf} canRestore={editable} onClose={() => setHistOpen(false)} onRestore={(c, t) => {
        titleRef.current = t; setTitle(t); editor.commands.setContent(c); touched(); setHistOpen(false); toast('Earlier version put back. It saves in a moment (the current one stays in History).');
      }} />}
    </article>
  );
}
/** Can this person share the document (so they can let a mentioned person in)? */
const DocRoleCanShare = (d: DocRow) => d.role === 'owner' || (d.access !== 'restricted' && d.role === 'edit');

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

function HistoryModal({ id, nameOf, onClose, onRestore, canRestore = true }: { id: string; nameOf: (a: string) => string; onClose: () => void; onRestore: (c: JSONContent, title: string) => void; canRestore?: boolean }) {
  const [list, setList] = useState<Rev[] | null>(null);
  const [sel, setSel] = useState<(Rev & { content: JSONContent }) | null>(null);
  useEffect(() => { void crm.get<Rev[]>(`/api/v1/work/docs/${id}/history`).then(setList).catch(() => setList([])); }, [id]);
  const open = async (r: Rev) => { try { setSel(await crm.get<Rev & { content: JSONContent }>(`/api/v1/work/docs/${id}/history/${r.id}`)); } catch { /* keep the list */ } };
  const content = useMemo(() => sel?.content ?? null, [sel]);
  return (
    <Modal title="Earlier versions" onClose={onClose} wide actions={sel ? <>
      <button type="button" className="crm-btn is-secondary" onClick={() => setSel(null)}>Back to the list</button>
      {canRestore && <button type="button" className="crm-btn" onClick={() => onRestore(sel.content, sel.title)}>Put this version back</button>}
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
