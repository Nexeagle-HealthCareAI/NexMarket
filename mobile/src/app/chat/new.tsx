import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SectionList, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { T } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { ChatAvatar, NX } from '../../components/ChatAvatar';
import { useSession } from '../../lib/session';
import { cachedPeople, cachedThreads, refreshPeople, startDirect, useChatVersion, type ChatPerson } from '../../lib/chat';
import { ApiError } from '../../lib/api';
import { C } from '../../theme';

/** Pick anyone to message: admins and managers in the office, or another field agent. */
export default function NewChat() {
  const { t } = useSession();
  useChatVersion();
  const people = cachedPeople();
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(people.length === 0);
  const [opening, setOpening] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let alive = true;
    refreshPeople().catch(() => undefined).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []));

  const sections = useMemo(() => {
    const s = search.trim().toLowerCase();
    const hit = (p: ChatPerson) => !s || p.name.toLowerCase().includes(s) || p.role.toLowerCase().includes(s) || (p.block ?? '').toLowerCase().includes(s) || p.agentId.toLowerCase().includes(s);
    const list = people.filter(hit);
    return [
      { key: 'office', title: t('chatPeopleOffice'), data: list.filter((p) => p.kind === 'dashboard') },
      { key: 'field', title: t('chatPeopleField'), data: list.filter((p) => p.kind === 'field') },
    ].filter((x) => x.data.length);
  }, [people, search, t]);

  const open = async (p: ChatPerson) => {
    if (opening) return;
    setOpening(p.agentId);
    try {
      const id = await startDirect(p.agentId);
      router.replace({ pathname: '/chat/[id]', params: { id } });
    } catch (e) {
      Alert.alert(t('chMessageSomeone'), e instanceof ApiError ? e.message : t('chatNeedsNet'));
    } finally {
      setOpening(null);
    }
  };
  const existing = new Set(cachedThreads().filter((x) => x.kind === 'direct').map((x) => x.agentId));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: NX.head }} edges={['top', 'left', 'right']}>
      <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 14, gap: 12, backgroundColor: NX.head }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable onPress={() => router.back()} hitSlop={6} accessibilityRole="button" accessibilityLabel={t('back')} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="back" color="#fff" size={24} /></Pressable>
          <View style={{ flex: 1 }}>
            <T style={{ color: '#fff', fontSize: 22, fontWeight: '800' }}>{t('chMessageSomeone')}</T>
            <T style={{ color: NX.headSub, fontSize: 14 }}>{t('chatNewSub', { n: people.length })}</T>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.ink2, borderRadius: 14, paddingHorizontal: 14, height: 48, marginHorizontal: 4 }}>
          <Icon name="search" color="#c3cbdc" size={20} />
          <TextInput value={search} onChangeText={setSearch} placeholder={t('chatSearchPeople')} placeholderTextColor="#c3cbdc" accessibilityLabel={t('chatSearchPeople')}
            style={{ flex: 1, minWidth: 0, color: '#fff', fontSize: 16, paddingVertical: 0 }} autoCorrect={false} returnKeyType="search" />
          {search ? (
            <Pressable onPress={() => setSearch('')} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('chClearSearch')} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" color="#c3cbdc" size={20} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={{ flex: 1, backgroundColor: C.bg }}>
        {loading && !people.length ? <ActivityIndicator color={C.blue} style={{ marginTop: 32 }} /> : (
          <SectionList
            sections={sections}
            keyExtractor={(p) => p.agentId}
            keyboardShouldPersistTaps="handled"
            stickySectionHeadersEnabled
            contentContainerStyle={{ paddingBottom: 24 }}
            ListEmptyComponent={<T style={{ color: C.text2, textAlign: 'center', padding: 28, fontSize: 16 }}>{people.length ? t('noMatches') : t('chatNeedsNet')}</T>}
            renderSectionHeader={({ section }) => (
              <View style={{ backgroundColor: C.bg, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
                <T style={{ fontSize: 14, fontWeight: '800', color: C.text2, letterSpacing: 0.8 }}>{section.title.toUpperCase()} · {section.data.length}</T>
              </View>
            )}
            renderItem={({ item: p }) => (
              <Pressable onPress={() => void open(p)} accessibilityRole="button" accessibilityLabel={[p.name, p.role, p.block].filter(Boolean).join(', ')} accessibilityState={{ busy: opening === p.agentId }}
                style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 8, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: C.border, backgroundColor: pressed ? C.line : C.card }]}>
                <ChatAvatar kind="direct" name={p.name} photoUrl={p.photoUrl} size={52} />
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <T style={{ fontSize: 17, fontWeight: '800' }} numberOfLines={1}>{p.name}</T>
                  <T style={{ color: C.text2, fontSize: 15 }} numberOfLines={1}>{[p.role, p.block].filter(Boolean).join(' · ')}</T>
                </View>
                {opening === p.agentId ? <ActivityIndicator color={C.blue} />
                  : existing.has(p.agentId) ? <Icon name="chat" color={C.blue} size={24} /> : <Icon name="chevron" color={C.muted} size={22} />}
              </Pressable>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
