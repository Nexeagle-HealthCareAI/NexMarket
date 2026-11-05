import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Vibration, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useKeepAwake } from 'expo-keep-awake';
import { Btn, T } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { MapWeb, type MapData } from '../components/MapWeb';
import { useSession } from '../lib/session';
import { kvJson, kvSet } from '../lib/db';
import { openDirections } from '../lib/links';
import {
  bearing, compassKey, distM, fetchRoute, fmtDist, fmtDur, progressOn, quiet, say, stepIcon, stepPositions, stepText,
  type NavRoute, type Profile,
} from '../lib/nav';
import { C } from '../theme';

interface Fix { lat: number; lng: number; acc: number | null; heading: number | null; speed: number | null; at: number }

const ARRIVE_M = 80;          // close enough to say "you have arrived"
const OFF_ROUTE_M = 60;       // this far from the line, three fixes running, means a new route
const REROUTE_EVERY_MS = 20000;

/**
 * Turn-by-turn navigation inside the app: the road route on the map, the next turn in big letters, spoken
 * directions, a new route when the agent goes another way, and "Check in here" on arrival. With no internet
 * or no road route it still shows the straight line, the distance and the compass direction.
 */
export default function Navigate() {
  useKeepAwake();
  const { t, lang } = useSession();
  const insets = useSafeAreaInsets();
  const p = useLocalSearchParams<{ lat: string; lng: string; name?: string; sub?: string; panchayatId?: string; contactId?: string }>();
  const dest = useMemo(() => ({ lat: Number(p.lat), lng: Number(p.lng) }), [p.lat, p.lng]);
  const name = p.name || t('navDestination');

  const [fix, setFix] = useState<Fix | null>(null);
  const [perm, setPerm] = useState<'ask' | 'ok' | 'denied'>('ask');
  const [route, setRoute] = useState<NavRoute | null>(null);
  const [routing, setRouting] = useState(false);
  const [noRoad, setNoRoad] = useState(false);
  const [follow, setFollow] = useState(true);
  const [voice, setVoice] = useState(() => kvJson<boolean>('navVoice', true));
  const [profile, setProfile] = useState<Profile>(() => kvJson<Profile>('navProfile', 'car'));
  const [arrived, setArrived] = useState(false);
  const [stayed, setStayed] = useState(false);

  const offCount = useRef(0);
  const lastRouteAt = useRef(0);
  const spoken = useRef(new Set<string>());
  const prevFix = useRef<Fix | null>(null);

  // Live position, as often as the phone gives it while this screen is open.
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let alive = true;
    (async () => {
      let st = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (!st?.granted) st = await Location.requestForegroundPermissionsAsync().catch(() => null);
      if (!alive) return;
      if (!st?.granted) { setPerm('denied'); return; }
      setPerm('ok');
      const last = await Location.getLastKnownPositionAsync().catch(() => null);
      if (alive && last) setFix({ lat: last.coords.latitude, lng: last.coords.longitude, acc: last.coords.accuracy ?? null, heading: null, speed: null, at: Date.now() });
      sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 3 }, (l) => {
        const f: Fix = { lat: l.coords.latitude, lng: l.coords.longitude, acc: l.coords.accuracy ?? null, heading: l.coords.heading ?? null, speed: l.coords.speed ?? null, at: Date.now() };
        setFix(f);
      }).catch(() => null);
    })();
    return () => { alive = false; sub?.remove(); quiet(); };
  }, []);

  const getRoute = useCallback(async (from: { lat: number; lng: number }, prof: Profile) => {
    lastRouteAt.current = Date.now();
    setRouting(true);
    const r = await fetchRoute(from, dest, prof);
    setRouting(false);
    offCount.current = 0;
    spoken.current = new Set();
    if (r) { setRoute(r); setNoRoad(false); } else { setRoute(null); setNoRoad(true); }
    return r;
  }, [dest]);

  // First route as soon as there is a fix; again when the travel mode changes.
  const hasFix = !!fix;
  useEffect(() => {
    if (hasFix && fix) void getRoute(fix, profile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFix, profile, getRoute]);

  // Where we are on the route, the next turn, and how far is left.
  const positions = useMemo(() => (route ? stepPositions(route.coords, route.steps) : []), [route]);
  const prog = useMemo(() => (route && fix ? progressOn(route.coords, fix) : null), [route, fix]);
  const direct = fix ? distM(fix, dest) : null;
  const nextIdx = useMemo(() => {
    if (!route || !prog) return -1;
    for (let i = 1; i < route.steps.length; i++) if (positions[i] > prog.doneM + 8) return i;
    return route.steps.length - 1;
  }, [route, prog, positions]);
  const next = route && nextIdx >= 0 ? route.steps[nextIdx] : null;
  const toNext = next && prog ? Math.max(0, positions[nextIdx] - prog.doneM) : null;
  const after = route && nextIdx >= 0 && nextIdx + 1 < route.steps.length ? route.steps[nextIdx + 1] : null;
  const leftM = prog ? prog.leftM : direct;
  const leftS = route && prog ? route.durationS * (prog.leftM / Math.max(1, route.distanceM)) : direct != null ? direct / (profile === 'foot' ? 1.3 : 8) : null;

  // Heading for the arrow: the compass from GPS when moving, otherwise from the last two fixes.
  const heading = useMemo(() => {
    if (!fix) return 0;
    if (fix.heading != null && fix.heading >= 0 && (fix.speed ?? 0) > 1) return fix.heading;
    const pf = prevFix.current;
    if (pf && distM(pf, fix) > 4) return bearing(pf, fix);
    return route && prog ? bearing(fix, { lat: route.coords[Math.min(route.coords.length - 1, prog.seg + 1)][0], lng: route.coords[Math.min(route.coords.length - 1, prog.seg + 1)][1] }) : bearing(fix, dest);
  }, [fix, route, prog, dest]);
  useEffect(() => { if (fix) prevFix.current = fix; }, [fix]);

  // Arrival, going off the route, and what to say.
  useEffect(() => {
    if (!fix) return;
    if (!arrived && !stayed && ((direct ?? Infinity) < ARRIVE_M || (prog && prog.leftM < 30 && (direct ?? 0) < 200))) {
      setArrived(true);
      Vibration.vibrate([0, 250, 120, 250]);
      if (voice) say(t('navArrivedAt', { name }), lang);
      return;
    }
    if (route && prog && (fix.acc ?? 0) <= 60) {
      offCount.current = prog.offM > OFF_ROUTE_M ? offCount.current + 1 : 0;
      if (offCount.current >= 3 && Date.now() - lastRouteAt.current > REROUTE_EVERY_MS && !routing) {
        if (voice) say(t('navRerouting'), lang);
        void getRoute(fix, profile);
        return;
      }
    }
    if (!voice || !route || !next || toNext == null) return;
    const key = (k: string) => `${nextIdx}:${k}`;
    if (!spoken.current.has('start')) {
      spoken.current.add('start');
      say(`${stepText(route.steps[0], t)}. ${t('navThen')} ${t('navIn', { d: fmtDist(toNext, t) })}, ${stepText(next, t)}`, lang);
      return;
    }
    if (toNext <= 60 && !spoken.current.has(key('now'))) { spoken.current.add(key('now')); spoken.current.add(key('soon')); say(stepText(next, t), lang); }
    else if (toNext <= 350 && toNext > 120 && !spoken.current.has(key('soon'))) { spoken.current.add(key('soon')); say(`${t('navIn', { d: fmtDist(toNext, t) })}, ${stepText(next, t)}`, lang); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix]);

  const setVoiceOn = (v: boolean) => { setVoice(v); kvSet('navVoice', JSON.stringify(v)); if (!v) quiet(); };
  const setProf = (pr: Profile) => { if (pr === profile) return; setProfile(pr); kvSet('navProfile', JSON.stringify(pr)); };

  const straight = !route && !!fix;
  const data = useMemo<MapData>(() => ({
    stops: [],
    me: fix ? { lat: fix.lat, lng: fix.lng } : null,
    dest,
    route: route ? route.coords : fix ? [[fix.lat, fix.lng], [dest.lat, dest.lng]] : [],
    straight,
    nav: { follow, heading },
  }), [fix, dest, route, straight, follow, heading]);

  const arriveAt = leftS != null ? new Date(Date.now() + leftS * 1000).toLocaleTimeString(lang === 'en' ? 'en-IN' : 'hi-IN', { hour: 'numeric', minute: '2-digit' }) : '';
  const checkIn = () => router.replace({ pathname: '/checkin', params: { panchayatId: p.panchayatId ?? '', contactId: p.contactId ?? '' } });

  // ─── Banner at the top: the next turn, or what's happening ───
  let banner: { icon: IconName; big: string; text: string; bg: string } | null = null;
  if (perm === 'denied') banner = { icon: 'alert', big: '', text: t('navNoPermission'), bg: C.bad };
  else if (!fix) banner = { icon: 'locate', big: '', text: t('navFinding'), bg: C.ink };
  else if (arrived) banner = { icon: 'arrive', big: '', text: t('navArrivedAt', { name }), bg: C.ok };
  else if (route && next && toNext != null) banner = { icon: stepIcon(next), big: fmtDist(toNext, t), text: stepText(next, t), bg: '#0b5d3b' };
  else if (routing) banner = { icon: 'route', big: '', text: t('navRouting'), bg: C.ink };
  else if (noRoad && direct != null) banner = { icon: 'nav', big: fmtDist(direct, t), text: t('navStraightLine', { dir: t(compassKey(bearing(fix, dest))) }), bg: '#a35a12' };

  return (
    <View style={{ flex: 1, backgroundColor: '#e9eef5' }}>
      <MapWeb data={data} flat offlineText={t('mapOffline')} onPan={() => setFollow(false)} />

      {/* Top: the next turn */}
      <View style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12, gap: 6 }} pointerEvents="box-none">
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'stretch' }}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('navEnd')}
            style={{ width: 48, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', elevation: 4 }}>
            <Icon name="back" size={22} color={C.text} />
          </Pressable>
          {banner ? (
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: banner.bg, borderRadius: 18, padding: 12, elevation: 6 }}
              accessibilityLiveRegion="polite">
              <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={banner.icon} size={32} color="#fff" strokeWidth={2.4} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                {banner.big ? <T style={{ color: '#fff', fontSize: 26, fontWeight: '800', lineHeight: 30 }}>{banner.big}</T> : null}
                <T style={{ color: '#fff', fontSize: banner.big ? 15 : 16, fontWeight: '600' }} numberOfLines={2}>{banner.text}</T>
              </View>
            </View>
          ) : <View style={{ flex: 1 }} />}
        </View>
        {route && after && toNext != null && toNext < 400 && !arrived ? (
          <View style={{ alignSelf: 'flex-start', marginLeft: 56, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#0b3d29', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 }}>
            <T style={{ color: '#cfe9dc', fontSize: 13 }}>{t('navThen')}</T>
            <Icon name={stepIcon(after)} size={16} color="#fff" />
          </View>
        ) : null}
      </View>

      {/* Right: voice and re-centre */}
      <View style={{ position: 'absolute', right: 12, top: insets.top + 140, gap: 10 }}>
        <RoundBtn icon={voice ? 'volume' : 'volumeOff'} label={voice ? t('navVoiceOff') : t('navVoiceOn')} onPress={() => setVoiceOn(!voice)} active={voice} />
        {!follow ? <RoundBtn icon="locate" label={t('navRecenter')} onPress={() => setFollow(true)} active /> : null}
      </View>

      {/* Bottom: where to, how far, what next */}
      <View style={{ backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12 + insets.bottom, gap: 10, elevation: 12 }}>
        <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: C.border }} />
        {arrived ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: C.okSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="arrive" size={26} color={C.okInk} />
              </View>
              <View style={{ flex: 1 }}>
                <T style={{ fontSize: 19, fontWeight: '800' }} numberOfLines={1}>{name}</T>
                <T style={{ color: C.text2 }}>{t('navYouAreHere')}</T>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn flex kind="secondary" label={t('navKeepGoing')} onPress={() => { setArrived(false); setStayed(true); }} />
              <Btn flex icon="pin" label={t('navCheckInHere')} onPress={checkIn} />
            </View>
          </>
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T style={{ fontSize: 18, fontWeight: '800' }} numberOfLines={1}>{name}</T>
                <T style={{ color: C.text2, fontSize: 14 }} numberOfLines={1}>
                  {leftM != null
                    ? [fmtDist(leftM, t), leftS != null ? fmtDur(leftS, t) : null, arriveAt ? t('navArriveBy', { time: arriveAt }) : null].filter(Boolean).join(' · ')
                    : p.sub || t('navFinding')}
                </T>
              </View>
              <View style={{ flexDirection: 'row', backgroundColor: C.bg, borderRadius: 12, padding: 3 }}>
                {([['car', 'bike', t('navBike')], ['foot', 'walk', t('navWalk')]] as [Profile, IconName, string][]).map(([k, ic, l]) => (
                  <Pressable key={k} onPress={() => setProf(k)} accessibilityRole="button" accessibilityState={{ selected: profile === k }} accessibilityLabel={l}
                    style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9, backgroundColor: profile === k ? C.card : 'transparent', elevation: profile === k ? 2 : 0 }}>
                    <Icon name={ic} size={20} color={profile === k ? C.blueInk : C.text3} />
                  </Pressable>
                ))}
              </View>
            </View>
            {noRoad ? <T style={{ color: C.warnInk, fontSize: 12.5 }}>{t('navNoRoadHelp')}</T> : null}
            <Pressable onPress={() => openDirections(dest.lat, dest.lng)} accessibilityRole="link" hitSlop={8}
              style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 }}>
              <Icon name="nav" size={15} color={C.blueInk} />
              <T style={{ color: C.blueInk, fontWeight: '700', fontSize: 14 }}>{t('navOpenInGoogle')}</T>
            </Pressable>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn kind="danger" label={t('navEnd')} onPress={() => router.back()} />
              <Btn flex icon="pin" label={t('reached')} onPress={checkIn} />
            </View>
          </>
        )}
        {route ? <T style={{ color: C.muted, fontSize: 10.5, textAlign: 'center' }}>{t('navMapCredit')}</T> : null}
      </View>
    </View>
  );
}

function RoundBtn({ icon, label, onPress, active }: { icon: IconName; label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      style={({ pressed }) => ({ width: 50, height: 50, borderRadius: 25, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', elevation: 5, opacity: pressed ? 0.8 : 1 })}>
      <Icon name={icon} size={23} color={active ? C.blueInk : C.text3} />
    </Pressable>
  );
}
