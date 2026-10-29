import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, Image, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Svg, { Circle, Defs, Line, Path, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { Vita, type VitaMood } from '../components/Vita';
import { BottomNav, Empty, Pill, T } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { LanguageButton, LanguageSheet } from '../components/LanguageSheet';
import { TasksSection } from '../components/TaskCard';
import { useDb, useSession, useSync } from '../lib/session';
import { db, q } from '../lib/db';
import { buildPlan, formatDist, type PlanItem } from '../lib/plan';
import { useHere } from '../lib/useHere';
import { assignment } from '../lib/sync';
import { finishShift, resumeTrackingIfNeeded } from '../lib/shift';
import { openDirections } from '../lib/links';
import { dayShort, km, timeOf, weekday } from '../lib/format';
import { routeKm, startOfDay, ymd } from '../lib/util';
import { cachedTasks } from '../lib/tasks';
import { cachedTips, ensureTips } from '../lib/aiTips';
import { C, PRIORITY_COLOR } from '../theme';
import type { Lang, TFn } from '../i18n';

function weekStart(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d.toISOString();
}

const greetingKey = () => {
  const h = new Date().getHours();
  return h < 12 ? 'goodMorning' : h < 17 ? 'goodAfternoon' : 'goodEvening';
};

export default function Today() {
  const { t, agent, lang } = useSession();
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
  useEffect(() => { if (sync.online) void ensureTips(lang); }, [lang, sync.online]);

  const data = useDb(() => {
    const shift = q.activeShift();
    const pts = shift ? q.trajectorySince(shift.startTime) : [];
    const ws = weekStart();
    const today = startOfDay().toISOString();
    const two = new Date(startOfDay().getTime() - 14 * 864e5).toISOString();
    const week = db().getFirstSync<{ sent: number; arrived: number }>(
      `SELECT COUNT(*) AS sent,
              SUM(CASE WHEN status IN ('arrived','opd','admitted','procedure','discharged') THEN 1 ELSE 0 END) AS arrived
         FROM referrals WHERE createdAt >= ?`, ws) ?? { sent: 0, arrived: 0 };
    const visitsToday = db().getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM visits WHERE checkInAt >= ?', today)?.n ?? 0;
    const partnersToday = db().getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM contacts WHERE createdAt >= ?', today)?.n ?? 0;
    const partners14 = db().getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM contacts WHERE createdAt >= ? AND createdAt < ?', two, today)?.n ?? 0;
    return {
      shift, kmToday: routeKm(pts), week, unsent: q.outboxCount(), visit: q.activeVisit(), visitsToday, partnersToday, partners14,
      here: (() => {
        const v = q.activeVisit();
        if (!v) return null;
        return { name: q.assignedOne(v.panchayatId)?.name ?? q.panchayat(v.panchayatId)?.name ?? '', since: v.checkInAt, people: q.contactsIn(v.panchayatId).length, id: v.panchayatId };
      })(),
      openTasks: cachedTasks().filter((x) => x.status === 'open').length, tip: cachedTips(lang)?.tips[0] ?? null,
      lateTasks: cachedTasks().filter((x) => x.status === 'open' && x.dueDate != null && x.dueDate < ymd()).length,
      shiftDoneToday: (db().getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM shifts WHERE endTime IS NOT NULL AND endTime >= ?', today)?.n ?? 0) > 0,
    };
  }, [lang]);
  const plan = useDb(() => buildPlan(here), [here?.lat, here?.lng]);
  const block = assignment().block ?? agent?.block ?? '';

  const end = () => {
    Alert.alert(t('endShift'), t('endShiftConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('endShift'), style: 'destructive', onPress: () => { void finishShift(); } },
    ]);
  };

  const [next, ...rest] = plan;
  const visible = showAll ? rest : rest.slice(0, 3);
  const firstName = agent?.name?.split(' ')[0] ?? '';
  const initials = (agent?.name ?? '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
  // Rings: visits against today's plan, new partners against the agent's own 14-day daily average, patients arrived of those sent.
  const avgPartners = Math.max(1, Math.round(data.partners14 / 14));
  const rings = [
    { n: data.visitsToday, of: data.visitsToday + plan.length, color: C.mint, label: t('ringVisits') },
    { n: data.partnersToday, of: avgPartners, color: '#6cb6ff', label: t('ringPartners') },
    { n: data.week.sent ?? 0, of: data.week.sent ?? 0, fill: data.week.sent ? (data.week.arrived ?? 0) / data.week.sent : 0, color: '#ffcf7a', label: t('ringPatients') },
  ];

  // What Vita says and how it looks, from the agent's day.
  const hour = new Date().getHours();
  const late = data.lateTasks + plan.filter((p) => p.kind === 'contact' && p.overdueDays > 0).length;
  const nextName = next ? (next.kind === 'contact' ? next.contact.name : next.panchayat.name) : '';
  const mood: { pose: VitaMood; say: string } =
    !data.shift
      ? (hour >= 21 || hour < 5) ? { pose: 'sleep', say: t('vitaNight') }
        : data.shiftDoneToday ? { pose: 'relax', say: t('vitaDone', { n: data.visitsToday }) }
          : hour < 12 ? { pose: 'coffee', say: t('vitaMorning', { n: plan.length }) }
            : { pose: 'wave', say: t('vitaReady', { n: plan.length }) }
      : late > 0 ? { pose: 'stern', say: t('vitaLate', { n: late }) }
        : plan.length === 0 && data.visitsToday > 0 ? { pose: 'cheer', say: t('vitaCheer') }
          : hour === 13 ? { pose: 'snack', say: t('vitaLunch') }
            : { pose: 'fly', say: nextName ? t('vitaFly', { name: nextName }) : t('vitaFlyNone') };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.ink }} edges={['top']}>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
          {/* Hero: brand bar, Vita with today's message, the shift, live rings */}
          <View style={{ backgroundColor: C.ink, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 34, gap: 14, overflow: 'hidden' }}>
            <Aurora />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Image source={require('../../assets/brand/logo.png')} style={{ width: 30, height: 22 }} resizeMode="contain" />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T style={{ color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: 0.3 }} numberOfLines={1}>NexMarket <T style={{ color: C.mint, fontSize: 15, fontWeight: '800' }}>AI</T></T>
                <T style={{ color: C.sideText, fontSize: 10, letterSpacing: 0.4 }} numberOfLines={1}>{t('poweredBy')}</T>
              </View>
              <LiveDot online={sync.online} running={sync.running} t={t} compact={data.unsent > 0} />
              {data.unsent > 0 ? (
                <Pressable onPress={() => router.replace('/me')} accessibilityLabel={t('nOnPhone', { n: data.unsent })} hitSlop={6}
                  style={{ height: 36, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,207,122,0.12)', borderWidth: 1, borderColor: 'rgba(255,207,122,0.3)', borderRadius: 999, paddingHorizontal: 10 }}>
                  <Icon name={sync.online ? 'upload' : 'cloudOff'} size={14} color="#ffcf7a" />
                  <T style={{ color: '#ffcf7a', fontSize: 13, fontWeight: '800' }}>{data.unsent}</T>
                </Pressable>
              ) : null}
              <LanguageButton onPress={() => setLangOpen(true)} />
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, minHeight: 128 }}>
              <View style={{ flex: 1, minWidth: 0, gap: 10, paddingBottom: 6 }}>
                <View>
                  <T style={{ color: '#fff', fontSize: 22, fontWeight: '800' }} numberOfLines={2}>{t(greetingKey(), { name: firstName })}</T>
                  <T style={{ color: C.sideText, fontSize: 12 }} numberOfLines={1}>{[`${weekday(lang, new Date())}, ${dayShort(lang, new Date())}`, block].filter(Boolean).join(' · ')}</T>
                </View>
                <View style={{ alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', borderRadius: 16, borderBottomRightRadius: 4, paddingHorizontal: 12, paddingVertical: 9, maxWidth: '100%' }}>
                  <T style={{ color: '#fff', fontSize: 13, lineHeight: 18, fontWeight: '600' }} numberOfLines={3}>{mood.say}</T>
                </View>
              </View>
              <Vita mood={mood.pose} height={mood.pose === 'fly' ? 96 : 128} />
            </View>

            {data.shift ? (
              <View style={glass}>
                <Pulse />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <ShiftTimer since={data.shift.startTime} />
                  <T style={{ color: C.sideText, fontSize: 12 }} numberOfLines={2}>{t('shiftLive', { km: km(t, data.kmToday) })}</T>
                </View>
                <Pressable onPress={end} hitSlop={6} style={({ pressed }) => [{ borderWidth: 1, borderColor: C.inkLine, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 }, pressed && { opacity: 0.7 }]}>
                  <T style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{t('endShift')}</T>
                </Pressable>
              </View>
            ) : null}
            {data.shift ? <WhereNow here={data.here} t={t} lang={lang} /> : (
              <Pressable onPress={() => router.push('/shift')} style={({ pressed }) => [glass, pressed && { opacity: 0.9 }]} accessibilityRole="button" accessibilityLabel={t('startShift')}>
                <StartOrb />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <T style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>{t('startShift')}</T>
                  <T style={{ color: C.sideText, fontSize: 12 }} numberOfLines={2}>{t('startShiftSub', { n: plan.length, m: data.openTasks })}</T>
                </View>
                <Icon name="chevron" color={C.sideText} />
              </Pressable>
            )}

            <View style={{ flexDirection: 'row', gap: 8 }}>
              {rings.map((r) => <Ring key={r.label} {...r} />)}
            </View>
          </View>

          {/* Ask the AI helper */}
          <View style={{ paddingHorizontal: 14, marginTop: -20, gap: 8 }}>
            <Pressable onPress={() => router.replace('/assistant')} accessibilityRole="button" accessibilityLabel={t('aiHelper')}
              style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 18, paddingVertical: 11, paddingHorizontal: 12,
                borderWidth: 1, borderColor: C.border, elevation: 4, shadowColor: C.ink, shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } }, pressed && { opacity: 0.9 }]}>
              <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: C.purpleSoft, alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden' }}>
                <Vita mood="think" height={40} bob={false} />
              </View>
              <T style={{ flex: 1, color: C.muted, fontSize: 15 }} numberOfLines={1}>{t('aiAskHome')}</T>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.blueSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="send" size={16} color={C.blueInk} />
              </View>
            </Pressable>
            {data.tip ? (
              <Pressable onPress={() => router.replace('/assistant')} style={{ flexDirection: 'row', gap: 10, backgroundColor: C.purpleSoft, borderRadius: 16, padding: 12 }}>
                <Icon name="sparkle" size={16} color={C.purple} />
                <View style={{ flex: 1, gap: 2 }}>
                  <T style={{ color: C.purple, fontWeight: '800', fontSize: 13 }}>{t('aiTipToday')} · {data.tip.title}</T>
                  <T style={{ color: C.text3, fontSize: 13, lineHeight: 19 }} numberOfLines={3}>{data.tip.detail}</T>
                </View>
              </Pressable>
            ) : null}
          </View>

          {/* Quick actions: what the agent needs right now */}
          <View style={{ paddingHorizontal: 14, paddingTop: 18, gap: 10 }}>
            <SectionHead icon="star" color={C.star} title={t('quickActions')} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Quick icon="users" bg={C.blueSoft} fg={C.blueInk} label={t('addNewPerson')}
                onPress={() => router.push({ pathname: '/partner-new', params: data.here ? { panchayatId: data.here.id } : {} })} />
              <Quick icon="hospital" bg={C.okSoft} fg={C.okInk} label={t('referPatient')} onPress={() => router.push('/refer')} />
              {data.shift
                ? <Quick icon="pin" bg={C.infoSoft} fg={C.infoInk} label={data.here ? t('changePanchayat') : t('checkIn')} onPress={() => router.push('/checkin')} />
                : <Quick icon="map" bg={C.infoSoft} fg={C.infoInk} label={t('map')} onPress={() => router.push('/route')} />}
              {data.shift
                ? <Quick icon="map" bg={C.purpleSoft} fg={C.purple} label={t('map')} onPress={() => router.push('/route')} />
                : <Quick icon="leave" bg={C.warnSoft} fg={C.warnInk} label={t('qaLeave')} onPress={() => router.push('/leave')} />}
            </View>
          </View>

          {/* Tasks from the manager */}
          <TasksSection />

          {/* Today's plan */}
          <View style={{ paddingHorizontal: 14, paddingTop: 20, gap: 10 }}>
            <SectionHead icon="pin" color={C.blue} title={t('todaysPlan')} sub={t('planSub', { n: plan.length })}
              right={<Pressable onPress={() => router.push('/route')} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.blueSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 }}>
                <Icon name="map" size={15} color={C.blueInk} /><T style={{ color: C.blueInk, fontWeight: '700', fontSize: 13 }}>{t('map')}</T>
              </Pressable>} />

            {!next ? <Empty text={t('planEmpty')} icon="map" /> : <NextStop item={next} t={t} />}
            {rest.length > 0 ? (
              <View style={{ paddingLeft: 22 }}>
                <View style={{ position: 'absolute', left: 9, top: 14, bottom: 14, width: 2, backgroundColor: C.borderStrong, borderRadius: 1 }} />
                {visible.map((item) => <TimelineRow key={item.kind + item.id} item={item} t={t} />)}
                {!showAll && rest.length > 3 ? (
                  <Pressable onPress={() => setShowAll(true)} style={{ padding: 12, alignItems: 'center', backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border }}>
                    <T style={{ color: C.blueInk, fontWeight: '700' }}>{t('seeMoreStops', { n: rest.length - 3 })}</T>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        </ScrollView>
        <BottomNav />
      </View>
      <LanguageSheet visible={langOpen} onClose={() => setLangOpen(false)} />
    </SafeAreaView>
  );
}

/** On shift: the panchayat the agent is working in, with the next things to do there; or a nudge to check in. */
function WhereNow({ here, t, lang }: { here: { name: string; since: string; people: number; id: string } | null; t: TFn; lang: Lang }) {
  if (!here) {
    return (
      <Pressable onPress={() => router.push('/checkin')} accessibilityRole="button"
        style={({ pressed }) => [glass, { borderColor: 'rgba(255,207,122,0.45)', backgroundColor: 'rgba(255,207,122,0.1)' }, pressed && { opacity: 0.85 }]}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,207,122,0.18)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="pin" color="#ffcf7a" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>{t('notCheckedIn')}</T>
          <T style={{ color: C.sideText, fontSize: 12 }} numberOfLines={2}>{t('notCheckedInSub')}</T>
        </View>
        <View style={{ backgroundColor: '#ffcf7a', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 }}>
          <T style={{ color: C.ink, fontWeight: '800', fontSize: 13 }}>{t('checkIn')}</T>
        </View>
      </Pressable>
    );
  }
  const open = () => router.push({ pathname: '/checkin', params: { panchayatId: here.id } });
  return (
    <View style={[glass, { flexDirection: 'column', alignItems: 'stretch', gap: 12, borderColor: 'rgba(56,246,169,0.35)' }]}>
      <Pressable onPress={open} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(56,246,169,0.15)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="pin" color={C.mint} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T style={{ color: C.sideText, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 }}>{t('workingIn').toUpperCase()}</T>
          <T style={{ color: '#fff', fontWeight: '800', fontSize: 18 }} numberOfLines={1}>{here.name}</T>
          <T style={{ color: C.sideText, fontSize: 12 }} numberOfLines={1}>{t('sinceAndPeople', { time: timeOf(lang, here.since), n: here.people })}</T>
        </View>
        <Icon name="chevron" color={C.sideText} />
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <HeroBtn icon="plus" label={t('addShort')} primary onPress={() => router.push({ pathname: '/partner-new', params: { panchayatId: here.id } })} />
        <HeroBtn icon="check" label={t('revisit')} onPress={open} />
        <HeroBtn icon="nav" label={t('nextPanchayat')} onPress={() => router.push('/checkin')} />
      </View>
    </View>
  );
}

function HeroBtn({ icon, label, onPress, primary }: { icon: IconName; label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [{ flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingHorizontal: 6,
        backgroundColor: primary ? C.mint : 'rgba(255,255,255,0.08)', borderWidth: primary ? 0 : 1, borderColor: 'rgba(255,255,255,0.16)' }, pressed && { opacity: 0.8 }]}>
      <Icon name={icon} size={16} color={primary ? C.ink : '#fff'} />
      <T style={{ color: primary ? C.ink : '#fff', fontWeight: '800', fontSize: 13 }} numberOfLines={1}>{label}</T>
    </Pressable>
  );
}

