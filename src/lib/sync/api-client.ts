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

// Auth is entirely cookie-based now (httpOnly cookies set by AuthController) —
// every request just needs the browser to attach them, which `credentials:
// 'include'` does automatically. This also works from the service worker's
// fetch context, since cookies are origin-scoped, not tied to which JS
// context issued the request.
const JSON_HEADERS: HeadersInit = { 'Content-Type': 'application/json' };

async function post<TBody, TResponse>(path: string, body: TBody): Promise<TResponse> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${path} → ${res.status}: ${text}`);
  }

  return res.json() as Promise<TResponse>;
}

async function get<TResponse>(path: string): Promise<TResponse> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
  });

  if (!res.ok) {
    throw new Error(`API GET ${path} → ${res.status}`);
  }

  return res.json() as Promise<TResponse>;
}

async function put<TBody, TResponse>(path: string, body: TBody): Promise<TResponse> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${path} → ${res.status}: ${text}`);
  }

  return res.json() as Promise<TResponse>;
}

async function patch<TBody, TResponse>(path: string, body: TBody): Promise<TResponse> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${path} → ${res.status}: ${text}`);
  }

  return res.json() as Promise<TResponse>;
}

async function del<TResponse>(path: string): Promise<TResponse> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    credentials: 'include',
  });

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
  });
}

export async function syncBatch(body: SyncBatchRequest): Promise<SyncBatchResponse> {
  return post<SyncBatchRequest, SyncBatchResponse>('/api/v1/sync/batch', body);
}

export async function syncPull(body: SyncPullRequest): Promise<SyncPullResponse> {
  return post<SyncPullRequest, SyncPullResponse>('/api/v1/sync/pull', body);
}

export async function refreshToken(agentId: string, deviceId: string): Promise<AuthResponse> {
  return post<{ agentId: string; deviceId: string }, AuthResponse>(
    '/api/v1/auth/refresh',
    { agentId, deviceId },
  );
}

export async function logout(): Promise<{ message: string }> {
  return post<Record<string, never>, { message: string }>('/api/v1/auth/logout', {});
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

export async function uploadPhoto(file: File): Promise<{ url: string; fileName: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/api/v1/sync/photo`, {
    method: 'POST',
    credentials: 'include',
    body: formData
  });
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

// ─── Admin API ────────────────────────────────────────────────────────────────

export function getAgents(): Promise<AdminAgentDto[]> {
  return get<AdminAgentDto[]>('/api/v1/agents');
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

export function getDuplicates(): Promise<DuplicatePairDto[]> {
  return get<DuplicatePairDto[]>('/api/v1/duplicates');
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
  statuses?: string[];
  startDate?: string;
  endDate?: string;
  maxFollowUpDate?: string;
  updatedAfter?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
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
  if (query.sortBy) params.set('sortBy', query.sortBy);
  if (query.sortOrder) params.set('sortOrder', query.sortOrder);
  const qs = params.toString();
  return get<PaginatedContactsResponse>(`/api/v1/admin/contacts${qs ? `?${qs}` : ''}`);
}

export function deleteAdminSurveyResponse(id: string): Promise<void> {
  return del<void>(`/api/v1/admin/surveys/${encodeURIComponent(id)}`);
}

// ─── Admin Survey Questions ──────────────────────────────────────────────

export interface SurveyQuestionDto {
  id: string;
  questionId: string;
  text: string;
  type: 'single' | 'multi' | 'text';
  optionsJson?: string | null;
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

// ─── Admin: Surveys ─────────────────────────────────────────────────────────────

export interface AdminSurveyDto {
  id: string;
  clientId: string;
  agentId: string;
  agentName?: string;
  contactId: string;
  contactName?: string;
  contactPhone?: string;
  panchayatId: string;
  locationName?: string;
  answersJson: string;
  createdAt: string;
  syncedAt: string;
}

export function getAdminSurveys(): Promise<AdminSurveyDto[]> {
  return get<AdminSurveyDto[]>('/api/v1/admin/surveys');
}
