'use client';

import { isDashboardRole, rememberPlace } from '@/lib/crm/access';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { loginWithPassword, syncPull, SIGNED_OUT_KEY, getOrg, setOrg, findOrg } from '@/lib/sync/api-client';
import { setSyncStateValue, isLocalDatabaseEmpty, getOrCreateDeviceId, db } from '@/lib/db';
import { refreshReferenceData } from '@/lib/sync/seeder';
import { useAgentStore } from '@/store/agent-store';
import type { LocalContact, LocalVisit, LocalShift, LocalReferral, LocalPanchayat } from '@/lib/db/schema';
import PwaInstallPrompt from '@/components/PwaInstallPrompt';
import NexMarketLogo from '@/components/NexMarketLogo';

// Why the last session on this browser ended (a newer sign-in on another device of the same kind, etc.).
const outListeners = new Set<() => void>();
function readSignedOut(): string {
  try { return sessionStorage.getItem(SIGNED_OUT_KEY) ?? ''; } catch { return ''; }
}
function clearSignedOut() {
  try { sessionStorage.removeItem(SIGNED_OUT_KEY); } catch { /* storage off */ }
  outListeners.forEach((l) => l());
}

const LAST_USER_KEY = 'nx.lastUserId';

/** The server's reason, without the request details ("API /api/v1/auth/login → 401: {…}"). */
function loginError(err: unknown): { message: string; lockedUntil?: number } {
  const raw = err instanceof Error ? err.message : '';
  const m = raw.match(/→ (\d{3}): ([\s\S]*)$/);
  if (!m) return { message: /fetch|network/i.test(raw) ? 'Can’t reach the server. Check your internet connection and try again.' : 'Something went wrong. Please try again.' };
  const status = Number(m[1]);
  let body: { message?: string; lockedUntil?: string } | string = m[2];
  try { body = JSON.parse(m[2]); } catch { /* plain text */ }
  const text = typeof body === 'string' ? body.replace(/^"|"$/g, '') : body.message ?? '';
  if (status === 423 && typeof body === 'object' && body.lockedUntil) return { message: text, lockedUntil: new Date(body.lockedUntil).getTime() };
  if (status === 404) return { message: text || 'We don’t know this organisation. Check the name and try again.' };
  if (status === 429) return { message: 'Too many sign-in attempts from this network. Wait a minute and try again.' };
  if (status === 401 || status === 400) return { message: text || 'Wrong User ID or password.' };
  return { message: text || 'Something went wrong. Please try again.' };
}

