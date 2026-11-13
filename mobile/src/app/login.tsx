import React, { useState } from 'react';
import { lockState } from '../lib/lock';
import { Icon } from '../components/Icon';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Btn, Field, T } from '../components/ui';
import { LANGS, hasOrgWording } from '../i18n';
import { ApiError, OfflineError, getOrg, pendingPasswordChange, setOrg, signedOutReason } from '../lib/api';
import { APP_VERSION } from '../lib/config';
import { useSession } from '../lib/session';
import { C } from '../theme';
import { Vita } from '../components/Vita';

export default function Login() {
  const { t, lang, setLang, signIn } = useSession();
  const [org, setOrgText] = useState(() => getOrg());
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [orgEdit, setOrgEdit] = useState(false);
  // The name can be shown for the first organisation (nothing typed) or one this phone has signed in to before.
  const known = org === getOrg() && (!org || hasOrgWording());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Signed out by the server: a newer sign-in on another phone, a password reset, or an admin.
  const [ended] = useState(() => signedOutReason());
  const endedText = ended ? (/another (phone|tablet)/.test(ended) ? t('signedOutElsewhere') : ended) : null;

  const submit = async () => {
    if (!userId.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await setOrg(org);
      await signIn(userId, password);
      // First time on this phone: offer a PIN and fingerprint so the password isn't needed every day.
      const l = lockState();
      router.replace(pendingPasswordChange() ? '/set-password' : !l.pinSet && !l.asked ? '/quick-unlock?first=1' : '/today');
    } catch (e) {
      if (e instanceof OfflineError) setError(t('loginOffline'));
      else if (e instanceof ApiError && e.status === 404) setError(t('orgUnknown'));
      else if (e instanceof ApiError && e.status === 423) setError(t('loginLocked'));
      else if (e instanceof ApiError && e.status === 429) setError(t('loginTooMany'));
      else if (e instanceof ApiError && (e.status === 401 || e.status === 400)) setError(/more tr(y|ies)/.test(e.message) ? `${t('loginFailed')} ${e.message.replace(/^.*?\. /, '')}` : t('loginFailed'));
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
              <T style={{ color: '#fff', fontSize: 26, fontWeight: '800' }}>NexEagle</T>
            </View>
            <T style={{ color: C.sideText, fontSize: 14, textAlign: 'center' }}>{known ? t('hospital') : ' '}</T>
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
            {/* Most agents never change organisation: show which one this phone signs in to, with a way to change it. */}
            {orgEdit ? (
              <Field label={t('organisation')} hint={t('organisationHint')} value={org} onChangeText={(v) => setOrgText(v.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                autoCapitalize="none" autoCorrect={false} returnKeyType="next" maxLength={30} autoFocus />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingLeft: 14, paddingRight: 8, paddingVertical: 8 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T style={{ fontSize: 12, fontWeight: '700', color: C.text2 }}>{t('organisation')}</T>
                  <T style={{ fontSize: 15, fontWeight: '800' }} numberOfLines={2}>{known ? t('hospital') : org}</T>
                </View>
                <Pressable onPress={() => setOrgEdit(true)} accessibilityRole="button" accessibilityLabel={`${t('change')}: ${t('organisation')}`} hitSlop={4}
                  style={({ pressed }) => [{ minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: C.borderStrong, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.7 }]}>
                  <T style={{ color: C.blueInk, fontSize: 14, fontWeight: '700' }}>{t('change')}</T>
                </Pressable>
              </View>
            )}
            <Field label={t('agentId')} hint={t('loginIdHint')} value={userId} onChangeText={setUserId} autoCapitalize="characters" autoCorrect={false}
              returnKeyType="next" textContentType="username" autoComplete="username" />
            <View>
              <Field label={t('password')} value={password} onChangeText={setPassword} secureTextEntry={!showPw} returnKeyType="go"
                onSubmitEditing={submit} textContentType="password" autoComplete="password" autoCapitalize="none" autoCorrect={false} style={{ paddingRight: 52 }} />
              <Pressable onPress={() => setShowPw(!showPw)} accessibilityRole="button" accessibilityLabel={showPw ? t('hidePassword') : t('showPassword')} hitSlop={6}
                style={{ position: 'absolute', right: 4, bottom: 4, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={showPw ? 'eyeOff' : 'eye'} color={C.text2} size={22} />
              </Pressable>
            </View>
            {endedText && !error ? (
              <View style={{ backgroundColor: '#fff7e6', borderRadius: 12, padding: 12 }} accessibilityRole="alert">
                <T style={{ color: '#92400e', fontWeight: '600', fontSize: 14 }}>{endedText}</T>
              </View>
            ) : null}
            {error ? <T style={{ color: C.bad, fontWeight: '600' }}>{error}</T> : null}
            <Btn label={busy ? t('firstSync') : t('continue')} onPress={submit} loading={busy} disabled={!userId.trim() || !password} />
            <Pressable onPress={async () => { await setOrg(org); router.push({ pathname: '/forgot', params: { user: userId.trim() } }); }} accessibilityRole="link" hitSlop={8}
              style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
              <T style={{ color: C.blue, fontSize: 15, fontWeight: '700', textDecorationLine: 'underline' }}>{t('fpLink')}</T>
            </Pressable>
          </View>

          <T style={{ color: C.sideText, fontSize: 12, textAlign: 'center', marginTop: 'auto' }}>
            {t('worksOffline')} · {t('version', { v: APP_VERSION })}
          </T>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
