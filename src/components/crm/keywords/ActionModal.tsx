'use client';

import { useState } from 'react';
import { crm } from '@/lib/sync/api-client';
import { friendlyError, Modal } from '@/components/crm/ui';
import { KIND_LABEL, STAGE_LABEL, STAGES, type ActionKind, type KwActionRow, type Person, type Stage } from './shared';

export interface ActionDraft { topicId: string; topicName: string; kind: ActionKind; title: string }

/** Adds or edits one action on a topic: a page, post, ad group, camp or broadcast, with who does it and how its leads are counted. */
export function ActionModal({ draft, action, people, onClose, onSaved }: {
  draft?: ActionDraft; action?: KwActionRow & { topicName?: string }; people: Person[]; onClose: () => void; onSaved: (msg: string) => void;
}) {
  const [kind, setKind] = useState<ActionKind>(action?.kind ?? draft?.kind ?? 'page');
  const [title, setTitle] = useState(action?.title ?? draft?.title ?? '');
  const [stage, setStage] = useState<Stage>(action?.stage ?? 'idea');
  const [owner, setOwner] = useState(action?.ownerId ?? '');
  const [due, setDue] = useState(action?.dueOn ?? '');
  const [code, setCode] = useState(action?.linkCode ?? '');
  const [url, setUrl] = useState(action?.url ?? '');
  const [spend, setSpend] = useState(action?.spend != null ? String(action.spend) : '');
  const [brief, setBrief] = useState(action?.brief ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const topicName = action?.topicName ?? draft?.topicName;

  const save = async () => {
    setBusy(true); setErr(null);
    const body = {
      kind, title, stage, ownerId: owner, dueOn: due || null, linkCode: code, url, brief,
      spend: spend.trim() === '' ? 0 : Number(spend.replace(/[^\d]/g, '')),
    };
    try {
      if (action) await crm.put(`/api/v1/keywords/actions/${action.id}`, body);
      else await crm.post('/api/v1/keywords/actions', { ...body, topicId: draft!.topicId });
      onSaved(action ? 'Saved.' : 'Added to the content plan.');
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!action) return;
    setBusy(true);
    try { await crm.del(`/api/v1/keywords/actions/${action.id}`); onSaved('Removed.'); } catch (e) { setErr(friendlyError(e)); setBusy(false); }
  };

  return (
    <Modal title={action ? 'Edit action' : 'Plan an action'} onClose={onClose} wide
      actions={<>
        {action && <button type="button" className="crm-btn is-secondary" disabled={busy} onClick={() => void remove()} style={{ marginRight: 'auto' }}>Remove</button>}
        <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="crm-btn" disabled={busy || title.trim().length < 3} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
      </>}>
      <div className="kw-form">
        {topicName && <p className="crm-sub" style={{ margin: 0 }}>Topic: <strong style={{ color: 'var(--text)' }}>{topicName}</strong></p>}
        <div className="kw-form-row">
          <label className="crm-field">What
            <select className="crm-select" value={kind} onChange={(e) => setKind(e.target.value as ActionKind)}>
              {(Object.keys(KIND_LABEL) as ActionKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="crm-field">Stage
            <select className="crm-select" value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
              {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
            </select>
          </label>
        </div>
        <label className="crm-field">Title
          <input className="crm-input" value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. पथरी का इलाज: खर्च, समय, डॉक्टर" />
        </label>
        <div className="kw-form-row">
          <label className="crm-field">Who does it
            <select className="crm-select" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Nobody yet</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="crm-field">Due
            <input className="crm-input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
        </div>
        <fieldset className="kw-fieldset">
          <legend>How its patients are counted</legend>
          <div className="kw-form-row">
            <label className="crm-field">Tracked link code <span className="crm-sub">From Lead sources, e.g. GGL-STONE</span>
              <input className="crm-input" value={code} maxLength={16} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            </label>
            <label className="crm-field">Page address <span className="crm-sub">Enquiries from this page count</span>
              <input className="crm-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="/blog/pathri-ka-ilaj" />
            </label>
            <label className="crm-field">Spent (₹) <span className="crm-sub">For cost per patient</span>
              <input className="crm-input" inputMode="numeric" value={spend} onChange={(e) => setSpend(e.target.value)} />
            </label>
          </div>
        </fieldset>
        <label className="crm-field">Brief or notes
          <textarea className="crm-textarea kw-brief" rows={8} value={brief} onChange={(e) => setBrief(e.target.value)} />
        </label>
        {err && <p className="gg-err" role="alert" style={{ margin: 0 }}>{err}</p>}
      </div>
    </Modal>
  );
}
