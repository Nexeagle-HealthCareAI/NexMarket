import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { T, TopBar } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useSession } from '../../lib/session';
import { cachedThreads, isOfficeUser, refreshThreads, useChatVersion, type ChatThread } from '../../lib/chat';
import { relDay, timeOf } from '../../lib/format';
import { C } from '../../theme';
import { SafeAreaView } from 'react-native-safe-area-context';

/** The agent's chats: the office (private) and the Field team group. */
export default function ChatList() {
  const { t, lang } = useSession();
  useChatVersion();
  const threads = cachedThreads();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try { await refreshThreads(); } catch { /* offline: show what the phone has */ } finally { setBusy(false); }
  }, []);
  useFocusEffect(useCallback(() => {
    void load();
    const id = setInterval(() => void refreshThreads().catch(() => undefined), 15000);
    return () => clearInterval(id);
  }, [load]));

  const when = (iso?: string | null) => {
    if (!iso) return '';
    const d = relDay(t, lang, iso);
    return d === t('today') ? timeOf(lang, iso) : d;
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'left', 'right']}>
      <TopBar title={t('chatTitle')} sub={t('chatPrivate')} />
      <ScrollView refreshControl={<RefreshControl refreshing={busy} onRefresh={load} />}>
        {threads.length === 0 ? (
          <View style={{ padding: 28, alignItems: 'center', gap: 8 }}>
            <Icon name="chat" size={28} color={C.muted} />
            <T style={{ color: C.text2, textAlign: 'center' }}>{busy ? t('loading') : t('chatOffline')}</T>
          </View>
        ) : threads.map((th: ChatThread) => (
          <Pressable key={th.id} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: th.id } })}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: pressed ? C.line : C.card, borderBottomWidth: 1, borderBottomColor: C.line }]}>
            <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: th.kind === 'team' ? C.blue : '#0f8a5f' }}>
              <Icon name={th.kind === 'team' ? 'users' : 'hospital'} color="#fff" size={24} />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <T style={{ flex: 1, fontSize: 17, fontWeight: '700' }} numberOfLines={1}>{th.kind === 'team' ? t('chatTeam') : isOfficeUser() ? th.title : t('chatOffice')}</T>
                <T style={{ fontSize: 12, color: th.unread ? '#1fa855' : C.text2, fontWeight: th.unread ? '700' : '500' }}>{when(th.lastMessageAt)}</T>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <T style={{ flex: 1, color: C.text2, fontSize: 14 }} numberOfLines={1}>{th.lastPreview ?? (th.kind === 'team' ? t('chatTeamSub') : t('chatOfficeSub'))}</T>
                {th.unread > 0 ? (
                  <View style={{ minWidth: 22, height: 22, borderRadius: 11, backgroundColor: '#25d366', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}>
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
    </SafeAreaView>
  );
}
