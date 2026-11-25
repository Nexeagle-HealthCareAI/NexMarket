import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Btn, Chip, Field, Pill, Screen, T, Toggle, TopBar, liveText, toast, useTextScale } from '../components/ui';
import { VoiceField } from '../components/MicButton';
import { Icon } from '../components/Icon';
import { sortPanchayats } from '../components/PanchayatList';
import { PanchayatPicker, recentPanchayats, rememberPanchayat } from '../components/PanchayatPicker';
import { CampCard, CampPickSheet } from '../components/CampPicker';
import { VitalsSheet } from '../components/VitalsSheet';
import { bookCamp, campList, campVitals, refreshCamps, sortCamps, vitalBits, type CampVitals } from '../lib/camps';
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
 * Book a patient met in the field, for the hospital or for a health camp. For the hospital: name, age, gender, mobile (optional) and where they live. The
 * panchayat is filled in only when it is sure (where the agent is checked in, else the last one used); otherwise the
 * agent picks it: one tap on a suggestion, or search any panchayat in any block. Block and district come from it.
 * The complaint can be written now or later; vitals and a sugar test are added on the patient's screen.
 * For a camp: pick the camp (every upcoming one, mine first); there is no visit day, the camp's date is it. The token
 * goes to them on WhatsApp by itself. Complaint and vitals are optional, now or later, or on the camp day.
 */
