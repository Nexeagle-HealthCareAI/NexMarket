import React, { useEffect, useState } from 'react';
import { Alert, Image, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Btn, Card, Chip, Empty, Field, Pill, Screen, Sheet, T, toast, TopBar } from '../components/ui';
import { Icon } from '../components/Icon';
import { useDb, useSession } from '../lib/session';
import { OfflineError } from '../lib/api';
import { takePhoto, type Photo } from '../lib/photo';
import { inr } from '../lib/money';
import {
  addExpense, billPhoto, dayBefore, dropExpenseDraft, expenseDrafts, flushSpend, mySpend, phoneToday, refreshSpend, SPEND_KEY, SPEND_KINDS, takeBackExpense,
  type MyExpense,
} from '../lib/spend';
import type { StringKey } from '../i18n';
import { C } from '../theme';

type Tone = 'ok' | 'warn' | 'bad';
const STATUS: Record<MyExpense['status'], { label: StringKey; tone: Tone }> = {
  pending: { label: 'exStPending', tone: 'warn' },
  approved: { label: 'exStApproved', tone: 'ok' },
  rejected: { label: 'exStRejected', tone: 'bad' },
};
const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
/** Rupees with paise only when there are any. */
const rs = (n: number) => (Number.isInteger(n) ? inr(n) : `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/**
 * My expenses: what I spent on work, whether the office approved it, and my balance with the office (money it gave me
 * that I still hold, or money it owes me because I spent my own).
 */
export default function Expenses() {
  const { t } = useSession();
  const data = useDb(() => mySpend());
  const drafts = useDb(() => expenseDrafts());
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const open = data?.items.find((e) => e.id === openId) ?? null;

  const reload = async () => {
    setBusy(true);
    await flushSpend();
    await refreshSpend().catch(() => undefined);
    setBusy(false);
  };
  useEffect(() => { void flushSpend().then(() => refreshSpend().catch(() => undefined)); }, []);

  const takeBack = (e: MyExpense) => Alert.alert(t('exTitle'), t('exTakeBackAsk'), [
    { text: t('cancel'), style: 'cancel' },
    {
      text: t('exTakeBack'), style: 'destructive', onPress: () => {
        setWorking(true);
        takeBackExpense(e.id).then(() => { setOpenId(null); toast(t('exTakenBack')); })
          .catch((err: unknown) => Alert.alert(t('exTitle'), err instanceof OfflineError ? t('exNeedInternet') : err instanceof Error ? err.message : t('exNeedInternet')))
          .finally(() => setWorking(false));
      },
    },
  ]);

  const b = data?.balance;
  const tone = !b || b.net === 0 ? { bg: C.okSoft, fg: C.okInk, border: C.ok } : b.net > 0 ? { bg: C.warnSoft, fg: C.warnInk, border: C.warn } : { bg: C.blueSoft, fg: C.blueInk, border: C.blue };

  return (
    <Screen scroll={false} padded={false} header={<TopBar title={t('exTitle')} explain={t('exExplain')} />}
      footer={<View style={{ padding: 12, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border }}><Btn label={t('exAdd')} icon="plus" onPress={() => setAdding(true)} /></View>}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={busy} onRefresh={() => void reload()} />}>
        {b ? (
          <Card style={{ backgroundColor: tone.bg, borderColor: tone.border, gap: 4 }}>
            <T style={{ fontSize: 22, fontWeight: '800', color: tone.fg }}>
              {b.net > 0 ? t('exHold', { amount: rs(b.holds) }) : b.net < 0 ? t('exOwed', { amount: rs(b.owed) }) : t('exEven')}
            </T>
            <T style={{ fontSize: 14, color: C.text3 }}>{b.net > 0 ? t('exHoldSub') : b.net < 0 ? t('exOwedSub') : t('exEvenSub')}</T>
            {b.pending > 0 ? <T style={{ fontSize: 13.5, fontWeight: '600', color: C.text2, marginTop: 4 }}>{t('exPendingLine', { amount: rs(b.pending) })}</T> : null}
          </Card>
        ) : null}

        {drafts.map((d) => (
          <Card key={d.clientId} style={{ borderColor: '#f5d9a8', backgroundColor: C.warnSoft }}>
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              {d.photoUri ? <Image source={{ uri: d.photoUri }} style={{ width: 48, height: 48, borderRadius: 10 }} /> : null}
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <T style={{ fontSize: 16, fontWeight: '700' }}>{rs(d.amount)} · {t(SPEND_KEY[d.category] ?? 'exCatOther')}</T>
                <T style={{ color: C.text2, fontSize: 13 }}>{d.error ?? t('exWaitingSub')}</T>
              </View>
              <Pill label={t('exWaiting')} tone="warn" icon="cloudOff" />
            </View>
            {d.error ? <Btn small kind="danger" label={t('exRemove')} onPress={() => dropExpenseDraft(d.clientId)} /> : null}
          </Card>
        ))}

        {data && data.moves.length > 0 ? (
          <>
            <T style={{ fontSize: 15, fontWeight: '800', marginTop: 4 }}>{t('exMoneyList')}</T>
            <Card style={{ gap: 10 }}>
              {data.moves.slice(0, 5).map((m) => (
                <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <T style={{ fontSize: 15, fontWeight: '600' }}>{t(m.kind === 'given' ? 'exGiven' : 'exReturned', { amount: rs(m.amount) })}</T>
                    {m.note ? <T style={{ fontSize: 13, color: C.text2 }} numberOfLines={2}>{m.note}</T> : null}
                  </View>
                  <T style={{ fontSize: 13, color: C.text2 }}>{day(m.on)}</T>
                </View>
              ))}
            </Card>
          </>
        ) : null}

        {data && data.items.length > 0 ? <T style={{ fontSize: 15, fontWeight: '800', marginTop: 4 }}>{t('exMine')}</T> : null}
        {(!data || data.items.length === 0) && drafts.length === 0 ? <Empty text={t('exEmpty')} icon="tag" /> : (data?.items ?? []).map((e) => {
          const st = STATUS[e.status] ?? STATUS.pending;
          return (
            <Card key={e.id} onPress={() => setOpenId(e.id)}>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <T style={{ fontSize: 16, fontWeight: '700' }}>{rs(e.amount)} · {t(SPEND_KEY[e.category] ?? 'exCatOther')}</T>
                  <T style={{ color: C.text2, fontSize: 13 }} numberOfLines={1}>{[day(e.spentOn), e.note].filter(Boolean).join(' · ')}</T>
                </View>
                <Pill label={t(st.label)} tone={st.tone} />
              </View>
              {e.status === 'rejected' && e.rejectReason ? <T style={{ color: C.bad, fontSize: 13.5, fontWeight: '600' }}>{t('exWhyNot', { reason: e.rejectReason })}</T> : null}
            </Card>
          );
        })}
      </ScrollView>

      <Sheet visible={!!open} onClose={() => setOpenId(null)} title={open ? `${rs(open.amount)} · ${t(SPEND_KEY[open.category] ?? 'exCatOther')}` : undefined}>
        {open ? (
          <View style={{ gap: 12 }}>
            <Pill label={t(STATUS[open.status].label)} tone={STATUS[open.status].tone} />
            <T style={{ fontSize: 15 }}>{[day(open.spentOn), open.note].filter(Boolean).join(' · ')}</T>
            {open.status === 'rejected' && open.rejectReason ? <T style={{ color: C.bad, fontSize: 15, fontWeight: '600' }}>{t('exWhyNot', { reason: open.rejectReason })}</T> : null}
            {open.hasBill ? <Image source={billPhoto(open.id)} resizeMode="contain" style={{ width: '100%', height: 320, borderRadius: 12, backgroundColor: C.line }} /> : null}
            {open.status === 'pending' ? <Btn kind="danger" icon="trash" label={t('exTakeBack')} loading={working} onPress={() => takeBack(open)} /> : null}
          </View>
        ) : null}
      </Sheet>

      <AddSheet visible={adding} today={data?.today ?? phoneToday()} onClose={() => setAdding(false)} />
    </Screen>
  );
}

/** The form: amount, what it was for, which day, a few words and a photo of the bill. */
function AddSheet({ visible, today, onClose }: { visible: boolean; today: string; onClose: () => void }) {
  const { t } = useSession();
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<string>('food');
  const [back, setBack] = useState(0);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const snap = async () => {
    const p = await takePhoto();
    if (p === 'denied') { Alert.alert(t('photo'), t('cameraDenied')); return; }
    if (p) setPhoto(p);
  };

  const send = async () => {
    const n = Math.round(Number(amount) * 100) / 100;
    if (!amount.trim() || !Number.isFinite(n) || n <= 0) { setErr(t('exNeedAmount')); return; }
    setBusy(true);
    const sent = await addExpense({ spentOn: dayBefore(today, back), category: kind, amount: n, note: note.trim(), photoUri: photo?.uri ?? null });
    setBusy(false);
    toast(t(sent ? 'exSent' : 'exSaved'));
    setAmount(''); setNote(''); setPhoto(null); setBack(0); setKind('food'); setErr(null);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('exAdd')}>
      <View style={{ gap: 14 }}>
        <Field label={t('exAmount')} value={amount} onChangeText={(v) => { setAmount(v.replace(/[^0-9.]/g, '')); setErr(null); }} keyboardType="decimal-pad" maxLength={9} error={err} placeholder="0" />
        <View style={{ gap: 8 }}>
          <T style={{ fontSize: 14, fontWeight: '600', color: C.text3 }}>{t('exKind')}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {SPEND_KINDS.map((k) => <Chip key={k} label={t(SPEND_KEY[k])} selected={kind === k} onPress={() => setKind(k)} />)}
          </View>
        </View>
        <View style={{ gap: 8 }}>
          <T style={{ fontSize: 14, fontWeight: '600', color: C.text3 }}>{t('exDay')}</T>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {[0, 1, 2, 3, 4, 5, 6].map((i) => <Chip key={i} label={i === 0 ? t('exToday') : i === 1 ? t('exYesterday') : day(dayBefore(today, i))} selected={back === i} onPress={() => setBack(i)} />)}
          </ScrollView>
        </View>
        <Field label={t('exNote')} placeholder={t('exNotePh')} value={note} onChangeText={setNote} maxLength={500} />
        {photo ? (
          <View>
            <Image source={{ uri: photo.uri }} style={{ width: '100%', height: 180, borderRadius: 14, backgroundColor: C.line }} />
            <View style={{ position: 'absolute', right: 10, bottom: 10 }}><Btn small kind="secondary" icon="camera" label={t('exRetake')} onPress={() => void snap()} /></View>
          </View>
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel={t('exBillAdd')} onPress={() => void snap()}
            style={({ pressed }) => ({ minHeight: 96, borderRadius: 14, borderWidth: 2, borderStyle: 'dashed', borderColor: C.blue, backgroundColor: pressed ? '#d9ebfc' : C.blueSoft, alignItems: 'center', justifyContent: 'center', gap: 4, padding: 12 })}>
            <Icon name="camera" size={28} color={C.blue} />
            <T style={{ fontSize: 16, fontWeight: '700', color: C.blueInk }}>{t('exBillAdd')}</T>
            <T style={{ fontSize: 13, color: C.text2, textAlign: 'center' }}>{t('exBillHint')}</T>
          </Pressable>
        )}
        <Btn label={t('exSend')} icon="send" loading={busy} onPress={() => void send()} />
      </View>
    </Sheet>
  );
}
