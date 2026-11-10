import React, { useMemo, useState } from 'react';
import { VoiceField } from '../components/MicButton';
import { Pressable, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Avatar, Btn, Chip, Field, Screen, T, TopBar, liveText, toast, useTextScale } from '../components/ui';
import { Icon } from '../components/Icon';
import { PartnerPicker } from '../components/PartnerPicker';
import { useDb, useSession } from '../lib/session';
import { db, q } from '../lib/db';
import { addReferral } from '../lib/repo';
import { departments } from '../lib/sync';
import { savedFeedback } from '../lib/prefs';
import { DUTY_DOCTOR_PHONE } from '../lib/config';
import { callNumber } from '../lib/links';
import { C } from '../theme';

// Used until the hospital's department list has synced to the phone.
const FALLBACK_DEPTS = ['Obstetrics & Gynaecology', 'Urology', 'Orthopaedics', 'General Surgery', 'Paediatrics', 'General Medicine', 'Cardiology', 'Neurology', 'ENT', 'Ophthalmology'];
const TOP_DEPTS = 5;

/** Age groups. The exact age (a number) is still what is stored; a group alone goes into the notes. */
const BANDS = [
  { k: 'ptAgeChild', min: 0, max: 17 },
  { k: 'ptAge18', min: 18, max: 40 },
  { k: 'ptAge41', min: 41, max: 60 },
  { k: 'ptAge60', min: 61, max: 119 },
] as const;
type BandKey = typeof BANDS[number]['k'];

