import React, { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { Avatar, Btn, Card, Chip, Screen, Sheet, SpeakButton, Switch, T, TopBar } from '../../components/ui';
import { Icon, type IconName } from '../../components/Icon';
import { LanguageSheet } from '../../components/LanguageSheet';
import { useDb, useSession, useSync } from '../../lib/session';
import { useLock } from '../../lib/lock';
import { db, kvGet, q } from '../../lib/db';
import { syncNow, assignment } from '../../lib/sync';
import { openAppSettings } from '../../lib/shift';
import { APP_VERSION } from '../../lib/config';
import { monthName, relDay, timeOf } from '../../lib/format';
import { LANGS } from '../../i18n';
import { myPhotoUrl } from '../../lib/profile';
import { C } from '../../theme';
import { oldPhone, setPerfMode, useLite, usePerfMode, type PerfMode } from '../../lib/perf';
import { savedFeedback, setPrefs, usePrefs, type TextSize } from '../../lib/prefs';

export default function Me() {
  const lock = useLock();
  const { t, lang, agent, signOut } = useSession();
  const sync = useSync();
  const [langOpen, setLangOpen] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [perfOpen, setPerfOpen] = useState(false);
  const light = useLite();
  const pm = usePerfMode();

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
  const photo = useDb(() => myPhotoUrl());

  return (
    <Screen header={<TopBar title={t('me')} onBack={false} explain={t('uxEasyExplain')} />}>
      <Card onPress={() => router.push('/profile')} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar name={agent?.name ?? '?'} size={52} uri={photo} />
        <View style={{ flex: 1 }}>
          <T style={{ fontSize: 18, fontWeight: '800' }}>{agent?.name}</T>
          <T style={{ color: C.text2, fontSize: 13 }}>{[agent?.agentId, block, agent?.district].filter(Boolean).join(' · ')}</T>
          <T style={{ color: C.blueInk, fontSize: 13, fontWeight: '700', marginTop: 2 }}>{t('pfEdit')}</T>
        </View>
        <Icon name="chevron" color={C.muted} />
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

      <EasyToUse />

      <T style={{ fontSize: 17, fontWeight: '700', marginTop: 4 }}>{t('monthNumbers')} · {monthName(lang, new Date())}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Num n={d.days} label={t('workedDays')} />
        <Num n={d.visits} label={t('visits')} />
        <Num n={d.partners} label={t('newPartners')} />
        <Num n={d.referred} label={t('patientsReferred')} />
      </View>

      <Row icon="chat" label={t('chatTitle')} sub={t('chatPrivate')} onPress={() => router.push('/chat')} />
      <Row icon="calendar" label={t('attendanceAndLeave')} sub={t('daysWorked', { n: d.days })} onPress={() => router.push('/attendance')} />
      <Row icon="lock" label={t('quTitle')} sub={lock.pinSet ? `${t('quOn')}${lock.bio ? ' · ' + t('quUseBio') : ''}` : t('quOff')} onPress={() => router.push('/quick-unlock')} />
      <Row icon="bolt" label={t('perfTitle')} sub={pm === 'auto' ? `${t('perfAuto')} · ${light ? t('perfOn') : t('perfOff')}` : light ? t('perfOn') : t('perfOff')} onPress={() => setPerfOpen(true)} />
      <Row icon="globe" label={t('language')} sub={LANGS.find((l) => l.code === lang)?.label} onPress={() => setLangOpen(true)} />
      <Row icon="battery" label={t('batteryLocation')} onPress={openAppSettings} />
      <Row icon="logout" label={t('logout')} danger onPress={logout} />
      <T style={{ textAlign: 'center', color: C.muted, fontSize: 12, marginTop: 8 }}>{t('appName')} · {t('version', { v: APP_VERSION })}</T>
      <LanguageSheet visible={langOpen} onClose={() => setLangOpen(false)} />
      <Sheet visible={perfOpen} onClose={() => setPerfOpen(false)} title={t('perfTitle')}>
        <T style={{ color: C.text2, lineHeight: 21 }}>{t('perfHelp')}</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(['auto', 'lite', 'full'] as PerfMode[]).map((m) => (
            <Chip key={m} big label={m === 'auto' ? t('perfAuto') : m === 'lite' ? t('perfOn') : t('perfOff')} selected={pm === m}
              onPress={() => setPerfMode(m)} />
          ))}
        </View>
        <T style={{ color: C.text2, fontSize: 13 }}>{oldPhone ? t('perfThisOld') : t('perfThisNew')}</T>
        <Btn label={t('fltDone')} onPress={() => setPerfOpen(false)} />
      </Sheet>
    </Screen>
  );
}

