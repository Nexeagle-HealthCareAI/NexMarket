'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, Plus, Search, UserRound, Wallet } from 'lucide-react';
import { PageTabs, usePageTab } from '@/components/crm/PageTabs';
import { crm } from '@/lib/sync/api-client';
import { canEdit, useAccess } from '@/lib/crm/access';
import { Pager, usePaged } from '@/components/crm/Pager';
import {
  contactTypeLabel, Empty, ErrorBox, fmt, friendlyError, initials, Modal, PageHead, Pill, rupees, Skeleton, useLoader, useToast,
} from '@/components/crm/ui';

interface PaymentSummary { pendingAmount: number; pendingCount: number; approvedAmount: number; approvedPartners: number; overdue: number; paidMonthAmount: number; paidMonthCount: number }
interface PaymentRow {
  id: string; contactClientId: string; partner: string; partnerType?: string | null; block?: string | null; phone?: string | null;
  patientsSent: number; admitted: number; purpose: string; period?: string | null; amount: number; status: string; overdue: boolean;
  createdAt: string; dueDate?: string | null; approvedAt?: string | null; paidAt?: string | null; paymentReference?: string | null; notes?: string | null;
  referralClientId?: string | null; patientName?: string | null;
}

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'pending_approval', label: 'Waiting approval' },
  { key: 'approved', label: 'To be paid' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'paid', label: 'Paid' },
];

const PURPOSES = ['Health camp support', 'Travel with patients', 'Ambulance coordination', 'Sample pickup service', 'Camp venue', 'Banner and display space', 'Other service'];

export default function PaymentsPageWrap() {
  return (
    <Suspense fallback={<main className="crm-page"><Skeleton h={520} /></main>}>
      <PaymentsPage />
    </Suspense>
  );
}

function PaymentsPage() {
  const [tab, setTab] = usePageTab(['partners', 'agents'] as const, 'partners');
  const { access } = useAccess();
  if (tab === 'agents') return <IncentivesView tab={tab} setTab={setTab} />;
  return <PartnerPaymentsView tab={tab} setTab={setTab} access={access} />;
}

type PayTab = 'partners' | 'agents';
function PayTabs({ tab, setTab }: { tab: PayTab; setTab: (t: PayTab) => void }) {
  return <PageTabs tabs={[{ key: 'partners', label: 'Partner payments', icon: Wallet }, { key: 'agents', label: 'Agent incentives', icon: UserRound }]} value={tab} onChange={setTab} label="Payments" />;
}

