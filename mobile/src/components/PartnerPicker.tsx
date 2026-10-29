import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Field, Sheet, T } from './ui';
import { Icon } from './Icon';
import { useDb, useSession } from '../lib/session';
import { db, type Contact } from '../lib/db';
import { C } from '../theme';

/** Search the agent's partners by name, phone or place; partners in the current panchayat come first. */
export function PartnerPicker({ visible, onClose, onPick, panchayatFirst }: { visible: boolean; onClose: () => void; onPick: (c: Contact) => void; panchayatFirst?: string | null }) {
  const { t } = useSession();
  const [term, setTerm] = useState('');
  const all = useDb(() => db().getAllSync<Contact & { place: string | null }>(
    `SELECT c.*, COALESCE(a.name, p.name) AS place FROM contacts c
       LEFT JOIN assigned a ON a.panchayatId = c.panchayatId LEFT JOIN panchayats p ON p.id = c.panchayatId
      ORDER BY CASE WHEN c.panchayatId = ? THEN 0 ELSE 1 END, c.name COLLATE NOCASE`, panchayatFirst ?? ''), [panchayatFirst]);
  const list = useMemo(() => {
    const s = term.trim().toLowerCase();
    if (!s) return all;
    return all.filter((c) => c.name.toLowerCase().includes(s) || (c.phone ?? '').includes(s) || (c.place ?? '').toLowerCase().includes(s));
  }, [all, term]);

  return (
    <Sheet visible={visible} onClose={onClose} title={t('choosePartner')} scroll={false}>
      <Field placeholder={t('searchPartners')} value={term} onChangeText={setTerm} autoCorrect={false} />
      <FlatList style={{ maxHeight: 380 }} data={list} keyExtractor={(c) => c.clientId} keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: C.line }} />}
        renderItem={({ item }) => (
          <Pressable onPress={() => { onPick(item); onClose(); setTerm(''); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 }}>
            <View style={{ flex: 1 }}>
              <T style={{ fontWeight: '700' }}>{item.name}</T>
              <T style={{ color: C.text2, fontSize: 13 }}>{[t(`type_${item.role}` as never), item.place].filter(Boolean).join(' · ')}</T>
            </View>
            <Icon name="chevron" color={C.muted} />
          </Pressable>
        )}
        ListEmptyComponent={<T style={{ color: C.text2, padding: 12 }}>—</T>} />
    </Sheet>
  );
}
