'use client';

import { useEffect, useState } from 'react';
import { crm } from '@/lib/sync/api-client';

export type PageKey =
  | 'dashboard' | 'calls' | 'desk' | 'pipeline' | 'partners' | 'whatsapp' | 'field'
  | 'payments' | 'targets' | 'analytics' | 'camps' | 'departments' | 'users';

export interface AccessMe {
  agentId: string;
  role: string;
  isAdmin: boolean;
  isDashboardUser: boolean;
  pages: Record<PageKey, number>; // 0 none, 1 view, 2 edit
}

export const DASHBOARD_ROLES = ['admin', 'marketingmanager', 'hospitalrep'];

export function normalizeRole(role?: string | null): string {
  return (role ?? '').replace(/[\s_]/g, '').toLowerCase().replace('hospitalrepresentative', 'hospitalrep');
}

export function isDashboardRole(role?: string | null): boolean {
  return DASHBOARD_ROLES.includes(normalizeRole(role));
}

export const ROLE_LABELS: Record<string, string> = {
  Admin: 'Admin',
  MarketingManager: 'Marketing manager',
  HospitalRep: 'Hospital representative',
};

let cached: AccessMe | null = null;
let inflight: Promise<AccessMe> | null = null;
const listeners = new Set<(a: AccessMe | null) => void>();

export function loadAccess(force = false): Promise<AccessMe> {
  if (cached && !force) return Promise.resolve(cached);
  if (!inflight) {
    inflight = crm.get<AccessMe>('/api/v1/access/me')
      .then((a) => {
        cached = a;
        listeners.forEach((l) => l(a));
        return a;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export function clearAccess() {
  cached = null;
  listeners.forEach((l) => l(null));
}

/** The signed-in user's page access. `null` while loading. */
export function useAccess(): { access: AccessMe | null; error: string | null } {
  const [access, setAccess] = useState<AccessMe | null>(cached);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    listeners.add(setAccess);
    loadAccess().then(setAccess).catch((e) => setError(e instanceof Error ? e.message : 'Could not load access'));
    return () => { listeners.delete(setAccess); };
  }, []);
  return { access, error };
}

export function canView(a: AccessMe | null, page: PageKey): boolean {
  return !!a && (a.isAdmin || (a.pages?.[page] ?? 0) >= 1);
}

export function canEdit(a: AccessMe | null, page: PageKey): boolean {
  return !!a && (a.isAdmin || (a.pages?.[page] ?? 0) >= 2);
}
