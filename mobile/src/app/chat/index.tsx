import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { SpeakButton, T } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { SyncStrip } from '../../components/SyncStrip';
import { ChatAvatar, NX } from '../../components/ChatAvatar';
import { useSession } from '../../lib/session';
import { cachedMessages, cachedThreads, isOfficeUser, msTime, refreshPeople, refreshThreads, useChatVersion, type ChatMsg, type ChatThread } from '../../lib/chat';
import { liveLine } from '../../lib/presence';
import { explainOnce } from '../../lib/speak';
import { relDay, timeOf } from '../../lib/format';
import { C } from '../../theme';

type Filter = 'all' | 'unread' | 'people';
type TFn = ReturnType<typeof useSession>['t'];
type Lang = ReturnType<typeof useSession>['lang'];

/**
 * Chats: the agent's Office chat first (highlighted), the Field team second, then one-to-one chats.
 * A chat whose last message is still on the phone says so ("waiting for signal"). "Message someone" starts a new one.
 */
export default function ChatList() {
  const { t, lang } = useSession();
  const insets = useSafeAreaInsets();
  useChatVersion();
  const threads = cachedThreads();
  const office = isOfficeUser();
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

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
  useEffect(() => { explainOnce('/chat', t('chListExplain'), lang); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const s = search.trim().toLowerCase();
  const matches = (th: ChatThread) => {
    if (!s) return true;
    if ([titleOf(th, t, office), th.lastPreview ?? '', th.sub ?? ''].some((x) => x.toLowerCase().includes(s))) return true;
    return cachedMessages(th.id).some((m) => (m.text ?? '').toLowerCase().includes(s) || (m.senderName ?? '').toLowerCase().includes(s));
  };
  const shown = threads.filter((th) => (filter === 'all' || (filter === 'unread' ? th.unread > 0 : th.kind === 'direct')) && matches(th));
  // The agent's own office chat and the team on top; a manager (who sees every agent's chat) gets just the team on top.
  const top = [
    ...(office ? [] : shown.filter((th) => th.kind === 'agent')),
    ...shown.filter((th) => th.kind === 'team'),
  ];
  const rest = shown.filter((th) => !top.includes(th));
  const unreadTotal = threads.reduce((n, th) => n + th.unread, 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: NX.head }} edges={['top', 'left', 'right']}>
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, gap: 12, backgroundColor: NX.head }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/today'))} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('back')}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -8 }}>
            <Icon name="back" color="#fff" size={24} />
          </Pressable>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T style={{ color: '#fff', fontSize: 24, fontWeight: '800' }}>{t('chatTitle')}</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Icon name="lock" size={12} color={NX.headSub} />
              <T style={{ color: NX.headSub, fontSize: 13 }} numberOfLines={1}>{t('chatPrivate')}</T>
            </View>
          </View>
          <SpeakButton text={t('chListExplain')} dark label={t('uxReadAloud')} />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, paddingHorizontal: 14, borderRadius: 14, backgroundColor: C.ink2 }}>
          <Icon name="search" color="#c3cbdc" size={20} />
          <TextInput value={search} onChangeText={setSearch} placeholder={t('chSearch')} placeholderTextColor="#c3cbdc" accessibilityLabel={t('chSearch')}
            style={{ flex: 1, minWidth: 0, color: '#fff', fontSize: 16, paddingVertical: 0 }} autoCorrect={false} returnKeyType="search" />
          {search ? (
            <Pressable onPress={() => setSearch('')} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('chClearSearch')}
              style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" color="#c3cbdc" size={20} />
            </Pressable>
          ) : null}
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['all', 'unread', 'people'] as Filter[]).map((f) => (
            <Pressable key={f} onPress={() => setFilter(f)} accessibilityRole="tab" accessibilityState={{ selected: filter === f }}
              style={{ paddingHorizontal: 16, minHeight: 44, borderRadius: 22, justifyContent: 'center', backgroundColor: filter === f ? NX.accent : C.ink2, borderWidth: 1, borderColor: filter === f ? NX.accent : C.inkLine }}>
              <T style={{ color: filter === f ? C.ink : '#fff', fontWeight: '800', fontSize: 15 }}>
                {f === 'all' ? t('chatFilterAll') : f === 'unread' ? `${t('chatFilterUnread')}${unreadTotal ? ` · ${unreadTotal}` : ''}` : t('chatFilterPeople')}
              </T>
            </Pressable>
          ))}
        </View>
      </View>
      <SyncStrip />

      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <ScrollView refreshControl={<RefreshControl refreshing={busy} onRefresh={load} />} keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, gap: 10, paddingBottom: 110 + insets.bottom }}>
          {shown.length === 0 ? (
            <View style={{ padding: 28, alignItems: 'center', gap: 10 }}>
              <Icon name={s ? 'search' : 'chat'} size={30} color={C.muted} />
              <T style={{ color: C.text2, textAlign: 'center', fontSize: 16 }}>
                {s ? t('chNoSearch') : busy ? t('loading') : filter === 'people' ? t('chatNoDirect') : filter === 'unread' ? t('chatNoUnread') : t('chatOffline')}
              </T>
            </View>
          ) : null}
          {top.map((th) => <ThreadCard key={th.id} th={th} highlight={th.kind === 'agent'} office={office} t={t} lang={lang} />)}
          {rest.length ? (
            <T style={{ fontSize: 14, fontWeight: '800', letterSpacing: 0.8, color: C.text2, marginTop: top.length ? 6 : 0 }}>{t('chOneToOne').toUpperCase()}</T>
          ) : null}
          {rest.map((th) => <ThreadCard key={th.id} th={th} office={office} t={t} lang={lang} />)}
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', padding: 12 }}>
            <Icon name="lock" size={13} color={C.muted} />
            <T style={{ color: C.muted, fontSize: 13, textAlign: 'center', flexShrink: 1 }}>{t('chatSecureNote')}</T>
          </View>
        </ScrollView>

        {/* Message someone (the old "New chat") */}
        <Pressable onPress={() => router.push('/chat/new')} accessibilityRole="button" accessibilityLabel={t('chMessageSomeone')}
          style={({ pressed }) => [{ position: 'absolute', right: 16, bottom: 20 + insets.bottom, flexDirection: 'row', alignItems: 'center', gap: 8, height: 56, paddingHorizontal: 20,
            borderRadius: 28, backgroundColor: C.blue, elevation: 6, shadowColor: C.blue, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } }, pressed && { opacity: 0.9 }]}>
          <Icon name="plus" color="#fff" size={22} strokeWidth={2.6} />
          <T style={{ color: '#fff', fontWeight: '800', fontSize: 17 }}>{t('chMessageSomeone')}</T>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const titleOf = (th: ChatThread, t: TFn, office: boolean) =>
  th.kind === 'team' ? t('chatTeam') : th.kind === 'direct' ? th.title : office ? th.title : t('chatOffice');

