import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import { router } from 'expo-router';
import { Avatar, Btn, Card, Chip, Field, Screen, T, TopBar, toast } from '../components/ui';
import { Icon } from '../components/Icon';
import { useSession } from '../lib/session';
import { cachedProfile, errorText, isOffline, loadProfile, pickProfilePhoto, saveProfile, type Profile } from '../lib/profile';
import { C } from '../theme';

type Form = {
  firstName: string; middleName: string; lastName: string; email: string; dob: string; gender: string; address: string; pincode: string;
  education: string; workExperience: string; emergencyContactName: string; emergencyContactPhone: string; photoUrl: string;
};

/** "1994-05-12T00:00:00Z" → "12-05-1994" */
const toDmy = (iso?: string | null) => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '');
/** "12-05-1994" → "1994-05-12", or null when it isn't a real past date. */
function fromDmy(s: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  const date = new Date(`${y}-${mo}-${d}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.getUTCDate() !== +d || date > new Date() || +y < 1940) return null;
  return `${y}-${mo}-${d}`;
}
/** Types the dashes for the agent: 12051994 → 12-05-1994 */
const maskDmy = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('-');
};

const toForm = (p: Profile): Form => {
  const parts = p.name.trim().split(/\s+/);
  return {
    firstName: p.firstName ?? parts[0] ?? '', middleName: p.middleName ?? '', lastName: p.lastName ?? (parts.length > 1 ? parts[parts.length - 1] : ''),
    email: p.email ?? '', dob: toDmy(p.dateOfBirth), gender: p.gender ?? '', address: p.address ?? '', pincode: p.pincode ?? '',
    education: p.education ?? '', workExperience: p.workExperience ?? '', emergencyContactName: p.emergencyContactName ?? '',
    emergencyContactPhone: p.emergencyContactPhone ?? '', photoUrl: p.photoUrl ?? '',
  };
};

/** The agent edits their own profile: photo, name, email, personal details, address, emergency contact. */
export default function MyProfile() {
  const { t, agent, updateAgent } = useSession();
  const [profile, setProfile] = useState<Profile | null>(cachedProfile());
  const [form, setForm] = useState<Form | null>(() => { const c = cachedProfile(); return c ? toForm(c) : null; });
  const [offline, setOffline] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!agent) return;
    let alive = true;
    loadProfile(agent.agentId)
      .then((p) => { if (alive) { setProfile(p); setForm(toForm(p)); setOffline(false); } })
      .catch((e) => { if (alive) { setOffline(isOffline(e)); if (!isOffline(e)) toast(errorText(e)); } });
    return () => { alive = false; };
  }, [agent]);

  const set = (k: keyof Form, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const photo = (source: 'camera' | 'gallery') => async () => {
    setUploading(true);
    try {
      const r = await pickProfilePhoto(source);
      if (r === 'denied') Alert.alert(t('pfPhoto'), source === 'camera' ? t('cameraDenied') : t('pfGalleryDenied'));
      else if (r) set('photoUrl', r);
    } catch (e) {
      Alert.alert(t('pfPhoto'), isOffline(e) ? t('pfNeedsNet') : t('pfPhotoFailed', { msg: errorText(e) }));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!form || !agent) return;
    const e: Partial<Record<keyof Form, string>> = {};
    if (!form.firstName.trim()) e.firstName = t('pfNeedFirst');
    if (!form.lastName.trim()) e.lastName = t('pfNeedLast');
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = t('pfBadEmail');
    const dob = form.dob.trim() ? fromDmy(form.dob) : '';
    if (dob === null) e.dob = t('pfBadDob');
    if (form.pincode && !/^\d{6}$/.test(form.pincode)) e.pincode = t('pfBadPin');
    if (form.emergencyContactPhone && !/^\d{10}$/.test(form.emergencyContactPhone)) e.emergencyContactPhone = t('pfBadEmergency');
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const p = await saveProfile(agent.agentId, {
        firstName: form.firstName.trim(), middleName: form.middleName.trim(), lastName: form.lastName.trim(), email: form.email.trim(),
        dateOfBirth: dob || null, gender: form.gender, address: form.address.trim(), pincode: form.pincode, education: form.education.trim(),
        workExperience: form.workExperience.trim(), emergencyContactName: form.emergencyContactName.trim(),
        emergencyContactPhone: form.emergencyContactPhone, photoUrl: form.photoUrl,
      });
      setProfile(p);
      updateAgent({ name: p.name });
      toast(t('pfSaved'));
      router.back();
    } catch (err) {
      Alert.alert(t('pfTitle'), isOffline(err) ? t('pfNeedsNet') : errorText(err));
    } finally {
      setSaving(false);
    }
  };

  if (!form || !profile) {
    return (
      <Screen header={<TopBar title={t('pfTitle')} />}>
        <Card style={{ alignItems: 'center', gap: 10, paddingVertical: 28 }}>
          {offline ? <Icon name="cloudOff" color={C.muted} size={28} /> : <ActivityIndicator color={C.blue} />}
          <T style={{ color: C.text2, textAlign: 'center' }}>{offline ? t('pfNeedsNet') : t('loading')}</T>
        </Card>
      </Screen>
    );
  }

  const fullName = [form.firstName, form.lastName].filter(Boolean).join(' ') || profile.name;
  return (
    <Screen header={<TopBar title={t('pfTitle')} sub={profile.agentId} />}
      footer={
        <View style={{ padding: 16, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border, gap: 6 }}>
          {offline ? <T style={{ color: C.warnInk, textAlign: 'center', fontSize: 13 }}>{t('pfNeedsNet')}</T> : null}
          <Btn label={t('pfSave')} icon="check" kind="ok" onPress={save} loading={saving} disabled={uploading} />
        </View>
      }>
      <Card style={{ alignItems: 'center', gap: 12 }}>
        <View>
          <Avatar name={fullName} uri={form.photoUrl || null} size={96} />
          {uploading ? (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 48, backgroundColor: 'rgba(14,21,37,0.45)', alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : null}
        </View>
        <T style={{ fontWeight: '700' }}>{uploading ? t('pfUploading') : t('pfPhoto')}</T>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Btn small kind="secondary" icon="camera" label={t('pfTakePhoto')} onPress={photo('camera')} disabled={uploading} />
          <Btn small kind="secondary" icon="image" label={t('pfGallery')} onPress={photo('gallery')} disabled={uploading} />
          {form.photoUrl ? <Btn small kind="ghost" label={t('pfRemovePhoto')} onPress={() => set('photoUrl', '')} disabled={uploading} /> : null}
        </View>
      </Card>

      <Section title={t('pfName')}>
        <Field label={t('pfFirst')} value={form.firstName} onChangeText={(v) => set('firstName', v)} error={errors.firstName} autoCapitalize="words" maxLength={50} />
        <Field label={t('pfMiddle')} value={form.middleName} onChangeText={(v) => set('middleName', v)} autoCapitalize="words" maxLength={50} />
        <Field label={t('pfLast')} value={form.lastName} onChangeText={(v) => set('lastName', v)} error={errors.lastName} autoCapitalize="words" maxLength={50} />
      </Section>

      <Section title={t('pfContact')}>
        <Field label={t('pfMobile')} value={profile.phone} editable={false} hint={t('pfOfficeOnly')} style={{ color: C.text2, backgroundColor: C.bg }} />
        <Field label={t('pfEmail')} value={form.email} onChangeText={(v) => set('email', v)} error={errors.email} keyboardType="email-address" autoCapitalize="none" maxLength={120} />
      </Section>

      <Section title={t('pfPersonal')}>
        <Field label={t('pfDob')} value={form.dob} onChangeText={(v) => set('dob', maskDmy(v))} error={errors.dob} keyboardType="number-pad" placeholder="DD-MM-YYYY" maxLength={10} />
        <T style={{ fontWeight: '600', fontSize: 14 }}>{t('pfGender')}</T>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {(['Female', 'Male', 'Other'] as const).map((g) => (
            <Chip key={g} label={t(`pfGender${g}` as never)} selected={form.gender === g} onPress={() => set('gender', form.gender === g ? '' : g)} />
          ))}
        </View>
        <Field label={t('pfEducation')} value={form.education} onChangeText={(v) => set('education', v)} maxLength={120} />
        <Field label={t('pfExperience')} value={form.workExperience} onChangeText={(v) => set('workExperience', v)} maxLength={200} multiline />
      </Section>

      <Section title={t('pfAddress')}>
        <Field label={t('pfAddress')} value={form.address} onChangeText={(v) => set('address', v)} multiline maxLength={300} />
        <Field label={t('pfPin')} value={form.pincode} onChangeText={(v) => set('pincode', v.replace(/\D/g, ''))} error={errors.pincode} keyboardType="number-pad" maxLength={6} />
        <T style={{ color: C.text2, fontSize: 13 }}>{t('pfWorkArea', { block: profile.block || '—', district: profile.district || '—', role: profile.role })}</T>
      </Section>

      <Section title={t('pfEmergency')}>
        <Field label={t('pfEmergencyName')} value={form.emergencyContactName} onChangeText={(v) => set('emergencyContactName', v)} autoCapitalize="words" maxLength={80} />
        <Field label={t('pfMobile')} value={form.emergencyContactPhone} onChangeText={(v) => set('emergencyContactPhone', v.replace(/\D/g, ''))} error={errors.emergencyContactPhone} keyboardType="phone-pad" maxLength={10} />
      </Section>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card style={{ gap: 12 }}>
      <T style={{ fontSize: 13, fontWeight: '800', color: C.text2, letterSpacing: 0.4 }}>{title.toUpperCase()}</T>
      {children}
    </Card>
  );
}
