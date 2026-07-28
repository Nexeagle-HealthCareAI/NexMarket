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
// referral_new, trajectory_batch, survey), not the coarse local EntityType.
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

export interface AuthResponse {
  token: string;
  refreshToken: string;
  agentId: string;
  name: string;
  role: string;
  deviceId: string; // echoed back from the request — the client owns this id, not the server
  mustChangePassword?: boolean;
  profileCompleted?: boolean;
}

// ─── Admin: Agents ─────────────────────────────────────────────────────────────

export interface AdminAgentDto {
  agentId: string;
  name: string;
  phone: string;
  role: string;
  district: string;
  block: string;
  isActive: boolean;
  status: 'online' | 'low-connectivity' | 'offline';
  activeShift: boolean;
  lastSeenLat: number | null;
  lastSeenLng: number | null;
  lastSeenAt: string | null;
  todayContacts: number;
  todayVisits: number;
  todayReferrals: number;
}

export interface OnboardAgentRequest {
  firstName: string;
  middleName?: string;
  lastName: string;
  phone: string;
  email?: string;
  password: string;
  role: string;
  district: string;
  block: string;
  dateOfBirth?: string; // ISO date
  gender?: string;
  address?: string;
  pincode?: string;
  education?: string;
  workExperience?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  photoUrl?: string;
}

export interface OnboardAgentResponse {
  agentId: string;
  name: string;
  role: string;
  district: string;
  block: string;
  password: string; // shown once
}

export interface TrajectoryPointDto {
  lat: number;
  lng: number;
  recordedAt: string;
  accuracyM: number | null;
}

export interface AgentDetailDto {
  agentId: string;
  name: string;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  phone: string;
  email: string | null;
  role: string;
  district: string;
  block: string;
  isActive: boolean;
  mustChangePassword: boolean;
  profileCompleted: boolean;
  dateOfBirth: string | null;
  age: number | null;
  gender: string | null;
  address: string | null;
  pincode: string | null;
  fullAddress: string | null;
  education: string | null;
  workExperience: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  photoUrl: string | null;
  personalDetails: string | null;
  createdAt: string;
  status: 'online' | 'low-connectivity' | 'offline';
  activeShift: boolean;
  lastSeenLat: number | null;
  lastSeenLng: number | null;
  lastSeenAt: string | null;
}

export interface UpdateAgentProfileRequest {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  email?: string;
  dateOfBirth?: string;
  gender?: string;
  address?: string;
  pincode?: string;
  education?: string;
  workExperience?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  photoUrl?: string;
  personalDetails?: string;
  // Admin-only — ignored by the API unless the caller is an Admin
  role?: string;
  district?: string;
  block?: string;
  isActive?: boolean;
}

// ─── Admin: Duplicates ──────────────────────────────────────────────────────────

export interface DuplicateRecordDto {
  clientId: string;
  name: string;
  role: string;
  phone: string | null;
  agentId: string;
  agentName: string;
  panchayatId: string;
  panchayatName: string;
  whatsappAdded: boolean;
  cardGiven: boolean;
  createdAt: string;
}

export interface DuplicatePairDto {
  id: string;
  recordA: DuplicateRecordDto;
  recordB: DuplicateRecordDto;
  status: 'pending' | 'merged' | 'dismissed';
}

// ─── Admin: Reports ───────────────────────────────────────────────────────────

export interface BlockReportDto {
  district: string;
  block: string;
  agents: number;
  asha: number;
  rmp: number;
  ward: number;
  med: number;
  visits: number;
  referrals: number;
  converted: number;
}

export interface ReportSummaryDto {
  totalContacts: number;
  ashaWorkers: number;
  rmpDoctors: number;
  wardMembers: number;
  medicineShops: number;
  totalVisits: number;
  totalReferrals: number;
  convertedReferrals: number;
  conversionRatePct: number;
  blocks: BlockReportDto[];
}

// ─── Panchayats ───────────────────────────────────────────────────────────────

