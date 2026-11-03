import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { api, ApiError, OfflineError } from './api';
import { kvGet, kvSet } from './db';

/** The agent's own profile, as the office sees it. */
export interface Profile {
  agentId: string; name: string; firstName?: string | null; middleName?: string | null; lastName?: string | null;
  phone: string; email?: string | null; role: string; district: string; block: string;
  dateOfBirth?: string | null; gender?: string | null; address?: string | null; pincode?: string | null;
  education?: string | null; workExperience?: string | null; emergencyContactName?: string | null; emergencyContactPhone?: string | null;
  photoUrl?: string | null;
}

export type ProfileUpdate = Partial<Pick<Profile, 'firstName' | 'middleName' | 'lastName' | 'email' | 'dateOfBirth' | 'gender' | 'address' | 'pincode'
  | 'education' | 'workExperience' | 'emergencyContactName' | 'emergencyContactPhone' | 'photoUrl'>>;

/** Last copy fetched, so the profile still shows offline. */
export function cachedProfile(): Profile | null {
  try { return JSON.parse(kvGet('profile') ?? 'null') as Profile | null; } catch { return null; }
}
export const myPhotoUrl = () => cachedProfile()?.photoUrl ?? null;

export async function loadProfile(agentId: string): Promise<Profile> {
  const p = await api<Profile>(`/api/v1/agents/${encodeURIComponent(agentId)}`);
  kvSet('profile', JSON.stringify(p));
  return p;
}

/** Saves the agent's own details (needs a connection). Mobile number, role and work area stay with the office. */
export async function saveProfile(agentId: string, patch: ProfileUpdate): Promise<Profile> {
  await api(`/api/v1/agents/${encodeURIComponent(agentId)}/profile`, { method: 'PUT', body: JSON.stringify(patch) });
  return loadProfile(agentId);
}

/** Pick a profile photo (camera or gallery), square-cropped and made small, then upload it; returns its URL. */
export async function pickProfilePhoto(source: 'camera' | 'gallery'): Promise<string | 'denied' | null> {
  // The gallery opens the system photo picker, which needs no permission; the camera does.
  if (source === 'camera' && !(await ImagePicker.requestCameraPermissionsAsync()).granted) return 'denied';
  const opts: ImagePicker.ImagePickerOptions = { quality: 0.85, allowsEditing: true, aspect: [1, 1], mediaTypes: ['images'] };
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync({ ...opts, cameraType: ImagePicker.CameraType.front }) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  const ref = await ImageManipulator.manipulate(a.uri).resize({ width: Math.min(640, a.width || 640) }).renderAsync();
  const out = await ref.saveAsync({ compress: 0.75, format: SaveFormat.JPEG });
  const fd = new FormData();
  fd.append('file', { uri: out.uri, name: 'profile.jpg', type: 'image/jpeg' } as unknown as Blob);
  const r = await api<{ url: string }>('/api/v1/sync/photo', { method: 'POST', body: fd, timeoutMs: 60000 });
  return r.url;
}

export const isOffline = (e: unknown) => e instanceof OfflineError;
export const errorText = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
