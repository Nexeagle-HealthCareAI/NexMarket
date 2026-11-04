'use client';

import type { ComponentType, ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export interface PageTab<K extends string = string> {
  key: K;
  label: string;
  /** A number shown next to the label (hidden when 0 or missing). */
  count?: number | null;
  /** Makes the count stand out (something waiting). */
  hot?: boolean;
  icon?: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
}

/**
 * The open tab, kept in the address bar (?tab=…) so a refresh, the back button or a shared link opens the same tab.
 * Other query values on the page are kept. The page must be inside a Suspense boundary (useSearchParams).
 */
export function usePageTab<K extends string>(keys: readonly K[], fallback: K, param = 'tab'): [K, (k: K) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const raw = params.get(param) as K | null;
  const tab = raw && keys.includes(raw) ? raw : fallback;
  const set = (k: K) => {
    const sp = new URLSearchParams(params.toString());
    if (k === fallback) sp.delete(param); else sp.set(param, k);
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  return [tab, set];
}

/** The row of tabs under a page heading. */
export function PageTabs<K extends string>({ tabs, value, onChange, label, children }: {
  tabs: PageTab<K>[]; value: K; onChange: (k: K) => void; label: string; children?: ReactNode;
}) {
  return (
    <div className="pg-tabs-row">
      <nav className="crm-tabs pg-tabs" role="tablist" aria-label={label}>
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} type="button" role="tab" className="crm-tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}>
              {Icon && <Icon size={15} aria-hidden />}
              {t.label}
              {t.count ? <span className={`ld-tab-n${t.hot ? ' is-hot' : ''}`}>{t.count.toLocaleString('en-IN')}</span> : null}
            </button>
          );
        })}
      </nav>
      {children && <div className="pg-tabs-extra">{children}</div>}
    </div>
  );
}
