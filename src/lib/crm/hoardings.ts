export type HoardingStage = 'suggested' | 'approved' | 'rented' | 'live' | 'ending' | 'ended' | 'rejected';
export type HoardingStatus = Exclude<HoardingStage, 'ending'>;

export interface HoardingPhoto { id: string; kind: 'site' | 'banner'; at: string }

export interface Hoarding {
  id: string; place: string; landmark?: string | null; district?: string | null; block?: string | null;
  lat: number; lng: number; accuracy?: number | null; kind: string; size?: string | null;
  status: HoardingStatus; stage: HoardingStage; daysLeft?: number | null;
  suggestedBy: string; suggestedByName: string; fromAgent: boolean; agentNote?: string | null; officeNote?: string | null;
  ownerId?: string | null; monthlyRent?: number | null; rentStart?: string | null; rentEnd?: string | null; rentMissing: boolean;
  rejectReason?: string | null; decidedAt?: string | null; rentedAt?: string | null; liveAt?: string | null; endedAt?: string | null;
  createdAt: string; updatedAt: string; photos: HoardingPhoto[];
}

export interface HoardingOwner { id: string; name: string; phone?: string | null; address?: string | null; notes?: string | null; places: number; running: number; monthlyRent: number }

export interface HoardingData {
  today: string; endingDays: number; kinds: string[]; items: Hoarding[]; owners: HoardingOwner[];
  summary: { monthlySpend: number; running: number; approvedRent: number; waiting: number; endingSoon: number; rentMissing: number };
}

/** The board's columns, left to right: the life of a banner place. */
export const STAGES: { key: HoardingStage; label: string; hint: string; color: string }[] = [
  { key: 'suggested', label: 'Suggested', hint: 'Sent by agents. Approve with the rent, or say why not.', color: '#d9822b' },
  { key: 'approved', label: 'Approved', hint: 'The agent fixes it with the owner.', color: '#0a72d6' },
  { key: 'rented', label: 'Rented', hint: 'Rent is running. Waiting for the banner.', color: '#7c3aed' },
  { key: 'live', label: 'Banner up', hint: 'The banner is on the wall, with a photo.', color: '#0f8a5f' },
  { key: 'ending', label: 'Ending soon', hint: 'Renew with a new end date, or end it.', color: '#dc2626' },
  { key: 'ended', label: 'Ended', hint: 'No rent is paid any more.', color: '#8c96ab' },
];
export const REJECTED_COLOR = '#b9c0cf';
export const stageOf = (k: HoardingStage) => STAGES.find((s) => s.key === k) ?? { key: k, label: 'Not taken', hint: '', color: REJECTED_COLOR };

export const KIND_LABEL: Record<string, string> = { hoarding: 'Hoarding', wall: 'Wall painting', shop: 'Shop board', pole: 'Pole banner', gate: 'Gate / arch', other: 'Other' };
export const kindLabel = (k?: string | null) => KIND_LABEL[k ?? ''] ?? 'Hoarding';

export const dayText = (d?: string | null) => d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

/** "ends in 5 days", "ends today", "ended 3 days ago". */
export function leftText(days?: number | null): string {
  if (days == null) return '';
  if (days < 0) return `rent period over ${-days} ${days === -1 ? 'day' : 'days'} ago`;
  if (days === 0) return 'ends today';
  if (days === 1) return 'ends tomorrow';
  return `ends in ${days} days`;
}
