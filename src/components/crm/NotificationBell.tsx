'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell, BellOff, CalendarOff, Check, ClipboardList, Flag, HeartPulse, MapPinned, MessageCircle, Monitor, Settings, StickyNote, UserPlus, Users, X,
} from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import type { LiveNotification } from '@/lib/crm/live';
import { friendlyError } from '@/components/crm/ui';

interface Item { id: string; kind: string; title: string; body: string; link?: string | null; createdAt: string; read: boolean }
interface ListRes { items: Item[]; unread: number; hasMore: boolean }
interface SettingsRes { kinds: { kind: string; label: string; on: boolean }[]; pushConfigured: boolean; phones: number }

/** The layout re-broadcasts live notifications on window as this event, so one socket serves the whole CRM. */
export const NOTIFY_EVENT = 'nx-notify';
const READ_EVENT = 'nx-notify-read';
const SOUND_KEY = 'nx-popup-sound';
const soundOn = () => { try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; } };

const KIND: Record<string, { icon: typeof Bell; tone: string }> = {
  chat: { icon: MessageCircle, tone: 'blue' },
  team_chat: { icon: Users, tone: 'blue' },
  escalation: { icon: Flag, tone: 'bad' },
  assignment: { icon: MapPinned, tone: 'ok' },
  task: { icon: ClipboardList, tone: 'ok' },
  leave: { icon: CalendarOff, tone: 'warn' },
  referral: { icon: HeartPulse, tone: 'ok' },
  note: { icon: StickyNote, tone: 'muted' },
  lead: { icon: UserPlus, tone: 'ok' },
};

/** Where a tap on a notification goes in the CRM. */
export function crmHref(link?: string | null): string | null {
  if (!link) return null;
  const [k, id] = link.split(':');
  if (k === 'chat' && id) return `/admin/chat?t=${encodeURIComponent(id)}`;
  if (k === 'lead' && id) return `/admin/leads?id=${encodeURIComponent(id)}`;
  if (k === 'work' && id) return `/admin/work?card=${encodeURIComponent(id)}`;
  if (k === 'ai-agents') return '/admin/ai-agents';
  if (k === 'field-survey' && id) return `/admin/field-surveys?id=${encodeURIComponent(id)}`;
  if (k === 'wa' && id) return `/admin/whatsapp?c=${encodeURIComponent(id)}`;
  if (k === 'social' && id === 'forms') return '/admin/social?tab=forms';
  if (k === 'social' && id) return `/admin/social?c=${encodeURIComponent(id)}`;
  if (k === 'partner' && id) return `/admin/partners?id=${encodeURIComponent(id)}`;
  if (k === 'referral') return id ? `/admin/referrals?r=${encodeURIComponent(id)}` : '/admin/referrals';
  if (k === 'money') return '/admin/payments';
  if (k === 'leave') return '/admin/leave';
  if (k === 'assignments') return '/admin/assignments';
  if (k === 'tasks') return '/admin/dashboard';
  return null;
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
}

/**
 * The CRM's notification bell: unread count, a panel with everything (chat, escalations, leave, tasks…),
 * a pop-up for each new one, and desktop alerts when the tab is in the background.
 */
