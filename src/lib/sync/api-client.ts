/**
 * Typed API client — matches the .NET OpenAPI contract.
 *
 * All fetch calls go through here. Components never call fetch() directly.
 * All payloads match the SyncBatchRequest / SyncBatchResponse DTOs on the server.
 */

import { getSyncStateValue } from '../db';

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
  page?: number;
  pageSize?: number;
}

export interface SyncPullResponse {
  hasMore: boolean;
  contacts: unknown[];
  visits: unknown[];
  referrals: unknown[];
  shifts: unknown[];
  panchayats: unknown[];
  surveys: unknown[];
  surveyQuestions: SurveyQuestionDto[];
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthResponse {
  // No token/refreshToken fields — both are set server-side as httpOnly
  // cookies (see AuthController.SetAuthCookies) and never touch client JS.
  agentId: string;
  name: string;
  role: string;
  district?: string;
  block?: string;
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
  mukhiya: number;
  prominent: number;
  lab: number;
  nursingHome: number;
  independentDoctor: number;
  hospital: number;
  other: number;
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
  mukhiyas: number;
  prominentPersons: number;
  labs: number;
  nursingHomes: number;
  independentDoctors: number;
  hospitals: number;
  others: number;
  totalVisits: number;
  totalReferrals: number;
  convertedReferrals: number;
  conversionRatePct: number;
  blocks: BlockReportDto[];
}

export interface SyncHourlyBucketDto {
  hour: string;
  contacts: number;
  visits: number;
  referrals: number;
  avgDelayMinutes: number;
}

export interface SyncAnalyticsDto {
  recordsSyncedToday: number;
  activeOfficersToday: number;
  avgSyncDelayMinutesToday: number;
  recordsSyncedThisWeek: number;
  hourlyBreakdown: SyncHourlyBucketDto[];
}

export function getSyncAnalytics(): Promise<SyncAnalyticsDto> {
  return get<SyncAnalyticsDto>('/api/v1/sync/analytics');
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
  isActiveForMarketing: boolean;
  createdAt?: string;
  createdBy?: string;
}

export interface CoveredPanchayatDto {
  id: string;
  name: string;
  block: string;
  district: string;
  contactCount: number;
  coveredByAgents: string[];
}

export interface UpdatePanchayatRequest {
  name: string;
  district: string;
  block: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Auth is entirely cookie-based now (httpOnly cookies set by AuthController) —
// every request just needs the browser to attach them, which `credentials:
// 'include'` does automatically. This also works from the service worker's
// fetch context, since cookies are origin-scoped, not tied to which JS
// context issued the request.
const JSON_HEADERS: HeadersInit = { 'Content-Type': 'application/json' };

// Fired when a 401 survives a refresh attempt — i.e. the session is truly
// gone, not just a stale access token. Registered once by the app shell
// (agent/admin layouts) to clear local state and bounce to /login, since
// api-client.ts has no router access of its own.
let sessionExpiredHandler: (() => void) | null = null;
export function setSessionExpiredHandler(handler: (() => void) | null): void {
  sessionExpiredHandler = handler;
}

// The access-token cookie expires (12h by default) with nothing to renew it —
// every previously-authenticated request would otherwise start failing with
// 401 mid-session (admin dashboards silently going stale, agents' outbox
// sync silently failing) until the user manually logs in again. Concurrent
// 401s share one in-flight refresh instead of each firing their own.
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const agentId = await getSyncStateValue('agentId');
        const deviceId = await getSyncStateValue('deviceId');
        if (!agentId || !deviceId) return false;

        const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: JSON_HEADERS,
          credentials: 'include',
          body: JSON.stringify({ agentId, deviceId }),
        });
        return res.ok;
      } catch {
        return false;
      }
    })();
  }

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

// Every request helper routes through here so the 401 → refresh → retry-once
// logic lives in exactly one place. `isAuthEndpoint` skips that dance for
// login/refresh/logout themselves — a 401 from /auth/login is a wrong
// password, not an expired session, and retrying /auth/refresh on its own
// 401 would just recurse forever.
async function doFetch(path: string, init: RequestInit, isAuthEndpoint = false): Promise<Response> {
  let res = await fetch(`${API_BASE}${path}`, { ...init, credentials: 'include' });

  if (res.status === 401 && !isAuthEndpoint) {
    const refreshed = await refreshSession();
    if (refreshed) {
      res = await fetch(`${API_BASE}${path}`, { ...init, credentials: 'include' });
    } else {
      sessionExpiredHandler?.();
    }
  }

  return res;
}

