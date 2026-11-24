'use client';

import { useMemo, useState } from 'react';
import { CreditCard, Download, Tent, UserRound, Users } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { Empty, ErrorBox, friendlyError, Pill, rupees, Skeleton, useLoader } from '@/components/crm/ui';
import { Pager, usePaged } from '@/components/crm/Pager';

export interface Tally {
  referred: number; came: number; opd: number; admitted: number; outcomeOpen: number; waiting: number; lost: number;
  cameRate: number; admittedRate: number; billed: number; collected: number; outstanding: number; opdBilled: number; ipdBilled: number; perPatient: number;
}
type Origin = 'all' | 'camp' | 'agent' | 'partner';
type Outcome = 'admitted' | 'opd' | 'came' | 'lost' | 'waiting';
interface Res {
  from: string; to: string; origin: Origin; total: Tally; withCard?: Tally; count: number;
  byOrigin: { key: Exclude<Origin, 'all'>; label: string; tally: Tally }[];
  camps: { id: string; title: string; date: string; block?: string | null; status: string; seen: number; cost: number; tally: Tally; returnOnCost: number | null }[];
  agents: { agentId: string; name: string; block?: string | null; tally: Tally }[];
  departments: { name: string; tally: Tally }[];
  months: { month: string; camp: Tally; agent: Tally; all: Tally }[];
  patients: { clientId: string; name: string; department: string; origin: Exclude<Origin, 'all'>; from?: string | null; referredAt: string; arrivedAt?: string | null; admittedAt?: string | null; status: string; outcome: Outcome; billed: number; collected: number; card?: string | null }[];
}

const OUTCOME: Record<Outcome, { label: string; tone: 'ok' | 'info' | 'accent' | 'neutral' | 'bad' }> = {
  admitted: { label: 'Admitted', tone: 'ok' }, opd: { label: 'OPD', tone: 'info' }, came: { label: 'Came · not recorded', tone: 'accent' },
  waiting: { label: 'Not come yet', tone: 'neutral' }, lost: { label: 'Did not come', tone: 'bad' },
};
const ORIGIN_ICON = { camp: Tent, agent: UserRound, partner: Users } as const;
const SHORT: Record<Exclude<Origin, 'all'>, string> = { camp: 'Health camp', agent: 'Field agent', partner: 'Partner' };

const ist = () => new Date(Date.now() + 5.5 * 3600e3);
const iso = (d: Date) => d.toISOString().slice(0, 10);
function rangeOf(k: string): [string, string] {
  const t = ist(); const y = t.getUTCFullYear(); const m = t.getUTCMonth();
  if (k === 'last') return [iso(new Date(Date.UTC(y, m - 1, 1))), iso(new Date(Date.UTC(y, m, 0)))];
  if (k === '3m') return [iso(new Date(Date.UTC(y, m - 2, 1))), iso(t)];
  if (k === 'year') return [iso(new Date(Date.UTC(y, 0, 1))), iso(t)];
  return [iso(new Date(Date.UTC(y, m, 1))), iso(t)];
}
const RANGES = [['month', 'This month'], ['last', 'Last month'], ['3m', 'Last 3 months'], ['year', 'This year'], ['custom', 'Custom']] as const;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const dayText = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const monthText = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });

/**
 * Patients from health camps, field agents and partners: how many came, OPD or admitted, and what they brought in.
 * Counts the patients sent in the chosen days and everything that has happened to them since.
 */
