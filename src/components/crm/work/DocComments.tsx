'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Check, CornerDownRight, MessageSquare, MessageSquarePlus, MoreHorizontal, Pencil, RotateCcw, Trash2, X } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { friendlyError } from '@/components/crm/ui';
import { avatarColor, initials, type Person } from './shared';

// ─── Where comments sit in the text ─────────────────────────────────────────────
// A comment remembers the words it is about and which time those words appear (the 1st, 2nd … "the"). It is not stored
// inside the document, so people who can only comment never change the document, and History stays clean. If the words
// are later changed, the comment stays and says so.

interface Chunk { start: number; pos: number; len: number }
/** The document as one string (a line break between paragraphs), and where each piece of text sits in the document. */
export function textIndex(doc: PmNode): { text: string; chunks: Chunk[] } {
  let text = '';
  const chunks: Chunk[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock && text.length > 0 && !text.endsWith('\n')) text += '\n';
    if (node.isText && node.text) { chunks.push({ start: text.length, pos, len: node.text.length }); text += node.text; }
    return true;
  });
  return { text, chunks };
}
function idxToPos(chunks: Chunk[], idx: number, end: boolean): number | null {
  for (const c of chunks) {
    if (idx >= c.start && (end ? idx <= c.start + c.len : idx < c.start + c.len)) return c.pos + (idx - c.start);
  }
  return null;
}
function posToIdx(chunks: Chunk[], pos: number): number | null {
  for (const c of chunks) if (pos >= c.pos && pos <= c.pos + c.len) return c.start + (pos - c.pos);
  // Between pieces of text (e.g. at a paragraph edge): the next piece.
  const next = chunks.find((c) => c.pos >= pos);
  return next ? next.start : null;
}
/** Where the nth time this text appears starts, or -1. */
export function findNth(text: string, quote: string, nth: number): number {
  let at = -1;
  for (let i = 0; i <= nth; i++) { at = text.indexOf(quote, at + 1); if (at < 0) return -1; }
  return at;
}
/** The words selected now, and which time they appear: what a new comment is pinned to. */
export function selectionAnchor(state: EditorState): { quote: string; nth: number } | null {
  const { from, to, empty } = state.selection;
  if (empty) return null;
  const { text, chunks } = textIndex(state.doc);
  const a = posToIdx(chunks, from);
  const b = posToIdx(chunks, to);
  if (a == null || b == null || b <= a) return null;
  const quote = text.slice(a, b).trim();
  if (!quote) return null;
  const start = text.indexOf(quote, a);
  let nth = 0;
  for (let i = text.indexOf(quote); i >= 0 && i < start; i = text.indexOf(quote, i + 1)) nth++;
  return { quote: quote.slice(0, 500), nth };
}

export interface Anchor { id: string; quote: string; nth: number; active: boolean }
type AnchorState = { anchors: Anchor[]; deco: DecorationSet; found: Set<string> };
const KEY = new PluginKey<AnchorState>('commentAnchors');

function decorate(doc: PmNode, anchors: Anchor[]) {
  const found = new Set<string>();
  if (anchors.length === 0) return { deco: DecorationSet.empty, found };
  const { text, chunks } = textIndex(doc);
  const decos: Decoration[] = [];
  for (const a of anchors) {
    const at = findNth(text, a.quote, a.nth);
    if (at < 0) continue;
    const from = idxToPos(chunks, at, false);
    const to = idxToPos(chunks, at + a.quote.length, true);
    if (from == null || to == null || to <= from) continue;
    found.add(a.id);
    decos.push(Decoration.inline(from, to, { class: a.active ? 'wk-cmt-mark is-active' : 'wk-cmt-mark', 'data-comment': a.id }));
  }
  return { deco: DecorationSet.create(doc, decos), found };
}

/** The event the editor sends when someone clicks highlighted words: detail = the comment's id. */
export const COMMENT_PICK = 'wk-comment-pick';

