'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Bot, Inbox, ListChecks, Megaphone, Pause, Play, ScrollText, Settings2, Wallet, Workflow } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { canView, useAccess } from '@/lib/crm/access';
import { friendlyError, PageHead, Pill, Skeleton, useToast } from '@/components/crm/ui';
import { WaInbox } from '@/components/crm/wa/WaInbox';
import { WaLog } from '@/components/crm/wa/WaLog';
import { WaTemplates } from '@/components/crm/wa/WaTemplates';
import { WaAutomation } from '@/components/crm/wa/WaAutomation';
import { WaBroadcasts } from '@/components/crm/wa/WaBroadcasts';
import { WaSetup } from '@/components/crm/wa/WaSetup';
import { WaBilling } from '@/components/crm/wa/WaBilling';
import AnalystPanel from '@/components/crm/AnalystPanel';
import { showPhone, when, type WaStatus } from '@/components/crm/wa/shared';

/** Who sees each tab: everyone on the WhatsApp page, those who can open broadcasts, those who manage WhatsApp, or only admins. */
const TABS = [
  { key: 'inbox', label: 'Inbox', icon: Inbox, who: 'all' },
  { key: 'broadcasts', label: 'Broadcasts', icon: Megaphone, who: 'whatsapp' },
  { key: 'messages', label: 'All messages', icon: ScrollText, who: 'all' },
  { key: 'templates', label: 'Templates', icon: ListChecks, who: 'all' },
  { key: 'automation', label: 'Automation', icon: Workflow, who: 'all' },
  { key: 'ai', label: 'AI analyst', icon: Bot, who: 'analytics' },
  { key: 'billing', label: 'Billing', icon: Wallet, who: 'manage' },
  { key: 'setup', label: 'Setup', icon: Settings2, who: 'admin' },
] as const;

export default function WhatsAppHubWrap() {
  return (
    <Suspense fallback={<main className="crm-page"><Skeleton h={520} /></main>}>
      <WhatsAppHub />
    </Suspense>
  );
}

