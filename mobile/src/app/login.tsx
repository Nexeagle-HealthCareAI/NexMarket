import React, { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Btn, Field, T } from '../components/ui';
import { LANGS } from '../i18n';
import { ApiError, OfflineError, pendingPasswordChange } from '../lib/api';
import { APP_VERSION } from '../lib/config';
import { useSession } from '../lib/session';
import { C } from '../theme';
import { Vita } from '../components/Vita';

export default function Login() {
  const { t, lang, setLang, signIn } = useSession();
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!userId.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(userId, password);
      router.replace(pendingPasswordChange() ? '/set-password' : '/today');
    } catch (e) {
      if (e instanceof OfflineError) setError(t('loginOffline'));
      else if (e instanceof ApiError && (e.status === 401 || e.status === 400)) setError(t('loginFailed'));
      else setError(e instanceof Error ? e.message : t('somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.ink }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 20, gap: 20 }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', gap: 8, marginTop: 24 }}>
            <Vita mood="wave" height={150} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Image source={require('../../assets/brand/logo.png')} style={{ width: 34, height: 25 }} resizeMode="contain" />
              <T style={{ color: '#fff', fontSize: 26, fontWeight: '800' }}>NexMarket <T style={{ color: C.mint, fontSize: 26, fontWeight: '800' }}>AI</T></T>
            </View>
            <T style={{ color: C.sideText, fontSize: 12, letterSpacing: 0.5 }}>{t('poweredBy')}</T>
            <T style={{ color: C.sideText, fontSize: 14, textAlign: 'center' }}>{t('hospital')}</T>
            <T style={{ color: C.mint, fontSize: 14, fontWeight: '700' }}>{t('fieldTeamApp')}</T>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }} accessibilityRole="radiogroup">
            {LANGS.map((l) => {
              const on = l.code === lang;
              return (
                <Pressable key={l.code} onPress={() => setLang(l.code)} accessibilityRole="radio" accessibilityState={{ selected: on }}
                  style={{ paddingHorizontal: 16, height: 40, borderRadius: 999, justifyContent: 'center', borderWidth: 1,
                    borderColor: on ? C.mint : C.inkLine, backgroundColor: on ? 'rgba(56,246,169,0.12)' : 'transparent' }}>
                  <T style={{ color: on ? C.mint : '#fff', fontWeight: '700' }}>{l.label}</T>
                </Pressable>
              );
            })}
          </View>

          <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 20, gap: 14 }}>
            <T style={{ fontSize: 20, fontWeight: '800' }}>{t('login')}</T>
            <Field label={t('agentId')} value={userId} onChangeText={setUserId} autoCapitalize="characters" autoCorrect={false}
              placeholder="MKT-1001" returnKeyType="next" textContentType="username" autoComplete="username" />
            <Field label={t('password')} value={password} onChangeText={setPassword} secureTextEntry returnKeyType="go"
              onSubmitEditing={submit} textContentType="password" autoComplete="password" />
            {error ? <T style={{ color: C.bad, fontWeight: '600' }}>{error}</T> : null}
            <Btn label={busy ? t('firstSync') : t('continue')} onPress={submit} loading={busy} disabled={!userId.trim() || !password} />
            <T style={{ color: C.text2, fontSize: 13, textAlign: 'center' }}>{t('forgotPassword')}</T>
          </View>

          <T style={{ color: C.sideText, fontSize: 12, textAlign: 'center', marginTop: 'auto' }}>
            {t('worksOffline')} · {t('version', { v: APP_VERSION })}
          </T>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
