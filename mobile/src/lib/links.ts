import { Linking } from 'react-native';
import { router } from 'expo-router';
import { digitsOnly } from './util';

/** Google Maps turn-by-turn to a point (opens the Maps app when installed). */
export function openDirections(lat: number, lng: number) {
  void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`);
}

/** In-app turn-by-turn navigation to a place (falls back to Google Maps from inside the screen). */
export function navigateTo(to: { lat: number; lng: number; name?: string; sub?: string; panchayatId?: string | null; contactId?: string | null }) {
  router.push({ pathname: '/navigate', params: { lat: String(to.lat), lng: String(to.lng), name: to.name ?? '', sub: to.sub ?? '', panchayatId: to.panchayatId ?? '', contactId: to.contactId ?? '' } });
}

export function callNumber(phone: string | null | undefined) {
  const d = digitsOnly(phone);
  if (d) void Linking.openURL(`tel:${d.length === 10 ? d : `+${d}`}`);
}

/** WhatsApp chat; Indian 10-digit numbers get the +91 prefix. */
export function openWhatsApp(phone: string | null | undefined, text = '') {
  let d = digitsOnly(phone);
  if (d.length === 10) d = `91${d}`;
  if (!d) return;
  void Linking.openURL(`https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ''}`);
}
