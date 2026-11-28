export interface KwStatus {
  google: { connected: boolean; gsc: boolean; gbp: boolean; ads: boolean; developerToken: boolean };
  runAt?: string | null; plannerAt?: string | null; plannerResult?: string | null; brand: string;
  keywords: number; grouped: number; withVolume: number; sources: Record<string, number>; places: string[];
}

export interface OppRow {
  id: string; name: string; department?: string | null; intent: string; status: string; score: number; demand: number;
  gapPct: number; valuePct: number; bestPosition?: number | null; peakMonths?: string | null; keywords: number; langs: string[];
  example?: string | null; trend?: number | null; enquiries: number; came: number; admitted: number; actions: number; liveActions: number;
  suggestKind: ActionKind; suggest: string;
}
export interface OppRes {
  topics: OppRow[];
  kpis: { demand: number; topics: number; foundPct?: number | null; came: number; admitted: number; nextPeak?: string | null; peakInMonths?: number | null };
  departments: string[]; districts: string[];
}

export type ActionKind = 'page' | 'post' | 'ad' | 'camp' | 'broadcast';
export type Stage = 'idea' | 'brief' | 'writing' | 'review' | 'live' | 'done';

export interface KwActionRow {
  id: string; topicId: string; kind: ActionKind; title: string; stage: Stage; ownerId?: string | null; ownerName?: string | null;
  dueOn?: string | null; linkCode?: string | null; url?: string | null; brief?: string | null; spend?: number | null;
  createdAt: string; updatedAt: string; liveAt?: string | null;
  enquiries?: number | null; came?: number | null; admitted?: number | null; costPerPatient?: number | null;
}

export interface Person { id: string; name: string }

export const KIND_LABEL: Record<ActionKind, string> = { page: 'Website page', post: 'Business Profile post', ad: 'Ad group', camp: 'Health camp', broadcast: 'WhatsApp broadcast' };
export const KIND_SHORT: Record<ActionKind, string> = { page: 'Page', post: 'Post', ad: 'Ad', camp: 'Camp', broadcast: 'Broadcast' };
export const STAGE_LABEL: Record<Stage, string> = { idea: 'Ideas', brief: 'Brief ready', writing: 'Writing', review: 'Doctor review', live: 'Live', done: 'Done' };
export const STAGES: Stage[] = ['idea', 'brief', 'writing', 'review', 'live', 'done'];
export const INTENT_LABEL: Record<string, string> = { visit: 'Visit now', compare: 'Compare', learn: 'Learn', brand: 'Our name' };
export const LANG_LABEL: Record<string, string> = { hi: 'Hindi', hinglish: 'Hinglish', en: 'English', bn: 'Bangla' };
export const SOURCE_LABEL: Record<string, string> = {
  gsc: 'Search Console', gbp: 'Business Profile', ads: 'Google Ads', planner: 'Keyword Planner', chats: 'WhatsApp', seed: 'Added by you', manual: 'Placed by you',
};
export const SUGGEST_BUTTON: Record<ActionKind, string> = { page: 'Create brief', post: 'Plan a post', ad: 'Plan an ad group', camp: 'Plan a camp', broadcast: 'Plan a broadcast' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthName = (m: number) => MONTHS[(m - 1 + 12) % 12];
export const peakText = (p?: string | null) => (p ? p.split(',').map((m) => monthName(Number(m))).join(', ') : '');
export const num = (n?: number | null) => (n == null ? '—' : n.toLocaleString('en-IN'));
export const positionText = (p?: number | null) => (p == null ? 'Not found' : p <= 10 ? `Page 1 (position ${p.toFixed(0)})` : `Page ${Math.ceil(p / 10)} (position ${p.toFixed(0)})`);