export function NotificationBell({ placement = 'nav' }: { placement?: 'nav' | 'inline' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'list' | 'settings'>('list');
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [items, setItems] = useState<Item[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  const loadCount = useCallback(() => {
    crm.get<{ total: number }>('/api/v1/notifications/unread').then((r) => setUnread(r.total)).catch(() => undefined);
  }, []);
  const load = useCallback(async (more = false, f: 'all' | 'unread' = 'all') => {
    try {
      const before = more && items?.length ? `&before=${encodeURIComponent(items[items.length - 1].createdAt)}` : '';
      const r = await crm.get<ListRes>(`/api/v1/notifications?limit=30${f === 'unread' ? '&unreadOnly=true' : ''}${before}`);
      setItems((x) => (more && x ? [...x, ...r.items] : r.items));
      setHasMore(r.hasMore);
      setUnread(r.unread);
      setError(null);
    } catch (e) { setError(friendlyError(e)); }
  }, [items]);

  useEffect(() => {
    const first = setTimeout(loadCount, 0);
    const t = setInterval(() => { if (!document.hidden) loadCount(); }, 60000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [loadCount]);

  // A new notification arrives live.
  useEffect(() => {
    const on = (ev: Event) => {
      const n = (ev as CustomEvent<LiveNotification>).detail;
      const item: Item = { id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, createdAt: n.createdAt, read: false };
      setUnread((u) => u + 1);
      setItems((x) => (x ? [item, ...x.filter((i) => i.id !== item.id)] : x));
    };
    // A pop-up marked one read: keep the count right.
    const read = (ev: Event) => {
      const id = (ev as CustomEvent<string>).detail;
      setItems((x) => x?.map((y) => (y.id === id ? { ...y, read: true } : y)) ?? x);
      setUnread((u) => Math.max(0, u - 1));
    };
    window.addEventListener(NOTIFY_EVENT, on);
    window.addEventListener(READ_EVENT, read);
    return () => { window.removeEventListener(NOTIFY_EVENT, on); window.removeEventListener(READ_EVENT, read); };
  }, []);

  // Close on outside click / Esc.
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', click);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', click); document.removeEventListener('keydown', key); };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) { setView('list'); void load(false, filter); }
  };
  const openItem = async (i: Item) => {
    setOpen(false);
    if (!i.read) {
      setItems((x) => x?.map((y) => (y.id === i.id ? { ...y, read: true } : y)) ?? x);
      setUnread((u) => Math.max(0, u - 1));
      void crm.post(`/api/v1/notifications/${i.id}/read`).catch(() => undefined);
    }
    const href = crmHref(i.link);
    if (href) router.push(href);
  };
  const readAll = async () => {
    try {
      await crm.post('/api/v1/notifications/read-all');
      setItems((x) => x?.map((y) => ({ ...y, read: true })) ?? x);
      setUnread(0);
    } catch (e) { setError(friendlyError(e)); }
  };

  return (
    <div className={`nt-wrap is-${placement}`} ref={panel}>
      <button type="button" className={`nt-bell${unread ? ' has-unread' : ''}`} onClick={toggle} aria-expanded={open} aria-haspopup="dialog"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} title="Notifications">
        <Bell size={19} aria-hidden />
        {unread > 0 && <span className="nt-count">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="nt-panel" role="dialog" aria-label="Notifications">
          {view === 'list' ? (
            <>
              <div className="nt-head">
                <strong>Notifications</strong>
                <span style={{ flex: 1 }} />
                {unread > 0 && <button type="button" className="nt-link" onClick={readAll}><Check size={14} aria-hidden /> Mark all read</button>}
                <button type="button" className="nt-iconbtn" onClick={() => setView('settings')} aria-label="Notification settings" title="Settings"><Settings size={16} aria-hidden /></button>
              </div>
              <div className="nt-tabs" role="tablist">
                {(['all', 'unread'] as const).map((f) => (
                  <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => { setFilter(f); setItems(null); void load(false, f); }}>
                    {f === 'all' ? 'All' : `Unread${unread ? ` · ${unread}` : ''}`}
                  </button>
                ))}
              </div>
              {error && <div className="crm-error" role="alert" style={{ margin: '0 12px' }}>{error}</div>}
              <ul className="nt-list">
                {!items ? <li className="nt-empty">Loading…</li> : items.length === 0 ? (
                  <li className="nt-empty"><BellOff size={22} aria-hidden /> {filter === 'unread' ? 'You are all caught up.' : 'No notifications yet.'}</li>
                ) : items.map((i) => {
                  const k = KIND[i.kind] ?? KIND.note;
                  const Icon = k.icon;
                  return (
                    <li key={i.id}>
                      <button type="button" className={`nt-item${i.read ? '' : ' is-unread'}`} onClick={() => void openItem(i)}>
                        <span className={`nt-ic tone-${k.tone}`} aria-hidden><Icon size={16} /></span>
                        <span className="nt-main">
                          <span className="nt-title">{i.title}</span>
                          {i.body && <span className="nt-body">{i.body}</span>}
                          <span className="nt-time">{ago(i.createdAt)}</span>
                        </span>
                        {!i.read && <span className="nt-dot" aria-label="Unread" />}
                      </button>
                    </li>
                  );
                })}
                {hasMore && <li><button type="button" className="nt-more" onClick={() => void load(true, filter)}>Show older</button></li>}
              </ul>
            </>
          ) : <BellSettings onBack={() => setView('list')} />}
        </div>
      )}

    </div>
  );
}

