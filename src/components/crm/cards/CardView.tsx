'use client';

import { useState } from 'react';
import QRCode from 'qrcode';
import { Ban, Printer, RefreshCw, Stethoscope, Trash2 } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { orgName } from '@/lib/crm/access';
import { ErrorBox, friendlyError, Modal, Pill, rupees, Skeleton, useLoader } from '@/components/crm/ui';
import { QrCode } from '@/components/crm/QrPoster';
import { benefits, dateText, KINDS, kindLabel, MODES, pctOf, SOURCE, STATUS, todayIso, validity, type Card, type CardDetail, type Plan } from './shared';

const ON: Record<string, string> = { opd: 'OPD', ipd: 'admission', procedure: 'procedures', lab: 'lab tests', pharmacy: 'pharmacy', other: 'other bills' };

/** The card as it looks printed: colour of its kind, number, holder, family, validity and a QR with the number. */
export function CardFace({ card, plan }: { card: Card; plan?: Plan | null }) {
  return (
    <div className="hc-face" style={{ ['--hc' as string]: card.color ?? plan?.color ?? '#0a72d6' }}>
      <div className="hc-face-top">
        <span className="hc-face-org">{orgName('full')}</span>
        <span className="hc-face-kind">{card.planName ?? plan?.name ?? 'Health card'}</span>
      </div>
      <div className="hc-face-mid">
        <div style={{ minWidth: 0 }}>
          <span className="hc-face-num">{card.number}</span>
          <strong className="hc-face-name">{card.holderName}</strong>
          {card.members.length > 0 && <span className="hc-face-members">+ {card.members.map((m) => m.name).join(', ')}</span>}
        </div>
        <QrCode text={card.number} size={68} label={`QR code for card ${card.number}`} />
      </div>
      <div className="hc-face-bot"><span>Valid {dateText(card.issuedOn)} – {dateText(card.validTill)}</span>{card.phone && <span>{card.phone}</span>}</div>
    </div>
  );
}

