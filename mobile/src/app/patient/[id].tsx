import React, { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Btn, Card, Chip, Empty, Pill, Screen, Sheet, T, TopBar, liveText, toast, useTextScale } from '../../components/ui';
import { VoiceField } from '../../components/MicButton';
import { Icon } from '../../components/Icon';
import { useDb, useSession } from '../../lib/session';
import { db, q, type Reading } from '../../lib/db';
import { addReading, setComplaint, type ReadingInput } from '../../lib/repo';
import { savedFeedback } from '../../lib/prefs';
import { dayShort } from '../../lib/format';
import { C } from '../../theme';
import type { StringKey } from '../../i18n';

type SugarKind = 'random' | 'fasting' | 'pp';
const SUGAR_KEY: Record<SugarKind, StringKey> = { random: 'apSugarRandom', fasting: 'apSugarFasting', pp: 'apSugarPp' };

/** A reading as short parts ("BP 150/95", "Sugar 210 · fasting"), with high or low ones marked. */
function parts(x: Reading, t: (k: StringKey) => string): { text: string; flag: 'high' | 'low' | null }[] {
  const out: { text: string; flag: 'high' | 'low' | null }[] = [];
  if (x.bpSystolic) out.push({ text: `${t('apBp')} ${x.bpSystolic}/${x.bpDiastolic ?? '–'}`, flag: x.bpSystolic >= 140 || (x.bpDiastolic ?? 0) >= 90 ? 'high' : x.bpSystolic < 90 ? 'low' : null });
  if (x.sugar) out.push({ text: `Sugar ${x.sugar}${x.sugarKind ? ` · ${t(SUGAR_KEY[x.sugarKind as SugarKind] ?? 'apSugarRandom')}` : ''}`,
    flag: (x.sugarKind === 'fasting' ? x.sugar >= 126 : x.sugar >= 200) ? 'high' : x.sugar < 70 ? 'low' : null });
  if (x.pulse) out.push({ text: `Pulse ${x.pulse}`, flag: x.pulse > 100 ? 'high' : x.pulse < 50 ? 'low' : null });
  if (x.tempF) out.push({ text: `${x.tempF}°F`, flag: x.tempF >= 100.4 ? 'high' : null });
  if (x.spo2) out.push({ text: `SpO2 ${x.spo2}%`, flag: x.spo2 < 94 ? 'low' : null });
  if (x.respRate) out.push({ text: `${x.respRate}/min`, flag: x.respRate > 24 ? 'high' : null });
  if (x.hba1c) out.push({ text: `HbA1c ${x.hba1c}%`, flag: x.hba1c >= 6.5 ? 'high' : null });
  if (x.weightKg) out.push({ text: `${x.weightKg} kg`, flag: null });
  if (x.heightCm) out.push({ text: `${x.heightCm} cm`, flag: null });
  return out;
}

/**
 * One patient (an appointment the agent booked, or a referral): who and where, the complaint (write or change it any
 * time), and every set of vitals the agent took. "Add vitals" opens a short form; only the readings taken are filled.
 */
