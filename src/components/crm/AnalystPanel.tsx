'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, ClipboardCheck, Send, Sparkles } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { canEdit, useAccess } from '@/lib/crm/access';
import { Empty, ErrorBox, fmt, friendlyError, Pill, Skeleton, useLoader, useToast, type Tone } from '@/components/crm/ui';
import { TaskModal, type TaskPreset } from '@/components/crm/Tasks';

interface Finding { key: string; title: string; detail: string; area: string; metric: string; severity: 'high' | 'medium' | 'low' }
interface BriefingResult {
  summary: string; health: 'good' | 'watch' | 'bad';
  wins: { title: string; detail: string }[];
  issues: Finding[]; opportunities: Finding[];
  plan: { key: string; title: string; detail: string; owner: string; due_in_days: number; expected_impact: string }[];
  watch_next: string[];
}
interface Briefing { id: string; createdAt: string; createdBy: string; periodFrom: string; periodTo: string; model: string; status: string; health?: string; summary?: string; result?: BriefingResult | null; toolCalls: number }
interface AnalystRes {
  configured: boolean; model: string; latest: Briefing | null; running: boolean; lastError?: string | null;
  history: { id: string; createdAt: string; by: string; health?: string; summary?: string }[];
}
type ItemStatus = 'open' | 'in_progress' | 'done' | 'dismissed';
interface Item {
  id: string; kind: 'issue' | 'opportunity' | 'plan'; title: string; detail: string; area?: string | null; metric?: string | null;
  severity: 'high' | 'medium' | 'low'; status: ItemStatus; owner?: string | null; dueDate?: string | null; overdue: boolean;
  trend?: 'better' | 'same' | 'worse' | 'resolved' | null; trendNote?: string | null; note?: string | null; timesRaised: number; createdAt: string; updatedAt: string;
}
interface ItemsRes { counts: { open: number; inProgress: number; done: number; dismissed: number }; items: Item[] }

const HEALTH: Record<string, { label: string; tone: Tone }> = { good: { label: 'Going well', tone: 'ok' }, watch: { label: 'Needs watching', tone: 'warn' }, bad: { label: 'Needs action', tone: 'bad' } };
const SEV: Record<string, Tone> = { high: 'bad', medium: 'warn', low: 'neutral' };
const KIND: Record<string, string> = { issue: 'Issue', opportunity: 'Opportunity', plan: 'Action' };
const TREND: Record<string, { label: string; tone: Tone }> = { better: { label: 'Getting better', tone: 'ok' }, same: { label: 'No change', tone: 'neutral' }, worse: { label: 'Getting worse', tone: 'bad' }, resolved: { label: 'Looks resolved', tone: 'ok' } };

// The model sometimes leaves a section out or returns the wrong shape; never let that crash the page.
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
function normalize(raw: unknown): BriefingResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const finding = (x: Record<string, unknown>): Finding => ({
    key: str(x.key), title: str(x.title), detail: str(x.detail), area: str(x.area), metric: str(x.metric),
    severity: (['high', 'medium', 'low'].includes(str(x.severity)) ? str(x.severity) : 'medium') as Finding['severity'],
  });
  const objs = (v: unknown) => arr<unknown>(v).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
  return {
    summary: str(o.summary),
    health: (['good', 'watch', 'bad'].includes(str(o.health)) ? str(o.health) : 'watch') as BriefingResult['health'],
    wins: objs(o.wins).map((x) => ({ title: str(x.title), detail: str(x.detail) })),
    issues: objs(o.issues).map(finding),
    opportunities: objs(o.opportunities).map(finding),
    plan: objs(o.plan).map((x) => ({ key: str(x.key), title: str(x.title), detail: str(x.detail), owner: str(x.owner), due_in_days: Number(x.due_in_days) || 0, expected_impact: str(x.expected_impact) })),
    watch_next: arr<unknown>(o.watch_next).map(str).filter(Boolean),
  };
}

// ─── AI analyst panel (business or surveys) ────────────────────────────────────────────────────────────

