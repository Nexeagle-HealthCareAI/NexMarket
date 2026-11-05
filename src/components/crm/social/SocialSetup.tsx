'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, AtSign, BellRing, CheckCircle2, MessageCircle, Target, ChevronDown, Copy, DownloadCloud, Eye, EyeOff, KeyRound, Link2, RefreshCw, ShieldCheck, Unplug, Webhook, XCircle,
} from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { ErrorBox, friendlyError, Pill, Skeleton } from '@/components/crm/ui';
import { when } from './shared';

interface SecretInfo { set: boolean; hint?: string | null; unreadable: boolean }
interface Data {
  fields: { appId?: string | null; verifyToken?: string | null; apiVersion: string };
  secrets: { appSecret: SecretInfo; accessToken: SecretInfo };
  connection: {
    pageId?: string | null; pageName?: string | null; igId?: string | null; igUsername?: string | null; adAccountId?: string | null; adAccountName?: string | null;
    currency?: string | null; connectedAt?: string | null; pageConnected: boolean; receiving?: boolean | null; receivingError?: string | null;
  };
  webhookUrl: string;
  conversions: { datasetId?: string | null; datasetName?: string | null; datasetError?: string | null; sent30d: number; lastError?: string | null; lastErrorAt?: string | null };
  instantWhatsApp: { template?: string | null; connected: boolean };
  needed: { scope: string; for: string }[];
  activity: { formLeads7d: number; messages7d: number; lastFormAt?: string | null; lastMessageAt?: string | null };
}
interface TestRes {
  who?: string | null; scopes?: string[] | null; expiresAt?: string | null; neverExpires: boolean;
  missing?: { scope: string; for: string }[] | null;
  pages: { id: string; name: string; igId?: string | null; igUsername?: string | null }[];
  adAccounts: { id: string; name: string; currency?: string | null; active: boolean }[];
  adsError?: string | null;
}

