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

const DOC_TYPES = [
  'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv', 'text/plain', 'image/*',
];

export async function pickDocument(): Promise<Picked | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: DOC_TYPES, copyToCacheDirectory: true, multiple: false });
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  return { uri: a.uri, name: a.name, mime: a.mimeType ?? 'application/octet-stream', size: a.size ?? null };
}

/** The address and header to show a private chat photo. */
export function imageSource(m: ChatMsg) {
  if (m.file?.localUri) return { uri: m.file.localUri };
  return { uri: `${API_URL}${m.file?.url ?? ''}`, headers: { Authorization: `Bearer ${accessToken() ?? ''}` } };
}

/** Downloads a private chat file (signed in) into the app's own cache and offers "Open with". */
export async function openChatFile(m: ChatMsg): Promise<void> {
  const f = m.file;
  if (!f) return;
  let uri = f.localUri;
  if (!uri) {
    const dir = new Directory(Paths.cache, 'chat');
    dir.create({ idempotent: true, intermediates: true });
    const safe = f.name.replace(/[^\w.\- ]+/g, '_').slice(-80) || 'file';
    const dest = new File(dir, `${m.id}-${safe}`);
    if (!dest.exists) {
      await File.downloadFileAsync(`${API_URL}${f.url}?download=true`, dest, { headers: { Authorization: `Bearer ${accessToken() ?? ''}` }, idempotent: true });
    }
    uri = dest.uri;
  }
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: f.mime, dialogTitle: f.name });
}
