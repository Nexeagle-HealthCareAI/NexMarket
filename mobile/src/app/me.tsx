import React, { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Avatar, BottomNav, Btn, Card, Screen, T, TopBar } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { LanguageSheet } from '../components/LanguageSheet';
import { useDb, useSession, useSync } from '../lib/session';
import { db, kvGet, q } from '../lib/db';
import { syncNow, assignment } from '../lib/sync';
import { openAppSettings } from '../lib/shift';
import { APP_VERSION } from '../lib/config';
import { monthName, relDay, timeOf } from '../lib/format';
import { LANGS } from '../i18n';
import { C } from '../theme';

export default function Me() {
  const { t, lang, agent, signOut } = useSession();
  const sync = useSync();
  const [langOpen, setLangOpen] = useState(false);
  const [showQueue, setShowQueue] = useState(false);

  const d = useDb(() => {
    const ms = new Date(); ms.setDate(1); ms.setHours(0, 0, 0, 0);
    const since = ms.toISOString();
    const one = (sql: string) => db().getFirstSync<{ n: number }>(sql, since)?.n ?? 0;
    return {
      outbox: q.outbox(),
      lastSync: kvGet('lastSyncAt'),
      visits: one('SELECT COUNT(*) AS n FROM visits WHERE checkInAt >= ?'),
      partners: one('SELECT COUNT(*) AS n FROM contacts WHERE createdAt >= ?'),
      referred: one('SELECT COUNT(*) AS n FROM referrals WHERE createdAt >= ?'),
      days: one("SELECT COUNT(DISTINCT substr(startTime, 1, 10)) AS n FROM shifts WHERE startTime >= ?"),
    };
  });
  const unsent = d.outbox.length;

  const logout = () => {
    const go = () => { void signOut(); };
    if (unsent > 0) {
      Alert.alert(t('logout'), t('logoutUnsent', { n: unsent }), [
        { text: t('sendNow'), onPress: () => { void syncNow(true); } },
        { text: t('logoutAnyway'), style: 'destructive', onPress: go },
        { text: t('cancel'), style: 'cancel' },
      ]);
    } else {
      Alert.alert(t('logout'), t('logoutConfirm'), [{ text: t('cancel'), style: 'cancel' }, { text: t('logout'), style: 'destructive', onPress: go }]);
    }
  };

  const block = assignment().block ?? agent?.block ?? '';

  return (
    <Screen header={<TopBar title={t('me')} onBack={false} />} footer={<BottomNav />}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar name={agent?.name ?? '?'} size={52} />
        <View style={{ flex: 1 }}>
          <T style={{ fontSize: 18, fontWeight: '800' }}>{agent?.name}</T>
          <T style={{ color: C.text2, fontSize: 13 }}>{[agent?.agentId, block, agent?.district].filter(Boolean).join(' · ')}</T>
        </View>
      </Card>

      <Card style={unsent ? { borderColor: '#f5d9a8', backgroundColor: C.warnSoft } : { borderColor: C.okSoft, backgroundColor: C.okSoft }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon name={unsent ? (sync.online ? 'upload' : 'cloudOff') : 'check'} color={unsent ? C.warnInk : C.okInk} />
          <View style={{ flex: 1 }}>
            <T style={{ fontWeight: '700', color: unsent ? C.warnInk : C.okInk }}>{unsent ? t('unsentItems', { n: unsent }) : t('everythingSent')}</T>
            <T style={{ fontSize: 13, color: unsent ? C.warnInk : C.okInk }}>
              {d.lastSync ? t('lastSent', { time: `${relDay(t, lang, d.lastSync)} ${timeOf(lang, d.lastSync)}` }) : ''}
              {!sync.online ? ` · ${t('noNetwork')}` : ''}
            </T>
          </View>
          <Btn small kind={unsent ? 'primary' : 'secondary'} icon="refresh" label={sync.running ? t('sending') : t('sendNow')} loading={sync.running} onPress={() => { void syncNow(true); }} />
        </View>
        {unsent ? <T style={{ fontSize: 13, color: C.warnInk }}>{t('nothingLost')}</T> : null}
        {sync.lastError ? <T style={{ fontSize: 13, color: C.bad }}>{t('outboxError', { msg: sync.lastError })}</T> : null}
        {unsent ? (
          <Pressable onPress={() => setShowQueue(!showQueue)}><T style={{ color: C.blueInk, fontWeight: '600' }}>{showQueue ? '▲' : '▼'} {t('unsentItems', { n: unsent })}</T></Pressable>
        ) : null}
        {showQueue ? d.outbox.slice(0, 50).map((o) => (
          <View key={o.id} style={{ flexDirection: 'row', gap: 8, paddingVertical: 4, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)' }}>
            <T style={{ flex: 1, fontSize: 13 }}>{t(`out_${o.type}` as never)}</T>
            <T style={{ fontSize: 12, color: o.lastError ? C.bad : C.text2 }} numberOfLines={1}>{o.lastError ? o.lastError : timeOf(lang, o.createdAt)}</T>
          </View>
        )) : null}
      </Card>

      <T style={{ fontSize: 17, fontWeight: '700', marginTop: 4 }}>{t('monthNumbers')} · {monthName(lang, new Date())}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Num n={d.days} label={t('workedDays')} />
        <Num n={d.visits} label={t('visits')} />
        <Num n={d.partners} label={t('newPartners')} />
        <Num n={d.referred} label={t('patientsReferred')} />
      </View>

      <Row icon="calendar" label={t('attendanceAndLeave')} sub={t('daysWorked', { n: d.days })} onPress={() => router.push('/attendance')} />
      <Row icon="globe" label={t('language')} sub={LANGS.find((l) => l.code === lang)?.label} onPress={() => setLangOpen(true)} />
      <Row icon="battery" label={t('batteryLocation')} onPress={openAppSettings} />
      <Row icon="logout" label={t('logout')} danger onPress={logout} />
      <T style={{ textAlign: 'center', color: C.muted, fontSize: 12, marginTop: 8 }}>{t('appName')} · {t('version', { v: APP_VERSION })}</T>
      <LanguageSheet visible={langOpen} onClose={() => setLangOpen(false)} />
    </Screen>
  );
}

function Num({ n, label }: { n: number; label: string }) {
  return (
    <View style={{ width: '48.5%', backgroundColor: C.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border }}>
      <T style={{ fontSize: 26, fontWeight: '800' }}>{n}</T>
      <T style={{ color: C.text2, fontSize: 13 }}>{label}</T>
    </View>
  );
}

function Row({ icon, label, sub, onPress, danger }: { icon: IconName; label: string; sub?: string; onPress: () => void; danger?: boolean }) {
  return (
    <Card onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Icon name={icon} color={danger ? C.bad : C.blue} />
      <View style={{ flex: 1 }}>
        <T style={{ fontWeight: '700', color: danger ? C.bad : C.text }}>{label}</T>
        {sub ? <T style={{ color: C.text2, fontSize: 13 }}>{sub}</T> : null}
      </View>
      {!danger ? <Icon name="chevron" color={C.muted} /> : null}
    </Card>
  );
}
