'use client';

/* eslint-disable @next/next/no-img-element */
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Activity as ActivityIcon, Box, Building2, Gauge, LayoutGrid, Lightbulb, Play, ScrollText, ShieldCheck, Square } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { ErrorBox, friendlyError, Modal, Skeleton, useToast } from '@/components/crm/ui';
import { Floor, Lane, Side } from '@/components/crm/ai/Office';
import { Activity, LessonsPanel, LimitsPanel, PolicyPanel, TryGuard } from '@/components/crm/ai/Panels';
import type { ActionRow, Lesson, Mode, OverviewRes, Settings } from '@/components/crm/ai/shared';
import { POSE } from '@/components/crm/ai/shared';

const Office3D = dynamic(() => import('@/components/crm/ai/Office3D').then((m) => m.Office3D), {
  ssr: false, loading: () => <div className="ai-3d ai-3d-loading">Building the office…</div>,
});
const VIEW_KEY = 'vita.office.view';
function canWebGL(): boolean {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

type Tab = 'office' | 'activity' | 'guard' | 'limits' | 'policy' | 'lessons';
const TABS: { k: Tab; l: string; icon: typeof Building2 }[] = [
  { k: 'office', l: 'Office', icon: Building2 }, { k: 'activity', l: 'Activity', icon: ActivityIcon }, { k: 'guard', l: 'Try the Guard', icon: ShieldCheck },
  { k: 'limits', l: 'Limits', icon: Gauge }, { k: 'policy', l: 'Policy & facts', icon: ScrollText }, { k: 'lessons', l: 'Lessons', icon: Lightbulb },
];

export default function AiAgentsWrap() {
  return <Suspense fallback={<main className="crm-page"><Skeleton h={520} /></main>}><AiAgents /></Suspense>;
}

function AiAgents() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = (TABS.find((t) => t.k === params.get('tab'))?.k ?? 'office') as Tab;
  const [ov, setOv] = useState<OverviewRes | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [feed, setFeed] = useState<ActionRow[]>([]);
  const [more, setMore] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [sel, setSel] = useState('compliance_guard');
  const [view, setView] = useState<'3d' | '2d'>('2d');
  const [has3d, setHas3d] = useState(false);
  useEffect(() => {
    const ok = canWebGL();
    let saved: string | null = null;
    try { saved = localStorage.getItem(VIEW_KEY); } catch { /* private mode */ }
    // Reading the browser once after mount; nothing to sync from React state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHas3d(ok); setView(ok && saved !== '2d' ? '3d' : '2d');
  }, []);
  const pickView = (v: '3d' | '2d') => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ } };
  const [busy, setBusy] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [tick, setTick] = useState(0);
  const [toast, show] = useToast();

  const load = useCallback(async () => {
    try {
      const r = await crm.get<OverviewRes>('/api/v1/ai-agents/overview');
      setOv(r); setErr(null); setOffline(false);
    } catch (e) {
      const m = String((e as Error)?.message ?? '');
      setOffline(m.includes('503'));
      setErr(friendlyError(e));
    }
  }, []);
  const loadFeed = useCallback(async () => {
    try {
      const rows = await crm.get<ActionRow[]>('/api/v1/ai-agents/actions?limit=60');
      setFeed(rows); setMore(rows.length === 60);
    } catch { /* the overview shows the error */ }
  }, []);
  const loadSettings = useCallback(async () => {
    try { setSettings(await crm.get<Settings>('/api/v1/ai-agents/settings')); } catch { /* shown by the overview */ }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => { void load(); void loadFeed(); }, 0);
    const t = setInterval(() => { if (!document.hidden) { void load(); void loadFeed(); setTick((n) => n + 1); } }, 10000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [load, loadFeed]);
  useEffect(() => {
    const t = setTimeout(() => {
      if ((tab === 'limits' || tab === 'policy') && !settings) void loadSettings();
      if (tab === 'lessons') void crm.get<Lesson[]>('/api/v1/ai-agents/lessons').then(setLessons).catch(() => undefined);
    }, 0);
    return () => clearTimeout(t);
  }, [tab, settings, loadSettings]);

  const go = (k: Tab) => router.replace(k === 'office' ? '/admin/ai-agents' : `/admin/ai-agents?tab=${k}`, { scroll: false });
  const data = ov?.data;
  const nameOf = useCallback((id: string) => data?.agents.find((a) => a.id === id)?.name ?? id, [data]);
  const handoffs = useMemo(() => feed.filter((f) => f.kind === 'handoff'), [feed]);
  const selected = data?.agents.find((a) => a.id === sel) ?? data?.agents[0];
  const selFeed = useMemo(() => feed.filter((f) => f.agent_id === selected?.id), [feed, selected]);

  // On a phone the agent's card is below the floor, so picking a room scrolls to it.
  const pick = (id: string) => {
    setSel(id);
    if (window.matchMedia('(max-width: 960px)').matches) setTimeout(() => document.querySelector('.ai-side')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try { await fn(); show(msg); await Promise.all([load(), loadFeed()]); } catch (e) { show(friendlyError(e)); } finally { setBusy(false); }
  };
  const stopAll = () => act(() => crm.post('/api/v1/ai-agents/stop-all', { reason: reason.trim() || null }), 'All agents stopped. Nothing will be sent until you resume.').then(() => { setStopOpen(false); setReason(''); });
  const resumeAll = () => act(() => crm.post('/api/v1/ai-agents/resume-all'), 'Agents resumed.');

  if (!ov && offline) return <Offline message={err} onRetry={load} />;
  if (!ov) return <main className="crm-page">{err ? <ErrorBox message={err} onRetry={load} /> : <Skeleton h={560} />}</main>;
  const d = ov.data;
  const on = d.agents.filter((a) => a.available && a.mode !== 'off' && !a.paused).length;
  const waitingCheck = d.agents.reduce((n, a) => n + (a.reviews?.waiting ?? 0), 0);

  return (
    <main className="crm-page ai-page">
      {toast}
      <header className="ai-top">
        <div className="ai-brand">
          <img src="/brand/vita/ai.webp" alt="Vita" />
          <div>
            <h1>Vita Marketing Autonomous Agents</h1>
            <span className="ai-sub">
              <span className={`ai-dot ${d.stopAll.on ? 'is-off' : 'is-live'}`} aria-hidden />
              {d.stopAll.on ? `All agents stopped${d.stopAll.by ? ` by ${d.stopAll.by.replace(/\s*\(.*\)$/, '')}` : ''} — nothing is sent` : `${on} of ${d.agents.length} on duty · works while you're away`}
              {!d.groq && <span className="ai-warn-chip" title="Set GROQ_API_KEY on the agents service">AI model not connected</span>}
            </span>
          </div>
        </div>
        <div className="ai-stats">
          <div><span>Done today</span><b>{d.today.done}</b></div>
          <div><span>Practice</span><b>{d.today.shadow}</b></div>
          <div><span>Stopped by Guard</span><b className="is-warn">{d.today.blocked}</b></div>
          <div><span>Hand-offs</span><b>{d.handoffsToday}</b></div>
          <div><span>AI tokens</span><b>{d.tokensToday.toLocaleString('en-IN')}</b></div>
        </div>
        {d.stopAll.on
          ? <button type="button" className="ai-stop is-resume" disabled={busy} onClick={() => void resumeAll()}><Play size={16} aria-hidden /> Resume all agents</button>
          : <button type="button" className="ai-stop" disabled={busy} onClick={() => setStopOpen(true)}><Square size={16} aria-hidden /> Stop all agents</button>}
      </header>

      <nav className="ai-tabs" role="tablist" aria-label="Vita marketing agents">
        {TABS.map((t) => (
          <button key={t.k} type="button" role="tab" aria-selected={tab === t.k} onClick={() => go(t.k)}><t.icon size={16} aria-hidden />{t.l}</button>
        ))}
      </nav>

      {err && <ErrorBox message={err} onRetry={load} />}
      {waitingCheck > 0 && tab !== 'activity' && (
        <button type="button" className="ai-check-banner" onClick={() => router.replace('/admin/ai-agents?tab=activity&show=check', { scroll: false })}>
          <strong>{waitingCheck} practice {waitingCheck === 1 ? 'message is' : 'messages are'} waiting for you to check.</strong> Say good, fix it, or wrong, and send the good ones from here.
        </button>
      )}

      {tab === 'office' && (
        <>
          <div className="ai-view-row">
            <Lane items={handoffs} nameOf={nameOf} tick={tick} />
            {has3d && (
              <div className="ai-view" role="group" aria-label="Office view">
                <button type="button" aria-pressed={view === '3d'} onClick={() => pickView('3d')}><Box size={15} aria-hidden />3D</button>
                <button type="button" aria-pressed={view === '2d'} onClick={() => pickView('2d')}><LayoutGrid size={15} aria-hidden />Floor plan</button>
              </div>
            )}
          </div>
          <div className="ai-office">
            {view === '3d' && has3d
              ? <Office3D data={d} selected={selected?.id ?? ''} onPick={pick} handoff={handoffs[0] ?? null} onFail={() => { setHas3d(false); setView('2d'); }} feed={feed} />
              : <Floor data={d} selected={selected?.id ?? ''} onPick={pick} incoming={handoffs[0]?.to_agent ?? null} />}
            {selected && (
              <Side a={selected} stopAll={d.stopAll.on} me={ov.me} busy={busy} feed={selFeed}
                onPause={() => void act(() => crm.post(`/api/v1/ai-agents/agents/${selected.id}/pause`, { reason: null }), `${selected.name} paused.`)}
                onResume={() => void act(() => crm.post(`/api/v1/ai-agents/agents/${selected.id}/resume`), `${selected.name} resumed.`)}
                onMode={(m: Mode) => void act(() => crm.put(`/api/v1/ai-agents/agents/${selected.id}/mode`, { mode: m }), `${selected.name} is now ${m}.`)}
                onCheck={() => router.replace('/admin/ai-agents?tab=activity&show=check', { scroll: false })} />
            )}
          </div>
          <p className="ai-foot"><ShieldCheck size={15} aria-hidden /> Every message to patients, partners or the public passes the Compliance Guard first. Agents only act through NexMarket, and no patient details go to the AI.</p>
        </>
      )}
      {tab === 'activity' && (
        <Activity key={params.get('show') ?? ''} startChecking={params.get('show') === 'check'} rows={feed} agents={d.agents} more={more}
          onChanged={(m) => { show(m); void load(); void loadFeed(); }} onMore={() => {
          const last = feed[feed.length - 1];
          if (!last) return;
          void crm.get<ActionRow[]>(`/api/v1/ai-agents/actions?limit=60&before=${encodeURIComponent(last.created_at)}`).then((rows) => { setFeed((f) => [...f, ...rows]); setMore(rows.length === 60); }).catch(() => undefined);
        }} />
      )}
      {tab === 'guard' && <TryGuard />}
      {tab === 'limits' && (settings ? <LimitsPanel key={JSON.stringify(settings.meta)} settings={settings} canEdit={ov.me.canEdit} onSaved={(m) => { show(m); void loadSettings(); }} /> : <Skeleton h={420} />)}
      {tab === 'policy' && (settings ? <PolicyPanel key={JSON.stringify(settings.meta)} settings={settings} canEdit={ov.me.canEdit} onSaved={(m) => { show(m); void loadSettings(); }} /> : <Skeleton h={420} />)}
      {tab === 'lessons' && <LessonsPanel lessons={lessons} agents={d.agents} onChanged={(m) => { show(m); void crm.get<Lesson[]>('/api/v1/ai-agents/lessons').then(setLessons).catch(() => undefined); void load(); }} />}

      {stopOpen && (
        <Modal title="Stop all agents?" onClose={() => setStopOpen(false)} actions={<>
          <button type="button" className="crm-btn is-secondary" onClick={() => setStopOpen(false)}>Cancel</button>
          <button type="button" className="crm-btn ai-btn-danger" disabled={busy} onClick={() => void stopAll()}>Stop all agents</button>
        </>}>
          <p>Every agent stops at once. Nothing more is sent, posted or replied until you press Resume. Work in progress is kept.</p>
          <label className="ai-field"><span>Why (optional, shown to the team)</span><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></label>
        </Modal>
      )}
    </main>
  );
}

function Offline({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <main className="crm-page ai-page">
      <div className="ai-offline">
        <img src={POSE.sleep} alt="" />
        <h1>Vita&apos;s marketing agents aren&apos;t running yet</h1>
        <p>{message ?? 'The agents service is not answering.'} While it is down, no agent sends anything.</p>
        <ol>
          <li>Run the agents service next to the API (see <code>agents/README.md</code>).</li>
          <li>Give both the same secret: <code>AGENTS_SECRET</code> on the service, <code>Agents__Secret</code> on the API.</li>
          <li>Add the Groq key to the service as <code>GROQ_API_KEY</code>.</li>
        </ol>
        <button type="button" className="crm-btn" onClick={onRetry}>Try again</button>
      </div>
    </main>
  );
}
