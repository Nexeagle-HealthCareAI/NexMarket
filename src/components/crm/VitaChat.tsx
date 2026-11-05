'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowUp, Copy, MessagesSquare, RotateCcw, Sparkles, Users, X } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { canView, useAccess } from '@/lib/crm/access';
import { friendlyError } from '@/components/crm/ui';

/**
 * Opens the side drawer from anywhere (the top bar's Vita and Messages buttons). detail: { tab?, area?, question? }.
 * With a question, Vita is asked it straight away (about `area`, e.g. from a button on the command centre).
 */
export const VITA_EVENT = 'vita-open';
interface VitaOpen { tab?: 'vita' | 'messages'; area?: string; question?: string }
export function openVita(tab: 'vita' | 'messages' = 'vita', opts: { area?: string; question?: string } = {}) {
  window.dispatchEvent(new CustomEvent<VitaOpen>(VITA_EVENT, { detail: { tab, ...opts } }));
}

interface ThreadLite { id: string; kind: string; title: string; sub?: string | null; lastPreview?: string | null; lastMessageAt?: string | null; unread: number; photoUrl?: string | null }

/**
 * Vita, the market analyst, in a side drawer opened from the top bar, with a Messages tab for a quick
 * look at the latest chats. It asks the same AI analyst as Analytics,
 * focused on the area of the page you are on (you can switch). Needs the Analytics page.
 */

type Turn = { role: 'user' | 'assistant'; content: string; tools?: string[]; failed?: boolean };

const AREAS: { k: string; l: string }[] = [
  { k: 'business', l: 'Everything' }, { k: 'partners', l: 'Partners' }, { k: 'field', l: 'Field team' },
  { k: 'referrals', l: 'Referrals' }, { k: 'money', l: 'Money' }, { k: 'surveys', l: 'Surveys' },
];

const SUGGEST: Record<string, string[]> = {
  business: ['What are the 3 most important things to fix this week?', 'How is this month going compared with last month?', 'Which block should we focus on next?'],
  partners: ['Which partners should we call this week?', 'Who signed up but never referred anyone?', 'Which partner type gets patients admitted?'],
  field: ['Which agent needs support, and with what?', 'Which assigned panchayats have never been visited?', 'Who is skipping the survey?'],
  referrals: ['Where are we losing patients before they arrive?', 'Which department gets referrals but few admissions?', 'Which blocks send patients who actually come?'],
  money: ['What is our cost per admission?', 'Who was paid but sent no admitted patients?', 'How much is waiting for approval or overdue?'],
  surveys: ['What should we offer in our weakest block?', 'Where do patients go instead of us?', 'Which illnesses come up most?'],
};

/** The page decides what Vita looks at first. */
function areaFor(path: string): string {
  if (/^\/admin\/(partners|pipeline|duplicates|calls|broadcasts)/.test(path)) return 'partners';
  if (/^\/admin\/(agents|assignments|coverage|panchayats|map|activity|leave)/.test(path)) return 'field';
  if (/^\/admin\/(referrals|desk|hospital-crm|departments)/.test(path)) return 'referrals';
  if (/^\/admin\/payments/.test(path)) return 'money';
  if (/^\/admin\/surveys/.test(path)) return 'surveys';
  return 'business';
}

const STORE = 'vita-chat-v1';
function load(): { turns: Turn[]; open: boolean } {
  try { const v = JSON.parse(sessionStorage.getItem(STORE) ?? 'null'); if (v && Array.isArray(v.turns)) return v; } catch { /* storage off */ }
  return { turns: [], open: false };
}

