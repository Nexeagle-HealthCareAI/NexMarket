'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlarmClock, AtSign, Bell, CheckCheck, Columns3, FileText, X } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { crmHref, NOTIFY_EVENT } from '@/components/crm/NotificationBell';
import { friendlyError } from '@/components/crm/ui';
import { istToday } from './shared';

interface Note { id: string; kind: string; title: string; body: string; link?: string | null; createdAt: string; read: boolean }
type Tab = 'all' | 'unread' | 'mentions' | 'reminders';
const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'unread', label: 'Unread' }, { key: 'mentions', label: 'Mentions' }, { key: 'reminders', label: 'Reminders' },
];
/** Everything the Team board sends: changes on my work, @mentions, and the morning reminder. */
export const WORK_KINDS = 'work*';
const kindFor = (t: Tab) => (t === 'mentions' ? 'work_mention' : t === 'reminders' ? 'work_due' : WORK_KINDS);

function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
}
const dayKey = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);

function Icon({ n }: { n: Note }) {
  if (n.kind === 'work_mention') return <AtSign size={16} aria-hidden />;
  if (n.kind === 'work_due') return <AlarmClock size={16} aria-hidden />;
  if (n.link?.startsWith('doc')) return <FileText size={16} aria-hidden />;
  return <Columns3 size={16} aria-hidden />;
}

/** How many Team board notifications are unread; refreshes when a new one arrives. */
export function useWorkUnread(): [number, () => void] {
  const [n, setN] = useState(0);
  const load = useCallback(() => {
    crm.get<{ total: number }>(`/api/v1/notifications/unread?kind=${encodeURIComponent(WORK_KINDS)}`).then((r) => setN(r.total)).catch(() => undefined);
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    const on = (e: Event) => { const k = (e as CustomEvent<{ kind?: string }>).detail?.kind ?? ''; if (k.startsWith('work')) load(); };
    window.addEventListener(NOTIFY_EVENT, on);
    return () => { clearTimeout(t); window.removeEventListener(NOTIFY_EVENT, on); };
  }, [load]);
  return [n, load];
}

/**
 * The Team board's own notifications, in a side panel: work given to me, moves, comments and @mentions on what I am on
 * or watching, sprints starting and ending, documents shared with me, and the morning reminder.
 */
