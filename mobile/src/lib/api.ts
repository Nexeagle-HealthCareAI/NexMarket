import * as SecureStore from 'expo-secure-store';
import { API_URL } from './config';

/**
 * Talks to the NexMarket API. Tokens live in the phone's secure keystore, never in
 * SQLite. `X-Client: mobile` makes the API return tokens in the body (the web app
 * uses httpOnly cookies instead).
 */
const K_ACCESS = 'nx_access';
const K_REFRESH = 'nx_refresh';
const K_AGENT = 'nx_agent';
const K_DEVICE = 'nx_device';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export class OfflineError extends Error {}

let access: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSignedOut: (() => void) | null = null;

export function setSignedOutHandler(fn: (() => void) | null) {
  onSignedOut = fn;
}

export async function loadTokens(): Promise<{ agentId: string | null; deviceId: string | null }> {
  access = await SecureStore.getItemAsync(K_ACCESS);
  return { agentId: await SecureStore.getItemAsync(K_AGENT), deviceId: await SecureStore.getItemAsync(K_DEVICE) };
}

/** One id per installation, kept across logins so the server can sign out a lost phone. */
export async function ensureDeviceId(make: () => string): Promise<string> {
  let id = await SecureStore.getItemAsync(K_DEVICE);
  if (!id) {
    id = make();
    await SecureStore.setItemAsync(K_DEVICE, id);
  }
  return id;
}

async function saveTokens(a: string | undefined, r: string | undefined) {
  if (a) { access = a; await SecureStore.setItemAsync(K_ACCESS, a); }
  if (r) await SecureStore.setItemAsync(K_REFRESH, r);
}

export async function clearTokens() {
  access = null;
  await SecureStore.deleteItemAsync(K_ACCESS);
  await SecureStore.deleteItemAsync(K_REFRESH);
  await SecureStore.deleteItemAsync(K_AGENT);
}

async function raw(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 30000);
  try {
    return await fetch(`${API_URL}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'X-Client': 'mobile',
        ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(access ? { Authorization: `Bearer ${access}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch (e) {
    throw new OfflineError(e instanceof Error ? e.message : 'Network error');
  } finally {
    clearTimeout(timer);
  }
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  if (!text) return `HTTP ${res.status}`;
  try {
    const j = JSON.parse(text);
    if (typeof j === 'string') return j;
    return j.message ?? j.title ?? text;
  } catch {
    return text.replace(/^"|"$/g, '');
  }
}

async function refresh(): Promise<boolean> {
  const agentId = await SecureStore.getItemAsync(K_AGENT);
  const deviceId = await SecureStore.getItemAsync(K_DEVICE);
  const refreshToken = await SecureStore.getItemAsync(K_REFRESH);
  if (!agentId || !deviceId || !refreshToken) return false;
  const res = await raw('/api/v1/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ agentId, deviceId, refreshToken }),
    headers: { Authorization: '' },
  });
  if (!res.ok) return false;
  const j = (await res.json()) as { accessToken?: string; refreshToken?: string };
  if (!j.accessToken) return false;
  await saveTokens(j.accessToken, j.refreshToken);
  return true;
}

export async function api<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  let res = await raw(path, init);
  if (res.status === 401) {
    refreshing ??= refresh().finally(() => { refreshing = null; });
    const ok = await refreshing;
    if (!ok) {
      onSignedOut?.();
      throw new ApiError(401, 'Signed out');
    }
    res = await raw(path, init);
  }
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body?: unknown, timeoutMs?: number) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}), timeoutMs });

export interface LoginResult {
  agentId: string;
  name: string;
  role: string;
  district: string;
  block: string;
  deviceId: string;
  profileCompleted: boolean;
  mustChangePassword: boolean;
  accessToken?: string;
  refreshToken?: string;
}

// The one-time password an admin gave, kept in memory only until the agent sets their own.
let pending: string | null = null;
export const pendingPasswordChange = () => pending;
export const clearPendingPasswordChange = () => { pending = null; };

export async function login(userId: string, password: string, deviceId: string): Promise<LoginResult> {
  const res = await raw('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ userId: userId.trim(), password, deviceId }),
  });
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  const j = (await res.json()) as LoginResult;
  if (!j.accessToken) {
    // An API without mobile token support would only set cookies, which a phone can't use.
    throw new ApiError(500, 'The server did not return a mobile session. Update the API.');
  }
  pending = j.mustChangePassword ? password : null;
  await saveTokens(j.accessToken, j.refreshToken);
  await SecureStore.setItemAsync(K_AGENT, j.agentId);
  await SecureStore.setItemAsync(K_DEVICE, j.deviceId || deviceId);
  return j;
}

export async function logoutRemote() {
  const refreshToken = await SecureStore.getItemAsync(K_REFRESH);
  try {
    await raw('/api/v1/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }), timeoutMs: 8000 });
  } catch { /* best effort */ }
}
