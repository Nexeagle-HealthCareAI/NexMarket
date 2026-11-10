import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { api } from './api';
import { kvGet, kvJson, kvSet, q } from './db';

/**
 * Notifications on the phone.
 *
 * - Push: the phone registers its Firebase token with the server, which pushes chat messages,
 *   escalations, new blocks, tasks, leave decisions… even when the app is closed.
 * - Without Firebase set up (or without signal for the token), the sync loop still picks up new ones
 *   and shows them as local notifications while the app is running, so nothing is missed in the field.
 * - Inbox: everything is also listed on the Notifications screen, read or not.
 */

export interface InboxItem { id: string; kind: string; title: string; body: string; link?: string | null; createdAt: string; read: boolean }
export interface NotifySettings { kinds: { kind: string; label: string; on: boolean }[]; pushConfigured: boolean; phones: number }

/** Android channels: people can tune each one in the phone's own settings too. */
const CHANNELS: { id: string; name: string; importance: Notifications.AndroidImportance; description: string }[] = [
  { id: 'chat', name: 'Chat messages', importance: Notifications.AndroidImportance.HIGH, description: 'Messages from the office, the field team and one-to-one chats' },
  { id: 'alerts', name: 'Escalations', importance: Notifications.AndroidImportance.MAX, description: 'Escalations raised and resolved' },
  { id: 'updates', name: 'Work updates', importance: Notifications.AndroidImportance.DEFAULT, description: 'New blocks, tasks, leave, patients and notes from the office' },
];
const channelOf = (kind: string) => (kind === 'chat' || kind === 'team_chat' ? 'chat' : kind === 'escalation' ? 'alerts' : 'updates');

// ─── Change notifications for screens ───
const listeners = new Set<() => void>();
let version = 0;
function changed() { version++; listeners.forEach((l) => { try { l(); } catch { /* keep going */ } }); }
export function useNotifyVersion(): number {
  const [, set] = useState(0);
  useEffect(() => {
    const l = () => set(version);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return version;
}

export const cachedInbox = (): InboxItem[] => kvJson<InboxItem[]>('notifInbox', []);
export const cachedNotifyUnread = (): number => Number(kvGet('notifUnread') ?? '0') || 0;

/**
 * The chat on screen (top of the stack), and whether the app is in the foreground with it.
 * Its messages don't pop up while the agent is reading it, and tapping one of its alerts doesn't open it twice.
 */
let openChat: string | null = null;
let chatActive = false;
export function setOpenChat(id: string | null, active = id != null) { openChat = id; chatActive = active; }

// ─── Setup (once, at app start) ───
let setUp = false;
export async function setupNotifications(): Promise<void> {
  if (setUp) return;
  setUp = true;
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      const link = String(n.request.content.data?.link ?? '');
      const reading = !!openChat && chatActive && link === `chat:${openChat}`;
      // Every chat message makes a sound; the chat you're reading just doesn't pop up a banner too.
      return { shouldShowBanner: !reading, shouldShowList: !reading, shouldPlaySound: true, shouldSetBadge: true };
    },
  });
  if (Platform.OS === 'android') {
    for (const c of CHANNELS) {
      await Notifications.setNotificationChannelAsync(c.id, {
        name: c.name, importance: c.importance, description: c.description,
        vibrationPattern: c.id === 'updates' ? [0, 150] : [0, 250, 120, 250], lightColor: '#38f6a9', showBadge: true,
      }).catch(() => undefined);
    }
  }
  // A new token (Firebase rotates them now and then): register it again.
  Notifications.addPushTokenListener((tok) => { if (kvGet('agentId')) void sendToken(String(tok.data)); });
}

