import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Btn, Card, Chip, Field, Screen, T, Toggle, TopBar } from '../components/ui';
import { NewPartnerSteps } from '../components/NewPartnerSteps';
import { Icon } from '../components/Icon';
import { useDb, useSession } from '../lib/session';
import { q } from '../lib/db';
import { addContact } from '../lib/repo';
import { currentPosition } from '../lib/location';
import { digitsOnly } from '../lib/util';
import { C } from '../theme';

const TYPES = ['asha_worker', 'rmp_doctor', 'medicine_shop', 'nursing_home', 'ward_member',
  'independent_doctor', 'lab', 'hospital', 'mukhiya', 'prominent_person', 'other'] as const;

export default function NewPartner() {
  const { t } = useSession();
  const params = useLocalSearchParams<{ panchayatId?: string }>();
  const visit = useDb(() => q.activeVisit());
  const onShift = useDb(() => !!q.activeShift());
  const [panchayatId, setPanchayatId] = useState(params.panchayatId || visit?.panchayatId || '');
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

  // Details first; then the panchayat questions; the photo is the last, optional step.
  const checkDetails = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = t('needName');
    if (!panchayatId) e.panchayat = t('needPanchayat');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!checkDetails()) return;
    setBusy(true);
    const pos = await currentPosition();
    const id = addContact({
      panchayatId, role: role ?? 'other', name, phone, whatsappAdded: wa, cardGiven: card,
      lat: pos?.lat ?? null, lng: pos?.lng ?? null, photos: [],
    });
    setBusy(false);
    // Every new contact is asked the panchayat questions (skippable only with a reason); the optional photo comes after.
    router.replace({ pathname: '/survey', params: { contactId: id, isNew: '1' } });
  };

  // Partners are added in the panchayat the agent is checked in to: no check-in, no adding.
  if (!visit && !params.panchayatId) {
    return (
      <Screen header={<TopBar title={t('addPartner')} />}>
        <Card style={{ alignItems: 'center', gap: 12, paddingVertical: 28 }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: C.blueSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="pin" size={30} color={C.blue} />
          </View>
          <T style={{ fontSize: 20, fontWeight: '800', textAlign: 'center' }}>{onShift ? t('checkInFirst') : t('startShiftFirst')}</T>
          <T style={{ color: C.text2, textAlign: 'center' }}>{t('checkInFirstSub')}</T>
          <Btn label={onShift ? t('checkInPanchayat') : t('startShift')} icon={onShift ? 'pin' : 'nav'} kind="ok"
            onPress={() => router.replace(onShift ? '/checkin' : '/shift')} style={{ alignSelf: 'stretch' }} />
        </Card>
      </Screen>
    );
  }

  const shownTypes = moreTypes ? TYPES : TYPES.slice(0, 5);

  return (
    <Screen header={<TopBar title={t('addPartner')} sub={placeName ? t('fromCheckIn', { name: placeName }) : undefined} />}
      footer={
        <View style={{ padding: 16, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border }}>
          <Btn label={t('saveNextQuestions')} icon="chevron" onPress={save} loading={busy} />
        </View>
      }>
      <NewPartnerSteps step={0} />

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
    </Screen>
  );
}
