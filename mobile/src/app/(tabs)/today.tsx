import React, { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useIsFocused } from 'expo-router';
import { Vita, type VitaMood } from '../../components/Vita';
import { ChatHeadButton, HeadButton, T, toast } from '../../components/ui';
import { Icon, type IconName } from '../../components/Icon';
import { SyncStrip, useSyncSummary } from '../../components/SyncStrip';
import { NextStepCard, type StepAction, type StepTone } from '../../components/NextStepCard';
import { TaskSheet, TasksSection, dueLabel } from '../../components/TaskCard';
import { useDb, useSession } from '../../lib/session';
import { useHere } from '../../lib/useHere';
import { assignment } from '../../lib/sync';
import { resumeTrackingIfNeeded } from '../../lib/shift';
import { callNumber } from '../../lib/links';
import { formatDist } from '../../lib/plan';
import { duration, dayShort, timeOf, weekday } from '../../lib/format';
import { refreshTasks, setTaskDone, type Task } from '../../lib/tasks';
import { cachedNotifyUnread, useNotifyVersion } from '../../lib/notifications';
import { cachedThreads, cachedUnread, useChatVersion } from '../../lib/chat';
import { savedFeedback } from '../../lib/prefs';
import { explainOnce } from '../../lib/speak';
import { PHASES, phaseOf, readToday, type NextStep, type TodayData } from '../../lib/nextStep';
import { C } from '../../theme';
import type { Lang, TFn } from '../../i18n';

const greetingKey = () => {
  const h = new Date().getHours();
  return h < 12 ? 'goodMorning' : h < 17 ? 'goodAfternoon' : 'goodEvening';
};

const typeLabel = (t: TFn, role: string) => {
  const key = `type_${role}`;
  const v = t(key as never);
  return v && v !== key ? v : role.replace(/_/g, ' ');
};

const dueText = (t: TFn, overdueDays: number) => (overdueDays > 0 ? t('tdOverdueBy', { n: overdueDays }) : t('tdDueToday'));
const openPartner = (id: string) => router.push({ pathname: '/partner/[id]', params: { id } });
const endShiftScreen = () => router.push({ pathname: '/shift', params: { end: '1' } });

/** Mark a task done from Today; the dark bar offers Undo (the "done" tap is only queued, so undoing is cheap). */
function markTaskDone(t: TFn, task: Task) {
  setTaskDone(task.id, null);
  savedFeedback();
  toast(t('tdTaskDone'), { undo: () => setTaskDone(task.id, null, true) });
}

