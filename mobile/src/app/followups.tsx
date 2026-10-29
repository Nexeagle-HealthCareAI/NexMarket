import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { BottomNav, Btn, Card, Chip, Empty, Field, Screen, T, TopBar, toast } from '../components/ui';
import { Icon } from '../components/Icon';
import { MoveSheet } from '../components/MoveSheet';
import { useDb, useSession } from '../lib/session';
import { db, type Contact } from '../lib/db';
import { setFollowUp } from '../lib/repo';
import { callNumber, openDirections } from '../lib/links';
import { dayShort, weekday } from '../lib/format';
import { addDays, daysFromToday, ymd } from '../lib/util';
import { C, PRIORITY_COLOR, type Priority } from '../theme';

type Row = Contact & { place: string | null; pLat: number | null; pLng: number | null; refs: number };
type Mode = 'followUps' | 'all';
const PRIOS: Priority[] = ['very_high', 'high', 'normal', 'low'];
const RANK: Record<string, number> = { very_high: 0, high: 1, normal: 2, low: 3 };

export default function FollowUps() {
  const { t, lang } = useSession();
  const [mode, setMode] = useState<Mode>('followUps');
  const [day, setDay] = useState<string>('due'); // 'due' = overdue + today
  const [prio, setPrio] = useState<Priority | null>(null);
  const [term, setTerm] = useState('');
  const [moving, setMoving] = useState<string | null>(null);

  const rows = useDb(() => db().getAllSync<Row>(
    `SELECT c.*, COALESCE(a.name, p.name) AS place, COALESCE(a.lat, p.lat) AS pLat, COALESCE(a.lng, p.lng) AS pLng,
            (SELECT COUNT(*) FROM referrals r WHERE r.contactId = c.clientId) AS refs
       FROM contacts c LEFT JOIN assigned a ON a.panchayatId = c.panchayatId LEFT JOIN panchayats p ON p.id = c.panchayatId`));

  const today = ymd();
  const strip = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(new Date(), i + 1)), []);
  const countFor = (key: string) => rows.filter((r) => r.followUpDate && (key === 'due' ? r.followUpDate <= today : r.followUpDate === key)).length;

  const list = useMemo(() => {
    let l = rows;
    if (mode === 'followUps') l = l.filter((r) => r.followUpDate && (day === 'due' ? r.followUpDate <= today : r.followUpDate === day));
    if (prio) l = l.filter((r) => r.priority === prio);
    const s = term.trim().toLowerCase();
    if (s) l = l.filter((r) => r.name.toLowerCase().includes(s) || (r.phone ?? '').includes(s) || (r.place ?? '').toLowerCase().includes(s));
    return [...l].sort((a, b) => (RANK[a.priority] ?? 2) - (RANK[b.priority] ?? 2)
      || (a.followUpDate ?? '9').localeCompare(b.followUpDate ?? '9') || a.name.localeCompare(b.name));
  }, [rows, mode, day, prio, term, today]);

  return (
    <Screen header={<TopBar title={mode === 'followUps' ? t('followUps') : t('myPartners', { n: rows.length })} onBack={false} />} footer={<BottomNav />}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><Chip big label={t('followUps')} selected={mode === 'followUps'} onPress={() => setMode('followUps')} /></View>
        <View style={{ flex: 1 }}><Chip big label={t('allPartners')} selected={mode === 'all'} onPress={() => setMode('all')} /></View>
      </View>

      {mode === 'followUps' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          <DayCell top={t('overdue')} bottom={t('today')} n={countFor('due')} on={day === 'due'} warn onPress={() => setDay('due')} />
          {strip.map((d) => {
            const k = ymd(d);
            return <DayCell key={k} top={weekday(lang, d)} bottom={String(d.getDate())} n={countFor(k)} on={day === k} onPress={() => setDay(k)} />;
          })}
        </ScrollView>
      ) : (
        <Field placeholder={t('searchPartners')} value={term} onChangeText={setTerm} autoCorrect={false} />
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        <Chip label={t('all')} selected={!prio} onPress={() => setPrio(null)} />
        {PRIOS.map((p) => <Chip key={p} label={t(`priority_${p}`)} selected={prio === p} color={PRIORITY_COLOR[p].dot} onPress={() => setPrio(p)} />)}
      </ScrollView>

      {list.length === 0 ? <Empty text={t('noFollowUps')} icon="calendar" /> : null}
      {list.map((c) => {
        const pc = PRIORITY_COLOR[c.priority] ?? PRIORITY_COLOR.normal;
        const fu = c.followUpDate ? daysFromToday(c.followUpDate) : null;
        const lat = c.lat ?? c.pLat;
        const lng = c.lng ?? c.pLng;
        return (
          <Card key={c.clientId} onPress={() => router.push({ pathname: '/partner/[id]', params: { id: c.clientId } })}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: pc.dot, marginTop: 6 }} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {c.refs >= 5 || c.priority === 'very_high' ? <Icon name="star" size={15} color={C.star} /> : null}
                  <T style={{ fontSize: 16, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>{c.name}</T>
                </View>
                <T style={{ color: C.text2, fontSize: 13 }} numberOfLines={1}>{[t(`type_${c.role}` as never), c.place].filter(Boolean).join(' · ')}</T>
                {fu != null ? (
                  <T style={{ fontSize: 13, fontWeight: '600', color: fu < 0 ? C.warnInk : C.blueInk }}>
                    {fu < 0 ? t('followUpOverdue', { n: -fu }) : t('followUpOn', { date: fu === 0 ? t('today') : fu === 1 ? t('tomorrow') : dayShort(lang, c.followUpDate!) })}
                  </T>
                ) : null}
              </View>
              <T style={{ color: pc.fg, fontSize: 12, fontWeight: '700' }}>{t(`priority_${c.priority}`)}</T>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn flex small kind="secondary" icon="phone" label={t('call')} disabled={!c.phone} onPress={() => callNumber(c.phone)} />
              <Btn flex small kind="secondary" icon="nav" label={t('goMeet')} disabled={lat == null || lng == null} onPress={() => lat != null && lng != null && openDirections(lat, lng)} />
              <Btn flex small kind="ghost" icon="calendar" label={t('moveFollowUp')} onPress={() => setMoving(c.clientId)} />
            </View>
          </Card>
        );
      })}
      <MoveSheet visible={!!moving} onClose={() => setMoving(null)} onPick={(d) => { if (moving) setFollowUp(moving, d); setMoving(null); toast(t('savedOnPhone')); }} />
    </Screen>
  );
}

function DayCell({ top, bottom, n, on, warn, onPress }: { top: string; bottom: string; n: number; on: boolean; warn?: boolean; onPress: () => void }) {
  const bg = on ? (warn ? C.warn : C.blue) : C.card;
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: on }}
      style={{ minWidth: 60, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 14, alignItems: 'center', gap: 2, backgroundColor: bg, borderWidth: 1, borderColor: on ? bg : C.border }}>
      <T style={{ fontSize: 12, color: on ? '#fff' : C.text2 }}>{top}</T>
      <T style={{ fontSize: 16, fontWeight: '800', color: on ? '#fff' : C.text }}>{bottom}</T>
      <View style={{ minWidth: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: on ? 'rgba(255,255,255,0.25)' : n ? (warn ? C.warnSoft : C.blueSoft) : C.line }}>
        <T style={{ fontSize: 11, fontWeight: '700', textAlign: 'center', color: on ? '#fff' : warn ? C.warnInk : C.blueInk }}>{n}</T>
      </View>
    </Pressable>
  );
}