function PartnerPaymentsView({ tab, setTab, access }: { tab: PayTab; setTab: (t: PayTab) => void; access: ReturnType<typeof useAccess>['access'] }) {
  const editable = canEdit(access, 'payments');
  const isAdmin = !!access?.isAdmin;
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<PaymentRow | null>(null);
  const [toast, showToast] = useToast();

  const summary = useLoader(() => crm.get<PaymentSummary>('/api/v1/payments/summary'));
  const list = useLoader(
    () => crm.get<PaymentRow[]>(`/api/v1/payments?status=${filter}${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}`),
    [filter, search],
  );
  const pg = usePaged(list.data ?? [], [filter, search], 25);
  const refresh = () => { void summary.reload(); void list.reload(); };

  const act = async (row: PaymentRow, action: 'approve' | 'reject') => {
    try {
      await crm.post(`/api/v1/payments/${row.id}/${action}`);
      showToast(action === 'approve' ? `Approved ${rupees(row.amount)} for ${row.partner}.` : 'Entry rejected.');
      refresh();
    } catch (e) {
      showToast(friendlyError(e));
    }
  };

  const s = summary.data;

  return (
    <main className="crm-page">
      <PageHead title="Payments" sub="What the hospital owes partners for their services — approved by an admin, then marked paid with a reference.">
        <button type="button" className="crm-btn is-secondary" onClick={() => crm.download(`/api/v1/payments/export?status=${filter}`, `partner-payments.csv`).catch((e) => showToast(friendlyError(e)))}>
          <Download size={16} aria-hidden /> Export for accounts
        </button>
        {editable && <button type="button" className="crm-btn" onClick={() => setAdding(true)}><Plus size={16} aria-hidden /> Add amount owed</button>}
      </PageHead>

      <PayTabs tab={tab} setTab={setTab} />
      {summary.error && <ErrorBox message={summary.error} onRetry={summary.reload} />}
      <section aria-label="Totals" className="crm-kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {!s ? [0, 1, 2].map((i) => <div key={i} className="crm-card"><Skeleton h={60} /></div>) : (
          <>
            <Tile label="Waiting for approval" value={rupees(s.pendingAmount)} sub={`${s.pendingCount} entr${s.pendingCount === 1 ? 'y' : 'ies'} · admin approves`} />
            <Tile label="Approved, to be paid" value={rupees(s.approvedAmount)} sub={`${s.approvedPartners} partner${s.approvedPartners === 1 ? '' : 's'}${s.overdue ? ` · ${s.overdue} overdue by 7+ days` : ''}`} warn />
            <Tile label="Paid this month" value={rupees(s.paidMonthAmount)} sub={`${s.paidMonthCount} payment${s.paidMonthCount === 1 ? '' : 's'}`} />
          </>
        )}
      </section>

      <section className="crm-card is-flush" aria-labelledby="led-h">
        <div className="crm-card-head">
          <h2 id="led-h" className="crm-h2" style={{ marginRight: 'auto' }}>Ledger</h2>
          <label className="crm-search" style={{ flex: '0 1 280px' }}>
            <Search size={16} color="#5a6478" aria-hidden />
            <span className="crm-sr">Search payments</span>
            <input type="search" placeholder="Partner or purpose" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <div className="crm-chips" role="tablist" aria-label="Status" style={{ width: '100%' }}>
            {FILTERS.map((f) => <button key={f.key} type="button" role="tab" className="crm-chip" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}</button>)}
          </div>
        </div>
        {list.error && <div style={{ padding: '0 22px' }}><ErrorBox message={list.error} onRetry={list.reload} /></div>}
        {!list.data ? <div style={{ padding: '0 22px 16px' }}><Skeleton h={200} /></div> : list.data.length === 0 ? (
          <Empty title="Nothing here">{editable ? 'Use “Add amount owed” to record what a partner should be paid.' : ''}</Empty>
        ) : (
          <><div className="crm-table-wrap">
            <table className="crm-table" style={{ minWidth: 900 }}>
              <thead>
                <tr><th>Partner</th><th>Patients sent · admitted</th><th>For</th><th className="num">Amount</th><th>Status</th><th className="num">Action</th></tr>
              </thead>
              <tbody>
                {pg.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="crm-initials">{initials(r.partner)}</span>
                        <div>
                          <div className="crm-cell-main">{r.partner}</div>
                          <div className="crm-cell-sub">{[contactTypeLabel(r.partnerType), r.block].filter(Boolean).join(' · ')}</div>
                        </div>
                      </div>
                    </td>
                    <td><strong>{r.patientsSent}</strong> <span style={{ color: 'var(--text-2)' }}>· {r.admitted} admitted</span></td>
                    <td>
                      <div>{r.purpose}</div>
                      {r.patientName && r.referralClientId && <div className="crm-cell-sub">Patient: <Link href={`/admin/referrals?r=${encodeURIComponent(r.referralClientId)}`}>{r.patientName}</Link></div>}
                      <div className="crm-cell-sub">{r.period ?? fmt.date(r.createdAt)}{r.paymentReference ? ` · ref ${r.paymentReference}` : ''}</div>
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>{rupees(r.amount)}</td>
                    <td>
                      {r.status === 'paid' ? <Pill tone="ok">Paid {fmt.date(r.paidAt)}</Pill>
                        : r.status === 'approved' ? <Pill tone={r.overdue ? 'bad' : 'warn'}>{r.overdue ? 'Overdue' : 'To be paid'}</Pill>
                        : r.status === 'rejected' ? <Pill>Rejected</Pill>
                        : <Pill tone="accent">Waiting approval</Pill>}
                    </td>
                    <td className="num">
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        {r.status === 'pending_approval' && isAdmin && (
                          <>
                            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => act(r, 'reject')}>Reject</button>
                            <button type="button" className="crm-btn is-secondary is-sm" style={{ borderColor: 'var(--accent)', color: 'var(--accent-ink)' }} onClick={() => act(r, 'approve')}>Approve</button>
                          </>
                        )}
                        {r.status === 'pending_approval' && !isAdmin && <span className="crm-sub" style={{ fontSize: 12 }}>Admin approves</span>}
                        {r.status === 'approved' && editable && <button type="button" className="crm-btn is-sm" onClick={() => setPaying(r)}>Mark paid</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            <Pager {...pg.pager} noun="payments" /></>
        )}
      </section>

      <p className="crm-note">
        Record payments for services partners provide (camp support, travel with patients, ambulance coordination). Indian medical ethics rules bar
        registered doctors from taking payment for referring patients — check with the hospital&apos;s legal advisor before paying any doctor.
      </p>

      {adding && <AddPayment onClose={() => setAdding(false)} onSaved={() => { setAdding(false); showToast('Sent for approval.'); refresh(); }} />}
      {paying && <MarkPaid row={paying} onClose={() => setPaying(null)} onSaved={() => { showToast(`Marked ${rupees(paying.amount)} paid to ${paying.partner}.`); setPaying(null); refresh(); }} />}
      {toast}
    </main>
  );
}

