'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { BarChart3, Bot, ClipboardList, History, IndianRupee, Loader2, Smartphone, Stethoscope, Users, ListChecks, type LucideIcon } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { ErrorBox, fmt, Skeleton, useLoader } from '@/components/crm/ui';
import AnalystPanel, { type AnalystView } from '@/components/crm/AnalystPanel';

interface AreaRow {
  key: string; label: string; autoEveryDays: number; latestAt?: string | null; health?: string | null; summary?: string | null;
  running: boolean; open: number; overdue: number; high: number;
}

const ICON: Record<string, LucideIcon> = { business: BarChart3, partners: Users, field: Smartphone, referrals: Stethoscope, money: IndianRupee, surveys: ListChecks };
const HEALTH_DOT: Record<string, string> = { good: 'var(--ok)', watch: 'var(--warn)', bad: 'var(--bad)' };

const INTRO: Record<string, string> = {
  business: 'The whole picture: referrals, admissions, partners, field work and surveys together. Written every morning.',
  partners: 'Who is sending patients, who has gone quiet, which partner types convert, champions and the follow-up backlog.',
  field: 'Each agent\'s visits, coverage of their block, new partners, follow-up discipline, survey skipping and attendance.',
  referrals: 'Where patients drop out between referral, arrival and admission, and which departments, blocks and partner types bring them.',
  money: 'What is paid to partners against the admissions it brings: cost per admission, pending and overdue payouts, partners paid with no admissions.',
  surveys: 'What the community survey says each area needs, and how well the survey is being done.',
};

const SUGGEST: Record<string, string[]> = {
  business: [
    'Which block lost the most admissions this month, and why?',
    'What are the three most important things to fix this week?',
    'How does this month compare with last month?',
  ],
  partners: [
    'Which partners should the call desk ring this week?',
    'Which partner type sends patients who actually get admitted?',
    'Who signed up recently but has never referred anyone?',
  ],
  field: [
    'Which agent needs support, and with what?',
    'Which panchayats in assigned blocks have never been visited?',
    'Who is adding partners without doing the survey?',
  ],
  referrals: [
    'Where are we losing patients between referral and arrival?',
    'Which department gets the most referrals but the fewest admissions?',
    'Which blocks send patients who actually arrive?',
  ],
  money: [
    'What is our cost per admission, and is it going up?',
    'Which partners were paid but sent no admitted patients?',
    'How much is waiting for approval or overdue?',
  ],
  surveys: [
    'What should we offer in our weakest block?',
    'Where do patients go today instead of us?',
    'Which agents are skipping the survey?',
  ],
};

const VIEWS: { k: AnalystView; l: string; icon: LucideIcon }[] = [
  { k: 'brief', l: 'Briefing', icon: ClipboardList },
  { k: 'items', l: 'Issues & actions', icon: ListChecks },
  { k: 'ask', l: 'Ask', icon: Bot },
  { k: 'history', l: 'History', icon: History },
];

/** Analytics → AI analyst: one tab per area, and inside each the briefing, tracked items, questions and history. */
export default function AnalystWorkspace() {
  const params = useSearchParams();
  const router = useRouter();
  const areas = useLoader(() => crm.get<{ configured: boolean; areas: AreaRow[] }>('/api/v1/analytics/analyst/areas'), []);
  const list = areas.data?.areas ?? [];
  const area = list.some((a) => a.key === params.get('area')) ? params.get('area')! : 'business';
  const view = (VIEWS.some((v) => v.k === params.get('view')) ? params.get('view') : 'brief') as AnalystView;
  const go = (a: string, v: AnalystView) => {
    const sp = new URLSearchParams({ tab: 'ai' });
    if (a !== 'business') sp.set('area', a);
    if (v !== 'brief') sp.set('view', v);
    router.replace(`/admin/reports?${sp}`, { scroll: false });
  };
  const cur = list.find((a) => a.key === area);

  if (areas.error) return <ErrorBox message={areas.error} onRetry={areas.reload} />;
  if (!areas.data) return <Skeleton h={420} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="an-areas" role="tablist" aria-label="Analyst areas">
        {list.map((a) => {
          const Icon = ICON[a.key] ?? BarChart3;
          return (
            <button key={a.key} type="button" role="tab" aria-selected={a.key === area} className="an-area" onClick={() => go(a.key, view)}>
              <span className="an-area-top">
                <Icon size={16} aria-hidden />
                <strong>{a.label}</strong>
                {a.running ? <Loader2 size={14} className="an-spin" aria-label="Writing a briefing" />
                  : a.health ? <span className="an-dot" style={{ background: HEALTH_DOT[a.health] ?? 'var(--muted)' }} aria-label={`Health: ${a.health}`} /> : null}
              </span>
              <span className="an-area-sub">
                {a.open > 0 ? <><b style={{ color: a.high > 0 ? 'var(--bad)' : undefined }}>{a.open}</b> open{a.overdue ? ` · ${a.overdue} overdue` : ''}</> : 'Nothing open'}
              </span>
              <span className="an-area-sub">{a.latestAt ? `Last: ${fmt.date(a.latestAt)}` : 'No briefing yet'}</span>
            </button>
          );
        })}
      </div>

      <p className="crm-sub" style={{ margin: 0, fontSize: 14 }}>
        {INTRO[area]} {cur && area !== 'business' ? <span className="crm-cell-sub" style={{ display: 'inline' }}>Runs by itself about once a week, or press Run analysis now.</span> : null}
      </p>

      <div className="crm-tabs" role="tablist" aria-label="Analyst views">
        {VIEWS.map((v) => (
          <button key={v.k} type="button" role="tab" className="crm-tab" aria-selected={view === v.k} onClick={() => go(area, v.k)}>
            <v.icon size={14} aria-hidden style={{ verticalAlign: -2, marginRight: 6 }} />{v.l}
            {v.k === 'items' && cur?.open ? <span className="an-count">{cur.open}</span> : null}
          </button>
        ))}
      </div>

      <AnalystPanel key={`${area}-${view}`} scope={area} view={view} suggestions={SUGGEST[area]} onChanged={() => void areas.reload()} />
    </div>
  );
}
