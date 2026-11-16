'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, HandCoins, Pencil, Plus, Receipt, Trash2, Undo2, X } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { canEdit, useAccess } from '@/lib/crm/access';
import { Empty, ErrorBox, friendlyError, Modal, PageHead, Pill, Skeleton, useToast } from '@/components/crm/ui';

interface Balance { given: number; returned: number; spent: number; pending: number; net: number; holds: number; owed: number }
interface Expense {
  id: string; spentOn: string; category: string; amount: number; note?: string | null; paidBy: 'office' | 'person';
  agentId?: string | null; agentName?: string | null; status: 'pending' | 'approved' | 'rejected'; rejectReason?: string | null;
  hasBill: boolean; fromApp?: boolean; createdByName: string; createdAt: string;
}
interface Move { id: string; agentId: string; agentName: string; kind: 'given' | 'returned'; amount: number; on: string; mode?: string | null; note?: string | null; createdByName: string }
interface Person { agentId: string; name: string; role?: string | null; balance: Balance }
interface Staff { agentId: string; name: string; role: string; block?: string | null }
interface Data {
  from: string; to: string; today: string; categories: { key: string; label: string }[]; modes: string[];
  total: number; byCategory: Record<string, number>; days: { date: string; total: number; byCategory: Record<string, number> }[];
  items: Expense[]; waiting: Expense[]; people: Person[]; held: number; owed: number; staff: Staff[];
}
interface PersonDetail { agentId: string; name: string; balance: Balance; settle: { kind: 'given' | 'returned'; amount: number } | null; moves: Move[]; expenses: Expense[] }

const whole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const paise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Rupees, with paise only when there are any. */
const rs = (n?: number | null) => { const v = Math.round((n ?? 0) * 100) / 100; return Number.isInteger(v) ? whole.format(v) : paise.format(v); };
const dayText = (d: string, long = false) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', long ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const MODE: Record<string, string> = { cash: 'Cash', upi: 'UPI', bank: 'Bank transfer' };
/** One colour per kind of spend, the same everywhere on the page. */
const COLOR: Record<string, string> = { agents: '#0a72d6', food: '#d9822b', petrol: '#7b3fe4', banner: '#0f8a5f', digital: '#c2185b', rent: '#0e7490', other: '#6b7280' };

const errText = (e: unknown) => {
  const m = e instanceof Error ? e.message : '';
  const i = m.indexOf(': {');
  if (i >= 0) { try { return (JSON.parse(m.slice(i + 2)) as { message?: string }).message ?? friendlyError(e); } catch { /* fall through */ } }
  return friendlyError(e);
};

/** What a person's balance means, in words. */
function BalanceText({ b }: { b: Balance }) {
  if (b.net > 0) return <Pill tone="warn">Holds {rs(b.holds)}</Pill>;
  if (b.net < 0) return <Pill tone="bad">We owe {rs(b.owed)}</Pill>;
  return <Pill tone="ok">Settled</Pill>;
}

type Tab = 'work' | 'analytics';
type Range = 'today' | 'week' | 'month' | 'last30' | 'custom';

/**
 * Marketing spend: what was spent each day and on what (agents' pay, food, petrol, banners, online ads, room rent…),
 * expenses agents sent from the app for approval, and who holds the organisation's money or is owed by it.
 */
