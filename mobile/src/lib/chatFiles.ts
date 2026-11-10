import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { accessToken } from './api';
import { API_URL } from './config';
import type { ChatMsg } from './chat';

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export interface Picked { uri: string; name: string; mime: string; size?: number | null }

/** Photos are shrunk (1600 px, JPEG) so they send quickly on a weak signal. */
async function shrink(uri: string, width?: number): Promise<Picked> {
  const ref = await ImageManipulator.manipulate(uri).resize({ width: Math.min(1600, width || 1600) }).renderAsync();
  const out = await ref.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
  return { uri: out.uri, name: `photo-${Date.now()}.jpg`, mime: 'image/jpeg', size: null };
}

export async function pickCamera(): Promise<Picked | 'denied' | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return 'denied';
  const r = await ImagePicker.launchCameraAsync({ quality: 0.8, mediaTypes: ['images'] });
  if (r.canceled || !r.assets?.length) return null;
  return shrink(r.assets[0].uri, r.assets[0].width);
}

export async function pickGallery(): Promise<Picked | 'denied' | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return 'denied';
  const r = await ImagePicker.launchImageLibraryAsync({ quality: 0.8, mediaTypes: ['images'] });
  if (r.canceled || !r.assets?.length) return null;
  return shrink(r.assets[0].uri, r.assets[0].width);
}

/** What the server accepts: extension → type (keep in step with ChatController.Allowed). */
const ALLOWED: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', gif: 'image/gif',
  pdf: 'application/pdf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv', txt: 'text/plain',
};
const EXT_OF: Record<string, string> = { ...Object.fromEntries(Object.entries(ALLOWED).map(([e, m]) => [m, e])), 'image/jpeg': 'jpg', 'image/heif': 'heic', 'application/csv': 'csv', 'text/comma-separated-values': 'csv' };
const DOC_TYPES = [...new Set(Object.values(ALLOWED))];

/** Size of a file on the phone, or null if it can't be read. */
export function fileSize(uri: string): number | null {
  try { const f = new File(uri); return f.exists ? f.size : null; } catch { return null; }
}
/** Whether a file the phone kept (a photo we sent, a queued upload) is still there; the OS can clear the cache. */
export function localFileExists(uri: string): boolean {
  if (!uri.startsWith('file:')) return true; // content:// and others: let the upload decide
  try { return new File(uri).exists; } catch { return false; }
}

/** 'unsupported' when the file isn't one the chat can send. */
export async function pickDocument(): Promise<Picked | 'unsupported' | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: DOC_TYPES, copyToCacheDirectory: true, multiple: false });
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  const mime = (a.mimeType ?? '').toLowerCase();
  let name = (a.name || 'file').trim();
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (!ALLOWED[ext]) {
    // Some Android apps (Drive, file managers) give a name with no extension: add it from the type.
    const fromMime = EXT_OF[mime];
    if (!fromMime) return 'unsupported';
    name = `${name}.${fromMime}`;
  }
  const finalExt = name.split('.').pop()!.toLowerCase();
  return { uri: a.uri, name, mime: ALLOWED[finalExt] ?? mime, size: a.size ?? fileSize(a.uri) };
}

type Src = { uri: string; headers?: Record<string, string> };
const srcCache = new Map<string, { key: string; src: Src }>();
/**
 * The address and header to show a private chat photo. The same object comes back while nothing changes,
 * so the image isn't reloaded on every refresh. A photo we sent whose phone copy is gone loads from the server.
 */
export function imageSource(m: ChatMsg): Src {
  const tok = accessToken() ?? '';
  const local = m.file?.localUri ?? '';
  const url = m.file?.url ?? '';
  const key = `${local}|${url}|${tok}`;
  const hit = srcCache.get(m.clientId);
  if (hit && hit.key === key) return hit.src;
  const src: Src = local && (localFileExists(local) || !url) ? { uri: local } : { uri: `${API_URL}${url}`, headers: { Authorization: `Bearer ${tok}` } };
  srcCache.set(m.clientId, { key, src });
  return src;
}

/** Downloads a private chat file (signed in) into the app's own cache and offers "Open with". */
export async function openChatFile(m: ChatMsg): Promise<void> {
  const f = m.file;
  if (!f) return;
  let uri = f.localUri && localFileExists(f.localUri) ? f.localUri : undefined;
  if (!uri && f.url) {
    const dir = new Directory(Paths.cache, 'chat');
    dir.create({ idempotent: true, intermediates: true });
    const safe = f.name.replace(/[^\w.\- ]+/g, '_').slice(-80) || 'file';
    const dest = new File(dir, `${m.id}-${safe}`);
    if (!dest.exists) {
      await File.downloadFileAsync(`${API_URL}${f.url}?download=true`, dest, { headers: { Authorization: `Bearer ${accessToken() ?? ''}` }, idempotent: true });
    }
    uri = dest.uri;
  }
  if (!uri) throw new Error('missing');
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: f.mime, dialogTitle: f.name });
}
