import React, { useState } from 'react';
import { VoiceField } from '../../components/MicButton';
import { Alert, Pressable, Share, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Avatar, Btn, Card, Empty, Pill, Screen, Sheet, T, TopBar, toast } from '../../components/ui';
import { ActionTile } from '../../components/ActionTile';
import { savedFeedback } from '../../lib/prefs';
import { Icon } from '../../components/Icon';
import { useDb, useSession } from '../../lib/session';
import { q } from '../../lib/db';
import { addNote, addPhoto, setFollowUp, setPriority } from '../../lib/repo';
import { takePhoto } from '../../lib/photo';
import { callNumber, navigateTo } from '../../lib/links';
import { api } from '../../lib/api';
import { dayShort, relDay, timeOf, weekday } from '../../lib/format';
import { daysFromToday, parseYmd } from '../../lib/util';
import { C, PRIORITY_COLOR, type Priority } from '../../theme';
import { stageTone } from '../../components/stage';
import { MoveSheet } from '../../components/MoveSheet';
import { WhatsAppSheet } from '../../components/WhatsAppSheet';
import { RevisitSheet } from '../../components/RevisitSheet';
import { NoteList } from '../../components/NoteList';
import { EscalateSheet } from '../../components/EscalateSheet';
import { EscalationStatus } from '../../components/EscalationStatus';

const PRIOS: Priority[] = ['very_high', 'high', 'normal', 'low'];

