import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Btn, Field, Pill, Sheet, T, toast } from './ui';
import { Icon } from './Icon';
import { useDb, useSession } from '../lib/session';
import { cachedTasks, refreshTasks, setTaskDone, type Task } from '../lib/tasks';
import { openDirections } from '../lib/links';
import { dayShort } from '../lib/format';
import { daysFromToday } from '../lib/util';
import type { TFn } from '../i18n';
import { C } from '../theme';

function dueLabel(t: TFn, lang: Parameters<typeof dayShort>[0], task: Task): { text: string; tone: 'bad' | 'warn' | 'muted' } | null {
  if (!task.dueDate) return null;
  const d = daysFromToday(task.dueDate);
  if (d < 0) return { text: t('taskOverdue', { n: -d }), tone: 'bad' };
  if (d === 0) return { text: t('taskDueToday'), tone: 'warn' };
  if (d === 1) return { text: t('taskDueTomorrow'), tone: 'warn' };
  return { text: t('taskDueOn', { date: dayShort(lang, task.dueDate) }), tone: 'muted' };
}

/** "From your manager" on the Today screen: open tasks first, then a line for recently done ones. */
export function TasksSection() {
  const { t, lang } = useSession();
  const tasks = useDb(() => cachedTasks());
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { void refreshTasks().catch(() => undefined); }, []);
  const open = tasks.filter((x) => x.status === 'open')
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || (a.priority === 'high' ? -1 : 0) - (b.priority === 'high' ? -1 : 0));
  const doneToday = tasks.filter((x) => x.status === 'done' && x.doneAt && daysFromToday(x.doneAt.slice(0, 10)) === 0).length;
  const current = tasks.find((x) => x.id === openId) ?? null;
  if (open.length === 0 && doneToday === 0) return null;

  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 20, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }}>
        <Icon name="flag" size={18} color={C.purple} />
        <T style={{ fontSize: 18, fontWeight: '700', flex: 1 }}>{t('tasksFromManager')}</T>
        {doneToday > 0 ? <Pill tone="ok" icon="check" label={t('tasksDoneToday', { n: doneToday })} /> : null}
      </View>
      {open.map((task) => {
        const due = dueLabel(t, lang, task);
        const where = [task.panchayats.map((p) => p.name).join(', '), task.partner?.name].filter(Boolean).join(' · ');
        return (
          <Pressable key={task.id} onPress={() => setOpenId(task.id)}
            style={({ pressed }) => [{ backgroundColor: C.card, borderRadius: 16, padding: 14, gap: 6, borderWidth: 1, borderColor: due?.tone === 'bad' ? '#f3c5c0' : C.border, borderLeftWidth: 4, borderLeftColor: task.priority === 'high' ? C.bad : C.purple }, pressed && { opacity: 0.85 }]}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <T style={{ flex: 1, fontSize: 16, fontWeight: '700' }} numberOfLines={2}>{task.title}</T>
              <Icon name="chevron" size={18} color={C.muted} />
            </View>
            {where ? <T style={{ fontSize: 13, color: C.text2 }} numberOfLines={1}>{where}</T> : null}
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {task.priority === 'high' ? <Pill tone="bad" icon="alert" label={t('taskUrgent')} /> : null}
              {due ? <Pill tone={due.tone} icon="clock" label={due.text} /> : null}
            </View>
          </Pressable>
        );
      })}
      <TaskSheet task={current} onClose={() => setOpenId(null)} />
    </View>
  );
}

function TaskSheet({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const { t, lang } = useSession();
  const [note, setNote] = useState('');
  if (!task) return <Sheet visible={false} onClose={onClose}><View /></Sheet>;
  const due = dueLabel(t, lang, task);
  const done = () => {
    setTaskDone(task.id, note);
    setNote('');
    toast(t('taskDoneSaved'));
    onClose();
  };
  const firstPlace = task.panchayats.find((p) => p.lat != null && p.lng != null);

  return (
    <Sheet visible onClose={onClose} title={task.title}>
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {task.priority === 'high' ? <Pill tone="bad" icon="alert" label={t('taskUrgent')} /> : null}
          {due ? <Pill tone={due.tone} icon="clock" label={due.text} /> : null}
          <Pill tone="muted" icon="user" label={t('taskFrom', { name: task.createdBy })} />
        </View>
        {task.detail ? <T style={{ fontSize: 15, lineHeight: 22, color: C.text3 }}>{task.detail}</T> : null}
        {task.panchayats.length > 0 ? (
          <View style={{ gap: 6 }}>
            <T style={{ fontSize: 13, fontWeight: '700', color: C.text2 }}>{t('taskWhere')}</T>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {task.panchayats.map((p) => (
                <Pressable key={p.id} onPress={() => { onClose(); router.push({ pathname: '/checkin', params: { panchayatId: p.id } }); }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.blueSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}>
                  <Icon name="pin" size={14} color={C.blueInk} />
                  <T style={{ color: C.blueInk, fontWeight: '600', fontSize: 13 }}>{p.name}</T>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        {task.partner ? (
          <Pressable onPress={() => { onClose(); router.push({ pathname: '/partner/[id]', params: { id: task.partner!.clientId } }); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.bg, borderRadius: 12, padding: 12 }}>
            <Icon name="user" size={18} color={C.text3} />
            <T style={{ flex: 1, fontWeight: '600' }}>{task.partner.name}</T>
            <Icon name="chevron" size={16} color={C.muted} />
          </Pressable>
        ) : null}
        {firstPlace ? (
          <Btn kind="secondary" icon="nav" label={t('route')} onPress={() => openDirections(firstPlace.lat!, firstPlace.lng!)} />
        ) : null}
        <Field label={t('taskNote')} value={note} onChangeText={setNote} placeholder={t('taskNoteHint')} multiline maxLength={1000} />
        <Btn kind="ok" icon="check" label={t('taskMarkDone')} onPress={done} />
      </View>
    </Sheet>
  );
}
