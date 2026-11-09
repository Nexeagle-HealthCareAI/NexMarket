'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Bot, Globe, LayoutDashboard, Search, Settings2, Star } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { canEdit, canView, useAccess } from '@/lib/crm/access';
import AnalystPanel from '@/components/crm/AnalystPanel';
import { PageHead, Pill, Skeleton, useToast } from '@/components/crm/ui';
import { DateRangeBar, type DateRangeKey, type DateRangeValue } from '@/components/crm/DateRange';
import { GoogleOverview } from '@/components/crm/google/GoogleOverview';
import { GoogleSearch } from '@/components/crm/google/GoogleSearch';
import { GoogleReviews } from '@/components/crm/google/GoogleReviews';
import { GoogleWebsite } from '@/components/crm/google/GoogleWebsite';
import { GoogleSetup } from '@/components/crm/google/GoogleSetup';

const TABS = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard, admin: false, dates: true },
  { key: 'search', label: 'Search terms', icon: Search, admin: false, dates: true },
  { key: 'reviews', label: 'Reviews', icon: Star, admin: false, dates: false },
  { key: 'website', label: 'Website & ads', icon: Globe, admin: false, dates: true },
  { key: 'ai', label: 'AI analyst', icon: Bot, admin: false, dates: false },
  { key: 'setup', label: 'Setup', icon: Settings2, admin: true, dates: false },
] as const;
const KEYS: DateRangeKey[] = ['', '7d', '30d', 'month', 'custom'];

interface Status { connected: boolean; email?: string | null }

export default function GoogleWrap() {
  return (
    <Suspense fallback={<main className="crm-page"><Skeleton h={520} /></main>}>
      <GooglePage />
    </Suspense>
  );
}

/**
 * The hospital on Google: its listing on Search and Maps (calls, directions, reviews), what people search, website
 * visits, YouTube and Google Ads. NexMarket reads all of it straight from Google with the hospital's own account.
 */
function GooglePage() {
  const params = useSearchParams();
  const router = useRouter();
  const { access } = useAccess();
  const tabs = TABS.filter((t) => (!t.admin || !!access?.isAdmin) && (t.key !== 'ai' || canView(access, 'analytics')));
  const asked = params.get('tab') ?? 'overview';
  const tab = (access && !tabs.some((t) => t.key === asked) ? 'overview' : asked) as typeof TABS[number]['key'];
  const [range, setRange] = useState<DateRangeValue>(() => {
    const d = params.get('d') ?? '30d';
    const key = (d === 'all' ? '' : KEYS.includes(d as DateRangeKey) ? d : '30d') as DateRangeKey;
    return { key, from: params.get('from') ?? '', to: params.get('to') ?? '' };
  });
  const [status, setStatus] = useState<Status | null>(null);
  const [toast, showToast] = useToast();

  const loadStatus = useCallback(async () => {
    if (!access?.isAdmin) return;
    try { setStatus(await crm.get<Status>('/api/v1/settings/google')); } catch { /* the tabs show their own errors */ }
  }, [access?.isAdmin]);
  useEffect(() => { const t = setTimeout(() => void loadStatus(), 0); return () => clearTimeout(t); }, [loadStatus]);

  const go = useCallback((t: string, r: DateRangeValue = range) => {
    const sp = new URLSearchParams();
    if (t !== 'overview') sp.set('tab', t);
    if (r.key !== '30d') sp.set('d', r.key || 'all');
    if (r.key === 'custom') { if (r.from) sp.set('from', r.from); if (r.to) sp.set('to', r.to); }
    router.replace(`/admin/google${sp.size ? `?${sp}` : ''}`, { scroll: false });
  }, [range, router]);

  // Back from Google's sign-in screen.
  useEffect(() => {
    const ok = params.get('google');
    const err = params.get('google_error');
    if (!ok && !err) return;
    const t = setTimeout(() => {
      showToast(err ? err : 'Google account connected. Now pick which accounts to follow.');
      void loadStatus();
      go('setup');
    }, 0);
    return () => clearTimeout(t);
  }, [params, showToast, loadStatus, go]);

  const meta = TABS.find((t) => t.key === tab)!;
  const setR = (r: DateRangeValue) => { setRange(r); go(tab, r); };

  return (
    <main className="crm-page wh-page">
      <PageHead title="Google" sub="The hospital on Google Search and Maps, its website, YouTube and Google Ads, read directly from Google."
        badge={status ? (status.connected ? <Pill tone="ok" dot>Connected</Pill> : <Pill tone="warn" dot>Not connected</Pill>) : undefined} />

      <div className="wh-top">
        <nav className="crm-tabs wh-tabs" role="tablist" aria-label="Google">
          {tabs.map((t) => {
            const Icon = t.icon;
            return <button key={t.key} type="button" role="tab" className="crm-tab" aria-selected={tab === t.key} onClick={() => go(t.key)}><Icon size={15} aria-hidden /> {t.label}</button>;
          })}
        </nav>
      </div>
      {meta.dates && <DateRangeBar value={range} onChange={setR} id="gg" keys={KEYS} />}

      {tab === 'overview' && <GoogleOverview range={range} onTab={(t) => go(t)} onSynced={loadStatus} toast={showToast} />}
      {tab === 'search' && <GoogleSearch range={range} />}
      {tab === 'reviews' && <GoogleReviews canReply={canEdit(access, 'social')} onTab={(t) => go(t)} toast={showToast} />}
      {tab === 'website' && <GoogleWebsite range={range} toast={showToast} />}
      {tab === 'ai' && (
        <AnalystPanel scope="google"
          intro="The analyst reads the Google numbers NexMarket fetches (listing calls and directions, search terms, website visits, YouTube, Google Ads and reviews, totals only, no reviewer names) next to the leads Google brought and admissions by department, and turns them into actions for the marketing team. It writes a new briefing every week."
          suggestions={[
            'Which Google searches have demand we are not winning yet, and what page or doctor profile would win them?',
            'Are calls and direction requests from the Google listing going up or down, and why?',
            'Which Google Ads campaign costs the most per patient, and where should the budget move?',
            'How is our Google rating moving, and how many low-rated reviews still need a reply?',
          ]} />
      )}
      {tab === 'setup' && <GoogleSetup onSaved={loadStatus} toast={showToast} />}
      {toast}
    </main>
  );
}
