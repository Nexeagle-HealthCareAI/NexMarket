'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useOutboxCount } from '@/lib/db';
import { startSyncPolling, registerBackgroundSync } from '@/lib/sync/engine';
import { logout as apiLogout, setSessionExpiredHandler } from '@/lib/sync/api-client';
import { useAgentStore } from '@/store/agent-store';
import PwaInstallPrompt from '@/components/PwaInstallPrompt';
import NotificationListener from '@/components/NotificationListener';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { AnimatePresence, motion } from 'framer-motion';
import MobileBottomNav from '@/components/layout/MobileBottomNav';
import { useTranslations } from '@/i18n/I18nProvider';

const navItems = (t: any) => [
  {
    href: '/home',
    label: t.navHome,
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    href: '/contacts',
    label: t.navContacts,
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    href: '/visit',
    label: t.navVisit,
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    href: '/history',
    label: t.navHistory,
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
  },
  {
    href: '/my-task',
    label: t.navMyTask,
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    href: '/profile',
    label: t.navProfile,
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
];

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const outboxCount = useOutboxCount();
  const { agentId, name, role, profileCompleted, hasHydrated, clearAuth } = useAgentStore(
    useShallow((s) => ({
      agentId: s.agentId,
      name: s.name,
      role: s.role,
      profileCompleted: s.profileCompleted,
      hasHydrated: s.hasHydrated,
      clearAuth: s.clearAuth,
    }))
  );

  const t = useTranslations();

  const handleSignOut = () => {
    // Best-effort: revoke the session server-side and clear the httpOnly
    // cookies. clearAuth() alone only wipes Zustand/localStorage — it can't
    // touch httpOnly cookies, so without this call they'd stay valid until
    // they expire even after the user "signs out".
    void apiLogout().catch(() => {});
    clearAuth();
    router.replace('/login');
  };

  useEffect(() => {
    // A 401 that survives a refresh attempt means the session is genuinely
    // gone (not just an expired-but-renewable access token) — no point
    // calling logout() against a server that already sees no session, just
    // drop local state and send the agent back to sign in.
    setSessionExpiredHandler(() => {
      clearAuth();
      router.replace('/login');
    });
    return () => setSessionExpiredHandler(null);
  }, [clearAuth, router]);

  useEffect(() => {
    // Zustand's persist middleware rehydrates from localStorage asynchronously,
    // so agentId is briefly null on every fresh load even for an already-logged
    // -in agent. Deciding "not logged in" before hydration finishes is what was
    // causing a false redirect to /login on refresh (reported as "automatic
    // logout") — wait for it first.
    if (!hasHydrated) return;

    if (!agentId && typeof window !== 'undefined') {
      router.replace('/login');
      return;
    }

    // Redirect un-onboarded agents to the onboarding page
    if (agentId && !profileCompleted && !pathname.startsWith('/onboarding') && typeof window !== 'undefined') {
      router.replace('/onboarding');
      return;
    }

    startSyncPolling();
    void registerBackgroundSync();
  }, [hasHydrated, agentId, profileCompleted, pathname, router]);

  // Close drawer on path change
  useEffect(() => {
    setIsDrawerOpen(false);
  }, [pathname]);

  // Before hydration finishes, agentId/name/role are all momentarily null even
  // for an already-logged-in agent — render a neutral loading state instead of
  // a flash of the sidebar with empty user info (or content that's about to be
  // redirected away from a beat later).
  if (!hasHydrated) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="spinner" style={{ width: 32, height: 32, border: '3px solid var(--surface-border)', borderTopColor: 'var(--color-primary-500)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    );
  }

  // If on the onboarding page, render just children without sidebar navigation
  if (pathname.startsWith('/onboarding')) {
    return (
      <main>
        {children}
      </main>
    );
  }

  const renderNavLinks = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '0 0.5rem 0.4rem' }}>
        {t.navigation}
      </div>
      {navItems(t).map((item) => {
        const isActive = pathname.startsWith(item.href);
        const isVisit = item.href === '/visit';
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`sidebar-nav-link${isActive ? ' active' : ''}`}
            onClick={() => setIsDrawerOpen(false)}
          >
            <span style={{ position: 'relative', display: 'flex' }}>
              {item.icon}
              {isVisit && outboxCount && outboxCount > 0 ? (
                <span style={{
                  position: 'absolute', top: -5, right: -6,
                  background: 'var(--color-warning)', color: '#0f172a',
                  borderRadius: '9999px', fontSize: '0.6rem', fontWeight: 700,
                  padding: '1px 5px', minWidth: 16, textAlign: 'center'
                }}>
                  {outboxCount > 99 ? '99+' : outboxCount}
                </span>
              ) : null}
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
      {role?.toLowerCase() === 'admin' && (
        <Link
          href="/admin/agents"
          className="sidebar-nav-link"
          onClick={() => setIsDrawerOpen(false)}
          style={{ marginTop: '0.5rem', borderTop: '1px solid var(--surface-border)', paddingTop: '0.75rem' }}
        >
          <span style={{ display: 'flex' }}>
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ width: 20, height: 20 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </span>
          <span>{t.navAdmin}</span>
        </Link>
      )}
    </div>
  );

  const renderUserInfo = () => (
    <>
      <div style={{ background: 'var(--surface-input)', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)', padding: '0.85rem', marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{t.loggedInAs}</div>
        <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.95rem', marginBottom: '0.2rem' }}>{name || t.officerRole}</div>
        <div style={{ display: 'inline-block', background: 'rgba(99,102,241,0.15)', color: 'var(--color-primary-600)', fontSize: '0.75rem', fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-sm)' }}>
          {role || t.defaultRole}
        </div>
      </div>
    </>
  );

  const renderFooterInfo = () => (
    <div>
      <div style={{ background: 'var(--surface-input)', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)', padding: '0.75rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: outboxCount && outboxCount > 0 ? '#f59e0b' : '#10b981', display: 'inline-block' }} />
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {outboxCount && outboxCount > 0 ? `${outboxCount} ${t.unsynced}` : t.allSynced}
          </span>
        </div>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t.offlineSafe}</span>
      </div>

      <div style={{ marginBottom: '0.75rem', display: 'flex', justifyContent: 'center' }}>
        <LanguageSwitcher />
      </div>

      <button
        type="button"
        onClick={handleSignOut}
        style={{
          width: '100%', padding: '0.65rem', background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)', color: '#ef4444',
          borderRadius: 'var(--radius-md)', fontWeight: 600, fontSize: '0.85rem',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'
        }}
      >
        🚪 {t.signOut}
      </button>
    </div>
  );

  return (
    <>
      {/* ─── Mobile Top Nav (Visible on < 768px) ───────────────────────────── */}
      <div className="mobile-top-nav">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontWeight: 900, fontSize: '1.2rem', color: '#0f172a', letterSpacing: '-0.03em', lineHeight: 1.1 }}>
            NexMarket
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-primary-600)', fontWeight: 700, letterSpacing: '0.02em' }}>
            {t.greeting}, {name?.split(' ')[0] ?? t.defaultAgentName} 👋
          </div>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <LanguageSwitcher />
          
          <button
            type="button"
            onClick={handleSignOut}
            style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 'var(--radius-full)', color: '#ef4444', cursor: 'pointer', padding: '0.4rem', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background var(--transition-fast)' }}
            aria-label="Sign Out"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>

      {/* ─── Desktop Left Sidebar (Visible on >= 768px) ────────────────────── */}
      <aside className="desktop-sidebar" aria-label="Desktop navigation">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem', padding: '0 0.5rem' }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1.2rem', color: '#0f172a', letterSpacing: '-0.02em' }}>NexMarket</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-primary-600)', fontWeight: 600 }}>{t.outreachPortal}</div>
            </div>
          </div>

          {renderUserInfo()}
          {renderNavLinks()}
        </div>

        <div>
          {renderFooterInfo()}
        </div>
      </aside>

      {/* ─── Main Content Area ──────────────────────────────────────────────── */}
      <main className="page-container" style={{ paddingTop: '0.5rem' }}>
        <PwaInstallPrompt />
        <NotificationListener />
        {children}
      </main>

      <MobileBottomNav />
    </>
  );
}
