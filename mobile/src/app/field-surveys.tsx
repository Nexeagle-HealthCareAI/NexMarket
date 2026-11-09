import React, { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Card, Empty, Pill, Screen, T, TopBar } from '../components/ui';
import { Icon } from '../components/Icon';
import { useDb, useSession } from '../lib/session';
import { localKm, localSpots, myFieldSurveys, refreshFieldSurveys, syncFieldSurveys } from '../lib/fieldSurvey';
import { C } from '../theme';

/** Field mapping: the occasional surveys the office gave me. */
export default function FieldSurveys() {
  const { t } = useSession();
  const items = useDb(() => myFieldSurveys());
  const [busy, setBusy] = useState(false);
  const reload = async () => {
    setBusy(true);
    await syncFieldSurveys().catch(() => undefined);
    await refreshFieldSurveys().catch(() => undefined);
    setBusy(false);
  };
  useEffect(() => { void refreshFieldSurveys().catch(() => undefined); }, []);

  return (
    <Screen scroll={false} padded={false} header={<TopBar title={t('fsTitle')} />}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={busy} onRefresh={() => void reload()} />}>
        {items.length === 0 ? <Empty text={t('fsListEmpty')} icon="route" /> : items.map((it) => {
          const c = it.config;
          const st = c.status === 'closed' ? 'closed' : it.myStatus;
          const km = Math.max(it.km, localKm(c.id));
          const spots = Math.max(it.spots, localSpots(c.id).length);
          return (
            <Card key={c.id} onPress={() => router.push({ pathname: '/field-survey', params: { id: c.id } })}>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: '#fff4e5', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="map" size={24} color="#c2410c" />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <T style={{ fontSize: 16, fontWeight: '700' }} numberOfLines={2}>{c.title}</T>
                  <T style={{ color: C.text2, fontSize: 13 }}>{t('fsKmSpots', { km: km.toFixed(1), n: spots })}{c.dueDate ? ` · ${t('fsDue', { d: new Date(`${c.dueDate}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) })}` : ''}</T>
                </View>
                <Pill label={t(st === 'submitted' ? 'fsStatusSubmitted' : st === 'started' ? 'fsStatusStarted' : st === 'closed' ? 'fsStatusClosed' : 'fsStatusAssigned')}
                  tone={st === 'submitted' ? 'ok' : st === 'started' ? 'blue' : st === 'closed' ? 'muted' : 'warn'} />
              </View>
            </Card>
          );
        })}
      </ScrollView>
    </Screen>
  );
}