export default function VitaChat() {
  const { access } = useAccess();
  const path = usePathname() ?? '';
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'vita' | 'messages'>('vita');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [area, setArea] = useState(() => areaFor(path));
  const [picked, setPicked] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const askRef = useRef<((q: string, area?: string) => void) | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Remember the conversation for this browser tab, so moving between pages keeps it.
  useEffect(() => { const v = load(); setTurns(v.turns); setOpen(v.open); }, []);
  useEffect(() => { try { sessionStorage.setItem(STORE, JSON.stringify({ turns: turns.slice(-30), open })); } catch { /* storage off */ } }, [turns, open]);
  // Follow the page until someone picks an area themselves.
  useEffect(() => { if (!picked) setArea(areaFor(path)); }, [path, picked]);
  useEffect(() => { if (open) endRef.current?.scrollIntoView({ block: 'end' }); }, [turns.length, busy, open]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<VitaOpen>).detail ?? {};
      setTab(d.tab ?? 'vita');
      setOpen(true);
      if (d.area && AREAS.some((a) => a.k === d.area)) { setArea(d.area); setPicked(true); }
      if (d.question) askRef.current?.(d.question, d.area);
    };
    window.addEventListener(VITA_EVENT, on);
    return () => window.removeEventListener(VITA_EVENT, on);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const ask = async (question: string, forArea?: string) => {
    const text = question.trim();
    if (!text || busy) return;
    const history = turns.filter((t) => !t.failed).slice(-10).map(({ role, content }) => ({ role, content }));
    setTurns((t) => [...t, { role: 'user', content: text }]);
    setQ('');
    setBusy(true);
    try {
      const r = await crm.post<{ answer: string; lookedUp: string[] }>('/api/v1/analytics/analyst/ask', { question: text, history, scope: forArea ?? area });
      setTurns((t) => [...t, { role: 'assistant', content: r.answer || 'No answer came back. Try asking another way.', tools: r.lookedUp }]);
    } catch (e) {
      setTurns((t) => [...t, { role: 'assistant', content: friendlyError(e), failed: true }]);
    } finally {
      setBusy(false);
    }
  };

  // The drawer's open event can carry a question; it calls the latest ask through this ref.
  useEffect(() => { askRef.current = (q, a) => { void ask(q, a); }; });

  const vitaAllowed = !!access && canView(access, 'analytics');
  const chatAllowed = !!access && (access.isAdmin || access.role === 'MarketingManager' || canView(access, 'field'));
  if (!access || (!vitaAllowed && !chatAllowed)) return null;
  const shownTab = !vitaAllowed ? 'messages' : !chatAllowed ? 'vita' : tab;

  return (
    <>
      {open && <div className="vita-backdrop" onClick={() => setOpen(false)} aria-hidden />}
      {open && (
        <section className="vita-panel is-drawer" role="dialog" aria-label={shownTab === 'vita' ? 'Vita, market analyst' : 'Messages'}>
          {vitaAllowed && chatAllowed && (
            <div className="vita-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={shownTab === 'vita'} onClick={() => setTab('vita')}><Sparkles size={15} aria-hidden /> Ask Vita</button>
              <button type="button" role="tab" aria-selected={shownTab === 'messages'} onClick={() => setTab('messages')}><MessagesSquare size={15} aria-hidden /> Messages</button>
              <span style={{ flex: 1 }} />
              <button type="button" className="vita-icon" onClick={() => setOpen(false)} aria-label="Close"><X size={18} /></button>
            </div>
          )}
          {shownTab === 'messages' ? <QuickMessages onClose={() => setOpen(false)} single={!vitaAllowed} /> : (<>
          <header className="vita-head">
            <Image src={busy ? '/brand/vita/think.webp' : '/brand/vita/ai.webp'} alt="" width={52} height={52} unoptimized className={busy ? 'vita-bob' : undefined} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>Vita <span className="vita-tag">Market analyst</span></strong>
              <span>{busy ? 'Looking at the numbers…' : 'Ask about referrals, leads, partners, agents, money or surveys.'}</span>
            </div>
            {turns.length > 0 && <button type="button" className="vita-icon" onClick={() => setTurns([])} aria-label="New conversation" title="New conversation"><RotateCcw size={16} /></button>}
            {!(vitaAllowed && chatAllowed) && <button type="button" className="vita-icon" onClick={() => setOpen(false)} aria-label="Close"><X size={18} /></button>}
          </header>

          <div className="vita-areas" role="group" aria-label="What Vita looks at">
            {AREAS.map((a) => (
              <button key={a.k} type="button" aria-pressed={area === a.k} onClick={() => { setArea(a.k); setPicked(true); }}>{a.l}</button>
            ))}
          </div>

          <div className="vita-thread" aria-live="polite">
            {turns.length === 0 && (
              <div className="vita-empty">
                <Image src="/brand/vita/wave.webp" alt="" width={110} height={110} unoptimized />
                <p>Namaste! I&apos;m Vita. I read your live numbers before I answer. Try one of these:</p>
                {SUGGEST[area].map((s) => <button key={s} type="button" className="vita-suggest" onClick={() => void ask(s)}>{s}</button>)}
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={`vita-msg is-${t.role}${t.failed ? ' is-failed' : ''}`}>
                <span style={{ whiteSpace: 'pre-wrap' }}>{t.content}</span>
                {t.role === 'assistant' && !t.failed && (
                  <span className="vita-meta">
                    {t.tools && t.tools.length > 0 ? `Looked up: ${[...new Set(t.tools)].map((x) => x.replace(/^get_/, '').replace(/_/g, ' ')).join(', ')}` : ''}
                    <button type="button" onClick={() => { void navigator.clipboard?.writeText(t.content).catch(() => undefined); }} aria-label="Copy answer" title="Copy"><Copy size={13} /></button>
                  </span>
                )}
              </div>
            ))}
            {busy && <div className="vita-msg is-assistant vita-typing" role="status"><i /><i /><i /></div>}
            <div ref={endRef} />
          </div>

          <form className="vita-form" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
            <label className="crm-sr" htmlFor="vita-q">Ask Vita</label>
            <textarea id="vita-q" ref={inputRef} rows={1} value={q} maxLength={2000} placeholder="Ask Vita anything about the business…"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(q); } }} />
            <button type="submit" disabled={busy || !q.trim()} aria-label="Send"><ArrowUp size={18} /></button>
          </form>
          <span className="vita-foot">Only totals and partner and agent names go to the AI. Vita can be wrong; check the numbers before acting.</span>
          </>)}
        </section>
      )}
    </>
  );
}

