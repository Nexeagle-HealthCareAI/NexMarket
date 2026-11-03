import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { ChatAvatar, NX } from '../../components/ChatAvatar';
import { useSession } from '../../lib/session';
import { cachedThreads, isOfficeUser, refreshPeople, refreshThreads, useChatVersion, type ChatThread } from '../../lib/chat';
import { relDay, timeOf } from '../../lib/format';
import { C } from '../../theme';

type Filter = 'all' | 'unread' | 'people';

/** Chats: the office, the Field team, and one-to-one chats with anyone. "New chat" starts one. */
export default function ChatList() {
  const { t, lang } = useSession();
  const insets = useSafeAreaInsets();
  useChatVersion();
  const threads = cachedThreads();
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    setBusy(true);
    try { await refreshThreads(); } catch { /* offline: show what the phone has */ } finally { setBusy(false); }
  }, []);
  useFocusEffect(useCallback(() => {
    void load();
    void refreshPeople().catch(() => undefined);
    const id = setInterval(() => void refreshThreads().catch(() => undefined), 15000);
    return () => clearInterval(id);
  }, [load]));

  const when = (iso?: string | null) => {
    if (!iso) return '';
    const d = relDay(t, lang, iso);
    return d === t('today') ? timeOf(lang, iso) : d;
  };
  const titleOf = (th: ChatThread) => th.kind === 'team' ? t('chatTeam') : th.kind === 'direct' ? th.title : isOfficeUser() ? th.title : t('chatOffice');
  const subOf = (th: ChatThread) => th.lastPreview ?? (th.kind === 'team' ? t('chatTeamSub') : th.kind === 'direct' ? (th.sub ?? t('chatDirectSub')) : t('chatOfficeSub'));
  const shown = threads.filter((th) => filter === 'all' || (filter === 'unread' ? th.unread > 0 : th.kind === 'direct'));
  const unreadTotal = threads.reduce((n, th) => n + th.unread, 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: NX.head }} edges={['top', 'left', 'right']}>
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, gap: 12, backgroundColor: NX.head, borderBottomWidth: 3, borderBottomColor: NX.accent }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/today'))} hitSlop={10} accessibilityLabel={t('back')} style={{ padding: 4 }}>
            <Icon name="back" color="#fff" size={22} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <T style={{ color: '#fff', fontSize: 22, fontWeight: '800' }}>{t('chatTitle')}</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Icon name="lock" size={11} color={NX.headSub} />
              <T style={{ color: NX.headSub, fontSize: 12 }}>{t('chatPrivate')}</T>
            </View>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['all', 'unread', 'people'] as Filter[]).map((f) => (
            <Pressable key={f} onPress={() => setFilter(f)} accessibilityRole="tab" accessibilityState={{ selected: filter === f }}
              style={{ paddingHorizontal: 14, height: 34, borderRadius: 17, justifyContent: 'center', backgroundColor: filter === f ? NX.accent : 'rgba(255,255,255,0.1)' }}>
              <T style={{ color: filter === f ? C.ink : '#fff', fontWeight: '700', fontSize: 13 }}>
                {f === 'all' ? t('chatFilterAll') : f === 'unread' ? `${t('chatFilterUnread')}${unreadTotal ? ` · ${unreadTotal}` : ''}` : t('chatFilterPeople')}
              </T>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <ScrollView refreshControl={<RefreshControl refreshing={busy} onRefresh={load} />} contentContainerStyle={{ paddingBottom: 110 + insets.bottom }}>
          {shown.length === 0 ? (
            <View style={{ padding: 28, alignItems: 'center', gap: 8 }}>
              <Icon name="chat" size={28} color={C.muted} />
              <T style={{ color: C.text2, textAlign: 'center' }}>{busy ? t('loading') : filter === 'people' ? t('chatNoDirect') : filter === 'unread' ? t('chatNoUnread') : t('chatOffline')}</T>
            </View>
          ) : shown.map((th) => (
            <Pressable key={th.id} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: th.id } })}
              style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: pressed ? C.line : C.card, borderBottomWidth: 1, borderBottomColor: C.line }]}>
              <ChatAvatar kind={th.kind} name={th.title} photoUrl={th.photoUrl} size={52} ring={th.unread > 0} />
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <T style={{ flex: 1, fontSize: 17, fontWeight: th.unread ? '800' : '700' }} numberOfLines={1}>{titleOf(th)}</T>
                  <T style={{ fontSize: 12, color: th.unread ? C.blue : C.text2, fontWeight: th.unread ? '800' : '500' }}>{when(th.lastMessageAt)}</T>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <T style={{ flex: 1, color: th.unread ? C.text : C.text2, fontSize: 14, fontWeight: th.unread ? '600' : '400' }} numberOfLines={1}>{subOf(th)}</T>
                  {th.unread > 0 ? (
                    <View style={{ minWidth: 22, height: 22, borderRadius: 11, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}>
                      <T style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{th.unread}</T>
                    </View>
                  ) : null}
                </View>
              </View>
            </Pressable>
          ))}
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <Icon name="lock" size={13} color={C.muted} />
            <T style={{ color: C.muted, fontSize: 12, textAlign: 'center' }}>{t('chatSecureNote')}</T>
          </View>
        </ScrollView>

        {/* New chat */}
        <Pressable onPress={() => router.push('/chat/new')} accessibilityRole="button" accessibilityLabel={t('chatNew')}
          style={({ pressed }) => [{ position: 'absolute', right: 16, bottom: 20 + insets.bottom, flexDirection: 'row', alignItems: 'center', gap: 8, height: 56, paddingHorizontal: 20,
            borderRadius: 18, backgroundColor: C.blue, elevation: 6, shadowColor: '#0e1525', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }, pressed && { opacity: 0.9 }]}>
          <Icon name="newChat" color="#fff" size={22} />
          <T style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>{t('chatNew')}</T>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
