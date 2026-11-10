import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { SpeakButton, T, toast } from './ui';
import { Icon } from './Icon';
import { Vita } from './Vita';
import { HoldButton } from './HoldButton';
import { SyncStrip, useSyncSummary } from './SyncStrip';
import { useDb, useSession } from '../lib/session';
import { db, q } from '../lib/db';
import { finishShift } from '../lib/shift';
import { savedFeedback } from '../lib/prefs';
import { explainOnce } from '../lib/speak';
import { dayShort, km, timeOf, weekday } from '../lib/format';
import { routeKm } from '../lib/util';
import { C } from '../theme';

/**
 * End of the day: what the shift added up to, a calm note if things are still waiting to send, and a
 * hold-to-end button so the shift can't be ended by a stray tap.
 */
export function EndShiftView() {
  const { t, lang, agent } = useSession();
  const insets = useSafeAreaInsets();
  const { waiting } = useSyncSummary();
  const [busy, setBusy] = useState(false);
  const ending = useRef(false);

  const data = useDb(() => {
    const s = q.activeShift();
    if (!s) return null;
    const n = (sql: string) => db().getFirstSync<{ n: number }>(sql, s.startTime)?.n ?? 0;
    const v = q.activeVisit();
    return {
      visits: n('SELECT COUNT(*) AS n FROM visits WHERE checkInAt >= ?'),
      partners: n('SELECT COUNT(*) AS n FROM contacts WHERE createdAt >= ?'),
      patients: n('SELECT COUNT(*) AS n FROM referrals WHERE createdAt >= ?'),
      km: routeKm(q.trajectorySince(s.startTime)),
      inPlace: v ? q.assignedOne(v.panchayatId)?.name ?? q.panchayat(v.panchayatId)?.name ?? '' : '',
    };
  });

  const explain = t('tdEndExplain');
  useEffect(() => { explainOnce('/shift|end', explain, lang); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // The shift was ended somewhere else (or never running): nothing to do here.
  useEffect(() => { if (!data && !ending.current) router.replace('/today'); }, [data]);

  const end = async () => {
    if (ending.current) return;
    ending.current = true;
    setBusy(true);
    try {
      await finishShift();
      savedFeedback();
      toast(t('tdShiftEnded'));
      router.replace('/today');
    } finally {
      ending.current = false;
      setBusy(false);
    }
  };
  const confirm = () => Alert.alert(t('endShift'), t('endShiftConfirm'), [
    { text: t('cancel'), style: 'cancel' },
    { text: t('endShift'), style: 'destructive', onPress: () => { void end(); } },
  ]);

  const name = agent?.name?.split(' ')[0] ?? '';
  const now = new Date();
  const stats = data ? [
    { n: String(data.visits), label: t('tdSumVisits', { n: data.visits }) },
    { n: String(data.partners), label: t('tdSumPartners', { n: data.partners }) },
    { n: String(data.patients), label: t('tdSumPatients', { n: data.patients }) },
    { n: km(t, data.km), label: t('tdSumKm') },
  ] : [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.ink }} edges={['top', 'left', 'right']}>
      <View style={{ backgroundColor: C.ink, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 20, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('uxBack')} hitSlop={6}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/today'))}
            style={({ pressed }) => [{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginLeft: -8 }, pressed && { opacity: 0.7 }]}>
            <Icon name="back" size={22} color="#fff" />
          </Pressable>
          <SpeakButton text={explain} dark />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}>
          <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
            <T style={{ fontSize: 15, color: '#c3cbdc', fontWeight: '600' }}>{`${weekday(lang, now)}, ${dayShort(lang, now)} · ${timeOf(lang, now.toISOString())}`}</T>
            <T style={{ fontSize: 24, fontWeight: '800', color: '#fff', lineHeight: 30 }}>
              {data && data.visits > 0 ? t('tdEndTitle', { name }) : t('tdEndTitlePlain', { name })}
            </T>
          </View>
          <Vita mood="cheer" height={72} bob={false} />
        </View>
      </View>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <SyncStrip />
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
          <View style={{ backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 20, padding: 16, gap: 12 }}>
            <T style={{ fontSize: 17, fontWeight: '800' }}>{t('tdYourDay')}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 }}>
              {stats.map((s) => (
                <View key={s.label} style={{ width: '50%', gap: 2, paddingRight: 8 }} accessible accessibilityLabel={`${s.n} ${s.label}`}>
                  <T style={{ fontSize: 26, fontWeight: '800' }}>{s.n}</T>
                  <T style={{ fontSize: 15, color: C.text2 }}>{s.label}</T>
                </View>
              ))}
            </View>
          </View>
          {waiting > 0 ? (
            <View accessibilityRole="text" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: C.warnSoft, borderWidth: 1, borderColor: '#f6d9a8' }}>
              <Icon name="clock" size={22} color={C.warnInk} />
              <T style={{ flex: 1, fontSize: 15, fontWeight: '600', lineHeight: 21, color: C.warnInk }}>{t('tdWaiting', { n: waiting })}</T>
            </View>
          ) : null}
          {data?.inPlace ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border }}>
              <Icon name="pin" size={22} color={C.okInk} />
              <T style={{ flex: 1, fontSize: 15, lineHeight: 21, color: C.text3 }}>{t('tdStillIn', { name: data.inPlace })}</T>
            </View>
          ) : null}
        </ScrollView>
        {/* The hold button stays out of the scroll view, so a scroll can't cancel the hold. */}
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 + insets.bottom, gap: 8 }}>
          <HoldButton label={t('tdHold')} a11yLabel={t('tdHoldA11y')} a11yHint={t('tdHoldA11yHint')} busy={busy} busyLabel={t('tdEnding')}
            onDone={() => { void end(); }} onA11yActivate={confirm} />
          <T style={{ fontSize: 14, color: C.text2, textAlign: 'center' }}>{t('tdHoldHint')}</T>
        </View>
      </View>
    </SafeAreaView>
  );
}