/** Everything WhatsApp in one place: conversations, broadcasts, every message, templates, rules and setup. */
function WhatsAppHub() {
  const params = useSearchParams();
  const router = useRouter();
  const { access } = useAccess();
  const [status, setStatus] = useState<WaStatus | null>(null);
  const tabs = TABS.filter((t) => t.who === 'all' || (t.who === 'admin' ? !!access?.isAdmin : t.who === 'manage' ? !!status?.canManage : t.who === 'analytics' ? canView(access, 'analytics') : canView(access, 'whatsapp')));
  const asked = params.get('tab') ?? 'inbox';
  // A tab this person can't open (or an old link) falls back to the inbox. (Billing waits for the status to know.)
  const tab = (access && (asked !== 'billing' || status) && !tabs.some((t) => t.key === asked) ? 'inbox' : asked) as typeof TABS[number]['key'];
  const selected = params.get('c');
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();

  const loadStatus = useCallback(async () => {
    try { setStatus(await crm.get<WaStatus>('/api/v1/whatsapp/status')); } catch { /* the tabs show their own errors */ }
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
    router.replace(`/admin/whatsapp${sp.size ? `?${sp}` : ''}`, { scroll: false });
  };
  const togglePause = async () => {
    if (!status) return;
    setBusy(true);
    try {
      await crm.post('/api/v1/whatsapp/pause', { paused: !status.paused });
      await loadStatus();
      showToast(status.paused ? 'WhatsApp sending is back on.' : 'All WhatsApp sending is paused.');
    } catch (e) { showToast(friendlyError(e)); } finally { setBusy(false); }
  };
  const bill = status?.billing;
  const billPct = bill && bill.budget > 0 ? Math.round((bill.spent / bill.budget) * 100) : 0;
  const used = status && status.dailyLimit > 0 ? Math.min(100, Math.round((status.templatesToday / status.dailyLimit) * 100)) : 0;

  return (
    <main className={`crm-page wh-page${tab === 'inbox' && selected ? ' ld-page has-sel' : ''}`}>
      <PageHead title="WhatsApp" sub={status?.displayPhone ? `${status.hospital} · ${showPhone(status.displayPhone)}` : 'Everything WhatsApp in one place: conversations, broadcasts, every message, templates, rules and setup.'}
        badge={status ? (!status.connected ? <Pill tone="warn" dot>Not connected</Pill> : status.paused ? <Pill tone="bad" dot>Sending paused</Pill> : <Pill tone="ok" dot>Live</Pill>) : undefined}>
        <div className="wh-controls">
          {status && status.dailyLimit > 0 && (
            <div className="wh-meter" title="Template messages (broadcasts, follow-ups) sent today against the daily limit">
              <span><strong>{status.templatesToday}</strong> / {status.dailyLimit} templates today</span>
              <span className="wh-meter-bar"><span style={{ width: `${used}%` }} className={used >= 90 ? 'is-high' : undefined} /></span>
            </div>
          )}
          {status?.canManage && status.connected && (
            <button type="button" className={`crm-btn ${status.paused ? '' : 'is-secondary'}`} disabled={busy} onClick={() => void togglePause()}>
              {status.paused ? <><Play size={16} aria-hidden /> Resume sending</> : <><Pause size={16} aria-hidden /> Pause all sending</>}
            </button>
          )}
        </div>
      </PageHead>

      <div className="wh-top">
        {status?.paused && (
          <div className="wh-paused">
            <Pause size={18} aria-hidden />
            <span><strong>Nothing is going out on WhatsApp.</strong> Replies, instant replies, broadcasts and follow-ups are held{status.pausedBy ? ` (paused by ${status.pausedBy}${status.pausedAt ? `, ${when(status.pausedAt)}` : ''})` : ''}. Incoming messages still arrive.</span>
          </div>
        )}
        {bill && billPct >= bill.alertPercent && tab !== 'billing' && (
          <div className={billPct >= 100 ? 'wh-paused' : 'ld-banner'}>
            <AlertTriangle size={18} aria-hidden />
            <span>
              <strong>{billPct >= 100 ? 'This month’s WhatsApp budget is spent.' : `${billPct}% of this month’s WhatsApp budget is spent.`}</strong>{' '}
              {billPct >= 100 && bill.stopAtBudget ? 'Broadcasts and follow-up templates are on hold. ' : ''}
              <button type="button" className="wa-link" style={{ lineHeight: 'inherit' }} onClick={() => go({ tab: 'billing', c: null })}>See billing →</button>
            </span>
          </div>
        )}
        {status && !status.connected && tab !== 'setup' && (
          <div className="ld-banner"><span><strong>WhatsApp isn&apos;t connected yet.</strong> {status.isAdmin ? <button type="button" className="wa-link" style={{ lineHeight: 'inherit' }} onClick={() => go({ tab: 'setup', c: null })}>Connect it in Setup →</button> : 'An admin can connect it in the Setup tab.'}</span></div>
        )}
        <nav className="crm-tabs wh-tabs" role="tablist" aria-label="WhatsApp">
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

      {tab === 'inbox' && <WaInbox status={status} selected={selected} onSelect={(c) => go({ c })} onChanged={loadStatus} toast={showToast} />}
      {tab === 'messages' && <WaLog onOpen={(c) => go({ tab: 'inbox', c })} toast={showToast} canManage />}
      {tab === 'templates' && <WaTemplates canManage={!!status?.canManage} toast={showToast} />}
      {tab === 'broadcasts' && <WaBroadcasts />}
      {tab === 'automation' && <WaAutomation canManage={!!status?.canManage} toast={showToast} />}
      {tab === 'billing' && status?.canManage && <WaBilling isAdmin={!!status.isAdmin} toast={showToast} />}
      {tab === 'ai' && (
        <AnalystPanel scope="whatsapp"
          intro="The analyst reads WhatsApp as counts only (no phone numbers or names): people writing in, how fast staff reply, busy hours, opt-outs, broadcasts and how many WhatsApp and QR-code leads came to the hospital, and turns them into actions for the desk and marketing. It writes a new briefing every week."
          suggestions={[
            'How fast does the desk reply on WhatsApp, and at which hours do we need more people?',
            'Which broadcasts get read and replied to, and which should we stop?',
            'Where do WhatsApp leads stall before coming to the hospital?',
            'Are opt-outs going up, and what is causing them?',
          ]} />
      )}
      {tab === 'setup' && <WaSetup onSaved={loadStatus} />}
      {toast}
    </main>
  );
}
