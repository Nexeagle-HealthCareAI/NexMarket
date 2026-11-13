import React, { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { T, toast } from './ui';
import { Icon, type IconName } from './Icon';
import { useSession, useSync } from '../lib/session';
import {
  callEmoji, callErrorText, callNoteText, cannotCall, joinCall, joinMeeting, liveCallIn, meetingsIn, openIncoming, peopleIn, refreshActive, refreshCallsStatus, ringingForMe,
  startCall, useActiveCalls, useCallsStatus, useCurrentCall, type Call, type CallNote, type Meeting,
} from '../lib/calls';
import { useChatVersion } from '../lib/chat';
import { dayShort, timeOf } from '../lib/format';
import { kvGet } from '../lib/db';
import { fullScreenAllowed } from '../lib/callRing';
import { C } from '../theme';

type TFn = ReturnType<typeof useSession>['t'];

/** Starts a call in this chat and opens the call screen; explains in a toast when it can't. */
export async function callFromChat(t: TFn, threadId: string, video: boolean): Promise<void> {
  try {
    const cur = await startCall(threadId, video);
    router.push({ pathname: '/call/[id]', params: { id: cur.id } });
  } catch (e) {
    toast(callErrorText(t, e), { ms: 3500 });
  }
}

/** Joins a call going on (or goes back to the one running on this phone). */
export async function joinFromBanner(t: TFn, c: Call): Promise<void> {
  try {
    const cur = await joinCall(c.id);
    router.push({ pathname: '/call/[id]', params: { id: cur.id } });
  } catch (e) {
    toast(callErrorText(t, e), { ms: 3500 });
    void refreshActive();
  }
}

/** 44 px round header button (dark header). Dimmed when there is no signal; tapping then explains why. */
function HeadBtn({ icon, label, onPress, dim, text }: { icon: IconName; label: string; onPress: () => void; dim?: boolean; text?: string }) {
  return (
    <Pressable onPress={onPress} hitSlop={4} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!dim }}
      style={({ pressed }) => [{ height: 44, minWidth: 44, paddingHorizontal: text ? 12 : 0, borderRadius: 22, borderWidth: 1, borderColor: '#3a4560', backgroundColor: '#1a2236',
        flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', opacity: dim ? 0.45 : 1 }, pressed && { opacity: 0.75 }]}>
      <Icon name={icon} color="#fff" size={20} />
      {text ? <T style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{text}</T> : null}
    </Pressable>
  );
}

/**
 * Call buttons for a chat header: voice + video (office and one-to-one chats), or one "Huddle" button (Field team).
 * Hidden while calls are switched off; dimmed without signal.
 */
export function CallButtons({ threadId, kind, name }: { threadId: string; kind: 'agent' | 'team' | 'direct'; name: string }) {
  const { t } = useSession();
  const status = useCallsStatus();
  const online = useSync().online;
  if (!status.on || !threadId) return null;
  const go = async (video: boolean) => {
    const why = await cannotCall();
    if (why) { toast(callErrorText(t, why), { ms: 3500 }); return; }
    void callFromChat(t, threadId, video);
  };
  if (kind === 'team') return <HeadBtn icon="users" text={t('clHuddle')} label={t('clHuddleA11y')} dim={!online} onPress={() => void go(false)} />;
  return (
    <>
      <HeadBtn icon="phone" label={t('clVoiceA11y', { name })} dim={!online} onPress={() => void go(false)} />
      <HeadBtn icon="video" label={t('clVideoA11y', { name })} dim={!online} onPress={() => void go(true)} />
    </>
  );
}

/** "Huddle going on · 3 people · Join" (or "Back to call" when this phone is in it). */
export function CallBanner({ call, where }: { call: Call; where?: string }) {
  const { t } = useSession();
  const cur = useCurrentCall();
  const mineNow = cur?.id === call.id;
  const n = Math.max(1, peopleIn(call));
  const head = call.kind === 'meeting' ? t('mtOn') : call.kind === 'huddle' ? t('clHuddleOn') : t('clCallOn');
  const line = [where ? `${head} ${t('clInChat', { name: where })}` : head, t('clPeopleN', { n })].join(' · ');
  const action = mineNow ? t('clBackToCall') : t('clJoin');
  const open = () => {
    if (mineNow) router.push({ pathname: '/call/[id]', params: { id: call.id } });
    else void joinFromBanner(t, call);
  };
  return (
    <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`${line}. ${action}`}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.okSoft, borderColor: '#9fdcbf', borderWidth: 1, borderRadius: 16,
        paddingLeft: 12, paddingRight: 8, paddingVertical: 8, minHeight: 56 }, pressed && { opacity: 0.85 }]}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.ok, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={call.video ? 'video' : call.kind !== 'call' ? 'users' : 'phone'} color="#fff" size={18} />
      </View>
      <T style={{ flex: 1, color: C.okInk, fontWeight: '700', fontSize: 15 }} numberOfLines={2}>{line}</T>
      <View style={{ minHeight: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: C.ok, justifyContent: 'center' }}>
        <T style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{action}</T>
      </View>
    </Pressable>
  );
}

