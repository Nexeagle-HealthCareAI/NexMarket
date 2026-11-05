import React, { useState } from 'react';
import { Alert, Image, Modal, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Btn, Card, Chip, Empty, Pill, Screen, T, TopBar, toast } from '../components/ui';
import { Icon } from '../components/Icon';
import { useSession, useSync } from '../lib/session';
import { syncNow } from '../lib/sync';
import { useMoney } from '../lib/useMoney';
import { confirmReceived, inr, openProofPdf, proofSource, recordCashHandover, statusLine, type MyIncentive, type PartnerPayout } from '../lib/money';
import { takePhoto } from '../lib/photo';
import { dayShort } from '../lib/format';
import { C } from '../theme';
import type { Lang, TFn } from '../i18n';

type Filter = 'all' | 'waiting' | 'paid';

/**
 * Money: what the hospital is paying my partners (for services such as travel with a patient), with approval
 * and paid status and the payment reference, and my own incentives for the patients I referred.
 */
export default function MoneyScreen() {
  const { t, lang } = useSession();
  const sync = useSync();
  const m = useMoney();
  const [filter, setFilter] = useState<Filter>('all');
  const keep = (s: string) => filter === 'all' || (filter === 'paid' ? s === 'paid' : s !== 'paid');
  const pays = (m?.partnerPayments ?? []).filter((p) => keep(p.status));
  const incs = (m?.incentives ?? []).filter((i) => keep(i.status));

  return (
    <Screen scroll={false} padded={false} header={<TopBar title={t('moneyTitle')} sub={m?.at ? t('moneyUpdated', { d: dayShort(lang, new Date(m.at)) }) : undefined} />}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={sync.running} onRefresh={() => void syncNow(true)} />}>
        {!m ? (
          <Empty text={sync.online ? t('moneyLoading') : t('moneyOffline')} icon="cloudOff" />
        ) : (
          <>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <SumCard title={t('moneyPartners')} paid={m.summary.partnerPaid} waiting={m.summary.partnerWaiting} t={t} warn={m.summary.partnerOverdue > 0 ? t('moneyOverdue', { n: m.summary.partnerOverdue }) : undefined} />
              <SumCard title={t('moneyMine')} paid={m.summary.myPaid} waiting={m.summary.myWaiting} t={t} />
            </View>
            {(m.summary.cashToHandOverCount ?? 0) > 0 ? (
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.warnSoft, borderColor: C.warn }}>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.warn, alignItems: 'center', justifyContent: 'center' }}><T style={{ color: '#fff', fontSize: 20, fontWeight: '800' }}>₹</T></View>
                <View style={{ flex: 1 }}>
                  <T style={{ fontWeight: '800', fontSize: 16 }}>{t('moneyCashToGive', { amount: inr(m.summary.cashToHandOver ?? 0) })}</T>
                  <T style={{ color: C.text2, fontSize: 13 }}>{t('moneyCashToGiveSub', { n: m.summary.cashToHandOverCount ?? 0 })}</T>
                </View>
              </Card>
            ) : null}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0 }}>
              {(['all', 'waiting', 'paid'] as Filter[]).map((f) => (
                <Chip key={f} label={f === 'all' ? t('all') : f === 'waiting' ? t('moneyWaiting') : t('moneyPaidF')} selected={filter === f} onPress={() => setFilter(f)} />
              ))}
            </ScrollView>

            <T style={{ fontSize: 17, fontWeight: '800', marginTop: 4 }}>{t('moneyPartners')}</T>
            {pays.length === 0 ? <T style={{ color: C.text2 }}>{t('moneyNoPartner')}</T> : pays.map((p) => <PayoutRow key={p.id} p={p} t={t} lang={lang} />)}

            <T style={{ fontSize: 17, fontWeight: '800', marginTop: 8 }}>{t('moneyMine')}</T>
            {incs.length === 0 ? <T style={{ color: C.text2 }}>{t('moneyNoMine')}</T> : incs.map((i) => <IncentiveRow key={i.id} i={i} t={t} lang={lang} />)}

            <T style={{ color: C.text2, fontSize: 12.5, lineHeight: 18, marginTop: 8 }}>{t('moneyHelp')}</T>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function SumCard({ title, paid, waiting, t, warn }: { title: string; paid: number; waiting: number; t: TFn; warn?: string }) {
  return (
    <Card style={{ flex: 1, gap: 4 }}>
      <T style={{ color: C.text2, fontSize: 13, fontWeight: '600' }}>{title}</T>
      <T style={{ fontSize: 22, fontWeight: '800', color: C.okInk }}>{inr(paid)}</T>
      <T style={{ fontSize: 12.5, color: C.text2 }}>{t('moneyPaidLabel')}</T>
      <T style={{ fontSize: 15, fontWeight: '700', color: waiting > 0 ? C.warnInk : C.text2, marginTop: 4 }}>{inr(waiting)}</T>
      <T style={{ fontSize: 12.5, color: C.text2 }}>{t('moneyWaitingLabel')}</T>
      {warn ? <T style={{ fontSize: 12.5, color: C.bad, fontWeight: '700' }}>{warn}</T> : null}
    </Card>
  );
}

