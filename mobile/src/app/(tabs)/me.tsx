import React, { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import { Avatar, Btn, Card, Chip, MainHeader, Screen, Sheet, SpeakButton, Switch, T } from '../../components/ui';
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
import { useMoney } from '../../lib/useMoney';
import { inr } from '../../lib/money';

export default function Me() {
  const lock = useLock();
  const { t, lang, agent, signOut } = useSession();
  const sync = useSync();
  const [langOpen, setLangOpen] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [perfOpen, setPerfOpen] = useState(false);
  const [easyOpen, setEasyOpen] = useState(false);
  const prefs = usePrefs();
  const money = useMoney();
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
    <Screen bg={C.ink} contentStyle={{ backgroundColor: C.bg, flexGrow: 1 }} header={(
      <MainHeader title={agent?.name ?? t('me')} sub={[agent?.agentId, block, agent?.district].filter(Boolean).join(' · ')}
        left={<Avatar name={agent?.name ?? '?'} size={48} uri={photo} />}
        right={(
          <Pressable onPress={() => router.push('/profile')} accessibilityRole="button" accessibilityLabel={t('pfEdit')} hitSlop={4}
            style={({ pressed }) => [{ height: 44, width: 44, borderRadius: 22, borderWidth: 1, borderColor: C.inkLine, backgroundColor: C.ink2, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.7 }]}>
            <Icon name="pencil" size={20} color="#fff" />
          </Pressable>
        )} />
    )}>
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

      {/* This month, in one line of four. */}
      <View accessible accessibilityLabel={`${t('monthNumbers')} ${monthName(lang, new Date())}`} style={{ flexDirection: 'row', backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, paddingVertical: 10 }}>
        <Num n={d.days} label={t('workedDays')} />
        <Num n={d.visits} label={t('visits')} />
        <Num n={d.partners} label={t('newPartners')} />
        <Num n={d.referred} label={t('patientsReferred')} />
      </View>

      <Group title={t('meWork')}>
        <Row icon="calendar" label={t('attendanceAndLeave')} sub={t('daysWorked', { n: d.days })} onPress={() => router.push('/attendance')} />
        {money ? <Row icon="doc" label={t('moneyCard')} sub={t('moneyCardSub', { paid: inr(money.summary.partnerPaid), waiting: inr(money.summary.partnerWaiting) })} onPress={() => router.push('/money')} /> : null}
        <Row icon="billboard" label={t('hdTitle')} onPress={() => router.push('/hoardings')} />
        <Row icon="map" label={t('fsTitle')} onPress={() => router.push('/field-surveys')} last />
      </Group>

      <Group title={t('meApp')}>
        <Row icon="globe" label={t('language')} sub={LANGS.find((l) => l.code === lang)?.label} onPress={() => setLangOpen(true)} />
        <Row icon="volume" label={t('uxEasy')} sub={[t('uxTextSize'), t('uxRead'), t('uxVibrate')].join(' · ')} onPress={() => setEasyOpen(true)} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 60, borderBottomWidth: 1, borderBottomColor: C.line }}>
          <SunIcon />
          <View style={{ flex: 1 }}>
            <T style={{ fontSize: 16, fontWeight: '700' }}>{t('uxSun')}</T>
            <T style={{ color: C.text2, fontSize: 13 }}>{t('uxSunSub')}</T>
          </View>
          <Switch label={t('uxSun')} value={prefs.sunlight} onChange={(v) => setPrefs({ sunlight: v })} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 8, minHeight: 60, borderBottomWidth: 1, borderBottomColor: C.line }}>
          <Icon name="video" color={C.blue} size={22} />
          <View style={{ flex: 1 }}>
            <T style={{ fontSize: 16, fontWeight: '700' }}>{t('clSaver')}</T>
            <T style={{ color: C.text2, fontSize: 13 }}>{t('clSaverSub')}</T>
          </View>
          <Switch label={t('clSaver')} value={prefs.dataSaver} onChange={(v) => setPrefs({ dataSaver: v })} />
        </View>
        <Row icon="lock" label={t('quTitle')} sub={lock.pinSet ? `${t('quOn')}${lock.bio ? ' · ' + t('quUseBio') : ''}` : t('quOff')} onPress={() => router.push('/quick-unlock')} />
        <Row icon="bolt" label={t('perfTitle')} sub={pm === 'auto' ? `${t('perfAuto')} · ${light ? t('perfOn') : t('perfOff')}` : light ? t('perfOn') : t('perfOff')} onPress={() => setPerfOpen(true)} />
        <Row icon="battery" label={t('batteryLocation')} onPress={openAppSettings} />
        <Row icon="sparkle" label={t('uxTour')} sub={t('uxTourSub')} onPress={() => router.push('/tour')} last />
      </Group>

      <Btn kind="danger" icon="logout" label={t('logout')} onPress={logout} />
      <T style={{ textAlign: 'center', color: C.muted, fontSize: 12, marginTop: 8 }}>{t('appName')} · {t('version', { v: APP_VERSION })}</T>
      <LanguageSheet visible={langOpen} onClose={() => setLangOpen(false)} />
      <Sheet visible={easyOpen} onClose={() => setEasyOpen(false)} title={t('uxEasy')}>
        <EasyToUse />
        <Btn label={t('fltDone')} onPress={() => setEasyOpen(false)} />
      </Sheet>
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
  const { t } = useSession();
  const p = usePrefs();
  const sizes: { code: TextSize; label: string; aa: number }[] = [
    { code: 'normal', label: t('uxSizeNormal'), aa: 16 },
    { code: 'large', label: t('uxSizeLarge'), aa: 20 },
    { code: 'xl', label: t('uxSizeXl'), aa: 24 },
  ];
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <T style={{ flex: 1, color: C.text2, fontSize: 14, lineHeight: 20 }}>{t('uxEasyExplain')}</T>
        <SpeakButton text={`${t('uxEasy')}. ${t('uxEasyExplain')}`} />
      </View>
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
        <SettingRow icon={<Icon name="volume" color={C.blue} />} tint={C.blueSoft} title={t('uxRead')} sub={t('uxReadSub')}
          right={<Switch label={t('uxRead')} value={p.readAloud} onChange={(v) => setPrefs({ readAloud: v })} />} />
        <SettingRow icon={<BuzzIcon />} tint={C.okSoft} title={t('uxVibrate')} sub={t('uxVibrateSub')}
          last right={<Switch label={t('uxVibrate')} value={p.vibrate} onChange={(v) => { setPrefs({ vibrate: v }); if (v) savedFeedback(); }} />} />
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
    <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 4, gap: 2 }}>
      <T style={{ fontSize: 22, fontWeight: '800' }}>{n}</T>
      <T style={{ color: C.text2, fontSize: 12, textAlign: 'center' }} numberOfLines={2}>{label}</T>
    </View>
  );
}

/** A titled list in one card: short rows instead of a card per setting, so the whole screen fits in about one view. */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <T style={{ fontSize: 13, fontWeight: '800', color: C.text2, letterSpacing: 0.5, textTransform: 'uppercase' }}>{title}</T>
      <View style={{ backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, overflow: 'hidden' }}>{children}</View>
    </View>
  );
}

function Row({ icon, label, sub, onPress, last }: { icon: IconName; label: string; sub?: string; onPress: () => void; last?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={sub ? `${label}. ${sub}` : label}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 8, minHeight: 60,
        borderBottomWidth: last ? 0 : 1, borderBottomColor: C.line }, pressed && { backgroundColor: C.line }]}>
      <Icon name={icon} color={C.blue} size={22} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T style={{ fontSize: 16, fontWeight: '700' }}>{label}</T>
        {sub ? <T style={{ color: C.text2, fontSize: 13 }} numberOfLines={1}>{sub}</T> : null}
      </View>
      <Icon name="chevron" color={C.muted} size={18} />
    </Pressable>
  );
}
