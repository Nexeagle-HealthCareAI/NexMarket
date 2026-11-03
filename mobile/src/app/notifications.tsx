import React, { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, RefreshControl, ScrollView, Switch, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { T, toast } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { NX } from '../components/ChatAvatar';
import { useSession } from '../lib/session';
import {
  askPermission, cachedInbox, cachedNotifyUnread, loadSettings, markAllRead, markRead, openLink, permissionGranted, refreshInbox,
  registerPush, saveSettings, sendTest, useNotifyVersion, type InboxItem, type NotifySettings,
} from '../lib/notifications';
import { relDay, timeOf } from '../lib/format';
import { C } from '../theme';

const KIND: Record<string, { icon: IconName; fg: string; bg: string }> = {
  chat: { icon: 'chat', fg: C.blueInk, bg: C.blueSoft },
  team_chat: { icon: 'users', fg: C.blueInk, bg: C.blueSoft },
  escalation: { icon: 'flag', fg: C.bad, bg: C.badSoft },
  assignment: { icon: 'map', fg: C.okInk, bg: C.okSoft },
  task: { icon: 'check', fg: C.okInk, bg: C.okSoft },
  leave: { icon: 'calendar', fg: C.warnInk, bg: C.warnSoft },
  referral: { icon: 'patients', fg: C.okInk, bg: C.okSoft },
  note: { icon: 'note', fg: C.text2, bg: C.line },
};

/** Everything the agent has been told: chat, escalations, new blocks, tasks, leave, patients. Plus settings. */
export default function NotificationsScreen() {
  const { t, lang } = useSession();
  const insets = useSafeAreaInsets();
  useNotifyVersion();
  const items = cachedInbox();
  const unread = cachedNotifyUnread();
  const [tab, setTab] = useState<'all' | 'unread' | 'settings'>('all');
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<NotifySettings | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try { await refreshInbox(); } catch { /* offline: show what the phone has */ } finally { setBusy(false); }
  }, []);
  useFocusEffect(useCallback(() => {
    void load();
    void permissionGranted().then(setAllowed).catch(() => undefined);
  }, [load]));

  const openSettings = async () => {
    setTab('settings');
    try { setSettings(await loadSettings()); } catch { toast(t('ntNeedsNet')); }
  };
  const toggle = async (kind: string) => {
    if (!settings) return;
    const next = { ...settings, kinds: settings.kinds.map((k) => (k.kind === kind ? { ...k, on: !k.on } : k)) };
    setSettings(next);
    try { await saveSettings(next.kinds.filter((k) => !k.on).map((k) => k.kind)); }
    catch { setSettings(settings); toast(t('ntNeedsNet')); }
  };
  const turnOn = async () => {
    const ok = await askPermission();
    setAllowed(ok);
    if (ok) { await registerPush(); toast(t('ntOn')); }
    else Alert.alert(t('ntTitle'), t('ntBlocked'), [{ text: t('close'), style: 'cancel' }, { text: t('fix'), onPress: () => void Linking.openSettings() }]);
  };
  const tap = (i: InboxItem) => { if (!i.read) void markRead(i.id); openLink(i.link); };
  const shown = tab === 'unread' ? items.filter((i) => !i.read) : items;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: NX.head }} edges={['top', 'left', 'right']}>
      <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12, gap: 12, backgroundColor: NX.head, borderBottomWidth: 3, borderBottomColor: NX.accent }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/today'))} hitSlop={10} accessibilityLabel={t('back')} style={{ padding: 4 }}>
            <Icon name="back" color="#fff" size={22} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <T style={{ color: '#fff', fontSize: 22, fontWeight: '800' }}>{t('ntTitle')}</T>
            <T style={{ color: NX.headSub, fontSize: 12 }}>{unread ? t('ntUnreadN', { n: unread }) : t('ntAllRead')}</T>
          </View>
          {unread > 0 && tab !== 'settings' ? (
            <Pressable onPress={() => void markAllRead().catch(() => toast(t('ntNeedsNet')))} hitSlop={8}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.1)' }}>
              <Icon name="checks" size={16} color={NX.accent} />
              <T style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{t('ntReadAll')}</T>
            </Pressable>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['all', 'unread', 'settings'] as const).map((k) => (
            <Pressable key={k} onPress={() => (k === 'settings' ? void openSettings() : setTab(k))} accessibilityRole="tab" accessibilityState={{ selected: tab === k }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 34, borderRadius: 17, backgroundColor: tab === k ? NX.accent : 'rgba(255,255,255,0.1)' }}>
              {k === 'settings' ? <Icon name="settings" size={14} color={tab === k ? C.ink : '#fff'} /> : null}
              <T style={{ color: tab === k ? C.ink : '#fff', fontWeight: '700', fontSize: 13 }}>
                {k === 'all' ? t('chatFilterAll') : k === 'unread' ? `${t('chatFilterUnread')}${unread ? ` · ${unread}` : ''}` : t('ntSettings')}
              </T>
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ paddingBottom: 24 + insets.bottom }}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={load} />}>
        {allowed === false && tab !== 'settings' ? (
          <Pressable onPress={() => void turnOn()} style={{ margin: 12, flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: C.warnSoft, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#f5d9a8' }}>
            <Icon name="bellOff" color={C.warnInk} />
            <View style={{ flex: 1 }}>
              <T style={{ fontWeight: '800', color: C.warnInk }}>{t('ntOffTitle')}</T>
              <T style={{ color: C.warnInk, fontSize: 13 }}>{t('ntOffSub')}</T>
            </View>
            <T style={{ color: C.blueInk, fontWeight: '800' }}>{t('ntTurnOn')}</T>
          </Pressable>
        ) : null}

        {tab === 'settings' ? (
          <View style={{ padding: 12, gap: 12 }}>
            <View style={{ backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, overflow: 'hidden' }}>
              {!settings ? <T style={{ padding: 16, color: C.text2 }}>{t('loading')}</T> : settings.kinds.map((k, i) => (
                <View key={k.kind} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
                  <View style={{ width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: (KIND[k.kind] ?? KIND.note).bg }}>
                    <Icon name={(KIND[k.kind] ?? KIND.note).icon} size={17} color={(KIND[k.kind] ?? KIND.note).fg} />
                  </View>
                  <T style={{ flex: 1, fontWeight: '600' }}>{t(`ntKind_${k.kind}` as never)}</T>
                  <Switch value={k.on} onValueChange={() => void toggle(k.kind)} trackColor={{ true: C.blue, false: C.borderStrong }} thumbColor="#fff" />
                </View>
              ))}
            </View>
            <T style={{ color: C.text2, fontSize: 13 }}>{t('ntMutedHint')}</T>
            <View style={{ backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14, gap: 6 }}>
              <T style={{ fontWeight: '800' }}>{t('ntPhoneTitle')}</T>
              <T style={{ color: C.text2, fontSize: 13 }}>
                {allowed === false ? t('ntOffSub') : settings && !settings.pushConfigured ? t('ntLocalOnly') : t('ntPushOn')}
              </T>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                {allowed === false ? <SmallBtn label={t('ntTurnOn')} onPress={() => void turnOn()} primary /> : null}
                <SmallBtn label={t('ntTest')} onPress={() => void sendTest().then(() => toast(t('ntTestSent'))).catch(() => toast(t('ntNeedsNet')))} />
                <SmallBtn label={t('ntPhoneSettings')} onPress={() => void Linking.openSettings()} />
              </View>
            </View>
          </View>
        ) : shown.length === 0 ? (
          <View style={{ padding: 32, alignItems: 'center', gap: 8 }}>
            <Icon name="bell" size={28} color={C.muted} />
            <T style={{ color: C.text2, textAlign: 'center' }}>{busy ? t('loading') : tab === 'unread' ? t('chatNoUnread') : t('ntNone')}</T>
          </View>
        ) : shown.map((i) => {
          const k = KIND[i.kind] ?? KIND.note;
          return (
            <Pressable key={i.id} onPress={() => tap(i)} accessibilityRole="button"
              style={({ pressed }) => [{ flexDirection: 'row', gap: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: pressed ? C.line : i.read ? C.card : '#f1f7fe', borderBottomWidth: 1, borderBottomColor: C.line }]}>
              <View style={{ width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: k.bg }}>
                <Icon name={k.icon} size={19} color={k.fg} />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <T style={{ fontSize: 15, fontWeight: i.read ? '700' : '800' }} numberOfLines={2}>{i.title}</T>
                {i.body ? <T style={{ color: C.text2, fontSize: 14, lineHeight: 19 }} numberOfLines={3}>{i.body}</T> : null}
                <T style={{ color: C.muted, fontSize: 12 }}>{relDay(t, lang, i.createdAt)} · {timeOf(lang, i.createdAt)}</T>
              </View>
              {!i.read ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.blue, marginTop: 6 }} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function SmallBtn({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => [{ paddingHorizontal: 14, height: 38, borderRadius: 12, justifyContent: 'center', backgroundColor: primary ? C.blue : C.blueSoft }, pressed && { opacity: 0.85 }]}>
      <T style={{ color: primary ? '#fff' : C.blueInk, fontWeight: '700', fontSize: 14 }}>{label}</T>
    </Pressable>
  );
}