export default function Today() {
  const focused = useIsFocused(); // Vita only floats while Today is on screen
  const { t, agent, lang } = useSession();
  useNotifyVersion();
  useChatVersion();
  const notifyUnread = cachedNotifyUnread();
  const chatUnread = cachedUnread();
  const here = useHere();
  const sync = useSyncSummary();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [allTasks, setAllTasks] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    void resumeTrackingIfNeeded(t);
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [t]);
  useEffect(() => { void refreshTasks().catch(() => undefined); }, []);
  const explain = t('tdExplain');
  useEffect(() => { explainOnce('/today', explain, lang); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const data = useDb(() => readToday(here), [here?.lat, here?.lng]);
  const block = assignment().block ?? agent?.block ?? '';
  const firstName = agent?.name?.split(' ')[0] ?? '';
  const card = stepCard(data.step, data, t, lang);
  const phase = phaseOf(data.step);
  const currentTask = taskId ? [...data.tasks, ...(data.step.kind === 'task' ? [data.step.task] : [])].find((x) => x.id === taskId) ?? null : null;

  // Vita's pose follows the day.
  const hour = new Date().getHours();
  const late = data.followUps.filter((f) => f.overdueDays > 0).length;
  const pose: VitaMood = !data.onShift
    ? (hour >= 21 || hour < 5) ? 'sleep' : data.step.kind === 'start' && data.step.doneToday ? 'relax' : hour < 12 ? 'coffee' : 'wave'
    : data.step.kind === 'finish' ? 'cheer' : late > 0 ? 'stern' : hour === 13 ? 'snack' : 'fly';

  const shiftLabel = data.shiftStart
    ? t('tdOnShift', { time: duration(t, Date.now() - new Date(data.shiftStart).getTime()) })
    : data.step.kind === 'start' && data.step.doneToday ? t('tdShiftOver') : t('tdNoShift');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.ink }} edges={['top']}>
      {/* Header: the brand name, then chat and alerts with their counts. Language and read-aloud live under Me. */}
      <View style={{ backgroundColor: C.ink, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 18, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Image source={require('../../../assets/brand/logo.png')} style={{ width: 30, height: 30 }} resizeMode="contain" accessibilityIgnoresInvertColors />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T style={{ color: '#fff', fontSize: 19, fontWeight: '800' }}>NexEagle</T>
          </View>
          <ChatHeadButton />
          <HeadButton label={t('ntTitle')} badge={notifyUnread} onPress={() => router.push('/notifications')}>
            <Icon name="bell" size={20} color="#fff" />
          </HeadButton>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}>
          <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
            <T style={{ fontSize: 24, fontWeight: '800', color: '#fff', lineHeight: 30 }}>{t(greetingKey(), { name: firstName })}</T>
            <T style={{ fontSize: 15, color: '#c3cbdc' }}>{[`${weekday(lang, new Date())}, ${dayShort(lang, new Date())}`, block].filter(Boolean).join(' · ')}</T>
            <Pressable disabled={!data.onShift} onPress={endShiftScreen} accessibilityRole={data.onShift ? 'button' : 'text'}
              accessibilityLabel={data.onShift ? `${shiftLabel}. ${t('endShift')}` : shiftLabel}
              style={({ pressed }) => [{ alignSelf: 'flex-start', marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6,
                minHeight: 32, borderRadius: 999, backgroundColor: data.onShift ? '#123a2c' : 'rgba(255,255,255,0.08)' }, pressed && { opacity: 0.8 }]}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: data.onShift ? C.mint : C.sideText }} />
              <T style={{ fontSize: 14, fontWeight: '700', color: data.onShift ? '#7ff5c2' : '#c3cbdc' }}>{shiftLabel}</T>
            </Pressable>
            {/* All sent: one quiet line here. Anything waiting or no signal: the full strip below, which can be tapped. */}
            {sync.level === 'ok' ? (
              <View accessible accessibilityLabel={t('uxSyncOk')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon name="check" size={14} color={C.mint} strokeWidth={3} />
                <T style={{ fontSize: 13, color: '#c3cbdc' }} numberOfLines={1}>{[t('uxSyncOk'), sync.lastAt ? timeOf(lang, sync.lastAt) : ''].filter(Boolean).join(' · ')}</T>
              </View>
            ) : null}
          </View>
          {/* Vita, the AI helper: tap to ask. */}
          <Pressable onPress={() => router.navigate('/assistant')} accessibilityRole="button" accessibilityLabel={t('vitaTop')}
            style={({ pressed }) => [{ alignItems: 'center', gap: 2 }, pressed && { opacity: 0.85 }]}>
            <Vita mood={pose} height={pose === 'fly' ? 60 : 72} bob={focused} />
            <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(167,139,250,0.22)', borderWidth: 1, borderColor: 'rgba(167,139,250,0.5)' }}>
              <T style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{t('tabVita')}</T>
            </View>
          </Pressable>
        </View>
      </View>

      <View style={{ flex: 1, backgroundColor: C.bg }}>
        {sync.level !== 'ok' ? <SyncStrip /> : null}
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 28 }}>
          <NextStepCard label={phase >= PHASES && data.step.kind === 'start' ? t('tdDayDone') : t('tdStepOf', { i: phase, n: PHASES })}
            filled={phase} total={PHASES} {...card}
            secondary={card.secondary ?? (data.step.kind === 'task' ? { label: t('tdOpenTask'), onPress: () => setTaskId((data.step as { task: Task }).task.id) } : null)} />

          <AlsoToday data={data} chatUnread={chatUnread} t={t} lang={lang} onOpenTask={setTaskId} />

          {/* Three numbers instead of the old rings. */}
          <View style={{ flexDirection: 'row', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingVertical: 6 }}>
            <Stat n={data.visitsToday} label={t('tdStatVisits', { n: data.visitsToday })} />
            <Stat n={data.partnersToday} label={t('tdStatPartners', { n: data.partnersToday })} />
            <Stat n={data.patientsWeek} label={t('tdStatPatients', { n: data.patientsWeek })} />
          </View>

          <View style={{ backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, overflow: 'hidden' }}>
            <LinkRow icon="map" color={C.blue} label={t('tdPlanRow', { n: data.planStops })} onPress={() => router.push('/route')} />
            {data.openTasks > 0 ? (
              <LinkRow icon="flag" color={C.purple} label={allTasks ? t('tdHide') : t('tdTasksRow', { n: data.openTasks })} onPress={() => setAllTasks((x) => !x)}
                expanded={allTasks} top />
            ) : null}
            {data.onShift ? <LinkRow icon="stop" color={C.bad} label={t('endShift')} onPress={endShiftScreen} top /> : null}
          </View>
          {allTasks ? <View style={{ marginHorizontal: -14, marginTop: -20 }}><TasksSection /></View> : null}
        </ScrollView>
      </View>
      <TaskSheet task={currentTask} onClose={() => setTaskId(null)} />
    </SafeAreaView>
  );
}

