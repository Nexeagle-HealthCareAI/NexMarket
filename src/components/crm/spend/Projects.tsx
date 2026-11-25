'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, FolderKanban, HandCoins, Plus, Tent } from 'lucide-react';
import { CampChecklist, useLinkableCamps } from './CampLink';
import { crm } from '@/lib/sync/api-client';
import { Empty, ErrorBox, friendlyError, Modal, Pill, Skeleton } from '@/components/crm/ui';
import { dayText, errText, MODE, money, NATURE, PALETTE, rs, type Data, type Staff } from './shared';

export interface ProjectRow {
  id: string; name: string; description?: string | null; budget?: number | null; startDate?: string | null; endDate?: string | null;
  status: 'active' | 'closed'; leadId?: string | null; leadName?: string | null; color: string;
  received: number; spent: number; constant: number; variable: number; pending: number; left?: number | null; usedPct?: number | null; entries: number;
  camps?: string[];
}

/** A project's budget as a bar: spent against the budget, with what was received marked. */
function BudgetBar({ p }: { p: ProjectRow }) {
  if (p.budget == null) return <p className="crm-sub mp-nobudget">No budget set{p.received ? ` · ${rs(p.received - p.spent)} of what was received is left` : ''}</p>;
  const used = p.usedPct ?? 0;
  const recv = p.budget > 0 ? Math.min(100, (p.received / p.budget) * 100) : 0;
  return (
    <div className="mp-budget">
      <span className={`ma-meter is-tall${used >= 100 ? ' is-bad' : used >= 85 ? ' is-warn' : ''}`} role="img" aria-label={`${used}% of the ${rs(p.budget)} budget spent; ${rs(p.received)} received`}>
        <span style={{ width: `${Math.min(100, used)}%` }} />
        {p.received > 0 && <em style={{ left: `${recv}%` }} title={`Received ${rs(p.received)}`} />}
      </span>
      <span className="mp-budget-t"><strong>{used}%</strong> of {rs(p.budget)} · {p.left != null && p.left < 0 ? <b className="is-bad">{rs(-p.left)} over</b> : `${rs(p.left ?? 0)} left`}</span>
    </div>
  );
}