/** Facebook & Instagram → Setup: connect the app, the Page (with its Instagram account) and the ad account. */
export function SocialSetup({ onSaved, toast }: { onSaved: () => void; toast: (m: string) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appId, setAppId] = useState('');
  const [verify, setVerify] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestRes | null>(null);
  const [testErr, setTestErr] = useState<string | null>(null);
  const [pageId, setPageId] = useState('');
  const [adId, setAdId] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [dataset, setDataset] = useState('');
  const [savingDs, setSavingDs] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await crm.get<Data>('/api/v1/settings/meta');
      setData(r); setAppId(r.fields.appId ?? ''); setVerify(r.fields.verifyToken ?? '');
      setPageId(r.connection.pageId ?? ''); setAdId(r.connection.adAccountId ?? ''); setDataset(r.conversions.datasetId ?? ''); setError(null);
    } catch (e) { setError(friendlyError(e)); }
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  if (error && !data) return <ErrorBox message={error} onRetry={load} />;
  if (!data) return <Skeleton h={640} />;
  const c = data.connection;
  const dirty = appId !== (data.fields.appId ?? '') || verify !== (data.fields.verifyToken ?? '') || secret !== null || token !== null;
  const step1Done = !!data.fields.appId && data.secrets.appSecret.set && data.secrets.accessToken.set;

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast(`${what} copied.`); } catch { toast('Copy blocked by the browser. Select and copy it instead.'); }
  };
  const save = async () => {
    setSaving(true);
    try {
      await crm.put('/api/v1/settings/meta', { appId, verifyToken: verify, ...(secret !== null ? { appSecret: secret } : {}), ...(token !== null ? { accessToken: token } : {}) });
      setSecret(null); setToken(null); await load(); onSaved(); toast('Saved.');
    } catch (e) { toast(friendlyError(e)); } finally { setSaving(false); }
  };
  const check = async () => {
    setTesting(true); setTestErr(null);
    try {
      const r = await crm.post<TestRes>('/api/v1/settings/meta/test', { appId, ...(secret ? { appSecret: secret } : {}), ...(token ? { accessToken: token } : {}) });
      setTest(r);
      if (!pageId && r.pages.length === 1) setPageId(r.pages[0].id);
      if (!adId && r.adAccounts.length === 1) setAdId(r.adAccounts[0].id);
    } catch (e) { setTest(null); setTestErr(friendlyError(e)); } finally { setTesting(false); }
  };
  const connect = async () => {
    setConnecting(true);
    try {
      const r = await crm.post<{ warning?: string | null }>('/api/v1/settings/meta/connect', { pageId: pageId || undefined, adAccountId: adId });
      toast(r.warning ?? 'Connected.'); await load(); onSaved();
    } catch (e) { toast(friendlyError(e)); } finally { setConnecting(false); }
  };
  const disconnect = async () => {
    if (!window.confirm('Stop receiving Facebook and Instagram leads and messages in the CRM? Everything already here stays.')) return;
    try { await crm.post('/api/v1/settings/meta/disconnect'); await load(); onSaved(); toast('Disconnected.'); } catch (e) { toast(friendlyError(e)); }
  };
  const saveDataset = async () => {
    setSavingDs(true);
    try { await crm.put('/api/v1/settings/meta', { datasetId: dataset.trim() }); await load(); toast(dataset.trim() ? 'Lead stages will be sent to Meta every few minutes.' : 'Lead stages are no longer sent to Meta.'); }
    catch (e) { toast(friendlyError(e)); } finally { setSavingDs(false); }
  };
  const syncForms = async () => {
    setSyncing(true);
    try { const r = await crm.post<{ added: number }>('/api/v1/social/forms/sync?days=90'); toast(r.added ? `${r.added} past form entries added.` : 'No past form entries to add.'); await load(); }
    catch (e) { toast(friendlyError(e)); } finally { setSyncing(false); }
  };

  return (
    <div className="wa-page">
      <div className="wa-activity wa-activity-row">
        {c.pageConnected ? <Pill tone="ok" dot>Connected</Pill> : <Pill tone="warn" dot>Not connected yet</Pill>}
        {c.pageName && <span><strong>{c.pageName}</strong></span>}
        {c.igUsername && <span><AtSign size={13} aria-hidden style={{ verticalAlign: '-2px' }} />{c.igUsername}</span>}
        <span><strong>{data.activity.formLeads7d}</strong> form entries</span>
        <span><strong>{data.activity.messages7d}</strong> messages</span>
        <span className="crm-sub">last 7 days</span>
      </div>

      <details className="crm-card wa-guide">
        <summary><ShieldCheck size={18} aria-hidden /> <strong>Before you start (about 30 minutes, once)</strong><ChevronDown size={16} aria-hidden className="wa-chev" /></summary>
        <ol>
          <li>The hospital&apos;s Facebook Page and Instagram professional account must be in the same <a href="https://business.facebook.com/settings" target="_blank" rel="noreferrer">Meta Business</a> account, and the Instagram account linked to the Page (Page settings → Linked accounts).</li>
          <li>At <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">developers.facebook.com</a>, use the same Business app as WhatsApp (or create one) and add <em>Webhooks</em>, <em>Messenger</em> and <em>Instagram</em>. Copy the App ID and App secret (App settings → Basic) into step 1.</li>
          <li>In Business settings → <em>System users</em>, give the system user the Page, the Instagram account and the ad account (full control), then <em>Generate token</em> for this app with the permissions listed in step 1, set to never expire.</li>
          <li>Page settings → <em>Leads access</em>: allow this app (and the CRM&apos;s system user) to receive leads.</li>
          <li>Until Meta approves the app (App Review: <code>leads_retrieval</code>, <code>pages_messaging</code>, <code>instagram_manage_messages</code>; for All posts also <code>pages_read_engagement</code>, <code>read_insights</code> and <code>instagram_manage_insights</code>), it works for people with a role on the app; set the app to <em>Live</em> after approval.</li>
        </ol>
      </details>

      {/* 1. App and token */}
      <section className="crm-card wa-step">
        <StepHead n={1} done={step1Done} title="Connect the Meta app" sub="The app and a system-user token. Secrets are stored encrypted and never shown again." />
        <div className="wa-grid">
          <label className="wa-field">
            <span className="wa-label">App ID</span>
            <input className="crm-input" value={appId} onChange={(e) => setAppId(e.target.value.trim())} inputMode="numeric" placeholder="e.g. 1234567890123456" />
            <span className="wa-hint">App settings → Basic</span>
          </label>
          <Secret label="App secret" info={data.secrets.appSecret} value={secret} onChange={setSecret} placeholder="32 characters" hint="Proves each lead and message really comes from Meta." />
          <Secret label="System-user access token" info={data.secrets.accessToken} value={token} onChange={setToken} placeholder="EAAG…" hint="Never-expiring token with the permissions below." />
        </div>
        <div className="wa-actions">
          <button type="button" className="crm-btn" disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
          <button type="button" className="crm-btn is-secondary" disabled={testing} onClick={() => void check()}>
            <RefreshCw size={16} aria-hidden className={testing ? 'wa-spin' : undefined} /> {testing ? 'Checking…' : 'Check token'}
          </button>
          <span className="crm-sub">Checks the token typed above (or the saved one) with Meta and lists the Pages and ad accounts it can use.</span>
        </div>
        {testErr && <div className="wa-result is-bad"><XCircle size={18} aria-hidden /><span><strong>Meta said no.</strong> {testErr}</span></div>}
        {test && (
          <div className={`wa-result ${test.missing && test.missing.length ? 'is-warn' : 'is-ok'}`}>
            {test.missing && test.missing.length ? <AlertTriangle size={18} aria-hidden /> : <CheckCircle2 size={18} aria-hidden />}
            <span>
              <strong>Token works</strong>{test.who ? ` (${test.who})` : ''}. {test.neverExpires ? 'It never expires.' : test.expiresAt ? `It expires ${when(test.expiresAt)}; use a never-expiring system-user token.` : ''}
              {test.missing && test.missing.length > 0 && <> Missing permissions: {test.missing.map((m) => <code key={m.scope} title={m.for}>{m.scope}</code>).reduce<React.ReactNode[]>((a, x, i) => (i ? [...a, ', ', x] : [x]), [])}. Generate the token again with them ticked.</>}
              {test.scopes == null && ' Save the App ID and secret to see which permissions it has.'}
            </span>
          </div>
        )}
        <div className="so-scopes">
          {data.needed.map((n) => (
            <span key={n.scope} className={`so-scope${test?.scopes ? (test.scopes.includes(n.scope) ? ' is-ok' : ' is-bad') : ''}`} title={n.for}><code>{n.scope}</code> {n.for}</span>
          ))}
        </div>
      </section>

      {/* 2. Page and ad account */}
      <section className="crm-card wa-step">
        <StepHead n={2} done={c.pageConnected} title="Pick the Page and ad account" sub="The Page's Instagram account comes with it. The ad account is only for spend and results." />
        <div className="wa-grid">
          <label className="wa-field">
            <span className="wa-label">Facebook Page</span>
            <select className="crm-select" value={pageId} onChange={(e) => setPageId(e.target.value)}>
              <option value="">{test ? 'Pick a Page' : c.pageName ?? 'Check the token first'}</option>
              {(test?.pages ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}{p.igUsername ? ` · @${p.igUsername}` : ' · no Instagram linked'}</option>)}
              {!test && c.pageId && <option value={c.pageId}>{c.pageName ?? c.pageId}</option>}
            </select>
            <span className="wa-hint">{c.pageConnected ? `Connected: ${c.pageName}${c.igUsername ? ` and @${c.igUsername}` : ' (no Instagram account linked to this Page)'}` : 'Only Pages the system user can manage are listed.'}</span>
          </label>
          <label className="wa-field">
            <span className="wa-label">Ad account</span>
            <select className="crm-select" value={adId} onChange={(e) => setAdId(e.target.value)}>
              <option value="">None</option>
              {(test?.adAccounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}{a.currency ? ` (${a.currency})` : ''}{a.active ? '' : ' · not active'}</option>)}
              {!test && c.adAccountId && <option value={c.adAccountId}>{c.adAccountName ?? c.adAccountId}</option>}
            </select>
            <span className="wa-hint">{test?.adsError ? `Ad accounts couldn't be listed: ${test.adsError}` : c.adAccountName ? `Connected: ${c.adAccountName}${c.currency ? ` (${c.currency})` : ''}` : 'Optional.'}</span>
          </label>
        </div>
        <div className="wa-actions">
          <button type="button" className="crm-btn" disabled={connecting || !data.secrets.accessToken.set || (!pageId && !adId)} onClick={() => void connect()}><Link2 size={16} aria-hidden /> {connecting ? 'Connecting…' : c.pageConnected ? 'Update' : 'Connect'}</button>
          {c.pageConnected && <button type="button" className="crm-btn is-secondary" onClick={() => void disconnect()}><Unplug size={16} aria-hidden /> Disconnect</button>}
          {!data.secrets.accessToken.set && <span className="crm-sub">Save the token in step 1 first.</span>}
        </div>
      </section>

      {/* 3. Webhook */}
      <section className="crm-card wa-step">
        <StepHead n={3} done={!!(data.activity.lastFormAt || data.activity.lastMessageAt)} title="Receive leads and messages" sub="In the Meta app: Webhooks → Page and Instagram. Connecting in step 2 subscribes the Page; the app needs the callback once." />
        <div className="wa-grid">
          <label className="wa-field">
            <span className="wa-label">Callback URL</span>
            <div className="wa-copy">
              <input className="crm-input" value={data.webhookUrl} readOnly onFocus={(e) => e.target.select()} />
              <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void copy(data.webhookUrl, 'Callback URL')}><Copy size={15} aria-hidden /> Copy</button>
            </div>
          </label>
          <label className="wa-field">
            <span className="wa-label">Verify token</span>
            <div className="wa-copy">
              <input className="crm-input" value={verify} onChange={(e) => setVerify(e.target.value)} />
              <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void copy(verify, 'Verify token')}><Copy size={15} aria-hidden /> Copy</button>
            </div>
            <span className="wa-hint">Changed it? Press Save in step 1.</span>
          </label>
        </div>
        <ol className="wb-steps">
          <li><strong>Page</strong> object: paste the callback URL and verify token, then subscribe to <code>leadgen</code>, <code>messages</code> and <code>message_echoes</code>.</li>
          <li><strong>Instagram</strong> object: the same URL and token, subscribe to <code>messages</code>.</li>
          <li>Test it with Meta&apos;s <a href="https://developers.facebook.com/tools/lead-ads-testing" target="_blank" rel="noreferrer">Lead Ads testing tool</a>, or send the Page a message.</li>
        </ol>
        <div className="wa-field">
          <span className="wa-label">Status</span>
          {c.receiving === false ? <span className="wa-err"><AlertTriangle size={14} aria-hidden /> The Page isn&apos;t sending events to this app. Press Update in step 2.</span>
            : c.receivingError ? <span className="wa-err"><AlertTriangle size={14} aria-hidden /> {c.receivingError}</span>
              : data.activity.lastFormAt || data.activity.lastMessageAt
                ? <span className="wa-ok"><CheckCircle2 size={16} aria-hidden /> Working · last {data.activity.lastFormAt && (!data.activity.lastMessageAt || data.activity.lastFormAt > data.activity.lastMessageAt) ? `form entry ${when(data.activity.lastFormAt)}` : `message ${when(data.activity.lastMessageAt!)}`}</span>
                : <span className="wa-wait"><Webhook size={16} aria-hidden /> Waiting for the first lead or message.</span>}
        </div>
        {c.pageConnected && (
          <div className="wa-actions">
            <button type="button" className="crm-btn is-secondary" disabled={syncing} onClick={() => void syncForms()}><DownloadCloud size={16} aria-hidden /> {syncing ? 'Fetching…' : 'Fetch form entries from the last 90 days'}</button>
            <span className="crm-sub">Adds anyone who filled a form before the CRM was connected. People already here aren&apos;t added twice.</span>
          </div>
        )}
      </section>

      {/* 4. Turning leads into patients */}
      <section className="crm-card wa-step">
        <StepHead n={4} done={!!data.instantWhatsApp.template && !!data.conversions.datasetName} title="Turn more form leads into patients" sub="Three things that run by themselves once set up." />

        <div className="so-auto">
          <span className="so-auto-icon" aria-hidden><MessageCircle size={18} /></span>
          <div>
            <strong>Instant WhatsApp thank-you</strong>
            <p className="crm-sub">Every new form lead gets a WhatsApp message within seconds, so they know the hospital will call and can reply straight away.</p>
            {data.instantWhatsApp.template
              ? <span className="wa-ok"><CheckCircle2 size={15} aria-hidden /> On · sends <code>{data.instantWhatsApp.template}</code></span>
              : <span className="wa-wait"><AlertTriangle size={15} aria-hidden /> Off. In <a href="/admin/whatsapp?tab=setup">WhatsApp → Setup</a>, pick an approved template for &ldquo;Facebook/Instagram form: instant thank-you&rdquo; (the NexEagle set has <code>nx_form_thanks</code>).</span>}
          </div>
        </div>

        <div className="so-auto">
          <span className="so-auto-icon" aria-hidden><BellRing size={18} /></span>
          <div>
            <strong>Reminders when nobody calls</strong>
            <p className="crm-sub">A new lead with no reply after the reply target reminds whoever has it (or the desk). After an hour, admins and marketing managers are told too. Only during office hours.</p>
            <span className="wa-ok"><CheckCircle2 size={15} aria-hidden /> On · reply target and office hours are in <a href="/admin/whatsapp?tab=automation">WhatsApp → Automation</a></span>
          </div>
        </div>

        <div className="so-auto">
          <span className="so-auto-icon" aria-hidden><Target size={18} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>Tell Meta who becomes a patient</strong>
            <p className="crm-sub">When a form lead is contacted, books, arrives or is admitted, the CRM tells Meta as plain steps (Contacted, Qualified, Converted) with only the form&apos;s lead ID and a scrambled phone number. No department, doctor or health details leave the CRM. Meta then shows the ads to people more like real patients. In Events Manager, create a CRM dataset and give the system user access, then paste its ID.</p>
            <div className="wa-copy" style={{ maxWidth: 520 }}>
              <input className="crm-input" value={dataset} onChange={(e) => setDataset(e.target.value.trim())} inputMode="numeric" placeholder="Dataset ID, e.g. 123456789012345" aria-label="Dataset ID" />
              <button type="button" className="crm-btn is-sm" disabled={savingDs || dataset === (data.conversions.datasetId ?? '')} onClick={() => void saveDataset()}>{savingDs ? 'Saving…' : 'Save'}</button>
            </div>
            <div style={{ marginTop: 8 }}>
              {!data.conversions.datasetId ? <span className="crm-sub">Off.</span>
                : data.conversions.datasetError ? <span className="wa-err"><AlertTriangle size={14} aria-hidden /> Can&apos;t open that dataset with the token: {data.conversions.datasetError}</span>
                  : data.conversions.lastError ? <span className="wa-err"><AlertTriangle size={14} aria-hidden /> Last send failed{data.conversions.lastErrorAt ? ` (${when(data.conversions.lastErrorAt)})` : ''}: {data.conversions.lastError}</span>
                    : <span className="wa-ok"><CheckCircle2 size={15} aria-hidden /> On{data.conversions.datasetName ? ` · ${data.conversions.datasetName}` : ''} · {data.conversions.sent30d} leads reported in the last 30 days</span>}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function StepHead({ n, done, title, sub }: { n: number; done: boolean; title: string; sub: string }) {
  return (
    <div className="wa-step-head">
      <span className={`wa-num${done ? ' is-done' : ''}`} aria-hidden>{done ? <CheckCircle2 size={18} /> : n}</span>
      <div><h2 className="crm-h2">{title}</h2><p className="crm-sub">{sub}</p></div>
    </div>
  );
}