/** One card: who it covers, what it gives, every visit with the discount given, and renew / cancel / print. */
export function CardView({ id, editable, onClose, onChanged, toast, referralClientId }: {
  id: string; editable: boolean; onClose: () => void; onChanged: () => void; toast: (m: string) => void; referralClientId?: string;
}) {
  const data = useLoader(() => crm.get<CardDetail>(`/api/v1/health-cards/${id}`), [id]);
  const [mode, setMode] = useState<'view' | 'visit' | 'renew' | 'cancel'>(referralClientId ? 'visit' : 'view');
  const d = data.data;
  const done = (m: string) => { toast(m); setMode('view'); void data.reload(); onChanged(); };

  return (
    <Modal title={d ? `Health card ${d.card.number}` : 'Health card'} onClose={onClose} wide
      actions={d && mode === 'view' ? <>
        <button type="button" className="crm-btn is-secondary" onClick={() => void printCard(d.card, d.plan)}><Printer size={15} aria-hidden /> Print card</button>
        {editable && d.card.status !== 'cancelled' && <>
          <button type="button" className="crm-btn is-secondary" onClick={() => setMode('cancel')}><Ban size={15} aria-hidden /> Cancel card</button>
          <button type="button" className="crm-btn is-secondary" onClick={() => setMode('renew')}><RefreshCw size={15} aria-hidden /> Renew</button>
          {(d.card.status === 'active' || d.card.status === 'expiring') && <button type="button" className="crm-btn" onClick={() => setMode('visit')}><Stethoscope size={15} aria-hidden /> Record a visit</button>}
        </>}
      </> : undefined}>
      {data.error ? <ErrorBox message={data.error} onRetry={data.reload} /> : !d ? <Skeleton h={360} /> : <>
        <div className="hc-view-top">
          <CardFace card={d.card} plan={d.plan} />
          <div className="hc-view-info">
            <span><Pill tone={STATUS[d.card.status].tone}>{STATUS[d.card.status].label}</Pill>{d.card.renewals > 0 && <span className="crm-cell-sub"> · renewed {d.card.renewals}×</span>}</span>
            {d.card.status === 'cancelled' && d.card.cancelReason && <span className="crm-cell-sub">Cancelled: {d.card.cancelReason}</span>}
            <span><em>Covers</em>{d.card.holderName}{d.card.age ? ` (${d.card.age})` : ''}{d.card.members.map((m) => `, ${m.name}${m.relation ? ` (${m.relation}${m.age ? `, ${m.age}` : ''})` : m.age ? ` (${m.age})` : ''}`).join('')}</span>
            <span><em>Given</em>{SOURCE[d.card.source]}{d.card.campTitle ? ` · ${d.card.campTitle}` : ''}{d.card.agentName ? ` · by ${d.card.agentName}` : ''} · {dateText(d.card.issuedOn)}</span>
            {d.card.village && <span><em>Village</em>{d.card.village}{d.card.block ? `, ${d.card.block}` : ''}</span>}
            {d.plan && <span><em>Gives</em>{benefits(d.plan).join(' · ') || 'No discounts set'}</span>}
            <span><em>Used</em>{d.card.visits} visit{d.card.visits === 1 ? '' : 's'} · billed {rupees(d.card.billed)} · discount {rupees(d.card.discount)}{d.plan?.freeOpdVisits ? ` · ${d.card.freeLeft} free OPD left` : ''}</span>
          </div>
        </div>

        {mode === 'visit' && d.plan && <VisitForm card={d.card} plan={d.plan} referralClientId={referralClientId} onCancel={() => setMode('view')} onSaved={done} />}
        {mode === 'renew' && d.plan && <RenewForm card={d.card} plan={d.plan} onCancel={() => setMode('view')} onSaved={done} />}
        {mode === 'cancel' && <CancelForm card={d.card} onCancel={() => setMode('view')} onSaved={done} />}

        <h3 className="at-h3">Visits with the card · {d.uses.length}</h3>
        {d.uses.length === 0 ? <p className="crm-sub" style={{ margin: 0 }}>Not used yet.</p> : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead><tr><th scope="col">Day</th><th scope="col">For</th><th scope="col">Who</th><th scope="col" className="wb-num">Bill</th><th scope="col" className="wb-num">Card discount</th><th scope="col" className="wb-num">Paid</th>{editable && <th scope="col"><span className="crm-sr">Actions</span></th>}</tr></thead>
              <tbody>
                {d.uses.map((u) => (
                  <tr key={u.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{dateText(u.on, false)}</td>
                    <td>{kindLabel(u.kind)}{u.freeVisit && <> <Pill tone="ok">Free visit</Pill></>}{u.note && <span className="crm-cell-sub" style={{ display: 'block' }}>{u.note}</span>}</td>
                    <td>{u.memberName ?? d.card.holderName}<span className="crm-cell-sub" style={{ display: 'block' }}>by {u.byName}</span></td>
                    <td className="wb-num">{rupees(u.billAmount)}</td>
                    <td className="wb-num" style={{ color: 'var(--ok-ink)', fontWeight: 700 }}>{u.discount ? `− ${rupees(u.discount)}` : '–'}</td>
                    <td className="wb-num"><strong>{rupees(u.billAmount - u.discount)}</strong></td>
                    {editable && <td className="wb-num"><button type="button" className="crm-btn is-ghost is-sm" aria-label="Entered by mistake: take out" title="Entered by mistake: take out"
                      onClick={async () => { if (!window.confirm('Take this visit out?')) return; try { await crm.post(`/api/v1/health-cards/uses/${u.id}/remove`, {}); done('Visit taken out.'); } catch (e) { toast(friendlyError(e)); } }}><Trash2 size={15} aria-hidden /></button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {d.referrals.length > 0 && <p className="crm-sub" style={{ margin: 0, fontSize: 13 }}>On the Referral desk: {d.referrals.map((r) => `${r.name}${r.department ? ` (${r.department})` : ''}`).join(', ')}</p>}
        {d.payments.length > 0 && <p className="crm-sub" style={{ margin: 0, fontSize: 13 }}>Card fees: {d.payments.map((p) => `${p.kind === 'renewal' ? 'Renewal' : 'Card'} ${rupees(p.amount)} on ${dateText(p.on, false)}${p.mode ? ` (${MODES.find((m) => m.key === p.mode)?.label ?? p.mode})` : ''}`).join(' · ')}</p>}
      </>}
    </Modal>
  );
}

function VisitForm({ card, plan, referralClientId, onCancel, onSaved }: { card: Card; plan: Plan; referralClientId?: string; onCancel: () => void; onSaved: (m: string) => void }) {
  const [kind, setKind] = useState('opd');
  const [on, setOn] = useState(todayIso());
  const [who, setWho] = useState('');
  const [bill, setBill] = useState('');
  const [disc, setDisc] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const b = Number(bill || 0);
  const free = kind === 'opd' && card.freeLeft > 0;
  const auto = free ? b : Math.round((b * pctOf(plan, kind)) / 100);
  const discount = disc == null ? auto : Number(disc || 0);
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const r = await crm.post<{ discount: number; freeVisit: boolean }>(`/api/v1/health-cards/${card.id}/uses`, {
        on, kind, memberName: who || null, billAmount: b, discount: disc == null ? null : discount, referralClientId: referralClientId ?? null, note: note || null,
      });
      onSaved(r.freeVisit ? 'Free OPD visit recorded.' : `Visit recorded: ${rupees(r.discount)} off with the card.`);
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <div className="hc-form">
      <strong>Record a visit with this card</strong>
      <div className="crm-chips" role="group" aria-label="Visit for">
        {KINDS.map((k) => <button key={k.key} type="button" className="crm-chip" aria-pressed={kind === k.key} onClick={() => { setKind(k.key); setDisc(null); }}>{k.label}</button>)}
      </div>
      <div className="hc-grid">
        <label className="crm-field">Day<input className="crm-input" type="date" value={on} max={todayIso()} onChange={(e) => setOn(e.target.value)} /></label>
        <label className="crm-field">Who came
          <select className="crm-input" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">{card.holderName} (holder)</option>
            {card.members.map((m) => <option key={m.name} value={m.name}>{m.name}{m.relation ? ` (${m.relation})` : ''}</option>)}
          </select>
        </label>
        <label className="crm-field">Bill before discount (₹)<input className="crm-input" inputMode="decimal" value={bill} onChange={(e) => { setBill(e.target.value.replace(/[^0-9.]/g, '')); setDisc(null); }} placeholder="e.g. 500" /></label>
        <label className="crm-field">Card discount (₹)<input className="crm-input" inputMode="decimal" value={disc ?? String(auto)} onChange={(e) => setDisc(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
      </div>
      <p className="crm-sub" style={{ margin: 0, fontSize: 13 }}>
        {free ? `Free OPD visit (${card.freeLeft} left on this card).` : pctOf(plan, kind) ? `${pctOf(plan, kind)}% off ${ON[kind]} with this card.` : `This card gives no discount on ${ON[kind]}.`}
        {b > 0 && ` Patient pays ${rupees(Math.max(0, b - discount))}.`}
      </p>
      <label className="crm-field">Note (optional)<input className="crm-input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Bill no. 4512, Dr Alam" /></label>
      {err && <p className="crm-error" role="alert" style={{ margin: 0 }}>{err}</p>}
      <span className="hc-form-acts"><button type="button" className="crm-btn is-secondary is-sm" onClick={onCancel}>Cancel</button><button type="button" className="crm-btn is-sm" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save visit'}</button></span>
    </div>
  );
}

function RenewForm({ card, plan, onCancel, onSaved }: { card: Card; plan: Plan; onCancel: () => void; onSaved: (m: string) => void }) {
  const [fee, setFee] = useState(String(plan.price));
  const [mode, setMode] = useState('cash');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    setBusy(true); setErr('');
    try { const c = await crm.post<Card>(`/api/v1/health-cards/${card.id}/renew`, { fee: mode === 'free' ? 0 : Number(fee || 0), payMode: mode }); onSaved(`Renewed: valid till ${dateText(c.validTill)}.`); }
    catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <div className="hc-form">
      <strong>Renew for another {validity(plan.validMonths)}</strong>
      <span className="crm-sub" style={{ fontSize: 13 }}>{card.status === 'expired' ? 'It has run out, so the new term starts today.' : `The new term starts the day after ${dateText(card.validTill)}.`}</span>
      <div className="hc-grid">
        <label className="crm-field">Fee (₹)<input className="crm-input" inputMode="decimal" value={mode === 'free' ? '0' : fee} disabled={mode === 'free'} onChange={(e) => setFee(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
      </div>
      <div className="crm-chips">{MODES.map((m) => <button key={m.key} type="button" className="crm-chip" aria-pressed={mode === m.key} onClick={() => setMode(m.key)}>{m.label}</button>)}</div>
      {err && <p className="crm-error" role="alert" style={{ margin: 0 }}>{err}</p>}
      <span className="hc-form-acts"><button type="button" className="crm-btn is-secondary is-sm" onClick={onCancel}>Cancel</button><button type="button" className="crm-btn is-sm" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Renew'}</button></span>
    </div>
  );
}

function CancelForm({ card, onCancel, onSaved }: { card: Card; onCancel: () => void; onSaved: (m: string) => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    setBusy(true); setErr('');
    try { await crm.post(`/api/v1/health-cards/${card.id}/cancel`, { reason }); onSaved(`Card ${card.number} cancelled.`); }
    catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <div className="hc-form is-bad">
      <strong>Cancel card {card.number}?</strong>
      <span className="crm-sub" style={{ fontSize: 13 }}>It can’t be used after this. Its visits stay in the records.</span>
      <label className="crm-field">Why<input className="crm-input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Given by mistake, or lost and replaced" /></label>
      {err && <p className="crm-error" role="alert" style={{ margin: 0 }}>{err}</p>}
      <span className="hc-form-acts"><button type="button" className="crm-btn is-secondary is-sm" onClick={onCancel}>Keep it</button><button type="button" className="crm-btn is-danger is-sm" disabled={busy} onClick={() => void save()}>Cancel card</button></span>
    </div>
  );
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));

/** Prints the card at bank-card size: front (holder, number, QR) and back (what it gives). */
export async function printCard(card: Card, plan: Plan | null) {
  const w = window.open('', '_blank');
  if (!w) return;
  const qr = await QRCode.toString(card.number, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0e1525', light: '#ffffff' } });
  const color = card.color ?? plan?.color ?? '#0a72d6';
  const ben = plan ? benefits(plan) : [];
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(card.number)}</title><style>
@page{size:auto;margin:12mm}body{font:12px/1.4 system-ui,sans-serif;color:#0f172a;display:flex;gap:10mm;flex-wrap:wrap;margin:0}
.c{width:85.6mm;height:54mm;border-radius:3.5mm;box-sizing:border-box;padding:4mm 5mm;position:relative;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.f{background:${color};color:#fff}.f:after{content:'';position:absolute;right:-18mm;top:-18mm;width:50mm;height:50mm;border-radius:50%;background:rgba(255,255,255,.12)}
.o{font-weight:800;font-size:10px;letter-spacing:.02em;opacity:.95}.k{font-size:9px;opacity:.85;text-transform:uppercase;letter-spacing:.08em}
.n{font:700 15px ui-monospace,Menlo,monospace;letter-spacing:.06em;margin-top:6mm}.h{font-size:13px;font-weight:700;margin-top:1mm}.m{font-size:9px;opacity:.9;margin-top:.5mm;max-width:52mm}
.q{position:absolute;right:5mm;bottom:5mm;width:17mm;height:17mm;background:#fff;padding:1mm;border-radius:1.5mm}.q svg{width:100%;height:100%}
.v{position:absolute;left:5mm;bottom:4mm;font-size:9px;opacity:.9}.b{background:#fff;border:.3mm solid #d6dae3}
.b h3{margin:0 0 2mm;font-size:11px;color:${color}}.b ul{margin:0;padding-left:4mm;font-size:9.5px}.b p{font-size:8.5px;color:#5a6478;position:absolute;bottom:3.5mm;left:5mm;right:5mm;margin:0}
</style></head><body>
<div class="c f"><div class="o">${esc(orgName('full'))}</div><div class="k">${esc(card.planName ?? plan?.name ?? 'Health card')}</div>
<div class="n">${esc(card.number)}</div><div class="h">${esc(card.holderName)}</div>
${card.members.length ? `<div class="m">+ ${esc(card.members.map((m) => m.name).join(', '))}</div>` : ''}
<div class="v">Valid ${esc(dateText(card.issuedOn))} – ${esc(dateText(card.validTill))}</div><div class="q">${qr}</div></div>
<div class="c b"><h3>${esc(plan?.name ?? 'Health card')} gives</h3><ul>${ben.map((x) => `<li>${esc(x)}</li>`).join('') || '<li>Ask at the hospital desk</li>'}</ul>
<p>Show this card at the hospital desk on every visit. Valid only for the people named on it, until ${esc(dateText(card.validTill))}.</p></div>
<script>window.onload=()=>setTimeout(()=>window.print(),200)</script></body></html>`);
  w.document.close();
}
