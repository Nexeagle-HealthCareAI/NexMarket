'use client';

import { useSyncExternalStore } from 'react';
import { crm } from '@/lib/sync/api-client';

// ─── Types (the server's /api/v1/calls) ──────────────────────────────────

export interface CallPerson { userId: string; name: string; joinedAt?: string | null; leftAt?: string | null; declined: boolean; inCall: boolean }
export interface Call {
  id: string; threadId: string; threadKind: 'agent' | 'team' | 'direct'; kind: 'call' | 'huddle' | 'meeting'; video: boolean;
  status: 'ringing' | 'active' | 'ended' | 'missed' | 'declined';
  startedBy: string; startedByName: string; mine: boolean;
  startedAt: string; answeredAt?: string | null; endedAt?: string | null; seconds?: number | null;
  people: CallPerson[];
}
export interface JoinInfo { url: string; room: string; token: string }
export interface CallJoin { call: Call; join: JoinInfo }
/** What a chat message says about a call that ended (a system message). */
export interface CallNote { id: string; kind: 'call' | 'huddle' | 'meeting'; video: boolean; status: Call['status']; seconds?: number | null }

/** The call I'm in (or dialling) in this tab. */
export interface CallSession { call: Call; join: JoinInfo; video: boolean; threadTitle?: string | null }

interface State {
  on: boolean;
  ringSeconds: number;
  /** Calls ringing for me + huddles in chats I can see (from /calls/active). */
  active: Call[];
  /** Calls ringing for me right now, newest first. */
  ringing: Call[];
  session: CallSession | null;
  /** A short message for the incoming pop-up, e.g. "Someone else answered". */
  notice: string | null;
}

let state: State = { on: false, ringSeconds: 30, active: [], ringing: [], session: null, notice: null };
const listeners = new Set<() => void>();
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const SERVER: State = { on: false, ringSeconds: 30, active: [], ringing: [], session: null, notice: null };

export function useCalls(): State {
  return useSyncExternalStore(subscribe, () => state, () => SERVER);
}
export const callState = () => state;

// ─── Labels ──────────────────────────────────────────────────────────────

