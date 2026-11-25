import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Btn, Card, Empty, Pill, Screen, SectionTitle, T, TopBar } from '../components/ui';
import { Icon } from '../components/Icon';
import { campPlace, campWhen } from '../components/CampPicker';
import { useDb, useSession } from '../lib/session';
import { campList, dropWaitingBooking, flushCamps, myBookings, refreshCamps, sortCamps, tokenState, type CampBooking } from '../lib/camps';
import { assignment } from '../lib/sync';
import { C } from '../theme';
import type { Lang, TFn } from '../i18n';

/**
 * Health camps: every upcoming camp (my block first) with how full it is, a button to book a person into it, and the
 * camp day; then the people I booked, with their token and whether it went on WhatsApp.
 */
export default function Camps() {
  const { t, lang } = useSession();
  const block = assignment().block;
  const data = useDb(() => { const l = campList(); return { today: l?.today ?? null, camps: sortCamps(l?.camps ?? [], block), loaded: !!l }; }, [block]);
  const bookings = useDb(() => myBookings());
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    setBusy(true);
    try { await flushCamps(); await refreshCamps(); } catch { /* the list on the phone stays */ } finally { setBusy(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const mine = (b: string | null) => !!block && (b ?? '').toLowerCase() === block.toLowerCase();

  return (
    <Screen scroll={false} header={<TopBar title={t('cmCamps')} sub={t('cmCampsSub')} explain={t('cmCampsExplain')} />}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 28 }} refreshControl={<RefreshControl refreshing={busy} onRefresh={() => void reload()} />}>
        {data.camps.length === 0 ? <Empty text={t('cmNoCamps')} icon="flag" /> : null}
        {data.camps.map((c) => {
          const isToday = c.date === data.today;
          return (
            <Card key={c.id} onPress={() => router.push({ pathname: '/camp/[id]', params: { id: c.id } })} style={isToday ? { borderColor: C.ok, borderWidth: 2 } : undefined}>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {isToday ? <Pill label={t('apToday')} tone="ok" /> : null}
                {mine(c.block) ? <Pill label={t('cmInMyBlock')} tone="blue" icon="pin" /> : null}
                <Pill label={c.typeLabel} />
              </View>
              <T style={{ fontSize: 17, fontWeight: '800' }}>{c.title}</T>
              <T style={{ fontSize: 14.5, color: C.text2 }}>{campWhen(c, t, lang, data.today)}</T>
              {campPlace(c) ? <T style={{ fontSize: 14.5, color: C.text2 }} numberOfLines={2}>{campPlace(c)}</T> : null}
              <T style={{ fontSize: 14, fontWeight: '700', color: C.okInk }}>
                {[t('cmBookedN', { n: c.booked }), isToday ? t('cmArrivedN', { n: c.arrived }) : c.placesLeft > 0 ? t('cmPlacesLeft', { n: c.placesLeft }) : t('cmFull', { n: c.booked }),
                  c.mine ? t('cmMineN', { n: c.mine }) : null].filter(Boolean).join(' · ')}
              </T>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {isToday ? <Btn kind="ok" icon="check" label={t('cmOpenDay')} onPress={() => router.push({ pathname: '/camp/[id]', params: { id: c.id } })} flex /> : null}
                <Btn kind={isToday ? 'secondary' : 'ok'} icon="plus" label={t('cmBookPerson')} onPress={() => router.push({ pathname: '/appointment', params: { camp: c.id } })} flex />
              </View>
            </Card>
          );
        })}

        <SectionTitle title={t('cmMyBookings')} />
        {bookings.length === 0 ? <T style={{ color: C.text2, fontSize: 15 }}>{t('cmNoBookings')}</T> : null}
        {bookings.map((b) => <BookingRow key={b.clientId ?? b.id ?? b.createdAt} b={b} t={t} today={data.today} lang={lang} />)}
      </ScrollView>
    </Screen>
  );
}

function BookingRow({ b, t, today, lang }: { b: CampBooking; t: TFn; today: string | null; lang: Lang }) {
  const wa = tokenState(b);
  const st = b.status === 'attended' ? { label: t('cmArrived'), tone: 'ok' as const } : b.status === 'no_show' ? { label: t('cmNoShow'), tone: 'warn' as const } : { label: t('cmWaiting'), tone: 'muted' as const };
  const remove = () => Alert.alert(b.name, b.error ?? '', [{ text: t('cancel'), style: 'cancel' }, { text: t('cmRemove'), style: 'destructive', onPress: () => b.clientId && dropWaitingBooking(b.clientId) }]);
  return (
    <Pressable onPress={() => (b.clientId ? router.push({ pathname: '/camp-booked', params: { id: b.clientId } }) : undefined)} accessibilityRole="button"
      style={({ pressed }) => [{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 12, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: b.error ? C.bad : C.border }, pressed && { opacity: 0.85 }]}>
      <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: C.purpleSoft, alignItems: 'center', justifyContent: 'center' }}>
        <T style={{ fontSize: 18, fontWeight: '800', color: C.purple }}>{b.token ?? '—'}</T>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T style={{ fontSize: 16, fontWeight: '800' }} numberOfLines={1}>{b.name}</T>
        <T style={{ fontSize: 13.5, color: C.text2 }} numberOfLines={1}>{[b.campTitle, b.campDate ? campWhen({ date: b.campDate, startTime: b.startTime, endTime: b.endTime }, t, lang, today).split(' · ')[0] : null].filter(Boolean).join(' · ')}</T>
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <Pill label={st.label} tone={st.tone} />
          {wa === 'ok' ? <Icon name="whatsapp" size={16} color="#1fa855" /> : wa === 'fail' ? <Icon name="alert" size={16} color={C.warnInk} /> : null}
          {b.pending ? <Icon name="cloudOff" size={15} color={b.error ? C.bad : C.warnInk} /> : null}
          {b.error ? <T style={{ color: C.bad, fontSize: 13 }} numberOfLines={1}>{b.error}</T> : null}
        </View>
      </View>
      {b.error ? (
        <Pressable onPress={remove} accessibilityRole="button" accessibilityLabel={t('cmRemove')} hitSlop={8} style={{ padding: 6 }}>
          <Icon name="trash" size={20} color={C.bad} />
        </Pressable>
      ) : <Icon name="chevron" size={18} color={C.text3} />}
    </Pressable>
  );
}
