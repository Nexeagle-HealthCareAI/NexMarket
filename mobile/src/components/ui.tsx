import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text,
  TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, usePathname } from 'expo-router';
import { C, R } from '../theme';
import { Icon, type IconName } from './Icon';
import { useT } from '../lib/session';

// ─── Text ───
export function T({ style, children, numberOfLines, onPress }: { style?: StyleProp<TextStyle>; children: React.ReactNode; numberOfLines?: number; onPress?: () => void }) {
  return <Text style={[s.text, style]} numberOfLines={numberOfLines} onPress={onPress}>{children}</Text>;
}

// ─── Screen ───
export function Screen({ children, scroll = true, header, footer, bg = C.bg, padded = true, contentStyle }: {
  children: React.ReactNode; scroll?: boolean; header?: React.ReactNode; footer?: React.ReactNode; bg?: string; padded?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const body = scroll ? (
    <ScrollView contentContainerStyle={[padded && s.pad, { paddingBottom: 24 }, contentStyle]} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : <View style={[{ flex: 1 }, padded && s.pad, contentStyle]}>{children}</View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {header}
        <View style={{ flex: 1 }}>{body}</View>
        {footer}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function TopBar({ title, sub, onBack, right, dark }: { title: string; sub?: string; onBack?: (() => void) | false; right?: React.ReactNode; dark?: boolean }) {
  const fg = dark ? '#fff' : C.text;
  return (
    <View style={[s.topBar, dark && { backgroundColor: C.ink, borderBottomColor: C.ink }]}>
      {onBack !== false && (
        <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={10} style={s.backBtn}
          onPress={onBack || (() => (router.canGoBack() ? router.back() : router.replace('/today')))}>
          <Icon name="back" color={fg} size={22} />
        </Pressable>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <T style={[s.topTitle, { color: fg }]} numberOfLines={1}>{title}</T>
        {sub ? <T style={[s.topSub, dark && { color: C.sideText }]} numberOfLines={1}>{sub}</T> : null}
      </View>
      {right}
    </View>
  );
}

// ─── Buttons ───
type BtnKind = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ok' | 'dark';
export function Btn({ label, onPress, kind = 'primary', icon, disabled, loading, small, style, flex }: {
  label: string; onPress?: () => void; kind?: BtnKind; icon?: IconName; disabled?: boolean; loading?: boolean; small?: boolean;
  style?: StyleProp<ViewStyle>; flex?: boolean;
}) {
  const k = BTN[kind];
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled || loading} onPress={onPress}
      style={({ pressed }) => [s.btn, small && s.btnSmall, { backgroundColor: k.bg, borderColor: k.border }, flex && { flex: 1 },
        (disabled || loading) && { opacity: 0.45 }, pressed && { opacity: 0.8 }, style]}>
      {loading ? <ActivityIndicator color={k.fg} /> : icon ? <Icon name={icon} color={k.fg} size={small ? 16 : 19} /> : null}
      <T style={[s.btnText, small && { fontSize: 14 }, { color: k.fg }]} numberOfLines={1}>{label}</T>
    </Pressable>
  );
}
const BTN: Record<BtnKind, { bg: string; fg: string; border: string }> = {
  primary: { bg: C.blue, fg: '#fff', border: C.blue },
  secondary: { bg: C.card, fg: C.text, border: C.borderStrong },
  ghost: { bg: C.blueSoft, fg: C.blueInk, border: C.blueSoft },
  danger: { bg: C.card, fg: C.bad, border: '#f3c5c0' },
  ok: { bg: C.ok, fg: '#fff', border: C.ok },
  dark: { bg: 'transparent', fg: '#fff', border: C.inkLine },
};

export function IconBtn({ icon, onPress, color = C.text, bg = C.card, label, size = 44 }: { icon: IconName; onPress: () => void; color?: string; bg?: string; label: string; size?: number }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.7 }]}>
      <Icon name={icon} color={color} size={20} />
    </Pressable>
  );
}

// ─── Chips & pills ───
export function Chip({ label, selected, onPress, color = C.blue, icon, big }: { label: string; selected?: boolean; onPress?: () => void; color?: string; icon?: IconName; big?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!selected }} onPress={onPress}
      style={({ pressed }) => [s.chip, big && s.chipBig, selected && { backgroundColor: color, borderColor: color }, pressed && { opacity: 0.8 }]}>
      {icon ? <Icon name={icon} size={15} color={selected ? '#fff' : C.text3} /> : null}
      <T style={[s.chipText, big && { fontSize: 16 }, selected && { color: '#fff' }]}>{label}</T>
    </Pressable>
  );
}

