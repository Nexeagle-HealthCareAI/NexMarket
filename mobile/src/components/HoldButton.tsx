import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, View, type AccessibilityActionEvent } from 'react-native';
import { T } from './ui';
import { Icon, type IconName } from './Icon';
import { C } from '../theme';

/**
 * A button that only fires after being held down (2 s by default): a bar fills while the finger stays on it and
 * drains back if it lifts early, so a pocket or stray tap can't trigger it. Screen-reader users can't hold, so
 * their double-tap (or double-tap-and-hold) calls `onA11yActivate` instead, which should ask for confirmation.
 */
export function HoldButton({ label, a11yLabel, a11yHint, onDone, onA11yActivate, ms = 2000, busy, busyLabel, icon = 'stop', color = C.bad, soft = C.badSoft }: {
  label: string; a11yLabel: string; a11yHint: string; onDone: () => void; onA11yActivate: () => void; ms?: number;
  busy?: boolean; busyLabel?: string; icon?: IconName; color?: string; soft?: string;
}) {
  const v = useRef(new Animated.Value(0)).current;
  const fired = useRef(false);
  useEffect(() => () => v.stopAnimation(), [v]);

  const pressIn = () => {
    if (busy) return;
    fired.current = false;
    v.stopAnimation((cur) => {
      Animated.timing(v, { toValue: 1, duration: Math.max(60, ms * (1 - cur)), easing: Easing.linear, useNativeDriver: false }).start(({ finished }) => {
        if (finished && !fired.current) { fired.current = true; onDone(); }
      });
    });
  };
  const pressOut = () => {
    if (fired.current) return;
    v.stopAnimation(() => Animated.timing(v, { toValue: 0, duration: 250, easing: Easing.out(Easing.quad), useNativeDriver: false }).start());
  };
  const a11y = (e: AccessibilityActionEvent) => {
    if (busy) return;
    if (e.nativeEvent.actionName === 'activate' || e.nativeEvent.actionName === 'longpress') onA11yActivate();
  };

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={a11yLabel} accessibilityHint={a11yHint} accessibilityState={{ busy: !!busy, disabled: !!busy }}
      accessibilityActions={[{ name: 'activate' }, { name: 'longpress' }]} onAccessibilityAction={a11y}
      onPressIn={pressIn} onPressOut={pressOut} disabled={busy}
      style={{ minHeight: 64, borderRadius: 18, borderWidth: 2, borderColor: color, backgroundColor: C.card, overflow: 'hidden', justifyContent: 'center' }}>
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: soft,
        width: v.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8 }}>
        {busy ? <ActivityIndicator color={color} /> : <Icon name={icon} size={22} color={color} strokeWidth={2.4} />}
        <T style={{ color, fontSize: 18, fontWeight: '800', textAlign: 'center', flexShrink: 1 }} numberOfLines={2}>{busy && busyLabel ? busyLabel : label}</T>
      </View>
    </Pressable>
  );
}