async function post<TBody, TResponse>(path: string, body: TBody, isAuthEndpoint = false): Promise<TResponse> {
  const res = await doFetch(path, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }, isAuthEndpoint);

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${path} → ${res.status}: ${text}`);
  }

  return res.json() as Promise<TResponse>;
}

async function get<TResponse>(path: string): Promise<TResponse> {
  const res = await doFetch(path, {});

  if (!res.ok) {
    throw new Error(`API GET ${path} → ${res.status}`);
  }

  return res.json() as Promise<TResponse>;
}

async function put<TBody, TResponse>(path: string, body: TBody): Promise<TResponse> {
  const res = await doFetch(path, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(body) });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${path} → ${res.status}: ${text}`);
  }

  return res.json() as Promise<TResponse>;
}

async function patch<TBody, TResponse>(path: string, body: TBody): Promise<TResponse> {
  const res = await doFetch(path, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(body) });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${path} → ${res.status}: ${text}`);
  }

  return res.json() as Promise<TResponse>;
}

async function del<TResponse>(path: string): Promise<TResponse> {
  const res = await doFetch(path, { method: 'DELETE' });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${path} → ${res.status}: ${text}`);
  }

  // Delete endpoints commonly return 204 No Content — guard against an empty body.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as TResponse;
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
  }, true);
}

export async function syncBatch(body: SyncBatchRequest): Promise<SyncBatchResponse> {
  return post<SyncBatchRequest, SyncBatchResponse>('/api/v1/sync/batch', body);
}

export async function syncPull(body: SyncPullRequest): Promise<SyncPullResponse> {
  return post<SyncPullRequest, SyncPullResponse>('/api/v1/sync/pull', body);
}

export interface ReferenceDataResponse {
  panchayats: PanchayatDto[];
  surveyQuestions: SurveyQuestionDto[];
}

// Panchayats + the active questionnaire — reference data every device needs to
// stay current. Unlike syncPull (reinstall recovery, only ever called once),
// this is cheap enough to call on every login and periodically while the app
// is open, so admin-side changes (new panchayat, edited/deactivated question)
// actually reach devices that were already set up.
export async function getReferenceData(): Promise<ReferenceDataResponse> {
  return get<ReferenceDataResponse>('/api/v1/sync/reference-data');
}

export async function refreshToken(agentId: string, deviceId: string): Promise<AuthResponse> {
  return post<{ agentId: string; deviceId: string }, AuthResponse>(
    '/api/v1/auth/refresh',
    { agentId, deviceId },
    true,
  );
}

export async function logout(): Promise<{ message: string }> {
  return post<Record<string, never>, { message: string }>('/api/v1/auth/logout', {}, true);
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ message: string }> {
  return post<{ currentPassword: string; newPassword: string }, { message: string }>(
    '/api/v1/auth/change-password',
    { currentPassword, newPassword },
  );
}

export async function uploadPhoto(file: File | Blob, fileName = 'photo.jpg'): Promise<{ url: string; fileName: string }> {
  const formData = new FormData();
  formData.append('file', file, file instanceof File ? file.name : fileName);
  const res = await doFetch('/api/v1/sync/photo', { method: 'POST', body: formData });
  if (!res.ok) throw new Error('Failed to upload photo');
  return res.json();
}
export async function updateAgentProfile(
  agentId: string,
  body: UpdateAgentProfileRequest
): Promise<{ success: boolean; profileCompleted: boolean }> {
  return put<UpdateAgentProfileRequest, { success: boolean; profileCompleted: boolean }>(
    `/api/v1/agents/${encodeURIComponent(agentId)}/profile`,
    body,
  );
}

export async function resetAgentPassword(userId: string, newPassword: string): Promise<{ message: string }> {
  return patch<{ userId: string; password: string }, { message: string }>(
    `/api/v1/auth/user/password?scope=reset-password`,
    { userId, password: newPassword }
  );
}

// ─── Admin: Hospital CRM ───────────────────────────────────────────────────────

export interface HospitalReferralDto {
  id: string;
  clientId: string;
  contactId: string;
  contactName: string;
  agentId: string;
  agentName: string;
  patientName: string;
  department: string;
  notes?: string;
  clientPhone?: string;
  referralDate?: string;
  status: 'pending' | 'converted' | 'lost';
  createdAt: string;
}

export interface UpdateReferralStatusDto {
  status: 'pending' | 'converted' | 'lost';
  notes?: string;
}