export default function AnalystPanel({ scope = 'business', suggestions = SUGGESTIONS, intro }: { scope?: 'business' | 'surveys'; suggestions?: string[]; intro?: string }) {
  const { access } = useAccess();
  const editable = canEdit(access, 'analytics');
  const state = useLoader(() => crm.get<AnalystRes>(`/api/v1/analytics/analyst?scope=${scope}`), []);
  const [viewing, setViewing] = useState<Briefing | null>(null);
  const [running, setRunning] = useState(false);
  const [toast, showToast] = useToast();
  const [itemsVersion, setItemsVersion] = useState(0);

  const run = async () => {
    setRunning(true);
    try {
      const b = await crm.post<Briefing>(`/api/v1/analytics/analyst/run?scope=${scope}`);
      setViewing(null);
      await state.reload();
      setItemsVersion((v) => v + 1);
      showToast(b.toolCalls ? `Briefing ready. The analyst made ${b.toolCalls} lookups.` : 'Briefing ready.');
    } catch (e) {
      showToast(friendlyError(e));
    } finally {
      setRunning(false);
    }
  };
  const open = async (id: string) => {
    try { setViewing(await crm.get<Briefing>(`/api/v1/analytics/analyst/briefings/${id}`)); } catch (e) { showToast(friendlyError(e)); }
  };

  if (state.error) return <ErrorBox message={state.error} onRetry={state.reload} />;
  const s = state.data;
  if (!s) return <Skeleton h={420} />;
  if (!s.configured) {
    return (
      <section className="crm-card" style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 720 }}>
        <h2 className="crm-h2"><Bot size={20} aria-hidden style={{ verticalAlign: -3, marginRight: 8 }} />Switch on the AI analyst</h2>
        <p className="crm-sub" style={{ margin: 0 }}>The analyst uses Groq. Ask your server admin to create a Groq API key and set it on the API server as the environment variable <code>Groq__ApiKey</code>, then restart the API. It then writes a business briefing every morning at 8 am and a survey briefing once a week, and you can ask it questions here.</p>
        <p className="crm-sub" style={{ margin: 0 }}>Only totals and partner and agent names are sent. Phone numbers and patient names stay on your server.</p>
      </section>
    );
  }
  const b = viewing ?? s.latest;
  const r = normalize(b?.result);

  return (
    <>
      {intro && <p className="crm-sub" style={{ margin: 0, fontSize: 14 }}>{intro}</p>}
      <section className="crm-card an-brief" aria-labelledby="br-h">
        <div className="crm-card-head">
          <h2 id="br-h" className="crm-h2" style={{ flex: 1 }}>
            {b ? <>Briefing · {fmt.dateTime(b.createdAt)}{viewing && <span className="crm-cell-sub" style={{ display: 'inline', marginLeft: 8 }}>(older one)</span>}</> : 'No briefing yet'}
          </h2>
          {b?.health && HEALTH[b.health] && <Pill tone={HEALTH[b.health].tone} dot>{HEALTH[b.health].label}</Pill>}
          {viewing && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setViewing(null)}>Back to latest</button>}
          {editable && (
            <button type="button" className="crm-btn" disabled={running || s.running} onClick={run}>
              <Sparkles size={16} aria-hidden /> {running || s.running ? 'Reading your numbers…' : 'Run analysis now'}
            </button>
          )}
        </div>
        {(running || s.running) && <div className="crm-note" role="status">The analyst is going through referrals, partners, field visits and survey answers. This takes 20 to 60 seconds.</div>}
        {s.lastError && !running && <div className="crm-error" role="alert">Last run failed: {s.lastError}</div>}
        {!b || !r ? (
          <Empty title="Nothing yet">{editable ? `Run the first analysis. After that it runs by itself ${scope === 'surveys' ? 'every week' : 'every morning'}.` : `The first briefing will appear after the ${scope === 'surveys' ? 'weekly' : 'morning'} run.`}</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6 }}>{r.summary}</p>
            <div className="an-cols">
              <FindingList title="Wins" tone="ok" items={r.wins.map((w) => ({ title: w.title, detail: w.detail }))} />
              <FindingList title="Issues" tone="bad" items={r.issues.map((x) => ({ title: x.title, detail: x.detail, meta: [x.area, x.metric].filter(Boolean).join(' · '), sev: x.severity }))} />
              <FindingList title="Opportunities" tone="accent" items={r.opportunities.map((x) => ({ title: x.title, detail: x.detail, meta: [x.area, x.metric].filter(Boolean).join(' · '), sev: x.severity }))} />
            </div>
            {r.plan.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <h3 style={{ fontSize: 16, fontWeight: 800 }}>Plan</h3>
                <ol className="an-plan">
                  {r.plan.map((x) => (
                    <li key={x.key}>
                      <strong>{x.title}</strong>
                      <span>{x.detail}</span>
                      <span className="crm-cell-sub">Owner: {x.owner} · within {x.due_in_days} day{x.due_in_days === 1 ? '' : 's'}{x.expected_impact ? ` · Expected: ${x.expected_impact}` : ''}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {r.watch_next.length > 0 && (
              <div className="crm-note"><strong>Watch next:</strong> {r.watch_next.join(' · ')}</div>
            )}
            <span className="crm-cell-sub">Covers {fmt.date(b.periodFrom)} – {fmt.date(b.periodTo)} · {b.toolCalls} lookups · {b.model}. The analyst can be wrong; check the numbers before acting.</span>
          </div>
        )}
      </section>

      <div className="crm-row">
        <Tracker key={itemsVersion} scope={scope} editable={editable} showToast={showToast} />
        <Ask scope={scope} suggestions={suggestions} />
      </div>

      {s.history.length > 1 && (
        <section className="crm-card" aria-labelledby="hi-h">
          <div className="crm-card-head"><h2 id="hi-h" className="crm-h2">Earlier briefings</h2></div>
          <ul className="crm-list">
            {s.history.map((h) => (
              <li key={h.id}>
                <span style={{ width: 130, flexShrink: 0, fontSize: 13 }}>{fmt.dateTime(h.createdAt)}<div className="crm-cell-sub">{h.by}</div></span>
                {h.health && HEALTH[h.health] && <Pill tone={HEALTH[h.health].tone}>{HEALTH[h.health].label}</Pill>}
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{h.summary}</span>
                <button type="button" className="crm-btn is-secondary is-sm" onClick={() => open(h.id)}>Read</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {toast}
    </>
  );
}

function FindingList({ title, tone, items }: { title: string; tone: Tone; items: { title: string; detail: string; meta?: string; sev?: string }[] }) {
  return (
    <div className="an-find" data-tone={tone}>
      <h3>{title} <span>{items.length}</span></h3>
      {items.length === 0 ? <span className="crm-cell-sub">None this time.</span> : items.map((x, i) => (
        <div key={i} className="an-find-item">
          <span style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}><strong>{x.title}</strong>{x.sev && <Pill tone={SEV[x.sev]}>{x.sev}</Pill>}</span>
          <span>{x.detail}</span>
          {x.meta && <span className="crm-cell-sub">{x.meta}</span>}
        </div>
      ))}
    </div>
  );
}

const STATUS_FILTERS: { k: string; l: string }[] = [{ k: 'active', l: 'Open' }, { k: 'done', l: 'Done' }, { k: 'dismissed', l: 'Dismissed' }, { k: 'all', l: 'All' }];
const STATUS_LABEL: Record<ItemStatus, string> = { open: 'Open', in_progress: 'In progress', done: 'Done', dismissed: 'Dismissed' };

function Tracker({ scope, editable, showToast }: { scope: string; editable: boolean; showToast: (m: string) => void }) {
  const { access } = useAccess();
  const canTask = canEdit(access, 'field');
  const [taskFor, setTaskFor] = useState<TaskPreset | null>(null);
  const [filter, setFilter] = useState('active');
  const items = useLoader(() => crm.get<ItemsRes>(`/api/v1/analytics/analyst/items?status=${filter}&scope=${scope}`), [filter, scope]);
  const [openId, setOpenId] = useState<string | null>(null);

  const save = async (it: Item, patch: Partial<{ status: ItemStatus; owner: string; dueDate: string; note: string }>) => {
    try {
      await crm.put(`/api/v1/analytics/analyst/items/${it.id}`, patch);
      await items.reload();
      if (patch.status) showToast(`Marked ${STATUS_LABEL[patch.status].toLowerCase()}.`);
    } catch (e) { showToast(friendlyError(e)); }
  };
  const c = items.data?.counts;

  return (
    <section className="crm-card grow-2" aria-labelledby="tk-h" style={{ flexBasis: 560 }}>
      <div className="crm-card-head">
        <h2 id="tk-h" className="crm-h2" style={{ flex: 1 }}>Tracked issues &amp; actions</h2>
        <div className="pt-seg" role="group" aria-label="Show">
          {STATUS_FILTERS.map((f) => (
            <button key={f.k} type="button" aria-pressed={filter === f.k} onClick={() => setFilter(f.k)}>
              {f.l}{c && f.k === 'active' ? ` ${c.open + c.inProgress}` : c && f.k === 'done' ? ` ${c.done}` : ''}
            </button>
          ))}
        </div>
      </div>
      <span className="crm-sub" style={{ fontSize: 13, display: 'block', marginBottom: 10 }}>Everything the analyst raises stays here until someone closes it. It checks each open item again on every run.</span>
      {items.error ? <ErrorBox message={items.error} onRetry={items.reload} /> : !items.data ? <Skeleton h={200} /> : items.data.items.length === 0 ? (
        <Empty title={filter === 'active' ? 'Nothing open' : 'Nothing here'}>{filter === 'active' ? 'Issues and actions from the next briefing will appear here.' : ''}</Empty>
      ) : (
        <ul className="crm-list">
          {items.data.items.map((it) => {
            const isOpen = openId === it.id;
            return (
              <li key={it.id} style={{ display: 'block', padding: '12px 0' }}>
                <button type="button" className="an-item-head" aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? null : it.id)}>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Pill tone={it.kind === 'issue' ? 'bad' : it.kind === 'plan' ? 'accent' : 'info'}>{KIND[it.kind]}</Pill>
                    <Pill tone={SEV[it.severity]}>{it.severity}</Pill>
                    {it.status !== 'open' && <Pill tone={it.status === 'done' ? 'ok' : 'neutral'}>{STATUS_LABEL[it.status]}</Pill>}
                    {it.trend && TREND[it.trend] && <Pill tone={TREND[it.trend].tone}>{TREND[it.trend].label}</Pill>}
                    {it.overdue && <Pill tone="bad">Overdue</Pill>}
                  </span>
                  <strong style={{ fontSize: 15 }}>{it.title}</strong>
                  <span className="crm-cell-sub">{[it.area, it.metric, it.owner && `Owner: ${it.owner}`, it.dueDate && `Due ${fmt.date(`${it.dueDate}T06:00:00Z`)}`, it.timesRaised > 1 && `raised ${it.timesRaised} times`].filter(Boolean).join(' · ')}</span>
                </button>
                {isOpen && (
                  <div className="an-item-body">
                    <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>{it.detail}</p>
                    {it.trendNote && <div className="crm-note"><strong>Latest check:</strong> {it.trendNote}</div>}
                    {editable ? (
                      <ItemEditor it={it} onSave={(patch) => save(it, patch)} />
                    ) : it.note ? <div className="crm-note">{it.note}</div> : null}
                    {canTask && (it.status === 'open' || it.status === 'in_progress') && (
                      <button type="button" className="crm-btn is-secondary is-sm" style={{ alignSelf: 'flex-start' }}
                        onClick={() => setTaskFor({ title: it.title, detail: it.detail, dueDate: it.dueDate, aiItemId: it.id })}>
                        <ClipboardCheck size={15} aria-hidden /> Give to field agents as a task
                      </button>
                    )}
                    <span className="crm-cell-sub">First raised {fmt.date(it.createdAt)} · last updated {fmt.dateTime(it.updatedAt)}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {taskFor && <TaskModal preset={taskFor} onClose={() => setTaskFor(null)} onSaved={(m) => { showToast(m); void items.reload(); }} />}
    </section>
  );
}

function ItemEditor({ it, onSave }: { it: Item; onSave: (p: Partial<{ status: ItemStatus; owner: string; dueDate: string; note: string }>) => Promise<void> }) {
  const [owner, setOwner] = useState(it.owner ?? '');
  const [due, setDue] = useState(it.dueDate ?? '');
  const [note, setNote] = useState(it.note ?? '');
  const [busy, setBusy] = useState(false);
  const dirty = owner !== (it.owner ?? '') || due !== (it.dueDate ?? '') || note !== (it.note ?? '');
  const go = async (p: Parameters<typeof onSave>[0]) => { setBusy(true); try { await onSave(p); } finally { setBusy(false); } };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="crm-form-grid">
        <label className="crm-field">Owner<input className="crm-input" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Who is doing this?" /></label>
        <label className="crm-field">Due by<input type="date" className="crm-input" value={due} onChange={(e) => setDue(e.target.value)} /></label>
      </div>
      <label className="crm-field">Team note<textarea className="crm-textarea" rows={2} style={{ minHeight: 60 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What has been done so far?" /></label>
      <div className="crm-chips" style={{ justifyContent: 'flex-end' }}>
        {dirty && <button type="button" className="crm-btn is-secondary is-sm" disabled={busy} onClick={() => go({ owner, dueDate: due, note })}>Save changes</button>}
        {it.status === 'open' && <button type="button" className="crm-btn is-secondary is-sm" disabled={busy} onClick={() => go({ status: 'in_progress', owner, dueDate: due, note })}>Start work</button>}
        {(it.status === 'open' || it.status === 'in_progress') && <button type="button" className="crm-btn is-secondary is-sm" disabled={busy} onClick={() => go({ status: 'dismissed', note })}>Dismiss</button>}
        {(it.status === 'open' || it.status === 'in_progress') && <button type="button" className="crm-btn is-ok is-sm" disabled={busy} onClick={() => go({ status: 'done', owner, dueDate: due, note })}>Mark done</button>}
        {(it.status === 'done' || it.status === 'dismissed') && <button type="button" className="crm-btn is-secondary is-sm" disabled={busy} onClick={() => go({ status: 'open' })}>Reopen</button>}
      </div>
    </div>
  );
}

const SUGGESTIONS = [
  'Which block lost the most admissions this month, and why?',
  'Which partners should the call desk ring this week?',
  'What do the surveys say we should offer in our weakest block?',
  'Which agent needs support, and with what?',
];

function Ask({ scope, suggestions }: { scope: string; suggestions: string[] }) {
  const [turns, setTurns] = useState<{ role: 'user' | 'assistant'; content: string; tools?: string[] }[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [turns.length, busy]);

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    const history = turns.map((t) => ({ role: t.role, content: t.content }));
    setTurns((t) => [...t, { role: 'user', content: text }]);
    setQ(''); setBusy(true); setError('');
    try {
      const res = await crm.post<{ answer: string; lookedUp: string[] }>('/api/v1/analytics/analyst/ask', { question: text, history, scope });
      setTurns((t) => [...t, { role: 'assistant', content: res.answer || 'No answer came back.', tools: res.lookedUp }]);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="crm-card grow-1 an-ask" aria-labelledby="ask-h" style={{ flexBasis: 380 }}>
      <div className="crm-card-head"><h2 id="ask-h" className="crm-h2"><Bot size={18} aria-hidden style={{ verticalAlign: -3, marginRight: 6 }} />Ask the analyst</h2></div>
      <div className="an-thread" aria-live="polite">
        {turns.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="crm-sub" style={{ fontSize: 13 }}>It looks up the numbers before answering. Try:</span>
            {suggestions.map((s) => <button key={s} type="button" className="an-suggest" onClick={() => ask(s)}>{s}</button>)}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`an-msg is-${t.role}`}>
            <span style={{ whiteSpace: 'pre-wrap' }}>{t.content}</span>
            {t.tools && t.tools.length > 0 && <span className="crm-cell-sub">Looked up: {t.tools.map((x) => x.replace(/^get_/, '').replace(/_/g, ' ')).join(', ')}</span>}
          </div>
        ))}
        {busy && <div className="an-msg is-assistant" role="status"><span className="crm-cell-sub">Looking at the numbers…</span></div>}
        {error && <div className="crm-error" role="alert">{error}</div>}
        <div ref={endRef} />
      </div>
      <form className="an-ask-form" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
        <label className="crm-sr" htmlFor="ask-q">Your question</label>
        <input id="ask-q" className="crm-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about referrals, partners, blocks, agents…" />
        <button type="submit" className="crm-btn" disabled={!q.trim() || busy} aria-label="Ask"><Send size={16} aria-hidden /></button>
      </form>
    </section>
  );
}
