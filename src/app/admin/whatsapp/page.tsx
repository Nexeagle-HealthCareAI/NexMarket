'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Inbox, ListChecks, Pause, Play, ScrollText, Settings2, Workflow } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { friendlyError, PageHead, Pill, Skeleton, useToast } from '@/components/crm/ui';
import { WaInbox } from '@/components/crm/wa/WaInbox';
import { WaLog } from '@/components/crm/wa/WaLog';
import { WaTemplates } from '@/components/crm/wa/WaTemplates';
import { WaAutomation } from '@/components/crm/wa/WaAutomation';
import { showPhone, when, type WaStatus } from '@/components/crm/wa/shared';

const TABS = [
  { key: 'inbox', label: 'Inbox', icon: Inbox },
  { key: 'messages', label: 'All messages', icon: ScrollText },
  { key: 'templates', label: 'Templates', icon: ListChecks },
  { key: 'automation', label: 'Automation', icon: Workflow },
] as const;

export default function WhatsAppHubWrap() {
  return (
    <Suspense fallback={<main className="crm-page"><Skeleton h={520} /></main>}>
      <WhatsAppHub />
    </Suspense>
  );
}

/** Everything WhatsApp in one place: conversations, every message sent and received, templates, and the rules. */
function WhatsAppHub() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = (params.get('tab') ?? 'inbox') as typeof TABS[number]['key'];
  const selected = params.get('c');
  const [status, setStatus] = useState<WaStatus | null>(null);
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
  const used = status && status.dailyLimit > 0 ? Math.min(100, Math.round((status.templatesToday / status.dailyLimit) * 100)) : 0;

  return (
    <main className={`crm-page wh-page${tab === 'inbox' && selected ? ' ld-page has-sel' : ''}`}>
      <PageHead title="WhatsApp" sub={status?.displayPhone ? `${status.hospital} · ${showPhone(status.displayPhone)}` : 'Every conversation, message, template and rule on the hospital’s WhatsApp number.'}
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
          {status?.isAdmin && <Link className="crm-btn is-secondary" href="/admin/whatsapp-setup"><Settings2 size={16} aria-hidden /> Setup</Link>}
        </div>
      </PageHead>

      <div className="wh-top">
        {status?.paused && (
          <div className="wh-paused">
            <Pause size={18} aria-hidden />
            <span><strong>Nothing is going out on WhatsApp.</strong> Replies, instant replies, broadcasts and follow-ups are held{status.pausedBy ? ` (paused by ${status.pausedBy}${status.pausedAt ? `, ${when(status.pausedAt)}` : ''})` : ''}. Incoming messages still arrive.</span>
          </div>
        )}
        {status && !status.connected && (
          <div className="ld-banner"><span><strong>WhatsApp isn&apos;t connected yet.</strong> {status.isAdmin ? <Link href="/admin/whatsapp-setup">Connect it in WhatsApp setup →</Link> : 'An admin can connect it in Settings → WhatsApp setup.'}</span></div>
        )}
        <nav className="crm-tabs wh-tabs" role="tablist" aria-label="WhatsApp">
          {TABS.map((t) => {
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
      {tab === 'automation' && <WaAutomation canManage={!!status?.canManage} toast={showToast} />}
      {toast}
    </main>
  );
}
