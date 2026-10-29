import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { Btn, Card, Pill, Screen, T, TopBar, toast } from '../components/ui';
import { PanchayatList, sortPanchayats } from '../components/PanchayatList';
import { tryCheckIn } from '../lib/visit';
import { useHere } from '../lib/useHere';
import { formatDist } from '../lib/plan';
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
  // The panchayat the agent is starting in: everyone they add today goes into it until they move on.
  const [picked, setPicked] = useState<string | null>(null);
  const starting = useRef(false);
  const here = useHere(true);

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
    return { total: a.length, done: a.filter((x) => x.visited).length, lastLine, active: !!q.activeShift(), assigned: a };
  }, [t, lang]);

  useEffect(() => {
    if (data.active && !starting.current) router.replace('/today');
  }, [data.active]);
  const list = useMemo(() => sortPanchayats(data.assigned, here), [data.assigned, here]);
  const pickedName = list.find((p) => p.panchayatId === picked)?.name ?? '';

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
    starting.current = true;
    try {
      const r = await beginShift(t);
      if (r === 'denied') Alert.alert(t('needBackgroundLocation'), t('permissionDenied'), [{ text: t('fix'), onPress: () => openAppSettings() }, { text: t('close') }]);
      else if (r === 'no-fix') Alert.alert(t('locationOff'), t('turnOnLocation'));
      else if (!picked) router.replace('/today');
      else {
        // Check in straight away, so new partners land in this panchayat.
        const c = await tryCheckIn(picked);
        if (c.ok) toast(t('shiftStartedIn', { name: pickedName }));
        else Alert.alert(t('shiftStarted'), c.why === 'far'
          ? t('startedNotCheckedIn', { name: pickedName, dist: formatDist(c.distM, t) })
          : t('turnOnLocation'));
        router.replace({ pathname: '/checkin', params: { panchayatId: picked } });
      }
    } finally {
      starting.current = false;
      setBusy(false);
    }
  };

  const block = assignment().block ?? agent?.block ?? '';
  const pct = data.total ? Math.round((data.done / data.total) * 100) : 0;

  return (
    <Screen header={<TopBar title={t('startShift')} />}
      footer={
        <View style={{ padding: 16, gap: 8, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border }}>
          <Btn label={picked ? t('startShiftIn', { name: pickedName }) : list.length ? t('pickPanchayatFirst') : t('startShift')}
            icon="nav" kind="ok" onPress={start} loading={busy} disabled={list.length > 0 && !picked} />
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

      {list.length ? (
        <View style={{ gap: 8 }}>
          <T style={{ fontSize: 17, fontWeight: '800' }}>{t('whereStarting')}</T>
          <T style={{ color: C.text2, fontSize: 13 }}>{t('whereStartingHint')}</T>
          <PanchayatList list={list} here={here} selected={picked} onPick={setPicked} />
        </View>
      ) : null}

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
