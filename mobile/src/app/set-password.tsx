import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Btn, Field, Screen, T, toast } from '../components/ui';
import { Vita } from '../components/Vita';
import { useSession } from '../lib/session';
import { ApiError, clearPendingPasswordChange, OfflineError, pendingPasswordChange, post } from '../lib/api';
import { errorMessage } from '../lib/util';
import { C } from '../theme';

/** After signing in with a one-time password from the admin, the agent picks their own. */
export default function SetPassword() {
  const { t, agent, signIn } = useSession();
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(null);
    if (pw.length < 8) { setError(t('pwTooShort')); return; }
    if (pw !== again) { setError(t('pwMismatch')); return; }
    const current = pendingPasswordChange();
    if (!current || !agent) { router.replace('/today'); return; }
    setBusy(true);
    try {
      await post('/api/v1/auth/change-password', { currentPassword: current, newPassword: pw });
      clearPendingPasswordChange();
      // Changing the password signs every device out, so sign this phone back in with the new one.
      await signIn(agent.agentId, pw);
      toast(t('pwSaved'));
      router.replace('/today');
    } catch (e) {
      setError(e instanceof OfflineError ? t('needInternet') : e instanceof ApiError ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen bg={C.ink}>
      <View style={{ alignItems: 'center', gap: 8, marginTop: 24 }}>
        <Vita mood="think" height={130} />
        <T style={{ color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center' }}>{t('setPwTitle')}</T>
        <T style={{ color: C.sideText, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>{t('setPwSub')}</T>
      </View>
      <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 20, gap: 14 }}>
        <Field label={t('newPassword')} value={pw} onChangeText={setPw} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
        <Field label={t('confirmPassword')} value={again} onChangeText={setAgain} secureTextEntry autoCapitalize="none" autoComplete="new-password" error={error} />
        <Btn label={t('pwSave')} icon="check" loading={busy} onPress={save} />
      </View>
    </Screen>
  );
}
