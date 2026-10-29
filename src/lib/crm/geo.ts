import { crm } from '@/lib/sync/api-client';

export type CoverageStatus = 'untouched' | 'visited' | 'partners' | 'patients';
export type LocationSource = 'manual' | 'field' | 'villages' | 'hq-village' | 'block';

export interface CoverageRow {
  id: string;
  name: string;
  block: string;
  district: string;
  lat: number | null;
  lng: number | null;
  source: LocationSource;
  visits: number;
  lastVisitAt: string | null;
  agents: string[];
  partners: number;
  newPartners: number;
  important: number;
  champions: number;
  referrals: number;
  admitted: number;
  surveys: number;
  status: CoverageStatus;
  inScope?: boolean;
}

export interface Coverage {
  from: string;
  to: string;
  total: number;
  covered: number;
  withPartners: number;
  sendingPatients: number;
  items: CoverageRow[];
}

export interface PanchayatPerson {
  clientId: string;
  name: string;
  role: string;
  profession?: string | null;
  phone?: string | null;
  important: boolean;
  champion: boolean;
  championNote?: string | null;
  relation?: string | null;
  addedBy: string;
  addedAt: string;
  lastConnectedAt?: string | null;
  referrals: number;
  referralsInPeriod: number;
  admitted: number;
  lastReferralAt?: string | null;
}

export interface SnapshotQuestion {
  questionId: string;
  title: string;
  text: string;
  type: string;
  respondents: number;
  answers: { label: string; full: string; count: number }[];
}

export interface PanchayatDetail {
  id: string;
  name: string;
  block: string;
  district: string;
  lgdCode: string;
  inScope?: boolean;
  canDelete?: boolean;
  createdBy?: string;
  lat: number | null;
  lng: number | null;
  source: LocationSource;
  fieldCheckIns: number;
  manualSetBy?: string | null;
  manualSetAt?: string | null;
  metrics: {
    visits: number;
    visitsAllTime: number;
    lastVisitAt: string | null;
    partners: number;
    important: number;
    champions: number;
    referrals: number;
    admitted: number;
    referralsAllTime: number;
    status: CoverageStatus;
  };
  agents: { agentId: string; name: string; visits: number; lastVisitAt: string }[];
  visits: { agent: string; checkInAt: string; checkOutAt: string | null; minutes: number | null }[];
  people: PanchayatPerson[];
  referrals: { clientId: string; patientName: string; department: string; status: string; stageLabel: string; createdAt: string; partner?: string | null }[];
  snapshot: { responses: number; lastAt: string | null; questions: SnapshotQuestion[] };
}

export type AgentStatus = 'on_visit' | 'moving' | 'idle' | 'no_signal' | 'off_shift';

export interface LiveAgent {
  agentId: string;
  name: string;
  phone: string;
  block: string;
  district: string;
  photoUrl?: string | null;
  status: AgentStatus;
  lat: number | null;
  lng: number | null;
  at: string | null;
  accuracyM?: number | null;
  minutesSinceSeen: number | null;
  shiftStartedAt: string | null;
  currentPlace: string | null;
  currentPlaceSince: string | null;
  today: { visits: number; panchayats: number; partners: number; referrals: number; km: number };
  trail: [number, number][];
}

export interface FieldLive {
  at: string;
  onShift: number;
  total: number;
  noSignal: number;
  agents: LiveAgent[];
}

export type TimelineKind = 'shift_start' | 'shift_end' | 'visit_in' | 'visit_out' | 'partner' | 'referral' | 'photo' | 'survey' | 'gap';

export interface TimelineEvent {
  kind: TimelineKind;
  at: string;
  title: string;
  detail?: string | null;
  lat?: number | null;
  lng?: number | null;
  panchayatId?: string | null;
  refId?: string | null;
  url?: string | null;
}

export interface AgentActivity {
  agent: { agentId: string; name: string; phone: string; block: string; district: string; photoUrl?: string | null };
  date: string;
  stats: {
    km: number;
    shiftHours: number;
    firstSeen: string | null;
    lastSeen: string | null;
    visits: number;
    panchayats: number;
    minutesInPanchayats: number;
    partners: number;
    referrals: number;
    photos: number;
    surveys: number;
    gaps: number;
    gpsPoints: number;
  };
  route: { lat: number; lng: number; at: string }[];
  events: TimelineEvent[];
}

export interface CoverageFilter {
  district?: string;
  block?: string;
  agentId?: string;
  from?: string;
  to?: string;
  /** default: in marketing scope · 'out' taken out · 'all' */
  scope?: 'out' | 'all';
}

function qs(f: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const geo = {
  coverage: (f: CoverageFilter) => crm.get<Coverage>(`/api/v1/geo/panchayats${qs({ ...f })}`),
  panchayat: (id: string, f: Pick<CoverageFilter, 'from' | 'to'> = {}) =>
    crm.get<PanchayatDetail>(`/api/v1/geo/panchayats/${encodeURIComponent(id)}${qs({ ...f })}`),
  setPin: (id: string, lat: number, lng: number) =>
    crm.put<{ lat: number; lng: number; source: LocationSource }>(`/api/v1/geo/panchayats/${encodeURIComponent(id)}/pin`, { lat, lng }),
  clearPin: (id: string) => crm.del<{ lat: number; lng: number; source: LocationSource }>(`/api/v1/geo/panchayats/${encodeURIComponent(id)}/pin`),
  setChampion: (clientId: string, champion: boolean, note?: string) =>
    crm.put<{ clientId: string; champion: boolean; note?: string }>(`/api/v1/geo/contacts/${encodeURIComponent(clientId)}/champion`, { champion, note }),
  live: () => crm.get<FieldLive>('/api/v1/field/live'),
  activity: (agentId: string, date?: string) =>
    crm.get<AgentActivity>(`/api/v1/field/agents/${encodeURIComponent(agentId)}/activity${qs({ date })}`),
};

export const STATUS_META: Record<CoverageStatus, { label: string; color: string; hint: string }> = {
  untouched: { label: 'Not visited', color: '#c7ceda', hint: 'No visit in this period' },
  visited: { label: 'Visited', color: '#f5b544', hint: 'Visited, no partner yet' },
  partners: { label: 'Has partners', color: '#3d8fe0', hint: 'Partners, no patients in this period' },
  patients: { label: 'Sending patients', color: '#16a36a', hint: 'At least one referral in this period' },
};

export const AGENT_STATUS_META: Record<AgentStatus, { label: string; color: string }> = {
  on_visit: { label: 'In a panchayat', color: '#16a36a' },
  moving: { label: 'Moving', color: '#0a72d6' },
  idle: { label: 'Not moving', color: '#f5b544' },
  no_signal: { label: 'No signal', color: '#e5484d' },
  off_shift: { label: 'Off shift', color: '#8a93a6' },
};

export const SOURCE_LABEL: Record<LocationSource, string> = {
  manual: 'Pin placed by hand',
  field: 'From agent check-ins',
  villages: 'From census villages',
  'hq-village': 'From the panchayat’s main village',
  block: 'Approximate — block centre only',
};

/** yyyy-MM-dd for an IST calendar day `daysAgo` before today. */
export function istDate(daysAgo = 0): string {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000 - daysAgo * 86400000);
  return ist.toISOString().slice(0, 10);
}
