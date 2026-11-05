'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, CheckCircle2, CreditCard, ExternalLink, RefreshCw, Wallet } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { ErrorBox, friendlyError, Skeleton } from '@/components/crm/ui';
import { showPhone } from './shared';

interface Row { key: string; label: string; cost: number; messages: number }
interface Report {
  month: string; currency?: string | null; total: number; messages: number; days: { date: string; cost: number; messages: number }[];
  categories: Row[]; numbers: Row[]; paymentMethodAttached: boolean; accountName?: string | null; fetchedAt: string; error?: string | null;
}
interface Settings { monthlyBudget: number; alertPercent: number; stopAtBudget: boolean; numberLabels: Record<string, string> }
interface Res { report: Report; thisMonth: boolean; projected?: number | null; settings: Settings; wabaId?: string | null }

const BILLING_URL = 'https://business.facebook.com/billing_hub/payment_settings';

function months(): { key: string; label: string }[] {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({ key: d.toISOString().slice(0, 7), label: new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d) });
  }
  return out;
}

/**
 * What WhatsApp costs: this month's spend from Meta by message type, day and sending number, a monthly budget that
 * can warn and stop broadcasts, and whether a payment method is attached. The invoice and the card stay in Meta.
 */
export function WaBilling({ isAdmin, toast }: { isAdmin: boolean; toast: (m: string) => void }) {
  const monthList = useMemo(() => months(), []);
  const [month, setMonth] = useState(monthList[0].key);
  const [data, setData] = useState<Res | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const r = await crm.get<Res>(`/api/v1/whatsapp/billing?month=${month}${refresh ? '&refresh=true' : ''}`);
      setData(r); setForm(r.settings); setError(null);
    } catch (e) { setError(friendlyError(e)); } finally { setLoading(false); }
  }, [month]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  const money = useMemo(() => {
    const cur = data?.report.currency;
    try { if (cur) return new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur, maximumFractionDigits: 2 }); } catch { /* unknown code */ }
    return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
  }, [data?.report.currency]);
  const moneyShort = useMemo(() => {
    const cur = data?.report.currency;
    try { if (cur) return new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur, maximumFractionDigits: 0, notation: 'compact' }); } catch { /* unknown code */ }
    return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0, notation: 'compact' });
  }, [data?.report.currency]);

  if (error && !data) return <ErrorBox message={error} onRetry={() => void load()} />;
  if (!data || !form) return <Skeleton h={560} />;
  const r = data.report;
  const s = data.settings;
  const budget = s.monthlyBudget;
  const pct = budget > 0 ? Math.round((r.total / budget) * 100) : 0;
  const tone = pct >= 100 ? 'is-bad' : pct >= s.alertPercent ? 'is-warn' : '';
  const dirty = JSON.stringify(form) !== JSON.stringify(s);
  const fmt = (n: number) => money.format(n);
  const dayFmt = (d: string) => String(Number(d.slice(8, 10)));

  const save = async () => {
    setSaving(true);
    try { await crm.put('/api/v1/whatsapp/billing/settings', form); await load(); toast('Billing settings saved.'); }
    catch (e) { toast(friendlyError(e)); } finally { setSaving(false); }
  };

  return (
    <div className="wb-wrap">
      <div className="wb-bar">
        <select className="crm-select" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
          {monthList.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        <button type="button" className="crm-btn is-secondary is-sm" disabled={loading} onClick={() => void load(true)}>
          <RefreshCw size={14} aria-hidden className={loading ? 'wb-spin' : undefined} /> Refresh from Meta
        </button>
        <span className="crm-sub">Updated {new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(r.fetchedAt))}{r.accountName ? ` · ${r.accountName}` : ''}</span>
      </div>

      {r.error ? (
        <div className="ld-banner"><span><strong>Couldn&apos;t read spend from Meta.</strong> {r.error}</span></div>
      ) : (
        <>
          <div className="crm-kpis">
            <div className={`crm-card crm-kpi wb-kpi ${tone}`}>
              <span className="crm-kpi-label">{data.thisMonth ? 'Spent this month' : 'Spent'}</span>
              <span className="crm-kpi-value">{fmt(r.total)}</span>
              {budget > 0 && (
                <>
                  <span className="wh-meter-bar wb-meter"><span style={{ width: `${Math.min(100, pct)}%` }} className={pct >= 100 ? 'is-high' : pct >= s.alertPercent ? 'is-warn' : undefined} /></span>
                  <span className="crm-sub">{pct}% of the {fmt(budget)} budget</span>
                </>
              )}
            </div>
            {data.thisMonth && data.projected != null && (
              <div className="crm-card crm-kpi">
                <span className="crm-kpi-label">At this pace, by month end</span>
                <span className="crm-kpi-value">{fmt(data.projected)}</span>
                {budget > 0 && <span className="crm-sub">{data.projected > budget ? `About ${fmt(data.projected - budget)} over budget` : 'Within budget'}</span>}
              </div>
            )}
            <div className="crm-card crm-kpi">
              <span className="crm-kpi-label">Messages charged or counted</span>
              <span className="crm-kpi-value">{r.messages.toLocaleString('en-IN')}</span>
              <span className="crm-sub">{r.messages > 0 ? `${fmt(r.total / r.messages)} each on average` : 'None yet'}</span>
            </div>
            <div className="crm-card crm-kpi">
              <span className="crm-kpi-label">Payment method</span>
              <span className={`wb-pay ${r.paymentMethodAttached ? 'is-ok' : 'is-bad'}`}>
                {r.paymentMethodAttached ? <><CheckCircle2 size={18} aria-hidden /> Attached</> : <><AlertTriangle size={18} aria-hidden /> None attached</>}
              </span>
              <a className="wa-link wb-ext" href={BILLING_URL} target="_blank" rel="noopener noreferrer">See the bill or change the card <ExternalLink size={13} aria-hidden /></a>
            </div>
          </div>

          {budget > 0 && pct >= s.alertPercent && data.thisMonth && (
            <div className={pct >= 100 ? 'wh-paused' : 'ld-banner'}>
              <AlertTriangle size={18} aria-hidden />
              <span>
                <strong>{pct >= 100 ? 'This month’s WhatsApp budget is spent.' : `${pct}% of this month’s budget is spent.`}</strong>{' '}
                {s.stopAtBudget ? (pct >= 100 ? 'Broadcasts and follow-up templates are on hold; replies still go out.' : 'Broadcasts stop when it reaches 100%.') : 'Sending continues; turn on “stop at budget” below to hold broadcasts.'}
              </span>
            </div>
          )}

          <section className="crm-card wa-step">
            <h2 className="crm-h2">Spend by day</h2>
            <div className="wb-chart" role="img" aria-label={`Daily WhatsApp spend for ${r.month}`}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={r.days} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="date" tickFormatter={dayFmt} stroke="var(--text-2)" fontSize={12} tickLine={false} interval="preserveStartEnd" minTickGap={8} />
                  <YAxis stroke="var(--text-2)" fontSize={12} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => moneyShort.format(v)} />
                  <Tooltip cursor={{ fill: 'rgba(10,114,214,0.06)' }} contentStyle={{ borderRadius: 10, border: '1px solid var(--line)', fontSize: 13 }}
                    labelFormatter={(d) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`))}
                    formatter={(v, _n, item) => [`${fmt(Number(v))} · ${(item?.payload as { messages?: number } | undefined)?.messages ?? 0} messages`, 'Spend']} />
                  <Bar dataKey="cost" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="crm-sub" style={{ margin: 0 }}>Days are in UTC, as Meta counts them. Meta&apos;s figures can lag by a few hours.</p>
          </section>

          <div className="wb-split">
            <SplitTable title="By message type" rows={r.categories} fmt={fmt} total={r.total} empty="No charged messages this month." />
            <SplitTable title="By sending number" rows={r.numbers.map((n) => ({ ...n, label: s.numberLabels[n.key] ?? (/^\d+$/.test(n.key) ? showPhone(n.key) : n.label) }))}
              fmt={fmt} total={r.total} empty="No numbers have sent yet." hint="Name each number below to see the cost per hospital." />
          </div>
        </>
      )}

      <section className="crm-card wa-step">
        <div className="wa-step-head">
          <span className="wa-num" aria-hidden><Wallet size={18} /></span>
          <div><h2 className="crm-h2">Budget</h2><p className="crm-sub">A monthly limit for WhatsApp spend, in the account&apos;s currency{r.currency ? ` (${r.currency})` : ''}.</p></div>
        </div>
        {!isAdmin && <div className="ld-banner"><span>Only an admin can change the budget.</span></div>}
        <div className="wb-form">
          <label className="wa-field">
            <span className="wa-label">Monthly budget</span>
            <input type="number" min={0} step="100" className="crm-input" disabled={!isAdmin} value={form.monthlyBudget || ''} placeholder="No budget"
              onChange={(e) => setForm({ ...form, monthlyBudget: Number(e.target.value) || 0 })} />
          </label>
          <label className="wa-field">
            <span className="wa-label">Warn at</span>
            <select className="crm-select" disabled={!isAdmin || !form.monthlyBudget} value={form.alertPercent} onChange={(e) => setForm({ ...form, alertPercent: Number(e.target.value) })}>
              {[50, 70, 80, 90, 100].map((p) => <option key={p} value={p}>{p}% of the budget</option>)}
            </select>
          </label>
          <label className="wau-switch wb-stop">
            <input type="checkbox" disabled={!isAdmin || !form.monthlyBudget} checked={form.stopAtBudget} onChange={(e) => setForm({ ...form, stopAtBudget: e.target.checked })} />
            <span className="wb-stop-text"><strong>Stop at budget</strong><span className="crm-sub">Hold broadcasts and follow-up templates once the budget is spent. Replies to people who wrote in still go.</span></span>
          </label>
        </div>

        {r.numbers.some((n) => /^\d+$/.test(n.key)) && (
          <div className="wa-field">
            <span className="wa-label">Who each number belongs to</span>
            <div className="wb-labels">
              {r.numbers.filter((n) => /^\d+$/.test(n.key)).map((n) => (
                <label key={n.key} className="wb-label-row">
                  <span>{showPhone(n.key)}</span>
                  <input className="crm-input" disabled={!isAdmin} maxLength={80} placeholder="e.g. Glisan Akbari Hospital" value={form.numberLabels[n.key] ?? ''}
                    onChange={(e) => setForm({ ...form, numberLabels: { ...form.numberLabels, [n.key]: e.target.value } })} />
                </label>
              ))}
            </div>
          </div>
        )}

        {isAdmin && (
          <div className="wa-actions">
            <button type="button" className="crm-btn" disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
            {dirty && <button type="button" className="crm-btn is-secondary" onClick={() => setForm(s)}>Undo</button>}
          </div>
        )}
      </section>

      <section className="crm-card wa-step wb-meta">
        <div className="wa-step-head">
          <span className="wa-num" aria-hidden><CreditCard size={18} /></span>
          <div>
            <h2 className="crm-h2">The bill and the card</h2>
            <p className="crm-sub">Meta doesn&apos;t let apps read invoices, the amount due or card details, so those stay in Meta. The spend above is the cost of messages sent, which is what the bill is made of.</p>
          </div>
        </div>
        <ol className="wb-steps">
          <li>Open <strong>Meta Business Suite → Billing &amp; payments</strong>.</li>
          <li><strong>Payment activity</strong> shows invoices and what is due; <strong>Payment methods</strong> shows the card.</li>
          <li>To change the card for WhatsApp: <strong>WhatsApp Business accounts</strong> tab → pick {r.accountName ? <strong>{r.accountName}</strong> : 'the account'} → <strong>Add payment method</strong>.</li>
        </ol>
        <div className="wa-actions">
          <a className="crm-btn is-secondary" href={BILLING_URL} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} aria-hidden /> Open Billing &amp; payments</a>
          {data.wabaId && <a className="crm-btn is-secondary" href={`https://business.facebook.com/wa/manage/home/?waba_id=${encodeURIComponent(data.wabaId)}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} aria-hidden /> Open WhatsApp Manager</a>}
        </div>
      </section>
    </div>
  );
}

function SplitTable({ title, rows, fmt, total, empty, hint }: { title: string; rows: Row[]; fmt: (n: number) => string; total: number; empty: string; hint?: string }) {
  return (
    <section className="crm-card wa-step">
      <h2 className="crm-h2">{title}</h2>
      {rows.length === 0 ? <span className="crm-sub">{empty}</span> : (
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead><tr><th scope="col"></th><th scope="col" className="wb-num">Messages</th><th scope="col" className="wb-num">Cost</th><th scope="col" className="wb-num">Share</th></tr></thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.key}>
                  <td>{x.label}</td>
                  <td className="wb-num">{x.messages.toLocaleString('en-IN')}</td>
                  <td className="wb-num">{fmt(x.cost)}</td>
                  <td className="wb-num">{total > 0 ? `${Math.round((x.cost / total) * 100)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hint && rows.length > 0 && <span className="crm-sub">{hint}</span>}
    </section>
  );
}