function Secret({ label, info, value, onChange, placeholder, hint }: {
  label: string; info: SecretInfo; value: string | null; onChange: (v: string | null) => void; placeholder?: string; hint?: string;
}) {
  const [show, setShow] = useState(false);
  const editing = value !== null;
  return (
    <div className="wa-field">
      <span className="wa-label">{label}</span>
      {editing ? (
        <div className="wa-copy">
          <input className="crm-input" type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" spellCheck={false} />
          <button type="button" className="crm-btn is-secondary is-sm" onClick={() => setShow(!show)} aria-label={show ? 'Hide' : 'Show'}>{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
          <button type="button" className="crm-btn is-secondary is-sm" onClick={() => onChange(null)}>Cancel</button>
        </div>
      ) : (
        <div className="wa-secret">
          {info.unreadable ? <span className="wa-err"><AlertTriangle size={14} aria-hidden /> Saved, but can&apos;t be read since the server&apos;s key changed. Enter it again.</span>
            : info.set ? <span className="wa-ok"><KeyRound size={15} aria-hidden /> Saved {info.hint}</span>
              : <span className="crm-sub">Not set</span>}
          <button type="button" className="crm-btn is-secondary is-sm" onClick={() => onChange('')}>{info.set ? 'Replace' : 'Add'}</button>
        </div>
      )}
      {hint && <span className="wa-hint">{hint}</span>}
    </div>
  );
}