type Tone = 'blue' | 'ok' | 'warn' | 'bad' | 'muted' | 'star' | 'info' | 'purple';
const TONE: Record<Tone, [string, string]> = {
  blue: [C.blueSoft, C.blueInk], ok: [C.okSoft, C.okInk], warn: [C.warnSoft, C.warnInk], bad: [C.badSoft, C.bad],
  muted: [C.line, C.text3], star: [C.starSoft, '#8a6400'], info: [C.infoSoft, C.infoInk], purple: [C.purpleSoft, C.purple],
};
export function Pill({ label, tone = 'muted', icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const [bg, fg] = TONE[tone];
  return (
    <View style={[s.pill, { backgroundColor: bg }]}>
      {icon ? <Icon name={icon} size={13} color={fg} /> : null}
      <T style={[s.pillText, { color: fg }]}>{label}</T>
    </View>
  );
}

// ─── Containers ───
export function Card({ children, style, onPress }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  if (onPress) {
    return <Pressable onPress={onPress} style={({ pressed }) => [s.card, style, pressed && { opacity: 0.85 }]}>{children}</Pressable>;
  }
  return <View style={[s.card, style]}>{children}</View>;
}

export function SectionTitle({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <View style={s.section}>
      <View style={{ flex: 1 }}>
        <T style={s.sectionTitle}>{title}</T>
        {sub ? <T style={s.sectionSub}>{sub}</T> : null}
      </View>
      {right}
    </View>
  );
}

export function Empty({ text, icon = 'note' }: { text: string; icon?: IconName }) {
  return (
    <View style={s.empty}>
      <Icon name={icon} size={28} color={C.muted} />
      <T style={{ color: C.text2, textAlign: 'center' }}>{text}</T>
    </View>
  );
}

export function Avatar({ name, size = 44, bg = C.blue, color = '#fff' }: { name: string; size?: number; bg?: string; color?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).filter((w) => !/^(dr|mr|mrs|ms)\.?$/i.test(w)).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <T style={{ color, fontWeight: '700', fontSize: size * 0.36 }}>{initials}</T>
    </View>
  );
}

// ─── Inputs ───
export function Field({ label, error, hint, ...props }: TextInputProps & { label?: string; error?: string | null; hint?: string }) {
  return (
    <View style={{ gap: 6 }}>
      {label ? <T style={s.label}>{label}</T> : null}
      <TextInput placeholderTextColor={C.muted} {...props}
        style={[s.input, props.multiline && { minHeight: 88, textAlignVertical: 'top', paddingTop: 12 }, !!error && { borderColor: C.bad }, props.style]} />
      {error ? <T style={{ color: C.bad, fontSize: 13 }}>{error}</T> : hint ? <T style={{ color: C.text2, fontSize: 13 }}>{hint}</T> : null}
    </View>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: value }} onPress={() => onChange(!value)} style={s.toggleRow}>
      <View style={[s.box, value && { backgroundColor: C.blue, borderColor: C.blue }]}>
        {value ? <Icon name="check" size={16} color="#fff" strokeWidth={3} /> : null}
      </View>
      <T style={{ flex: 1, fontSize: 15 }}>{label}</T>
    </Pressable>
  );
}

// ─── Bottom sheet ───
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title?: string; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[s.sheet, { paddingBottom: 16 + insets.bottom }]}>
          <View style={s.grabber} />
          {title ? <T style={s.sheetTitle}>{title}</T> : null}
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── "Saved on phone" toast ───
let showToast: ((msg: string) => void) | null = null;
export function toast(msg: string) {
  showToast?.(msg);
}
export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  const op = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    showToast = (m) => {
      setMsg(m);
      Animated.timing(op, { toValue: 1, duration: 150, useNativeDriver: true }).start();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => Animated.timing(op, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => setMsg(null)), 2200);
    };
    return () => { showToast = null; if (timer) clearTimeout(timer); };
  }, [op]);
  if (!msg) return null;
  return (
    <Animated.View pointerEvents="none" style={[s.toast, { opacity: op, bottom: 96 + insets.bottom }]}>
      <Icon name="check" size={16} color={C.mint} strokeWidth={3} />
      <T style={{ color: '#fff', fontWeight: '600' }}>{msg}</T>
    </Animated.View>
  );
}

