'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import LanguageSwitcher from '@/components/LanguageSwitcher';

const adminNavItems = [
  { href: '/admin/map', label: 'Live Map & Replay', icon: '🗺️' },
  { href: '/admin/assignments', label: 'Tasks & Assignments', icon: '📋' },
  { href: '/admin/sync', label: 'Sync Analytics', icon: '📡' },
  { href: '/admin/agents', label: 'Field Agents', icon: '👥' },
  { href: '/admin/duplicates', label: 'Duplicate Review', icon: '⚠️' },
  { href: '/admin/reports', label: 'Reports & Analytics', icon: '📊' },
  { href: '/admin/surveys', label: 'Surveys', icon: '📋' },
  { href: '/admin/pipeline', label: 'CRM Pipeline', icon: '🗂️' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: '#f8fafc' }}>
      
      {/* Sidebar Navigation */}
      <aside
        style={{
          width: '280px',
          background: 'linear-gradient(180deg, #1e1b4b 0%, #312e81 100%)',
          color: 'white',
          display: 'flex',
          flexDirection: 'column',
          position: 'fixed',
          top: 0,
          bottom: 0,
          left: 0,
          zIndex: 50,
          boxShadow: '4px 0 24px rgba(0,0,0,0.1)',
        }}
      >
        {/* Sidebar Header */}
        <div style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #4ade80, #3b82f6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontWeight: 900,
              fontSize: '1.25rem',
              boxShadow: '0 4px 12px rgba(59,130,246,0.3)',
            }}
          >
            N
          </div>
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'white', margin: 0, letterSpacing: '-0.02em' }}>
              NexMarket
            </h1>
            <p style={{ fontSize: '0.75rem', color: '#a5b4fc', margin: 0, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Admin Portal
            </p>
          </div>
        </div>

        {/* Navigation Links */}
        <nav style={{ flex: 1, padding: '1.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto' }}>
          <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem', paddingLeft: '0.75rem' }}>Management</p>
          {adminNavItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.75rem 1rem',
                  borderRadius: '10px',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  textDecoration: 'none',
                  color: isActive ? 'white' : '#c7d2fe',
                  background: isActive ? 'rgba(255,255,255,0.15)' : 'transparent',
                  border: '1px solid',
                  borderColor: isActive ? 'rgba(255,255,255,0.1)' : 'transparent',
                  transition: 'all 0.2s ease',
                  boxShadow: isActive ? '0 4px 12px rgba(0,0,0,0.1)' : 'none'
                }}
              >
                <span style={{ fontSize: '1.1rem' }}>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div style={{ padding: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ background: 'rgba(255,255,255,0.1)', padding: '0.5rem', borderRadius: '8px', display: 'flex', justifyContent: 'center' }}>
            <LanguageSwitcher />
          </div>
          
          <Link
            href="/home"
            style={{ 
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
              padding: '0.75rem', borderRadius: '10px', background: 'white', color: '#1e1b4b',
              fontSize: '0.85rem', fontWeight: 800, textDecoration: 'none',
              boxShadow: '0 4px 12px rgba(0,0,0,0.2)', transition: 'transform 0.2s'
            }}
          >
            <span>📱</span> Agent App
          </Link>
        </div>
      </aside>

      {/* Main Content Area */}
      <main style={{ marginLeft: '280px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        
        {/* Top bar (for spacing and maybe global actions in future) */}
        <header style={{ 
          height: '70px', 
          background: 'rgba(255, 255, 255, 0.8)', 
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid #e2e8f0',
          position: 'sticky',
          top: 0,
          zIndex: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          padding: '0 2rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ textAlign: 'right' }}>
              <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: '#0f172a' }}>Admin User</p>
              <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b' }}>admin@nexmarket.com</p>
            </div>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#e0e7ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#4338ca' }}>
              AD
            </div>
          </div>
        </header>

        <div style={{ padding: '2rem', flex: 1, maxWidth: 1600, width: '100%', margin: '0 auto' }}>
          {children}
        </div>
      </main>
    </div>
  );
}
