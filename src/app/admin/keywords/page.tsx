'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { KanbanSquare, List, Map as MapIcon, RefreshCw, Settings2, Target } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { canEdit, useAccess } from '@/lib/crm/access';
import { friendlyError, PageHead, Skeleton, useToast } from '@/components/crm/ui';
import { Opportunities } from '@/components/crm/keywords/Opportunities';
import { TopicView } from '@/components/crm/keywords/TopicView';
import { Areas } from '@/components/crm/keywords/Areas';
import { Plan } from '@/components/crm/keywords/Plan';
import { KeywordList } from '@/components/crm/keywords/KeywordList';
import { KwSetup } from '@/components/crm/keywords/KwSetup';
import type { KwStatus, OppRes, Person } from '@/components/crm/keywords/shared';

const TABS = [
  { key: 'opportunities', label: 'Opportunities', icon: Target },
  { key: 'areas', label: 'Areas', icon: MapIcon },
  { key: 'plan', label: 'Content plan', icon: KanbanSquare },
  { key: 'keywords', label: 'All keywords', icon: List },
  { key: 'setup', label: 'Sources & topics', icon: Settings2 },
] as const;
type TabKey = typeof TABS[number]['key'];

export default function KeywordsWrap() {
  return (
    <Suspense fallback={<main className="crm-page"><Skeleton h={520} /></main>}>
      <Keywords />
    </Suspense>
  );
}

/**
 * Network → Keywords: what people around the hospital search for, the topics it is missing, by district, and the pages,
 * posts, ads and camps made for each topic, followed through to patients.
 */
function Keywords() {
  const params = useSearchParams();
  const router = useRouter();
  const { access } = useAccess();
  const editable = canEdit(access, 'social') || canEdit(access, 'analytics');
  const asked = params.get('tab') as TabKey | null;
  const tab: TabKey = TABS.some((t) => t.key === asked) ? asked! : 'opportunities';
  const topic = params.get('topic');
  const [toast, showToast] = useToast();
  const [status, setStatus] = useState<KwStatus | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [topics, setTopics] = useState<{ id: string; name: string }[]>([]);
  const [running, setRunning] = useState<'' | 'quick' | 'planner'>('');
  const [reloadKey, setReloadKey] = useState(0);

  const loadStatus = useCallback(async () => {
    try { setStatus(await crm.get<KwStatus>('/api/v1/keywords/status')); } catch { /* the tabs show their own errors */ }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      void loadStatus();
      crm.get<Person[]>('/api/v1/keywords/people').then(setPeople).catch(() => setPeople([]));
      crm.get<OppRes>('/api/v1/keywords/opportunities?all=true').then((r) => setTopics(r.topics.map((x) => ({ id: x.id, name: x.name })).sort((a, b) => a.name.localeCompare(b.name)))).catch(() => setTopics([]));
    }, 0);
    return () => clearTimeout(t);
  }, [loadStatus, reloadKey]);

  const go = (next: { tab?: TabKey; topic?: string | null }) => {
    const sp = new URLSearchParams();
    const t = next.tab ?? tab;
    if (t !== 'opportunities') sp.set('tab', t);
    const tp = next.topic === undefined ? topic : next.topic;
    if (tp) sp.set('topic', tp);
    router.replace(`/admin/keywords${sp.size ? `?${sp}` : ''}`, { scroll: false });
  };
  const open = (id: string) => go({ tab: 'opportunities', topic: id });

  const run = async (planner: boolean) => {
    setRunning(planner ? 'planner' : 'quick');
    try {
      const r = await crm.post<{ ok: boolean; keywords: number; error?: string | null; planner: boolean }>('/api/v1/keywords/run', { planner });
      showToast(r.error ? `Updated ${r.keywords} keywords. ${r.error}` : planner ? `Updated ${r.keywords} keywords with Keyword Planner.` : `Updated ${r.keywords} keywords.`);
      setReloadKey((k) => k + 1);
    } catch (e) { showToast(friendlyError(e)); } finally { setRunning(''); }
  };
  const sub = 'What people around the hospital search for, and where you are missing patients.';

  return (
    <main className="crm-page kw-page">
      <PageHead title="Keywords" sub={sub}>
        {editable && (
          <div className="kw-actions-row">
            <button type="button" className="crm-btn is-secondary" disabled={!!running} onClick={() => void run(false)}><RefreshCw size={14} aria-hidden /> {running === 'quick' ? 'Refreshing…' : 'Refresh'}</button>
            <button type="button" className="crm-btn" disabled={!!running || !status?.google.ads} title={status?.google.ads ? undefined : 'Needs Google Ads (Google → Setup)'} onClick={() => void run(true)}>{running === 'planner' ? 'Asking Keyword Planner…' : 'Refresh volumes'}</button>
          </div>
        )}
      </PageHead>
      {status && !status.google.connected && (
        <div className="ld-banner"><span><strong>Google isn&apos;t connected yet.</strong> Keywords come from Search Console, Business Profile and Google Ads. Connect them in Google → Setup; WhatsApp phrases are counted meanwhile.</span></div>
      )}
      <nav className="crm-tabs" role="tablist" aria-label="Keywords">
        {TABS.map((t) => {
          const Icon = t.icon;
          return <button key={t.key} type="button" role="tab" className="crm-tab" aria-selected={tab === t.key && !topic} onClick={() => go({ tab: t.key, topic: null })}><Icon size={15} aria-hidden /> {t.label}</button>;
        })}
      </nav>
      <div key={reloadKey}>
        {topic ? <TopicView id={topic} people={people} editable={editable} topics={topics} onBack={() => go({ topic: null })} toast={showToast} />
          : tab === 'opportunities' ? <Opportunities people={people} editable={editable} onOpen={open} toast={showToast} />
            : tab === 'areas' ? <Areas onOpen={open} onPlanCamp={() => router.push('/admin/camps')} />
              : tab === 'plan' ? <Plan people={people} editable={editable} onOpen={open} toast={showToast} />
                : tab === 'keywords' ? <KeywordList editable={editable} toast={showToast} />
                  : <KwSetup status={status} people={people} editable={editable} onChanged={() => setReloadKey((k) => k + 1)} onOpen={open} toast={showToast} />}
      </div>
      {toast}
    </main>
  );
}
