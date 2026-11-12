'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import NexMarketLogo from '@/components/NexMarketLogo';
import { checkOrgKey, getSignupOptions, sendSignupCode, signUp, SignupError, type SignupOptions } from '@/lib/sync/api-client';

const FALLBACK_KINDS = [
  { key: 'hospital', label: 'Hospital' }, { key: 'clinic', label: 'Clinic' }, { key: 'diagnostic', label: 'Diagnostic centre' },
  { key: 'lab', label: 'Pathology lab' }, { key: 'pharmacy', label: 'Pharmacy' }, { key: 'dialysis', label: 'Dialysis centre' },
  { key: 'other', label: 'Other healthcare' },
];

/** The same rule the server uses: "City Lab & Scans" → "city-lab-scans". */
function suggestKey(name: string): string {
  let s = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+/, '').replace(/-+$/, '');
  if (s.length > 30) s = s.slice(0, 30).replace(/-+$/, '');
  return s;
}

export default function SignupPage() {
  const [options, setOptions] = useState<SignupOptions | null>(null);
  const [orgName, setOrgName] = useState('');
  const [orgKey, setOrgKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [keyState, setKeyState] = useState<{ ok: boolean; text: string } | null>(null);
  const [kinds, setKinds] = useState<string[]>([]);
  const [city, setCity] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  // The code step: where the code went, and what the person typed.
  const [sentTo, setSentTo] = useState<{ email: boolean; whatsapp: boolean; minutes: number } | null>(null);
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [resent, setResent] = useState(false);
  const [done, setDone] = useState<{ key: string; name: string; userId: string } | null>(null);

  useEffect(() => {
    let live = true;
    getSignupOptions().then((o) => { if (live) setOptions(o); }).catch(() => { if (live) setOptions({ open: true, kinds: FALLBACK_KINDS }); });
    return () => { live = false; };
  }, []);

  const key = keyEdited ? orgKey.trim().toLowerCase() : suggestKey(orgName);

  // Is the sign-in name free? Asked a moment after typing stops.
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      if (key.length < 3) { setKeyState(null); return; }
      checkOrgKey(key, orgName)
        .then((r) => { if (live) setKeyState({ ok: r.available, text: r.available ? 'This name is free.' : r.message ?? 'This name is not available.' }); })
        .catch(() => { if (live) setKeyState(null); });
    }, 500);
    return () => { live = false; clearTimeout(t); };
  }, [key, orgName]);

  // A field's error goes away as soon as the person starts fixing it.
  const fixed = (...keys: string[]) => { setError(''); setFields((f) => (keys.some((k) => f[k]) ? Object.fromEntries(Object.entries(f).filter(([k]) => !keys.includes(k))) : f)); };
  const toggleKind = (k: string) => { fixed('kinds'); setKinds((list) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k])); };

  function checkForm(): Record<string, string> {
    const bad: Record<string, string> = {};
    if (orgName.trim().length < 2) bad.orgName = 'Enter the organisation’s name.';
    if (!/^[a-z][a-z0-9-]{2,29}$/.test(key) || key.endsWith('-') || key.includes('--')) bad.orgKey = 'Use 3 to 30 small letters, numbers or hyphens, starting with a letter.';
    if (kinds.length === 0) bad.kinds = 'Choose what your organisation is.';
    if (name.trim().length < 2) bad.name = 'Enter your name.';
    if (phone.replace(/\D/g, '').slice(-10).length !== 10) bad.phone = 'Enter a 10-digit mobile number.';
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) bad.email = 'This email address doesn’t look right.';
    else if (!email.trim() && emailNeeded) bad.email = 'Enter your email: the code is sent there.';
    if (password.length < 8) bad.password = 'Use a password of at least 8 characters.';
    else if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) bad.password = 'Use at least one letter and one number in the password.';
    if (!agree) bad.agree = 'Please confirm this before you continue.';
    return bad;
  }

  const details = () => ({ orgName: orgName.trim(), orgKey: key, kinds, city: city.trim() || undefined, name: name.trim(), phone, email: email.trim() || undefined, password });

  // Field errors other than the code belong to the first step: go back there so the person can see them.
  function failed(err: unknown) {
    if (err instanceof SignupError) {
      setError(err.message); setFields(err.fields);
      if (Object.keys(err.fields).some((k) => k !== 'code')) setSentTo(null);
    } else setError('Something went wrong. Please try again.');
  }

  /** Asks the server to send the code. False when no code is needed or it could not be sent. */
  async function sendCode(): Promise<boolean> {
    setSending(true);
    try {
      const r = await sendSignupCode({ phone, email: email.trim() || undefined, orgName: orgName.trim() });
      if (!r.needed) return false;
      setSentTo({ email: !!r.email, whatsapp: !!r.whatsapp, minutes: r.minutes ?? 10 });
      return true;
    } finally { setSending(false); }
  }

  async function create(withCode?: string) {
    setBusy(true);
    try { setDone(await signUp({ ...details(), code: withCode })); }
    catch (err) { failed(err); }
    finally { setBusy(false); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || sending) return;
    const bad = checkForm();
    setFields(bad);
    setError('');
    if (Object.keys(bad).length > 0) {
      setError('Please check the marked fields.');
      document.getElementById(`su-${Object.keys(bad)[0]}`)?.focus();
      return;
    }
    if (keyState && !keyState.ok) { setFields({ orgKey: keyState.text }); setError('Please check the marked fields.'); document.getElementById('su-orgKey')?.focus(); return; }
    if (options?.verify) {
      setCode(''); setResent(false);
      try { if (await sendCode()) return; } catch (err) { failed(err); return; }
    }
    await create();
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const digits = code.replace(/\D/g, '');
    if (digits.length !== 6) { setFields({ code: 'Enter the 6-digit code.' }); return; }
    setFields({}); setError('');
    await create(digits);
  }

  async function sendAgain() {
    if (sending) return;
    setError(''); setFields({}); setResent(false);
    try { if (await sendCode()) setResent(true); } catch (err) { failed(err); }
  }

  const emailNeeded = !!options?.verify && !options.verifyWhatsApp;
  const phoneEnd = phone.replace(/\D/g, '').slice(-4);
  const where = sentTo ? [sentTo.whatsapp ? `WhatsApp on the number ending ${phoneEnd}` : null, sentTo.email ? email.trim() : null].filter(Boolean).join(' and ') : '';

  const err = (k: string) => (fields[k] ? <span className="lg-hint is-bad" role="alert">{fields[k]}</span> : null);
  const kindList = options?.kinds?.length ? options.kinds : FALLBACK_KINDS;

  return (
    <div className="lg-shell">
      <aside className="lg-side" aria-hidden="true">
        <div className="lg-side-top">
          <span className="lg-mark"><NexMarketLogo size={34} /></span>
          <span className="lg-brand">NexEagle</span>
        </div>
        <div className="lg-side-body">
          <h1>Your own space for leads, partners and patients.</h1>
          <ul>
            <li><strong>Yours alone</strong> Your organisation gets its own separate database. No other organisation can see it.</li>
            <li><strong>Set up your way</strong> Start empty and add your team, your WhatsApp number and your own settings.</li>
            <li><strong>Add branches later</strong> Open in one city today and add more branches under the same account.</li>
          </ul>
        </div>
        <div className="lg-side-foot">For hospitals, clinics, diagnostic centres, labs, pharmacies and dialysis centres</div>
      </aside>

      <main className="lg-main">
        <div className="lg-card is-wide">
          <div className="lg-head">
            <span className="lg-mark is-sm"><NexMarketLogo size={28} /></span>
            <div>
              <h2>{done ? 'Your organisation is ready' : sentTo && !busy ? 'Enter your code' : 'Create your organisation'}</h2>
              <p>NexEagle</p>
            </div>
          </div>

          {done ? (
            <div className="lg-form">
              <div className="lg-note is-good" role="status">
                <strong>{done.name}</strong> has been set up, and you are its admin.
              </div>
              <dl className="lg-facts">
                <div><dt>Organisation</dt><dd>{done.key}</dd></div>
                <div><dt>User ID</dt><dd>{done.userId} <span>(or your mobile number)</span></dd></div>
                <div><dt>Password</dt><dd>The one you just chose</dd></div>
              </dl>
              <p className="lg-help">Write down the organisation name: everyone in your team types it when they sign in.</p>
              <Link className="lg-submit is-link" href={`/login?org=${encodeURIComponent(done.key)}`}>Go to sign in</Link>
            </div>
          ) : options && !options.open ? (
            <div className="lg-form">
              <div className="lg-note is-warn" role="status">New sign-ups are closed at the moment. Please try again later.</div>
              <Link className="lg-submit is-link" href="/login">Back to sign in</Link>
            </div>
          ) : busy ? (
            <div className="lg-busy" role="status">
              <span className="lg-spinner spin" aria-hidden="true" />
              <strong>Setting up {orgName.trim()}…</strong>
              <span>Creating your own database. This can take up to a minute. Please keep this page open.</span>
            </div>
          ) : sentTo ? (
            <form onSubmit={submitCode} className="lg-form" noValidate>
              <div className="lg-note is-good" role="status">
                {resent ? 'A new code is on its way. ' : ''}We sent a 6-digit code to {where}. It works for {sentTo.minutes} minutes.
              </div>
              <label className="lg-field">
                <span>6-digit code</span>
                <input id="su-code" type="text" inputMode="numeric" autoComplete="one-time-code" value={code} autoFocus
                  onChange={(e) => { fixed('code'); setCode(e.target.value.replace(/[^\d\s]/g, '')); }} placeholder="123456" required />
                {err('code')}
              </label>
              {error && !fields.code && <div className="lg-note is-bad" role="alert">{error}</div>}
              <button type="submit" className="lg-submit">Create {orgName.trim()}</button>
              <p className="lg-help">
                Nothing arrived? <button type="button" className="lg-linkbtn" onClick={sendAgain} disabled={sending}>{sending ? 'Sending…' : 'Send it again'}</button>
                {' · '}
                <button type="button" className="lg-linkbtn" onClick={() => { setSentTo(null); setError(''); setFields({}); }}>Change my details</button>
              </p>
            </form>
          ) : (
            <form onSubmit={submit} className="lg-form" noValidate>
              <label className="lg-field">
                <span>Organisation name</span>
                <input id="su-orgName" type="text" value={orgName} onChange={(e) => { fixed('orgName', 'orgKey'); setOrgName(e.target.value); }} autoComplete="organization" maxLength={80} placeholder="e.g. City Lab & Scans" required />
                {err('orgName')}
              </label>

              <label className="lg-field">
                <span>Sign-in name</span>
                <input id="su-orgKey" type="text" value={key} onChange={(e) => { fixed('orgKey'); setKeyEdited(true); setOrgKey(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); }}
                  autoCapitalize="none" spellCheck={false} maxLength={30} placeholder="e.g. citylab" aria-describedby="su-key-hint" required />
                {fields.orgKey ? err('orgKey') : (
                  <span id="su-key-hint" className={`lg-hint${keyState ? (keyState.ok ? ' is-good' : ' is-bad') : ''}`}>
                    {keyState ? keyState.text : 'Short and easy to type. Your team enters it every time they sign in. It cannot be changed later.'}
                  </span>
                )}
              </label>

              <fieldset className="lg-kinds" id="su-kinds" tabIndex={-1}>
                <legend>What is your organisation? <span>Choose all that apply</span></legend>
                <div>
                  {kindList.map((k) => (
                    <label key={k.key} className={kinds.includes(k.key) ? 'is-on' : ''}>
                      <input type="checkbox" checked={kinds.includes(k.key)} onChange={() => toggleKind(k.key)} />
                      <span>{k.label}</span>
                    </label>
                  ))}
                </div>
                {err('kinds')}
              </fieldset>

              <label className="lg-field">
                <span>City <em>optional</em></span>
                <input id="su-city" type="text" value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" maxLength={60} />
              </label>

              <div className="lg-sep">You, the first admin</div>

              <label className="lg-field">
                <span>Your name</span>
                <input id="su-name" type="text" value={name} onChange={(e) => { fixed('name'); setName(e.target.value); }} autoComplete="name" maxLength={80} required />
                {err('name')}
              </label>
              <div className="lg-row2">
                <label className="lg-field">
                  <span>Mobile number</span>
                  <input id="su-phone" type="tel" inputMode="numeric" value={phone} onChange={(e) => { fixed('phone'); setPhone(e.target.value); }} autoComplete="tel-national" maxLength={16} required />
                  {err('phone')}
                </label>
                <label className="lg-field">
                  <span>Email {emailNeeded ? null : <em>optional</em>}</span>
                  <input id="su-email" type="email" value={email} onChange={(e) => { fixed('email'); setEmail(e.target.value); }} autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={120} />
                  {err('email')}
                </label>
              </div>
              <label className="lg-field">
                <span>Password</span>
                <span className="lg-pw">
                  <input id="su-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => { fixed('password'); setPassword(e.target.value); }} autoComplete="new-password" maxLength={200} required />
                  <button type="button" className="lg-eye is-text" onClick={() => setShowPassword(!showPassword)} aria-pressed={showPassword}>{showPassword ? 'Hide' : 'Show'}</button>
                </span>
                {fields.password ? err('password') : <span className="lg-hint">At least 8 characters, with a letter and a number.</span>}
              </label>

              <label className="lg-check" htmlFor="su-agree">
                <input id="su-agree" type="checkbox" checked={agree} onChange={(e) => { fixed('agree'); setAgree(e.target.checked); }} />
                <span>I am allowed to create this account for this organisation.</span>
              </label>
              {err('agree')}

              {error && <div className="lg-note is-bad" role="alert">{error}</div>}

              {options?.verify && (
                <p className="lg-help">Next, we send a code to your {options.verifyWhatsApp ? (options.verifyEmail ? 'WhatsApp number and email' : 'WhatsApp number') : 'email'} to check it is really you.</p>
              )}
              <button type="submit" className="lg-submit" disabled={sending}>{sending ? 'Sending your code…' : options?.verify ? 'Continue' : 'Create organisation'}</button>
              <p className="lg-help">Already have an account? <Link href="/login">Sign in</Link></p>
            </form>
          )}
        </div>
        <p className="lg-foot">Each organisation&rsquo;s data is kept in its own database</p>
      </main>
    </div>
  );
}
