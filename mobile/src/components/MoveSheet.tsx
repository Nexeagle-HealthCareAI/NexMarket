import React from 'react';
import { View } from 'react-native';
import { Chip, Sheet, T } from './ui';
import { useSession } from '../lib/session';
import { dayShort } from '../lib/format';
import { addDays, ymd } from '../lib/util';
import { C } from '../theme';

/** Reschedule: tomorrow, 3 days, a week, or any of the next 14 days. */
export function MoveSheet({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (ymd: string) => void }) {
  const { t, lang } = useSession();
  const days = Array.from({ length: 14 }, (_, i) => addDays(new Date(), i + 1));
  return (
    <Sheet visible={visible} onClose={onClose} title={t('moveTo')}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><Chip big label={t('tomorrow')} onPress={() => onPick(ymd(addDays(new Date(), 1)))} /></View>
        <View style={{ flex: 1 }}><Chip big label={t('in3Days')} onPress={() => onPick(ymd(addDays(new Date(), 3)))} /></View>
        <View style={{ flex: 1 }}><Chip big label={t('in1Week')} onPress={() => onPick(ymd(addDays(new Date(), 7)))} /></View>
      </View>
      <T style={{ color: C.text2 }}>{t('pickDate')}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {days.map((d) => <Chip key={ymd(d)} label={dayShort(lang, d)} onPress={() => onPick(ymd(d))} />)}
      </View>
    </Sheet>
  );
}
