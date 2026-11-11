import { api, accessToken, get, post, OfflineError } from './api';
import { API_URL } from './config';
import { kvJson, kvSet, notifyChange } from './db';
import { nowIso, uuid } from './util';
import type { StringKey } from '../i18n';

/**
 * Banner and hoarding places. The agent suggests a place (photo + GPS); the office approves it; the agent fixes it with
 * the owner and marks it rented, then adds a photo when the banner is up. A new place is kept on the phone and sent
 * when there is signal. The rent is never sent to the app.
 */
export type HoardingStage = 'suggested' | 'approved' | 'rented' | 'live' | 'ending' | 'ended' | 'rejected';
export const HOARDING_KINDS = ['hoarding', 'wall', 'shop', 'pole', 'gate', 'other'] as const;
export type HoardingKind = typeof HOARDING_KINDS[number];
export const KIND_KEY: Record<string, StringKey> = { hoarding: 'hdKindHoarding', wall: 'hdKindWall', shop: 'hdKindShop', pole: 'hdKindPole', gate: 'hdKindGate', other: 'hdKindOther' };

export interface Hoarding {
  id: string; clientId: string; place: string; landmark?: string | null; lat: number; lng: number; kind: string; size?: string | null;
  status: Exclude<HoardingStage, 'ending'>; stage: HoardingStage; daysLeft?: number | null; rentEnd?: string | null;
  note?: string | null; ownerName?: string | null; rejectReason?: string | null; createdAt: string;
  photos: { id: string; kind: 'site' | 'banner' }[];
}

/** A place added on the phone that the server doesn't have yet (or whose photo is still to go). */
export interface HoardingDraft {
  clientId: string; place: string; landmark: string; kind: string; size: string; note: string; alreadyRented: boolean;
  ownerName: string; ownerPhone: string; lat: number; lng: number; accuracy: number | null; photoUri: string | null;
  createdAt: string; serverId?: string | null; error?: string | null;
}

const K_CACHE = 'hoardings.cache';
const K_QUEUE = 'hoardings.queue';

export const myHoardings = (): Hoarding[] => kvJson<Hoarding[]>(K_CACHE, []);
export const hoardingDrafts = (): HoardingDraft[] => kvJson<HoardingDraft[]>(K_QUEUE, []);
const saveDrafts = (d: HoardingDraft[]) => { kvSet(K_QUEUE, d.length ? JSON.stringify(d) : null); notifyChange(); };
const saveCache = (items: Hoarding[]) => { kvSet(K_CACHE, JSON.stringify(items)); notifyChange(); };
const putOne = (h: Hoarding) => { const all = myHoardings(); saveCache(all.some((x) => x.id === h.id) ? all.map((x) => (x.id === h.id ? h : x)) : [h, ...all]); };

export async function refreshHoardings(): Promise<void> {
  const r = await get<{ items: Hoarding[] }>('/api/v1/me/hoardings');
  saveCache(r.items ?? []);
}

async function sendPhoto(id: string, uri: string, kind: 'site' | 'banner'): Promise<Hoarding> {
  const form = new FormData();
  form.append('file', { uri, name: `${kind}-${id}.jpg`, type: 'image/jpeg' } as unknown as Blob);
  return api<Hoarding>(`/api/v1/me/hoardings/${id}/photo?kind=${kind}`, { method: 'POST', body: form, timeoutMs: 120000 });
}

/** Keeps the new place on the phone and tries to send it. Returns true when it reached the office now. */
export async function suggestHoarding(d: Omit<HoardingDraft, 'clientId' | 'createdAt' | 'serverId' | 'error'>): Promise<boolean> {
  saveDrafts([{ ...d, clientId: uuid(), createdAt: nowIso() }, ...hoardingDrafts()]);
  await flushHoardings();
  return hoardingDrafts().length === 0;
}

let flushing: Promise<void> | null = null;
/** Sends the places waiting on the phone, then their photos. Safe to call often; never throws. */
export function flushHoardings(): Promise<void> {
  flushing ??= (async () => {
    for (const d of hoardingDrafts()) {
      const set = (patch: Partial<HoardingDraft> | null) =>
        saveDrafts(patch === null ? hoardingDrafts().filter((x) => x.clientId !== d.clientId) : hoardingDrafts().map((x) => (x.clientId === d.clientId ? { ...x, ...patch } : x)));
      try {
        let id = d.serverId ?? null;
        if (!id) {
          const h = await post<Hoarding>('/api/v1/me/hoardings', {
            clientId: d.clientId, place: d.place, landmark: d.landmark, kind: d.kind, size: d.size, note: d.note, alreadyRented: d.alreadyRented,
            ownerName: d.ownerName, ownerPhone: d.ownerPhone, lat: d.lat, lng: d.lng, accuracy: d.accuracy,
          }, 30000);
          id = h.id;
          putOne(h);
          set({ serverId: id, error: null });
        }
        if (d.photoUri) putOne(await sendPhoto(id, d.photoUri, 'site'));
        set(null);
      } catch (e) {
        if (e instanceof OfflineError) break; // no signal: the rest waits too
        set({ error: e instanceof Error ? e.message : 'Could not send' });
      }
    }
  })().finally(() => { flushing = null; });
  return flushing;
}

/** A draft the server refused (e.g. no location): the agent can remove it from the phone. */
export function dropDraft(clientId: string) { saveDrafts(hoardingDrafts().filter((x) => x.clientId !== clientId)); }

export async function markRented(id: string, ownerName: string, ownerPhone: string): Promise<void> {
  putOne(await post<Hoarding>(`/api/v1/me/hoardings/${id}/rented`, { ownerName, ownerPhone }, 30000));
}

export async function bannerUp(id: string, uri: string): Promise<void> { putOne(await sendPhoto(id, uri, 'banner')); }
export async function addSitePhoto(id: string, uri: string): Promise<void> { putOne(await sendPhoto(id, uri, 'site')); }

export const hoardingPhoto = (photoId: string) => ({ uri: `${API_URL}/api/v1/me/hoardings/photos/${photoId}`, headers: { Authorization: `Bearer ${accessToken() ?? ''}` } });
