import React, { useEffect, useState } from 'react';
import { Btn, Sheet } from './ui';
import { VoiceField } from './MicButton';
import { useSession } from '../lib/session';

/** Write or change what the person came with (in their words; typing or speaking). */
export function ComplaintSheet({ visible, onClose, value, onSave }: { visible: boolean; onClose: () => void; value: string | null; onSave: (text: string) => void }) {
  const { t } = useSession();
  const [text, setText] = useState(value ?? '');
  useEffect(() => { if (visible) setText(value ?? ''); }, [visible, value]);
  return (
    <Sheet visible={visible} onClose={onClose} title={t('apComplaint')}>
      <VoiceField voice="note" value={text} onChangeText={setText} placeholder={t('apComplaintPh')} multiline autoFocus />
      <Btn kind="ok" icon="check" label={t('apSaveComplaint')} onPress={() => onSave(text.trim())} style={{ minHeight: 56, borderRadius: 16 }} />
    </Sheet>
  );
}
