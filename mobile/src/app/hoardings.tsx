import React, { useEffect, useState } from 'react';
import { Alert, Image, RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Btn, Card, Empty, Field, Pill, Screen, Sheet, T, toast, TopBar } from '../components/ui';
import { Icon } from '../components/Icon';
import { useDb, useSession } from '../lib/session';
import { OfflineError } from '../lib/api';
import { takePhoto } from '../lib/photo';
import {
  addSitePhoto, bannerUp, dropDraft, flushHoardings, hoardingDrafts, hoardingPhoto, KIND_KEY, markRented, myHoardings, refreshHoardings,
  type Hoarding, type HoardingStage,
} from '../lib/hoardings';
import type { StringKey } from '../i18n';
import { C } from '../theme';

type Tone = 'blue' | 'ok' | 'warn' | 'bad' | 'muted' | 'purple';
const STAGE: Record<HoardingStage, { label: StringKey; next: StringKey; tone: Tone }> = {
  suggested: { label: 'hdStSuggested', next: 'hdNextSuggested', tone: 'warn' },
  approved: { label: 'hdStApproved', next: 'hdNextApproved', tone: 'blue' },
  rented: { label: 'hdStRented', next: 'hdNextRented', tone: 'purple' },
  live: { label: 'hdStLive', next: 'hdNextLive', tone: 'ok' },
  ending: { label: 'hdStEnding', next: 'hdNextEnding', tone: 'bad' },
  ended: { label: 'hdStEnded', next: 'hdNextEnded', tone: 'muted' },
  rejected: { label: 'hdStRejected', next: 'hdNextEnded', tone: 'muted' },
};
const day = (d?: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');

/** My hoarding places: the ones I suggested, where each one stands, and what I should do next. No money is shown here. */
export default function Hoardings() {
  const { t } = useSession();
  const items = useDb(() => myHoardings());
  const drafts = useDb(() => hoardingDrafts());
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [rentFor, setRentFor] = useState<Hoarding | null>(null);
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [working, setWorking] = useState(false);
  const open = items.find((h) => h.id === openId) ?? null;

  const reload = async () => {
    setBusy(true);
    await flushHoardings();
    await refreshHoardings().catch(() => undefined);
    setBusy(false);
  };
  useEffect(() => { void flushHoardings().then(() => refreshHoardings().catch(() => undefined)); }, []);

  const fail = (e: unknown) => Alert.alert(t('hdTitle'), e instanceof OfflineError ? t('hdNeedInternet') : e instanceof Error ? e.message : t('hdNeedInternet'));

  const photo = async (h: Hoarding, kind: 'site' | 'banner') => {
    const p = await takePhoto();
    if (p === 'denied') { Alert.alert(t('photo'), t('cameraDenied')); return; }
    if (!p) return;
    setWorking(true);
    try {
      if (kind === 'banner') { await bannerUp(h.id, p.uri); toast(t('hdBannerDone')); }
      else { await addSitePhoto(h.id, p.uri); toast(t('hdPhotoDone')); }
    } catch (e) { fail(e); } finally { setWorking(false); }
  };

  const rented = async () => {
    if (!rentFor) return;
    setWorking(true);
    try { await markRented(rentFor.id, ownerName.trim(), ownerPhone.trim()); setRentFor(null); toast(t('hdRentedDone')); }
    catch (e) { fail(e); } finally { setWorking(false); }
  };

  return (
    <Screen scroll={false} padded={false} header={<TopBar title={t('hdTitle')} explain={t('hdExplain')} />}
      footer={<View style={{ padding: 12, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border }}><Btn label={t('hdAdd')} icon="camera" onPress={() => router.push('/hoarding-new')} /></View>}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={busy} onRefresh={() => void reload()} />}>
        {drafts.map((d) => (
          <Card key={d.clientId} style={{ borderColor: '#f5d9a8', backgroundColor: C.warnSoft }}>
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              {d.photoUri ? <Image source={{ uri: d.photoUri }} style={{ width: 56, height: 56, borderRadius: 12 }} /> : null}
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <T style={{ fontSize: 16, fontWeight: '700' }} numberOfLines={2}>{d.place}</T>
                <T style={{ color: C.text2, fontSize: 13 }}>{d.error ?? t('hdWaitingSub')}</T>
              </View>
              <Pill label={t('hdWaiting')} tone="warn" icon="cloudOff" />
            </View>
            {d.error ? <Btn small kind="danger" label={t('hdRemove')} onPress={() => dropDraft(d.clientId)} /> : null}
          </Card>
        ))}
        {items.length === 0 && drafts.length === 0 ? <Empty text={t('hdEmpty')} icon="billboard" /> : items.map((h) => {
          const st = STAGE[h.stage] ?? STAGE.suggested;
          const first = h.photos[h.photos.length - 1];
          return (
            <Card key={h.id} onPress={() => setOpenId(h.id)}>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                {first ? <Image source={hoardingPhoto(first.id)} style={{ width: 56, height: 56, borderRadius: 12, backgroundColor: C.line }} />
                  : <View style={{ width: 56, height: 56, borderRadius: 12, backgroundColor: '#ffe9ee', alignItems: 'center', justifyContent: 'center' }}><Icon name="billboard" size={26} color="#be123c" /></View>}
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <T style={{ fontSize: 16, fontWeight: '700' }} numberOfLines={2}>{h.place}</T>
                  <T style={{ color: C.text2, fontSize: 13 }} numberOfLines={1}>{[t(KIND_KEY[h.kind] ?? 'hdKindHoarding'), h.size, h.landmark].filter(Boolean).join(' · ')}</T>
                  <Pill label={t(st.label)} tone={st.tone} />
                </View>
                <Icon name="chevron" size={18} color={C.muted} />
              </View>
              {(h.status === 'approved' || h.status === 'rented') ? <T style={{ color: C.blueInk, fontSize: 13.5, fontWeight: '600' }}>{t(st.next)}</T> : null}
            </Card>
          );
        })}
      </ScrollView>

      <Sheet visible={!!open && !rentFor} onClose={() => setOpenId(null)} title={open?.place}>
        {open ? (() => {
          const st = STAGE[open.stage] ?? STAGE.suggested;
          return (
            <View style={{ gap: 12 }}>
              <Pill label={t(st.label)} tone={st.tone} />
              <T style={{ fontSize: 15 }}>
                {open.status === 'rejected' ? t('hdWhyNot', { reason: open.rejectReason ?? '' }) : t(st.next, { d: day(open.rentEnd) })}
              </T>
              <T style={{ color: C.text2, fontSize: 13.5 }}>{[t(KIND_KEY[open.kind] ?? 'hdKindHoarding'), open.size, open.landmark].filter(Boolean).join(' · ')}</T>
              {open.ownerName ? <T style={{ color: C.text2, fontSize: 13.5 }}>{t('hdOwner', { name: open.ownerName })}</T> : null}
              {open.photos.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {open.photos.map((p) => (
                    <View key={p.id}>
                      <Image source={hoardingPhoto(p.id)} style={{ width: 150, height: 112, borderRadius: 12, backgroundColor: C.line }} />
                      <View style={{ position: 'absolute', left: 6, bottom: 6 }}><Pill label={t(p.kind === 'banner' ? 'hdStLive' : 'hdPhotoSite')} tone={p.kind === 'banner' ? 'ok' : 'muted'} /></View>
                    </View>
                  ))}
                </ScrollView>
              ) : null}
              {open.status === 'approved' ? <Btn kind="ok" icon="check" label={t('hdMarkRented')} loading={working} onPress={() => { setOwnerName(''); setOwnerPhone(''); setRentFor(open); }} /> : null}
              {open.status === 'approved' || open.status === 'rented' ? <Btn kind={open.status === 'rented' ? 'ok' : 'secondary'} icon="camera" label={t('hdBannerUp')} loading={working} onPress={() => void photo(open, 'banner')} /> : null}
              {open.status === 'live' ? <Btn kind="secondary" icon="camera" label={t('hdAddPhoto')} loading={working} onPress={() => void photo(open, 'banner')} /> : null}
              {open.status === 'suggested' ? <Btn kind="secondary" icon="camera" label={t('hdAddPhoto')} loading={working} onPress={() => void photo(open, 'site')} /> : null}
            </View>
          );
        })() : null}
      </Sheet>

      <Sheet visible={!!rentFor} onClose={() => setRentFor(null)} title={t('hdRentedSheet')}>
        <View style={{ gap: 12 }}>
          <T style={{ color: C.text2, fontSize: 14 }}>{t('hdRentedSheetSub')}</T>
          {rentFor?.ownerName ? <T style={{ fontSize: 15, fontWeight: '600' }}>{t('hdOwner', { name: rentFor.ownerName })}</T> : (
            <>
              <Field label={t('hdOwnerName')} value={ownerName} onChangeText={setOwnerName} maxLength={120} />
              <Field label={t('hdOwnerPhone')} value={ownerPhone} onChangeText={setOwnerPhone} keyboardType="phone-pad" maxLength={14} />
            </>
          )}
          <Btn kind="ok" icon="check" label={t('hdConfirm')} loading={working} onPress={() => void rented()} />
          <Btn kind="secondary" label={t('cancel')} onPress={() => setRentFor(null)} />
        </View>
      </Sheet>
    </Screen>
  );
}
