import React, { useState } from 'react';
import { Alert, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Btn, Card, Chip, Empty, Screen, T, TopBar, toast } from '../components/ui';
import { useDb, useSession } from '../lib/session';
import { fieldSurvey, localAnswers, saveAnswers, syncFieldSurveys } from '../lib/fieldSurvey';
import { C } from '../theme';

/** The survey's questions: answered once, separately from the map, then the survey is submitted. */
export default function FieldSurveyQuestions() {
  const { t } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useDb(() => fieldSurvey(id), [id]);
  const saved = useDb(() => localAnswers(id), [id]);
  const [ans, setAns] = useState<Record<string, unknown>>(() => saved?.answers ?? (item?.answers as Record<string, unknown> | null) ?? {});
  if (!item) return <Screen header={<TopBar title={t('fsQuestions')} />}><Empty text={t('fsListEmpty')} icon="note" /></Screen>;
  const c = item.config;
  const set = (k: string, v: unknown) => setAns({ ...ans, [k]: v });
  const missing = c.questions.filter((q) => q.required && (ans[q.id] == null || ans[q.id] === '' || (Array.isArray(ans[q.id]) && (ans[q.id] as unknown[]).length === 0)));
  const submitted = item.myStatus === 'submitted' || !!saved?.submitted;
  const input = { borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: C.text, backgroundColor: '#fff' } as const;

  const save = (submit: boolean) => {
    const clean = Object.fromEntries(Object.entries(ans).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0)));
    saveAnswers(id, clean, submit);
    void syncFieldSurveys().catch(() => undefined);
    toast(submit ? t('fsSubmitted') : t('fsSaved'));
    if (submit) router.back();
  };

  return (
    <Screen header={<TopBar title={t('fsQuestions')} sub={c.title} />}>
      <View style={{ gap: 12 }}>
        {c.questions.map((q, i) => (
          <Card key={q.id} style={{ gap: 10 }}>
            <T style={{ fontWeight: '700', fontSize: 15.5 }}>{i + 1}. {q.text}{q.required ? ' *' : ''}</T>
            {q.type === 'text' && <TextInput style={[input, { minHeight: 70, textAlignVertical: 'top' }]} multiline maxLength={2000} value={String(ans[q.id] ?? '')} onChangeText={(v) => set(q.id, v)} placeholder={t('fsAnswerPh')} placeholderTextColor={C.text3} />}
            {q.type === 'number' && <TextInput style={input} keyboardType="numeric" maxLength={12} value={ans[q.id] == null ? '' : String(ans[q.id])} onChangeText={(v) => set(q.id, v.replace(/[^0-9.]/g, '') === '' ? '' : Number(v.replace(/[^0-9.]/g, '')))} placeholder="0" placeholderTextColor={C.text3} />}
            {q.type === 'yesno' && (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Chip big label={t('fsYes')} selected={ans[q.id] === true} onPress={() => set(q.id, true)} />
                <Chip big label={t('fsNo')} selected={ans[q.id] === false} onPress={() => set(q.id, false)} />
              </View>
            )}
            {(q.type === 'choice' || q.type === 'multi') && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {(q.options ?? []).map((o) => {
                  const cur = ans[q.id];
                  const on = q.type === 'multi' ? Array.isArray(cur) && (cur as string[]).includes(o) : cur === o;
                  return <Chip key={o} label={o} selected={on} onPress={() => {
                    if (q.type === 'choice') set(q.id, o);
                    else { const arr = Array.isArray(cur) ? (cur as string[]) : []; set(q.id, on ? arr.filter((x) => x !== o) : [...arr, o]); }
                  }} />;
                })}
              </View>
            )}
          </Card>
        ))}
        <Btn kind="secondary" icon="check" label={t('fsSaveAnswers')} onPress={() => save(false)} />
        {!submitted && (
          <Btn icon="send" label={t('fsSubmit')} onPress={() => {
            if (missing.length) { Alert.alert(t('fsSubmit'), t('fsAnswerRequired')); return; }
            Alert.alert(t('fsSubmit'), t('fsSubmitQ'), [{ text: t('fsCancel'), style: 'cancel' }, { text: t('fsSubmit'), onPress: () => save(true) }]);
          }} />
        )}
        {submitted && <T style={{ color: '#0f8a5f', textAlign: 'center', fontWeight: '600' }}>{t('fsStatusSubmitted')}</T>}
      </View>
    </Screen>
  );
}