function BellSettings({ onBack }: { onBack: () => void }) {
  const [s, setS] = useState<SettingsRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission));
  const [tested, setTested] = useState(false);
  const [sound, setSound] = useState(soundOn);

  useEffect(() => {
    crm.get<SettingsRes>('/api/v1/notifications/settings').then(setS).catch((e) => setError(friendlyError(e)));
  }, []);

  const toggle = async (kind: string) => {
    if (!s) return;
    const next = { ...s, kinds: s.kinds.map((k) => (k.kind === kind ? { ...k, on: !k.on } : k)) };
    setS(next);
    try { await crm.put('/api/v1/notifications/settings', { muted: next.kinds.filter((k) => !k.on).map((k) => k.kind) }); }
    catch (e) { setS(s); setError(friendlyError(e)); }
  };
  const askDesktop = async () => {
    if (typeof Notification === 'undefined') return;
    setPerm(await Notification.requestPermission());
  };
  const test = async () => {
    try { await crm.post('/api/v1/notifications/test'); setTested(true); } catch (e) { setError(friendlyError(e)); }
  };

  return (
    <div className="nt-settings">
      <div className="nt-head">
        <button type="button" className="nt-link" onClick={onBack}>← Back</button>
        <strong style={{ marginLeft: 6 }}>Notification settings</strong>
      </div>
      {error && <div className="crm-error" role="alert">{error}</div>}
      <p className="nt-hint">Turned-off kinds still appear in the list, without a pop-up, sound or phone alert.</p>
      {!s ? <p className="nt-hint">Loading…</p> : (
        <ul className="nt-switches">
          {s.kinds.map((k) => (
            <li key={k.kind}>
              <label>
                <span>{k.label}</span>
                <input type="checkbox" role="switch" checked={k.on} onChange={() => void toggle(k.kind)} />
                <span className="nt-switch" aria-hidden />
              </label>
            </li>
          ))}
        </ul>
      )}
      <label className="nt-block" style={{ cursor: 'pointer' }}>
        <Bell size={16} aria-hidden />
        <span style={{ flex: 1 }}>
          <strong>Sounds</strong>
          <span className="nt-hint" style={{ display: 'block', margin: 0 }}>A chime for every chat message and each pop-up.</span>
        </span>
        <input type="checkbox" checked={sound} onChange={(e) => { setSound(e.target.checked); try { localStorage.setItem(SOUND_KEY, e.target.checked ? 'on' : 'off'); } catch { /* storage off */ } }} />
      </label>
      <div className="nt-block">
        <Monitor size={16} aria-hidden />
        <span style={{ flex: 1 }}>
          <strong>Desktop alerts</strong>
          <span className="nt-hint" style={{ display: 'block', margin: 0 }}>
            {perm === 'granted' ? 'On: alerts show even when this tab is in the background.'
              : perm === 'denied' ? 'Blocked in this browser. Allow notifications for this site in the browser settings.'
                : perm === 'unsupported' ? 'This browser doesn’t support desktop alerts.' : 'Get an alert when this tab is in the background.'}
          </span>
        </span>
        {perm === 'default' && <button type="button" className="crm-btn is-sm" onClick={() => void askDesktop()}>Turn on</button>}
      </div>
      <div className="nt-block">
        <Bell size={16} aria-hidden />
        <span style={{ flex: 1 }}>
          <strong>Phone alerts</strong>
          <span className="nt-hint" style={{ display: 'block', margin: 0 }}>
            {!s ? '…' : !s.pushConfigured ? 'Phone push isn’t set up on the server yet (Firebase key). The app still shows alerts while it’s open.'
              : s.phones ? `On for ${s.phones} phone${s.phones === 1 ? '' : 's'} signed in to the NexMarket app.` : 'Sign in to the NexMarket app on your phone to get alerts there.'}
          </span>
        </span>
      </div>
      <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void test()} disabled={tested}>{tested ? 'Test sent ✓' : 'Send me a test notification'}</button>
    </div>
  );
}

