'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Check, FileImage, Lock, Pencil, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { ErrorBox, friendlyError, Pill, Skeleton } from '@/components/crm/ui';
import { ProjectForm, type ProjectRow } from './Projects';
import { ProjectCampsBand, type ProjectCamps } from './ProjectCamps';
import { dayText, errText, MODE, money, monthText, NATURE, rs, type Data, type Expense, type Fund, type Kind } from './shared';

interface Detail {
  project: ProjectRow; funds: Fund[]; expenses: Expense[]; byKind: Record<string, number>;
  byPerson: { agentId: string; name: string; total: number }[]; byMonth: { month: string; constant: number; variable: number }[];
  recurring: { id: string; title: string; amount: number; every: string; active: boolean }[];
  camps?: ProjectCamps;
}
type Mode = 'in' | 'out';
type Row = { key: string; date: string; at: string; type: 'in'; f: Fund } | { key: string; date: string; at: string; type: 'out'; e: Expense };
type Filter = 'all' | 'in' | 'out' | 'waiting';

/**
 * One project as a workspace: its money at a glance, a quick entry that stays open (money in or money spent), and a
 * passbook of every entry with a running balance, where any entry can be corrected or removed (with Undo).
 */
export function ProjectDesk({ id, data, canHandle, startMode, onBack, onChanged, toast, onBill }: {
  id: string; data: Data; canHandle: boolean; startMode?: Mode; onBack: () => void; onChanged: () => void; toast: (m: string) => void; onBill: (e: Expense) => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(startMode ?? 'out');
  const [editing, setEditing] = useState<{ type: 'in'; f: Fund } | { type: 'out'; e: Expense } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [undo, setUndo] = useState<{ text: string; run: () => Promise<void> } | null>(null);
  const [changing, setChanging] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entryRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => { try { setD(await crm.get<Detail>(`/api/v1/spend/projects/${id}`)); setErr(null); } catch (e) { setErr(friendlyError(e)); } }, [id]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);
  const changed = async () => { await load(); onChanged(); };

  const kinds = useMemo(() => Object.fromEntries(data.categories.map((k) => [k.key, k])) as Record<string, Kind>, [data.categories]);

  // The passbook: money in and money out by day, newest first, with the balance after each counted entry.
  const rows = useMemo(() => {
    if (!d) return [] as (Row & { balance: number | null })[];
    const all: Row[] = [
      ...d.funds.map((f) => ({ key: `f${f.id}`, date: f.on, at: f.createdAt ?? '', type: 'in' as const, f })),
      ...d.expenses.map((e) => ({ key: `e${e.id}`, date: e.spentOn, at: e.createdAt, type: 'out' as const, e })),
    ].sort((a, b) => (a.date === b.date ? a.at.localeCompare(b.at) : a.date.localeCompare(b.date)));
    let bal = 0;
    const withBal = all.map((r) => {
      if (r.type === 'in') bal += r.f.amount;
      else if (r.e.status === 'approved') bal -= r.e.amount;
      else return { ...r, balance: null };
      return { ...r, balance: bal };
    });
    return withBal.reverse();
  }, [d]);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'in' && r.type !== 'in') return false;
      if (filter === 'out' && r.type !== 'out') return false;
      if (filter === 'waiting' && !(r.type === 'out' && r.e.status === 'pending')) return false;
      if (!term) return true;
      const text = r.type === 'in' ? `${r.f.source} ${r.f.note ?? ''} ${r.f.receivedByName ?? ''}` : `${kinds[r.e.category]?.label ?? r.e.category} ${r.e.note ?? ''} ${r.e.agentName ?? ''} ${r.e.forAgentName ?? ''}`;
      return text.toLowerCase().includes(term) || String(r.type === 'in' ? r.f.amount : r.e.amount).includes(term);
    });
  }, [rows, filter, q, kinds]);

  const showUndo = (text: string, run: () => Promise<void>) => {
    setUndo({ text, run });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 9000);
  };
  const remove = async (r: Row) => {
    try {
      if (r.type === 'in') {
        await crm.post(`/api/v1/spend/funds/${r.f.id}/remove`);
        showUndo(`Removed ${rs(r.f.amount)} received from ${r.f.source}.`, async () => { await crm.post(`/api/v1/spend/funds/${r.f.id}/restore`); });
      } else {
        await crm.post(`/api/v1/spend/${r.e.id}/remove`);
        showUndo(`Removed ${rs(r.e.amount)} · ${kinds[r.e.category]?.label ?? r.e.category}.`, async () => { await crm.post(`/api/v1/spend/${r.e.id}/restore`); });
      }
      if (editing && ((editing.type === 'in' && r.type === 'in' && editing.f.id === r.f.id) || (editing.type === 'out' && r.type === 'out' && editing.e.id === r.e.id))) setEditing(null);
      await changed();
    } catch (e) { toast(errText(e)); }
  };
  const runUndo = async () => {
    if (!undo) return;
    try { await undo.run(); setUndo(null); toast('Put back.'); await changed(); } catch (e) { toast(errText(e)); }
  };
  const decide = async (e: Expense, approve: boolean, reason?: string) => {
    try { await crm.post(`/api/v1/spend/${e.id}/decide`, { approve, reason }); setRejecting(null); toast(approve ? 'Approved: it now counts in the project.' : 'Not approved. They are told why.'); await changed(); }
    catch (x) { toast(errText(x)); }
  };
  const setStatus = async (status: 'active' | 'closed') => {
    if (status === 'closed' && !window.confirm('Close this project? It stays in the records and reports; no new money can be added to it. You can open it again.')) return;
    try { await crm.put(`/api/v1/spend/projects/${id}`, { status }); toast(status === 'closed' ? 'Project closed.' : 'Project open again.'); await changed(); } catch (e) { toast(errText(e)); }
  };
  const startEdit = (r: Row) => {
    setEditing(r.type === 'in' ? { type: 'in', f: r.f } : { type: 'out', e: r.e });
    setMode(r.type);
    entryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (err && !d) return <ErrorBox message={err} onRetry={load} />;
  if (!d) return <Skeleton h={480} />;
  const p = d.project;
  const open = p.status === 'active';
  const inHand = p.received - p.spent;
  const pending = d.expenses.filter((e) => e.status === 'pending');
  const top = Math.max(1, ...d.byMonth.map((m) => m.constant + m.variable));
  const kindTop = Math.max(1, ...Object.values(d.byKind));

  if (changing) return <ProjectForm staff={data.staff} edit={p} onClose={() => setChanging(false)} onSaved={(m) => { toast(m); setChanging(false); void changed(); }} />;

  return (
    <div className="pd-wrap" style={{ ['--pc' as string]: p.color }}>
      <div className="pd-head">
        <button type="button" className="crm-btn is-secondary is-sm" onClick={onBack}><ArrowLeft size={15} aria-hidden /> All projects</button>
        <div className="pd-title">
          <span className="pd-dot" aria-hidden />
          <h2>{p.name}</h2>
          <Pill tone={open ? 'ok' : 'neutral'}>{open ? 'Open' : 'Closed'}</Pill>
        </div>
        {canHandle && <span className="pd-head-acts">
          <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setChanging(true)}><Pencil size={14} aria-hidden /> Change</button>
          <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void setStatus(open ? 'closed' : 'active')}>{open ? 'Close project' : 'Open again'}</button>
        </span>}
      </div>
      {(p.leadName || p.startDate || p.description) && (
        <p className="crm-sub pd-meta">{[p.leadName ? `Led by ${p.leadName}` : null, p.startDate ? `${dayText(p.startDate, true)}${p.endDate ? ` to ${dayText(p.endDate, true)}` : ''}` : null, p.description].filter(Boolean).join(' · ')}</p>
      )}

      <section className="pd-money" aria-label="Project money">
        <div><span>Received</span><strong className="is-in">{rs(p.received)}</strong><em>{d.funds.length} time{d.funds.length === 1 ? '' : 's'}</em></div>
        <div><span>Spent</span><strong className="is-out">{rs(p.spent)}</strong><em>{rs(p.constant)} constant · {rs(p.variable)} variable</em></div>
        <div className="is-main"><span>In hand</span><strong className={inHand < 0 ? 'is-neg' : ''}>{inHand < 0 ? `− ${rs(-inHand)}` : rs(inHand)}</strong><em>{inHand < 0 ? 'spent more than received' : 'received − spent'}</em></div>
        <div className="pd-budget">
          <span>Budget</span>
          {p.budget == null ? <><strong>—</strong><em>No budget set{canHandle ? ' · Change to add one' : ''}</em></> : <>
            <strong>{rs(p.budget)}</strong>
            <span className={`ma-meter${(p.usedPct ?? 0) >= 100 ? ' is-bad' : (p.usedPct ?? 0) >= 85 ? ' is-warn' : ''}`} role="img" aria-label={`${p.usedPct ?? 0}% of the budget spent`}><span style={{ width: `${Math.min(100, p.usedPct ?? 0)}%` }} /></span>
            <em>{p.usedPct ?? 0}% used · {p.left != null && p.left < 0 ? <b className="is-bad">{rs(-p.left)} over</b> : `${rs(p.left ?? 0)} left`}</em>
          </>}
        </div>
      </section>

      {pending.length > 0 && (
        <p className="pd-wait">{pending.length} expense{pending.length === 1 ? '' : 's'} ({rs(pending.reduce((s, e) => s + e.amount, 0))}) sent from the app {pending.length === 1 ? 'is' : 'are'} waiting for approval. <button type="button" className="wa-link" onClick={() => setFilter('waiting')}>Show</button></p>
      )}

      <ProjectCampsBand projectId={p.id} projectName={p.name} spent={p.spent} data={d.camps} canHandle={canHandle} open={open} toast={toast} onChanged={changed} />

      <div className="pd-grid">
        <div className="pd-main">
          {canHandle && open && (
            <section className="crm-card pd-entry" ref={entryRef} aria-label={editing ? 'Correct an entry' : 'Add money in or out'}>
              {editing ? (
                <div className="pd-entry-head"><strong>Correct {editing.type === 'in' ? 'money received' : 'expense'}</strong><button type="button" className="crm-btn is-ghost is-sm" onClick={() => setEditing(null)}><X size={14} aria-hidden /> Stop correcting</button></div>
              ) : (
                <div className="pd-switch" role="tablist" aria-label="Kind of entry">
                  <button type="button" role="tab" aria-selected={mode === 'in'} className="is-in" onClick={() => setMode('in')}><ArrowDownLeft size={17} aria-hidden /> Money in</button>
                  <button type="button" role="tab" aria-selected={mode === 'out'} className="is-out" onClick={() => setMode('out')}><ArrowUpRight size={17} aria-hidden /> Spend</button>
                </div>
              )}
              {mode === 'in'
                ? <InForm key={editing?.type === 'in' ? editing.f.id : 'new-in'} data={data} projectId={p.id} edit={editing?.type === 'in' ? editing.f : undefined} sources={d.funds.map((f) => f.source)}
                    onSaved={async (m) => { toast(m); setEditing(null); await changed(); }} />
                : <OutForm key={editing?.type === 'out' ? editing.e.id : 'new-out'} data={data} projectId={p.id} edit={editing?.type === 'out' ? editing.e : undefined} used={Object.keys(d.byKind)}
                    onSaved={async (m) => { toast(m); setEditing(null); await changed(); }} />}
            </section>
          )}
          {!open && <p className="crm-sub pd-closed"><Lock size={14} aria-hidden /> This project is closed. Open it again to add or correct money.</p>}

          <section className="crm-card pd-book" aria-labelledby="pd-book-h">
            <div className="pd-book-head">
              <h3 id="pd-book-h" className="crm-h2">Passbook</h3>
              <div className="crm-chips" role="group" aria-label="Show">
                {([['all', 'All', rows.length], ['in', 'Money in', d.funds.length], ['out', 'Spent', d.expenses.length], ['waiting', 'Waiting', pending.length]] as [Filter, string, number][])
                  .filter(([k, , n]) => k !== 'waiting' || n > 0)
                  .map(([k, l, n]) => <button key={k} type="button" className="crm-chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}<span className="ld-chip-n">{n}</span></button>)}
              </div>
              <label className="crm-search pd-search"><Search size={15} aria-hidden /><span className="crm-sr">Search entries</span>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" /></label>
            </div>
            {shown.length === 0 ? <p className="crm-sub" style={{ margin: 0 }}>{rows.length === 0 ? 'Nothing yet. Add the first money received or the first expense above.' : 'Nothing matches.'}</p> : (
              <ul className="pd-rows">
                {shown.map((r) => {
                  const isIn = r.type === 'in';
                  const e = r.type === 'out' ? r.e : null;
                  const f = r.type === 'in' ? r.f : null;
                  const k = e ? kinds[e.category] : null;
                  const locked = !!e && (!!e.salaryMonth || !!e.recurringId);
                  const counted = isIn || e!.status === 'approved';
                  const beingEdited = editing && ((editing.type === 'in' && f && editing.f.id === f.id) || (editing.type === 'out' && e && editing.e.id === e.id));
                  return (
                    <li key={r.key} className={`pd-row${counted ? '' : ' is-muted'}${beingEdited ? ' is-editing' : ''}`}>
                      <span className={`pd-icon ${isIn ? 'is-in' : 'is-out'}`} aria-hidden>{isIn ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}</span>
                      <span className="pd-what">
                        <strong>{isIn ? `From ${f!.source}` : <><i className="pd-kdot" style={{ background: k?.color ?? '#6b7280' }} aria-hidden />{k?.label ?? e!.category}</>}</strong>
                        <span className="crm-cell-sub">
                          {dayText(r.date)}{r.date.slice(0, 4) !== data.today.slice(0, 4) ? ` ${r.date.slice(0, 4)}` : ''}
                          {isIn ? ` · ${f!.receivedByName ? `held by ${f!.receivedByName}` : 'organisation’s account'}${f!.mode ? ` · ${MODE[f!.mode] ?? f!.mode}` : ''}`
                            : ` · ${e!.paidBy === 'person' ? `paid by ${e!.agentName}` : 'paid by the organisation'}${e!.forAgentName ? ` · for ${e!.forAgentName}` : ''}`}
                          {(isIn ? f!.note : e!.note) ? ` · ${isIn ? f!.note : e!.note}` : ''}
                        </span>
                        {e && e.status === 'pending' && <span className="pd-tag is-wait">Waiting for approval{e.fromApp ? ' · sent from the app' : ''}</span>}
                        {e && e.status === 'rejected' && <span className="pd-tag is-no">Not approved{e.rejectReason ? `: ${e.rejectReason}` : ''}</span>}
                        {locked && <span className="pd-tag">{e!.salaryMonth ? `Salary · ${monthText(e!.salaryMonth, true)}` : 'Constant payment'}</span>}
                        {rejecting === e?.id && <RejectInline onCancel={() => setRejecting(null)} onReject={(why) => void decide(e!, false, why)} />}
                      </span>
                      <span className="pd-amt">
                        <strong className={isIn ? 'is-in' : counted ? 'is-out' : ''}>{isIn ? '+' : '−'} {rs(isIn ? f!.amount : e!.amount)}</strong>
                        {r.balance != null && <span className="crm-cell-sub">bal. {r.balance < 0 ? `− ${rs(-r.balance)}` : rs(r.balance)}</span>}
                      </span>
                      <span className="pd-acts">
                        {e?.hasBill && <button type="button" className="crm-btn is-ghost is-sm" aria-label="See the bill" title="See the bill" onClick={() => onBill(e)}><FileImage size={15} aria-hidden /></button>}
                        {canHandle && open && e?.status === 'pending' && <>
                          <button type="button" className="crm-btn is-ok is-sm" onClick={() => void decide(e, true)}><Check size={14} aria-hidden /> Approve</button>
                          <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setRejecting(e.id)}>Not approve</button>
                        </>}
                        {canHandle && open && !locked && <button type="button" className="crm-btn is-ghost is-sm" aria-label="Correct" title="Correct" onClick={() => startEdit(r)}><Pencil size={15} aria-hidden /></button>}
                        {canHandle && open && !locked && <button type="button" className="crm-btn is-ghost is-sm pd-del" aria-label="Remove" title="Remove (you can undo)" onClick={() => void remove(r)}><Trash2 size={15} aria-hidden /></button>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <aside className="pd-side">
          <section className="crm-card pd-card">
            <h3 className="ms-h3">Spent on</h3>
            {Object.keys(d.byKind).length === 0 ? <p className="crm-sub" style={{ margin: 0 }}>Nothing yet.</p> : (
              <ul className="pd-bars">{Object.entries(d.byKind).sort((a, b) => b[1] - a[1]).map(([kk, v]) => (
                <li key={kk}><span className="pd-bar-l"><i style={{ background: kinds[kk]?.color ?? '#6b7280' }} aria-hidden />{kinds[kk]?.label ?? kk}</span><strong>{rs(v)}</strong>
                  <span className="pd-bar" aria-hidden><span style={{ width: `${(v / kindTop) * 100}%`, background: kinds[kk]?.color ?? '#6b7280' }} /></span></li>
              ))}</ul>
            )}
          </section>
          {d.byPerson.length > 0 && (
            <section className="crm-card pd-card">
              <h3 className="ms-h3">On whom</h3>
              <ul className="mp-list">{d.byPerson.map((x) => <li key={x.agentId}><span>{x.name}</span><strong>{rs(x.total)}</strong></li>)}</ul>
            </section>
          )}
          {d.byMonth.length > 0 && (
            <section className="crm-card pd-card">
              <h3 className="ms-h3">Month by month</h3>
              <ul className="mp-months">
                {d.byMonth.map((m) => (
                  <li key={m.month}>
                    <span>{monthText(m.month, true)}</span>
                    <span className="mp-mbar" role="img" aria-label={`Constant ${rs(m.constant)}, variable ${rs(m.variable)}`}>
                      <span style={{ width: `${(m.constant / top) * 100}%`, background: NATURE.constant.color }} />
                      <span style={{ width: `${(m.variable / top) * 100}%`, background: NATURE.variable.color }} />
                    </span>
                    <strong>{rs(m.constant + m.variable)}</strong>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {d.recurring.length > 0 && (
            <section className="crm-card pd-card">
              <h3 className="ms-h3">Constant payments</h3>
              <ul className="mp-list">{d.recurring.map((r) => <li key={r.id}><span>{r.title}{r.active ? '' : ' (stopped)'}</span><strong>{rs(r.amount)}</strong></li>)}</ul>
            </section>
          )}
        </aside>
      </div>

      {undo && (
        <div className="pd-undo" role="status">
          <span>{undo.text}</span>
          <button type="button" className="crm-btn is-sm" onClick={() => void runUndo()}><RotateCcw size={14} aria-hidden /> Undo</button>
          <button type="button" className="crm-btn is-ghost is-sm" aria-label="Close" onClick={() => setUndo(null)}><X size={14} aria-hidden /></button>
        </div>
      )}
    </div>
  );
}

function RejectInline({ onCancel, onReject }: { onCancel: () => void; onReject: (why: string) => void }) {
  const [why, setWhy] = useState('');
  return (
    <span className="pd-reject">
      <input className="crm-input" autoFocus value={why} maxLength={300} onChange={(e) => setWhy(e.target.value)} placeholder="Why? They see this in the app" onKeyDown={(e) => { if (e.key === 'Enter' && why.trim()) onReject(why); }} />
      <button type="button" className="crm-btn is-danger is-sm" disabled={!why.trim()} onClick={() => onReject(why)}>Not approve</button>
      <button type="button" className="crm-btn is-ghost is-sm" onClick={onCancel}>Cancel</button>
    </span>
  );
}

/** Money received for this project. Stays open after saving, ready for the next one. */
function InForm({ data, projectId, edit, sources, onSaved }: { data: Data; projectId: string; edit?: Fund; sources: string[]; onSaved: (m: string) => Promise<void> }) {
  const managers = data.staff.filter((s) => data.managers.includes(s.agentId));
  const recent = useMemo(() => {
    const all = [...sources, ...data.funds.map((f) => f.source), 'Hospital management'];
    return [...new Set(all.map((s) => s.trim()).filter(Boolean))].slice(0, 5);
  }, [sources, data.funds]);
  const [amount, setAmount] = useState(edit ? String(edit.amount) : '');
  const [on, setOn] = useState(edit?.on ?? data.today);
  const [source, setSource] = useState(edit?.source ?? recent[0] ?? '');
  const [mode, setMode] = useState(edit?.mode ?? 'bank');
  const [who, setWho] = useState(edit?.receivedBy ?? (data.me.isManager && !data.me.canSetup ? data.me.agentId : ''));
  const [note, setNote] = useState(edit?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement | null>(null);
  const save = async () => {
    const n = money(amount);
    if (n == null) { setErr('Write the amount received.'); amountRef.current?.focus(); return; }
    if (!source.trim()) { setErr('Write who it came from.'); return; }
    setBusy(true); setErr(null);
    const body = { projectId, amount: n, on, source, mode, note, receivedBy: who || null };
    try {
      if (edit) await crm.put(`/api/v1/spend/funds/${edit.id}`, body); else await crm.post('/api/v1/spend/funds', body);
      await onSaved(edit ? 'Corrected.' : `+ ${rs(n)} received from ${source.trim()}.`);
      if (!edit) { setAmount(''); setNote(''); amountRef.current?.focus(); }
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <form className="pd-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="pd-row1">
        <label className="crm-field pd-amount">Amount received (₹)<input ref={amountRef} className="crm-input" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0" /></label>
        <label className="crm-field">Day<input className="crm-input" type="date" value={on} max={data.today} onChange={(e) => setOn(e.target.value)} /></label>
      </div>
      <div className="crm-field">From
        <div className="crm-chips">{recent.map((s) => <button key={s} type="button" className="crm-chip is-soft" aria-pressed={source === s} onClick={() => setSource(s)}>{s}</button>)}</div>
        <input className="crm-input" value={source} maxLength={120} onChange={(e) => setSource(e.target.value)} placeholder="Or write who it came from (a sponsor, a partner…)" />
      </div>
      <div className="pd-row1">
        <fieldset className="ms-set"><legend>How</legend>
          <div className="crm-chips">{data.modes.map((m) => <button key={m} type="button" className="crm-chip" aria-pressed={mode === m} onClick={() => setMode(m)}>{MODE[m] ?? m}</button>)}</div>
        </fieldset>
        <label className="crm-field">Who holds it now
          <select className="crm-input" value={who} onChange={(e) => setWho(e.target.value)} disabled={data.me.isManager && !data.me.canSetup}>
            <option value="">The organisation’s account</option>
            {managers.map((s) => <option key={s.agentId} value={s.agentId}>{s.name} (money manager)</option>)}
          </select>
        </label>
      </div>
      <label className="crm-field">Note (optional)<input className="crm-input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. first part of the budget" /></label>
      {err && <p className="ms-err" role="alert">{err}</p>}
      <button type="submit" className="crm-btn pd-save is-in" disabled={busy}><ArrowDownLeft size={16} aria-hidden /> {busy ? 'Saving…' : edit ? 'Save correction' : `Add${money(amount) ? ` ${rs(money(amount))}` : ''} received`}</button>
    </form>
  );
}

/** An expense in this project. Kinds already used here come first. Stays open after saving. */
function OutForm({ data, projectId, edit, used, onSaved }: { data: Data; projectId: string; edit?: Expense; used: string[]; onSaved: (m: string) => Promise<void> }) {
  const open = data.categories.filter((k) => (!k.archived || k.key === edit?.category) && k.key !== 'agents');
  const ordered = useMemo(() => [...open].sort((a, b) => (used.includes(b.key) ? 1 : 0) - (used.includes(a.key) ? 1 : 0)), [open, used]);
  const first = ordered.slice(0, 10);
  const more = ordered.slice(10);
  const managerOnly = data.me.isManager && !data.me.canSetup;
  const [amount, setAmount] = useState(edit ? String(edit.amount) : '');
  const [on, setOn] = useState(edit?.spentOn ?? data.today);
  const [category, setCategory] = useState(edit?.category ?? ordered[0]?.key ?? 'other');
  const [note, setNote] = useState(edit?.note ?? '');
  const [paidBy, setPaidBy] = useState<'office' | 'person'>(edit?.paidBy ?? (managerOnly ? 'person' : 'office'));
  const [agentId, setAgentId] = useState(edit?.agentId ?? (managerOnly ? data.me.agentId : ''));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const fromApp = !!edit?.fromApp;
  const save = async () => {
    const n = money(amount);
    if (n == null) { setErr('Write the amount spent.'); amountRef.current?.focus(); return; }
    if (paidBy === 'person' && !agentId) { setErr('Pick the person who paid.'); return; }
    setBusy(true); setErr(null);
    const body = { spentOn: on, category, amount: n, note, paidBy, agentId: paidBy === 'person' ? agentId : null, forAgentId: edit?.paidBy === 'office' ? edit.forAgentId ?? null : null, projectId };
    try {
      const saved = edit ? await crm.put<Expense>(`/api/v1/spend/${edit.id}`, body) : await crm.post<Expense>('/api/v1/spend', body);
      if (file) { const f = new FormData(); f.append('file', file); await crm.upload(`/api/v1/spend/${saved.id}/bill`, f); }
      await onSaved(edit ? 'Corrected.' : `− ${rs(n)} spent on ${data.categories.find((k) => k.key === category)?.label ?? category}.`);
      if (!edit) { setAmount(''); setNote(''); setFile(null); if (fileRef.current) fileRef.current.value = ''; amountRef.current?.focus(); }
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <form className="pd-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="pd-row1">
        <label className="crm-field pd-amount">Amount spent (₹)<input ref={amountRef} className="crm-input" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0" /></label>
        <label className="crm-field">Day<input className="crm-input" type="date" value={on} max={data.today} onChange={(e) => setOn(e.target.value)} /></label>
      </div>
      <div className="crm-field">On what
        <div className="crm-chips">
          {first.map((c) => <button key={c.key} type="button" className="crm-chip" aria-pressed={category === c.key} onClick={() => setCategory(c.key)}><i className="ms-dot" style={{ background: c.color }} aria-hidden />{c.label}</button>)}
          {more.length > 0 && (
            <select className="crm-select pd-more" aria-label="More kinds" value={more.some((m) => m.key === category) ? category : ''} onChange={(e) => e.target.value && setCategory(e.target.value)}>
              <option value="">More kinds…</option>{more.map((c) => <option key={c.key} value={c.key}>{c.label} ({NATURE[c.nature].label.toLowerCase()})</option>)}
            </select>
          )}
        </div>
      </div>
      <label className="crm-field">What it was for (optional)<input className="crm-input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. tent and chairs for the camp" /></label>
      {fromApp ? <p className="crm-sub" style={{ margin: 0 }}>Paid by {edit!.agentName} (sent from the app).</p> : (
        <div className="pd-row1">
          <fieldset className="ms-set"><legend>Who paid</legend>
            <div className="crm-chips">
              <button type="button" className="crm-chip" aria-pressed={paidBy === 'office'} onClick={() => setPaidBy('office')} disabled={managerOnly}>The organisation</button>
              <button type="button" className="crm-chip" aria-pressed={paidBy === 'person'} onClick={() => setPaidBy('person')}>A person</button>
            </div>
          </fieldset>
          {paidBy === 'person' && (
            <label className="crm-field">Person
              <select className="crm-input" value={agentId} onChange={(e) => setAgentId(e.target.value)} disabled={managerOnly}>
                <option value="">Pick a person</option>
                {data.staff.map((s) => <option key={s.agentId} value={s.agentId}>{s.name}{data.managers.includes(s.agentId) ? ' (money manager)' : ''}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      <label className="pd-file">
        <FileImage size={16} aria-hidden /> {file ? file.name : edit?.hasBill ? 'Replace the bill photo (optional)' : 'Add a bill photo (optional)'}
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      {err && <p className="ms-err" role="alert">{err}</p>}
      <button type="submit" className="crm-btn pd-save is-out" disabled={busy}><ArrowUpRight size={16} aria-hidden /> {busy ? 'Saving…' : edit ? 'Save correction' : `Add${money(amount) ? ` ${rs(money(amount))}` : ''} expense`}</button>
    </form>
  );
}