export default function LoginPage() {
  const signedOutReason = useSyncExternalStore(
    (cb) => { outListeners.add(cb); return () => { outListeners.delete(cb); }; },
    readSignedOut,
    () => '',
  );
  const router = useRouter();
  const setAuth = useAgentStore((s) => s.setAuth);

  const [userId, setUserId] = useState('');
  // The organisation's short sign-in name. Empty = the first organisation on this server.
  const [org, setOrgName] = useState('');
  const [orgFound, setOrgFound] = useState<{ key: string; name: string } | null | undefined>(undefined);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [remember, setRemember] = useState(true);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // The User ID used last time on this browser (never the password).
  useEffect(() => {
    let saved = '';
    try { saved = localStorage.getItem(LAST_USER_KEY) ?? ''; } catch { /* storage off */ }
    if (saved) {
      const t = setTimeout(() => { setUserId((u) => u || saved); document.getElementById('password-input')?.focus(); }, 0);
      return () => clearTimeout(t);
    }
  }, []);
  // The organisation used last time on this browser, or the one in the link (/login?org=…).
  useEffect(() => {
    let fromLink = '';
    try { fromLink = new URLSearchParams(window.location.search).get('org') ?? ''; } catch { /* no address */ }
    const start = (fromLink || getOrg()).trim().toLowerCase();
    if (!start) return;
    const t = setTimeout(() => setOrgName((o) => o || start), 0);
    return () => clearTimeout(t);
  }, []);
  // Show the organisation's full name once a short name is typed, so a typo is seen before the password is sent.
  useEffect(() => {
    const k = org.trim().toLowerCase();
    let live = true;
    const t = setTimeout(() => {
      if (k.length < 3) { setOrgFound(undefined); return; }
      findOrg(k).then((o) => { if (live) setOrgFound(o); });
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [org]);
  // Count down a sign-in lock.
  useEffect(() => {
    if (!lockedUntil) return;
    const t = setInterval(() => { const n = Date.now(); setNow(n); if (n >= lockedUntil) setLockedUntil(null); }, 1000);
    return () => clearInterval(t);
  }, [lockedUntil]);
  const lockLeft = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - now) / 1000)) : 0;

  async function performLogin(targetId: string, targetPass: string) {
    setError('');
    clearSignedOut();
    setIsLoading(true);
    setIsInitializing(true);

    try {
      // Field work saved on this browser belongs to the organisation that was signed in here. Never mix two.
      const wanted = org.trim().toLowerCase();
      if (wanted !== getOrg() && !(await isLocalDatabaseEmpty())) {
        setError('This browser still holds field work from another organisation. Sign in to that one and let it sync, or use a different browser for this organisation.');
        setIsInitializing(false);
        return;
      }
      setOrg(wanted);
      const deviceId = await getOrCreateDeviceId();
      const auth = await loginWithPassword(targetId, targetPass, deviceId);
      try { if (remember) localStorage.setItem(LAST_USER_KEY, targetId); else localStorage.removeItem(LAST_USER_KEY); } catch { /* storage off */ }

      // Persist to Dexie syncState for sync engine — no token here, the JWT
      // and refresh token are httpOnly cookies now, invisible to this code.
      await setSyncStateValue('agentId', auth.agentId);
      await setSyncStateValue('deviceId', auth.deviceId);

      // Persist to Zustand
      setAuth({
        agentId: auth.agentId,
        deviceId: auth.deviceId,
        name: auth.name,
        role: auth.role,
        profileCompleted: auth.profileCompleted,
      });

      // Refresh panchayats + questionnaire unconditionally (not just when
      // empty) — every login is a chance to pick up admin-side changes that
      // a previously-onboarded device would otherwise never see again.
      await refreshReferenceData();

      // Reinstall recovery: if local DB is empty, pull down all agent data
      const isEmpty = await isLocalDatabaseEmpty();
      if (isEmpty) {
        try {
          let hasMore = true;
          let page = 1;
          const pageSize = 500;
          
          while (hasMore) {
            const pulled = await syncPull({
              agentId: auth.agentId,
              deviceId: auth.deviceId,
              since: '1970-01-01T00:00:00Z',
              page,
              pageSize
            });

            if (pulled.panchayats?.length) {
              await db.panchayats.bulkPut(pulled.panchayats as LocalPanchayat[]);
            }
            if (pulled.contacts?.length) {
              await db.contacts.bulkPut(
                (pulled.contacts as LocalContact[]).map((c) => ({ ...c, syncedAt: new Date().toISOString() }))
              );
            }
            if (pulled.visits?.length) {
              await db.visits.bulkPut(
                (pulled.visits as LocalVisit[]).map((v) => ({ ...v, syncedAt: new Date().toISOString() }))
              );
            }
            if (pulled.shifts?.length) {
              await db.shifts.bulkPut(
                (pulled.shifts as LocalShift[]).map((s) => ({ ...s, syncedAt: new Date().toISOString() }))
              );
            }
            if (pulled.referrals?.length) {
              await db.referrals.bulkPut(
                (pulled.referrals as LocalReferral[]).map((r) => ({ ...r, syncedAt: new Date().toISOString() }))
              );
            }
            if (pulled.surveys?.length) {
              await db.surveyResponses.bulkPut(
                (pulled.surveys as import('@/lib/db/schema').LocalSurveyResponse[]).map((s) => ({ ...s, syncedAt: new Date().toISOString() }))
              );
            }
            if (pulled.surveyQuestions?.length) {
              await db.transaction('rw', db.surveyQuestions, async () => {
                await db.surveyQuestions.clear();
                await db.surveyQuestions.bulkPut(pulled.surveyQuestions!);
              });
            }

            hasMore = pulled.hasMore;
            page++;
          }
        } catch (pullErr) {
          console.warn('Reinstall recovery pull failed — continuing with an empty local DB:', pullErr);
        }
      }

      rememberPlace(auth.orgPlace);   // the organisation's own wording, right from the first screen

      if (auth.mustChangePassword) {
        router.push('/change-password');
      } else if (isDashboardRole(auth.role)) {
        router.push('/admin/dashboard');
      } else {
        router.push('/home');
      }
    } catch (err: unknown) {
      const { message, lockedUntil: until } = loginError(err);
      setError(message);
      if (until) { setLockedUntil(until); setNow(Date.now()); }
      setIsInitializing(false);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (lockLeft > 0) return;
    if (!userId.trim() || !password) {
      setError('Enter your User ID and password.');
      return;
    }
    await performLogin(userId.trim(), password);
  }
  const caps = (e: React.KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState?.('CapsLock') ?? false);
  const mmss = `${Math.floor(lockLeft / 60)}:${String(lockLeft % 60).padStart(2, '0')}`;

  return (
    <div className="lg-shell">
      <aside className="lg-side" aria-label="The NexEagle Android app for field agents">
        <div className="lg-side-top">
          <span className="lg-mark"><NexMarketLogo size={34} /></span>
          <span className="lg-brand">NexEagle</span>
        </div>
        <AppShowcase />
        <div className="lg-side-foot">For hospitals, clinics, diagnostic centres, labs, pharmacies and dialysis centres</div>
      </aside>

      <main className="lg-main">
        <div className="lg-card">
          <div className="lg-head">
            <span className="lg-mark is-sm"><NexMarketLogo size={28} /></span>
            <div>
              <h2>Sign in</h2>
              <p>{orgFound ? `NexEagle · ${orgFound.name}` : 'NexEagle'}</p>
            </div>
          </div>
          <PwaInstallPrompt />

          {isInitializing ? (
            <div className="lg-busy" role="status">
              <span className="lg-spinner spin" aria-hidden="true" />
              <strong>Signing you in…</strong>
              <span>Getting your data ready.</span>
            </div>
          ) : (
            <form onSubmit={handleFormSubmit} className="lg-form" noValidate>
              <label className="lg-field">
                <span>Organisation</span>
                <input id="org-input" type="text" value={org} onChange={(e) => setOrgName(e.target.value)} autoComplete="organization"
                  autoCapitalize="none" spellCheck={false} placeholder="e.g. citylab" maxLength={30} aria-describedby="org-hint" />
                <span id="org-hint" className={`lg-hint${orgFound === null ? ' is-warn' : ''}`}>
                  {orgFound ? orgFound.name : orgFound === null ? 'We don’t know this organisation. Check the name.' : 'The short name your organisation chose. Leave empty if you were not given one.'}
                </span>
              </label>

              <label className="lg-field">
                <span>User ID, phone or email</span>
                <input id="userid-input" type="text" value={userId} onChange={(e) => setUserId(e.target.value)} autoComplete="username"
                  autoCapitalize="none" spellCheck={false} placeholder="e.g. MKT-1001" maxLength={120} required />
              </label>

              <label className="lg-field">
                <span>Password</span>
                <span className="lg-pw">
                  <input id="password-input" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                    onKeyUp={caps} onKeyDown={caps} onBlur={() => setCapsLock(false)} autoComplete="current-password" maxLength={200} required />
                  <button type="button" className="lg-eye" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>
                    {showPassword ? (
                      <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                    ) : (
                      <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    )}
                  </button>
                </span>
                {capsLock && <span className="lg-hint is-warn">Caps Lock is on.</span>}
              </label>

              <label className="lg-check">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                <span>Remember my User ID on this device</span>
              </label>

              {signedOutReason && !error && (
                <div className="lg-note is-warn" role="status">
                  {signedOutReason} Each person can be signed in on one laptop or desktop, one tablet and one phone at a time.
                </div>
              )}
              {error && (
                <div className="lg-note is-bad" role="alert">
                  {lockLeft > 0 ? <>Too many wrong passwords. Try again in <strong>{mmss}</strong>, or ask your admin to reset your password.</> : error}
                </div>
              )}

              <button type="submit" className="lg-submit" disabled={isLoading || lockLeft > 0 || !userId.trim() || !password}>
                {isLoading ? 'Signing in…' : lockLeft > 0 ? `Locked · ${mmss}` : 'Sign in'}
              </button>

              <p className="lg-help">New here? <Link href="/signup">Create an account for your organisation</Link></p>
              <p className="lg-help"><Link href={`/forgot${org.trim() ? `?org=${encodeURIComponent(org.trim().toLowerCase())}` : ''}`}>Forgot your password?</Link> Never share your password, even with the NexEagle team.</p>
            </form>
          )}
        </div>
        <p className="lg-foot">Secured sign-in · sessions end on other devices of the same kind when you sign in here</p>
      </main>
    </div>
  );
}

// ─── The Android app, shown beside the sign-in form ──────────────────────

const APP_SLIDES = [
  { img: '/appshots/today.webp', title: 'Every day planned', line: 'Agents open the app and see where to go next.', alt: 'The app’s Today screen: the next panchayat to check in at, a call that is overdue, and today’s numbers.' },
  { img: '/appshots/partners.webp', title: 'No follow-up missed', line: 'Late and due partners come first. One tap to call.', alt: 'The app’s Partners screen: follow-ups due today and overdue, each with Call, WhatsApp, Route and Later buttons.' },
  { img: '/appshots/patients.webp', title: 'Every patient tracked', line: 'From the village to your door, step by step.', alt: 'The app’s My patients screen: each referred patient with a five-step progress bar from on the way to admitted.' },
  { img: '/appshots/partner.webp', title: 'Visits with proof', line: 'Each visit is saved with its time and place, even with no signal.', alt: 'One partner’s screen in the app: call, WhatsApp, the follow-up due, patients sent, and Visit done and Refer patient buttons.' },
];

const WHY = [
  { title: 'One place for every lead', line: 'WhatsApp, Facebook, Instagram, camps and partner referrals, followed up to your door.' },
  { title: 'A field team you can see', line: 'Shifts, visits and routes from the agents’ phones, even without signal.' },
  { title: 'Results as patients', line: 'What each campaign and partner really brought in.' },
];
const TABS = ['Why NexEagle', ...APP_SLIDES.map((s) => s.title)];

/**
 * Beside the sign-in form: first why NexEagle (three short points), then four screens of the field agents' Android
 * app, one at a time and large, each with a few words on what it gives the manager. It moves on by itself (the
 * first one stays a little longer); it stops while the pointer or keyboard is on it, and never moves for people who
 * have asked their device for less motion.
 */
function AppShowcase() {
  const [at, setAt] = useState(0);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = setTimeout(() => setAt((n) => (n + 1) % TABS.length), at === 0 ? 9000 : 6000);
    return () => clearTimeout(t);
  }, [held, at]);
  const slide = at > 0 ? APP_SLIDES[at - 1] : null;
  return (
    <div className={`lg-show${slide ? '' : ' is-why'}`} onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)} onFocus={() => setHeld(true)} onBlur={() => setHeld(false)}>
      {/* The phone stays in the page while "Why" shows, so its pictures are ready the moment it comes in. */}
      <div className="lg-phone" hidden={!slide}>
        {APP_SLIDES.map((s, i) => (
          // eslint-disable-next-line @next/next/no-img-element -- four small local pictures, cross-faded
          <img key={s.img} src={s.img} alt={i === at - 1 ? s.alt : ''} aria-hidden={i !== at - 1} className={i === at - 1 || (!slide && i === 0) ? 'is-on' : ''} width={640} height={1385} decoding="async" />
        ))}
      </div>
      <div className="lg-show-text">
        <p className="lg-kicker">{slide ? 'Android app for your field team' : 'Why NexEagle'}</p>
        <h1>{slide ? slide.title : 'Every lead, partner and patient in one place.'}</h1>
        {slide ? <p className="lg-show-line" aria-live="polite">{slide.line}</p> : (
          <ul className="lg-why">
            {WHY.map((w) => <li key={w.title}><strong>{w.title}</strong>{w.line}</li>)}
          </ul>
        )}
        <div className={`lg-show-tabs${slide ? '' : ' is-row'}`} role="group" aria-label="What to show">
          {TABS.map((title, i) => (
            <button key={title} type="button" className={i === at ? 'is-on' : ''} aria-pressed={i === at} onClick={() => { setAt(i); setHeld(true); }}>
              {i > 0 && <span aria-hidden="true">{i}</span>}{title}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