interface Popup extends Item { leaving?: boolean }

/** A short, soft two-note chime (no audio file needed). */
export function chime(kind: 'chat' | 'alert' | 'soft' = 'alert') {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    // chat: a quick rising pair; alert: three notes; soft: one low note for the chat you're reading.
    const notes = kind === 'chat' ? [[988, 0], [1480, 0.09]] : kind === 'soft' ? [[740, 0]] : [[880, 0], [1320, 0.12], [1760, 0.24]];
    notes.forEach(([f, at]) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 0.4);
    });
    setTimeout(() => void ctx.close().catch(() => undefined), 900);
  } catch { /* the browser blocked sound until the page is clicked */ }
}

const STAY_MS = 9000;

/**
 * Pop-ups at the bottom right for each new notification: up to three stacked, newest at the bottom,
 * each with Open, Mark read and (for chat) a quick reply. They stay while the mouse is over them.
 * Mounted once in the CRM layout.
 */
export function NotificationPopups() {
  const router = useRouter();
  const [list, setList] = useState<Popup[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const remove = useCallback((id: string) => {
    setList((x) => x.map((p) => (p.id === id ? { ...p, leaving: true } : p)));
    setTimeout(() => setList((x) => x.filter((p) => p.id !== id)), 220);
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
  }, []);
  const schedule = useCallback((id: string, ms = STAY_MS) => {
    const old = timers.current.get(id);
    if (old) clearTimeout(old);
    timers.current.set(id, setTimeout(() => remove(id), ms));
  }, [remove]);
  const hold = (id: string) => { const t = timers.current.get(id); if (t) clearTimeout(t); timers.current.delete(id); };

  useEffect(() => {
    const on = (ev: Event) => {
      const n = (ev as CustomEvent<LiveNotification>).detail;
      if (n.muted) return;
      const href = crmHref(n.link);
      const isChat = n.kind === 'chat' || n.kind === 'team_chat' || n.kind === 'lead';
      // Every chat message pings, even in the chat that's open (a softer, single note there).
      const looking = !!href && `${window.location.pathname}${window.location.search}` === href && !document.hidden;
      if (soundOn() && !document.hidden) chime(looking ? 'soft' : isChat ? 'chat' : 'alert');
      // Already looking at that chat: no pop-up.
      if (looking) return;
      const item: Popup = { id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, createdAt: n.createdAt, read: false };
      setList((x) => {
        // A second message in the same chat replaces the first pop-up.
        const rest = x.filter((p) => p.id !== item.id && !((item.link?.startsWith('chat:') || item.link?.startsWith('lead:')) && p.link === item.link));
        const next = [...rest, item];
        next.slice(0, Math.max(0, next.length - 3)).forEach((p) => remove(p.id));
        return next;
      });
      schedule(item.id);
      if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          const d = new Notification(n.title, { body: n.body, tag: n.link ?? n.id, icon: '/brand/nexeagle-mark.png' });
          d.onclick = () => { window.focus(); if (href) router.push(href); d.close(); };
        } catch { /* some browsers only allow this from a service worker */ }
      }
    };
    window.addEventListener(NOTIFY_EVENT, on);
    const all = timers.current;
    return () => { window.removeEventListener(NOTIFY_EVENT, on); all.forEach(clearTimeout); };
  }, [router, schedule, remove]);

  const markRead = (p: Popup) => {
    void crm.post(`/api/v1/notifications/${p.id}/read`).catch(() => undefined);
    window.dispatchEvent(new CustomEvent(READ_EVENT, { detail: p.id }));
  };
  const open = (p: Popup) => {
    markRead(p);
    remove(p.id);
    const href = crmHref(p.link);
    if (href) router.push(href);
  };

  if (list.length === 0) return null;
  return (
    <div className="nt-stack" aria-live="polite" aria-label="New notifications">
      {list.length > 1 && (
        <button type="button" className="nt-stack-clear" onClick={() => list.forEach((p) => remove(p.id))}>Dismiss all</button>
      )}
      {list.map((p) => <PopupCard key={p.id} p={p} onOpen={() => open(p)} onRead={() => { markRead(p); remove(p.id); }}
        onClose={() => remove(p.id)} onHold={() => hold(p.id)} onRelease={() => schedule(p.id, 4000)} />)}
    </div>
  );
}

