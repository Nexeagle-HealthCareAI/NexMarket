'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useOutboxCount } from '@/lib/db';
import { startSyncPolling, registerBackgroundSync } from '@/lib/sync/engine';
import { useAgentStore } from '@/store/agent-store';
import PwaInstallPrompt from '@/components/PwaInstallPrompt';
import NotificationListener from '@/components/NotificationListener';
import LanguageSwitcher from '@/components/LanguageSwitcher';

const navItems = [
  {
    href: '/home',
    label: 'Home',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    href: '/contacts',
    label: 'Contacts',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    href: '/visit',
    label: 'Visit',
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
    label: 'History',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
  },
];

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const outboxCount = useOutboxCount();
  const { agentId, name, role, profileCompleted, clearAuth } = useAgentStore((s) => ({
    agentId: s.agentId,
    name: s.name,
    role: s.role,
    profileCompleted: s.profileCompleted,
    clearAuth: s.clearAuth,
  }));

  useEffect(() => {
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
  }, [agentId, profileCompleted, pathname, router]);

  // If on the onboarding page, render just children without sidebar navigation
  if (pathname.startsWith('/onboarding')) {
    return (
      <main>
        {children}
      </main>
    );
  }

  return (
    <>
      {/* ─── Desktop Left Sidebar (Visible on >= 768px) ────────────────────── */}
      <aside className="desktop-sidebar" aria-label="Desktop navigation">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem', padding: '0 0.5rem' }}>
            <div style={{
              width: 40, height: 40,
              background: 'linear-gradient(135deg, var(--color-primary-600), var(--color-primary-400))',
              borderRadius: 'var(--radius-lg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontWeight: 900, fontSize: '1.4rem',
              boxShadow: '0 4px 12px rgba(99,102,241,0.3)'
            }}>
              N
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1.2rem', color: '#0f172a', letterSpacing: '-0.02em' }}>NexMarket</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-primary-600)', fontWeight: 600 }}>Outreach Portal</div>
            </div>
          </div>

          <div style={{ background: 'var(--surface-input)', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)', padding: '0.85rem', marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Logged in as</div>
            <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.95rem', marginBottom: '0.2rem' }}>{name || 'Officer'}</div>
            <div style={{ display: 'inline-block', background: 'rgba(99,102,241,0.15)', color: 'var(--color-primary-600)', fontSize: '0.75rem', fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-sm)' }}>
              {role || 'Marketing Executive'}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '0 0.5rem 0.4rem' }}>
              Navigation
            </div>
            {navItems.map((item) => {
              const isActive = pathname.startsWith(item.href);
              const isVisit = item.href === '/visit';
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`sidebar-nav-link${isActive ? ' active' : ''}`}
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
            <Link
              href="/admin/agents"
              className="sidebar-nav-link"
              style={{ marginTop: '0.5rem', borderTop: '1px solid var(--surface-border)', paddingTop: '0.75rem' }}
            >
              <span style={{ display: 'flex' }}>
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ width: 20, height: 20 }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </span>
              <span>Admin Directory</span>
            </Link>
          </div>
        </div>

        <div>
          <div style={{ background: 'var(--surface-input)', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)', padding: '0.75rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: outboxCount && outboxCount > 0 ? '#f59e0b' : '#10b981', display: 'inline-block' }} />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                {outboxCount && outboxCount > 0 ? `${outboxCount} unsynced` : 'All Synced'}
              </span>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Offline Safe</span>
          </div>

          <div style={{ marginBottom: '0.75rem', display: 'flex', justifyContent: 'center' }}>
            <LanguageSwitcher />
          </div>

          <button
            type="button"
            onClick={() => {
              clearAuth();
              router.replace('/login');
            }}
            style={{
              width: '100%', padding: '0.65rem', background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)', color: '#ef4444',
              borderRadius: 'var(--radius-md)', fontWeight: 600, fontSize: '0.85rem',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'
            }}
          >
            🚪 Sign Out
          </button>
        </div>
      </aside>

      {/* ─── Main Content Area ──────────────────────────────────────────────── */}
      <main className="page-container" style={{ paddingTop: '0.5rem' }}>
        <PwaInstallPrompt />
        <NotificationListener />
        {children}
      </main>

      {/* ─── Mobile Bottom Nav (Visible on < 768px) ─────────────────────────── */}
      <nav className="bottom-nav" role="navigation" aria-label="Agent navigation">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const isVisit = item.href === '/visit';
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item${isActive ? ' active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              <span style={{ position: 'relative' }}>
                {item.icon}
                {isVisit && outboxCount && outboxCount > 0 && (
                  <span
                    style={{
                      position: 'absolute',
                      top: -4,
                      right: -6,
                      background: 'var(--color-warning)',
                      color: '#0f172a',
                      borderRadius: '9999px',
                      fontSize: '0.6rem',
                      fontWeight: 700,
                      padding: '1px 5px',
                      minWidth: 16,
                      textAlign: 'center',
                    }}
                    aria-label={`${outboxCount} items pending sync`}
                  >
                    {outboxCount > 99 ? '99+' : outboxCount}
                  </span>
                )}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
