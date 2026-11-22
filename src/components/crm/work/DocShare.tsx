'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Copy, Folder, FolderOpen, Globe2, Home, Lock, UserPlus, X } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { friendlyError, Modal, Skeleton } from '@/components/crm/ui';
import { avatarColor, initials, type FolderRow, type Person } from './shared';

type Role = 'view' | 'comment' | 'edit';
const ROLE_LABEL: Record<Role, string> = { view: 'Can view', comment: 'Can comment', edit: 'Can edit' };
interface AccessRes {
  access: 'team' | 'restricted'; owner: string; role: string; canShare: boolean; canChangeAccess: boolean;
  people: { agentId: string; role: Role; sharedBy: string; sharedAt: string }[];
  limitedBy?: { id: string; name: string } | null;
}

/**
 * Who can open a document or folder, like Google Docs' Share box: open to the team, or only for the people added
 * (no one added = private, only for you). Each person can view, comment or edit. New people get a notification.
 */
export function ShareModal({ kind, id, title, people, me, onClose, toast, onSaved, addFirst }: {
  kind: 'doc' | 'folder'; id: string; title: string; people: Person[]; me: string; onClose: () => void; toast: (m: string) => void;
  onSaved?: (access: 'team' | 'restricted', count: number) => void;
  /** People to add straight away (e.g. someone mentioned in a comment who can't open the document yet). */
  addFirst?: string[];
}) {
  const base = kind === 'doc' ? `/api/v1/work/docs/${id}/access` : `/api/v1/work/docs/folders/${id}/access`;
  const [res, setRes] = useState<AccessRes | null>(null);
  const [access, setAccess] = useState<'team' | 'restricted'>('team');
  const [list, setList] = useState<{ agentId: string; role: Role }[]>([]);
  const [pick, setPick] = useState('');
  const [pickRole, setPickRole] = useState<Role>('view');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const nameOf = (a: string) => people.find((p) => p.agentId === a)?.name ?? a;

  useEffect(() => {
    let alive = true;
    crm.get<AccessRes>(base).then((r) => {
      if (!alive) return;
      setRes(r); setAccess(r.access);
      const start = r.people.map((p) => ({ agentId: p.agentId, role: p.role }));
      for (const a of addFirst ?? []) if (a !== r.owner && !start.some((p) => p.agentId === a)) start.push({ agentId: a, role: 'view' });
      setList(start);
    }).catch((e) => { toast(friendlyError(e)); onClose(); });
    return () => { alive = false; };
  }, [base, toast, onClose, addFirst]);

  const choices = useMemo(() => people.filter((p) => p.role !== 'field_rep' && p.agentId !== res?.owner && !list.some((x) => x.agentId === p.agentId)), [people, res, list]);
  const changed = !!res && (access !== res.access || JSON.stringify(list) !== JSON.stringify(res.people.map((p) => ({ agentId: p.agentId, role: p.role }))));
  const isOwner = res?.role === 'owner';
  const add = () => { if (!pick) return; setList((l) => [...l, { agentId: pick, role: pickRole }]); setPick(''); };

  const save = async () => {
    if (!res) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { people: list, message: message.trim() || undefined };
      if (access !== res.access) body.access = access;
      const r = await crm.put<AccessRes>(base, body);
      onSaved?.(r.access, r.people.length);
      toast(r.access === 'restricted' && r.people.length === 0 ? 'Private: only you can open it.' : 'Sharing saved.');
      onClose();
    } catch (e) { toast(friendlyError(e)); }
    finally { setBusy(false); }
  };
  const copyLink = () => {
    const url = `${window.location.origin}/admin/work?v=docs&${kind === 'doc' ? 'doc' : 'folder'}=${id}`;
    void navigator.clipboard?.writeText(url).then(() => toast('Link copied. Only people who can open it will see it.'), () => toast(url));
  };

  return (
    <Modal title={`Share “${title.length > 50 ? `${title.slice(0, 50)}…` : title}”`} onClose={onClose} actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={copyLink}><Copy size={15} aria-hidden /> Copy link</button>
      <button type="button" className="crm-btn" disabled={busy || !changed} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
    </>}>
      {!res ? <Skeleton h={180} /> : (
        <div className="wk-share">
          <label className="wk-share-general">
            <span className="wk-share-ico">{access === 'team' ? <Globe2 size={18} aria-hidden /> : <Lock size={18} aria-hidden />}</span>
            <span className="wk-share-gtext">
              <strong>Who can open it</strong>
              <select className="crm-input" value={access} disabled={!res.canChangeAccess} onChange={(e) => setAccess(e.target.value as 'team' | 'restricted')} aria-label="Who can open it">
                <option value="team">The team: everyone who can see {kind === 'doc' ? 'its folder' : 'the folder above'} can edit</option>
                <option value="restricted">Only me and the people added below</option>
              </select>
              <span className="crm-sub">
                {!res.canChangeAccess ? `Only ${nameOf(res.owner)} (the owner) can change this.`
                  : access === 'restricted' && list.length === 0 ? 'Private: only you can open it. Admins can’t see it either.'
                  : access === 'restricted' ? 'Only you and these people can open it.'
                  : res.limitedBy ? `It is inside “${res.limitedBy.name}”, so only people who can open that folder see it.`
                  : 'Everyone on the Team board can open and edit it.'}
              </span>
            </span>
          </label>

          <div className="wk-share-people">
            <strong>{access === 'team' ? 'Also shared with' : 'People with access'}</strong>
            <ul>
              <li>
                <span className="wk-av" style={{ background: avatarColor(res.owner), width: 30, height: 30, fontSize: 11 }}>{initials(nameOf(res.owner))}</span>
                <span className="wk-share-name">{nameOf(res.owner)}{res.owner === me ? ' (you)' : ''}</span>
                <span className="crm-sub">Owner</span>
              </li>
              {list.map((p) => (
                <li key={p.agentId}>
                  <span className="wk-av" style={{ background: avatarColor(p.agentId), width: 30, height: 30, fontSize: 11 }}>{initials(nameOf(p.agentId))}</span>
                  <span className="wk-share-name">{nameOf(p.agentId)}{p.agentId === me ? ' (you)' : ''}</span>
                  <select className="crm-input wk-small-in" value={p.role} disabled={!res.canShare} aria-label={`What ${nameOf(p.agentId)} can do`}
                    onChange={(e) => setList((l) => l.map((x) => (x.agentId === p.agentId ? { ...x, role: e.target.value as Role } : x)))}>
                    {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                  {isOwner && <button type="button" className="wk-icon-btn" aria-label={`Remove ${nameOf(p.agentId)}`} title="Remove" onClick={() => setList((l) => l.filter((x) => x.agentId !== p.agentId))}><X size={15} aria-hidden /></button>}
                </li>
              ))}
            </ul>
            {res.canShare ? (
              <div className="wk-share-add">
                <select className="crm-input" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Add a person">
                  <option value="">Add a person…</option>
                  {choices.map((p) => <option key={p.agentId} value={p.agentId}>{p.name}</option>)}
                </select>
                <select className="crm-input wk-small-in" value={pickRole} onChange={(e) => setPickRole(e.target.value as Role)} aria-label="What they can do">
                  {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
                <button type="button" className="crm-btn is-secondary is-sm" disabled={!pick} onClick={add}><UserPlus size={14} aria-hidden /> Add</button>
              </div>
            ) : <p className="crm-sub">You can see who has access, but only {access === 'restricted' ? 'the owner' : 'people who can edit'} can share it.</p>}
            {res.canShare && list.some((p) => !res.people.some((x) => x.agentId === p.agentId)) && (
              <input className="crm-input" value={message} maxLength={300} onChange={(e) => setMessage(e.target.value)} placeholder="A note for the people you added (optional)" aria-label="A note for the people you added" />
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Folders as a tree for choosing where something goes ("Move to…"). Only folders this person can add to are offered. */
export function MoveModal({ folders, current, exclude, onClose, onMove }: {
  folders: FolderRow[]; current: string | null; exclude: string[]; onClose: () => void; onMove: (to: string | null) => void;
}) {
  const [sel, setSel] = useState<string | null>(current);
  const [open, setOpen] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (let f = folders.find((x) => x.id === current); f?.parentId; f = folders.find((x) => x.id === f!.parentId)) s.add(f.parentId);
    return s;
  });
  const banned = useMemo(() => {
    // A folder can't go into itself or anything inside it.
    const out = new Set(exclude);
    let grew = true;
    while (grew) { grew = false; for (const f of folders) if (f.parentId && out.has(f.parentId) && !out.has(f.id)) { out.add(f.id); grew = true; } }
    return out;
  }, [folders, exclude]);
  const kids = (pid: string | null) => folders.filter((f) => (f.parentId ?? null) === pid && f.inTree);
  const node = (f: FolderRow, depth: number): React.ReactNode => {
    const ch = kids(f.id);
    const can = f.role === 'edit' || f.role === 'owner';
    const disabled = !can || banned.has(f.id);
    return (
      <li key={f.id}>
        <div className="wk-move-row" style={{ paddingLeft: 6 + depth * 16 }}>
          {ch.length > 0 ? <button type="button" className="wk-icon-btn" aria-label={open.has(f.id) ? 'Close' : 'Open'} aria-expanded={open.has(f.id)}
            onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; })}>
            <ChevronRight size={14} aria-hidden style={{ transform: open.has(f.id) ? 'rotate(90deg)' : undefined }} /></button> : <span className="wk-move-pad" />}
          <button type="button" className="wk-move-pick" disabled={disabled} aria-pressed={sel === f.id} onClick={() => setSel(f.id)} title={disabled ? (banned.has(f.id) ? 'A folder can’t go inside itself' : 'You can’t add to this folder') : undefined}>
            {sel === f.id ? <FolderOpen size={15} aria-hidden /> : <Folder size={15} aria-hidden />} {f.name}{f.access === 'restricted' && <Lock size={12} aria-label="Private" />}
          </button>
        </div>
        {open.has(f.id) && ch.length > 0 && <ul>{ch.map((c) => node(c, depth + 1))}</ul>}
      </li>
    );
  };
  return (
    <Modal title="Move to" onClose={onClose} actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="crm-btn" disabled={sel === current} onClick={() => onMove(sel)}>Move here</button>
    </>}>
      <ul className="wk-move">
        <li>
          <div className="wk-move-row"><span className="wk-move-pad" />
            <button type="button" className="wk-move-pick" aria-pressed={sel === null} onClick={() => setSel(null)}><Home size={15} aria-hidden /> All documents (top level)</button>
          </div>
        </li>
        {kids(null).map((f) => node(f, 0))}
      </ul>
    </Modal>
  );
}
