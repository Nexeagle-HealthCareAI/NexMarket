import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Btn, SpeakButton, T, toast } from './ui';
import { VoiceField } from './MicButton';
import { Icon } from './Icon';
import { useSession } from '../lib/session';
import { addNote, setFollowUp } from '../lib/repo';
import { quickPosition } from '../lib/location';
import { savedFeedback } from '../lib/prefs';
import { dayShort, weekday } from '../lib/format';
import { addDays, parseYmd, ymd } from '../lib/util';
import { C } from '../theme';

export const OUTCOMES = ['ptOutMet', 'ptOutWillSend', 'ptOutNotAvail', 'ptOutCallLater', 'ptOutPosters', 'ptOutNotInterested'] as const;
export type OutcomeKey = typeof OUTCOMES[number];

/** Chips that can't both be true: picking one drops the other (and "will send" / "not interested" mean they were met). */
function toggleOutcome(cur: Set<OutcomeKey>, k: OutcomeKey): Set<OutcomeKey> {
  const n = new Set(cur);
  if (n.has(k)) { n.delete(k); return n; }
  n.add(k);
  if (k === 'ptOutMet') n.delete('ptOutNotAvail');
  if (k === 'ptOutNotAvail') { n.delete('ptOutMet'); n.delete('ptOutWillSend'); n.delete('ptOutNotInterested'); }
  if (k === 'ptOutWillSend') { n.add('ptOutMet'); n.delete('ptOutNotAvail'); n.delete('ptOutNotInterested'); }
  if (k === 'ptOutNotInterested') { n.add('ptOutMet'); n.delete('ptOutNotAvail'); n.delete('ptOutWillSend'); }
  return n;
}

const QUICK = [{ k: 'tomorrow', d: 1 }, { k: 'ptIn3Days', d: 3 }, { k: 'ptNextWeek', d: 7 }] as const;

/**
 * "How did it go?": tap what happened (one or more), when to meet again, an optional spoken note, Save.
 * Saved the way visits always were: one note (the chosen chips in the agent's language, then the comment)
 * with the agent's position, and the partner's follow-up date (cleared when no next meeting is chosen).
 */