type CardProps = { tone: StepTone; icon: IconName; title: string; reason?: string; primary: StepAction; secondary?: StepAction | null };

/** Words and actions for the next-step card. Every button goes to the same screen or action the app already uses. */
function stepCard(s: NextStep, d: TodayData, t: TFn, lang: Lang): CardProps {
  switch (s.kind) {
    case 'start':
      return s.doneToday
        ? { tone: 'purple', icon: 'check', title: t('tdRestTitle'), reason: t('tdRestSub', { n: d.visitsToday }),
          primary: { label: t('startShift'), icon: 'nav', onPress: () => router.push('/shift') } }
        : { tone: 'blue', icon: 'nav', title: t('tdStartTitle'), reason: t('tdStartSub'),
          primary: { label: t('startShift'), icon: 'nav', onPress: () => router.push('/shift') } };
    case 'checkin': {
      if (!s.place) {
        return { tone: 'ok', icon: 'pin', title: t('tdCheckInAny'), reason: t('tdCheckInAnySub'),
          primary: { label: t('checkIn'), icon: 'pin', onPress: () => router.push('/checkin') } };
      }
      const id = s.place.id;
      const dist = formatDist(s.place.distM, t);
      const who = s.dueHere > 0 ? t('tdToMeet', { n: s.dueHere }) : s.partnersHere > 0 ? t('tdPartnersHere', { n: s.partnersHere }) : t('tdNewPlace');
      return { tone: 'ok', icon: 'pin', title: t('tdCheckInTitle', { name: s.place.name }), reason: [dist ? t('tdAway', { dist }) : '', who].filter(Boolean).join(' · '),
        primary: { label: t('checkIn'), icon: 'pin', onPress: () => router.push({ pathname: '/checkin', params: { panchayatId: id } }) },
        secondary: { label: t('tdChooseOther'), onPress: () => router.push('/checkin') } };
    }
    case 'here': {
      const id = s.place.id;
      return { tone: 'ok', icon: 'users', title: t('tdHereTitle', { name: s.place.name }), reason: t('tdHereSub'),
        primary: { label: t('tdMeetSomeone'), icon: 'users', onPress: () => router.push({ pathname: '/checkin', params: { panchayatId: id } }) },
        secondary: { label: t('uxAddPartner'), onPress: () => router.push({ pathname: '/partner-new', params: { panchayatId: id } }) } };
    }
    case 'meet': {
      const c = s.item.contact;
      const reason = [typeLabel(t, c.role), dueText(t, s.item.overdueDays), s.lastNote ? t('tdLastTalk', { text: s.lastNote }) : ''].filter(Boolean).join(' · ');
      return { tone: 'ok', icon: 'check', title: t('tdMeetTitle', { name: c.name }), reason,
        // Opens this partner's quick "how did it go" right in the panchayat list, as the check-in screen does.
        primary: { label: t('tdVisitDone'), icon: 'check', onPress: () => router.push({ pathname: '/checkin', params: { panchayatId: c.panchayatId ?? '', contactId: c.clientId } }) },
        secondary: { label: t('tdOpenPartner'), onPress: () => openPartner(c.clientId) } };
    }
    case 'call': {
      const c = s.item.contact;
      const reason = [dueText(t, s.item.overdueDays), typeLabel(t, c.role), s.item.panchayatName].filter(Boolean).join(' · ');
      return c.phone
        ? { tone: 'warn', icon: 'phone', title: t('tdCallTitle', { name: c.name }), reason,
          primary: { label: t('call'), icon: 'phone', a11y: t('tdCallTitle', { name: c.name }), onPress: () => callNumber(c.phone) },
          secondary: { label: t('tdOpenPartner'), onPress: () => openPartner(c.clientId) } }
        : { tone: 'warn', icon: 'user', title: t('tdFollowTitle', { name: c.name }), reason,
          primary: { label: t('tdOpenPartner'), icon: 'user', onPress: () => openPartner(c.clientId) } };
    }
    case 'task': {
      const task = s.task;
      return { tone: 'warn', icon: 'flag', title: task.title, reason: taskSub(t, task, lang),
        primary: { label: t('taskMarkDone'), icon: 'check', a11y: t('tdMarkDoneA11y', { title: task.title }), onPress: () => markTaskDone(t, task) } };
    }
    case 'finish':
      return { tone: 'purple', icon: 'stop', title: t('tdFinishTitle'), reason: t('tdFinishSub', { v: d.visitsToday, p: d.referralsToday }),
        primary: { label: t('endShift'), icon: 'stop', onPress: endShiftScreen },
        secondary: s.next ? { label: t('tdNextPlace', { name: s.next.name }), onPress: () => router.push({ pathname: '/checkin', params: { panchayatId: s.next!.id } }) } : null };
  }
}

