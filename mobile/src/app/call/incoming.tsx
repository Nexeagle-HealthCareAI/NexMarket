import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, Vibration, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { T, toast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { ChatAvatar } from '../../components/ChatAvatar';
import { useSession } from '../../lib/session';
import { activeCalls, callErrorText, callsStatus, declineCall, fetchCall, joinCall, isRoom, markHandled, onAnswerAsked, setIncomingOpen, type Call } from '../../lib/calls';
import { showRing, stopRing } from '../../lib/callRing';
import { holdOverLock } from '../../../modules/lock-screen';
import { cachedThreads } from '../../lib/chat';
import { kvGet } from '../../lib/db';
import { lite } from '../../lib/perf';
import { C } from '../../theme';

const RING: number[] = [0, 900, 700];

/** Removes this call's notifications from the tray (the push, or the local one this screen rang with). */
async function clearCallNotifications(id: string) {
  void stopRing(id);
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    for (const n of shown) {
      const d = (n.request.content.data ?? {}) as Record<string, unknown>;
      const remote = (n.request.trigger as { remoteMessage?: { data?: Record<string, string> } } | null)?.remoteMessage?.data;
      if (String(d.link ?? remote?.link ?? '') === `call:${id}`) await Notifications.dismissNotificationAsync(n.request.identifier);
    }
  } catch { /* nothing to clear */ }
}

/**
 * Someone is calling (or a huddle started): full screen, dark, with big Answer and Decline buttons.
 * Rings (vibration loop, plus the call channel's sound) until answered, declined, the call stops ringing, or ringSeconds pass.
 */
