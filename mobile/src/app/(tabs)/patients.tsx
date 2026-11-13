import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Card, Empty, MainHeader, Pill, Screen, T } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useDb, useSession } from '../../lib/session';
import { db, type Referral } from '../../lib/db';
import { dayShort } from '../../lib/format';
import { WhatsAppSheet } from '../../components/WhatsAppSheet';
import { stageStep } from '../../components/stage';
import { C } from '../../theme';
import { useMoney } from '../../lib/useMoney';
import { inr, statusLine, type MyMoney } from '../../lib/money';
import type { Lang, TFn } from '../../i18n';

type Filter = 'all' | 'inTransit' | 'arrived' | 'notCame';
type Row = Referral & { partnerName: string | null; partnerPhone: string | null; unsent: number };

export default function Patients() {
  const { t, lang } = useSession();
  const [filter, setFilter] = useState<Filter>('all');
  const [thank, setThank] = useState<{ name: string; phone: string } | null>(null);
  const money = useMoney();
  const rows = useDb(() => db().getAllSync<Row>(
    `SELECT r.*, c.name AS partnerName, c.phone AS partnerPhone,
            EXISTS(SELECT 1 FROM outbox o WHERE o.clientId = r.clientId) AS unsent
       FROM referrals r LEFT JOIN contacts c ON c.clientId = r.contactId ORDER BY r.createdAt DESC`));
  const inFilter = (r: Row, f: Filter) =>
    f === 'all' ? true
      : f === 'inTransit' ? r.status === 'pending'
        : f === 'notCame' ? r.status === 'lost'
          : !['pending', 'lost'].includes(r.status);
  const list = rows.filter((r) => inFilter(r, filter));
  // Each filter shows how many patients it holds, so the agent sees the whole picture before tapping.
  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: t('all') }, { key: 'inTransit', label: t('inTransit') }, { key: 'arrived', label: t('stage_arrived') }, { key: 'notCame', label: t('notCame') },
  ];
  const waitingMoney = money ? money.summary.partnerWaiting : 0;
  // Payments linked to each patient, so the agent sees on the patient card whether the partner was paid.
  const byPatient = useMemo(() => {
    const m = new Map<string, { pays: MyMoney['partnerPayments']; incs: MyMoney['incentives'] }>();
    const slot = (id: string) => { let x = m.get(id); if (!x) { x = { pays: [], incs: [] }; m.set(id, x); } return x; };
    for (const p of money?.partnerPayments ?? []) if (p.referralClientId) slot(p.referralClientId).pays.push(p);
    for (const i of money?.incentives ?? []) if (i.referralClientId) slot(i.referralClientId).incs.push(i);
    return m;
  }, [money]);
  const steps = useMemo(() => [t('stepSent'), t('stepArrived'), t('stepOpd'), t('stepAdmitted'), t('stepDischarged')], [t]);

  return (
    <Screen scroll={false} padded={false} bg={C.ink} header={(
      <MainHeader title={t('myPatients')} right={money ? (
        <Pressable onPress={() => router.push('/money')} accessibilityRole="button"
          accessibilityLabel={`${t('moneyCard')}. ${t('moneyCardSub', { paid: inr(money.summary.partnerPaid), waiting: inr(money.summary.partnerWaiting) })}`}
          style={({ pressed }) => [{ height: 44, paddingHorizontal: 12, borderRadius: 22, borderWidth: 1, borderColor: money.summary.partnerOverdue > 0 ? '#ff8a80' : C.inkLine, backgroundColor: C.ink2,
            flexDirection: 'row', alignItems: 'center', gap: 6 }, pressed && { opacity: 0.7 }]}>
          <T style={{ color: '#fff', fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{waitingMoney > 0 ? `${t('moneyCard')} · ${inr(waitingMoney)}` : t('moneyCard')}</T>
          <Icon name="chevron" size={14} color="#fff" />
        </Pressable>
      ) : undefined}>
        <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 6 }}>
          {filters.map((f) => {
            const on = filter === f.key;
            const n = rows.filter((r) => inFilter(r, f.key)).length;
            return (
              <Pressable key={f.key} onPress={() => setFilter(f.key)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`${f.label}, ${n}`}
                style={({ pressed }) => [{ flex: 1, minWidth: 0, minHeight: 58, borderRadius: 12, paddingHorizontal: 2, paddingVertical: 4, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: on ? '#fff' : C.ink2, borderWidth: 1, borderColor: on ? '#fff' : C.inkLine }, pressed && { opacity: 0.85 }]}>
                <T style={{ fontSize: 18, fontWeight: '800', color: on ? C.ink : '#fff' }}>{n}</T>
                <T style={{ fontSize: 12, fontWeight: '700', color: on ? C.ink : '#c3cbdc', textAlign: 'center' }} numberOfLines={2}>{f.label}</T>
              </Pressable>
            );
          })}
        </View>
      </MainHeader>
    )}>
      <FlatList
        style={{ backgroundColor: C.bg }}
        data={list}
        keyExtractor={(r) => r.clientId}
        renderItem={({ item }) => <PatientCard r={item} t={t} lang={lang} steps={steps} onThank={setThank} money={byPatient.get(item.clientId)} />}
        ListEmptyComponent={<Empty text={t('noPatients')} icon="patients" />}
        ItemSeparatorComponent={Gap}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
      />
      <WhatsAppSheet visible={!!thank} onClose={() => setThank(null)} name={thank?.name ?? ''} phone={thank?.phone ?? null} template="thanks" />
    </Screen>
  );
}

