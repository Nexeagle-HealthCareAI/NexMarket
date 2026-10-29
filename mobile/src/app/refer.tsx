import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Avatar, Btn, Card, Chip, Field, Pill, Screen, T, Toggle, TopBar, toast } from '../components/ui';
import { Icon } from '../components/Icon';
import { PartnerPicker } from '../components/PartnerPicker';
import { useDb, useSession } from '../lib/session';
import { q } from '../lib/db';
import { addReferral } from '../lib/repo';
import { departments } from '../lib/sync';
import { DUTY_DOCTOR_PHONE } from '../lib/config';
import { callNumber } from '../lib/links';
import { C } from '../theme';

// Used until the hospital's department list has synced to the phone.
const FALLBACK_DEPTS = ['Obstetrics & Gynaecology', 'Urology', 'Orthopaedics', 'General Surgery', 'Paediatrics', 'General Medicine', 'Cardiology', 'Neurology', 'ENT', 'Ophthalmology'];

export default function Refer() {
  const { t } = useSession();
  const params = useLocalSearchParams<{ contactId?: string }>();
  const visit = useDb(() => q.activeVisit());
  const [contactId, setContactId] = useState(params.contactId || '');
  const partner = useDb(() => (contactId ? q.contact(contactId) : null), [contactId]);
  const place = useDb(() => (partner?.panchayatId ? q.assignedOne(partner.panchayatId)?.name ?? q.panchayat(partner.panchayatId)?.name ?? '' : ''), [partner?.panchayatId]);
  const [picking, setPicking] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<'M' | 'F' | 'O' | null>(null);
  const [dept, setDept] = useState<string | null>(null);
  const [allDepts, setAllDepts] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [consent, setConsent] = useState(false);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const depts = departments().length ? departments() : FALLBACK_DEPTS;
  const shown = allDepts ? depts : depts.slice(0, 5);

  const send = () => {
    const e: Record<string, string> = {};
    if (!contactId) e.partner = t('needPartner');
    if (!name.trim()) e.name = t('needPatientName');
    if (!dept) e.dept = t('needDept');
    if (!consent) e.consent = t('consentNeeded');
    setErrors(e);
    if (Object.keys(e).length) return;
    const n = parseInt(age, 10);
    addReferral({
      contactId, patientName: name, patientAge: Number.isFinite(n) && n > 0 && n < 120 ? n : null, patientSex: sex,
      clientPhone: phone, department: dept!, urgent, notes,
    });
    toast(t('savedOnPhone'));
    router.replace('/patients');
  };

  return (
    <Screen header={<TopBar title={t('referTitle')} right={<Pill label={t('worksOffline')} tone="ok" icon="cloudOff" />} />}
      footer={
        <View style={{ padding: 16, gap: 6, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border }}>
          <Btn kind="ok" icon="hospital" label={t('referSend')} onPress={send} />
          <T style={{ textAlign: 'center', color: C.text2, fontSize: 12 }}>{t('referSavedHint')}</T>
        </View>
      }>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {partner ? <Avatar name={partner.name} size={40} /> : <Icon name="users" color={C.muted} />}
        <View style={{ flex: 1 }}>
          <T style={{ color: C.text2, fontSize: 12 }}>{t('referredBy')}</T>
          <T style={{ fontWeight: '700' }}>{partner ? [partner.name, place].filter(Boolean).join(' · ') : t('choosePartner')}</T>
        </View>
        <Btn small kind="ghost" label={partner ? t('change') : t('choosePartner')} onPress={() => setPicking(true)} />
      </Card>
      {errors.partner ? <T style={{ color: C.bad }}>{errors.partner}</T> : null}

      <Field label={t('patientName')} value={name} onChangeText={setName} error={errors.name} autoCapitalize="words" />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 2 }}><Field label={t('phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={14} /></View>
        <View style={{ flex: 1 }}><Field label={t('age')} value={age} onChangeText={(v) => setAge(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={3} /></View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><Chip big label={t('male')} selected={sex === 'M'} onPress={() => setSex('M')} /></View>
        <View style={{ flex: 1 }}><Chip big label={t('female')} selected={sex === 'F'} onPress={() => setSex('F')} /></View>
        <View style={{ flex: 1 }}><Chip big label={t('otherSex')} selected={sex === 'O'} onPress={() => setSex('O')} /></View>
      </View>

      <T style={{ fontSize: 16, fontWeight: '700' }}>{t('forWhichTreatment')}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {shown.map((d) => <Chip key={d} label={d} selected={dept === d} onPress={() => setDept(d)} />)}
        {!allDepts && depts.length > 5 ? <Chip label={t('more')} onPress={() => setAllDepts(true)} /> : null}
      </View>
      {errors.dept ? <T style={{ color: C.bad }}>{errors.dept}</T> : null}

      <Card style={urgent ? { borderColor: C.bad, backgroundColor: C.badSoft } : undefined}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Toggle label={t('urgent')} value={urgent} onChange={setUrgent} /></View>
          {urgent && DUTY_DOCTOR_PHONE ? <Btn small kind="danger" icon="phone" label={t('dutyDoctor')} onPress={() => callNumber(DUTY_DOCTOR_PHONE)} /> : null}
        </View>
      </Card>

      <Field label={t('notesOptional')} value={notes} onChangeText={setNotes} multiline />

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