function ago(iso?: string | null): string {
  if (!iso) return '';
  const m = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 1440) return `${Math.round(m / 60)} h`;
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
}

/** The latest chats, unread first: one click opens the conversation on the Chat page. */
function QuickMessages({ onClose, single }: { onClose: () => void; single: boolean }) {
  const router = useRouter();
  const [threads, setThreads] = useState<ThreadLite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => crm.get<{ threads: ThreadLite[] }>('/api/v1/chat/threads')
      .then((r) => { if (alive) setThreads(r.threads); }).catch((e) => { if (alive) setError(friendlyError(e)); });
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const go = (href: string) => { onClose(); router.push(href); };
  const list = (threads ?? []).filter((t) => t.lastPreview || t.kind === 'team')
    .sort((a, b) => (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0) || (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))
    .slice(0, 12);
  return (
    <div className="vq">
      <header className="vita-head">
        <div className="vq-ic" aria-hidden><MessagesSquare size={24} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong>Messages</strong>
          <span>Latest chats with agents, the field team and one-to-one.</span>
        </div>
        {single && <button type="button" className="vita-icon" onClick={onClose} aria-label="Close"><X size={18} /></button>}
      </header>
      {error && <div className="crm-error" role="alert" style={{ margin: 12 }}>{error}</div>}
      <ul className="vq-list">
        {!threads ? <li className="vq-empty">Loading…</li> : list.length === 0 ? <li className="vq-empty">No messages yet.</li> : list.map((t) => (
          <li key={t.id}>
            <button type="button" className={`vq-item${t.unread ? ' is-unread' : ''}`} onClick={() => go(`/admin/chat?t=${t.id}`)}>
              {t.kind === 'team' ? <span className="ch-avatar is-team" aria-hidden><Users size={17} /></span>
                // eslint-disable-next-line @next/next/no-img-element
                : t.photoUrl ? <img className="ch-avatar" src={t.photoUrl} alt="" />
                  : <span className="ch-avatar is-direct" aria-hidden>{t.title.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')}</span>}
              <span className="vq-main">
                <span className="vq-top"><strong>{t.title}</strong><span>{ago(t.lastMessageAt)}</span></span>
                <span className="vq-bottom"><span className="vq-prev">{t.lastPreview ?? t.sub ?? ''}</span>{t.unread > 0 && <span className="ch-badge">{t.unread}</span>}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="vq-foot">
        <button type="button" className="crm-btn" onClick={() => go('/admin/chat')}><MessagesSquare size={16} aria-hidden /> Open Chat</button>
      </div>
    </div>
  );
}
