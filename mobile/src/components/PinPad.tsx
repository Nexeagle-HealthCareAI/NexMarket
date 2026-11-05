import React from 'react';
import { Pressable, View } from 'react-native';
import { T } from './ui';
import { Icon } from './Icon';
import { C } from '../theme';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'bio', '0', 'del'] as const;

/** PIN boxes, with an eye to show or hide the digits typed so far. */
export function PinDots({ value, length, show, onToggle, dark, labelShow, labelHide, error }: {
  value: string; length: number; show: boolean; onToggle: () => void; dark?: boolean; labelShow: string; labelHide: string; error?: boolean;
}) {
  const fg = dark ? '#fff' : C.text;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 12 }} accessibilityLabel={`${value.length} of ${length}`}>
        {Array.from({ length }, (_, i) => {
          const filled = i < value.length;
          return (
            <View key={i} style={{
              width: 44, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2,
              borderColor: error ? C.bad : filled ? (dark ? C.mint : C.blue) : dark ? 'rgba(255,255,255,0.25)' : C.borderStrong,
              backgroundColor: dark ? 'rgba(255,255,255,0.06)' : C.card,
            }}>
              {filled ? (show ? <T style={{ color: fg, fontSize: 22, fontWeight: '800' }}>{value[i]}</T>
                : <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: fg }} />) : null}
            </View>
          );
        })}
      </View>
      <Pressable onPress={onToggle} hitSlop={10} accessibilityRole="button" accessibilityLabel={show ? labelHide : labelShow}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 }}>
        <Icon name={show ? 'eyeOff' : 'eye'} color={dark ? C.sideText : C.text2} size={22} />
      </Pressable>
    </View>
  );
}

/** A big number pad. The bottom-left key is the fingerprint button when `onBio` is given. */
export function PinPad({ onDigit, onDelete, onBio, dark, bioLabel, disabled }: {
  onDigit: (d: string) => void; onDelete: () => void; onBio?: () => void; dark?: boolean; bioLabel?: string; disabled?: boolean;
}) {
  const fg = dark ? '#fff' : C.text;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', width: 288, alignSelf: 'center', justifyContent: 'space-between', rowGap: 14 }}>
      {KEYS.map((k) => {
        if (k === 'bio') {
          return onBio ? (
            <Pressable key={k} onPress={onBio} disabled={disabled} accessibilityRole="button" accessibilityLabel={bioLabel}
              style={({ pressed }) => [keyStyle(dark, false), pressed && { opacity: 0.6 }]}>
              <Icon name="fingerprint" size={30} color={dark ? C.mint : C.blue} />
            </Pressable>
          ) : <View key={k} style={{ width: 84, height: 64 }} />;
        }
        if (k === 'del') {
          return (
            <Pressable key={k} onPress={onDelete} disabled={disabled} accessibilityRole="button" accessibilityLabel="Delete"
              style={({ pressed }) => [keyStyle(dark, false), pressed && { opacity: 0.6 }]}>
              <Icon name="backspace" size={26} color={fg} />
            </Pressable>
          );
        }
        return (
          <Pressable key={k} onPress={() => onDigit(k)} disabled={disabled} accessibilityRole="button" accessibilityLabel={k}
            style={({ pressed }) => [keyStyle(dark, true), pressed && { backgroundColor: dark ? 'rgba(255,255,255,0.16)' : C.blueSoft }]}>
            <T style={{ color: fg, fontSize: 28, fontWeight: '700' }}>{k}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

const keyStyle = (dark?: boolean, filled?: boolean) => ({
  width: 84, height: 64, borderRadius: 18, alignItems: 'center' as const, justifyContent: 'center' as const,
  backgroundColor: filled ? (dark ? 'rgba(255,255,255,0.07)' : C.card) : 'transparent',
  borderWidth: filled && !dark ? 1 : 0, borderColor: C.border,
});
