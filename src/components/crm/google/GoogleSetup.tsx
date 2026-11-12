'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, Copy, ExternalLink, KeyRound, LogIn, RefreshCw, Unplug, XCircle } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { ErrorBox, friendlyError, Skeleton } from '@/components/crm/ui';
import { when, type SourceRun } from './shared';
import { place } from '@/lib/crm/access';

interface Picked { id: string; name?: string | null; account?: string | null; login?: string | null; currency?: string | null }
interface Data {
  clientId?: string | null; clientSecret?: string | null; hasClient: boolean; connected: boolean; email?: string | null; connectedAt?: string | null;
  redirectUri: string; missingScopes: string[]; scopes: { scope: string; for: string }[];
  adsDeveloperToken?: string | null; adsVersion: string;
  picked: { gbp?: Picked | null; gsc?: Picked | null; ga4?: Picked | null; youtube?: Picked | null; ads?: Picked | null };
  syncedAt?: string | null; lastSync?: SourceRun[] | null;
}
interface Opt { id: string; name?: string | null; detail?: string | null; account?: string | null; currency?: string | null; manager?: boolean }
interface Part { items: Opt[]; error?: string | null }
interface Options { gbp: Part; gsc: Part; ga4: Part; youtube: Part; ads: Part }

const APIS = [
  'My Business Account Management API', 'My Business Business Information API', 'Business Profile Performance API', 'Google My Business API (for reviews)',
  'Google Search Console API', 'Google Analytics Data API', 'Google Analytics Admin API', 'YouTube Data API v3', 'YouTube Analytics API', 'Google Ads API (only if you run Google ads)',
];

const KINDS: { key: keyof Options; label: string; what: string }[] = [
  { key: 'gbp', label: 'Google Business Profile', what: 'Calls, direction requests, website clicks, search terms and reviews from Google Search and Maps' },
  { key: 'gsc', label: 'Website in Search Console', what: 'What people search before they click through to the website' },
  { key: 'ga4', label: 'Google Analytics 4 property', what: 'Website visits, where they came from, and campaign links' },
  { key: 'youtube', label: 'YouTube channel', what: 'Views, watch time and subscribers' },
  { key: 'ads', label: 'Google Ads account', what: 'Spend, clicks, calls and conversions per campaign' },
];

