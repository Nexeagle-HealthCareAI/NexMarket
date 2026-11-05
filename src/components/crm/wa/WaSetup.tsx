'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, CheckCircle2, ChevronDown, Copy, Eye, EyeOff, KeyRound, Link2, MessageCircle, RefreshCw, Send, ShieldCheck, Webhook, XCircle,
} from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { useAccess } from '@/lib/crm/access';
import { ErrorBox, friendlyError, Pill, Skeleton, useToast } from '@/components/crm/ui';

type Source = 'crm' | 'server' | 'none';
interface SecretInfo { set: boolean; hint?: string | null; source: Source; unreadable: boolean }
interface Settings {
  connected: boolean;
  fields: Record<string, string | null>;
  sources: Record<string, Source>;
  secrets: { accessToken: SecretInfo; appSecret: SecretInfo };
  templates: Record<string, string | null>;
  uses: { kind: string; label: string; params: string[] }[];
  webhookUrl: string;
  activity: { lastInboundAt?: string | null; inbound7d: number; outbound7d: number; failed7d: number };
  updatedAt?: string | null;
}
interface TestRes {
  ok: boolean; step?: string; message?: string;
  phone?: { number?: string; name?: string; quality?: string; verification?: string; nameStatus?: string; limit?: string };
  account?: { name?: string } | null; accountError?: string | null; subscribed?: boolean | null;
}
interface Template { name: string; language: string; status: string; category: string; body: string; params: number }

const FIELD_KEYS = ['phoneNumberId', 'businessAccountId', 'displayPhone', 'verifyToken', 'hospitalName', 'apiVersion', 'hindiCode', 'englishCode', 'autoReply', 'qrGreeting'] as const;
type FieldKey = typeof FIELD_KEYS[number];

const when = (iso?: string | null) => (iso ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(iso)) : null);