function PopupCard({ p, onOpen, onRead, onClose, onHold, onRelease }: {
  p: Popup; onOpen: () => void; onRead: () => void; onClose: () => void; onHold: () => void; onRelease: () => void;
}) {
  const k = KIND[p.kind] ?? KIND.note;
  const Icon = k.icon;
  const chatId = p.link?.startsWith('chat:') ? p.link.slice(5) : null;
  // A patient's WhatsApp message: reply straight from the pop-up (WhatsApp allows it for 24 hours after they write).
  const leadId = p.kind === 'lead' && p.link?.startsWith('lead:') ? p.link.slice(5) : null;
  const waPhone = p.kind === 'lead' && p.link?.startsWith('wa:') ? p.link.slice(3) : null;
  // A Facebook or Instagram message: reply from the pop-up too (allowed for 24 hours after they write).
  const socialId = p.kind === 'lead' && p.link?.startsWith('social:') && p.link !== 'social:forms' ? p.link.slice(7) : null;
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [err, setErr] = useState('');

  const send = async () => {
    if ((!chatId && !leadId && !waPhone && !socialId) || !text.trim()) return;
    setState('sending');
    try {
      if (leadId) {
        await crm.post(`/api/v1/leads/${leadId}/whatsapp`, { text: text.trim() });
      } else if (socialId) {
        await crm.post(`/api/v1/social/conversations/${encodeURIComponent(socialId)}/reply`, { text: text.trim() });
      } else if (waPhone) {
        await crm.post(`/api/v1/whatsapp/conversations/${encodeURIComponent(waPhone)}/text`, { text: text.trim() });
      } else {
        const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`;
        await crm.post(`/api/v1/chat/threads/${chatId}/messages`, { clientId: id, text: text.trim() });
      }
      setState('sent');
      setTimeout(onRead, 900);
    } catch (e) { setErr(leadId || waPhone || socialId ? friendlyError(e) : ''); setState('error'); }
  };

  return (
    <div className={`nt-pop tone-${k.tone}${p.leaving ? ' is-leaving' : ''}`} role="status" onMouseEnter={onHold} onMouseLeave={() => { if (!replying) onRelease(); }}
      onFocus={onHold}>
      <div className="nt-pop-row">
        <span className={`nt-ic tone-${k.tone}`} aria-hidden><Icon size={17} /></span>
        <button type="button" className="nt-pop-main" onClick={onOpen}>
          <span className="nt-pop-kind">{KIND_LABEL[p.kind] ?? 'Notification'} · now</span>
          <span className="nt-title">{p.title}</span>
          {p.body && <span className="nt-body">{p.body}</span>}
        </button>
        <button type="button" className="nt-iconbtn" onClick={onClose} aria-label="Dismiss"><X size={15} /></button>
      </div>
      {replying ? (
        <form className="nt-reply" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={socialId ? 'Reply…' : leadId || waPhone ? 'Reply on WhatsApp…' : 'Type a reply…'} maxLength={4000} disabled={state === 'sending' || state === 'sent'} />
          <button type="submit" className="crm-btn is-sm" disabled={!text.trim() || state === 'sending' || state === 'sent'}>
            {state === 'sending' ? 'Sending…' : state === 'sent' ? 'Sent ✓' : 'Send'}
          </button>
          {state === 'error' && <span className="nt-reply-err">{err || 'Not sent. Try again.'}</span>}
        </form>
      ) : (
        <div className="nt-pop-actions">
          <button type="button" className="nt-link" onClick={onOpen}>Open</button>
          {(chatId || leadId || waPhone || socialId) && <button type="button" className="nt-link" onClick={() => { onHold(); setReplying(true); }}>Reply</button>}
          <button type="button" className="nt-link is-muted" onClick={onRead}><Check size={14} aria-hidden /> Mark read</button>
        </div>
      )}
      {!replying && <span className="nt-pop-timer" aria-hidden />}
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  chat: 'Message', team_chat: 'Field team', escalation: 'Escalation', assignment: 'Block', task: 'Task', leave: 'Leave', referral: 'Patient', note: 'Note', lead: 'Lead',
};