/** Me → Easy to use: language, text size, sunlight mode, read aloud, vibrate, and the Vita tour. */
function EasyToUse() {
  const { t, lang, setLang } = useSession();
  const p = usePrefs();
  const sizes: { code: TextSize; label: string; aa: number }[] = [
    { code: 'normal', label: t('uxSizeNormal'), aa: 16 },
    { code: 'large', label: t('uxSizeLarge'), aa: 20 },
    { code: 'xl', label: t('uxSizeXl'), aa: 24 },
  ];
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
        <T style={{ flex: 1, fontSize: 20, fontWeight: '800' }}>{t('uxEasy')}</T>
        <SpeakButton text={`${t('uxEasy')}. ${t('uxEasyExplain')}`} />
      </View>
      <Card style={{ padding: 16, gap: 12 }}>
        <T style={{ fontSize: 17, fontWeight: '800' }}>{t('language')}</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {LANGS.map((l) => {
            const on = l.code === lang;
            return (
              <Pressable key={l.code} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => setLang(l.code)}
                style={{ width: '48.5%', minHeight: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8,
                  borderWidth: on ? 0 : 1, borderColor: C.borderStrong, backgroundColor: on ? C.blue : C.card }}>
                <T style={{ fontSize: 18, fontWeight: '700', color: on ? '#fff' : C.text }}>{l.label}</T>
              </Pressable>
            );
          })}
        </View>
      </Card>
      <Card style={{ padding: 16, gap: 12 }}>
        <T style={{ fontSize: 17, fontWeight: '800' }}>{t('uxTextSize')}</T>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {sizes.map((z) => {
            const on = p.textSize === z.code;
            return (
              <Pressable key={z.code} accessibilityRole="radio" accessibilityLabel={z.label} accessibilityState={{ selected: on }}
                onPress={() => setPrefs({ textSize: z.code })}
                style={{ flex: 1, minHeight: 64, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingVertical: 6,
                  borderWidth: on ? 2 : 1, borderColor: on ? C.blue : C.borderStrong, backgroundColor: on ? C.blueSoft : C.card }}>
                {/* The "Aa" preview keeps its own size so the three stay comparable. */}
                <Text allowFontScaling={false} style={{ fontSize: z.aa, fontWeight: '800', color: on ? C.blueInk : C.text }}>Aa</Text>
                <T style={{ fontSize: 13, fontWeight: on ? '700' : '400', color: on ? C.blueInk : C.text2, textAlign: 'center' }} numberOfLines={2}>{z.label}</T>
              </Pressable>
            );
          })}
        </View>
      </Card>
      <Card style={{ padding: 0, gap: 0 }}>
        <SettingRow icon={<SunIcon />} tint={C.warnSoft} title={t('uxSun')} sub={t('uxSunSub')}
          right={<Switch label={t('uxSun')} value={p.sunlight} onChange={(v) => setPrefs({ sunlight: v })} />} />
        <SettingRow icon={<Icon name="volume" color={C.blue} />} tint={C.blueSoft} title={t('uxRead')} sub={t('uxReadSub')}
          right={<Switch label={t('uxRead')} value={p.readAloud} onChange={(v) => setPrefs({ readAloud: v })} />} />
        <SettingRow icon={<BuzzIcon />} tint={C.okSoft} title={t('uxVibrate')} sub={t('uxVibrateSub')}
          right={<Switch label={t('uxVibrate')} value={p.vibrate} onChange={(v) => { setPrefs({ vibrate: v }); if (v) savedFeedback(); }} />} />
        <SettingRow icon={<Icon name="sparkle" color={C.purple} />} tint={C.purpleSoft} title={t('uxTour')} sub={t('uxTourSub')} last
          onPress={() => router.push('/tour')} right={<Icon name="chevron" color={C.muted} />} />
      </Card>
    </>
  );
}

function SettingRow({ icon, tint, title, sub, right, onPress, last }: { icon: React.ReactNode; tint: string; title: string; sub: string; right: React.ReactNode; onPress?: () => void; last?: boolean }) {
  const body = (
    <>
      <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }}>{icon}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <T style={{ fontSize: 16, fontWeight: '700' }}>{title}</T>
        <T style={{ fontSize: 14, color: C.text2 }}>{sub}</T>
      </View>
      {right}
    </>
  );
  const style = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingHorizontal: 16, paddingVertical: 14, minHeight: 64,
    borderBottomWidth: last ? 0 : 1, borderBottomColor: C.line };
  return onPress
    ? <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [style, pressed && { opacity: 0.7 }]}>{body}</Pressable>
    : <View style={style}>{body}</View>;
}

function SunIcon() {
  const p = { stroke: C.warnInk, strokeWidth: 2, fill: 'none', strokeLinecap: 'round' as const };
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24">
      <Circle {...p} cx={12} cy={12} r={4} />
      <Path {...p} d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Svg>
  );
}

function BuzzIcon() {
  const p = { stroke: C.ok, strokeWidth: 2, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24">
      <Path {...p} d="M8 4h8v16H8z" />
      <Path {...p} d="M4 8v8M20 8v8M2 10v4M22 10v4" />
    </Svg>
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
