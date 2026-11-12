'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import NexMarketLogo from '@/components/NexMarketLogo';
import { forgotPassword, getOrg, getRecoveryOptions, resetPasswordWithCode, setOrg } from '@/lib/sync/api-client';

/** Forgot password: ask for a code (sent to the account's own email and WhatsApp), then set a new password with it. */
export default function ForgotPage() {
  const [org, setOrgName] = useState('');
  const [userId, setUserId] = useState('');
  const [step, setStep] = useState<'ask' | 'code' | 'done'>('ask');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [ways, setWays] = useState<{ email: boolean; whatsapp: boolean } | null>(null);

  useEffect(() => {
    let fromLink = '';
    try { fromLink = new URLSearchParams(window.location.search).get('org') ?? ''; } catch { /* no address */ }
    const start = (fromLink || getOrg()).trim().toLowerCase();
    const t = setTimeout(() => { if (start) setOrgName((o) => o || start); }, 0);
    let live = true;
    getRecoveryOptions().then((w) => { if (live) setWays(w); });
    return () => { live = false; clearTimeout(t); };
  }, []);

  const none = ways !== null && !ways.email && !ways.whatsapp;
  const where = ways?.email && ways?.whatsapp ? 'email and WhatsApp number' : ways?.email ? 'email address' : 'WhatsApp number';

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !userId.trim()) return;
    setBusy(true); setError('');
    setOrg(org);
    const r = await forgotPassword(userId.trim());
    setBusy(false);
    if (!r.ok) { setError(r.status === 404 ? 'We don’t know this organisation. Check the name and try again.' : r.message); return; }
    setNote(r.message);
    setStep('code');
    setTimeout(() => document.getElementById('fg-code')?.focus(), 50);
  }

  async function reset(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (code.replace(/\D/g, '').length !== 6) { setError('Enter the 6-digit code.'); return; }
    if (password.length < 8) { setError('Use a password of at least 8 characters.'); return; }
    setBusy(true); setError('');
    const r = await resetPasswordWithCode(userId.trim(), code, password);
    setBusy(false);
    if (!r.ok) { setError(r.message); return; }
    setStep('done');
  }

  return (
    <div className="lg-shell">
      <aside className="lg-side" aria-hidden="true">
        <div className="lg-side-top">
          <span className="lg-mark"><NexMarketLogo size={34} /></span>
          <span className="lg-brand">NexEagle</span>
        </div>
        <div className="lg-side-body">
          <h1>Back in, in two steps.</h1>
          <ul>
            <li><strong>A code, to you only</strong> It goes to the email and WhatsApp number already saved on your account.</li>
            <li><strong>Ten minutes</strong> The code works once, for ten minutes, and five tries.</li>
            <li><strong>Everything else signs out</strong> A new password signs out every other device.</li>
          </ul>
        </div>
        <div className="lg-side-foot">Never share a code or password, even with the NexEagle team</div>
      </aside>

      <main className="lg-main">
        <div className="lg-card">
          <div className="lg-head">
            <span className="lg-mark is-sm"><NexMarketLogo size={28} /></span>
            <div>
              <h2>{step === 'done' ? 'Password changed' : 'Forgot your password?'}</h2>
              <p>NexEagle</p>
            </div>
          </div>

          {step === 'done' ? (
            <div className="lg-form">
              <div className="lg-note is-good" role="status">Your password has been changed and your other devices are signed out.</div>
              <Link className="lg-submit is-link" href={`/login${org.trim() ? `?org=${encodeURIComponent(org.trim().toLowerCase())}` : ''}`}>Sign in</Link>
            </div>
          ) : none ? (
            <div className="lg-form">
              <div className="lg-note is-warn" role="status">Codes can’t be sent from this server yet. Ask your admin to reset your password from Users &amp; roles.</div>
              <Link className="lg-submit is-link" href="/login">Back to sign in</Link>
            </div>
          ) : step === 'ask' ? (
            <form onSubmit={ask} className="lg-form" noValidate>
              <label className="lg-field">
                <span>Organisation</span>
                <input id="fg-org" type="text" value={org} onChange={(e) => setOrgName(e.target.value)} autoCapitalize="none" spellCheck={false} maxLength={30} placeholder="e.g. citylab" />
                <span className="lg-hint">Leave empty if you were not given one.</span>
              </label>
              <label className="lg-field">
                <span>User ID, phone or email</span>
                <input id="fg-user" type="text" value={userId} onChange={(e) => setUserId(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={120} required />
              </label>
              {error && <div className="lg-note is-bad" role="alert">{error}</div>}
              <button type="submit" className="lg-submit" disabled={busy || !userId.trim()}>{busy ? 'Sending…' : 'Send me a code'}</button>
              <p className="lg-help">{ways ? `The code goes to the ${where} saved on your account.` : ' '} <Link href="/login">Back to sign in</Link></p>
            </form>
          ) : (
            <form onSubmit={reset} className="lg-form" noValidate>
              <div className="lg-note is-good" role="status">{note}</div>
              <label className="lg-field">
                <span>6-digit code</span>
                <input id="fg-code" type="text" inputMode="numeric" autoComplete="one-time-code" value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} style={{ letterSpacing: '0.3em', fontVariantNumeric: 'tabular-nums' }} required />
              </label>
              <label className="lg-field">
                <span>New password</span>
                <span className="lg-pw">
                  <input id="fg-password" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" maxLength={200} required />
                  <button type="button" className="lg-eye is-text" onClick={() => setShow(!show)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
                </span>
                <span className="lg-hint">At least 8 characters, with a letter and a number.</span>
              </label>
              {error && <div className="lg-note is-bad" role="alert">{error}</div>}
              <button type="submit" className="lg-submit" disabled={busy}>{busy ? 'Saving…' : 'Set new password'}</button>
              <p className="lg-help">No code after a minute? <button type="button" className="lg-linkbtn" onClick={() => { setStep('ask'); setCode(''); setError(''); }}>Send another</button> (three an hour at most)</p>
            </form>
          )}
        </div>
        <p className="lg-foot">If you have no email or WhatsApp number on your account, ask your admin to reset your password</p>
      </main>
    </div>
  );
}