const glass = {
  flexDirection: 'row' as const, alignItems: 'center' as const, gap: 14, padding: 14, borderRadius: 20,
  backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
};

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Slowly drifting blue and green light behind the dark header. */
function Aurora() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 9000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 9000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  const blob = (id: string, color: string, o: number) => (
    <Svg width={420} height={420}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={o} />
          <Stop offset="1" stopColor={color} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="420" height="420" fill={`url(#${id})`} />
    </Svg>
  );
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
      <Animated.View style={{ position: 'absolute', right: -170, top: -190, transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, -60] }) }, { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, 30] }) }] }}>
        {blob('a1', '#2a5bd7', 0.75)}
      </Animated.View>
      <Animated.View style={{ position: 'absolute', left: -190, bottom: -220, transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, 70] }) }] }}>
        {blob('a2', '#13a37a', 0.6)}
      </Animated.View>
    </View>
  );
}

/** "Live" when connected (pulsing), "Syncing" while sending, "Offline" otherwise. */
function LiveDot({ online, running, t, compact }: { online: boolean; running: boolean; t: TFn; compact?: boolean }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!online) return;
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1600, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [v, online]);
  const color = !online ? C.muted : running ? '#ffcf7a' : C.mint;
  return (
    <View accessibilityLabel={!online ? t('liveOffline') : running ? t('liveSyncing') : t('liveOn')} style={{ height: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: compact ? 13 : 10, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
      <View style={{ width: 8, height: 8, alignItems: 'center', justifyContent: 'center' }}>
        {online ? <Animated.View style={{ position: 'absolute', width: 16, height: 16, borderRadius: 8, backgroundColor: color,
          opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.4] }) }] }} /> : null}
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      </View>
      {compact ? null : <T style={{ color, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 }}>{(!online ? t('liveOffline') : running ? t('liveSyncing') : t('liveOn')).toUpperCase()}</T>}
    </View>
  );
}

