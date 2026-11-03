'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Check, CheckCheck, CornerUpLeft, Download, FileText, Image as ImageIcon, Lock, Paperclip, Search, Send, Smile, Tag, Users, X,
} from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { useLiveEvents } from '@/lib/crm/live';
import { EMOJI } from '@/lib/crm/emoji';
import { contactTypeLabel, ErrorBox, friendlyError, initials, PageHead, Skeleton, useToast } from '@/components/crm/ui';

export interface ChatThread { id: string; kind: 'agent' | 'team'; agentId?: string | null; title: string; sub?: string | null; lastMessageAt?: string | null; lastPreview?: string | null; unread: number }
export interface ChatMsg {
  id: string; clientId: string; threadId: string; senderId: string; senderName: string; fromOffice: boolean; mine: boolean;
  text?: string | null; contact?: { id: string; name: string } | null;
  file?: { name: string; mime: string; size?: number | null; url: string } | null;
  lat?: number | null; lng?: number | null;
  replyTo?: { id: string; senderName: string; text?: string | null; fileName?: string | null } | null;
  createdAt: string;
  pending?: boolean; failed?: boolean;
}
interface MsgRes { messages: ChatMsg[]; otherReadAt?: string | null; otherSeenAt?: string | null; hasMore: boolean }
interface PartnerHit { clientId: string; name: string; type: string; panchayat?: string | null; agentName?: string }