/** Every project as a card: its budget, money received and spent (constant and variable), and what is left. */
export function ProjectsTab({ data, canHandle, onOpen, onAddFund, toast, refreshKey }: {
  data: Data; canHandle: boolean; onOpen: (id: string, mode?: 'in' | 'out') => void; onAddFund: (projectId?: string) => void;
  toast: (m: string) => void; refreshKey: number;
}) {
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [form, setForm] = useState<{ edit?: ProjectRow } | null>(null);
  const load = useCallback(async () => { try { setRows(await crm.get<ProjectRow[]>('/api/v1/spend/projects')); setErr(null); } catch (e) { setErr(friendlyError(e)); } }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load, refreshKey]);
  if (err && !rows) return <ErrorBox message={err} onRetry={load} />;
  if (!rows) return <Skeleton h={300} />;
  const open = rows.filter((p) => p.status === 'active');
  const shut = rows.filter((p) => p.status === 'closed');
  const list = closed ? shut : open;
  const tot = open.reduce((a, p) => ({ budget: a.budget + (p.budget ?? 0), received: a.received + p.received, spent: a.spent + p.spent }), { budget: 0, received: 0, spent: 0 });

  return (
    <>
      <div className="ms-range">
        <div className="crm-chips" role="group" aria-label="Which projects">
          <button type="button" className="crm-chip" aria-pressed={!closed} onClick={() => setClosed(false)}>Open · {open.length}</button>
          <button type="button" className="crm-chip" aria-pressed={closed} onClick={() => setClosed(true)}>Closed · {shut.length}</button>
        </div>
        {canHandle && <span className="mp-acts">
          <button type="button" className="crm-btn is-secondary is-sm" onClick={() => onAddFund()}><HandCoins size={15} aria-hidden /> Money received</button>
          <button type="button" className="crm-btn is-sm" onClick={() => setForm({})}><Plus size={15} aria-hidden /> New project</button>
        </span>}
      </div>
      {!closed && open.length > 0 && (
        <div className="crm-kpis">
          <div className="crm-card crm-kpi"><span className="crm-kpi-label">Budget of open projects</span><span className="crm-kpi-value">{rs(tot.budget)}</span><span className="crm-sub">{open.filter((p) => p.budget != null).length} of {open.length} have a budget</span></div>
          <div className="crm-card crm-kpi"><span className="crm-kpi-label">Received for them</span><span className="crm-kpi-value">{rs(tot.received)}</span><span className="crm-sub">Funds recorded against a project</span></div>
          <div className="crm-card crm-kpi"><span className="crm-kpi-label">Spent on them</span><span className="crm-kpi-value">{rs(tot.spent)}</span><span className="crm-sub">All time, approved</span></div>
          <div className="crm-card crm-kpi"><span className="crm-kpi-label">Over budget</span><span className="crm-kpi-value">{open.filter((p) => (p.usedPct ?? 0) > 100).length}</span><span className="crm-sub">{open.filter((p) => (p.usedPct ?? 0) >= 85 && (p.usedPct ?? 0) <= 100).length} close to it</span></div>
        </div>
      )}
      {list.length === 0 ? (
        <section className="crm-card">
          <Empty title={closed ? 'No closed projects' : 'No projects yet'}>
            <span className="crm-sub">A project keeps the money of one piece of work together: a health camp, a campaign, a launch. Give it a budget, record the funds received for it, and pick it when adding an expense.</span>
            {canHandle && !closed && <button type="button" className="crm-btn is-sm" onClick={() => setForm({})}>New project</button>}
          </Empty>
        </section>
      ) : (
        <div className="mp-grid">
          {list.map((p) => (
            <article key={p.id} className="crm-card mp-card" style={{ borderTopColor: p.color }}>
              <div className="mp-card-h">
                <FolderKanban size={18} aria-hidden style={{ color: p.color }} />
                <h3><button type="button" className="wa-link" onClick={() => onOpen(p.id)}>{p.name}</button></h3>
                {p.status === 'closed' && <Pill>Closed</Pill>}
              </div>
              <p className="crm-sub mp-meta">{[p.leadName ? `Led by ${p.leadName}` : null, p.startDate ? `${dayText(p.startDate)}${p.endDate ? ` – ${dayText(p.endDate)}` : ''}` : null].filter(Boolean).join(' · ') || 'No lead or dates yet'}</p>
              {(p.camps?.length ?? 0) > 0 && <p className="mp-camps"><Tent size={14} aria-hidden /> {p.camps!.length === 1 ? p.camps![0] : `${p.camps!.length} health camps: ${p.camps!.join(', ')}`}</p>}
              <BudgetBar p={p} />
              <div className="mp-hand"><span>In hand</span><strong className={p.received - p.spent < 0 ? 'is-neg' : ''}>{p.received - p.spent < 0 ? `− ${rs(p.spent - p.received)}` : rs(p.received - p.spent)}</strong></div>
              <dl className="mp-nums">
                <div><dt>Received</dt><dd className="is-in">{rs(p.received)}</dd></div>
                <div><dt>Spent</dt><dd className="is-out">{rs(p.spent)}</dd></div>
                <div><dt><i style={{ background: NATURE.constant.color }} aria-hidden />Constant</dt><dd>{rs(p.constant)}</dd></div>
                <div><dt><i style={{ background: NATURE.variable.color }} aria-hidden />Variable</dt><dd>{rs(p.variable)}</dd></div>
              </dl>
              {p.pending > 0 && <p className="crm-sub" style={{ margin: 0 }}>{rs(p.pending)} more waiting for approval</p>}
              <div className="mp-card-acts">
                {canHandle && p.status === 'active' && <>
                  <button type="button" className="crm-btn is-sm pd-quick is-in" onClick={() => onOpen(p.id, 'in')}><ArrowDownLeft size={15} aria-hidden /> Money in</button>
                  <button type="button" className="crm-btn is-sm pd-quick is-out" onClick={() => onOpen(p.id, 'out')}><ArrowUpRight size={15} aria-hidden /> Spend</button>
                </>}
                <button type="button" className="crm-btn is-secondary is-sm" onClick={() => onOpen(p.id)}>Open passbook{p.entries ? ` · ${p.entries}` : ''}</button>
              </div>
            </article>
          ))}
        </div>
      )}
      {form && <ProjectForm staff={data.staff} edit={form.edit} onClose={() => setForm(null)} onSaved={(m) => { toast(m); setForm(null); void load(); }} />}
    </>
  );
}

