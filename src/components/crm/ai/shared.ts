/** Types and helpers for the AI agents page. */

export type Mode = 'off' | 'shadow' | 'live';
export interface AgentRow {
  id: string; name: string; job: string; wing: 'command' | 'leads' | 'studio' | 'growth'; wingName: string; phase: number;
  wokenBy: string; canDo: string; limits: string; talksTo: string[];
  mode: Mode; paused: boolean; pausedReason?: string | null; pausedBy?: string | null; available: boolean;
  today: { done: number; shadow: number; blocked: number; skipped: number; failed: number };
  tokensToday: number;
  last?: { summary: string; status: string; created_at: string } | null;
}
export interface Overview {
  version: string; groq: boolean; stopAll: { on: boolean; by?: string | null; reason?: string | null; at?: string | null };
  agents: AgentRow[]; today: AgentRow['today']; handoffsToday: number; lessonsThisWeek: number; tokensToday: number;
}
export interface OverviewRes { data: Overview; me: { isAdmin: boolean; canStop: boolean; canEdit: boolean } }
export interface ActionRow {
  id: string; agent_id: string; kind: string; status: 'done' | 'shadow' | 'blocked' | 'held' | 'failed' | 'skipped';
  summary: string; subject_type?: string | null; subject_id?: string | null; channel?: string | null;
  detail?: Record<string, unknown>; reasons?: { rule: string; message: string; match?: string | null }[]; to_agent?: string | null; created_at: string;
}
export interface GuardIssue { rule: string; severity: 'block' | 'fix'; message: string; match?: string | null; fixable: boolean }
export interface GuardRes {
  outcome: 'pass' | 'fix' | 'block' | 'held'; text: string; rewritten: boolean; issues: GuardIssue[];
  policy?: { violation: boolean; rules: string[]; explanation: string } | null; checked_by: string[]; note?: string | null;
}
export interface Limits {
  quietHours: { from: string; to: string; allowRepliesToInbound: boolean };
  lead: { repliesPerLeadPerHour: number; maxFollowUpsPerLead: number; autoRepliesPerPersonPerDay: number };
  partner: { messagesPerDay: number };
  broadcast: { perListPerWeek: number; perPersonPerWeek: number };
  social: { postsPerChannelPerDay: number };
  reviews: { repliesPerDay: number };
  whatsapp: { sendsPerDay: number };
  ads: { mode: string; monthlyCapMeta: number; monthlyCapGoogle: number; maxDailyChangePct: number };
  tokens: { perAgentPerDay: number };
  anomaly: { blocksPerHourToPause: number; volumeMultipleToPause: number };
}
export interface Settings {
  limits: Limits;
  policy: { text: string; isDefault?: boolean };
  facts: { text: string; phones: string[]; domains: string[] };
  recipients: { roles: string[]; whatsapp: boolean };
  meta: Record<string, { updatedAt?: string; updatedBy?: string }>;
}
export interface Lesson { agentId: string; key: string; text: string; status?: 'trial' | 'kept' | 'dropped'; episodes?: number; score?: number }

const V = '/brand/vita/';
export const POSE = {
  work: V + 'ai.webp', think: V + 'think.webp', wave: V + 'wave.webp', stern: V + 'stern.webp', fly: V + 'fly.webp',
  relax: V + 'relax.webp', coffee: V + 'coffee.webp', snack: V + 'snack.webp', sleep: V + 'sleep.webp', cheer: V + 'cheer.webp',
};

/** What a room shows: the pose, the light, the word and the motion — from the real state, never made up. */
export interface Look { label: string; img: string; anim: 'bob' | 'tilt' | 'breathe' | 'guard' | 'none'; tone: 'live' | 'shadow' | 'wait' | 'off'; line: string; zz: boolean }

export function lookOf(a: AgentRow, stopAll: boolean): Look {
  const recent = a.last && Date.now() - new Date(a.last.created_at).getTime() < 5 * 60e3;
  if (stopAll) return { label: 'Stopped', img: POSE.sleep, anim: 'breathe', tone: 'off', line: 'All agents are stopped. Nothing is sent.', zz: true };
  if (a.paused) return { label: 'Paused', img: POSE.sleep, anim: 'breathe', tone: 'wait', line: a.pausedReason ?? 'Paused', zz: true };
  if (!a.available) return { label: `Phase ${a.phase}`, img: POSE.relax, anim: 'none', tone: 'off', line: `Arrives in phase ${a.phase}. ${a.job}.`, zz: false };
  if (a.mode === 'off') return { label: 'Off', img: POSE.sleep, anim: 'breathe', tone: 'off', line: 'Switched off.', zz: true };
  if (a.id === 'compliance_guard') {
    return { label: recent ? 'Checking' : 'On guard', img: POSE.stern, anim: recent ? 'guard' : 'breathe', tone: 'live', zz: false,
      line: a.last ? a.last.summary : 'Ready to check every message before it leaves.' };
  }
  if (a.mode === 'shadow') return { label: 'Shadow', img: POSE.think, anim: 'tilt', tone: 'shadow', line: a.last?.summary ?? 'Practising: does everything except send.', zz: false };
  return { label: recent ? 'Working' : 'Live', img: recent ? POSE.work : POSE.coffee, anim: recent ? 'bob' : 'breathe', tone: 'live', line: a.last?.summary ?? 'Waiting for work.', zz: false };
}

export const STATUS_LABEL: Record<ActionRow['status'], string> = { done: 'Done', shadow: 'Would do', blocked: 'Blocked', held: 'Held', failed: 'Failed', skipped: 'Not done' };

const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const dayFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
export function when(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins} min ago`;
  const ist = (x: Date) => new Date(x.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
  return ist(d) === ist(new Date()) ? timeFmt.format(d) : `${dayFmt.format(d)}, ${timeFmt.format(d)}`;
}

export const CHANNELS: { k: string; l: string }[] = [
  { k: 'whatsapp', l: 'WhatsApp reply' }, { k: 'broadcast', l: 'WhatsApp broadcast' }, { k: 'sms', l: 'SMS' },
  { k: 'facebook', l: 'Facebook post' }, { k: 'instagram', l: 'Instagram post' }, { k: 'whatsapp_status', l: 'WhatsApp Status' },
  { k: 'google_review', l: 'Google review reply' }, { k: 'partner', l: 'Message to a partner' },
];
