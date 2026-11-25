import React from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Btn, T } from './ui';
import { Icon } from './Icon';
import { campPlace, campWhen } from './CampPicker';
import { useDb, useSession } from '../lib/session';
import { campList, sortCamps } from '../lib/camps';
import { assignment } from '../lib/sync';
import { C } from '../theme';

/**
 * On Today: a camp happening today (anyone can mark who came), or the next camp in my block this week (book people
 * for it). Nothing when no camp is near.
 */
export function CampTodayCard() {
  const { t, lang } = useSession();
  const block = assignment().block;
  const pick = useDb(() => {
    const l = campList();
    if (!l) return null;
    const sorted = sortCamps(l.camps ?? [], block);
    const today = sorted.find((c) => c.date === l.today);
    if (today) return { camp: today, today: true, day: l.today };
    const week = new Date(`${l.today}T12:00:00`); week.setDate(week.getDate() + 7);
    const soon = sorted.find((c) => !!block && (c.block ?? '').toLowerCase() === block.toLowerCase() && new Date(`${c.date}T12:00:00`) <= week);
    return soon ? { camp: soon, today: false, day: l.today } : null;
  }, [block]);
  if (!pick) return null;
  const { camp, today } = pick;
  return (
    <View style={{ backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: today ? C.ok : C.border, padding: 14, gap: 10 }}>
      <Pressable onPress={() => router.push({ pathname: '/camp/[id]', params: { id: camp.id } })} accessibilityRole="button" style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: C.okSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="flag" size={22} color={C.okInk} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <T style={{ fontSize: 16.5, fontWeight: '800' }} numberOfLines={2}>{today ? t('cmTodayCamp', { title: camp.title }) : t('cmSoonCamp', { d: campWhen(camp, t, lang).split(' · ')[0], title: camp.title })}</T>
          <T style={{ fontSize: 14, color: C.text2 }} numberOfLines={1}>{[campWhen(camp, t, lang, pick.day).split(' · ')[1], campPlace(camp)].filter(Boolean).join(' · ')}</T>
          <T style={{ fontSize: 14, fontWeight: '700', color: C.okInk }}>{[t('cmBookedN', { n: camp.booked }), today ? t('cmArrivedN', { n: camp.arrived }) : null, camp.mine ? t('cmMineN', { n: camp.mine }) : null].filter(Boolean).join(' · ')}</T>
        </View>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {today ? <Btn kind="ok" icon="check" label={t('cmOpenDay')} onPress={() => router.push({ pathname: '/camp/[id]', params: { id: camp.id } })} flex /> : null}
        <Btn kind={today ? 'secondary' : 'ok'} icon="plus" label={t('cmBookPerson')} onPress={() => router.push({ pathname: '/appointment', params: { camp: camp.id } })} flex />
      </View>
    </View>
  );
}
