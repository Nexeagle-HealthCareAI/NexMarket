'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Tent, X } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { Pill } from '@/components/crm/ui';
import { LinkCamps } from './CampLink';
import { dayText, errText, rs } from './shared';

export interface ProjectCampRow {
  id: string; title: string; code: string; date: string; status: string; place?: string | null;
  booked: number; seen: number; referred: number; came: number; opd: number; admitted: number; billed: number; collected: number;
}
export interface ProjectCamps {
  rows: ProjectCampRow[];
  total: { camps: number; booked: number; seen: number; referred: number; came: number; opd: number; admitted: number; billed: number; collected: number;
    perSeen?: number | null; perCame?: number | null; returnX?: number | null };
}

const STATUS: Record<string, { label: string; tone: 'neutral' | 'info' | 'ok' | 'bad' }> = {
  planned: { label: 'Planned', tone: 'neutral' }, confirmed: { label: 'Confirmed', tone: 'info' }, done: { label: 'Done', tone: 'ok' }, cancelled: { label: 'Cancelled', tone: 'bad' },
};

/** The health camps in a project: what each brought, and the project's spending set against it. */
export function ProjectCampsBand({ projectId, projectName, spent, data, canHandle, open, toast, onChanged }: {
  projectId: string; projectName: string; spent: number; data?: ProjectCamps; canHandle: boolean; open: boolean; toast: (m: string) => void; onChanged: () => Promise<void>;
}) {
  const [linking, setLinking] = useState(false);
  const rows = data?.rows ?? [];
  const t = data?.total;
  const unlink = async (c: ProjectCampRow) => {
    if (!window.confirm(`Take “${c.title}” out of this project? The camp and its patients stay as they are; only the link goes.`)) return;
    try { await crm.post(`/api/v1/spend/projects/${projectId}/camps/${c.id}/unlink`); toast('Camp taken out of the project.'); await onChanged(); } catch (e) { toast(errText(e)); }
  };
  const modal = linking && <LinkCamps projectId={projectId} projectName={projectName} onClose={() => setLinking(false)} onLinked={(m) => { setLinking(false); toast(m); void onChanged(); }} />;

  if (rows.length === 0) {
    if (!canHandle || !open) return null;
    return (
      <>
        <button type="button" className="pc-empty" onClick={() => setLinking(true)}>
          <Tent size={18} aria-hidden />
          <span><strong>Is this project for a health camp?</strong> Link the camp to see its patients, hospital visits and earnings beside this spending.</span>
          <span className="pc-empty-go"><Plus size={14} aria-hidden /> Link a camp</span>
        </button>
        {modal}
      </>
    );
  }

  return (
    <section className="crm-card pc-band" aria-labelledby="pc-h">
      <div className="pc-head">
        <h3 id="pc-h" className="crm-h2"><Tent size={18} aria-hidden /> Health camp{rows.length === 1 ? '' : 's'} in this project</h3>
        {canHandle && open && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setLinking(true)}><Plus size={14} aria-hidden /> Link a camp</button>}
      </div>

      {t && (
        <div className="pc-sum" aria-label="What the camps brought for the money spent">
          <div><span>Spent</span><strong>{rs(spent)}</strong></div>
          <div><span>People seen</span><strong>{t.seen}</strong><em>{t.perSeen ? `${rs(t.perSeen)} a person` : `${t.booked} booked`}</em></div>
          <div><span>Sent to hospital</span><strong>{t.referred}</strong></div>
          <div><span>Came</span><strong>{t.came}</strong><em>{t.perCame ? `${rs(t.perCame)} a patient` : `${t.opd} OPD · ${t.admitted} admitted`}</em></div>
          <div><span>OPD · admitted</span><strong>{t.opd} · {t.admitted}</strong></div>
          <div className="is-main"><span>Billed at hospital</span><strong>{rs(t.billed)}</strong><em>{t.returnX ? `${t.returnX}× what was spent` : t.collected ? `${rs(t.collected)} collected` : 'nothing billed yet'}</em></div>
        </div>
      )}

      <div className="crm-table-wrap">
        <table className="crm-table pc-table">
          <thead><tr><th scope="col">Camp</th><th scope="col" className="is-num">Seen</th><th scope="col" className="is-num">Sent</th><th scope="col" className="is-num">Came</th><th scope="col" className="is-num">OPD</th><th scope="col" className="is-num">Admitted</th><th scope="col" className="is-num">Billed</th>{canHandle && open && <th scope="col"><span className="crm-sr">Unlink</span></th>}</tr></thead>
          <tbody>
            {rows.map((c) => {
              const st = STATUS[c.status] ?? STATUS.planned;
              return (
                <tr key={c.id}>
                  <td>
                    <Link href={`/admin/camps?id=${c.id}`} className="pc-title">{c.title}</Link>
                    <span className="crm-cell-sub" style={{ display: 'block' }}>{dayText(c.date, true)}{c.place ? ` · ${c.place}` : ''} · <Pill tone={st.tone}>{st.label}</Pill></span>
                  </td>
                  <td className="is-num">{c.seen}{c.booked > c.seen && c.status !== 'done' ? <span className="crm-cell-sub" style={{ display: 'block' }}>{c.booked} booked</span> : null}</td>
                  <td className="is-num">{c.referred}</td>
                  <td className="is-num">{c.came}</td>
                  <td className="is-num">{c.opd}</td>
                  <td className="is-num">{c.admitted}</td>
                  <td className="is-num"><strong>{rs(c.billed)}</strong>{c.billed > 0 && c.collected < c.billed ? <span className="crm-cell-sub" style={{ display: 'block' }}>{rs(c.collected)} collected</span> : null}</td>
                  {canHandle && open && <td><button type="button" className="crm-btn is-ghost is-sm" aria-label={`Take ${c.title} out of the project`} title="Take out of the project" onClick={() => void unlink(c)}><X size={15} aria-hidden /></button></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {modal}
    </section>
  );
}
