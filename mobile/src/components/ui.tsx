import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Dimensions, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text,
  TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, usePathname } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { C, R, colorsMixed, liveColor } from '../theme';
import { Icon, type IconName } from './Icon';
import { SyncStrip } from './SyncStrip';
import { useDb, useSession, useT } from '../lib/session';
import { db } from '../lib/db';
import { ymd } from '../lib/util';
import { cachedUnread, useChatVersion } from '../lib/chat';
import { lite } from '../lib/perf';
import { usePrefs } from '../lib/prefs';
import { explainOnce, speak } from '../lib/speak';

// ─── Text ───
/**
 * All app text. Follows the Me → Easy to use settings: text size (font size and line height are scaled) and
 * sunlight mode (secondary text colours are drawn darker).
 */
export function T({ style, children, numberOfLines, onPress }: { style?: StyleProp<TextStyle>; children: React.ReactNode; numberOfLines?: number; onPress?: () => void }) {
  const { scale } = usePrefs();
  return <Text style={liveText([s.text, style], scale)} numberOfLines={numberOfLines} onPress={onPress}>{children}</Text>;
}

/** A text style with the current text size and sunlight colours applied (for TextInput or raw Text). */
export function liveText(style: StyleProp<TextStyle>, scale: number): StyleProp<TextStyle> {
  if (scale === 1 && !colorsMixed()) return style;
  const f: TextStyle = StyleSheet.flatten(style) ?? {};
  const out: { -readonly [K in keyof TextStyle]: TextStyle[K] } = { ...f };
  if (scale !== 1) {
    out.fontSize = (f.fontSize ?? 16) * scale;
    if (typeof f.lineHeight === 'number') out.lineHeight = f.lineHeight * scale;
  }
  if (typeof f.color === 'string') out.color = liveColor(f.color);
  return out;
}

/** The text-size factor (1, 1.15 or 1.3) for screens that size things by hand: `const k = useTextScale()`. */
export function useTextScale(): number {
  return usePrefs().scale;
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
      {/* The app is edge-to-edge on Android too, so the window doesn't resize for the keyboard: pad on both. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {header}
        <View style={{ flex: 1 }}>{body}</View>
        {footer}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * Screen header.
 * - explain: what this screen is for, in the agent's language. Shows a speaker button that reads it, and is read
 *   by itself the first time the screen opens this session when "Read screens aloud" is on.
 * - status: show the send-status strip (SyncStrip) under the header.
 */
export function TopBar({ title, sub, onBack, right, dark, explain, status }: {
  title: string; sub?: string; onBack?: (() => void) | false; right?: React.ReactNode; dark?: boolean; explain?: string; status?: boolean;
}) {
  const fg = dark ? '#fff' : C.text;
  const { lang } = useSession();
  const path = usePathname();
  useEffect(() => {
    if (explain) explainOnce(`${path}|${title}`, explain, lang);
    // Only on first open: later changes to the text don't read it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const bar = (
    <View style={[s.topBar, { borderBottomColor: C.border }, dark && { backgroundColor: C.ink, borderBottomColor: C.ink }]}>
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
      {explain ? <SpeakButton text={explain} dark={dark} /> : null}
      {right}
    </View>
  );
  if (!status) return bar;
  return <View>{bar}<SyncStrip /></View>;
}

/** Round 44 px speaker button that reads `text` aloud in the app's language (stops anything already being read). */
export function SpeakButton({ text, dark, size = 44, label }: { text: string; dark?: boolean; size?: number; label?: string }) {
  const { lang, t } = useSession();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label ?? t('uxReadAloud')} hitSlop={4} onPress={() => speak(text, lang)}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
        borderColor: dark ? C.inkLine : C.borderStrong, backgroundColor: dark ? 'transparent' : C.card }, pressed && { opacity: 0.7 }]}>
      <Icon name="volume" size={20} color={dark ? '#fff' : C.blue} />
    </Pressable>
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
      style={({ pressed }) => [s.btn, small && s.btnSmall, { backgroundColor: k.bg, borderColor: k.border === BORDER ? C.borderStrong : k.border }, flex && { flex: 1 },
        (disabled || loading) && { opacity: 0.45 }, pressed && { opacity: 0.8 }, style]}>
      {loading ? <ActivityIndicator color={k.fg} /> : icon ? <Icon name={icon} color={k.fg} size={small ? 16 : 19} /> : null}
      {/* Long labels wrap to a second line instead of being cut off. */}
      <T style={[s.btnText, small && { fontSize: 15 }, { color: k.fg }]} numberOfLines={2}>{label}</T>
    </Pressable>
  );
}
const BORDER = 'borderStrong'; // follows sunlight mode
const BTN: Record<BtnKind, { bg: string; fg: string; border: string }> = {
  primary: { bg: C.blue, fg: '#fff', border: C.blue },
  secondary: { bg: C.card, fg: C.text, border: BORDER },
  ghost: { bg: C.blueSoft, fg: C.blueInk, border: C.blueSoft },
  danger: { bg: C.card, fg: C.bad, border: '#f3c5c0' },
  ok: { bg: C.ok, fg: '#fff', border: C.ok },
  dark: { bg: 'transparent', fg: '#fff', border: C.inkLine },
};