export default function Appointment() {
  const { t } = useSession();
  const scale = useTextScale();
  const params = useLocalSearchParams<{ panchayatId?: string; camp?: string; name?: string; walkIn?: string }>();
  const here = useHere();
  const visit = useDb(() => q.activeVisit());
  const assigned = useDb(() => q.assigned());
  const mine = assignment();
  const [name, setName] = useState(params.name ?? '');
  const camps = useDb(() => { const l = campList(); return { today: l?.today ?? null, list: sortCamps(l?.camps ?? [], mine.block) }; }, [mine.block]);
  const [where, setWhere] = useState<'hospital' | 'camp'>(params.camp ? 'camp' : 'hospital');
  const [campId, setCampId] = useState<string | null>(params.camp ?? null);
  const [pickingCamp, setPickingCamp] = useState(false);
  const [vitals, setVitals] = useState<Partial<CampVitals> | null>(null);
  const [addingVitals, setAddingVitals] = useState(false);
  const [walkIn, setWalkIn] = useState(params.walkIn === '1');
  useEffect(() => { refreshCamps().catch(() => undefined); }, []);
  const camp = camps.list.find((c) => c.id === campId) ?? (where === 'camp' && !params.camp ? camps.list[0] : undefined) ?? null;
  const forCamp = where === 'camp';
  const campToday = !!camp && camp.date === camps.today;
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<'F' | 'M' | 'O' | null>(null);
  const [phone, setPhone] = useState('');
  const [panchayatId, setPanchayatId] = useState<string | null>(() => params.panchayatId || visit?.panchayatId || kvGet(K_LAST_PLACE) || null);
  const [picking, setPicking] = useState(false);
  const [editPlace, setEditPlace] = useState(false);
  const [placeTyped, setPlaceTyped] = useState('');
  const [blockTyped, setBlockTyped] = useState<string | null>(null);
  const [districtTyped, setDistrictTyped] = useState<string | null>(null);
  const [day, setDay] = useState(0);
  const [complaint, setComplaint] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  // One-tap suggestions under the field: where I am, the ones used lately, then the nearest of my block.
  const suggestions = useMemo(() => {
    const ids = [visit?.panchayatId, ...recentPanchayats(), ...sortPanchayats(assigned, here).map((a) => a.panchayatId)].filter((x): x is string => !!x);
    return [...new Set(ids)].filter((id) => id !== panchayatId).slice(0, 3)
      .map((id) => ({ id, name: q.assignedOne(id)?.name ?? q.panchayat(id)?.name ?? null })).filter((x): x is { id: string; name: string } => !!x.name);
  }, [visit?.panchayatId, assigned, here, panchayatId]);
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
    if (!panchayatId && !(editPlace && placeTyped.trim() && block.trim())) e.place = t('apNeedPlace');
    setErrors(e);
    if (Object.keys(e).length) { toast(Object.values(e)[0]); return; }
    if (forCamp) {
      if (!camp) { toast(t('cmPickCamp')); setPickingCamp(true); return; }
      void bookCamp({
        campId: camp.id, name: name.trim(), age: n, sex: sex!, phone: digits, panchayatId, village: !panchayatId && placeTyped.trim() ? placeTyped.trim() : null,
        complaint: complaint.trim(), vitals, arrived: walkIn && campToday,
      }).then((clientId) => router.replace({ pathname: '/camp-booked', params: { id: clientId, ...(params.walkIn === '1' ? { day: camp.id } : {}) } }));
      if (panchayatId) { kvSet(K_LAST_PLACE, panchayatId); rememberPanchayat(panchayatId); }
      savedFeedback();
      return;
    }
    const visitDate = ymd(new Date(Date.now() + day * 86400000));
    const id = addAppointment({
      patientName: name, patientAge: n, patientSex: sex!, clientPhone: digits, panchayatId, block: block.trim() || null, district: district.trim() || null,
      visitDate, complaint: [editPlace && !panchayatId && placeTyped.trim() ? `${t('apPanchayat')}: ${placeTyped.trim()}` : '', complaint.trim()].filter(Boolean).join('\n'),
    });
    if (panchayatId) { kvSet(K_LAST_PLACE, panchayatId); rememberPanchayat(panchayatId); }
    savedFeedback();
    toast(t('apBooked', { name: name.trim() }));
    // Straight on to the patient: the vitals and sugar test are usually taken right after booking.
    router.replace({ pathname: '/patient/[id]', params: { id, vitals: '1' } });
  };

  return (
    <Screen header={<TopBar title={forCamp ? t('cmSave') : t('apTitle')} explain={forCamp ? t('cmCampsExplain') : t('apExplain')} />}
      footer={
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border }}>
          <Btn kind="ok" icon="calendar" label={forCamp ? t('cmSave') : t('apSave')} onPress={save} style={{ minHeight: 58, borderRadius: 16 }} />
        </View>
      }>
      {/* Hospital or a health camp: shown once the office has a camp coming up. */}
      {camps.list.length > 0 || params.camp ? (
        <View style={{ gap: 6 }}>
          <T style={{ fontSize: 15, fontWeight: '700' }}>{t('cmWhere')}</T>
          <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup">
            {([['hospital', t('cmHospital'), 'hospital'], ['camp', t('cmCamp'), 'flag']] as const).map(([k, l, ic]) => {
              const on = where === k;
              const tone = k === 'camp' ? C.ok : C.blue;
              return (
                <Pressable key={k} onPress={() => setWhere(k)} accessibilityRole="radio" accessibilityState={{ selected: on }}
                  style={({ pressed }) => [{ flex: 1, minHeight: 54, borderRadius: 14, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: on ? tone : C.card, borderWidth: 1, borderColor: on ? tone : C.borderStrong }, pressed && { opacity: 0.85 }]}>
                  <Icon name={ic} size={18} color={on ? '#fff' : C.text3} />
                  <T style={{ fontSize: 16, fontWeight: '800', color: on ? '#fff' : C.text }} numberOfLines={1}>{l}</T>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
      {forCamp ? (
        camp ? <CampCard camp={camp} today={camps.today} onPress={() => setPickingCamp(true)} />
          : <Btn kind="secondary" icon="flag" label={t('cmPickCamp')} onPress={() => setPickingCamp(true)} />
      ) : null}

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
        <T style={{ fontSize: 15, fontWeight: '700' }}>{t('apMobile')} <T style={{ fontWeight: '500', color: C.text2 }}>{forCamp ? `(${t('apOptional').replace(/[()]/g, '')} · ${t('cmTokenAuto')})` : t('apOptional')}</T></T>
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

      {/* Where they live: a required field like the others. Block and district come from the panchayat. */}
      <View style={{ gap: 6 }}>
        <T style={{ fontSize: 15, fontWeight: '700' }}>{t('apPanchayat')}</T>
        {editPlace && !panchayatId ? (
          <View style={{ gap: 8 }}>
            <Field label={t('apPanchayatName')} value={placeTyped} onChangeText={setPlaceTyped} error={errors.place && !placeTyped.trim() ? errors.place : undefined} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><Field label={t('apBlock')} value={block} onChangeText={setBlockTyped} /></View>
              <View style={{ flex: 1 }}><Field label={t('apDistrict')} value={district} onChangeText={setDistrictTyped} /></View>
            </View>
            <Pressable onPress={() => { setEditPlace(false); setPicking(true); }} accessibilityRole="button" style={{ alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center' }}>
              <T style={{ color: C.blue, fontWeight: '700', fontSize: 15 }}>{t('apPickPanchayat')}</T>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setPicking(true)} accessibilityRole="button" accessibilityLabel={`${t('apPanchayat')}: ${pName ?? t('apPickPanchayat')}`}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14,
              borderWidth: 1, borderColor: errors.place ? C.bad : panchayatId ? C.blue : C.borderStrong, backgroundColor: panchayatId ? C.blueSoft : C.card }, pressed && { opacity: 0.85 }]}>
            <Icon name="pin" size={20} color={panchayatId ? C.blueInk : C.text3} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <T style={{ fontSize: 17, fontWeight: panchayatId ? '800' : '600', color: panchayatId ? C.text : C.muted }} numberOfLines={1}>{pName ?? t('apPickPanchayat')}</T>
              {panchayatId ? <T style={{ fontSize: 14, color: C.text2 }} numberOfLines={1}>{[block && `${t('apBlock')}: ${block}`, district].filter(Boolean).join(' · ')}</T> : null}
            </View>
            <Icon name="chevron" size={18} color={C.text3} />
          </Pressable>
        )}
        {errors.place && !editPlace ? <T style={{ color: C.bad, fontSize: 13 }}>{errors.place}</T> : null}
        {!editPlace && suggestions.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {suggestions.map((s0) => <Chip key={s0.id} label={s0.name} icon="pin" onPress={() => { setPanchayatId(s0.id); setBlockTyped(null); setDistrictTyped(null); }} />)}
          </View>
        ) : null}
      </View>

      {!forCamp ? (
        <View style={{ gap: 6 }}>
          <T style={{ fontSize: 15, fontWeight: '700' }}>{t('apVisitDay')}</T>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {days.map((d, i) => <Chip key={d} label={d} selected={day === i} onPress={() => setDay(i)} big />)}
          </View>
        </View>
      ) : null}

      <VoiceField voice="note" label={`${t('apComplaint')} ${t('apOptional')}`} value={complaint} onChangeText={setComplaint} placeholder={t('apComplaintPh')} multiline />

      {/* For a camp, vitals can be taken now (optional); otherwise later, or on the camp day. */}
      {forCamp ? (
        <Pressable onPress={() => setAddingVitals(true)} accessibilityRole="button"
          style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 54, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: C.borderStrong, backgroundColor: C.card }, pressed && { opacity: 0.85 }]}>
          <Icon name="plus" size={18} color={C.blue} />
          <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {vitals ? vitalBits(vitals).map((b) => <Pill key={b} label={b} />) : <T style={{ color: C.blue, fontWeight: '700', fontSize: 15.5 }}>{t('cmVitalsAdd')}</T>}
          </View>
        </Pressable>
      ) : null}
      {forCamp && campToday ? <Toggle label={t('cmWalkIn')} value={walkIn} onChange={setWalkIn} /> : null}

      <CampPickSheet visible={pickingCamp} onClose={() => setPickingCamp(false)} camps={camps.list} selected={camp?.id ?? null} myBlock={mine.block} today={camps.today}
        onPick={(c) => { setCampId(c.id); setWhere('camp'); setPickingCamp(false); }} />
      <VitalsSheet short visible={addingVitals} onClose={() => setAddingVitals(false)} onSave={(v) => { setVitals(campVitals(v)); setAddingVitals(false); }} />

      <PanchayatPicker visible={picking} onClose={() => setPicking(false)} selected={panchayatId} here={here}
        onPick={(pp) => { setPanchayatId(pp.id); setEditPlace(false); setBlockTyped(null); setDistrictTyped(null); setPicking(false); }}
        onWrite={() => { setPanchayatId(null); setEditPlace(true); setPicking(false); }} />
    </Screen>
  );
}
