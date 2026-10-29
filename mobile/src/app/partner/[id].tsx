import React, { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Avatar, Btn, Card, Empty, Field, Pill, Screen, Sheet, T, TopBar, toast } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useDb, useSession } from '../../lib/session';
import { q } from '../../lib/db';
import { addNote, addPhoto, setFollowUp, setPriority } from '../../lib/repo';
import { takePhoto } from '../../lib/photo';
import { callNumber } from '../../lib/links';
import { dayShort } from '../../lib/format';
import { daysFromToday } from '../../lib/util';
import { C, PRIORITY_COLOR, type Priority } from '../../theme';
import { stageTone } from '../../components/stage';
import { MoveSheet } from '../../components/MoveSheet';
import { WhatsAppSheet } from '../../components/WhatsAppSheet';
import { RevisitSheet } from '../../components/RevisitSheet';

const PRIOS: Priority[] = ['very_high', 'high', 'normal', 'low'];

export default function PartnerProfile() {
  const { t, lang } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [prioOpen, setPrioOpen] = useState(false);
  const [waOpen, setWaOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [revisitOpen, setRevisitOpen] = useState(false);
  const [noteText, setNoteText] = useState('');

  const d = useDb(() => {
    const c = q.contact(id);
    if (!c) return null;
    const refs = q.referralsFor(id);
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    return {
      c,
      place: c.panchayatId ? (q.assignedOne(c.panchayatId)?.name ?? q.panchayat(c.panchayatId)?.name ?? null) : null,
      refs,
      admitted: refs.filter((r) => ['admitted', 'procedure', 'discharged'].includes(r.status)).length,
      month: refs.filter((r) => r.createdAt >= monthStart.toISOString()).length,
      notes: q.notesFor(id),
      surveyed: q.hasSurvey(id),
    };
  }, [id]);

  if (!d) {
    return <Screen header={<TopBar title={t('partnerNotFound')} />}><Empty text={t('partnerNotFound')} /></Screen>;
  }
  const { c } = d;
  const pc = PRIORITY_COLOR[c.priority] ?? PRIORITY_COLOR.normal;
  const champion = d.refs.length >= 5 || c.priority === 'very_high';
  const fu = c.followUpDate ? daysFromToday(c.followUpDate) : null;

  const saveNote = () => {
    if (!noteText.trim()) return;
    addNote(c.clientId, noteText, 'note');
    setNoteText('');
    toast(t('savedOnPhone'));
  };

  const photo = async () => {
    const p = await takePhoto();
    if (p === 'denied') Alert.alert(t('photo'), t('cameraDenied'));
    else if (p) { addPhoto(c.clientId, p); toast(t('savedOnPhone')); }
  };

  return (
    <Screen header={<TopBar title={c.name} right={
      <Pressable onPress={photo} hitSlop={8} accessibilityLabel={t('photo')} style={{ padding: 8 }}><Icon name="camera" color={C.text} /></Pressable>
    } />}>
      <Card>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <Avatar name={c.name} size={56} bg={champion ? C.star : C.blue} />
          <View style={{ flex: 1, gap: 4 }}>
            {champion ? <Pill label={t('champion')} tone="star" icon="star" /> : null}
            <T style={{ fontSize: 20, fontWeight: '800' }}>{c.name}</T>
            <T style={{ color: C.text2, fontSize: 13 }}>{[t(`type_${c.role}` as never), d.place].filter(Boolean).join(' · ')}</T>
          </View>
        </View>
        <Pressable onPress={() => setPrioOpen(true)} accessibilityRole="button" accessibilityLabel={t('changePriority')}
          style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: pc.bg, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: pc.dot }} />
          <T style={{ color: pc.fg, fontWeight: '700' }}>{t(`priority_${c.priority}`)}</T>
          <Icon name="chevron" size={14} color={pc.fg} />
        </Pressable>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Btn flex small kind="secondary" icon="phone" label={t('call')} disabled={!c.phone} onPress={() => { callNumber(c.phone); }} />
          <Btn flex small kind="secondary" icon="whatsapp" label={t('whatsapp')} disabled={!c.phone} onPress={() => setWaOpen(true)} />
          <Btn flex small icon="hospital" label={t('referPatient')} onPress={() => router.push({ pathname: '/refer', params: { contactId: c.clientId } })} />
        </View>
        <Btn kind="ok" icon="check" label={t('revisitPerson')} onPress={() => setRevisitOpen(true)} />
      </Card>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <MiniStat n={d.refs.length} label={t('patientsSent')} color={C.text} />
        <MiniStat n={d.admitted} label={t('admittedLabel')} color={C.okInk} />
        <MiniStat n={d.month} label={t('thisMonth')} color={C.blue} />
      </View>

      <Card style={fu != null && fu < 0 ? { backgroundColor: C.warnSoft, borderColor: '#f5d9a8' } : undefined}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon name="calendar" color={fu != null && fu < 0 ? C.warnInk : C.blue} />
          <View style={{ flex: 1 }}>
            <T style={{ fontWeight: '700', color: fu != null && fu < 0 ? C.warnInk : C.text }}>
              {fu == null ? t('noFollowUps') : fu < 0 ? t('followUpOverdue', { n: -fu }) : t('followUpOn', { date: fu === 0 ? t('today') : dayShort(lang, c.followUpDate!) })}
            </T>
            {d.notes[0] ? <T style={{ color: C.text2, fontSize: 13 }}>{dayShort(lang, new Date(d.notes[0].createdAt))} · {t(`source_${d.notes[0].source}` as never)}</T> : null}
          </View>
          <Btn small kind="ghost" label={t('moveFollowUp')} onPress={() => setMoveOpen(true)} />
        </View>
      </Card>

      {!d.surveyed ? (
        <Card onPress={() => router.push({ pathname: '/survey', params: { contactId: c.clientId } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.purpleSoft, borderColor: C.purpleSoft }}>
          <Icon name="note" color={C.purple} />
          <T style={{ flex: 1, color: C.purple, fontWeight: '700' }}>{t('doSurvey')}</T>
          <Icon name="chevron" color={C.purple} />
        </Card>
      ) : null}

      <T style={{ fontSize: 17, fontWeight: '700', marginTop: 4 }}>{t('recentPatients')}</T>
      {d.refs.length === 0 ? <T style={{ color: C.text2 }}>{t('noPatientsYet')}</T> : null}
      {d.refs.slice(0, 5).map((r) => (
        <Card key={r.clientId} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <T style={{ fontWeight: '700' }}>{r.patientName || '—'}</T>
            <T style={{ color: C.text2, fontSize: 13 }}>{[r.department, dayShort(lang, new Date(r.createdAt))].filter(Boolean).join(' · ')}</T>
          </View>
          <Pill label={t(`stage_${r.status}` as never)} tone={stageTone(r.status)} />
        </Card>
      ))}

      <T style={{ fontSize: 17, fontWeight: '700', marginTop: 4 }}>{t('notes')} · {d.notes.length}</T>
      <Field placeholder={t('writeNote')} value={noteText} onChangeText={setNoteText} multiline />
      <Btn kind="ghost" icon="note" label={t('addNote')} onPress={saveNote} disabled={!noteText.trim()} />
      {d.notes.length === 0 ? <T style={{ color: C.text2 }}>{t('noNotes')}</T> : null}
      {d.notes.map((n) => (
        <Card key={n.clientId} style={{ gap: 4 }}>
          <T style={{ color: C.text2, fontSize: 12 }}>{dayShort(lang, new Date(n.createdAt))} · {t(`source_${n.source}` as never)}</T>
          <T>{n.text}</T>
        </Card>
      ))}

      <Sheet visible={prioOpen} onClose={() => setPrioOpen(false)} title={t('changePriority')}>
        {PRIOS.map((p) => (
          <Pressable key={p} onPress={() => { setPriority(c.clientId, p); setPrioOpen(false); toast(t('savedOnPhone')); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, height: 52, paddingHorizontal: 14, borderRadius: 12,
              backgroundColor: c.priority === p ? PRIORITY_COLOR[p].bg : C.card, borderWidth: 1, borderColor: c.priority === p ? PRIORITY_COLOR[p].dot : C.border }}>
            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: PRIORITY_COLOR[p].dot }} />
            <T style={{ flex: 1, fontWeight: '700', color: PRIORITY_COLOR[p].fg }}>{t(`priority_${p}`)}</T>
            {c.priority === p ? <Icon name="check" color={PRIORITY_COLOR[p].fg} /> : null}
          </Pressable>
        ))}
      </Sheet>
      <MoveSheet visible={moveOpen} onClose={() => setMoveOpen(false)} onPick={(date) => { setFollowUp(c.clientId, date); setMoveOpen(false); toast(t('savedOnPhone')); }} />
      <RevisitSheet visible={revisitOpen} onClose={() => setRevisitOpen(false)} contactId={c.clientId} name={c.name} />
      <WhatsAppSheet visible={waOpen} onClose={() => setWaOpen(false)} name={c.name} phone={c.phone} />
    </Screen>
  );
}

function MiniStat({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: C.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: C.border }}>
      <T style={{ fontSize: 24, fontWeight: '800', color }}>{n}</T>
      <T style={{ fontSize: 12, color: C.text2 }}>{label}</T>
    </View>
  );
}
