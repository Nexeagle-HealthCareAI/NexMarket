import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Btn, Field, Sheet, T, toast } from './ui';
import { Icon } from './Icon';
import { useSession } from '../lib/session';
import type { Note } from '../lib/db';
import { canEditNote, editNote } from '../lib/repo';
import { relDay, timeOf } from '../lib/format';
import { C } from '../theme';

/**
 * A partner's comments, newest first. The agent can change their own (visit, revisit or note):
 * a typo, or something they forgot. The office keeps the first wording as well.
 */
export function NoteList({ notes, limit, title, bare }: { notes: Note[]; limit?: number; title?: string; bare?: boolean }) {
  const { t, lang } = useSession();
  const [editing, setEditing] = useState<Note | null>(null);
  const [text, setText] = useState('');
  const shown = limit ? notes.slice(0, limit) : notes;

  const open = (n: Note) => { setEditing(n); setText(n.text); };
  const save = () => {
    if (!editing) return;
    editNote(editing.clientId, text);
    setEditing(null);
    toast(t('commentUpdated'));
  };

  return (
    <View style={bare ? { gap: 10 } : { gap: 10, backgroundColor: C.bg, borderRadius: 14, padding: 12 }}>
      {title ? <T style={{ fontWeight: '700', color: C.text2, fontSize: 13 }}>{title}</T> : null}
      {shown.length === 0 ? <T style={{ color: C.text2 }}>{t('noNotes')}</T> : shown.map((n) => {
        const mine = canEditNote(n);
        return (
          <View key={n.clientId} style={{ gap: 3, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.line }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: n.source === 'revisit' ? C.ok : n.source === 'visit' ? C.blue : n.text.startsWith('⚑') ? C.bad : C.muted }} />
              <T style={{ flex: 1, color: C.text2, fontSize: 12 }}>
                {relDay(t, lang, n.createdAt)} {timeOf(lang, n.createdAt)} · {t(`source_${n.source}` as never)}{n.editedAt ? ` · ${t('editedLabel')}` : ''}
              </T>
              {mine ? (
                <Pressable onPress={() => open(n)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('editComment')}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: C.blueSoft }}>
                  <Icon name="note" size={13} color={C.blueInk} />
                  <T style={{ color: C.blueInk, fontSize: 12, fontWeight: '700' }}>{t('editShort')}</T>
                </Pressable>
              ) : null}
            </View>
            <T style={{ lineHeight: 21 }}>{n.text}</T>
          </View>
        );
      })}
      {limit && notes.length > limit ? <T style={{ color: C.text2, fontSize: 12 }}>{t('moreComments', { n: notes.length - limit })}</T> : null}

      <Sheet visible={!!editing} onClose={() => setEditing(null)} title={t('editComment')}>
        {editing ? <T style={{ color: C.text2, fontSize: 13 }}>{relDay(t, lang, editing.createdAt)} {timeOf(lang, editing.createdAt)} · {t(`source_${editing.source}` as never)}</T> : null}
        <Field value={text} onChangeText={setText} multiline autoFocus maxLength={2000} />
        <T style={{ color: C.text2, fontSize: 12 }}>{t('editKeepsOriginal')}</T>
        <Btn label={t('saveChanges')} icon="check" onPress={save} disabled={!text.trim() || text.trim() === editing?.text} />
      </Sheet>
    </View>
  );
}
