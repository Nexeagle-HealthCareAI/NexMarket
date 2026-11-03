import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Btn, Card, Chip, Empty, Field, Pill, Screen, T, TopBar, toast } from '../components/ui';
import { Icon } from '../components/Icon';
import { useDb, useSession } from '../lib/session';
import { lastVisited, q, timesVisited } from '../lib/db';
import { PanchayatList, sortPanchayats } from '../components/PanchayatList';
import { tryCheckIn } from '../lib/visit';
import { relDay } from '../lib/format';
import { addNote, addPhoto, checkOut, setFollowUp } from '../lib/repo';
import { currentPosition, quickPosition } from '../lib/location';
import { takePhoto } from '../lib/photo';
import { useHere } from '../lib/useHere';
import { CHECK_IN_RADIUS_M } from '../lib/config';
import { formatDist } from '../lib/plan';
import { timeOf } from '../lib/format';
import { addDays, haversineM, ymd } from '../lib/util';
import { C } from '../theme';

type Met = 'met' | 'notMet';
type Interest = 'interestHigh' | 'interestSome' | 'interestNone';

export default function CheckIn() {
  const { t, lang } = useSession();
  const params = useLocalSearchParams<{ panchayatId?: string; contactId?: string }>();
  const [panchayatId, setPanchayatId] = useState(params.panchayatId || '');
  const here = useHere(true);
  const [busy, setBusy] = useState(false);

  const info = useDb(() => {
    const a = panchayatId ? q.assignedOne(panchayatId) : null;
    const p = panchayatId ? q.panchayat(panchayatId) : null;
    return {
      name: a?.name ?? p?.name ?? '',
      lat: a?.lat ?? p?.lat ?? null,
      lng: a?.lng ?? p?.lng ?? null,
      approx: (a?.source ?? 'block') === 'block' && a != null,
      times: a ? timesVisited(a) : 0,
      last: a ? lastVisited(a) : null,
      shift: q.activeShift(),
      visit: q.activeVisit(),
      partners: panchayatId ? q.contactsIn(panchayatId) : [],
      assigned: q.assigned(),
    };
  }, [panchayatId]);

  // No panchayat chosen yet: pick one (nearest first).
  if (!panchayatId) {
    const list = sortPanchayats(info.assigned, here);
    const done = list.filter((p) => timesVisited(p) > 0).length;
    return (
      <Screen header={<TopBar title={t('choosePanchayat')} sub={list.length ? t('blockProgress', { done, total: list.length }) : undefined} />}>
        {list.length === 0 ? <Empty text={t('noBlock')} icon="map" /> : <T style={{ color: C.text2, fontSize: 13 }}>{t('revisitHint')}</T>}
        <PanchayatList list={list} here={here} current={info.visit?.panchayatId ?? null} onPick={setPanchayatId} />
      </Screen>
    );
  }

  const inThis = info.visit && info.visit.panchayatId === panchayatId ? info.visit : null;
  if (inThis) return <InVisit visit={inThis} name={info.name} partners={info.partners} initialContact={params.contactId || null} />;

  const dist = here && info.lat != null && info.lng != null ? haversineM(here, { lat: info.lat, lng: info.lng }) : null;
  const canCheckIn = !!info.shift && (info.approx || info.lat == null || (dist != null && dist <= CHECK_IN_RADIUS_M));

  const doCheckIn = async () => {
    setBusy(true);
    try {
      // Leaves the panchayat they were in (if any) and checks in here, first visit or revisit.
      const r = await tryCheckIn(panchayatId);
      if (!r.ok && r.why === 'no-fix') Alert.alert(t('locationOff'), t('turnOnLocation'));
      else if (!r.ok && r.why === 'far') confirmFar(r.distM);
      else toast(t('savedOnPhone'));
    } finally {
      setBusy(false);
    }
  };

  // Too far from the panchayat centre (or its pin is wrong): the agent can still check in; the
  // location saved with it shows the office where they really were.
  const confirmFar = (distM: number) => Alert.alert(t('checkIn'), t('farCheckInConfirm', { name: info.name, dist: formatDist(distM, t) }), [
    { text: t('close'), style: 'cancel' },
    { text: t('checkInAnyway'), onPress: () => void anyway() },
  ]);
  const anyway = async () => {
    setBusy(true);
    try {
      const r = await tryCheckIn(panchayatId, { anyDistance: true });
      if (!r.ok) Alert.alert(t('locationOff'), t('turnOnLocation'));
      else toast(t('savedOnPhone'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen header={<TopBar title={info.name || t('checkIn')} sub={t('checkIn')} />}>
      <Card style={{ alignItems: 'center', gap: 12, paddingVertical: 24 }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: C.blueSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="pin" size={30} color={C.blue} />
        </View>
        <T style={{ fontSize: 22, fontWeight: '800', textAlign: 'center' }}>{info.name}</T>
        {dist != null ? <T style={{ color: C.text2 }}>{formatDist(dist, t)}</T> : null}
        {info.times ? <Pill label={t('visitedTimes', { n: info.times, when: info.last ? relDay(t, lang, info.last) : '—' })} tone="ok" icon="check" /> : <Pill label={t('notVisitedYet')} tone="blue" />}
        {info.approx ? <T style={{ color: C.text2, textAlign: 'center', fontSize: 13 }}>{t('approxPin')}</T> : null}
        {!info.shift ? (
          <>
            <T style={{ color: C.warnInk, textAlign: 'center' }}>{t('startShiftToCheckIn')}</T>
            <Btn label={t('startShift')} kind="ok" icon="nav" onPress={() => router.push('/shift')} style={{ alignSelf: 'stretch' }} />
          </>
        ) : !canCheckIn && dist != null ? (
          <T style={{ color: C.warnInk, textAlign: 'center' }}>{t('tooFar', { name: info.name, dist: formatDist(dist, t) })}</T>
        ) : null}
        {info.shift ? <Btn label={info.times ? t('revisitCheckIn') : t('checkIn')} icon="pin" onPress={doCheckIn} loading={busy} style={{ alignSelf: 'stretch' }} /> : null}
        {info.shift && !canCheckIn && dist != null ? <Btn kind="ghost" label={t('checkInAnyway')} onPress={() => confirmFar(dist)} style={{ alignSelf: 'stretch' }} /> : null}
        {info.visit && info.visit.panchayatId !== panchayatId ? <T style={{ color: C.text2, textAlign: 'center', fontSize: 13 }}>{t('willLeaveCurrent')}</T> : null}
      </Card>
      {info.partners.length ? (
        <>
          <T style={{ fontWeight: '700', marginTop: 8 }}>{t('myPartners', { n: info.partners.length })}</T>
          {info.partners.map((c) => (
            <Card key={c.clientId} onPress={() => router.push({ pathname: '/partner/[id]', params: { id: c.clientId } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <T style={{ flex: 1, fontWeight: '600' }}>{c.name}</T>
              <T style={{ color: C.text2, fontSize: 13 }}>{t(`type_${c.role}` as never)}</T>
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

function InVisit({ visit, name, partners, initialContact }: {
  visit: NonNullable<ReturnType<typeof q.activeVisit>>; name: string; partners: ReturnType<typeof q.contactsIn>; initialContact: string | null;
}) {
  const { t, lang } = useSession();
  // Nobody is picked to start with: the agent first chooses "add new" or "revisit someone".
  const [contactId, setContactId] = useState<string | null>(initialContact || null);
  const [search, setSearch] = useState('');
  // Someone just added here (back from Add person): pick them so the agent can carry on with them.
  const known = useRef(new Set(partners.map((c) => c.clientId)));
  useEffect(() => {
    const fresh = partners.find((c) => !known.current.has(c.clientId));
    partners.forEach((c) => known.current.add(c.clientId));
    if (fresh) setContactId(fresh.clientId);
  }, [partners]);
  const [met, setMet] = useState<Met | null>(null);
  const [interest, setInterest] = useState<Interest | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const distFromCentre = useMemo(() => {
    const a = q.assignedOne(visit.panchayatId);
    return a?.lat != null && a?.lng != null ? haversineM({ lat: visit.checkInLat, lng: visit.checkInLng }, { lat: a.lat, lng: a.lng }) : null;
  }, [visit]);

  const reset = () => { setMet(null); setInterest(null); setNote(''); };

  // Someone added before this visit is a revisit: show what was said last time.
  const picked = useDb(() => {
    if (!contactId) return null;
    const c = q.contact(contactId);
    return c ? { name: c.name, role: c.role, revisit: c.createdAt < visit.checkInAt, history: q.notesFor(contactId).slice(0, 3) } : null;
  }, [contactId, visit.checkInAt]);
  const stats = useDb(() => new Map(q.visitStatsIn(visit.panchayatId).map((r) => [r.contactId, r])), [visit.panchayatId, partners.length]);
  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    const d = s.replace(/\D/g, '');
    return s ? partners.filter((c) => c.name.toLowerCase().includes(s) || (d.length >= 3 && (c.phone ?? '').replace(/\D/g, '').includes(d))) : partners;
  }, [partners, search]);
  const metLine = (id: string) => {
    const r = stats.get(id);
    return r?.n ? t('partnerVisits', { n: r.n, when: r.last ? relDay(t, lang, r.last) : '–' }) : t('noVisitNoteYet');
  };

  const savingRef = useRef(false);
  const save = async (days: number) => {
    if (!contactId || !met || savingRef.current) return;
    savingRef.current = true;
    const text = [t('visitNoteText', { met: t(met), interest: interest ? t(interest) : '–' }), note.trim()].filter(Boolean).join('\n');
    const pos = await quickPosition();
    addNote(contactId, text, picked?.revisit ? 'revisit' : 'visit', pos);
    setFollowUp(contactId, ymd(addDays(new Date(), days)));
    savingRef.current = false;
    toast(t('visitSaved'));
    reset();
    setContactId(null);
  };

  const photo = async () => {
    if (!contactId) return;
    const p = await takePhoto();
    if (p === 'denied') { Alert.alert(t('photo'), t('cameraDenied')); return; }
    if (p) { addPhoto(contactId, p); toast(t('savedOnPhone')); }
  };

  const out = async () => {
    setBusy(true);
    const pos = await currentPosition();
    checkOut(visit.clientId, pos?.lat ?? null, pos?.lng ?? null);
    setBusy(false);
    toast(t('savedOnPhone'));
    router.replace('/today');
  };

  const pickPerson = (id: string) => { setContactId(id); reset(); };
  const addNew = () => router.push({ pathname: '/partner-new', params: { panchayatId: visit.panchayatId } });

  return (
    <Screen header={<TopBar title={name} sub={t('youAreIn')} dark onBack={contactId ? () => { setContactId(null); reset(); } : undefined} />}
      footer={<View style={{ padding: 16, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border }}>
        <Btn kind="secondary" icon="check" label={t('checkOut')} onPress={out} loading={busy} />
      </View>}>
      <Card style={{ backgroundColor: C.okSoft, borderColor: C.okSoft, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Icon name="pin" color={C.okInk} />
        <View style={{ flex: 1 }}>
          <T style={{ fontWeight: '700', color: C.okInk }}>{timeOf(lang, now.toISOString())}</T>
          <T style={{ color: C.okInk, fontSize: 13 }}>{t('checkedInAt', { time: timeOf(lang, visit.checkInAt), dist: formatDist(distFromCentre, t) || '–' })}</T>
        </View>
      </Card>

      {!contactId ? (
        <>
          <T style={{ fontSize: 17, fontWeight: '800' }}>{t('whatNow')}</T>
          {/* 1. Someone new */}
          <Pressable onPress={addNew} accessibilityRole="button" style={({ pressed }) => [{
            flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 16, backgroundColor: C.blue,
          }, pressed && { opacity: 0.85 }]}>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="plus" color="#fff" size={26} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <T style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>{t('addPartner')}</T>
              <T style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>{t('addNewSub')}</T>
            </View>
            <Icon name="chevron" color="#fff" />
          </Pressable>

          {/* 2. Someone already added here */}
          <Card style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: C.okSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="refresh" color={C.okInk} size={24} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <T style={{ fontSize: 18, fontWeight: '800' }}>{t('revisitPartner')}</T>
                <T style={{ color: C.text2, fontSize: 13 }}>{partners.length ? t('revisitPartnerSub', { n: partners.length }) : t('noOneHereYet')}</T>
              </View>
            </View>
            {partners.length > 6 ? <Field placeholder={t('searchPartners')} value={search} onChangeText={setSearch} /> : null}
            {shown.map((c) => (
              <Pressable key={c.clientId} onPress={() => pickPerson(c.clientId)} accessibilityRole="button"
                style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, backgroundColor: pressed ? C.line : C.bg }]}>
                <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: C.blueSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <T style={{ color: C.blueInk, fontWeight: '800' }}>{c.name.trim().charAt(0).toUpperCase()}</T>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T style={{ fontWeight: '700' }} numberOfLines={1}>{c.name}</T>
                  <T style={{ color: C.text2, fontSize: 12 }} numberOfLines={1}>{t(`type_${c.role}` as never)} · {metLine(c.clientId)}</T>
                </View>
                <T style={{ color: C.blue, fontWeight: '700', fontSize: 13 }}>{t('revisitBtn')}</T>
              </Pressable>
            ))}
            {partners.length && !shown.length ? <T style={{ color: C.text2 }}>{t('noMatches')}</T> : null}
          </Card>

          <Btn kind="ghost" icon="pin" label={t('nextPanchayat')} onPress={() => router.push('/checkin')} />
        </>
      ) : (
        <>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: picked?.revisit ? C.okSoft : C.blueSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={picked?.revisit ? 'refresh' : 'user'} color={picked?.revisit ? C.okInk : C.blueInk} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T style={{ color: C.text2, fontSize: 12, fontWeight: '700' }}>{picked?.revisit ? t('revisiting') : t('firstMeeting')}</T>
              <T style={{ fontSize: 18, fontWeight: '800' }} numberOfLines={1}>{picked?.name ?? ''}</T>
              <T style={{ color: C.text2, fontSize: 12 }} numberOfLines={1}>{picked ? `${t(`type_${picked.role}` as never)} · ${metLine(contactId)}` : ''}</T>
            </View>
            <Btn small kind="secondary" label={t('change')} onPress={() => { setContactId(null); reset(); }} />
          </Card>

          {picked?.history.length ? (
            <Card style={{ gap: 6, backgroundColor: C.bg }}>
              <T style={{ fontWeight: '700', color: C.text2, fontSize: 13 }}>{t('earlierComments')}</T>
              {picked.history.map((n) => (
                <View key={n.clientId} style={{ gap: 2 }}>
                  <T style={{ color: C.text2, fontSize: 12 }}>{relDay(t, lang, n.createdAt)} · {t(`source_${n.source}` as never)}</T>
                  <T numberOfLines={3}>{n.text}</T>
                </View>
              ))}
            </Card>
          ) : null}

          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <T style={{ flex: 1, fontSize: 17, fontWeight: '700' }}>{picked?.revisit ? t('howWasRevisit') : t('howWasIt')}</T>
              <Pill label={t('threeTaps')} tone="blue" />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['met', 'notMet'] as Met[]).map((m) => (
                <View key={m} style={{ flex: 1 }}>
                  <Chip big label={t(m)} selected={met === m} color={m === 'met' ? C.ok : C.warn} onPress={() => { setMet(m); if (m === 'notMet') setInterest(null); }} />
                </View>
              ))}
            </View>
            {met === 'met' ? (
              <>
                <T style={{ color: C.text2 }}>{t('interest')}</T>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {(['interestHigh', 'interestSome', 'interestNone'] as Interest[]).map((i) => (
                    <View key={i} style={{ flex: 1 }}><Chip big label={t(i)} selected={interest === i} onPress={() => setInterest(i)} /></View>
                  ))}
                </View>
              </>
            ) : null}
            {met && (met === 'notMet' || interest) ? (
              <>
                <Field placeholder={t('addNote')} value={note} onChangeText={setNote} multiline />
                <T style={{ color: C.text2 }}>{t('nextFollowUp')}</T>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}><Chip big label={t('tomorrow')} onPress={() => void save(1)} /></View>
                  <View style={{ flex: 1 }}><Chip big label={t('in3Days')} onPress={() => void save(3)} /></View>
                  <View style={{ flex: 1 }}><Chip big label={t('in1Week')} onPress={() => void save(7)} /></View>
                </View>
              </>
            ) : null}
          </Card>

          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Action icon="hospital" label={t('referPatient')} onPress={() => router.push({ pathname: '/refer', params: { contactId } })} />
            <Action icon="note" label={t('survey')} onPress={() => router.push({ pathname: '/survey', params: { contactId } })} />
            <Action icon="camera" label={t('photoOptional')} onPress={photo} />
          </View>
        </>
      )}
    </Screen>
  );
}

function Action({ icon, label, onPress, disabled }: { icon: 'hospital' | 'note' | 'camera'; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [{
      flex: 1, alignItems: 'center', gap: 6, paddingVertical: 14, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    }, disabled && { opacity: 0.4 }, pressed && { opacity: 0.8 }]}>
      <Icon name={icon} color={C.blue} />
      <T style={{ fontSize: 13, fontWeight: '600', textAlign: 'center' }}>{label}</T>
    </Pressable>
  );
}
