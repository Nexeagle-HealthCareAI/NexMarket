'use client';

import { useState } from 'react';
import Link from 'next/link';
import { canEdit, useAccess, Place, hasOpd } from '@/lib/crm/access';
import { PayWithProof, ProofLine, type ProofInfo } from '@/components/crm/PaymentProof';
import { IndianRupee, Receipt, Wallet } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { fmt, friendlyError, Pill, rupees, Skeleton, useLoader } from '@/components/crm/ui';

interface Bill {
  id: string; kind: string; kindLabel: string; amount: number; collected: number; scheme: string; schemeLabel: string; billNumber?: string | null;
  note?: string | null; billedOn: string; status: 'active' | 'void'; voidReason?: string | null; by: string;
}
interface Payout {
  id: string; purpose: string; amount: number; status: string; notes?: string | null; createdAt: string; approvedAt?: string | null; paidAt?: string | null;
  paymentReference?: string | null; overdue: boolean; by: string; proof?: ProofInfo | null;
}
interface Incentive { id: string; reason: string; amount: number; status: string; auto: boolean; createdAt: string; paidAt?: string | null; paymentReference?: string | null; agent: string }
interface Money {
  billed: number; collected: number; due: number; bills: Bill[]; partnerPayments: Payout[]; partnerOverall: { paid: number; open: number; total?: number };
  partnerForPatient?: { total: number; paid: number; pending: number; unconfirmed: number };
  incentives: Incentive[]; purposes: string[];
}

const KINDS: [string, string][] = [['opd', hasOpd() ? 'OPD' : 'Visit'], ['ipd', 'Admission (IPD)'], ['procedure', 'Procedure / surgery'], ['pharmacy', 'Pharmacy'], ['lab', 'Lab / tests'], ['other', 'Other']];
const SCHEMES: [string, string][] = [['cash', 'Cash / UPI'], ['ayushman', 'Ayushman Bharat'], ['insurance', 'Insurance'], ['govt_scheme', 'Other government scheme'], ['other', 'Other']];

export function statusPill(status: string, overdue?: boolean) {
  if (status === 'paid') return <Pill tone="ok" dot>Paid</Pill>;
  if (status === 'approved') return <Pill tone={overdue ? 'bad' : 'warn'} dot>{overdue ? 'Approved · overdue' : 'Approved · to pay'}</Pill>;
  if (status === 'rejected') return <Pill>Rejected</Pill>;
  return <Pill tone="info" dot>Waiting approval</Pill>;
}

/**
 * Everything to do with money for one referred patient: the hospital's bills (what was billed and collected),
 * the referring partner's service payments for this patient, and the field agent's incentive.
 */