/** Highlights the words each open comment is about; a click on them opens that comment. */
export const CommentAnchors = Extension.create({
  name: 'commentAnchors',
  addProseMirrorPlugins() {
    return [new Plugin<AnchorState>({
      key: KEY,
      state: {
        init: (_, s): AnchorState => ({ anchors: [], ...decorate(s.doc, []) }),
        apply(tr, old, _o, s): AnchorState {
          const next = tr.getMeta(KEY) as Anchor[] | undefined;
          if (next) return { anchors: next, ...decorate(s.doc, next) };
          if (!tr.docChanged) return old;
          return { anchors: old.anchors, ...decorate(s.doc, old.anchors) };
        },
      },
      props: {
        decorations: (s) => KEY.getState(s)?.deco,
        handleClick: (view, _pos, e) => {
          const el = (e.target as HTMLElement | null)?.closest?.('[data-comment]');
          if (el) view.dom.dispatchEvent(new CustomEvent(COMMENT_PICK, { detail: el.getAttribute('data-comment') }));
          return false;
        },
      },
    })];
  },
});

export function setAnchors(editor: Editor, anchors: Anchor[]) {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(KEY, anchors).setMeta('addToHistory', false));
}
export function anchorsFound(editor: Editor): Set<string> { return KEY.getState(editor.state)?.found ?? new Set(); }
export function scrollToComment(editor: Editor, id: string) {
  const el = editor.view.dom.querySelector(`[data-comment="${CSS.escape(id)}"]`);
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// ─── The comments panel ─────────────────────────────────────────────────────────

export interface Comment {
  id: string; parentId?: string | null; quote?: string | null; quoteNth: number; text: string; removed: boolean; mentions: string[];
  agentId: string; createdAt: string; editedAt?: string | null; resolved: boolean; resolvedBy?: string | null; resolvedAt?: string | null;
}
interface Thread { root: Comment; replies: Comment[] }

const when = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
};

/** A comment's words with each "@Name" of a mentioned person shown as a tag. */
function Words({ text, mentions, people }: { text: string; mentions: string[]; people: Person[] }) {
  const names = mentions.map((m) => people.find((p) => p.agentId === m)?.name).filter(Boolean) as string[];
  if (names.length === 0) return <>{text}</>;
  const re = new RegExp(`(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`, 'g');
  return <>{text.split(re).map((part, i) => (part.startsWith('@') && names.includes(part.slice(1)) ? <span key={i} className="wk-cmt-at">{part}</span> : part))}</>;
}

/**
 * A box to write a comment, with "@" to mention someone: a list of people opens, and the chosen person hears about it.
 * Ctrl+Enter sends.
 */