export default function SpendPage() {
  const { access } = useAccess();
  const editable = canEdit(access, 'payments');
  const [range, setRange] = useState<Range>('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('work');
  const [cat, setCat] = useState('');
  const [toast, showToast] = useToast();
  const [form, setForm] = useState<{ edit?: Expense; day?: string } | null>(null);
  const [move, setMove] = useState<{ agentId?: string; kind?: 'given' | 'returned'; amount?: number } | null>(null);
  const [reject, setReject] = useState<Expense | null>(null);
  const [bill, setBill] = useState<Expense | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const span = useMemo(() => {
    const now = new Date();
    if (range === 'today') return { f: iso(now), t: iso(now) };
    if (range === 'week') { const s = new Date(now); s.setDate(s.getDate() - 6); return { f: iso(s), t: iso(now) }; }
    if (range === 'month') return { f: iso(new Date(now.getFullYear(), now.getMonth(), 1)), t: iso(now) };
    if (range === 'last30') { const s = new Date(now); s.setDate(s.getDate() - 29); return { f: iso(s), t: iso(now) }; }
    return { f: from, t: to };
  }, [range, from, to]);

  const load = useCallback(async () => {
    if (!span.f || !span.t) return;
    try { setData(await crm.get<Data>(`/api/v1/spend?from=${span.f}&to=${span.t}`)); setError(null); } catch (e) { setError(friendlyError(e)); }
  }, [span.f, span.t]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  const label = useMemo(() => Object.fromEntries((data?.categories ?? []).map((c) => [c.key, c.label])) as Record<string, string>, [data]);
  const done = (msg: string) => { showToast(msg); setForm(null); setMove(null); setReject(null); void load(); };

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

  const cats = data.categories;
  const entries = data.items.filter((e) => !cat || e.category === cat);
  const waitingSum = data.waiting.reduce((s, e) => s + e.amount, 0);
  const nDays = data.days.length;
  const top = Math.max(1, ...cats.map((c) => data.byCategory[c.key] ?? 0));

  return (
    <main className="crm-page">
      <PageHead title="Marketing spend" sub="What marketing costs each day: agents' pay, food, petrol, banners, online ads, room rent and the rest. Give a person money in advance, or let them add what they spent and settle it when the funds come.">
        {editable && <button type="button" className="crm-btn is-secondary" onClick={() => setMove({})}><HandCoins size={16} aria-hidden /> Give or take back money</button>}
        {editable && <button type="button" className="crm-btn" onClick={() => setForm({})}><Plus size={16} aria-hidden /> Add expense</button>}
      </PageHead>

      <div className="ms-range">
        <div className="crm-chips" role="group" aria-label="Days shown">
          {([['today', 'Today'], ['week', 'Last 7 days'], ['month', 'This month'], ['last30', 'Last 30 days'], ['custom', 'Pick dates']] as [Range, string][]).map(([k, l]) => (
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

      <div className="crm-tabs" role="tablist" aria-label="Marketing spend views">
        <button type="button" role="tab" className="crm-tab" aria-selected={tab === 'work'} onClick={() => setTab('work')}>Expenses and approvals{data.waiting.length ? <span className="an-count">{data.waiting.length}</span> : null}</button>
        <button type="button" role="tab" className="crm-tab" aria-selected={tab === 'analytics'} onClick={() => setTab('analytics')}>Analytics</button>
      </div>

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
                    <span className="crm-sub">{e.agentName} · {dayText(e.spentOn, true)}{e.note ? ` · ${e.note}` : ''}</span>
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
          <h2 className="crm-h2 ms-h">People and balances <span className="crm-sub">· {rs(data.held)} held by people · we owe {rs(data.owed)}</span></h2>
          <section className="crm-card">
            {data.people.length === 0 ? (
              <Empty title="Nobody holds money yet"><span className="crm-sub">Give a person an advance, or approve an expense they added: they appear here with their balance.</span>{editable && <button type="button" className="crm-btn is-sm" onClick={() => setMove({ kind: 'given' })}>Give money</button>}</Empty>
            ) : (
              <div className="crm-table-wrap">
                <table className="crm-table">
                  <thead><tr><th scope="col">Person</th><th scope="col" className="wb-num">Given</th><th scope="col" className="wb-num">Returned</th><th scope="col" className="wb-num">Spent</th><th scope="col" className="wb-num">Waiting</th><th scope="col">Balance</th>{editable && <th scope="col"><span className="crm-sr">Actions</span></th>}</tr></thead>
                  <tbody>
                    {data.people.map((p) => (
                      <tr key={p.agentId}>
                        <td><button type="button" className="wa-link" onClick={() => setPerson(p.agentId)}>{p.name}</button><span className="crm-cell-sub" style={{ display: 'block' }}>{p.agentId}</span></td>
                        <td className="wb-num">{rs(p.balance.given)}</td>
                        <td className="wb-num">{rs(p.balance.returned)}</td>
                        <td className="wb-num">{rs(p.balance.spent)}</td>
                        <td className="wb-num">{p.balance.pending ? rs(p.balance.pending) : <span className="crm-sub">—</span>}</td>
                        <td><BalanceText b={p.balance} /></td>
                        {editable && <td><span className="sp-actions" style={{ justifyContent: 'flex-end' }}>
                          {p.balance.net < 0 && <button type="button" className="crm-btn is-sm" onClick={() => setMove({ agentId: p.agentId, kind: 'given', amount: p.balance.owed })}>Settle {rs(p.balance.owed)}</button>}
                          {p.balance.net > 0 && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setMove({ agentId: p.agentId, kind: 'returned', amount: p.balance.holds })}><Undo2 size={14} aria-hidden /> Took back {rs(p.balance.holds)}</button>}
                          <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setMove({ agentId: p.agentId, kind: 'given' })}>Give money</button>
                        </span></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <h2 className="crm-h2 ms-h">Entries <span className="crm-sub">· {dayText(data.from)} to {dayText(data.to)}</span></h2>
          <section className="crm-card">
            <div className="crm-chips ms-filter" role="group" aria-label="Kind of spend">
              <button type="button" className="crm-chip" aria-pressed={!cat} onClick={() => setCat('')}>All kinds</button>
              {cats.map((c) => <button key={c.key} type="button" className="crm-chip" aria-pressed={cat === c.key} onClick={() => setCat(c.key)}>{c.label}</button>)}
            </div>
            {entries.length === 0 ? <Empty title="No entries here" /> : (
              <div className="crm-table-wrap">
                <table className="crm-table">
                  <thead><tr><th scope="col">Day</th><th scope="col">Kind</th><th scope="col">For</th><th scope="col">Paid by</th><th scope="col" className="wb-num">Amount</th><th scope="col">Bill</th>{editable && <th scope="col"><span className="crm-sr">Actions</span></th>}</tr></thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.id} className={e.status === 'rejected' ? 'ms-rejected' : undefined}>
                        <td style={{ whiteSpace: 'nowrap' }}>{dayText(e.spentOn)}</td>
                        <td><span className="ms-cat-name"><i style={{ background: COLOR[e.category] }} aria-hidden />{label[e.category] ?? e.category}</span></td>
                        <td>{e.note || <span className="crm-sub">—</span>}{e.status === 'rejected' && <span className="crm-cell-sub" style={{ display: 'block' }}>Not approved: {e.rejectReason}</span>}</td>
                        <td>{e.paidBy === 'person' ? <button type="button" className="wa-link" onClick={() => setPerson(e.agentId!)}>{e.agentName}</button> : 'Organisation'}<span className="crm-cell-sub" style={{ display: 'block' }}>entered by {e.createdByName}</span></td>
                        <td className="wb-num">{e.status === 'rejected' ? <s>{rs(e.amount)}</s> : <strong>{rs(e.amount)}</strong>}</td>
                        <td>{e.hasBill ? <button type="button" className="wa-link" onClick={() => setBill(e)}>See bill</button> : <span className="crm-sub">—</span>}</td>
                        {editable && <td><span className="sp-actions" style={{ justifyContent: 'flex-end' }}>
                          <button type="button" className="crm-btn is-secondary is-sm" aria-label={`Change ${rs(e.amount)} ${label[e.category] ?? ''}`} onClick={() => setForm({ edit: e })}><Pencil size={14} aria-hidden /></button>
                          <button type="button" className="crm-btn is-secondary is-sm" aria-label={`Take out ${rs(e.amount)} ${label[e.category] ?? ''}`} disabled={busyId === e.id} onClick={() => void remove(e)}><Trash2 size={14} aria-hidden /></button>
                        </span></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {tab === 'analytics' && (
        <>
        <div className="crm-kpis">
          <div className="crm-card crm-kpi"><span className="crm-kpi-label">Spent in these days</span><span className="crm-kpi-value">{rs(data.total)}</span><span className="crm-sub">{nDays ? `${rs(Math.round(data.total / nDays))} a day over ${nDays} ${nDays === 1 ? 'day' : 'days'} with spending` : 'Nothing entered yet'}</span></div>
          <div className="crm-card crm-kpi"><span className="crm-kpi-label">Waiting for approval</span><span className="crm-kpi-value">{data.waiting.length}</span><span className="crm-sub">{data.waiting.length ? `${rs(waitingSum)} sent by agents` : 'Nothing waiting'}</span></div>
          <div className="crm-card crm-kpi"><span className="crm-kpi-label">Held by people</span><span className="crm-kpi-value">{rs(data.held)}</span><span className="crm-sub">Advances not yet spent or returned</span></div>
          <div className="crm-card crm-kpi"><span className="crm-kpi-label">We owe people</span><span className="crm-kpi-value">{rs(data.owed)}</span><span className="crm-sub">Spent from their own pocket, to settle</span></div>
        </div>

        <section className="crm-card so-card">
          <h2 className="crm-h2" style={{ margin: 0 }}>Where it went</h2>
          <ul className="ms-cats">
            {cats.map((c) => {
              const v = data.byCategory[c.key] ?? 0;
              return (
                <li key={c.key}>
                  <span className="ms-cat-name"><i style={{ background: COLOR[c.key] }} aria-hidden />{c.label}</span>
                  <span className="ms-cat-bar" aria-hidden><i style={{ width: `${(v / top) * 100}%`, background: COLOR[c.key] }} /></span>
                  <span className="ms-cat-amt">{rs(v)}</span>
                  <span className="ms-cat-pct">{data.total ? `${Math.round((v / data.total) * 100)}%` : '—'}</span>
                </li>
              );
            })}
          </ul>
        </section>
          <h2 className="crm-h2 ms-h">Day by day</h2>
          <section className="crm-card">
            {data.days.length === 0 ? <Empty title="No spending in these days">{editable && <button type="button" className="crm-btn is-sm" onClick={() => setForm({})}>Add expense</button>}</Empty> : (
              <div className="crm-table-wrap">
                <table className="crm-table">
                  <thead><tr><th scope="col">Day</th>{cats.map((c) => <th key={c.key} scope="col" className="wb-num">{c.label}</th>)}<th scope="col" className="wb-num">Total</th>{editable && <th scope="col"><span className="crm-sr">Add</span></th>}</tr></thead>
                  <tbody>
                    {data.days.map((d) => (
                      <tr key={d.date}>
                        <th scope="row" className="ms-day">{dayText(d.date, true)}</th>
                        {cats.map((c) => <td key={c.key} className="wb-num">{d.byCategory[c.key] ? rs(d.byCategory[c.key]) : <span className="crm-sub">—</span>}</td>)}
                        <td className="wb-num"><strong>{rs(d.total)}</strong></td>
                        {editable && <td className="wb-num"><button type="button" className="wa-link" style={{ whiteSpace: 'nowrap' }} aria-label={`Add an expense for ${dayText(d.date, true)}`} onClick={() => setForm({ day: d.date })}>+ Add</button></td>}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><th scope="row">All {nDays} {nDays === 1 ? 'day' : 'days'}</th>{cats.map((c) => <td key={c.key} className="wb-num"><strong>{rs(data.byCategory[c.key] ?? 0)}</strong></td>)}<td className="wb-num"><strong>{rs(data.total)}</strong></td>{editable && <td />}</tr></tfoot>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {form && <ExpenseForm data={data} edit={form.edit} day={form.day} onClose={() => setForm(null)} onSaved={done} />}
      {move && <MoveForm data={data} start={move} onClose={() => setMove(null)} onSaved={done} />}
      {reject && <RejectForm e={reject} label={label[reject.category] ?? reject.category} onClose={() => setReject(null)} onReject={(reason) => void decide(reject, false, reason)} />}
      {bill && <BillView e={bill} onClose={() => setBill(null)} />}
      {person && <PersonView agentId={person} label={label} editable={editable} onClose={() => setPerson(null)} onMove={(m) => { setPerson(null); setMove(m); }} onChanged={() => void load()} toast={showToast} />}
      {toast}
    </main>
  );
}

/** Add an expense, or correct one (the amount, day, kind and what it was for). */
function ExpenseForm({ data, edit, day, onClose, onSaved }: { data: Data; edit?: Expense; day?: string; onClose: () => void; onSaved: (m: string) => void }) {
  const [spentOn, setSpentOn] = useState(edit?.spentOn ?? day ?? data.today);
  const [category, setCategory] = useState(edit?.category ?? 'food');
  const [amount, setAmount] = useState(edit ? String(edit.amount) : '');
  const [note, setNote] = useState(edit?.note ?? '');
  const [paidBy, setPaidBy] = useState<'office' | 'person'>(edit?.paidBy ?? 'office');
  const [agentId, setAgentId] = useState(edit?.agentId ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fromAgent = !!edit?.fromApp;

  const save = async () => {
    const n = Number(amount);
    if (!amount.trim() || !Number.isFinite(n) || n <= 0) { setErr('Write the amount in rupees.'); return; }
    if (paidBy === 'person' && !agentId) { setErr('Pick the person who paid.'); return; }
    setBusy(true); setErr(null);
    try {
      const body = { spentOn, category, amount: n, note, paidBy, agentId: paidBy === 'person' ? agentId : null };
      const saved = edit ? await crm.put<Expense>(`/api/v1/spend/${edit.id}`, body) : await crm.post<Expense>('/api/v1/spend', body);
      if (file) { const f = new FormData(); f.append('file', file); await crm.upload(`/api/v1/spend/${saved.id}/bill`, f); }
      onSaved(edit ? 'Saved.' : `Added ${rs(n)} for ${dayText(spentOn)}.`);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
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
        <fieldset className="ms-set"><legend>Kind</legend>
          <div className="crm-chips">{data.categories.map((c) => <button key={c.key} type="button" className="crm-chip" aria-pressed={category === c.key} onClick={() => setCategory(c.key)}>{c.label}</button>)}</div>
        </fieldset>
        <label className="crm-field">What it was for (optional)<input className="crm-input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={category === 'agents' ? 'e.g. 4 agents, daily pay' : category === 'petrol' ? 'e.g. bike to Amour and back' : 'A few words'} /></label>
        {fromAgent ? <p className="crm-sub" style={{ margin: 0 }}>Paid by {edit!.agentName} (sent from the app).</p> : (
          <fieldset className="ms-set"><legend>Who paid</legend>
            <div className="crm-chips">
              <button type="button" className="crm-chip" aria-pressed={paidBy === 'office'} onClick={() => setPaidBy('office')}>The organisation, directly</button>
              <button type="button" className="crm-chip" aria-pressed={paidBy === 'person'} onClick={() => setPaidBy('person')}>A person (from their advance or pocket)</button>
            </div>
            {paidBy === 'person' && (
              <label className="crm-field" style={{ marginTop: 10 }}>Person
                <select className="crm-input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                  <option value="">Pick a person</option>
                  {data.staff.map((s) => <option key={s.agentId} value={s.agentId}>{s.name} · {s.agentId}</option>)}
                </select>
              </label>
            )}
            <p className="crm-sub" style={{ margin: '8px 0 0' }}>{paidBy === 'person' ? 'It comes off the money they hold; if they hold none, we owe it to them.' : 'It counts in the daily spend and in nobody’s balance.'}</p>
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

/** Money given to a person (an advance, or settling what we owe them) or handed back by them. */
function MoveForm({ data, start, onClose, onSaved }: { data: Data; start: { agentId?: string; kind?: 'given' | 'returned'; amount?: number }; onClose: () => void; onSaved: (m: string) => void }) {
  const [agentId, setAgentId] = useState(start.agentId ?? '');
  const [kind, setKind] = useState<'given' | 'returned'>(start.kind ?? 'given');
  const [amount, setAmount] = useState(start.amount ? String(start.amount) : '');
  const [on, setOn] = useState(data.today);
  const [mode, setMode] = useState('cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const who = data.people.find((p) => p.agentId === agentId);
  const name = data.staff.find((s) => s.agentId === agentId)?.name ?? who?.name ?? '';
  const n = Number(amount);
  const after = who && Number.isFinite(n) && n > 0 ? who.balance.net + (kind === 'given' ? n : -n) : null;

  const save = async () => {
    if (!agentId) { setErr('Pick the person.'); return; }
    if (!amount.trim() || !Number.isFinite(n) || n <= 0) { setErr('Write the amount in rupees.'); return; }
    setBusy(true); setErr(null);
    try { await crm.post('/api/v1/spend/moves', { agentId, kind, amount: n, on, mode, note }); onSaved(kind === 'given' ? `${rs(n)} given to ${name}. They are told.` : `${rs(n)} taken back from ${name}.`); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
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
            {data.staff.map((s) => <option key={s.agentId} value={s.agentId}>{s.name} · {s.agentId}</option>)}
          </select>
        </label>
        {who && <p className="crm-sub" style={{ margin: 0 }}>Now: {who.balance.net > 0 ? `holds ${rs(who.balance.holds)}` : who.balance.net < 0 ? `we owe ${rs(who.balance.owed)}` : 'settled'}{after !== null ? ` → after this: ${after > 0 ? `holds ${rs(after)}` : after < 0 ? `we owe ${rs(-after)}` : 'settled'}` : ''}</p>}
        <div className="ms-two">
          <label className="crm-field">Amount (₹)<input className="crm-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="e.g. 2000" /></label>
          <label className="crm-field">Day<input className="crm-input" type="date" value={on} max={data.today} onChange={(e) => setOn(e.target.value)} /></label>
        </div>
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

/** One person's account: every amount given or returned, and every expense of theirs. */
function PersonView({ agentId, label, editable, onClose, onMove, onChanged, toast }: {
  agentId: string; label: Record<string, string>; editable: boolean; onClose: () => void;
  onMove: (m: { agentId: string; kind: 'given' | 'returned'; amount?: number }) => void; onChanged: () => void; toast: (m: string) => void;
}) {
  const [d, setD] = useState<PersonDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { try { setD(await crm.get<PersonDetail>(`/api/v1/spend/people/${encodeURIComponent(agentId)}`)); } catch (e) { setErr(friendlyError(e)); } }, [agentId]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  const removeMove = async (m: Move) => {
    if (!window.confirm(`Take this ${rs(m.amount)} entry out of ${d?.name}'s balance? It is kept in the records, not deleted.`)) return;
    try { await crm.post(`/api/v1/spend/moves/${m.id}/remove`); toast('Taken out of the balance.'); await load(); onChanged(); } catch (e) { toast(errText(e)); }
  };
  type Line = { key: string; day: string; text: string; sub?: string; amount: number; sign: 1 | -1 | 0; move?: Move };
  const lines: Line[] = d ? [
    ...d.moves.map((m): Line => ({ key: `m${m.id}`, day: m.on, text: m.kind === 'given' ? 'Money given' : 'Money returned', sub: [m.mode ? MODE[m.mode] : null, m.note, `by ${m.createdByName}`].filter(Boolean).join(' · '), amount: m.amount, sign: m.kind === 'given' ? 1 : -1, move: m })),
    ...d.expenses.map((e): Line => ({ key: `e${e.id}`, day: e.spentOn, text: `Spent · ${label[e.category] ?? e.category}`, sub: [e.note, e.status === 'pending' ? 'waiting for approval' : e.status === 'rejected' ? `not approved: ${e.rejectReason ?? ''}` : null].filter(Boolean).join(' · '), amount: e.amount, sign: e.status === 'approved' ? -1 : 0 })),
  ].sort((a, b) => b.day.localeCompare(a.day)) : [];

  return (
    <Modal title={d?.name ?? 'Account'} onClose={onClose} wide actions={d && editable ? <>
      {d.settle?.kind === 'given' && <button type="button" className="crm-btn" onClick={() => onMove({ agentId, kind: 'given', amount: d.settle!.amount })}>Settle {rs(d.settle.amount)}</button>}
      {d.settle?.kind === 'returned' && <button type="button" className="crm-btn is-secondary" onClick={() => onMove({ agentId, kind: 'returned', amount: d.settle!.amount })}>Took back {rs(d.settle.amount)}</button>}
      <button type="button" className="crm-btn is-secondary" onClick={() => onMove({ agentId, kind: 'given' })}>Give money</button>
    </> : undefined}>
      {err ? <ErrorBox message={err} /> : !d ? <Skeleton h={300} /> : (
        <>
          <div className="ms-acct">
            <div><span className="crm-sub">Given</span><strong>{rs(d.balance.given)}</strong></div>
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
