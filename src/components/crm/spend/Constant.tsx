'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, Plus, Repeat, Wallet } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { Empty, ErrorBox, friendlyError, Modal, Pill, Skeleton } from '@/components/crm/ui';
import { dayText, errText, EVERY, MODE, money, monthText, PAY, rs, thisMonthOf, type Data, type PayStatus } from './shared';

interface PeriodRow { period: string; dueOn: string; due: number; paid: number; left: number; status: PayStatus }
export interface ConstantRow {
  id: string; title: string; category: string; amount: number; every: 'month' | 'quarter' | 'year'; dueDay: number; fromMonth: string; toMonth?: string | null;
  projectId?: string | null; projectName?: string | null; payee?: string | null; forAgentId?: string | null; forAgentName?: string | null; note?: string | null; active: boolean;
  current?: PeriodRow | null; overdueCount: number; overdueSum: number; nextDue?: string | null; paidAllTime: number; periods: PeriodRow[];
}
interface ConstantRes { today: string; rows: ConstantRow[] }

const periodText = (p: string, every: string) => every === 'month' ? monthText(p) : every === 'quarter' ? `${monthText(p, true)} quarter` : `Year from ${monthText(p, true)}`;

/**
 * Constant payments: what is due every month, quarter or year (room rent, a software subscription, the phone bill),
 * this period's status, what is overdue, and each payment, in full or in parts. Salaries stay in Team and salaries.
 */
