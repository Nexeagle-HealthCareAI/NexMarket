import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Btn, Chip, Field, Sheet, T, toast } from './ui';
import { NoteList } from './NoteList';
import { EscalateSheet } from './EscalateSheet';
import { Icon } from './Icon';
import { useDb, useSession } from '../lib/session';
import { q, type Note } from '../lib/db';
import { addNote, setFollowUp } from '../lib/repo';
import { quickPosition } from '../lib/location';
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
  const history = useDb(() => (visible ? q.notesFor(contactId) : ([] as Note[])), [visible, contactId]);
  const [saving, setSaving] = useState(false);
  const [escOpen, setEscOpen] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setMet(null); setInterest(null); setComment('');
  }, [visible, contactId]);

  const ready = !!met && (met === 'notMet' || !!interest || comment.trim().length > 0);
  const save = async (days: number | null) => {
    if (!met || saving) return;
    setSaving(true);
    // Where the agent is right now goes with the comment (saved even without a fix).
    const pos = await quickPosition();
    const text = [t('visitNoteText', { met: t(met), interest: interest ? t(interest) : '–' }), comment.trim()].filter(Boolean).join('\n');
    addNote(contactId, text, 'revisit', pos);
    if (days != null) setFollowUp(contactId, ymd(addDays(new Date(), days)));
    setSaving(false);
    toast(pos ? t('revisitSaved') : t('revisitSavedNoGps'));
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('revisitTitle', { name })}>
      <View style={{ gap: 12 }}>
        <NoteList notes={history} limit={3} title={t('earlierComments')} />

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
            {saving ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon name="pin" size={14} color={C.blue} />
                <T style={{ color: C.blueInk, fontSize: 13, fontWeight: '600' }}>{t('gettingLocation')}</T>
              </View>
            ) : null}
            <T style={{ color: C.text2 }}>{t('nextFollowUp')}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip big label={t('tomorrow')} onPress={() => void save(1)} />
              <Chip big label={t('in3Days')} onPress={() => void save(3)} />
              <Chip big label={t('in1Week')} onPress={() => void save(7)} />
              <Chip big label={t('noFollowUpNeeded')} onPress={() => void save(null)} />
            </View>
          </>
        ) : <T style={{ color: C.muted, fontSize: 13 }}>{t('revisitPickFirst')}</T>}
        <T style={{ color: C.muted, fontSize: 12 }}>{t('revisitLocationNote')}</T>
        <Btn kind="danger" icon="flag" label={t('escalateIssue')} onPress={() => setEscOpen(true)} />
      </View>
      <EscalateSheet visible={escOpen} onClose={() => setEscOpen(false)} contactId={contactId} name={name} />
    </Sheet>
  );
}