export interface PanchayatDto {
  id: string;
  lgdCode: string;
  name: string;
  block: string;
  district: string;
  state: string;
  centroidLat: number | null;
  centroidLng: number | null;
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

async function put<TBody, TResponse>(
  path: string,
  body: TBody,
  token: string,
): Promise<TResponse> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${path} → ${res.status}: ${text}`);
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

export async function refreshToken(agentId: string, refresh: string): Promise<AuthResponse> {
  return post<{ agentId: string; refreshToken: string }, AuthResponse>(
    '/api/v1/auth/refresh',
    { agentId, refreshToken: refresh },
  );
}

export async function changePassword(
  token: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ message: string }> {
  return post<{ currentPassword: string; newPassword: string }, { message: string }>(
    '/api/v1/auth/change-password',
    { currentPassword, newPassword },
    token,
  );
}

export async function uploadPhoto(token: string, file: File): Promise<{ url: string; fileName: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/api/v1/sync/photo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });
  if (!res.ok) throw new Error('Failed to upload photo');
  return res.json();
}

export async function updateAgentProfile(
  agentId: string,
  token: string,
  body: UpdateAgentProfileRequest
): Promise<{ success: boolean; profileCompleted: boolean }> {
  return put<UpdateAgentProfileRequest, { success: boolean; profileCompleted: boolean }>(
    `/api/v1/agents/${encodeURIComponent(agentId)}/profile`,
    body,
    token
  );
}

// ─── Admin API ────────────────────────────────────────────────────────────────

export function getAgents(token: string): Promise<AdminAgentDto[]> {
  return get<AdminAgentDto[]>('/api/v1/agents', token);
}

export function getAgentDetail(token: string, agentId: string): Promise<AgentDetailDto> {
  return get<AgentDetailDto>(`/api/v1/agents/${encodeURIComponent(agentId)}`, token);
}

export function onboardAgent(token: string, body: OnboardAgentRequest): Promise<OnboardAgentResponse> {
  return post<OnboardAgentRequest, OnboardAgentResponse>('/api/v1/agents', body, token);
}

export function getAgentTrajectory(token: string, agentId: string, date?: string): Promise<TrajectoryPointDto[]> {
  const qs = date ? `?date=${encodeURIComponent(date)}` : '';
  return get<TrajectoryPointDto[]>(`/api/v1/agents/${encodeURIComponent(agentId)}/trajectory${qs}`, token);
}

export function getDuplicates(token: string): Promise<DuplicatePairDto[]> {
  return get<DuplicatePairDto[]>('/api/v1/duplicates', token);
}

export function mergeDuplicate(token: string, clientId: string): Promise<unknown> {
  return post<Record<string, never>, unknown>(`/api/v1/duplicates/${encodeURIComponent(clientId)}/merge`, {}, token);
}

export function dismissDuplicate(token: string, clientId: string): Promise<unknown> {
  return post<Record<string, never>, unknown>(`/api/v1/duplicates/${encodeURIComponent(clientId)}/dismiss`, {}, token);
}

export function getReportsSummary(token: string, district?: string): Promise<ReportSummaryDto> {
  const qs = district && district !== 'All' ? `?district=${encodeURIComponent(district)}` : '';
  return get<ReportSummaryDto>(`/api/v1/reports/summary${qs}`, token);
}

export function getPanchayats(token: string): Promise<PanchayatDto[]> {
  return get<PanchayatDto[]>('/api/v1/panchayats', token);
}

export interface AdminContactDto {
  clientId: string;
  name: string;
  phone: string | null;
  role: string;
  panchayatId: string;
  agentId: string;
  status: string;
  followUpDate: string | null;
  comments: string | null;
  relation: string | null;
  complaints: string | null;
  conflicts: string | null;
  createdAt: string;
  lastUpdatedAt?: string | null;
  lastUpdatedBy?: string | null;
}

export interface ContactUpdateRequest {
  status?: string;
  followUpDate?: string | null;
  comments?: string;
  relation?: string;
  complaints?: string;
  conflicts?: string;
}

export interface AdminContactsQuery {
  page?: number;
  pageSize?: number;
  districts?: string[];
  blocks?: string[];
  panchayats?: string[];
}

export interface PaginatedContactsResponse {
  items: AdminContactDto[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export function getAdminContacts(token: string, query: AdminContactsQuery = {}): Promise<PaginatedContactsResponse> {
  const params = new URLSearchParams();
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  if (query.districts?.length) params.set('districts', query.districts.join(','));
  if (query.blocks?.length) params.set('blocks', query.blocks.join(','));
  if (query.panchayats?.length) params.set('panchayats', query.panchayats.join(','));
  const qs = params.toString();
  return get<PaginatedContactsResponse>(`/api/v1/admin/contacts${qs ? `?${qs}` : ''}`, token);
}

export function getAdminContact(token: string, clientId: string): Promise<AdminContactDto> {
  return get<AdminContactDto>(`/api/v1/admin/contacts/${encodeURIComponent(clientId)}`, token);
}

export interface ContactHistoryEntryDto {
  id: string;
  timestamp: string;
  updatedBy: string;
  previousStatus: string;
  newStatus: string;
  comments: string | null;
}

export function getContactHistory(token: string, clientId: string): Promise<ContactHistoryEntryDto[]> {
  return get<ContactHistoryEntryDto[]>(`/api/v1/admin/contacts/${encodeURIComponent(clientId)}/history`, token);
}

export function updateAdminContact(
  token: string,
  clientId: string,
  body: ContactUpdateRequest
): Promise<AdminContactDto> {
  return put<ContactUpdateRequest, AdminContactDto>(
    `/api/v1/admin/contacts/${encodeURIComponent(clientId)}`,
    body,
    token
  );
}