export default function Patient() {
  const { t, lang } = useSession();
  const { id, vitals } = useLocalSearchParams<{ id: string; vitals?: string }>();
  const r = useDb(() => q.referral(id), [id]);
  const readings = useDb(() => q.readingsFor(id), [id]);
  const place = useDb(() => (r?.panchayatId ? q.assignedOne(r.panchayatId)?.name ?? q.panchayat(r.panchayatId)?.name ?? null : null), [r?.panchayatId]);
  const unsent = useDb(() => (db().getFirstSync<{ n: number }>("SELECT COUNT(*) AS n FROM outbox WHERE clientId = ? OR clientId = ? OR (type = 'patient_reading' AND payload LIKE ?)",
    id, `complaint-${id}`, `%${id}%`)?.n ?? 0), [id]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');

  // Coming straight from booking: open the vitals form.
  useEffect(() => { if (vitals === '1') { const tm = setTimeout(() => setAdding(true), 350); return () => clearTimeout(tm); } return undefined; }, [vitals]);

  if (!r) return <Screen header={<TopBar title={t('apAppointment')} />}><Empty text={t('apPatientNotFound')} icon="patients" /></Screen>;
  const appt = r.kind === 'appointment';
  const sexWord = r.patientSex === 'F' ? t('apFemale') : r.patientSex === 'M' ? t('apMale') : r.patientSex === 'O' ? t('apOther') : null;
  const saveComplaint = () => { setComplaint(id, text); savedFeedback(); toast(t('apComplaintSaved')); setEditing(false); };

  return (
    <Screen header={<TopBar title={r.patientName || '—'} sub={[r.patientAge != null ? `${r.patientAge}` : null, sexWord].filter(Boolean).join(' · ')} />}
      footer={
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border }}>
          <Btn kind="ok" icon="plus" label={t('apAddVitals')} onPress={() => setAdding(true)} style={{ minHeight: 58, borderRadius: 16 }} />
        </View>
      }>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {appt ? <Pill label={t('apAppointment')} tone="info" icon="calendar" /> : null}
          {r.visitDate ? <T style={{ color: C.text2, fontSize: 14 }}>{t('apVisitOn', { d: dayShort(lang, new Date(`${r.visitDate}T12:00:00`)) })}</T> : null}
          <T style={{ color: C.text2, fontSize: 14 }}>{t('apBookedOn', { d: dayShort(lang, new Date(r.createdAt)) })}</T>
        </View>
        {place || r.block || r.district ? (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Icon name="pin" size={16} color={C.text3} />
            <T style={{ flex: 1, fontSize: 15 }}>{[...new Set([place, r.block, r.district].filter(Boolean))].join(', ')}</T>
          </View>
        ) : null}
        {r.clientPhone ? (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Icon name="phone" size={16} color={C.text3} />
            <T style={{ fontSize: 15 }}>+91 {r.clientPhone}</T>
          </View>
        ) : null}
        {unsent ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="cloudOff" size={14} color={C.warnInk} />
            <T style={{ color: C.warnInk, fontSize: 13 }}>{t('onPhoneWillSend')}</T>
          </View>
        ) : null}
      </Card>

      {/* Complaint: written at booking, or added / changed later. */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <T style={{ flex: 1, fontSize: 17, fontWeight: '800' }}>{t('apComplaint')}</T>
          {!editing ? (
            <Pressable onPress={() => { setText(r.complaint ?? ''); setEditing(true); }} accessibilityRole="button" hitSlop={6} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 }}>
              <T style={{ color: C.blue, fontWeight: '700', fontSize: 15 }}>{r.complaint ? t('apEdit') : t('apComplaintAdd')}</T>
            </Pressable>
          ) : null}
        </View>
        {editing ? (
          <>
            <VoiceField voice="note" value={text} onChangeText={setText} placeholder={t('apComplaintPh')} multiline autoFocus />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn kind="secondary" label={t('cancel')} onPress={() => setEditing(false)} flex />
              <Btn label={t('apSaveComplaint')} onPress={saveComplaint} flex />
            </View>
          </>
        ) : (
          <T style={{ fontSize: 15.5, lineHeight: 22, color: r.complaint ? C.text : C.text2 }}>{r.complaint || t('apComplaintNone')}</T>
        )}
      </Card>

      <T style={{ fontSize: 17, fontWeight: '800', marginTop: 4 }}>{t('apHistory')}</T>
      {readings.length === 0 ? <Empty text={t('apNoVitals')} icon="note" /> : readings.map((x) => (
        <Card key={x.clientId}>
          <T style={{ color: C.text2, fontSize: 13 }}>{`${dayShort(lang, new Date(x.takenAt))} · ${new Date(x.takenAt).toLocaleTimeString(lang === 'en' ? 'en-IN' : 'hi-IN', { hour: 'numeric', minute: '2-digit' })}`}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {parts(x, t).map((p) => (
              <View key={p.text} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: p.flag ? C.badSoft : C.bg }}>
                <T style={{ fontSize: 15, fontWeight: '700', color: p.flag ? C.bad : C.text }}>{p.text}{p.flag ? ` · ${t(p.flag === 'high' ? 'apHigh' : 'apLow')}` : ''}</T>
              </View>
            ))}
          </View>
          {x.note ? <T style={{ color: C.text2, fontSize: 14 }}>{x.note}</T> : null}
        </Card>
      ))}

      <VitalsSheet visible={adding} onClose={() => setAdding(false)} onSave={(v) => { addReading(id, v); savedFeedback(); toast(t('apVitalsSaved')); setAdding(false); }} />
    </Screen>
  );
}

/** Numbers only, in a small box with a label: the phone's number pad comes up. */
function Num({ label, value, onChange, decimal, width }: { label: string; value: string; onChange: (v: string) => void; decimal?: boolean; width?: number }) {
  const scale = useTextScale();
  return (
    <View style={{ gap: 4, flex: width ? undefined : 1, width, minWidth: 0 }}>
      <T style={{ fontSize: 13.5, fontWeight: '700', color: C.text2 }} numberOfLines={1}>{label}</T>
      <TextInput value={value} onChangeText={(v) => onChange(v.replace(decimal ? /[^\d.]/g : /\D/g, '').slice(0, decimal ? 5 : 3))}
        keyboardType={decimal ? 'decimal-pad' : 'number-pad'} accessibilityLabel={label} placeholderTextColor={C.muted}
        style={liveText({ minHeight: 52, borderWidth: 1, borderColor: C.borderStrong, borderRadius: 12, backgroundColor: C.card, paddingHorizontal: 12, fontSize: 19, fontWeight: '700', color: C.text, textAlign: 'center' }, scale)} />
    </View>
  );
}

