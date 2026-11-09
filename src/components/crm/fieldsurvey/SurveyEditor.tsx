'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Search, Trash2, Undo2, X } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { ErrorBox, friendlyError, Skeleton } from '@/components/crm/ui';
import FieldMap from './FieldMap';
import { newId, Q_LABEL, roleLabel, type Defaults, type FQuestion, type QType } from './shared';

export interface EditorValue {
  title: string; instructions: string; dueDate: string; area: [number, number][];
  spotTypes: string[]; roadTypes: string[]; questions: FQuestion[]; assignees: string[];
}

/** A list of short names the admin can add to and remove from (spot types, road types, answer options). */
function TagList({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [t, setT] = useState('');
  const add = () => {
    const v = t.trim();
    if (v && !value.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...value, v]);
    setT('');
  };
  return (
    <div className="fs-tags">
      {value.map((v) => (
        <span key={v} className="fs-tag">{v}<button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}><X size={13} aria-hidden /></button></span>
      ))}
      <span className="fs-tag-add">
        <input className="crm-input" value={t} maxLength={60} placeholder={placeholder} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" className="crm-btn is-secondary is-sm" onClick={add} disabled={!t.trim()}><Plus size={14} aria-hidden /> Add</button>
      </span>
    </div>
  );
}

/** Create or change an occasional field survey: area on the map, what to mark, the questions, and who does it. */
export function SurveyEditor({ id, onDone, onCancel, toast }: { id: string | null; onDone: (id: string) => void; onCancel: () => void; toast: (m: string) => void }) {
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [v, setV] = useState<EditorValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const d = await crm.get<Defaults>('/api/v1/field-surveys/defaults');
        let val: EditorValue = { title: '', instructions: '', dueDate: '', area: [], spotTypes: d.spotTypes, roadTypes: d.roadTypes, questions: [], assignees: [] };
        if (id) {
          const r = await crm.get<{ survey: { title: string; instructions?: string | null; dueDate?: string | null; area: [number, number][]; spotTypes: string[]; roadTypes: string[]; questions: FQuestion[] }; people: { agentId: string }[] }>(`/api/v1/field-surveys/${id}`);
          val = { title: r.survey.title, instructions: r.survey.instructions ?? '', dueDate: r.survey.dueDate ?? '', area: r.survey.area, spotTypes: r.survey.spotTypes, roadTypes: r.survey.roadTypes, questions: r.survey.questions, assignees: r.people.map((p) => p.agentId) };
        }
        if (live) { setDefaults(d); setV(val); }
      } catch (e) { if (live) setError(friendlyError(e)); }
    })();
    return () => { live = false; };
  }, [id]);

  const people = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (defaults?.people ?? []).filter((p) => (!role || p.role === role) && (!s || p.name.toLowerCase().includes(s) || p.agentId.toLowerCase().includes(s) || (p.block ?? '').toLowerCase().includes(s)));
  }, [defaults, q, role]);
  const roles = useMemo(() => [...new Set((defaults?.people ?? []).map((p) => p.role))], [defaults]);

  if (error) return <ErrorBox message={error} />;
  if (!v || !defaults) return <Skeleton h={600} />;
  const set = (patch: Partial<EditorValue>) => setV({ ...v, ...patch });
  const setQn = (i: number, patch: Partial<FQuestion>) => set({ questions: v.questions.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const move = (i: number, d: -1 | 1) => { const qs = [...v.questions]; const [x] = qs.splice(i, 1); qs.splice(i + d, 0, x); set({ questions: qs }); };

  const save = async (status: 'active' | 'draft') => {
    setBusy(true);
    try {
      const body = { title: v.title, instructions: v.instructions, dueDate: v.dueDate || null, area: v.area, spotTypes: v.spotTypes, roadTypes: v.roadTypes, questions: v.questions, assignees: v.assignees, status };
      const r = id ? await crm.put<{ id: string }>(`/api/v1/field-surveys/${id}`, body) : await crm.post<{ id: string }>('/api/v1/field-surveys', body);
      toast(status === 'active' ? `Saved. ${v.assignees.length} ${v.assignees.length === 1 ? 'person sees' : 'people see'} it in the app.` : 'Saved as a draft. Nobody sees it in the app yet.');
      onDone(r.id);
    } catch (e) { toast(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <div className="fs-editor">
      <section className="crm-card so-card">
        <h2 className="crm-h2" style={{ margin: 0 }}>{id ? 'Change field survey' : 'New field survey'}</h2>
        <div className="gg-form">
          <label className="crm-field">Name<input className="crm-input" value={v.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Kishanganj town – banner places" /></label>
          <label className="crm-field">Finish by (optional)<input className="crm-input" type="date" value={v.dueDate} onChange={(e) => set({ dueDate: e.target.value })} /></label>
        </div>
        <label className="crm-field">What to do (shown in the app)
          <textarea className="crm-input" rows={3} maxLength={2000} value={v.instructions} onChange={(e) => set({ instructions: e.target.value })}
            placeholder="e.g. Walk every main road in the area. Mark every chowk and every place where a banner could go, with a photo." />
        </label>
      </section>

      <section className="crm-card so-card">
        <div className="sp-bar">
          <h2 className="crm-h2" style={{ margin: 0 }}>Area</h2>
          <span className="sp-actions">
            <button type="button" className="crm-btn is-secondary is-sm" disabled={!v.area.length} onClick={() => set({ area: v.area.slice(0, -1) })}><Undo2 size={14} aria-hidden /> Undo last corner</button>
            <button type="button" className="crm-btn is-secondary is-sm" disabled={!v.area.length} onClick={() => set({ area: [] })}><Trash2 size={14} aria-hidden /> Start again</button>
          </span>
        </div>
        <p className="crm-sub" style={{ margin: 0 }}>Click on the map to place the corners of the area, one after another; drag a corner to move it. Switch to Satellite to see roads and chowks. {v.area.length >= 3 ? `${v.area.length} corners.` : `At least 3 corners (${v.area.length} so far).`}</p>
        <FieldMap area={v.area} onArea={(a) => set({ area: a })} height={460} fitKey={id ?? 'new'} />
      </section>

      <section className="crm-card so-card">
        <h2 className="crm-h2" style={{ margin: 0 }}>What to mark</h2>
        <div className="fs-field-l">Spot types <span className="crm-sub">the agent picks one for each spot (chowk, banner place…)</span></div>
        <TagList value={v.spotTypes} onChange={(x) => set({ spotTypes: x })} placeholder="Add a spot type" />
        <div className="fs-field-l">Road types <span className="crm-sub">the agent switches these while walking, and picks one for each spot</span></div>
        <TagList value={v.roadTypes} onChange={(x) => set({ roadTypes: x })} placeholder="Add a road type" />
      </section>

      <section className="crm-card so-card">
        <div className="sp-bar">
          <h2 className="crm-h2" style={{ margin: 0 }}>Questions <span className="crm-sub">(optional, answered once in the app, separately from the map)</span></h2>
          <button type="button" className="crm-btn is-secondary is-sm" onClick={() => set({ questions: [...v.questions, { id: newId(), text: '', type: 'text', options: null, required: false }] })}><Plus size={14} aria-hidden /> Add question</button>
        </div>
        {v.questions.length === 0 && <p className="crm-sub" style={{ margin: 0 }}>No questions. Add some if the agent should also report something about the area, e.g. &ldquo;Which hospital&apos;s banners are already up here?&rdquo;</p>}
        {v.questions.map((qn, i) => (
          <div key={qn.id} className="fs-q">
            <span className="fs-q-n">{i + 1}</span>
            <div className="fs-q-body">
              <input className="crm-input" value={qn.text} maxLength={300} placeholder="Question" onChange={(e) => setQn(i, { text: e.target.value })} />
              <div className="fs-q-row">
                <select className="crm-input" value={qn.type} onChange={(e) => setQn(i, { type: e.target.value as QType, options: ['choice', 'multi'].includes(e.target.value) ? (qn.options?.length ? qn.options : []) : null })} style={{ maxWidth: 200 }}>
                  {defaults.questionTypes.map((t) => <option key={t} value={t}>{Q_LABEL[t]}</option>)}
                </select>
                <label className="fs-check"><input type="checkbox" checked={qn.required} onChange={(e) => setQn(i, { required: e.target.checked })} /> Must answer</label>
                <span className="sp-actions" style={{ marginLeft: 'auto' }}>
                  <button type="button" className="crm-btn is-secondary is-sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} aria-hidden /></button>
                  <button type="button" className="crm-btn is-secondary is-sm" aria-label="Move down" disabled={i === v.questions.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} aria-hidden /></button>
                  <button type="button" className="crm-btn is-secondary is-sm" aria-label="Remove question" onClick={() => set({ questions: v.questions.filter((_, j) => j !== i) })}><Trash2 size={14} aria-hidden /></button>
                </span>
              </div>
              {(qn.type === 'choice' || qn.type === 'multi') && <TagList value={qn.options ?? []} onChange={(o) => setQn(i, { options: o })} placeholder="Add an answer" />}
            </div>
          </div>
        ))}
      </section>

      <section className="crm-card so-card">
        <div className="sp-bar">
          <h2 className="crm-h2" style={{ margin: 0 }}>Who does it <span className="crm-sub">· {v.assignees.length} picked</span></h2>
          {v.assignees.length > 0 && <button type="button" className="wa-link" onClick={() => set({ assignees: [] })}>Clear</button>}
        </div>
        <div className="fs-people-bar">
          <label className="crm-search" style={{ flex: '1 1 240px' }}><Search size={16} aria-hidden /><span className="crm-sr">Find a person</span>
            <input className="crm-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, ID or block" /></label>
          <div className="crm-chips">
            <button type="button" className="crm-chip" aria-pressed={!role} onClick={() => setRole('')}>Everyone</button>
            {roles.map((r) => <button key={r} type="button" className="crm-chip" aria-pressed={role === r} onClick={() => setRole(r)}>{roleLabel(r)}</button>)}
          </div>
        </div>
        <ul className="fs-people">
          {people.map((p) => {
            const on = v.assignees.includes(p.agentId);
            return (
              <li key={p.agentId}>
                <label className={`fs-person${on ? ' is-on' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => set({ assignees: on ? v.assignees.filter((x) => x !== p.agentId) : [...v.assignees, p.agentId] })} />
                  <span><strong>{p.name}</strong><span className="crm-sub">{roleLabel(p.role)}{p.block ? ` · ${p.block}` : ''} · {p.agentId}</span></span>
                </label>
              </li>
            );
          })}
          {people.length === 0 && <li className="crm-sub">Nobody matches.</li>}
        </ul>
      </section>

      <div className="fs-save">
        <button type="button" className="crm-btn" disabled={busy || !v.title.trim() || v.area.length < 3} onClick={() => void save('active')}>{busy ? 'Saving…' : v.assignees.length ? `Save and send to ${v.assignees.length}` : 'Save'}</button>
        <button type="button" className="crm-btn is-secondary" disabled={busy || !v.title.trim() || v.area.length < 3} onClick={() => void save('draft')}>Save as draft</button>
        <button type="button" className="crm-btn is-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
        {(v.area.length < 3 || !v.title.trim()) && <span className="crm-sub">{!v.title.trim() ? 'Give it a name.' : 'Draw the area on the map.'}</span>}
      </div>
    </div>
  );
}
