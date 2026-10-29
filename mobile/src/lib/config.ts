import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string; dutyDoctorPhone?: string };

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || extra.apiUrl || 'https://nexmarket-api.nexeagle.com').replace(/\/+$/, '');
export const DUTY_DOCTOR_PHONE = process.env.EXPO_PUBLIC_DUTY_DOCTOR_PHONE || extra.dutyDoctorPhone || '';
export const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

/** Agents can check in anywhere within this distance of a panchayat's centre. */
export const CHECK_IN_RADIUS_M = 2500;
/** While on shift: a route point at least this often, or after moving this far. */
export const TRACK_INTERVAL_MS = 2 * 60 * 1000;
export const TRACK_DISTANCE_M = 100;
/** Background sync cadence while on shift. */
export const SYNC_INTERVAL_MS = 2 * 60 * 1000;
