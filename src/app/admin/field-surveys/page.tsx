'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Plus } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { canEdit, useAccess } from '@/lib/crm/access';
import { Empty, ErrorBox, friendlyError, PageHead, Pill, Skeleton, useToast } from '@/components/crm/ui';
import { SurveyEditor } from '@/components/crm/fieldsurvey/SurveyEditor';
import { SurveyResults } from '@/components/crm/fieldsurvey/SurveyResults';
import { STATUS_LABEL } from '@/components/crm/fieldsurvey/shared';

interface Row { id: string; title: string; status: string; dueDate?: string | null; createdAt: string; closedAt?: string | null; assigned: number; started: number; submitted: number; spots: number; km: number }

export default function FieldSurveysWrap() {
  return (
    <Suspense fallback={<main className="crm-page"><Skeleton h={520} /></main>}>
      <FieldSurveysPage />
    </Suspense>
  );
}

const day = (d?: string | null) => d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/**
 * Occasional field surveys: an area drawn on the map, given to chosen people, who trace their route (by road type)
 * and mark chowks, crossroads, banner places and the like in the app, and answer a few questions.
 */
function FieldSurveysPage() {
  const params = useSearchParams();
  const router = useRouter();
  const { access } = useAccess();
  const editable = canEdit(access, 'field');
  const id = params.get('id');
  const edit = params.get('edit');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, showToast] = useToast();
  const go = (q: string) => router.replace(`/admin/field-surveys${q}`, { scroll: false });

  const load = useCallback(async () => {
    try { setRows((await crm.get<{ items: Row[] }>('/api/v1/field-surveys')).items); setError(null); } catch (e) { setError(friendlyError(e)); }
  }, []);
  useEffect(() => { if (id || edit) return; const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load, id, edit]);

  return (
    <main className="crm-page">
      <PageHead title="Field mapping" sub="Occasional surveys: draw an area, give it to the people who should go, and see their routes (by road type), the chowks, crossroads and banner places they mark, and their answers." >
        {!id && !edit && editable && <button type="button" className="crm-btn" onClick={() => go('?edit=new')}><Plus size={16} aria-hidden /> New field survey</button>}
      </PageHead>
      {(id || edit) && <button type="button" className="wa-link fs-back" onClick={() => go(edit && edit !== 'new' ? `?id=${edit}` : '')}><ArrowLeft size={15} aria-hidden /> {edit && edit !== 'new' ? 'Back to results' : 'All field surveys'}</button>}

      {edit && editable ? (
        <SurveyEditor id={edit === 'new' ? null : edit} toast={showToast} onCancel={() => go(edit !== 'new' ? `?id=${edit}` : '')} onDone={(nid) => go(`?id=${nid}`)} />
      ) : id ? (
        <SurveyResults id={id} editable={editable} toast={showToast} onEdit={() => go(`?edit=${id}`)} />
      ) : error && !rows ? <ErrorBox message={error} onRetry={load} /> : !rows ? <Skeleton h={400} /> : rows.length === 0 ? (
        <section className="crm-card"><Empty title="No field surveys yet">
          <span className="crm-sub">Make one when you need an area mapped: draw it on the map, pick what to mark and who goes. It appears in their app under Field mapping, and works without internet.</span>
          {editable && <button type="button" className="crm-btn is-sm" onClick={() => go('?edit=new')}>New field survey</button>}
        </Empty></section>
      ) : (
        <section className="crm-card">
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead><tr><th scope="col">Survey</th><th scope="col">Status</th><th scope="col">People</th><th scope="col" className="wb-num">Route</th><th scope="col" className="wb-num">Spots</th><th scope="col">Finish by</th><th scope="col">Made</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="fs-row" onClick={() => go(`?id=${r.id}`)}>
                    <td><button type="button" className="wa-link" onClick={(e) => { e.stopPropagation(); go(`?id=${r.id}`); }}>{r.title}</button></td>
                    <td><Pill tone={r.status === 'active' ? 'accent' : r.status === 'draft' ? 'warn' : 'neutral'}>{STATUS_LABEL[r.status] ?? r.status}</Pill></td>
                    <td>{r.submitted}/{r.assigned} submitted<span className="crm-cell-sub" style={{ display: 'block' }}>{r.started} started</span></td>
                    <td className="wb-num">{r.km} km</td>
                    <td className="wb-num">{r.spots}</td>
                    <td>{day(r.dueDate)}</td>
                    <td>{day(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {toast}
    </main>
  );
}
