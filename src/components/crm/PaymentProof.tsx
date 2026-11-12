'use client';

import { useEffect, useRef, useState } from 'react';
import { BadgeCheck, Banknote, Camera, FileImage, HandCoins, MapPin, Upload } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { fmt, friendlyError, Modal, rupees } from '@/components/crm/ui';
import { place } from '@/lib/crm/access';

/** What the server says about a payment's proof and whether the partner got it. */
export interface ProofInfo {
  method?: string | null; methodLabel?: string; hasProof: boolean; proofKind?: string | null; proofAt?: string | null;
  proofLat?: number | null; proofLng?: number | null; proofBy?: string | null; cashAgentId?: string | null; cashAgent?: string | null;
  receivedAt?: string | null; receivedBy?: string | null;
}

const METHODS = [
  { k: 'upi', l: 'UPI' }, { k: 'bank', l: 'Bank transfer' }, { k: 'cheque', l: 'Cheque' }, { k: 'cash', l: `Cash at the ${place()}` },
] as const;

const errText = (e: unknown) => {
  const m = e instanceof Error ? e.message : '';
  const i = m.indexOf(': {');
  if (i >= 0) { try { return (JSON.parse(m.slice(i + 2)) as { message?: string }).message ?? friendlyError(e); } catch { /* fall through */ } }
  return friendlyError(e);
};

/**
 * Pay an approved amount with proof: how it was paid, the UPI/bank reference, and the screenshot or receipt (a photo for
 * cash at the hospital). Or hand it to the field agent to pay in cash; they record it with a photo in the app.
 */
