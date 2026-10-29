import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Btn, Card, Empty, Pill, Screen, T, TopBar } from '../components/ui';
import { Icon } from '../components/Icon';
import { useSession } from '../lib/session';
import { get, OfflineError, post } from '../lib/api';
import { kvJson, kvSet } from '../lib/db';
import { dayShort, monthName } from '../lib/format';
import { errorMessage } from '../lib/util';
import { C } from '../theme';

export interface AttendanceResp {
  month: string;
  days: { date: string; status: 'worked' | 'leave' | 'absent' | 'off' | 'future' | string; leaveType: string | null }[];
  summary: { worked: number; leave: number; absent: number };
  allowance: { year: number; total: number; used: number; pending: number; remaining: number };
}
export interface Leave {
  id: string; type: 'urgent' | 'holiday'; fromDate: string; toDate: string; halfDay: boolean; days: number; reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'; decidedBy: string | null; decisionNote: string | null; followUpsMoved: number | null;
}

const DAY_COLOR: Record<string, { bg: string; fg: string }> = {
  worked: { bg: C.ok, fg: '#fff' },
  leave: { bg: C.purple, fg: '#fff' },
  absent: { bg: C.badSoft, fg: C.bad },
  off: { bg: C.line, fg: C.muted },
  future: { bg: 'transparent', fg: C.text3 },
};
const STATUS_TONE = { pending: 'warn', approved: 'ok', rejected: 'bad', cancelled: 'muted' } as const;

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function Attendance() {
  const { t, lang } = useSession();
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const key = monthKey(month);
  const [att, setAtt] = useState<AttendanceResp | null>(() => kvJson<AttendanceResp | null>(`att:${key}`, null));
  const [leaves, setLeaves] = useState<Leave[]>(() => kvJson<Leave[]>('leaves', []));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, l] = await Promise.all([get<AttendanceResp>(`/api/v1/me/attendance?month=${key}`), get<Leave[]>('/api/v1/me/leaves')]);
      setAtt(a); setLeaves(l);
      kvSet(`att:${key}`, JSON.stringify(a));
      kvSet('leaves', JSON.stringify(l));
    } catch (e) {
      setError(e instanceof OfflineError ? t('needInternet') : errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [key, t]);

  useEffect(() => { setAtt(kvJson<AttendanceResp | null>(`att:${key}`, null)); }, [key]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const cancel = (l: Leave) => {
    Alert.alert(t('cancelLeave'), t('cancelLeaveConfirm'), [
      { text: t('close'), style: 'cancel' },
      { text: t('cancelLeave'), style: 'destructive', onPress: async () => {
        try { await post(`/api/v1/me/leaves/${l.id}/cancel`); await load(); } catch (e) { Alert.alert(t('cancelLeave'), e instanceof OfflineError ? t('needInternet') : errorMessage(e)); }
      } },
    ]);
  };

  // Calendar grid, Monday first.
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const daysIn = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const byDate = new Map((att?.days ?? []).map((d) => [d.date, d]));
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const wk = t('weekdaysShort').split(',');
  const isThisMonth = key === monthKey(new Date());

  return (
    <Screen header={<TopBar title={t('myAttendance')} sub={t('fromShifts')} right={loading ? <ActivityIndicator color={C.blue} style={{ marginRight: 8 }} /> : undefined} />}
      footer={<View style={{ padding: 16, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border }}>
        <Btn icon="leave" label={t('applyLeave')} onPress={() => router.push('/leave')} />
      </View>}>
      {error ? (
        <Card style={{ backgroundColor: C.warnSoft, borderColor: '#f5d9a8', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon name="cloudOff" color={C.warnInk} />
          <T style={{ flex: 1, color: C.warnInk }}>{error}</T>
          <Btn small kind="secondary" label={t('retry')} onPress={load} />
        </Card>
      ) : null}

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Pressable hitSlop={10} onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} style={{ padding: 6 }} accessibilityLabel="Previous month">
            <Icon name="back" />
          </Pressable>
          <T style={{ flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700' }}>{monthName(lang, month)}</T>
          <Pressable hitSlop={10} disabled={isThisMonth} onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} style={{ padding: 6, opacity: isThisMonth ? 0.3 : 1 }} accessibilityLabel="Next month">
            <Icon name="chevron" />
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row' }}>
          {wk.map((w) => <T key={w} style={{ flex: 1, textAlign: 'center', fontSize: 12, color: C.text2, fontWeight: '600' }}>{w}</T>)}
        </View>
        {Array.from({ length: cells.length / 7 }, (_, r) => (
          <View key={r} style={{ flexDirection: 'row' }}>
            {cells.slice(r * 7, r * 7 + 7).map((n, i) => {
              if (!n) return <View key={i} style={{ flex: 1, aspectRatio: 1 }} />;
              const date = `${key}-${String(n).padStart(2, '0')}`;
              const st = byDate.get(date)?.status ?? 'future';
              const col = DAY_COLOR[st] ?? DAY_COLOR.future;
              return (
                <View key={i} style={{ flex: 1, aspectRatio: 1, padding: 3 }}>
                  <View style={{ flex: 1, borderRadius: 10, backgroundColor: col.bg, alignItems: 'center', justifyContent: 'center' }}>
                    <T style={{ color: col.fg, fontWeight: '700', fontSize: 14 }}>{n}</T>
                  </View>
                </View>
              );
            })}
          </View>
        ))}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {(['worked', 'leave', 'absent', 'off'] as const).map((s) => (
            <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 12, height: 12, borderRadius: 4, backgroundColor: DAY_COLOR[s].bg, borderWidth: s === 'absent' ? 1 : 0, borderColor: C.bad }} />
              <T style={{ fontSize: 12, color: C.text2 }}>{t(`att_${s}`)}</T>
            </View>
          ))}
        </View>
      </Card>

      {att ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Stat n={att.summary.worked} label={t('workedDays')} color={C.okInk} />
          <Stat n={att.summary.leave} label={t('leaveTaken')} color={C.purple} />
          <Stat n={att.summary.absent} label={t('absentDays')} color={C.bad} />
        </View>
      ) : null}

      {att ? (
        <Card style={{ backgroundColor: C.purpleSoft, borderColor: C.purpleSoft }}>
          <T style={{ fontWeight: '700', color: C.purple }}>{t('leaveBalance', { remaining: att.allowance.remaining, total: att.allowance.total })}</T>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: '#fff', overflow: 'hidden', flexDirection: 'row' }}>
            <View style={{ width: `${Math.min(100, (att.allowance.used / Math.max(1, att.allowance.total)) * 100)}%`, backgroundColor: C.purple }} />
            <View style={{ width: `${Math.min(100, (att.allowance.pending / Math.max(1, att.allowance.total)) * 100)}%`, backgroundColor: '#b9a8ef' }} />
          </View>
        </Card>
      ) : null}

      <T style={{ fontSize: 17, fontWeight: '700', marginTop: 4 }}>{t('myLeaves')}</T>
      {leaves.length === 0 ? <Empty text={t('noLeaves')} icon="leave" /> : null}
      {leaves.map((l) => {
        const canCancel = l.status === 'pending' || (l.status === 'approved' && l.fromDate > new Date().toISOString().slice(0, 10));
        return (
          <Card key={l.id}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <T style={{ fontWeight: '700' }}>{l.type === 'urgent' ? t('leaveUrgent') : t('leaveHoliday')} · {t('leaveDays', { n: l.days })}</T>
                <T style={{ color: C.text2, fontSize: 13 }}>{dayShort(lang, l.fromDate)}{l.toDate !== l.fromDate ? ` – ${dayShort(lang, l.toDate)}` : ''}{l.halfDay ? ` · ${t('halfDay')}` : ''}</T>
              </View>
              <Pill label={t(`status_${l.status}`)} tone={STATUS_TONE[l.status] ?? 'muted'} />
            </View>
            <T style={{ color: C.text3, fontSize: 14 }}>{l.reason}</T>
            {l.decidedBy ? <T style={{ color: C.text2, fontSize: 12 }}>{t('approvedBy', { name: l.decidedBy })}{l.decisionNote ? ` · ${l.decisionNote}` : ''}</T> : null}
            {canCancel ? <Btn small kind="danger" label={t('cancelLeave')} onPress={() => cancel(l)} style={{ alignSelf: 'flex-start' }} /> : null}
          </Card>
        );
      })}
    </Screen>
  );
}

function Stat({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: C.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: C.border }}>
      <T style={{ fontSize: 24, fontWeight: '800', color }}>{n}</T>
      <T style={{ fontSize: 12, color: C.text2 }}>{label}</T>
    </View>
  );
}
