import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { currentPosition } from './location';

export interface Photo {
  uri: string;
  dataUri: string;
  lat: number | null;
  lng: number | null;
  takenAt: string;
}

/**
 * Camera only — no gallery — so every photo is taken on the spot. The place and time
 * come from the phone's GPS at the moment of capture (EXIF GPS is used when the phone
 * has a better fix in it), and travel with the photo to the server.
 */
export async function takePhoto(): Promise<Photo | 'denied' | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return 'denied';
  const posPromise = currentPosition();
  const res = await ImagePicker.launchCameraAsync({ quality: 0.8, exif: true, allowsEditing: false, mediaTypes: ['images'] });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  const takenAt = new Date().toISOString();
  const exif = (a.exif ?? {}) as Record<string, unknown>;
  let lat: number | null = null;
  let lng: number | null = null;
  if (typeof exif.GPSLatitude === 'number' && typeof exif.GPSLongitude === 'number') {
    lat = (exif.GPSLatitudeRef === 'S' ? -1 : 1) * (exif.GPSLatitude as number);
    lng = (exif.GPSLongitudeRef === 'W' ? -1 : 1) * (exif.GPSLongitude as number);
  }
  if (lat == null || lng == null) {
    const p = await posPromise;
    lat = p?.lat ?? null;
    lng = p?.lng ?? null;
  }
  const ref = await ImageManipulator.manipulate(a.uri).resize({ width: Math.min(1280, a.width || 1280) }).renderAsync();
  const out = await ref.saveAsync({ compress: 0.6, base64: true, format: SaveFormat.JPEG });
  return { uri: out.uri, dataUri: `data:image/jpeg;base64,${out.base64}`, lat, lng, takenAt };
}
