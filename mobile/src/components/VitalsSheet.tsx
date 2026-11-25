import React, { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Btn, Chip, Sheet, T, liveText, useTextScale } from './ui';
import { Icon } from './Icon';
import { VoiceField } from './MicButton';
import { useSession } from '../lib/session';
import type { ReadingInput } from '../lib/repo';
import { C } from '../theme';
import type { StringKey } from '../i18n';

export type SugarKind = 'random' | 'fasting' | 'pp';
export const SUGAR_KEY: Record<SugarKind, StringKey> = { random: 'apSugarRandom', fasting: 'apSugarFasting', pp: 'apSugarPp' };

/** Numbers only, in a small box with a label: the phone's number pad comes up. */
function Num({ label, value, onChange, decimal, width, bad }: { label: string; value: string; onChange: (v: string) => void; decimal?: boolean; width?: number; bad?: boolean }) {
  const scale = useTextScale();
  return (
    <View style={{ gap: 4, flex: width ? undefined : 1, width, minWidth: 0 }}>
      <T style={{ fontSize: 13.5, fontWeight: '700', color: C.text2 }} numberOfLines={1}>{label}</T>
      <TextInput value={value} onChangeText={(v) => onChange(v.replace(decimal ? /[^\d.]/g : /\D/g, '').slice(0, decimal ? 5 : 3))}
        keyboardType={decimal ? 'decimal-pad' : 'number-pad'} accessibilityLabel={label} placeholderTextColor={C.muted}
        style={liveText({ minHeight: 52, borderWidth: bad ? 2 : 1, borderColor: bad ? C.bad : C.borderStrong, borderRadius: 12, backgroundColor: C.card, paddingHorizontal: 12, fontSize: 19, fontWeight: '700', color: C.text, textAlign: 'center' }, scale)} />
    </View>
  );
}

/**
 * Vitals (all kinds) and a sugar test: only the ones taken are filled. Used for an appointment's readings and for a
 * camp booking. `short` hides what a camp desk doesn't record (breathing, HbA1c, height, a note).
 */