export function IconBtn({ icon, onPress, color = C.text, bg = C.card, label, size = 48 }: { icon: IconName; onPress: () => void; color?: string; bg?: string; label: string; size?: number }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={Math.max(6, (48 - size) / 2)}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.7 }]}>
      <Icon name={icon} color={color} size={20} />
    </Pressable>
  );
}

// ─── Chips & pills ───
export function Chip({ label, selected, onPress, color = C.blue, icon, big }: { label: string; selected?: boolean; onPress?: () => void; color?: string; icon?: IconName; big?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!selected }} onPress={onPress}
      style={({ pressed }) => [s.chip, { borderColor: C.borderStrong }, big && s.chipBig, selected && { backgroundColor: color, borderColor: color }, pressed && { opacity: 0.8 }]}>
      {icon ? <Icon name={icon} size={15} color={selected ? '#fff' : C.text3} /> : null}
      <T style={[s.chipText, big && { fontSize: 17 }, selected && { color: '#fff' }]}>{label}</T>
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
    return <Pressable onPress={onPress} style={({ pressed }) => [s.card, { borderColor: C.border }, style, pressed && { opacity: 0.85 }]}>{children}</Pressable>;
  }
  return <View style={[s.card, { borderColor: C.border }, style]}>{children}</View>;
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

export function Avatar({ name, size = 44, bg = C.blue, color = '#fff', uri }: { name: string; size?: number; bg?: string; color?: string; uri?: string | null }) {
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.line }} accessibilityIgnoresInvertColors />;
  const initials = name.split(/\s+/).filter(Boolean).filter((w) => !/^(dr|mr|mrs|ms)\.?$/i.test(w)).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <T style={{ color, fontWeight: '700', fontSize: size * 0.36 }}>{initials}</T>
    </View>
  );
}

// ─── Inputs ───
export function Field({ label, error, hint, ...props }: TextInputProps & { label?: string; error?: string | null; hint?: string }) {
  const { scale } = usePrefs();
  return (
    <View style={{ gap: 6 }}>
      {label ? <T style={s.label}>{label}</T> : null}
      <TextInput placeholderTextColor={C.muted} {...props}
        style={liveText([s.input, { borderColor: C.borderStrong, minHeight: Math.round(52 * Math.min(scale, 1.2)) },
          props.multiline && { minHeight: 88, textAlignVertical: 'top', paddingTop: 12 }, !!error && { borderColor: C.bad }, props.style], scale)} />
      {error ? <T style={{ color: C.bad, fontSize: 13 }}>{error}</T> : hint ? <T style={{ color: C.text2, fontSize: 13 }}>{hint}</T> : null}
    </View>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: value }} onPress={() => onChange(!value)} style={s.toggleRow}>
      <View style={[s.box, { borderColor: C.borderStrong }, value && { backgroundColor: C.blue, borderColor: C.blue }]}>
        {value ? <Icon name="check" size={16} color="#fff" strokeWidth={3} /> : null}
      </View>
      <T style={{ flex: 1, fontSize: 16 }}>{label}</T>
    </Pressable>
  );
}

/** On/off switch (56×32, green when on) like the Me → Easy to use rows. Give `label` for screen readers. */
export function Switch({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value }} hitSlop={8} onPress={() => onChange(!value)}
      style={{ width: 56, height: 32, borderRadius: 16, padding: 3, backgroundColor: value ? C.ok : '#c3cad8', alignItems: value ? 'flex-end' : 'flex-start' }}>
      <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff' }} />
    </Pressable>
  );
}

