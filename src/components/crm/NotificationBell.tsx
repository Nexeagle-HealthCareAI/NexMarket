'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell, BellOff, CalendarOff, Check, ClipboardList, Flag, HeartPulse, MapPinned, MessageCircle, Monitor, Settings, StickyNote, Users, X,
} from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import type { LiveNotification } from '@/lib/crm/live';
import { friendlyError } from '@/components/crm/ui';

interface Item { id: string; kind: string; title: string; body: string; link?: string | null; createdAt: string; read: boolean }
interface ListRes { items: Item[]; unread: number; hasMore: boolean }
interface SettingsRes { kinds: { kind: string; label: string; on: boolean }[]; pushConfigured: boolean; phones: number }

/** The layout re-broadcasts live notifications on window as this event, so one socket serves the whole CRM. */
export const NOTIFY_EVENT = 'nx-notify';

const KIND: Record<string, { icon: typeof Bell; tone: string }> = {
  chat: { icon: MessageCircle, tone: 'blue' },
  team_chat: { icon: Users, tone: 'blue' },
  escalation: { icon: Flag, tone: 'bad' },
  assignment: { icon: MapPinned, tone: 'ok' },
  task: { icon: ClipboardList, tone: 'ok' },
  leave: { icon: CalendarOff, tone: 'warn' },
  referral: { icon: HeartPulse, tone: 'ok' },
  note: { icon: StickyNote, tone: 'muted' },
};

/** Where a tap on a notification goes in the CRM. */
export function crmHref(link?: string | null): string | null {
  if (!link) return null;
  const [k, id] = link.split(':');
  if (k === 'chat' && id) return `/admin/chat?t=${encodeURIComponent(id)}`;
  if (k === 'partner' && id) return `/admin/partners?id=${encodeURIComponent(id)}`;
  if (k === 'referral') return '/admin/pipeline';
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
export function NotificationBell({ placement = 'fixed' }: { placement?: 'fixed' | 'inline' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'list' | 'settings'>('list');
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [items, setItems] = useState<Item[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [unread, setUnread] = useState(0);
  const [toast, setToast] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      if (n.muted) return;
      // Already looking at that chat: no pop-up.
      const href = crmHref(n.link);
      if (href && typeof window !== 'undefined' && `${window.location.pathname}${window.location.search}` === href && !document.hidden) return;
      setToast(item);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 7000);
      if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          const d = new Notification(n.title, { body: n.body, tag: n.link ?? n.id, icon: '/brand/nexeagle-mark.png' });
          d.onclick = () => { window.focus(); if (href) router.push(href); d.close(); };
        } catch { /* some browsers only allow this from a service worker */ }
      }
    };
    window.addEventListener(NOTIFY_EVENT, on);
    return () => window.removeEventListener(NOTIFY_EVENT, on);
  }, [router]);

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
    setToast(null);
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

      {toast && !open && (
        <div className="nt-toast" role="status">
          <button type="button" className="nt-toast-main" onClick={() => void openItem(toast)}>
            {(() => { const k = KIND[toast.kind] ?? KIND.note; const Icon = k.icon; return <span className={`nt-ic tone-${k.tone}`} aria-hidden><Icon size={16} /></span>; })()}
            <span className="nt-main">
              <span className="nt-title">{toast.title}</span>
              {toast.body && <span className="nt-body">{toast.body}</span>}
            </span>
          </button>
          <button type="button" className="nt-iconbtn" onClick={() => setToast(null)} aria-label="Dismiss"><X size={15} /></button>
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