// ─── Bottom navigation with the centre "+" ───
const TABS: { path: string; icon: IconName | 'vita'; key: 'tabToday' | 'tabPartners' | 'tabVita' | 'tabPatients' | 'tabMe' }[] = [
  { path: '/today', icon: 'home', key: 'tabToday' },
  { path: '/followups', icon: 'users', key: 'tabPartners' },
  { path: '/assistant', icon: 'vita', key: 'tabVita' },
  { path: '/patients', icon: 'patients', key: 'tabPatients' },
  { path: '/me', icon: 'user', key: 'tabMe' },
];
const VITA_TAB = require('../../assets/mascot/think.webp');
export function BottomNav() {
  const t = useT();
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const item = (tab: (typeof TABS)[number]) => {
    const active = path.startsWith(tab.path);
    return (
      <Pressable key={tab.path} accessibilityRole="tab" accessibilityState={{ selected: active }} style={s.tab}
        onPress={() => { if (!active) router.replace(tab.path as never); }}>
        {tab.icon === 'vita' ? (
          <View style={{ width: 28, height: 28, borderRadius: 14, overflow: 'hidden', alignItems: 'center', justifyContent: 'flex-end',
            backgroundColor: active ? C.purpleSoft : C.line, borderWidth: active ? 2 : 0, borderColor: C.purple }}>
            <Image source={VITA_TAB} style={{ width: 24, height: 30 }} resizeMode="contain" />
          </View>
        ) : <Icon name={tab.icon} size={22} color={active ? C.blue : C.muted} />}
        <T style={[s.tabText, active && { color: tab.icon === 'vita' ? C.purple : C.blue, fontWeight: '700' }]} numberOfLines={1}>{t(tab.key)}</T>
      </Pressable>
    );
  };
  return (
    <View style={[s.nav, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {item(TABS[0])}
      {item(TABS[1])}
      <View style={s.tab}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('addAnything')} onPress={() => router.push('/add')}
          style={({ pressed }) => [s.fab, pressed && { transform: [{ scale: 0.95 }] }]}>
          <Icon name="plus" size={28} color="#fff" strokeWidth={2.6} />
        </Pressable>
      </View>
      {item(TABS[2])}
      {item(TABS[3])}
      {item(TABS[4])}
    </View>
  );
}

export const s = StyleSheet.create({
  text: { color: C.text, fontSize: 15 },
  pad: { padding: 16, gap: 12 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border, minHeight: 58 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  topTitle: { fontSize: 18, fontWeight: '700' },
  topSub: { fontSize: 13, color: C.text2 },
  btn: { height: 52, borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  btnSmall: { height: 40, borderRadius: 10, paddingHorizontal: 12 },
  btnText: { fontSize: 16, fontWeight: '700' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 40, borderRadius: 999, borderWidth: 1, borderColor: C.borderStrong, backgroundColor: C.card },
  chipBig: { height: 52, paddingHorizontal: 18, borderRadius: 14 },
  chipText: { fontSize: 14, fontWeight: '600', color: C.text3 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontSize: 12, fontWeight: '700' },
  card: { backgroundColor: C.card, borderRadius: R.lg, padding: 14, gap: 10, borderWidth: 1, borderColor: C.border },
  section: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '700' },
  sectionSub: { fontSize: 13, color: C.text2 },
  empty: { alignItems: 'center', gap: 8, padding: 28 },
  label: { fontSize: 14, fontWeight: '600', color: C.text3 },
  input: { minHeight: 52, borderRadius: 12, borderWidth: 1, borderColor: C.borderStrong, backgroundColor: C.card, paddingHorizontal: 14, fontSize: 17, color: C.text },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  box: { width: 26, height: 26, borderRadius: 7, borderWidth: 2, borderColor: C.borderStrong, alignItems: 'center', justifyContent: 'center' },
  scrim: { flex: 1, backgroundColor: 'rgba(14,21,37,0.45)' },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, padding: 16, gap: 12 },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: C.border },
  sheetTitle: { fontSize: 18, fontWeight: '700' },
  toast: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: C.ink, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999 },
  nav: { flexDirection: 'row', backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 6 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 52 },
  tabText: { fontSize: 11, color: C.muted, fontWeight: '600' },
  fab: { width: 58, height: 58, borderRadius: 29, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center', marginTop: -26, borderWidth: 4, borderColor: C.bg, elevation: 4, shadowColor: '#0a72d6', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
});
