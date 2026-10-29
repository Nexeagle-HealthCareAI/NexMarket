import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Btn, Card, Field, Screen, T, Toggle, TopBar, toast } from '../components/ui';
import { Icon } from '../components/Icon';
import { useSession } from '../lib/session';
import { ApiError, get, OfflineError, post } from '../lib/api';
import { kvJson } from '../lib/db';
import { dayLong, dayShort } from '../lib/format';
import { addDays, errorMessage, parseYmd, ymd } from '../lib/util';
import type { AttendanceResp } from './attendance';
import { C } from '../theme';

type LeaveType = 'urgent' | 'holiday';
interface Preview { days: number; followUpsAffected: number; moveTo: string }

export default function ApplyLeave() {
  const { t, lang } = useSession();
  const [type, setType] = useState<LeaveType>('holiday');
  const [from, setFrom] = useState(ymd(addDays(new Date(), 1)));
  const [to, setTo] = useState(ymd(addDays(new Date(), 1)));
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const now = new Date();
  const att = kvJson<AttendanceResp | null>(`att:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, null);
  const remaining = att?.allowance.remaining ?? null;

  // Urgent leave is for today or tomorrow; holiday leave is planned ahead.
  const minFrom = type === 'urgent' ? ymd() : ymd(addDays(new Date(), 1));
  const maxFrom = type === 'urgent' ? ymd(addDays(new Date(), 1)) : ymd(addDays(new Date(), 365));
  useEffect(() => {
    if (from < minFrom) setFrom(minFrom);
    if (from > maxFrom) setFrom(maxFrom);
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (to < from) setTo(from); }, [from, to]);
  useEffect(() => { if (from !== to) setHalfDay(false); }, [from, to]);

  useEffect(() => {
    let alive = true;
    setPreview(null);
    const id = setTimeout(async () => {
      try {
        const p = await get<Preview>(`/api/v1/me/leaves/preview?from=${from}&to=${to}&halfDay=${halfDay}`);
        if (alive) setPreview(p);
      } catch { /* preview is a nicety; sending still validates */ }
    }, 300);
    return () => { alive = false; clearTimeout(id); };
  }, [from, to, halfDay]);

  const send = async () => {
    if (!reason.trim()) { setError(t('needReason')); return; }
    if (to < from) { setError(t('dateOrder')); return; }
    if (preview && remaining != null && preview.days > remaining) { setError(t('notEnoughLeave', { n: remaining })); return; }
    setBusy(true);
    setError(null);
    try {
      await post('/api/v1/me/leaves', { type, fromDate: from, toDate: to, halfDay, reason: reason.trim() });
      toast(t('leaveSent'));
      router.back();
    } catch (e) {
      setError(e instanceof OfflineError ? t('needInternet') : e instanceof ApiError ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen header={<TopBar title={t('applyLeave')} sub={remaining != null ? t('leaveLeft', { n: remaining }) : undefined} />}
      footer={<View style={{ padding: 16, gap: 6, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border }}>
        <Btn label={t('sendRequest')} icon="upload" onPress={send} loading={busy} />
        <T style={{ textAlign: 'center', color: C.text2, fontSize: 12 }}>{t('leaveSentHint')}</T>
      </View>}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['urgent', 'holiday'] as LeaveType[]).map((k) => {
          const on = type === k;
          return (
            <Pressable key={k} onPress={() => setType(k)} accessibilityRole="radio" accessibilityState={{ selected: on }}
              style={{ flex: 1, padding: 14, borderRadius: 16, gap: 4, borderWidth: on ? 2 : 1, borderColor: on ? (k === 'urgent' ? C.bad : C.purple) : C.borderStrong, backgroundColor: on ? (k === 'urgent' ? C.badSoft : C.purpleSoft) : C.card }}>
              <Icon name={k === 'urgent' ? 'alert' : 'calendar'} color={k === 'urgent' ? C.bad : C.purple} />
              <T style={{ fontWeight: '800', fontSize: 16 }}>{k === 'urgent' ? t('leaveUrgent') : t('leaveHoliday')}</T>
              <T style={{ color: C.text2, fontSize: 13 }}>{k === 'urgent' ? t('leaveUrgentSub') : t('leaveHolidaySub')}</T>
            </Pressable>
          );
        })}
      </View>

      <DateStepper label={t('fromDate')} value={from} min={minFrom} max={maxFrom} onChange={setFrom} lang={lang} />
      <DateStepper label={t('toDate')} value={to} min={from} max={ymd(addDays(parseYmd(from), 60))} onChange={setTo} lang={lang} />
      {from === to ? <Toggle label={t('halfDay')} value={halfDay} onChange={setHalfDay} /> : null}
      <Field label={t('reason')} value={reason} onChangeText={(v) => { setReason(v); setError(null); }} multiline maxLength={500} />

      {preview ? (
        <Card style={{ backgroundColor: C.blueSoft, borderColor: C.blueSoft }}>
          <T style={{ fontWeight: '800', color: C.blueInk, fontSize: 17 }}>{t('leaveDays', { n: preview.days })}</T>
          {preview.followUpsAffected > 0 ? (
            <T style={{ color: C.blueInk }}>{t('followUpsMove', { n: preview.followUpsAffected, date: dayShort(lang, preview.moveTo) })}</T>
          ) : null}
          {remaining != null ? <T style={{ color: C.blueInk, fontSize: 13 }}>{t('leaveLeft', { n: Math.max(0, remaining - preview.days) })}</T> : null}
        </Card>
      ) : null}
      {error ? <T style={{ color: C.bad, fontWeight: '600' }}>{error}</T> : null}
    </Screen>
  );
}

function DateStepper({ label, value, min, max, onChange, lang }: { label: string; value: string; min: string; max: string; onChange: (v: string) => void; lang: Parameters<typeof dayLong>[0] }) {
  const step = (n: number) => {
    const next = ymd(addDays(parseYmd(value), n));
    if (next >= min && next <= max) onChange(next);
  };
  return (
    <View style={{ gap: 6 }}>
      <T style={{ fontSize: 14, fontWeight: '600', color: C.text3 }}>{label}</T>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.borderStrong, padding: 4 }}>
        <Pressable onPress={() => step(-1)} disabled={value <= min} accessibilityLabel={`${label} -1`} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: value <= min ? 0.3 : 1 }}>
          <Icon name="back" />
        </Pressable>
        <T style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700' }}>{dayLong(lang, parseYmd(value))}</T>
        <Pressable onPress={() => step(1)} disabled={value >= max} accessibilityLabel={`${label} +1`} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: value >= max ? 0.3 : 1 }}>
          <Icon name="chevron" />
        </Pressable>
      </View>
    </View>
  );
}
