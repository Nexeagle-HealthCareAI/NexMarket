'use client';

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowDown, ArrowLeft, Check, CheckCheck, ChevronLeft, ChevronRight, ClipboardList, Copy, CornerUpLeft, Download, FileText, Image as ImageIcon,
  Info, Languages, Lock, MapPin, MessageSquarePlus, Paperclip, Phone, PhoneIncoming, PhoneMissed, Pin, PinOff, Plus, Search, Send, Settings2, SmilePlus, Smile, Sparkles, Tag, Trash2, Upload, Users, Video, X, Zap,
} from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { useLiveEvents } from '@/lib/crm/live';
import { EMOJI } from '@/lib/crm/emoji';
import { lastSeenText, liveText, type Live } from '@/lib/crm/presence';
import { canAssignBlocks, useAccess, place } from '@/lib/crm/access';
import { digest, loadChatAi, needsEnglish, saveChatAi, suggestReplies, summarise, taskIdea, translateMessages, useChatAi, type ChatSummary, type Digest, type TaskIdea } from '@/lib/crm/chatAi';
import { callNoteText, inCallCount, joinCall, live as callLive, startCall, useCalls, type Call, type CallNote } from '@/lib/crm/calls';
import { contactTypeLabel, ErrorBox, friendlyError, initials, Modal, PageHead, Skeleton, useToast } from '@/components/crm/ui';

// ─── Types ───────────────────────────────────────────────────────────────

export interface Presence { state: 'visit' | 'shift' | 'off'; place?: string | null; since?: string | null; lastSeenAt?: string | null }
export interface ChatThread {
  id: string; kind: 'agent' | 'team' | 'direct'; agentId?: string | null; title: string; sub?: string | null; lastMessageAt?: string | null;
  lastPreview?: string | null; unread: number; photoUrl?: string | null; presence?: Presence | null;
  /** Online now, or last seen (the other person, the office, or how many are online in Team). */
  live?: Live | null;
}
interface ChatPerson { agentId: string; name: string; role: string; kind: 'dashboard' | 'field'; block?: string | null; photoUrl?: string | null }
interface Reaction { emoji: string; count: number; mine: boolean; names: string[] }
export interface ChatMsg {
  id: string; clientId: string; threadId: string; senderId: string; senderName: string; fromOffice: boolean; mine: boolean;
  text?: string | null; contact?: { id: string; name: string } | null;
  file?: { name: string; mime: string; size?: number | null; url: string } | null;
  lat?: number | null; lng?: number | null;
  replyTo?: { id: string; senderName: string; text?: string | null; fileName?: string | null } | null;
  reactions?: Reaction[];
  /** A system message written when a call in this chat ended. */
  call?: CallNote | null;
  createdAt: string;
  pending?: boolean; failed?: boolean;
  /** The file being sent from this browser, kept so a failed upload can be retried. */
  localFile?: File | null;
}
interface Pinned { message: ChatMsg; pinnedBy: string; pinnedAt: string }
interface MsgRes { messages: ChatMsg[]; otherReadAt?: string | null; otherSeenAt?: string | null; hasMore: boolean; pinned?: Pinned | null; live?: Live | null }
interface PartnerHit { clientId: string; name: string; type: string; panchayat?: string | null; agentName?: string }
interface SearchHit { id: string; createdAt: string; senderName: string; text?: string | null; fileName?: string | null; contactName?: string | null }
interface Shared { media: ChatMsg[]; files: ChatMsg[]; places: ChatMsg[]; partners: { id: string; name: string; count: number; lastAt: string }[] }
interface Staged { id: string; file: File; preview: string | null }

// ─── Helpers ─────────────────────────────────────────────────────────────

