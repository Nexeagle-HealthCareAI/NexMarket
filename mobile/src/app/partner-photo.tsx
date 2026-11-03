import React, { useCallback, useState } from 'react';
import { Alert, BackHandler, Image, Pressable, ScrollView, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Btn, Screen, T, TopBar, toast } from '../components/ui';
import { Icon } from '../components/Icon';
import { NewPartnerSteps } from '../components/NewPartnerSteps';
import { useDb, useSession } from '../lib/session';
import { q } from '../lib/db';
import { addPhoto } from '../lib/repo';
import { takePhoto, type Photo } from '../lib/photo';
import { timeOf } from '../lib/format';
import { C } from '../theme';

/** The last step of adding a partner, after the questions: a photo, only if it helps. */
export default function PartnerPhoto() {
  const { t, lang } = useSession();
  const { contactId } = useLocalSearchParams<{ contactId: string }>();
  const contact = useDb(() => q.contact(contactId), [contactId]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);

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

  // Back to the panchayat (where the new person is picked), or to the partner's page.
  const finish = () => {
    photos.forEach((p) => addPhoto(contactId, p));
    if (photos.length) toast(t('savedOnPhone'));
    const v = q.activeVisit();
    if (v && v.panchayatId === contact?.panchayatId && router.canGoBack()) router.back();
    else router.replace({ pathname: '/partner/[id]', params: { id: contactId } });
  };

  // The phone's back button finishes too, so photos already taken are kept.
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { finish(); return true; });
    return () => sub.remove();
  }, [finish]));

  const last = photos[photos.length - 1];
  return (
    <Screen header={<TopBar title={t('addPartner')} sub={contact?.name} onBack={finish} />}
      footer={
        <View style={{ padding: 16, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border }}>
          <Btn label={photos.length ? t('nextSixQuestions') : t('skipPhotoNext')} kind={photos.length ? 'ok' : 'secondary'} icon="check" onPress={finish} />
        </View>
      }>
      <NewPartnerSteps step={2} />
      <T style={{ color: C.text2 }}>{t('partnerSavedPhotoNext', { name: contact?.name ?? '' })}</T>
      {last ? (
        <View style={{ borderRadius: 18, overflow: 'hidden' }}>
          <Image source={{ uri: last.uri }} style={{ width: '100%', aspectRatio: 4 / 3, backgroundColor: C.ink }} />
          <View style={{ position: 'absolute', left: 10, bottom: 10, backgroundColor: 'rgba(14,21,37,0.75)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
            <T style={{ color: '#fff', fontSize: 12 }}>
              {timeOf(lang, last.takenAt)}{last.lat != null ? ` · ${last.lat.toFixed(4)}, ${last.lng!.toFixed(4)}` : ''}
            </T>
          </View>
        </View>
      ) : (
        <Pressable onPress={snap} disabled={busy} accessibilityRole="button" style={{ aspectRatio: 4 / 3, borderRadius: 18, borderWidth: 2, borderStyle: 'dashed', borderColor: C.borderStrong, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: C.card }}>
          <Icon name="camera" size={40} color={C.blue} />
          <T style={{ fontSize: 18, fontWeight: '700', color: C.blueInk }}>{t('takePhoto')}</T>
        </Pressable>
      )}
      <T style={{ fontWeight: '700' }}>{t('photoStamped')} <T style={{ fontWeight: '600', color: C.text2 }}>· {t('optional')}</T></T>
      {!photos.length ? <T style={{ color: C.text2, fontSize: 13 }}>{t('photoLastHint', { name: contact?.name?.trim() ?? '' })}</T> : null}
      <T style={{ color: C.text2, fontSize: 13 }}>{t('photoHint')}</T>
      {photos.length ? (
        <>
          <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
            {photos.map((p, i) => (
              <Pressable key={p.uri} onLongPress={() => setPhotos((x) => x.filter((_, j) => j !== i))}>
                <Image source={{ uri: p.uri }} style={{ width: 72, height: 72, borderRadius: 10 }} />
              </Pressable>
            ))}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Btn flex kind="secondary" icon="camera" label={t('retake')} onPress={() => { setPhotos((x) => x.slice(0, -1)); void snap(); }} />
            <Btn flex kind="ghost" icon="plus" label={t('addAnotherPhoto')} onPress={snap} loading={busy} />
          </View>
        </>
      ) : null}
    </Screen>
  );
}
