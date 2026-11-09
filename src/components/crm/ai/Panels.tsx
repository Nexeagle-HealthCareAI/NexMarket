'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Lightbulb, Lock, ShieldAlert, ShieldCheck } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { friendlyError } from '@/components/crm/ui';
import type { ActionRow, AgentRow, GuardRes, Lesson, Limits, Settings } from './shared';
import { CHANNELS, STATUS_LABEL, when } from './shared';

// ─── Activity ──────────────────────────────────────────────────────────────

export function Activity({ rows, agents, onMore, more }: { rows: ActionRow[]; agents: AgentRow[]; onMore: () => void; more: boolean }) {
  const [agent, setAgent] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const name = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const shown = rows.filter((r) => (!agent || r.agent_id === agent) && (!status || r.status === status));
  return (
    <section className="ai-panel">
      <div className="ai-filters">
        <label><span>Agent</span>
          <select value={agent} onChange={(e) => setAgent(e.target.value)}>
            <option value="">All agents</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label><span>What happened</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Everything</option>
            {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <span className="ai-muted">Every action is kept with its reasons. Practice (shadow) actions show what an agent would have sent.</span>
      </div>
      {shown.length === 0 ? <p className="ai-empty">Nothing here yet.</p> : (
        <div className="ai-table-wrap">
          <table className="ai-table">
            <thead><tr><th>When</th><th>Agent</th><th>What</th><th>Result</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td className="ai-nowrap">{when(r.created_at)}</td>
                  <td className="ai-nowrap">{name(r.agent_id)}</td>
                  <td>
                    <button type="button" className="ai-linkish" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>{r.summary}</button>
                    {open === r.id && (
                      <div className="ai-detail">
                        {r.channel && <div><b>Channel:</b> {r.channel}</div>}
                        {typeof r.detail?.text === 'string' && <blockquote>{r.detail.text}</blockquote>}
                        {r.reasons && r.reasons.length > 0 && (
                          <ul>{r.reasons.map((x, i) => <li key={i}>{x.message}{x.match ? <> — <q>{x.match}</q></> : null}</li>)}</ul>
                        )}
                        {!r.channel && !r.detail?.text && !r.reasons?.length && <span className="ai-muted">No more detail.</span>}
                      </div>
                    )}
                  </td>
                  <td><span className={`ai-pill is-${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more && <button type="button" className="crm-btn is-secondary" onClick={onMore}>Show older</button>}
    </section>
  );
}

// ─── Try the Guard ─────────────────────────────────────────────────────────

const OUTCOME: Record<GuardRes['outcome'], { label: string; icon: typeof ShieldCheck; tone: string; text: string }> = {
  pass: { label: 'Allowed', icon: ShieldCheck, tone: 'ok', text: 'This message could be sent.' },
  fix: { label: 'Needs changes', icon: AlertTriangle, tone: 'warn', text: 'Not sent as it is. The agent would rewrite it once; if it still fails, a person gets a card.' },
  block: { label: 'Blocked', icon: ShieldAlert, tone: 'bad', text: 'This would never be sent.' },
  held: { label: 'Held', icon: Lock, tone: 'warn', text: 'Not checked fully, so not sent. Nothing reaches patients or the public unchecked.' },
};

export function TryGuard() {
  const [text, setText] = useState('');
  const [channel, setChannel] = useState('whatsapp');
  const [rulesOnly, setRulesOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<GuardRes | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const check = async () => {
    setBusy(true); setErr(null);
    try { setRes(await crm.post<GuardRes>('/api/v1/ai-agents/guard/check', { text, channel, rulesOnly })); } catch (e) { setErr(friendlyError(e)); setRes(null); } finally { setBusy(false); }
  };
  const o = res ? OUTCOME[res.outcome] : null;
  return (
    <section className="ai-panel ai-guard">
      <div className="ai-guard-form">
        <p className="ai-muted">Paste any message, post or review reply and see what the Compliance Guard would do with it. Nothing is sent.</p>
        <label className="ai-field"><span>Where it would go</span>
          <select value={channel} onChange={(e) => setChannel(e.target.value)}>{CHANNELS.map((c) => <option key={c.k} value={c.k}>{c.l}</option>)}</select>
        </label>
        <label className="ai-field"><span>Message</span>
          <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} maxLength={6000}
            placeholder="e.g. Free eye check-up camp at Amour High School on Saturday, 10 am to 2 pm." />
        </label>
        <label className="ai-check"><input type="checkbox" checked={rulesOnly} onChange={(e) => setRulesOnly(e.target.checked)} /> Rules only (skip the AI policy check)</label>
        <button type="button" className="crm-btn" disabled={busy || !text.trim()} onClick={() => void check()}><ShieldCheck size={16} aria-hidden /> {busy ? 'Checking…' : 'Check it'}</button>
        {err && <p className="ai-err" role="alert">{err}</p>}
      </div>
      <div className="ai-guard-out" aria-live="polite">
        {!res || !o ? (
          <div className="ai-guard-empty"><ShieldCheck size={28} aria-hidden /><span>The result shows here: which rules a message breaks, the exact words, and the rewrite.</span></div>
        ) : (
          <>
            <div className={`ai-verdict is-${o.tone}`}><o.icon size={22} aria-hidden /><div><strong>{o.label}</strong><span>{o.text}</span></div></div>
            {res.rewritten && (
              <div className="ai-rewrite"><span className="ai-eyebrow">The Guard&apos;s rewrite</span><blockquote>{res.text}</blockquote></div>
            )}
            {res.issues.length > 0 && (
              <ul className="ai-issues">
                {res.issues.map((i, k) => (
                  <li key={k} className={`is-${i.severity}`}><span className="ai-rule">{i.rule.replace(/_/g, ' ')}</span><span>{i.message}{i.match ? <> — <q>{i.match}</q></> : null}</span></li>
                ))}
              </ul>
            )}
            {res.policy?.violation && <p className="ai-policy-line"><b>Policy check:</b> {res.policy.explanation}</p>}
            {res.outcome === 'pass' && res.issues.length === 0 && <p className="ai-policy-line"><CheckCircle2 size={15} aria-hidden /> Checked by: {res.checked_by.join(', ')}.</p>}
            {res.note && <p className="ai-note">{res.note}</p>}
          </>
        )}
      </div>
    </section>
  );
}

// ─── Limits ────────────────────────────────────────────────────────────────

type NumKey = { group: keyof Limits; key: string; label: string; unit?: string };
const NUMS: { title: string; items: NumKey[] }[] = [
  { title: 'Leads', items: [
    { group: 'lead', key: 'repliesPerLeadPerHour', label: 'Replies per lead per hour' },
    { group: 'lead', key: 'maxFollowUpsPerLead', label: 'Follow-ups per lead, at most' },
    { group: 'lead', key: 'autoRepliesPerPersonPerDay', label: 'Automatic replies per person per day' },
  ] },
  { title: 'Messages and posts', items: [
    { group: 'whatsapp', key: 'sendsPerDay', label: 'WhatsApp sends per day, all agents' },
    { group: 'partner', key: 'messagesPerDay', label: 'Messages to partners per day' },
    { group: 'broadcast', key: 'perListPerWeek', label: 'Broadcasts per list per week' },
    { group: 'broadcast', key: 'perPersonPerWeek', label: 'Broadcasts per person per week' },
    { group: 'social', key: 'postsPerChannelPerDay', label: 'Posts per channel per day' },
    { group: 'reviews', key: 'repliesPerDay', label: 'Review replies per day' },
  ] },
  { title: 'Safety', items: [
    { group: 'tokens', key: 'perAgentPerDay', label: 'AI tokens per agent per day', unit: 'tokens' },
    { group: 'anomaly', key: 'blocksPerHourToPause', label: 'Pause an agent after this many blocks in an hour' },
    { group: 'anomaly', key: 'volumeMultipleToPause', label: 'Pause an agent at this many times its usual volume', unit: '×' },
  ] },
];

export function LimitsPanel({ settings, canEdit, onSaved }: { settings: Settings; canEdit: boolean; onSaved: (msg: string) => void }) {
  const [lim, setLim] = useState<Limits>(settings.limits);
  const [rec, setRec] = useState(settings.recipients);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = useMemo(() => JSON.stringify(lim) !== JSON.stringify(settings.limits) || JSON.stringify(rec) !== JSON.stringify(settings.recipients), [lim, rec, settings]);
  const setNum = (g: keyof Limits, k: string, v: string) => setLim((x) => ({ ...x, [g]: { ...(x[g] as Record<string, unknown>), [k]: Math.max(0, Number(v) || 0) } }));
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await crm.put('/api/v1/ai-agents/settings/limits', { value: lim });
      await crm.put('/api/v1/ai-agents/settings/recipients', { value: rec });
      onSaved('Limits saved. Agents use them from their next action.');
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };
  const role = (r: string, on: boolean) => setRec((x) => ({ ...x, roles: on ? [...new Set([...x.roles, r])] : x.roles.filter((y) => y !== r) }));
  return (
    <section className="ai-panel ai-limits">
      {!canEdit && <p className="ai-note">Only an admin can change these.</p>}
      <fieldset disabled={!canEdit || busy}>
        <div className="ai-limit-grid">
          <div className="ai-card">
            <h3>Quiet hours</h3>
            <p className="ai-muted">Nothing goes out in these hours.</p>
            <div className="ai-row2">
              <label className="ai-field"><span>From</span><input type="time" value={lim.quietHours.from} onChange={(e) => setLim((x) => ({ ...x, quietHours: { ...x.quietHours, from: e.target.value } }))} /></label>
              <label className="ai-field"><span>To</span><input type="time" value={lim.quietHours.to} onChange={(e) => setLim((x) => ({ ...x, quietHours: { ...x.quietHours, to: e.target.value } }))} /></label>
            </div>
            <label className="ai-check"><input type="checkbox" checked={lim.quietHours.allowRepliesToInbound} onChange={(e) => setLim((x) => ({ ...x, quietHours: { ...x.quietHours, allowRepliesToInbound: e.target.checked } }))} /> Still answer people who wrote first</label>
          </div>
          {NUMS.map((g) => (
            <div className="ai-card" key={g.title}>
              <h3>{g.title}</h3>
              {g.items.map((it) => (
                <label className="ai-field ai-num" key={it.group + it.key}>
                  <span>{it.label}</span>
                  <input type="number" min={0} inputMode="numeric" value={String((lim[it.group] as Record<string, number>)[it.key] ?? 0)} onChange={(e) => setNum(it.group, it.key, e.target.value)} />
                </label>
              ))}
            </div>
          ))}
          <div className="ai-card">
            <h3>Ads</h3>
            <p className="ai-muted">You run Google and Meta ads yourself. The Ads Optimiser only reads results and suggests changes; it can&apos;t change a campaign.</p>
            <span className="ai-pill is-shadow">Suggestions only</span>
          </div>
          <div className="ai-card">
            <h3>Reports and alerts go to</h3>
            <label className="ai-check"><input type="checkbox" checked={rec.roles.includes('admin')} onChange={(e) => role('admin', e.target.checked)} /> Admins</label>
            <label className="ai-check"><input type="checkbox" checked={rec.roles.includes('marketing_manager')} onChange={(e) => role('marketing_manager', e.target.checked)} /> Marketing managers</label>
            <p className="ai-muted">In the CRM bell and as a phone notification.</p>
          </div>
        </div>
      </fieldset>
      {canEdit && (
        <div className="ai-save">
          {err && <span className="ai-err" role="alert">{err}</span>}
          <button type="button" className="crm-btn" disabled={!dirty || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save limits'}</button>
        </div>
      )}
    </section>
  );
}

// ─── Policy and facts pack ─────────────────────────────────────────────────

export function PolicyPanel({ settings, canEdit, onSaved }: { settings: Settings; canEdit: boolean; onSaved: (msg: string) => void }) {
  const [policy, setPolicy] = useState(settings.policy.text);
  const [facts, setFacts] = useState(settings.facts.text);
  const [phones, setPhones] = useState(settings.facts.phones.join('\n'));
  const [domains, setDomains] = useState(settings.facts.domains.join('\n'));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const lines = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
  const save = async (key: 'policy' | 'facts') => {
    setBusy(key); setErr(null);
    try {
      if (key === 'policy') await crm.put('/api/v1/ai-agents/settings/policy', { value: { text: policy } });
      else await crm.put('/api/v1/ai-agents/settings/facts', { value: { text: facts, phones: lines(phones), domains: lines(domains) } });
      onSaved(key === 'policy' ? 'Policy saved. The Guard checks against it from now on.' : 'Facts pack saved.');
    } catch (e) { setErr(friendlyError(e)); } finally { setBusy(null); }
  };
  const m = settings.meta;
  return (
    <section className="ai-panel ai-policy">
      {!canEdit && <p className="ai-note">Only an admin can change these.</p>}
      <div className="ai-card">
        <h3>Facts pack</h3>
        <p className="ai-muted">The only facts agents may use besides live records: departments, doctors and their OPD days, timings, address, emergency number, camps. Any time, date or price in a message must appear here or in the task&apos;s records, or the Guard blocks it.</p>
        <label className="ai-field"><span>Facts</span><textarea rows={9} value={facts} disabled={!canEdit} onChange={(e) => setFacts(e.target.value)}
          placeholder={'Departments: …\nOPD: Monday to Saturday, 9 am to 5 pm\nEmergency: 24 hours\nAddress: …'} /></label>
        <div className="ai-row2">
          <label className="ai-field"><span>Hospital phone numbers (one per line)</span><textarea rows={3} value={phones} disabled={!canEdit} onChange={(e) => setPhones(e.target.value)} /></label>
          <label className="ai-field"><span>Hospital websites (one per line)</span><textarea rows={3} value={domains} disabled={!canEdit} onChange={(e) => setDomains(e.target.value)} placeholder="example.in" /></label>
        </div>
        {canEdit && <div className="ai-save"><span className="ai-muted">{m.facts?.updatedBy ? `Last changed by ${m.facts.updatedBy}` : 'Not filled in yet'}</span>
          <button type="button" className="crm-btn" disabled={busy !== null} onClick={() => void save('facts')}>{busy === 'facts' ? 'Saving…' : 'Save facts pack'}</button></div>}
      </div>
      <div className="ai-card">
        <h3>Marketing policy {settings.policy.isDefault && <span className="ai-pill is-shadow">Default</span>}</h3>
        <p className="ai-muted">What the Compliance Guard checks every message against, on top of its fixed rules. Replace it with the hospital&apos;s own policy when you have one.</p>
        <label className="ai-field"><span>Policy</span><textarea rows={14} value={policy} disabled={!canEdit} onChange={(e) => setPolicy(e.target.value)} /></label>
        {canEdit && <div className="ai-save"><span className="ai-muted">{m.policy?.updatedBy ? `Last changed by ${m.policy.updatedBy}` : 'Using the safe default'}</span>
          <button type="button" className="crm-btn" disabled={busy !== null || policy.trim().length < 80} onClick={() => void save('policy')}>{busy === 'policy' ? 'Saving…' : 'Save policy'}</button></div>}
      </div>
      {err && <p className="ai-err" role="alert">{err}</p>}
    </section>
  );
}

// ─── Lessons ───────────────────────────────────────────────────────────────

export function LessonsPanel({ lessons, agents }: { lessons: Lesson[]; agents: AgentRow[] }) {
  const name = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  return (
    <section className="ai-panel">
      <div className="ai-card ai-how">
        <h3>How agents learn</h3>
        <ol className="ai-steps">
          <li><b>Record</b> every action and why.</li>
          <li><b>Measure</b> what happened: replied, came in, reach.</li>
          <li><b>Reflect</b> each night: the Coach proposes a lesson with its numbers.</li>
          <li><b>Trial</b> on a quarter of cases until it holds on 20 or more.</li>
          <li><b>Keep</b> it, or drop it when it stops working.</li>
        </ol>
      </div>
      {lessons.length === 0 ? (
        <p className="ai-empty"><Lightbulb size={18} aria-hidden /> No lessons yet. They start once agents are working and results come back (phase 2).</p>
      ) : (
        <ul className="ai-lessons">
          {lessons.map((l) => (
            <li key={l.agentId + l.key} className={`is-${l.status ?? 'trial'}`}>
              <Lightbulb size={16} aria-hidden />
              <div><strong>{l.text}</strong><span>{name(l.agentId)} · {l.status === 'kept' ? 'kept' : l.status === 'dropped' ? 'dropped' : 'on trial'}{l.episodes ? ` · ${l.episodes} cases` : ''}</span></div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
