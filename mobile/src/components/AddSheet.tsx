import React, { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Btn, Sheet, SpeakButton, T, setAddHandler, toast } from './ui';
import { Icon, type IconName } from './Icon';
import { PartnerPicker } from './PartnerPicker';
import { VoiceField } from './MicButton';
import { useDb, useSession } from '../lib/session';
import { q, type Contact } from '../lib/db';
import { addNote } from '../lib/repo';
import { savedFeedback } from '../lib/prefs';
import { C } from '../theme';

/** Opening one sheet right after another closes: give the first one time to slide away. */
const NEXT_SHEET_MS = 320;

interface Tile { key: string; icon: IconName; title: string; sub: string; bg: string; fg: string; onPress: () => void }

/**
 * The centre "+ Add" sheet: four big choices (check in, add partner, refer patient, speak a note).
 * Mounted once by the tabs layout through <AddSheetHost />; open it from anywhere with openAddSheet() from ui.tsx.
 */
export function AddSheetHost() {
  const { t } = useSession();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [noteFor, setNoteFor] = useState<Contact | null>(null);
  const [text, setText] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const visit = useDb(() => q.activeVisit());
  const place = useDb(() => (visit ? q.assignedOne(visit.panchayatId)?.name ?? q.panchayat(visit.panchayatId)?.name ?? '' : ''), [visit?.panchayatId]);

  useEffect(() => {
    setAddHandler(() => setOpen(true));
    return () => { setAddHandler(null); if (timer.current) clearTimeout(timer.current); };
  }, []);

  const later = (fn: () => void) => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(fn, NEXT_SHEET_MS); };
  const go = (fn: () => void) => { setOpen(false); fn(); };

  // Same routes as the full /add screen; each screen keeps its own checks (shift started, checked in…).
  const tiles: Tile[] = [
    { key: 'checkin', icon: 'pin', title: t('uxAddCheckIn'), sub: visit && place ? t('nowIn', { name: place }) : t('uxAddCheckInSub'), bg: C.okSoft, fg: C.okInk,
      onPress: () => go(() => router.push('/checkin')) },
    { key: 'partner', icon: 'userPlus', title: t('uxAddPartner'), sub: t('uxAddPartnerSub'), bg: C.blueSoft, fg: C.blueInk,
      onPress: () => go(() => router.push({ pathname: '/partner-new', params: visit ? { panchayatId: visit.panchayatId } : {} })) },
    { key: 'refer', icon: 'hospital', title: t('uxAddRefer'), sub: t('uxAddReferSub'), bg: C.warnSoft, fg: C.warnInk,
      onPress: () => go(() => router.push('/refer')) },
    // A note always belongs to a partner: choose one first, then speak.
    { key: 'note', icon: 'mic', title: t('uxAddNote'), sub: t('uxAddNoteSub'), bg: C.purpleSoft, fg: C.purple,
      onPress: () => go(() => later(() => setPicking(true))) },
  ];

  const save = () => {
    if (!noteFor || !text.trim()) return;
    addNote(noteFor.clientId, text, 'note');
    savedFeedback();
    toast(t('savedOnPhone'));
    setNoteFor(null);
    setText('');
  };

  return (
    <>
      <Sheet visible={open} onClose={() => setOpen(false)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <T style={{ flex: 1, fontSize: 22, fontWeight: '800' }}>{t('uxAddTitle')}</T>
          <SpeakButton text={`${t('uxAddTitle')} ${t('uxAddExplain')}`} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {tiles.map((it) => (
            <Pressable key={it.key} onPress={it.onPress} accessibilityRole="button" accessibilityLabel={`${it.title}. ${it.sub}`}
              style={({ pressed }) => ({ width: '48.5%', minHeight: 132, borderRadius: 20, padding: 16, gap: 10,
                justifyContent: 'space-between', backgroundColor: it.bg, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
              <Icon name={it.icon} size={34} color={it.fg} />
              <View style={{ gap: 2 }}>
                <T style={{ fontSize: 18, fontWeight: '800', color: it.fg }}>{it.title}</T>
                <T style={{ fontSize: 14, color: it.fg }} numberOfLines={2}>{it.sub}</T>
              </View>
            </Pressable>
          ))}
        </View>
        {/* Everything else the old "+" offered (revisit, photo, route, problem…) stays one tap away. */}
        <Pressable accessibilityRole="button" onPress={() => go(() => router.push('/add'))} style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
          <T style={{ color: C.blueInk, fontWeight: '700' }}>{t('uxMoreChoices')}</T>
        </Pressable>
        <Btn kind="secondary" label={t('close')} onPress={() => setOpen(false)} />
      </Sheet>

      <PartnerPicker visible={picking} onClose={() => setPicking(false)} panchayatFirst={visit?.panchayatId}
        onPick={(c) => later(() => { setText(''); setNoteFor(c); })} />

      <Sheet visible={!!noteFor} onClose={() => setNoteFor(null)} title={noteFor ? t('uxNoteFor', { name: noteFor.name }) : undefined}>
        <VoiceField voice="note" placeholder={t('uxNotePh')} value={text} onChangeText={setText} multiline autoFocus={false} />
        <Btn kind="ok" icon="check" label={t('uxSaveNote')} onPress={save} disabled={!text.trim()} />
        <Btn kind="secondary" label={t('cancel')} onPress={() => setNoteFor(null)} />
      </Sheet>
    </>
  );
}