export default function Refer() {
  const { t } = useSession();
  const scale = useTextScale();
  const params = useLocalSearchParams<{ contactId?: string }>();
  const visit = useDb(() => q.activeVisit());
  const [contactId, setContactId] = useState(params.contactId || '');
  const partner = useDb(() => (contactId ? q.contact(contactId) : null), [contactId]);
  const place = useDb(() => (partner?.panchayatId ? q.assignedOne(partner.panchayatId)?.name ?? q.panchayat(partner.panchayatId)?.name ?? '' : ''), [partner?.panchayatId]);
  const [picking, setPicking] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [age, setAge] = useState('');
  const [band, setBand] = useState<BandKey | null>(null);
  const [exactOpen, setExactOpen] = useState(false);
  const [sex, setSex] = useState<'M' | 'F' | 'O' | null>(null);
  const [dept, setDept] = useState<string | null>(null);
  const [allDepts, setAllDepts] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [consent, setConsent] = useState(false);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  // The departments this agent sends to most come first (counted from referrals on the phone).
  const sent = useDb(() => db().getAllSync<{ department: string; n: number }>(
    'SELECT department, COUNT(*) AS n FROM referrals WHERE department IS NOT NULL GROUP BY department'));
  const depts = useMemo(() => {
    const list = departments().length ? departments() : FALLBACK_DEPTS;
    const n = new Map(sent.map((r) => [r.department, r.n]));
    return list.map((d, i) => ({ d, i, n: n.get(d) ?? 0 })).sort((a, b) => b.n - a.n || a.i - b.i).map((x) => x.d);
  }, [sent]);
  const top = depts.slice(0, TOP_DEPTS);
  const shown = allDepts ? depts : dept && !top.includes(dept) ? [...top, dept] : top;
  const hasMore = !allDepts && depts.length > TOP_DEPTS;

  const exact = parseInt(age, 10);
  const exactOk = Number.isFinite(exact) && exact > 0 && exact < 120;
  // A typed age lights up its group; a group tapped on its own clears the typed age.
  const activeBand: BandKey | null = exactOk ? BANDS.find((b) => exact >= b.min && exact <= b.max)?.k ?? null : band;

  const send = () => {
    const e: Record<string, string> = {};
    if (!contactId) e.partner = t('needPartner');
    if (!name.trim()) e.name = t('needPatientName');
    if (!dept) e.dept = t('needDept');
    if (!consent) e.consent = t('consentNeeded');
    setErrors(e);
    if (Object.keys(e).length) { toast(Object.values(e)[0]); return; }
    // No exact age: the group goes at the top of the notes so the front desk still sees it.
    const ageNote = !exactOk && band ? t('ptAgeNote', { band: t(band) }) : '';
    addReferral({
      contactId, patientName: name, patientAge: exactOk ? exact : null, patientSex: sex,
      clientPhone: phone, department: dept!, urgent, notes: [ageNote, notes.trim()].filter(Boolean).join('\n'),
    });
    savedFeedback();
    toast(t('referSaved', { name: name.trim() }));
    if (router.canGoBack()) router.back();
    else router.replace('/patients');
  };

  return (
    <Screen header={<TopBar title={t('referTitle')} explain={t('ptReferExplain')} />}
      footer={
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, gap: 8, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border }}>
          <Btn kind="ok" icon="hospital" label={t('referSend')} onPress={send} style={{ minHeight: 58, borderRadius: 16 }} />
          <T style={{ textAlign: 'center', color: C.text2, fontSize: 14 }}>{t('ptReferHint')}</T>
        </View>
      }>
      {partner ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: C.blueSoft }}>
          <Avatar name={partner.name} size={40} bg={C.star} />
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <T style={{ fontSize: 13, color: C.blueInk, fontWeight: '700', textTransform: 'uppercase' }}>{t('referredBy')}</T>
            <T style={{ fontSize: 17, fontWeight: '800' }}>{[partner.name, place].filter(Boolean).join(' · ')}</T>
          </View>
          <Pressable onPress={() => setPicking(true)} accessibilityRole="button" accessibilityLabel={`${t('change')}: ${t('referredBy')}`} hitSlop={6}
            style={{ minHeight: 48, paddingHorizontal: 10, justifyContent: 'center' }}>
            <T style={{ fontSize: 15, fontWeight: '700', color: C.blue }}>{t('change')}</T>
          </Pressable>
        </View>
      ) : (
        <Btn kind="secondary" icon="users" label={t('choosePartner')} onPress={() => setPicking(true)}
          style={errors.partner ? { borderColor: C.bad } : undefined} />
      )}
      {errors.partner ? <T style={{ color: C.bad }}>{errors.partner}</T> : null}

      <VoiceField voice="name" label={t('patientName')} value={name} onChangeText={setName} error={errors.name} autoCapitalize="words" />

      <View style={{ gap: 6 }}>
        <T style={{ fontSize: 15, fontWeight: '700' }}>{t('phone')} <T style={{ fontWeight: '500', color: C.text2 }}>{t('ptPhoneHint')}</T></T>
        <View style={{ flexDirection: 'row', alignItems: 'stretch', minHeight: 52, borderWidth: 1, borderColor: C.borderStrong, borderRadius: 14, backgroundColor: C.card, overflow: 'hidden' }}>
          <View style={{ paddingHorizontal: 12, justifyContent: 'center', backgroundColor: C.bg, borderRightWidth: 1, borderRightColor: C.borderStrong }}>
            <T style={{ fontSize: 17, fontWeight: '700', color: C.text3 }}>+91</T>
          </View>
          <TextInput value={phone} onChangeText={(v) => setPhone(v.replace(/[^\d ]/g, ''))} keyboardType="number-pad" maxLength={14}
            accessibilityLabel={t('phone')} placeholderTextColor={C.muted}
            style={liveText({ flex: 1, minWidth: 0, paddingHorizontal: 12, fontSize: 17, letterSpacing: 0.6, color: C.text }, scale)} />
        </View>
      </View>

      <View style={{ gap: 6 }}>
        <T style={{ fontSize: 15, fontWeight: '700' }}>{t('age')}</T>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {BANDS.map((b) => {
            const on = activeBand === b.k;
            return (
              <Pressable key={b.k} onPress={() => { setAge(''); setBand(on && !exactOk ? null : b.k); }} accessibilityRole="radio" accessibilityState={{ selected: on }}
                style={({ pressed }) => [{ flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2,
                  backgroundColor: on ? C.blue : C.card, borderWidth: 1, borderColor: on ? C.blue : C.borderStrong }, pressed && { opacity: 0.8 }]}>
                <T style={{ fontSize: 15, fontWeight: on ? '800' : '700', color: on ? '#fff' : C.text, textAlign: 'center' }}>{t(b.k)}</T>
              </Pressable>
            );
          })}
        </View>
        {exactOpen || age ? (
          <Field value={age} onChangeText={(v) => setAge(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={3} placeholder={t('ptExactAge')}
            accessibilityLabel={t('ptExactAge')} autoFocus={exactOpen && !age} />
        ) : (
          <Pressable onPress={() => setExactOpen(true)} accessibilityRole="button" hitSlop={4} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
            <T style={{ color: C.blue, fontWeight: '700', fontSize: 15 }}>{t('ptExactAge')}</T>
          </Pressable>
        )}
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><Chip big label={t('male')} selected={sex === 'M'} onPress={() => setSex(sex === 'M' ? null : 'M')} /></View>
        <View style={{ flex: 1 }}><Chip big label={t('female')} selected={sex === 'F'} onPress={() => setSex(sex === 'F' ? null : 'F')} /></View>
        <View style={{ flex: 1 }}><Chip big label={t('otherSex')} selected={sex === 'O'} onPress={() => setSex(sex === 'O' ? null : 'O')} /></View>
      </View>

      <View style={{ gap: 6 }}>
        <T style={{ fontSize: 15, fontWeight: '700' }}>{t('forWhichTreatment')} {sent.length ? <T style={{ fontWeight: '500', color: C.text2 }}>{t('ptMostSent')}</T> : null}</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {shown.map((d) => <DeptChip key={d} label={d} on={dept === d} onPress={() => setDept(d)} />)}
          {hasMore ? <DeptChip label={t('more')} on={false} onPress={() => setAllDepts(true)} /> : null}
        </View>
        {errors.dept ? <T style={{ color: C.bad }}>{errors.dept}</T> : null}
      </View>

      <Pressable onPress={() => setUrgent(!urgent)} accessibilityRole="switch" accessibilityLabel={t('ptUrgentA11y')} accessibilityState={{ checked: urgent }}
        style={({ pressed }) => [{ minHeight: 52, borderRadius: 14, borderWidth: urgent ? 2 : 1, borderColor: urgent ? C.bad : '#f3b8b2',
          backgroundColor: urgent ? C.bad : C.card, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12 }, pressed && { opacity: 0.85 }]}>
        <Icon name={urgent ? 'check' : 'alert'} size={20} color={urgent ? '#fff' : C.bad} strokeWidth={urgent ? 3 : 2} />
        <T style={{ fontSize: 16, fontWeight: '800', color: urgent ? '#fff' : C.bad }}>{t('urgent')}</T>
      </Pressable>
      {urgent && DUTY_DOCTOR_PHONE ? <Btn kind="danger" icon="phone" label={t('dutyDoctor')} onPress={() => callNumber(DUTY_DOCTOR_PHONE)} /> : null}

      <VoiceField voice="note" label={t('notesOptional')} value={notes} onChangeText={setNotes} multiline />

      <Pressable onPress={() => setConsent(!consent)} accessibilityRole="checkbox" accessibilityState={{ checked: consent }}
        style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 14, borderRadius: 14, borderWidth: 1,
          borderColor: errors.consent && !consent ? C.bad : consent ? C.ok : C.borderStrong, backgroundColor: consent ? C.okSoft : C.card }}>
        <View style={{ width: 26, height: 26, borderRadius: 7, borderWidth: 2, borderColor: consent ? C.ok : C.borderStrong, backgroundColor: consent ? C.ok : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
          {consent ? <Icon name="check" size={16} color="#fff" strokeWidth={3} /> : null}
        </View>
        <T style={{ flex: 1 }}>{t('consent')}</T>
      </Pressable>
      {errors.consent && !consent ? <T style={{ color: C.bad }}>{errors.consent}</T> : null}

      <PartnerPicker visible={picking} onClose={() => setPicking(false)} onPick={(c) => setContactId(c.clientId)} panchayatFirst={visit?.panchayatId} />
    </Screen>
  );
}

/** Half-width department button; long names wrap instead of being cut. */
function DeptChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected: on }}
      style={({ pressed }) => [{ width: '49%', minHeight: 52, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, justifyContent: 'center',
        backgroundColor: on ? C.blue : C.card, borderWidth: 1, borderColor: on ? C.blue : C.borderStrong }, pressed && { opacity: 0.8 }]}>
      <T style={{ fontSize: 15, fontWeight: on ? '800' : '700', color: on ? '#fff' : C.text }}>{label}</T>
    </Pressable>
  );
}
