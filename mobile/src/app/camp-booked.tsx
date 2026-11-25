import React, { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Btn, Card, Empty, Pill, Screen, T, TopBar, toast } from '../components/ui';
import { Icon } from '../components/Icon';
import { ComplaintSheet } from '../components/ComplaintSheet';
import { VitalsSheet } from '../components/VitalsSheet';
import { campWhen } from '../components/CampPicker';
import { useDb, useSession } from '../lib/session';
import { bookingByClientId, campVitals, saveBookingDetails, tokenState, vitalBits } from '../lib/camps';
import { savedFeedback } from '../lib/prefs';
import { C } from '../theme';

/**
 * Booked for a camp: the token number (big, to say out loud or write on their hand), whether it went on WhatsApp, and
 * the optional complaint and vitals. Then book the next person for the same camp, or finish.
 */
export default function CampBooked() {
  const { t, lang } = useSession();
  const { id, day } = useLocalSearchParams<{ id: string; day?: string }>();
  // From the camp day (a walk-in): back to the camp's list; otherwise to the camps.
  const finish = () => (day ? router.replace({ pathname: '/camp/[id]', params: { id: day } }) : router.replace('/camps'));
  const b = useDb(() => bookingByClientId(id), [id]);
  const [complaintOpen, setComplaintOpen] = useState(false);
  const [vitalsOpen, setVitalsOpen] = useState(false);
  if (!b) return <Screen header={<TopBar title={t('cmBookedTitle')} />}><Empty text={t('apPatientNotFound')} icon="patients" /></Screen>;

  const wa = tokenState(b);
  const waLine = wa === 'ok' ? t('cmWaSent', { phone: b.phone ?? '' }) : wa === 'none' ? t('cmWaNone') : wa === 'fail' ? t('cmWaFail', { why: b.waError ?? b.waStatus ?? '' }) : t('cmWaWait');
  const saved = () => { savedFeedback(); toast(t('cmDetailsSaved')); };

  return (
    <Screen header={<TopBar title={t('cmBookedTitle')} onBack={finish} />}
      footer={
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border, gap: 8 }}>
          <Btn kind="ok" icon="plus" label={t('cmBookAnother')} onPress={() => router.replace({ pathname: '/appointment', params: { camp: b.campId, ...(day ? { walkIn: '1' } : {}) } })} style={{ minHeight: 56, borderRadius: 16 }} />
          <Btn kind="secondary" label={t('done')} onPress={finish} />
        </View>
      }>
      <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 20 }}>
        <T style={{ fontSize: 14, fontWeight: '800', color: C.text3, textTransform: 'uppercase', letterSpacing: 0.6 }}>{t('cmToken')}</T>
        <T style={{ fontSize: 64, fontWeight: '800', color: C.purple, lineHeight: 72 }}>{b.token ?? '—'}</T>
        <T style={{ fontSize: 19, fontWeight: '800', textAlign: 'center' }}>{b.name}</T>
        <T style={{ fontSize: 14.5, color: C.text2, textAlign: 'center' }}>{[b.age != null ? `${b.age}` : null, b.sex === 'F' ? t('apFemale') : b.sex === 'M' ? t('apMale') : b.sex === 'O' ? t('apOther') : null, b.village].filter(Boolean).join(' · ')}</T>
        {b.token == null ? <T style={{ fontSize: 14, color: C.text2, textAlign: 'center' }}>{t('cmTokenSoon')}</T> : null}
      </Card>

      <Card>
        <T style={{ fontSize: 12, fontWeight: '800', color: C.okInk, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('cmCampLabel')}</T>
        <T style={{ fontSize: 17, fontWeight: '800' }}>{b.campTitle}</T>
        <T style={{ fontSize: 14.5, color: C.text2 }}>{[b.campDate ? campWhen({ date: b.campDate, startTime: b.startTime, endTime: b.endTime }, t, lang) : null, b.place].filter(Boolean).join(' · ')}</T>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 4 }}>
          <Icon name={wa === 'ok' ? 'whatsapp' : wa === 'wait' ? 'clock' : 'alert'} size={18} color={wa === 'ok' ? '#1fa855' : wa === 'wait' ? C.text3 : C.warnInk} />
          <T style={{ flex: 1, fontSize: 14.5, color: wa === 'fail' || wa === 'none' ? C.warnInk : C.text }}>{waLine}</T>
        </View>
        {b.pending ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="cloudOff" size={14} color={C.warnInk} />
            <T style={{ color: b.error ? C.bad : C.warnInk, fontSize: 13 }}>{b.error ?? t('onPhoneWillSend')}</T>
          </View>
        ) : null}
      </Card>

      {/* Optional: what they came with, and vitals. Can also be done later, or on the camp day. */}
      <Card>
        <T style={{ fontSize: 16, fontWeight: '800' }}>{t('cmDetails')}</T>
        {b.complaint ? <T style={{ fontSize: 15 }}>{b.complaint}</T> : null}
        {b.vitals ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{vitalBits(b.vitals).map((x) => <Pill key={x} label={x} />)}</View> : null}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Btn kind="secondary" icon="note" label={t('apComplaint')} onPress={() => setComplaintOpen(true)} flex />
          <Btn kind="secondary" icon="plus" label={t('apAddVitals')} onPress={() => setVitalsOpen(true)} flex />
        </View>
      </Card>

      <ComplaintSheet visible={complaintOpen} onClose={() => setComplaintOpen(false)} value={b.complaint}
        onSave={(text) => { setComplaintOpen(false); void saveBookingDetails(b, { complaint: text }); saved(); }} />
      <VitalsSheet short visible={vitalsOpen} onClose={() => setVitalsOpen(false)}
        onSave={(v) => { setVitalsOpen(false); void saveBookingDetails(b, { vitals: campVitals(v) }); saved(); }} />
    </Screen>
  );
}
