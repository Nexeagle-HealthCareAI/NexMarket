import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { liveText, useTextScale } from './ui';
import { Icon, type IconName } from './Icon';
import { C } from '../theme';

export type TileTone = 'primary' | 'wa' | 'soft' | 'grey' | 'okOutline' | 'danger';
// Built on each draw so sunlight mode's colours are used.
const tones = (): Record<TileTone, { bg: string; fg: string; border?: string; bw?: number }> => ({
  primary: { bg: C.blue, fg: '#fff' },
  wa: { bg: C.okSoft, fg: C.okInk },
  soft: { bg: C.blueSoft, fg: C.blueInk },
  grey: { bg: C.bg, fg: C.text3 },
  okOutline: { bg: C.card, fg: C.okInk, border: C.ok, bw: 2 },
  danger: { bg: C.card, fg: C.bad, border: '#f3b8b2', bw: 1 },
});

/**
 * A big square-ish button with the icon above one short word (Call, WhatsApp, Route…). Used in rows or grids
 * that share the width equally; the word shrinks a little or wraps to two lines instead of being cut off.
 */
export function ActionTile({ icon, label, onPress, disabled, tone = 'grey', height = 64, a11y }: {
  icon: IconName; label: string; onPress: () => void; disabled?: boolean; tone?: TileTone; height?: number; a11y?: string;
}) {
  const scale = useTextScale();
  const k = tones()[tone];
  const big = height >= 72;
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={a11y ?? label} accessibilityState={{ disabled: !!disabled }}
        style={({ pressed }) => [{
          minHeight: height, borderRadius: big ? 16 : 14, backgroundColor: k.bg, borderWidth: k.bw ?? 0, borderColor: k.border ?? k.bg,
          alignItems: 'center', justifyContent: 'center', gap: big ? 6 : 4, paddingHorizontal: 4, paddingVertical: 6,
        }, disabled && { opacity: 0.4 }, pressed && { opacity: 0.8 }]}>
        <Icon name={icon} size={big ? 24 : 22} color={k.fg} />
        <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75}
          style={liveText({ fontSize: big ? 15 : 14, fontWeight: '700', color: k.fg, textAlign: 'center' }, scale)}>{label}</Text>
      </Pressable>
    </View>
  );
}