function PayoutRow({ p, t, lang }: { p: PartnerPayout; t: TFn; lang: Lang }) {
  const st = statusLine(p, t, lang);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(false);
  const handOver = async () => {
    const photo = await takePhoto();
    if (photo === 'denied') { Alert.alert(t('photo'), t('cameraDenied')); return; }
    if (!photo) return;
    setBusy(true);
    try { await recordCashHandover(p.id, photo); toast(t('moneyCashSaved')); }
    catch { Alert.alert(t('moneyCashTitle'), t('moneyNeedInternet')); }
    finally { setBusy(false); }
  };
  const received = async () => {
    setBusy(true);
    try { await confirmReceived(p.id); toast(t('moneyReceivedSaved')); } catch { toast(t('moneyNeedInternet')); } finally { setBusy(false); }
  };
  return (
    <View style={{ backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: p.cashByMe ? C.warn : C.border, padding: 12, gap: 8 }}>
      <Pressable onPress={() => router.push({ pathname: '/partner/[id]', params: { id: p.contactClientId } })} accessibilityRole="button" style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="users" size={16} color={C.blueInk} />
          <T style={{ flex: 1, fontWeight: '700' }} numberOfLines={1}>{p.partner}</T>
          <T style={{ fontSize: 17, fontWeight: '800' }}>{inr(p.amount)}</T>
        </View>
        <T style={{ color: C.text2, fontSize: 13 }}>{[p.purpose, p.patient ? t('moneyForPatient', { name: p.patient }) : null, dayShort(lang, new Date(p.createdAt))].filter(Boolean).join(' · ')}</T>
      </Pressable>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <Pill label={st.label} tone={st.tone} />
        {p.status === 'paid' && p.methodLabel && p.method ? <Pill label={p.methodLabel} tone="muted" /> : null}
        {p.status === 'paid' && p.hasProof ? (
          <Pressable onPress={() => (p.proofIsPdf ? void openProofPdf(p.id).catch(() => toast(t('moneyNeedInternet'))) : setViewing(true))} accessibilityRole="button" hitSlop={6}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.blueSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
            <Icon name="image" size={14} color={C.blueInk} />
            <T style={{ color: C.blueInk, fontWeight: '700', fontSize: 12.5 }}>{p.proofKind === 'cash_photo' ? t('moneyCashPhoto') : t('moneyProof')}</T>
          </Pressable>
        ) : null}
      </View>
      {p.cashByMe ? (
        <View style={{ gap: 6 }}>
          <T style={{ fontSize: 13, color: C.warnInk }}>{t('moneyCashHelp')}</T>
          <Btn icon="camera" label={t('moneyCashButton', { amount: inr(p.amount) })} loading={busy} onPress={handOver} />
        </View>
      ) : p.status === 'paid' && !p.receivedAt ? (
        <Btn small kind="secondary" icon="check" label={t('moneyGotIt')} loading={busy} onPress={received} />
      ) : null}
      <Modal visible={viewing} transparent animationType="fade" onRequestClose={() => setViewing(false)}>
        <Pressable onPress={() => setViewing(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.88)', alignItems: 'center', justifyContent: 'center', padding: 16, gap: 12 }}>
          {viewing ? <Image source={proofSource(p.id)} style={{ width: '100%', height: '75%' }} resizeMode="contain" /> : null}
          <T style={{ color: '#fff', textAlign: 'center' }}>
            {[p.methodLabel, p.proofAt ? new Date(p.proofAt).toLocaleString(lang === 'en' ? 'en-IN' : 'hi-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : null].filter(Boolean).join(' · ')}
          </T>
          <T style={{ color: '#cbd5e1', fontSize: 13 }}>{t('tapToClose')}</T>
        </Pressable>
      </Modal>
    </View>
  );
}

function IncentiveRow({ i, t, lang }: { i: MyIncentive; t: TFn; lang: Lang }) {
  const st = statusLine(i, t, lang);
  return (
    <View style={{ backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 12, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="star" size={16} color={C.warnInk} />
        <T style={{ flex: 1, fontWeight: '700' }} numberOfLines={1}>{i.patient ?? i.reason}</T>
        <T style={{ fontSize: 17, fontWeight: '800' }}>{inr(i.amount)}</T>
      </View>
      <T style={{ color: C.text2, fontSize: 13 }}>{[i.patient ? i.reason : null, dayShort(lang, new Date(i.createdAt))].filter(Boolean).join(' · ')}</T>
      <View style={{ alignSelf: 'flex-start' }}><Pill label={st.label} tone={st.tone} /></View>
    </View>
  );
}