/** The hospital's latest note on a referral ("[Hospital - 2026-11-05]: Admitted to ward 3"), if any. */
function lastHospitalNote(notes: string | null): string | null {
  if (!notes) return null;
  const all = [...notes.matchAll(/\[Hospital - [^\]]+\]:\s*([^\n]+)/g)];
  return all.length ? all[all.length - 1][1].trim() : null;
}

/** The stage in words; a stage this version doesn't know is shown readably instead of as a raw code. */
function stageText(t: TFn, status: string): string {
  const key = `stage_${status}`;
  const v = t(key as never);
  return v && v !== key ? v : status.replace(/_/g, ' ');
}

function Gap() {
  return <View style={{ height: 12 }} />;
}

const PatientCard = React.memo(function PatientCard({ r, t, lang, steps, onThank, money }: {
  r: Row; t: TFn; lang: Lang; steps: string[]; onThank: (x: { name: string; phone: string }) => void;
  money?: { pays: MyMoney['partnerPayments']; incs: MyMoney['incentives'] };
}) {
  const step = stageStep(r.status);
  const lost = r.status === 'lost';
  const waiting = r.status === 'pending' ? Math.floor((Date.now() - new Date(r.createdAt).getTime()) / 86400000) : 0;
  const hospitalNote = lastHospitalNote(r.notes);
  const statusText = r.status === 'pending' ? t('inTransit') : stageText(t, r.status);
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <T style={{ fontSize: 16, fontWeight: '700', flexShrink: 1 }}>{r.patientName || '—'}</T>
            {r.urgent ? <Pill label={t('urgent')} tone="bad" /> : null}
          </View>
          <T style={{ color: C.text2, fontSize: 13 }}>{[r.department, dayShort(lang, new Date(r.createdAt))].filter(Boolean).join(' · ')}</T>
          {r.partnerName ? (
            <T style={{ color: C.blueInk, fontSize: 13, fontWeight: '600' }} onPress={() => router.push({ pathname: '/partner/[id]', params: { id: r.contactId } })}>
              {t('referredBy')}: {r.partnerName}
            </T>
          ) : null}
        </View>
      </View>

      {/* Five short bars and one plain line: how far this patient has got. */}
      <View style={{ gap: 6 }} accessible accessibilityLabel={`${statusText}. ${lost ? '' : `${step + 1} / ${steps.length}`}`}>
        {!lost ? (
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {steps.map((s, i) => <View key={s} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i <= step ? (step === 0 ? C.blue : C.ok) : C.border }} />)}
          </View>
        ) : null}
        <T style={{ fontSize: 14.5, fontWeight: '700', color: lost ? C.bad : step === 0 ? C.blueInk : C.okInk }}>{statusText}</T>
      </View>

      {r.arrivedAt || r.admittedAt ? (
        <T style={{ color: C.text2, fontSize: 12.5 }}>
          {[r.arrivedAt ? t('arrivedOn', { d: dayShort(lang, new Date(r.arrivedAt)) }) : null, r.admittedAt ? t('admittedOn', { d: dayShort(lang, new Date(r.admittedAt)) }) : null].filter(Boolean).join(' · ')}
        </T>
      ) : null}

      {hospitalNote ? (
        <View style={{ flexDirection: 'row', gap: 8, backgroundColor: C.blueSoft, borderRadius: 10, padding: 10 }}>
          <Icon name="hospital" size={16} color={C.blueInk} />
          <T style={{ flex: 1, color: C.text, fontSize: 13.5, lineHeight: 19 }}>
            <T style={{ fontWeight: '700', color: C.blueInk }}>{t('hospitalSays')}: </T>{hospitalNote}
          </T>
        </View>
      ) : null}

      {money ? (
        <View style={{ gap: 6 }}>
          {money.pays.some((x) => x.status !== 'paid') ? (
            <T style={{ fontSize: 13, fontWeight: '700', color: C.warnInk }}>
              {t('moneyPatientDue', { amount: inr(money.pays.filter((x) => x.status !== 'paid').reduce((a, x) => a + x.amount, 0)) })}
            </T>
          ) : null}
          {[...money.pays.map((p) => ({ key: p.id, text: `${t('moneyPatientLine', { amount: inr(p.amount) })} · ${p.purpose}`, st: statusLine(p, t, lang) })),
            ...money.incs.map((i) => ({ key: i.id, text: t('moneyMyLine', { amount: inr(i.amount) }), st: statusLine(i, t, lang) }))].map((x) => (
            <Pressable key={x.key} onPress={() => router.push('/money')} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <T style={{ fontSize: 13, fontWeight: '600' }}>₹ {x.text}</T>
              <Pill label={x.st.label} tone={x.st.tone} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {r.unsent ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="cloudOff" size={14} color={C.warnInk} />
          <T style={{ color: C.warnInk, fontSize: 13 }}>{t('onPhoneWillSend')}</T>
        </View>
      ) : waiting >= 2 ? <T style={{ color: C.warnInk, fontSize: 13 }}>{t('waitingDays', { n: waiting })}</T> : null}

      {step >= 3 && r.partnerPhone ? (
        <Pressable onPress={() => onThank({ name: r.partnerName ?? '', phone: r.partnerPhone! })} accessibilityRole="button"
          style={({ pressed }) => [{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#e7f8ee', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 }, pressed && { opacity: 0.8 }]}>
          <Icon name="whatsapp" size={16} color="#1fa855" />
          <T style={{ color: '#127a3d', fontWeight: '700' }}>{t('thankPartner', { name: r.partnerName ?? '' })}</T>
        </Pressable>
      ) : null}
    </Card>
  );
});
