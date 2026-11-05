import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Easing, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { T, toast } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { Vita } from '../components/Vita';
import { PartnerPicker } from '../components/PartnerPicker';
import { RevisitSheet } from '../components/RevisitSheet';
import { EscalateSheet } from '../components/EscalateSheet';
import { useDb, useSession } from '../lib/session';
import { q, type Contact } from '../lib/db';
import { addPhoto } from '../lib/repo';
import { takePhoto } from '../lib/photo';
import { lite } from '../lib/perf';
import { C } from '../theme';

type Pending = 'photo' | 'issue' | 'revisit' | null;
interface Item { key: string; icon: IconName; title: string; sub: string; from: string; to: string; tint: string; onPress: () => void }

/**
 * The centre "+" sheet: everything an agent can do, one tap away. Each action has its own colour badge so it can be
 * found at a glance; the most important one for this moment (check in, or the panchayat you're in) sits on top.
 */
export default function AddSheet() {
  const { t } = useSession();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const visit = useDb(() => q.activeVisit());
  const onShift = useDb(() => !!q.activeShift());
  const [picking, setPicking] = useState<Pending>(null);
  const [issueFor, setIssueFor] = useState<Contact | null>(null);
  const [revisitFor, setRevisitFor] = useState<Contact | null>(null);
  const place = useDb(() => (visit ? q.assignedOne(visit.panchayatId)?.name ?? q.panchayat(visit.panchayatId)?.name ?? '' : ''), [visit?.panchayatId]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/today'));

  // Checking in comes first when on shift without a visit (everything else is logged against it); once checked in,
  // adding people there is the main job and changing panchayat moves into the grid.
  const checkIn: Item = {
    key: 'checkin', icon: 'pin', title: visit ? t('changePanchayat') : t('checkInPanchayat'),
    sub: visit ? t('nowIn', { name: place }) : t('visitSub'), from: '#1d4ed8', to: '#06b6d4', tint: '#e8f1fe',
    onPress: () => router.replace('/checkin'),
  };
  const person: Item = { key: 'person', icon: 'userPlus', title: t('addNewPerson'), sub: place ? t('addsTo', { name: place }) : t('newPartnerSub'), from: '#4338ca', to: '#818cf8', tint: '#eef0ff',
      onPress: () => router.replace({ pathname: '/partner-new', params: visit ? { panchayatId: visit.panchayatId } : {} }) };
  const heroFirst = !visit;
  const hero = heroFirst ? checkIn : { ...person, from: '#3730a3', to: '#22d3ee' };
  const items: Item[] = [
    ...(heroFirst ? [person] : []),
    { key: 'refer', icon: 'ambulance', title: t('referPatient'), sub: t('referPatientSub'), from: '#047857', to: '#34d399', tint: '#e7f8f0',
      onPress: () => router.replace('/refer') },
    { key: 'revisit', icon: 'repeat', title: t('revisitSomeone'), sub: t('revisitSomeoneSub'), from: '#15803d', to: '#a3e635', tint: '#eff9e6',
      onPress: () => setPicking('revisit') },
    { key: 'route', icon: 'route', title: t('addNavigate'), sub: t('addNavigateSub'), from: '#c2410c', to: '#fbbf24', tint: '#fff4e5',
      onPress: () => router.replace('/route') },
    { key: 'photo', icon: 'camera', title: t('photo'), sub: t('photoSub'), from: '#7e22ce', to: '#f0abfc', tint: '#f7ecfd',
      onPress: () => setPicking('photo') },
    { key: 'chat', icon: 'chat', title: t('chatMessageOffice'), sub: t('chatMessageOfficeSub'), from: '#0f766e', to: '#5eead4', tint: '#e6f8f6',
      onPress: () => router.replace('/chat') },
    ...(heroFirst ? [] : [{ ...checkIn, from: '#1d4ed8', to: '#38bdf8', tint: '#e8f1fe' }]),
  ];
  const issue: Item = { key: 'issue', icon: 'flag', title: t('raiseIssue'), sub: t('raiseIssueSub'), from: '#b91c1c', to: '#fb7185', tint: '#fdecee', onPress: () => setPicking('issue') };

  const onPick = async (c: Contact) => {
    if (picking === 'photo') {
      setPicking(null);
      const p = await takePhoto();
      if (p === 'denied') Alert.alert(t('photo'), t('cameraDenied'));
      else if (p) { addPhoto(c.clientId, p); toast(t('savedOnPhone')); close(); }
    } else if (picking === 'issue') {
      setPicking(null);
      setIssueFor(c);
    } else if (picking === 'revisit') {
      setPicking(null);
      setRevisitFor(c);
    }
  };

  // Slide up, then the tiles pop in one after another (skipped on older phones in light mode).
  const still = lite();
  const sheetY = useRef(new Animated.Value(still ? 0 : 1)).current;
  const tiles = useMemo(() => Array.from({ length: items.length + 2 }, () => new Animated.Value(still ? 1 : 0)), [items.length, still]);
  useEffect(() => {
    if (still) return;
    Animated.parallel([
      Animated.timing(sheetY, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.stagger(40, tiles.map((v) => Animated.spring(v, { toValue: 1, friction: 7, tension: 90, useNativeDriver: true }))),
    ]).start();
  }, [still, sheetY, tiles]);
  const pop = (i: number) => ({ opacity: tiles[i], transform: [{ scale: tiles[i].interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) }] });

  return (
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Pressable style={{ ...StyleFill, backgroundColor: 'rgba(14,21,37,0.55)' }} onPress={close} accessibilityLabel={t('close')} />
      <Animated.View style={{ maxHeight: winH * 0.9, backgroundColor: C.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden',
        transform: [{ translateY: sheetY.interpolate({ inputRange: [0, 1], outputRange: [0, 500] }) }] }}>
        {/* Header with Vita */}
        <View style={{ backgroundColor: C.ink, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 30 }}>
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)', marginBottom: 10 }} />
          <HeaderGlow />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <T style={{ color: '#9fb6d8', fontSize: 13, fontWeight: '600' }}>
                {onShift ? (visit ? t('nowIn', { name: place }) : t('addOnShift')) : t('addOffShift')}
              </T>
              <T style={{ color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 2 }}>{t('whatToAdd')}</T>
            </View>
            <Vita mood="wave" height={64} bob={!still} />
          </View>
        </View>

        <ScrollView style={{ marginTop: -18 }} contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 14 + insets.bottom, gap: 10 }} showsVerticalScrollIndicator={false}>
          {/* Hero */}
          <Animated.View style={pop(0)}>
            <Pressable onPress={hero.onPress} accessibilityRole="button" accessibilityLabel={`${hero.title}. ${hero.sub}`}
              style={({ pressed }) => ({ borderRadius: 22, overflow: 'hidden', transform: [{ scale: pressed ? 0.98 : 1 }], elevation: 6 })}>
              <GradientFill from={hero.from} to={hero.to} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 }}>
                <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' }}>
                  <Icon name={hero.icon} size={30} color="#fff" strokeWidth={2.3} />
                </View>
                <View style={{ flex: 1 }}>
                  <T style={{ color: '#fff', fontSize: 19, fontWeight: '800' }}>{hero.title}</T>
                  <T style={{ color: 'rgba(255,255,255,0.88)', fontSize: 13.5 }} numberOfLines={2}>{hero.sub}</T>
                </View>
                <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="chevron" size={18} color={hero.from} strokeWidth={2.6} />
                </View>
              </View>
            </Pressable>
          </Animated.View>

          {/* Two-column grid */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {items.map((it, i) => (
              <Animated.View key={it.key} style={[{ width: '48.4%' }, pop(i + 1)]}>
                <Tile it={it} />
              </Animated.View>
            ))}
          </View>

          {/* Problem: always last, full width, clearly separate */}
          <Animated.View style={pop(items.length + 1)}>
            <Pressable onPress={issue.onPress} accessibilityRole="button" accessibilityLabel={`${issue.title}. ${issue.sub}`}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, backgroundColor: pressed ? '#fbdde1' : issue.tint, borderWidth: 1, borderColor: '#f6c9cf' })}>
              <Badge from={issue.from} to={issue.to} icon={issue.icon} size={42} />
              <View style={{ flex: 1 }}>
                <T style={{ fontWeight: '800', fontSize: 15.5, color: '#9f1239' }}>{issue.title}</T>
                <T style={{ color: C.text2, fontSize: 12.5 }} numberOfLines={1}>{issue.sub}</T>
              </View>
              <Icon name="chevron" size={18} color="#be123c" />
            </Pressable>
          </Animated.View>
        </ScrollView>
      </Animated.View>
      <PartnerPicker visible={picking != null} onClose={() => setPicking(null)} onPick={onPick} panchayatFirst={visit?.panchayatId} />
      <RevisitSheet visible={!!revisitFor} onClose={() => { setRevisitFor(null); close(); }} contactId={revisitFor?.clientId ?? ''} name={revisitFor?.name ?? ''} />
      <EscalateSheet visible={!!issueFor} onClose={() => setIssueFor(null)} contactId={issueFor?.clientId ?? ''} name={issueFor?.name ?? ''} onDone={close} />
    </View>
  );
}

