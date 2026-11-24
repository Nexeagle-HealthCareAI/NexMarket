'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, ChevronLeft, ChevronRight, Download, FileText, Gift, Lock, Plus, Printer, RotateCcw, Trash2, UserPlus, Wallet } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { Empty, ErrorBox, friendlyError, Modal, Pill, Skeleton } from '@/components/crm/ui';
import { dayText, errText, MODE, monthText, PAY, rs, type PayStatus, type Staff } from './shared';

export interface Calc {
  basis: 'fixed' | 'attendance'; rate: number; monthDays: number; employedDays: number; from?: string | null; to?: string | null;
  present: number; paidLeave: number; off: number; absent: number; unpaidLeave: number; half: number; notYet: number;
  payableDays: number; deductedDays: number; perDay: number; earned: number; deduction: number; incentives: number; net: number;
}
export interface Incentive { id: string; agentId: string; month: string; amount: number; kind: string; title: string; basis?: string | null; details?: string | null; addedByName: string; addedAt: string }
export interface PayRow {
  agentId: string; name: string; role?: string | null; block?: string | null; office: boolean; onPayroll: boolean; fromMonth: string; toMonth?: string | null;
  joinedOn?: string | null; leftOn?: string | null; payBasis: 'fixed' | 'attendance'; attendanceFrom?: string | null; note?: string | null;
  calc: Calc; incentives: Incentive[]; approved: { by: string; at: string; note?: string | null } | null;
  paid: number; left: number; status: PayStatus; owedBefore: number; referralWaiting: { count: number; amount: number } | null;
}
export interface Sheet {
  month: string; thisMonth: string; today: string; monthOver: boolean; monthDays: number; canHandle: boolean; rows: PayRow[];
  totals: { people: number; salaries: number; earned: number; deductions: number; incentives: number; net: number; paid: number; left: number; approved: number; owedBefore: number };
  kinds: string[]; candidates: Staff[];
}

export const KIND_LABEL: Record<string, string> = {
  performance: 'Performance', referrals: 'Referrals & admissions', target: 'Target reached', camp: 'Health camp', travel: 'Travel / field', festival: 'Festival bonus', other: 'Other',
};
const days = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const shiftMonth = (m: string, by: number) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + by, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

