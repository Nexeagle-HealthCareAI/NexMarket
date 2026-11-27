'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { BarChart3, CreditCard, Download, Layers, Pencil, Plus, ScanSearch, Search } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { canEdit, useAccess } from '@/lib/crm/access';
import { PageTabs, usePageTab } from '@/components/crm/PageTabs';
import { Pager } from '@/components/crm/Pager';
import { Empty, ErrorBox, friendlyError, Modal, PageHead, Pill, rupees, Skeleton, useLoader, useToast } from '@/components/crm/ui';
import { CardView } from '@/components/crm/cards/CardView';
import { FEATURES } from '@/lib/crm/features';
import { IssueCard } from '@/components/crm/cards/IssueCard';
import { benefits, covers, dateText, SOURCE, STATUS, validity, type Card, type CardStatus, type Plan } from '@/components/crm/cards/shared';

const TABS = ['cards', 'results', 'types'] as const;

export default function HealthCardsPageWrap() {
  if (!FEATURES.healthCards) return (
    <main className="crm-page"><PageHead title="Health cards" />
      <Empty title="Health cards are switched off for now">Cards already given are kept. Ask the NexMarket team to switch them back on.</Empty></main>
  );
  return <Suspense fallback={<main className="crm-page"><Skeleton h={480} /></main>}><HealthCardsPage /></Suspense>;
}

/**
 * The hospital's own health cards: give them at camps, through agents or at the desk; check one when the patient comes;
 * record each visit with the discount it gave; and see what the cards bring in.
 */
function HealthCardsPage() {
  const { access } = useAccess();
  const editable = canEdit(access, 'camps') || canEdit(access, 'desk');
  const [tab, setTab] = usePageTab(TABS, 'cards');
  const [toast, showToast] = useToast();
  const [issuing, setIssuing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  return (
    <main className="crm-page">
      <PageHead title="Health cards" sub="The hospital’s own card: give it at camps, through field agents or at the desk, check it when the patient comes, and see what the cards bring in.">
        {editable && <button type="button" className="crm-btn" onClick={() => setIssuing(true)}><Plus size={16} aria-hidden /> Give a card</button>}
      </PageHead>
      <CheckBar onOpen={setOpen} />
      <PageTabs label="Health cards" value={tab} onChange={setTab} tabs={[
        { key: 'cards', label: 'Cards', icon: CreditCard },
        { key: 'results', label: 'What cards bring in', icon: BarChart3 },
        { key: 'types', label: 'Card types', icon: Layers },
      ]} />
      {tab === 'cards' && <CardsTab key={version} onOpen={setOpen} toast={showToast} />}
      {tab === 'results' && <ResultsTab key={version} />}
      {tab === 'types' && <TypesTab editable={editable} toast={showToast} />}
      {issuing && <IssueCard onClose={() => setIssuing(false)} onIssued={(c) => { setIssuing(false); showToast(`Card ${c.number} given to ${c.holderName}.`); bump(); setOpen(c.id); }} />}
      {open && <CardView id={open} editable={editable} onClose={() => setOpen(null)} onChanged={bump} toast={showToast} />}
      {toast}
    </main>
  );
}

/** At the desk: type the card number or the mobile, see at once whether it is valid. */
function CheckBar({ onOpen }: { onOpen: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Card[] | null>(null);
  useEffect(() => {
    const s = q.trim();
    if (s.length < 3) { const t = setTimeout(() => setRes(null), 0); return () => clearTimeout(t); }
    const t = setTimeout(() => { crm.get<Card[]>(`/api/v1/health-cards/check?q=${encodeURIComponent(s)}`).then(setRes).catch(() => setRes([])); }, 300);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <section className="crm-card hc-check" aria-label="Check a card">
      <label className="crm-search" style={{ flex: '1 1 320px', maxWidth: 520 }}>
        <ScanSearch size={17} aria-hidden /><span className="crm-sr">Card number or mobile</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Check a card: card number (HC26-00042) or mobile" />
      </label>
      {res && (res.length === 0 ? <span className="crm-sub">No card found for “{q.trim()}”.</span> : (
        <ul className="hc-check-list">
          {res.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onOpen(c.id)}>
                <span className="hc-dot" style={{ background: c.color ?? '#0a72d6' }} aria-hidden />
                <strong>{c.number}</strong> {c.holderName}{c.members.length ? ` + ${c.members.length}` : ''}
                <Pill tone={STATUS[c.status].tone}>{STATUS[c.status].label}{c.status !== 'cancelled' ? ` · till ${dateText(c.validTill, false)}` : ''}</Pill>
                {c.freeLeft > 0 && c.status !== 'expired' && c.status !== 'cancelled' && <span className="crm-cell-sub">{c.freeLeft} free OPD left</span>}
              </button>
            </li>
          ))}
        </ul>
      ))}
    </section>
  );
}