// ─── Bottom sheet ───
export function Sheet({ visible, onClose, title, children, scroll = true }: { visible: boolean; onClose: () => void; title?: string; children: React.ReactNode; scroll?: boolean }) {
  const insets = useSafeAreaInsets();
  const maxH = Dimensions.get('window').height * 0.88;
  return (
    <Modal visible={visible} transparent animationType={lite() ? 'none' : 'slide'} onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Close" />
      {/* Android modals resize for the keyboard by themselves, so only iOS needs padding here. */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[s.sheet, { paddingBottom: 16 + insets.bottom, maxHeight: maxH }]}>
          <View style={s.grabber} />
          {title ? <T style={s.sheetTitle}>{title}</T> : null}
          {scroll ? (
            <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {children}
            </ScrollView>
          ) : children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── "Saved on phone" toast ───
export interface ToastOptions {
  /** Shows an "Undo" button on a wide dark bar; called if the agent taps it. */
  undo?: () => void;
  /** How long it stays, in ms (2.2 s, or 5 s with undo). */
  ms?: number;
}
let showToast: ((msg: string, o?: ToastOptions) => void) | null = null;
/** toast('Saved on phone') or toast('Follow-up moved', { undo: () => moveBack() }). */
export function toast(msg: string, opts?: ToastOptions) {
  showToast?.(msg, opts);
}
export function ToastHost() {
  const t = useT();
  const [cur, setCur] = useState<{ msg: string; undo?: () => void } | null>(null);
  const op = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    showToast = (m, o) => {
      setCur({ msg: m, undo: o?.undo });
      Animated.timing(op, { toValue: 1, duration: 150, useNativeDriver: true }).start();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => Animated.timing(op, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => setCur(null)), o?.ms ?? (o?.undo ? 5000 : 2200));
    };
    return () => { showToast = null; if (timer.current) clearTimeout(timer.current); };
  }, [op]);
  if (!cur) return null;
  if (cur.undo) {
    const undo = cur.undo;
    return (
      <Animated.View accessibilityRole="alert" style={[s.undoBar, { opacity: op, bottom: 96 + insets.bottom }]}>
        <Icon name="check" size={18} color={C.mint} strokeWidth={3} />
        <T style={{ flex: 1, color: '#fff', fontWeight: '600' }}>{cur.msg}</T>
        <Pressable accessibilityRole="button" accessibilityLabel={t('uxUndo')} hitSlop={6}
          onPress={() => { if (timer.current) clearTimeout(timer.current); setCur(null); op.setValue(0); undo(); }}
          style={({ pressed }) => [s.undoBtn, pressed && { opacity: 0.7 }]}>
          <Svg width={18} height={18} viewBox="0 0 24 24">
            <Path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" stroke="#7fd3ff" strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
          <T style={{ color: '#7fd3ff', fontWeight: '800' }}>{t('uxUndo')}</T>
        </Pressable>
      </Animated.View>
    );
  }
  return (
    <Animated.View pointerEvents="none" style={[s.toast, { opacity: op, bottom: 96 + insets.bottom }]}>
      <Icon name="check" size={16} color={C.mint} strokeWidth={3} />
      <T style={{ color: '#fff', fontWeight: '600' }}>{cur.msg}</T>
    </Animated.View>
  );
}

// ─── The "+ Add" sheet ───
// The sheet itself lives in components/AddSheet.tsx and is mounted once by the tabs layout, which registers it here.
let addHandler: (() => void) | null = null;
/** Used by AddSheetHost: what the centre "+" opens. */
export function setAddHandler(fn: (() => void) | null) {
  addHandler = fn;
}
/** Opens the "What do you want to do?" sheet (falls back to the full /add screen outside the tabs). */
export function openAddSheet() {
  if (addHandler) addHandler();
  else router.push('/add');
}

