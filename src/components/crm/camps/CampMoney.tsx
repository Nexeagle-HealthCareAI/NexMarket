'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FolderKanban, Plus } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { rupees } from '@/components/crm/ui';
import { errText } from '@/components/crm/spend/shared';

export interface CampProject {
  id: string; name: string; color: string; status: string; budget?: number | null; received: number; spent: number; otherCamps: number; usedForCost: boolean;
}
interface ProjectLite { id: string; name: string; status: string }

/**
 * The camp's money in Marketing spend. Linked: the project, what it received and spent, and whether its spending is this
 * camp's cost. Not linked: put it in a project, or make a project for it in one go.
 */
export function CampMoney({ campId, campTitle, campDate, campBudget, project, canEdit, onChanged, toast }: {
  campId: string; campTitle: string; campDate: string; campBudget: number; project?: CampProject | null; canEdit: boolean; onChanged: () => void; toast: (m: string) => void;
}) {
  const [projects, setProjects] = useState<ProjectLite[] | null>(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (project || !canEdit) return;
    // People without Marketing spend access just don't see the linking box.
    crm.get<ProjectLite[]>('/api/v1/spend/projects').then((p) => setProjects(p.filter((x) => x.status === 'active'))).catch(() => setProjects(null));
  }, [project, canEdit]);

  const run = async (f: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try { await f(); toast(msg); onChanged(); } catch (e) { toast(errText(e)); } finally { setBusy(false); }
  };
  const link = () => run(() => crm.post(`/api/v1/spend/projects/${pick}/camps`, { campIds: [campId] }), 'Camp put in the project. Its spending is counted there.');
  const make = () => run(() => crm.post('/api/v1/spend/projects', {
    name: campTitle.slice(0, 80), startDate: campDate, endDate: campDate, budget: campBudget > 0 ? campBudget : null, campIds: [campId],
  }), 'Project made for this camp. Add its money in Marketing spend → Projects.');

  if (project) {
    const left = project.budget != null ? project.budget - project.spent : null;
    return (
      <section className="crm-card cm-box" style={{ ['--pc' as string]: project.color }} aria-label="Camp money">
        <FolderKanban size={20} aria-hidden className="cm-ico" />
        <div className="cm-main">
          <span className="cm-kicker">Money kept in Marketing spend</span>
          <Link className="cm-name" href={`/admin/spend?project=${project.id}`}>{project.name}</Link>
          <span className="crm-sub">
            {project.usedForCost ? 'Its spending is this camp’s cost (used for the cost per person here).'
              : project.otherCamps > 0 ? `Shared with ${project.otherCamps} other camp${project.otherCamps === 1 ? '' : 's'}; the camp’s own “Spent” is used for its cost.` : 'Nothing spent in it yet.'}
          </span>
        </div>
        <dl className="cm-nums">
          <div><dt>Received</dt><dd>{rupees(project.received)}</dd></div>
          <div><dt>Spent</dt><dd>{rupees(project.spent)}</dd></div>
          {left != null && <div><dt>Budget left</dt><dd className={left < 0 ? 'is-bad' : ''}>{left < 0 ? `${rupees(-left)} over` : rupees(left)}</dd></div>}
        </dl>
        <Link className="crm-btn is-secondary is-sm" href={`/admin/spend?project=${project.id}`}>Open project</Link>
      </section>
    );
  }
  if (!canEdit || projects == null) return null;
  return (
    <section className="crm-card cm-box is-empty" aria-label="Camp money">
      <FolderKanban size={20} aria-hidden className="cm-ico" />
      <div className="cm-main">
        <span className="cm-kicker">Money for this camp</span>
        <span className="crm-sub">Keep its spending in a Marketing spend project, so money in, expenses and bills sit beside the patients it brought.</span>
      </div>
      <div className="cm-acts">
        {projects.length > 0 && <>
          <label className="crm-sr" htmlFor="cm-pick">Project</label>
          <select id="cm-pick" className="crm-select" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Put it in a project…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {pick && <button type="button" className="crm-btn is-sm" disabled={busy} onClick={() => void link()}>Link</button>}
        </>}
        <button type="button" className="crm-btn is-secondary is-sm" disabled={busy} onClick={() => void make()}><Plus size={14} aria-hidden /> Make a project for it</button>
      </div>
    </section>
  );
}
