import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Btn, Chip, Empty, IconBtn, Screen, Sheet, T, TopBar, toast } from '../components/ui';
import { Icon } from '../components/Icon';
import { MapWeb, type MapData } from '../components/MapWeb';
import { useDb, useSession } from '../lib/session';
import { takePhoto } from '../lib/photo';
import { quickPosition } from '../lib/location';
import { uuid, nowIso } from '../lib/util';
import {
  addPoint, areaLatLng, colorOf, fieldSurvey, lastRoadType, localAnswers, localKm, localLines, localSpots, recording, removeSpot,
  saveAnswers, saveSpot, startRecording, stopRecording, switchRoad, syncFieldSurveys, waitingToSend,
} from '../lib/fieldSurvey';
import { C } from '../theme';

interface Draft { clientId: string; isNew: boolean; lat: number; lng: number; acc: number | null; type: string; name: string; roadType: string | null; note: string; photoUri: string | null; takenAt: string }

function inside(ring: [number, number][], lat: number, lng: number) {
  if (ring.length < 3) return true;
  let r = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi) r = !r;
  }
  return r;
}

/**
 * One field survey: the area on the map, tracing the route by road type (keeps going with the screen off when
 * allowed), marking spots where you stand or by tapping the map, and the questions. Everything saves on the phone.
 */