function Composer({ people, me, placeholder, initial = '', busy, onSend, onCancel, autoFocus }: {
  people: Person[]; me: string; placeholder: string; initial?: string; busy?: boolean; autoFocus?: boolean;
  onSend: (text: string, mentions: string[]) => void; onCancel?: () => void;
}) {
  const [text, setText] = useState(initial);
  const [at, setAt] = useState<{ q: string; start: number } | null>(null);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);
  const picked = useRef<Map<string, string>>(new Map());   // name → agentId
  const matches = useMemo(() => (at ? people.filter((p) => p.agentId !== me && p.name.toLowerCase().includes(at.q.toLowerCase())).slice(0, 6) : []), [at, people, me]);

  const onChange = (v: string, caret: number) => {
    setText(v);
    const before = v.slice(0, caret);
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(before);
    setAt(m ? { q: m[2], start: caret - m[2].length - 1 } : null);
    setHi(0);
  };
  const choose = (p: Person) => {
    if (!at) return;
    const caret = box.current?.selectionStart ?? text.length;
    const v = `${text.slice(0, at.start)}@${p.name} ${text.slice(caret)}`;
    picked.current.set(p.name, p.agentId);
    setText(v); setAt(null);
    requestAnimationFrame(() => { const c = at.start + p.name.length + 2; box.current?.focus(); box.current?.setSelectionRange(c, c); });
  };
  const send = () => {
    const t = text.trim();
    if (!t || busy) return;
    const mentions = [...picked.current.entries()].filter(([name]) => t.includes(`@${name}`)).map(([, id]) => id);
    onSend(t, mentions);
  };
  return (
    <div className="wk-cmt-compose">
      <textarea ref={box} className="crm-input crm-textarea" rows={3} value={text} placeholder={placeholder} autoFocus={autoFocus} maxLength={4000}
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
        onKeyDown={(e) => {
          if (at && matches.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => (h + 1) % matches.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => (h - 1 + matches.length) % matches.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(matches[hi]); return; }
            if (e.key === 'Escape') { e.preventDefault(); setAt(null); return; }
          }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
          if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel(); }
        }} />
      {at && matches.length > 0 && (
        <ul className="wk-cmt-people" role="listbox" aria-label="Mention someone">
          {matches.map((p, i) => (
            <li key={p.agentId} role="option" aria-selected={i === hi}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); choose(p); }}>
                <span className="wk-av" style={{ background: avatarColor(p.agentId), width: 22, height: 22, fontSize: 10 }}>{initials(p.name)}</span>{p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="wk-cmt-compose-bar">
        <span className="crm-sub">Type @ to mention someone</span>
        {onCancel && <button type="button" className="crm-btn is-secondary is-sm" onClick={onCancel}>Cancel</button>}
        <button type="button" className="crm-btn is-sm" disabled={busy || !text.trim()} onClick={send}>{busy ? 'Sending…' : 'Comment'}</button>
      </div>
    </div>
  );
}

/**
 * Comments on one document, like in Google Docs: on a piece of the text or on the whole document, with replies,
 * @mentions, and "Resolve" when it's dealt with (it can be opened again). Writers can change or remove their own.
 */
export function CommentsPanel({ docId, editor, people, me, canComment, pending, onPendingDone, focus, onFocus, onClose, toast, reloadKey, onCount, onCannotOpen }: {
  docId: string; editor: Editor | null; people: Person[]; me: string; canComment: boolean;
  /** A new comment being written on the selected words. */
  pending: { quote: string; nth: number } | null; onPendingDone: () => void;
  focus: string | null; onFocus: (id: string | null) => void; onClose: () => void; toast: (m: string) => void;
  reloadKey: number; onCount: (open: number) => void; onCannotOpen: (agentIds: string[]) => void;
}) {
  const [list, setList] = useState<Comment[] | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const nameOf = useCallback((a: string) => people.find((p) => p.agentId === a)?.name ?? a, [people]);

  const load = useCallback(async () => {
    try { const r = await crm.get<{ comments: Comment[] }>(`/api/v1/work/docs/${docId}/comments`); setList(r.comments); }
    catch (e) { toast(friendlyError(e)); setList((l) => l ?? []); }
  }, [docId, toast]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load, reloadKey]);

  const threads = useMemo<Thread[]>(() => {
    const roots = (list ?? []).filter((c) => !c.parentId);
    return roots.map((r) => ({ root: r, replies: (list ?? []).filter((c) => c.parentId === r.id) }));
  }, [list]);
  const open = threads.filter((t) => !t.root.resolved);
  const done = threads.filter((t) => t.root.resolved);
  useEffect(() => { onCount(open.length); }, [open.length, onCount]);

  // The highlighted words: open threads only.
  const [found, setFound] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!editor) return;
    setAnchors(editor, open.filter((t) => t.root.quote).map((t) => ({ id: t.root.id, quote: t.root.quote!, nth: t.root.quoteNth, active: t.root.id === focus })));
    const again = () => setFound(new Set(anchorsFound(editor)));
    const t = setTimeout(again, 0);
    editor.on('update', again);
    return () => { clearTimeout(t); editor.off('update', again); };
  }, [editor, open, focus]);
  // Open on a thread (from a notification or a click on the words): show it and the words it is about.
  const items = useRef<Map<string, HTMLElement>>(new Map());
  useEffect(() => {
    if (!focus || !list) return;
    const t = threads.find((x) => x.root.id === focus);
    requestAnimationFrame(() => {
      if (t?.root.resolved) setShowDone(true);
      items.current.get(focus)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      if (editor && t?.root.quote) scrollToComment(editor, focus);
    });
  }, [focus, list, threads, editor]);

  const post = async (text: string, mentions: string[], parentId: string | null) => {
    setBusy(true);
    try {
      const c = await crm.post<Comment>(`/api/v1/work/docs/${docId}/comments`, { text, mentions, parentId, quote: parentId ? null : pending?.quote, quoteNth: parentId ? 0 : pending?.nth ?? 0 });
      setList((l) => {
        const next = [...(l ?? []), c];
        return parentId ? next.map((x) => (x.id === parentId && x.resolved ? { ...x, resolved: false } : x)) : next;
      });
      if (parentId) setReplyTo(null); else { onPendingDone(); onFocus(c.id); }
    } catch (e) {
      const m = String((e as Error)?.message ?? '');
      try { const j = JSON.parse(m.slice(m.indexOf(': ') + 2)); if (Array.isArray(j.cannotOpen)) onCannotOpen(j.cannotOpen); } catch { /* plain error */ }
      toast(friendlyError(e));
    } finally { setBusy(false); }
  };
  const act = async (c: Comment, what: 'resolve' | 'reopen' | 'remove') => {
    setMenu(null);
    if (what === 'remove' && !window.confirm('Remove this comment? Replies to it stay.')) return;
    try {
      const path = what === 'remove' ? `comments/${c.id}/delete` : `comments/${c.id}/resolve${what === 'reopen' ? '?undo=true' : ''}`;
      const r = await crm.post<Comment>(`/api/v1/work/docs/${path}`);
      setList((l) => (l ?? []).map((x) => (x.id === r.id ? r : x)));
      if (what === 'resolve' && focus === c.id) onFocus(null);
    } catch (e) { toast(friendlyError(e)); }
  };
  const saveEdit = async (c: Comment, text: string) => {
    try { const r = await crm.put<Comment>(`/api/v1/work/docs/comments/${c.id}`, { text }); setList((l) => (l ?? []).map((x) => (x.id === r.id ? r : x))); setEditing(null); }
    catch (e) { toast(friendlyError(e)); }
  };

  const one = (c: Comment, root: boolean) => (
    <div key={c.id} className={`wk-cmt-one${root ? '' : ' is-reply'}`}>
      <div className="wk-cmt-who">
        <span className="wk-av" style={{ background: avatarColor(c.agentId), width: 26, height: 26, fontSize: 11 }}>{initials(nameOf(c.agentId))}</span>
        <span><strong>{nameOf(c.agentId)}</strong><span className="crm-sub"> · {when(c.createdAt)}{c.editedAt ? ' · edited' : ''}</span></span>
        {!c.removed && (c.agentId === me || (root && canComment)) && (
          <span className="wk-cmt-actions">
            {root && canComment && <button type="button" className="wk-icon-btn" title="Resolve: mark as done" aria-label="Resolve" onClick={() => void act(c, c.resolved ? 'reopen' : 'resolve')}>{c.resolved ? <RotateCcw size={15} aria-hidden /> : <Check size={15} aria-hidden />}</button>}
            {c.agentId === me && (
              <span className="wk-menu-wrap">
                <button type="button" className="wk-icon-btn" aria-label="More" aria-expanded={menu === c.id} onClick={() => setMenu((m) => (m === c.id ? null : c.id))}><MoreHorizontal size={15} aria-hidden /></button>
                {menu === c.id && (
                  <span className="wk-menu" role="menu">
                    <button type="button" role="menuitem" onClick={() => { setMenu(null); setEditing(c.id); }}><Pencil size={14} aria-hidden /> Edit</button>
                    <button type="button" role="menuitem" className="wk-danger" onClick={() => void act(c, 'remove')}><Trash2 size={14} aria-hidden /> Remove</button>
                  </span>
                )}
              </span>
            )}
          </span>
        )}
      </div>
      {c.removed ? <p className="wk-cmt-text crm-sub"><em>Comment removed</em></p>
        : editing === c.id ? <Composer people={people} me={me} placeholder="Change your comment" initial={c.text} autoFocus onSend={(t) => void saveEdit(c, t)} onCancel={() => setEditing(null)} />
        : <p className="wk-cmt-text"><Words text={c.text} mentions={c.mentions} people={people} /></p>}
    </div>
  );

  const card = (t: Thread) => {
    const lost = !!t.root.quote && !t.root.resolved && !found.has(t.root.id);
    return (
      <li key={t.root.id} ref={(el) => { if (el) items.current.set(t.root.id, el); else items.current.delete(t.root.id); }}
        className={`wk-cmt${focus === t.root.id ? ' is-active' : ''}${t.root.resolved ? ' is-done' : ''}`}
        onClick={(e) => { if (!(e.target as HTMLElement).closest('button, textarea, a')) onFocus(t.root.id); }}>
        {t.root.quote && (
          <button type="button" className="wk-cmt-quote" title="Show in the document" onClick={() => { onFocus(t.root.id); if (editor) scrollToComment(editor, t.root.id); }}>
            “{t.root.quote.length > 140 ? `${t.root.quote.slice(0, 140)}…` : t.root.quote}”
          </button>
        )}
        {lost && <span className="crm-sub wk-cmt-lost">The words this was on have been changed.</span>}
        {t.root.resolved && t.root.resolvedBy && <span className="crm-sub">Resolved by {nameOf(t.root.resolvedBy)}{t.root.resolvedAt ? ` · ${when(t.root.resolvedAt)}` : ''}</span>}
        {one(t.root, true)}
        {t.replies.map((r) => one(r, false))}
        {canComment && (replyTo === t.root.id
          ? <Composer people={people} me={me} placeholder="Reply" busy={busy} autoFocus onSend={(text, m) => void post(text, m, t.root.id)} onCancel={() => setReplyTo(null)} />
          : <button type="button" className="wa-link wk-cmt-reply" onClick={() => setReplyTo(t.root.id)}><CornerDownRight size={14} aria-hidden /> Reply</button>)}
      </li>
    );
  };

  return (
    <aside className="wk-cmts" aria-label="Comments">
      <div className="wk-cmts-head">
        <MessageSquare size={17} aria-hidden /><strong>Comments</strong><span className="crm-sub">{open.length} open</span>
        <button type="button" className="wk-x" aria-label="Close comments" onClick={onClose}><X size={17} aria-hidden /></button>
      </div>
      {pending && canComment && (
        <div className="wk-cmt is-new">
          <span className="wk-cmt-quote is-static">“{pending.quote.length > 140 ? `${pending.quote.slice(0, 140)}…` : pending.quote}”</span>
          <Composer people={people} me={me} placeholder="Add a comment" busy={busy} autoFocus onSend={(t, m) => void post(t, m, null)} onCancel={onPendingDone} />
        </div>
      )}
      {!list ? <p className="crm-sub">Loading…</p> : (
        <>
          {open.length === 0 && !pending && <p className="crm-sub wk-cmts-empty">{canComment ? 'No open comments. Select some words and press “Comment”, or comment on the whole document below.' : 'No open comments.'}</p>}
          <ul className="wk-cmt-list">{open.map(card)}</ul>
          {canComment && !pending && (
            <details className="wk-cmt-general">
              <summary><MessageSquarePlus size={14} aria-hidden /> Comment on the whole document</summary>
              <Composer people={people} me={me} placeholder="Add a comment" busy={busy} onSend={(t, m) => void post(t, m, null)} />
            </details>
          )}
          {done.length > 0 && (
            <>
              <button type="button" className="wa-link wk-cmt-toggle" aria-expanded={showDone} onClick={() => setShowDone((s) => !s)}>{showDone ? 'Hide' : 'Show'} resolved ({done.length})</button>
              {showDone && <ul className="wk-cmt-list">{done.map(card)}</ul>}
            </>
          )}
        </>
      )}
    </aside>
  );
}
