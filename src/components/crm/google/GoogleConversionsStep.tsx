'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ExternalLink, Send, ShieldCheck, XCircle } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { friendlyError, Skeleton } from '@/components/crm/ui';
import { when } from './shared';

interface Status {
  convArrived?: string | null; convAdmitted?: string | null; sentAt?: string | null; last?: string | null;
  fromAds: number; waiting: number; sentArrived: number; sentAdmitted: number;
  refused: { id: string; name?: string | null; error?: string | null }[]; scopeOk: boolean;
}
interface Result { ok: boolean; sent: number; failed: number; waiting: number; error?: string | null; validated: boolean }

/**
 * Google → Setup, step 5: tells Google Ads which ad clicks became patients. When a lead that came from a Google ad is marked
 * Arrived or Admitted, NexMarket sends that to Google Ads (every morning, or now), so Google can show which ads bring patients.
 */
export function GoogleConversionsStep({ connected, adsPicked, toast, onReconnect }: { connected: boolean; adsPicked: boolean; toast: (m: string) => void; onReconnect: () => void }) {
  const [s, setS] = useState<Status | null>(null);
  const [arrived, setArrived] = useState('');
  const [admitted, setAdmitted] = useState('');
  const [busy, setBusy] = useState<'' | 'save' | 'check' | 'send'>('');
  const [result, setResult] = useState<Result | null>(null);
  const [guide, setGuide] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await crm.get<Status>('/api/v1/settings/google/conversions');
      setS(r); setArrived(r.convArrived ?? ''); setAdmitted(r.convAdmitted ?? '');
      if (!r.convArrived) setGuide(true);
    } catch (e) { toast(friendlyError(e)); }
  }, [toast]);
  useEffect(() => { if (!connected) return; const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [connected, load]);

  const save = async () => {
    setBusy('save');
    try { const r = await crm.put<Status>('/api/v1/settings/google/conversions', { arrived: arrived.trim(), admitted: admitted.trim() }); setS(r); toast('Saved. Press “Check with Google” next.'); }
    catch (e) { toast(friendlyError(e)); } finally { setBusy(''); }
  };
  const run = async (kind: 'check' | 'send') => {
    setBusy(kind); setResult(null);
    try { setResult(await crm.post<Result>(`/api/v1/settings/google/conversions/${kind}`)); await load(); }
    catch (e) { toast(friendlyError(e)); } finally { setBusy(''); }
  };

  const done = !!s?.convArrived && !!s?.sentAt;
  return (
    <section className="crm-card so-card">
      <h2 className="crm-h2 gg-step"><span className={`gg-n${done ? ' is-done' : ''}`}>{done ? <CheckCircle2 size={16} aria-hidden /> : 5}</span> Tell Google Ads which clicks became patients</h2>
      <p className="crm-sub" style={{ margin: 0 }}>
        When someone who clicked a Google ad sends an enquiry and is later marked <strong>Arrived</strong> or <strong>Admitted</strong>, NexMarket tells Google Ads,
        every morning. Google then shows which ads and keywords bring real patients, not only clicks, and can spend more on those. Only the click code and the time are sent:
        no name, phone or medical detail. Only for Google ads; skip this step if you don&apos;t run them.
      </p>
      {!connected ? <p className="crm-sub" style={{ margin: 0 }}>Sign in first.</p> : !adsPicked ? <p className="crm-sub" style={{ margin: 0 }}>Pick the Google Ads account in step 3 first.</p> : !s ? <Skeleton h={160} /> : (
        <>
          {!s.scopeOk && (
            <p className="gg-err" style={{ margin: 0 }}><XCircle size={13} aria-hidden /> Google hasn&apos;t given NexMarket permission to send these yet. Press <button type="button" className="wa-link" onClick={onReconnect}>Connect again</button> and allow everything Google asks.</p>
          )}
          <button type="button" className="wa-link gg-guide-btn" aria-expanded={guide} onClick={() => setGuide((g) => !g)}>How to set it up (10 minutes, once) <ChevronDown size={14} aria-hidden style={{ transform: guide ? 'rotate(180deg)' : undefined }} /></button>
          {guide && (
            <ol className="gg-guide">
              <li>In <a href="https://console.cloud.google.com/apis/library/datamanager.googleapis.com" target="_blank" rel="noreferrer">Google Cloud <ExternalLink size={12} aria-hidden /></a> (the same NexMarket project), turn on the <code>Data Manager API</code>.</li>
              <li>Press <strong>Connect again</strong> in step 2 and allow the new permission (&ldquo;send conversions&rdquo;).</li>
              <li>In <a href="https://ads.google.com/aw/conversions" target="_blank" rel="noreferrer">Google Ads <ExternalLink size={12} aria-hidden /></a>: <strong>Goals → Conversions → New conversion action → Import → CRMs, files or other data sources → Track conversions from clicks</strong>. Make one called <em>Came to hospital</em> (category: <em>Qualified lead</em>, value: none or an average bill, count: <em>One</em>) and, if you like, a second called <em>Admitted</em> (category: <em>Converted lead</em>).</li>
              <li>Open each one. Its <strong>conversion action ID</strong> is the number after <code>ctId=</code> in the browser&apos;s address bar. Put them in the boxes below.</li>
              <li>Make sure <strong>auto-tagging</strong> is on (Google Ads → Admin → Account settings). Without it ads carry no click code, and nothing can be matched.</li>
            </ol>
          )}
          <div className="gg-picks">
            <label className="crm-field gg-pick">
              <span><strong>“Came to hospital” conversion action ID</strong> <span className="crm-sub">Sent when a Google lead is marked Arrived</span></span>
              <input className="crm-input" inputMode="numeric" value={arrived} onChange={(e) => setArrived(e.target.value)} placeholder="e.g. 7012345678" />
            </label>
            <label className="crm-field gg-pick">
              <span><strong>“Admitted” conversion action ID</strong> <span className="crm-sub">Optional. Sent when a Google lead is marked Admitted</span></span>
              <input className="crm-input" inputMode="numeric" value={admitted} onChange={(e) => setAdmitted(e.target.value)} placeholder="e.g. 7012345679" />
            </label>
          </div>
          <div className="sp-actions">
            <button type="button" className="crm-btn is-sm" disabled={!!busy} onClick={() => void save()}>Save</button>
            <button type="button" className="crm-btn is-secondary is-sm" disabled={!!busy || !s.convArrived} onClick={() => void run('check')}><ShieldCheck size={14} aria-hidden /> {busy === 'check' ? 'Checking…' : 'Check with Google'}</button>
            <button type="button" className="crm-btn is-secondary is-sm" disabled={!!busy || !s.convArrived || s.waiting === 0} onClick={() => void run('send')}><Send size={14} aria-hidden /> {busy === 'send' ? 'Sending…' : `Send now (${s.waiting})`}</button>
          </div>
          {result && (
            <p className={result.ok ? 'crm-sub' : 'gg-err'} style={{ margin: 0 }} role="status">
              {result.ok ? <CheckCircle2 size={13} aria-hidden /> : <XCircle size={13} aria-hidden />}{' '}
              {result.error ?? (result.validated
                ? `Google accepted all ${result.sent} without recording them. Everything is set up right.`
                : `Sent ${result.sent} to Google Ads${result.failed ? `; Google refused ${result.failed} (see below)` : ''}.`)}
            </p>
          )}
          <ul className="gg-runs">
            <li className="is-ok"><span><strong>{s.fromAds.toLocaleString('en-IN')}</strong> <span className="crm-sub">enquiries came from a Google ad click in the last 90 days</span></span></li>
            <li className="is-ok"><span><strong>{s.sentArrived.toLocaleString('en-IN')}</strong> <span className="crm-sub">arrivals and</span> <strong>{s.sentAdmitted.toLocaleString('en-IN')}</strong> <span className="crm-sub">admissions sent to Google Ads</span></span></li>
            <li className="is-ok"><span><strong>{s.waiting.toLocaleString('en-IN')}</strong> <span className="crm-sub">waiting to be sent</span></span></li>
            {s.refused.map((r) => (
              <li key={r.id} className="is-bad"><XCircle size={15} aria-hidden /><span><strong>{r.name ?? 'Lead'}</strong> <span>{r.error}</span></span></li>
            ))}
          </ul>
          {s.sentAt && <span className="crm-sub">Last sent {when(s.sentAt)}. Google Ads shows them in Conversions within about a day.</span>}
        </>
      )}
    </section>
  );
}
