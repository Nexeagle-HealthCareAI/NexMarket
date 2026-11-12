'use client';

/* eslint-disable @next/next/no-img-element */
import { Mail, Pause, Play, ShieldCheck } from 'lucide-react';
import type { ActionRow, AgentRow, Mode, Overview } from './shared';
import { lookOf, POSE, when, RUN_JOB } from './shared';

const WING_COLOR: Record<AgentRow['wing'], string> = { command: '#01a0ec', leads: '#38f6a9', studio: '#b48cff', growth: '#f5b544' };
const WING_HINT: Record<AgentRow['wing'], string> = {
  command: 'plans, guards and watches', leads: 'every enquiry answered and followed', studio: 'camps, posts, broadcasts, reviews', growth: 'ads and the daily report',
};

/** The office floor: one room per agent, grouped in wings. Everything shown comes from the agent's real state. */
export function Floor({ data, selected, onPick, incoming }: { data: Overview; selected: string; onPick: (id: string) => void; incoming: string | null }) {
  const wings = (['command', 'leads', 'studio', 'growth'] as const).map((w) => ({ w, rooms: data.agents.filter((a) => a.wing === w) }));
  return (
    <div className="ai-floor">
      {wings.map(({ w, rooms }) => (
        <section key={w} className="ai-wing" aria-label={rooms[0]?.wingName}>
          <div className="ai-wing-head">
            <span className="ai-wing-sq" style={{ background: WING_COLOR[w] }} aria-hidden />
            <h2>{rooms[0]?.wingName}</h2>
            <span>{WING_HINT[w]}</span>
          </div>
          <div className="ai-rooms">
            {rooms.map((a) => <Room key={a.id} a={a} stopAll={data.stopAll.on} sel={selected === a.id} incoming={incoming === a.id} onPick={() => onPick(a.id)} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function Room({ a, stopAll, sel, incoming, onPick }: { a: AgentRow; stopAll: boolean; sel: boolean; incoming: boolean; onPick: () => void }) {
  const l = lookOf(a, stopAll);
  const busy = l.anim === 'bob' || l.anim === 'guard' || l.anim === 'tilt';
  const total = a.today.done + a.today.shadow + a.today.blocked;
  return (
    <button type="button" className={`ai-room is-${l.tone}${sel ? ' is-sel' : ''}${incoming ? ' is-in' : ''}${a.available ? '' : ' is-later'}`}
      onClick={onPick} aria-pressed={sel} aria-label={`${a.name}: ${l.label}`}>
      <span className="ai-room-top">
        <span className={`ai-dot is-${l.tone}`} aria-hidden />
        <strong>{a.name}</strong>
        <span className={`ai-state is-${l.tone}`}>{l.label}</span>
      </span>
      <span className="ai-scene" aria-hidden>
        <span className="ai-floorline" />
        <span className="ai-desk" /><span className="ai-desk-leg" />
        <span className="ai-screen">{busy && <span className="ai-screen-lines"><i /><i /><i /></span>}</span>
        <img className={`ai-pet is-${l.anim}`} src={l.img} alt="" />
        {l.zz && <span className="ai-zz"><b>z</b><b>z</b></span>}
        {incoming && <span className="ai-mail"><Mail size={15} /></span>}
      </span>
      <span className="ai-bubble">
        {l.line}
        {busy && <span className="ai-typing" aria-hidden><i /><i /><i /></span>}
      </span>
      <span className="ai-room-foot">
        {a.available ? <>{total} today{a.today.blocked ? ` · ${a.today.blocked} stopped by the Guard` : ''}{a.mode === 'shadow' && a.today.shadow ? ` · ${a.today.shadow} practice` : ''}</> : a.wokenBy}
      </span>
    </button>
  );
}

/** Hand-offs between agents, newest first, with an envelope flying along. */
export function Lane({ items, nameOf, tick }: { items: ActionRow[]; nameOf: (id: string) => string; tick: number }) {
  const cur = items[0];
  return (
    <section className="ai-lane" aria-label="Messages between agents">
      <span className="ai-lane-label">Message lane</span>
      {cur ? (
        <>
          <span className="ai-lane-who"><img src={POSE.wave} alt="" />{nameOf(cur.agent_id)}</span>
          <span className="ai-lane-track">
            <span className="ai-lane-dash" />
            <span key={cur.id + tick} className="ai-env"><Mail size={16} /></span>
          </span>
          <span className="ai-lane-who"><img src={POSE.think} alt="" />{cur.to_agent ? nameOf(cur.to_agent) : '—'}</span>
          <p>“{cur.summary}” <span className="ai-muted">· {when(cur.created_at)}</span></p>
        </>
      ) : (
        <p className="ai-lane-empty">Agents hand work to each other here once more of them start (phase 2). Right now the Compliance Guard is on duty.</p>
      )}
    </section>
  );
}

/** The selected agent's card: its job, what it may do, its limits, its switches. */
export function Side({ a, stopAll, me, busy, onPause, onResume, onMode, feed, onCheck, onRun }: {
  a: AgentRow; stopAll: boolean; me: { isAdmin: boolean }; busy: boolean;
  onPause: () => void; onResume: () => void; onMode: (m: Mode) => void; feed: ActionRow[]; onCheck?: () => void; onRun?: (job: string, label: string) => void;
}) {
  const l = lookOf(a, stopAll);
  const guard = a.id === 'compliance_guard';
  return (
    <aside className="ai-side">
      <section className="ai-card">
        <div className="ai-side-head">
          <span className="ai-side-pet"><img className={`ai-pet is-${l.anim}`} src={l.img} alt="" /></span>
          <div>
            <span className="ai-eyebrow">{a.wingName} · phase {a.phase}</span>
            <h2>{a.name}</h2>
            <p>{a.job}</p>
          </div>
        </div>
        <div className="ai-now">
          <span className={`ai-state is-${l.tone}`}><span className={`ai-dot is-${l.tone}`} aria-hidden /> {l.label}</span>
          <p>{l.line}</p>
        </div>
        <dl className="ai-dl">
          <dt>Woken by</dt><dd>{a.wokenBy}</dd>
          <dt>May do</dt><dd>{a.canDo}</dd>
          <dt>Limits</dt><dd>{a.limits}</dd>
          <dt>Works with</dt><dd>{a.talksTo.join(', ') || '—'}</dd>
          <dt>Today</dt><dd>{a.today.done} done · {a.today.shadow} practice · {a.today.blocked} stopped · {a.tokensToday.toLocaleString('en-IN')} tokens</dd>
          {a.available && a.reviews && (a.reviews.checked > 0 || a.reviews.waiting > 0) && (
            <><dt>Checked by people</dt><dd>
              {a.reviews.checked > 0 ? `${a.reviews.percent}% good as written (${a.reviews.good} of ${a.reviews.checked} in 30 days; ${a.reviews.edited} edited, ${a.reviews.wrong} wrong)` : 'None checked yet'}
              {a.reviews.waiting > 0 && onCheck ? <> · <button type="button" className="ai-linkish ai-to-check" onClick={onCheck}>{a.reviews.waiting} to check</button></> : null}
            </dd></>
          )}
        </dl>
        <div className="ai-side-actions">
          {guard ? (
            <span className="ai-guard-note"><ShieldCheck size={16} aria-hidden /> Always on. Use Stop all to halt everything.</span>
          ) : !a.available ? (
            <span className="ai-guard-note">Arrives in phase {a.phase}. It can be switched on after its shadow trial.</span>
          ) : (
            <>
              {a.paused
                ? <button type="button" className="crm-btn" disabled={busy} onClick={onResume}><Play size={15} aria-hidden /> Resume</button>
                : <button type="button" className="crm-btn is-secondary" disabled={busy} onClick={onPause}><Pause size={15} aria-hidden /> Pause</button>}
              {me.isAdmin && (
                <label className="ai-mode">
                  <span>Mode</span>
                  <select value={a.mode} disabled={busy} onChange={(e) => onMode(e.target.value as Mode)}>
                    <option value="off">Off</option>
                    <option value="shadow">Shadow (practice, sends nothing)</option>
                    <option value="live">Live</option>
                  </select>
                </label>
              )}
              {me.isAdmin && onRun && a.mode !== 'off' && !a.paused && !stopAll && (RUN_JOB[a.id] ?? []).map((j) => (
                <button key={j.job} type="button" className="crm-btn is-secondary is-sm" disabled={busy} onClick={() => onRun(j.job, j.label)}>{j.label}</button>
              ))}
            </>
          )}
        </div>
      </section>
      <section className="ai-card">
        <h3>Latest from {a.name}</h3>
        {feed.length === 0 ? <p className="ai-muted">Nothing yet.</p> : (
          <ul className="ai-mini-feed">
            {feed.slice(0, 6).map((x) => (
              <li key={x.id}><span className={`ai-pill is-${x.status}`}>{x.status}</span><span>{x.summary}</span><time>{when(x.created_at)}</time></li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
