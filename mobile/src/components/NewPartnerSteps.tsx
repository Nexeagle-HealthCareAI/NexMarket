import React from 'react';
import { View } from 'react-native';
import { T } from './ui';
import { useSession } from '../lib/session';
import { C } from '../theme';

/** Adding a partner: 1 Details → 2 Questions → 3 Photo (optional, last). */
export function NewPartnerSteps({ step }: { step: 0 | 1 | 2 }) {
  const { t } = useSession();
  const steps = [t('stepDetails'), t('stepSurvey'), t('stepPhoto')];
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {steps.map((s, i) => (
        <View key={s} style={{ flex: 1, gap: 6 }}>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: i <= step ? C.blue : C.line }} />
          <T style={{ fontSize: 12, color: i === step ? C.blueInk : C.text2, fontWeight: i === step ? '700' : '500' }} numberOfLines={1}>{s}</T>
        </View>
      ))}
    </View>
  );
}