/** Connect the hospital's WhatsApp Business number from the CRM, step by step (the Setup tab, admins only). */
export function WaSetup({ onSaved }: { onSaved?: () => void }) {
  const { access } = useAccess();
  const [data, setData] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Record<FieldKey, string>>(() => Object.fromEntries(FIELD_KEYS.map((k) => [k, ''])) as Record<FieldKey, string>);
  const [secrets, setSecrets] = useState<{ accessToken: string | null; appSecret: string | null }>({ accessToken: null, appSecret: null });
  const [tpl, setTpl] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<TestRes | null>(null);
  const [testing, setTesting] = useState(false);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [tplError, setTplError] = useState<string | null>(null);
  const [toast, showToast] = useToast();

  const apply = (s: Settings) => {
    setData(s);
    setForm(Object.fromEntries(FIELD_KEYS.map((k) => [k, s.fields[k] ?? ''])) as Record<FieldKey, string>);
    setTpl(Object.fromEntries(s.uses.map((u) => [u.kind, s.templates[u.kind] ?? ''])));
    setSecrets({ accessToken: null, appSecret: null });
  };
  const load = useCallback(async () => {
    try { apply(await crm.get<Settings>('/api/v1/settings/whatsapp')); setError(null); }
    catch (e) { setError(friendlyError(e)); }
  }, []);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  const dirtyFields = useMemo(() => (data ? FIELD_KEYS.filter((k) => (data.fields[k] ?? '') !== form[k]) : []), [data, form]);
  const dirtyTpl = useMemo(() => (data ? data.uses.filter((u) => (data.templates[u.kind] ?? '') !== (tpl[u.kind] ?? '')).map((u) => u.kind) : []), [data, tpl]);
  const dirtySecrets = (['accessToken', 'appSecret'] as const).filter((k) => secrets[k] !== null);
  const dirty = dirtyFields.length + dirtyTpl.length + dirtySecrets.length > 0;

  const save = async () => {
    setSaving(true);
    try {
      await crm.put('/api/v1/settings/whatsapp', {
        fields: Object.fromEntries(dirtyFields.map((k) => [k, form[k]])),
        secrets: Object.fromEntries(dirtySecrets.map((k) => [k, secrets[k]])),
        templates: Object.fromEntries(dirtyTpl.map((k) => [k, tpl[k] ?? ''])),
      });
      await load();
      onSaved?.();
      showToast('WhatsApp settings saved.');
    } catch (e) { showToast(friendlyError(e)); }
    finally { setSaving(false); }
  };
  const check = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await crm.post<TestRes>('/api/v1/settings/whatsapp/test', {
        phoneNumberId: form.phoneNumberId || null, businessAccountId: form.businessAccountId || null, accessToken: secrets.accessToken || null,
      }));
    } catch (e) { setTest({ ok: false, message: friendlyError(e) }); }
    finally { setTesting(false); }
  };
  const loadTemplates = async () => {
    setTplError(null);
    try { setTemplates(await crm.get<Template[]>('/api/v1/settings/whatsapp/templates')); }
    catch (e) { setTplError(friendlyError(e)); }
  };
  const newToken = async () => {
    try {
      const r = await crm.post<{ verifyToken: string }>('/api/v1/settings/whatsapp/verify-token');
      await load();
      setForm((f) => ({ ...f, verifyToken: r.verifyToken }));
      showToast('New verify token saved. Paste it into Meta.');
    } catch (e) { showToast(friendlyError(e)); }
  };
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); showToast(`${what} copied.`); } catch { showToast('Copy blocked by the browser. Select and copy it instead.'); }
  };
  const set = (k: FieldKey) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (access && !access.isAdmin) {
    return <ErrorBox message="Only admins can change the WhatsApp connection." />;
  }
  if (error && !data) return <ErrorBox message={error} onRetry={load} />;
  if (!data) return <Skeleton h={600} />;

  const fromServer = (k: string) => data.sources[k] === 'server';
  const step1Done = data.connected;
  const step2Done = !!data.activity.lastInboundAt;
  const step3Done = !!data.templates.lead_followup;
  const approved = (templates ?? []).filter((t) => t.status === 'APPROVED');

  return (
    <div className="wa-page">
      <div className="wa-activity wa-activity-row">
        {data.connected ? <Pill tone="ok" dot>Connected</Pill> : <Pill tone="warn" dot>Not connected yet</Pill>}
        <span><strong>{data.activity.inbound7d}</strong> received</span>
        <span><strong>{data.activity.outbound7d}</strong> sent</span>
        {data.activity.failed7d > 0 && <span className="is-bad"><strong>{data.activity.failed7d}</strong> failed</span>}
        <span className="crm-sub">last 7 days · changes apply straight away, no server changes needed</span>
      </div>

      <details className="crm-card wa-guide">
        <summary><ShieldCheck size={18} aria-hidden /> <strong>Before you start (about 20 minutes, once)</strong><ChevronDown size={16} aria-hidden className="wa-chev" /></summary>
        <ol>
          <li>Open <a href="https://business.facebook.com" target="_blank" rel="noreferrer">Meta Business Suite</a> with the hospital&apos;s business account and verify the business (GST or registration certificate).</li>
          <li>At <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">developers.facebook.com</a>, create an app of type <em>Business</em> and add the <em>WhatsApp</em> product.</li>
          <li>In WhatsApp → <em>API setup</em>, add the hospital&apos;s phone number (one that isn&apos;t already on the WhatsApp app) and verify it by SMS. Copy the <em>Phone number ID</em> and <em>WhatsApp Business Account ID</em> into step 1.</li>
          <li>In Business settings → <em>System users</em>, add a system user (Admin), give it the app and the WhatsApp account, and generate a token with <code>whatsapp_business_messaging</code> and <code>whatsapp_business_management</code>, set to never expire. Paste it as the access token.</li>
          <li>In WhatsApp Manager → <em>Message templates</em>, create the templates listed in step 3 and wait for approval (usually minutes to a day).</li>
          <li>Add a payment method in WhatsApp Manager. Meta charges per template message; replies within 24 hours of a patient&apos;s message are free.</li>
        </ol>
      </details>

      {/* 1. Connect */}
      <section className="crm-card wa-step">
        <StepHead n={1} done={step1Done} title="Connect the number" sub="The IDs and token from Meta. The token is stored encrypted and never shown again." />
        <div className="wa-grid">
          <Field label="WhatsApp Business Account ID" hint="Digits, from WhatsApp → API setup" server={fromServer('businessAccountId')}>
            <input className="crm-input" value={form.businessAccountId} onChange={set('businessAccountId')} inputMode="numeric" placeholder="e.g. 102938475610293" />
          </Field>
          <Field label="Phone number ID" hint="Not the phone number itself: the long ID next to it" server={fromServer('phoneNumberId')}>
            <input className="crm-input" value={form.phoneNumberId} onChange={set('phoneNumberId')} inputMode="numeric" placeholder="e.g. 109876543210987" />
          </Field>
          <SecretField label="Permanent access token" info={data.secrets.accessToken} value={secrets.accessToken}
            onChange={(v) => setSecrets((s) => ({ ...s, accessToken: v }))} placeholder="EAAG…" />
          <Field label="Hospital's WhatsApp number" hint="Shown on QR posters; patients message this number" server={fromServer('displayPhone')}>
            <input className="crm-input" value={form.displayPhone} onChange={set('displayPhone')} inputMode="tel" placeholder="10-digit mobile" />
          </Field>
        </div>
        <div className="wa-actions">
          <button type="button" className="crm-btn is-secondary" disabled={testing} onClick={() => void check()}>
            <RefreshCw size={16} aria-hidden className={testing ? 'wa-spin' : undefined} /> {testing ? 'Checking…' : 'Check connection'}
          </button>
          <span className="crm-sub">Checks the values typed above with Meta, before or after saving.</span>
        </div>
        {test && <TestResult r={test} />}
      </section>

      {/* 2. Webhook */}
      <section className="crm-card wa-step">
        <StepHead n={2} done={step2Done} title="Receive messages" sub="So patients' messages and delivery ticks reach the Leads inbox. In the Meta app: WhatsApp → Configuration → Webhook → Edit." />
        <div className="wa-grid">
          <Field label="Callback URL" hint="Paste into Meta">
            <div className="wa-copy">
              <input className="crm-input" value={data.webhookUrl} readOnly onFocus={(e) => e.target.select()} />
              <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void copy(data.webhookUrl, 'Callback URL')}><Copy size={15} aria-hidden /> Copy</button>
            </div>
          </Field>
          <Field label="Verify token" hint="Paste into Meta, then press Verify and save there" server={fromServer('verifyToken')}>
            <div className="wa-copy">
              <input className="crm-input" value={form.verifyToken} onChange={set('verifyToken')} placeholder="Make one →" />
              {form.verifyToken && <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void copy(form.verifyToken, 'Verify token')}><Copy size={15} aria-hidden /> Copy</button>}
              <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void newToken()}><KeyRound size={15} aria-hidden /> New</button>
            </div>
          </Field>
          <SecretField label="App secret" info={data.secrets.appSecret} value={secrets.appSecret}
            onChange={(v) => setSecrets((s) => ({ ...s, appSecret: v }))} placeholder="From App settings → Basic"
            hint="Proves each message really comes from Meta. Messages are refused until it's set." />
          <div className="wa-field">
            <span className="wa-label">Status</span>
            {data.activity.lastInboundAt
              ? <span className="wa-ok"><CheckCircle2 size={16} aria-hidden /> Working · last message {when(data.activity.lastInboundAt)}</span>
              : <span className="wa-wait"><Webhook size={16} aria-hidden /> Waiting for the first message. After saving in Meta, tick <em>messages</em> under Webhook fields, then send any message to the hospital number.</span>}
          </div>
        </div>
      </section>

      {/* 3. Templates */}
      <section className="crm-card wa-step">
        <StepHead n={3} done={step3Done} title="Message templates" sub="WhatsApp only allows approved templates when the hospital writes first (broadcasts, or a follow-up after 24 hours). Pick the template for each use. Values are filled in the order shown." />
        <div className="wa-actions">
          <button type="button" className="crm-btn is-secondary" onClick={() => void loadTemplates()}><RefreshCw size={16} aria-hidden /> {templates ? 'Reload from Meta' : 'Load templates from Meta'}</button>
          {templates && <span className="crm-sub">{approved.length} approved of {templates.length}</span>}
          {tplError && <span className="wa-err">{tplError}</span>}
        </div>
        <div className="wa-uses">
          {data.uses.map((u) => {
            const chosen = tpl[u.kind] ?? '';
            const t = templates?.find((x) => x.name === chosen);
            const mismatch = t && t.params !== u.params.length;
            return (
              <div key={u.kind} className="wa-use">
                <div className="wa-use-head">
                  <strong>{u.label}</strong>
                  <span className="wa-params">{u.params.map((p, i) => <span key={p}>{`{{${i + 1}}}`} {p}</span>)}</span>
                </div>
                {templates ? (
                  <select className="crm-select" value={chosen} onChange={(e) => setTpl((x) => ({ ...x, [u.kind]: e.target.value }))}>
                    <option value="">{u.kind === 'lead_followup' ? 'None (follow-up turned off)' : u.kind === 'form_welcome' ? 'None (no instant WhatsApp to form leads)' : `None (uses a template named ${u.kind})`}</option>
                    {[...new Map(templates.map((x) => [x.name, x])).values()].map((x) => (
                      <option key={x.name} value={x.name} disabled={x.status !== 'APPROVED' && x.name !== chosen}>
                        {x.name} · {x.language} · {x.params} values{x.status !== 'APPROVED' ? ` · ${x.status.toLowerCase()}` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input className="crm-input" value={chosen} onChange={(e) => setTpl((x) => ({ ...x, [u.kind]: e.target.value.toLowerCase() }))} placeholder="template_name (or load from Meta)" />
                )}
                {t && <span className="wa-tpl-body">{t.body}</span>}
                {mismatch && <span className="wa-err"><AlertTriangle size={14} aria-hidden /> This template takes {t!.params} values but this use sends {u.params.length}. WhatsApp will refuse it.</span>}
                {fromServer('template.' + u.kind) && !dirtyTpl.includes(u.kind) && <span className="wa-server">Set in the server settings</span>}
              </div>
            );
          })}
        </div>
        <div className="wa-grid wa-grid-3">
          <Field label="Hindi template language code" hint="As approved in Meta, usually hi" server={fromServer('hindiCode')}>
            <input className="crm-input" value={form.hindiCode} onChange={set('hindiCode')} placeholder="hi" />
          </Field>
          <Field label="English template language code" hint="en, en_US or en_GB" server={fromServer('englishCode')}>
            <input className="crm-input" value={form.englishCode} onChange={set('englishCode')} placeholder="en" />
          </Field>
          <Field label="Graph API version" hint="Leave as it is unless Meta asks" server={fromServer('apiVersion')}>
            <input className="crm-input" value={form.apiVersion} onChange={set('apiVersion')} placeholder="v21.0" />
          </Field>
        </div>
      </section>

      {/* 4. Messages */}
      <section className="crm-card wa-step">
        <StepHead n={4} done={!!form.hospitalName} title="Automatic messages and QR codes" sub="What patients see. Hindi and English together work well across Seemanchal." />
        <div className="wa-grid">
          <Field label="Hospital name" hint="Used in templates and on QR posters" server={fromServer('hospitalName')}>
            <input className="crm-input" value={form.hospitalName} onChange={set('hospitalName')} />
          </Field>
          <div />
          <Field label="Instant reply to a new enquiry (optional)" hint="Sent free, the moment someone first writes. Leave empty to turn off." server={fromServer('autoReply')}>
            <textarea className="crm-textarea" rows={3} value={form.autoReply} onChange={set('autoReply')} maxLength={1000}
              placeholder="धन्यवाद! हमारी टीम आपको जल्द ही कॉल करेगी। Thank you, our desk will call you shortly." />
          </Field>
          <Field label="Message typed in when someone scans a QR code" hint="The partner's code or camp name is added on its own line" server={fromServer('qrGreeting')}>
            <textarea className="crm-textarea" rows={3} value={form.qrGreeting} onChange={set('qrGreeting')} maxLength={300} />
          </Field>
        </div>
        <div className="wa-preview" aria-label="Preview">
          <span className="wa-preview-label"><MessageCircle size={14} aria-hidden /> Preview</span>
          <span className="wa-bubble is-in">{form.qrGreeting || '…'}{'\n'}Ref: G7K2QX</span>
          {form.autoReply && <span className="wa-bubble is-out">{form.autoReply}</span>}
        </div>
      </section>

      {/* 5. Test */}
      <TestSend connected={data.connected} templates={approved} onToast={showToast} />

      <div className={`wa-savebar${dirty ? ' is-dirty' : ''}`}>
        <span>{dirty ? 'You have unsaved changes.' : data.updatedAt ? `Saved · ${when(data.updatedAt)}` : 'Nothing saved here yet.'}</span>
        {dirty && <button type="button" className="crm-btn is-secondary" onClick={() => apply(data)} disabled={saving}>Discard</button>}
        <button type="button" className="crm-btn" onClick={() => void save()} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save changes'}</button>
      </div>
      {toast}
    </div>
  );
}

function StepHead({ n, done, title, sub }: { n: number; done: boolean; title: string; sub: string }) {
  return (
    <div className="wa-step-head">
      <span className={`wa-num${done ? ' is-done' : ''}`} aria-hidden>{done ? <CheckCircle2 size={18} /> : n}</span>
      <div>
        <h2 className="crm-h2">{title}</h2>
        <p className="crm-sub">{sub}</p>
      </div>
    </div>
  );
}

function Field({ label, hint, server, children }: { label: string; hint?: string; server?: boolean; children: React.ReactNode }) {
  return (
    <label className="wa-field">
      <span className="wa-label">{label}{server && <span className="wa-server" title="Comes from the server configuration. Saving a value here overrides it.">server setting</span>}</span>
      {children}
      {hint && <span className="wa-hint">{hint}</span>}
    </label>
  );
}

function SecretField({ label, info, value, onChange, placeholder, hint }: {
  label: string; info: SecretInfo; value: string | null; onChange: (v: string | null) => void; placeholder?: string; hint?: string;
}) {
  const [show, setShow] = useState(false);
  const editing = value !== null;
  return (
    <div className="wa-field">
      <span className="wa-label">{label}{info.source === 'server' && !editing && <span className="wa-server">server setting</span>}</span>
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
      {editing && value === '' && info.set && <span className="wa-hint">Saving with this empty removes the saved one.</span>}
      {hint && <span className="wa-hint">{hint}</span>}
    </div>
  );
}

function TestResult({ r }: { r: TestRes }) {
  if (!r.ok) {
    return (
      <div className="wa-result is-bad">
        <XCircle size={18} aria-hidden />
        <span><strong>Meta said no.</strong> {r.message} {r.step === 'phone' ? 'Check the phone number ID and that the token belongs to the same WhatsApp account.' : ''}</span>
      </div>
    );
  }
  const p = r.phone ?? {};
  return (
    <div className="wa-result is-ok">
      <CheckCircle2 size={18} aria-hidden />
      <div className="wa-result-body">
        <strong>{p.name ?? 'Connected'} · {p.number}</strong>
        <span className="wa-chips">
          {p.quality && <Pill tone={p.quality === 'GREEN' ? 'ok' : p.quality === 'YELLOW' ? 'warn' : 'bad'}>Quality {p.quality.toLowerCase()}</Pill>}
          {p.verification && <Pill tone={p.verification === 'VERIFIED' ? 'ok' : 'warn'}>{p.verification === 'VERIFIED' ? 'Number verified' : `Number ${p.verification.toLowerCase().replace(/_/g, ' ')}`}</Pill>}
          {p.nameStatus && <Pill tone={p.nameStatus === 'APPROVED' ? 'ok' : 'warn'}>Display name {p.nameStatus.toLowerCase().replace(/_/g, ' ')}</Pill>}
          {p.limit && <Pill tone="info">Limit {p.limit.replace('TIER_', '').toLowerCase()} / day</Pill>}
        </span>
        {r.account?.name && <span className="crm-sub">Business account: {r.account.name}</span>}
        {r.accountError && <span className="wa-err">Business account: {r.accountError}</span>}
        {r.subscribed === false && (
          <span className="wa-err"><AlertTriangle size={14} aria-hidden /> This app isn&apos;t subscribed to the business account, so messages won&apos;t arrive. In the Meta app, open WhatsApp → Configuration and subscribe, or ask Meta support.</span>
        )}
        {r.subscribed === true && <span className="wa-ok"><Link2 size={14} aria-hidden /> Receiving messages for this account</span>}
      </div>
    </div>
  );
}

function TestSend({ connected, templates, onToast }: { connected: boolean; templates: Template[]; onToast: (m: string) => void }) {
  const [to, setTo] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const t = templates.find((x) => x.name === name);
  const send = async () => {
    setBusy(true);
    try {
      await crm.post('/api/v1/settings/whatsapp/send-test', { to, template: name || null, language: t?.language ?? null, params: t?.params ?? 0 });
      onToast('Test sent. Check the phone.');
    } catch (e) { onToast(friendlyError(e)); }
    finally { setBusy(false); }
  };
  return (
    <section className="crm-card wa-step">
      <StepHead n={5} done={false} title="Send a test" sub="Sends one message to your own phone. Save your settings first." />
      <div className="wa-test">
        <label className="wa-field">
          <span className="wa-label">Your mobile number</span>
          <input className="crm-input" value={to} onChange={(e) => setTo(e.target.value)} inputMode="tel" placeholder="10 digits" />
        </label>
        <label className="wa-field">
          <span className="wa-label">Template</span>
          <select className="crm-select" value={name} onChange={(e) => setName(e.target.value)}>
            <option value="">hello_world (Meta&apos;s sample)</option>
            {templates.map((x) => <option key={`${x.name}-${x.language}`} value={x.name}>{x.name} · {x.language}</option>)}
          </select>
        </label>
        <button type="button" className="crm-btn" disabled={!connected || busy || to.replace(/\D/g, '').length < 10} onClick={() => void send()}>
          <Send size={16} aria-hidden /> {busy ? 'Sending…' : 'Send test'}
        </button>
      </div>
      {!connected && <span className="crm-sub">Connect the number in step 1 first.</span>}
      <span className="crm-sub">Then see it arrive in the <Link href="/admin/leads">Leads inbox</Link> by replying from that phone.</span>
    </section>
  );
}
