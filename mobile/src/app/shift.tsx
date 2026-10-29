import React, { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { Btn, Card, Pill, Screen, T, TopBar } from '../components/ui';
import { Icon } from '../components/Icon';
import { useDb, useSession } from '../lib/session';
import { db, q } from '../lib/db';
import { assignment } from '../lib/sync';
import { beginShift, openAppSettings } from '../lib/shift';
import { dayLong, duration, km, relDay } from '../lib/format';
import { routeKm } from '../lib/util';
import { C } from '../theme';

export default function StartShift() {
  const { t, lang, agent } = useSession();
  const [busy, setBusy] = useState(false);
  const [gps, setGps] = useState<{ on: boolean; accuracy: number | null } | null>(null);

  const data = useDb(() => {
    const a = q.assigned();
    const last = q.lastShift();
    let lastLine: string | null = null;
    if (last?.endTime) {
      const pts = db().getAllSync<{ lat: number; lng: number; recordedAt: string }>(
        'SELECT lat, lng, recordedAt FROM trajectory WHERE shiftId = ? ORDER BY recordedAt', last.clientId);
      const visits = db().getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM visits WHERE shiftId = ?', last.clientId)?.n ?? 0;
      const hours = duration(t, new Date(last.endTime).getTime() - new Date(last.startTime).getTime());
      lastLine = `${t('lastShift', { when: relDay(t, lang, last.startTime), hours })}${pts.length > 1 ? ` · ${km(t, routeKm(pts))}` : ''}${visits ? ` · ${visits} ${t('visits')}` : ''}`;
    }
    return { total: a.length, done: a.filter((x) => x.visited).length, lastLine, active: !!q.activeShift() };
  }, [t, lang]);

  useEffect(() => {
    if (data.active) router.replace('/today');
  }, [data.active]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const on = await Location.hasServicesEnabledAsync().catch(() => true);
      let accuracy: number | null = null;
      const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (on && perm?.granted) {
        const p = await Location.getLastKnownPositionAsync().catch(() => null);
        accuracy = p?.coords.accuracy ?? null;
      }
      if (alive) setGps({ on, accuracy });
    })();
    return () => { alive = false; };
  }, []);

  const start = async () => {
    setBusy(true);
    try {
      const r = await beginShift(t);
      if (r === 'denied') Alert.alert(t('needBackgroundLocation'), t('permissionDenied'), [{ text: t('fix'), onPress: () => openAppSettings() }, { text: t('close') }]);
      else if (r === 'no-fix') Alert.alert(t('locationOff'), t('turnOnLocation'));
      else router.replace('/today');
    } finally {
      setBusy(false);
    }
  };

  const block = assignment().block ?? agent?.block ?? '';
  const pct = data.total ? Math.round((data.done / data.total) * 100) : 0;

  return (
    <Screen header={<TopBar title={t('startShift')} />}
      footer={
        <View style={{ padding: 16, gap: 8, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border }}>
          <Btn label={t('startShift')} icon="nav" kind="ok" onPress={start} loading={busy} />
          {data.lastLine ? <T style={{ textAlign: 'center', color: C.text2, fontSize: 13 }}>{data.lastLine}</T> : null}
        </View>
      }>
      <T style={{ color: C.text2 }}>{dayLong(lang)}</T>
      <T style={{ fontSize: 24, fontWeight: '800' }}>{t('goodMorning', { name: agent?.name?.split(' ')[0] ?? '' })}</T>

      <Card>
        <T style={{ color: C.text2, fontSize: 13 }}>{t('todaysBlock')}</T>
        {block ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <T style={{ fontSize: 20, fontWeight: '800' }}>{block}</T>
              <T style={{ fontSize: 20, fontWeight: '800', color: C.blue }}>{pct}%</T>
            </View>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: C.line, overflow: 'hidden' }}>
              <View style={{ width: `${pct}%`, height: '100%', backgroundColor: C.blue }} />
            </View>
            <T style={{ color: C.text2, fontSize: 13 }}>{t('blockProgress', { done: data.done, total: data.total })}</T>
          </>
        ) : <T style={{ color: C.text2 }}>{t('noBlock')}</T>}
      </Card>

      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Icon name="pin" color={gps?.on === false ? C.bad : C.ok} />
        <View style={{ flex: 1 }}>
          <T style={{ fontWeight: '700' }}>{gps?.on === false ? t('locationOff') : t('locationOn')}</T>
          <T style={{ color: C.text2, fontSize: 13 }}>
            {gps?.on === false ? t('turnOnLocation') : gps?.accuracy != null ? t('locationAccuracy', { n: Math.round(gps.accuracy) }) : ' '}
          </T>
        </View>
      </Card>

      <Card style={{ backgroundColor: C.warnSoft, borderColor: '#f5d9a8' }}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
          <Icon name="battery" color={C.warnInk} />
          <View style={{ flex: 1, gap: 4 }}>
            <T style={{ fontWeight: '700', color: C.warnInk }}>{t('batterySaverWarn')}</T>
            <T style={{ color: C.warnInk, fontSize: 13 }}>{t('batterySaverHint')}</T>
          </View>
        </View>
        <Btn small kind="secondary" label={t('fix')} onPress={openAppSettings} style={{ alignSelf: 'flex-start' }} />
      </Card>

      <Card style={{ backgroundColor: C.blueSoft, borderColor: C.blueSoft }}>
        <Pill label={t('locationOn')} tone="blue" icon="pin" />
        <T style={{ color: C.blueInk }}>{t('locationNotice')}</T>
        {lang !== 'en' ? <T style={{ color: C.blueInk, fontSize: 12, opacity: 0.8 }}>{t('locationNoticeEn')}</T> : null}
      </Card>
    </Screen>
  );
}
