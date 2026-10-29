import React from 'react';
import { Pressable, View } from 'react-native';
import { LANGS } from '../i18n';
import { useSession } from '../lib/session';
import { C } from '../theme';
import { Icon } from './Icon';
import { Sheet, T } from './ui';

export function LanguageSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { lang, setLang, t } = useSession();
  return (
    <Sheet visible={visible} onClose={onClose} title={t('chooseLanguage')}>
      <View style={{ gap: 8 }}>
        {LANGS.map((l) => {
          const on = l.code === lang;
          return (
            <Pressable key={l.code} accessibilityRole="radio" accessibilityState={{ selected: on }}
              onPress={() => { setLang(l.code); onClose(); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, height: 56, paddingHorizontal: 16, borderRadius: 14,
                borderWidth: on ? 2 : 1, borderColor: on ? C.blue : C.borderStrong, backgroundColor: on ? C.blueSoft : C.card }}>
              <T style={{ flex: 1, fontSize: 18, fontWeight: '700', color: on ? C.blueInk : C.text }}>{l.label}</T>
              {on ? <Icon name="check" color={C.blue} strokeWidth={3} /> : null}
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

/** The round globe button with the short code, used on dark headers and on Login. */
export function LanguageButton({ onPress, dark = true }: { onPress: () => void; dark?: boolean }) {
  const { lang, t } = useSession();
  const short = LANGS.find((l) => l.code === lang)?.short ?? 'EN';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('language')} onPress={onPress} hitSlop={6}
      style={{ height: 36, borderRadius: 999, borderWidth: 1, borderColor: dark ? C.inkLine : C.borderStrong, paddingHorizontal: 10,
        flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: dark ? 'transparent' : C.card }}>
      <Icon name="globe" size={16} color={dark ? '#fff' : C.text} />
      <T style={{ color: dark ? '#fff' : C.text, fontWeight: '700', fontSize: 13 }}>{short}</T>
    </Pressable>
  );
}