export async function getHospitalReferrals(
  status?: string,
  page = 1,
  pageSize = 50,
  searchQuery?: string
): Promise<{ totalCount: number; items: HospitalReferralDto[] }> {
  const params = new URLSearchParams();
  if (status) params.append('status', status);
  params.append('page', page.toString());
  params.append('pageSize', pageSize.toString());
  if (searchQuery) params.append('search', searchQuery);
  
  return get<{ totalCount: number; items: HospitalReferralDto[] }>(`/api/v1/referrals?${params.toString()}`);
}

export async function updateReferralStatus(clientId: string, dto: UpdateReferralStatusDto): Promise<{ message: string }> {
  return put<UpdateReferralStatusDto, { message: string }>(`/api/v1/referrals/${encodeURIComponent(clientId)}/status`, dto);
}

// ─── Admin API ────────────────────────────────────────────────────────────────

export function getAgents(
  page = 1,
  pageSize = 50,
  searchQuery?: string,
  statusFilter?: string
): Promise<{ totalCount: number; items: AdminAgentDto[] }> {
  const params = new URLSearchParams();
  params.append('page', page.toString());
  params.append('pageSize', pageSize.toString());
  if (searchQuery) params.append('search', searchQuery);
  if (statusFilter) params.append('statusFilter', statusFilter);
  
  return get<{ totalCount: number; items: AdminAgentDto[] }>(`/api/v1/agents?${params.toString()}`);
}

export function getAgentDetail(agentId: string): Promise<AgentDetailDto> {
  return get<AgentDetailDto>(`/api/v1/agents/${encodeURIComponent(agentId)}`);
}

export function onboardAgent(body: OnboardAgentRequest): Promise<OnboardAgentResponse> {
  return post<OnboardAgentRequest, OnboardAgentResponse>('/api/v1/agents', body);
}

export function getAgentTrajectory(agentId: string, date?: string): Promise<TrajectoryPointDto[]> {
  const qs = date ? `?date=${encodeURIComponent(date)}` : '';
  return get<TrajectoryPointDto[]>(`/api/v1/agents/${encodeURIComponent(agentId)}/trajectory${qs}`);
}

export function getDuplicates(
  status?: string,
  page = 1,
  pageSize = 50
): Promise<{ totalCount: number; items: DuplicatePairDto[] }> {
  const params = new URLSearchParams();
  if (status) params.append('status', status);
  params.append('page', page.toString());
  params.append('pageSize', pageSize.toString());

  return get<{ totalCount: number; items: DuplicatePairDto[] }>(`/api/v1/duplicates?${params.toString()}`);
}

export function mergeDuplicate(clientId: string): Promise<unknown> {
  return post<Record<string, never>, unknown>(`/api/v1/duplicates/${encodeURIComponent(clientId)}/merge`, {});
}

export function dismissDuplicate(clientId: string): Promise<unknown> {
  return post<Record<string, never>, unknown>(`/api/v1/duplicates/${encodeURIComponent(clientId)}/dismiss`, {});
}

export function getReportsSummary(district?: string): Promise<ReportSummaryDto> {
  const qs = district && district !== 'All' ? `?district=${encodeURIComponent(district)}` : '';
  return get<ReportSummaryDto>(`/api/v1/reports/summary${qs}`);
}

export function getPanchayats(): Promise<PanchayatDto[]> {
  return get<PanchayatDto[]>('/api/v1/panchayats');
}

export function getCoveredPanchayats(): Promise<CoveredPanchayatDto[]> {
  return get<CoveredPanchayatDto[]>('/api/v1/panchayats/covered');
}

// ─── Routing ────────────────────────────────────────────────────────────────

export interface DirectionsDto {
  distanceMeters: number;
  durationSeconds: number;
  /** [lng, lat] pairs, GeoJSON order — feeds a MapLibre LineString source directly. */
  geometry: [number, number][];
}