/** Ask for permission (Android 13+ shows the system prompt once). */
export async function askPermission(): Promise<boolean> {
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  if (!cur.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}
export const permissionGranted = async () => (await Notifications.getPermissionsAsync()).granted;

async function sendToken(token: string): Promise<void> {
  const r = await api<{ registered: boolean; pushConfigured: boolean }>('/api/v1/notifications/devices', {
    method: 'POST', body: JSON.stringify({ token, platform: Platform.OS, deviceId: kvGet('deviceId') }), timeoutMs: 15000,
  });
  kvSet('pushToken', token);
  // Firebase push from the server works: no need for local copies of the same alerts.
  kvSet('pushMode', r.pushConfigured ? 'fcm' : 'local');
}

/** After sign-in: permission, then the Firebase token to the server. Falls back to local alerts if either fails. */
export async function registerPush(): Promise<void> {
  try {
    await setupNotifications();
    if (!(await askPermission())) { kvSet('pushMode', 'off'); return; }
    const tok = await Notifications.getDevicePushTokenAsync();
    await sendToken(String(tok.data));
  } catch {
    // No google-services.json in this build, or no signal: alerts still come through the sync loop.
    if (kvGet('pushMode') !== 'fcm') kvSet('pushMode', 'local');
  }
}

/** Signing out: this phone stops getting this person's alerts. */
export async function unregisterPush(): Promise<void> {
  const token = kvGet('pushToken');
  if (token) await api('/api/v1/notifications/devices/remove', { method: 'POST', body: JSON.stringify({ token }), timeoutMs: 8000 }).catch(() => undefined);
  kvSet('pushToken', null);
  kvSet('pushMode', null);
  kvSet('notifInbox', null);
  kvSet('notifUnread', null);
  kvSet('notifShown', null);
  await Notifications.setBadgeCountAsync(0).catch(() => undefined);
}

// ─── Inbox ───
export async function refreshInbox(): Promise<InboxItem[]> {
  const r = await api<{ items: InboxItem[]; unread: number }>('/api/v1/notifications?limit=50', { timeoutMs: 15000 });
  kvSet('notifInbox', JSON.stringify(r.items));
  setUnread(r.unread);
  changed();
  return r.items;
}

function setUnread(n: number) {
  if (String(n) !== kvGet('notifUnread')) { kvSet('notifUnread', String(n)); changed(); }
  void Notifications.setBadgeCountAsync(n).catch(() => undefined);
}

export async function markRead(id: string): Promise<void> {
  const list = cachedInbox();
  const was = list.find((x) => x.id === id);
  if (was && !was.read) {
    kvSet('notifInbox', JSON.stringify(list.map((x) => (x.id === id ? { ...x, read: true } : x))));
    setUnread(Math.max(0, cachedNotifyUnread() - 1));
    changed();
  }
  await api(`/api/v1/notifications/${id}/read`, { method: 'POST', body: '{}', timeoutMs: 8000 }).catch(() => undefined);
}

export async function markAllRead(): Promise<void> {
  await api('/api/v1/notifications/read-all', { method: 'POST', body: '{}', timeoutMs: 10000 });
  kvSet('notifInbox', JSON.stringify(cachedInbox().map((x) => ({ ...x, read: true }))));
  setUnread(0);
  changed();
  await Notifications.dismissAllNotificationsAsync().catch(() => undefined);
}

export const loadSettings = () => api<NotifySettings>('/api/v1/notifications/settings', { timeoutMs: 10000 });
export const saveSettings = (muted: string[]) => api('/api/v1/notifications/settings', { method: 'PUT', body: JSON.stringify({ muted }), timeoutMs: 10000 });
export const sendTest = () => api('/api/v1/notifications/test', { method: 'POST', body: '{}', timeoutMs: 10000 });

/**
 * Called by the sync loop: updates the unread count and, when the server can't push to this phone,
 * shows anything new as a local notification (each only once).
 */
export async function pollNotifications(): Promise<void> {
  const r = await api<{ items: InboxItem[]; unread: number }>('/api/v1/notifications?unreadOnly=true&limit=20', { timeoutMs: 10000 });
  setUnread(r.unread);
  const mode = kvGet('pushMode');
  const shown = new Set(kvJson<string[]>('notifShown', []));
  const since = kvGet('notifSince');
  kvSet('notifSince', new Date().toISOString());
  if (!since) { kvSet('notifShown', JSON.stringify(r.items.map((x) => x.id))); return; } // first run after sign-in: don't replay old ones
  const fresh = r.items.filter((x) => !shown.has(x.id) && x.createdAt > new Date(Date.parse(since) - 5 * 60_000).toISOString());
  if (mode !== 'fcm' && mode !== 'off') {
    for (const x of fresh.slice(0, 5).reverse()) {
      await Notifications.scheduleNotificationAsync({
        content: { title: x.title, body: x.body, data: { id: x.id, link: x.link ?? '', kind: x.kind } },
        trigger: Platform.OS === 'android' ? { channelId: channelOf(x.kind) } : null,
      }).catch(() => undefined);
    }
  }
  fresh.forEach((x) => shown.add(x.id));
  kvSet('notifShown', JSON.stringify([...shown].slice(-200)));
  if (fresh.length) changed();
}

// ─── Opening one ───
/** Where a notification takes the agent in the app. */
export function openLink(link?: string | null) {
  const [k, id] = (link ?? '').split(':');
  if (k === 'chat' && id) {
    if (openChat === id) return; // already on screen
    // From another chat, swap it rather than stacking chat on chat.
    if (openChat) router.replace({ pathname: '/chat/[id]', params: { id } });
    else router.push({ pathname: '/chat/[id]', params: { id } });
  }
  else if (k === 'partner' && id && q.contact(id)) router.push({ pathname: '/partner/[id]', params: { id } });
  else if (k === 'referral') router.push('/patients');
  else if (k === 'money') router.push('/money');
  else if (k === 'leave') router.push('/leave');
  else if (k === 'assignments') router.push('/shift');
  else if (k === 'tasks') router.push('/today');
  else if (k === 'field-survey' && id) router.push({ pathname: '/field-survey', params: { id } });
  else router.push('/notifications');
}

/** A notification the agent tapped (from the tray, or the one that opened the app). */
export function handleResponse(res: Notifications.NotificationResponse | null) {
  if (!res) return;
  const d = (res.notification.request.content.data ?? {}) as Record<string, unknown>;
  const trig = res.notification.request.trigger as { remoteMessage?: { data?: Record<string, string> } } | null;
  const data = { ...(trig?.remoteMessage?.data ?? {}), ...d } as Record<string, unknown>;
  const id = String(data.id ?? '');
  if (id) void markRead(id);
  openLink(String(data.link ?? ''));
}
