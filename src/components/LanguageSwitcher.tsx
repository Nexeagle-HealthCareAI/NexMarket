'use client';

import React from 'react';
import { useRouter } from 'next/navigation';

export default function LanguageSwitcher() {
  const router = useRouter();

  // Helper to get cookie value client-side
  const getCookie = (name: string) => {
    if (typeof document === 'undefined') return 'en';
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? match[2] : 'en';
  };

  const currentLang = getCookie('NEXT_LOCALE');

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const locale = e.target.value;
    document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=31536000`;
    router.refresh(); // Tell Next.js Server Components to re-render
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      <span style={{ fontSize: '1rem' }}>🌐</span>
      <select
        value={currentLang}
        onChange={handleChange}
        style={{
          background: 'var(--surface-input)',
          border: '1px solid var(--surface-border)',
          borderRadius: '4px',
          padding: '0.2rem 0.4rem',
          fontSize: '0.8rem',
          fontWeight: 600,
          color: 'var(--text-primary)',
          cursor: 'pointer',
          outline: 'none',
        }}
      >
        <option value="en">English</option>
        <option value="hi">हिंदी (Hindi)</option>
        <option value="hinglish">Hinglish</option>
      </select>
    </div>
  );
}