const previewOf = (m: ChatMsg) => m.text ?? (m.file ? `📎 ${m.file.name}` : m.contact ? `🏷 ${m.contact.name}` : '');

function ThreadCard({ th, highlight, office, t, lang }: { th: ChatThread; highlight?: boolean; office: boolean; t: TFn; lang: Lang }) {
  const title = titleOf(th, t, office);
  const big = th.kind !== 'direct';
  // A message of ours still on the phone (newer than what the server last told us) shows instead of the server's preview.
  const last = cachedMessages(th.id).at(-1);
  const local = last && last.mine && last.state && msTime(last.createdAt) >= msTime(th.lastMessageAt) ? last : null;

  const when = (iso?: string | null) => {
    if (!iso) return '';
    const d = relDay(t, lang, iso);
    return d === t('today') ? timeOf(lang, iso) : d;
  };
  const live = liveLine(t, lang, th.live, th.kind, office);
  const online = th.kind === 'team' ? (th.live?.count ?? 0) > 0 : !!th.live?.online;
  const status = th.kind === 'team' ? ((th.live?.count ?? 0) > 0 ? t('chTeamLine', { n: th.live!.count }) : t('chTeamEveryone'))
    : th.kind === 'direct' ? [th.sub ?? t('chatDirectSub'), live].filter(Boolean).join(' · ')
      : live ?? t('chatOfficeSub');
  const statusGreen = online && th.kind !== 'team';
  const unread = th.unread > 0;

  return (
    <Pressable onPress={() => router.push({ pathname: '/chat/[id]', params: { id: th.id } })} accessibilityRole="button"
      accessibilityLabel={[title, status, unread ? t('chUnreadN', { n: th.unread }) : ''].filter(Boolean).join(', ')}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: pressed ? C.line : C.card,
        borderWidth: highlight ? 2 : 1, borderColor: highlight ? C.blue : C.border }]}>
      <ChatAvatar kind={th.kind} name={th.title} photoUrl={th.photoUrl} size={big ? 56 : 52} online={!!th.live?.online} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <T style={{ flex: 1, fontSize: big ? 18 : 17, fontWeight: '800' }} numberOfLines={1}>{title}</T>
          <T style={{ fontSize: 14, color: unread ? C.blue : C.text2, fontWeight: unread ? '700' : '500' }}>{when(local?.createdAt ?? th.lastMessageAt)}</T>
        </View>
        <T style={{ fontSize: 14, color: statusGreen ? C.okInk : C.text2, fontWeight: statusGreen ? '700' : '500' }} numberOfLines={1}>{status}</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {local ? (
            <>
              <Icon name={local.state === 'failed' ? 'alert' : 'clock'} size={16} color={local.state === 'failed' ? C.bad : C.warnInk} strokeWidth={2.2} />
              <T style={{ flex: 1, fontSize: 15, fontWeight: '600', color: local.state === 'failed' ? C.bad : C.warnInk }} numberOfLines={1}>
                {`${t('chYouSaid', { text: previewOf(local) })} · ${local.state === 'failed' ? t('chatNotSent') : t('chWaitingShort')}`}
              </T>
            </>
          ) : (
            <T style={{ flex: 1, fontSize: big ? 16 : 15, color: unread ? C.text : C.text3, fontWeight: unread ? '600' : '400' }} numberOfLines={1}>{th.lastPreview ?? ''}</T>
          )}
          {unread ? (
            <View style={{ minWidth: 26, height: 26, borderRadius: 13, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 }}>
              <T style={{ color: '#fff', fontSize: 14, fontWeight: '800' }}>{th.unread}</T>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
