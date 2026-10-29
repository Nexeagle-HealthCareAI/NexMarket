import { Linking } from 'react-native';
import { digitsOnly } from './util';

/** Google Maps turn-by-turn to a point (opens the Maps app when installed). */
export function openDirections(lat: number, lng: number) {
  void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`);
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
