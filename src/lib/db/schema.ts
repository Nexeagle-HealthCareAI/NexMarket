/**
 * Dexie.js local-first schema for Seemanchal Field Outreach
 *
 * Key design decisions:
 * - Composite idempotency key: [clientId, deviceId] — safe for multi-device agents
 * - serverId is set after successful sync; undefined means unsynced
 * - GPS trajectory recorded only during active shifts (DPDP Act compliance)
 * - trajectory_points never pulled back to client on reinstall (too large)
 */

import Dexie, { type EntityTable } from 'dexie';

// ─── Panchayat (seeded from LGD Bihar data) ──────────────────────────────────

export interface LocalPanchayat {
  id: string;           // UUID (server-assigned; seeded)
  lgdCode: string;      // LGD official code
  name: string;
  block: string;
  district: string; // real LGD data spans more districts than any fixed union stays in sync with
  state: string;
  centroidLat?: number;
  centroidLng?: number;
}

// ─── Agent (current logged-in agent profile) ─────────────────────────────────

export interface LocalAgent {
  id: string;           // server UUID
  name: string;
  phone: string;
  role: 'Marketing Executive' | 'Field Officer' | 'Regional Representative' | 'Admin' | string;
  deviceId: string;     // stable device UUID stored in syncState
}

// ─── Shift (GPS on/off bracket — DPDP compliance) ────────────────────────────

export interface LocalShift {
  localId?: number;
  clientId: string;
  deviceId: string;
  serverId?: string;
  agentId: string;
  startAt: string;      // ISO string (client clock)
  endAt?: string;
  syncedAt?: string;
}

// ─── Contact ──────────────────────────────────────────────────────────────────

export type ContactRole = 'asha_worker' | 'rmp_doctor' | 'ward_member' | 'medicine_shop' | 'mukhiya' | 'prominent_person';

export interface LocalContact {
  localId?: number;
  clientId: string;
  deviceId: string;
  serverId?: string;
  panchayatId: string;  // LocalPanchayat.id
  agentId: string;
  name: string;
  role: ContactRole;
  phone?: string;
  whatsappAdded: boolean;
  cardGiven: boolean;
  notes?: string;
  status: 'Lead' | 'Contacted' | 'Interested' | 'Converted' | 'Rejected'; // Added in v2
  followUpDate?: string; // YYYY-MM-DD
  photoDataUri?: string; // Base64 offline photo storage
  lat?: number;
  lng?: number;
  potentialDuplicateOf?: string[];  // server-flagged duplicate serverIds
  createdAt: string;    // ISO string — client clock
  updatedAt: string;
  syncedAt?: string;
}

// ─── Visit ────────────────────────────────────────────────────────────────────

export interface LocalVisit {
  localId?: number;
  clientId: string;
  deviceId: string;
  serverId?: string;
  agentId: string;
  panchayatId: string;
  contactId?: string;   // clientId of related contact
  shiftId?: string;     // clientId of parent shift
  checkInAt: string;
  checkInLat: number;
  checkInLng: number;
  checkOutAt?: string;
  checkOutLat?: number;
  checkOutLng?: number;
  syncedAt?: string;
}

// ─── Trajectory Point ─────────────────────────────────────────────────────────

export interface LocalTrajectoryPoint {
  localId?: number;
  clientId: string;
  deviceId: string;
  serverId?: string;
  agentId: string;
  shiftId?: string;
  visitId?: string;     // clientId of current visit if checked in
  lat: number;
  lng: number;
  accuracyM?: number;
  recordedAt: string;   // ISO string
  syncedAt?: string;
}

// ─── Referral ─────────────────────────────────────────────────────────────────

export type ReferralStatus = 'pending' | 'converted' | 'lost';

export interface LocalReferral {
  localId?: number;
  clientId: string;
  deviceId: string;
  serverId?: string;
  contactId: string;    // clientId of contact
  visitId?: string;     // clientId of visit
  referralDate: string; // YYYY-MM-DD
  status: ReferralStatus;
  notes?: string;
  createdAt: string;
  syncedAt?: string;
}

// ─── Survey Response ──────────────────────────────────────────────────────────

export interface LocalSurveyResponse {
  localId?: number;
  clientId: string;
  deviceId: string;
  serverId?: string;
  agentId: string;
  contactId?: string;
  panchayatId?: string;
  answersJson: string; // The gamified Q&A
  createdAt: string;
  syncedAt?: string;
}

// ─── Sync Outbox ──────────────────────────────────────────────────────────────

export type EntityType =
  | 'shift'
  | 'contact'
  | 'visit'
  | 'trajectory_batch'
  | 'referral'
  | 'survey';

export interface SyncOutboxEntry {
  localId?: number;
  clientId: string;
  deviceId: string;
  entityType: EntityType;
  payload: string;       // JSON serialized entity
  attemptCount: number;
  lastAttemptAt?: string;
  errorMessage?: string;
}

// ─── Sync State (key-value metadata store) ────────────────────────────────────

export interface SyncState {
  key: string;           // e.g. 'deviceId', 'lastPullAt', 'lastSyncAt', 'agentId'
  value: string;
}

// ─── Dexie Database Class ─────────────────────────────────────────────────────

export class NexMarketDB extends Dexie {
  panchayats!: EntityTable<LocalPanchayat, 'id'>;
  agents!: EntityTable<LocalAgent, 'id'>;
  shifts!: EntityTable<LocalShift, 'localId'>;
  contacts!: EntityTable<LocalContact, 'localId'>;
  visits!: EntityTable<LocalVisit, 'localId'>;
  trajectoryPoints!: EntityTable<LocalTrajectoryPoint, 'localId'>;
  referrals!: EntityTable<LocalReferral, 'localId'>;
  surveyResponses!: EntityTable<LocalSurveyResponse, 'localId'>;
  syncOutbox!: EntityTable<SyncOutboxEntry, 'localId'>;
  syncState!: EntityTable<SyncState, 'key'>;

  constructor() {
    super('nexmarket_db');

    this.version(1).stores({
      panchayats: 'id, lgdCode, district, block, name',
      agents: 'id',
      shifts: '++localId, [clientId+deviceId], serverId, agentId, startAt, syncedAt',
      contacts: '++localId, [clientId+deviceId], serverId, panchayatId, agentId, phone, syncedAt',
      visits: '++localId, [clientId+deviceId], serverId, agentId, checkInAt, panchayatId, syncedAt',
      trajectoryPoints: '++localId, [clientId+deviceId], serverId, agentId, shiftId, recordedAt, syncedAt',
      referrals: '++localId, [clientId+deviceId], serverId, contactId, visitId, syncedAt',
      syncOutbox: '++localId, [clientId+deviceId], entityType, attemptCount',
      syncState: 'key',
    });

    this.version(2).stores({
      contacts: '++localId, [clientId+deviceId], serverId, panchayatId, agentId, phone, status, followUpDate, syncedAt',
    }).upgrade(tx => {
      return tx.table('contacts').toCollection().modify(contact => {
        if (!contact.status) contact.status = 'Lead';
      });
    });

    this.version(3).stores({
      surveyResponses: '++localId, [clientId+deviceId], serverId, agentId, contactId, panchayatId, syncedAt',
    });
  }
}

export const db = new NexMarketDB();