export function VitalsSheet({ visible, onClose, onSave, short, title }: { visible: boolean; onClose: () => void; onSave: (v: ReadingInput) => void; short?: boolean; title?: string }) {
  const { t } = useSession();
  const blank = { bpS: '', bpD: '', pulse: '', temp: '', spo2: '', resp: '', weight: '', height: '', sugar: '', hba1c: '', note: '' };
  const [f, setF] = useState(blank);
  const [kind, setKind] = useState<SugarKind>('random');
  const [more, setMore] = useState(false);
  // What stops saving is shown here, in the sheet: a toast would sit behind it (Android draws the sheet on top).
  const [err, setErr] = useState<{ msg: string; field: keyof typeof blank | null } | null>(null);
  useEffect(() => { if (visible) { setF(blank); setKind('random'); setMore(false); setErr(null); } }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof blank) => (v: string) => { setF((x) => ({ ...x, [k]: v })); setErr(null); };
  const bad = (k: keyof typeof blank) => err?.field === k;
  const int = (s: string) => (s.trim() ? parseInt(s, 10) : null);
  const dec = (s: string) => (s.trim() && Number.isFinite(Number(s)) ? Math.round(Number(s) * 10) / 10 : null);

  const save = () => {
    // A temperature written in °C (35–43) is turned into °F, which is what is kept.
    const tRaw = dec(f.temp);
    const tempF = tRaw != null && tRaw >= 30 && tRaw <= 45 ? Math.round((tRaw * 9 / 5 + 32) * 10) / 10 : tRaw;
    const v: ReadingInput = {
      bpSystolic: int(f.bpS), bpDiastolic: int(f.bpD), pulse: int(f.pulse), tempF, spo2: int(f.spo2), respRate: int(f.resp),
      weightKg: dec(f.weight), heightCm: dec(f.height), sugar: int(f.sugar), sugarKind: f.sugar.trim() ? kind : null, hba1c: dec(f.hba1c), note: f.note.trim() || null,
    };
    // Same limits as the server, so a typing slip is caught here instead of silently dropped there.
    const checks: [boolean, string, keyof typeof blank][] = [
      [v.bpSystolic != null && (v.bpSystolic < 50 || v.bpSystolic > 300), t('apBp'), 'bpS'], [v.bpDiastolic != null && (v.bpDiastolic < 30 || v.bpDiastolic > 200), t('apBp'), 'bpD'],
      [v.pulse != null && (v.pulse < 20 || v.pulse > 250), t('apPulse'), 'pulse'], [v.tempF != null && (v.tempF < 85 || v.tempF > 110), t('apTemp'), 'temp'],
      [v.spo2 != null && (v.spo2 < 50 || v.spo2 > 100), t('apSpo2'), 'spo2'], [v.respRate != null && (v.respRate < 4 || v.respRate > 80), t('apResp'), 'resp'],
      [v.weightKg != null && (v.weightKg < 1 || v.weightKg > 300), t('apWeight'), 'weight'], [v.heightCm != null && (v.heightCm < 30 || v.heightCm > 250), t('apHeight'), 'height'],
      [v.sugar != null && (v.sugar < 20 || v.sugar > 900), t('apSugar'), 'sugar'], [v.hba1c != null && (v.hba1c < 3 || v.hba1c > 20), t('apHba1c'), 'hba1c'],
    ];
    const wrong = checks.find(([b]) => b);
    if (wrong) { setErr({ msg: t('apBadValue', { what: wrong[1] }), field: wrong[2] }); if (wrong[2] === 'resp' || wrong[2] === 'hba1c') setMore(true); return; }
    const any = [v.bpSystolic, v.bpDiastolic, v.pulse, v.tempF, v.spo2, v.respRate, v.weightKg, v.heightCm, v.sugar, v.hba1c].some((x) => x != null);
    if (!any) { setErr({ msg: t('apNeedOne'), field: null }); return; }
    onSave(v);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={title ?? t('apVitalsTitle')}>
      <View style={{ gap: 4 }}>
        <T style={{ fontSize: 13.5, fontWeight: '700', color: C.text2 }}>{t('apBp')} (mmHg)</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Num label={t('apUpper')} value={f.bpS} onChange={set('bpS')} bad={bad('bpS')} />
          <T style={{ fontSize: 24, color: C.text3, marginTop: 18 }}>/</T>
          <Num label={t('apLower')} value={f.bpD} onChange={set('bpD')} bad={bad('bpD')} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Num label={t('apPulse')} value={f.pulse} onChange={set('pulse')} bad={bad('pulse')} />
        <Num label={t('apSpo2')} value={f.spo2} onChange={set('spo2')} bad={bad('spo2')} />
        <Num label={t('apTemp')} value={f.temp} onChange={set('temp')} decimal bad={bad('temp')} />
      </View>

      {/* Sugar test: the value, and when it was taken. */}
      <View style={{ gap: 8, padding: 12, borderRadius: 14, backgroundColor: C.warnSoft }}>
        <Num label={t('apSugar')} value={f.sugar} onChange={set('sugar')} bad={bad('sugar')} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {(['random', 'fasting', 'pp'] as SugarKind[]).map((k) => <Chip key={k} label={t(SUGAR_KEY[k])} selected={kind === k} onPress={() => setKind(k)} color={C.warnInk} />)}
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Num label={t('apWeight')} value={f.weight} onChange={set('weight')} decimal bad={bad('weight')} />
        {!short ? <Num label={t('apHeight')} value={f.height} onChange={set('height')} decimal bad={bad('height')} /> : null}
      </View>

      {short ? null : more ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Num label={t('apResp')} value={f.resp} onChange={set('resp')} bad={bad('resp')} />
          <Num label={t('apHba1c')} value={f.hba1c} onChange={set('hba1c')} decimal bad={bad('hba1c')} />
        </View>
      ) : (
        <Pressable onPress={() => setMore(true)} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
          <T style={{ color: C.blue, fontWeight: '700', fontSize: 15 }}>+ {t('apMoreReadings')}</T>
        </Pressable>
      )}
      {!short ? <VoiceField voice="note" label={t('apVitalsNote')} value={f.note} onChangeText={set('note')} /> : null}
      {err ? (
        <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', gap: 8, alignItems: 'center', padding: 12, borderRadius: 12, backgroundColor: C.badSoft }}>
          <Icon name="alert" size={18} color={C.bad} />
          <T style={{ flex: 1, color: C.bad, fontSize: 15, fontWeight: '700' }}>{err.msg}</T>
        </View>
      ) : null}
      <Btn kind="ok" icon="check" label={t('apSaveVitals')} onPress={save} style={{ minHeight: 56, borderRadius: 16 }} />
    </Sheet>
  );
}
