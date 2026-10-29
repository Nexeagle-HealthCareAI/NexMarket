import React, { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Btn, Card, Empty, Screen, T, TopBar } from '../components/ui';
import { Icon } from '../components/Icon';
import { MapWeb, type MapData } from '../components/MapWeb';
import { useDb, useSession } from '../lib/session';
import { q } from '../lib/db';
import { buildPlan, formatDist } from '../lib/plan';
import { useHere } from '../lib/useHere';
import { openDirections } from '../lib/links';
import { C } from '../theme';

export default function RouteScreen() {
  const { t } = useSession();
  const here = useHere(true);
  const plan = useDb(() => buildPlan(here), [here?.lat, here?.lng]);
  const path = useDb(() => {
    const s = q.activeShift();
    return s ? q.trajectorySince(s.startTime).map((p) => [p.lat, p.lng] as [number, number]) : [];
  });

  const stops = plan.filter((p) => p.lat != null && p.lng != null);
  const data = useMemo<MapData>(() => ({
    stops: stops.map((p, i) => ({
      id: `${p.kind}:${p.id}`, n: i + 1, lat: p.lat!, lng: p.lng!, next: i === 0,
      label: p.kind === 'contact' ? p.contact.name : p.panchayat.name,
      approx: p.kind === 'panchayat' && p.panchayat.source === 'block',
    })),
    me: here ? { lat: here.lat, lng: here.lng } : null,
    path,
  }), [stops, here, path]);

  const open = (key: string) => {
    const [kind, id] = key.split(':');
    if (kind === 'contact') router.push({ pathname: '/partner/[id]', params: { id } });
    else router.push({ pathname: '/checkin', params: { panchayatId: id } });
  };
  const next = stops[0];

  return (
    <Screen header={<TopBar title={t('todaysRoute')} sub={t('routeSub', { n: stops.length })} />}
      footer={next ? (
        <View style={{ padding: 16, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border, gap: 8 }}>
          <T style={{ color: C.text2, fontSize: 13 }}>{t('nextStopLabel')}: {next.kind === 'contact' ? next.contact.name : next.panchayat.name}</T>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Btn flex kind="secondary" icon="nav" label={t('openGoogleMaps')} onPress={() => openDirections(next.lat!, next.lng!)} />
            <Btn flex icon="pin" label={t('reached')} onPress={() => router.push({ pathname: '/checkin', params: {
              panchayatId: next.kind === 'contact' ? next.contact.panchayatId ?? '' : next.id, contactId: next.kind === 'contact' ? next.id : '' } })} />
          </View>
        </View>
      ) : undefined}>
      <MapWeb data={data} onSelect={open} height={320} offlineText={t('mapOffline')} />
      <T style={{ color: C.text2, fontSize: 12 }}>{t('pinFromCensus')}</T>
      {plan.length === 0 ? <Empty text={t('planEmpty')} icon="map" /> : null}
      {plan.map((p, i) => {
        const name = p.kind === 'contact' ? p.contact.name : p.panchayat.name;
        const approx = p.kind === 'panchayat' && p.panchayat.source === 'block';
        return (
          <Card key={p.kind + p.id} onPress={() => open(`${p.kind}:${p.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: i === 0 ? C.warn : approx ? C.muted : C.blue, alignItems: 'center', justifyContent: 'center' }}>
              <T style={{ color: '#fff', fontWeight: '700' }}>{i + 1}</T>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T style={{ fontWeight: '700' }} numberOfLines={1}>{name}</T>
              <T style={{ color: C.text2, fontSize: 13 }} numberOfLines={1}>
                {[formatDist(p.distM, t), approx ? t('pinApprox') : null].filter(Boolean).join(' · ')}
              </T>
            </View>
            {p.lat != null && p.lng != null ? (
              <Pressable hitSlop={8} onPress={() => openDirections(p.lat!, p.lng!)} accessibilityLabel={t('route')}
                style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.blueSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="nav" size={18} color={C.blueInk} />
              </Pressable>
            ) : null}
          </Card>
        );
      })}
    </Screen>
  );
}
