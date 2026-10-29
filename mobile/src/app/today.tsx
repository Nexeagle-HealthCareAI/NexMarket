import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Avatar, BottomNav, Btn, Empty, Pill, T } from '../components/ui';
import { Icon } from '../components/Icon';
import { TasksSection } from '../components/TaskCard';
import { LanguageButton, LanguageSheet } from '../components/LanguageSheet';
import { useDb, useSession, useSync } from '../lib/session';
import { db, q } from '../lib/db';
import { buildPlan, formatDist, type PlanItem } from '../lib/plan';
import { useHere } from '../lib/useHere';
import { assignment } from '../lib/sync';
import { finishShift, resumeTrackingIfNeeded } from '../lib/shift';
import { openDirections } from '../lib/links';
import { duration, km } from '../lib/format';
import { routeKm } from '../lib/util';
import { C, PRIORITY_COLOR } from '../theme';
import type { TFn } from '../i18n';

function weekStart(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d.toISOString();
}

export default function Today() {
  const { t, agent } = useSession();
  const sync = useSync();
  const here = useHere();
  const [langOpen, setLangOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    void resumeTrackingIfNeeded(t);
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [t]);

  const data = useDb(() => {
    const shift = q.activeShift();
    const pts = shift ? q.trajectorySince(shift.startTime) : [];
    const ws = weekStart();
    const week = db().getFirstSync<{ sent: number; arrived: number; admitted: number }>(
      `SELECT COUNT(*) AS sent,
              SUM(CASE WHEN status IN ('arrived','opd','admitted','procedure','discharged') THEN 1 ELSE 0 END) AS arrived,
              SUM(CASE WHEN status IN ('admitted','procedure','discharged') THEN 1 ELSE 0 END) AS admitted
         FROM referrals WHERE createdAt >= ?`, ws) ?? { sent: 0, arrived: 0, admitted: 0 };
    return { shift, kmToday: routeKm(pts), week, unsent: q.outboxCount(), visit: q.activeVisit() };
  });
  const plan = useDb(() => buildPlan(here), [here?.lat, here?.lng]);
  const block = assignment().block ?? agent?.block ?? '';

  const end = () => {
    Alert.alert(t('endShift'), t('endShiftConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('endShift'), style: 'destructive', onPress: () => { void finishShift(); } },
    ]);
  };

  const visible = showAll ? plan : plan.slice(0, 3);
  const firstName = agent?.name?.split(' ')[0] ?? '';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.ink }} edges={['top']}>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          {/* Dark header */}
          <View style={{ backgroundColor: C.ink, padding: 20, paddingBottom: 64, gap: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar name={agent?.name ?? '?'} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T style={{ color: '#fff', fontSize: 18, fontWeight: '700' }} numberOfLines={1}>{t('hello', { name: firstName })}</T>
                <T style={{ color: C.sideText, fontSize: 12 }} numberOfLines={1}>{[block, agent?.district].filter(Boolean).join(' · ')}</T>
              </View>
              <LanguageButton onPress={() => setLangOpen(true)} />
              {data.unsent > 0 ? (
                <Pressable onPress={() => router.replace('/me')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#3a2c10', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}>
                  <Icon name={sync.online ? 'upload' : 'cloudOff'} size={14} color="#ffcf7a" />
                  <T style={{ color: '#ffcf7a', fontSize: 12, fontWeight: '600' }}>{t('nOnPhone', { n: data.unsent })}</T>
                </Pressable>
              ) : null}
            </View>

            {data.shift ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.ink2, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.mint, borderWidth: 3, borderColor: 'rgba(56,246,169,0.25)' }} />
                <View style={{ flex: 1 }}>
                  <T style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>{t('shiftOn', { time: duration(t, Date.now() - new Date(data.shift.startTime).getTime()) })}</T>
                  <T style={{ color: C.sideText, fontSize: 12 }}>{t('shiftOnSub', { km: km(t, data.kmToday) })}</T>
                </View>
                <Btn small kind="dark" label={t('endShift')} onPress={end} />
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.ink2, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.muted }} />
                <View style={{ flex: 1 }}>
                  <T style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>{t('offShift')}</T>
                  <T style={{ color: C.sideText, fontSize: 12 }}>{t('startShiftFirst')}</T>
                </View>
                <Btn small kind="ok" label={t('startShift')} onPress={() => router.push('/shift')} />
              </View>
            )}
          </View>

          {/* This week's impact */}
          <View style={{ marginTop: -48, marginHorizontal: 16, backgroundColor: C.card, borderRadius: 20, padding: 16, gap: 12, elevation: 3, shadowColor: C.ink, shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } }}>
            <T style={{ fontSize: 15, fontWeight: '700' }}>{t('yourPatientsWeek')}</T>
            <View style={{ flexDirection: 'row' }}>
              <Stat n={data.week.sent ?? 0} label={t('sent')} color={C.text} />
              <Stat n={data.week.arrived ?? 0} label={t('arrived')} color={C.blue} />
              <Stat n={data.week.admitted ?? 0} label={t('admitted')} color={C.okInk} />
            </View>
          </View>

          {/* Tasks from the manager */}
          <TasksSection />

          {/* AI helper */}
          <Pressable onPress={() => router.push('/assistant')}
            style={({ pressed }) => [{ marginHorizontal: 16, marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14 }, pressed && { opacity: 0.85 }]}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="sparkle" size={20} color={C.mint} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T style={{ fontSize: 15, fontWeight: '700' }}>{t('aiHelper')}</T>
              <T style={{ fontSize: 13, color: C.text2 }} numberOfLines={2}>{t('aiHelperSub')}</T>
            </View>
            <Icon name="chevron" color={C.muted} />
          </Pressable>

          {/* Today's plan */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 10, gap: 8 }}>
            <View style={{ flex: 1 }}>
              <T style={{ fontSize: 18, fontWeight: '700' }}>{t('todaysPlan')}</T>
              <T style={{ fontSize: 13, color: C.text2 }}>{t('planSub', { n: plan.length })}</T>
            </View>
            <Pressable onPress={() => router.push('/route')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.blueSoft, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 }}>
              <Icon name="map" size={17} color={C.blueInk} />
              <T style={{ color: C.blueInk, fontWeight: '600' }}>{t('map')}</T>
            </Pressable>
          </View>

          <View style={{ paddingHorizontal: 16, gap: 10 }}>
            {data.visit ? (
              <Pressable onPress={() => router.push({ pathname: '/checkin', params: { panchayatId: data.visit!.panchayatId } })}
                style={{ backgroundColor: C.okSoft, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Icon name="pin" color={C.okInk} />
                <T style={{ flex: 1, color: C.okInk, fontWeight: '700' }}>{t('youAreIn')} · {q.assignedOne(data.visit.panchayatId)?.name ?? q.panchayat(data.visit.panchayatId)?.name ?? ''}</T>
                <Icon name="chevron" color={C.okInk} />
              </Pressable>
            ) : null}
            {plan.length === 0 ? <Empty text={t('planEmpty')} icon="map" /> : null}
            {visible.map((item, i) => <PlanRow key={item.kind + item.id} item={item} n={i + 1} first={i === 0} t={t} />)}
            {!showAll && plan.length > 3 ? (
              <Pressable onPress={() => setShowAll(true)} style={{ padding: 12, alignItems: 'center' }}>
                <T style={{ color: C.blueInk, fontWeight: '600' }}>{t('seeMoreStops', { n: plan.length - 3 })}</T>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
        <BottomNav />
      </View>
      <LanguageSheet visible={langOpen} onClose={() => setLangOpen(false)} />
    </SafeAreaView>
  );
}

function Stat({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <T style={{ fontSize: 30, fontWeight: '800', color }}>{n}</T>
      <T style={{ fontSize: 13, color: C.text3 }}>{label}</T>
    </View>
  );
}

function PlanRow({ item, n, first, t }: { item: PlanItem; n: number; first: boolean; t: TFn }) {
  const title = item.kind === 'contact' ? item.contact.name : item.panchayat.name;
  const dist = formatDist(item.distM, t);
  const sub = item.kind === 'contact'
    ? [t(`type_${item.contact.role}` as never) || item.contact.role, item.panchayatName, dist].filter(Boolean).join(' · ')
    : [dist, item.panchayat.source === 'block' ? t('pinApprox') : null].filter(Boolean).join(' · ');
  const reason = item.kind === 'contact'
    ? (item.overdueDays > 0 ? t('reasonOverdue', { n: item.overdueDays }) : t('reasonDueToday'))
    : (item.partners === 0 ? t('reasonNewPanchayat') : t('reasonNotVisited'));
  const panchayatId = item.kind === 'contact' ? item.contact.panchayatId : item.panchayat.panchayatId;
  const open = () => {
    if (item.kind === 'contact') router.push({ pathname: '/partner/[id]', params: { id: item.id } });
    else router.push({ pathname: '/checkin', params: { panchayatId: item.id } });
  };
  const prio = item.kind === 'contact' ? item.contact.priority : null;

  return (
    <Pressable onPress={open} style={({ pressed }) => [{
      backgroundColor: C.card, borderRadius: 18, padding: 14, gap: 12, borderWidth: first ? 2 : 1, borderColor: first ? C.blue : C.border,
    }, pressed && { opacity: 0.85 }]}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: first ? C.blue : C.line, alignItems: 'center', justifyContent: 'center' }}>
          <T style={{ color: first ? '#fff' : C.text3, fontWeight: '700' }}>{n}</T>
        </View>
        <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {prio === 'very_high' ? <Icon name="star" size={15} color={C.star} /> : null}
            <T style={{ fontSize: 16, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>{title}</T>
          </View>
          {sub ? <T style={{ fontSize: 13, color: C.text2 }} numberOfLines={1}>{sub}</T> : null}
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Pill label={reason} tone={item.kind === 'contact' && item.overdueDays > 0 ? 'warn' : 'blue'} icon={item.kind === 'contact' ? 'clock' : 'flag'} />
            {prio && prio !== 'normal' ? (
              <View style={{ backgroundColor: PRIORITY_COLOR[prio].bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                <T style={{ color: PRIORITY_COLOR[prio].fg, fontSize: 12, fontWeight: '700' }}>{t(`priority_${prio}`)}</T>
              </View>
            ) : null}
          </View>
        </View>
        {first ? <View style={{ backgroundColor: C.blueSoft, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}><T style={{ fontSize: 11, fontWeight: '700', color: C.blueInk }}>{t('nextStop')}</T></View> : null}
      </View>
      {first ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Btn flex kind="secondary" icon="nav" label={t('route')} disabled={item.lat == null || item.lng == null}
            onPress={() => item.lat != null && item.lng != null && openDirections(item.lat, item.lng)} />
          <Btn flex icon="pin" label={t('checkIn')} disabled={!panchayatId}
            onPress={() => router.push({ pathname: '/checkin', params: { panchayatId: panchayatId ?? '', contactId: item.kind === 'contact' ? item.id : '' } })} />
        </View>
      ) : null}
    </Pressable>
  );
}