function Tile({ it }: { it: Item }) {
  return (
    <Pressable onPress={it.onPress} accessibilityRole="button" accessibilityLabel={`${it.title}. ${it.sub}`}
      style={({ pressed }) => ({ minHeight: 132, borderRadius: 20, padding: 14, gap: 10, backgroundColor: pressed ? it.tint : C.card,
        borderWidth: 1, borderColor: pressed ? it.from + '55' : C.border, transform: [{ scale: pressed ? 0.97 : 1 }], elevation: pressed ? 1 : 2 })}>
      <Badge from={it.from} to={it.to} icon={it.icon} />
      <View style={{ gap: 2 }}>
        <T style={{ fontWeight: '800', fontSize: 15.5, lineHeight: 19 }} numberOfLines={2}>{it.title}</T>
        <T style={{ color: C.text2, fontSize: 12.5, lineHeight: 16 }} numberOfLines={2}>{it.sub}</T>
      </View>
    </Pressable>
  );
}

/** The action's logo: a glossy gradient badge with a white icon. */
function Badge({ from, to, icon, size = 50 }: { from: string; to: string; icon: IconName; size?: number }) {
  const id = `g${from.slice(1)}${to.slice(1)}`;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 50 50" style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={to} />
            <Stop offset="1" stopColor={from} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={50} height={50} rx={16} fill={`url(#${id})`} />
        <Path d="M6 18 C 14 6, 34 4, 46 12 L 46 6 C 46 3, 44 2, 42 2 L 10 2 C 6 2, 4 4, 4 8 Z" fill="#fff" opacity={0.18} />
        <Circle cx={42} cy={42} r={14} fill="#fff" opacity={0.08} />
      </Svg>
      <View style={{ ...StyleFill, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={Math.round(size * 0.5)} color="#fff" strokeWidth={2.2} />
      </View>
    </View>
  );
}

function GradientFill({ from, to }: { from: string; to: string }) {
  return (
    <Svg style={StyleFill} width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="hero" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={from} />
          <Stop offset="1" stopColor={to} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={100} height={100} fill="url(#hero)" />
      <Circle cx={92} cy={8} r={30} fill="#fff" opacity={0.1} />
      <Circle cx={78} cy={110} r={34} fill="#fff" opacity={0.07} />
    </Svg>
  );
}

function HeaderGlow() {
  return (
    <Svg style={StyleFill} width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100" pointerEvents="none">
      <Circle cx={88} cy={20} r={40} fill="#2b6fd6" opacity={0.25} />
      <Circle cx={10} cy={110} r={30} fill="#14b8a6" opacity={0.14} />
    </Svg>
  );
}

const StyleFill = { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 };
