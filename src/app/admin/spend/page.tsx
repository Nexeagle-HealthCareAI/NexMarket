'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, HandCoins, Pencil, Plus, Receipt, Trash2, Undo2, Wallet, X } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { Empty, ErrorBox, friendlyError, Modal, PageHead, Pill, Skeleton, useToast } from '@/components/crm/ui';
import { Analytics } from '@/components/crm/spend/Analytics';
import { ConstantTab } from '@/components/crm/spend/Constant';
import { FundForm, ProjectsTab, ProjectView } from '@/components/crm/spend/Projects';
import { SetupTab } from '@/components/crm/spend/Setup';
import { MemberForm, PayForm, PayrollTab } from '@/components/crm/spend/Payroll';
import {
  dayText, errText, MODE, money, monthText, NATURE, PAY, rs,
  type Balance, type Data, type Expense, type Fund, type Move, type PayStatus,
} from '@/components/crm/spend/shared';

interface Member {
  agentId: string; name: string; role?: string | null; block?: string | null; onTeam: boolean; onPayroll: boolean; fromMonth?: string | null; toMonth?: string | null; note?: string | null;
  salary: number; rates: { amount: number; fromMonth: string }[]; months: { month: string; due: number; paid: number; left: number; status: PayStatus }[];
  totalDue: number; totalPaid: number; totalLeft: number; payments: Expense[]; otherTotal: number; otherByCategory: Record<string, number>; other: Expense[];
  categories: { key: string; label: string }[];
}
interface PersonDetail { agentId: string; name: string; balance: Balance; settle: { kind: 'given' | 'returned'; amount: number } | null; moves: Move[]; expenses: Expense[]; funds?: Fund[]; manager?: boolean }

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Colours for the original kinds, for places that only get a kind's key. */
const COLOR: Record<string, string> = { agents: '#0a72d6', food: '#d9822b', petrol: '#7b3fe4', stay: '#b45309', banner: '#0f8a5f', digital: '#c2185b', rent: '#0e7490', other: '#6b7280' };

/** What a person's balance means, in words. */
function BalanceText({ b }: { b: Balance }) {
  if (b.net > 0) return <Pill tone="warn">Holds {rs(b.holds)}</Pill>;
  if (b.net < 0) return <Pill tone="bad">We owe {rs(b.owed)}</Pill>;
  return <Pill tone="ok">Settled</Pill>;
}

type Tab = 'work' | 'projects' | 'constant' | 'team' | 'analytics' | 'setup';
type Range = 'today' | 'week' | 'month' | 'last30' | 'quarter' | 'custom';
const TABS: { key: Tab; label: string }[] = [
  { key: 'work', label: 'Expenses and approvals' }, { key: 'projects', label: 'Projects' }, { key: 'constant', label: 'Constant payments' },
  { key: 'team', label: 'Salaries' }, { key: 'analytics', label: 'Analytics' }, { key: 'setup', label: 'Setup' },
];

/**
 * Marketing spend: what was spent each day and on what, organised by the team's own kinds (constant or variable) and by
 * project; funds received; constant payments due every month; salaries; who holds the money (money managers and the
 * team); and Analytics that puts what needs attention first.
 */
