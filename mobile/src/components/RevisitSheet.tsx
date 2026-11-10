import React, { useState } from 'react';
import { Btn, Sheet } from './ui';
import { NoteList } from './NoteList';
import { EscalateSheet } from './EscalateSheet';
import { VisitOutcomeForm } from './VisitOutcomeForm';
import { useDb, useSession } from '../lib/session';
import { q, type Note } from '../lib/db';

/**
 * "Visit done" with someone already added: see what was said last time, then tap how it went, when to meet
 * again and (optionally) speak a note. Saved on the phone first as a revisit note plus the follow-up date.
 */
export function RevisitSheet({ visible, onClose, contactId, name }: { visible: boolean; onClose: () => void; contactId: string; name: string }) {
  const { t } = useSession();
  const history = useDb(() => (visible ? q.notesFor(contactId) : ([] as Note[])), [visible, contactId]);
  const [escOpen, setEscOpen] = useState(false);

  return (
    <Sheet visible={visible} onClose={onClose}>
      {/* Mounted fresh on every open, so nothing from a previous visit is still ticked. */}
      {visible ? <VisitOutcomeForm key={contactId} contactId={contactId} name={name} source="revisit" onSaved={onClose} /> : null}
      {history.length ? <NoteList notes={history} limit={2} title={t('earlierComments')} /> : null}
      <Btn kind="danger" icon="flag" label={t('ptGetHelp')} onPress={() => setEscOpen(true)} />
      <EscalateSheet visible={escOpen} onClose={() => setEscOpen(false)} contactId={contactId} name={name} />
    </Sheet>
  );
}