// Exactly what the server accepts (ChatController.Allowed).
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.csv', '.txt'];
const ACCEPT = ALLOWED_EXT.join(',');
const extOf = (name: string) => { const i = name.lastIndexOf('.'); return i < 0 ? '' : name.slice(i).toLowerCase(); };
/** Photos a browser can show in place. HEIC (iPhone) can't be shown by most browsers, so it is a file card. */
const showsInline = (mime?: string | null) => !!mime && mime.startsWith('image/') && mime !== 'image/heic' && mime !== 'image/heif';
/** A timestamp as a fixed-width string (7 fraction digits), so plain string order is time order. */
const isoKey = (iso: string) => iso.replace(/(\.\d+)?(Z|[+-]\d\d:\d\d)$/, (_, f: string | undefined, z: string) => `${(f ?? '.').padEnd(8, '0').slice(0, 8)}${z}`);
const isTouch = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_STAGED = 10;
const QUICK_REACTIONS = ['👍', '✅', '🙏', '❤️', '😂', '👀'];
const dayFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });
const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const shortDate = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
const istDay = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
function listTime(iso?: string | null) {
  if (!iso) return '';
  const d = istDay(iso), today = istDay(new Date().toISOString()), y = istDay(new Date(Date.now() - 864e5).toISOString());
  return d === today ? timeFmt.format(new Date(iso)) : d === y ? 'Yesterday' : shortDate.format(new Date(iso));
}
function dayLabel(iso: string) {
  const d = istDay(iso), today = istDay(new Date().toISOString()), y = istDay(new Date(Date.now() - 864e5).toISOString());
  return d === today ? 'Today' : d === y ? 'Yesterday' : dayFmt.format(new Date(iso));
}
const size = (n?: number | null) => (n == null ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const isImage = (m: ChatMsg) => !!m.file && showsInline(m.file.mime) && !!m.file.url;
const mapsUrl = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`;
const tomorrowIst = () => istDay(new Date(Date.now() + 864e5).toISOString());

/** On a visit / on shift / off, in words, for the conversation header. */
function presenceText(p?: Presence | null): string | null {
  if (!p) return null;
  const at = (iso?: string | null) => (iso ? timeFmt.format(new Date(iso)) : '');
  if (p.state === 'visit') return `On a visit${p.place ? ` at ${p.place}` : ''}${p.since ? ` since ${at(p.since)}` : ''}`;
  if (p.state === 'shift') return `On shift${p.since ? ` since ${at(p.since)}` : ''}${p.lastSeenAt ? ` · last update ${at(p.lastSeenAt)}` : ''}`;
  return p.lastSeenAt ? `Off shift · last seen ${at(p.lastSeenAt)}` : 'Off shift today';
}
/** The server's reason (e.g. 409 "already answered"), my own "already in a call", or a plain fallback. */
const callError = (e: unknown, fallback: string) => friendlyError(e, '') || (e instanceof Error && e.message.startsWith('You are already') ? e.message : fallback);
const PRESENCE_LABEL: Record<Presence['state'], string> = { visit: 'On a visit', shift: 'On shift', off: 'Off shift' };

/** Text with web links made clickable (opens in a new tab). */
function Linkify({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<]+)/g);
  return <>{parts.map((p, i) => (/^https?:\/\//.test(p)
    ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="ch-link">{p}</a>
    : <span key={i}>{p}</span>))}</>;
}

// Saved quick replies live in this browser only: a per-person convenience, not shared data.
const QR_KEY = 'crm-chat-quick-v1';
const QR_DEFAULT = [
  'Please share today\'s visit photos.',
  'Call me when you are free.',
  'Good work today 👏',
  'Please update the partner\'s details in the app.',
  'Patient ko referral desk par bhej dijiye.',
  'Kal subah 10 baje office aa jaiye.',
];
function loadQuick(): string[] {
  try { const v = JSON.parse(localStorage.getItem(QR_KEY) ?? 'null'); if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v; } catch { /* storage off */ }
  return QR_DEFAULT;
}
function saveQuick(list: string[]) { try { localStorage.setItem(QR_KEY, JSON.stringify(list)); } catch { /* storage off: kept for this visit */ } }

/** Polling continues from the newest message someone else sent (the server repeats the last 10 s, so nothing is missed). */
function advanceFrom(lastAt: { current: string | null }, list: ChatMsg[], allowMine: boolean) {
  for (const m of list) {
    if (m.mine && !allowMine) continue;
    if (!lastAt.current || isoKey(m.createdAt) > isoKey(lastAt.current)) lastAt.current = m.createdAt;
  }
}

// ─── Page ────────────────────────────────────────────────────────────────

type ListFilter = 'all' | 'unread' | 'field' | 'direct';

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
  const { access } = useAccess();
  const selected = params.get('t');
  const [threads, setThreads] = useState<ChatThread[] | null>(null);
  const [office, setOffice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ListFilter>('all');
  const [ping, setPing] = useState(0);
  const [newOpen, setNewOpen] = useState(false);
  const [digestOpen, setDigestOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const calls = useCalls();
  const ai = useChatAi();
  useEffect(() => { void loadChatAi(); }, []);
  // The call or huddle going on in each chat (mine first, then what /calls/active says).
  const liveCalls = useMemo(() => {
    const m = new Map<string, Call>();
    for (const c of calls.active) if (callLive(c) && !m.has(c.threadId)) m.set(c.threadId, c);
    if (calls.session) m.set(calls.session.call.threadId, calls.session.call);
    return m;
  }, [calls.active, calls.session]);

  const loadThreads = useCallback(async () => {
    try {
      const r = await crm.get<{ office: boolean; threads: ChatThread[] }>('/api/v1/chat/threads');
      setThreads(r.threads);
      setOffice(!!r.office);
      setError(null);
    } catch (e) { setError(friendlyError(e)); }
  }, []);
  useEffect(() => {
    const first = setTimeout(() => void loadThreads(), 0);
    const t = setInterval(() => { if (!document.hidden) void loadThreads(); }, 20000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [loadThreads]);
  // Chat pings come in bursts (a message, then each reader's receipt): reload the list once they settle.
  const listTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadThreadsSoon = useCallback(() => {
    if (listTimer.current) clearTimeout(listTimer.current);
    listTimer.current = setTimeout(() => { listTimer.current = null; void loadThreads(); }, 1500);
  }, [loadThreads]);
  useEffect(() => () => { if (listTimer.current) clearTimeout(listTimer.current); }, []);
  const selectedRef = useRef(selected);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  const onChat = useCallback((threadId: string) => {
    loadThreadsSoon();
    // Only the open conversation needs to fetch its messages again.
    if (threadId && threadId === selectedRef.current) setPing((n) => n + 1);
  }, [loadThreadsSoon]);
  const noop = useCallback(() => {}, []);
  useLiveEvents(noop, undefined, onChat);

  // Ctrl/⌘ + K jumps to the chat search from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchRef.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const open = (id: string | null) => router.replace(id ? `/admin/chat?t=${id}` : '/admin/chat', { scroll: false });
  const all = useMemo(() => threads ?? [], [threads]);
  const counts = useMemo(() => ({
    unread: all.filter((t) => t.unread > 0).length,
    field: all.filter((t) => t.kind === 'agent').length,
    direct: all.filter((t) => t.kind === 'direct').length,
  }), [all]);
  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return all.filter((t) => (filter === 'all' || (filter === 'unread' ? t.unread > 0 : filter === 'field' ? t.kind === 'agent' : t.kind === 'direct'))
      && (!s || t.title.toLowerCase().includes(s) || (t.sub ?? '').toLowerCase().includes(s) || (t.lastPreview ?? '').toLowerCase().includes(s)));
  }, [all, search, filter]);
  const current = all.find((t) => t.id === selected) ?? null;
  const onShift = all.filter((t) => t.kind === 'agent' && t.presence && t.presence.state !== 'off').length;
  const onlineNow = all.filter((t) => t.kind !== 'team' && t.live?.online && (office ? t.kind === 'agent' || t.kind === 'direct' : t.kind === 'direct')).length;

  const chips: { k: ListFilter; l: string; n?: number }[] = [
    { k: 'all', l: 'All' }, { k: 'unread', l: 'Unread', n: counts.unread },
    ...(counts.field ? [{ k: 'field' as const, l: 'Field agents', n: counts.field }] : []),
    { k: 'direct', l: 'One-to-one', n: counts.direct },
  ];

  return (
    <main className="crm-page">
      <PageHead title="Chat" sub={office && counts.field ? `${onShift} of ${counts.field} field agents on shift now${onlineNow ? ` · ${onlineNow} online` : ''} · Ctrl+K to find a chat` : 'Talk with the office, the whole team, or anyone one to one.'}>
        {office && ai.status.summary && <button type="button" className="crm-btn is-secondary ch-ai-btn" onClick={() => setDigestOpen(true)}><Sparkles size={16} aria-hidden /> Today&apos;s digest</button>}
        {ai.canManage && <button type="button" className="crm-btn is-secondary" onClick={() => setAiOpen(true)} aria-label="Smart chat settings" title="Smart chat settings"><Settings2 size={16} aria-hidden /> Smart chat</button>}
        <button type="button" className="crm-btn" onClick={() => setNewOpen(true)}><MessageSquarePlus size={16} aria-hidden /> New chat</button>
      </PageHead>
      {error && <ErrorBox message={error} onRetry={loadThreads} />}
      <div className={`ch-shell${selected ? ' has-sel' : ''}`}>
        <aside className="ch-list" aria-label="Conversations">
          <label className="ch-search">
            <Search size={16} aria-hidden />
            <span className="crm-sr">Search conversations</span>
            <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search chats" />
            {search && <button type="button" className="ch-clear" onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button>}
          </label>
          <div className="ch-filters" role="group" aria-label="Show">
            {chips.map((c) => (
              <button key={c.k} type="button" aria-pressed={filter === c.k} onClick={() => setFilter(c.k)}>
                {c.l}{c.n ? <span>{c.n}</span> : null}
              </button>
            ))}
          </div>
          {!threads ? <div style={{ padding: 12 }}><Skeleton h={300} /></div> : (
            <ul>
              {shown.map((t) => (
                <li key={t.id}>
                  <button type="button" className="ch-thread" aria-current={t.id === selected ? 'true' : undefined} onClick={() => open(t.id)}>
                    <ThreadAvatar t={t} />
                    <span className="ch-thread-main">
                      <span className="ch-thread-top">
                        <strong>{t.title}{t.kind === 'direct' && <span className="ch-direct-dot" title="One-to-one: only the two of you can read it"><Lock size={11} aria-hidden /></span>}</strong>
                        {calls.on && liveCalls.has(t.id) && <CallMarker c={liveCalls.get(t.id)!} />}
                        <span className={t.unread ? 'is-unread' : undefined}>{listTime(t.lastMessageAt)}</span>
                      </span>
                      <span className="ch-thread-bottom">
                        <span className="ch-preview">
                          {t.presence && t.presence.state !== 'off' && <span className={`ch-pres-tag is-${t.presence.state}`}>{t.presence.state === 'visit' ? (t.presence.place ?? 'Visit') : 'On shift'}</span>}
                          {t.lastPreview ?? (t.sub ? t.sub : 'No messages yet')}
                        </span>
                        {t.unread > 0 && <span className="ch-badge" aria-label={`${t.unread} unread`}>{t.unread}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {shown.length === 0 && <li className="crm-sub" style={{ padding: 16 }}>{filter === 'unread' ? 'All caught up 🎉' : 'No chat matches.'}</li>}
            </ul>
          )}
        </aside>
        <section className="ch-pane" aria-label="Conversation">
          {current ? (
            <Conversation key={current.id} thread={current} office={office} ping={ping} canTask={canAssignBlocks(access)}
              callsOn={calls.on} liveCall={liveCalls.get(current.id) ?? null} inCall={calls.session?.call.threadId === current.id}
              onBack={() => open(null)} onSent={loadThreadsSoon}
              onRead={() => { setThreads((ts) => ts && ts.map((t) => (t.id === current.id ? { ...t, unread: 0 } : t))); loadThreadsSoon(); }} />
          ) : (
            <div className="ch-empty">
              <Lock size={22} aria-hidden />
              <strong>Pick a conversation</strong>
              <span>Messages and files are private to the people in each chat and are kept on the {place()}&apos;s server.</span>
              <span className="ch-tips">Drop photos straight into a chat · type <kbd>/</kbd> for quick replies · hover a message to react, pin or make it a task</span>
            </div>
          )}
        </section>
      </div>
      {newOpen && <NewChat onClose={() => setNewOpen(false)} onOpened={(id) => { setNewOpen(false); void loadThreads().then(() => open(id)); }} />}
      {digestOpen && <DigestModal onClose={() => setDigestOpen(false)} onOpen={(id) => { setDigestOpen(false); open(id); }} />}
      {aiOpen && <SmartChatSettings onClose={() => setAiOpen(false)} />}
    </main>
  );
}

/** "Huddle · 3" / "In call" next to a chat in the list while a call is going on there. */
function CallMarker({ c }: { c: Call }) {
  const n = inCallCount(c);
  const text = c.kind === 'huddle' ? `Huddle${n ? ` · ${n}` : ''}` : c.status === 'ringing' ? 'Calling…' : 'In call';
  return <span className={`ch-call-mark${c.status === 'ringing' ? ' is-ringing' : ''}`} title={c.kind === 'huddle' ? `Huddle going on · ${n} ${n === 1 ? 'person' : 'people'}` : text}>
    {c.video ? <Video size={11} aria-hidden /> : <Phone size={11} aria-hidden />}{text}</span>;
}

function ThreadAvatar({ t, small }: { t: ChatThread; small?: boolean }) {
  // Green dot = online now (CRM or app open). Shift and visits show as a tag next to the message preview.
  const seen = t.live && !t.live.online ? lastSeenText(t.live.lastSeenAt) : null;
  const dot = t.kind !== 'team' && t.live?.online
    ? <span className="ch-pres is-online" aria-label="Online now" title={['Online now', presenceText(t.presence)].filter(Boolean).join(' · ')} />
    : t.presence ? <span className={`ch-pres is-${t.presence.state} is-dim`} aria-label={PRESENCE_LABEL[t.presence.state]} title={[presenceText(t.presence), seen].filter(Boolean).join(' · ') || undefined} /> : null;
  if (t.kind === 'team') return <span className="ch-avatar is-team" aria-hidden><Users size={small ? 16 : 18} /></span>;
  return (
    <span className="ch-avatar-wrap">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {t.kind === 'direct' && t.photoUrl ? <img className="ch-avatar" src={t.photoUrl} alt="" />
        : <span className={`ch-avatar${t.kind === 'direct' ? ' is-direct' : ''}`} aria-hidden>{initials(t.title)}</span>}
      {dot}
    </span>
  );
}

/** Start a one-to-one chat with anyone: an admin, a manager or a field agent. */
function NewChat({ onClose, onOpened }: { onClose: () => void; onOpened: (id: string) => void }) {
  const [people, setPeople] = useState<ChatPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    crm.get<ChatPerson[]>('/api/v1/chat/people').then((p) => { if (alive) setPeople(p); }).catch((e) => { if (alive) setError(friendlyError(e)); });
    return () => { alive = false; };
  }, []);
  const s = q.trim().toLowerCase();
  const list = (people ?? []).filter((p) => !s || p.name.toLowerCase().includes(s) || p.role.toLowerCase().includes(s) || (p.block ?? '').toLowerCase().includes(s) || p.agentId.toLowerCase().includes(s));
  const start = async (p: ChatPerson) => {
    setBusy(p.agentId);
    try { const r = await crm.post<{ id: string }>('/api/v1/chat/direct', { agentId: p.agentId }); onOpened(r.id); }
    catch (e) { setError(friendlyError(e)); setBusy(null); }
  };
  const group = (kind: 'dashboard' | 'field', title: string) => {
    const g = list.filter((p) => p.kind === kind);
    if (!g.length) return null;
    return (
      <div className="ch-people-group">
        <span className="ch-people-title">{title} · {g.length}</span>
        <ul>
          {g.map((p) => (
            <li key={p.agentId}>
              <button type="button" disabled={!!busy} onClick={() => void start(p)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.photoUrl ? <img className="ch-avatar" src={p.photoUrl} alt="" /> : <span className="ch-avatar is-direct" aria-hidden>{initials(p.name)}</span>}
                <span style={{ minWidth: 0, flex: 1 }}>
                  <strong>{p.name}</strong>
                  <span className="crm-cell-sub" style={{ display: 'block' }}>{[p.role, p.block, p.agentId].filter(Boolean).join(' · ')}</span>
                </span>
                {busy === p.agentId && <span className="crm-cell-sub">Opening…</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  };
  return (
    <Modal title="New chat" onClose={onClose}>
      <p className="crm-sub" style={{ margin: 0, fontSize: 13 }}>A one-to-one chat: only the two of you can read it.</p>
      <label className="ch-search" style={{ margin: 0 }}>
        <Search size={16} aria-hidden />
        <span className="crm-sr">Search people</span>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, role or block" />
      </label>
      {error && <div className="crm-error" role="alert">{error}</div>}
      {!people ? <Skeleton h={240} /> : list.length === 0 ? <span className="crm-sub">Nobody matches.</span> : (
        <div className="ch-people">{group('dashboard', 'Office')}{group('field', 'Field team')}</div>
      )}
    </Modal>
  );
}

// ─── Conversation ────────────────────────────────────────────────────────

type Row = { kind: 'day'; at: string } | { kind: 'unread'; n: number } | { kind: 'msg'; m: ChatMsg; cont: boolean };

function Conversation({ thread, office, ping, canTask, callsOn, liveCall, inCall, onBack, onSent, onRead }: {
  thread: ChatThread; office: boolean; ping: number; canTask: boolean; callsOn: boolean; liveCall: Call | null; inCall: boolean;
  onBack: () => void; onSent: () => void; onRead: () => void;
}) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [readAt, setReadAt] = useState<string | null>(null);
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const [pinned, setPinned] = useState<Pinned | null>(null);
  const [text, setText] = useState('');
  const [emojiFor, setEmojiFor] = useState<'compose' | string | null>(null); // 'compose' or a message id to react to
  const [emojiGroup, setEmojiGroup] = useState(0);
  const [tag, setTag] = useState<PartnerHit | null>(null);
  const [tagOpen, setTagOpen] = useState(false);
  const [reply, setReply] = useState<ChatMsg | null>(null);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [dragging, setDragging] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quick, setQuick] = useState<string[]>(loadQuick);
  const [searchOpen, setSearchOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [viewer, setViewer] = useState<{ items: ChatMsg[]; index: number } | null>(null);
  const [taskFor, setTaskFor] = useState<ChatMsg | null>(null);
  const [active, setActive] = useState<string | null>(null); // message whose tools are open (touch screens)
  const [flash, setFlash] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [newBelow, setNewBelow] = useState(0);
  const [unreadFrom, setUnreadFrom] = useState<{ id: string; n: number } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [toast, showToast] = useToast();
  const ai = useChatAi();
  const [tr, setTr] = useState<Record<string, string>>({});
  const [sugg, setSugg] = useState<{ id: string; list: string[] } | null>(null);
  const [summary, setSummary] = useState<{ busy: boolean; data?: ChatSummary; error?: string; since?: string } | null>(null);
  const [idea, setIdea] = useState<TaskIdea | null>(null);
  const [ideaFor, setIdeaFor] = useState<TaskIdea | null>(null);
  const trAsked = useRef(new Set<string>());
  const suggAsked = useRef<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastAt = useRef<string | null>(null);
  const msgsRef = useRef<ChatMsg[]>([]);
  const restore = useRef<number | null>(null);
  const firstScroll = useRef(true);
  const lastCount = useRef(0);
  const dragDepth = useRef(0);
  const unreadAtOpen = useRef(thread.unread);
  const atBottomRef = useRef(true);
  const olderBusy = useRef(false);
  const readOwed = useRef(false); // messages from others arrived while the tab was hidden
  const reacting = useRef(new Map<string, number>()); // message id → reactions in flight
  const reactedAt = useRef(new Map<string, number>()); // message id → step at which I last changed a reaction
  const step = useRef(0); // a counter that orders reaction taps and refreshes
  const stagedRef = useRef<Staged[]>([]);

  const canPin = thread.kind === 'direct' || office;
  const taskAgent = thread.kind === 'agent' ? thread.agentId : thread.kind === 'direct' && thread.presence ? thread.agentId : null;
  const [live, setLive] = useState<Live | null>(thread.live ?? null);
  const presence = [liveText(live, thread.kind, office), presenceText(thread.presence)].filter(Boolean).join(' · ') || null;

  useEffect(() => { msgsRef.current = msgs; }, [msgs]);
  useEffect(() => { stagedRef.current = staged; }, [staged]);
  // Previews of files still waiting to be sent are released when the chat closes.
  useEffect(() => () => { for (const s of stagedRef.current) if (s.preview) URL.revokeObjectURL(s.preview); }, []);

  /** Adds or updates messages by clientId. A copy from the server always wins and is no longer sending or failed. */
  const merge = useCallback((incoming: ChatMsg[], fromServer = true) => {
    setMsgs((cur) => {
      const byClient = new Map(cur.map((m) => [m.clientId, m]));
      for (const m of incoming) {
        const was = byClient.get(m.clientId);
        byClient.set(m.clientId, fromServer
          // Keep reactions I'm changing right now; the server copy may predate my tap.
          ? { ...was, ...m, pending: false, failed: false, localFile: null, reactions: was && reacting.current.has(was.id) ? was.reactions : m.reactions }
          : { ...was, ...m });
      }
      return [...byClient.values()].sort((a, b) => (isoKey(a.createdAt) < isoKey(b.createdAt) ? -1 : isoKey(a.createdAt) > isoKey(b.createdAt) ? 1 : 0));
    });
  }, []);

  // The parent's callbacks change on every render; the fetchers below must not restart because of that.
  const parent = useRef({ onRead, onSent });
  useEffect(() => { parent.current = { onRead, onSent }; }, [onRead, onSent]);

  const markRead = useCallback(() => {
    if (document.hidden) { readOwed.current = true; return; }
    readOwed.current = false;
    parent.current.onRead();
    void crm.post(`/api/v1/chat/threads/${thread.id}/read`).then(() => parent.current.onSent()).catch(() => undefined);
  }, [thread.id]);

  const fetchNew = useCallback(async (first = false) => {
    try {
      const q = first || !lastAt.current ? '' : `?after=${encodeURIComponent(lastAt.current)}`;
      const r = await crm.get<MsgRes>(`/api/v1/chat/threads/${thread.id}/messages${q}`);
      const known = new Set(msgsRef.current.map((m) => m.clientId));
      const fresh = r.messages.filter((m) => !known.has(m.clientId) && !m.mine);
      if (first) {
        setHasMore(r.hasMore);
        // "New messages" line above the first one I haven't read.
        const theirs = r.messages.filter((m) => !m.mine);
        const n = Math.min(unreadAtOpen.current, theirs.length);
        if (n > 0) setUnreadFrom({ id: theirs[theirs.length - n].id, n });
      } else if (fresh.length) {
        const m = fresh[fresh.length - 1];
        setAnnounce(`New message from ${m.senderName}: ${m.text ?? m.file?.name ?? m.contact?.name ?? ''}`);
      }
      merge(r.messages);
      // On first load the page is a full snapshot, so even a chat with only my messages has a starting point.
      advanceFrom(lastAt, r.messages, first || !lastAt.current);
      setReadAt(r.otherReadAt ?? null);
      setSeenAt(r.otherSeenAt ?? null);
      setPinned(r.pinned ?? null);
      if (r.live !== undefined) setLive(r.live ?? null);
      setLoaded(true);
      if (first || fresh.length > 0) markRead();
    } catch { setLoaded(true); }
  }, [thread.id, merge, markRead]);

  // Back on the tab: tell the server I've now read what came in meanwhile.
  useEffect(() => {
    const onVis = () => { if (!document.hidden && readOwed.current) markRead(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [markRead]);

  /** Reactions change on older messages too, so they are refreshed for everything on screen. */
  const refreshReactions = useCallback(async () => {
    const oldest = msgsRef.current.find((m) => !m.pending && !m.failed);
    if (!oldest) return;
    const started = ++step.current;
    try {
      const map = await crm.get<Record<string, Reaction[]>>(`/api/v1/chat/threads/${thread.id}/reactions?from=${encodeURIComponent(oldest.createdAt)}`);
      // The server sends at most 2000 reactions; past that, a message missing from the answer may still have some.
      const capped = Object.values(map).reduce((n, list) => n + list.reduce((k, x) => k + x.count, 0), 0) >= 2000;
      setMsgs((cur) => cur.map((m) => {
        if (m.pending || m.failed) return m;
        // Mine in flight, or changed after this request left: what is shown is newer.
        if (reacting.current.has(m.id) || (reactedAt.current.get(m.id) ?? 0) >= started) return m;
        const next = map[m.id];
        return next ? { ...m, reactions: next } : capped ? m : { ...m, reactions: [] };
      }));
    } catch { /* keep what is shown */ }
  }, [thread.id]);

  useEffect(() => {
    void fetchNew(true);
    let tick = 0;
    const t = setInterval(() => {
      if (document.hidden) return;
      void fetchNew();
      if (++tick % 3 === 0) void refreshReactions();
    }, 5000);
    return () => clearInterval(t);
  }, [fetchNew, refreshReactions]);
  useEffect(() => { if (ping) { void fetchNew(); void refreshReactions(); } }, [ping, fetchNew, refreshReactions]);

  // ─── Scrolling: stay at the bottom while reading the latest, keep place when loading older, count what arrives below.
  const scrollToBottom = (smooth = false) => {
    const el = bodyRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    setNewBelow(0);
  };
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (restore.current != null) { el.scrollTop = el.scrollHeight - restore.current; restore.current = null; lastCount.current = msgs.length; return; }
    if (!loaded || msgs.length === 0) return;
    if (firstScroll.current) {
      firstScroll.current = false;
      lastCount.current = msgs.length;
      const mark = el.querySelector('.ch-unread-line');
      if (mark) (mark as HTMLElement).scrollIntoView({ block: 'start' }); else el.scrollTop = el.scrollHeight;
      return;
    }
    const added = msgs.length - lastCount.current;
    lastCount.current = msgs.length;
    if (added <= 0) return;
    const last = msgs[msgs.length - 1];
    if (atBottom || last.mine) el.scrollTop = el.scrollHeight;
    else setNewBelow((n) => n + msgs.slice(-added).filter((m) => !m.mine).length);
  }, [msgs, loaded, atBottom]);
  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    atBottomRef.current = near;
    setAtBottom(near);
    if (near) setNewBelow(0);
  };
  /** A photo finished loading and made the list taller: stay on the latest if that is where I was. */
  const onMediaLoad = useCallback(() => {
    const el = bodyRef.current;
    if (el && atBottomRef.current && restore.current == null) el.scrollTop = el.scrollHeight;
  }, []);

  /** Loads the page before the oldest message shown. Returns whether there is more, or null if it failed. */
  const older = useCallback(async (): Promise<boolean | null> => {
    if (olderBusy.current) return true;
    const first = msgsRef.current.find((m) => !m.pending && !m.failed);
    if (!first) return false;
    olderBusy.current = true;
    setLoadingOlder(true);
    try {
      const r = await crm.get<MsgRes>(`/api/v1/chat/threads/${thread.id}/messages?before=${encodeURIComponent(first.createdAt)}`);
      const el = bodyRef.current;
      if (el) restore.current = el.scrollHeight - el.scrollTop;
      setHasMore(r.hasMore);
      merge(r.messages);
      return r.hasMore;
    } catch (e) {
      showToast(`Couldn't load earlier messages. ${friendlyError(e)}`);
      return null;
    } finally {
      olderBusy.current = false;
      setLoadingOlder(false);
    }
  }, [thread.id, merge, showToast]);

  /** Scrolls to a message (loading older pages until it is there) and makes it glow for a moment. */
  const jumpTo = useCallback(async (id: string) => {
    for (let i = 0; i < 15 && !msgsRef.current.some((m) => m.id === id); i++) {
      const more = await older();
      if (more === null) return;
      await new Promise((r) => setTimeout(r, 60));
      if (!more && !msgsRef.current.some((m) => m.id === id)) break;
    }
    requestAnimationFrame(() => {
      const el = bodyRef.current?.querySelector(`[data-mid="${id}"]`);
      if (!el) { showToast('That message is too far back to show here.'); return; }
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setFlash(id);
      setTimeout(() => setFlash((f) => (f === id ? null : f)), 1800);
    });
  }, [older, showToast]);

  // ─── Sending ───
  const baseFields = () => ({ clientId: uid(), contactClientId: tag?.clientId, replyToId: reply?.id });
  const optimistic = (clientId: string, extra: Partial<ChatMsg>): ChatMsg => ({
    id: clientId, clientId, threadId: thread.id, senderId: 'me', senderName: 'You', fromOffice: true, mine: true,
    contact: tag ? { id: tag.clientId, name: tag.name } : null,
    replyTo: reply ? { id: reply.id, senderName: reply.senderName, text: reply.text, fileName: reply.file?.name } : null,
    createdAt: new Date().toISOString(), pending: true, ...extra,
  });
  const resetCompose = () => {
    setText(''); setReply(null); setTag(null); setEmojiFor(null); setQuickOpen(false);
    if (inputRef.current) inputRef.current.style.height = '';
  };

  const postText = async (body: string, f: ReturnType<typeof baseFields>, spot = true) => {
    try {
      const m = await crm.post<ChatMsg>(`/api/v1/chat/threads/${thread.id}/messages`, { ...f, text: body });
      merge([m]); onSent();
      // Smart chat: an office message that asks the agent to do something can become a task with one tap.
      if (spot && ai.status.tasks && canTask && thread.kind === 'agent' && taskAgent && body.length >= 8) {
        taskIdea(thread.id, m.id).then((r) => { if (r.isTask) setIdea(r); }).catch(() => undefined);
      }
    } catch (e) {
      setMsgs((cur) => cur.map((m) => (m.clientId === f.clientId ? { ...m, pending: false, failed: true } : m)));
      showToast(friendlyError(e));
    }
  };

  const uploadFile = async (file: File, caption: string, f: ReturnType<typeof baseFields>) => {
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

  const send = async () => {
    const body = text.trim();
    if (staged.length > 0) {
      const files = staged;
      setStaged([]);
      // The bubbles don't use the previews, so they can go now.
      for (const s of files) if (s.preview) URL.revokeObjectURL(s.preview);
      // The caption goes with the first file; reply and partner tag with every one.
      const jobs = files.map((s, i) => {
        const f = baseFields();
        const caption = i === 0 ? body : '';
        merge([optimistic(f.clientId, { text: caption || null, localFile: s.file, file: { name: s.file.name, mime: s.file.type || 'application/octet-stream', size: s.file.size, url: '' } })], false);
        return { s, f, caption };
      });
      resetCompose();
      scrollToBottom();
      for (const j of jobs) await uploadFile(j.s.file, j.caption, j.f);
      return;
    }
    if (!body) return;
    const f = baseFields();
    merge([optimistic(f.clientId, { text: body })], false);
    resetCompose();
    scrollToBottom();
    await postText(body, f);
  };

  /** Sends a failed message again with the same clientId, so the server never stores it twice. */
  const retry = async (m: ChatMsg) => {
    const f = { clientId: m.clientId, contactClientId: m.contact?.id, replyToId: m.replyTo?.id };
    if (m.file) {
      if (!m.localFile) { showToast('Attach the file again to resend it.'); return; }
      setMsgs((cur) => cur.map((x) => (x.clientId === m.clientId ? { ...x, failed: false, pending: true } : x)));
      await uploadFile(m.localFile, m.text ?? '', f);
      return;
    }
    if (!m.text) return;
    setMsgs((cur) => cur.map((x) => (x.clientId === m.clientId ? { ...x, failed: false, pending: true } : x)));
    await postText(m.text, f);
  };
  /** Removes a message that was never sent. */
  const dismiss = (m: ChatMsg) => setMsgs((cur) => cur.filter((x) => !(x.clientId === m.clientId && x.failed)));

  const stage = (files: File[]) => {
    const room = MAX_STAGED - staged.length;
    const ok: Staged[] = [];
    for (const f of files.slice(0, Math.max(0, room))) {
      if (!ALLOWED_EXT.includes(extOf(f.name))) { showToast(`${f.name || 'That file'} can't be sent. Send photos (JPG, PNG, WebP, GIF, HEIC), PDF, Word, Excel, PowerPoint, CSV or text files.`); continue; }
      if (f.size > MAX_BYTES) { showToast(`${f.name} is over 15 MB.`); continue; }
      ok.push({ id: uid(), file: f, preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : null });
    }
    if (files.length > room) showToast(`Up to ${MAX_STAGED} files at a time.`);
    if (ok.length) { setStaged((s) => [...s, ...ok]); inputRef.current?.focus(); }
  };
  const unstage = (id: string) => setStaged((s) => {
    const x = s.find((y) => y.id === id);
    if (x?.preview) URL.revokeObjectURL(x.preview);
    return s.filter((y) => y.id !== id);
  });

  // ─── Reactions, pins, copy ───
  const react = async (m: ChatMsg, emoji: string) => {
    setEmojiFor(null); setActive(null);
    // Show it at once; the server's answer replaces it.
    setMsgs((cur) => cur.map((x) => {
      if (x.id !== m.id) return x;
      const list = [...(x.reactions ?? [])];
      const i = list.findIndex((r) => r.emoji === emoji);
      if (i >= 0 && list[i].mine) {
        const r = { ...list[i], count: list[i].count - 1, mine: false, names: list[i].names.filter((n) => n !== 'You') };
        if (r.count <= 0) list.splice(i, 1); else list[i] = r;
      } else if (i >= 0) list[i] = { ...list[i], count: list[i].count + 1, mine: true, names: [...list[i].names, 'You'] };
      else list.push({ emoji, count: 1, mine: true, names: ['You'] });
      return { ...x, reactions: list };
    }));
    // While this is in flight, polling and refreshes leave this message's reactions alone.
    reacting.current.set(m.id, (reacting.current.get(m.id) ?? 0) + 1);
    reactedAt.current.set(m.id, ++step.current);
    let failed = false;
    try {
      const r = await crm.post<{ messageId: string; reactions: Reaction[] }>(`/api/v1/chat/threads/${thread.id}/messages/${m.id}/react`, { emoji });
      // Another tap on this message is still on its way: its answer is the one to show.
      if ((reacting.current.get(m.id) ?? 0) <= 1) setMsgs((cur) => cur.map((x) => (x.id === r.messageId ? { ...x, reactions: r.reactions } : x)));
    } catch (e) { failed = true; showToast(friendlyError(e)); }
    finally {
      const n = (reacting.current.get(m.id) ?? 1) - 1;
      if (n > 0) reacting.current.set(m.id, n); else reacting.current.delete(m.id);
      reactedAt.current.set(m.id, ++step.current);
    }
    if (failed) { reactedAt.current.delete(m.id); void refreshReactions(); }
  };
  const pin = async (m: ChatMsg | null) => {
    setActive(null);
    try {
      const r = await crm.put<{ pinned: Pinned | null }>(`/api/v1/chat/threads/${thread.id}/pin`, { messageId: m?.id ?? null });
      setPinned(r.pinned);
      showToast(m ? 'Pinned for everyone in this chat.' : 'Unpinned.');
    } catch (e) { showToast(friendlyError(e)); }
  };
  const copy = async (m: ChatMsg) => {
    setActive(null);
    try { await navigator.clipboard.writeText(m.text ?? m.file?.name ?? ''); showToast('Copied.'); } catch { showToast('Copying is blocked in this browser.'); }
  };

  // ─── Calls ───
  const [calling, setCalling] = useState(false);
  const call = async (video: boolean) => {
    if (calling) return;
    setCalling(true);
    try { await startCall(thread.id, video, thread.title); }
    catch (e) { showToast(callError(e, "Couldn't start the call.")); }
    finally { setCalling(false); }
  };
  const joinLive = async () => {
    if (!liveCall || calling) return;
    setCalling(true);
    try { await joinCall(liveCall, thread.title); }
    catch (e) { showToast(callError(e, 'This call is no longer available.')); }
    finally { setCalling(false); }
  };
  const huddleOn = !!liveCall && liveCall.kind === 'huddle';

  const insertEmoji = (e: string) => {
    const el = inputRef.current;
    if (!el) { setText((t) => t + e); return; }
    const a = el.selectionStart ?? text.length, b = el.selectionEnd ?? text.length;
    const next = text.slice(0, a) + e + text.slice(b);
    setText(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + e.length, a + e.length); });
  };

  // Quick replies: the ⚡ button, or "/" at the start of the message to filter them.
  const slash = text.startsWith('/') ? text.slice(1).toLowerCase() : null;
  const quickShown = quickOpen || slash !== null;
  const quickList = slash ? quick.filter((q) => q.toLowerCase().includes(slash)) : quick;
  const pickFirstQuick = () => { if (quickList[0]) pickQuick(quickList[0]); };
  const pickQuick = (q: string) => {
    setText(q); setQuickOpen(false);
    requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(q.length, q.length); grow(el); } });
  };
  const saveCurrentAsQuick = () => {
    const t = text.trim();
    if (!t || t.startsWith('/')) { showToast('Type the message first, then save it.'); return; }
    if (quick.includes(t)) { showToast('Already saved.'); return; }
    const next = [t, ...quick].slice(0, 30);
    setQuick(next); saveQuick(next); showToast('Saved as a quick reply.');
  };
  const removeQuick = (q: string) => { const next = quick.filter((x) => x !== q); setQuick(next); saveQuick(next); };
  const grow = (el: HTMLTextAreaElement) => { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; };

  // ─── Smart chat ───
  // Messages written in Hindi or Bangla script get an English version under them.
  useEffect(() => {
    if (!ai.status.translate) return;
    const want = msgs.filter((m) => !m.mine && !m.pending && !m.failed && needsEnglish(m.text) && !trAsked.current.has(m.id)).slice(-40).map((m) => m.id);
    if (!want.length) return;
    const t = setTimeout(() => {
      for (const id of want) trAsked.current.add(id);
      translateMessages(thread.id, want)
        .then((r) => setTr((cur) => { const next = { ...cur }; for (const it of r.items) next[it.id] = it.text; return next; }))
        .catch(() => undefined); // not retried: the original text is still there
    }, 400);
    return () => clearTimeout(t);
  }, [msgs, ai.status.translate, thread.id]);

  // Suggested replies when the last word in the chat is someone else's (in a field agent's chat the office answers as one).
  const lastReal = useMemo(() => [...msgs].reverse().find((m) => !m.call && !m.pending && !m.failed) ?? null, [msgs]);
  const theirs = !!lastReal && !lastReal.mine && !(office && thread.kind === 'agent' && lastReal.fromOffice);
  useEffect(() => {
    if (!ai.status.replies || !theirs || !lastReal || suggAsked.current === lastReal.id) return;
    const id = lastReal.id;
    const t = setTimeout(() => {
      suggAsked.current = id;
      suggestReplies(thread.id).then((r) => setSugg({ id: r.forMessage ?? id, list: r.replies ?? [] })).catch(() => undefined);
    }, 700);
    return () => clearTimeout(t);
  }, [ai.status.replies, theirs, lastReal, thread.id]);
  const showSugg = ai.status.replies && theirs && !!sugg && sugg.id === lastReal?.id && sugg.list.length > 0 && !text && !quickShown && staged.length === 0;

  const catchUp = async (since?: string) => {
    setSummary({ busy: true, since });
    try { setSummary({ busy: false, data: await summarise(thread.id, since), since }); }
    catch (e) { setSummary({ busy: false, error: friendlyError(e), since }); }
  };
  const firstUnreadAt = unreadFrom ? msgs.find((m) => m.id === unreadFrom.id)?.createdAt : undefined;

  // ─── Rows: day lines, the "new messages" line, and messages grouped when the same person writes again within 5 minutes.
  const rows: Row[] = [];
  let lastDay = '';
  let prev: ChatMsg | null = null;
  for (const m of msgs) {
    const d = istDay(m.createdAt);
    if (d !== lastDay) { rows.push({ kind: 'day', at: m.createdAt }); lastDay = d; prev = null; }
    if (unreadFrom && unreadFrom.id === m.id) { rows.push({ kind: 'unread', n: unreadFrom.n }); prev = null; }
    const cont = !!prev && prev.senderId === m.senderId && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60e3;
    rows.push({ kind: 'msg', m, cont });
    prev = m;
  }
  const images = msgs.filter(isImage);

  return (
    <div className={`ch-conv${infoOpen ? ' has-info' : ''}`}
      onDragEnter={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); dragDepth.current++; setDragging(true); } }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
      onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); dragDepth.current = 0; setDragging(false); stage([...e.dataTransfer.files]); }}>
      <div className="ch-main">
        <header className="ch-head">
          <button type="button" className="ch-icon ch-back" onClick={onBack} aria-label="Back to conversations"><ArrowLeft size={18} /></button>
          <ThreadAvatar t={{ ...thread, live }} />
          <button type="button" className="ch-head-who" onClick={() => setInfoOpen((o) => !o)} aria-label="Chat details">
            <strong>{thread.title}</strong>
            <span className="crm-cell-sub">
              {live?.online && thread.kind !== 'team' && <span className="ch-online-word">●</span>}
              {presence ?? (thread.kind === 'team' ? 'Everyone in the field team and the office' : thread.kind === 'direct' ? [thread.sub, 'one-to-one'].filter(Boolean).join(' · ') : [thread.agentId, thread.sub].filter(Boolean).join(' · '))}
            </span>
          </button>
          {callsOn && (thread.kind === 'team' ? (
            <button type="button" className="ch-huddle-btn" disabled={calling || inCall} onClick={() => void (huddleOn ? joinLive() : call(true))}
              aria-label={inCall ? 'You are in the huddle' : huddleOn ? 'Join the huddle' : 'Start a video huddle with the field team'}>
              <Video size={16} aria-hidden /> <span>{inCall ? 'In huddle' : huddleOn ? 'Join huddle' : 'Start huddle'}</span>
            </button>
          ) : (
            <>
              <button type="button" className="ch-icon" disabled={calling || inCall} onClick={() => void call(false)} aria-label={`Voice call ${thread.title}`} title="Voice call"><Phone size={18} /></button>
              <button type="button" className="ch-icon" disabled={calling || inCall} onClick={() => void call(true)} aria-label={`Video call ${thread.title}`} title="Video call"><Video size={19} /></button>
            </>
          ))}
          {ai.status.summary && <button type="button" className="ch-icon ch-ai-icon" aria-label="Catch up: sum up this chat" title="Catch up: sum up this chat" aria-pressed={!!summary} onClick={() => (summary ? setSummary(null) : void catchUp())}><Sparkles size={18} /></button>}
          <button type="button" className="ch-icon" aria-label="Search this chat" aria-pressed={searchOpen} onClick={() => setSearchOpen((o) => !o)}><Search size={18} /></button>
          <button type="button" className="ch-icon" aria-label="Chat details and shared files" aria-pressed={infoOpen} onClick={() => setInfoOpen((o) => !o)}><Info size={18} /></button>
        </header>

        {summary && <SummaryPanel s={summary} onClose={() => setSummary(null)} onRetry={() => void catchUp(summary.since)} />}

        {searchOpen && <ThreadSearch threadId={thread.id} onClose={() => setSearchOpen(false)} onPick={(id) => void jumpTo(id)} />}

        {callsOn && liveCall && <CallBanner c={liveCall} inCall={inCall} busy={calling} onJoin={() => void joinLive()} />}

        {pinned && (
          <div className="ch-pinned">
            <Pin size={14} aria-hidden />
            <button type="button" className="ch-pinned-text" onClick={() => void jumpTo(pinned.message.id)}>
              <strong>Pinned by {pinned.pinnedBy}</strong>
              <span>{pinned.message.text ?? (pinned.message.file ? `📎 ${pinned.message.file.name}` : pinned.message.contact?.name ?? 'Message')}</span>
            </button>
            {canPin && <button type="button" className="ch-icon is-sm" onClick={() => void pin(null)} aria-label="Unpin"><PinOff size={15} /></button>}
          </div>
        )}

        {/* New messages are announced once, below; the list itself stays quiet so loading older pages isn't read out. */}
        <div className="crm-sr" role="status" aria-live="polite">{announce}</div>
        <div className="ch-body" role="log" aria-live="off" aria-label={`Messages with ${thread.title}`} aria-busy={loadingOlder || !loaded} ref={bodyRef} onScroll={onScroll}>
          <div className="ch-secure"><Lock size={12} aria-hidden /> {thread.kind === 'direct' ? `Only you and ${thread.title} can read this chat. Admins can't see it.` : 'Only the people in this chat can see these messages and files.'}</div>
          {hasMore && <button type="button" className="ch-older" disabled={loadingOlder} onClick={() => void older()}>{loadingOlder ? 'Loading…' : 'Load earlier messages'}</button>}
          {!loaded ? <Skeleton h={200} /> : msgs.length === 0 ? (
            <div className="ch-none">
              No messages yet. Say namaste 👋
              <span className="ch-starters">
                {quick.slice(0, 3).map((q) => <button key={q} type="button" onClick={() => pickQuick(q)}>{q}</button>)}
              </span>
            </div>
          ) : null}
          {rows.map((r, i) => r.kind === 'day' ? <div key={`d${i}`} className="ch-day"><span>{dayLabel(r.at)}</span></div>
            : r.kind === 'unread' ? <div key="unread" className="ch-unread-line"><span>{r.n} new {r.n === 1 ? 'message' : 'messages'}
              {ai.status.summary && r.n >= 4 && firstUnreadAt && <button type="button" className="ch-unread-sum" onClick={() => void catchUp(new Date(new Date(firstUnreadAt).getTime() - 1).toISOString())}><Sparkles size={12} aria-hidden /> Sum up</button>}</span></div>
              : r.m.call ? <CallPill key={r.m.clientId} m={r.m} note={r.m.call} canCall={callsOn && !inCall && !calling}
                onCallBack={() => void call(thread.kind === 'team' ? true : r.m.call!.video)} team={thread.kind === 'team'} />
              : (
                <Bubble key={r.m.clientId} m={r.m} cont={r.cont} showName={!r.m.mine && thread.kind !== 'direct' && (thread.kind === 'team' || r.m.fromOffice)}
                  readAt={readAt} seenAt={seenAt} flash={flash === r.m.id} active={active === r.m.id} pinned={pinned?.message.id === r.m.id}
                  canPin={canPin} canTask={canTask && !!taskAgent} translation={tr[r.m.id]}
                  onToggle={() => setActive((a) => (a === r.m.id ? null : r.m.id))}
                  onReply={() => { setReply(r.m); setActive(null); inputRef.current?.focus(); }}
                  onReact={(e) => void react(r.m, e)} onMoreReactions={() => { setEmojiFor(r.m.id); setEmojiGroup(0); }}
                  onCopy={() => void copy(r.m)} onPin={() => void pin(pinned?.message.id === r.m.id ? null : r.m)}
                  onTask={() => { setTaskFor(r.m); setActive(null); }}
                  onQuote={() => r.m.replyTo && void jumpTo(r.m.replyTo.id)}
                  onImage={() => setViewer({ items: images, index: Math.max(0, images.findIndex((x) => x.id === r.m.id)) })}
                  onRetry={() => void retry(r.m)} onDismiss={() => dismiss(r.m)} onMediaLoad={onMediaLoad} onToast={showToast} />
              ))}
        </div>

        {!atBottom && (
          <button type="button" className="ch-down" onClick={() => scrollToBottom(true)} aria-label={newBelow ? `${newBelow} new messages, go to the latest` : 'Go to the latest message'}>
            <ArrowDown size={18} aria-hidden />{newBelow > 0 && <span>{newBelow}</span>}
          </button>
        )}

        {emojiFor && (
          <div className="ch-emoji" role="dialog" aria-label={emojiFor === 'compose' ? 'Emoji' : 'React with an emoji'}>
            <div className="ch-emoji-tabs" role="group" aria-label="Emoji groups">
              {EMOJI.map((g, i) => <button key={g.group} type="button" aria-pressed={i === emojiGroup} aria-label={g.group} title={g.group} onClick={() => setEmojiGroup(i)}>{g.icon}</button>)}
              {emojiFor !== 'compose' && <span className="ch-emoji-note">Reacting to a message</span>}
              <button type="button" className="ch-icon is-sm" style={{ marginLeft: 'auto' }} onClick={() => setEmojiFor(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="ch-emoji-grid">
              {EMOJI[emojiGroup].list.map((e) => (
                <button key={e} type="button" aria-label={e} onClick={() => {
                  if (emojiFor === 'compose') insertEmoji(e);
                  else { const m = msgs.find((x) => x.id === emojiFor); if (m) void react(m, e); }
                }}>{e}</button>
              ))}
            </div>
          </div>
        )}

        {quickShown && (
          <div className="ch-quick" role="region" aria-label="Quick replies">
            <div className="ch-quick-head">
              <strong><Zap size={14} aria-hidden /> Quick replies</strong>
              <span className="crm-sub">{slash !== null ? 'Enter picks the first · Esc closes' : 'Saved in this browser'}</span>
              <button type="button" className="ch-icon is-sm" onClick={() => { setQuickOpen(false); if (slash !== null) setText(''); }} aria-label="Close quick replies"><X size={16} /></button>
            </div>
            <ul aria-label={slash !== null ? `${quickList.length} matching quick replies` : 'Saved quick replies'}>
              {quickList.map((q) => (
                <li key={q}>
                  <button type="button" onClick={() => pickQuick(q)}>{q}</button>
                  <button type="button" className="ch-icon is-sm" onClick={() => removeQuick(q)} aria-label={`Delete quick reply: ${q}`}><Trash2 size={14} /></button>
                </li>
              ))}
              {quickList.length === 0 && <li className="crm-sub" style={{ padding: '6px 10px' }}>No quick reply matches.</li>}
            </ul>
            {slash === null && <button type="button" className="ch-quick-save" onClick={saveCurrentAsQuick}><Plus size={14} aria-hidden /> Save what I&apos;ve typed as a quick reply</button>}
          </div>
        )}

        {idea && (
          <div className="ch-ai-idea" role="status">
            <Sparkles size={16} aria-hidden />
            <span>Make this a task for {thread.title.split(' ')[0]}? <strong>{idea.title}</strong>{idea.dueDate ? ` · due ${dueText(idea.dueDate)}` : ''}</span>
            <button type="button" className="crm-btn is-sm" onClick={() => { setIdeaFor(idea); setTaskFor(msgs.find((m) => m.id === idea.messageId) ?? null); setIdea(null); }}>Make it a task</button>
            <button type="button" className="ch-icon is-sm" onClick={() => setIdea(null)} aria-label="No, it's not a task"><X size={16} /></button>
          </div>
        )}

        {showSugg && (
          <div className="ch-sugg" role="group" aria-label="Suggested replies">
            <span className="ch-sugg-label"><Sparkles size={13} aria-hidden /> Suggested</span>
            {sugg!.list.map((q) => <button key={q} type="button" onClick={() => pickQuick(q)} title="Put in the message box to edit or send">{q}</button>)}
            <button type="button" className="ch-icon is-sm" onClick={() => setSugg(null)} aria-label="Hide suggestions"><X size={14} /></button>
          </div>
        )}

        <footer className="ch-compose">
          {(reply || tag || staged.length > 0) && (
            <div className="ch-attach-row">
              {reply && (
                <span className="ch-reply-chip"><CornerUpLeft size={14} aria-hidden /> Replying to {reply.senderName}: {reply.text?.slice(0, 60) ?? reply.file?.name}
                  <button type="button" onClick={() => setReply(null)} aria-label="Cancel reply"><X size={14} /></button></span>
              )}
              {tag && (
                <span className="ch-tag-chip"><Tag size={14} aria-hidden /> {tag.name}
                  <button type="button" onClick={() => setTag(null)} aria-label="Remove partner tag"><X size={14} /></button></span>
              )}
              {staged.length > 0 && (
                <div className="ch-staged" aria-label={`${staged.length} files ready to send`}>
                  {staged.map((s) => (
                    <span key={s.id} className="ch-staged-item" title={`${s.file.name} · ${size(s.file.size)}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {s.preview ? <img src={s.preview} alt="" /> : <span className="ch-staged-doc"><FileText size={20} aria-hidden /><span>{s.file.name.split('.').pop()?.toUpperCase()}</span></span>}
                      <button type="button" onClick={() => unstage(s.id)} aria-label={`Remove ${s.file.name}`}><X size={12} /></button>
                    </span>
                  ))}
                  {staged.length < MAX_STAGED && <button type="button" className="ch-staged-add" onClick={() => fileRef.current?.click()} aria-label="Add more files"><Plus size={18} /></button>}
                </div>
              )}
            </div>
          )}
          <div className="ch-compose-row">
            <button type="button" className="ch-icon ch-emoji-btn" aria-label="Emoji" aria-pressed={emojiFor === 'compose'} onClick={() => setEmojiFor((o) => (o === 'compose' ? null : 'compose'))}><Smile size={20} /></button>
            <button type="button" className="ch-icon" aria-label="Attach photos or documents" onClick={() => fileRef.current?.click()}><Paperclip size={20} /></button>
            <button type="button" className="ch-icon" aria-label="Tag a partner" aria-pressed={!!tag} onClick={() => setTagOpen(true)}><Tag size={20} /></button>
            <button type="button" className="ch-icon" aria-label="Quick replies" aria-pressed={quickShown} onClick={() => setQuickOpen((o) => !o)}><Zap size={20} /></button>
            <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; stage(f); }} />
            <label className="crm-sr" htmlFor="ch-input">Message</label>
            <textarea id="ch-input" ref={inputRef} rows={1} value={text} maxLength={4000}
              placeholder={staged.length ? 'Add a caption (optional)' : 'Message · / for quick replies'}
              onChange={(e) => { setText(e.target.value); grow(e.target); }}
              onPaste={(e) => { const files = [...e.clipboardData.files]; if (files.length) { e.preventDefault(); stage(files); } }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setQuickOpen(false); setEmojiFor(null); if (slash !== null) setText(''); return; }
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  if (slash !== null) { e.preventDefault(); pickFirstQuick(); return; }
                  // On a phone or tablet Enter is a new line; the send button sends.
                  if (isTouch()) return;
                  e.preventDefault();
                  void send();
                }
                if (e.key === 'ArrowUp' && !text && reply == null) {
                  const lastTheirs = [...msgs].reverse().find((m) => !m.mine && !m.pending);
                  if (lastTheirs) { e.preventDefault(); setReply(lastTheirs); }
                }
              }} />
            {text.length > 3500 && <span className="ch-count">{4000 - text.length}</span>}
            <button type="button" className="ch-send" aria-label={staged.length ? `Send ${staged.length} ${staged.length === 1 ? 'file' : 'files'}` : 'Send'}
              disabled={!text.trim() && staged.length === 0 || slash !== null} onClick={() => void send()}><Send size={18} /></button>
          </div>
        </footer>

        {dragging && <div className="ch-drop" aria-hidden><Upload size={30} /><strong>Drop to attach</strong><span>Photos and documents, up to 15 MB each</span></div>}
      </div>

      {infoOpen && (
        <InfoPanel thread={thread} presence={presence} onClose={() => setInfoOpen(false)} onJump={(id) => void jumpTo(id)}
          onImage={(items, index) => setViewer({ items, index })} onToast={showToast} canTask={canTask && !!taskAgent} onTask={() => setTaskFor({ id: '', clientId: '', threadId: thread.id, senderId: '', senderName: '', fromOffice: true, mine: true, createdAt: new Date().toISOString() })} />
      )}

      {tagOpen && <TagPicker agentId={thread.kind === 'agent' ? thread.agentId ?? undefined : undefined} onClose={() => setTagOpen(false)} onPick={(p) => { setTag(p); setTagOpen(false); inputRef.current?.focus(); }} />}
      {viewer && <Lightbox items={viewer.items} start={viewer.index} onClose={() => setViewer(null)} onToast={showToast} />}
      {(taskFor || ideaFor) && taskAgent && (
        <TaskFromChat agentId={taskAgent} agentName={thread.title} msg={taskFor?.id ? taskFor : null} idea={ideaFor} onClose={() => { setTaskFor(null); setIdeaFor(null); }}
          onDone={async (title, due, tell) => {
            setTaskFor(null); setIdeaFor(null);
            showToast(`Task sent to ${thread.title}.`);
            if (tell) {
              const f = { clientId: uid(), contactClientId: undefined, replyToId: taskFor?.id || undefined };
              const body = `📋 New task for you: ${title}${due ? ` (by ${shortDate.format(new Date(`${due}T12:00:00+05:30`))})` : ''}. It is in your Tasks in the app.`;
              merge([optimistic(f.clientId, { text: body, replyTo: null })], false);
              await postText(body, f, false);
            }
          }} />
      )}
      {toast}
    </div>
  );
}

// ─── Calls in the conversation ───────────────────────────────────────────

/** "Huddle going on · 3 people · Join" above the messages while a call is going on in this chat. */
function CallBanner({ c, inCall, busy, onJoin }: { c: Call; inCall: boolean; busy: boolean; onJoin: () => void }) {
  const n = inCallCount(c);
  const people = `${n} ${n === 1 ? 'person' : 'people'}`;
  let text: string; let action: string | null = null;
  if (c.kind === 'huddle') { text = inCall ? `You're in the huddle · ${people}` : `Huddle going on · ${people}`; action = inCall ? null : 'Join'; }
  else if (inCall) text = c.status === 'ringing' ? `Calling… · ${c.video ? 'video' : 'voice'} call` : `You're in a ${c.video ? 'video' : 'voice'} call`;
  else if (c.status === 'ringing' && !c.mine) { text = `${c.startedByName} is calling${c.threadKind === 'agent' ? ' the office' : ''}`; action = 'Answer'; }
  else text = `${c.video ? 'Video' : 'Voice'} call going on · ${people}`;
  return (
    <div className={`ch-call-banner${c.status === 'ringing' ? ' is-ringing' : ''}`} role="status">
      {c.status === 'ringing' && !c.mine ? <PhoneIncoming size={16} aria-hidden /> : c.video ? <Video size={16} aria-hidden /> : <Phone size={16} aria-hidden />}
      <span>{text}</span>
      {c.kind === 'huddle' && c.people.some((p) => p.inCall) && (
        <span className="ch-call-faces" aria-hidden>{c.people.filter((p) => p.inCall).slice(0, 4).map((p) => <span key={p.userId} title={p.name}>{initials(p.name)}</span>)}</span>
      )}
      {action && <button type="button" className="crm-btn is-sm is-ok" disabled={busy} onClick={onJoin}>{action}</button>}
    </div>
  );
}

/** A finished call, as a centered pill: "Missed video call", "Voice call · 3 min", "Huddle · 12 min", "Call declined". */
function CallPill({ m, note, canCall, team, onCallBack }: { m: ChatMsg; note: CallNote; canCall: boolean; team: boolean; onCallBack: () => void }) {
  const missed = note.status === 'missed' || note.status === 'declined';
  const label = callNoteText(note, m.mine);
  return (
    <div data-mid={m.id} className={`ch-call-pill${missed && !m.mine ? ' is-missed' : ''}`}>
      <span className="ch-call-pill-body">
        {missed && !m.mine ? <PhoneMissed size={14} aria-hidden /> : note.video || note.kind === 'huddle' ? <Video size={14} aria-hidden /> : <Phone size={14} aria-hidden />}
        <strong>{label}</strong>
        <span className="ch-call-pill-time">{note.kind !== 'huddle' && !m.mine && m.senderName ? `${m.senderName} · ` : ''}{timeFmt.format(new Date(m.createdAt))}</span>
      </span>
      {canCall && <button type="button" className="ch-call-back" onClick={onCallBack}>{team ? 'Start huddle' : 'Call back'}</button>}
    </div>
  );
}

// ─── One message ─────────────────────────────────────────────────────────

function Bubble({ m, cont, showName, readAt, seenAt, flash, active, pinned, canPin, canTask, translation, onToggle, onReply, onReact, onMoreReactions, onCopy, onPin, onTask, onQuote, onImage, onRetry, onDismiss, onMediaLoad, onToast }: {
  m: ChatMsg; cont: boolean; showName: boolean; readAt: string | null; seenAt: string | null; flash: boolean; active: boolean; pinned: boolean;
  canPin: boolean; canTask: boolean; translation?: string;
  onToggle: () => void; onReply: () => void; onReact: (e: string) => void; onMoreReactions: () => void; onCopy: () => void; onPin: () => void; onTask: () => void;
  onQuote: () => void; onImage: () => void; onRetry: () => void; onDismiss: () => void; onMediaLoad: () => void; onToast: (t: string) => void;
}) {
  const read = m.mine && readAt && isoKey(readAt) >= isoKey(m.createdAt);
  const seen = m.mine && seenAt && isoKey(seenAt) >= isoKey(m.createdAt);
  const reactions = m.reactions ?? [];
  // Tools sit above the message, or below it when it is at the top of the visible area.
  const [below, setBelow] = useState(false);
  const place = (el: HTMLElement) => {
    const body = el.closest('.ch-body');
    if (body) setBelow(el.getBoundingClientRect().top - body.getBoundingClientRect().top < 56);
  };
  return (
    <div data-mid={m.id} onMouseEnter={(e) => place(e.currentTarget)} onFocus={(e) => place(e.currentTarget)}
      className={`ch-msg${m.mine ? ' is-mine' : ''}${m.failed ? ' is-failed' : ''}${cont ? ' is-cont' : ''}${flash ? ' is-flash' : ''}${active ? ' is-active' : ''}${below ? ' tools-below' : ''}`}>
      <div className="ch-bubble-wrap">
        {/* A tap on a touch screen opens the tools; on a computer they show on hover. */}
        <div className="ch-bubble" onClick={(e) => { if ((e.target as HTMLElement).closest('a,button')) return; place(e.currentTarget.closest('.ch-msg') as HTMLElement); onToggle(); }}>
          {pinned && <span className="ch-pin-mark"><Pin size={11} aria-hidden /> Pinned</span>}
          {showName && !cont && <span className="ch-sender">{m.senderName}{m.fromOffice ? ' · Office' : ''}</span>}
          {m.replyTo && (
            <button type="button" className="ch-quote" onClick={onQuote} title="Go to the original message">
              <strong>{m.replyTo.senderName}</strong>{m.replyTo.text ?? (m.replyTo.fileName ? `📎 ${m.replyTo.fileName}` : '')}
            </button>
          )}
          {m.file && <FileView m={m} onImage={onImage} onLoad={onMediaLoad} onToast={onToast} />}
          {m.lat != null && m.lng != null && (
            <a className="ch-place" href={mapsUrl(m.lat, m.lng)} target="_blank" rel="noopener noreferrer">
              <MapPin size={18} aria-hidden />
              <span><strong>Location shared</strong><span>{m.lat.toFixed(5)}, {m.lng.toFixed(5)} · open in Maps</span></span>
            </a>
          )}
          {m.text && <span className="ch-text"><Linkify text={m.text} /></span>}
          {translation && <span className="ch-tr" title="Translated by smart chat"><Languages size={12} aria-label="English translation" /> {translation}</span>}
          {m.contact && (
            <Link className="ch-tag" href={`/admin/partners?id=${encodeURIComponent(m.contact.id)}`}><Tag size={12} aria-hidden /> {m.contact.name}</Link>
          )}
          <span className="ch-meta">
            {timeFmt.format(new Date(m.createdAt))}
            {m.mine && (m.failed ? <>
                <button type="button" className="ch-fail" onClick={onRetry}>Not sent · retry</button>
                <button type="button" className="ch-fail" onClick={onDismiss} aria-label="Remove this unsent message">Remove</button>
              </>
              : m.pending ? <Check size={14} aria-label="Sending" style={{ opacity: 0.5 }} />
                : read ? <CheckCheck size={15} aria-label="Read" className="is-read" />
                  : seen ? <CheckCheck size={15} aria-label="Delivered" /> : <Check size={14} aria-label="Sent" />)}
          </span>
        </div>
        {reactions.length > 0 && (
          <div className="ch-reactions">
            {reactions.map((r) => (
              <button key={r.emoji} type="button" className={r.mine ? 'is-mine' : undefined} onClick={() => onReact(r.emoji)}
                title={r.names.join(', ')} aria-label={`${r.emoji} ${r.count}: ${r.names.join(', ')}${r.mine ? '. Tap to remove yours' : ''}`}>
                {r.emoji}{r.count > 1 && <span>{r.count}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {!m.pending && !m.failed && (
        <div className="ch-tools" role="toolbar" aria-label="Message actions">
          {QUICK_REACTIONS.map((e) => <button key={e} type="button" className="ch-tool-emoji" onClick={() => onReact(e)} aria-label={`React ${e}`}>{e}</button>)}
          <button type="button" onClick={onMoreReactions} aria-label="More reactions" title="More reactions"><SmilePlus size={15} /></button>
          <span className="ch-tools-sep" aria-hidden />
          <button type="button" onClick={onReply} aria-label="Reply" title="Reply"><CornerUpLeft size={15} /></button>
          {m.text && <button type="button" onClick={onCopy} aria-label="Copy text" title="Copy text"><Copy size={15} /></button>}
          {canPin && <button type="button" onClick={onPin} aria-label={pinned ? 'Unpin' : 'Pin for everyone'} title={pinned ? 'Unpin' : 'Pin for everyone'}>{pinned ? <PinOff size={15} /> : <Pin size={15} />}</button>}
          {canTask && <button type="button" onClick={onTask} aria-label="Make this a task" title="Make this a task"><ClipboardList size={15} /></button>}
        </div>
      )}
    </div>
  );
}

/** Private files load through the API with the session, never from a public link. */
function useBlobUrl(url?: string | null): { src: string | null; failed: boolean } {
  const [state, setState] = useState<{ url: string; src: string | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (!url) return;
    let made: string | null = null, alive = true;
    crm.blob(url)
      .then((b) => { made = URL.createObjectURL(b); if (alive) setState({ url, src: made, failed: false }); else URL.revokeObjectURL(made); })
      .catch(() => { if (alive) setState({ url, src: null, failed: true }); });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [url]);
  // Only what was loaded for this url: never the previous photo while the next one loads.
  const cur = url && state?.url === url ? state : null;
  return { src: cur?.src ?? null, failed: !!cur?.failed };
}

/**
 * Opens (PDF, photo) or downloads a private file. The new tab is opened straight away, inside the tap,
 * so browsers don't block it as a pop-up; it is pointed at the file once that has loaded.
 */
async function openFile(f: NonNullable<ChatMsg['file']>, download: boolean) {
  if (!f.url) return;
  const win = download ? null : window.open('', '_blank');
  if (win) { try { win.opener = null; win.document.title = f.name; } catch { /* another origin */ } }
  try {
    const b = await crm.blob(`${f.url}${download ? '?download=true' : ''}`);
    const url = URL.createObjectURL(b);
    if (download || !win) {
      const a = document.createElement('a'); a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
    } else win.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    win?.close();
    throw e;
  }
}
const openOrToast = (f: NonNullable<ChatMsg['file']>, download: boolean, onToast: (t: string) => void) =>
  void openFile(f, download).catch((e) => onToast(`Couldn't open ${f.name}. ${friendlyError(e)}`));

function FileView({ m, onImage, onLoad, onToast }: { m: ChatMsg; onImage: () => void; onLoad: () => void; onToast: (t: string) => void }) {
  const f = m.file!;
  const image = showsInline(f.mime) && !!f.url;
  const { src, failed } = useBlobUrl(image ? f.url : null);
  if (image && !failed) {
    return src
      // A blob: URL for a private file, so next/image can't optimise it.
      // eslint-disable-next-line @next/next/no-img-element
      ? <button type="button" className="ch-img" onClick={onImage} aria-label={`View ${f.name}`}><img src={src} alt={f.name} onLoad={onLoad} /></button>
      : <span className="ch-img is-loading" role="img" aria-label={`Loading ${f.name}`}><ImageIcon size={22} aria-hidden /></span>;
  }
  const status = !f.url ? (m.failed ? 'Not sent' : 'Sending…') : failed ? "Photo couldn't load" : null;
  return (
    <span className="ch-doc">
      {f.mime.startsWith('image/') ? <ImageIcon size={26} aria-hidden /> : <FileText size={26} aria-hidden />}
      <span style={{ minWidth: 0, flex: 1 }}>
        <strong>{f.name}</strong>
        <span>{[f.name.split('.').pop()?.toUpperCase(), size(f.size), status].filter(Boolean).join(' · ')}</span>
      </span>
      {f.url && <button type="button" onClick={() => openOrToast(f, f.mime !== 'application/pdf', onToast)} aria-label={f.mime === 'application/pdf' ? `Open ${f.name}` : `Download ${f.name}`}><Download size={16} /></button>}
    </span>
  );
}

/** Full-screen photo viewer: arrow keys or buttons move between the chat's photos. */
function Lightbox({ items, start, onClose, onToast }: { items: ChatMsg[]; start: number; onClose: () => void; onToast: (t: string) => void }) {
  const [i, setI] = useState(start);
  const m = items[i];
  const { src, failed } = useBlobUrl(m?.file?.url);
  const boxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  // A modal: focus moves in, Tab stays inside, and focus goes back where it was on close.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => { before?.focus?.(); };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); }
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
      if (e.key === 'ArrowRight') setI((x) => Math.min(items.length - 1, x + 1));
      if (e.key === 'Tab' && boxRef.current) {
        const f = [...boxRef.current.querySelectorAll<HTMLElement>('button:not([disabled])')];
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!boxRef.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [items.length]);
  if (!m?.file) return null;
  return (
    <div ref={boxRef} className="ch-lightbox" role="dialog" aria-modal="true" aria-label="Photo viewer" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ch-lb-bar">
        <span><strong>{m.mine ? 'You' : m.senderName}</strong> · {dayLabel(m.createdAt)}, {timeFmt.format(new Date(m.createdAt))}{items.length > 1 ? ` · ${i + 1} of ${items.length}` : ''}</span>
        <button type="button" className="ch-icon" onClick={() => openOrToast(m.file!, true, onToast)} aria-label="Download"><Download size={18} /></button>
        <button ref={closeRef} type="button" className="ch-icon" onClick={onClose} aria-label="Close"><X size={20} /></button>
      </div>
      {i > 0 && <button type="button" className="ch-lb-nav is-prev" onClick={() => setI(i - 1)} aria-label="Previous photo"><ChevronLeft size={28} /></button>}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img className="ch-lb-img" src={src} alt={m.file.name} />
        : failed ? <p className="ch-lb-caption" role="alert">This photo couldn&apos;t be loaded. Try Download.</p>
          : <Skeleton h={300} w="50%" />}
      {i < items.length - 1 && <button type="button" className="ch-lb-nav is-next" onClick={() => setI(i + 1)} aria-label="Next photo"><ChevronRight size={28} /></button>}
      {m.text && <p className="ch-lb-caption">{m.text}</p>}
    </div>
  );
}

// ─── Search in this chat ─────────────────────────────────────────────────

function ThreadSearch({ threadId, onClose, onPick }: { threadId: string; onClose: () => void; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  useEffect(() => {
    const term = q.trim();
    let alive = true;
    const t = setTimeout(() => {
      if (term.length < 2) { setHits(null); return; }
      crm.get<SearchHit[]>(`/api/v1/chat/threads/${threadId}/search?q=${encodeURIComponent(term)}`)
        .then((r) => { if (alive) setHits(r); }).catch(() => { if (alive) setHits([]); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, threadId]);
  const mark = (s: string) => {
    const term = q.trim();
    const i = s.toLowerCase().indexOf(term.toLowerCase());
    if (i < 0 || !term) return s;
    const from = Math.max(0, i - 40);
    return <>{from > 0 ? '…' : ''}{s.slice(from, i)}<mark>{s.slice(i, i + term.length)}</mark>{s.slice(i + term.length, i + term.length + 80)}</>;
  };
  return (
    <div className="ch-tsearch">
      <label className="ch-search" style={{ margin: 0 }}>
        <Search size={16} aria-hidden />
        <span className="crm-sr">Search this chat</span>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search messages, files and tagged partners"
          onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }} />
        <button type="button" className="ch-clear" onClick={onClose} aria-label="Close search"><X size={14} /></button>
      </label>
      {hits && (
        <ul className="ch-tsearch-list">
          {hits.length === 0 && <li className="crm-sub" style={{ padding: 10 }}>Nothing found.</li>}
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" onClick={() => onPick(h.id)}>
                <span className="ch-tsearch-top"><strong>{h.senderName}</strong><span>{listTime(h.createdAt)}</span></span>
                <span className="ch-tsearch-text">{h.text ? mark(h.text) : h.fileName ? <>📎 {mark(h.fileName)}</> : h.contactName ? <>🏷 {mark(h.contactName)}</> : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Details panel ───────────────────────────────────────────────────────

function Thumb({ m, onClick }: { m: ChatMsg; onClick: () => void }) {
  const { src } = useBlobUrl(m.file?.url);
  return (
    <button type="button" className="ch-thumb" onClick={onClick} aria-label={`View ${m.file?.name}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt="" /> : <ImageIcon size={18} aria-hidden />}
    </button>
  );
}

function InfoPanel({ thread, presence, onClose, onJump, onImage, onToast, canTask, onTask }: {
  thread: ChatThread; presence: string | null; onClose: () => void; onJump: (id: string) => void; onImage: (items: ChatMsg[], index: number) => void;
  onToast: (t: string) => void; canTask: boolean; onTask: () => void;
}) {
  const [tab, setTab] = useState<'media' | 'files' | 'places' | 'partners'>('media');
  const [data, setData] = useState<Shared | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    let alive = true;
    crm.get<Shared>(`/api/v1/chat/threads/${thread.id}/shared`).then((r) => { if (alive) setData(r); }).catch(() => { if (alive) setData({ media: [], files: [], places: [], partners: [] }); });
    return () => { alive = false; };
  }, [thread.id]);
  const field = thread.kind === 'agent' || (thread.kind === 'direct' && !!thread.presence);
  // Photos the browser can show go in Photos; HEIC (iPhone) photos are listed with the files to download.
  const media = useMemo(() => (data?.media ?? []).filter((m) => showsInline(m.file?.mime)), [data]);
  const files = useMemo(() => [...(data?.media ?? []).filter((m) => !showsInline(m.file?.mime)), ...(data?.files ?? [])], [data]);
  const tabs: { k: typeof tab; l: string; n: number }[] = [
    { k: 'media', l: 'Photos', n: media.length }, { k: 'files', l: 'Files', n: files.length },
    { k: 'places', l: 'Places', n: data?.places.length ?? 0 }, { k: 'partners', l: 'Partners', n: data?.partners.length ?? 0 },
  ];
  return (
    <aside className="ch-info" aria-label="Chat details">
      <div className="ch-info-head">
        <strong>Details</strong>
        <button type="button" className="ch-icon is-sm" onClick={onClose} aria-label="Close details"><X size={18} /></button>
      </div>
      <div className="ch-info-who">
        <ThreadAvatar t={thread} />
        <strong>{thread.title}</strong>
        <span className="crm-sub">{[thread.sub, thread.kind === 'direct' ? 'one-to-one' : null].filter(Boolean).join(' · ')}</span>
        {presence && <span className={`ch-pres-line is-${thread.presence?.state}`}>{presence}</span>}
      </div>
      {field && thread.agentId && (
        <div className="ch-info-links">
          <Link href={`/admin/activity?agent=${encodeURIComponent(thread.agentId)}`}>Today&apos;s activity</Link>
          <Link href="/admin/map">Live map</Link>
          <Link href="/admin/assignments?view=tasks">Tasks</Link>
          {canTask && <button type="button" onClick={onTask}><ClipboardList size={14} aria-hidden /> Give a task</button>}
        </div>
      )}
      <div className="ch-info-tabs" role="tablist" aria-label="Shared in this chat">
        {tabs.map((t) => <button key={t.k} type="button" role="tab" aria-selected={tab === t.k} aria-controls="ch-info-body" onClick={() => setTab(t.k)}>{t.l}{t.n ? <span>{t.n}</span> : null}</button>)}
      </div>
      <div className="ch-info-body" id="ch-info-body" role="tabpanel">
        {!data ? <Skeleton h={160} /> : tab === 'media' ? (
          media.length === 0 ? <p className="crm-sub">No photos shared yet.</p> : (
            <>
              <div className="ch-thumbs">{(more ? media : media.slice(0, 18)).map((m, i) => <Thumb key={m.id} m={m} onClick={() => onImage(media, i)} />)}</div>
              {!more && media.length > 18 && <button type="button" className="crm-chip" onClick={() => setMore(true)}>Show all {media.length}</button>}
            </>
          )
        ) : tab === 'files' ? (
          files.length === 0 ? <p className="crm-sub">No documents shared yet.</p> : (
            <ul className="ch-info-list">
              {files.map((m) => (
                <li key={m.id}>
                  <button type="button" onClick={() => m.file && openOrToast(m.file, m.file.mime !== 'application/pdf', onToast)}>
                    {m.file?.mime.startsWith('image/') ? <ImageIcon size={18} aria-hidden /> : <FileText size={18} aria-hidden />}
                    <span><strong>{m.file?.name}</strong><span>{[m.mine ? 'You' : m.senderName, listTime(m.createdAt), size(m.file?.size)].filter(Boolean).join(' · ')}</span></span>
                  </button>
                  <button type="button" className="ch-icon is-sm" onClick={() => onJump(m.id)} aria-label="Show in chat"><CornerUpLeft size={14} /></button>
                </li>
              ))}
            </ul>
          )
        ) : tab === 'places' ? (
          data.places.length === 0 ? <p className="crm-sub">No locations shared yet.</p> : (
            <ul className="ch-info-list">
              {data.places.map((m) => (
                <li key={m.id}>
                  <a href={mapsUrl(m.lat!, m.lng!)} target="_blank" rel="noopener noreferrer"><MapPin size={18} aria-hidden />
                    <span><strong>{m.text ?? 'Location'}</strong><span>{[m.mine ? 'You' : m.senderName, listTime(m.createdAt)].join(' · ')}</span></span>
                  </a>
                  <button type="button" className="ch-icon is-sm" onClick={() => onJump(m.id)} aria-label="Show in chat"><CornerUpLeft size={14} /></button>
                </li>
              ))}
            </ul>
          )
        ) : (
          data.partners.length === 0 ? <p className="crm-sub">No partners tagged yet.</p> : (
            <ul className="ch-info-list">
              {data.partners.map((p) => (
                <li key={p.id}>
                  <Link href={`/admin/partners?id=${encodeURIComponent(p.id)}`}><Tag size={16} aria-hidden />
                    <span><strong>{p.name}</strong><span>{p.count} {p.count === 1 ? 'message' : 'messages'} · last {listTime(p.lastAt)}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </aside>
  );
}

// ─── Make a task from a message ──────────────────────────────────────────

function TaskFromChat({ agentId, agentName, msg, idea, onClose, onDone }: {
  agentId: string; agentName: string; msg: ChatMsg | null; idea?: TaskIdea | null; onClose: () => void; onDone: (title: string, due: string | null, tell: boolean) => void;
}) {
  const source = (msg?.text ?? (msg?.file ? `See the file: ${msg.file.name}` : '')).trim();
  const firstLine = source.split('\n')[0];
  const [title, setTitle] = useState(idea?.title ?? (firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine));
  const [detail, setDetail] = useState(idea ? (idea.detail ?? '') : source.length > title.length ? source : '');
  const [priority, setPriority] = useState<string>(idea?.priority ?? 'normal');
  const [due, setDue] = useState(idea?.dueDate ?? tomorrowIst());
  // A task suggested from the office's own message: the agent already has the message, so no second note by default.
  const [tell, setTell] = useState(!idea);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!title.trim()) { setError('Write what the agent should do.'); return; }
    setBusy(true); setError(null);
    try {
      await crm.post('/api/v1/tasks', { agentIds: [agentId], title: title.trim(), detail: detail.trim() || undefined, priority, dueDate: due || undefined, contactClientId: idea?.contactClientId || undefined });
      onDone(title.trim(), due || null, tell);
    } catch (e) { setError(friendlyError(e)); setBusy(false); }
  };
  return (
    <Modal title={`Task for ${agentName}`} onClose={onClose}
      actions={<>
        <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="crm-btn" onClick={() => void save()} disabled={busy}>{busy ? 'Sending…' : 'Send task'}</button>
      </>}>
      <p className="crm-sub" style={{ margin: 0, fontSize: 13 }}>{idea ? <><Sparkles size={13} aria-hidden style={{ verticalAlign: -2 }} /> Filled in by smart chat from your message: check it before sending. </> : null}It appears in the agent&apos;s Tasks in the app until they mark it done.</p>
      <label className="crm-field"><span>What to do</span>
        <input className="crm-input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Visit Dr. Shahid Anwar and collect the OPD list" />
      </label>
      <label className="crm-field"><span>Details (optional)</span>
        <textarea className="crm-input" rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} />
      </label>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label className="crm-field" style={{ flex: 1, minWidth: 140 }}><span>Due by</span>
          <input className="crm-input" type="date" value={due} min={istDay(new Date().toISOString())} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label className="crm-field" style={{ flex: 1, minWidth: 140 }}><span>Priority</span>
          <select className="crm-input" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option>
          </select>
        </label>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
        <input type="checkbox" checked={tell} onChange={(e) => setTell(e.target.checked)} /> Also tell {agentName.split(' ')[0]} in this chat
      </label>
      {error && <div className="crm-error" role="alert">{error}</div>}
    </Modal>
  );
}

// ─── Smart chat ──────────────────────────────────────────────────────────

/** "today", "tomorrow" or "Fri 14 Nov" for a yyyy-MM-dd day (India time). */
function dueText(day: string): string {
  const today = istDay(new Date().toISOString());
  if (day === today) return 'today';
  if (day === tomorrowIst()) return 'tomorrow';
  return shortDate.format(new Date(`${day}T12:00:00+05:30`));
}

function SummaryPanel({ s, onClose, onRetry }: { s: { busy: boolean; data?: ChatSummary; error?: string; since?: string }; onClose: () => void; onRetry: () => void }) {
  return (
    <section className="ch-sum" aria-label="Catch-up summary" aria-busy={s.busy}>
      <div className="ch-sum-head">
        <strong><Sparkles size={15} aria-hidden /> {s.since ? 'New since you last read' : 'Catch up'}</strong>
        {s.data && <span className="crm-cell-sub">{s.data.count} messages · {dayLabel(s.data.from)} {timeFmt.format(new Date(s.data.from))} – {timeFmt.format(new Date(s.data.to))}</span>}
        <button type="button" className="ch-icon is-sm" onClick={onClose} aria-label="Close summary"><X size={16} /></button>
      </div>
      {s.busy ? <div className="ch-sum-wait"><Skeleton h={14} /><Skeleton h={14} /><Skeleton h={14} /></div>
        : s.error ? <div className="crm-error" role="alert">{s.error} <button type="button" className="crm-btn is-secondary is-sm" onClick={onRetry}>Try again</button></div>
          : s.data && (
            <>
              <ul className="ch-sum-points">{s.data.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
              {s.data.todo.length > 0 && (
                <>
                  <span className="ch-sum-label">Still to do</span>
                  <ul className="ch-sum-todo">{s.data.todo.map((p, i) => <li key={i}><ClipboardList size={13} aria-hidden /> {p}</li>)}</ul>
                </>
              )}
              <span className="ch-sum-note">Written by AI from the messages above: check anything important in the chat itself.</span>
            </>
          )}
    </section>
  );
}

function DigestModal({ onClose, onOpen }: { onClose: () => void; onOpen: (threadId: string) => void }) {
  const [hours, setHours] = useState(24);
  const [data, setData] = useState<Digest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      setBusy(true); setError(null);
      digest(hours).then((d) => { if (alive) setData(d); }).catch((e) => { if (alive) setError(friendlyError(e)); }).finally(() => { if (alive) setBusy(false); });
    }, 0);
    return () => { alive = false; clearTimeout(t); };
  }, [hours]);
  const urgent = data?.chats.filter((c) => c.urgent).length ?? 0;
  const waiting = data?.chats.filter((c) => c.waiting).length ?? 0;
  return (
    <Modal title="Today's digest" onClose={onClose} wide>
      <div className="ch-dig-bar">
        <span className="crm-sub">What the field agents said in the last</span>
        <div className="ch-filters" role="group" aria-label="Period">
          {[12, 24, 48].map((h) => <button key={h} type="button" aria-pressed={hours === h} onClick={() => setHours(h)}>{h} h</button>)}
        </div>
      </div>
      {error && <div className="crm-error" role="alert">{error}</div>}
      {busy && !data ? <Skeleton h={240} /> : data && data.count === 0 ? (
        <p className="crm-sub">No field agent has written in the last {data.hours} hours.</p>
      ) : data && (
        <div aria-busy={busy}>
          {data.overview && <p className="ch-dig-over"><Sparkles size={15} aria-hidden /> {data.overview}</p>}
          <p className="crm-cell-sub" style={{ margin: '0 0 8px' }}>{data.count} {data.count === 1 ? 'agent' : 'agents'} wrote{urgent ? ` · ${urgent} urgent` : ''}{waiting ? ` · ${waiting} waiting for a reply` : ''}</p>
          <ul className="ch-dig-list">
            {data.chats.map((c) => (
              <li key={c.threadId}>
                <button type="button" onClick={() => onOpen(c.threadId)} className={c.urgent ? 'is-urgent' : undefined}>
                  <span className="ch-dig-top">
                    <strong>{c.name}</strong>{c.block && <span className="crm-cell-sub">{c.block}</span>}
                    {c.urgent && <span className="ch-dig-tag is-urgent">Urgent</span>}
                    {c.waiting && <span className="ch-dig-tag">Waiting for reply</span>}
                    <span className="crm-cell-sub" style={{ marginLeft: 'auto' }}>{listTime(c.lastAt)}</span>
                  </span>
                  <span className="ch-dig-sum">{c.summary}</span>
                  {c.urgent && c.why && <span className="ch-dig-why">{c.why}</span>}
                </button>
              </li>
            ))}
          </ul>
          <p className="ch-sum-note">Written by AI from the chats. Phone numbers, ID numbers and patient names were hidden from it.</p>
        </div>
      )}
    </Modal>
  );
}

const AI_FEATURES: { k: 'translate' | 'replies' | 'summary' | 'tasks'; title: string; text: string }[] = [
  { k: 'translate', title: 'Translate messages', text: 'Agents read the office in their app language (Hindi, Bangla, Hinglish or English); the office sees an English line under messages written in Hindi or Bangla.' },
  { k: 'replies', title: 'Suggested replies', text: 'Three short replies to tap and edit, in the reader’s language. Nothing is sent until they press send.' },
  { k: 'summary', title: 'Catch-up and daily digest', text: 'Sum up a chat or the new messages, and a digest of all field agents’ chats with urgent ones first.' },
  { k: 'tasks', title: 'Spot tasks', text: 'When the office asks an agent to do something, offer to make it a task; when an agent writes it’s done, the app offers to mark the task done.' },
];

function SmartChatSettings({ onClose }: { onClose: () => void }) {
  const { status } = useChatAi();
  const [v, setV] = useState({ translate: status.translate, replies: status.replies, summary: status.summary, tasks: status.tasks });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try { await saveChatAi(v); onClose(); } catch (e) { setError(friendlyError(e)); setBusy(false); }
  };
  return (
    <Modal title="Smart chat" onClose={onClose}
      actions={<>
        <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="crm-btn" onClick={() => void save()} disabled={busy || !status.configured}>{busy ? 'Saving…' : 'Save'}</button>
      </>}>
      <p className="crm-sub" style={{ margin: 0 }}>AI helpers in chat, run by Groq. They only suggest: people still decide what is sent, saved or marked done.</p>
      {!status.configured && <div className="crm-error" role="alert">The Groq API key isn&apos;t set on the server yet (Groq__ApiKey), so smart chat can&apos;t be switched on.</div>}
      <div className="ch-ai-list">
        {AI_FEATURES.map((f) => (
          <label key={f.k} className="ch-ai-row">
            <input type="checkbox" checked={v[f.k]} disabled={!status.configured} onChange={(e) => setV((x) => ({ ...x, [f.k]: e.target.checked }))} />
            <span><strong>{f.title}</strong><span className="crm-cell-sub">{f.text}</span></span>
          </label>
        ))}
      </div>
      <div className="ch-ai-privacy">
        <Lock size={14} aria-hidden />
        <span>Message text goes to Groq only when a helper needs it. Phone numbers, ID numbers, email addresses and the names of patients in referrals, leads and camps are removed first and put back afterwards. Nothing the AI writes is stored. Each person has a daily limit, so the Groq bill stays predictable.</span>
      </div>
      {error && <div className="crm-error" role="alert">{error}</div>}
    </Modal>
  );
}

// ─── Tag a partner ───────────────────────────────────────────────────────

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
      <input autoFocus className="crm-input" placeholder="Search name, phone or panchayat" value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }} />
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
