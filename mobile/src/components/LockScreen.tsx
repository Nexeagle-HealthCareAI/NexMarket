import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { T } from './ui';
import { PinDots, PinPad } from './PinPad';
import { useSession } from '../lib/session';
import { checkPin, unlockWithBio, useLock } from '../lib/lock';
import { C } from '../theme';

/**
 * Shown over the app when it opens (or comes back after a while) and quick unlock is set: the fingerprint prompt
 * comes up straight away, and the PIN pad is always there as the fallback.
 */
export function LockScreen() {
  const { t, agent, passwordAgain } = useSession();
  const lock = useLock();
  const [pin, setPin] = useState('');
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const asked = useRef(false);

  const bio = useCallback(async () => {
    setMsg(null);
    await unlockWithBio(t('unlockBioPrompt'), t('cancel2'));
  }, [t]);
  useEffect(() => {
    if (lock.bio && !asked.current) { asked.current = true; const id = setTimeout(() => void bio(), 300); return () => clearTimeout(id); }
  }, [lock.bio, bio]);

  const submit = async (value: string) => {
    setBusy(true);
    const r = await checkPin(value);
    setBusy(false);
    if (r === 'ok') return;
    setPin('');
    if (r === 0) { setMsg(t('unlockTooMany')); setTimeout(() => void passwordAgain(), 1500); return; }
    setMsg(t('unlockWrong', { n: r }));
  };
  const digit = (d: string) => {
    if (busy) return;
    const next = (pin + d).slice(0, lock.pinLen);
    setPin(next);
    setMsg(null);
    if (next.length === lock.pinLen) void submit(next);
  };
  const first = agent?.name?.split(' ')[0] ?? '';

  return (
    <SafeAreaView style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: C.ink, zIndex: 100 }}>
      <View style={{ flex: 1, justifyContent: 'center', gap: 26, padding: 20 }}>
        <View style={{ alignItems: 'center', gap: 10 }}>
          <Image source={require('../../assets/brand/logo.png')} style={{ width: 56, height: 40 }} resizeMode="contain" />
          <T style={{ color: '#fff', fontSize: 22, fontWeight: '800' }}>{first ? t('unlockHello', { name: first }) : 'NexEagle'}</T>
          <T style={{ color: C.sideText, fontSize: 15 }}>{t('unlockEnterPin')}</T>
        </View>
        <PinDots value={pin} length={lock.pinLen} show={show} onToggle={() => setShow(!show)} dark error={!!msg}
          labelShow={t('unlockShowPin')} labelHide={t('unlockHidePin')} />
        <View style={{ minHeight: 22, alignItems: 'center' }} accessibilityLiveRegion="polite">
          {busy ? <ActivityIndicator color="#fff" /> : msg ? <T style={{ color: '#ffb4ab', fontWeight: '700', textAlign: 'center' }}>{msg}</T> : null}
        </View>
        <PinPad dark disabled={busy} onDigit={digit} onDelete={() => setPin((p) => p.slice(0, -1))}
          onBio={lock.bio ? () => void bio() : undefined} bioLabel={t('unlockUseFinger')} />
        <Pressable onPress={() => void passwordAgain()} hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'center', paddingVertical: 10 }}>
          <T style={{ color: C.mint, fontWeight: '700' }}>{t('unlockUsePassword')}</T>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
