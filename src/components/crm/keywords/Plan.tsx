'use client';

import { useState } from 'react';
import Link from 'next/link';
import { crm } from '@/lib/sync/api-client';
import { Empty, ErrorBox, friendlyError, rupees, Skeleton, useLoader } from '@/components/crm/ui';
import { ActionModal } from './ActionModal';
import { KIND_SHORT, num, STAGE_LABEL, STAGES, type KwActionRow, type Person, type Stage } from './shared';

interface PlanRes { stages: Stage[]; items: { action: KwActionRow; topic?: { id: string; name: string; score: number; demand: number } | null }[] }

/** Every page, post, ad group, camp and broadcast made from a keyword topic, by stage, with what each brought. */
export function Plan({ people, editable, onOpen, toast }: { people: Person[]; editable: boolean; onOpen: (id: string) => void; toast: (m: string) => void }) {
  const data = useLoader(() => crm.get<PlanRes>('/api/v1/keywords/plan'));
  const [edit, setEdit] = useState<(KwActionRow & { topicName?: string }) | null>(null);
  const [showDone, setShowDone] = useState(false);
  const d = data.data;

  const move = async (a: KwActionRow, stage: Stage) => {
    try { await crm.put(`/api/v1/keywords/actions/${a.id}`, { stage }); toast(`Moved to ${STAGE_LABEL[stage]}.`); void data.reload(); }
    catch (e) { toast(friendlyError(e)); }
  };

  if (data.error) return <ErrorBox message={data.error} onRetry={data.reload} />;
  if (!d) return <Skeleton h={420} />;
  if (d.items.length === 0) return <Empty title="Nothing planned yet">Open a topic under Opportunities and press its next step, or Write a page brief. Everything planned shows here.</Empty>;
  const stages = STAGES.filter((s) => showDone || s !== 'done');

  return (
    <div className="kw-stack">
      <div className="kw-plan-bar">
        <p className="crm-sub" style={{ margin: 0 }}>Medical pages go through doctor review in Manage website before they are published.</p>
        <label className="kw-check"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done</label>
      </div>
      <div className="kw-board">
        {stages.map((s) => {
          const items = d.items.filter((i) => i.action.stage === s);
          return (
            <section key={s} className="kw-col" aria-label={STAGE_LABEL[s]}>
              <div className="kw-col-head"><h3>{STAGE_LABEL[s]}</h3><span>{items.length}</span></div>
              {items.map(({ action: a, topic }) => (
                <article key={a.id} className="kw-cardlet">
                  <span className={`kw-kind is-${a.kind}`}>{KIND_SHORT[a.kind]}</span>
                  <button type="button" className="kw-cardlet-title" onClick={() => setEdit({ ...a, topicName: topic?.name })}>{a.title}</button>
                  {topic && <button type="button" className="kw-cardlet-topic" onClick={() => onOpen(topic.id)}>{topic.name} · {num(topic.demand)} searches</button>}
                  <div className="kw-cardlet-foot">
                    <span>{a.ownerName ?? 'Not assigned'}{a.dueOn ? ` · due ${a.dueOn}` : ''}</span>
                    <strong>{a.came != null ? `${a.came} ${a.came === 1 ? 'patient' : 'patients'}` : a.spend ? rupees(a.spend) : ''}</strong>
                  </div>
                  {a.costPerPatient != null && <span className="kw-meta">{rupees(a.costPerPatient)} per patient</span>}
                  {a.kind === 'page' && (s === 'brief' || s === 'writing') && <Link className="wa-link kw-small" href="/admin/website">Write it in Manage website →</Link>}
                  {editable && (
                    <label className="kw-move"><span className="kw-sr">Stage of “{a.title}”</span>
                      <select className="crm-select kw-mini" value={a.stage} onChange={(e) => void move(a, e.target.value as Stage)}>
                        {STAGES.map((x) => <option key={x} value={x}>{STAGE_LABEL[x]}</option>)}
                      </select>
                    </label>
                  )}
                </article>
              ))}
            </section>
          );
        })}
      </div>
      {edit && <ActionModal action={edit} people={people} onClose={() => setEdit(null)} onSaved={(m) => { setEdit(null); toast(m); void data.reload(); }} />}
    </div>
  );
}