export function ResultsTab({ onOpen, toast }: { onOpen: (clientId: string) => void; toast: (m: string) => void }) {
  const [range, setRange] = useState<string>('month');
  const [[from, to], setDates] = useState<[string, string]>(rangeOf('month'));
  const [origin, setOrigin] = useState<Origin>('all');
  const data = useLoader(() => crm.get<Res>(`/api/v1/referrals/results?from=${from}&to=${to}&origin=${origin}`), [from, to, origin]);
  const d = data.data;
  const [outcome, setOutcome] = useState<Outcome | 'all'>('all');
  const pts = useMemo(() => (d?.patients ?? []).filter((p) => outcome === 'all' || p.outcome === outcome), [d, outcome]);
  const pg = usePaged(pts, `${from}${to}${origin}${outcome}`, 25);

  const pick = (k: string) => { setRange(k); if (k !== 'custom') setDates(rangeOf(k)); };
  const exportCsv = async () => {
    try { await crm.download(`/api/v1/referrals/results/export?from=${from}&to=${to}&origin=${origin}`, `patients-${from}-to-${to}.csv`); }
    catch (e) { toast(friendlyError(e)); }
  };

  return (
    <div className="pr-wrap">
      <div className="pr-tools">
        <div className="crm-chips" role="group" aria-label="Days">
          {RANGES.map(([k, l]) => <button key={k} type="button" className="crm-chip" aria-pressed={range === k} onClick={() => pick(k)}>{l}</button>)}
        </div>
        {range === 'custom' && (
          <span className="pr-dates">
            <input type="date" className="crm-input" aria-label="From" value={from} max={to} onChange={(e) => e.target.value && setDates([e.target.value, to])} />
            <span aria-hidden>–</span>
            <input type="date" className="crm-input" aria-label="To" value={to} min={from} onChange={(e) => e.target.value && setDates([from, e.target.value])} />
          </span>
        )}
        <div className="crm-chips pr-origin" role="group" aria-label="Came through">
          {([['all', 'Everyone'], ['camp', 'Health camps'], ['agent', 'Field agents'], ['partner', 'Partners']] as [Origin, string][]).map(([k, l]) => (
            <button key={k} type="button" className="crm-chip is-soft" aria-pressed={origin === k} onClick={() => setOrigin(k)}>{l}</button>
          ))}
        </div>
        <button type="button" className="crm-btn is-secondary is-sm" style={{ marginLeft: 'auto' }} disabled={!d?.count} onClick={() => void exportCsv()}><Download size={15} aria-hidden /> Export</button>
      </div>
      <p className="crm-sub" style={{ margin: 0, fontSize: 13 }}>Patients sent to the hospital from {dayText(from)} to {dayText(to)}, and everything that has happened to them since. Earnings are the bills the Referral desk entered for them.</p>

      {data.error ? <ErrorBox message={data.error} onRetry={data.reload} /> : !d ? <Skeleton h={420} /> : d.count === 0 ? (
        <section className="crm-card"><Empty title="No patients sent in these days">Camp patients the doctor sends to the hospital, and agents’ referrals, show here once they are on the Referral desk.</Empty></section>
      ) : <>
        <Funnel t={d.total} />

        {d.withCard && d.withCard.referred > 0 && (
          <p className="hc-ref-note"><CreditCard size={15} aria-hidden /> <strong>{d.withCard.referred}</strong> had the hospital health card: {d.withCard.came} came, {d.withCard.admitted} admitted, {rupees(d.withCard.billed)} billed.</p>
        )}

        {origin === 'all' && (
          <section className="pr-origins" aria-label="By where they came from">
            {d.byOrigin.filter((o) => o.tally.referred > 0 || o.key !== 'partner').map((o) => {
              const Icon = ORIGIN_ICON[o.key];
              const t = o.tally;
              return (
                <button key={o.key} type="button" className={`crm-card pr-origin-card is-${o.key}`} onClick={() => setOrigin(o.key)}>
                  <span className="pr-oc-head"><Icon size={17} aria-hidden /><strong>{o.label}</strong></span>
                  {t.referred === 0 ? <span className="crm-sub">Nobody sent in these days.</span> : <>
                    <span className="pr-oc-bar" aria-hidden>
                      <i className="is-adm" style={{ width: `${pct(t.admitted, t.referred)}%` }} />
                      <i className="is-opd" style={{ width: `${pct(t.opd + t.outcomeOpen, t.referred)}%` }} />
                    </span>
                    <span className="pr-oc-nums">
                      <span><b>{t.referred}</b>sent</span><span><b>{t.came}</b>came ({t.cameRate}%)</span><span><b>{t.opd}</b>OPD</span><span><b>{t.admitted}</b>admitted</span>
                    </span>
                    <span className="pr-oc-money"><strong>{rupees(t.billed)}</strong> billed · {rupees(t.collected)} collected</span>
                  </>}
                </button>
              );
            })}
          </section>
        )}

        {d.months.length > 1 && <Months months={d.months} />}

        {(origin === 'all' || origin === 'camp') && d.camps.length > 0 && (
          <section className="crm-card pr-sec" aria-labelledby="pr-camps-h">
            <h2 id="pr-camps-h" className="crm-h2"><Tent size={17} aria-hidden /> Health camps</h2>
            <span className="crm-sub" style={{ fontSize: 13 }}>Seen at the camp, sent to the hospital by the doctor, and what came of them. Return is billed ÷ what the camp cost.</span>
            <div className="crm-table-wrap">
              <table className="crm-table pr-table">
                <thead><tr><th scope="col">Camp</th><th scope="col" className="num">Seen</th><th scope="col" className="num">Sent</th><th scope="col" className="num">Came</th><th scope="col" className="num">OPD</th><th scope="col" className="num">Admitted</th><th scope="col" className="num">Billed</th><th scope="col" className="num">Collected</th><th scope="col" className="num">Camp cost</th><th scope="col" className="num">Return</th></tr></thead>
                <tbody>
                  {d.camps.map((c) => (
                    <tr key={c.id}>
                      <td><strong>{c.title}</strong><span className="crm-cell-sub" style={{ display: 'block' }}>{dayText(c.date)}{c.block ? ` · ${c.block}` : ''}</span></td>
                      <td className="num">{c.seen || '–'}</td>
                      <td className="num">{c.tally.referred || '–'}</td>
                      <td className="num">{c.tally.came ? <>{c.tally.came}<span className="crm-cell-sub"> {c.tally.cameRate}%</span></> : '–'}</td>
                      <td className="num">{c.tally.opd || '–'}</td>
                      <td className="num is-ok">{c.tally.admitted || '–'}</td>
                      <td className="num"><strong>{c.tally.billed ? rupees(c.tally.billed) : '–'}</strong></td>
                      <td className="num">{c.tally.collected ? rupees(c.tally.collected) : '–'}</td>
                      <td className="num">{c.cost ? rupees(c.cost) : '–'}</td>
                      <td className="num">{c.returnOnCost != null ? <Pill tone={c.returnOnCost >= 1 ? 'ok' : 'warn'}>{c.returnOnCost}×</Pill> : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {(origin === 'all' || origin === 'agent' || origin === 'partner') && d.agents.length > 0 && (
          <section className="crm-card pr-sec" aria-labelledby="pr-agents-h">
            <h2 id="pr-agents-h" className="crm-h2"><UserRound size={17} aria-hidden /> Field agents</h2>
            <span className="crm-sub" style={{ fontSize: 13 }}>Their own referrals and their partners’ patients (QR code / WhatsApp).</span>
            <div className="crm-table-wrap">
              <table className="crm-table pr-table">
                <thead><tr><th scope="col">Agent</th><th scope="col" className="num">Sent</th><th scope="col" className="num">Came</th><th scope="col" className="num">OPD</th><th scope="col" className="num">Admitted</th><th scope="col" className="num">Billed</th><th scope="col" className="num">Collected</th><th scope="col" className="num">Per patient</th></tr></thead>
                <tbody>
                  {d.agents.map((a) => (
                    <tr key={a.agentId}>
                      <td><strong>{a.name}</strong>{a.block && <span className="crm-cell-sub" style={{ display: 'block' }}>{a.block}</span>}</td>
                      <td className="num">{a.tally.referred}</td>
                      <td className="num">{a.tally.came}<span className="crm-cell-sub"> {a.tally.cameRate}%</span></td>
                      <td className="num">{a.tally.opd || '–'}</td>
                      <td className="num is-ok">{a.tally.admitted || '–'}</td>
                      <td className="num"><strong>{a.tally.billed ? rupees(a.tally.billed) : '–'}</strong></td>
                      <td className="num">{a.tally.collected ? rupees(a.tally.collected) : '–'}</td>
                      <td className="num">{a.tally.perPatient ? rupees(a.tally.perPatient) : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {d.departments.length > 0 && (
          <section className="crm-card pr-sec" aria-labelledby="pr-dept-h">
            <h2 id="pr-dept-h" className="crm-h2">By department</h2>
            <ul className="pr-depts">
              {d.departments.map((x) => (
                <li key={x.name}>
                  <span className="pr-dep-name">{x.name}</span>
                  <span className="pr-dep-bar" aria-hidden><i style={{ width: `${pct(x.tally.referred, d.departments[0].tally.referred)}%` }} /><i className="is-adm" style={{ width: `${pct(x.tally.admitted, d.departments[0].tally.referred)}%` }} /></span>
                  <span className="pr-dep-nums">{x.tally.referred} sent · {x.tally.came} came · {x.tally.admitted} admitted</span>
                  <strong className="pr-dep-money">{x.tally.billed ? rupees(x.tally.billed) : '–'}</strong>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="crm-card pr-sec" aria-labelledby="pr-pts-h">
          <div className="pr-pts-head">
            <h2 id="pr-pts-h" className="crm-h2">Patients · {d.count}</h2>
            <div className="crm-chips" role="group" aria-label="Show">
              {(['all', 'admitted', 'opd', 'came', 'waiting', 'lost'] as const).map((k) => (
                <button key={k} type="button" className="crm-chip" aria-pressed={outcome === k} onClick={() => setOutcome(k)}>
                  {k === 'all' ? 'All' : OUTCOME[k].label}<span className="ld-chip-n">{k === 'all' ? d.patients.length : d.patients.filter((p) => p.outcome === k).length}</span>
                </button>
              ))}
            </div>
          </div>
          {pts.length === 0 ? <Empty title="Nobody here" /> : (
            <div className="crm-table-wrap">
              <table className="crm-table pr-table">
                <thead><tr><th scope="col">Patient</th><th scope="col">Came through</th><th scope="col">Sent</th><th scope="col">What happened</th><th scope="col" className="num">Billed</th><th scope="col" className="num">Collected</th></tr></thead>
                <tbody>
                  {pg.rows.map((p) => (
                    <tr key={p.clientId}>
                      <td><button type="button" className="wa-link" onClick={() => onOpen(p.clientId)}>{p.name}</button>{p.card && <span className="hc-badge is-static">{p.card}</span>}{p.department && <span className="crm-cell-sub" style={{ display: 'block' }}>{p.department}</span>}</td>
                      <td>{SHORT[p.origin]}{p.from && <span className="crm-cell-sub" style={{ display: 'block' }}>{p.from}</span>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{dayText(p.referredAt)}</td>
                      <td><Pill tone={OUTCOME[p.outcome].tone}>{OUTCOME[p.outcome].label}</Pill>
                        {(p.admittedAt || p.arrivedAt) && <span className="crm-cell-sub" style={{ display: 'block' }}>{p.admittedAt ? `admitted ${dayText(p.admittedAt)}` : `came ${dayText(p.arrivedAt!)}`}</span>}</td>
                      <td className="num"><strong>{p.billed ? rupees(p.billed) : '–'}</strong></td>
                      <td className="num">{p.collected ? rupees(p.collected) : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pager {...pg.pager} noun="patients" />
        </section>
      </>}
    </div>
  );
}

/** Sent → came → OPD / admitted, and the money. */
function Funnel({ t }: { t: Tally }) {
  return (
    <section className="pr-funnel" aria-label="Patients and earnings">
      <div className="pr-f-steps">
        <div className="pr-f"><span>Sent to hospital</span><strong>{t.referred}</strong><em>{t.waiting} not come yet · {t.lost} did not come</em></div>
        <div className="pr-f is-came"><span>Came</span><strong>{t.came}</strong><em>{t.cameRate}% of those sent</em></div>
        <div className="pr-f is-opd"><span>OPD only</span><strong>{t.opd}</strong><em>{t.outcomeOpen ? `${t.outcomeOpen} came, OPD or admission not recorded` : 'seen, not admitted'}</em></div>
        <div className="pr-f is-adm"><span>Admitted</span><strong>{t.admitted}</strong><em>{t.admittedRate}% of those who came</em></div>
      </div>
      <div className="pr-f-money">
        <div><span>Billed</span><strong>{rupees(t.billed)}</strong><em>OPD {rupees(t.opdBilled)} · admission and other {rupees(t.ipdBilled)}</em></div>
        <div><span>Collected</span><strong className="is-ok">{rupees(t.collected)}</strong><em>{t.outstanding ? `${rupees(t.outstanding)} still to collect` : 'all collected'}</em></div>
        <div><span>Per patient who came</span><strong>{rupees(t.perPatient)}</strong><em>billed ÷ patients who came</em></div>
      </div>
    </section>
  );
}

/** Billed each month: health camps and field agents side by side, with the patient counts. */
function Months({ months }: { months: Res['months'] }) {
  const max = Math.max(1, ...months.map((m) => Math.max(m.camp.billed, m.agent.billed)));
  return (
    <section className="crm-card pr-sec" aria-labelledby="pr-months-h">
      <div className="pr-pts-head">
        <h2 id="pr-months-h" className="crm-h2">Month by month</h2>
        <span className="pr-legend"><span><i className="is-camp" />Health camps</span><span><i className="is-agent" />Field agents and partners</span></span>
      </div>
      <div className="pr-months" role="list">
        {months.map((m) => (
          <div key={m.month} className="pr-month" role="listitem" aria-label={`${monthText(m.month)}: camps ${rupees(m.camp.billed)}, agents ${rupees(m.agent.billed)}`}>
            <div className="pr-m-bars">
              <span className="is-camp" style={{ height: `${Math.max(m.camp.billed ? 3 : 0, (m.camp.billed / max) * 100)}%` }} title={`Health camps: ${rupees(m.camp.billed)} · ${m.camp.came} came · ${m.camp.admitted} admitted`} />
              <span className="is-agent" style={{ height: `${Math.max(m.agent.billed ? 3 : 0, (m.agent.billed / max) * 100)}%` }} title={`Field agents: ${rupees(m.agent.billed)} · ${m.agent.came} came · ${m.agent.admitted} admitted`} />
            </div>
            <strong>{rupees(m.all.billed)}</strong>
            <span>{monthText(m.month)}</span>
            <em>{m.all.came} came · {m.all.admitted} adm.</em>
          </div>
        ))}
      </div>
    </section>
  );
}
