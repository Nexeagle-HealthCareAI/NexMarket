import type { Tone } from '@/components/crm/ui';

export interface CampRow {
  id: string; title: string; code: string; campType: string; typeLabel: string; date: string; startTime: string; endTime: string;
  district?: string | null; block?: string | null; venue?: string | null; status: string; capacity: number; targetRegistrations: number; targetReferrals: number;
  budget: number; spent: number; booked: number; attended: number; referred: number; arrived: number; checklistDone: number; checklistTotal: number;
}
export interface ChecklistItem { id: string; phase: 'before' | 'week' | 'day' | 'after'; text: string; done: boolean; doneBy?: string | null; doneAt?: string | null }
export interface CountRow { code: string; label: string; n: number; dept?: string }
export interface CampDetail {
  camp: CampRow & { departments: string[]; doctors: string[]; panchayatId?: string | null; hostPartnerClientId?: string | null; notes?: string | null; outcome?: string | null; createdAt: string };
  host?: { clientId: string; name: string; role: string } | null;
  checklist: ChecklistItem[];
  stats: {
    booked: number; attended: number; referred: number; arrived: number; prebooked: number; walkIn: number; noShow: number;
    women: number; men: number; over60: number; children: number; highBp: number; highSugar: number; costPerAttendee?: number | null; costPerArrival?: number | null;
  };
  symptoms: CountRow[]; conditions: CountRow[];
  link: { message: string; waLink: string | null; displayPhone?: string | null; hospital: string };
}
export interface CampPatient {
  id: string; token: number; name: string; phone?: string | null; age?: number | null; sex?: string | null; village?: string | null; source: string;
  partnerClientId?: string | null; partnerName?: string | null; slot?: string | null; status: string; arrivedAt?: string | null; complaint?: string | null;
  symptoms: string[]; conditions: string[]; bpSystolic?: number | null; bpDiastolic?: number | null; sugar?: number | null; weightKg?: number | null; spo2?: number | null;
  advice?: string | null; referToHospital: boolean; department?: string | null; urgent: boolean; consent: boolean; leadId?: string | null; leadStatus?: string | null; flags: string[];
}
export interface CampOptions {
  types: { key: string; label: string }[];
  symptoms: { code: string; en: string; hi: string }[];
  conditions: { code: string; en: string; hi: string; dept: string }[];
}

export const CAMP_STATUS: Record<string, { label: string; tone: Tone }> = {
  planned: { label: 'Planned', tone: 'neutral' }, confirmed: { label: 'Confirmed', tone: 'accent' }, done: { label: 'Done', tone: 'ok' }, cancelled: { label: 'Cancelled', tone: 'bad' },
};
export const PATIENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  booked: { label: 'Booked', tone: 'accent' }, attended: { label: 'Seen', tone: 'ok' }, no_show: { label: "Didn't come", tone: 'warn' }, cancelled: { label: 'Cancelled', tone: 'neutral' },
};
export const SOURCE_LABEL: Record<string, string> = { prebooked: 'Booked by desk', whatsapp: 'WhatsApp', partner: 'Partner', agent: 'Field agent', walk_in: 'Walk-in' };
export const PHASES: { key: ChecklistItem['phase']; label: string; hint: string }[] = [
  { key: 'before', label: '2–3 weeks before', hint: 'Place, doctors, posters' },
  { key: 'week', label: 'The week before', hint: 'Invite, remind, pre-book' },
  { key: 'day', label: 'On the day', hint: 'Register, screen, refer' },
  { key: 'after', label: 'After the camp', hint: 'Follow up, credit, learn' },
];

const dFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const campDate = (d: string) => dFmt.format(new Date(`${d}T00:00:00Z`));
export const daysTo = (d: string) => {
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  return Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5);
};
export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