/** A huddle or a meeting: people walk in and out, nobody is rung, and it goes on until the last person leaves. */
export const isRoom = (c: { kind: string }) => c.kind === 'huddle' || c.kind === 'meeting';
export const live = (c: Call) => c.status === 'ringing' || c.status === 'active';
export const inCallCount = (c: Call) => c.people.filter((p) => p.inCall).length;
export function durationText(seconds?: number | null): string {
  const s = Math.max(0, Math.round(seconds ?? 0));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(r).padStart(2, '0')}`;
}
/** "Missed video call", "Voice call · 3 min", "Huddle · 12 min", "Call declined". */
export function callNoteText(n: CallNote, mine?: boolean): string {
  if (n.kind === 'meeting') return n.seconds ? `Meeting · ${durationText(n.seconds)}` : 'Meeting';
  if (n.kind === 'huddle') return n.seconds ? `Huddle · ${durationText(n.seconds)}` : 'Huddle';
  const what = n.video ? 'video call' : 'voice call';
  if (n.status === 'declined') return 'Call declined';
  if (n.status === 'missed') return mine ? `${what[0].toUpperCase()}${what.slice(1)} · no answer` : `Missed ${what}`;
  return `${what[0].toUpperCase()}${what.slice(1)}${n.seconds ? ` · ${durationText(n.seconds)}` : ''}`;
}

// ─── Server calls ────────────────────────────────────────────────────────

let statusLoaded = false;
export async function loadCallStatus(force = false) {
  if (statusLoaded && !force) return;
  statusLoaded = true;
  try {
    const r = await crm.get<{ on: boolean; ringSeconds: number }>('/api/v1/calls/status');
    set({ on: !!r.on, ringSeconds: r.ringSeconds || 30 });
  } catch { set({ on: false }); statusLoaded = false; }
}

/** Calls I declined (or that someone else answered) in this tab — never ring again for them. */
const dismissed = new Set<string>();

function ringingFrom(list: Call[]): Call[] {
  const myId = state.session?.call.id;
  return list.filter((c) => c.status === 'ringing' && !c.mine && c.kind === 'call' && !dismissed.has(c.id) && c.id !== myId);
}

export async function refreshActive() {
  if (!state.on) return;
  try {
    const list = await crm.get<Call[]>('/api/v1/calls/active');
    // Keep any ringing call we learnt of from a push but the list hasn't caught up with yet.
    const pushed = state.ringing.filter((r) => !list.some((c) => c.id === r.id));
    set({ active: list, ringing: [...ringingFrom(list), ...pushed] });
  } catch { /* keep what is shown */ }
}

/** A call came in on the socket (notify kind 'call', link "call:<id>"). */
export async function noteIncoming(id: string) {
  if (!id || dismissed.has(id)) return;
  try {
    const c = await crm.get<Call>(`/api/v1/calls/${id}`);
    updateCall(c);
  } catch { /* the 10 s poll will pick it up */ }
}

/** A fresh copy of one call: update the lists it is in. */
export function updateCall(c: Call) {
  const active = live(c) ? [c, ...state.active.filter((x) => x.id !== c.id)] : state.active.filter((x) => x.id !== c.id);
  const ringing = ringingFrom([c]).length ? [c, ...state.ringing.filter((x) => x.id !== c.id)] : state.ringing.filter((x) => x.id !== c.id);
  const session = state.session && state.session.call.id === c.id ? { ...state.session, call: c } : state.session;
  set({ active, ringing, session });
}

/** Starts a call in a chat (or starts / joins the huddle in the Field team chat). */
export async function startCall(threadId: string, video: boolean, threadTitle?: string | null): Promise<void> {
  if (state.session) {
    if (state.session.call.threadId === threadId) return;
    throw new Error('You are already in a call. Hang up first.');
  }
  const r = await crm.post<CallJoin>('/api/v1/calls', { threadId, video });
  set({ session: { call: r.call, join: r.join, video: video || r.call.video, threadTitle } });
  updateCall(r.call);
}

/** Joins a call: answering a ring, or joining a huddle. Throws with the server's message on 409. */
export async function joinCall(c: Call, threadTitle?: string | null): Promise<void> {
  if (state.session) {
    if (state.session.call.id === c.id) return;
    throw new Error('You are already in a call. Hang up first.');
  }
  dismissed.add(c.id);
  try {
    const r = await crm.post<CallJoin>(`/api/v1/calls/${c.id}/join`, {});
    set({ session: { call: r.call, join: r.join, video: r.call.video, threadTitle }, ringing: state.ringing.filter((x) => x.id !== c.id), notice: null });
    updateCall(r.call);
  } catch (e) {
    set({ ringing: state.ringing.filter((x) => x.id !== c.id) });
    throw e;
  }
}

export async function declineCall(c: Call) {
  dismissed.add(c.id);
  set({ ringing: state.ringing.filter((x) => x.id !== c.id) });
  try { await crm.post(`/api/v1/calls/${c.id}/decline`, {}); } catch { /* it rings out on its own */ }
}

/** Stop ringing for a call without telling the server (it ended, or someone else answered). */
export function dropRinging(id: string, notice?: string) {
  dismissed.add(id);
  set({ ringing: state.ringing.filter((x) => x.id !== id), notice: notice ?? state.notice });
}
export const clearNotice = () => set({ notice: null });

/** Hang up: leave the room on the server and close the call window. */
export async function leaveCall() {
  const s = state.session;
  if (!s) return;
  set({ session: null, active: !isRoom(s.call) ? state.active.filter((x) => x.id !== s.call.id) : state.active });
  try { await crm.post(`/api/v1/calls/${s.call.id}/leave`, {}); } catch { /* the server ends it when the room empties */ }
  void refreshActive();
}

/** The call window closed itself (the call ended elsewhere). */
export function endSession(id: string) {
  if (state.session?.call.id !== id) return;
  set({ session: null, active: state.active.filter((x) => x.id !== id || isRoom(x)) });
  void refreshActive();
}
