import React from 'react';
import { View } from 'react-native';
import { T } from './ui';
import { Icon } from './Icon';
import { useSession } from '../lib/session';
import type { Contact } from '../lib/db';
import { relDay } from '../lib/format';
import { C } from '../theme';

/** The agent's escalation on this partner: still with the office, or resolved (and what the office said). */
export function EscalationStatus({ c }: { c: Contact }) {
  const { t, lang } = useSession();
  if (c.escalated && !c.escalationResolved) {
    return (
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: C.badSoft, borderRadius: 14, padding: 12 }}>
        <Icon name="flag" color={C.bad} size={18} />
        <View style={{ flex: 1, gap: 2 }}>
          <T style={{ fontWeight: '800', color: C.bad }}>{t('escOpen')}</T>
          {c.escalationNote ? <T style={{ color: C.bad, fontSize: 13 }} numberOfLines={3}>{c.escalationNote}</T> : null}
          {c.escalatedAt ? <T style={{ color: C.bad, fontSize: 12, opacity: 0.8 }}>{relDay(t, lang, c.escalatedAt)}</T> : null}
        </View>
      </View>
    );
  }
  if (c.escalationResolved) {
    return (
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: C.okSoft, borderRadius: 14, padding: 12 }}>
        <Icon name="check" color={C.okInk} size={18} />
        <View style={{ flex: 1, gap: 2 }}>
          <T style={{ fontWeight: '800', color: C.okInk }}>{t('escResolved')}</T>
          {c.escalationResolution ? <T style={{ color: C.okInk, fontSize: 13 }} numberOfLines={4}>{c.escalationResolution}</T> : null}
        </View>
      </View>
    );
  }
  return null;
}