export function UpdatesPanel({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('all');
  const [items, setItems] = useState<Note[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchPage = useCallback(async (t: Tab, before?: string) => {
    const sp = new URLSearchParams({ limit: '30', kind: kindFor(t) });
    if (t === 'unread') sp.set('unreadOnly', 'true');
    if (before) sp.set('before', before);
    return crm.get<{ items: Note[]; hasMore: boolean }>(`/api/v1/notifications?${sp}`);
  }, []);

  useEffect(() => {
    let off = false;
    fetchPage(tab).then((r) => { if (!off) { setItems(r.items); setMore(r.hasMore); setError(null); } }).catch((e) => { if (!off) setError(friendlyError(e)); });
    return () => { off = true; };
  }, [tab, fetchPage]);
  // A new one while the panel is open shows at the top.
  useEffect(() => {
    const on = (e: Event) => {
      const k = (e as CustomEvent<{ kind?: string }>).detail?.kind ?? '';
      if (k.startsWith('work')) fetchPage(tab).then((r) => { setItems(r.items); setMore(r.hasMore); }).catch(() => undefined);
    };
    window.addEventListener(NOTIFY_EVENT, on);
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => { window.removeEventListener(NOTIFY_EVENT, on); document.removeEventListener('keydown', k); };
  }, [tab, fetchPage, onClose]);

  const pick = (t: Tab) => { if (t !== tab) { setItems(null); setTab(t); } };
  const loadMore = async () => {
    if (!items?.length) return;
    try { const r = await fetchPage(tab, items[items.length - 1].createdAt); setItems([...items, ...r.items]); setMore(r.hasMore); } catch (e) { setError(friendlyError(e)); }
  };
  const open = (n: Note) => {
    if (!n.read) {
      void crm.post(`/api/v1/notifications/${n.id}/read`).then(onChanged).catch(() => undefined);
      setItems((x) => x?.map((y) => (y.id === n.id ? { ...y, read: true } : y)) ?? x);
    }
    const href = crmHref(n.link);
    if (href) { router.push(href, { scroll: false }); onClose(); }
  };
  const readAll = async () => {
    setBusy(true);
    try {
      await crm.post(`/api/v1/notifications/read-all?kind=${encodeURIComponent(WORK_KINDS)}`);
      setItems((x) => (tab === 'unread' ? [] : x?.map((y) => ({ ...y, read: true })) ?? x));
      onChanged();
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };

  const today = istToday(), yesterday = istToday(-1);
  const groups: { label: string; list: Note[] }[] = [];
  for (const n of items ?? []) {
    const k = dayKey(n.createdAt);
    const label = k === today ? 'Today' : k === yesterday ? 'Yesterday' : 'Earlier';
    const g = groups.find((x) => x.label === label);
    if (g) g.list.push(n); else groups.push({ label, list: [n] });
  }

  return (
    <>
      <div className="wk-scrim" onClick={onClose} aria-hidden />
      <aside className="wk-drawer wk-up" role="dialog" aria-label="Team board updates">
        <div className="wk-up-h">
          <Bell size={18} aria-hidden />
          <h2>Updates</h2>
          <button type="button" className="crm-btn is-secondary is-sm" disabled={busy} onClick={() => void readAll()}><CheckCheck size={15} aria-hidden /> Mark all read</button>
          <button type="button" className="wk-x" aria-label="Close updates" onClick={onClose}><X size={18} aria-hidden /></button>
        </div>
        <p className="crm-sub wk-up-sub">What changed on the work you are on, made, reported or watch. Turn kinds off in the bell&apos;s settings.</p>
        <div className="wk-up-tabs" role="group" aria-label="Show">
          {TABS.map((t) => <button key={t.key} type="button" className="crm-chip" aria-pressed={tab === t.key} onClick={() => pick(t.key)}>{t.label}</button>)}
        </div>
        <div className="wk-up-body">
          {error && <p className="crm-error" role="alert">{error}</p>}
          {items === null && !error && <p className="crm-sub">Loading…</p>}
          {items?.length === 0 && (
            <div className="wk-up-empty">
              <Bell size={26} aria-hidden />
              <strong>{tab === 'unread' ? 'All caught up' : tab === 'mentions' ? 'No mentions yet' : tab === 'reminders' ? 'No reminders yet' : 'Nothing yet'}</strong>
              <span className="crm-sub">{tab === 'mentions' ? 'When someone writes @your-name in a comment, it shows here.' : tab === 'reminders' ? 'Each morning you get one note of what is due today and late.' : 'Changes on your work show here: given to you, moved, commented on, finished.'}</span>
            </div>
          )}
          {groups.map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h3 className="wk-up-day">{g.label}</h3>
              <ul className="wk-up-list">
                {g.list.map((n) => (
                  <li key={n.id}>
                    <button type="button" className={`wk-up-row${n.read ? '' : ' is-new'}`} onClick={() => open(n)}>
                      <span className={`wk-up-ic is-${n.kind}`}><Icon n={n} /></span>
                      <span className="wk-up-txt">
                        <strong>{n.title}</strong>
                        {n.body && <span>{n.body}</span>}
                        <em>{ago(n.createdAt)}</em>
                      </span>
                      {!n.read && <span className="wk-up-dot" aria-label="Unread" />}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {more && <button type="button" className="crm-btn is-secondary is-sm wk-up-more" onClick={() => void loadMore()}>Show older</button>}
        </div>
      </aside>
    </>
  );
}
