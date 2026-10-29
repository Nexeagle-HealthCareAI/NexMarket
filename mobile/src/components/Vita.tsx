import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Modal, Pressable, View, type ImageStyle, type StyleProp } from 'react-native';
import { T } from './ui';
import { C } from '../theme';

/** Vita, the NexEagle eagle. One pose per mood; the home screen picks the mood from the agent's day. */
export const VITA = {
  wave: require('../../assets/mascot/wave.webp'),
  coffee: require('../../assets/mascot/coffee.webp'),
  fly: require('../../assets/mascot/fly.webp'),
  stern: require('../../assets/mascot/stern.webp'),
  cheer: require('../../assets/mascot/cheer.webp'),
  snack: require('../../assets/mascot/snack.webp'),
  relax: require('../../assets/mascot/relax.webp'),
  sleep: require('../../assets/mascot/sleep.webp'),
  think: require('../../assets/mascot/think.webp'),
  ai: require('../../assets/mascot/ai.webp'),
};
export type VitaMood = keyof typeof VITA;

/** Width ÷ height of each pose, so it is never stretched. */
const RATIO: Record<VitaMood, number> = { wave: 633 / 640, coffee: 539 / 640, fly: 640 / 454, stern: 437 / 640, cheer: 640 / 485, snack: 487 / 640, relax: 640 / 565, sleep: 640 / 639, think: 467 / 640, ai: 633 / 640 };

/** Vita, gently floating (flying moods drift more). Pass bob={false} for a still picture. */
export function Vita({ mood, height, bob = true, style }: { mood: VitaMood; height: number; bob?: boolean; style?: StyleProp<ImageStyle> }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!bob) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: mood === 'fly' ? 1400 : 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: mood === 'fly' ? 1400 : 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v, bob, mood]);
  const lift = mood === 'fly' ? 8 : mood === 'sleep' ? 2 : 4;
  return (
    <Animated.View style={{ transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -lift] }) }, { scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, mood === 'sleep' ? 1.02 : 1.01] }) }] }}>
      <Image source={VITA[mood]} resizeMode="contain" accessibilityIgnoresInvertColors
        style={[{ height, width: Math.round(height * RATIO[mood]) }, style]} />
    </Animated.View>
  );
}

// ─── Celebration ("Shabash!") ─────────────────────────────────────────────────────────────

let show: ((msg: string) => void) | null = null;
/** Vita cheers for a moment — after a task is done, the last stop of the day, and so on. */
export function celebrate(msg: string) {
  show?.(msg);
}

export function CelebrateHost() {
  const [msg, setMsg] = useState<string | null>(null);
  const s = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    show = (m) => {
      setMsg(m);
      s.setValue(0);
      Animated.spring(s, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }).start();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setMsg(null), 2400);
    };
    return () => { show = null; if (timer.current) clearTimeout(timer.current); };
  }, [s]);
  if (!msg) return null;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => setMsg(null)} statusBarTranslucent>
      <Pressable onPress={() => setMsg(null)} style={{ flex: 1, backgroundColor: 'rgba(14,21,37,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Animated.View style={{ alignItems: 'center', gap: 6, transform: [{ scale: s.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }], opacity: s }}>
          <Vita mood="cheer" height={190} />
          <View style={{ backgroundColor: C.card, borderRadius: 18, paddingHorizontal: 20, paddingVertical: 14, maxWidth: 320 }}>
            <T style={{ fontSize: 18, fontWeight: '800', textAlign: 'center' }}>{msg}</T>
          </View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}
