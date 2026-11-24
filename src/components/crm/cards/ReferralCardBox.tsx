'use client';

import { useState } from 'react';
import { CreditCard, Link2, Plus, Unlink } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { friendlyError, Pill, Skeleton, useLoader, useToast } from '@/components/crm/ui';
import { CardView } from './CardView';
import { IssueCard } from './IssueCard';
import { dateText, STATUS, type Card } from './shared';

interface ForRef { linked: Card | null; suggestions: Card[] }

/**
 * On a patient at the Referral desk: their hospital health card (valid or not, free OPD visits left), a one-tap link when
 * a card with the same mobile is found, and "Record a visit" so the card's discount is kept with the bill.
 */
export function ReferralCardBox({ clientId, patient, editable }: {
  clientId: string; editable: boolean; patient: { name: string; phone?: string | null; age?: number | null; sex?: string | null };
}) {
  const data = useLoader(() => crm.get<ForRef>(`/api/v1/health-cards/for-referral/${encodeURIComponent(clientId)}`), [clientId]);
  const [open, setOpen] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [find, setFind] = useState('');
  const [found, setFound] = useState<Card[] | null>(null);
  const [toast, showToast] = useToast();
  const link = async (cardId: string | null) => {
    try { await crm.put(`/api/v1/health-cards/for-referral/${encodeURIComponent(clientId)}`, { cardId }); showToast(cardId ? 'Card linked to this patient.' : 'Card unlinked.'); setFound(null); void data.reload(); }
    catch (e) { showToast(friendlyError(e)); }
  };
  const search = async () => {
    if (find.trim().length < 3) return;
    try { setFound(await crm.get<Card[]>(`/api/v1/health-cards/check?q=${encodeURIComponent(find.trim())}`)); } catch (e) { showToast(friendlyError(e)); }
  };
  const d = data.data;
  const c = d?.linked;
  return (
    <section className="hc-ref" aria-label="Health card">
      <h3><CreditCard size={16} aria-hidden /> Hospital health card</h3>
      {!d ? <Skeleton h={50} /> : c ? (
        <div className="hc-ref-card" style={{ ['--hc' as string]: c.color ?? '#0a72d6' }}>
          <span className="hc-ref-main">
            <strong>{c.number}</strong> · {c.planName} · {c.holderName}{c.members.length ? ` + ${c.members.length}` : ''}
            <span className="crm-cell-sub">{STATUS[c.status].label} till {dateText(c.validTill)}{c.freeLeft > 0 ? ` · ${c.freeLeft} free OPD left` : ''} · {c.visits} visit{c.visits === 1 ? '' : 's'}</span>
          </span>
          <Pill tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Pill>
          <button type="button" className="crm-btn is-sm" onClick={() => setOpen(true)}>{editable && (c.status === 'active' || c.status === 'expiring') ? 'Record a visit' : 'Open card'}</button>
          {editable && <button type="button" className="crm-btn is-ghost is-sm" aria-label="Unlink card" title="Not this patient's card: unlink" onClick={() => void link(null)}><Unlink size={15} aria-hidden /></button>}
        </div>
      ) : <>
        {d.suggestions.length > 0 && (
          <ul className="hc-ref-sug">
            {d.suggestions.map((s) => (
              <li key={s.id}><span><strong>{s.number}</strong> {s.holderName} · <Pill tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Pill> <span className="crm-cell-sub">same mobile</span></span>
                {editable && <button type="button" className="crm-btn is-sm" onClick={() => void link(s.id)}><Link2 size={14} aria-hidden /> This is their card</button>}</li>
            ))}
          </ul>
        )}
        {d.suggestions.length === 0 && <span className="crm-sub" style={{ fontSize: 13 }}>No card linked. If they show one, find it by its number.</span>}
        {editable && (
          <div className="hc-ref-find">
            <input className="crm-input" aria-label="Card number or mobile" value={find} onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void search(); }} placeholder="Card number or mobile" />
            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void search()}>Find</button>
            <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setIssuing(true)}><Plus size={14} aria-hidden /> Give a card</button>
          </div>
        )}
        {found && (found.length === 0 ? <span className="crm-sub" style={{ fontSize: 13 }}>No card found.</span> : (
          <ul className="hc-ref-sug">{found.map((s) => (
            <li key={s.id}><span><strong>{s.number}</strong> {s.holderName} · <Pill tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Pill></span>
              <button type="button" className="crm-btn is-sm" onClick={() => void link(s.id)}><Link2 size={14} aria-hidden /> Link</button></li>
          ))}</ul>
        ))}
      </>}
      {open && c && <CardView id={c.id} editable={editable} referralClientId={editable && (c.status === 'active' || c.status === 'expiring') ? clientId : undefined}
        onClose={() => setOpen(false)} onChanged={() => void data.reload()} toast={showToast} />}
      {issuing && <IssueCard prefill={{ holderName: patient.name, phone: patient.phone, age: patient.age, sex: patient.sex, source: 'desk' }} onClose={() => setIssuing(false)}
        onIssued={(card) => { setIssuing(false); void link(card.id); }} />}
      {toast}
    </section>
  );
}
