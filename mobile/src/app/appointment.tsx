import React, { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Btn, Chip, Field, Screen, Sheet, T, TopBar, liveText, toast, useTextScale } from '../components/ui';
import { VoiceField } from '../components/MicButton';
import { Icon } from '../components/Icon';
import { PanchayatList, sortPanchayats } from '../components/PanchayatList';
import { useDb, useSession } from '../lib/session';
import { kvGet, kvSet, q } from '../lib/db';
import { addAppointment } from '../lib/repo';
import { assignment } from '../lib/sync';
import { savedFeedback } from '../lib/prefs';
import { useHere } from '../lib/useHere';
import { ymd } from '../lib/util';
import { C } from '../theme';

const K_LAST_PLACE = 'appt.lastPanchayat';

/**
 * Book an appointment for a patient met in the field: name, age, gender, mobile (optional) and where they live. The
 * panchayat comes from where the agent is checked in (or the last one used); block and district fill in from it.
 * The complaint can be written now or later; vitals and a sugar test are added on the patient's screen.
 */
export default function Appointment() {
  const { t } = useSession();
  const scale = useTextScale();
  const params = useLocalSearchParams<{ panchayatId?: string }>();
  const here = useHere();
  const visit = useDb(() => q.activeVisit());
  const assigned = useDb(() => q.assigned());
  const mine = assignment();
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<'F' | 'M' | 'O' | null>(null);
  const [phone, setPhone] = useState('');
  const [picked, setPanchayatId] = useState<string | null>(() => params.panchayatId || visit?.panchayatId || kvGet(K_LAST_PLACE) || null);
  const [picking, setPicking] = useState(false);
  const [editPlace, setEditPlace] = useState(false);
  const [blockTyped, setBlockTyped] = useState<string | null>(null);
  const [districtTyped, setDistrictTyped] = useState<string | null>(null);
  const [day, setDay] = useState(0);
  const [complaint, setComplaint] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const list = useMemo(() => sortPanchayats(assigned, here), [assigned, here]);
  // Nothing chosen yet (not checked in, never booked here): the nearest panchayat of my block.
  const panchayatId = picked ?? list[0]?.panchayatId ?? null;
  const p = useDb(() => (panchayatId ? q.panchayat(panchayatId) : null), [panchayatId]);
  const pName = useDb(() => (panchayatId ? q.assignedOne(panchayatId)?.name ?? q.panchayat(panchayatId)?.name ?? null : null), [panchayatId]);
  const block = blockTyped ?? p?.block ?? mine.block ?? '';
  const district = districtTyped ?? p?.district ?? mine.district ?? '';
  const days = [t('apToday'), t('apTomorrow'), t('apDayAfter')];
  const digits = phone.replace(/\D/g, '');

  const save = () => {
    const e: Record<string, string> = {};
    const n = parseInt(age, 10);
    if (!name.trim()) e.name = t('apNeedName');
    if (!Number.isFinite(n) || n < 0 || n > 120) e.age = t('apNeedAge');
    if (!sex) e.sex = t('apNeedGender');
    if (digits && digits.length !== 10) e.phone = t('apPhoneBad');
    if (!panchayatId && !block.trim()) e.place = t('apNeedPlace');
    setErrors(e);
    if (Object.keys(e).length) { toast(Object.values(e)[0]); return; }
    const visitDate = ymd(new Date(Date.now() + day * 86400000));
    const id = addAppointment({
      patientName: name, patientAge: n, patientSex: sex!, clientPhone: digits, panchayatId, block: block.trim() || null, district: district.trim() || null,
      visitDate, complaint,
    });
    if (panchayatId) kvSet(K_LAST_PLACE, panchayatId);
    savedFeedback();
    toast(t('apBooked', { name: name.trim() }));
    // Straight on to the patient: the vitals and sugar test are usually taken right after booking.
    router.replace({ pathname: '/patient/[id]', params: { id, vitals: '1' } });
  };

  return (
    <Screen header={<TopBar title={t('apTitle')} explain={t('apExplain')} />}
      footer={
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border }}>
          <Btn kind="ok" icon="calendar" label={t('apSave')} onPress={save} style={{ minHeight: 58, borderRadius: 16 }} />
        </View>
      }>
      <VoiceField voice="name" label={t('apName')} value={name} onChangeText={setName} error={errors.name} autoCapitalize="words" autoFocus />

      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <View style={{ width: 110 }}>
          <Field label={t('apAge')} value={age} onChangeText={(v) => setAge(v.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" maxLength={3} error={errors.age} />
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <T style={{ fontSize: 15, fontWeight: '700' }}>{t('apGender')}</T>
          <View style={{ flexDirection: 'row', gap: 6 }} accessibilityRole="radiogroup">
            {([['F', t('apFemale')], ['M', t('apMale')], ['O', t('apOther')]] as const).map(([k, l]) => {
              const on = sex === k;
              return (
                <Pressable key={k} onPress={() => setSex(k)} accessibilityRole="radio" accessibilityState={{ selected: on }}
                  style={({ pressed }) => [{ flex: 1, minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2,
                    backgroundColor: on ? C.blue : C.card, borderWidth: 1, borderColor: on ? C.blue : errors.sex ? C.bad : C.borderStrong }, pressed && { opacity: 0.8 }]}>
                  <T style={{ fontSize: 15, fontWeight: on ? '800' : '700', color: on ? '#fff' : C.text, textAlign: 'center' }} numberOfLines={1}>{l}</T>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      <View style={{ gap: 6 }}>
        <T style={{ fontSize: 15, fontWeight: '700' }}>{t('apMobile')} <T style={{ fontWeight: '500', color: C.text2 }}>{t('apOptional')}</T></T>
        <View style={{ flexDirection: 'row', alignItems: 'stretch', minHeight: 52, borderWidth: 1, borderColor: errors.phone ? C.bad : C.borderStrong, borderRadius: 14, backgroundColor: C.card, overflow: 'hidden' }}>
          <View style={{ paddingHorizontal: 12, justifyContent: 'center', backgroundColor: C.bg, borderRightWidth: 1, borderRightColor: C.borderStrong }}>
            <T style={{ fontSize: 17, fontWeight: '700', color: C.text3 }}>+91</T>
          </View>
          <TextInput value={phone} onChangeText={(v) => setPhone(v.replace(/[^\d ]/g, ''))} keyboardType="number-pad" maxLength={12}
            accessibilityLabel={t('apMobile')} placeholderTextColor={C.muted}
            style={liveText({ flex: 1, minWidth: 0, paddingHorizontal: 12, fontSize: 17, letterSpacing: 0.6, color: C.text }, scale)} />
        </View>
        {errors.phone ? <T style={{ color: C.bad, fontSize: 13 }}>{errors.phone}</T> : null}
      </View>

      {/* Where they live: the panchayat picked, block and district filled in from it. */}
      <View style={{ gap: 8, padding: 14, borderRadius: 16, backgroundColor: C.blueSoft, borderWidth: errors.place ? 1 : 0, borderColor: C.bad }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon name="pin" size={20} color={C.blueInk} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T style={{ fontSize: 13, color: C.blueInk, fontWeight: '700', textTransform: 'uppercase' }}>{t('apPlace')}</T>
            <T style={{ fontSize: 17, fontWeight: '800' }} numberOfLines={2}>{pName ?? t('apPickPanchayat')}</T>
            <T style={{ fontSize: 14, color: C.text2 }} numberOfLines={1}>{[block && `${t('apBlock')}: ${block}`, district && `${t('apDistrict')}: ${district}`].filter(Boolean).join(' · ')}</T>
          </View>
          <Pressable onPress={() => setPicking(true)} accessibilityRole="button" accessibilityLabel={`${t('apChangePlace')}: ${t('apPanchayat')}`} hitSlop={6}
            style={{ minHeight: 48, paddingHorizontal: 10, justifyContent: 'center' }}>
            <T style={{ fontSize: 15, fontWeight: '700', color: C.blue }}>{t('apChangePlace')}</T>
          </Pressable>
        </View>
        {editPlace ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Field label={t('apBlock')} value={block} onChangeText={setBlockTyped} /></View>
            <View style={{ flex: 1 }}><Field label={t('apDistrict')} value={district} onChangeText={setDistrictTyped} /></View>
          </View>
        ) : (
          <Pressable onPress={() => setEditPlace(true)} accessibilityRole="button" hitSlop={4} style={{ alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center' }}>
            <T style={{ color: C.blue, fontWeight: '700', fontSize: 14 }}>{`${t('apEdit')} ${t('apBlock').toLowerCase()} / ${t('apDistrict').toLowerCase()}`}</T>
          </Pressable>
        )}
      </View>

      <View style={{ gap: 6 }}>
        <T style={{ fontSize: 15, fontWeight: '700' }}>{t('apVisitDay')}</T>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {days.map((d, i) => <Chip key={d} label={d} selected={day === i} onPress={() => setDay(i)} big />)}
        </View>
      </View>

      <VoiceField voice="note" label={`${t('apComplaint')} ${t('apOptional')}`} value={complaint} onChangeText={setComplaint} placeholder={t('apComplaintPh')} multiline />

      <Sheet visible={picking} onClose={() => setPicking(false)} title={t('apPickPanchayat')}>
        <PanchayatList list={list} here={here} selected={panchayatId} current={visit?.panchayatId ?? null}
          onPick={(id) => { setPanchayatId(id); setBlockTyped(null); setDistrictTyped(null); setPicking(false); }} />
      </Sheet>
    </Screen>
  );
}
