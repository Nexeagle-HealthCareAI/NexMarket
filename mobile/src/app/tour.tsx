import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Icon } from '../components/Icon';
import { T } from '../components/ui';
import { Vita, type VitaMood } from '../components/Vita';
import { useSession } from '../lib/session';
import { speak, stopSpeaking } from '../lib/speak';
import { getPrefs } from '../lib/prefs';
import { translate, type StringKey } from '../i18n';
import { C } from '../theme';

/**
 * Vita's 5-step tour: shown once after sign-in, and again from Me → Easy to use.
 * Each step has a picture of the thing it explains, Vita's words in the agent's language, and a Listen button.
 */
const STEPS: { text: StringKey; mood: VitaMood }[] = [
  { text: 'uxTour1', mood: 'wave' },
  { text: 'uxTour2', mood: 'cheer' },
  { text: 'uxTour3', mood: 'think' },
  { text: 'uxTour4', mood: 'relax' },
  { text: 'uxTour5', mood: 'ai' },
];
const BG = '#20283a';

export default function Tour() {
  const { t, lang } = useSession();
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  const done = () => { stopSpeaking(); router.canGoBack() ? router.back() : router.replace('/today'); };

  // With "Read screens aloud" on, each step is read as it appears.
  useEffect(() => {
    if (getPrefs().readAloud) speak(t(step.text), lang);
  }, [i, lang, step.text, t]);
  useEffect(() => () => stopSpeaking(), []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }}>
      <StatusBar style="light" />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 8 }}>
        <T style={{ flex: 1, color: '#c3cbdc', fontSize: 14, fontWeight: '700' }}>{t('uxStepOf', { i: i + 1, n: STEPS.length })}</T>
        <View style={{ flexDirection: 'row', gap: 5 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {STEPS.map((_, k) => <View key={k} style={{ width: 22, height: 6, borderRadius: 3, backgroundColor: k <= i ? C.mint : C.inkLine }} />)}
        </View>
        <Pressable accessibilityRole="button" onPress={done} hitSlop={6} style={{ minHeight: 48, paddingHorizontal: 12, justifyContent: 'center' }}>
          <T style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{t('uxSkip')}</T>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 18, flexGrow: 1 }}>
        <View style={{ minHeight: 170, justifyContent: 'center' }}>
          <Picture step={i} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
          <Vita mood={step.mood} height={104} />
          <View style={{ flex: 1, backgroundColor: '#fff', borderRadius: 20, borderBottomLeftRadius: 6, padding: 16, gap: 12 }}>
            <T style={{ fontSize: 18, fontWeight: '700', lineHeight: 27 }}>{t(step.text)}</T>
            {lang !== 'en' ? <T style={{ fontSize: 14, color: C.text2, lineHeight: 20 }}>{translate('en', step.text)}</T> : null}
            <Pressable accessibilityRole="button" onPress={() => speak(t(step.text), lang)}
              style={({ pressed }) => [{ alignSelf: 'flex-start', minHeight: 48, paddingHorizontal: 16, borderRadius: 14, backgroundColor: C.blue, flexDirection: 'row', alignItems: 'center', gap: 8 }, pressed && { opacity: 0.8 }]}>
              <Icon name="volume" color="#fff" />
              <T style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>{t('uxListen')}</T>
            </Pressable>
          </View>
        </View>
        <View style={{ flex: 1 }} />
      </ScrollView>

      <View style={{ paddingHorizontal: 16, paddingBottom: 12, gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {i > 0 ? (
            <Pressable accessibilityRole="button" onPress={() => setI(i - 1)}
              style={({ pressed }) => [{ flex: 1, minHeight: 56, borderRadius: 16, borderWidth: 1, borderColor: C.inkLine, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 }, pressed && { opacity: 0.8 }]}>
              <T style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>{t('uxBack')}</T>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" onPress={() => (last ? done() : setI(i + 1))}
            style={({ pressed }) => [{ flex: 2, minHeight: 56, borderRadius: 16, backgroundColor: C.mint, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 }, pressed && { opacity: 0.85 }]}>
            <T style={{ color: C.ink, fontSize: 17, fontWeight: '800' }}>{last ? t('uxStart') : t('uxNext')}</T>
          </Pressable>
        </View>
        <T style={{ color: '#c3cbdc', fontSize: 13, textAlign: 'center' }}>{t('uxTourReplay')}</T>
      </View>
    </SafeAreaView>
  );
}

/** A small drawing of what each step talks about. */
function Picture({ step }: { step: number }) {
  const { t } = useSession();
  const glow = { borderRadius: 20, borderWidth: 2, borderColor: C.ok, shadowColor: C.mint, shadowOpacity: 0.6, shadowRadius: 12, elevation: 6 };
  if (step === 0) {
    return (
      <View style={{ alignItems: 'center' }}>
        <Vita mood="fly" height={150} />
      </View>
    );
  }
  if (step === 1) {
    return (
      <View style={[{ backgroundColor: '#fff', padding: 16, gap: 12 }, glow]}>
        <T style={{ fontSize: 13, fontWeight: '800', letterSpacing: 0.8, color: C.okInk }}>{t('uxTourCardLabel')}</T>
        <T style={{ fontSize: 21, fontWeight: '800' }}>{t('uxTourCardTitle')}</T>
        <View style={{ minHeight: 54, borderRadius: 14, backgroundColor: C.ok, alignItems: 'center', justifyContent: 'center' }}>
          <T style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>{t('uxAddCheckIn')}</T>
        </View>
      </View>
    );
  }
  if (step === 2) {
    const tiles: { key: StringKey; icon: 'pin' | 'userPlus' | 'hospital' | 'mic'; bg: string; fg: string }[] = [
      { key: 'uxAddCheckIn', icon: 'pin', bg: C.okSoft, fg: C.okInk },
      { key: 'uxAddPartner', icon: 'userPlus', bg: C.blueSoft, fg: C.blueInk },
      { key: 'uxAddRefer', icon: 'hospital', bg: C.warnSoft, fg: C.warnInk },
      { key: 'uxAddNote', icon: 'mic', bg: C.purpleSoft, fg: C.purple },
    ];
    return (
      <View style={{ alignItems: 'center', gap: 14 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
          {tiles.map((x) => (
            <View key={x.key} style={{ width: '47%', borderRadius: 16, padding: 12, gap: 6, backgroundColor: x.bg }}>
              <Icon name={x.icon} size={26} color={x.fg} />
              <T style={{ fontSize: 15, fontWeight: '800', color: x.fg }}>{t(x.key)}</T>
            </View>
          ))}
        </View>
        <View style={[{ width: 66, height: 66, borderRadius: 33, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: '#fff' }]}>
          <Icon name="plus" size={26} color="#fff" strokeWidth={2.6} />
          <T style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{t('uxAdd')}</T>
        </View>
      </View>
    );
  }
  if (step === 3) {
    const rows: { bg: string; fg: string; text: string }[] = [
      { bg: '#e7f6ef', fg: '#0b6b4a', text: t('uxSyncOk') },
      { bg: '#fff4e0', fg: '#8a5100', text: t('uxSyncWait', { n: 3 }) },
      { bg: '#fdecea', fg: '#9a1c12', text: t('uxSyncOff') },
    ];
    return (
      <View style={{ gap: 8 }}>
        {rows.map((r) => (
          <View key={r.text} style={{ minHeight: 44, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, justifyContent: 'center', backgroundColor: r.bg }}>
            <T style={{ color: r.fg, fontSize: 15, fontWeight: '700' }}>{r.text}</T>
          </View>
        ))}
      </View>
    );
  }
  return (
    <View style={{ gap: 12 }}>
      <View style={{ alignSelf: 'flex-end', maxWidth: '80%', backgroundColor: C.blue, borderRadius: 16, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 10 }}>
        <T style={{ color: '#fff', fontSize: 16 }}>{t('uxTourChatSample')}</T>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 999, paddingLeft: 16, padding: 6 }}>
        <T style={{ flex: 1, color: C.muted }}>{t('chatType')}</T>
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: C.bad, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: '#f7c5c0' }}>
          <Icon name="mic" size={24} color="#fff" />
        </View>
      </View>
    </View>
  );
}