export function PayWithProof({ row, onClose, onSaved }: {
  row: { id: string; amount: number; partner: string }; onClose: () => void; onSaved: (msg: string) => void;
}) {
  const [method, setMethod] = useState<string>('upi');
  const [reference, setReference] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pick = (f: File | null) => {
    setFile(f);
    setPreview((old) => { if (old) URL.revokeObjectURL(old); return f && f.type.startsWith('image/') ? URL.createObjectURL(f) : null; });
  };

  const pay = async () => {
    if (!file) { setErr(method === 'cash' ? 'Add a photo of the cash handover.' : 'Add the payment screenshot or receipt.'); return; }
    setBusy(true); setErr(null);
    const form = new FormData();
    form.append('file', file); form.append('method', method);
    if (reference.trim()) form.append('reference', reference.trim());
    try { await crm.upload(`/api/v1/payments/${row.id}/pay`, form); onSaved(`Paid ${rupees(row.amount)} to ${row.partner}, with proof. Their agent is told.`); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const byAgent = async () => {
    setBusy(true); setErr(null);
    try { await crm.post(`/api/v1/payments/${row.id}/cash-agent`, {}); onSaved(`Sent to ${row.partner}'s field agent to hand over in cash. They'll record it with a photo.`); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  return (
    <Modal title={`Pay ${rupees(row.amount)} to ${row.partner}`} onClose={onClose} actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="crm-btn" onClick={() => void pay()} disabled={busy || !file}>{busy ? 'Saving…' : 'Mark paid with proof'}</button>
    </>}>
      <div className="pp-form">
        <fieldset className="pp-methods">
          <legend className="crm-field" style={{ marginBottom: 6 }}>How was it paid?</legend>
          {METHODS.map((m) => (
            <label key={m.k} className="crm-chip" aria-pressed={method === m.k}>
              <input type="radio" name="pp-method" value={m.k} checked={method === m.k} onChange={() => setMethod(m.k)} className="crm-sr" />{m.l}
            </label>
          ))}
        </fieldset>
        {method !== 'cash' && (
          <label className="crm-field">{method === 'upi' ? 'UPI transaction ID (UTR)' : method === 'bank' ? 'Bank reference (UTR)' : 'Cheque number'}
            <input className="crm-input" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} placeholder={method === 'upi' ? 'e.g. 4521 8890 1234' : ''} />
          </label>
        )}
        <label className="pp-drop">
          <input type="file" accept="image/*,application/pdf" className="crm-sr" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
          {/* A local preview of a picked file: next/image can't load blob URLs. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview ? <img src={preview} alt="Proof preview" /> : <span className="pp-drop-icon">{method === 'cash' ? <Camera size={22} aria-hidden /> : <Upload size={22} aria-hidden />}</span>}
          <span>
            <strong>{file ? file.name : method === 'cash' ? 'Add a photo of the handover' : 'Add the payment screenshot or receipt'}</strong>
            <span className="crm-cell-sub" style={{ display: 'block' }}>{file ? 'Click to change' : 'Photo (JPG, PNG) or PDF, up to 10 MB. Required.'}</span>
          </span>
        </label>
        {err && <div className="crm-error" role="alert">{err}</div>}
        <div className="pp-or">
          <span className="crm-sub" style={{ fontSize: 13 }}>Paying in cash in the village?</span>
          <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void byAgent()} disabled={busy}><HandCoins size={15} aria-hidden /> Field agent will pay in cash</button>
        </div>
      </div>
    </Modal>
  );
}

/** One line under a payment: proof, cash with an agent, and whether the partner got it. */
export function ProofLine({ id, status, proof, canPay, onChanged, toast }: {
  id: string; status: string; proof?: ProofInfo | null; canPay: boolean; onChanged: () => void; toast?: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!proof) return null;
  const act = async (path: string, msg: string) => {
    setBusy(true);
    try { await crm.post(path, {}); toast?.(msg); onChanged(); } catch (e) { toast?.(errText(e)); } finally { setBusy(false); }
  };
  return (
    <span className="pp-line">
      {status === 'approved' && proof.cashAgentId && (
        <span className="pp-chip is-cash"><Banknote size={13} aria-hidden /> Cash with {proof.cashAgent ?? 'agent'}
          {canPay && <button type="button" className="pp-link" disabled={busy} onClick={() => void act(`/api/v1/payments/${id}/cash-agent/cancel`, 'Taken back from the agent.')}>undo</button>}
        </span>
      )}
      {status === 'paid' && (
        <>
          {proof.methodLabel && proof.method && <span className="pp-chip">{proof.methodLabel}</span>}
          {proof.hasProof
            ? <button type="button" className="pp-chip is-proof" onClick={() => setOpen(true)}><FileImage size={13} aria-hidden /> {proof.proofKind === 'cash_photo' ? 'Cash photo' : 'Proof'}</button>
            : <span className="pp-chip is-missing">No proof</span>}
          {proof.receivedAt
            ? <span className="pp-chip is-ok"><BadgeCheck size={13} aria-hidden /> Received · {fmt.date(proof.receivedAt)}</span>
            : canPay
              ? <button type="button" className="pp-chip is-ask" disabled={busy} onClick={() => void act(`/api/v1/payments/${id}/received`, 'Marked as received by the partner.')}>Partner got it?</button>
              : <span className="pp-chip is-ask">Not confirmed yet</span>}
        </>
      )}
      {open && <ProofViewer id={id} proof={proof} onClose={() => setOpen(false)} />}
    </span>
  );
}

function ProofViewer({ id, proof, onClose }: { id: string; proof: ProofInfo; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [type, setType] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  useEffect(() => {
    let alive = true;
    crm.blob(`/api/v1/payment-proofs/${id}`).then((b) => {
      if (!alive) return;
      const u = URL.createObjectURL(b); urlRef.current = u; setUrl(u); setType(b.type);
    }).catch((e) => setErr(friendlyError(e)));
    return () => { alive = false; if (urlRef.current) URL.revokeObjectURL(urlRef.current); };
  }, [id]);
  const when = proof.proofAt ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(proof.proofAt)) : null;
  return (
    <Modal title={proof.proofKind === 'cash_photo' ? 'Cash handover photo' : 'Proof of payment'} onClose={onClose} wide
      actions={<>{url && <a className="crm-btn is-secondary" href={url} download={`payment-proof-${id}`}>Download</a>}<button type="button" className="crm-btn" onClick={onClose}>Close</button></>}>
      <div className="pp-view">
        {err ? <div className="crm-error">{err}</div> : !url ? <div className="crm-sub">Loading…</div>
          // eslint-disable-next-line @next/next/no-img-element
          : type === 'application/pdf' ? <iframe title="Proof" src={url} /> : <img src={url} alt="Proof of payment" />}
        <p className="crm-sub" style={{ margin: 0, fontSize: 13 }}>
          {[proof.methodLabel, when ? `${proof.proofKind === 'cash_photo' ? 'Taken' : 'Added'} ${when}` : null, proof.proofBy ? `by ${proof.proofBy}` : null].filter(Boolean).join(' · ')}
          {proof.proofLat != null && proof.proofLng != null && <> · <a href={`https://www.google.com/maps?q=${proof.proofLat},${proof.proofLng}`} target="_blank" rel="noreferrer"><MapPin size={12} aria-hidden style={{ verticalAlign: -1 }} /> where it was taken</a></>}
        </p>
      </div>
    </Modal>
  );
}

export function proofStatusLabel(status: string, proof?: ProofInfo | null): { tone: 'ok' | 'warn' | 'accent' | 'neutral'; text: string } {
  if (status === 'paid') return proof?.receivedAt ? { tone: 'ok', text: 'Paid · received' } : { tone: 'ok', text: 'Paid' };
  if (status === 'approved') return proof?.cashAgentId ? { tone: 'warn', text: 'Cash with agent' } : { tone: 'warn', text: 'To pay' };
  return { tone: 'accent', text: 'Waiting approval' };
}
