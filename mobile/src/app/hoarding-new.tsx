import React, { useState } from 'react';
import { Alert, Image, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Btn, Chip, Field, Screen, T, toast, Toggle, TopBar } from '../components/ui';
import { Icon } from '../components/Icon';
import { useSession } from '../lib/session';
import { takePhoto, type Photo } from '../lib/photo';
import { useHere } from '../lib/useHere';
import { HOARDING_KINDS, KIND_KEY, suggestHoarding } from '../lib/hoardings';
import { C } from '../theme';

/** Suggest a place for a banner: one photo taken on the spot (with its GPS), the place's name, and what kind of space it is. */
export default function HoardingNew() {
  const { t } = useSession();
  const here = useHere(true);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [place, setPlace] = useState('');
  const [landmark, setLandmark] = useState('');
  const [kind, setKind] = useState<string>('hoarding');
  const [size, setSize] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [note, setNote] = useState('');
  const [already, setAlready] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The photo's own GPS is the place; the phone's current fix is the fallback.
  const at = photo?.lat != null && photo.lng != null ? { lat: photo.lat, lng: photo.lng, accuracy: here?.accuracy ?? null } : here;

  const snap = async () => {
    const p = await takePhoto();
    if (p === 'denied') { Alert.alert(t('photo'), t('cameraDenied')); return; }
    if (p) { setPhoto(p); setErr(null); }
  };

  const send = async () => {
    if (!photo) { setErr(t('hdNeedPhoto')); return; }
    if (!place.trim()) { setErr(t('hdNeedPlace')); return; }
    if (!at) { setErr(t('hdLocNone')); return; }
    setBusy(true);
    const sent = await suggestHoarding({
      place: place.trim(), landmark: landmark.trim(), kind, size: size.trim(), note: note.trim(), alreadyRented: already,
      ownerName: ownerName.trim(), ownerPhone: ownerPhone.trim(), lat: at.lat, lng: at.lng, accuracy: at.accuracy ?? null, photoUri: photo.uri,
    });
    setBusy(false);
    toast(t(sent ? 'hdSent' : 'hdSaved'));
    if (router.canGoBack()) router.back(); else router.replace('/hoardings');
  };

  return (
    <Screen header={<TopBar title={t('hdNewTitle')} />}
      footer={<View style={{ padding: 12, gap: 8, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border }}>
        {err ? <T style={{ color: C.bad, fontSize: 14, fontWeight: '600' }}>{err}</T> : null}
        <Btn label={t('hdSend')} icon="send" loading={busy} onPress={() => void send()} />
      </View>}>
      {photo ? (
        <View>
          <Image source={{ uri: photo.uri }} style={{ width: '100%', height: 210, borderRadius: 16, backgroundColor: C.line }} />
          <View style={{ position: 'absolute', right: 10, bottom: 10 }}><Btn small kind="secondary" icon="camera" label={t('hdRetake')} onPress={() => void snap()} /></View>
        </View>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={t('hdPhotoStep')} onPress={() => void snap()}
          style={({ pressed }) => ({ height: 190, borderRadius: 16, borderWidth: 2, borderStyle: 'dashed', borderColor: C.blue, backgroundColor: pressed ? '#d9ebfc' : C.blueSoft, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 })}>
          <Icon name="camera" size={40} color={C.blue} />
          <T style={{ fontSize: 17, fontWeight: '700', color: C.blueInk }}>{t('hdPhotoStep')}</T>
          <T style={{ fontSize: 13.5, color: C.text2, textAlign: 'center' }}>{t('hdPhotoHint')}</T>
        </Pressable>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name="pin" size={16} color={at ? C.ok : C.warn} />
        <T style={{ fontSize: 13.5, color: at ? C.ok : C.text2, fontWeight: '600', flex: 1 }}>
          {at ? (at.accuracy != null ? t('hdLocOk', { m: Math.max(1, Math.round(at.accuracy)) }) : t('hdLocOk', { m: '?' })) : t('hdLocWait')}
        </T>
      </View>

      <Field label={t('hdPlace')} placeholder={t('hdPlacePh')} value={place} onChangeText={(v) => { setPlace(v); setErr(null); }} maxLength={160} />
      <Field label={t('hdLandmark')} placeholder={t('hdLandmarkPh')} value={landmark} onChangeText={setLandmark} maxLength={200} />

      <View style={{ gap: 8 }}>
        <T style={{ fontSize: 14, fontWeight: '600', color: C.text3 }}>{t('hdKind')}</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {HOARDING_KINDS.map((k) => <Chip key={k} label={t(KIND_KEY[k])} selected={kind === k} onPress={() => setKind(k)} />)}
        </View>
      </View>

      <Field label={t('hdSize')} placeholder={t('hdSizePh')} value={size} onChangeText={setSize} maxLength={60} />
      <Field label={t('hdOwnerName')} value={ownerName} onChangeText={setOwnerName} maxLength={120} />
      <Field label={t('hdOwnerPhone')} value={ownerPhone} onChangeText={setOwnerPhone} keyboardType="phone-pad" maxLength={14} />
      <Field label={t('hdNote')} value={note} onChangeText={setNote} multiline maxLength={1000} />
      <Toggle label={t('hdAlready')} value={already} onChange={setAlready} />
    </Screen>
  );
}
