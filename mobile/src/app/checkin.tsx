import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Btn, Card, Chip, Empty, Field, Pill, Screen, T, TopBar, toast } from '../components/ui';
import { Icon } from '../components/Icon';
import { useDb, useSession } from '../lib/session';
import { q } from '../lib/db';
import { addNote, addPhoto, checkIn, checkOut, setFollowUp } from '../lib/repo';
import { currentPosition, recordPoint } from '../lib/location';
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
  const { t } = useSession();
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
      shift: q.activeShift(),
      visit: q.activeVisit(),
      partners: panchayatId ? q.contactsIn(panchayatId) : [],
      assigned: q.assigned(),
    };
  }, [panchayatId]);

  // No panchayat chosen yet: pick one (nearest first).
  if (!panchayatId) {
    const list = [...info.assigned].sort((a, b) => {
      const da = here && a.lat != null && a.lng != null ? haversineM(here, { lat: a.lat, lng: a.lng }) : 1e12;
      const db_ = here && b.lat != null && b.lng != null ? haversineM(here, { lat: b.lat, lng: b.lng }) : 1e12;
      return da - db_;
    });
    return (
      <Screen header={<TopBar title={t('choosePanchayat')} />}>
        {list.length === 0 ? <Empty text={t('noBlock')} icon="map" /> : null}
        {list.map((p) => (
          <Card key={p.panchayatId} onPress={() => setPanchayatId(p.panchayatId)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Icon name="pin" color={p.visited ? C.ok : C.blue} />
            <View style={{ flex: 1 }}>
              <T style={{ fontWeight: '700' }}>{p.name}</T>
              <T style={{ color: C.text2, fontSize: 13 }}>
                {formatDist(here && p.lat != null && p.lng != null ? haversineM(here, { lat: p.lat, lng: p.lng }) : null, t)}
              </T>
            </View>
            <Icon name="chevron" color={C.muted} />
          </Card>
        ))}
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
      const pos = await currentPosition();
      if (!pos) { Alert.alert(t('locationOff'), t('turnOnLocation')); return; }
      if (!info.approx && info.lat != null && info.lng != null && haversineM(pos, { lat: info.lat, lng: info.lng }) > CHECK_IN_RADIUS_M) {
        Alert.alert(t('checkIn'), t('tooFar', { name: info.name, dist: formatDist(haversineM(pos, { lat: info.lat, lng: info.lng }), t) }));
        return;
      }
      if (info.visit) checkOut(info.visit.clientId, pos.lat, pos.lng); // leaving the previous panchayat
      checkIn(panchayatId, pos.lat, pos.lng);
      recordPoint(pos.lat, pos.lng, pos.accuracy);
      toast(t('savedOnPhone'));
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
        {info.approx ? <T style={{ color: C.text2, textAlign: 'center', fontSize: 13 }}>{t('approxPin')}</T> : null}
        {!info.shift ? (
          <>
            <T style={{ color: C.warnInk, textAlign: 'center' }}>{t('startShiftToCheckIn')}</T>
            <Btn label={t('startShift')} kind="ok" icon="nav" onPress={() => router.push('/shift')} style={{ alignSelf: 'stretch' }} />
          </>
        ) : !canCheckIn && dist != null ? (
          <T style={{ color: C.warnInk, textAlign: 'center' }}>{t('tooFar', { name: info.name, dist: formatDist(dist, t) })}</T>
        ) : null}
        {info.shift ? <Btn label={t('checkIn')} icon="pin" onPress={doCheckIn} loading={busy} disabled={!canCheckIn && dist != null} style={{ alignSelf: 'stretch' }} /> : null}
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
  const [contactId, setContactId] = useState<string | null>(initialContact || partners[0]?.clientId || null);
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

  const save = (days: number) => {
    if (!contactId || !met) return;
    const text = [t('visitNoteText', { met: t(met), interest: interest ? t(interest) : '–' }), note.trim()].filter(Boolean).join('\n');
    addNote(contactId, text, 'visit');
    setFollowUp(contactId, ymd(addDays(new Date(), days)));
    toast(t('visitSaved'));
    reset();
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

  return (
    <Screen header={<TopBar title={name} sub={t('youAreIn')} dark />}
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

      <T style={{ fontSize: 17, fontWeight: '700' }}>{t('whoDidYouMeet')}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {partners.map((c) => <Chip key={c.clientId} label={c.name} selected={contactId === c.clientId} onPress={() => { setContactId(c.clientId); reset(); }} />)}
        <Chip label={`+ ${t('newPartner')}`} onPress={() => router.push({ pathname: '/partner-new', params: { panchayatId: visit.panchayatId } })} />
      </View>

      {contactId ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <T style={{ flex: 1, fontSize: 17, fontWeight: '700' }}>{t('howWasIt')}</T>
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
                <View style={{ flex: 1 }}><Chip big label={t('tomorrow')} onPress={() => save(1)} /></View>
                <View style={{ flex: 1 }}><Chip big label={t('in3Days')} onPress={() => save(3)} /></View>
                <View style={{ flex: 1 }}><Chip big label={t('in1Week')} onPress={() => save(7)} /></View>
              </View>
            </>
          ) : null}
        </Card>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Action icon="hospital" label={t('referPatient')} disabled={!contactId} onPress={() => router.push({ pathname: '/refer', params: { contactId: contactId ?? '' } })} />
        <Action icon="note" label={t('survey')} disabled={!contactId} onPress={() => router.push({ pathname: '/survey', params: { contactId: contactId ?? '' } })} />
        <Action icon="camera" label={t('photo')} disabled={!contactId} onPress={photo} />
      </View>
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