/** "26.5 of 30 days · 2 absent · 1 half day" */
export function daysLine(c: Calc) {
  const parts: string[] = [];
  if (c.absent) parts.push(`${c.absent} absent`);
  if (c.unpaidLeave) parts.push(`${c.unpaidLeave} unpaid leave`);
  if (c.half) parts.push(`${c.half} half day${c.half === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/**
 * Salaries for a month: each person's days (from the date of joining, and attendance for those paid by it), what that
 * earns, incentives on top, then check and approve, then pay. A payment is recorded only after the month is approved.
 */
export function PayrollTab({ editable, modes, onOpen, toast, onChanged }: { editable: boolean; modes: string[]; onOpen: (agentId: string) => void; toast: (m: string) => void; onChanged: () => void }) {
  const [month, setMonth] = useState('');
  const [t, setT] = useState<Sheet | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [add, setAdd] = useState(false);
  const [review, setReview] = useState<string | null>(null);
  const [pay, setPay] = useState<PayRow | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setT(await crm.get<Sheet>(`/api/v1/spend/payroll${month ? `?month=${month}` : ''}`)); setErr(null); } catch (e) { setErr(friendlyError(e)); } }, [month]);
  useEffect(() => { const x = setTimeout(() => void load(), 0); return () => clearTimeout(x); }, [load]);
  const done = (m: string) => { toast(m); setAdd(false); setPay(null); setPicked(new Set()); void load(); onChanged(); };
  const can = editable && !!t?.canHandle;
  const row = useMemo(() => t?.rows.find((r) => r.agentId === review) ?? null, [t, review]);

  const approve = async (ids: string[]) => {
    if (!t) return;
    setBusy(true);
    try {
      const res = await crm.post<{ approved: number }>('/api/v1/spend/payroll/approve', { agentIds: ids, month: t.month });
      done(`${res.approved} salar${res.approved === 1 ? 'y' : 'ies'} for ${monthText(t.month)} approved. Each person is told; record the payment when you pay.`);
    } catch (e) { toast(errText(e)); } finally { setBusy(false); }
  };
  const exportCsv = async () => {
    if (!t) return;
    try { await crm.download(`/api/v1/spend/payroll/export?month=${t.month}`, `payroll-${t.month}.csv`); } catch (e) { toast(friendlyError(e)); }
  };

  if (err && !t) return <ErrorBox message={err} onRetry={load} />;
  if (!t) return <Skeleton h={360} />;
  const waiting = t.rows.filter((r) => !r.approved && r.calc.net > 0);
  const pickable = waiting.map((r) => r.agentId);
  const allPicked = pickable.length > 0 && pickable.every((id) => picked.has(id));

  return (
    <>
      <div className="ms-range">
        <div className="at-month">
          <button type="button" className="crm-btn is-secondary is-sm" aria-label="Previous month" style={{ width: 40, padding: 0 }} onClick={() => setMonth(shiftMonth(t.month, -1))}><ChevronLeft size={17} aria-hidden /></button>
          <strong style={{ minWidth: 140, textAlign: 'center', fontSize: 16 }}>{monthText(t.month)}</strong>
          <button type="button" className="crm-btn is-secondary is-sm" aria-label="Next month" style={{ width: 40, padding: 0 }} disabled={t.month >= t.thisMonth} onClick={() => setMonth(shiftMonth(t.month, 1))}><ChevronRight size={17} aria-hidden /></button>
        </div>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a className="crm-btn is-secondary is-sm" href="/admin/leave?tab=register"><CalendarCheck size={15} aria-hidden /> Attendance</a>
          <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void exportCsv()} disabled={!t.rows.length}><Download size={15} aria-hidden /> Export</button>
          {can && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setAdd(true)}><UserPlus size={15} aria-hidden /> Add a person</button>}
        </span>
      </div>

      <div className="py-steps" aria-label="How salaries are paid">
        <span><b>1</b><span>Days worked come from <a href="/admin/leave?tab=register">Team attendance</a>, counted from each person’s date of joining</span></span>
        <span><b>2</b><span>Add incentives, with what they are for</span></span>
        <span><b>3</b><span>Check each person and approve the month</span></span>
        <span><b>4</b><span>Pay, and record the payment</span></span>
      </div>

      <div className="py-sum">
        <div><span>Monthly salaries</span><strong>{rs(t.totals.salaries)}</strong><em>{t.totals.people} people</em></div>
        <div><span>Not paid (days off work)</span><strong className={t.totals.deductions ? 'is-bad' : ''}>− {rs(t.totals.deductions)}</strong><em>absent, unpaid leave, half days, joining</em></div>
        <div><span>Incentives</span><strong className="is-ok">+ {rs(t.totals.incentives)}</strong><em>{t.rows.reduce((s, r) => s + r.incentives.length, 0)} added</em></div>
        <div className="is-main"><span>To pay for {monthText(t.month, true)}</span><strong>{rs(t.totals.net)}</strong><em>{t.totals.approved} of {t.rows.filter((r) => r.calc.net > 0).length} approved</em></div>
        <div><span>Paid</span><strong>{rs(t.totals.paid)}</strong><em>{rs(t.totals.left)} left{t.totals.owedBefore ? ` · ${rs(t.totals.owedBefore)} from earlier months` : ''}</em></div>
      </div>

      {!t.monthOver && <p className="ms-warn" style={{ margin: 0 }}>{monthText(t.month)} isn’t over yet. Days still to come are counted as paid; approve once the month ends, or now if you are paying early.</p>}

      {can && picked.size > 0 && (
        <div className="at-bulk"><strong>{picked.size} selected</strong>
          <span className="at-bulk-acts">
            <button type="button" className="crm-btn is-ok is-sm" disabled={busy} onClick={() => void approve([...picked])}><Lock size={14} aria-hidden /> Approve {picked.size}</button>
            <button type="button" className="crm-btn is-ghost is-sm" onClick={() => setPicked(new Set())}>Clear</button>
          </span>
        </div>
      )}

      <section className="crm-card" style={{ padding: 0 }}>
        {t.rows.length === 0 ? (
          <div style={{ padding: 20 }}><Empty title="Nobody is on the payroll for this month"><span className="crm-sub">Add the people on the team with their monthly salary and date of joining. Their salary is then worked out from the days they work.</span>{can && <button type="button" className="crm-btn is-sm" onClick={() => setAdd(true)}>Add a person</button>}</Empty></div>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table py-table">
              <thead><tr>
                {can && <th scope="col" style={{ width: 36 }}><input type="checkbox" className="at-pick" aria-label="Select everyone waiting for approval" checked={allPicked} disabled={!pickable.length} onChange={() => setPicked(allPicked ? new Set() : new Set(pickable))} /></th>}
                <th scope="col">Person</th><th scope="col" className="wb-num">Salary</th><th scope="col">Days paid</th><th scope="col" className="wb-num">Earned</th>
                <th scope="col" className="wb-num">Incentives</th><th scope="col" className="wb-num">To pay</th><th scope="col">Status</th><th scope="col"><span className="crm-sr">Actions</span></th>
              </tr></thead>
              <tbody>
                {t.rows.map((r) => {
                  const c = r.calc;
                  const extra = daysLine(c);
                  return (
                    <tr key={r.agentId}>
                      {can && <td>{!r.approved && c.net > 0 && <input type="checkbox" className="at-pick" aria-label={`Select ${r.name}`} checked={picked.has(r.agentId)} onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(r.agentId)) n.delete(r.agentId); else n.add(r.agentId); return n; })} />}</td>}
                      <td>
                        <button type="button" className="wa-link" onClick={() => setReview(r.agentId)}>{r.name}</button>
                        <span className="crm-cell-sub" style={{ display: 'block' }}>
                          {r.joinedOn ? `Joined ${dayText(r.joinedOn, false)} ${r.joinedOn.slice(0, 4)}` : `Since ${monthText(r.fromMonth, true)}`}{r.leftOn ? ` · left ${dayText(r.leftOn)}` : ''}
                        </span>
                        <span className={`py-basis is-${c.basis}`}>{c.basis === 'attendance' ? 'By attendance' : 'Fixed monthly'}</span>
                      </td>
                      <td className="wb-num">{rs(c.rate)}</td>
                      <td>
                        <strong>{days(c.payableDays)}</strong> <span className="crm-sub">of {c.monthDays}</span>
                        {c.employedDays < c.monthDays && c.employedDays > 0 && <span className="crm-cell-sub" style={{ display: 'block' }}>employed {c.employedDays} days</span>}
                        {extra && <span className="crm-cell-sub py-cut" style={{ display: 'block' }}>{extra}</span>}
                        {c.basis === 'attendance' && c.notYet > 0 && <span className="crm-cell-sub" style={{ display: 'block' }}>{c.notYet} days still to come</span>}
                      </td>
                      <td className="wb-num">{rs(c.earned)}{c.deduction > 0 && <span className="crm-cell-sub py-cut" style={{ display: 'block' }}>− {rs(c.deduction)}</span>}</td>
                      <td className="wb-num">{c.incentives ? <span className="py-plus">+ {rs(c.incentives)}</span> : <span className="crm-sub">—</span>}
                        {r.referralWaiting && !r.approved && <span className="crm-cell-sub" style={{ display: 'block' }}>{rs(r.referralWaiting.amount)} referral waiting</span>}</td>
                      <td className="wb-num"><strong>{rs(c.net)}</strong></td>
                      <td>
                        {r.approved ? <Pill tone="ok"><Lock size={11} aria-hidden /> Approved</Pill> : <Pill tone="neutral">To check</Pill>}
                        {r.paid > 0 || r.approved ? <span style={{ display: 'block', marginTop: 4 }}><Pill tone={PAY[r.status].tone}>{r.status === 'full' ? 'Paid' : r.status === 'part' ? `Paid ${rs(r.paid)}` : PAY[r.status].label}</Pill></span> : null}
                        {r.owedBefore > 0 && <span className="crm-cell-sub" style={{ display: 'block' }}>+ {rs(r.owedBefore)} earlier</span>}
                      </td>
                      <td><span className="sp-actions ms-nowrap" style={{ justifyContent: 'flex-end' }}>
                        {can && r.approved && r.left > 0
                          ? <button type="button" className="crm-btn is-sm" onClick={() => setPay(r)}><Wallet size={14} aria-hidden /> Pay {rs(r.left)}</button>
                          : <button type="button" className={`crm-btn is-sm${!r.approved && can ? '' : ' is-secondary'}`} onClick={() => setReview(r.agentId)}><FileText size={14} aria-hidden /> {!r.approved && can ? 'Check' : 'Open'}</button>}
                      </span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {add && <MemberForm candidates={t.candidates} thisMonth={t.thisMonth} today={t.today} onClose={() => setAdd(false)} onSaved={done} />}
      {pay && <PayForm agentId={pay.agentId} name={pay.name} month={t.month} due={pay.calc.net} paid={pay.paid} today={t.today} modes={modes} onClose={() => setPay(null)} onSaved={done} />}
      {row && <ReviewModal row={row} sheet={t} can={can} toast={toast} onClose={() => setReview(null)} onChanged={() => { void load(); onChanged(); }}
        onPay={() => { setPay(row); setReview(null); }} onOpenPerson={() => { setReview(null); onOpen(row.agentId); }} />}
    </>
  );
}

/** One person's month: the days, how the salary is worked out, incentives, and approve / reopen / pay. */
function ReviewModal({ row: r, sheet: t, can, toast, onClose, onChanged, onPay, onOpenPerson }: {
  row: PayRow; sheet: Sheet; can: boolean; toast: (m: string) => void; onClose: () => void; onChanged: () => void; onPay: () => void; onOpenPerson: () => void;
}) {
  const c = r.calc;
  const [adding, setAdding] = useState(false);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = !!r.approved;
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try { await fn(); toast(msg); onChanged(); } catch (e) { toast(errText(e)); } finally { setBusy(false); }
  };
  const tiles: [string, number | string, string?][] = c.basis === 'attendance'
    ? [['Present', days(c.present), 'ok'], ['Paid leave', c.paidLeave], ['Days off / holidays', c.off], ['Absent', c.absent, c.absent ? 'bad' : undefined], ['Unpaid leave', c.unpaidLeave, c.unpaidLeave ? 'bad' : undefined], ['Half days', c.half, c.half ? 'warn' : undefined], ...(c.notYet ? [['Still to come', c.notYet] as [string, number]] : [])]
    : [['Days employed', c.employedDays], ['Days in month', c.monthDays]];

  if (terms) return <TermsForm row={r} thisMonth={t.thisMonth} onClose={() => setTerms(false)} onSaved={(m) => { setTerms(false); toast(m); onChanged(); }} />;

  return (
    <Modal title={`${r.name} · ${monthText(t.month)}`} onClose={onClose} wide actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={onOpenPerson}>All months</button>
      {locked && <button type="button" className="crm-btn is-secondary" onClick={() => printSlip(r, t)}><Printer size={15} aria-hidden /> Payslip</button>}
      {can && locked && <button type="button" className="crm-btn is-secondary" disabled={busy} onClick={() => void act(() => crm.post('/api/v1/spend/payroll/reopen', { agentId: r.agentId, month: t.month }), 'Reopened: change incentives or attendance, then approve again.')}><RotateCcw size={15} aria-hidden /> Reopen</button>}
      {can && !locked && c.net > 0 && <button type="button" className="crm-btn is-ok" disabled={busy} onClick={() => void act(() => crm.post('/api/v1/spend/payroll/approve', { agentIds: [r.agentId], month: t.month }), `${monthText(t.month)} approved for ${r.name}: ${rs(c.net)}.`)}><Lock size={15} aria-hidden /> Approve {rs(c.net)}</button>}
      {can && locked && r.left > 0 && <button type="button" className="crm-btn" onClick={onPay}><Wallet size={15} aria-hidden /> Pay {rs(r.left)}</button>}
    </>}>
      <div className="py-terms">
        <span><em>Salary</em><strong>{rs(c.rate)} a month</strong></span>
        <span><em>Joined</em><strong>{r.joinedOn ? `${dayText(r.joinedOn)} ${r.joinedOn.slice(0, 4)}` : 'Not set'}</strong></span>
        <span><em>Paid</em><strong>{c.basis === 'attendance' ? 'By attendance' : 'Fixed monthly'}</strong></span>
        {r.leftOn && <span><em>Last day</em><strong>{dayText(r.leftOn)} {r.leftOn.slice(0, 4)}</strong></span>}
        {can && <button type="button" className="wa-link" onClick={() => setTerms(true)}>Change</button>}
      </div>
      {locked && <p className="py-locked"><Lock size={14} aria-hidden /> Approved by {r.approved!.by} on {new Date(r.approved!.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}. These figures stay as approved; reopen to change them.</p>}

      <h3 className="at-h3">Days in {monthText(t.month)}{c.employedDays < c.monthDays && c.from ? ` (employed ${dayText(c.from)} – ${dayText(c.to!)})` : ''}</h3>
      <div className="py-tiles">
        {tiles.map(([l, n, tone]) => <span key={l} className={tone ? `is-${tone}` : ''}><strong>{n}</strong>{l}</span>)}
      </div>
      {c.basis === 'attendance' && <p className="crm-sub" style={{ margin: 0, fontSize: 13 }}>From <a href="/admin/leave?tab=register">Team attendance</a>. A wrong day? Mark it there{locked ? ', reopen this month,' : ''} and it shows here.</p>}

      <h3 className="at-h3">How it’s worked out</h3>
      <dl className="py-calc">
        <div><dt>Monthly salary</dt><dd>{rs(c.rate)}</dd></div>
        <div><dt>One day ({rs(c.rate)} ÷ {c.monthDays} days)</dt><dd>{rs(c.perDay)}</dd></div>
        {c.employedDays < c.monthDays && <div><dt>Days employed this month</dt><dd>{c.employedDays} of {c.monthDays}</dd></div>}
        {c.deductedDays > 0 && <div className="is-cut"><dt>Days not paid: {daysLine(c)}</dt><dd>− {days(c.deductedDays)} days</dd></div>}
        <div><dt>Days paid</dt><dd>{days(c.payableDays)}</dd></div>
        <div className="is-sub"><dt>Earned ({days(c.payableDays)} × {rs(c.perDay)})</dt><dd>{rs(c.earned)}</dd></div>
        <div className="is-plus"><dt>Incentives</dt><dd>+ {rs(c.incentives)}</dd></div>
        <div className="is-total"><dt>To pay</dt><dd>{rs(c.net)}</dd></div>
        {r.paid > 0 && <div><dt>Paid so far</dt><dd>{rs(r.paid)} · {r.left > 0 ? `${rs(r.left)} left` : 'fully paid'}</dd></div>}
      </dl>

      <div className="py-inc-head">
        <h3 className="at-h3"><Gift size={15} aria-hidden /> Incentives · {rs(c.incentives)}</h3>
        {can && !locked && !adding && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setAdding(true)}><Plus size={14} aria-hidden /> Add incentive</button>}
      </div>
      {r.referralWaiting && can && !locked && (
        <div className="py-ref">
          <span><strong>{rs(r.referralWaiting.amount)}</strong> in {r.referralWaiting.count} approved referral incentive{r.referralWaiting.count === 1 ? '' : 's'} not paid yet (Payments).</span>
          <button type="button" className="crm-btn is-sm" disabled={busy} onClick={() => void act(() => crm.post('/api/v1/spend/payroll/pull-referrals', { agentId: r.agentId, month: t.month }), 'Added to this salary; marked paid in Payments.')}>Pay with this salary</button>
        </div>
      )}
      {adding && <IncentiveForm row={r} month={t.month} kinds={t.kinds} onCancel={() => setAdding(false)} onSaved={(m) => { setAdding(false); toast(m); onChanged(); }} />}
      {r.incentives.length === 0 ? (!adding && <p className="crm-sub" style={{ margin: 0 }}>No incentives this month.</p>) : (
        <ul className="py-incs">
          {r.incentives.map((i) => (
            <li key={i.id}>
              <span className="py-inc-kind">{KIND_LABEL[i.kind] ?? i.kind}</span>
              <span className="py-inc-main">
                <strong>{i.title}</strong>
                {i.basis && <span className="crm-cell-sub">{i.basis}</span>}
                {i.details && <span className="crm-cell-sub">{i.details}</span>}
                <span className="crm-cell-sub">Added by {i.addedByName}, {new Date(i.addedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
              </span>
              <strong className="py-plus">+ {rs(i.amount)}</strong>
              {can && !locked && <button type="button" className="crm-btn is-ghost is-sm" aria-label={`Take out ${i.title}`} disabled={busy}
                onClick={() => { if (window.confirm(`Take out “${i.title}” (${rs(i.amount)})?`)) void act(() => crm.post(`/api/v1/spend/incentives/${i.id}/remove`), 'Incentive taken out.'); }}><Trash2 size={15} aria-hidden /></button>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function IncentiveForm({ row, month, kinds, onCancel, onSaved }: { row: PayRow; month: string; kinds: string[]; onCancel: () => void; onSaved: (m: string) => void }) {
  const [kind, setKind] = useState('performance');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [basis, setBasis] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    const n = Number(amount);
    if (!amount.trim() || !Number.isFinite(n) || n <= 0) { setErr('Write the amount in rupees.'); return; }
    if (!title.trim()) { setErr('Write a short title.'); return; }
    setBusy(true); setErr('');
    try { await crm.post('/api/v1/spend/incentives', { agentId: row.agentId, month, amount: n, kind, title, basis, details }); onSaved(`${rs(n)} incentive added for ${row.name}.`); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="py-inc-form">
      <div className="crm-chips" role="group" aria-label="What it is for">
        {kinds.map((k) => <button key={k} type="button" className="crm-chip is-soft" aria-pressed={kind === k} onClick={() => setKind(k)}>{KIND_LABEL[k] ?? k}</button>)}
      </div>
      <div className="ms-two">
        <label className="crm-field">Title<input className="crm-input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. November admissions" /></label>
        <label className="crm-field">Amount (₹)<input className="crm-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="e.g. 2400" /></label>
      </div>
      <label className="crm-field">How it was worked out (optional)<input className="crm-input" value={basis} maxLength={200} onChange={(e) => setBasis(e.target.value)} placeholder="e.g. 12 admissions × ₹200" /></label>
      <label className="crm-field">Details (optional)<textarea className="crm-textarea" style={{ minHeight: 64 }} value={details} maxLength={600} onChange={(e) => setDetails(e.target.value)} placeholder="e.g. Patients from Jokihat camp, approved by the MD" /></label>
      {err && <p className="ms-err" role="alert">{err}</p>}
      <span style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="crm-btn is-secondary is-sm" onClick={onCancel}>Cancel</button>
        <button type="button" className="crm-btn is-sm" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Add incentive'}</button>
      </span>
    </div>
  );
}

/** Date of joining, last working day and how the salary is paid. */
function TermsForm({ row, thisMonth, onClose, onSaved }: { row: PayRow; thisMonth: string; onClose: () => void; onSaved: (m: string) => void }) {
  const [joinedOn, setJoinedOn] = useState(row.joinedOn ?? '');
  const [leftOn, setLeftOn] = useState(row.leftOn ?? '');
  const [basis, setBasis] = useState<'fixed' | 'attendance'>(row.payBasis);
  const [attFrom, setAttFrom] = useState(row.attendanceFrom ?? thisMonth);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    setBusy(true); setErr('');
    try {
      await crm.put(`/api/v1/spend/team/${encodeURIComponent(row.agentId)}/terms`, { joinedOn: joinedOn || null, leftOn: leftOn || null, payBasis: basis, attendanceFrom: basis === 'attendance' ? attFrom : null });
      onSaved(`Saved for ${row.name}.`);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Pay terms · ${row.name}`} onClose={onClose} actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="crm-btn" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
    </>}>
      <div className="ms-form">
        <div className="ms-two">
          <label className="crm-field">Date of joining<input className="crm-input" type="date" value={joinedOn} onChange={(e) => setJoinedOn(e.target.value)} /></label>
          <label className="crm-field">Last working day (if leaving)<input className="crm-input" type="date" value={leftOn} min={joinedOn || undefined} onChange={(e) => setLeftOn(e.target.value)} /></label>
        </div>
        <BasisPicker value={basis} onChange={setBasis} />
        {basis === 'attendance' && (
          <label className="crm-field">By attendance from<input className="crm-input" type="month" value={attFrom} onChange={(e) => setAttFrom(e.target.value)} />
            <span className="crm-sub" style={{ fontWeight: 400 }}>Months before this are paid as fixed monthly.</span></label>
        )}
        {err && <p className="ms-err" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

function BasisPicker({ value, onChange }: { value: 'fixed' | 'attendance'; onChange: (v: 'fixed' | 'attendance') => void }) {
  return (
    <div role="radiogroup" aria-label="How the salary is paid" className="py-basis-pick">
      <button type="button" role="radio" aria-checked={value === 'attendance'} onClick={() => onChange('attendance')}>
        <strong>By attendance</strong><span>Only days worked are paid: absent days and unpaid leave are cut, a half day is half. Days off, holidays and paid leave are paid.</span>
      </button>
      <button type="button" role="radio" aria-checked={value === 'fixed'} onClick={() => onChange('fixed')}>
        <strong>Fixed monthly</strong><span>The full salary every month, counted from the date of joining.</span>
      </button>
    </div>
  );
}

/** Put a person on the payroll, or change their salary from a month onwards. */
export function MemberForm({ candidates, fixed, salary: startSalary, thisMonth, today, onClose, onSaved }: { candidates?: Staff[]; fixed?: { agentId: string; name: string }; salary?: number; thisMonth: string; today?: string; onClose: () => void; onSaved: (m: string) => void }) {
  const [agentId, setAgentId] = useState(fixed?.agentId ?? '');
  const [salary, setSalary] = useState(startSalary ? String(startSalary) : '');
  const [fromMonth, setFromMonth] = useState(thisMonth);
  const [joinedOn, setJoinedOn] = useState(today ?? '');
  const [basis, setBasis] = useState<'fixed' | 'attendance'>('attendance');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const n = Number(salary);
    if (!agentId) { setErr('Pick the person.'); return; }
    if (!salary.trim() || !Number.isFinite(n) || n <= 0) { setErr('Write the monthly salary in rupees.'); return; }
    if (!fixed && !joinedOn) { setErr('Pick the date of joining.'); return; }
    setBusy(true); setErr(null);
    try {
      await crm.post('/api/v1/spend/team', fixed ? { agentId, salary: n, fromMonth, note } : { agentId, salary: n, joinedOn, payBasis: basis, note });
      onSaved(fixed ? `Salary is ${rs(n)} a month from ${monthText(fromMonth)}.` : `Added to the payroll at ${rs(n)} a month from ${dayText(joinedOn)}.`);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={fixed ? `Change salary · ${fixed.name}` : 'Add a person to the payroll'} onClose={onClose} actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="crm-btn" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
    </>}>
      <div className="ms-form">
        {!fixed && (
          <label className="crm-field">Person
            <select className="crm-input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">Pick a person</option>
              {(candidates ?? []).map((s) => <option key={s.agentId} value={s.agentId}>{s.name} · {s.agentId}</option>)}
            </select>
            <span className="crm-sub" style={{ fontWeight: 400 }}>Everyone with a login is listed. Create a new person in Field agents or Users &amp; roles first.</span>
          </label>
        )}
        <div className="ms-two">
          <label className="crm-field">Salary a month (₹)<input className="crm-input" inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="e.g. 12000" /></label>
          {fixed
            ? <label className="crm-field">From month<input className="crm-input" type="month" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} /></label>
            : <label className="crm-field">Date of joining<input className="crm-input" type="date" value={joinedOn} onChange={(e) => setJoinedOn(e.target.value)} /></label>}
        </div>
        {fixed ? <p className="crm-sub" style={{ margin: 0 }}>Months before this one keep the salary they had.</p> : <>
          <BasisPicker value={basis} onChange={setBasis} />
          <p className="crm-sub" style={{ margin: 0 }}>The first month is paid from the date of joining: joining on the 16th of a 30-day month pays 15 days.</p>
        </>}
        <label className="crm-field">Note (optional)<input className="crm-input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Marketing executive, Baisi block" /></label>
        {err && <p className="ms-err" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

/** Record a salary payment for a person and a month: all of it or a part. */
export function PayForm({ agentId, name, month: startMonth, due, paid, today, modes, onClose, onSaved }: { agentId: string; name: string; month: string; due: number; paid: number; today: string; modes: string[]; onClose: () => void; onSaved: (m: string) => void }) {
  const left = Math.max(0, due - paid);
  const [month, setMonth] = useState(startMonth);
  const [amount, setAmount] = useState(left ? String(left) : '');
  const [on, setOn] = useState(today);
  const [mode, setMode] = useState('bank');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const n = Number(amount);
  const same = month === startMonth;
  const save = async () => {
    if (!amount.trim() || !Number.isFinite(n) || n <= 0) { setErr('Write the amount in rupees.'); return; }
    setBusy(true); setErr(null);
    try { await crm.post('/api/v1/spend/salary', { agentId, month, amount: n, on, mode, note }); onSaved(`${rs(n)} salary paid to ${name} for ${monthText(month)}. They are told.`); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Pay salary · ${name}`} onClose={onClose} actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="crm-btn" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Record payment'}</button>
    </>}>
      <div className="ms-form">
        <div className="ms-two">
          <label className="crm-field">For the month<input className="crm-input" type="month" value={month} onChange={(e) => { if (e.target.value) setMonth(e.target.value); }} /></label>
          <label className="crm-field">Paid on<input className="crm-input" type="date" value={on} max={today} onChange={(e) => setOn(e.target.value)} /></label>
        </div>
        {same && <p className="crm-sub" style={{ margin: 0 }}>{monthText(month)}: to pay {rs(due)} · paid {rs(paid)} · left {rs(left)}{Number.isFinite(n) && n > 0 ? ` → after this: ${n + paid >= due ? (n + paid > due ? `paid ${rs(n + paid - due)} extra` : 'fully paid') : `${rs(due - paid - n)} still left`}` : ''}</p>}
        <label className="crm-field">Amount (₹)<input className="crm-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="All of it or a part" /></label>
        <fieldset className="ms-set"><legend>How</legend>
          <div className="crm-chips">{modes.map((m) => <button key={m} type="button" className="crm-chip" aria-pressed={mode === m} onClick={() => setMode(m)}>{MODE[m] ?? m}</button>)}</div>
        </fieldset>
        <label className="crm-field">Note or reference (optional)<input className="crm-input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. UPI ref 4321, or first half" /></label>
        {err && <p className="ms-err" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));

/** A printable payslip for an approved month, in a new window. */
function printSlip(r: PayRow, t: Sheet) {
  const c = r.calc;
  const line = (a: string, b: string, cls = '') => `<tr class="${cls}"><td>${esc(a)}</td><td>${esc(b)}</td></tr>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Payslip ${esc(r.name)} ${esc(t.month)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;color:#0f172a;max-width:640px;margin:32px auto;padding:0 16px}h1{font-size:20px;margin:0}p{margin:2px 0;color:#5a6478}
table{width:100%;border-collapse:collapse;margin-top:18px}td{padding:8px 0;border-bottom:1px solid #e3e6ee}td:last-child{text-align:right;font-variant-numeric:tabular-nums}
.t td{font-weight:800;font-size:16px;border-top:2px solid #0f172a}.cut td:last-child{color:#b42318}.plus td:last-child{color:#0b6b4a}.s{font-size:12px;color:#5a6478;margin-top:24px}</style></head><body>
<h1>Payslip · ${esc(monthText(t.month))}</h1><p>${esc(r.name)} · ${esc(r.agentId)}${r.joinedOn ? ` · joined ${esc(r.joinedOn)}` : ''}</p>
<table>${line('Monthly salary', rs(c.rate))}${line('Days in month', String(c.monthDays))}${c.employedDays < c.monthDays ? line('Days employed', String(c.employedDays)) : ''}
${c.basis === 'attendance' ? line('Present', days(c.present)) + line('Paid leave', String(c.paidLeave)) + line('Days off and holidays', String(c.off)) : ''}
${c.deductedDays ? line(`Days not paid (${daysLine(c)})`, `− ${days(c.deductedDays)}`, 'cut') : ''}${line('Days paid', days(c.payableDays))}${line('Earned', rs(c.earned))}
${r.incentives.map((i) => line(`Incentive: ${i.title}${i.basis ? ` (${i.basis})` : ''}`, `+ ${rs(i.amount)}`, 'plus')).join('')}${line('Net pay', rs(c.net), 't')}
${r.paid ? line('Paid', rs(r.paid)) : ''}</table>
<p class="s">Approved by ${esc(r.approved?.by ?? '')} on ${r.approved ? esc(new Date(r.approved.at).toLocaleDateString('en-IN')) : ''}. One day’s pay is the monthly salary ÷ days in the month.</p>
<script>window.onload=()=>window.print()</script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
