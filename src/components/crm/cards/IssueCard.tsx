'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { friendlyError, Modal, rupees, Skeleton } from '@/components/crm/ui';
import { benefits, covers, dateText, MODES, todayIso, validity, type Card, type Member, type Plan } from './shared';

export interface IssuePrefill {
  holderName?: string; phone?: string | null; age?: number | null; sex?: string | null; village?: string | null;
  campPatientId?: string; campId?: string; campTitle?: string; source?: 'camp' | 'agent' | 'desk';
}

/** Give a health card: pick the kind, the holder and family members, and the fee taken. */
export function IssueCard({ prefill, onClose, onIssued }: { prefill?: IssuePrefill; onClose: () => void; onIssued: (c: Card) => void }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [agents, setAgents] = useState<{ agentId: string; name: string }[]>([]);
  const [planId, setPlanId] = useState('');
  const [name, setName] = useState(prefill?.holderName ?? '');
  const [phone, setPhone] = useState((prefill?.phone ?? '').replace(/^91(?=\d{10}$)/, ''));
  const [age, setAge] = useState(prefill?.age != null ? String(prefill.age) : '');
  const [sex, setSex] = useState(prefill?.sex ?? '');
  const [village, setVillage] = useState(prefill?.village ?? '');
  const [members, setMembers] = useState<Member[]>([]);
  const [source, setSource] = useState<'camp' | 'agent' | 'desk'>(prefill?.source ?? (prefill?.campPatientId ? 'camp' : 'desk'));
  const [agentId, setAgentId] = useState('');
  const [fee, setFee] = useState('');
  const [mode, setMode] = useState('cash');
  const [on, setOn] = useState(todayIso());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    crm.get<Plan[]>('/api/v1/health-cards/plans').then((p) => {
      const act = p.filter((x) => x.active);
      setPlans(act);
      if (act[0]) { setPlanId(act[0].id); setFee(String(act[0].price)); }
    }).catch((e) => setErr(friendlyError(e)));
    crm.get<{ agentId: string; name: string }[]>('/api/v1/health-cards/agents').then(setAgents).catch(() => undefined);
  }, []);
  const plan = plans?.find((p) => p.id === planId) ?? null;
  const pick = (id: string) => { setPlanId(id); const p = plans?.find((x) => x.id === id); if (p) { setFee(String(p.price)); setMembers((m) => m.slice(0, Math.max(0, p.maxMembers - 1))); } };

  const save = async () => {
    if (!plan) { setErr('Pick the kind of card.'); return; }
    if (!name.trim()) { setErr('Write the card holder’s name.'); return; }
    setBusy(true); setErr('');
    try {
      const c = await crm.post<Card>('/api/v1/health-cards', {
        planId, holderName: name, phone: phone || null, age: age ? Number(age) : null, sex: sex || null, village: village || null,
        members: members.filter((m) => m.name.trim()), issuedOn: on, fee: mode === 'free' ? 0 : Number(fee || 0), payMode: mode,
        source, agentId: source === 'agent' ? agentId || null : null, campPatientId: prefill?.campPatientId, campId: prefill?.campId, note: note || null,
      });
      onIssued(c);
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <Modal title={prefill?.holderName ? `Health card for ${prefill.holderName}` : 'Give a health card'} onClose={onClose} wide
      actions={<>
        <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="crm-btn" disabled={busy || !plan} onClick={() => void save()}>{busy ? 'Saving…' : 'Give card'}</button>
      </>}>
      {!plans ? <Skeleton h={200} /> : plans.length === 0 ? (
        <p className="ms-warn" style={{ margin: 0 }}>No kinds of card yet. Set one up in Health cards → Card types (price, how long it lasts, discounts).</p>
      ) : <>
        {prefill?.campTitle && <p className="crm-sub" style={{ margin: 0 }}>Given at the health camp <strong>{prefill.campTitle}</strong>. It shows on their place on the Referral desk when they come.</p>}
        <div className="hc-plans" role="radiogroup" aria-label="Kind of card">
          {plans.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={planId === p.id} className="hc-plan-pick" style={{ ['--hc' as string]: p.color }} onClick={() => pick(p.id)}>
              <span className="hc-plan-top"><strong>{p.name}</strong><b>{p.price ? rupees(p.price) : 'Free'}</b></span>
              <span className="crm-cell-sub">{covers(p)} · {validity(p.validMonths)}</span>
              <span className="hc-plan-ben">{benefits(p).slice(0, 3).join(' · ') || 'No discounts set'}</span>
            </button>
          ))}
        </div>
        <div className="hc-grid">
          <label className="crm-field hc-span2">Card holder<input className="crm-input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Full name" /></label>
          <label className="crm-field">Mobile<input className="crm-input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^0-9+ ]/g, ''))} placeholder="10 digits" /></label>
          <label className="crm-field">Age<input className="crm-input" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, '').slice(0, 3))} /></label>
          <label className="crm-field">Gender
            <select className="crm-input" value={sex} onChange={(e) => setSex(e.target.value)}><option value="">—</option><option value="F">Female</option><option value="M">Male</option><option value="O">Other</option></select>
          </label>
          <label className="crm-field">Village<input className="crm-input" value={village} maxLength={80} onChange={(e) => setVillage(e.target.value)} /></label>
        </div>

        {plan && plan.maxMembers > 1 && (
          <div className="crm-field">Family members on the card <span className="crm-cell-sub" style={{ fontWeight: 400 }}>({members.length} of {plan.maxMembers - 1} more)</span>
            {members.map((m, i) => (
              <div key={i} className="hc-member">
                <input className="crm-input" aria-label={`Member ${i + 1} name`} value={m.name} maxLength={80} placeholder="Name" onChange={(e) => setMembers((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <input className="crm-input" aria-label={`Member ${i + 1} relation`} value={m.relation ?? ''} maxLength={30} placeholder="Relation (wife, son…)" onChange={(e) => setMembers((l) => l.map((x, j) => (j === i ? { ...x, relation: e.target.value } : x)))} />
                <input className="crm-input" aria-label={`Member ${i + 1} age`} inputMode="numeric" value={m.age ?? ''} placeholder="Age" onChange={(e) => setMembers((l) => l.map((x, j) => (j === i ? { ...x, age: e.target.value ? Number(e.target.value.replace(/\D/g, '').slice(0, 3)) : null } : x)))} />
                <button type="button" className="crm-btn is-ghost is-sm" aria-label="Remove member" onClick={() => setMembers((l) => l.filter((_, j) => j !== i))}><Trash2 size={15} aria-hidden /></button>
              </div>
            ))}
            {members.length < plan.maxMembers - 1 && <button type="button" className="crm-btn is-secondary is-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setMembers((l) => [...l, { name: '' }])}><Plus size={14} aria-hidden /> Add a family member</button>}
          </div>
        )}

        <div className="hc-grid">
          <label className="crm-field">Given at
            <select className="crm-input" value={source} onChange={(e) => setSource(e.target.value as 'camp' | 'agent' | 'desk')} disabled={!!prefill?.campPatientId}>
              <option value="desk">Hospital desk</option><option value="camp">Health camp</option><option value="agent">By a field agent</option>
            </select>
          </label>
          {source === 'agent' && (
            <label className="crm-field">Agent
              <select className="crm-input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">Pick the agent</option>{agents.map((a) => <option key={a.agentId} value={a.agentId}>{a.name}</option>)}
              </select>
            </label>
          )}
          <label className="crm-field">Given on<input className="crm-input" type="date" value={on} max={todayIso()} onChange={(e) => setOn(e.target.value)} /></label>
          <label className="crm-field">Fee (₹)<input className="crm-input" inputMode="decimal" value={mode === 'free' ? '0' : fee} disabled={mode === 'free'} onChange={(e) => setFee(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
        </div>
        <div className="crm-chips" role="group" aria-label="Paid by">
          {MODES.map((m) => <button key={m.key} type="button" className="crm-chip" aria-pressed={mode === m.key} onClick={() => setMode(m.key)}>{m.label}</button>)}
        </div>
        <label className="crm-field">Note (optional)<input className="crm-input" value={note} maxLength={400} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Given free to ASHA worker's family" /></label>
        {plan && <p className="crm-sub" style={{ margin: 0, fontSize: 13 }}>Valid for {validity(plan.validMonths)} from {dateText(on)}. {benefits(plan).join(' · ')}</p>}
      </>}
      {err && <p className="crm-error" role="alert" style={{ margin: 0 }}>{err}</p>}
    </Modal>
  );
}
