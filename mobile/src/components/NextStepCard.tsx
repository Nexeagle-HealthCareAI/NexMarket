import React from 'react';
import { Pressable, View } from 'react-native';
import { T } from './ui';
import { Icon, type IconName } from './Icon';
import { C } from '../theme';

export type StepTone = 'blue' | 'ok' | 'warn' | 'purple';
/** Border / button colour, soft icon background, and the darker label colour for each kind of step. */
export const STEP_TONE: Record<StepTone, { color: string; soft: string; ink: string }> = {
  blue: { color: C.blue, soft: C.blueSoft, ink: C.blueInk },
  ok: { color: C.ok, soft: C.okSoft, ink: C.okInk },
  // A little darker than the warning amber so white button text stays readable in sunlight.
  warn: { color: '#b8650f', soft: C.warnSoft, ink: C.warnInk },
  purple: { color: C.purple, soft: C.purpleSoft, ink: C.purple },
};

export interface StepAction { label: string; icon?: IconName; onPress: () => void; a11y?: string }

/**
 * Today's one big card: "NEXT STEP · 2 OF 4" with a step bar, an icon, the job, one line on why, one large button,
 * and at most one small link under it.
 */
export function NextStepCard({ label, filled, total, tone, icon, title, reason, primary, secondary }: {
  label: string; filled: number; total: number; tone: StepTone; icon: IconName; title: string; reason?: string;
  primary: StepAction; secondary?: StepAction | null;
}) {
  const k = STEP_TONE[tone];
  return (
    <View style={{ backgroundColor: C.card, borderRadius: 20, borderWidth: 2, borderColor: k.color, padding: 18, gap: 14,
      elevation: 3, shadowColor: C.ink, shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <T style={{ flex: 1, fontSize: 13, fontWeight: '800', letterSpacing: 0.8, color: k.ink }}>{label}</T>
        <View style={{ flexDirection: 'row', gap: 4 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {Array.from({ length: total }, (_, i) => (
            <View key={i} style={{ width: 18, height: 6, borderRadius: 3, backgroundColor: i < filled ? k.color : C.borderStrong }} />
          ))}
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: k.soft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={28} color={k.color} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <T style={{ fontSize: 22, fontWeight: '800', lineHeight: 27 }}>{title}</T>
          {reason ? <T style={{ fontSize: 15, color: C.text2, lineHeight: 20 }} numberOfLines={3}>{reason}</T> : null}
        </View>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={primary.a11y ?? primary.label} onPress={primary.onPress}
        style={({ pressed }) => [{ minHeight: 58, borderRadius: 16, backgroundColor: k.color, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
          gap: 10, paddingHorizontal: 16, paddingVertical: 8 }, pressed && { opacity: 0.85 }]}>
        {primary.icon ? <Icon name={primary.icon} size={22} color="#fff" strokeWidth={2.4} /> : null}
        <T style={{ color: '#fff', fontSize: 19, fontWeight: '800', textAlign: 'center', flexShrink: 1 }} numberOfLines={2}>{primary.label}</T>
      </Pressable>
      {secondary ? (
        <Pressable accessibilityRole="link" accessibilityLabel={secondary.a11y ?? secondary.label} onPress={secondary.onPress} hitSlop={4}
          style={({ pressed }) => [{ alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, marginTop: -4, marginBottom: -6 }, pressed && { opacity: 0.6 }]}>
          <T style={{ color: C.blue, fontSize: 15, fontWeight: '700', textDecorationLine: 'underline', textAlign: 'center' }}>{secondary.label}</T>
        </Pressable>
      ) : null}
    </View>
  );
}