export function VisitOutcomeForm({ contactId, name, source, onSaved, defaultDays = 7 }: {
  contactId: string; name: string; source: 'visit' | 'revisit'; onSaved: () => void; defaultDays?: number | null;
}) {
  const { t, lang } = useSession();
  const [picked, setPicked] = useState<Set<OutcomeKey>>(new Set());
  const [next, setNext] = useState<string | null>(defaultDays == null ? null : ymd(addDays(new Date(), defaultDays)));
  const [quick, setQuick] = useState<number | 'pick' | null>(defaultDays);
  const [showDates, setShowDates] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const days = useMemo(() => Array.from({ length: 21 }, (_, i) => addDays(new Date(), i + 1)), []);

  const ready = picked.size > 0 || note.trim().length > 0;
  const chooseQuick = (d: number) => {
    setShowDates(false);
    if (quick === d) { setQuick(null); setNext(null); return; }
    setQuick(d); setNext(ymd(addDays(new Date(), d)));
  };
  const save = async () => {
    if (!ready || saving) return;
    setSaving(true);
    // Where the agent is right now goes with the note (saved even without a fix).
    const pos = await quickPosition();
    const chips = OUTCOMES.filter((k) => picked.has(k)).map((k) => t(k)).join(' · ');
    addNote(contactId, [chips, note.trim()].filter(Boolean).join('\n'), source, pos);
    // A new date replaces the old one; no date keeps the old follow-up, unless they said they're not interested.
    if (next || picked.has('ptOutNotInterested')) setFollowUp(contactId, next);
    setSaving(false);
    savedFeedback();
    toast(pos ? t('revisitSaved') : t('revisitSavedNoGps'));
    onSaved();
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <T style={{ fontSize: 21, fontWeight: '800', lineHeight: 26 }}>{t('ptHowWent', { name })}</T>
          <T style={{ fontSize: 15, color: C.text2 }}>{t('ptTapMore')}</T>
        </View>
        <SpeakButton text={t('ptVisitExplain')} />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {OUTCOMES.map((k) => {
          const on = picked.has(k);
          return (
            <Pressable key={k} onPress={() => setPicked((p) => toggleOutcome(p, k))} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
              style={({ pressed }) => [{ width: '48.5%', minHeight: 56, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 8,
                borderWidth: on ? 2 : 1, borderColor: on ? C.ok : C.borderStrong, backgroundColor: on ? C.okSoft : C.card }, pressed && { opacity: 0.8 }]}>
              {on ? <Icon name="check" size={20} color={C.okInk} strokeWidth={2.4} /> : null}
              <T style={{ flex: 1, fontSize: 16, fontWeight: on ? '700' : '600', color: on ? C.okInk : C.text }}>{t(k)}</T>
            </Pressable>
          );
        })}
      </View>

      <View style={{ gap: 8 }}>
        <T style={{ fontSize: 16, fontWeight: '800' }}>{t('ptMeetAgain')}</T>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {QUICK.map((f) => {
            const on = quick === f.d;
            return (
              <Pressable key={f.k} onPress={() => chooseQuick(f.d)} accessibilityRole="radio" accessibilityState={{ selected: on }}
                style={({ pressed }) => [{ flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
                  backgroundColor: on ? C.blue : C.card, borderWidth: 1, borderColor: on ? C.blue : C.borderStrong }, pressed && { opacity: 0.8 }]}>
                <T style={{ fontSize: 14, fontWeight: on ? '800' : '700', color: on ? '#fff' : C.text, textAlign: 'center' }}>{t(f.k)}</T>
              </Pressable>
            );
          })}
          <Pressable onPress={() => setShowDates((v) => !v)} accessibilityRole="button" accessibilityLabel={t('ptPickDate')} accessibilityState={{ expanded: showDates, selected: quick === 'pick' }}
            style={({ pressed }) => [{ flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
              backgroundColor: quick === 'pick' ? C.blue : C.card, borderWidth: 1, borderColor: quick === 'pick' ? C.blue : C.borderStrong }, pressed && { opacity: 0.8 }]}>
            <Icon name="calendar" size={20} color={quick === 'pick' ? '#fff' : C.text3} />
          </Pressable>
        </View>
        {showDates ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">
            {days.map((d) => {
              const k = ymd(d);
              const on = next === k;
              return (
                <Pressable key={k} onPress={() => { setNext(k); setQuick('pick'); setShowDates(false); }} accessibilityRole="radio" accessibilityState={{ selected: on }}
                  style={{ minWidth: 60, minHeight: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8,
                    backgroundColor: on ? C.blue : C.card, borderWidth: 1, borderColor: on ? C.blue : C.borderStrong }}>
                  <T style={{ fontSize: 12, color: on ? '#fff' : C.text2 }}>{weekday(lang, d)}</T>
                  <T style={{ fontSize: 15, fontWeight: '800', color: on ? '#fff' : C.text }}>{dayShort(lang, d)}</T>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
        <T style={{ fontSize: 14, color: C.text2 }}>{next ? `${weekday(lang, parseYmd(next))}, ${dayShort(lang, next)}` : t('ptNoNextDate')}</T>
      </View>

      <View style={{ gap: 8 }}>
        <T style={{ fontSize: 16, fontWeight: '800' }}>{t('ptNote')} <T style={{ fontWeight: '500', color: C.text2 }}>{t('ptOptional')}</T></T>
        <VoiceField voice="note" placeholder={t('ptNotePh')} value={note} onChangeText={setNote} multiline maxLength={2000} accessibilityLabel={t('ptNote')} />
      </View>

      {saving ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="pin" size={14} color={C.blue} />
          <T style={{ color: C.blueInk, fontSize: 13, fontWeight: '600' }}>{t('gettingLocation')}</T>
        </View>
      ) : null}
      <Btn kind="ok" icon="check" label={ready ? t('ptSaveVisit') : t('ptPickFirst')} onPress={() => void save()} loading={saving} disabled={!ready} />
      <T style={{ color: C.muted, fontSize: 12 }}>{t('revisitLocationNote')}</T>
    </View>
  );
}
