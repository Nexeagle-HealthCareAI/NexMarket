import React from 'react';
import { Pressable, View } from 'react-native';
import { T, Pill } from './ui';
import { Icon } from './Icon';
import { useSession } from '../lib/session';
import { lastVisited, timesVisited, type Assigned } from '../lib/db';
import { formatDist } from '../lib/plan';
import { relDay } from '../lib/format';
import { haversineM } from '../lib/util';
import { C } from '../theme';

/** Nearest first; panchayats not visited yet come before ones already done when distance is unknown. */
export function sortPanchayats(list: Assigned[], here: { lat: number; lng: number } | null): Assigned[] {
  const d = (a: Assigned) => (here && a.lat != null && a.lng != null ? haversineM(here, { lat: a.lat, lng: a.lng }) : 1e12);
  return [...list].sort((a, b) => d(a) - d(b) || timesVisited(a) - timesVisited(b) || a.name.localeCompare(b.name));
}

/**
 * The agent's block, one row per panchayat: how far it is, and whether it's new or a revisit
 * (with how many times and when last). Tapping picks it.
 */
export function PanchayatList({ list, here, selected, current, onPick }: {
  list: Assigned[];
  here: { lat: number; lng: number } | null;
  selected?: string | null;
  current?: string | null;
  onPick: (id: string) => void;
}) {
  const { t, lang } = useSession();
  return (
    <View style={{ gap: 8 }} accessibilityRole="radiogroup">
      {list.map((p) => {
        const n = timesVisited(p);
        const last = lastVisited(p);
        const on = selected === p.panchayatId;
        const isHere = current === p.panchayatId;
        const dist = here && p.lat != null && p.lng != null ? haversineM(here, { lat: p.lat, lng: p.lng }) : null;
        return (
          <Pressable key={p.panchayatId} onPress={() => onPick(p.panchayatId)} accessibilityRole="radio" accessibilityState={{ selected: on }}
            style={({ pressed }) => [{
              flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: on ? C.blueSoft : C.card,
              borderWidth: on ? 2 : 1, borderColor: on ? C.blue : C.border,
            }, pressed && { opacity: 0.85 }]}>
            <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: n ? C.okSoft : C.blueSoft }}>
              <Icon name={n ? 'check' : 'pin'} color={n ? C.okInk : C.blue} size={20} />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <T style={{ fontWeight: '700', fontSize: 16 }} numberOfLines={1}>{p.name}</T>
              <T style={{ color: C.text2, fontSize: 13 }} numberOfLines={2}>
                {[formatDist(dist, t), n ? t('visitedTimes', { n, when: last ? relDay(t, lang, last) : '—' }) : t('notVisitedYet')].filter(Boolean).join(' · ')}
              </T>
            </View>
            {isHere ? <Pill label={t('youAreHere')} tone="ok" icon="pin" />
              : n ? <Pill label={t('revisit')} tone="ok" /> : <Pill label={t('newPlace')} tone="blue" />}
          </Pressable>
        );
      })}
    </View>
  );
}