export default function PartnerProfile() {
  const { t, lang } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [prioOpen, setPrioOpen] = useState(false);
  const [waOpen, setWaOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [revisitOpen, setRevisitOpen] = useState(false);
  const [escOpen, setEscOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [composing, setComposing] = useState(false);
  const [sharing, setSharing] = useState(false);

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
      // Every time the agent met this person: when added, then each visit / revisit.
      visits: [
        ...q.notesFor(id).filter((n) => n.source === 'visit' || n.source === 'revisit'),
        { clientId: 'added', contactId: id, text: '', source: 'added' as const, createdAt: c.createdAt, lat: c.lat, lng: c.lng },
      ],
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
    setComposing(false);
    savedFeedback();
    toast(t('savedOnPhone'));
  };

  const photo = async () => {
    const p = await takePhoto();
    if (p === 'denied') Alert.alert(t('photo'), t('cameraDenied'));
    else if (p) { addPhoto(c.clientId, p); toast(t('savedOnPhone')); }
  };

  const overdue = fu != null && fu < 0;
  const lastVisit = d.visits[0];
  const metN = d.visits.length;
  const lastNote = d.notes[0];

  return (
    <Screen header={<TopBar title={t('ptPartner')} sub={c.name} explain={t('ptPartnerExplain')} />}
      footer={(
        // The two things that finish a meeting stay in reach at the bottom, however far the agent has scrolled.
        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border }}>
          <Btn flex kind="secondary" icon="check" label={t('ptVisitDone')} onPress={() => setRevisitOpen(true)} style={{ borderColor: C.ok, borderWidth: 2 }} />
          <Btn flex kind="ok" icon="hospital" label={t('referPatient')} onPress={() => router.push({ pathname: '/refer', params: { contactId: c.clientId } })} />
        </View>
      )}>
      <Card style={{ borderRadius: 20, padding: 16, gap: 14 }}>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          <Avatar name={c.name} size={60} bg={champion ? C.star : C.blue} />
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <T style={{ fontSize: 21, fontWeight: '800' }}>{c.name}</T>
            <T style={{ color: C.text2, fontSize: 15 }}>{[t(`type_${c.role}` as never), d.place].filter(Boolean).join(' · ')}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
              <Pressable onPress={() => setPrioOpen(true)} accessibilityRole="button" accessibilityLabel={t('ptChangePriority', { p: t(`priority_${c.priority}`) })} hitSlop={8}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: pc.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: pc.dot }} />
                <T style={{ color: pc.fg, fontWeight: '700', fontSize: 13 }}>{t(`priority_${c.priority}`)}</T>
                <Icon name="chevron" size={13} color={pc.fg} />
              </Pressable>
              {champion ? <Pill label={t('champion')} tone="star" icon="star" /> : null}
            </View>
          </View>
        </View>
        {/* One row of quick actions. Meet later, Get help and Photo are under More. */}
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <ActionTile oneLine tone="primary" icon="phone" label={t('call')} disabled={!c.phone} onPress={() => callNumber(c.phone)} />
          <ActionTile oneLine tone="wa" icon="whatsapp" label={t('whatsapp')} disabled={!c.phone} onPress={() => setWaOpen(true)} />
          <ActionTile oneLine icon="nav" label={t('ptRoute')} disabled={c.lat == null || c.lng == null}
            onPress={() => c.lat != null && c.lng != null && navigateTo({ lat: c.lat, lng: c.lng, name: c.name, panchayatId: c.panchayatId, contactId: c.clientId })} />
          <ActionTile oneLine icon="settings" label={t('ptMore')} onPress={() => setMoreOpen(true)} />
        </View>
      </Card>

      <EscalationStatus c={c} />

      <Pressable onPress={() => setMoveOpen(true)} accessibilityRole="button" accessibilityHint={t('ptFuTap')}
        style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1,
          backgroundColor: overdue ? C.warnSoft : fu === 0 ? C.warnSoft : C.card, borderColor: overdue || fu === 0 ? '#f6d9a8' : C.border }, pressed && { opacity: 0.85 }]}>
        <Icon name={overdue ? 'alert' : 'calendar'} size={24} color={overdue || fu === 0 ? C.warnInk : C.blue} />
        <View style={{ flex: 1, gap: 2 }}>
          <T style={{ fontSize: 16, fontWeight: '800', color: overdue || fu === 0 ? C.warnInk : C.text }}>
            {fu == null ? t('ptFuNone') : overdue ? t('ptFuOverdue', { n: -fu }) : fu === 0 ? t('ptFuToday')
              : t('ptFuNext', { date: fu === 1 ? t('tomorrow') : `${weekday(lang, parseYmd(c.followUpDate!))}, ${dayShort(lang, c.followUpDate!)}` })}
          </T>
          <T style={{ fontSize: 14, color: overdue || fu === 0 ? C.warnInk : C.text2 }}>
            {overdue ? t('ptWasDue', { date: `${weekday(lang, parseYmd(c.followUpDate!))}, ${dayShort(lang, c.followUpDate!)}` }) : t('ptFuTap')}
          </T>
        </View>
        <Icon name="chevron" color={overdue || fu === 0 ? C.warnInk : C.text2} />
      </Pressable>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <MiniStat value={String(d.refs.length)} label={t('ptStatSent', { n: d.refs.length })} sub={d.month ? t('ptStatMonth', { n: d.month }) : undefined} color={C.text} />
        <MiniStat value={String(d.admitted)} label={t('ptStatAdmitted')} color={C.okInk} />
        <MiniStat value={metN === 1 ? t('ptOnce') : t('ptTimes', { n: metN })} label={t('ptStatMet', { date: dayShort(lang, new Date(lastVisit.createdAt)) })} color={C.blue} />
      </View>

      <Card style={{ borderRadius: 16, gap: 10 }}>
        <T style={{ fontSize: 16, fontWeight: '800' }}>{t('ptLastNote')}</T>
        {lastNote ? (
          <>
            <T style={{ fontSize: 15, color: C.text3, lineHeight: 22 }} numberOfLines={6}>{lastNote.text}</T>
            <T style={{ fontSize: 13, color: C.text2 }}>{dayShort(lang, new Date(lastNote.createdAt))} · {t(`source_${lastNote.source}` as never)}</T>
          </>
        ) : <T style={{ color: C.text2 }}>{t('ptNoNoteYet')}</T>}
        {composing ? (
          <>
            <VoiceField voice="note" placeholder={t('writeNote')} value={noteText} onChangeText={setNoteText} multiline accessibilityLabel={t('ptSpeakNote')} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn flex small kind="secondary" label={t('cancel')} onPress={() => { setComposing(false); setNoteText(''); }} />
              <Btn flex small kind="ok" icon="check" label={t('ptSaveNote')} onPress={saveNote} disabled={!noteText.trim()} />
            </View>
          </>
        ) : (
          <Pressable onPress={() => setComposing(true)} accessibilityRole="button"
            style={({ pressed }) => [{ alignSelf: 'flex-start', minHeight: 48, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: C.borderStrong,
              backgroundColor: C.card, flexDirection: 'row', alignItems: 'center', gap: 8 }, pressed && { opacity: 0.8 }]}>
            <Icon name="mic" size={20} color={C.blue} />
            <T style={{ color: C.blue, fontWeight: '700', fontSize: 15 }}>{t('ptSpeakNote')}</T>
          </Pressable>
        )}
      </Card>

      <Card style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="whatsapp" color={C.okInk} />
          <T style={{ fontWeight: '800', fontSize: 16, flex: 1 }}>{t('qrTitle')}</T>
        </View>
        <T style={{ color: C.text2, fontSize: 14 }}>{t('qrSub', { name: c.name })}</T>
        <Btn small kind="secondary" icon="send" label={t('qrShare')} disabled={sharing} onPress={() => {
          setSharing(true);
          api<{ waLink: string | null }>(`/api/v1/partners/${encodeURIComponent(c.clientId)}/referral-link`, { timeoutMs: 15000 })
            .then(async (r) => {
              if (!r.waLink) { toast(t('qrNotReady')); return; }
              await Share.share({ message: t('qrShareText', { link: r.waLink }) });
            })
            .catch(() => toast(t('qrNeedsNet')))
            .finally(() => setSharing(false));
        }} />
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.okSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" color={C.okInk} />
          </View>
          <View style={{ flex: 1 }}>
            <T style={{ fontWeight: '800', fontSize: 16 }}>{t('metTimes', { n: d.visits.length })}</T>
            <T style={{ color: C.text2, fontSize: 13 }}>{t('lastMet', { when: `${relDay(t, lang, d.visits[0].createdAt)} ${timeOf(lang, d.visits[0].createdAt)}` })}</T>
          </View>
        </View>
        {d.visits.map((v, i) => (
          <View key={v.clientId} style={{ flexDirection: 'row', gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.line }}>
            <View style={{ width: 22, alignItems: 'center' }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: v.source === 'added' ? C.purpleSoft : C.okSoft }}>
                <T style={{ fontSize: 11, fontWeight: '800', color: v.source === 'added' ? C.purple : C.okInk }}>{d.visits.length - i}</T>
              </View>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <T style={{ fontWeight: '700' }}>{v.source === 'added' ? t('firstMetAdded') : t(`source_${v.source}` as never)} · <T style={{ fontWeight: '500', color: C.text2 }}>{dayShort(lang, new Date(v.createdAt))} {timeOf(lang, v.createdAt)}</T></T>
              {v.text ? <T style={{ color: C.text3, fontSize: 14 }} numberOfLines={4}>{v.text}</T> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icon name="pin" size={12} color={v.lat != null ? C.okInk : C.muted} />
                <T style={{ fontSize: 12, color: v.lat != null ? C.okInk : C.muted }}>{v.lat != null ? t('locationSaved') : t('noLocationSaved')}</T>
              </View>
            </View>
          </View>
        ))}
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
      {d.notes.length ? <Card><NoteList notes={d.notes} bare /></Card> : null}

      <Sheet visible={prioOpen} onClose={() => setPrioOpen(false)} title={t('changePriority')}>
        {PRIOS.map((p) => (
          <Pressable key={p} onPress={() => { setPriority(c.clientId, p); setPrioOpen(false); savedFeedback(); toast(t('savedOnPhone')); }} accessibilityRole="radio" accessibilityState={{ selected: c.priority === p }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 14, borderRadius: 12,
              backgroundColor: c.priority === p ? PRIORITY_COLOR[p].bg : C.card, borderWidth: 1, borderColor: c.priority === p ? PRIORITY_COLOR[p].dot : C.border }}>
            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: PRIORITY_COLOR[p].dot }} />
            <T style={{ flex: 1, fontWeight: '700', color: PRIORITY_COLOR[p].fg }}>{t(`priority_${p}`)}</T>
            {c.priority === p ? <Icon name="check" color={PRIORITY_COLOR[p].fg} /> : null}
          </Pressable>
        ))}
      </Sheet>
      <MoveSheet visible={moveOpen} onClose={() => setMoveOpen(false)} onPick={(date) => {
        const before = c.followUpDate;
        setFollowUp(c.clientId, date); setMoveOpen(false); savedFeedback();
        toast(t('ptMovedTo', { date: dayShort(lang, date) }), { undo: () => setFollowUp(c.clientId, before) });
      }} />
      <Sheet visible={moreOpen} onClose={() => setMoreOpen(false)} title={c.name}>
        <Btn kind="secondary" icon="calendar" label={t('ptMeetLater')} onPress={() => { setMoreOpen(false); setMoveOpen(true); }} />
        <Btn kind="secondary" icon="camera" label={t('photo')} onPress={() => { setMoreOpen(false); void photo(); }} />
        <Btn kind="danger" icon="flag" label={t('ptGetHelp')} onPress={() => { setMoreOpen(false); setEscOpen(true); }} />
      </Sheet>
      <EscalateSheet visible={escOpen} onClose={() => setEscOpen(false)} contactId={c.clientId} name={c.name} />
      <RevisitSheet visible={revisitOpen} onClose={() => setRevisitOpen(false)} contactId={c.clientId} name={c.name} />
      <WhatsAppSheet visible={waOpen} onClose={() => setWaOpen(false)} name={c.name} phone={c.phone} />
    </Screen>
  );
}

function MiniStat({ value, label, sub, color }: { value: string; label: string; sub?: string; color: string }) {
  return (
    <View accessible style={{ flex: 1, minWidth: 0, backgroundColor: C.card, borderRadius: 14, padding: 12, gap: 2, borderWidth: 1, borderColor: C.border }}>
      <T style={{ fontSize: 22, fontWeight: '800', color }}>{value}</T>
      <T style={{ fontSize: 14, color: C.text2 }}>{label}</T>
      {sub ? <T style={{ fontSize: 12, color: C.muted }}>{sub}</T> : null}
    </View>
  );
}
