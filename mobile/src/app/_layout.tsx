import '../lib/location'; // registers the background location task before anything else runs
import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from '../lib/session';
import { ToastHost } from '../components/ui';
import { CelebrateHost } from '../components/Vita';
import { C } from '../theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function Gate() {
  const { ready, agent } = useSession();
  const segments = useSegments();
  const onLogin = segments[0] === 'login';

  useEffect(() => {
    if (!ready) return;
    SplashScreen.hideAsync().catch(() => undefined);
    if (!agent && !onLogin) router.replace('/login');
    else if (agent && onLogin) router.replace('/today');
  }, [ready, agent, onLogin]);

  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#fff" /></View>;
  }
  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'slide_from_right' }}>
        <Stack.Screen name="index" options={{ animation: 'none' }} />
        <Stack.Screen name="login" options={{ animation: 'fade' }} />
        <Stack.Screen name="today" options={{ animation: 'none' }} />
        <Stack.Screen name="followups" options={{ animation: 'none' }} />
        <Stack.Screen name="patients" options={{ animation: 'none' }} />
        <Stack.Screen name="me" options={{ animation: 'none' }} />
        <Stack.Screen name="assistant" options={{ animation: 'none' }} />
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
