'use client';

import { useEffect, useState } from 'react';
import { crm } from '@/lib/sync/api-client';

export type PageKey =
  | 'dashboard' | 'calls' | 'desk' | 'pipeline' | 'partners' | 'whatsapp' | 'field'
  | 'payments' | 'targets' | 'analytics' | 'camps' | 'social' | 'departments' | 'users' | 'hoardings' | 'work';

export interface AccessMe {
  agentId: string;
  role: string;
  isAdmin: boolean;
  isDashboardUser: boolean;
  /** Runs the platform (an admin of the first organisation): sees the Organisations screen. */
  isPlatformOwner?: boolean;
  /** The organisation's own name. */
  orgName?: string;
  /** True for the first organisation, which keeps the wording it always had. */
  orgFirst?: boolean;
  /** The everyday word for this kind of organisation: hospital, clinic, lab, pharmacy… */
  orgPlace?: string;
  pages: Record<PageKey, number>; // 0 none, 1 view, 2 edit
}

export const DASHBOARD_ROLES = ['admin', 'marketingmanager', 'hospitalrep', 'digitalmarketing'];

export function normalizeRole(role?: string | null): string {
  return (role ?? '').replace(/[\s_]/g, '').toLowerCase().replace('hospitalrepresentative', 'hospitalrep').replace('digitalmarketingspecialist', 'digitalmarketing');
}

export function isDashboardRole(role?: string | null): boolean {
  return DASHBOARD_ROLES.includes(normalizeRole(role));
}

export const ROLE_LABELS: Record<string, string> = {
  Admin: 'Admin',
  MarketingManager: 'Marketing manager',
  HospitalRep: 'Hospital representative',
  DigitalMarketing: 'Digital marketing specialist',
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
        rememberPlace(a.orgPlace);
        listeners.forEach((l) => l(a));
        return a;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/**
 * The organisation's name for the screens. The first organisation keeps its familiar short and full names;
 * every other organisation is shown by the name it signed up with.
 */
export function orgName(form: 'short' | 'full' = 'short'): string {
  if (cached && cached.orgFirst === false && cached.orgName) return cached.orgName;
  if (form === 'full') return cached?.orgName || 'Glisan Akbari SuperSpeciality Hospital';
  return 'Glisan Akbari Hospital';
}

// ─── The organisation's everyday word ("hospital", "clinic", "lab"…) ───────────
// Screens say "the hospital's WhatsApp number"; a lab should read "the lab's WhatsApp number".
// The word comes with sign-in and is kept in this browser, so wording is right from the first screen.

const PLACE_KEY = 'nx_org_place';
const PLACES = ['hospital', 'clinic', 'diagnostic centre', 'lab', 'pharmacy', 'dialysis centre', 'centre'];
let placeWord: string | null = null;

export function rememberPlace(word?: string | null) {
  placeWord = word && PLACES.includes(word) ? word : 'hospital';
  try { localStorage.setItem(PLACE_KEY, placeWord); } catch { /* private window */ }
}

/** "hospital", or this organisation's own word. */
export function place(): string {
  if (placeWord) return placeWord;
  if (typeof window === 'undefined') return 'hospital';
  try { const w = localStorage.getItem(PLACE_KEY); if (w && PLACES.includes(w)) placeWord = w; } catch { /* private window */ }
  return placeWord ?? 'hospital';
}
/** The same word to start a sentence or a label: "Hospital", "Lab". */
export function Place(): string { const w = place(); return w.charAt(0).toUpperCase() + w.slice(1); }
/** More than one: "hospitals", "pharmacies". */
export function places(): string { const w = place(); return w.endsWith('y') ? w.slice(0, -1) + 'ies' : w + 's'; }
/** True when doctors' OPD wording fits (a hospital or a clinic). */
export function hasOpd(): boolean { const w = place(); return w === 'hospital' || w === 'clinic'; }

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

/** Block assignments and tasks for agents: admins, marketing managers, and anyone who can edit the field pages. */
export function canAssignBlocks(a: AccessMe | null): boolean {
  return canEdit(a, 'field') || a?.role === 'MarketingManager';
}