function VitalsSheet({ visible, onClose, onSave }: { visible: boolean; onClose: () => void; onSave: (v: ReadingInput) => void }) {
  const { t } = useSession();
  const blank = { bpS: '', bpD: '', pulse: '', temp: '', spo2: '', resp: '', weight: '', height: '', sugar: '', hba1c: '', note: '' };
  const [f, setF] = useState(blank);
  const [kind, setKind] = useState<SugarKind>('random');
  const [more, setMore] = useState(false);
  useEffect(() => { if (visible) { setF(blank); setKind('random'); setMore(false); } }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof blank) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const int = (s: string) => (s.trim() ? parseInt(s, 10) : null);
  const dec = (s: string) => (s.trim() && Number.isFinite(Number(s)) ? Math.round(Number(s) * 10) / 10 : null);

  const save = () => {
    const v: ReadingInput = {
      bpSystolic: int(f.bpS), bpDiastolic: int(f.bpD), pulse: int(f.pulse), tempF: dec(f.temp), spo2: int(f.spo2), respRate: int(f.resp),
      weightKg: dec(f.weight), heightCm: dec(f.height), sugar: int(f.sugar), sugarKind: f.sugar.trim() ? kind : null, hba1c: dec(f.hba1c), note: f.note.trim() || null,
    };
    // Same limits as the server, so a typing slip is caught here instead of silently dropped there.
    const bad: [boolean, string][] = [
      [v.bpSystolic != null && (v.bpSystolic < 50 || v.bpSystolic > 300), t('apBp')], [v.bpDiastolic != null && (v.bpDiastolic < 30 || v.bpDiastolic > 200), t('apBp')],
      [v.pulse != null && (v.pulse < 20 || v.pulse > 250), t('apPulse')], [v.tempF != null && (v.tempF < 85 || v.tempF > 110), t('apTemp')],
      [v.spo2 != null && (v.spo2 < 50 || v.spo2 > 100), t('apSpo2')], [v.respRate != null && (v.respRate < 4 || v.respRate > 80), t('apResp')],
      [v.weightKg != null && (v.weightKg < 1 || v.weightKg > 300), t('apWeight')], [v.heightCm != null && (v.heightCm < 30 || v.heightCm > 250), t('apHeight')],
      [v.sugar != null && (v.sugar < 20 || v.sugar > 900), t('apSugar')], [v.hba1c != null && (v.hba1c < 3 || v.hba1c > 20), t('apHba1c')],
    ];
    const wrong = bad.find(([b]) => b);
    if (wrong) { toast(t('apBadValue', { what: wrong[1] })); return; }
    const any = [v.bpSystolic, v.bpDiastolic, v.pulse, v.tempF, v.spo2, v.respRate, v.weightKg, v.heightCm, v.sugar, v.hba1c].some((x) => x != null);
    if (!any) { toast(t('apNeedOne')); return; }
    onSave(v);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('apVitalsTitle')}>
      <View style={{ gap: 4 }}>
        <T style={{ fontSize: 13.5, fontWeight: '700', color: C.text2 }}>{t('apBp')} (mmHg)</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Num label={t('apUpper')} value={f.bpS} onChange={set('bpS')} />
          <T style={{ fontSize: 24, color: C.text3, marginTop: 18 }}>/</T>
          <Num label={t('apLower')} value={f.bpD} onChange={set('bpD')} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Num label={t('apPulse')} value={f.pulse} onChange={set('pulse')} />
        <Num label={t('apSpo2')} value={f.spo2} onChange={set('spo2')} />
        <Num label={t('apTemp')} value={f.temp} onChange={set('temp')} decimal />
      </View>

      {/* Sugar test: the value, and when it was taken. */}
      <View style={{ gap: 8, padding: 12, borderRadius: 14, backgroundColor: C.warnSoft }}>
        <Num label={t('apSugar')} value={f.sugar} onChange={set('sugar')} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {(['random', 'fasting', 'pp'] as SugarKind[]).map((k) => <Chip key={k} label={t(SUGAR_KEY[k])} selected={kind === k} onPress={() => setKind(k)} color={C.warnInk} />)}
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Num label={t('apWeight')} value={f.weight} onChange={set('weight')} decimal />
        <Num label={t('apHeight')} value={f.height} onChange={set('height')} decimal />
      </View>

      {more ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Num label={t('apResp')} value={f.resp} onChange={set('resp')} />
          <Num label={t('apHba1c')} value={f.hba1c} onChange={set('hba1c')} decimal />
        </View>
      ) : (
        <Pressable onPress={() => setMore(true)} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
          <T style={{ color: C.blue, fontWeight: '700', fontSize: 15 }}>+ {t('apMoreReadings')}</T>
        </Pressable>
      )}
      <VoiceField voice="note" label={t('apVitalsNote')} value={f.note} onChangeText={set('note')} />
      <Btn kind="ok" icon="check" label={t('apSaveVitals')} onPress={save} style={{ minHeight: 56, borderRadius: 16 }} />
    </Sheet>
  );
}
