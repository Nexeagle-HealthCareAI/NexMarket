import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Btn, Field, T } from '../components/ui';
import { Icon } from '../components/Icon';
import { ApiError, OfflineError, forgotPassword, recoveryOptions, resetPasswordWithCode } from '../lib/api';
import { useSession } from '../lib/session';
import { C } from '../theme';

/**
 * Forgot password, without calling anyone: a 6-digit code goes to the email and WhatsApp number saved on the
 * account, then the agent chooses a new password. The organisation typed on the sign-in screen is used.
 */
export default function Forgot() {
  const { t } = useSession();
  const params = useLocalSearchParams<{ user?: string }>();
  const [userId, setUserId] = useState(typeof params.user === 'string' ? params.user : '');
  const [step, setStep] = useState<'ask' | 'code' | 'done'>('ask');
  const [canSend, setCanSend] = useState<boolean | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    recoveryOptions().then((o) => { if (live) setCanSend(o.email || o.whatsapp); }).catch(() => { if (live) setCanSend(true); });
    return () => { live = false; };
  }, []);

  const fail = (e: unknown) => {
    if (e instanceof OfflineError) setError(t('fpOffline'));
    else if (e instanceof ApiError && e.status === 404) setError(t('orgUnknown'));
    else if (e instanceof ApiError && e.status === 429) setError(t('loginTooMany'));
    else if (e instanceof ApiError && e.status === 503) setCanSend(false);
    else if (e instanceof ApiError && /code/i.test(e.message)) setError(t('fpBadCode'));
    else setError(e instanceof ApiError ? e.message : t('somethingWrong'));
  };

  const send = async () => {
    if (!userId.trim() || busy) return;
    setBusy(true); setError(null);
    try { await forgotPassword(userId); setStep('code'); setCode(''); }
    catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  const digits = code.replace(/\D/g, '');
  const save = async () => {
    if (digits.length !== 6 || password.length < 8 || busy) return;
    setBusy(true); setError(null);
    try { await resetPasswordWithCode(userId, digits, password); setStep('done'); }
    catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  const note = (text: string, good = true) => (
    <View style={{ backgroundColor: good ? '#e9f7ef' : '#fff7e6', borderRadius: 12, padding: 12 }} accessibilityRole="alert">
      <T style={{ color: good ? '#0b5b32' : '#92400e', fontWeight: '600', fontSize: 14 }}>{text}</T>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.ink }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 20, gap: 20, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
          <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 20, gap: 14 }}>
            <T style={{ fontSize: 20, fontWeight: '800' }}>{t('fpTitle')}</T>

            {step === 'done' ? (
              <>
                {note(t('fpDone'))}
                <Btn label={t('fpBack')} onPress={() => router.replace('/login')} />
              </>
            ) : canSend === false ? (
              <>
                {note(t('fpNoSender'), false)}
                <Btn label={t('fpBack')} onPress={() => router.replace('/login')} />
              </>
            ) : step === 'ask' ? (
              <>
                <T style={{ color: C.text2, fontSize: 15, lineHeight: 21 }}>{t('fpIntro')}</T>
                <Field label={t('fpUser')} value={userId} onChangeText={setUserId} autoCapitalize="none" autoCorrect={false}
                  returnKeyType="go" onSubmitEditing={() => send()} textContentType="username" autoComplete="username" maxLength={120} />
                {error ? <T style={{ color: C.bad, fontWeight: '600' }}>{error}</T> : null}
                <Btn label={t('fpSend')} onPress={() => send()} loading={busy} disabled={!userId.trim()} />
              </>
            ) : (
              <>
                {note(t('fpSent'))}
                <Field label={t('fpCode')} value={code} onChangeText={(v) => setCode(v.replace(/[^\d\s]/g, ''))} keyboardType="number-pad"
                  textContentType="oneTimeCode" autoComplete="one-time-code" placeholder="123456" maxLength={9} returnKeyType="next" />
                <View>
                  <Field label={t('fpNewPassword')} hint={t('fpNewPasswordHint')} value={password} onChangeText={setPassword} secureTextEntry={!showPw}
                    textContentType="newPassword" autoComplete="new-password" autoCapitalize="none" autoCorrect={false} maxLength={200} style={{ paddingRight: 52 }} />
                  <Pressable onPress={() => setShowPw(!showPw)} accessibilityRole="button" accessibilityLabel={showPw ? t('hidePassword') : t('showPassword')} hitSlop={6}
                    style={{ position: 'absolute', right: 4, top: 26, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={showPw ? 'eyeOff' : 'eye'} color={C.text2} size={22} />
                  </Pressable>
                </View>
                {error ? <T style={{ color: C.bad, fontWeight: '600' }}>{error}</T> : null}
                <Btn label={t('fpSave')} onPress={save} loading={busy} disabled={digits.length !== 6 || password.length < 8} />
                <Pressable onPress={() => send()} disabled={busy} accessibilityRole="button" hitSlop={8} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <T style={{ color: C.blue, fontSize: 15, fontWeight: '700', textDecorationLine: 'underline' }}>{t('fpAgain')}</T>
                </Pressable>
              </>
            )}

            {step !== 'done' && canSend !== false ? (
              <Pressable onPress={() => router.replace('/login')} accessibilityRole="link" hitSlop={8} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                <T style={{ color: C.text2, fontSize: 15, fontWeight: '600' }}>{t('fpBack')}</T>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
