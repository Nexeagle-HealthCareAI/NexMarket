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
      Alert.alert(t('chatNew'), e instanceof ApiError ? e.message : t('chatNeedsNet'));
    } finally {
      setOpening(null);
    }
  };
  const existing = new Set(cachedThreads().filter((x) => x.kind === 'direct').map((x) => x.agentId));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: NX.head }} edges={['top', 'left', 'right']}>
      <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12, gap: 10, backgroundColor: NX.head, borderBottomWidth: 3, borderBottomColor: NX.accent }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel={t('back')} style={{ padding: 4 }}><Icon name="back" color="#fff" size={22} /></Pressable>
          <View style={{ flex: 1 }}>
            <T style={{ color: '#fff', fontSize: 20, fontWeight: '800' }}>{t('chatNew')}</T>
            <T style={{ color: NX.headSub, fontSize: 12 }}>{t('chatNewSub', { n: people.length })}</T>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 14, paddingHorizontal: 12, height: 46 }}>
          <Icon name="search" color={NX.headSub} size={18} />
          <TextInput value={search} onChangeText={setSearch} placeholder={t('chatSearchPeople')} placeholderTextColor={NX.headSub}
            style={{ flex: 1, color: '#fff', fontSize: 16 }} autoCorrect={false} />
          {search ? <Pressable onPress={() => setSearch('')} hitSlop={8}><Icon name="close" color={NX.headSub} size={18} /></Pressable> : null}
        </View>
      </View>

      <View style={{ flex: 1, backgroundColor: C.bg }}>
        {loading && !people.length ? <ActivityIndicator color={C.blue} style={{ marginTop: 32 }} /> : (
          <SectionList
            sections={sections}
            keyExtractor={(p) => p.agentId}
            keyboardShouldPersistTaps="handled"
            stickySectionHeadersEnabled
            ListEmptyComponent={<T style={{ color: C.text2, textAlign: 'center', padding: 28 }}>{people.length ? t('noMatches') : t('chatNeedsNet')}</T>}
            renderSectionHeader={({ section }) => (
              <View style={{ backgroundColor: C.bg, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>
                <T style={{ fontSize: 12, fontWeight: '800', color: C.text2, letterSpacing: 0.5 }}>{section.title.toUpperCase()} · {section.data.length}</T>
              </View>
            )}
            renderItem={({ item: p }) => (
              <Pressable onPress={() => void open(p)} accessibilityRole="button"
                style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: pressed ? C.line : C.card, borderBottomWidth: 1, borderBottomColor: C.line }]}>
                <ChatAvatar kind="direct" name={p.name} photoUrl={p.photoUrl} size={46} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T style={{ fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{p.name}</T>
                  <T style={{ color: C.text2, fontSize: 13 }} numberOfLines={1}>{[p.role, p.block].filter(Boolean).join(' · ')}</T>
                </View>
                {opening === p.agentId ? <ActivityIndicator color={C.blue} />
                  : existing.has(p.agentId) ? <Icon name="chat" color={C.blue} size={20} /> : <Icon name="chevron" color={C.muted} />}
              </Pressable>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
