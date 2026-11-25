'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { friendlyError, Modal, Skeleton } from '@/components/crm/ui';
import { dayText, errText } from './shared';

export interface LinkableCamp {
  id: string; title: string; code: string; date: string; status: string; place?: string | null; budget: number;
  projectId?: string | null; projectName?: string | null;
}

const STATUS: Record<string, string> = { planned: 'Planned', confirmed: 'Confirmed', done: 'Done', cancelled: 'Cancelled' };

/** The list of health camps to tick, used when making a project and when linking camps to one. */
export function CampChecklist({ projectId, picked, onChange, camps }: { projectId?: string; picked: string[]; onChange: (ids: string[], first?: LinkableCamp) => void; camps: LinkableCamp[] | null }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (camps ?? []).filter((c) => c.projectId !== projectId || !projectId).filter((c) => !t || `${c.title} ${c.code} ${c.place ?? ''}`.toLowerCase().includes(t));
  }, [camps, q, projectId]);
  if (!camps) return <Skeleton h={120} />;
  if (camps.length === 0) return <p className="crm-sub" style={{ margin: 0 }}>No health camps yet. Plan one in Health camps, then link it here.</p>;
  const toggle = (c: LinkableCamp) => {
    const on = picked.includes(c.id);
    onChange(on ? picked.filter((x) => x !== c.id) : [...picked, c.id], on ? undefined : c);
  };
  return (
    <div className="cl-wrap">
      {camps.length > 6 && (
        <label className="crm-search"><Search size={15} aria-hidden /><span className="crm-sr">Search camps</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, code or place" /></label>
      )}
      <ul className="cl-list">
        {shown.map((c) => (
          <li key={c.id}>
            <label className={`cl-row${picked.includes(c.id) ? ' is-on' : ''}`}>
              <input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c)} />
              <span className="cl-main">
                <strong>{c.title}</strong>
                <span className="crm-cell-sub">{dayText(c.date, true)}{c.place ? ` · ${c.place}` : ''} · {STATUS[c.status] ?? c.status} · code {c.code}</span>
                {c.projectName && <span className="cl-moves">Now in “{c.projectName}”. Ticking it moves it here.</span>}
              </span>
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="crm-sub">No camp matches.</li>}
      </ul>
    </div>
  );
}

export function useLinkableCamps() {
  const [camps, setCamps] = useState<LinkableCamp[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { crm.get<LinkableCamp[]>('/api/v1/spend/camps').then(setCamps).catch((e) => { setErr(friendlyError(e)); setCamps([]); }); }, []);
  return { camps, err };
}

/** Link one or more health camps to a project. */
export function LinkCamps({ projectId, projectName, onClose, onLinked }: { projectId: string; projectName: string; onClose: () => void; onLinked: (m: string) => void }) {
  const { camps, err: loadErr } = useLinkableCamps();
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (picked.length === 0) { setErr('Tick at least one camp.'); return; }
    setBusy(true); setErr(null);
    try {
      await crm.post(`/api/v1/spend/projects/${projectId}/camps`, { campIds: picked });
      onLinked(picked.length === 1 ? 'Camp linked. Its patients and earnings now show in this project.' : `${picked.length} camps linked.`);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Link health camps to ${projectName}`} onClose={onClose} actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="crm-btn" onClick={() => void save()} disabled={busy || picked.length === 0}>{busy ? 'Linking…' : picked.length > 1 ? `Link ${picked.length} camps` : 'Link camp'}</button>
    </>}>
      <p className="crm-sub" style={{ margin: 0 }}>The project then shows how many people each camp saw, how many came to the hospital, OPD or admitted, and what was billed, beside what the project spent.</p>
      {loadErr && <p className="ms-err" role="alert">{loadErr}</p>}
      <CampChecklist projectId={projectId} picked={picked} onChange={(ids) => setPicked(ids)} camps={camps} />
      {err && <p className="ms-err" role="alert">{err}</p>}
    </Modal>
  );
}
