/** Types and helpers for the Vita Marketing Autonomous Agents page. */

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

// ─── Asking an agent (the card that opens when you tap a Vita in the 3D office) ───

export interface Whereabouts { place: 'desk' | 'pool' | 'lounge' | 'meeting' | 'walking'; doing: string }
export const QUICK = [
  { k: 'now', q: 'What are you doing?' }, { k: 'today', q: 'What did you do today?' }, { k: 'job', q: 'What is your job?' },
  { k: 'limits', q: 'What are your limits?' }, { k: 'team', q: 'Who do you work with?' }, { k: 'need', q: 'Do you need anything from me?' },
] as const;
export type QuickKey = (typeof QUICK)[number]['k'];

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** Her answer in her own words, built only from the agent's live state: nothing is made up and no AI is involved. */
export function quickAnswer(k: QuickKey, a: AgentRow, o: { stopAll: boolean; groq: boolean; where: Whereabouts; feed: ActionRow[]; nameOf: (id: string) => string }): string {
  const last = a.last ? `${a.last.summary} (${when(a.last.created_at)})` : null;
  const mine = o.feed.filter((f) => f.agent_id === a.id);
  switch (k) {
    case 'now': {
      if (o.stopAll) return 'All agents are stopped, so I am doing nothing and sending nothing until someone presses Resume.';
      if (!a.available) return `I haven't started work yet: I arrive in phase ${a.phase}. Until then I'm ${o.where.doing || 'taking it easy'}. When I start, my job will be: ${a.job.toLowerCase()}.`;
      if (a.paused) return `I'm paused${a.pausedBy ? ` by ${a.pausedBy.replace(/\s*\(.*\)$/, '')}` : ''}${a.pausedReason ? `: ${a.pausedReason}` : ''}. I'm asleep at my desk and do nothing until someone resumes me.`;
      if (a.mode === 'off') return "I'm switched off, asleep at my desk. Switch me to Shadow to let me practise, or to Live to let me work.";
      if (o.where.place === 'meeting') return `I'm ${o.where.doing}.${last ? ` It's about this: ${last}.` : ''}`;
      if (o.where.place === 'walking') return `I'm ${o.where.doing}.${last ? ` The last thing I did: ${last}.` : ''}`;
      if (o.where.place === 'desk') {
        if (a.id === 'compliance_guard') return `I'm at my desk on guard: every message is checked by me before it leaves.${last ? ` Last check: ${last}.` : ''}`;
        return last ? `I'm at my desk${a.mode === 'shadow' ? ', practising (I do everything except send)' : ', working'}. The last thing I did: ${last}.` : "I'm at my desk, ready for work.";
      }
      return `No work has come in for me${a.last ? ` since ${when(a.last.created_at)}` : ' yet today'}, so I'm ${o.where.doing}. The moment something arrives I walk back to my desk.`;
    }
    case 'today': {
      const t = a.today, total = t.done + t.shadow + t.blocked + t.skipped + t.failed;
      if (!a.available) return `Nothing yet: I arrive in phase ${a.phase}.`;
      if (total === 0) return "Nothing yet today. I'm ready when work comes.";
      const parts = [t.done ? `${t.done} done` : '', t.shadow ? plural(t.shadow, 'practice run') : '', t.blocked ? `${t.blocked} stopped by the Guard` : '', t.skipped ? `${t.skipped} not done` : '', t.failed ? `${t.failed} failed` : ''].filter(Boolean);
      const recent = mine.slice(0, 3).map((f) => `• ${when(f.created_at)}: ${f.summary}`).join('\n');
      return `Today: ${parts.join(', ')}. I used ${a.tokensToday.toLocaleString('en-IN')} AI tokens.${recent ? `\n\nLatest:\n${recent}` : ''}`;
    }
    case 'job':
      return `${a.job}. I wake up on: ${a.wokenBy.charAt(0).toLowerCase()}${a.wokenBy.slice(1)}. What I may do: ${a.canDo.charAt(0).toLowerCase()}${a.canDo.slice(1)}.`;
    case 'limits':
      return `${a.limits}. And every message I write for a patient, a partner or the public goes through the Compliance Guard before it leaves.`;
    case 'team': {
      if (a.talksTo.includes('*')) return 'Everyone: I work with every agent in the office.';
      const names = a.talksTo.map(o.nameOf);
      return names.length ? `I work with ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]}. I'm in the ${a.wingName}.` : `I work on my own, in the ${a.wingName}.`;
    }
    case 'need': {
      if (o.stopAll) return 'Yes: all agents are stopped. Press "Resume all agents" when you want us to work again.';
      if (!a.available) return `Not yet. I arrive in phase ${a.phase}; after my shadow trial you can switch me on.`;
      if (a.paused) return 'Yes: I am paused. Press Resume on my card when I should work again.';
      if (a.last?.status === 'held') return `Yes: this is held for a person to decide: ${a.last.summary}. Please look at it in Activity.`;
      const needs: string[] = [];
      if (!o.groq) needs.push('The AI model is not connected (the Groq key is missing on the agents service), so I cannot think.');
      if (a.today.failed) needs.push(`${plural(a.today.failed, 'action')} of mine failed today. Please check Activity.`);
      if (a.today.blocked) needs.push(`The Guard stopped ${plural(a.today.blocked, 'message')} of mine today. Have a look at why in Activity.`);
      if (a.mode === 'off') needs.push('I am switched off. Switch me to Shadow to let me practise.');
      if (a.mode === 'shadow') needs.push('I am in Shadow: I do everything except send. Read my practice runs, and switch me to Live when you are happy.');
      return needs.length ? needs.join(' ') : 'No, all good. I will tell you if something needs you.';
    }
  }
}
