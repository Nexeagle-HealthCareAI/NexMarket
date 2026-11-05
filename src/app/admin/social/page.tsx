'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BarChart3, ClipboardList, Inbox, Settings2 } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { useAccess } from '@/lib/crm/access';
import { PageHead, Pill, Skeleton, useToast } from '@/components/crm/ui';
import { SocialInbox } from '@/components/crm/social/SocialInbox';
import { SocialForms } from '@/components/crm/social/SocialForms';
import { SocialAds } from '@/components/crm/social/SocialAds';
import { SocialSetup } from '@/components/crm/social/SocialSetup';
import type { SocialStatus } from '@/components/crm/social/shared';

const TABS = [
  { key: 'inbox', label: 'Messages', icon: Inbox, admin: false },
  { key: 'forms', label: 'Lead forms', icon: ClipboardList, admin: false },
  { key: 'ads', label: 'Ads & results', icon: BarChart3, admin: false },
  { key: 'setup', label: 'Setup', icon: Settings2, admin: true },
] as const;

export default function SocialWrap() {
  return (
    <Suspense fallback={<main className="crm-page"><Skeleton h={520} /></main>}>
      <Social />
    </Suspense>
  );
}

/** Facebook and Instagram in one place: messages, Lead Ads form entries, ad spend against results, and setup. */
function Social() {
  const params = useSearchParams();
  const router = useRouter();
  const { access } = useAccess();
  const tabs = TABS.filter((t) => !t.admin || !!access?.isAdmin);
  const asked = params.get('tab') ?? 'inbox';
  const tab = (access && !tabs.some((t) => t.key === asked) ? 'inbox' : asked) as typeof TABS[number]['key'];
  const selected = params.get('c');
  const [status, setStatus] = useState<SocialStatus | null>(null);
  const [toast, showToast] = useToast();

  const loadStatus = useCallback(async () => {
    try { setStatus(await crm.get<SocialStatus>('/api/v1/social/status')); } catch { /* the tabs show their own errors */ }
  }, []);
  useEffect(() => {
    const first = setTimeout(() => void loadStatus(), 0);
    const t = setInterval(() => { if (!document.hidden) void loadStatus(); }, 30000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [loadStatus]);

  const go = (next: { tab?: string; c?: string | null }) => {
    const sp = new URLSearchParams();
    const t = next.tab ?? tab;
    if (t !== 'inbox') sp.set('tab', t);
    const c = next.c === undefined ? selected : next.c;
    if (c && t === 'inbox') sp.set('c', c);
    router.replace(`/admin/social${sp.size ? `?${sp}` : ''}`, { scroll: false });
  };
  const accounts = [status?.page, status?.instagram ? `@${status.instagram}` : null].filter(Boolean).join(' · ');

  return (
    <main className={`crm-page wh-page${tab === 'inbox' && selected ? ' ld-page has-sel' : ''}`}>
      <PageHead title="Facebook & Instagram" sub={accounts || 'Messages, Lead Ads form entries and ad results from the hospital’s Facebook Page and Instagram account.'}
        badge={status ? (status.connected ? <Pill tone="ok" dot>Connected</Pill> : <Pill tone="warn" dot>Not connected</Pill>) : undefined}>
        {status && status.formsToday > 0 && <span className="crm-sub"><strong style={{ color: 'var(--text)' }}>{status.formsToday}</strong> form {status.formsToday === 1 ? 'entry' : 'entries'} today</span>}
      </PageHead>

      <div className="wh-top">
        {status && !status.connected && tab !== 'setup' && (
          <div className="ld-banner"><span><strong>Facebook and Instagram aren&apos;t connected yet.</strong> {status.isAdmin ? <button type="button" className="wa-link" style={{ lineHeight: 'inherit' }} onClick={() => go({ tab: 'setup', c: null })}>Connect them in Setup →</button> : 'An admin can connect them in Setup.'}</span></div>
        )}
        <nav className="crm-tabs wh-tabs" role="tablist" aria-label="Facebook and Instagram">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.key} type="button" role="tab" className="crm-tab" aria-selected={tab === t.key} onClick={() => go({ tab: t.key, c: null })}>
                <Icon size={15} aria-hidden /> {t.label}
                {t.key === 'inbox' && status?.unread ? <span className="ld-tab-n is-hot">{status.unread}</span> : null}
              </button>
            );
          })}
        </nav>
      </div>

      {tab === 'inbox' && <SocialInbox status={status} selected={selected} onSelect={(c) => go({ c })} onChanged={loadStatus} toast={showToast} />}
      {tab === 'forms' && <SocialForms canManage={!!status?.canManage} connected={!!status?.connected} toast={showToast} />}
      {tab === 'ads' && <SocialAds hasAds={!!status?.hasAds} isAdmin={!!status?.isAdmin} onSetup={() => go({ tab: 'setup', c: null })} />}
      {tab === 'setup' && <SocialSetup onSaved={loadStatus} toast={showToast} />}
      {toast}
    </main>
  );
}
