import React, { useMemo, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Btn, Card, Chip, Field, Screen, T, Toggle, TopBar } from '../components/ui';
import { Icon } from '../components/Icon';
import { useDb, useSession } from '../lib/session';
import { q } from '../lib/db';
import { addContact } from '../lib/repo';
import { takePhoto, type Photo } from '../lib/photo';
import { currentPosition } from '../lib/location';
import { timeOf } from '../lib/format';
import { digitsOnly } from '../lib/util';
import { C } from '../theme';

const TYPES = ['asha_worker', 'rmp_doctor', 'medicine_shop', 'nursing_home', 'ward_member',
  'independent_doctor', 'lab', 'hospital', 'mukhiya', 'prominent_person', 'other'] as const;

export default function NewPartner() {
  const { t, lang } = useSession();
  const params = useLocalSearchParams<{ panchayatId?: string }>();
  const visit = useDb(() => q.activeVisit());
  const [panchayatId, setPanchayatId] = useState(params.panchayatId || visit?.panchayatId || '');
  const [step, setStep] = useState<0 | 1>(0);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [moreTypes, setMoreTypes] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [wa, setWa] = useState(false);
  const [card, setCard] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const placeName = useDb(() => (panchayatId ? q.assignedOne(panchayatId)?.name ?? q.panchayat(panchayatId)?.name ?? '' : ''), [panchayatId]);
  const assigned = useDb(() => q.assigned());

  const dup = useMemo(() => {
    const d = digitsOnly(phone);
    if (d.length < 10) return null;
    const hit = q.contactByPhone(d.slice(-10))[0];
    if (!hit) return null;
    const place = hit.panchayatId ? q.assignedOne(hit.panchayatId)?.name ?? q.panchayat(hit.panchayatId)?.name ?? '' : '';
    return { id: hit.clientId, name: hit.name, place };
  }, [phone]);

  const snap = async () => {
    setBusy(true);
    try {
      const p = await takePhoto();
      if (p === 'denied') Alert.alert(t('photo'), t('cameraDenied'));
      else if (p) setPhotos((x) => [...x, p]);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = t('needName');
    if (!panchayatId) e.panchayat = t('needPanchayat');
    if (!photos.length) e.photo = t('needPhoto');
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const pos = photos[0]?.lat != null ? { lat: photos[0].lat, lng: photos[0].lng } : await currentPosition();
    const id = addContact({
      panchayatId, role: role ?? 'other', name, phone, whatsappAdded: wa, cardGiven: card,
      lat: pos?.lat ?? null, lng: pos?.lng ?? null, photos,
    });
    setBusy(false);
    // Every new contact is asked the panchayat questions (skippable only with a reason).
    router.replace({ pathname: '/survey', params: { contactId: id, isNew: '1' } });
  };

  const steps = [t('stepPhoto'), t('stepDetails'), t('stepSurvey')];
  const shownTypes = moreTypes ? TYPES : TYPES.slice(0, 5);

  return (
    <Screen header={<TopBar title={t('addPartner')} sub={placeName ? t('fromCheckIn', { name: placeName }) : undefined}
      onBack={step === 1 ? () => setStep(0) : undefined} />}
      footer={
        <View style={{ padding: 16, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border }}>
          {step === 0
            ? <Btn label={t('next')} onPress={() => (photos.length ? setStep(1) : setErrors({ photo: t('needPhoto') }))} disabled={!photos.length} />
            : <Btn label={t('nextSixQuestions')} icon="chevron" onPress={save} loading={busy} />}
        </View>
      }>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {steps.map((s, i) => (
          <View key={s} style={{ flex: 1, gap: 6 }}>
            <View style={{ height: 4, borderRadius: 2, backgroundColor: i <= step ? C.blue : C.line }} />
            <T style={{ fontSize: 12, color: i === step ? C.blueInk : C.text2, fontWeight: i === step ? '700' : '500' }} numberOfLines={1}>{s}</T>
          </View>
        ))}
      </View>

      {step === 0 ? (
        <>
          {photos.length ? (
            <View style={{ borderRadius: 18, overflow: 'hidden' }}>
              <Image source={{ uri: photos[photos.length - 1].uri }} style={{ width: '100%', aspectRatio: 4 / 3, backgroundColor: C.ink }} />
              <View style={{ position: 'absolute', left: 10, bottom: 10, backgroundColor: 'rgba(14,21,37,0.75)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                <T style={{ color: '#fff', fontSize: 12 }}>
                  {timeOf(lang, photos[photos.length - 1].takenAt)}
                  {photos[photos.length - 1].lat != null ? ` · ${photos[photos.length - 1].lat!.toFixed(4)}, ${photos[photos.length - 1].lng!.toFixed(4)}` : ''}
                </T>
              </View>
            </View>
          ) : (
            <Pressable onPress={snap} style={{ aspectRatio: 4 / 3, borderRadius: 18, borderWidth: 2, borderStyle: 'dashed', borderColor: C.borderStrong, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: C.card }}>
              <Icon name="camera" size={40} color={C.blue} />
              <T style={{ fontSize: 18, fontWeight: '700', color: C.blueInk }}>{t('takePhoto')}</T>
            </Pressable>
          )}
          <T style={{ fontWeight: '700' }}>{t('photoStamped')}</T>
          <T style={{ color: C.text2, fontSize: 13 }}>{t('photoHint')}</T>
          {errors.photo ? <T style={{ color: C.bad }}>{errors.photo}</T> : null}
          {photos.length ? (
            <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
              {photos.map((p, i) => (
                <Pressable key={p.uri} onLongPress={() => setPhotos((x) => x.filter((_, j) => j !== i))}>
                  <Image source={{ uri: p.uri }} style={{ width: 72, height: 72, borderRadius: 10 }} />
                </Pressable>
              ))}
              <Pressable onPress={snap} style={{ width: 72, height: 72, borderRadius: 10, borderWidth: 1, borderColor: C.borderStrong, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="plus" color={C.blue} />
              </Pressable>
            </ScrollView>
          ) : null}
          {photos.length ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn flex kind="secondary" icon="camera" label={t('retake')} onPress={() => { setPhotos((x) => x.slice(0, -1)); void snap(); }} />
              <Btn flex kind="ghost" icon="plus" label={t('addAnotherPhoto')} onPress={snap} loading={busy} />
            </View>
          ) : null}
        </>
      ) : (
        <>
          {!panchayatId || !params.panchayatId && !visit ? (
            <Card>
              <T style={{ fontWeight: '700' }}>{t('choosePanchayat')}</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {assigned.map((p) => <Chip key={p.panchayatId} label={p.name} selected={panchayatId === p.panchayatId} onPress={() => setPanchayatId(p.panchayatId)} />)}
              </View>
              {errors.panchayat ? <T style={{ color: C.bad }}>{errors.panchayat}</T> : null}
            </Card>
          ) : null}
          <T style={{ fontSize: 17, fontWeight: '700' }}>{t('whoAreThey')}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {shownTypes.map((ty) => <Chip key={ty} label={t(`type_${ty}`)} selected={role === ty} onPress={() => setRole(ty)} />)}
            {!moreTypes ? <Chip label={t('more')} onPress={() => setMoreTypes(true)} /> : null}
          </View>
          <Field label={t('name')} value={name} onChangeText={setName} error={errors.name} autoCapitalize="words" />
          <Field label={t('phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={14} />
          {dup ? (
            <Card onPress={() => router.push({ pathname: '/partner/[id]', params: { id: dup.id } })} style={{ backgroundColor: C.warnSoft, borderColor: '#f5d9a8', flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <Icon name="alert" color={C.warnInk} />
              <T style={{ flex: 1, color: C.warnInk }}>{t('duplicateWarn', { name: dup.name, place: dup.place })}</T>
            </Card>
          ) : null}
          <Toggle label={t('addedOnWhatsapp')} value={wa} onChange={setWa} />
          <Toggle label={t('cardGiven')} value={card} onChange={setCard} />
        </>
      )}
    </Screen>
  );
}