/** Make a project, or change one: name, budget, dates, who leads it, colour. */
export function ProjectForm({ staff, edit, onClose, onSaved }: { staff: Staff[]; edit?: ProjectRow; onClose: () => void; onSaved: (m: string) => void }) {
  const [name, setName] = useState(edit?.name ?? '');
  const [budget, setBudget] = useState(edit?.budget != null ? String(edit.budget) : '');
  const [start, setStart] = useState(edit?.startDate ?? '');
  const [end, setEnd] = useState(edit?.endDate ?? '');
  const [lead, setLead] = useState(edit?.leadId ?? '');
  const [desc, setDesc] = useState(edit?.description ?? '');
  const [color, setColor] = useState(edit?.color ?? '');
  const [campIds, setCampIds] = useState<string[]>([]);
  const [showCamps, setShowCamps] = useState(!edit);
  const { camps } = useLinkableCamps();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!name.trim()) { setErr('Write the project’s name.'); return; }
    const b = budget.trim() ? money(budget) : null;
    if (budget.trim() && b == null) { setErr('Write the budget in rupees, or leave it empty.'); return; }
    setBusy(true); setErr(null);
    const body = { name, description: desc, budget: b ?? (edit?.budget != null ? -1 : null), startDate: start || null, endDate: end || null, leadId: lead, color: color || null, campIds };
    try {
      if (edit) await crm.put(`/api/v1/spend/projects/${edit.id}`, body); else await crm.post('/api/v1/spend/projects', body);
      onSaved(edit ? (campIds.length ? 'Project saved and camps linked.' : 'Project saved.') : `Project “${name.trim()}” made${campIds.length ? ` with ${campIds.length === 1 ? 'its camp' : `${campIds.length} camps`}` : ''}. Pick it when you add an expense.`);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={edit ? `Change project · ${edit.name}` : 'New project'} onClose={onClose} actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="crm-btn" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : edit ? 'Save' : 'Make project'}</button>
    </>}>
      <div className="ms-form">
        {showCamps ? (
          <fieldset className="ms-set"><legend>{edit ? 'Add health camps to it (optional)' : 'Is it for a health camp? (optional)'}</legend>
            <CampChecklist projectId={edit?.id} picked={campIds} camps={camps} onChange={(ids, first) => {
              setCampIds(ids);
              if (first && !edit && ids.length === 1) {
                if (!name.trim()) setName(first.title);
                if (!start) setStart(first.date);
                if (!end) setEnd(first.date);
                if (!budget.trim() && first.budget > 0) setBudget(String(first.budget));
              }
            }} />
          </fieldset>
        ) : (
          <button type="button" className="crm-btn is-secondary is-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowCamps(true)}><Tent size={14} aria-hidden /> Add health camps to it</button>
        )}
        <label className="crm-field">Name<input className="crm-input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Purnia health camp, December" /></label>
        <div className="ms-two">
          <label className="crm-field">Budget (₹, optional)<input className="crm-input" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="e.g. 50000" /></label>
          <label className="crm-field">Led by (optional)
            <select className="crm-input" value={lead} onChange={(e) => setLead(e.target.value)}>
              <option value="">Nobody in particular</option>
              {staff.map((s) => <option key={s.agentId} value={s.agentId}>{s.name}</option>)}
            </select>
          </label>
        </div>
        <div className="ms-two">
          <label className="crm-field">Starts (optional)<input className="crm-input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label className="crm-field">Ends (optional)<input className="crm-input" type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} /></label>
        </div>
        <label className="crm-field">What it is (optional)<textarea className="crm-input" rows={2} value={desc} maxLength={1000} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Three free check-up camps with Dr Ansari" /></label>
        <fieldset className="ms-set"><legend>Colour</legend>
          <div className="mp-colors">{PALETTE.map((c) => <button key={c} type="button" className="mp-color" aria-label={c} aria-pressed={(color || edit?.color) === c} style={{ background: c }} onClick={() => setColor(c)} />)}</div>
        </fieldset>
        {err && <p className="ms-err" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

/** Money received for marketing: from whom, for which project, and who holds it now. */
export function FundForm({ data, projectId, onClose, onSaved }: { data: Data; projectId?: string; onClose: () => void; onSaved: (m: string) => void }) {
  const [project, setProject] = useState(projectId ?? '');
  const [amount, setAmount] = useState('');
  const [on, setOn] = useState(data.today);
  const [source, setSource] = useState('');
  const [mode, setMode] = useState('bank');
  const [who, setWho] = useState(data.me.isManager && !data.me.canSetup ? data.me.agentId : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const managers = data.staff.filter((s) => data.managers.includes(s.agentId));
  const save = async () => {
    const n = money(amount);
    if (n == null) { setErr('Write the amount received.'); return; }
    if (!source.trim()) { setErr('Write who it came from.'); return; }
    setBusy(true); setErr(null);
    try {
      await crm.post('/api/v1/spend/funds', { projectId: project || null, amount: n, on, source, mode, note, receivedBy: who || null });
      onSaved(`${rs(n)} received from ${source.trim()}${who ? `, held by ${data.staff.find((s) => s.agentId === who)?.name ?? who}` : ''}.`);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Money received" onClose={onClose} actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="crm-btn" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
    </>}>
      <div className="ms-form">
        <div className="ms-two">
          <label className="crm-field">Amount (₹)<input className="crm-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="e.g. 50000" /></label>
          <label className="crm-field">Day<input className="crm-input" type="date" value={on} max={data.today} onChange={(e) => setOn(e.target.value)} /></label>
        </div>
        <label className="crm-field">From<input className="crm-input" value={source} maxLength={120} onChange={(e) => setSource(e.target.value)} placeholder="e.g. Hospital management, or a sponsor" list="ms-sources" />
          <datalist id="ms-sources"><option value="Hospital management" /><option value="Sponsor" /><option value="Partner" /></datalist>
        </label>
        <label className="crm-field">For the project
          <select className="crm-input" value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">Marketing in general (no project)</option>
            {data.projects.filter((p) => p.status === 'active' || p.id === project).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="crm-field">Who holds it now
          <select className="crm-input" value={who} onChange={(e) => setWho(e.target.value)} disabled={data.me.isManager && !data.me.canSetup}>
            <option value="">The organisation&apos;s account</option>
            {managers.map((s) => <option key={s.agentId} value={s.agentId}>{s.name} (money manager)</option>)}
          </select>
          <span className="crm-sub" style={{ fontWeight: 400 }}>When a money manager receives it, it counts in what they hold, and what they give the team comes out of it.</span>
        </label>
        <fieldset className="ms-set"><legend>How</legend>
          <div className="crm-chips">{data.modes.map((m) => <button key={m} type="button" className="crm-chip" aria-pressed={mode === m} onClick={() => setMode(m)}>{MODE[m] ?? m}</button>)}</div>
        </fieldset>
        <label className="crm-field">Note (optional)<input className="crm-input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. first part of the December budget" /></label>
        {err && <p className="ms-err" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

