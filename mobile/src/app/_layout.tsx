import '../lib/location'; // registers the background location task before anything else runs
import React, { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { ActivityIndicator, AppState, View } from 'react-native';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { enableFreeze } from 'react-native-screens';
import { SessionProvider, useSession } from '../lib/session';
import { pendingPasswordChange } from '../lib/api';
import { syncNow } from '../lib/sync';
import { handleResponse, registerPush, setupNotifications } from '../lib/notifications';
import { ToastHost } from '../components/ui';
import { CelebrateHost } from '../components/Vita';
import { C } from '../theme';
import { LockScreen } from '../components/LockScreen';
import { lockNow, lockState, useLock } from '../lib/lock';
import { useLite } from '../lib/perf';

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
  const onLogin = segments[0] === 'login';

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
    });
    // The tap that opened the app from the tray.
    Notifications.getLastNotificationResponseAsync().then((r) => {
      if (r) { handleResponse(r); void Notifications.clearLastNotificationResponseAsync().catch(() => undefined); }
    }).catch(() => undefined);
    return () => { sub.remove(); received.remove(); };
  }, [ready, agent]);

  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#fff" /></View>;
  }
  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: light ? 'none' : 'slide_from_right', animationDuration: 220, freezeOnBlur: true }}>
        <Stack.Screen name="index" options={{ animation: 'none' }} />
        <Stack.Screen name="login" options={{ animation: 'fade' }} />
        <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
        <Stack.Screen name="set-password" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="add" options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }} />
      </Stack>
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
        <StatusBar style="auto" />
        <Gate />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
