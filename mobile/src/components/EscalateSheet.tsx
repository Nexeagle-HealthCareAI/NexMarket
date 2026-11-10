import React, { useEffect, useState } from 'react';
import { VoiceField } from './MicButton';
import { View } from 'react-native';
import { Btn, Chip, Field, Sheet, T, toast } from './ui';
import { Icon } from './Icon';
import { useSession } from '../lib/session';
import { ESCALATION_KINDS, raiseIssue, type EscalationKind } from '../lib/repo';
import { quickPosition } from '../lib/location';
import { C } from '../theme';

/**
 * Escalate a partner to the office: what kind of issue and what happened. It lands in the office's
 * escalation queue and in the partner's history (with where the agent was); the agent sees when it's resolved.
 */
export function EscalateSheet({ visible, onClose, contactId, name, onDone }: { visible: boolean; onClose: () => void; contactId: string; name: string; onDone?: () => void }) {
  const { t } = useSession();
  const [kind, setKind] = useState<EscalationKind | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (visible) { setKind(null); setNote(''); } }, [visible]);

  const send = async () => {
    if (!kind || busy) return;
    if (kind === 'escOther' && !note.trim()) return;
    setBusy(true);
    const pos = await quickPosition();
    raiseIssue(contactId, note, t(kind), pos);
    setBusy(false);
    toast(t('escSent'));
    onClose();
    onDone?.();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t('escalateTitle', { name })}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: C.badSoft, borderRadius: 12, padding: 12 }}>
        <Icon name="flag" color={C.bad} size={18} />
        <T style={{ flex: 1, color: C.bad, fontSize: 13 }}>{t('escalateSub')}</T>
      </View>
      <T style={{ fontWeight: '700' }}>{t('escWhat')}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {ESCALATION_KINDS.map((k) => <Chip key={k} label={t(k)} selected={kind === k} color={C.bad} onPress={() => setKind(k)} />)}
      </View>
      <VoiceField voice="note" placeholder={t('escDetails')} value={note} onChangeText={setNote} multiline maxLength={1000} />
      <Btn label={t('escSend')} kind="danger" icon="flag" onPress={() => void send()} loading={busy} disabled={!kind || (kind === 'escOther' && !note.trim())} />
    </Sheet>
  );
}
