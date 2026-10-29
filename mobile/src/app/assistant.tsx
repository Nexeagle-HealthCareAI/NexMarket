import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { Screen, T, TopBar } from '../components/ui';
import { Icon } from '../components/Icon';
import { useSession } from '../lib/session';
import { api, ApiError, OfflineError, post } from '../lib/api';
import { errorMessage } from '../lib/util';
import { saveTips } from '../lib/aiTips';
import { Vita } from '../components/Vita';
import type { StringKey } from '../i18n';
import { C } from '../theme';

interface Tip { title: string; detail: string }
interface Tips { greeting: string; tips: Tip[] }
interface Msg { role: 'user' | 'assistant'; content: string; failed?: boolean }

const SUGGESTIONS: StringKey[] = ['aiSuggest1', 'aiSuggest2', 'aiSuggest3', 'aiSuggest4', 'aiSuggest5'];

/** The field agent's AI helper: today's tips plus a chat that only looks at the agent's own work. */
export default function Assistant() {
  const { t, lang } = useSession();
  const [tips, setTips] = useState<Tips | null>(null);
  const [tipsError, setTipsError] = useState<string | null>(null);
  const [tipsBusy, setTipsBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [asking, setAsking] = useState(false);
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);

  const explain = useCallback((e: unknown) =>
    e instanceof OfflineError ? t('needInternet')
      : e instanceof ApiError && e.status === 503 ? t('aiNotOn')
        : e instanceof ApiError ? e.message : errorMessage(e), [t]);

  const loadTips = useCallback(async (refresh = false) => {
    setTipsBusy(true);
    setTipsError(null);
    try {
      const got = await api<Tips>(`/api/v1/me/assistant/tips?lang=${lang}${refresh ? '&refresh=true' : ''}`, { timeoutMs: 90000 });
      setTips(got);
      saveTips(lang, got);
    } catch (e) {
      setTipsError(e instanceof OfflineError || (e instanceof ApiError && e.status === 503) ? explain(e) : t('aiTipsFailed'));
    } finally {
      setTipsBusy(false);
    }
  }, [lang, explain, t]);

  useEffect(() => { void loadTips(); }, [loadTips]);

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || asking) return;
    const history = msgs.filter((m) => !m.failed).slice(-8).map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: 'user', content: question }]);
    setText('');
    setAsking(true);
    try {
      const r = await post<{ answer: string }>('/api/v1/me/assistant/ask', { question, history, lang }, 90000);
      setMsgs((m) => [...m, { role: 'assistant', content: r.answer || '—' }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: explain(e), failed: true }]);
    } finally {
      setAsking(false);
    }
  };

  useEffect(() => {
    const id = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(id);
  }, [msgs.length, asking]);

  const clear = msgs.length > 0 ? (
    <Pressable onPress={() => setMsgs([])} hitSlop={8} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
      <T style={{ color: C.blueInk, fontWeight: '600', fontSize: 14 }}>{t('aiClear')}</T>
    </Pressable>
  ) : null;

  return (
    <Screen scroll={false} padded={false}
      header={<TopBar title={t('aiHelper')} sub={t('aiHelperSub')} right={clear} />}
      footer={
        <View style={{ padding: 12, gap: 6, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
            <TextInput value={text} onChangeText={setText} placeholder={t('aiAskPlaceholder')} placeholderTextColor={C.muted}
              multiline maxLength={1000} editable={!asking} onSubmitEditing={() => void ask(text)}
              style={{ flex: 1, minHeight: 46, maxHeight: 120, borderWidth: 1, borderColor: C.borderStrong, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, fontSize: 16, color: C.text, backgroundColor: C.bg }} />
            <Pressable accessibilityRole="button" accessibilityLabel={t('aiAskPlaceholder')} disabled={asking || !text.trim()} onPress={() => void ask(text)}
              style={({ pressed }) => [{ width: 46, height: 46, borderRadius: 23, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center' },
                (asking || !text.trim()) && { opacity: 0.4 }, pressed && { opacity: 0.8 }]}>
              {asking ? <ActivityIndicator color="#fff" /> : <Icon name="send" color="#fff" size={20} />}
            </Pressable>
          </View>
          <T style={{ color: C.muted, fontSize: 11, textAlign: 'center' }}>{t('aiPrivacy')}</T>
        </View>
      }>
      <ScrollView ref={scroller} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 24 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void loadTips(true)} />}>
        {/* Today's tips */}
        <View style={{ backgroundColor: C.ink, borderRadius: 18, padding: 16, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Vita mood="ai" height={52} />
            <T style={{ color: '#fff', fontSize: 16, fontWeight: '700', flex: 1 }}>{t('aiTodayTips')}</T>
            {tips && !tipsBusy ? (
              <Pressable onPress={() => void loadTips(true)} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icon name="refresh" color={C.sideText} size={14} />
                <T style={{ color: C.sideText, fontSize: 12 }}>{t('aiNewTips')}</T>
              </Pressable>
            ) : null}
          </View>
          {tipsBusy ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
              <ActivityIndicator color={C.mint} />
              <T style={{ color: C.sideText }}>{t('aiThinking')}</T>
            </View>
          ) : tipsError ? (
            <T style={{ color: C.sideText }}>{tipsError}</T>
          ) : tips ? (
            <>
              {tips.greeting ? <T style={{ color: C.sideText, fontSize: 14 }}>{tips.greeting}</T> : null}
              {tips.tips.map((tip, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 10, backgroundColor: C.ink2, borderRadius: 12, padding: 12 }}>
                  <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: i === 0 ? C.mint : C.inkLine, alignItems: 'center', justifyContent: 'center' }}>
                    <T style={{ color: i === 0 ? C.ink : '#fff', fontWeight: '800', fontSize: 13 }}>{i + 1}</T>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <T style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{tip.title}</T>
                    <T style={{ color: C.sideText, fontSize: 14, lineHeight: 20 }}>{tip.detail}</T>
                  </View>
                </View>
              ))}
            </>
          ) : null}
        </View>

        {/* Suggestions until the first question */}
        {msgs.length === 0 ? (
          <View style={{ gap: 8 }}>
            {SUGGESTIONS.map((k) => (
              <Pressable key={k} onPress={() => void ask(t(k))} disabled={asking}
                style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 }, pressed && { opacity: 0.8 }]}>
                <Icon name="sparkle" color={C.blue} size={16} />
                <T style={{ flex: 1, fontSize: 15 }}>{t(k)}</T>
                <Icon name="chevron" color={C.muted} size={16} />
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* Chat */}
        {msgs.map((m, i) => (
          <View key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%',
            backgroundColor: m.role === 'user' ? C.blue : m.failed ? C.warnSoft : C.card,
            borderWidth: m.role === 'user' ? 0 : 1, borderColor: m.failed ? C.warnSoft : C.border,
            borderRadius: 16, borderBottomRightRadius: m.role === 'user' ? 4 : 16, borderBottomLeftRadius: m.role === 'user' ? 16 : 4,
            paddingHorizontal: 14, paddingVertical: 10 }}>
            <T style={{ color: m.role === 'user' ? '#fff' : m.failed ? C.warnInk : C.text, fontSize: 15, lineHeight: 22 }}>{m.content}</T>
          </View>
        ))}
        {asking ? (
          <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 }}>
            <Vita mood="think" height={36} />
            <T style={{ color: C.text2 }}>{t('aiThinking')}</T>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
