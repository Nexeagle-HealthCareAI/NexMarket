import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Card, Chip, Empty, Pill, Screen, T, TopBar } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useDb, useSession } from '../../lib/session';
import { db, type Referral } from '../../lib/db';
import { dayShort } from '../../lib/format';
import { WhatsAppSheet } from '../../components/WhatsAppSheet';
import { stageStep, stageTone } from '../../components/stage';
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
  const rows = useDb(() => db().getAllSync<Row>(
    `SELECT r.*, c.name AS partnerName, c.phone AS partnerPhone,
            EXISTS(SELECT 1 FROM outbox o WHERE o.clientId = r.clientId) AS unsent
       FROM referrals r LEFT JOIN contacts c ON c.clientId = r.contactId ORDER BY r.createdAt DESC`));
  const list = rows.filter((r) =>
    filter === 'all' ? true
      : filter === 'inTransit' ? r.status === 'pending'
        : filter === 'notCame' ? r.status === 'lost'
          : !['pending', 'lost'].includes(r.status));
  const money = useMoney();
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
    <Screen scroll={false} padded={false} header={<TopBar title={t('myPatients')} sub={`${rows.length}`} onBack={false} />}>
      <FlatList
        data={list}
        keyExtractor={(r) => r.clientId}
        renderItem={({ item }) => <PatientCard r={item} t={t} lang={lang} steps={steps} onThank={setThank} money={byPatient.get(item.clientId)} />}
        ListHeaderComponent={<>
          {money ? (
            <Card onPress={() => router.push('/money')} style={{ marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.okSoft, alignItems: 'center', justifyContent: 'center' }}>
                <T style={{ fontSize: 18, fontWeight: '800', color: C.okInk }}>₹</T>
              </View>
              <View style={{ flex: 1 }}>
                <T style={{ fontWeight: '700', fontSize: 15.5 }}>{t('moneyCard')}</T>
                <T style={{ color: C.text2, fontSize: 13 }}>{t('moneyCardSub', { paid: inr(money.summary.partnerPaid), waiting: inr(money.summary.partnerWaiting) })}</T>
                {money.summary.partnerOverdue > 0 ? <T style={{ color: C.bad, fontSize: 12.5, fontWeight: '700' }}>{t('moneyOverdue', { n: money.summary.partnerOverdue })}</T> : null}
              </View>
              <Icon name="chevron" size={18} color={C.text3} />
            </Card>
          ) : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginBottom: 12, flexGrow: 0 }}>
            {(['all', 'inTransit', 'arrived', 'notCame'] as Filter[]).map((f) => (
              <Chip key={f} label={f === 'all' ? t('all') : t(f)} selected={filter === f} onPress={() => setFilter(f)} />
            ))}
          </ScrollView>
        </>}
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
        <Pill label={t(`stage_${r.status}` as never)} tone={stageTone(r.status)} />
      </View>

      {!lost ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          {steps.map((s, i) => (
            <View key={s} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' }}>
                <View style={{ flex: 1, height: 3, backgroundColor: i === 0 ? 'transparent' : i <= step ? C.ok : C.line }} />
                <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: i <= step ? C.ok : C.card, borderWidth: 2, borderColor: i <= step ? C.ok : C.borderStrong, alignItems: 'center', justifyContent: 'center' }}>
                  {i <= step ? <Icon name="check" size={11} color="#fff" strokeWidth={3.5} /> : null}
                </View>
                <View style={{ flex: 1, height: 3, backgroundColor: i === steps.length - 1 ? 'transparent' : i < step ? C.ok : C.line }} />
              </View>
              <T style={{ fontSize: 11, color: i <= step ? C.okInk : C.muted, fontWeight: i === step ? '700' : '500', textAlign: 'center' }}>{s}</T>
            </View>
          ))}
        </View>
      ) : null}

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