export function ReferralMoney({ clientId, partnerName, editable, isAdmin, onChanged }: {
  clientId: string; partnerName: string; editable: boolean; isAdmin: boolean; onChanged?: () => void;
}) {
  const { data, error, reload } = useLoader(() => crm.get<Money>(`/api/v1/referrals/${encodeURIComponent(clientId)}/money`), [clientId]);
  const [form, setForm] = useState<'bill' | 'payout' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const done = (m: string) => { setForm(null); setMsg(m); void reload(); onChanged?.(); };
  const { access } = useAccess();
  const canPay = canEdit(access, 'payments');
  const [paying, setPaying] = useState<Payout | null>(null);
  const changed = () => { void reload(); onChanged?.(); };

  return (
    <section className="rm" aria-labelledby={`money-${clientId}`}>
      <div className="rm-head">
        <h3 id={`money-${clientId}`}><IndianRupee size={16} aria-hidden /> Money for this patient</h3>
        {editable && (
          <span className="rm-actions">
            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setForm(form === 'bill' ? null : 'bill')} aria-expanded={form === 'bill'}><Receipt size={14} aria-hidden /> Add bill</button>
            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setForm(form === 'payout' ? null : 'payout')} aria-expanded={form === 'payout'}><Wallet size={14} aria-hidden /> Partner service payment</button>
          </span>
        )}
      </div>
      {msg && <div className="crm-note" role="status">{msg}</div>}
      {error && <div className="crm-error" role="alert">{error}</div>}
      {!data ? <Skeleton h={90} /> : (
        <>
          <div className="rm-totals">
            <Total label="Billed" value={rupees(data.billed)} />
            <Total label="Collected" value={rupees(data.collected)} tone="ok" />
            <Total label="Still due" value={rupees(data.due)} tone={data.due > 0 ? 'warn' : undefined} />
          </div>
          {(() => {
            const pp = data.partnerForPatient ?? { total: data.partnerPayments.reduce((a, p) => a + p.amount, 0), paid: data.partnerPayments.filter((p) => p.status === 'paid').reduce((a, p) => a + p.amount, 0), pending: 0, unconfirmed: 0 };
            const pending = data.partnerForPatient ? pp.pending : pp.total - pp.paid;
            return (
              <div className="rm-partner">
                <div className="rm-partner-head">
                  <strong>{partnerName}</strong>
                  <span className="crm-cell-sub">who referred this patient · gets for services for this patient</span>
                </div>
                <div className="rm-partner-nums">
                  <span><em>Total</em>{rupees(pp.total)}</span>
                  <span className="is-ok"><em>Paid</em>{rupees(pp.paid)}</span>
                  <span className={pending > 0 ? 'is-warn' : undefined}><em>Still to pay</em>{rupees(pending)}</span>
                  <span className={pp.unconfirmed ? 'is-warn' : undefined}><em>Receipt confirmed</em>{pp.unconfirmed ? `${pp.unconfirmed} not yet` : pp.paid > 0 ? 'Yes' : '—'}</span>
                </div>
                <span className="crm-cell-sub">All patients: {rupees(data.partnerOverall.paid)} paid · {rupees(data.partnerOverall.open)} still to pay. The field agent sees the same in the app.</span>
              </div>
            );
          })()}

          {form === 'bill' && <BillForm clientId={clientId} onDone={() => done('Bill saved.')} onCancel={() => setForm(null)} />}
          {form === 'payout' && <PayoutForm clientId={clientId} partnerName={partnerName} purposes={data.purposes} onDone={() => done(`Sent to Payments for an admin's approval.`)} onCancel={() => setForm(null)} />}

          <h4 className="rm-sub">{Place()} bills</h4>
          {data.bills.length === 0 ? <p className="crm-sub rm-empty">No bill recorded yet.{editable ? ' Add the OPD, admission or procedure bill when it is raised.' : ''}</p> : (
            <ul className="rm-list">
              {data.bills.map((b) => <BillRow key={b.id} b={b} editable={editable} onChanged={() => { void reload(); onChanged?.(); }} />)}
            </ul>
          )}

          <h4 className="rm-sub">Payments to {partnerName} for this patient</h4>
          {data.partnerPayments.length === 0 ? <p className="crm-sub rm-empty">None. Payments are for services such as travel with the patient, an escort or an ambulance, and need an admin&apos;s approval.</p> : (
            <ul className="rm-list">
              {data.partnerPayments.map((p) => (
                <li key={p.id}>
                  <span className="rm-main"><strong>{rupees(p.amount)}</strong> · {p.purpose}<span className="crm-cell-sub">{p.notes ?? ''}</span></span>
                  <span className="rm-side">
                    {statusPill(p.status, p.overdue)}
                    <span className="crm-cell-sub">{p.paidAt ? `Paid ${fmt.date(p.paidAt)}${p.paymentReference ? ` · ref ${p.paymentReference}` : ''}` : `Asked ${fmt.date(p.createdAt)} by ${p.by}`}</span>
                    <ProofLine id={p.id} status={p.status} proof={p.proof} canPay={canPay} onChanged={changed} toast={setMsg} />
                    {canPay && p.status === 'approved' && !p.proof?.cashAgentId && <button type="button" className="crm-btn is-sm" onClick={() => setPaying(p)}>Pay with proof</button>}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h4 className="rm-sub">Field agent&apos;s incentive</h4>
          {data.incentives.length === 0 ? <p className="crm-sub rm-empty">None for this patient.{isAdmin ? ' Set a fixed amount per arrival or admission in Payments → Agent incentives.' : ''}</p> : (
            <ul className="rm-list">
              {data.incentives.map((i) => (
                <li key={i.id}>
                  <span className="rm-main"><strong>{rupees(i.amount)}</strong> · {i.agent}<span className="crm-cell-sub">{i.reason}{i.auto ? ' (by the incentive rule)' : ''}</span></span>
                  <span className="rm-side">{statusPill(i.status)}<span className="crm-cell-sub">{i.paidAt ? `Paid ${fmt.date(i.paidAt)}${i.paymentReference ? ` · ref ${i.paymentReference}` : ''}` : fmt.date(i.createdAt)}</span></span>
                </li>
              ))}
            </ul>
          )}
          {(data.partnerPayments.some((p) => p.status !== 'paid') || data.incentives.some((i) => i.status !== 'paid')) && (
            <p className="crm-sub" style={{ fontSize: 12.5, margin: 0 }}>Approving happens in <Link href="/admin/payments">Payments</Link>. Every payment needs proof: a UPI or bank screenshot, or the agent&apos;s photo of the cash handover. The agent sees each status in their app.</p>
          )}
          {paying && <PayWithProof row={{ id: paying.id, amount: paying.amount, partner: partnerName }} onClose={() => setPaying(null)} onSaved={(m) => { setPaying(null); setMsg(m); changed(); }} />}
        </>
      )}
    </section>
  );
}

function Total({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="rm-total">
      <span>{label}</span>
      <strong className={tone ? `is-${tone}` : undefined}>{value}</strong>
      {sub && <em>{sub}</em>}
    </div>
  );
}

function BillRow({ b, editable, onChanged }: { b: Bill; editable: boolean; onChanged: () => void }) {
  const [mode, setMode] = useState<'collect' | 'void' | null>(null);
  const [collected, setCollected] = useState(String(b.collected));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      if (mode === 'collect') await crm.put(`/api/v1/referrals/bills/${b.id}`, { collected: Number(collected) || 0 });
      else await crm.post(`/api/v1/referrals/bills/${b.id}/void`, { reason });
      setMode(null); onChanged();
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  const voided = b.status === 'void';
  return (
    <li className={voided ? 'is-void' : undefined}>
      <span className="rm-main">
        <strong>{rupees(b.amount)}</strong> · {b.kindLabel}
        <span className="crm-cell-sub">{[fmt.date(b.billedOn), b.schemeLabel, b.billNumber ? `bill ${b.billNumber}` : null, b.note, `by ${b.by}`].filter(Boolean).join(' · ')}</span>
        {voided && <span className="crm-cell-sub" style={{ color: 'var(--bad)' }}>Voided: {b.voidReason}</span>}
      </span>
      <span className="rm-side">
        {voided ? <Pill>Void</Pill> : b.collected >= b.amount ? <Pill tone="ok" dot>Collected</Pill> : <Pill tone="warn" dot>{rupees(b.amount - b.collected)} due</Pill>}
        {editable && !voided && !mode && (
          <span style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="rm-link" onClick={() => setMode('collect')}>Update collected</button>
            <button type="button" className="rm-link" onClick={() => setMode('void')}>Void</button>
          </span>
        )}
      </span>
      {mode && (
        <div className="rm-inline">
          {mode === 'collect'
            ? <label className="crm-field">Collected so far (₹)<input className="crm-input" type="number" min={0} max={b.amount} value={collected} onChange={(e) => setCollected(e.target.value)} /></label>
            : <label className="crm-field">Why is this bill wrong?<input className="crm-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered twice" /></label>}
          <span style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="crm-btn is-sm" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : mode === 'collect' ? 'Save' : 'Void bill'}</button>
            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setMode(null)}>Cancel</button>
          </span>
          {err && <div className="crm-error" role="alert">{err}</div>}
        </div>
      )}
    </li>
  );
}

function BillForm({ clientId, onDone, onCancel }: { clientId: string; onDone: () => void; onCancel: () => void }) {
  const [kind, setKind] = useState('ipd');
  const [amount, setAmount] = useState('');
  const [collected, setCollected] = useState('');
  const [scheme, setScheme] = useState('cash');
  const [billNumber, setBillNumber] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await crm.post(`/api/v1/referrals/${encodeURIComponent(clientId)}/bills`, {
        kind, scheme, amount: Number(amount) || 0, collected: Number(collected) || 0, billNumber: billNumber || null, note: note || null,
      });
      onDone();
    } catch (e) { setErr(friendlyError(e)); setBusy(false); }
  };
  return (
    <div className="rm-form">
      <div className="rm-grid">
        <label className="crm-field">For<select className="crm-input" value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="crm-field">Bill amount (₹)<input className="crm-input" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="crm-field">Collected now (₹)<input className="crm-input" type="number" min={0} value={collected} onChange={(e) => setCollected(e.target.value)} placeholder="0" /></label>
        <label className="crm-field">Paid by<select className="crm-input" value={scheme} onChange={(e) => setScheme(e.target.value)}>{SCHEMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="crm-field">Bill number<input className="crm-input" value={billNumber} onChange={(e) => setBillNumber(e.target.value)} placeholder="optional" /></label>
        <label className="crm-field">Note<input className="crm-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" /></label>
      </div>
      {err && <div className="crm-error" role="alert">{err}</div>}
      <span style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="crm-btn is-sm" disabled={busy || !amount} onClick={() => void save()}>{busy ? 'Saving…' : 'Save bill'}</button>
        <button type="button" className="crm-btn is-secondary is-sm" onClick={onCancel}>Cancel</button>
      </span>
    </div>
  );
}