/** Google → Setup: the hospital's own Google Cloud OAuth client, one sign-in with the hospital's Google account, and which accounts to follow. */
export function GoogleSetup({ onSaved, toast }: { onSaved: () => void; toast: (m: string) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [devToken, setDevToken] = useState('');
  const [adsVersion, setAdsVersion] = useState('');
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [opts, setOpts] = useState<Options | null>(null);
  const [optsBusy, setOptsBusy] = useState(false);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [syncing, setSyncing] = useState(false);
  const [guide, setGuide] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await crm.get<Data>('/api/v1/settings/google');
      setData(r); setClientId(r.clientId ?? ''); setAdsVersion(r.adsVersion); setError(null);
      setPick({ gbp: r.picked.gbp?.id ?? '', gsc: r.picked.gsc?.id ?? '', ga4: r.picked.ga4?.id ?? '', youtube: r.picked.youtube?.id ?? '', ads: r.picked.ads?.id ?? '' });
      if (!r.hasClient) setGuide(true);
    } catch (e) { setError(friendlyError(e)); }
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  const loadOptions = useCallback(async () => {
    setOptsBusy(true);
    try { setOpts(await crm.get<Options>('/api/v1/settings/google/options')); } catch (e) { toast(friendlyError(e)); } finally { setOptsBusy(false); }
  }, [toast]);
  useEffect(() => { if (!data?.connected || opts) return; const t = setTimeout(() => void loadOptions(), 0); return () => clearTimeout(t); }, [data?.connected, opts, loadOptions]);

  if (error && !data) return <ErrorBox message={error} onRetry={load} />;
  if (!data) return <Skeleton h={520} />;

  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast('Copied.'); } catch { toast('Copy blocked by the browser. Select and copy it instead.'); } };

  const saveClient = async () => {
    setSaving(true);
    try {
      const body: Record<string, string> = { clientId: clientId.trim() };
      if (secret) body.clientSecret = secret.trim();
      if (devToken) body.adsDeveloperToken = devToken.trim();
      if (adsVersion !== data.adsVersion) body.adsVersion = adsVersion.trim();
      const r = await crm.put<Data>('/api/v1/settings/google', body);
      setData(r); setSecret(''); setDevToken(''); toast('Saved.'); onSaved();
      if (devToken && r.connected) { setOpts(null); }
    } catch (e) { toast(friendlyError(e)); } finally { setSaving(false); }
  };

  const connect = async () => {
    setConnecting(true);
    try {
      const r = await crm.post<{ url: string }>('/api/v1/settings/google/connect', { returnTo: window.location.origin });
      window.location.assign(r.url);
    } catch (e) { toast(friendlyError(e)); setConnecting(false); }
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect the Google account? Numbers already fetched stay in NexMarket; no new ones will come until you connect again.')) return;
    try { setData(await crm.post<Data>('/api/v1/settings/google/disconnect')); setOpts(null); onSaved(); toast('Disconnected.'); } catch (e) { toast(friendlyError(e)); }
  };

  const savePick = async () => {
    if (!opts) return;
    const find = (k: keyof Options) => opts[k].items.find((x) => x.id === pick[k]);
    const gbp = find('gbp'), ga4 = find('ga4'), yt = find('youtube'), ads = find('ads');
    setSaving(true);
    try {
      const r = await crm.put<Data>('/api/v1/settings/google/pick', {
        gbpLocation: pick.gbp ?? '', gbpAccount: gbp?.account ?? '', gbpName: gbp?.name ?? '',
        gscSite: pick.gsc ?? '',
        ga4Property: pick.ga4 ?? '', ga4Name: ga4?.name ?? '',
        ytChannel: pick.youtube ?? '', ytName: yt?.name ?? '',
        adsCustomer: pick.ads ?? '', adsLoginCustomer: ads?.manager ? pick.ads : '', adsName: ads?.name ?? '', adsCurrency: ads?.currency ?? '',
      });
      setData(r); toast('Saved. Press “Fetch now” to bring in the numbers.'); onSaved();
    } catch (e) { toast(friendlyError(e)); } finally { setSaving(false); }
  };

  const sync = async () => {
    setSyncing(true);
    try { await crm.post('/api/v1/google/sync'); await load(); onSaved(); toast('Fetched from Google. See below for each account.'); }
    catch (e) { toast(friendlyError(e)); } finally { setSyncing(false); }
  };

  const anyPicked = Object.values(data.picked).some(Boolean);

  return (
    <div className="gg-setup">
      <section className="crm-card so-card">
        <p style={{ margin: 0 }}><strong>NexMarket reads the {place()}&apos;s Google accounts directly.</strong> No Windsor.ai or other paid connector: Google&apos;s own APIs are free for this use. Set it up once, with the {place()}&apos;s Google account (not a staff member&apos;s personal one), and the numbers come in every morning.</p>
      </section>

      {/* Step 1 */}
      <section className="crm-card so-card">
        <h2 className="crm-h2 gg-step"><span className={`gg-n${data.hasClient ? ' is-done' : ''}`}>{data.hasClient ? <CheckCircle2 size={16} aria-hidden /> : 1}</span> The {place()}&apos;s Google Cloud key</h2>
        <button type="button" className="wa-link gg-guide-btn" aria-expanded={guide} onClick={() => setGuide((g) => !g)}>How to make it (about 15 minutes, once) <ChevronDown size={14} aria-hidden style={{ transform: guide ? 'rotate(180deg)' : undefined }} /></button>
        {guide && (
          <ol className="gg-guide">
            <li>Signed in as the {place()}&apos;s Google account, open <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">Google Cloud <ExternalLink size={12} aria-hidden /></a> and create a project called <em>NexMarket</em>.</li>
            <li>In <strong>APIs &amp; Services → Library</strong>, turn on each of these: <span className="gg-apis">{APIS.map((a) => <code key={a}>{a}</code>)}</span></li>
            <li>In <strong>Google Auth Platform → Branding / Audience</strong>: app name <em>NexMarket</em>, the {place()}&apos;s email. Audience: <strong>Internal</strong> if the {place()} uses Google Workspace; otherwise <strong>External</strong> and press <strong>Publish app</strong> (&ldquo;In production&rdquo;). In testing mode Google cuts the connection every 7 days. Google will show an &ldquo;unverified app&rdquo; notice when you sign in; that is expected for the {place()}&apos;s own private tool.</li>
            <li>In <strong>Clients → Create client</strong>: type <strong>Web application</strong>. Under <em>Authorised redirect URIs</em> add exactly:
              <span className="gg-copy"><code>{data.redirectUri}</code><button type="button" className="crm-btn is-secondary is-sm" onClick={() => void copy(data.redirectUri)}><Copy size={13} aria-hidden /> Copy</button></span>
              Create, then copy the <strong>Client ID</strong> and <strong>Client secret</strong> into the boxes below.</li>
            <li><strong>Business Profile only:</strong> Google gives these APIs zero quota until it approves the project. Fill in Google&apos;s <a href="https://developers.google.com/my-business/content/prereqs" target="_blank" rel="noreferrer">Business Profile API access request <ExternalLink size={12} aria-hidden /></a> with the project number; approval usually takes a few days. Everything else works straight away.</li>
            <li><strong>Google Ads only:</strong> in Google Ads → Tools → <strong>API Center</strong>, apply for a developer token (Basic access is enough) and paste it below.</li>
          </ol>
        )}
        <div className="gg-form">
          <label className="crm-field">Client ID
            <input className="crm-input" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234567890-abc….apps.googleusercontent.com" autoComplete="off" spellCheck={false} />
          </label>
          <label className="crm-field">Client secret {data.clientSecret && <span className="crm-sub">saved {data.clientSecret}</span>}
            <input className="crm-input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={data.clientSecret ? 'Leave empty to keep the saved one' : 'GOCSPX-…'} autoComplete="new-password" spellCheck={false} />
          </label>
          <label className="crm-field">Google Ads developer token <span className="crm-sub">(optional){data.adsDeveloperToken ? ` · saved ${data.adsDeveloperToken}` : ''}</span>
            <input className="crm-input" type="password" value={devToken} onChange={(e) => setDevToken(e.target.value)} placeholder={data.adsDeveloperToken ? 'Leave empty to keep the saved one' : `Only if the ${place()} runs Google ads`} autoComplete="new-password" spellCheck={false} />
          </label>
          <label className="crm-field">Google Ads API version
            <input className="crm-input" value={adsVersion} onChange={(e) => setAdsVersion(e.target.value)} style={{ maxWidth: 120 }} />
            <span className="crm-sub">Google retires old versions about once a year; if Ads stops working, raise this (v25 → v26…).</span>
          </label>
        </div>
        <button type="button" className="crm-btn is-sm" style={{ alignSelf: 'flex-start' }} disabled={saving || !clientId.trim() || (!data.clientSecret && !secret.trim())} onClick={() => void saveClient()}><KeyRound size={14} aria-hidden /> Save</button>
      </section>

      {/* Step 2 */}
      <section className="crm-card so-card">
        <h2 className="crm-h2 gg-step"><span className={`gg-n${data.connected ? ' is-done' : ''}`}>{data.connected ? <CheckCircle2 size={16} aria-hidden /> : 2}</span> Sign in with the {place()}&apos;s Google account</h2>
        {data.connected ? (
          <>
            <p style={{ margin: 0 }}>Connected as <strong>{data.email ?? `the ${place()}’s Google account`}</strong>{data.connectedAt ? ` since ${when(data.connectedAt)}` : ''}.</p>
            {data.missingScopes.length > 0 && (
              <div className="ld-banner"><span><strong>Some permissions were left unticked on Google&apos;s screen:</strong> {data.missingScopes.join('; ')}. Connect again and tick every box.</span></div>
            )}
            <div className="sp-actions">
              <button type="button" className="crm-btn is-secondary is-sm" disabled={connecting} onClick={() => void connect()}><LogIn size={14} aria-hidden /> Connect again</button>
              <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void disconnect()}><Unplug size={14} aria-hidden /> Disconnect</button>
            </div>
          </>
        ) : (
          <>
            <p className="crm-sub" style={{ margin: 0 }}>Google will ask the {place()}&apos;s account to allow NexMarket to read:</p>
            <ul className="gg-scopes">{data.scopes.map((s) => <li key={s.scope}>{s.for}</li>)}</ul>
            <button type="button" className="crm-btn is-sm" style={{ alignSelf: 'flex-start' }} disabled={!data.hasClient || connecting} onClick={() => void connect()}><LogIn size={14} aria-hidden /> {connecting ? 'Opening Google…' : 'Sign in with Google'}</button>
            {!data.hasClient && <span className="crm-sub">Save the client ID and secret first.</span>}
          </>
        )}
      </section>

      {/* Step 3 */}
      <section className="crm-card so-card">
        <h2 className="crm-h2 gg-step"><span className={`gg-n${anyPicked ? ' is-done' : ''}`}>{anyPicked ? <CheckCircle2 size={16} aria-hidden /> : 3}</span> Which accounts to follow</h2>
        {!data.connected ? <p className="crm-sub" style={{ margin: 0 }}>Sign in first.</p> : !opts ? <Skeleton h={220} /> : (
          <>
            <div className="gg-picks">
              {KINDS.map((k) => {
                const part = opts[k.key];
                const saved = data.picked[k.key];
                return (
                  <label key={k.key} className="crm-field gg-pick">
                    <span><strong>{k.label}</strong> <span className="crm-sub">{k.what}</span></span>
                    <select className="crm-input" value={pick[k.key] ?? ''} onChange={(e) => setPick((p) => ({ ...p, [k.key]: e.target.value }))} disabled={part.items.length === 0 && !saved}>
                      <option value="">{part.items.length === 0 ? 'None found' : 'Don’t follow'}</option>
                      {saved && !part.items.some((x) => x.id === saved.id) && <option value={saved.id}>{saved.name ?? saved.id} (saved)</option>}
                      {part.items.map((x) => <option key={x.id} value={x.id}>{x.name ?? x.id}{x.detail ? ` · ${x.detail}` : ''}</option>)}
                    </select>
                    {part.error && <span className="gg-err"><XCircle size={13} aria-hidden /> {part.error}</span>}
                  </label>
                );
              })}
            </div>
            <div className="sp-actions">
              <button type="button" className="crm-btn is-sm" disabled={saving} onClick={() => void savePick()}>Save choices</button>
              <button type="button" className="crm-btn is-secondary is-sm" disabled={optsBusy} onClick={() => void loadOptions()}><RefreshCw size={14} aria-hidden className={optsBusy ? 'sp-spin' : undefined} /> Look again</button>
            </div>
          </>
        )}
      </section>

      {/* Step 4 */}
      <section className="crm-card so-card">
        <h2 className="crm-h2 gg-step"><span className={`gg-n${data.syncedAt ? ' is-done' : ''}`}>{data.syncedAt ? <CheckCircle2 size={16} aria-hidden /> : 4}</span> Fetch the numbers</h2>
        <p className="crm-sub" style={{ margin: 0 }}>NexMarket fetches every morning after 6 am by itself. The first fetch brings up to 16 months of history and can take a minute.</p>
        {data.lastSync && data.lastSync.length > 0 && (
          <ul className="gg-runs">
            {data.lastSync.map((s) => (
              <li key={s.source} className={s.ok ? 'is-ok' : 'is-bad'}>
                {s.ok ? <CheckCircle2 size={15} aria-hidden /> : <XCircle size={15} aria-hidden />}
                <span><strong>{s.label}</strong> {s.ok ? <span className="crm-sub">{s.rows.toLocaleString('en-IN')} numbers</span> : <span>{s.error}</span>}</span>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="crm-btn is-sm" style={{ alignSelf: 'flex-start' }} disabled={syncing || !data.connected || !anyPicked} onClick={() => void sync()}>
          <RefreshCw size={14} aria-hidden className={syncing ? 'sp-spin' : undefined} /> {syncing ? 'Fetching… (up to a minute)' : 'Fetch now'}
        </button>
        {data.syncedAt && <span className="crm-sub">Last fetched {when(data.syncedAt)}.</span>}
      </section>
    </div>
  );
}
