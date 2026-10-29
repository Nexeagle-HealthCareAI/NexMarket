import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Chip, Field, Sheet, T, toast } from './ui';
import { useSession } from '../lib/session';
import { q, type Note } from '../lib/db';
import { addNote, setFollowUp } from '../lib/repo';
import { relDay } from '../lib/format';
import { addDays, ymd } from '../lib/util';
import { C } from '../theme';

type Met = 'met' | 'notMet';
type Interest = 'interestHigh' | 'interestSome' | 'interestNone';

/**
 * Revisiting someone already added: see what was said before, then record this visit
 * (met or not, interest, a comment) and when to go back. Saved on the phone first.
 */
export function RevisitSheet({ visible, onClose, contactId, name }: { visible: boolean; onClose: () => void; contactId: string; name: string }) {
  const { t, lang } = useSession();
  const [met, setMet] = useState<Met | null>(null);
  const [interest, setInterest] = useState<Interest | null>(null);
  const [comment, setComment] = useState('');
  const [history, setHistory] = useState<Note[]>([]);

  useEffect(() => {
    if (!visible) return;
    setMet(null); setInterest(null); setComment('');
    setHistory(q.notesFor(contactId).slice(0, 3));
  }, [visible, contactId]);

  const ready = !!met && (met === 'notMet' || !!interest || comment.trim().length > 0);
  const save = (days: number | null) => {
    if (!met) return;
    const text = [t('visitNoteText', { met: t(met), interest: interest ? t(interest) : '–' }), comment.trim()].filter(Boolean).join('\n');
    addNote(contactId, text, 'revisit');
    if (days != null) setFollowUp(contactId, ymd(addDays(new Date(), days)));
    toast(t('revisitSaved'));
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('revisitTitle', { name })}>
      <View style={{ gap: 12 }}>
        {history.length ? (
          <View style={{ gap: 8, backgroundColor: C.bg, borderRadius: 14, padding: 12 }}>
            <T style={{ fontWeight: '700', color: C.text2, fontSize: 13 }}>{t('earlierComments')}</T>
            {history.map((n) => (
              <View key={n.clientId} style={{ gap: 2 }}>
                <T style={{ color: C.text2, fontSize: 12 }}>{relDay(t, lang, n.createdAt)} · {t(`source_${n.source}` as never)}</T>
                <T numberOfLines={3}>{n.text}</T>
              </View>
            ))}
          </View>
        ) : <T style={{ color: C.text2 }}>{t('noNotes')}</T>}

        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['met', 'notMet'] as Met[]).map((m) => (
            <View key={m} style={{ flex: 1 }}>
              <Chip big label={t(m)} selected={met === m} color={m === 'met' ? C.ok : C.warn} onPress={() => { setMet(m); if (m === 'notMet') setInterest(null); }} />
            </View>
          ))}
        </View>
        {met === 'met' ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['interestHigh', 'interestSome', 'interestNone'] as Interest[]).map((i) => (
              <View key={i} style={{ flex: 1 }}><Chip big label={t(i)} selected={interest === i} onPress={() => setInterest(i)} /></View>
            ))}
          </View>
        ) : null}
        <Field placeholder={t('revisitComment')} value={comment} onChangeText={setComment} multiline />
        {ready ? (
          <>
            <T style={{ color: C.text2 }}>{t('nextFollowUp')}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip big label={t('tomorrow')} onPress={() => save(1)} />
              <Chip big label={t('in3Days')} onPress={() => save(3)} />
              <Chip big label={t('in1Week')} onPress={() => save(7)} />
              <Chip big label={t('noFollowUpNeeded')} onPress={() => save(null)} />
            </View>
          </>
        ) : <T style={{ color: C.muted, fontSize: 13 }}>{t('revisitPickFirst')}</T>}
      </View>
    </Sheet>
  );
}