function PayoutForm({ clientId, partnerName, purposes, onDone, onCancel }: { clientId: string; partnerName: string; purposes: string[]; onDone: () => void; onCancel: () => void }) {
  const [purpose, setPurpose] = useState(purposes[0] ?? '');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await crm.post(`/api/v1/referrals/${encodeURIComponent(clientId)}/partner-payment`, { purpose, amount: Number(amount) || 0, notes: notes || null });
      onDone();
    } catch (e) { setErr(friendlyError(e)); setBusy(false); }
  };
  return (
    <div className="rm-form">
      <p className="crm-sub" style={{ margin: 0, fontSize: 13 }}>
        A payment to {partnerName} for a service they gave this patient. It goes to Payments for an admin&apos;s approval. Payments can&apos;t be a fee for the referral itself or a share of the bill.
      </p>
      <div className="rm-grid">
        <label className="crm-field">Service<select className="crm-input" value={purpose} onChange={(e) => setPurpose(e.target.value)}>{purposes.map((p) => <option key={p}>{p}</option>)}</select></label>
        <label className="crm-field">Amount (₹)<input className="crm-input" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="crm-field" style={{ gridColumn: 'span 2' }}>Details{purpose === 'Other service' ? '' : ' (optional)'}<input className="crm-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Brought the patient by auto from Pothia" /></label>
      </div>
      {err && <div className="crm-error" role="alert">{err}</div>}
      <span style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="crm-btn is-sm" disabled={busy || !amount} onClick={() => void save()}>{busy ? 'Sending…' : 'Send for approval'}</button>
        <button type="button" className="crm-btn is-secondary is-sm" onClick={onCancel}>Cancel</button>
      </span>
    </div>
  );
}