/** The big green start button, breathing softly so it invites a tap. */
function StartOrb() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <View style={{ width: 66, height: 66, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ position: 'absolute', width: 66, height: 66, borderRadius: 33, backgroundColor: 'rgba(56,246,169,0.18)', transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.08] }) }] }} />
      <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: '#1fd38e', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="nav" size={24} color={C.ink} strokeWidth={2.4} />
      </View>
    </View>
  );
}

/** A live "on shift" dot with a soft ring that keeps pulsing. */
function Pulse() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <View style={{ width: 46, height: 46, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ position: 'absolute', width: 46, height: 46, borderRadius: 23, borderWidth: 2, borderColor: C.mint,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.3] }) }] }} />
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(56,246,169,0.15)', alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: C.mint }} />
      </View>
    </View>
  );
}

/** h:mm:ss since the shift started; only this ticks every second. */
function ShiftTimer({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const txt = `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return <T style={{ color: '#fff', fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: 0.5 }}>{txt}</T>;
}

function Ring({ n, of, fill, color, label }: { n: number; of: number; fill?: number; color: string; label: string }) {
  const r = 21, c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, fill ?? (of > 0 ? n / of : 0)));
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: p, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [v, p]);
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 4, paddingVertical: 10, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
      <Svg width={54} height={54} viewBox="0 0 54 54">
        <Circle cx={27} cy={27} r={r} stroke="rgba(255,255,255,0.12)" strokeWidth={6} fill="none" />
        <AnimatedCircle cx={27} cy={27} r={r} stroke={color} strokeWidth={6} fill="none" strokeLinecap="round"
          strokeDasharray={`${c} ${c}`} strokeDashoffset={v.interpolate({ inputRange: [0, 1], outputRange: [c, 0] })} transform="rotate(-90 27 27)" opacity={p > 0 ? 1 : 0} />
        <SvgText x={27} y={32} textAnchor="middle" fill="#fff" fontSize={16} fontWeight="800">{String(n)}</SvgText>
      </Svg>
      <T style={{ color: C.sideText, fontSize: 11, fontWeight: '600', textAlign: 'center' }} numberOfLines={1}>{label}</T>
    </View>
  );
}

function SectionHead({ icon, color, title, sub, right }: { icon: IconName; color: string; title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }}>
      <Icon name={icon} size={18} color={color} />
      <View style={{ flex: 1 }}>
        <T style={{ fontSize: 18, fontWeight: '800' }}>{title}</T>
        {sub ? <T style={{ fontSize: 12, color: C.text2 }}>{sub}</T> : null}
      </View>
      {right}
    </View>
  );
}

function Quick({ icon, bg, fg, label, onPress }: { icon: IconName; bg: string; fg: string; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [{ flex: 1, alignItems: 'center', gap: 6, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 4 }, pressed && { opacity: 0.8 }]}>
      <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={19} color={fg} />
      </View>
      <T style={{ fontSize: 11, fontWeight: '700', color: C.text3, textAlign: 'center' }} numberOfLines={2}>{label}</T>
    </Pressable>
  );
}

const typeLabel = (t: TFn, role: string) => {
  const key = `type_${role}`;
  const v = t(key as never);
  return v && v !== key ? v : role.replace(/_/g, ' ');
};

function describe(item: PlanItem, t: TFn) {
  const title = item.kind === 'contact' ? item.contact.name : item.panchayat.name;
  const dist = formatDist(item.distM, t);
  const sub = item.kind === 'contact'
    ? [typeLabel(t, item.contact.role), item.panchayatName].filter(Boolean).join(' · ')
    : item.panchayat.source === 'block' ? t('pinApprox') : '';
  const reason = item.kind === 'contact'
    ? (item.overdueDays > 0 ? t('reasonOverdue', { n: item.overdueDays }) : t('reasonDueToday'))
    : (item.partners === 0 ? t('reasonNewPanchayat') : t('reasonNotVisited'));
  const tone: 'warn' | 'blue' | 'ok' = item.kind === 'contact' ? (item.overdueDays > 0 ? 'warn' : 'blue') : item.partners === 0 ? 'ok' : 'blue';
  const panchayatId = item.kind === 'contact' ? item.contact.panchayatId : item.panchayat.panchayatId;
  const prio = item.kind === 'contact' ? item.contact.priority : null;
  const open = () => {
    if (item.kind === 'contact') router.push({ pathname: '/partner/[id]', params: { id: item.id } });
    else router.push({ pathname: '/checkin', params: { panchayatId: item.id } });
  };
  return { title, dist, sub, reason, tone, panchayatId, prio, open };
}

/** The first stop, big: a small map-like band with the distance, then route and check-in. */
function NextStop({ item, t }: { item: PlanItem; t: TFn }) {
  const d = describe(item, t);
  return (
    <Pressable onPress={d.open} style={({ pressed }) => [{ backgroundColor: C.card, borderRadius: 22, overflow: 'hidden', borderWidth: 2, borderColor: C.blue,
      elevation: 3, shadowColor: C.blue, shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } }, pressed && { opacity: 0.92 }]}>
      <View style={{ height: 92, backgroundColor: '#f3f6fb' }}>
        <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 360 92">
          {Array.from({ length: 17 }, (_, i) => <Line key={`v${i}`} x1={i * 22} y1={0} x2={i * 22} y2={92} stroke="#e3e9f2" strokeWidth={1} />)}
          {Array.from({ length: 5 }, (_, i) => <Line key={`h${i}`} x1={0} y1={i * 22} x2={360} y2={i * 22} stroke="#e3e9f2" strokeWidth={1} />)}
          <Path d="M -10 80 C 80 70, 120 20, 200 46 S 280 30, 282 34" stroke={C.blue} strokeOpacity={0.6} strokeWidth={4} fill="none" strokeDasharray="10 7" strokeLinecap="round" />
          <Circle cx={282} cy={34} r={18} fill={C.blue} fillOpacity={0.15} />
          <Circle cx={282} cy={34} r={9} fill="#fff" />
          <Circle cx={282} cy={34} r={6} fill={C.blue} />
        </Svg>
        {d.dist ? (
          <View style={{ position: 'absolute', left: 12, bottom: 10, backgroundColor: C.ink, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
            <T style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{d.dist}</T>
          </View>
        ) : null}
      </View>
      <View style={{ padding: 14, gap: 4 }}>
        <T style={{ fontSize: 11, fontWeight: '800', color: C.blueInk, letterSpacing: 0.6 }}>{t('nextStopLabel').toUpperCase()}</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {d.prio === 'very_high' ? <Icon name="star" size={16} color={C.star} /> : null}
          <T style={{ fontSize: 19, fontWeight: '800', flexShrink: 1 }} numberOfLines={1}>{d.title}</T>
        </View>
        {d.sub ? <T style={{ fontSize: 13, color: C.text2 }} numberOfLines={1}>{d.sub}</T> : null}
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
          <Pill label={d.reason} tone={d.tone} icon={item.kind === 'contact' ? 'clock' : 'flag'} />
          {d.prio && d.prio !== 'normal' ? (
            <View style={{ backgroundColor: PRIORITY_COLOR[d.prio].bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
              <T style={{ color: PRIORITY_COLOR[d.prio].fg, fontSize: 12, fontWeight: '700' }}>{t(`priority_${d.prio}`)}</T>
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <Pressable disabled={item.lat == null || item.lng == null} onPress={() => item.lat != null && item.lng != null && openDirections(item.lat, item.lng)}
            style={({ pressed }) => [actionBtn, { backgroundColor: C.card, borderWidth: 1, borderColor: C.borderStrong }, (item.lat == null || item.lng == null) && { opacity: 0.45 }, pressed && { opacity: 0.8 }]}>
            <Icon name="nav" size={18} color={C.text} /><T style={{ fontWeight: '700', fontSize: 15 }}>{t('route')}</T>
          </Pressable>
          <Pressable disabled={!d.panchayatId} onPress={() => router.push({ pathname: '/checkin', params: { panchayatId: d.panchayatId ?? '', contactId: item.kind === 'contact' ? item.id : '' } })}
            style={({ pressed }) => [actionBtn, { backgroundColor: C.blue }, !d.panchayatId && { opacity: 0.45 }, pressed && { opacity: 0.85 }]}>
            <Icon name="pin" size={18} color="#fff" /><T style={{ fontWeight: '700', fontSize: 15, color: '#fff' }}>{t('checkIn')}</T>
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}
const actionBtn = { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, borderRadius: 14, paddingVertical: 12 };

function TimelineRow({ item, t }: { item: PlanItem; t: TFn }) {
  const d = describe(item, t);
  return (
    <View style={{ marginBottom: 8 }}>
      <View style={{ position: 'absolute', left: -18, top: '50%', marginTop: -6, width: 12, height: 12, borderRadius: 6, backgroundColor: C.card, borderWidth: 2, borderColor: d.tone === 'warn' ? C.warn : C.blue }} />
      <Pressable onPress={d.open} style={({ pressed }) => [{ backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, pressed && { opacity: 0.85 }]}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            {d.prio === 'very_high' ? <Icon name="star" size={14} color={C.star} /> : null}
            <T style={{ fontSize: 15, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>{d.title}</T>
          </View>
          <T style={{ fontSize: 12, color: C.text2 }} numberOfLines={1}>{[d.sub, d.dist].filter(Boolean).join(' · ')}</T>
        </View>
        <Pill label={d.reason} tone={d.tone} />
      </Pressable>
    </View>
  );
}