/** The banner for one chat, polled every 5 s while the chat is open. */
export function ChatCallBanner({ threadId }: { threadId: string }) {
  const list = useActiveCalls(true);
  const c = liveCallIn(list, threadId);
  if (!c) return null;
  return <View style={{ paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#eef1f6' }}><CallBanner call={c} /></View>;
}

/**
 * Meetings planned for this chat that haven't started: when they are, and "Start meeting" once the room is open
 * (15 minutes before). One going on is shown by the call banner above, with Join.
 */
export function ChatMeetings({ threadId }: { threadId: string }) {
  const { t, lang } = useSession();
  const version = useChatVersion();
  const status = useCallsStatus();
  const [rows, setRows] = useState<Meeting[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () => meetingsIn(threadId).then((r) => { if (live) setRows(r); }).catch(() => undefined);
    void load();
    const timer = setInterval(load, 60000);
    return () => { live = false; clearInterval(timer); };
  }, [threadId, version]);
  const coming = rows.filter((m) => m.status === 'scheduled').slice(0, 2);
  if (coming.length === 0) return null;
  const when = (iso: string) => {
    const d = new Date(iso); const now = new Date();
    const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
    return `${days === 0 ? t('mtToday') : days === 1 ? t('mtTomorrow') : dayShort(lang, d)}, ${timeOf(lang, iso)}`;
  };
  const start = async (m: Meeting) => {
    if (busy) return;
    setBusy(true);
    try { const cur = await joinMeeting(m.id); router.push({ pathname: '/call/[id]', params: { id: cur.id } }); }
    catch (e) { toast(callErrorText(t, e) || t('mtCantJoin'), { ms: 3500 }); }
    finally { setBusy(false); }
  };
  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 8, gap: 8, backgroundColor: '#eef1f6' }}>
      {coming.map((m) => {
        const open = m.canJoin && status.on;
        const line = t('mtComing', { when: when(m.startsAt), n: m.minutes });
        return (
          <View key={m.id} accessible={!open} accessibilityLabel={`${m.title}. ${line}. ${open ? '' : t('mtOpens')}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderColor: C.border, borderWidth: 1, borderRadius: 16, paddingLeft: 12, paddingRight: 8, paddingVertical: 8, minHeight: 56 }}>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.blueSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="calendar" color={C.blue} size={18} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T style={{ fontWeight: '800', fontSize: 15 }} numberOfLines={1}>{m.title}</T>
              <T style={{ color: C.text2, fontSize: 13 }} numberOfLines={2}>{open ? line : `${line}. ${t('mtOpens')}`}</T>
            </View>
            {open ? (
              <Pressable onPress={() => void start(m)} disabled={busy} accessibilityRole="button" accessibilityLabel={`${t('mtStart')}: ${m.title}`}
                style={({ pressed }) => [{ minHeight: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: C.ok, justifyContent: 'center' }, (pressed || busy) && { opacity: 0.7 }]}>
                <T style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>{t('mtStart')}</T>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** A call in the conversation: centred pill with what happened, and "Call back" for 1:1 calls. */
export function CallPill({ note, mine, threadId, canCall }: { note: CallNote; mine: boolean; threadId: string; canCall: boolean }) {
  const { t } = useSession();
  const status = useCallsStatus();
  const missed = note.status === 'missed' || note.status === 'declined';
  const text = callNoteText(t, note, mine);
  const back = canCall && status.on && note.kind === 'call';
  return (
    <View style={{ alignSelf: 'center', alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginVertical: 6, paddingLeft: 14, paddingRight: back ? 6 : 14,
      paddingVertical: 6, borderRadius: 22, backgroundColor: missed ? C.badSoft : '#ffffff', borderWidth: 1, borderColor: missed ? '#f3c5c0' : C.border, maxWidth: '94%' }}
      accessible={!back} accessibilityLabel={text}>
      <Icon name={note.kind !== 'call' ? 'users' : note.video ? 'video' : 'phone'} size={17} color={missed ? C.bad : C.okInk} />
      <T style={{ color: missed ? C.bad : C.text3, fontWeight: '700', fontSize: 15, flexShrink: 1 }}>{text}</T>
      {back ? (
        <Pressable onPress={() => void callFromChat(t, threadId, note.video)} accessibilityRole="button" accessibilityLabel={`${t('clCallBack')}: ${note.video ? t('clVideoCall') : t('clVoiceCall')}`}
          style={({ pressed }) => [{ minHeight: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: C.ok, flexDirection: 'row', alignItems: 'center', gap: 6 }, pressed && { opacity: 0.8 }]}>
          <Icon name={note.video ? 'video' : 'phone'} size={16} color="#fff" />
          <T style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>{t('clCallBack')}</T>
        </Pressable>
      ) : null}
    </View>
  );
}

export const callPreview = (t: TFn, note: CallNote, mine: boolean) => `${callEmoji(note)} ${callNoteText(t, note, mine)}`;

/**
 * Mounted once in the root layout: checks for calls when the app comes to the front (and every 20 s while open
 * if this phone gets no push), and shows the incoming-call screen when someone is calling.
 */
export function CallWatcher() {
  const status = useCallsStatus();
  const list = useActiveCalls(false);
  const [front, setFront] = useState(AppState.currentState === 'active');
  const lastStatus = useRef(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      const on = st === 'active';
      setFront(on);
      if (on) {
        if (Date.now() - lastStatus.current > 60_000) { lastStatus.current = Date.now(); void refreshCallsStatus(true); }
        void refreshActive();
      }
    });
    lastStatus.current = Date.now();
    void refreshCallsStatus(true).then(() => refreshActive());
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!status.on || !front) return;
    void refreshActive();
    const iv = setInterval(() => { if (kvGet('pushMode') !== 'fcm') void refreshActive(); }, 20_000);
    return () => clearInterval(iv);
  }, [status.on, front]);
  const ring = front ? ringingForMe(list) : null;
  useEffect(() => { if (ring) openIncoming(ring.id); }, [ring?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * Android 14+ can stop an app from ringing full screen (the phone-style incoming call). When it has, this says so and
 * opens the setting. Shown only while calls are switched on for the hospital.
 */
export function FullScreenCallsBanner() {
  const { t } = useSession();
  const on = useCallsStatus().on;
  const [allowed, setAllowed] = useState(true);
  useEffect(() => {
    if (Platform.OS !== 'android' || !on) return;
    const check = () => { void fullScreenAllowed().then(setAllowed); };
    check();
    // Back from the phone's settings: check again.
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
    return () => sub.remove();
  }, [on]);
  if (Platform.OS !== 'android' || !on || allowed) return null;
  const open = async () => {
    try { await Linking.sendIntent('android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT'); }
    catch { void Linking.openSettings(); }
  };
  return (
    <Pressable onPress={() => void open()} accessibilityRole="button" accessibilityLabel={`${t('clFsOffTitle')}. ${t('clFsAllow')}`}
      style={{ margin: 12, flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: C.warnSoft, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#f5d9a8' }}>
      <Icon name="phone" color={C.warnInk} />
      <View style={{ flex: 1 }}>
        <T style={{ fontWeight: '800', color: C.warnInk }}>{t('clFsOffTitle')}</T>
        <T style={{ color: C.warnInk, fontSize: 13 }}>{t('clFsOffBody')}</T>
      </View>
      <T style={{ color: C.blueInk, fontWeight: '800' }}>{t('clFsAllow')}</T>
    </Pressable>
  );
}
