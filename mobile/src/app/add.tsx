import React, { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T, toast } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { PartnerPicker } from '../components/PartnerPicker';
import { RevisitSheet } from '../components/RevisitSheet';
import { EscalateSheet } from '../components/EscalateSheet';
import { useDb, useSession } from '../lib/session';
import { q, type Contact } from '../lib/db';
import { addPhoto } from '../lib/repo';
import { takePhoto } from '../lib/photo';
import { C } from '../theme';

type Pending = 'photo' | 'issue' | 'revisit' | null;

/** The centre "+" sheet: everything an agent can add, one tap away. */
export default function AddSheet() {
  const { t } = useSession();
  const insets = useSafeAreaInsets();
  const visit = useDb(() => q.activeVisit());
  const onShift = useDb(() => !!q.activeShift());
  const [picking, setPicking] = useState<Pending>(null);
  const [issueFor, setIssueFor] = useState<Contact | null>(null);
  const [revisitFor, setRevisitFor] = useState<Contact | null>(null);
  const place = useDb(() => (visit ? q.assignedOne(visit.panchayatId)?.name ?? q.panchayat(visit.panchayatId)?.name ?? '' : ''), [visit?.panchayatId]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/today'));

  // Most-used first. On shift but not yet checked in, checking in comes first: everything else is logged against it.
  const checkIn = { icon: 'pin' as IconName, title: visit ? t('changePanchayat') : t('checkInPanchayat'), sub: visit ? t('nowIn', { name: place }) : t('visitSub'), color: C.info, onPress: () => router.replace('/checkin') };
  const items: { icon: IconName; title: string; sub: string; color: string; onPress: () => void }[] = [
    ...(onShift && !visit ? [checkIn] : []),
    { icon: 'users', title: t('addNewPerson'), sub: place ? t('addsTo', { name: place }) : t('newPartnerSub'), color: C.blue, onPress: () => router.replace({ pathname: '/partner-new', params: visit ? { panchayatId: visit.panchayatId } : {} }) },
    { icon: 'hospital', title: t('referPatient'), sub: t('referPatientSub'), color: '#0f8a5f', onPress: () => router.replace('/refer') },
    { icon: 'check', title: t('revisitSomeone'), sub: t('revisitSomeoneSub'), color: C.ok, onPress: () => setPicking('revisit') },
    ...(onShift && !visit ? [] : [checkIn]),
    { icon: 'camera', title: t('photo'), sub: t('photoSub'), color: C.purple, onPress: () => setPicking('photo') },
    { icon: 'chat', title: t('chatMessageOffice'), sub: t('chatMessageOfficeSub'), color: '#00a884', onPress: () => router.replace('/chat') },
    { icon: 'flag', title: t('raiseIssue'), sub: t('raiseIssueSub'), color: C.bad, onPress: () => setPicking('issue') },
  ];

  const onPick = async (c: Contact) => {
    if (picking === 'photo') {
      setPicking(null);
      const p = await takePhoto();
      if (p === 'denied') Alert.alert(t('photo'), t('cameraDenied'));
      else if (p) { addPhoto(c.clientId, p); toast(t('savedOnPhone')); close(); }
    } else if (picking === 'issue') {
      setPicking(null);
      setIssueFor(c);
    } else if (picking === 'revisit') {
      setPicking(null);
      setRevisitFor(c);
    }
  };

  return (
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Pressable style={{ ...StyleFill, backgroundColor: 'rgba(14,21,37,0.5)' }} onPress={close} accessibilityLabel={t('close')} />
      <View style={{ backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, paddingBottom: 16 + insets.bottom, gap: 8 }}>
        <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: C.border }} />
        <T style={{ fontSize: 20, fontWeight: '800', marginBottom: 4 }}>{t('whatToAdd')}</T>
        {items.map((it) => (
          <Pressable key={it.title} onPress={it.onPress} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, borderRadius: 16, backgroundColor: pressed ? C.bg : C.card }]}>
            <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: it.color, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={it.icon} color="#fff" size={22} />
            </View>
            <View style={{ flex: 1 }}>
              <T style={{ fontSize: 17, fontWeight: '700' }}>{it.title}</T>
              <T style={{ color: C.text2, fontSize: 13 }}>{it.sub}</T>
            </View>
            <Icon name="chevron" color={C.muted} />
          </Pressable>
        ))}
      </View>
      <PartnerPicker visible={picking != null} onClose={() => setPicking(null)} onPick={onPick} panchayatFirst={visit?.panchayatId} />
      <RevisitSheet visible={!!revisitFor} onClose={() => { setRevisitFor(null); close(); }} contactId={revisitFor?.clientId ?? ''} name={revisitFor?.name ?? ''} />
      <EscalateSheet visible={!!issueFor} onClose={() => setIssueFor(null)} contactId={issueFor?.clientId ?? ''} name={issueFor?.name ?? ''} onDone={close} />
    </View>
  );
}

const StyleFill = { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 };
