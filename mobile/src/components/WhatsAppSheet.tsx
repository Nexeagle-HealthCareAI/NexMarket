import React, { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Btn, Sheet, T } from './ui';
import { Icon } from './Icon';
import { useSession } from '../lib/session';
import { openWhatsApp } from '../lib/links';
import { departments } from '../lib/sync';
import type { StringKey } from '../i18n';
import { C } from '../theme';

const TEMPLATES: { key: string; label: StringKey; text: StringKey }[] = [
  { key: 'intro', label: 'waIntroL', text: 'waIntro' },
  { key: 'depts', label: 'waDeptsL', text: 'waDepts' },
  { key: 'follow', label: 'waFollowL', text: 'waFollow' },
  { key: 'visit', label: 'waVisitL', text: 'waVisit' },
  { key: 'thanks', label: 'waThanksL', text: 'waThanks' },
  { key: 'own', label: 'waOwnL', text: 'waOwn' },
];

/** Pick a ready message in the agent's language (or write one), check it, and open WhatsApp with it filled in. */
export function WhatsAppSheet({ visible, onClose, name, phone, template = 'intro' }: { visible: boolean; onClose: () => void; name: string; phone: string | null; template?: string }) {
  const { t, agent } = useSession();
  const [pick, setPick] = useState('intro');
  const [text, setText] = useState('');
  const fill = (k: StringKey) => t(k, {
    partner: name.trim(),
    agent: agent?.name?.trim() ?? '',
    hospital: 'Glisan Akbari SuperSpeciality Hospital',
    departments: departments().slice(0, 8).join(', ') || '—',
  });
  useEffect(() => {
    if (!visible) return;
    const tp = TEMPLATES.find((x) => x.key === template) ?? TEMPLATES[0];
    setPick(tp.key);
    setText(tp.key === 'own' ? '' : fill(tp.text));
  }, [visible, template]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (k: (typeof TEMPLATES)[number]) => {
    setPick(k.key);
    setText(k.key === 'own' ? '' : fill(k.text));
  };
  const send = () => {
    openWhatsApp(phone, text.trim());
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('waTitle', { name })}>
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {TEMPLATES.map((k) => {
            const on = pick === k.key;
            return (
              <Pressable key={k.key} onPress={() => choose(k)} accessibilityRole="button" accessibilityState={{ selected: on }}
                style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: on ? '#1fa855' : C.borderStrong, backgroundColor: on ? '#e7f8ee' : C.card }}>
                <T style={{ fontSize: 14, fontWeight: '600', color: on ? '#127a3d' : C.text3 }}>{t(k.label)}</T>
              </Pressable>
            );
          })}
        </View>
        <TextInput value={text} onChangeText={setText} multiline placeholder={t('waOwnHint')} placeholderTextColor={C.muted}
          style={{ minHeight: 120, maxHeight: 220, borderWidth: 1, borderColor: C.borderStrong, borderRadius: 14, padding: 12, fontSize: 15, lineHeight: 21, color: C.text, backgroundColor: C.bg, textAlignVertical: 'top' }} />
        {!phone ? <T style={{ color: C.bad, fontSize: 13 }}>{t('waNoPhone')}</T> : null}
        <Btn label={t('waOpen')} icon="whatsapp" kind="ok" disabled={!phone || !text.trim()} onPress={send} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="note" size={14} color={C.muted} />
          <T style={{ color: C.muted, fontSize: 12, flex: 1 }}>{t('waHint')}</T>
        </View>
      </View>
    </Sheet>
  );
}
