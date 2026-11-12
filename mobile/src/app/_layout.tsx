import '../lib/location'; // registers the background location task before anything else runs
import '../lib/fieldSurvey'; // and the field-mapping route task
import { registerGlobals } from '@livekit/react-native';
import React, { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { ActivityIndicator, AppState, View } from 'react-native';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { enableFreeze } from 'react-native-screens';
import { SessionProvider, useSession } from '../lib/session';
import { PrefsProvider, persistPrefs } from '../lib/prefs';
import { kvGet, kvSet } from '../lib/db';
import { pendingPasswordChange } from '../lib/api';
import { syncNow } from '../lib/sync';
import { handleResponse, registerPush, setupNotifications } from '../lib/notifications';
import { ToastHost } from '../components/ui';
import { CelebrateHost } from '../components/Vita';
import { C } from '../theme';
import { LockScreen } from '../components/LockScreen';
import { lockNow, lockState, useLock } from '../lib/lock';
import { useLite } from '../lib/perf';
import { startPresence } from '../lib/presence';
import { askToAnswer, declineCall, openIncoming } from '../lib/calls';
import notifee, { EventType } from 'react-native-notify-kit';
import { ringTapOf, stopRing, type RingTap } from '../lib/callRing';
import { CallWatcher } from '../components/CallParts';

// WebRTC for LiveKit calls (voice and video through the hospital's own server): once, before any call starts.
registerGlobals();

SplashScreen.preventAutoHideAsync().catch(() => undefined);
// Screens the agent can't see (behind the one on top, or other tabs) stop re-rendering until shown again.
enableFreeze(true);

function Gate() {
  const { ready, agent } = useSession();
  const lock = useLock();
  const light = useLite();
  const segments = useSegments();

  // Coming back to the app after a while asks for the PIN or fingerprint again.
  const awayAt = useRef<number | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'background') awayAt.current = Date.now();
      else if (st === 'active' && awayAt.current != null) {
        const away = Date.now() - awayAt.current;
        awayAt.current = null;
        if (lockState().pinSet && away >= lockState().afterMin * 60_000) lockNow();
      }
    });
    return () => sub.remove();
  }, []);
  // Signed-out screens: sign-in and forgot password.
  const onLogin = segments[0] === 'login' || segments[0] === 'forgot';
  const inTabs = segments[0] === '(tabs)';

  // Signing in or out clears the kv table: keep this phone's Easy to use settings.
  useEffect(() => { if (ready) persistPrefs(); }, [ready, agent?.agentId]);

  // Vita's tour, once after sign-in, when the agent first reaches the main tabs (replay from Me).
  useEffect(() => {
    if (!ready || !agent || !inTabs || lock.locked) return;
    if (kvGet('uxTourSeen') === '1') return;
    kvSet('uxTourSeen', '1');
    router.push('/tour');
  }, [ready, agent, inTabs, lock.locked]);

  useEffect(() => {
    if (!ready) return;
    SplashScreen.hideAsync().catch(() => undefined);
    if (!agent && !onLogin) router.replace('/login');
    else if (agent && onLogin) router.replace(pendingPasswordChange() ? '/set-password' : '/today');
  }, [ready, agent, onLogin]);

  // Notifications: once signed in, register this phone for push and open whatever the agent taps.
  const registeredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !agent) return;
    void setupNotifications();
    if (registeredFor.current !== agent.agentId) {
      registeredFor.current = agent.agentId;
      void registerPush();
    }
    const sub = Notifications.addNotificationResponseReceivedListener(handleResponse);
    // A patient's stage changed at the hospital while the app is open: fetch it now, so My patients updates
    // at once instead of at the next sync.
    const received = Notifications.addNotificationReceivedListener((n) => {
      const link = String(n.request.content.data?.link ?? (n.request.trigger as { remoteMessage?: { data?: Record<string, string> } } | null)?.remoteMessage?.data?.link ?? '');
      if (link.startsWith('referral:') || link.startsWith('money:')) void syncNow(true).catch(() => undefined);
      // Someone is calling while the app is open: straight to the incoming-call screen (huddles just notify).
      const kind = String(n.request.content.data?.kind ?? (n.request.trigger as { remoteMessage?: { data?: Record<string, string> } } | null)?.remoteMessage?.data?.kind ?? '');
      if (link.startsWith('call:') && kind !== 'huddle') openIncoming(link.slice(5));
    });
    // The tap that opened the app from the tray.
    Notifications.getLastNotificationResponseAsync().then((r) => {
      if (r) { handleResponse(r); void Notifications.clearLastNotificationResponseAsync().catch(() => undefined); }
    }).catch(() => undefined);
    // The phone-style ring (Android): a tap opens the incoming screen, Answer answers, Decline declines.
    const onRingTap = (tap: RingTap | null) => {
      if (!tap) return;
      if (tap.action === 'decline') { void stopRing(tap.callId); void declineCall(tap.callId); return; }
      if (tap.action === 'answer') askToAnswer(tap.callId);
      else openIncoming(tap.callId, true);
    };
    const ringSub = notifee.onForegroundEvent((e) => onRingTap(ringTapOf(e)));
    // The full-screen ring or a tap that started the app.
    notifee.getInitialNotification().then((init) => {
      if (!init) return;
      const action = init.pressAction?.id;
      onRingTap(ringTapOf({ type: action && action !== 'default' ? EventType.ACTION_PRESS : EventType.PRESS, detail: { notification: init.notification, pressAction: init.pressAction } }));
    }).catch(() => undefined);
    return () => { sub.remove(); received.remove(); ringSub(); };
  }, [ready, agent]);

  // Online / last seen in chat: a heartbeat while the app is on screen.
  useEffect(() => {
    if (!ready || !agent) return;
    return startPresence();
  }, [ready, agent]);

  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#fff" /></View>;
  }
  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: light ? 'none' : 'slide_from_right', animationDuration: 220, freezeOnBlur: true }}>
        <Stack.Screen name="index" options={{ animation: 'none' }} />
        <Stack.Screen name="login" options={{ animation: 'fade' }} />
        <Stack.Screen name="forgot" options={{ animation: 'fade' }} />
        <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
        <Stack.Screen name="set-password" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="add" options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }} />
        <Stack.Screen name="tour" options={{ animation: 'fade', contentStyle: { backgroundColor: '#20283a' } }} />
        <Stack.Screen name="call/incoming" options={{ animation: 'fade', gestureEnabled: false, contentStyle: { backgroundColor: C.ink } }} />
        <Stack.Screen name="call/[id]" options={{ animation: 'fade', gestureEnabled: false, contentStyle: { backgroundColor: C.ink } }} />
      </Stack>
      {agent ? <CallWatcher key={agent.agentId} /> : null}
      <ToastHost />
      <CelebrateHost />
      {agent && lock.pinSet && lock.locked ? <LockScreen /> : null}
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <PrefsProvider>
          <StatusBar style="auto" />
          <Gate />
        </PrefsProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
