import React, { useMemo, useState } from 'react';
import { BackHandler, Pressable, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Btn, Card, Chip, Empty, Field, Screen, Sheet, T, TopBar, toast } from '../components/ui';
import { Icon } from '../components/Icon';
import { useDb, useSession } from '../lib/session';
import { q, type Question } from '../lib/db';
import { saveSurvey } from '../lib/repo';
import { C } from '../theme';

function options(qn: Question): string[] {
  try {
    const v = JSON.parse(qn.optionsJson ?? '[]');
    return Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : String(x?.label ?? x?.value ?? x))) : [];
  } catch {
    return [];
  }
}
const isOther = (o: string) => /^(other|others|anya|अन्य|অন্য)\b/i.test(o.trim());

export default function Survey() {
  const { t } = useSession();
  const { contactId, isNew } = useLocalSearchParams<{ contactId: string; isNew?: string }>();
  const contact = useDb(() => q.contact(contactId), [contactId]);
  const questions = useDb(() => q.questions());
  const place = useDb(() => (contact?.panchayatId ? q.assignedOne(contact.panchayatId)?.name ?? q.panchayat(contact.panchayatId)?.name ?? '' : ''), [contact?.panchayatId]);
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipWhy, setSkipWhy] = useState<string | null>(null);
  const [skipText, setSkipText] = useState('');

  const done = () => {
    // Added during a visit: go straight back to the panchayat, where the new person is picked.
    const v = q.activeVisit();
    if (isNew === '1' && v && v.panchayatId === contact?.panchayatId && router.canGoBack()) router.back();
    else if (isNew === '1') router.replace({ pathname: '/partner/[id]', params: { id: contactId } });
    else if (router.canGoBack()) router.back();
    else router.replace('/today');
  };

  // Leaving a new partner's survey without answering means choosing a skip reason.
  useFocusEffect(React.useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setSkipOpen(true); return true; });
    return () => sub.remove();
  }, []));

  const qn = questions[i];
  const opts = useMemo(() => (qn ? options(qn) : []), [qn]);
  const sel = qn ? answers[qn.questionId] ?? [] : [];
  const multi = qn?.type === 'multi';
  const free = qn && (qn.type === 'text' || opts.length === 0);
  const answered = qn ? (free ? (other[qn.questionId] ?? '').trim().length > 0 : sel.length > 0 && (!sel.some(isOther) || (other[qn.questionId] ?? '').trim().length > 0)) : false;
  const canNext = !!qn && (answered || !!qn.isOptional);

  const pick = (o: string) => {
    if (!qn) return;
    setAnswers((a) => {
      const cur = a[qn.questionId] ?? [];
      const next = multi ? (cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]) : [o];
      return { ...a, [qn.questionId]: next };
    });
  };

  const finish = () => {
    const out: Record<string, string> = {};
    for (const x of questions) {
      const o = (other[x.questionId] ?? '').trim();
      const picked = (answers[x.questionId] ?? []).map((v) => (isOther(v) && o ? `${v}: ${o}` : v));
      const val = picked.length ? picked.join(', ') : o;
      if (val) out[x.questionId] = val;
    }
    saveSurvey(contactId, contact?.panchayatId ?? null, out);
    toast(t('surveySaved'));
    done();
  };

  const skip = () => {
    if (!skipWhy) return;
    const reason = skipWhy === 'skipOther' ? skipText.trim() : t(skipWhy as never);
    if (!reason) return;
    saveSurvey(contactId, contact?.panchayatId ?? null, {}, `${skipWhy}: ${reason}`);
    setSkipOpen(false);
    toast(t('savedOnPhone'));
    done();
  };

  return (
    <Screen header={<TopBar title={`${t('panchayatSurvey')}${place ? ` · ${place}` : ''}`} sub={contact ? t('asking', { name: contact.name }) : undefined}
      onBack={() => setSkipOpen(true)}
      right={questions.length ? <T style={{ fontWeight: '800', color: C.blue, paddingHorizontal: 8 }}>{t('questionOf', { i: i + 1, n: questions.length })}</T> : undefined} />}
      footer={
        <View style={{ padding: 16, gap: 10, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border }}>
          {questions.length ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn flex kind="secondary" label={t('previous')} onPress={() => setI((n) => Math.max(0, n - 1))} disabled={i === 0} />
              {i < questions.length - 1
                ? <Btn flex label={t('nextQuestion')} onPress={() => setI((n) => n + 1)} disabled={!canNext} />
                : <Btn flex kind="ok" label={t('finish')} onPress={finish} disabled={!canNext} />}
            </View>
          ) : <Btn label={t('done')} onPress={done} />}
          <Pressable onPress={() => setSkipOpen(true)} style={{ alignItems: 'center', padding: 4 }}>
            <T style={{ color: C.text2, fontWeight: '600' }}>{t('skipSurvey')}</T>
          </Pressable>
        </View>
      }>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {questions.map((x, k) => <View key={x.id} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: k <= i ? C.blue : C.line }} />)}
      </View>
      {!qn ? <Empty text={t('noQuestions')} /> : (
        <>
          {qn.section ? <T style={{ color: C.text2, fontSize: 13, fontWeight: '600' }}>{qn.section}</T> : null}
          <T style={{ fontSize: 22, fontWeight: '800', lineHeight: 30 }}>{qn.text}</T>
          {free ? (
            <Field placeholder={t('typeAnswer')} value={other[qn.questionId] ?? ''} multiline
              onChangeText={(v) => setOther((o) => ({ ...o, [qn.questionId]: v }))} />
          ) : (
            <View style={{ gap: 8 }}>
              {opts.map((o) => {
                const on = sel.includes(o);
                return (
                  <Pressable key={o} onPress={() => pick(o)} accessibilityRole={multi ? 'checkbox' : 'radio'} accessibilityState={{ checked: on }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14,
                      borderWidth: on ? 2 : 1, borderColor: on ? C.blue : C.borderStrong, backgroundColor: on ? C.blueSoft : C.card }}>
                    <View style={{ width: 22, height: 22, borderRadius: multi ? 6 : 11, borderWidth: 2, borderColor: on ? C.blue : C.borderStrong, backgroundColor: on ? C.blue : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                      {on ? <Icon name="check" size={14} color="#fff" strokeWidth={3} /> : null}
                    </View>
                    <T style={{ flex: 1, fontSize: 16, color: on ? C.blueInk : C.text, fontWeight: on ? '700' : '500' }}>{o}</T>
                  </Pressable>
                );
              })}
              {sel.some(isOther) ? (
                <Field placeholder={t('otherAnswer')} value={other[qn.questionId] ?? ''} onChangeText={(v) => setOther((x) => ({ ...x, [qn.questionId]: v }))} />
              ) : null}
            </View>
          )}
        </>
      )}

      <Sheet visible={skipOpen} onClose={() => setSkipOpen(false)} title={t('skipReason')}>
        <View style={{ gap: 8 }}>
          {['skipBusy', 'skipRefused', 'skipAlready', 'skipOther'].map((k) => (
            <Chip key={k} big label={t(k as never)} selected={skipWhy === k} onPress={() => setSkipWhy(k)} />
          ))}
        </View>
        {skipWhy === 'skipOther' ? <Field placeholder={t('reason')} value={skipText} onChangeText={setSkipText} /> : null}
        <Card style={{ padding: 0, borderWidth: 0, backgroundColor: 'transparent' }}>
          <Btn label={t('skipSurvey')} kind="danger" onPress={skip} disabled={!skipWhy || (skipWhy === 'skipOther' && !skipText.trim())} />
        </Card>
      </Sheet>
    </Screen>
  );
}