function Tile({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className="crm-card" style={{ display: 'flex', flexDirection: 'column', gap: 6, ...(warn ? { background: 'var(--warn-soft)', borderColor: '#f3d9a8' } : {}) }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: warn ? 'var(--warn-ink)' : 'var(--text-2)' }}>{label}</span>
      <span style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 28, fontWeight: 800, color: warn ? '#6b3f00' : 'var(--text)' }}>{value}</span>
      <span style={{ fontSize: 12, color: warn ? 'var(--warn-ink)' : 'var(--text-2)' }}>{sub}</span>
    </div>
  );
}

function AddPayment({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<{ clientId: string; name: string; role: string; phone?: string | null }[]>([]);
  const [partner, setPartner] = useState<{ clientId: string; name: string } | null>(null);
  const [purpose, setPurpose] = useState(PURPOSES[0]);
  const [other, setOther] = useState('');
  const [period, setPeriod] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      crm.get<typeof options>(`/api/v1/payments/partners?q=${encodeURIComponent(q.trim())}`).then(setOptions).catch(() => setOptions([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const save = async () => {
    setError(null);
    const value = Number(amount);
    if (!partner) return setError('Pick a partner.');
    if (!value || value <= 0) return setError('Enter an amount.');
    setSaving(true);
    try {
      await crm.post('/api/v1/payments', { contactClientId: partner.clientId, purpose: purpose === 'Other service' ? (other.trim() || 'Other service') : purpose, period: period.trim() || null, amount: value, notes: notes.trim() || null });
      onSaved();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Add amount owed" onClose={onClose} actions={
      <>
        <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="crm-btn" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Send for approval'}</button>
      </>
    }>
      <label className="crm-field">Partner
        {partner ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <strong style={{ fontSize: 15 }}>{partner.name}</strong>
            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setPartner(null)}>Change</button>
          </span>
        ) : (
          <>
            <input className="crm-input" placeholder="Search partner name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
            <ul className="crm-list" style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 12, padding: '0 12px' }}>
              {options.map((o) => (
                <li key={o.clientId} style={{ padding: 0 }}>
                  <button type="button" onClick={() => setPartner(o)} style={{ all: 'unset', cursor: 'pointer', padding: '10px 0', width: '100%', display: 'flex', gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{o.name}</span>
                    <span className="crm-cell-sub" style={{ margin: 0 }}>{contactTypeLabel(o.role)}{o.phone ? ` · ${o.phone}` : ''}</span>
                  </button>
                </li>
              ))}
              {options.length === 0 && <li className="crm-sub" style={{ fontSize: 13 }}>No partners found</li>}
            </ul>
          </>
        )}
      </label>
      <div className="crm-form-grid">
        <label className="crm-field">For
          <select className="crm-select" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            {PURPOSES.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
        <label className="crm-field">Amount (₹)
          <input className="crm-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="e.g. 2500" />
        </label>
      </div>
      {purpose === 'Other service' && <label className="crm-field">Describe the service<input className="crm-input" value={other} onChange={(e) => setOther(e.target.value)} /></label>}
      <label className="crm-field">Period or event (optional)<input className="crm-input" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="e.g. Camp on 24 Oct, or October" /></label>
      <label className="crm-field">Notes (optional)<textarea className="crm-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      {error && <div className="crm-error" role="alert">{error}</div>}
    </Modal>
  );
}

function MarkPaid({ row, onClose, onSaved }: { row: PaymentRow; onClose: () => void; onSaved: () => void }) {
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await crm.post(`/api/v1/payments/${row.id}/paid`, { reference: reference.trim() || null });
      onSaved();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title={`Mark ${rupees(row.amount)} paid`} onClose={onClose} actions={
      <>
        <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="crm-btn" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Mark paid'}</button>
      </>
    }>
      <p className="crm-sub">{row.partner} · {row.purpose}</p>
      <label className="crm-field">Payment reference (UPI / bank / cash receipt no.)
        <input className="crm-input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. UPI 4521…" />
      </label>
      {error && <div className="crm-error" role="alert">{error}</div>}
    </Modal>
  );
}

// ─── Field agents' incentives ────────────────────────────────────────────

interface IncentiveRow {
  id: string; agentId: string; agent: string; block?: string | null; referralClientId?: string | null; patient?: string | null; patientStage?: string | null;
  department?: string | null; amount: number; reason: string; auto: boolean; status: string; createdAt: string; approvedAt?: string | null; paidAt?: string | null;
  paymentReference?: string | null; notes?: string | null;
}
interface IncentivesRes {
  summary: { pendingAmount: number; pendingCount: number; approvedAmount: number; paidMonthAmount: number };
  rule: { perArrival: number; perAdmission: number };
  items: IncentiveRow[];
}

function IncentivesView({ tab, setTab }: { tab: PayTab; setTab: (t: PayTab) => void }) {
  const { access } = useAccess();
  const editable = canEdit(access, 'payments');
  const isAdmin = !!access?.isAdmin;
  const [filter, setFilter] = useState('');
  const [paying, setPaying] = useState<IncentiveRow | null>(null);
  const [toast, showToast] = useToast();
  const data = useLoader(() => crm.get<IncentivesRes>(`/api/v1/payments/incentives${filter ? `?status=${filter}` : ''}`), [filter]);
  const pg = usePaged(data.data?.items ?? [], filter, 25);
  const act = async (row: IncentiveRow, action: 'approve' | 'reject') => {
    try {
      await crm.post(`/api/v1/payments/incentives/${row.id}/${action}`);
      showToast(action === 'approve' ? `Approved ${rupees(row.amount)} for ${row.agent}.` : 'Incentive rejected.');
      void data.reload();
    } catch (e) { showToast(friendlyError(e)); }
  };
  const s = data.data?.summary;
  return (
    <main className="crm-page">
      <PageHead title="Payments" sub="What the hospital pays field agents for patients they bring: added by the rule below or by hand, approved by an admin, then marked paid. Agents see each one in their app." />
      <PayTabs tab={tab} setTab={setTab} />
      {data.error && <ErrorBox message={data.error} onRetry={data.reload} />}
      <section aria-label="Totals" className="crm-kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {!s ? [0, 1, 2].map((i) => <div key={i} className="crm-card"><Skeleton h={60} /></div>) : (
          <>
            <Tile label="Waiting for approval" value={rupees(s.pendingAmount)} sub={`${s.pendingCount} incentive${s.pendingCount === 1 ? '' : 's'} · admin approves`} />
            <Tile label="Approved, to be paid" value={rupees(s.approvedAmount)} sub="pay with salary or separately" warn />
            <Tile label="Paid this month" value={rupees(s.paidMonthAmount)} sub="to field agents" />
          </>
        )}
      </section>

      {data.data && <RuleCard rule={data.data.rule} isAdmin={isAdmin} onSaved={() => { showToast('Incentive rule saved. It applies to patients from now on.'); void data.reload(); }} />}

      <section className="crm-card is-flush" aria-labelledby="inc-h">
        <div className="crm-card-head">
          <h2 id="inc-h" className="crm-h2" style={{ marginRight: 'auto' }}>Incentives</h2>
          <div className="crm-chips" role="tablist" aria-label="Status" style={{ width: '100%' }}>
            {FILTERS.filter((f) => f.key !== 'overdue').map((f) => <button key={f.key} type="button" role="tab" className="crm-chip" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}</button>)}
          </div>
        </div>
        {!data.data ? <div style={{ padding: '0 22px 16px' }}><Skeleton h={200} /></div> : data.data.items.length === 0 ? (
          <Empty title="No incentives yet">Set an amount per arrival or admission above, and each patient an agent brings adds one for approval.</Empty>
        ) : (
          <><div className="crm-table-wrap">
            <table className="crm-table" style={{ minWidth: 860 }}>
              <thead><tr><th>Agent</th><th>For</th><th className="num">Amount</th><th>Status</th><th className="num">Action</th></tr></thead>
              <tbody>
                {pg.rows.map((r) => (
                  <tr key={r.id}>
                    <td><div className="crm-cell-main">{r.agent}</div><div className="crm-cell-sub">{[r.block, r.agentId].filter(Boolean).join(' · ')}</div></td>
                    <td>
                      <div>{r.reason}{r.auto && <span className="crm-cell-sub"> · by the rule</span>}</div>
                      {r.patient && r.referralClientId && <div className="crm-cell-sub">Patient: <Link href={`/admin/referrals?r=${encodeURIComponent(r.referralClientId)}`}>{r.patient}</Link>{r.patientStage ? ` · ${r.patientStage.toLowerCase()}` : ''}{r.department ? ` · ${r.department}` : ''}</div>}
                      <div className="crm-cell-sub">{fmt.date(r.createdAt)}{r.paymentReference ? ` · ref ${r.paymentReference}` : ''}</div>
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>{rupees(r.amount)}</td>
                    <td>
                      {r.status === 'paid' ? <Pill tone="ok">Paid {fmt.date(r.paidAt)}</Pill>
                        : r.status === 'approved' ? <Pill tone="warn">To be paid</Pill>
                          : r.status === 'rejected' ? <Pill>Rejected</Pill> : <Pill tone="accent">Waiting approval</Pill>}
                    </td>
                    <td className="num">
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        {r.status === 'pending_approval' && isAdmin && (
                          <>
                            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => act(r, 'reject')}>Reject</button>
                            <button type="button" className="crm-btn is-secondary is-sm" style={{ borderColor: 'var(--accent)', color: 'var(--accent-ink)' }} onClick={() => act(r, 'approve')}>Approve</button>
                          </>
                        )}
                        {r.status === 'pending_approval' && !isAdmin && <span className="crm-sub" style={{ fontSize: 12 }}>Admin approves</span>}
                        {r.status === 'approved' && editable && <button type="button" className="crm-btn is-sm" onClick={() => setPaying(r)}>Mark paid</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            <Pager {...pg.pager} noun="incentives" /></>
        )}
      </section>
      {paying && <IncentivePaid row={paying} onClose={() => setPaying(null)} onSaved={() => { showToast(`Marked ${rupees(paying.amount)} paid to ${paying.agent}. They are notified in the app.`); setPaying(null); void data.reload(); }} />}
      {toast}
    </main>
  );
}

function RuleCard({ rule, isAdmin, onSaved }: { rule: { perArrival: number; perAdmission: number }; isAdmin: boolean; onSaved: () => void }) {
  const [arrival, setArrival] = useState(String(rule.perArrival || ''));
  const [admission, setAdmission] = useState(String(rule.perAdmission || ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try { await crm.put('/api/v1/payments/incentive-rule', { perArrival: Number(arrival) || 0, perAdmission: Number(admission) || 0 }); onSaved(); }
    catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  const off = !rule.perArrival && !rule.perAdmission;
  return (
    <section className="crm-card" aria-labelledby="rule-h" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 id="rule-h" className="crm-h2">Incentive rule for field agents</h2>
      <p className="crm-sub" style={{ margin: 0, fontSize: 13.5 }}>
        {off ? 'Off. ' : `${rule.perArrival ? `${rupees(rule.perArrival)} when a patient arrives` : ''}${rule.perArrival && rule.perAdmission ? ' and ' : ''}${rule.perAdmission ? `${rupees(rule.perAdmission)} when a patient is admitted` : ''}. `}
        When a patient an agent referred reaches that stage, the incentive is added here for approval. Leave 0 to switch a step off.
      </p>
      {isAdmin ? (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="crm-field" style={{ minWidth: 180 }}>Per patient who arrives (₹)<input className="crm-input" type="number" min={0} value={arrival} onChange={(e) => setArrival(e.target.value)} placeholder="0" /></label>
          <label className="crm-field" style={{ minWidth: 180 }}>Per patient admitted (₹)<input className="crm-input" type="number" min={0} value={admission} onChange={(e) => setAdmission(e.target.value)} placeholder="0" /></label>
          <button type="button" className="crm-btn" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save rule'}</button>
        </div>
      ) : <span className="crm-sub" style={{ fontSize: 12.5 }}>Only an admin can change the rule.</span>}
      {error && <div className="crm-error" role="alert">{error}</div>}
    </section>
  );
}

function IncentivePaid({ row, onClose, onSaved }: { row: IncentiveRow; onClose: () => void; onSaved: () => void }) {
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setSaving(true); setError(null);
    try { await crm.post(`/api/v1/payments/incentives/${row.id}/paid`, { reference: reference.trim() || null }); onSaved(); }
    catch (e) { setError(friendlyError(e)); } finally { setSaving(false); }
  };
  return (
    <Modal title={`Mark ${rupees(row.amount)} paid to ${row.agent}`} onClose={onClose} actions={
      <>
        <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="crm-btn" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Mark paid'}</button>
      </>
    }>
      <p className="crm-sub">{row.reason}{row.patient ? ` · ${row.patient}` : ''}</p>
      <label className="crm-field">Payment reference (UPI / bank / salary month)
        <input className="crm-input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. With November salary" />
      </label>
      {error && <div className="crm-error" role="alert">{error}</div>}
    </Modal>
  );
}
