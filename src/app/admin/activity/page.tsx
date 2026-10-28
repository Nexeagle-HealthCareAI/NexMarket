'use client';

import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  Camera, ChevronLeft, ChevronRight, ClipboardList, LogIn, LogOut, Pause, Play, Play as Start, Square, TriangleAlert, UserPlus, Send, MapPin,
} from 'lucide-react';
import { geo, istDate, type AgentActivity, type TimelineEvent, type TimelineKind } from '@/lib/crm/geo';
import { useLiveEvents, type LiveLocation } from '@/lib/crm/live';
import { Empty, ErrorBox, fmt, PageHead, Skeleton, useLoader } from '@/components/crm/ui';

const RouteMap = dynamic(() => import('@/components/crm/geo/RouteMap'), { ssr: false, loading: () => <div className="act-map"><Skeleton h={520} /></div> });

type Icon = ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
const KIND: Record<TimelineKind, { icon: Icon; c: string; soft: string }> = {
  shift_start: { icon: Start, c: '#0e1525', soft: '#e8eaf0' },
  shift_end: { icon: Square, c: '#0e1525', soft: '#e8eaf0' },
  visit_in: { icon: LogIn, c: '#0b6b4a', soft: '#e7f6ef' },
  visit_out: { icon: LogOut, c: '#0b6b4a', soft: '#e7f6ef' },
  partner: { icon: UserPlus, c: '#0a4e94', soft: '#e6f2fd' },
  referral: { icon: Send, c: '#8a5100', soft: '#fff4e0' },
  photo: { icon: Camera, c: '#5b3fb8', soft: '#efeafd' },
  survey: { icon: ClipboardList, c: '#0e6178', soft: '#e6f6fa' },
  gap: { icon: TriangleAlert, c: '#b42318', soft: '#fdecea' },
};

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function ActivityInner() {
  const params = useSearchParams();
  const router = useRouter();
  const today = istDate(0);
  const agentId = params.get('agent') ?? '';
  const date = params.get('date') ?? today;
  const agents = useLoader(() => geo.live(), []);
  const firstAgent = agents.data?.agents[0]?.agentId;
  const effectiveAgent = agentId || firstAgent || '';

  const setQuery = useCallback((next: { agent?: string; date?: string }) => {
    const p = new URLSearchParams(params.toString());
    if (next.agent !== undefined) p.set('agent', next.agent);
    if (next.date !== undefined) p.set('date', next.date);
    router.replace(`/admin/activity?${p.toString()}`);
  }, [params, router]);

  const act = useLoader<AgentActivity | null>(() => (effectiveAgent ? geo.activity(effectiveAgent, date) : Promise.resolve(null)), [effectiveAgent, date]);
  const [focus, setFocus] = useState<TimelineEvent | null>(null);
  const [replayIdx, setReplayIdx] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const route = act.data?.route ?? [];

  // Today's timeline keeps itself current.
  const isToday = date === today;
  const onLocation = useCallback((l: LiveLocation) => { if (isToday && l.agentId === effectiveAgent) void act.reload(); }, [isToday, effectiveAgent, act]);
  const onEvent = useCallback(() => { if (isToday) void act.reload(); }, [isToday, act]);
  useLiveEvents(onEvent, onLocation);
  useEffect(() => {
    if (!isToday) return;
    const t = setInterval(() => void act.reload(), 60000);
    return () => clearInterval(t);
  }, [isToday, act]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setReplayIdx((i) => {
        const next = (i ?? -1) + 1;
        if (next >= route.length) { setPlaying(false); return route.length - 1; }
        return next;
      });
    }, 120);
    return () => clearInterval(t);
  }, [playing, route.length]);

  // Reset replay and focus whenever a different day or agent is opened.
  const viewKey = `${effectiveAgent}|${date}`;
  const [lastView, setLastView] = useState(viewKey);
  if (lastView !== viewKey) {
    setLastView(viewKey);
    setFocus(null);
    setReplayIdx(null);
    setPlaying(false);
  }

  const d = act.data;
  const s = d?.stats;
  const replayAt = replayIdx != null ? route[replayIdx]?.at : null;
  const nowEventIdx = useMemo(() => {
    if (!replayAt || !d) return -1;
    let idx = -1;
    d.events.forEach((e, i) => { if (e.at <= replayAt) idx = i; });
    return idx;
  }, [replayAt, d]);

  return (
    <main className="crm-page">
      <PageHead title="Agent activity" sub="Everything one agent did on a day, in order, with the route they took.">
        <div className="crm-chips" style={{ alignItems: 'center' }}>
          <select className="crm-select" aria-label="Agent" value={effectiveAgent} onChange={(e) => setQuery({ agent: e.target.value })} style={{ width: 'auto', minWidth: 180 }}>
            {(agents.data?.agents ?? []).map((a) => <option key={a.agentId} value={a.agentId}>{a.name}</option>)}
          </select>
          <button type="button" className="crm-btn is-secondary" aria-label="Previous day" onClick={() => setQuery({ date: shiftDate(date, -1) })} style={{ width: 44, padding: 0 }}><ChevronLeft size={18} aria-hidden /></button>
          <input type="date" className="crm-input" aria-label="Day" value={date} max={today} onChange={(e) => e.target.value && setQuery({ date: e.target.value })} style={{ width: 'auto' }} />
          <button type="button" className="crm-btn is-secondary" aria-label="Next day" disabled={date >= today} onClick={() => setQuery({ date: shiftDate(date, 1) })} style={{ width: 44, padding: 0 }}><ChevronRight size={18} aria-hidden /></button>
        </div>
      </PageHead>

      {agents.error && <ErrorBox message={agents.error} onRetry={agents.reload} />}
      {act.error && <ErrorBox message={act.error} onRetry={act.reload} />}
      {agents.data && agents.data.agents.length === 0 && <Empty title="No field agents yet">Onboard agents in Users &amp; roles.</Empty>}

      {!d ? (effectiveAgent ? <Skeleton h={600} /> : null) : (
        <>
          <div className="crm-kpis">
            <Stat label="Distance" value={`${s!.km}`} unit="km" sub={s!.firstSeen ? `${fmt.time(s!.firstSeen)} – ${fmt.time(s!.lastSeen)}` : 'No GPS today'} />
            <Stat label="On shift" value={`${s!.shiftHours}`} unit="h" sub={`${Math.round(s!.minutesInPanchayats / 60 * 10) / 10} h inside panchayats`} />
            <Stat label="Visits" value={`${s!.visits}`} sub={`${s!.panchayats} panchayat${s!.panchayats === 1 ? '' : 's'}`} />
            <Stat label="Partners added" value={`${s!.partners}`} sub={`${s!.surveys} survey${s!.surveys === 1 ? '' : 's'} done`} />
            <Stat label="Referrals" value={`${s!.referrals}`} sub={`${s!.photos} photo${s!.photos === 1 ? '' : 's'}`} />
            <Stat label="Location gaps" value={`${s!.gaps}`} sub={s!.gaps ? '30+ min with no GPS on shift' : 'Tracked all shift'} bad={s!.gaps > 0} />
          </div>

          <div className="act-layout">
            <section className="crm-card" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14 }} aria-label="Route">
              <RouteMap data={d} focus={focus} replayIndex={replayIdx} />
              {route.length > 1 && (
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <button type="button" className="crm-btn is-secondary is-sm" onClick={() => { if (replayIdx == null || replayIdx >= route.length - 1) setReplayIdx(0); setPlaying((p) => !p); }} aria-label={playing ? 'Pause replay' : 'Replay the day'} style={{ width: 40, padding: 0 }}>
                    {playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
                  </button>
                  <input type="range" min={0} max={route.length - 1} value={replayIdx ?? 0} onChange={(e) => { setPlaying(false); setReplayIdx(Number(e.target.value)); }} aria-label="Replay position" style={{ flex: 1 }} />
                  <span className="crm-sub" style={{ fontSize: 13, minWidth: 64, textAlign: 'right' }}>{replayAt ? fmt.time(replayAt) : 'Replay'}</span>
                </div>
              )}
            </section>

            <section className="crm-card" aria-labelledby="tl-h">
              <div className="crm-card-head">
                <h2 id="tl-h" className="crm-h2">Timeline</h2>
                <span className="crm-sub" style={{ fontSize: 13 }}>{fmt.date(`${d.date}T06:30:00Z`)} · {d.events.length} events</span>
              </div>
              {d.events.length === 0 ? <Empty title="Nothing recorded">No shift, visit or partner on this day.</Empty> : (
                <ol className="act-timeline">
                  {d.events.map((e, i) => {
                    const k = KIND[e.kind] ?? KIND.partner;
                    const Ico = k.icon;
                    return (
                      <li key={`${e.kind}-${e.at}-${i}`} className={e.kind === 'gap' ? 'act-gap' : undefined}>
                        <span className="act-icon" style={{ ['--c' as string]: k.c, ['--c-soft' as string]: k.soft }}><Ico size={16} aria-hidden /></span>
                        <button type="button" className="act-item" aria-current={focus === e || nowEventIdx === i ? 'true' : undefined} onClick={() => setFocus(e)}>
                          <span style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                            <strong style={{ fontSize: 14 }}>{e.title}</strong>
                            <span className="crm-cell-sub" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>{fmt.time(e.at)}</span>
                          </span>
                          {e.detail && <span className="crm-cell-sub">{e.detail}</span>}
                          {e.lat != null && e.kind !== 'gap' && <span className="crm-cell-sub" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><MapPin size={11} aria-hidden /> on map</span>}
                          {e.url && <a href={e.url} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()} style={{ fontSize: 12 }}>Open photo</a>}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}

function Stat({ label, value, unit, sub, bad }: { label: string; value: string; unit?: string; sub?: string; bad?: boolean }) {
  return (
    <div className="crm-card crm-kpi" style={bad ? { borderColor: '#f2c4c0', background: 'var(--bad-soft)' } : undefined}>
      <span className="crm-kpi-label">{label}</span>
      <span className="crm-kpi-value" style={bad ? { color: 'var(--bad)' } : undefined}>{value}{unit && <span className="crm-kpi-unit">{unit}</span>}</span>
      {sub && <span className="crm-cell-sub">{sub}</span>}
    </div>
  );
}

export default function ActivityPage() {
  return (
    <Suspense fallback={<main className="crm-page"><Skeleton h={600} /></main>}>
      <ActivityInner />
    </Suspense>
  );
}