export default function SpendPage() {
  const [range, setRange] = useState<Range>('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('work');
  const [cat, setCat] = useState('');
  const [nature, setNature] = useState<'' | 'constant' | 'variable'>('');
  const [proj, setProj] = useState('');
  const [toast, showToast] = useToast();
  const [form, setForm] = useState<{ edit?: Expense; day?: string; projectId?: string } | null>(null);
  const [move, setMove] = useState<{ agentId?: string; kind?: 'given' | 'returned'; amount?: number } | null>(null);
  const [fund, setFund] = useState<{ projectId?: string } | null>(null);
  const [reject, setReject] = useState<Expense | null>(null);
  const [bill, setBill] = useState<Expense | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [member, setMember] = useState<string | null>(null);
  const [teamKey, setTeamKey] = useState(0);

  const span = useMemo(() => {
    const now = new Date();
    if (range === 'today') return { f: iso(now), t: iso(now) };
    if (range === 'week') { const s = new Date(now); s.setDate(s.getDate() - 6); return { f: iso(s), t: iso(now) }; }
    if (range === 'month') return { f: iso(new Date(now.getFullYear(), now.getMonth(), 1)), t: iso(now) };
    if (range === 'last30') { const s = new Date(now); s.setDate(s.getDate() - 29); return { f: iso(s), t: iso(now) }; }
    if (range === 'quarter') { const s = new Date(now); s.setDate(s.getDate() - 89); return { f: iso(s), t: iso(now) }; }
    return { f: from, t: to };
  }, [range, from, to]);

  const load = useCallback(async () => {
    if (!span.f || !span.t) return;
    try { setData(await crm.get<Data>(`/api/v1/spend?from=${span.f}&to=${span.t}`)); setError(null); } catch (e) { setError(friendlyError(e)); }
  }, [span.f, span.t]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  const kindOf = useMemo(() => Object.fromEntries((data?.categories ?? []).map((c) => [c.key, c])) as Record<string, Data['categories'][number]>, [data]);
  const label = useMemo(() => Object.fromEntries((data?.categories ?? []).map((c) => [c.key, c.label])) as Record<string, string>, [data]);
  const projName = useMemo(() => Object.fromEntries((data?.projects ?? []).map((p) => [p.id, p])) as Record<string, Data['projects'][number]>, [data]);
  const done = (msg: string) => { showToast(msg); setForm(null); setMove(null); setReject(null); setFund(null); setTeamKey((k) => k + 1); void load(); };

  const decide = async (e: Expense, approve: boolean, reason?: string) => {
    setBusyId(e.id);
    try { await crm.post(`/api/v1/spend/${e.id}/decide`, { approve, reason }); done(approve ? `Approved ${rs(e.amount)} for ${e.agentName ?? 'them'}.` : `Not approved. ${e.agentName ?? 'They'} will see the reason.`); }
    catch (err) { showToast(errText(err)); } finally { setBusyId(null); }
  };
  const remove = async (e: Expense) => {
    if (!window.confirm(`Take ${rs(e.amount)} (${label[e.category] ?? e.category}, ${dayText(e.spentOn)}) out of the totals? It is kept in the records, not deleted.`)) return;
    setBusyId(e.id);
    try { await crm.post(`/api/v1/spend/${e.id}/remove`); done('Taken out of the totals.'); } catch (err) { showToast(errText(err)); } finally { setBusyId(null); }
  };

  if (error && !data) return <main className="crm-page"><PageHead title="Marketing spend" /><ErrorBox message={error} onRetry={load} /></main>;
  if (!data) return <main className="crm-page"><PageHead title="Marketing spend" /><Skeleton h={520} /></main>;

  const editable = data.me.canHandle;
  const cats = data.categories.filter((c) => !c.archived || data.byCategory[c.key]);
  const entries = data.items.filter((e) => (!cat || e.category === cat) && (!nature || (kindOf[e.category]?.nature ?? 'variable') === nature) && (!proj || (proj === '-' ? !e.projectId : e.projectId === proj)));
  const entriesSum = entries.filter((e) => e.status === 'approved').reduce((s, e) => s + e.amount, 0);
  const bad = data.notes.filter((n) => n.tone === 'bad').length;
  const showsRange = tab === 'work' || tab === 'analytics';
  const projectsUsed = data.projects.filter((p) => data.items.some((e) => e.projectId === p.id));

  return (
    <main className="crm-page">
      <PageHead title="Marketing spend" sub={data.me.isManager
        ? 'You are a money manager: record funds received, give the team money, approve what they spend and pay the regular costs.'
        : 'What marketing costs, constant and variable, by project and by person. Funds received, money in people’s hands, salaries and regular payments, all in one place.'}>
        {editable && <button type="button" className="crm-btn is-secondary" onClick={() => setFund({})}><HandCoins size={16} aria-hidden /> Money received</button>}
        {editable && <button type="button" className="crm-btn is-secondary" onClick={() => setMove({})}><Wallet size={16} aria-hidden /> Give or take back</button>}
        {editable && <button type="button" className="crm-btn" onClick={() => setForm({})}><Plus size={16} aria-hidden /> Add expense</button>}
      </PageHead>

      <div className="crm-tabs ms-tabs" role="tablist" aria-label="Marketing spend views">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" className="crm-tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === 'work' && data.waiting.length > 0 && <span className="an-count">{data.waiting.length}</span>}
            {t.key === 'analytics' && bad > 0 && <span className="an-count is-bad" aria-label={`${bad} things need attention`}>{bad}</span>}
            {t.key === 'constant' && data.commitments.overdueCount > 0 && <span className="an-count is-bad" aria-label={`${data.commitments.overdueCount} overdue`}>{data.commitments.overdueCount}</span>}
          </button>
        ))}
      </div>

      {showsRange && (
        <div className="ms-range">
          <div className="crm-chips" role="group" aria-label="Days shown">
            {([['today', 'Today'], ['week', 'Last 7 days'], ['month', 'This month'], ['last30', 'Last 30 days'], ['quarter', 'Last 90 days'], ['custom', 'Pick dates']] as [Range, string][]).map(([k, l]) => (
              <button key={k} type="button" className="crm-chip" aria-pressed={range === k} onClick={() => { if (k === 'custom') { setFrom(data.from); setTo(data.to); } setRange(k); }}>{l}</button>
            ))}
          </div>
          {range === 'custom' && (
            <span className="ms-dates">
              <label className="crm-sr" htmlFor="ms-from">From</label>
              <input id="ms-from" className="crm-input" type="date" value={from} max={to || data.today} onChange={(e) => setFrom(e.target.value)} />
              <span aria-hidden>to</span>
              <label className="crm-sr" htmlFor="ms-to">To</label>
              <input id="ms-to" className="crm-input" type="date" value={to} min={from} max={data.today} onChange={(e) => setTo(e.target.value)} />
            </span>
          )}
          <span className="crm-sub">{dayText(data.from, true)} to {dayText(data.to, true)}</span>
        </div>
      )}

      {tab === 'work' && (
        <>
          {data.waiting.length === 0 && <section className="crm-card so-card"><p className="ms-allclear" style={{ margin: 0 }}><Check size={16} aria-hidden /> Nothing is waiting for approval.</p></section>}
          {data.waiting.length > 0 && (
            <section className="crm-card so-card">
              <h2 className="crm-h2" style={{ margin: 0 }}>Waiting for approval <span className="crm-sub">· sent from the app; they count only once approved</span></h2>
              <ul className="ms-waiting">
                {data.waiting.map((e) => (
                  <li key={e.id}>
                    <div className="ms-w-main">
                      <strong>{rs(e.amount)} · {label[e.category] ?? e.category}</strong>
                      <span className="crm-sub">{e.agentName} · {dayText(e.spentOn, true)}{e.projectId && projName[e.projectId] ? ` · ${projName[e.projectId].name}` : ''}{e.note ? ` · ${e.note}` : ''}</span>
                    </div>
                    <span className="sp-actions">
                      {e.hasBill ? <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setBill(e)}><Receipt size={14} aria-hidden /> Bill</button> : <span className="crm-sub">No bill photo</span>}
                      {editable && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setForm({ edit: e })}><Pencil size={14} aria-hidden /> Correct</button>}
                      {editable && <button type="button" className="crm-btn is-secondary is-sm" disabled={busyId === e.id} onClick={() => setReject(e)}><X size={14} aria-hidden /> Reject</button>}
                      {editable && <button type="button" className="crm-btn is-sm" disabled={busyId === e.id} onClick={() => void decide(e, true)}><Check size={14} aria-hidden /> Approve</button>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <h2 className="crm-h2 ms-h">People and balances <span className="crm-sub">· {rs(data.held)} in people&apos;s hands{data.heldByManagers ? ` (${rs(data.heldByManagers)} with money managers)` : ''} · we owe {rs(data.owed)}</span></h2>
          <section className="crm-card">
            {data.people.length === 0 ? (
              <Empty title="Nobody holds money yet"><span className="crm-sub">Give a person an advance, record funds a money manager received, or approve an expense someone added: they appear here with their balance.</span>{editable && <button type="button" className="crm-btn is-sm" onClick={() => setMove({ kind: 'given' })}>Give money</button>}</Empty>
            ) : (
              <div className="crm-table-wrap">
                <table className="crm-table">
                  <thead><tr><th scope="col">Person</th><th scope="col" className="wb-num">Got</th><th scope="col" className="wb-num">Handed on</th><th scope="col" className="wb-num">Returned</th><th scope="col" className="wb-num">Spent</th><th scope="col" className="wb-num">Waiting</th><th scope="col">Balance</th>{editable && <th scope="col"><span className="crm-sr">Actions</span></th>}</tr></thead>
                  <tbody>
                    {data.people.map((p) => {
                      const got = p.balance.given + (p.balance.received ?? 0) + (p.balance.handedBack ?? 0);
                      return (
                        <tr key={p.agentId}>
                          <td><button type="button" className="wa-link" onClick={() => setPerson(p.agentId)}>{p.name}</button>{p.manager && <> <Pill tone="info">Money manager</Pill></>}<span className="crm-cell-sub" style={{ display: 'block' }}>{p.agentId}</span></td>
                          <td className="wb-num">{rs(got)}{(p.balance.received ?? 0) > 0 && <span className="crm-cell-sub" style={{ display: 'block' }}>{rs(p.balance.received)} as funds</span>}</td>
                          <td className="wb-num">{p.balance.handedOut ? rs(p.balance.handedOut) : <span className="crm-sub">—</span>}</td>
                          <td className="wb-num">{rs(p.balance.returned)}</td>
                          <td className="wb-num">{rs(p.balance.spent)}</td>
                          <td className="wb-num">{p.balance.pending ? rs(p.balance.pending) : <span className="crm-sub">—</span>}</td>
                          <td><BalanceText b={p.balance} /></td>
                          {editable && <td><span className="sp-actions" style={{ justifyContent: 'flex-end' }}>
                            {p.balance.net < 0 && <button type="button" className="crm-btn is-sm" onClick={() => setMove({ agentId: p.agentId, kind: 'given', amount: p.balance.owed })}>Settle {rs(p.balance.owed)}</button>}
                            {p.balance.net > 0 && !p.manager && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setMove({ agentId: p.agentId, kind: 'returned', amount: p.balance.holds })}><Undo2 size={14} aria-hidden /> Took back {rs(p.balance.holds)}</button>}
                            {p.agentId !== data.me.agentId && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setMove({ agentId: p.agentId, kind: 'given' })}>Give money</button>}
                          </span></td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <h2 className="crm-h2 ms-h">Entries <span className="crm-sub">· {dayText(data.from)} to {dayText(data.to)} · {rs(entriesSum)} shown</span></h2>
          <section className="crm-card">
            <div className="ms-filters">
              <div className="crm-chips" role="group" aria-label="Constant or variable">
                <button type="button" className="crm-chip" aria-pressed={!nature} onClick={() => setNature('')}>All</button>
                <button type="button" className="crm-chip" aria-pressed={nature === 'constant'} onClick={() => { setNature('constant'); setCat(''); }}><i className="ms-dot" style={{ background: NATURE.constant.color }} aria-hidden />Constant</button>
                <button type="button" className="crm-chip" aria-pressed={nature === 'variable'} onClick={() => { setNature('variable'); setCat(''); }}><i className="ms-dot" style={{ background: NATURE.variable.color }} aria-hidden />Variable</button>
              </div>
              <label className="crm-sr" htmlFor="ms-kind">Kind</label>
              <select id="ms-kind" className="crm-input ms-sel" value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="">Every kind</option>
                {cats.filter((c) => !nature || c.nature === nature).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              {data.projects.length > 0 && <>
                <label className="crm-sr" htmlFor="ms-proj">Project</label>
                <select id="ms-proj" className="crm-input ms-sel" value={proj} onChange={(e) => setProj(e.target.value)}>
                  <option value="">Every project</option><option value="-">Not in a project</option>
                  {(projectsUsed.length ? projectsUsed : data.projects).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </>}
              {(cat || nature || proj) && <button type="button" className="wa-link" onClick={() => { setCat(''); setNature(''); setProj(''); }}>Clear</button>}
            </div>
            {entries.length === 0 ? <Empty title="No entries here" /> : (
              <div className="crm-table-wrap">
                <table className="crm-table">
                  <thead><tr><th scope="col">Day</th><th scope="col">Kind</th><th scope="col">For</th><th scope="col">Paid by</th><th scope="col" className="wb-num">Amount</th><th scope="col">Bill</th>{editable && <th scope="col"><span className="crm-sr">Actions</span></th>}</tr></thead>
                  <tbody>
                    {entries.map((e) => {
                      const k = kindOf[e.category];
                      const pj = e.projectId ? projName[e.projectId] : undefined;
                      return (
                        <tr key={e.id} className={e.status === 'rejected' ? 'ms-rejected' : undefined}>
                          <td style={{ whiteSpace: 'nowrap' }}>{dayText(e.spentOn)}</td>
                          <td><span className="ms-cat-name"><i style={{ background: k?.color ?? COLOR[e.category] ?? '#6b7280' }} aria-hidden />{k?.label ?? e.category}</span><span className="crm-cell-sub" style={{ display: 'block' }}>{k ? NATURE[k.nature].label : ''}</span></td>
                          <td>{e.salaryMonth ? `Salary · ${monthText(e.salaryMonth)}${e.note ? ` · ${e.note}` : ''}` : e.note || <span className="crm-sub">—</span>}
                            {pj && <span className="crm-cell-sub" style={{ display: 'block' }}><button type="button" className="wa-link" onClick={() => setProject(pj.id)}><i className="ms-dot" style={{ background: pj.color }} aria-hidden />{pj.name}</button></span>}
                            {e.forAgentId && (e.paidBy === 'office') && <span className="crm-cell-sub" style={{ display: 'block' }}>for <button type="button" className="wa-link" onClick={() => setMember(e.forAgentId!)}>{e.forAgentName}</button></span>}
                            {e.status === 'rejected' && <span className="crm-cell-sub" style={{ display: 'block' }}>Not approved: {e.rejectReason}</span>}</td>
                          <td>{e.paidBy === 'person' ? <button type="button" className="wa-link" onClick={() => setPerson(e.agentId!)}>{e.agentName}</button> : 'Organisation'}<span className="crm-cell-sub" style={{ display: 'block' }}>entered by {e.createdByName}</span></td>
                          <td className="wb-num">{e.status === 'rejected' ? <s>{rs(e.amount)}</s> : <strong>{rs(e.amount)}</strong>}</td>
                          <td>{e.hasBill ? <button type="button" className="wa-link" onClick={() => setBill(e)}>See bill</button> : <span className="crm-sub">—</span>}</td>
                          {editable && <td><span className="sp-actions" style={{ justifyContent: 'flex-end' }}>
                            <button type="button" className="crm-btn is-secondary is-sm" aria-label={`Change ${rs(e.amount)} ${label[e.category] ?? ''}`} onClick={() => setForm({ edit: e })}><Pencil size={14} aria-hidden /></button>
                            <button type="button" className="crm-btn is-secondary is-sm" aria-label={`Take out ${rs(e.amount)} ${label[e.category] ?? ''}`} disabled={busyId === e.id} onClick={() => void remove(e)}><Trash2 size={14} aria-hidden /></button>
                          </span></td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {tab === 'analytics' && <Analytics data={data} go={(t) => setTab(t as Tab)} openProject={setProject} openPerson={setMember} />}
      {tab === 'projects' && <ProjectsTab data={data} canHandle={editable} onOpen={setProject} onAddExpense={(id) => setForm({ projectId: id })} onAddFund={(id) => setFund({ projectId: id })} toast={showToast} refreshKey={teamKey} />}
      {tab === 'constant' && <ConstantTab data={data} canHandle={editable} toast={showToast} onChanged={() => void load()} refreshKey={teamKey} />}
      {tab === 'team' && <PayrollTab key={teamKey} editable={editable} modes={data.modes} onOpen={setMember} toast={showToast} onChanged={() => void load()} />}
      {tab === 'setup' && <SetupTab data={data} toast={showToast} onChanged={() => void load()} />}

      {member && <MemberView agentId={member} editable={editable} modes={data.modes} onClose={() => setMember(null)} toast={showToast} onChanged={() => { setTeamKey((k) => k + 1); void load(); }} onBill={setBill} />}
      {project && <ProjectView id={project} data={data} canHandle={editable} onClose={() => setProject(null)} onChanged={() => { setTeamKey((k) => k + 1); void load(); }}
        onAddExpense={(id) => { setProject(null); setForm({ projectId: id }); }} onAddFund={(id) => { setProject(null); setFund({ projectId: id }); }} toast={showToast} onBill={setBill} />}
      {form && <ExpenseForm data={data} edit={form.edit} day={form.day} projectId={form.projectId} onClose={() => setForm(null)} onSaved={done} />}
      {move && <MoveForm data={data} start={move} onClose={() => setMove(null)} onSaved={done} />}
      {fund && <FundForm data={data} projectId={fund.projectId} onClose={() => setFund(null)} onSaved={done} />}
      {reject && <RejectForm e={reject} label={label[reject.category] ?? reject.category} onClose={() => setReject(null)} onReject={(reason) => void decide(reject, false, reason)} />}
      {bill && <BillView e={bill} onClose={() => setBill(null)} />}
      {person && <PersonView agentId={person} label={label} editable={editable} onClose={() => setPerson(null)} onMove={(m) => { setPerson(null); setMove(m); }} onChanged={() => void load()} toast={showToast} />}
      {toast}
    </main>
  );
}

/** Add an expense, or correct one: day, amount, kind (constant or variable), project, what it was for, who paid. */
function ExpenseForm({ data, edit, day, projectId, onClose, onSaved }: { data: Data; edit?: Expense; day?: string; projectId?: string; onClose: () => void; onSaved: (m: string) => void }) {
  const open = data.categories.filter((k) => !k.archived || k.key === edit?.category);
  const [spentOn, setSpentOn] = useState(edit?.spentOn ?? day ?? data.today);
  const [category, setCategory] = useState(edit?.category ?? (open.find((k) => k.key === 'food') ?? open.find((k) => k.nature === 'variable') ?? open[0])?.key ?? 'other');
  const [amount, setAmount] = useState(edit ? String(edit.amount) : '');
  const [note, setNote] = useState(edit?.note ?? '');
  const [project, setProject] = useState(edit?.projectId ?? projectId ?? '');
  const [paidBy, setPaidBy] = useState<'office' | 'person'>(edit?.paidBy ?? (data.me.isManager && !data.me.canSetup ? 'person' : 'office'));
  const [agentId, setAgentId] = useState(edit?.agentId ?? (data.me.isManager && !data.me.canSetup ? data.me.agentId : ''));
  const [forId, setForId] = useState(edit?.paidBy === 'office' ? edit.forAgentId ?? '' : '');
  const isSalary = !!edit?.salaryMonth;
  const isConstantPay = !!edit?.recurringId;
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fromAgent = !!edit?.fromApp;
  const k = open.find((x) => x.key === category);

  const save = async () => {
    const n = money(amount);
    if (n == null) { setErr('Write the amount in rupees.'); return; }
    if (paidBy === 'person' && !agentId) { setErr('Pick the person who paid.'); return; }
    setBusy(true); setErr(null);
    try {
      const body = {
        spentOn, category, amount: n, note, paidBy, agentId: paidBy === 'person' ? agentId : null, forAgentId: paidBy === 'office' ? forId || null : null,
        projectId: project || (edit?.projectId ? '00000000-0000-0000-0000-000000000000' : null),
      };
      const saved = edit ? await crm.put<Expense>(`/api/v1/spend/${edit.id}`, body) : await crm.post<Expense>('/api/v1/spend', body);
      if (file) { const f = new FormData(); f.append('file', file); await crm.upload(`/api/v1/spend/${saved.id}/bill`, f); }
      onSaved(edit ? 'Saved.' : `Added ${rs(n)} for ${dayText(spentOn)}.`);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  const chips = (nat: 'constant' | 'variable') => {
    const list = open.filter((x) => x.nature === nat && x.key !== 'agents');
    if (!list.length) return null;
    return (
      <div className="ms-kindgroup">
        <span className="ms-kindgroup-l"><i style={{ background: NATURE[nat].color }} aria-hidden />{NATURE[nat].label}</span>
        <div className="crm-chips">{list.map((c) => <button key={c.key} type="button" className="crm-chip" aria-pressed={category === c.key} onClick={() => setCategory(c.key)}><i className="ms-dot" style={{ background: c.color }} aria-hidden />{c.label}</button>)}</div>
      </div>
    );
  };

  return (
    <Modal title={edit ? 'Correct expense' : 'Add expense'} onClose={onClose} actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="crm-btn" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : edit ? 'Save' : 'Add expense'}</button>
    </>}>
      <div className="ms-form">
        <div className="ms-two">
          <label className="crm-field">Day<input className="crm-input" type="date" value={spentOn} max={data.today} onChange={(e) => setSpentOn(e.target.value)} /></label>
          <label className="crm-field">Amount (₹)<input className="crm-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="e.g. 450" /></label>
        </div>
        {isSalary ? <p className="crm-sub" style={{ margin: 0 }}>Salary payment to {edit!.forAgentName} for {monthText(edit!.salaryMonth)}.</p>
          : isConstantPay ? <p className="crm-sub" style={{ margin: 0 }}>A constant payment ({data.categories.find((x) => x.key === edit!.category)?.label ?? edit!.category}). Change the payment itself in Constant payments.</p> : (
          <fieldset className="ms-set"><legend>Kind</legend>
            {chips('variable')}
            {chips('constant')}
            <p className="crm-sub" style={{ margin: '6px 0 0' }}>{k ? `${k.label} is a ${k.nature} cost.` : ''} Need another kind? Add it in Setup. A cost due every month is easier as a constant payment.</p>
          </fieldset>
        )}
        {data.projects.some((p) => p.status === 'active' || p.id === project) && (
          <label className="crm-field">Project (optional)
            <select className="crm-input" value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">Not in a project</option>
              {data.projects.filter((p) => p.status === 'active' || p.id === project).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        <label className="crm-field">What it was for (optional)<input className="crm-input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={category === 'petrol' ? 'e.g. bike to Amour and back' : 'A few words'} /></label>
        {isSalary ? null : fromAgent ? <p className="crm-sub" style={{ margin: 0 }}>Paid by {edit!.agentName} (sent from the app).</p> : (
          <fieldset className="ms-set"><legend>Who paid</legend>
            <div className="crm-chips">
              <button type="button" className="crm-chip" aria-pressed={paidBy === 'office'} onClick={() => setPaidBy('office')}>The organisation, directly</button>
              <button type="button" className="crm-chip" aria-pressed={paidBy === 'person'} onClick={() => setPaidBy('person')}>A person (from money they hold, or their pocket)</button>
            </div>
            {paidBy === 'person' && (
              <label className="crm-field" style={{ marginTop: 10 }}>Person
                <select className="crm-input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                  <option value="">Pick a person</option>
                  {data.staff.map((s) => <option key={s.agentId} value={s.agentId}>{s.name}{data.managers.includes(s.agentId) ? ' (money manager)' : ''} · {s.agentId}</option>)}
                </select>
              </label>
            )}
            {paidBy === 'office' && (
              <label className="crm-field" style={{ marginTop: 10 }}>Spent on (optional)
                <select className="crm-input" value={forId} onChange={(e) => setForId(e.target.value)}>
                  <option value="">Nobody in particular</option>
                  {data.staff.map((s) => <option key={s.agentId} value={s.agentId}>{s.name} · {s.agentId}</option>)}
                </select>
              </label>
            )}
            <p className="crm-sub" style={{ margin: '8px 0 0' }}>{paidBy === 'person' ? 'It comes off the money they hold; if they hold none, we owe it to them.' : 'It counts in the spend and in nobody’s balance. Pick a person to see it under their name, e.g. their petrol or stay.'}</p>
          </fieldset>
        )}
        <label className="crm-field">Photo of the bill (optional){edit?.hasBill ? ' · replaces the one already there' : ''}
          <input className="crm-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        {err && <p className="ms-err" role="alert">{err}</p>}
      </div>
    </Modal>
  );

}

/** Money handed to a person (an advance, or settling what we owe them) or handed back by them; from the organisation or a money manager's funds. */
function MoveForm({ data, start, onClose, onSaved }: { data: Data; start: { agentId?: string; kind?: 'given' | 'returned'; amount?: number }; onClose: () => void; onSaved: (m: string) => void }) {
  const managerOnly = data.me.isManager && !data.me.canSetup;
  const [agentId, setAgentId] = useState(start.agentId ?? '');
  const [kind, setKind] = useState<'given' | 'returned'>(start.kind ?? 'given');
  const [amount, setAmount] = useState(start.amount ? String(start.amount) : '');
  const [on, setOn] = useState(data.today);
  const [mode, setMode] = useState('cash');
  const [note, setNote] = useState('');
  const [fromWho, setFromWho] = useState(managerOnly ? data.me.agentId : data.me.isManager ? data.me.agentId : 'org');
  const [project, setProject] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const who = data.people.find((p) => p.agentId === agentId);
  const name = data.staff.find((s) => s.agentId === agentId)?.name ?? who?.name ?? '';
  const managers = data.people.filter((p) => p.manager);
  const mgr = managers.find((m) => m.agentId === fromWho);
  const n = Number(amount);
  const after = who && Number.isFinite(n) && n > 0 ? who.balance.net + (kind === 'given' ? n : -n) : null;

  const save = async () => {
    if (!agentId) { setErr('Pick the person.'); return; }
    const v = money(amount);
    if (v == null) { setErr('Write the amount in rupees.'); return; }
    setBusy(true); setErr(null);
    try {
      await crm.post('/api/v1/spend/moves', { agentId, kind, amount: v, on, mode, note, from: fromWho, projectId: project || null });
      onSaved(kind === 'given' ? `${rs(v)} given to ${name}${mgr ? ` from ${mgr.name}'s funds` : ''}. They are told.` : `${rs(v)} taken back from ${name}${mgr ? ` to ${mgr.name}` : ''}.`);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  return (
    <Modal title={kind === 'given' ? 'Give money to a person' : 'Money taken back from a person'} onClose={onClose} actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="crm-btn" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
    </>}>
      <div className="ms-form">
        <div className="crm-chips" role="group" aria-label="Which way the money went">
          <button type="button" className="crm-chip" aria-pressed={kind === 'given'} onClick={() => setKind('given')}>We gave them money</button>
          <button type="button" className="crm-chip" aria-pressed={kind === 'returned'} onClick={() => setKind('returned')}>They gave money back</button>
        </div>
        <label className="crm-field">Person
          <select className="crm-input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">Pick a person</option>
            {data.staff.filter((s) => s.agentId !== fromWho).map((s) => <option key={s.agentId} value={s.agentId}>{s.name} · {s.agentId}</option>)}
          </select>
        </label>
        {who && <p className="crm-sub" style={{ margin: 0 }}>Now: {who.balance.net > 0 ? `holds ${rs(who.balance.holds)}` : who.balance.net < 0 ? `we owe ${rs(who.balance.owed)}` : 'settled'}{after !== null ? ` → after this: ${after > 0 ? `holds ${rs(after)}` : after < 0 ? `we owe ${rs(-after)}` : 'settled'}` : ''}</p>}
        {managerOnly ? (
          <p className="crm-sub" style={{ margin: 0 }}>{kind === 'given' ? 'From the money you hold' : 'Back to you'}{mgr ? `: you hold ${rs(Math.max(0, mgr.balance.net))} now.` : '.'}</p>
        ) : managers.length > 0 && (
          <label className="crm-field">{kind === 'given' ? 'Whose money' : 'Given back to'}
            <select className="crm-input" value={fromWho} onChange={(e) => setFromWho(e.target.value)}>
              <option value="org">The organisation</option>
              {managers.map((m) => <option key={m.agentId} value={m.agentId}>{m.name} (holds {rs(Math.max(0, m.balance.net))})</option>)}
            </select>
          </label>
        )}
        {mgr && kind === 'given' && Number.isFinite(n) && n > mgr.balance.net && <p className="ms-warn" role="status">{mgr.name} holds only {rs(Math.max(0, mgr.balance.net))}. Record the funds they received first, or the difference shows as owed to them.</p>}
        <div className="ms-two">
          <label className="crm-field">Amount (₹)<input className="crm-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="e.g. 2000" /></label>
          <label className="crm-field">Day<input className="crm-input" type="date" value={on} max={data.today} onChange={(e) => setOn(e.target.value)} /></label>
        </div>
        {data.projects.some((p) => p.status === 'active') && (
          <label className="crm-field">For the project (optional)
            <select className="crm-input" value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">No particular project</option>
              {data.projects.filter((p) => p.status === 'active').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        <fieldset className="ms-set"><legend>How</legend>
          <div className="crm-chips">{data.modes.map((m) => <button key={m} type="button" className="crm-chip" aria-pressed={mode === m} onClick={() => setMode(m)}>{MODE[m] ?? m}</button>)}</div>
        </fieldset>
        <label className="crm-field">Note (optional)<input className="crm-input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'given' ? 'e.g. advance for the Amour camp week' : 'e.g. unspent advance'} /></label>
        {err && <p className="ms-err" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

function RejectForm({ e, label, onClose, onReject }: { e: Expense; label: string; onClose: () => void; onReject: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title="Why not?" onClose={onClose} actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="crm-btn" disabled={!reason.trim()} onClick={() => onReject(reason.trim())}>Reject</button>
    </>}>
      <p className="crm-sub" style={{ margin: 0 }}>{rs(e.amount)} · {label} · {e.agentName} · {dayText(e.spentOn, true)}</p>
      <label className="crm-field">Reason (they see this in the app)<input className="crm-input" value={reason} maxLength={300} onChange={(ev) => setReason(ev.target.value)} placeholder="e.g. No bill, or already paid by the office" /></label>
    </Modal>
  );
}

function BillView({ e, onClose }: { e: Expense; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let made: string | null = null, live = true;
    crm.blob(`/api/v1/spend/${e.id}/bill`).then((b) => { if (!live) return; made = URL.createObjectURL(b); setUrl(made); }).catch(() => { if (live) setErr('The bill photo could not be opened.'); });
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [e.id]);
  return (
    <Modal title={`Bill · ${rs(e.amount)}`} onClose={onClose} wide>
      {err ? <p className="ms-err" role="alert">{err}</p> : !url ? <Skeleton h={320} /> : (
        // eslint-disable-next-line @next/next/no-img-element -- a private photo read through the API as a blob
        <img src={url} alt={`Bill for ${rs(e.amount)}${e.agentName ? ` from ${e.agentName}` : ''}`} className="ms-bill" />
      )}
    </Modal>
  );
}

/** One person's account: funds they received, money given to them or by them, money returned, and every expense of theirs. */
function PersonView({ agentId, label, editable, onClose, onMove, onChanged, toast }: {
  agentId: string; label: Record<string, string>; editable: boolean; onClose: () => void;
  onMove: (m: { agentId: string; kind: 'given' | 'returned'; amount?: number }) => void; onChanged: () => void; toast: (m: string) => void;
}) {
  const [d, setD] = useState<PersonDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { try { setD(await crm.get<PersonDetail>(`/api/v1/spend/people/${encodeURIComponent(agentId)}`)); } catch (e) { setErr(friendlyError(e)); } }, [agentId]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  const removeMove = async (m: Move) => {
    if (!window.confirm(`Take this ${rs(m.amount)} entry out of the balances? It is kept in the records, not deleted.`)) return;
    try { await crm.post(`/api/v1/spend/moves/${m.id}/remove`); toast('Taken out of the balance.'); await load(); onChanged(); } catch (e) { toast(errText(e)); }
  };
  type Line = { key: string; day: string; text: string; sub?: string; amount: number; sign: 1 | -1 | 0; move?: Move };
  const lines: Line[] = d ? [
    ...(d.funds ?? []).map((f): Line => ({ key: `f${f.id}`, day: f.on, text: `Funds received from ${f.source}`, sub: [f.mode ? MODE[f.mode] : null, f.note].filter(Boolean).join(' · '), amount: f.amount, sign: 1 })),
    ...d.moves.map((m): Line => {
      const mine = m.agentId === agentId;
      return mine
        ? { key: `m${m.id}`, day: m.on, text: m.kind === 'given' ? `Money given${m.fromAgentName ? ` by ${m.fromAgentName}` : ''}` : `Money returned${m.fromAgentName ? ` to ${m.fromAgentName}` : ''}`, sub: [m.mode ? MODE[m.mode] : null, m.note, `by ${m.createdByName}`].filter(Boolean).join(' · '), amount: m.amount, sign: m.kind === 'given' ? 1 : -1, move: m }
        : { key: `m${m.id}`, day: m.on, text: m.kind === 'given' ? `Handed to ${m.agentName}` : `${m.agentName} gave back`, sub: [m.mode ? MODE[m.mode] : null, m.note].filter(Boolean).join(' · '), amount: m.amount, sign: m.kind === 'given' ? -1 : 1, move: m };
    }),
    ...d.expenses.map((e): Line => ({ key: `e${e.id}`, day: e.spentOn, text: `Spent · ${label[e.category] ?? e.category}`, sub: [e.note, e.status === 'pending' ? 'waiting for approval' : e.status === 'rejected' ? `not approved: ${e.rejectReason ?? ''}` : null].filter(Boolean).join(' · '), amount: e.amount, sign: e.status === 'approved' ? -1 : 0 })),
  ].sort((a, b) => b.day.localeCompare(a.day)) : [];

  return (
    <Modal title={d ? `${d.name}${d.manager ? ' · money manager' : ''}` : 'Account'} onClose={onClose} wide actions={d && editable ? <>
      {d.settle?.kind === 'given' && <button type="button" className="crm-btn" onClick={() => onMove({ agentId, kind: 'given', amount: d.settle!.amount })}>Settle {rs(d.settle.amount)}</button>}
      {d.settle?.kind === 'returned' && !d.manager && <button type="button" className="crm-btn is-secondary" onClick={() => onMove({ agentId, kind: 'returned', amount: d.settle!.amount })}>Took back {rs(d.settle.amount)}</button>}
      <button type="button" className="crm-btn is-secondary" onClick={() => onMove({ agentId, kind: 'given' })}>Give money</button>
    </> : undefined}>
      {err ? <ErrorBox message={err} /> : !d ? <Skeleton h={300} /> : (
        <>
          <div className="ms-acct">
            {(d.balance.received ?? 0) > 0 && <div><span className="crm-sub">Funds received</span><strong>{rs(d.balance.received)}</strong></div>}
            <div><span className="crm-sub">Given to them</span><strong>{rs(d.balance.given)}</strong></div>
            {(d.balance.handedOut ?? 0) > 0 && <div><span className="crm-sub">Handed to the team</span><strong>{rs((d.balance.handedOut ?? 0) - (d.balance.handedBack ?? 0))}</strong></div>}
            <div><span className="crm-sub">Returned</span><strong>{rs(d.balance.returned)}</strong></div>
            <div><span className="crm-sub">Spent (approved)</span><strong>{rs(d.balance.spent)}</strong></div>
            <div><span className="crm-sub">Balance</span><BalanceText b={d.balance} /></div>
          </div>
          {d.balance.pending > 0 && <p className="crm-sub" style={{ margin: 0 }}>{rs(d.balance.pending)} more is waiting for approval and not counted yet.</p>}
          {lines.length === 0 ? <Empty title="Nothing yet" /> : (
            <div className="crm-table-wrap">
              <table className="crm-table">
                <thead><tr><th scope="col">Day</th><th scope="col">What</th><th scope="col" className="wb-num">Amount</th>{editable && <th scope="col"><span className="crm-sr">Actions</span></th>}</tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.key}>
                      <td style={{ whiteSpace: 'nowrap' }}>{dayText(l.day)}</td>
                      <td>{l.text}{l.sub && <span className="crm-cell-sub" style={{ display: 'block' }}>{l.sub}</span>}</td>
                      <td className="wb-num">{l.sign === 0 ? <span className="crm-sub">{rs(l.amount)}</span> : <strong>{l.sign > 0 ? '+' : '−'}{rs(l.amount)}</strong>}</td>
                      {editable && <td className="wb-num">{l.move && <button type="button" className="wa-link" onClick={() => void removeMove(l.move!)}>Entered by mistake</button>}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

/** One team member in full: salary over time, every month, every payment, and what else was spent on them. */
function MemberView({ agentId, editable, modes, onClose, toast, onChanged, onBill }: { agentId: string; editable: boolean; modes: string[]; onClose: () => void; toast: (m: string) => void; onChanged: () => void; onBill: (e: Expense) => void }) {
  const [d, setD] = useState<Member | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pay, setPay] = useState<{ month: string; due: number; paid: number } | null>(null);
  const [change, setChange] = useState(false);
  const load = useCallback(async () => { try { setD(await crm.get<Member>(`/api/v1/spend/team/${encodeURIComponent(agentId)}`)); } catch (e) { setErr(friendlyError(e)); } }, [agentId]);
  useEffect(() => { const x = setTimeout(() => void load(), 0); return () => clearTimeout(x); }, [load]);
  const today = new Date(); const todayIso = iso(today); const thisMonth = todayIso.slice(0, 7);
  const done = (m: string) => { toast(m); setPay(null); setChange(false); void load(); onChanged(); };
  const takeOut = async (e: Expense) => {
    if (!window.confirm(`Take this ${rs(e.amount)} payment out? It is kept in the records, not deleted.`)) return;
    try { await crm.post(`/api/v1/spend/${e.id}/remove`); done('Taken out.'); } catch (x) { toast(errText(x)); }
  };
  const off = async () => {
    if (!d || !window.confirm(`Take ${d.name} off the payroll after ${monthText(thisMonth)}? Their record and payments are kept.`)) return;
    try { await crm.post(`/api/v1/spend/team/${encodeURIComponent(agentId)}/off`, { lastMonth: thisMonth }); done(`${d.name} is off the payroll after ${monthText(thisMonth)}.`); } catch (x) { toast(errText(x)); }
  };
  const lab = Object.fromEntries((d?.categories ?? []).map((c) => [c.key, c.label])) as Record<string, string>;

  if (pay && d) return <PayForm agentId={agentId} name={d.name} month={pay.month} due={pay.due} paid={pay.paid} today={todayIso} modes={modes} onClose={() => setPay(null)} onSaved={done} />;
  if (change && d) return <MemberForm fixed={{ agentId, name: d.name }} salary={d.salary || undefined} thisMonth={thisMonth} onClose={() => setChange(false)} onSaved={done} />;

  return (
    <Modal title={d?.name ?? 'Person'} onClose={onClose} wide actions={d && editable ? <>
      {d.onPayroll && <button type="button" className="crm-btn is-secondary" onClick={() => void off()}>Take off the payroll</button>}
      <button type="button" className="crm-btn is-secondary" onClick={() => setChange(true)}>{d.onPayroll ? 'Change salary' : d.onTeam ? 'Put back on the payroll' : 'Add to the team'}</button>
      {d.onTeam && <button type="button" className="crm-btn" onClick={() => { const m = d.months.find((x) => x.left > 0) ?? d.months[0]; setPay(m ? { month: m.month, due: m.due, paid: m.paid } : { month: thisMonth, due: d.salary, paid: 0 }); }}><Wallet size={15} aria-hidden /> Pay salary</button>}
    </> : undefined}>
      {err ? <ErrorBox message={err} /> : !d ? <Skeleton h={320} /> : (
        <>
          <p className="crm-sub" style={{ margin: 0 }}>{d.agentId}{d.block ? ` · ${d.block}` : ''}{d.onTeam ? (d.onPayroll ? ` · on the payroll since ${monthText(d.fromMonth)}` : ` · off the payroll after ${monthText(d.toMonth)}`) : ' · not on the marketing payroll'}{d.note ? ` · ${d.note}` : ''}</p>
          <div className="ms-acct">
            <div><span className="crm-sub">Salary now</span><strong>{d.salary ? `${rs(d.salary)} a month` : '—'}</strong></div>
            <div><span className="crm-sub">Salary paid, all time</span><strong>{rs(d.totalPaid)}</strong></div>
            <div><span className="crm-sub">Salary still to pay</span><strong>{rs(d.totalLeft)}</strong></div>
            <div><span className="crm-sub">Other costs, all time</span><strong>{rs(d.otherTotal)}</strong></div>
          </div>
          {d.rates.length > 1 && <p className="crm-sub" style={{ margin: 0 }}>Salary over time: {d.rates.map((r) => `${rs(r.amount)} from ${monthText(r.fromMonth)}`).join(' · ')}</p>}

          {d.onTeam && (
            <>
              <h3 className="ms-h3">Month by month</h3>
              <div className="crm-table-wrap">
                <table className="crm-table">
                  <thead><tr><th scope="col">Month</th><th scope="col" className="wb-num">Salary</th><th scope="col" className="wb-num">Paid</th><th scope="col" className="wb-num">Left</th><th scope="col">Status</th>{editable && <th scope="col"><span className="crm-sr">Pay</span></th>}</tr></thead>
                  <tbody>
                    {d.months.map((m) => (
                      <tr key={m.month}>
                        <td style={{ whiteSpace: 'nowrap' }}>{monthText(m.month)}</td>
                        <td className="wb-num">{rs(m.due)}</td><td className="wb-num">{rs(m.paid)}</td>
                        <td className="wb-num">{m.left ? <strong>{rs(m.left)}</strong> : <span className="crm-sub">—</span>}</td>
                        <td><Pill tone={PAY[m.status].tone}>{PAY[m.status].label}</Pill></td>
                        {editable && <td className="wb-num">{m.left > 0 && <button type="button" className="wa-link" style={{ whiteSpace: 'nowrap' }} onClick={() => setPay({ month: m.month, due: m.due, paid: m.paid })}>Pay {rs(m.left)}</button>}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3 className="ms-h3">Salary payments · {d.payments.length}</h3>
              {d.payments.length === 0 ? <p className="crm-sub" style={{ margin: 0 }}>No payment recorded yet.</p> : (
                <div className="crm-table-wrap">
                  <table className="crm-table">
                    <thead><tr><th scope="col">Paid on</th><th scope="col">For</th><th scope="col">How</th><th scope="col" className="wb-num">Amount</th>{editable && <th scope="col"><span className="crm-sr">Actions</span></th>}</tr></thead>
                    <tbody>
                      {d.payments.map((e) => (
                        <tr key={e.id}>
                          <td style={{ whiteSpace: 'nowrap' }}>{dayText(e.spentOn, true)}</td>
                          <td>{monthText(e.salaryMonth)}{e.note && <span className="crm-cell-sub" style={{ display: 'block' }}>{e.note}</span>}</td>
                          <td>{e.payMode ? MODE[e.payMode] ?? e.payMode : <span className="crm-sub">—</span>}<span className="crm-cell-sub" style={{ display: 'block' }}>by {e.createdByName}</span></td>
                          <td className="wb-num"><strong>{rs(e.amount)}</strong></td>
                          {editable && <td className="wb-num"><button type="button" className="wa-link" style={{ whiteSpace: 'nowrap' }} onClick={() => void takeOut(e)}>Entered by mistake</button></td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          <h3 className="ms-h3">Other costs on them · {rs(d.otherTotal)}</h3>
          {d.other.length === 0 ? <p className="crm-sub" style={{ margin: 0 }}>Nothing yet. Their petrol, food, stay and the like show here when an expense is tagged to them.</p> : (
            <>
              <div className="crm-chips">{Object.entries(d.otherByCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => <span key={k} className="ms-cat-name ms-costchip"><i style={{ background: COLOR[k] }} aria-hidden />{lab[k] ?? k} {rs(v)}</span>)}</div>
              <div className="crm-table-wrap">
                <table className="crm-table">
                  <thead><tr><th scope="col">Day</th><th scope="col">Kind</th><th scope="col">For</th><th scope="col">Paid by</th><th scope="col" className="wb-num">Amount</th><th scope="col">Bill</th></tr></thead>
                  <tbody>
                    {d.other.map((e) => (
                      <tr key={e.id} className={e.status === 'rejected' ? 'ms-rejected' : undefined}>
                        <td style={{ whiteSpace: 'nowrap' }}>{dayText(e.spentOn)}</td>
                        <td><span className="ms-cat-name"><i style={{ background: COLOR[e.category] }} aria-hidden />{lab[e.category] ?? e.category}</span></td>
                        <td>{e.note || <span className="crm-sub">—</span>}{e.status !== 'approved' && <span className="crm-cell-sub" style={{ display: 'block' }}>{e.status === 'pending' ? 'waiting for approval' : `not approved: ${e.rejectReason ?? ''}`}</span>}</td>
                        <td>{e.paidBy === 'person' ? 'Themselves' : 'Organisation'}</td>
                        <td className="wb-num">{e.status === 'approved' ? <strong>{rs(e.amount)}</strong> : <span className="crm-sub">{rs(e.amount)}</span>}</td>
                        <td>{e.hasBill ? <button type="button" className="wa-link" onClick={() => onBill(e)}>See bill</button> : <span className="crm-sub">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