interface ListRes { items: Card[]; total: number; page: number; pageSize: number; counts: Record<'all' | CardStatus, number> }

function CardsTab({ onOpen, toast }: { onOpen: (id: string) => void; toast: (m: string) => void }) {
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const [status, setStatus] = useState<'' | CardStatus>('');
  const [source, setSource] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  useEffect(() => { const t = setTimeout(() => { setQd(q.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const qs = useMemo(() => { const sp = new URLSearchParams({ page: String(page), pageSize: String(size) }); if (qd) sp.set('q', qd); if (status) sp.set('status', status); if (source) sp.set('source', source); return sp.toString(); }, [qd, status, source, page, size]);
  const data = useLoader(() => crm.get<ListRes>(`/api/v1/health-cards?${qs}`), [qs]);
  const d = data.data;
  const exportCsv = async () => { try { await crm.download('/api/v1/health-cards/export', 'health-cards.csv'); } catch (e) { toast(friendlyError(e)); } };
  return (
    <section className="crm-card hc-list" aria-label="Cards">
      <div className="hc-tools">
        <label className="crm-search" style={{ flex: '1 1 240px' }}><Search size={16} aria-hidden /><span className="crm-sr">Search cards</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, card number, mobile or village" /></label>
        <select className="crm-select ms-sel" aria-label="Given at" value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }}>
          <option value="">Given anywhere</option><option value="camp">At health camps</option><option value="agent">By field agents</option><option value="desk">At the desk</option>
        </select>
        <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void exportCsv()}><Download size={15} aria-hidden /> Export</button>
      </div>
      <div className="crm-chips" role="group" aria-label="Status">
        {([['', 'All', 'all'], ['active', 'Valid', 'active'], ['expiring', 'Ending in 30 days', 'expiring'], ['expired', 'Expired', 'expired'], ['cancelled', 'Cancelled', 'cancelled']] as const).map(([k, l, c]) => (
          <button key={k} type="button" className="crm-chip" aria-pressed={status === k} onClick={() => { setStatus(k as '' | CardStatus); setPage(1); }}>{l}<span className="ld-chip-n">{d?.counts[c] ?? 0}</span></button>
        ))}
      </div>
      {data.error ? <ErrorBox message={data.error} onRetry={data.reload} /> : !d ? <Skeleton h={300} /> : d.items.length === 0 ? (
        <Empty title={qd || status || source ? 'No cards match' : 'No cards given yet'}>Give cards from a camp’s register, or with “Give a card” above.</Empty>
      ) : (
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead><tr><th scope="col">Card</th><th scope="col">Holder</th><th scope="col">Given</th><th scope="col">Valid till</th><th scope="col" className="wb-num">Visits</th><th scope="col" className="wb-num">Billed</th><th scope="col" className="wb-num">Discount</th></tr></thead>
            <tbody>
              {d.items.map((c) => (
                <tr key={c.id}>
                  <td><button type="button" className="wa-link hc-num" onClick={() => onOpen(c.id)}><span className="hc-dot" style={{ background: c.color ?? '#0a72d6' }} aria-hidden />{c.number}</button><span className="crm-cell-sub" style={{ display: 'block' }}>{c.planName}</span></td>
                  <td><strong>{c.holderName}</strong>{c.members.length > 0 && <span className="crm-cell-sub"> + {c.members.length}</span>}<span className="crm-cell-sub" style={{ display: 'block' }}>{[c.phone, c.village].filter(Boolean).join(' · ')}</span></td>
                  <td>{SOURCE[c.source]}<span className="crm-cell-sub" style={{ display: 'block' }}>{c.campTitle ?? c.agentName ?? c.createdByName} · {dateText(c.issuedOn, false)}</span></td>
                  <td><Pill tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Pill><span className="crm-cell-sub" style={{ display: 'block' }}>{dateText(c.validTill)}</span></td>
                  <td className="wb-num">{c.visits || '–'}</td>
                  <td className="wb-num">{c.billed ? rupees(c.billed) : '–'}</td>
                  <td className="wb-num">{c.discount ? rupees(c.discount) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {d && <Pager page={page} pages={Math.max(1, Math.ceil(d.total / size))} total={d.total} size={size} onPage={setPage} onSize={(n) => { setSize(n); setPage(1); }} noun="cards" />}
    </section>
  );
}

interface VT { visits: number; people: number; opd: number; admitted: number; free: number; billed: number; discount: number; net: number }
interface Res {
  from: string; to: string;
  cards: { issued: number; fromCamps: number; byAgents: number; atDesk: number; used: number; feeCollected: number; renewals: number; activeNow: number; expiringSoon: number };
  visits: VT;
  byPlan: { id: string; name: string; color: string; issued: number; fee: number; visits: VT }[];
  byCamp: { id: string; title: string; date: string; block?: string | null; issued: number; used: number; visits: VT }[];
  byAgent: { agentId: string; name: string; issued: number; used: number }[];
  byKind: { kind: string; n: number; billed: number; discount: number }[];
}
const ist = () => new Date(Date.now() + 5.5 * 3600e3);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const RANGES: [string, string][] = [['month', 'This month'], ['last', 'Last month'], ['3m', 'Last 3 months'], ['year', 'This year']];
function rangeOf(k: string): [string, string] {
  const t = ist(); const y = t.getUTCFullYear(); const m = t.getUTCMonth();
  if (k === 'last') return [iso(new Date(Date.UTC(y, m - 1, 1))), iso(new Date(Date.UTC(y, m, 0)))];
  if (k === '3m') return [iso(new Date(Date.UTC(y, m - 2, 1))), iso(t)];
  if (k === 'year') return [iso(new Date(Date.UTC(y, 0, 1))), iso(t)];
  return [iso(new Date(Date.UTC(y, m, 1))), iso(t)];
}

function ResultsTab() {
  const [range, setRange] = useState('month');
  const [from, to] = rangeOf(range);
  const data = useLoader(() => crm.get<Res>(`/api/v1/health-cards/results?from=${from}&to=${to}`), [from, to]);
  const d = data.data;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  return (
    <div className="pr-wrap">
      <div className="crm-chips" role="group" aria-label="Days">{RANGES.map(([k, l]) => <button key={k} type="button" className="crm-chip" aria-pressed={range === k} onClick={() => setRange(k)}>{l}</button>)}</div>
      {data.error ? <ErrorBox message={data.error} onRetry={data.reload} /> : !d ? <Skeleton h={360} /> : <>
        <section className="hc-sum">
          <div><span>Cards given</span><strong>{d.cards.issued}</strong><em>{d.cards.fromCamps} at camps · {d.cards.byAgents} by agents · {d.cards.atDesk} at the desk</em></div>
          <div><span>Card fees received</span><strong>{rupees(d.cards.feeCollected)}</strong><em>{d.cards.renewals} renewal{d.cards.renewals === 1 ? '' : 's'}</em></div>
          <div><span>Used at least once</span><strong>{d.cards.used}</strong><em>{pct(d.cards.used, d.cards.issued)}% of cards given in these days</em></div>
          <div><span>Valid cards now</span><strong>{d.cards.activeNow}</strong><em>{d.cards.expiringSoon} end in the next 30 days</em></div>
        </section>
        <section className="pr-f-money hc-money">
          <div><span>Visits with a card</span><strong>{d.visits.visits}</strong><em>{d.visits.people} people · {d.visits.opd} OPD · {d.visits.admitted} admitted · {d.visits.free} free</em></div>
          <div><span>Billed to card holders</span><strong>{rupees(d.visits.billed)}</strong><em>before card discounts</em></div>
          <div><span>Discount given</span><strong>{rupees(d.visits.discount)}</strong><em>{pct(d.visits.discount, d.visits.billed)}% of what was billed</em></div>
          <div><span>Paid by card holders</span><strong className="is-ok">{rupees(d.visits.net)}</strong><em>billed − discount</em></div>
        </section>
        {d.byCamp.length > 0 && (
          <section className="crm-card pr-sec"><h2 className="crm-h2">Cards from health camps</h2>
            <div className="crm-table-wrap"><table className="crm-table pr-table">
              <thead><tr><th scope="col">Camp</th><th scope="col" className="num">Cards given</th><th scope="col" className="num">Used</th><th scope="col" className="num">Visits</th><th scope="col" className="num">Billed</th><th scope="col" className="num">Discount</th></tr></thead>
              <tbody>{d.byCamp.map((c) => (
                <tr key={c.id}><td><strong>{c.title}</strong><span className="crm-cell-sub" style={{ display: 'block' }}>{dateText(c.date, false)}{c.block ? ` · ${c.block}` : ''}</span></td>
                  <td className="num">{c.issued || '–'}</td><td className="num">{c.used ? `${c.used} (${pct(c.used, c.issued)}%)` : '–'}</td><td className="num">{c.visits.visits || '–'}</td>
                  <td className="num"><strong>{c.visits.billed ? rupees(c.visits.billed) : '–'}</strong></td><td className="num">{c.visits.discount ? rupees(c.visits.discount) : '–'}</td></tr>
              ))}</tbody>
            </table></div>
          </section>
        )}
        <div className="hc-two">
          {d.byPlan.length > 0 && (
            <section className="crm-card pr-sec"><h2 className="crm-h2">By card type</h2>
              <ul className="hc-rows">{d.byPlan.map((p) => (
                <li key={p.id}><span className="hc-dot" style={{ background: p.color }} aria-hidden /><strong>{p.name}</strong>
                  <span className="crm-cell-sub">{p.issued} given · {rupees(p.fee)} fees · {p.visits.visits} visits · {rupees(p.visits.billed)} billed</span></li>
              ))}</ul>
            </section>
          )}
          {d.byAgent.length > 0 && (
            <section className="crm-card pr-sec"><h2 className="crm-h2">Given by field agents</h2>
              <ul className="hc-rows">{d.byAgent.map((a) => <li key={a.agentId}><strong>{a.name}</strong><span className="crm-cell-sub">{a.issued} given · {a.used} used</span></li>)}</ul>
            </section>
          )}
          {d.byKind.length > 0 && (
            <section className="crm-card pr-sec"><h2 className="crm-h2">Visits by kind</h2>
              <ul className="hc-rows">{d.byKind.map((k) => <li key={k.kind}><strong>{({ opd: 'OPD', ipd: 'Admission', procedure: 'Procedure', lab: 'Lab', pharmacy: 'Pharmacy', other: 'Other' } as Record<string, string>)[k.kind]}</strong><span className="crm-cell-sub">{k.n} visits · {rupees(k.billed)} billed · {rupees(k.discount)} discount</span></li>)}</ul>
            </section>
          )}
        </div>
      </>}
    </div>
  );
}

function TypesTab({ editable, toast }: { editable: boolean; toast: (m: string) => void }) {
  const data = useLoader(() => crm.get<Plan[]>('/api/v1/health-cards/plans'), []);
  const [edit, setEdit] = useState<Plan | 'new' | null>(null);
  return (
    <section className="pr-wrap" aria-label="Card types">
      {editable && <button type="button" className="crm-btn is-secondary" style={{ alignSelf: 'flex-start' }} onClick={() => setEdit('new')}><Plus size={16} aria-hidden /> New card type</button>}
      {data.error ? <ErrorBox message={data.error} onRetry={data.reload} /> : !data.data ? <Skeleton h={200} /> : data.data.length === 0 ? (
        <section className="crm-card"><Empty title="No card types yet">Set up the card you give: its price, how long it lasts, how many family members it covers, and the discounts.</Empty></section>
      ) : (
        <div className="hc-types">
          {data.data.map((p) => (
            <article key={p.id} className={`crm-card hc-type${p.active ? '' : ' is-off'}`} style={{ ['--hc' as string]: p.color }}>
              <div className="hc-type-head"><strong>{p.name}</strong><b>{p.price ? rupees(p.price) : 'Free'}</b></div>
              <span className="crm-cell-sub">{covers(p)} · valid {validity(p.validMonths)}{p.active ? '' : ' · not given any more'}</span>
              <ul>{benefits(p).map((b) => <li key={b}>{b}</li>)}{benefits(p).length === 0 && <li>No discounts set</li>}</ul>
              {editable && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setEdit(p)}><Pencil size={14} aria-hidden /> Change</button>}
            </article>
          ))}
        </div>
      )}
      {edit && <PlanForm plan={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={(m) => { setEdit(null); toast(m); void data.reload(); }} />}
    </section>
  );
}

const COLORS = ['#0a72d6', '#0f8a5f', '#7b3fe4', '#c2185b', '#d9822b', '#0e7490', '#b45309', '#0e1525'];

function PlanForm({ plan, onClose, onSaved }: { plan: Plan | null; onClose: () => void; onSaved: (m: string) => void }) {
  const [f, setF] = useState({
    name: plan?.name ?? '', price: String(plan?.price ?? 199), validMonths: String(plan?.validMonths ?? 12), maxMembers: String(plan?.maxMembers ?? 4),
    opd: String(plan?.opdDiscountPct ?? 20), ipd: String(plan?.ipdDiscountPct ?? 10), lab: String(plan?.labDiscountPct ?? 15), pharmacy: String(plan?.pharmacyDiscountPct ?? 0),
    free: String(plan?.freeOpdVisits ?? 1), extras: plan?.extras ?? '', color: plan?.color ?? COLORS[0], active: plan?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const num = (v: string) => (v.trim() === '' ? 0 : Number(v));
  const save = async () => {
    setBusy(true); setErr('');
    const body = { name: f.name, price: num(f.price), validMonths: num(f.validMonths), maxMembers: num(f.maxMembers), opdDiscountPct: num(f.opd), ipdDiscountPct: num(f.ipd),
      labDiscountPct: num(f.lab), pharmacyDiscountPct: num(f.pharmacy), freeOpdVisits: num(f.free), extras: f.extras, color: f.color, active: f.active };
    try {
      if (plan) await crm.put(`/api/v1/health-cards/plans/${plan.id}`, body); else await crm.post('/api/v1/health-cards/plans', body);
      onSaved(plan ? 'Card type saved. Cards already given keep their dates.' : `${f.name} added.`);
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={plan ? `Change ${plan.name}` : 'New card type'} onClose={onClose} wide actions={<>
      <button type="button" className="crm-btn is-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="crm-btn" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
    </>}>
      <div className="hc-grid">
        <label className="crm-field hc-span2">Name<input className="crm-input" value={f.name} maxLength={80} onChange={set('name')} placeholder="e.g. Family health card" /></label>
        <label className="crm-field">Price (₹)<input className="crm-input" inputMode="decimal" value={f.price} onChange={set('price')} /></label>
        <label className="crm-field">Valid for (months)<input className="crm-input" inputMode="numeric" value={f.validMonths} onChange={set('validMonths')} /></label>
        <label className="crm-field">People it covers<input className="crm-input" inputMode="numeric" value={f.maxMembers} onChange={set('maxMembers')} /></label>
        <label className="crm-field">Free OPD visits<input className="crm-input" inputMode="numeric" value={f.free} onChange={set('free')} /></label>
      </div>
      <div className="hc-grid">
        <label className="crm-field">OPD discount %<input className="crm-input" inputMode="decimal" value={f.opd} onChange={set('opd')} /></label>
        <label className="crm-field">Admission / procedure %<input className="crm-input" inputMode="decimal" value={f.ipd} onChange={set('ipd')} /></label>
        <label className="crm-field">Lab tests %<input className="crm-input" inputMode="decimal" value={f.lab} onChange={set('lab')} /></label>
        <label className="crm-field">Pharmacy %<input className="crm-input" inputMode="decimal" value={f.pharmacy} onChange={set('pharmacy')} /></label>
      </div>
      <label className="crm-field">Anything else it gives (one per line)<textarea className="crm-textarea" style={{ minHeight: 64 }} value={f.extras} maxLength={600} onChange={set('extras')} placeholder={'Free BP and sugar check every visit\nPriority at the OPD counter'} /></label>
      <div className="crm-field">Colour on the card
        <div className="crm-chips">{COLORS.map((c) => <button key={c} type="button" className="hc-swatch" aria-label={c} aria-pressed={f.color === c} style={{ background: c }} onClick={() => setF((x) => ({ ...x, color: c }))} />)}</div>
      </div>
      {plan && <label className="at-check"><input type="checkbox" checked={f.active} onChange={(e) => setF((x) => ({ ...x, active: e.target.checked }))} /> Still given (untick to stop giving this kind; cards already given keep working)</label>}
      {err && <p className="crm-error" role="alert" style={{ margin: 0 }}>{err}</p>}
    </Modal>
  );
}