export async function getDirections(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<DirectionsDto> {
  const qs = `fromLat=${from.lat}&fromLng=${from.lng}&toLat=${to.lat}&toLng=${to.lng}`;
  return get<DirectionsDto>(`/api/v1/routing/directions?${qs}`);
}

export interface CreatePanchayatRequest {
  name: string;
  district: string;
  block: string;
  centroidLat?: number;
  centroidLng?: number;
}

// Admin-only, always-online create — agents get an offline-capable equivalent
// via the sync outbox (see addToOutbox with entityType 'panchayat').
export function createPanchayat(body: CreatePanchayatRequest): Promise<PanchayatDto> {
  return post<CreatePanchayatRequest, PanchayatDto>('/api/v1/panchayats', body);
}

export function updatePanchayat(id: string, body: UpdatePanchayatRequest): Promise<PanchayatDto> {
  return put<UpdatePanchayatRequest, PanchayatDto>(`/api/v1/panchayats/${id}`, body);
}

export function deletePanchayat(id: string): Promise<void> {
  return del(`/api/v1/panchayats/${id}`);
}

export interface UpdatePanchayatMarketingStatusRequest {
  panchayatIds: string[];
  isActive: boolean;
}

// Powers "Manage Panchayat" — only active-for-marketing panchayats are
// included when an agent's block assignment is built (AssignmentsController).
export function updatePanchayatMarketingStatus(body: UpdatePanchayatMarketingStatusRequest): Promise<{ updated: number }> {
  return patch<UpdatePanchayatMarketingStatusRequest, { updated: number }>('/api/v1/panchayats/marketing-status', body);
}

// ─── Admin: Block Assignments ──────────────────────────────────────────────────

export interface AssignmentSummaryDto {
  id: string;
  agentId: string;
  agentName: string;
  district: string;
  block: string;
  status: 'Active' | 'Completed' | 'Cancelled';
  notes: string | null;
  assignedAt: string;
  completedAt: string | null;
  totalPanchayats: number;
  visitedPanchayats: number;
}

export interface CreateAssignmentRequest {
  agentId: string;
  district: string;
  block: string;
  notes?: string;
}

export interface AssignmentPanchayatDto {
  panchayatId: string;
  name: string;
  visited: boolean;
  lastVisitedAt: string | null;
  centroidLat: number | null;
  centroidLng: number | null;
}

export interface MyAssignmentDto {
  assignmentId: string | null;
  district: string | null;
  block: string | null;
  assignedAt: string | null;
  notes: string | null;
  panchayats: AssignmentPanchayatDto[];
}

export function getAssignments(): Promise<AssignmentSummaryDto[]> {
  return get<AssignmentSummaryDto[]>('/api/v1/assignments');
}

export function createAssignment(body: CreateAssignmentRequest): Promise<AssignmentSummaryDto> {
  return post<CreateAssignmentRequest, AssignmentSummaryDto>('/api/v1/assignments', body);
}

export function updateAssignmentStatus(
  id: string,
  status: 'Active' | 'Completed' | 'Cancelled'
): Promise<{ success: boolean }> {
  return patch<{ status: string }, { success: boolean }>(`/api/v1/assignments/${encodeURIComponent(id)}`, { status });
}

export function getMyAssignment(): Promise<MyAssignmentDto> {
  return get<MyAssignmentDto>('/api/v1/assignments/mine');
}

export interface AdminContactDto {
  clientId: string;
  name: string;
  phone: string | null;
  role: string;
  profession?: string | null;
  panchayatId: string;
  agentId: string;
  agentName?: string;
  latitude?: number;
  longitude?: number;
  status: string;
  followUpDate: string | null;
  comments: string | null;
  relation: string | null;
  complaints: string | null;
  conflicts: string | null;
  createdAt: string;
  lastUpdatedAt?: string | null;
  lastUpdatedBy?: string | null;
  photoUrl?: string | null;
  whatsappAdded?: boolean;
  cardGiven?: boolean;
  agentEscalated?: boolean;
  agentEscalationNote?: string | null;
  isEscalationResolved?: boolean;
  agentEscalationResolution?: string | null;
  documents?: { id: string, url: string, mimeType: string, label: string | null, createdAt: string }[];
}

export interface ContactUpdateRequest {
  status?: string;
  followUpDate?: string | null;
  clearFollowUpDate?: boolean; // explicit opt-in to clear — omitting followUpDate no longer clears it
  comments?: string;
  relation?: string;
  complaints?: string;
  conflicts?: string;
  photoUrl?: string | null;
  name?: string;
  phone?: string;
  panchayatId?: string;
  agentEscalationResolved?: boolean;
  agentEscalationResolution?: string | null;
  agentEscalated?: boolean;
  agentEscalationNote?: string | null;
}

export interface AdminContactsQuery {
  page?: number;
  pageSize?: number;
  districts?: string[];
  blocks?: string[];
  panchayats?: string[];
  statuses?: string[];
  startDate?: string;
  endDate?: string;
  maxFollowUpDate?: string;
  updatedAfter?: string;
  agentEscalated?: boolean;
  searchQuery?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  exactPanchayatId?: string;
}

export interface PaginatedContactsResponse {
  items: AdminContactDto[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export function getAdminContacts(query: AdminContactsQuery = {}): Promise<PaginatedContactsResponse> {
  const params = new URLSearchParams();
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  if (query.districts?.length) params.set('districts', query.districts.join(','));
  if (query.blocks?.length) params.set('blocks', query.blocks.join(','));
  if (query.panchayats?.length) params.set('panchayats', query.panchayats.join(','));
  if (query.statuses?.length) params.set('statuses', query.statuses.join(','));
  if (query.startDate) params.set('startDate', query.startDate);
  if (query.endDate) params.set('endDate', query.endDate);
  if (query.maxFollowUpDate) params.set('maxFollowUpDate', query.maxFollowUpDate);
  if (query.updatedAfter) params.set('updatedAfter', query.updatedAfter);
  if (query.agentEscalated) params.set('agentEscalated', 'true');
  if (query.searchQuery) params.set('search', query.searchQuery);
  if (query.sortBy) params.set('sortBy', query.sortBy);
  if (query.sortOrder) params.set('sortOrder', query.sortOrder);
  if (query.exactPanchayatId) params.set('exactPanchayatId', query.exactPanchayatId);
  const qs = params.toString();
  return get<PaginatedContactsResponse>(`/api/v1/admin/contacts${qs ? `?${qs}` : ''}`);
}

export function deleteAdminSurveyResponse(id: string): Promise<void> {
  return del<void>(`/api/v1/admin/surveys/${encodeURIComponent(id)}`);
}

export function updateAdminSurveyResponse(id: string, answersJson: string): Promise<AdminSurveyDto> {
  return put<any, AdminSurveyDto>(
    `/api/v1/admin/surveys/${encodeURIComponent(id)}`,
    { answersJson }
  );
}

// ─── Admin Survey Questions ──────────────────────────────────────────────

export interface SurveyQuestionDto {
  id: string;           // Guid
  questionId: string;   // e.g. "q1"
  text: string;
  type: string;         // 'single' | 'multi' | 'text'
  optionsJson?: string;
  section?: string;     // Group/Tab the question belongs to
  isOptional: boolean;
  isActive: boolean;
  order: number;
}

export function getAdminSurveyQuestions(): Promise<SurveyQuestionDto[]> {
  return get<SurveyQuestionDto[]>('/api/v1/admin/questions');
}

export function createAdminSurveyQuestion(data: Omit<SurveyQuestionDto, 'id'>): Promise<SurveyQuestionDto> {
  const body = {
    ...data,
    options: data.optionsJson ? JSON.parse(data.optionsJson) : null
  };
  return post<typeof body, SurveyQuestionDto>('/api/v1/admin/questions', body);
}

export function updateAdminSurveyQuestion(id: string, data: Omit<SurveyQuestionDto, 'id'>): Promise<SurveyQuestionDto> {
  const body = {
    ...data,
    options: data.optionsJson ? JSON.parse(data.optionsJson) : null
  };
  return put<typeof body, SurveyQuestionDto>(`/api/v1/admin/questions/${encodeURIComponent(id)}`, body);
}

export function deleteAdminSurveyQuestion(id: string): Promise<void> {
  return del<void>(`/api/v1/admin/questions/${encodeURIComponent(id)}`);
}

export function getAdminContact(clientId: string): Promise<AdminContactDto> {
  return get<AdminContactDto>(`/api/v1/admin/contacts/${encodeURIComponent(clientId)}`);
}

export interface ContactHistoryEntryDto {
  id: string;
  timestamp: string;
  updatedBy: string;
  previousStatus: string;
  newStatus: string;
  comments: string | null;
  followUpDate?: string | null;
  complaints?: string | null;
  conflicts?: string | null;
}

export function getContactHistory(clientId: string): Promise<ContactHistoryEntryDto[]> {
  return get<ContactHistoryEntryDto[]>(`/api/v1/admin/contacts/${encodeURIComponent(clientId)}/history`);
}

export function updateAdminContact(
  clientId: string,
  body: ContactUpdateRequest
): Promise<AdminContactDto> {
  return put<ContactUpdateRequest, AdminContactDto>(
    `/api/v1/admin/contacts/${encodeURIComponent(clientId)}`,
    body,
  );
}

export function deleteAdminContact(clientId: string): Promise<void> {
  return del<void>(`/api/v1/admin/contacts/${encodeURIComponent(clientId)}`);
}

// ─── Admin: Surveys ─────────────────────────────────────────────────────────────

export interface AdminSurveyDto {
  id: string;
  clientId: string;
  agentId: string;
  agentName?: string;
  contactId: string;
  contactName?: string;
  contactPhone?: string;
  contactRole?: string | null;
  panchayatId: string;
  locationName?: string;
  district?: string | null;
  block?: string | null;
  answersJson: string;
  createdAt: string;
  syncedAt: string;
}

export function getAdminSurveys(): Promise<AdminSurveyDto[]> {
  return get<AdminSurveyDto[]>('/api/v1/admin/surveys');
}
