'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const adminNavItems = [
  { href: '/admin/map', label: 'Live Map & Replay', icon: '🗺️' },
  { href: '/admin/agents', label: 'Field Agents', icon: '👥' },
  { href: '/admin/duplicates', label: 'Duplicate Review', icon: '⚠️' },
  { href: '/admin/reports', label: 'Reports & Analytics', icon: '📊' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--surface-bg)' }}>
      {/* Top Admin Navbar */}
      <header
        style={{
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--surface-border)',
          padding: '0.75rem 1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          zIndex: 50,
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.03)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '8px',
              background: 'linear-gradient(135deg, var(--color-primary-600), var(--color-primary-500))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontWeight: 900,
              fontSize: '1.25rem',
              boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)',
            }}
          >
            N
          </div>
          <div>
            <h1 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>
              NexMarket
            </h1>
            <p style={{ fontSize: '0.75rem', color: 'var(--color-primary-600)', margin: 0, fontWeight: 600 }}>
              Field Outreach · Admin Portal
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <nav style={{ display: 'flex', gap: '0.5rem' }}>
            {adminNavItems.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    padding: '0.4rem 0.85rem',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    textDecoration: 'none',
                    color: isActive ? '#fff' : 'var(--text-secondary)',
                    background: isActive ? 'var(--color-primary-600)' : 'transparent',
                    transition: 'all 0.2s',
                  }}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div style={{ height: 24, width: 1, background: 'var(--surface-border)' }} />

          <Link
            href="/home"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: '0.8rem', color: 'var(--color-primary-600)', borderColor: 'rgba(99, 102, 241, 0.3)' }}
          >
            📱 Switch to Field Agent App
          </Link>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: '1.5rem', maxWidth: 1600, width: '100%', margin: '0 auto' }}>
        {children}
      </main>
    </div>
  );
}
