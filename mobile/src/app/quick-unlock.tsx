import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Btn, Card, Chip, Screen, T, TopBar, toast } from '../components/ui';
import { Icon } from '../components/Icon';
import { PinDots, PinPad } from '../components/PinPad';
import { useSession } from '../lib/session';
import { askBio, bioSupport, clearQuickUnlock, LOCK_AFTER_CHOICES, markAsked, setBio, setLockAfter, setPin, useLock, type BioSupport } from '../lib/lock';
import { C } from '../theme';

const PIN_LEN = 4;
/** Same digit four times, or a straight run (1234, 9876) — the first PINs anyone would try. */
function tooEasy(p: string) {
  if (/^(\d)\1+$/.test(p)) return true;
  const d = p.split('').map(Number);
  const up = d.every((x, i) => i === 0 || x === (d[i - 1] + 1) % 10);
  const down = d.every((x, i) => i === 0 || x === (d[i - 1] + 9) % 10);
  return up || down;
}

/** Set up or change quick unlock: a 4-digit PIN, the fingerprint, and how soon the app asks again. */
export default function QuickUnlock() {
  const { t } = useSession();
  const { first } = useLocalSearchParams<{ first?: string }>();
  const isFirst = first === '1';
  const lock = useLock();
  const [mode, setMode] = useState<'manage' | 'choose' | 'confirm'>(lock.pinSet && !isFirst ? 'manage' : 'choose');
  const [pin, setPinValue] = useState('');
  const [chosen, setChosen] = useState('');
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [support, setSupport] = useState<BioSupport | null>(null);
  useEffect(() => { void bioSupport().then(setSupport); }, []);

  const done = () => (isFirst ? router.replace('/today') : router.back());
  const skip = async () => { await markAsked(); done(); };

  const digit = async (d: string) => {
    const next = (pin + d).slice(0, PIN_LEN);
    setPinValue(next);
    setMsg(null);
    if (next.length < PIN_LEN) return;
    if (mode === 'choose') {
      if (tooEasy(next)) { setMsg(t('quPinEasy')); setPinValue(''); return; }
      setChosen(next); setPinValue(''); setMode('confirm');
      return;
    }
    if (next !== chosen) { setMsg(t('quPinMismatch')); setPinValue(''); setChosen(''); setMode('choose'); return; }
    await setPin(next);
    setPinValue(''); setChosen('');
    toast(t('quPinSet'));
    // Offer the fingerprint straight away when the phone has one.
    if (support === 'ready' && (await askBio(t('quUseBio'), t('cancel2')))) await setBio(true);
    if (isFirst) done(); else setMode('manage');
  };

  const toggleBio = async () => {
    if (lock.bio) { await setBio(false); return; }
    if (support !== 'ready') return;
    if (await askBio(t('quUseBio'), t('cancel2'))) await setBio(true);
  };
  const remove = async () => { await clearQuickUnlock(); toast(t('quRemoved')); setMode('choose'); };

  if (mode !== 'manage') {
    return (
      <Screen scroll={false} header={<TopBar title={t('quTitle')} onBack={isFirst ? false : undefined} />}>
        <View style={{ flex: 1, justifyContent: 'center', gap: 22 }}>
          {isFirst ? (
            <View style={{ gap: 6, alignItems: 'center' }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.blueSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="lock" color={C.blue} size={26} />
              </View>
              <T style={{ fontSize: 22, fontWeight: '800', textAlign: 'center' }}>{t('quFirstTitle')}</T>
              <T style={{ color: C.text2, textAlign: 'center', fontSize: 15, lineHeight: 21 }}>{t('quFirstSub')}</T>
            </View>
          ) : null}
          <T style={{ fontSize: 17, fontWeight: '700', textAlign: 'center' }}>{mode === 'choose' ? t('quChoosePin') : t('quConfirmPin')}</T>
          <PinDots value={pin} length={PIN_LEN} show={show} onToggle={() => setShow(!show)} error={!!msg}
            labelShow={t('unlockShowPin')} labelHide={t('unlockHidePin')} />
          <View style={{ minHeight: 22 }} accessibilityLiveRegion="polite">
            {msg ? <T style={{ color: C.bad, fontWeight: '700', textAlign: 'center' }}>{msg}</T> : null}
          </View>
          <PinPad onDigit={(d) => void digit(d)} onDelete={() => setPinValue((p) => p.slice(0, -1))} />
          {isFirst ? (
            <Pressable onPress={() => void skip()} hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'center', padding: 10 }}>
              <T style={{ color: C.text2, fontWeight: '700' }}>{t('quSkip')}</T>
            </Pressable>
          ) : null}
        </View>
      </Screen>
    );
  }

  return (
    <Screen header={<TopBar title={t('quTitle')} />}>
      <Card>
        <Pressable onPress={() => void toggleBio()} disabled={support !== 'ready' && !lock.bio} accessibilityRole="switch" accessibilityState={{ checked: lock.bio }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 }}>
          <Icon name="fingerprint" color={C.blue} size={24} />
          <View style={{ flex: 1 }}>
            <T style={{ fontWeight: '700' }}>{t('quUseBio')}</T>
            {support === 'not_enrolled' ? <T style={{ color: C.text2, fontSize: 13 }}>{t('quBioNotEnrolled')}</T>
              : support === 'none' ? <T style={{ color: C.text2, fontSize: 13 }}>{t('quBioNone')}</T> : null}
          </View>
          <View style={{ width: 50, height: 30, borderRadius: 15, padding: 3, backgroundColor: lock.bio ? C.ok : C.borderStrong, justifyContent: 'center' }}>
            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff', alignSelf: lock.bio ? 'flex-end' : 'flex-start' }} />
          </View>
        </Pressable>
      </Card>

      <Card>
        <T style={{ fontWeight: '700' }}>{t('quLockAfter')}</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {LOCK_AFTER_CHOICES.map((m) => (
            <Chip key={m} label={m === 0 ? t('quLockNow') : t('quLockMin', { n: m })} selected={lock.afterMin === m} onPress={() => void setLockAfter(m)} />
          ))}
        </View>
      </Card>

      <Btn kind="secondary" icon="lock" label={t('quChangePin')} onPress={() => { setMode('choose'); setPinValue(''); }} />
      <Btn kind="danger" icon="trash" label={t('quRemove')} onPress={() => void remove()} />
    </Screen>
  );
}