export default function Incoming() {
  const { t } = useSession();
  const { id, answer: autoAnswer } = useLocalSearchParams<{ id: string; answer?: string }>();
  const [call, setCall] = useState<Call | null>(() => activeCalls().find((c) => c.id === id) ?? null);
  const [busy, setBusy] = useState(false);
  const done = useRef(false);
  const pulse = useRef(new Animated.Value(0)).current;

  const ringing = !call || (call.kind === 'call' && call.status === 'ringing');
  // A huddle or a meeting: nobody is rung; the screen offers Join.
  const huddle = isRoom(call?.kind);

  const close = () => {
    if (done.current) return;
    done.current = true;
    Vibration.cancel();
    void clearCallNotifications(id);
    if (router.canGoBack()) router.back(); else router.replace('/today');
  };

  // This screen is the one ringing: the push for the same call doesn't put a banner on top of it.
  // Over the lock screen while it rings (only the call screens ever are), like the phone's own dialer.
  useEffect(() => {
    markHandled(id);
    setIncomingOpen(id);
    const release = holdOverLock();
    return () => { setIncomingOpen(null); Vibration.cancel(); release(); };
  }, [id]);

  // Ring: vibration loop; and when the call came by polling (no push on this phone), one alert on the "calls" channel for the sound.
  useEffect(() => {
    if (huddle || !ringing) return;
    // Android: the phone-style ring (sound on repeat + vibration, Answer/Decline in the tray), the same one a push
    // starts when the app is closed; showing it again doesn't restart it.
    if (Platform.OS === 'android') {
      void showRing({ callId: id, caller: call?.startedByName ?? '', video: !!call?.video, ringSeconds: callsStatus().ringSeconds });
      return () => { void stopRing(id); };
    }
    try { Vibration.vibrate(RING, true); } catch { /* no vibrator */ }
    let localId: string | null = null;
    if (kvGet('pushMode') !== 'fcm') {
      void Notifications.scheduleNotificationAsync({
        content: { title: call?.startedByName ?? t('clVoiceCall'), body: call?.video ? t('clIncomingVideo') : t('clIncomingVoice'), data: { link: `call:${id}`, kind: 'call' }, sound: 'default' },
        trigger: null,
      }).then((x) => { localId = x; }).catch(() => undefined);
    }
    return () => {
      Vibration.cancel();
      if (localId) void Notifications.dismissNotificationAsync(localId).catch(() => undefined);
    };
  }, [huddle, ringing, id, call?.startedByName]); // eslint-disable-line react-hooks/exhaustive-deps

  // The call's state from the server every 2 s; closes when it stops ringing (or the huddle ends), and after ringSeconds.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const c = await fetchCall(id);
        if (!alive || done.current) return;
        setCall(c);
        if (isRoom(c.kind) ? c.status === 'ended' : c.status !== 'ringing') {
          if (c.kind === 'call' && c.status === 'active') toast(t('clOtherPhone'));
          close();
        }
      } catch { /* weak signal: keep ringing until the timeout */ }
    };
    void tick();
    const iv = setInterval(() => void tick(), 2000);
    const limit = setTimeout(() => { if (alive && !huddle) close(); }, Math.max(10, callsStatus().ringSeconds) * 1000);
    return () => { alive = false; clearInterval(iv); clearTimeout(limit); };
  }, [id, huddle]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (lite()) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const answer = async () => {
    if (busy) return;
    setBusy(true);
    Vibration.cancel();
    try {
      const cur = await joinCall(id);
      done.current = true;
      void clearCallNotifications(id);
      router.replace({ pathname: '/call/[id]', params: { id: cur.id } });
    } catch (e) {
      toast(callErrorText(t, e), { ms: 3500 });
      setBusy(false);
      close();
    }
  };
  // Answer pressed on the notification (or the full-screen ring): answer here at once.
  const answerRef = useRef(answer);
  answerRef.current = answer;
  useEffect(() => {
    if (autoAnswer === '1' && !huddle) void answerRef.current();
    return onAnswerAsked((x) => { if (x === id) void answerRef.current(); });
  }, [id, autoAnswer, huddle]);

  const decline = () => {
    Vibration.cancel();
    if (!huddle) void declineCall(id);
    close();
  };

  const thread = call ? cachedThreads().find((x) => x.id === call.threadId) : undefined;
  const name = call?.kind === 'meeting' ? t('mtMeeting') : huddle ? t('clTeamHuddle') : call?.startedByName ?? '…';
  const kindLine = call?.kind === 'meeting' ? t('mtOn') : huddle ? t('clHuddleStarted', { name: call?.startedByName ?? '' }) : call?.video ? t('clIncomingVideo') : t('clIncomingVoice');
  const where = thread && thread.kind === 'direct' ? thread.sub : thread?.kind === 'agent' ? t('chatOffice') : null;
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.ink }} edges={['top', 'bottom', 'left', 'right']}>
      <StatusBar style="light" />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, paddingHorizontal: 24 }} accessible accessibilityLiveRegion="polite"
        accessibilityLabel={`${huddle ? kindLine : t('clCallingYou', { name })}. ${huddle ? '' : kindLine}`}>
        <View style={{ alignItems: 'center', justifyContent: 'center', width: 180, height: 180 }}>
          <Animated.View style={{ position: 'absolute', width: 168, height: 168, borderRadius: 84, borderWidth: 3, borderColor: C.mint, opacity: ringOpacity, transform: [{ scale }] }} />
          <ChatAvatar kind={huddle ? 'team' : 'direct'} name={name} photoUrl={thread?.kind === 'direct' ? thread.photoUrl : null} size={132} dark />
        </View>
        <T style={{ color: '#fff', fontSize: 28, fontWeight: '800', textAlign: 'center' }} numberOfLines={2}>{name}</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name={call?.video ? 'video' : huddle ? 'users' : 'phone'} size={20} color={C.mint} />
          <T style={{ color: C.mint, fontSize: 18, fontWeight: '700', textAlign: 'center' }}>{kindLine}</T>
        </View>
        {where ? <T style={{ color: C.sideText, fontSize: 15, textAlign: 'center' }} numberOfLines={1}>{where}</T> : null}
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 24, paddingBottom: 48 }}>
        <RoundAction color={C.bad} icon={huddle ? 'close' : 'phoneOff'} label={huddle ? t('clNotNow') : t('clDecline')} onPress={decline} />
        <RoundAction color={C.ok} icon={huddle ? 'users' : call?.video ? 'video' : 'phone'} label={huddle ? t('clJoin') : t('clAnswer')} onPress={() => void answer()} busy={busy} />
      </View>
    </SafeAreaView>
  );
}

function RoundAction({ color, icon, label, onPress, busy }: { color: string; icon: 'phone' | 'phoneOff' | 'video' | 'users' | 'close'; label: string; onPress: () => void; busy?: boolean }) {
  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      <Pressable onPress={onPress} disabled={busy} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!busy, busy: !!busy }} hitSlop={10}
        style={({ pressed }) => [{ width: 72, height: 72, borderRadius: 36, backgroundColor: color, alignItems: 'center', justifyContent: 'center', elevation: 6,
          shadowColor: color, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }, (pressed || busy) && { opacity: 0.75 }]}>
        <Icon name={icon} size={32} color="#fff" strokeWidth={2.4} />
      </Pressable>
      <T style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>{label}</T>
    </View>
  );
}