export default function FieldSurveyScreen() {
  const { t } = useSession();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useDb(() => fieldSurvey(id), [id]);
  const rec = useDb(() => recording());
  const lines = useDb(() => localLines(id), [id]);
  const spots = useDb(() => localSpots(id), [id]);
  const km = useDb(() => localKm(id), [id]);
  const waiting = useDb(() => waitingToSend(id), [id]);
  const answered = useDb(() => localAnswers(id), [id]);
  const [me, setMe] = useState<{ lat: number; lng: number; acc: number | null; heading: number | null } | null>(null);
  const [follow, setFollow] = useState(false);
  const [pick, setPick] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [road, setRoad] = useState<string | null>(() => lastRoadType(id));
  const [busy, setBusy] = useState(false);
  const recordingHere = rec?.surveyId === id;

  // Live position while the screen is open (it also feeds the route when tracing).
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let alive = true;
    (async () => {
      let st = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (!st?.granted) st = await Location.requestForegroundPermissionsAsync().catch(() => null);
      if (!alive || !st?.granted) return;
      sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 3000, distanceInterval: 5 }, (l) => {
        setMe({ lat: l.coords.latitude, lng: l.coords.longitude, acc: l.coords.accuracy ?? null, heading: l.coords.heading ?? null });
        addPoint(l.coords.latitude, l.coords.longitude, l.coords.accuracy ?? null, l.timestamp);
      }).catch(() => null);
    })();
    return () => { alive = false; sub?.remove(); };
  }, []);

  const c = item?.config;
  const data: MapData = useMemo(() => ({
    stops: [],
    me: me ? { lat: me.lat, lng: me.lng } : null,
    nav: follow && me ? { follow: true, heading: me.heading } : null,
    area: c ? areaLatLng(c.area) : [],
    lines: lines.map((l) => ({ color: colorOf(c?.roadTypes ?? [], l.roadType), points: l.points })),
    marks: spots.map((s) => ({ id: s.clientId, lat: s.lat, lng: s.lng, color: colorOf(c?.spotTypes ?? [], s.type) })),
    pick, keepView: true,
  }), [me, follow, c, lines, spots, pick]);

  if (!c) {
    return <Screen header={<TopBar title={t('fsTitle')} />}><Empty text={t('fsListEmpty')} icon="route" /></Screen>;
  }
  const closed = c.status === 'closed';
  const outside = me ? !inside(c.area, me.lat, me.lng) : false;

  const toggleRec = async () => {
    if (recordingHere) { await stopRecording(); return; }
    if (rec && rec.surveyId !== id) await stopRecording();
    setBusy(true);
    const bg = await startRecording(id, road, t('fsNotifTitle'), t('fsNotifBody', { name: c.title }));
    setBusy(false);
    if (!bg) Alert.alert(t('fsTitle'), t('fsBgDenied'));
  };
  const pickRoad = (r: string) => { setRoad(r); if (recordingHere) switchRoad(r); };

  const newSpot = (lat: number, lng: number, acc: number | null) => {
    setPick(false);
    setDraft({ clientId: uuid(), isNew: true, lat, lng, acc, type: '', name: '', roadType: road, note: '', photoUri: null, takenAt: nowIso() });
  };
  const markHere = async () => {
    if (me && (me.acc == null || me.acc <= 60)) { newSpot(me.lat, me.lng, me.acc); return; }
    setBusy(true);
    const p = await quickPosition();
    setBusy(false);
    if (p) newSpot(p.lat, p.lng, p.accuracy);
    else Alert.alert(t('fsTitle'), t('fsNoFix'));
  };
  const openSpot = (sid: string) => {
    const s = spots.find((x) => x.clientId === sid);
    if (s) setDraft({ clientId: s.clientId, isNew: false, lat: s.lat, lng: s.lng, acc: s.acc, type: s.type, name: s.name ?? '', roadType: s.roadType, note: s.note ?? '', photoUri: s.photoUri, takenAt: s.takenAt });
  };
  const save = () => {
    if (!draft || !draft.type) return;
    saveSpot({ clientId: draft.clientId, surveyId: id, type: draft.type, name: draft.name.trim() || null, roadType: draft.roadType, lat: draft.lat, lng: draft.lng, acc: draft.acc, note: draft.note.trim() || null, photoUri: draft.photoUri, takenAt: draft.takenAt });
    setDraft(null);
    toast(t('fsSaved'));
  };
  const photo = async () => {
    const p = await takePhoto();
    if (p === 'denied') Alert.alert(t('photo'), t('cameraDenied'));
    else if (p && draft) setDraft({ ...draft, photoUri: p.uri });
  };
  const nQ = c.questions.length;
  const nA = answered ? c.questions.filter((q) => answered.answers[q.id] != null && answered.answers[q.id] !== '').length : 0;

  return (
    <Screen scroll={false} padded={false} header={
      <TopBar title={c.title} sub={t('fsKmSpots', { km: km.toFixed(2), n: spots.length })}
        right={nQ > 0 ? <IconBtn icon="note" label={t('fsQuestions')} onPress={() => router.push({ pathname: '/field-survey-questions', params: { id } })} /> : undefined} />
    }>
      <View style={{ flex: 1 }}>
        <MapWeb data={data} flat offlineText={t('mapOffline')} onSelect={openSpot} onPan={() => setFollow(false)} onTap={(lat, lng) => newSpot(lat, lng, null)} />
        <View style={{ position: 'absolute', right: 12, top: 12, gap: 8 }}>
          <IconBtn icon="locate" label={t('fsFollow')} color={follow ? '#fff' : C.text} bg={follow ? C.blue : C.card} onPress={() => setFollow((f) => !f)} />
        </View>
        {pick && (
          <View style={{ position: 'absolute', left: 12, right: 12, top: 12, backgroundColor: C.ink, borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, marginRight: 60 }}>
            <T style={{ color: '#fff', flex: 1 }}>{t('fsTapMapHint')}</T>
            <Btn label={t('fsCancel')} small kind="secondary" onPress={() => setPick(false)} />
          </View>
        )}
        {outside && !pick && (
          <View style={{ position: 'absolute', left: 12, top: 12, backgroundColor: '#fff4e0', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, marginRight: 70 }}>
            <T style={{ color: '#8a5100', fontSize: 13, fontWeight: '600' }}>{t('fsOutside')}</T>
          </View>
        )}
      </View>

      <View style={{ backgroundColor: C.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 + insets.bottom, gap: 10, borderTopWidth: 1, borderColor: C.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: recordingHere ? '#d03b3b' : C.text3 }} />
          <T style={{ fontWeight: '700', flex: 1 }}>{recordingHere ? t('fsRecording') : t('fsPaused')}</T>
          <T style={{ color: waiting ? C.text2 : '#0f8a5f', fontSize: 12.5 }}>{waiting ? t('fsWaiting', { n: waiting }) : t('fsAllSent')}</T>
        </View>
        {c.roadTypes.length > 0 && (
          <View>
            <T style={{ color: C.text2, fontSize: 12.5, marginBottom: 6 }}>{t('fsRoadType')}</T>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {c.roadTypes.map((r) => <Chip key={r} label={r} selected={road === r} color={colorOf(c.roadTypes, r)} onPress={() => pickRoad(r)} />)}
            </ScrollView>
          </View>
        )}
        {!closed && (
          <>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn flex label={recordingHere ? t('fsPause') : t('fsStart')} kind={recordingHere ? 'danger' : 'ok'} icon="route" loading={busy && !draft} onPress={() => void toggleRec()} />
              <Btn flex label={t('fsMarkHere')} icon="pin" onPress={() => void markHere()} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn flex small kind="secondary" label={t('fsTapMap')} icon="map" onPress={() => setPick(true)} />
              {nQ > 0 ? <Btn flex small kind="secondary" label={`${t('fsQuestions')} ${nA}/${nQ}`} icon="note" onPress={() => router.push({ pathname: '/field-survey-questions', params: { id } })} />
                : item.myStatus !== 'submitted' && !answered?.submitted ? <Btn flex small kind="secondary" label={t('fsSubmit')} icon="send" onPress={() => Alert.alert(t('fsSubmit'), t('fsSubmitQ'), [
                  { text: t('fsCancel'), style: 'cancel' },
                  { text: t('fsSubmit'), onPress: () => { void stopRecording(); saveAnswers(id, {}, true); void syncFieldSurveys().catch(() => undefined); toast(t('fsSubmitted')); } },
                ])} /> : null}
            </View>
          </>
        )}
        {c.instructions ? <T style={{ color: C.text2, fontSize: 12.5 }} numberOfLines={3}>{c.instructions}</T> : null}
      </View>

      <Sheet visible={!!draft} onClose={() => setDraft(null)} title={draft?.isNew ? t('fsMarkHere') : t('fsSpot')}>
        {draft && (
          <>
            <T style={{ fontWeight: '700' }}>{t('fsSpotType')}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {c.spotTypes.map((s) => <Chip key={s} label={s} selected={draft.type === s} color={colorOf(c.spotTypes, s)} onPress={() => setDraft({ ...draft, type: s })} />)}
            </View>
            <T style={{ fontWeight: '700' }}>{t('fsSpotName')}</T>
            <TextInput value={draft.name} onChangeText={(v) => setDraft({ ...draft, name: v })} maxLength={120} placeholder="…" placeholderTextColor={C.text3}
              style={{ borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: C.text, backgroundColor: '#fff' }} />
            {c.roadTypes.length > 0 && (
              <>
                <T style={{ fontWeight: '700' }}>{t('fsSpotRoad')}</T>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {c.roadTypes.map((r) => <Chip key={r} label={r} selected={draft.roadType === r} color={colorOf(c.roadTypes, r)} onPress={() => setDraft({ ...draft, roadType: r })} />)}
                </View>
              </>
            )}
            <T style={{ fontWeight: '700' }}>{t('fsSpotNote')}</T>
            <TextInput value={draft.note} onChangeText={(v) => setDraft({ ...draft, note: v })} maxLength={1000} multiline placeholder={t('fsSpotNotePh')} placeholderTextColor={C.text3}
              style={{ borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, minHeight: 70, textAlignVertical: 'top', color: C.text, backgroundColor: '#fff' }} />
            {draft.photoUri ? (
              <Pressable onPress={() => void photo()} accessibilityLabel={t('fsChangePhoto')}>
                <Image source={{ uri: draft.photoUri }} style={{ width: '100%', height: 180, borderRadius: 14 }} resizeMode="cover" />
              </Pressable>
            ) : null}
            <Btn kind="secondary" icon="camera" label={draft.photoUri ? t('fsChangePhoto') : t('fsAddPhoto')} onPress={() => void photo()} />
            <T style={{ color: C.text3, fontSize: 12 }}>{draft.lat.toFixed(5)}, {draft.lng.toFixed(5)}{draft.acc != null ? ` · ±${Math.round(draft.acc)} m` : ''}</T>
            <Btn label={t('fsSaveSpot')} icon="check" disabled={!draft.type} onPress={save} />
            {!draft.isNew && (
              <Btn kind="ghost" icon="trash" label={t('fsDeleteSpot')} onPress={() => Alert.alert(t('fsDeleteSpot'), t('fsDeleteSpotQ'), [
                { text: t('fsCancel'), style: 'cancel' },
                { text: t('fsDeleteSpot'), style: 'destructive', onPress: () => { removeSpot(draft.clientId); setDraft(null); } },
              ])} />
            )}
          </>
        )}
      </Sheet>
    </Screen>
  );
}

