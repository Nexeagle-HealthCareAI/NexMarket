/**
 * Typed API client — matches the .NET OpenAPI contract.
 *
 * All fetch calls go through here. Components never call fetch() directly.
 * All payloads match the SyncBatchRequest / SyncBatchResponse DTOs on the server.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000';

// ─── Types matching .NET DTOs ─────────────────────────────────────────────────

export type SyncStatus = 'created' | 'already_exists' | 'conflict' | 'error';

// Matches OutboxItemDto on the server — Payload is a JSON *string*, and Type
// must be one of the granular values the handler switches on (shift_start,
// shift_end, visit_checkin, visit_checkout, contact_new, contact_update,
// referral_new, trajectory_batch), not the coarse local EntityType.
export interface SyncItem {
  id: string;
  clientId: string;
  deviceId: string;
  agentId: string;
  type: string;
  payload: string;
  timestamp: string;
}

export interface SyncBatchRequest {
  deviceId: string;
  agentId: string;
  items: SyncItem[];
}

export interface SyncResult {
  clientId: string;
  deviceId: string;
  serverId: string;
  syncedAt: string;
  status: SyncStatus;
  errorMessage?: string;
}

export interface SyncBatchResponse {
  results: SyncResult[];
}

// ─── Sync pull (reinstall recovery) ──────────────────────────────────────────

export interface SyncPullRequest {
  agentId: string;
  deviceId: string;
  since: string; // ISO date — '1970-01-01T00:00:00Z' for full pull
}

export interface SyncPullResponse {
  contacts: unknown[];
  visits: unknown[];
  referrals: unknown[];
  shifts: unknown[];
  panchayats: unknown[];
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface OtpRequestBody {
  phone: string;
}

export interface OtpVerifyBody {
  phone: string;
  otp: string;
}

export interface AuthResponse {
  token: string;
  refreshToken: string;
  agentId: string;
  name: string;
  role: string;
  deviceId: string; // echoed back from the request — the client owns this id, not the server
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function authHeaders(token: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function post<TBody, TResponse>(
  path: string,
  body: TBody,
  token?: string,
): Promise<TResponse> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: token ? authHeaders(token) : { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${path} → ${res.status}: ${text}`);
  }

  return res.json() as Promise<TResponse>;
}

async function get<TResponse>(path: string, token: string): Promise<TResponse> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: authHeaders(token),
  });

  if (!res.ok) {
    throw new Error(`API GET ${path} → ${res.status}`);
  }

  return res.json() as Promise<TResponse>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface LoginRequestBody {
  userId: string;
  password: string;
  deviceId: string;
}

export async function loginWithPassword(
  userId: string,
  pass: string,
  deviceId: string,
): Promise<AuthResponse> {
  return post<LoginRequestBody, AuthResponse>('/api/v1/auth/login', {
    userId,
    password: pass,
    deviceId,
  });
}

export async function syncBatch(
  token: string,
  body: SyncBatchRequest,
): Promise<SyncBatchResponse> {
  return post<SyncBatchRequest, SyncBatchResponse>('/api/v1/sync/batch', body, token);
}

export async function syncPull(
  token: string,
  body: SyncPullRequest,
): Promise<SyncPullResponse> {
  return post<SyncPullRequest, SyncPullResponse>('/api/v1/sync/pull', body, token);
}

export async function refreshToken(token: string, refresh: string): Promise<AuthResponse> {
  return post<{ refreshToken: string }, AuthResponse>(
    '/api/v1/auth/refresh',
    { refreshToken: refresh },
    token,
  );
}