export function ConstantTab({ data, canHandle, toast, onChanged, refreshKey }: { data: Data; canHandle: boolean; toast: (m: string) => void; onChanged: () => void; refreshKey: number }) {
  const [res, setRes] = useState<ConstantRes | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<{ edit?: ConstantRow } | null>(null);
  const [pay, setPay] = useState<{ row: ConstantRow; period?: PeriodRow } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const load = useCallback(async () => { try { setRes(await crm.get<ConstantRes>('/api/v1/spend/constant')); setErr(null); } catch (e) { setErr(friendlyError(e)); } }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load, refreshKey]);
  const done = (m: string) => { toast(m); setForm(null); setPay(null); void load(); onChanged(); };
  const stop = async (r: ConstantRow, undo = false) => {
    if (!undo && !window.confirm(`Stop “${r.title}” after ${monthText(thisMonthOf(data.today))}? Its payments are kept.`)) return;
    try { await crm.post(`/api/v1/spend/constant/${r.id}/stop${undo ? '?undo=true' : ''}`, { lastMonth: thisMonthOf(data.today) }); done(undo ? `“${r.title}” is running again.` : `“${r.title}” stopped.`); } catch (e) { toast(errText(e)); }
  };
  if (err && !res) return <ErrorBox message={err} onRetry={load} />;
  if (!res) return <Skeleton h={300} />;
  const kinds = Object.fromEntries(data.categories.map((k) => [k.key, k])) as Record<string, (typeof data.categories)[number]>;
  const live = res.rows.filter((r) => r.active);
  const list = res.rows.filter((r) => r.active !== stopped);
  const due = live.reduce((a, r) => a + (r.current?.due ?? 0), 0);
  const paid = live.reduce((a, r) => a + (r.current?.paid ?? 0), 0);
  const overdue = res.rows.reduce((a, r) => a + r.overdueSum, 0);
  const monthly = live.reduce((a, r) => a + r.amount / (r.every === 'year' ? 12 : r.every === 'quarter' ? 3 : 1), 0);

  return (
    <>
      <div className="ms-range">
        <div className="crm-chips" role="group" aria-label="Which payments">
          <button type="button" className="crm-chip" aria-pressed={!stopped} onClick={() => setStopped(false)}>Running · {live.length}</button>
          <button type="button" className="crm-chip" aria-pressed={stopped} onClick={() => setStopped(true)}>Stopped · {res.rows.length - live.length}</button>
        </div>
        {canHandle && <button type="button" className="crm-btn is-sm" style={{ marginLeft: 'auto' }} onClick={() => setForm({})}><Plus size={15} aria-hidden /> Add constant payment</button>}
      </div>
      <div className="crm-kpis">
        <div className="crm-card crm-kpi"><span className="crm-kpi-label">Due this period</span><span className="crm-kpi-value">{rs(due)}</span><span className="crm-sub">{live.length} running payments</span></div>
        <div className="crm-card crm-kpi"><span className="crm-kpi-label">Paid</span><span className="crm-kpi-value">{rs(paid)}</span><span className="crm-sub">{rs(Math.max(0, due - paid))} still to pay</span></div>
        <div className="crm-card crm-kpi"><span className="crm-kpi-label">Overdue</span><span className={`crm-kpi-value${overdue ? ' is-bad' : ''}`}>{rs(overdue)}</span><span className="crm-sub">{((n) => `${n} ${n === 1 ? 'payment' : 'payments'} past the due day`)(res.rows.filter((r) => r.overdueCount).length)}</span></div>
        <div className="crm-card crm-kpi"><span className="crm-kpi-label">Costs a month, on average</span><span className="crm-kpi-value">{rs(Math.round(monthly))}</span><span className="crm-sub">Salaries not included</span></div>
      </div>
      <section className="crm-card">
        {list.length === 0 ? (
          <Empty title={stopped ? 'Nothing stopped' : 'No constant payments yet'}>
            <span className="crm-sub">Add what the team pays again and again: room rent, office rent, software, phone and internet bills. Each period shows as due until it is paid, and Analytics warns when one is late.</span>
            {canHandle && !stopped && <button type="button" className="crm-btn is-sm" onClick={() => setForm({})}>Add constant payment</button>}
          </Empty>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table mc-table">
              <thead><tr><th scope="col"><span className="crm-sr">Show history</span></th><th scope="col">Payment</th><th scope="col" className="wb-num">Amount</th><th scope="col">Due</th><th scope="col">This period</th>{canHandle && <th scope="col"><span className="crm-sr">Actions</span></th>}</tr></thead>
              <tbody>
                {list.map((r) => {
                  const k = kinds[r.category];
                  const isOpen = openId === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr>
                        <td><button type="button" className="wk-x" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} every period of ${r.title}`} onClick={() => setOpenId(isOpen ? null : r.id)}>{isOpen ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}</button></td>
                        <td>
                          <strong>{r.title}</strong>
                          <span className="crm-cell-sub" style={{ display: 'block' }}>
                            <span className="ms-cat-name"><i style={{ background: k?.color ?? '#6b7280' }} aria-hidden />{k?.label ?? r.category}</span>
                            {[r.payee ? `to ${r.payee}` : null, r.forAgentName ? `for ${r.forAgentName}` : null, r.projectName ? `project ${r.projectName}` : null].filter(Boolean).map((x) => ` · ${x}`).join('')}
                          </span>
                        </td>
                        <td className="wb-num"><strong>{rs(r.amount)}</strong><span className="crm-cell-sub" style={{ display: 'block' }}><Repeat size={11} aria-hidden /> {EVERY[r.every]}</span></td>
                        <td style={{ whiteSpace: 'nowrap' }}>{r.active ? (r.nextDue ? dayText(r.nextDue) : `Day ${r.dueDay}`) : `Stopped after ${monthText(r.toMonth, true)}`}{r.overdueCount > 0 && <span className="crm-cell-sub is-bad" style={{ display: 'block' }}>{r.overdueCount} overdue · {rs(r.overdueSum)}</span>}</td>
                        <td>{r.current ? <><Pill tone={r.current.status === 'unpaid' && r.current.dueOn < res.today ? 'bad' : PAY[r.current.status].tone}>{r.current.status === 'unpaid' && r.current.dueOn >= res.today ? 'Not paid yet' : PAY[r.current.status].label}</Pill>{r.current.left > 0 && r.current.paid > 0 && <span className="crm-cell-sub" style={{ display: 'block' }}>{rs(r.current.left)} left</span>}</> : <span className="crm-sub">—</span>}</td>
                        {canHandle && <td><span className="sp-actions ms-nowrap" style={{ justifyContent: 'flex-end' }}>
                          {r.active && <button type="button" className={`crm-btn is-sm${(r.current?.left ?? 0) > 0 || r.overdueCount ? '' : ' is-secondary'}`} onClick={() => setPay({ row: r, period: r.periods.find((p) => p.left > 0 && p.dueOn < res.today) ?? r.current ?? undefined })}><Wallet size={14} aria-hidden /> Pay</button>}
                          <button type="button" className="crm-btn is-secondary is-sm" aria-label={`Change ${r.title}`} onClick={() => setForm({ edit: r })}><Pencil size={14} aria-hidden /></button>
                          {r.active ? <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void stop(r)}>Stop</button> : <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void stop(r, true)}>Start again</button>}
                        </span></td>}
                      </tr>
                      {isOpen && (
                        <tr className="mc-hist"><td /><td colSpan={canHandle ? 5 : 4}>
                          {r.periods.length === 0 ? <span className="crm-sub">No period has started yet (it starts {monthText(r.fromMonth)}).</span> : (
                            <ul className="mc-periods">
                              {r.periods.map((p) => (
                                <li key={p.period}>
                                  <span>{periodText(p.period, r.every)}</span>
                                  <span className="crm-sub">due {dayText(p.dueOn)}</span>
                                  <span>{rs(p.paid)} of {rs(p.due)}</span>
                                  <Pill tone={p.status === 'unpaid' && p.dueOn < res.today ? 'bad' : PAY[p.status].tone}>{p.status === 'unpaid' && p.dueOn >= res.today ? 'Not paid yet' : PAY[p.status].label}</Pill>
                                  {canHandle && p.left > 0 && <button type="button" className="wa-link" onClick={() => setPay({ row: r, period: p })}>Pay {rs(p.left)}</button>}
                                </li>
                              ))}
                            </ul>
                          )}
                          <p className="crm-sub" style={{ margin: '8px 0 0' }}>Paid in all: {rs(r.paidAllTime)}{r.note ? ` · ${r.note}` : ''}</p>
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {form && <ConstantForm data={data} edit={form.edit} onClose={() => setForm(null)} onSaved={done} />}
      {pay && <ConstantPay data={data} row={pay.row} start={pay.period} onClose={() => setPay(null)} onSaved={done} />}
    </>
  );
}

function ConstantForm({ data, edit, onClose, onSaved }: { data: Data; edit?: ConstantRow; onClose: () => void; onSaved: (m: string) => void }) {
  const open = data.categories.filter((k) => !k.archived && k.key !== 'agents');
  const [title, setTitle] = useState(edit?.title ?? '');
  const [category, setCategory] = useState(edit?.category ?? (open.find((k) => k.nature === 'constant')?.key ?? 'other'));
  const [amount, setAmount] = useState(edit ? String(edit.amount) : '');
  const [every, setEvery] = useState<string>(edit?.every ?? 'month');
  const [dueDay, setDueDay] = useState(String(edit?.dueDay ?? 5));
  const [fromMonth, setFromMonth] = useState(edit?.fromMonth ?? thisMonthOf(data.today));
  const [project, setProject] = useState(edit?.projectId ?? '');
  const [payee, setPayee] = useState(edit?.payee ?? '');
  const [forId, setForId] = useState(edit?.forAgentId ?? '');
  const [note, setNote] = useState(edit?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const n = money(amount);
    if (!title.trim()) { setErr('Write what it is.'); return; }
    if (n == null) { setErr('Write the amount.'); return; }
    setBusy(true); setErr(null);
    const body = { title, category, amount: n, every, dueDay: Number(dueDay) || 1, fromMonth, projectId: project || (edit?.projectId ? '00000000-0000-0000-0000-000000000000' : null), payee, forAgentId: forId, note };
    try {
      if (edit) await crm.put(`/api/v1/spend/constant/${edit.id}`, body); else await crm.post('/api/v1/spend/constant', body);
      onSaved(edit ? 'Saved.' : `“${title.trim()}” added: ${rs(n)} ${EVERY[every].toLowerCase()}.`);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={edit ? `Change · ${edit.title}` : 'Add constant payment'} onClose={onClose} actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="crm-btn" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
    </>}>
      <div className="ms-form">
        <label className="crm-field">What it is<input className="crm-input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Room rent, Purnia office" /></label>
        <div className="ms-two">
          <label className="crm-field">Amount each time (₹)<input className="crm-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="e.g. 6000" /></label>
          <label className="crm-field">Kind
            <select className="crm-input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <optgroup label="Constant">{open.filter((k) => k.nature === 'constant').map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</optgroup>
              <optgroup label="Variable">{open.filter((k) => k.nature === 'variable').map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</optgroup>
            </select>
          </label>
        </div>
        <fieldset className="ms-set"><legend>How often</legend>
          <div className="crm-chips">{Object.entries(EVERY).map(([k, l]) => <button key={k} type="button" className="crm-chip" aria-pressed={every === k} onClick={() => setEvery(k)}>{l}</button>)}</div>
        </fieldset>
        <div className="ms-two">
          <label className="crm-field">Due on day (1–28)<input className="crm-input" inputMode="numeric" value={dueDay} onChange={(e) => setDueDay(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))} /></label>
          <label className="crm-field">First {every === 'month' ? 'month' : 'period'}<input className="crm-input" type="month" value={fromMonth} onChange={(e) => { if (e.target.value) setFromMonth(e.target.value); }} /></label>
        </div>
        <div className="ms-two">
          <label className="crm-field">Paid to (optional)<input className="crm-input" value={payee} maxLength={120} onChange={(e) => setPayee(e.target.value)} placeholder="e.g. Mr Yadav (landlord)" /></label>
          <label className="crm-field">For a person (optional)
            <select className="crm-input" value={forId} onChange={(e) => setForId(e.target.value)}>
              <option value="">Nobody in particular</option>
              {data.staff.map((s) => <option key={s.agentId} value={s.agentId}>{s.name}</option>)}
            </select>
          </label>
        </div>
        <label className="crm-field">Project (optional)
          <select className="crm-input" value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">No project</option>
            {data.projects.filter((p) => p.status === 'active' || p.id === project).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="crm-field">Note (optional)<input className="crm-input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. agreement till March 2027" /></label>
        {err && <p className="ms-err" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

function ConstantPay({ data, row, start, onClose, onSaved }: { data: Data; row: ConstantRow; start?: PeriodRow; onClose: () => void; onSaved: (m: string) => void }) {
  const [period, setPeriod] = useState(start?.period ?? row.current?.period ?? '');
  const p = row.periods.find((x) => x.period === period);
  const [amount, setAmount] = useState(p && p.left > 0 ? String(p.left) : String(row.amount));
  const [on, setOn] = useState(data.today);
  const [mode, setMode] = useState('bank');
  const [paidBy, setPaidBy] = useState<'office' | 'person'>(data.me.isManager && !data.me.canSetup ? 'person' : 'office');
  const [who, setWho] = useState(data.me.agentId);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const n = money(amount);
    if (n == null) { setErr('Write the amount.'); return; }
    if (!period) { setErr('Pick the period it pays for.'); return; }
    setBusy(true); setErr(null);
    try {
      await crm.post(`/api/v1/spend/constant/${row.id}/pay`, { period, amount: n, on, mode, note, paidBy, agentId: paidBy === 'person' ? who : null });
      onSaved(`${rs(n)} paid for ${row.title}, ${periodText(period, row.every)}.`);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Pay · ${row.title}`} onClose={onClose} actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="crm-btn" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Record payment'}</button>
    </>}>
      <div className="ms-form">
        <div className="ms-two">
          <label className="crm-field">For
            <select className="crm-input" value={period} onChange={(e) => { setPeriod(e.target.value); const x = row.periods.find((y) => y.period === e.target.value); if (x) setAmount(String(x.left > 0 ? x.left : row.amount)); }}>
              {row.periods.map((x) => <option key={x.period} value={x.period}>{periodText(x.period, row.every)}{x.left > 0 ? ` · ${rs(x.left)} left` : ' · paid'}</option>)}
            </select>
          </label>
          <label className="crm-field">Paid on<input className="crm-input" type="date" value={on} max={data.today} onChange={(e) => setOn(e.target.value)} /></label>
        </div>
        {p && <p className="crm-sub" style={{ margin: 0 }}>Due {rs(p.due)} on {dayText(p.dueOn, true)} · paid {rs(p.paid)} · left {rs(p.left)}</p>}
        <label className="crm-field">Amount (₹)<input className="crm-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
        <fieldset className="ms-set"><legend>Paid from</legend>
          <div className="crm-chips">
            <button type="button" className="crm-chip" aria-pressed={paidBy === 'office'} onClick={() => setPaidBy('office')}>The organisation, directly</button>
            <button type="button" className="crm-chip" aria-pressed={paidBy === 'person'} onClick={() => setPaidBy('person')}>Money a person holds</button>
          </div>
          {paidBy === 'person' && (
            <label className="crm-field" style={{ marginTop: 10 }}>Who paid
              <select className="crm-input" value={who} onChange={(e) => setWho(e.target.value)}>
                {data.staff.map((s) => <option key={s.agentId} value={s.agentId}>{s.name}{data.managers.includes(s.agentId) ? ' (money manager)' : ''}</option>)}
              </select>
            </label>
          )}
        </fieldset>
        <fieldset className="ms-set"><legend>How</legend>
          <div className="crm-chips">{data.modes.map((m) => <button key={m} type="button" className="crm-chip" aria-pressed={mode === m} onClick={() => setMode(m)}>{MODE[m] ?? m}</button>)}</div>
        </fieldset>
        <label className="crm-field">Note or reference (optional)<input className="crm-input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. UPI ref 4321" /></label>
        {err && <p className="ms-err" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}
