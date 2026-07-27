/**
 * Admin Mock Data & State Management
 *
 * Provides realistic field data for the Seemanchal region (Katihar, Purnia, Araria, Supaul)
 * for testing and demonstrating the Admin Dashboard before the .NET 8 backend is connected.
 * Merges local Dexie data with simulated field representative data.
 */

import { v4 as uuidv4 } from 'uuid';
import type { LocalContact, LocalVisit, LocalReferral, LocalTrajectoryPoint } from '@/lib/db/schema';

export interface AdminAgent {
  agentId: string;
  name: string;
  role?: string;
  phone: string;
  district: string;
  block: string;
  status: 'online' | 'offline' | 'low-connectivity';
  lastSeenLat: number;
  lastSeenLng: number;
  lastSeenAt: string;
  batteryPct: number;
  activeShift: boolean;
  todayContacts: number;
  todayVisits: number;
  todayReferrals: number;
}

export interface AdminDuplicatePair {
  id: string;
  recordA: {
    clientId: string;
    deviceId?: string;
    name: string;
    role: string;
    phone?: string;
    agentId: string;
    agentName: string;
    panchayatId?: string;
    panchayatName: string;
    whatsappAdded?: boolean;
    cardGiven?: boolean;
    createdAt: string;
  };
  recordB: {
    clientId: string;
    deviceId?: string;
    name: string;
    role: string;
    phone?: string;
    agentId: string;
    agentName: string;
    panchayatId?: string;
    panchayatName: string;
    whatsappAdded?: boolean;
    cardGiven?: boolean;
    createdAt: string;
  };
  reason: string;
  matchScore: number;
  status: 'pending' | 'merged' | 'dismissed';
}

const NOW = new Date();
const TODAY_STR = NOW.toISOString().slice(0, 10);

// Helper to generate timestamps earlier today
function timeToday(hours: number, minutes: number): string {
  const d = new Date(NOW);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

// ─── Simulated Field Representatives ──────────────────────────────────────────

export const MOCK_AGENTS: AdminAgent[] = [];

// ─── Simulated Trajectories for Replay ────────────────────────────────────────

export const MOCK_TRAJECTORIES: Record<string, LocalTrajectoryPoint[]> = {};

// ─── Simulated Duplicate Pairs for Resolution ─────────────────────────────────

export const MOCK_DUPLICATES: AdminDuplicatePair[] = [];

// ─── Simulated Reports Data ───────────────────────────────────────────────────

export interface AdminReportSummary {
  totalContacts: number;
  ashaWorkers: number;
  rmpDoctors: number;
  wardMembers: number;
  medicineShops: number;
  totalVisits: number;
  totalReferrals: number;
  convertedReferrals: number;
  conversionRatePct: number;
}

export const MOCK_REPORT_SUMMARY: AdminReportSummary = {
  totalContacts: 0,
  ashaWorkers: 0,
  rmpDoctors: 0,
  wardMembers: 0,
  medicineShops: 0,
  totalVisits: 0,
  totalReferrals: 0,
  convertedReferrals: 0,
  conversionRatePct: 0,
};

export function addMockAgent(agent: AdminAgent) {
  MOCK_AGENTS.unshift(agent);
}
