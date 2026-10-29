import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { BottomNav, Card, Chip, Empty, Pill, Screen, T, TopBar } from '../components/ui';
import { Icon } from '../components/Icon';
import { useDb, useSession } from '../lib/session';
import { db, type Referral } from '../lib/db';
import { dayShort } from '../lib/format';
import { WhatsAppSheet } from '../components/WhatsAppSheet';
import { stageStep, stageTone } from '../components/stage';
import { C } from '../theme';

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
  const steps = [t('stepSent'), t('stepArrived'), t('stepOpd'), t('stepAdmitted'), t('stepDischarged')];

  return (
    <Screen header={<TopBar title={t('myPatients')} sub={`${rows.length}`} onBack={false} />} footer={<BottomNav />}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {(['all', 'inTransit', 'arrived', 'notCame'] as Filter[]).map((f) => (
          <Chip key={f} label={f === 'all' ? t('all') : t(f)} selected={filter === f} onPress={() => setFilter(f)} />
        ))}
      </ScrollView>
      {list.length === 0 ? <Empty text={t('noPatients')} icon="patients" /> : null}
      {list.map((r) => {
        const step = stageStep(r.status);
        const lost = r.status === 'lost';
        const waiting = r.status === 'pending' ? Math.floor((Date.now() - new Date(r.createdAt).getTime()) / 86400000) : 0;
        return (
          <Card key={r.clientId}>
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

            {r.unsent ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon name="cloudOff" size={14} color={C.warnInk} />
                <T style={{ color: C.warnInk, fontSize: 13 }}>{t('onPhoneWillSend')}</T>
              </View>
            ) : waiting >= 2 ? <T style={{ color: C.warnInk, fontSize: 13 }}>{t('waitingDays', { n: waiting })}</T> : null}

            {step >= 3 && r.partnerPhone ? (
              <Pressable onPress={() => setThank({ name: r.partnerName ?? '', phone: r.partnerPhone! })} accessibilityRole="button"
                style={({ pressed }) => [{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#e7f8ee', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 }, pressed && { opacity: 0.8 }]}>
                <Icon name="whatsapp" size={16} color="#1fa855" />
                <T style={{ color: '#127a3d', fontWeight: '700' }}>{t('thankPartner', { name: r.partnerName ?? '' })}</T>
              </Pressable>
            ) : null}
          </Card>
        );
      })}
      <WhatsAppSheet visible={!!thank} onClose={() => setThank(null)} name={thank?.name ?? ''} phone={thank?.phone ?? null} template="thanks" />
    </Screen>
  );
}