function taskSub(t: TFn, task: Task, lang: Lang): string {
  const due = dueLabel(t, lang, task)?.text;
  return due ? t('tdTaskFrom', { name: task.createdBy, due }) : t('tdTaskFromNoDue', { name: task.createdBy });
}

/** Up to three more jobs for today, each with one big action button. */
function AlsoToday({ data, chatUnread, t, lang, onOpenTask }: { data: TodayData; chatUnread: number; t: TFn; lang: Lang; onOpenTask: (id: string) => void }) {
  type Row = { key: string; dot: string; title: string; sub: string; subColor?: string; onPress: () => void; action: { icon: IconName; label: string; onPress: () => void; bg: string; fg: string } };
  const fu: Row[] = data.followUps.map((f) => {
    const c = f.contact;
    const late = f.overdueDays > 0;
    return {
      key: `f${f.id}`, dot: late ? C.bad : C.warn, title: c.phone ? t('tdCallTitle', { name: c.name }) : t('tdFollowTitle', { name: c.name }),
      sub: [dueText(t, f.overdueDays), f.panchayatName].filter(Boolean).join(' · '), subColor: late ? C.bad : undefined,
      onPress: () => openPartner(c.clientId),
      action: c.phone
        ? { icon: 'phone', label: t('tdCallTitle', { name: c.name }), onPress: () => callNumber(c.phone), bg: C.blueSoft, fg: C.blue }
        : { icon: 'chevron', label: t('tdOpenPartner'), onPress: () => openPartner(c.clientId), bg: C.bg, fg: C.text3 },
    };
  });
  const tasks: Row[] = data.tasks.map((task) => ({
    key: `t${task.id}`, dot: C.warn, title: task.title, sub: taskSub(t, task, lang), onPress: () => onOpenTask(task.id),
    action: { icon: 'check', label: t('tdMarkDoneA11y', { title: task.title }), onPress: () => markTaskDone(t, task), bg: C.okSoft, fg: C.ok },
  }));
  const thread = cachedThreads().filter((x) => x.unread > 0).sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))[0];
  const chat: Row[] = chatUnread > 0 ? [{
    key: 'chat', dot: C.blue, title: t('tdMsgs', { n: chatUnread }), sub: thread ? (thread.lastPreview ? `${thread.title}: ${thread.lastPreview}` : thread.title) : '',
    onPress: () => router.push('/chat'),
    action: { icon: 'chevron', label: t('tdOpenChat'), onPress: () => router.push('/chat'), bg: C.bg, fg: C.text3 },
  }] : [];
  // One of each kind first, then fill up with more follow-ups and tasks.
  const rows: Row[] = [];
  for (const r of [fu[0], tasks[0], chat[0], ...fu.slice(1), ...tasks.slice(1)]) {
    if (r && rows.length < 3) rows.push(r);
  }

  return (
    <View style={{ gap: 10 }}>
      <T style={{ fontSize: 17, fontWeight: '800', marginTop: 4 }}>{t('tdAlsoToday')}</T>
      {rows.length === 0 ? (
        <View style={{ backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon name="check" size={20} color={C.ok} />
          <T style={{ flex: 1, fontSize: 15, color: C.text2 }}>{t('tdNothingElse')}</T>
        </View>
      ) : (
        <View style={{ backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, overflow: 'hidden' }}>
          {rows.map((r, i) => (
            <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingLeft: 14, paddingRight: 10, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
              <Pressable onPress={r.onPress} accessibilityRole="button" accessibilityLabel={r.sub ? `${r.title}. ${r.sub}` : r.title}
                style={({ pressed }) => [{ flex: 1, minWidth: 0, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 }, pressed && { opacity: 0.7 }]}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: r.dot }} />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <T style={{ fontSize: 16, fontWeight: '700' }} numberOfLines={2}>{r.title}</T>
                  {r.sub ? <T style={{ fontSize: 14, color: r.subColor ?? C.text2, fontWeight: r.subColor ? '600' : '400' }} numberOfLines={1}>{r.sub}</T> : null}
                </View>
              </Pressable>
              <Pressable onPress={r.action.onPress} accessibilityRole="button" accessibilityLabel={r.action.label} hitSlop={4}
                style={({ pressed }) => [{ width: 48, height: 48, borderRadius: 14, backgroundColor: r.action.bg, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.7 }]}>
                <Icon name={r.action.icon} size={22} color={r.action.fg} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <View accessible accessibilityLabel={`${n} ${label}`}
      style={{ flex: 1, paddingVertical: 6, paddingHorizontal: 6, alignItems: 'center', gap: 2 }}>
      <T style={{ fontSize: 22, fontWeight: '800' }}>{n}</T>
      <T style={{ fontSize: 13, color: C.text2, textAlign: 'center' }}>{label}</T>
    </View>
  );
}

function LinkRow({ icon, color, label, onPress, top, expanded }: { icon: IconName; color: string; label: string; onPress: () => void; top?: boolean; expanded?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={expanded != null ? { expanded } : undefined}
      style={({ pressed }) => [{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 8,
        borderTopWidth: top ? 1 : 0, borderTopColor: C.line }, pressed && { backgroundColor: C.line }]}>
      <Icon name={icon} size={20} color={color} />
      <T style={{ flex: 1, fontSize: 16, fontWeight: '700' }}>{label}</T>
      <Icon name="chevron" size={18} color={C.muted} />
    </Pressable>
  );
}