const ACCEPT = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt';
const MAX_BYTES = 15 * 1024 * 1024;
const dayFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });
const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const istDay = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
function listTime(iso?: string | null) {
  if (!iso) return '';
  const d = istDay(iso), today = istDay(new Date().toISOString()), y = istDay(new Date(Date.now() - 864e5).toISOString());
  return d === today ? timeFmt.format(new Date(iso)) : d === y ? 'Yesterday' : new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
}
function dayLabel(iso: string) {
  const d = istDay(iso), today = istDay(new Date().toISOString()), y = istDay(new Date(Date.now() - 864e5).toISOString());
  return d === today ? 'Today' : d === y ? 'Yesterday' : dayFmt.format(new Date(iso));
}
const size = (n?: number | null) => (n == null ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export default function ChatPageWrap() {
  return (
    <Suspense fallback={<main className="crm-page"><Skeleton h={520} /></main>}>
      <ChatPage />
    </Suspense>
  );
}

function ChatPage() {
  const params = useSearchParams();
  const router = useRouter();
  const selected = params.get('t');
  const [threads, setThreads] = useState<ChatThread[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [ping, setPing] = useState(0);

  const loadThreads = useCallback(async () => {
    try {
      const r = await crm.get<{ threads: ChatThread[] }>('/api/v1/chat/threads');
      setThreads(r.threads);
      setError(null);
    } catch (e) { setError(friendlyError(e)); }
  }, []);
  useEffect(() => {
    const first = setTimeout(() => void loadThreads(), 0);
    const t = setInterval(() => { if (!document.hidden) void loadThreads(); }, 20000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [loadThreads]);
  const onChat = useCallback(() => { void loadThreads(); setPing((n) => n + 1); }, [loadThreads]);
  const noop = useCallback(() => {}, []);
  useLiveEvents(noop, undefined, onChat);

  const open = (id: string | null) => router.replace(id ? `/admin/chat?t=${id}` : '/admin/chat', { scroll: false });
  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (threads ?? []).filter((t) => !s || t.title.toLowerCase().includes(s) || (t.sub ?? '').toLowerCase().includes(s));
  }, [threads, search]);
  const current = threads?.find((t) => t.id === selected) ?? null;

  return (
    <main className="crm-page">
      <PageHead title="Chat" sub="Talk with field agents one to one, or with the whole team. Share photos and documents and tag a partner: tagged items also show on that partner's profile." />
      {error && <ErrorBox message={error} onRetry={loadThreads} />}
      <div className={`ch-shell${selected ? ' has-sel' : ''}`}>
        <aside className="ch-list" aria-label="Conversations">
          <label className="ch-search">
            <Search size={16} aria-hidden />
            <span className="crm-sr">Search conversations</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search agents" />
          </label>
          {!threads ? <div style={{ padding: 12 }}><Skeleton h={300} /></div> : (
            <ul>
              {shown.map((t) => (
                <li key={t.id}>
                  <button type="button" className="ch-thread" aria-current={t.id === selected ? 'true' : undefined} onClick={() => open(t.id)}>
                    <span className={`ch-avatar${t.kind === 'team' ? ' is-team' : ''}`} aria-hidden>{t.kind === 'team' ? <Users size={18} /> : initials(t.title)}</span>
                    <span className="ch-thread-main">
                      <span className="ch-thread-top">
                        <strong>{t.title}</strong>
                        <span className={t.unread ? 'is-unread' : undefined}>{listTime(t.lastMessageAt)}</span>
                      </span>
                      <span className="ch-thread-bottom">
                        <span className="ch-preview">{t.lastPreview ?? (t.sub ? t.sub : 'No messages yet')}</span>
                        {t.unread > 0 && <span className="ch-badge" aria-label={`${t.unread} unread`}>{t.unread}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {shown.length === 0 && <li className="crm-sub" style={{ padding: 16 }}>No agent matches.</li>}
            </ul>
          )}
        </aside>
        <section className="ch-pane" aria-label="Conversation">
          {current ? <Conversation key={current.id} thread={current} ping={ping} onBack={() => open(null)} onSent={loadThreads} /> : (
            <div className="ch-empty">
              <Lock size={22} aria-hidden />
              <strong>Pick a conversation</strong>
              <span>Messages and files are private to the people in each chat and are kept on the hospital&apos;s server.</span>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Conversation({ thread, ping, onBack, onSent }: { thread: ChatThread; ping: number; onBack: () => void; onSent: () => void }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [readAt, setReadAt] = useState<string | null>(null);
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiGroup, setEmojiGroup] = useState(0);
  const [tag, setTag] = useState<PartnerHit | null>(null);
  const [tagOpen, setTagOpen] = useState(false);
  const [reply, setReply] = useState<ChatMsg | null>(null);
  const [toast, showToast] = useToast();
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastAt = useRef<string | null>(null);

  const merge = useCallback((incoming: ChatMsg[]) => {
    setMsgs((cur) => {
      const byClient = new Map(cur.map((m) => [m.clientId, m]));
      for (const m of incoming) byClient.set(m.clientId, m);
      const all = [...byClient.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const last = [...all].reverse().find((m) => !m.pending);
      if (last) lastAt.current = last.createdAt;
      return all;
    });
  }, []);

  const fetchNew = useCallback(async (first = false) => {
    try {
      const q = first || !lastAt.current ? '' : `?after=${encodeURIComponent(lastAt.current)}`;
      const r = await crm.get<MsgRes>(`/api/v1/chat/threads/${thread.id}/messages${q}`);
      if (first) setHasMore(r.hasMore);
      merge(r.messages);
      setReadAt(r.otherReadAt ?? null);
      setSeenAt(r.otherSeenAt ?? null);
      setLoaded(true);
      if (r.messages.some((m) => !m.mine) || first) void crm.post(`/api/v1/chat/threads/${thread.id}/read`).then(onSent).catch(() => undefined);
    } catch { setLoaded(true); }
  }, [thread.id, merge, onSent]);

  useEffect(() => {
    void fetchNew(true);
    const t = setInterval(() => { if (!document.hidden) void fetchNew(); }, 5000);
    return () => clearInterval(t);
  }, [fetchNew]);
  useEffect(() => { if (ping) void fetchNew(); }, [ping, fetchNew]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);

  const older = async () => {
    const first = msgs.find((m) => !m.pending);
    if (!first) return;
    const r = await crm.get<MsgRes>(`/api/v1/chat/threads/${thread.id}/messages?before=${encodeURIComponent(first.createdAt)}`);
    setHasMore(r.hasMore);
    merge(r.messages);
  };

  const baseFields = () => ({ clientId: uid(), contactClientId: tag?.clientId, replyToId: reply?.id });
  const optimistic = (clientId: string, extra: Partial<ChatMsg>): ChatMsg => ({
    id: clientId, clientId, threadId: thread.id, senderId: 'me', senderName: 'You', fromOffice: true, mine: true,
    contact: tag ? { id: tag.clientId, name: tag.name } : null,
    replyTo: reply ? { id: reply.id, senderName: reply.senderName, text: reply.text, fileName: reply.file?.name } : null,
    createdAt: new Date().toISOString(), pending: true, ...extra,
  });

  const sendText = async () => {
    const body = text.trim();
    if (!body) return;
    const f = baseFields();
    merge([optimistic(f.clientId, { text: body })]);
    setText(''); setReply(null); setTag(null); setEmojiOpen(false);
    try {
      const m = await crm.post<ChatMsg>(`/api/v1/chat/threads/${thread.id}/messages`, { ...f, text: body });
      merge([m]); onSent();
    } catch (e) {
      merge([{ ...optimistic(f.clientId, { text: body }), failed: true, pending: false }]);
      showToast(friendlyError(e));
    }
  };

  const sendFile = async (file: File) => {
    if (file.size > MAX_BYTES) { showToast('Files can be up to 15 MB.'); return; }
    const f = baseFields();
    const caption = text.trim();
    merge([optimistic(f.clientId, { text: caption || null, file: { name: file.name, mime: file.type, size: file.size, url: '' } })]);
    setText(''); setReply(null); setTag(null);
    const form = new FormData();
    form.append('file', file);
    form.append('clientId', f.clientId);
    if (caption) form.append('text', caption);
    if (f.contactClientId) form.append('contactClientId', f.contactClientId);
    if (f.replyToId) form.append('replyToId', f.replyToId);
    try {
      const m = await crm.upload<ChatMsg>(`/api/v1/chat/threads/${thread.id}/files`, form);
      merge([m]); onSent();
    } catch (e) {
      setMsgs((cur) => cur.map((m) => (m.clientId === f.clientId ? { ...m, pending: false, failed: true } : m)));
      showToast(friendlyError(e));
    }
  };

  const insertEmoji = (e: string) => {
    const el = inputRef.current;
    if (!el) { setText((t) => t + e); return; }
    const a = el.selectionStart ?? text.length, b = el.selectionEnd ?? text.length;
    const next = text.slice(0, a) + e + text.slice(b);
    setText(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + e.length, a + e.length); });
  };

  // Group by day.
  const rows: ({ day: string } | ChatMsg)[] = [];
  let lastDay = '';
  for (const m of msgs) {
    const d = istDay(m.createdAt);
    if (d !== lastDay) { rows.push({ day: m.createdAt }); lastDay = d; }
    rows.push(m);
  }

  return (
    <div className="ch-conv">
      <header className="ch-head">
        <button type="button" className="ch-icon ch-back" onClick={onBack} aria-label="Back to conversations"><ArrowLeft size={18} /></button>
        <span className={`ch-avatar${thread.kind === 'team' ? ' is-team' : ''}`} aria-hidden>{thread.kind === 'team' ? <Users size={18} /> : initials(thread.title)}</span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <strong>{thread.title}</strong>
          <span className="crm-cell-sub" style={{ display: 'block' }}>{thread.kind === 'team' ? 'Everyone in the field team and the office' : [thread.agentId, thread.sub].filter(Boolean).join(' · ')}</span>
        </span>
        {thread.agentId && <Link className="crm-btn is-secondary is-sm" href={`/admin/activity?agent=${encodeURIComponent(thread.agentId)}`}>Today&apos;s activity</Link>}
      </header>

      <div className="ch-body" role="log" aria-live="polite">
        <div className="ch-secure"><Lock size={12} aria-hidden /> Only the people in this chat can see these messages and files.</div>
        {hasMore && <button type="button" className="ch-older" onClick={older}>Load earlier messages</button>}
        {!loaded ? <Skeleton h={200} /> : msgs.length === 0 ? <div className="ch-none">No messages yet. Say namaste 👋</div> : null}
        {rows.map((r, i) => 'day' in r ? <div key={`d${i}`} className="ch-day"><span>{dayLabel(r.day)}</span></div> : (
          <Bubble key={r.clientId} m={r} showName={!r.mine && (thread.kind === 'team' || r.fromOffice)} readAt={readAt} seenAt={seenAt}
            onReply={() => { setReply(r); inputRef.current?.focus(); }} />
        ))}
        <div ref={endRef} />
      </div>

      {emojiOpen && (
        <div className="ch-emoji" role="dialog" aria-label="Emoji">
          <div className="ch-emoji-tabs" role="tablist">
            {EMOJI.map((g, i) => <button key={g.group} type="button" role="tab" aria-selected={i === emojiGroup} title={g.group} onClick={() => setEmojiGroup(i)}>{g.icon}</button>)}
          </div>
          <div className="ch-emoji-grid">
            {EMOJI[emojiGroup].list.map((e) => <button key={e} type="button" onClick={() => insertEmoji(e)} aria-label={e}>{e}</button>)}
          </div>
        </div>
      )}

      <footer className="ch-compose">
        {(reply || tag) && (
          <div className="ch-attach-row">
            {reply && (
              <span className="ch-reply-chip"><CornerUpLeft size={14} aria-hidden /> Replying to {reply.senderName}: {reply.text?.slice(0, 60) ?? reply.file?.name}
                <button type="button" onClick={() => setReply(null)} aria-label="Cancel reply"><X size={14} /></button></span>
            )}
            {tag && (
              <span className="ch-tag-chip"><Tag size={14} aria-hidden /> {tag.name}
                <button type="button" onClick={() => setTag(null)} aria-label="Remove partner tag"><X size={14} /></button></span>
            )}
          </div>
        )}
        <div className="ch-compose-row">
          <button type="button" className="ch-icon" aria-label="Emoji" aria-pressed={emojiOpen} onClick={() => setEmojiOpen((o) => !o)}><Smile size={20} /></button>
          <button type="button" className="ch-icon" aria-label="Attach a photo or document" onClick={() => fileRef.current?.click()}><Paperclip size={20} /></button>
          <button type="button" className="ch-icon" aria-label="Tag a partner" aria-pressed={!!tag} onClick={() => setTagOpen(true)}><Tag size={20} /></button>
          <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void sendFile(f); }} />
          <label className="crm-sr" htmlFor="ch-input">Message</label>
          <textarea id="ch-input" ref={inputRef} rows={1} value={text} maxLength={4000} placeholder="Type a message"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendText(); } }} />
          <button type="button" className="ch-send" aria-label="Send" disabled={!text.trim()} onClick={() => void sendText()}><Send size={18} /></button>
        </div>
      </footer>
      {tagOpen && <TagPicker agentId={thread.kind === 'agent' ? thread.agentId ?? undefined : undefined} onClose={() => setTagOpen(false)} onPick={(p) => { setTag(p); setTagOpen(false); inputRef.current?.focus(); }} />}
      {toast}
    </div>
  );
}

function Bubble({ m, showName, readAt, seenAt, onReply }: { m: ChatMsg; showName: boolean; readAt: string | null; seenAt: string | null; onReply: () => void }) {
  const read = m.mine && readAt && readAt >= m.createdAt;
  const seen = m.mine && seenAt && seenAt >= m.createdAt;
  return (
    <div className={`ch-msg${m.mine ? ' is-mine' : ''}${m.failed ? ' is-failed' : ''}`}>
      <div className="ch-bubble">
        {showName && <span className="ch-sender">{m.senderName}{m.fromOffice ? ' · Office' : ''}</span>}
        {m.replyTo && <span className="ch-quote"><strong>{m.replyTo.senderName}</strong>{m.replyTo.text ?? (m.replyTo.fileName ? `📎 ${m.replyTo.fileName}` : '')}</span>}
        {m.file && <FileView m={m} />}
        {m.text && <span className="ch-text">{m.text}</span>}
        {m.contact && (
          <Link className="ch-tag" href={`/admin/partners?id=${encodeURIComponent(m.contact.id)}`}><Tag size={12} aria-hidden /> {m.contact.name}</Link>
        )}
        <span className="ch-meta">
          {timeFmt.format(new Date(m.createdAt))}
          {m.mine && (m.failed ? <span className="ch-fail">Not sent</span>
            : m.pending ? <Check size={14} aria-label="Sending" style={{ opacity: 0.5 }} />
              : read ? <CheckCheck size={15} aria-label="Read" className="is-read" />
                : seen ? <CheckCheck size={15} aria-label="Delivered" /> : <Check size={14} aria-label="Sent" />)}
        </span>
      </div>
      {!m.pending && <button type="button" className="ch-reply-btn" onClick={onReply} aria-label="Reply"><CornerUpLeft size={14} /></button>}
    </div>
  );
}

/** Private files load through the API with the session, never from a public link. */
function FileView({ m }: { m: ChatMsg }) {
  const f = m.file!;
  const isImage = f.mime.startsWith('image/');
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!isImage || !f.url) return;
    let url: string | null = null, alive = true;
    crm.blob(f.url).then((b) => { url = URL.createObjectURL(b); if (alive) setSrc(url); }).catch(() => undefined);
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [f.url, isImage]);
  const open = async (download: boolean) => {
    if (!f.url) return;
    const b = await crm.blob(`${f.url}${download ? '?download=true' : ''}`);
    const url = URL.createObjectURL(b);
    if (download) {
      const a = document.createElement('a'); a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
    } else window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  if (isImage) {
    return src
      // A blob: URL for a private file, so next/image can't optimise it.
      // eslint-disable-next-line @next/next/no-img-element
      ? <button type="button" className="ch-img" onClick={() => void open(false)} aria-label={`Open ${f.name}`}><img src={src} alt={f.name} /></button>
      : <span className="ch-img is-loading"><ImageIcon size={22} aria-hidden /></span>;
  }
  return (
    <span className="ch-doc">
      <FileText size={26} aria-hidden />
      <span style={{ minWidth: 0, flex: 1 }}>
        <strong>{f.name}</strong>
        <span>{[f.name.split('.').pop()?.toUpperCase(), size(f.size)].filter(Boolean).join(' · ')}</span>
      </span>
      {f.url && <button type="button" onClick={() => void open(f.mime === 'application/pdf' ? false : true)} aria-label={`Open ${f.name}`}><Download size={16} /></button>}
    </span>
  );
}

function TagPicker({ agentId, onClose, onPick }: { agentId?: string; onClose: () => void; onPick: (p: PartnerHit) => void }) {
  const [q, setQ] = useState('');
  const [onlyAgent, setOnlyAgent] = useState(!!agentId);
  const [hits, setHits] = useState<PartnerHit[] | null>(null);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      const sp = new URLSearchParams({ pageSize: '20' });
      if (q.trim()) sp.set('q', q.trim());
      if (onlyAgent && agentId) sp.set('agentId', agentId);
      crm.get<{ rows: PartnerHit[] }>(`/api/v1/partners?${sp}`).then((r) => { if (alive) setHits(r.rows); }).catch(() => alive && setHits([]));
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, onlyAgent, agentId]);
  return (
    <div className="ch-tagpicker" role="dialog" aria-label="Tag a partner">
      <div className="ch-tagpicker-head">
        <strong>Tag a partner</strong>
        <button type="button" className="ch-icon" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </div>
      <input autoFocus className="crm-input" placeholder="Search name, phone or panchayat" value={q} onChange={(e) => setQ(e.target.value)} />
      {agentId && <label className="crm-cell-sub" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={onlyAgent} onChange={(e) => setOnlyAgent(e.target.checked)} /> Only this agent&apos;s partners</label>}
      <ul>
        {(hits ?? []).map((p) => (
          <li key={p.clientId}><button type="button" onClick={() => onPick(p)}>
            <strong>{p.name}</strong>
            <span className="crm-cell-sub">{[contactTypeLabel(p.type), p.panchayat, p.agentName].filter(Boolean).join(' · ')}</span>
          </button></li>
        ))}
        {hits && hits.length === 0 && <li className="crm-cell-sub" style={{ padding: 10 }}>No partner found.</li>}
        {!hits && <li style={{ padding: 10 }}><Skeleton h={60} /></li>}
      </ul>
    </div>
  );
}
