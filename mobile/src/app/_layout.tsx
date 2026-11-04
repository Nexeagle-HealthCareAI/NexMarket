import '../lib/location'; // registers the background location task before anything else runs
import React, { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { ActivityIndicator, View } from 'react-native';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { enableFreeze } from 'react-native-screens';
import { SessionProvider, useSession } from '../lib/session';
import { pendingPasswordChange } from '../lib/api';
import { handleResponse, registerPush, setupNotifications } from '../lib/notifications';
import { ToastHost } from '../components/ui';
import { CelebrateHost } from '../components/Vita';
import { C } from '../theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);
// Screens the agent can't see (behind the one on top, or other tabs) stop re-rendering until shown again.
enableFreeze(true);

function Gate() {
  const { ready, agent } = useSession();
  const segments = useSegments();
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
    // The tap that opened the app from the tray.
    Notifications.getLastNotificationResponseAsync().then((r) => {
      if (r) { handleResponse(r); void Notifications.clearLastNotificationResponseAsync().catch(() => undefined); }
    }).catch(() => undefined);
    return () => sub.remove();
  }, [ready, agent]);

  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#fff" /></View>;
  }
  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'slide_from_right', animationDuration: 220, freezeOnBlur: true }}>
        <Stack.Screen name="index" options={{ animation: 'none' }} />
        <Stack.Screen name="login" options={{ animation: 'fade' }} />
        <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
        <Stack.Screen name="set-password" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="add" options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }} />
      </Stack>
      <ToastHost />
      <CelebrateHost />
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
