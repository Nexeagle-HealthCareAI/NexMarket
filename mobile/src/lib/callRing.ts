import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import notifee, { AndroidCategory, AndroidImportance, AndroidNotificationSetting, AndroidVisibility, EventType, type Event } from 'react-native-notify-kit';
import { post } from './api';
import { kvGet } from './db';
import { translate, type Lang } from '../i18n';

/**
 * Incoming calls ring like a phone call (Android): a full-screen alert that lights the screen (also when locked or when
 * the app was closed), keeps ringing until answered, declined or stopped, with Answer and Decline on the notification.
 *
 * The server sends a data-only push for a ringing call (so nothing shows by itself) and another one, "call-stop", when it
 * stops ringing (answered elsewhere, declined, missed or the caller hung up). This file is loaded before the app itself
 * (see index.ts), because Android may start the app in the background just to handle such a push.
 */

export const CALL_PUSH_TASK = 'nexeagle-call-push';
const CHANNEL = 'call-ring';
const ringId = (callId: string) => `call:${callId}`;

const lang = (): Lang => (kvGet('lang') as Lang | null) ?? 'hi';

let channel: Promise<string> | null = null;
function ensureChannel(): Promise<string> {
  // A channel's sound and vibration can't change once created: a new id if they ever need to.
  channel ??= notifee.createChannel({
    id: CHANNEL,
    name: translate(lang(), 'clRingChannel'),
    description: translate(lang(), 'clRingChannelInfo'),
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PUBLIC,
    sound: 'default',
    vibration: true,
    vibrationPattern: [300, 900, 600, 900],
  });
  return channel;
}

export interface Ring { callId: string; caller: string; video: boolean; ringSeconds?: number }

/** Rings for this call: full screen when the phone allows it, otherwise a ringing heads-up notification. Safe to repeat. */
export async function showRing(r: Ring): Promise<void> {
  if (Platform.OS !== 'android' || !r.callId) return;
  try {
    await ensureChannel();
    const l = lang();
    await notifee.displayNotification({
      id: ringId(r.callId),
      title: r.caller || translate(l, 'clVoiceCall'),
      body: translate(l, r.video ? 'clIncomingVideo' : 'clIncomingVoice'),
      data: { callId: r.callId, link: `call:${r.callId}`, kind: 'call' },
      android: {
        channelId: CHANNEL,
        category: AndroidCategory.CALL,
        importance: AndroidImportance.HIGH,
        visibility: AndroidVisibility.PUBLIC,
        smallIcon: 'notification_icon',
        color: '#0a72d6',
        ongoing: true,
        autoCancel: false,
        loopSound: true,          // keeps ringing until answered, declined or cancelled
        onlyAlertOnce: true,      // showing it again (from the incoming screen) doesn't restart the ring
        lightUpScreen: true,
        timeoutAfter: Math.max(10, r.ringSeconds ?? 45) * 1000,
        pressAction: { id: 'default', launchActivity: 'default' },
        fullScreenAction: { id: 'default', launchActivity: 'default' },
        actions: [
          { title: translate(l, 'clDecline'), pressAction: { id: 'decline' } },
          { title: translate(l, 'clAnswer'), pressAction: { id: 'answer', launchActivity: 'default' } },
        ],
      },
    });
  } catch { /* the incoming screen still rings by vibration */ }
}

/** Stops the ringing for this call (answered, declined, ended, or the screen took over). */
export async function stopRing(callId: string): Promise<void> {
  if (Platform.OS !== 'android' || !callId) return;
  try { await notifee.cancelNotification(ringId(callId)); } catch { /* not ringing */ }
}

/** Whether Android lets this app ring full screen (Android 14+ can switch it off per app). */
export async function fullScreenAllowed(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const s = await notifee.getNotificationSettings();
    return s.android?.fullScreenIntent !== AndroidNotificationSetting.DISABLED;
  } catch { return true; }
}

const declineFromTray = async (callId: string) => {
  await stopRing(callId);
  await post(`/api/v1/calls/${callId}/decline`, {}, 10000).catch(() => undefined);
};

/** What a tap on the ringing notification asks for: open the incoming screen, answer at once, or decline. */
export type RingTap = { callId: string; action: 'open' | 'answer' | 'decline' };
export function ringTapOf(e: Pick<Event, 'type' | 'detail'>): RingTap | null {
  const callId = String(e.detail.notification?.data?.callId ?? '');
  if (!callId) return null;
  if (e.type === EventType.ACTION_PRESS) {
    const id = e.detail.pressAction?.id;
    return { callId, action: id === 'decline' ? 'decline' : id === 'answer' ? 'answer' : 'open' };
  }
  if (e.type === EventType.PRESS) return { callId, action: 'open' };
  return null;
}

// ─── Wired up as soon as the JS bundle loads (also in the background, without any screen) ───
if (Platform.OS === 'android') {
  type Payload = { data?: Record<string, unknown> & { data?: Record<string, unknown> } };
  TaskManager.defineTask<Payload>(CALL_PUSH_TASK, async ({ data, error }) => {
    if (error || !data) return;
    // The Firebase message's data, wherever this version of expo-notifications puts it.
    const outer = data as Record<string, unknown>;
    const inner = outer.data as Record<string, unknown> | undefined;
    const raw = ((inner && typeof inner.data === 'object' && inner.data) || inner || outer) as Record<string, unknown>;
    const kind = String(raw.kind ?? '');
    const callId = String(raw.callId ?? '');
    if (!callId) return;
    if (kind === 'call-stop') { await stopRing(callId); return; }
    if (kind !== 'call') return;
    // App on screen: its own listener opens the incoming-call screen, which rings.
    if (AppState.currentState === 'active') return;
    await showRing({ callId, caller: String(raw.caller ?? ''), video: raw.video === '1' });
  });
  void Notifications.registerTaskAsync(CALL_PUSH_TASK).catch(() => undefined);

  // Decline from the notification without opening the app. (Answer and taps open the app; it handles those.)
  notifee.onBackgroundEvent(async (e) => {
    const tap = ringTapOf(e);
    if (tap?.action === 'decline') await declineFromTray(tap.callId);
  });
}

export { declineFromTray };
