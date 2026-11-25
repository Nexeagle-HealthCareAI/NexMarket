import React from 'react';
import { Pressable, View } from 'react-native';
import { Pill, Sheet, T } from './ui';
import { Icon } from './Icon';
import { useSession } from '../lib/session';
import { dayShort } from '../lib/format';
import type { Camp } from '../lib/camps';
import type { Lang, TFn } from '../i18n';
import { C } from '../theme';

/** "Sat 29 Nov · 09:00–14:00" (or "Today · …"). */
export function campWhen(c: Pick<Camp, 'date' | 'startTime' | 'endTime'>, t: TFn, lang: Lang, today?: string | null): string {
  const d = today && c.date === today ? t('apToday') : dayShort(lang, c.date);
  return `${d} · ${c.startTime}–${c.endTime}`;
}

export const campPlace = (c: Pick<Camp, 'venue' | 'block' | 'district'>) => [...new Set([c.venue, c.block, c.district].filter(Boolean))].join(', ');

/** The camp card on the Book screen: which camp, when, where, and how many places are left. */
export function CampCard({ camp, today, onPress }: { camp: Camp; today: string | null; onPress?: () => void }) {
  const { t, lang } = useSession();
  const full = camp.placesLeft <= 0;
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="button" accessibilityLabel={`${t('cmCampLabel')}: ${camp.title}. ${t('apChangePlace')}`}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: C.okSoft }, pressed && { opacity: 0.85 }]}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T style={{ fontSize: 12, fontWeight: '800', color: C.okInk, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('cmCampLabel')}</T>
        <T style={{ fontSize: 17, fontWeight: '800' }} numberOfLines={2}>{camp.title}</T>
        <T style={{ fontSize: 14, color: C.text2 }} numberOfLines={2}>{[campWhen(camp, t, lang, today), campPlace(camp)].filter(Boolean).join(' · ')}</T>
        <T style={{ fontSize: 14, fontWeight: '700', color: full ? C.warnInk : C.okInk }}>{full ? t('cmFull', { n: camp.booked }) : t('cmPlacesLeft', { n: camp.placesLeft })}</T>
      </View>
      {onPress ? <T style={{ fontSize: 15, fontWeight: '700', color: C.blue }}>{t('apChangePlace')}</T> : null}
    </Pressable>
  );
}

/** Every upcoming camp, those in my block first. */
export function CampPickSheet({ visible, onClose, camps, selected, onPick, myBlock, today }: {
  visible: boolean; onClose: () => void; camps: Camp[]; selected: string | null; onPick: (c: Camp) => void; myBlock: string | null; today: string | null;
}) {
  const { t, lang } = useSession();
  const mine = (c: Camp) => !!myBlock && (c.block ?? '').toLowerCase() === myBlock.toLowerCase();
  return (
    <Sheet visible={visible} onClose={onClose} title={t('cmPickCamp')}>
      {camps.length === 0 ? <T style={{ color: C.text2, fontSize: 15 }}>{t('cmNoCamps')}</T> : null}
      {camps.map((c) => {
        const on = c.id === selected;
        return (
          <Pressable key={c.id} onPress={() => onPick(c)} accessibilityRole="radio" accessibilityState={{ selected: on }}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: on ? 2 : 1,
              borderColor: on ? C.ok : C.border, backgroundColor: on ? C.okSoft : C.card }, pressed && { opacity: 0.85 }]}>
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <T style={{ fontSize: 16.5, fontWeight: '800' }} numberOfLines={2}>{c.title}</T>
              <T style={{ fontSize: 14, color: C.text2 }}>{campWhen(c, t, lang, today)}</T>
              {campPlace(c) ? <T style={{ fontSize: 14, color: C.text2 }} numberOfLines={1}>{campPlace(c)}</T> : null}
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {today && c.date === today ? <Pill label={t('apToday')} tone="ok" /> : null}
                {mine(c) ? <Pill label={t('cmInMyBlock')} tone="blue" icon="pin" /> : null}
                <Pill label={c.placesLeft > 0 ? t('cmPlacesLeft', { n: c.placesLeft }) : t('cmFull', { n: c.booked })} tone={c.placesLeft > 0 ? 'muted' : 'warn'} />
              </View>
            </View>
            {on ? <Icon name="check" size={20} color={C.ok} /> : null}
          </Pressable>
        );
      })}
    </Sheet>
  );
}