// ─── Bottom navigation with the centre "+" ───
// Vita sits in the Today header; the team chat (linked to the CRM) has the bottom slot so it's one tap from anywhere.
const TABS: { path: string; icon: IconName; key: 'tabToday' | 'tabPartners' | 'chatTab' | 'tabPatients' | 'tabMe' }[] = [
  { path: '/today', icon: 'home', key: 'tabToday' },
  { path: '/followups', icon: 'users', key: 'tabPartners' },
  { path: '/chat', icon: 'chat', key: 'chatTab' },
  { path: '/patients', icon: 'patients', key: 'tabPatients' },
  { path: '/me', icon: 'user', key: 'tabMe' },
];
export const BottomNav = React.memo(function BottomNav() {
  const t = useT();
  const path = usePathname();
  const insets = useSafeAreaInsets();
  // On Android the keyboard pushes the window up; hide the tabs while typing so the input keeps the room.
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const a = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true));
    const b = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false));
    return () => { a.remove(); b.remove(); };
  }, []);
  // Follow-ups due today or overdue, on the Partners tab, so they're never out of sight.
  const due = useDb(() => db().getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM contacts WHERE followUpDate IS NOT NULL AND followUpDate <= ?', ymd())?.n ?? 0);
  useChatVersion();
  const chatUnread = cachedUnread();
  if (keyboard) return null;
  const item = (tab: (typeof TABS)[number]) => {
    const active = path.startsWith(tab.path);
    const isChat = tab.path === '/chat';
    const badge = tab.path === '/followups' ? due : isChat ? chatUnread : 0;
    return (
      <Pressable key={tab.path} accessibilityRole="tab" accessibilityState={{ selected: active }} style={s.tab}
        accessibilityLabel={badge > 0 ? `${t(tab.key)}, ${badge}` : undefined}
        // Chat is a stack of screens (list → conversation), so it opens on top and Back returns to where the agent was.
        onPress={() => { if (active) return; if (isChat) router.push('/chat'); else router.navigate(tab.path as never); }}>
        {(
          <View>
            <Icon name={tab.icon} size={24} color={active ? C.blue : C.text2} />
            {badge > 0 ? (
              <View style={{ position: 'absolute', top: -5, right: -10, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: isChat ? C.blue : C.bad, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.card }}>
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{badge > 99 ? '99+' : badge}</Text>
              </View>
            ) : null}
          </View>
        )}
        <T style={[s.tabText, active && { color: C.blue, fontWeight: '800' }]} numberOfLines={1}>{t(tab.key)}</T>
      </Pressable>
    );
  };
  return (
    <View style={[s.nav, { borderTopColor: C.border, paddingBottom: Math.max(insets.bottom, 8) }]}>
      {item(TABS[0])}
      {item(TABS[1])}
      <View style={s.tab}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('uxAddA11y')} onPress={openAddSheet}
          style={({ pressed }) => [s.fab, pressed && { transform: [{ scale: 0.95 }] }]}>
          <Icon name="plus" size={26} color="#fff" strokeWidth={2.6} />
          <Text style={s.fabText} numberOfLines={1} allowFontScaling={false}>{t('uxAdd')}</Text>
        </Pressable>
      </View>
      {item(TABS[2])}
      {item(TABS[3])}
      {item(TABS[4])}
    </View>
  );
});

export const s = StyleSheet.create({
  text: { color: C.text, fontSize: 16 },
  pad: { padding: 16, gap: 12 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border, minHeight: 58 },
  backBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
  topTitle: { fontSize: 18, fontWeight: '700' },
  topSub: { fontSize: 13, color: C.text2 },
  btn: { minHeight: 52, borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 6 },
  btnSmall: { minHeight: 48, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4 },
  btnText: { fontSize: 17, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, minHeight: 48, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: C.borderStrong, backgroundColor: C.card },
  chipBig: { minHeight: 54, paddingHorizontal: 18, borderRadius: 14 },
  chipText: { fontSize: 15, fontWeight: '600', color: C.text3, flexShrink: 1 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontSize: 12, fontWeight: '700' },
  card: { backgroundColor: C.card, borderRadius: R.lg, padding: 14, gap: 10, borderWidth: 1, borderColor: C.border },
  section: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '700' },
  sectionSub: { fontSize: 13, color: C.text2 },
  empty: { alignItems: 'center', gap: 8, padding: 28 },
  label: { fontSize: 14, fontWeight: '600', color: C.text3 },
  input: { minHeight: 52, borderRadius: 12, borderWidth: 1, borderColor: C.borderStrong, backgroundColor: C.card, paddingHorizontal: 14, fontSize: 17, color: C.text },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, minHeight: 48 },
  box: { width: 26, height: 26, borderRadius: 7, borderWidth: 2, borderColor: C.borderStrong, alignItems: 'center', justifyContent: 'center' },
  scrim: { flex: 1, backgroundColor: 'rgba(14,21,37,0.45)' },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, padding: 16, gap: 12 },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: C.border },
  sheetTitle: { fontSize: 18, fontWeight: '700' },
  toast: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: C.ink, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999, maxWidth: '92%' },
  undoBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: C.ink, borderRadius: 16, paddingVertical: 10, paddingLeft: 16, paddingRight: 10, elevation: 8, shadowColor: '#0f172a', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 8 } },
  undoBtn: { minHeight: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: C.ink2, flexDirection: 'row', alignItems: 'center', gap: 6 },
  nav: { flexDirection: 'row', backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 6 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 52 },
  tabText: { fontSize: 12, color: C.text2, fontWeight: '600' },
  fab: { width: 66, height: 66, borderRadius: 33, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center', marginTop: -26, borderWidth: 4, borderColor: C.card, elevation: 5, shadowColor: '#0a72d6', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } },
  fabText: { color: '#fff', fontSize: 11, fontWeight: '800', marginTop: -1 },
});
