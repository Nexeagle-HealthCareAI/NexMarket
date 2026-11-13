import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { router } from 'expo-router';
import { ApiError, OfflineError, get, post } from './api';
import { kvGet, kvJson, kvSet } from './db';
import { isOnline, syncState } from './sync';
import type { TFn } from '../i18n';

/**
 * Voice and video calls through the hospital's own LiveKit server.
 * - Office and one-to-one chats: a 1:1 "call" that rings the other side.
 * - Field team chat: a "huddle" anyone in the team can join while it is going on.
 * The server owns the call's state; the phone polls it (push is the fast path, polling the fallback).
 * Only one call runs on the phone at a time (the "current call").
 */

export interface CallPerson { userId: string; name: string; joinedAt?: string | null; leftAt?: string | null; declined?: boolean; inCall?: boolean }
export type CallStatus = 'ringing' | 'active' | 'ended' | 'missed' | 'declined';
export interface Call {
  id: string; threadId: string; threadKind: 'agent' | 'team' | 'direct'; kind: 'call' | 'huddle' | 'meeting'; video: boolean; status: CallStatus;
  startedBy: string; startedByName: string; mine: boolean; startedAt: string; answeredAt?: string | null; endedAt?: string | null; seconds?: number | null;
  people: CallPerson[];
}
export interface CallJoin { url: string; room: string; token: string }
/** What a chat message says about a call that ended (system message written by the server). */
/** A huddle or a planned meeting: people walk in and out, nobody is rung. */
export const isRoom = (kind?: string | null) => kind === 'huddle' || kind === 'meeting';
export interface CallNote { id: string; kind: 'call' | 'huddle' | 'meeting'; video: boolean; status: CallStatus; seconds?: number | null }

// ─── Small change-notification helper ───
function store<T>(initial: T) {
  let value = initial;
  const ls = new Set<() => void>();
  return {
    get: () => value,
    set(v: T) { value = v; ls.forEach((l) => { try { l(); } catch { /* keep going */ } }); },
    use(): T {
      const [, bump] = useState(0);
      useEffect(() => {
        const l = () => bump((n) => n + 1);
        ls.add(l);
        return () => { ls.delete(l); };
      }, []);
      return value;
    },
  };
}

// ─── Are calls switched on (cached on the phone; hidden until the server says yes) ───
export interface CallsStatus { on: boolean; ringSeconds: number }
const OFF: CallsStatus = { on: false, ringSeconds: 40 };
const statusStore = store<CallsStatus>((() => { try { return kvJson<CallsStatus>('callStatus', OFF); } catch { return OFF; } })());
let statusAt = 0;
export const callsStatus = () => statusStore.get();
export async function refreshCallsStatus(force = false): Promise<CallsStatus> {
  if (!force && Date.now() - statusAt < 5 * 60_000) return statusStore.get();
  try {
    const r = await get<CallsStatus>('/api/v1/calls/status');
    statusAt = Date.now();
    const v = { on: !!r.on, ringSeconds: Number(r.ringSeconds) || 40 };
    kvSet('callStatus', JSON.stringify(v));
    if (v.on !== statusStore.get().on || v.ringSeconds !== statusStore.get().ringSeconds) statusStore.set(v);
  } catch { /* offline: keep the last answer */ }
  return statusStore.get();
}
/** Calls on/off; refreshes now and then while a screen uses it. */
export function useCallsStatus(): CallsStatus {
  useEffect(() => { void refreshCallsStatus(); }, []);
  return statusStore.use();
}

// ─── The one call running on this phone ───
export interface CurrentCall { id: string; threadId: string; video: boolean; kind: 'call' | 'huddle' | 'meeting'; join: CallJoin; call: Call }
const currentStore = store<CurrentCall | null>(null);
export const currentCall = () => currentStore.get();
export const useCurrentCall = () => currentStore.use();
export const clearCurrentCall = (id?: string) => { if (!id || currentStore.get()?.id === id) currentStore.set(null); };

function setCurrent(r: { call: Call; join: CallJoin }) {
  currentStore.set({ id: r.call.id, threadId: r.call.threadId, video: r.call.video, kind: r.call.kind, join: r.join, call: r.call });
  handled.add(r.call.id);
}

export class CallError extends Error {
  constructor(public code: 'off' | 'offline' | 'busy' | 'refused' | 'failed', message: string = code) { super(message); }
}

/** Why a call can't start right now, or null. */
export async function cannotCall(): Promise<CallError | null> {
  if (!callsStatus().on) return new CallError('off');
  if (!syncState().online && !(await isOnline())) return new CallError('offline');
  return null;
}

function wrap(e: unknown): CallError {
  if (e instanceof CallError) return e;
  if (e instanceof OfflineError) return new CallError('offline');
  if (e instanceof ApiError && (e.status === 409 || e.status === 403 || e.status === 404)) return new CallError('refused', e.message);
  return new CallError('failed', e instanceof Error ? e.message : '');
}

/** Starts a call (or the Field team huddle; joins the one already going on in that chat). */
export async function startCall(threadId: string, video: boolean): Promise<CurrentCall> {
  const cur = currentCall();
  if (cur) {
    if (cur.threadId === threadId) return cur;
    throw new CallError('busy');
  }
  const why = await cannotCall();
  if (why) throw why;
  try {
    const r = await post<{ call: Call; join: CallJoin }>('/api/v1/calls', { threadId, video }, 20000);
    setCurrent(r);
    void refreshActive();
    return currentCall()!;
  } catch (e) { throw wrap(e); }
}

/** Answers a ringing call or joins a huddle. 409 = it ended, or someone else in the office answered. */
export async function joinCall(id: string): Promise<CurrentCall> {
  const cur = currentCall();
  if (cur) {
    if (cur.id === id) return cur;
    throw new CallError('busy');
  }
  if (!syncState().online && !(await isOnline())) throw new CallError('offline');
  try {
    const r = await post<{ call: Call; join: CallJoin }>(`/api/v1/calls/${id}/join`, {}, 20000);
    setCurrent(r);
    return currentCall()!;
  } catch (e) { throw wrap(e); }
}

export async function declineCall(id: string): Promise<void> {
  handled.add(id);
  dropActive(id);
  await post(`/api/v1/calls/${id}/decline`, {}, 10000).catch(() => undefined);
}

/** Hang up / leave the call screen. Safe to call twice. */
export async function leaveCall(id: string): Promise<void> {
  clearCurrentCall(id);
  dropActive(id);
  await post(`/api/v1/calls/${id}/leave`, {}, 10000).catch(() => undefined);
  void refreshActive();
}

export const fetchCall = (id: string) => get<Call>(`/api/v1/calls/${id}`);

// ─── Calls ringing for me and huddles going on (polled) ───
const activeStore = store<Call[]>([]);
export const activeCalls = () => activeStore.get();
let activeBusy = false;
export async function refreshActive(): Promise<Call[]> {
  if (activeBusy || !kvGet('agentId') || !callsStatus().on) return activeStore.get();
  activeBusy = true;
  try {
    const list = await get<Call[]>('/api/v1/calls/active');
    const next = Array.isArray(list) ? list : [];
    if (JSON.stringify(next) !== JSON.stringify(activeStore.get())) activeStore.set(next);
  } catch { /* offline: keep the last list */ } finally { activeBusy = false; }
  return activeStore.get();
}
function dropActive(id: string) {
  const list = activeStore.get();
  if (list.some((c) => c.id === id)) activeStore.set(list.filter((c) => c.id !== id));
}

/** The active calls; with poll, fetched every 5 s while the app is in front (chat list and chat screens). */
export function useActiveCalls(poll = false): Call[] {
  const status = statusStore.use();
  useEffect(() => {
    if (!poll || !status.on) return;
    let active = AppState.currentState === 'active';
    void refreshActive();
    const iv = setInterval(() => { if (active) void refreshActive(); }, 5000);
    const sub = AppState.addEventListener('change', (st) => { active = st === 'active'; if (active) void refreshActive(); });
    return () => { clearInterval(iv); sub.remove(); };
  }, [poll, status.on]);
  return activeStore.use();
}

/** A call in this chat that is going on (or a huddle still ringing), for the "Join" banner. */
export function liveCallIn(list: Call[], threadId: string): Call | null {
  return list.find((c) => c.threadId === threadId && (c.status === 'active' || (isRoom(c.kind) && c.status === 'ringing'))) ?? null;
}
/** Somebody is calling me (a 1:1 call still ringing that I didn't start). */
export const ringingForMe = (list: Call[]) => list.find((c) => c.kind === 'call' && c.status === 'ringing' && !c.mine) ?? null;
export const peopleIn = (c: Call) => c.people.filter((p) => p.inCall).length;

// ─── Incoming calls: shown once each ───
const handled = new Set<string>();
let incomingOpen: string | null = null;
export const setIncomingOpen = (id: string | null) => { incomingOpen = id; };
export const incomingShowing = () => incomingOpen;

/** Opens the incoming-call screen for this call (from a push tap, a push while open, or the poll). */
export function openIncoming(id: string, fromTap = false) {
  if (!id) return;
  const cur = currentCall();
  if (cur?.id === id) { router.push({ pathname: '/call/[id]', params: { id } }); return; }
  if (incomingOpen === id) return;
  if (!fromTap && (handled.has(id) || cur)) return;
  handled.add(id);
  router.push({ pathname: '/call/incoming', params: { id } });
}
export const markHandled = (id: string) => { handled.add(id); };

/** "Answer" pressed on the ringing notification: answers on the incoming screen (opening it first if needed). */
const answerListeners = new Set<(id: string) => void>();
export function askToAnswer(id: string) {
  if (!id) return;
  if (incomingOpen === id) { answerListeners.forEach((l) => l(id)); return; }
  handled.add(id);
  router.push({ pathname: '/call/incoming', params: { id, answer: '1' } });
}
export function onAnswerAsked(l: (id: string) => void): () => void {
  answerListeners.add(l);
  return () => { answerListeners.delete(l); };
}

// ─── Words ───
/** "3 min" / "45 sec". */
export function callLength(t: TFn, seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? t('clDurSec', { n: s }) : t('clDurMin', { n: Math.round(s / 60) });
}

/** The line for a call in the chat: "Missed video call", "Voice call · 3 min", "Huddle · 12 min", "Call declined". */
export function callNoteText(t: TFn, c: CallNote, mine: boolean): string {
  const kind = c.kind === 'meeting' ? t('mtMeeting') : c.kind === 'huddle' ? t('clHuddle') : c.video ? t('clVideoCall') : t('clVoiceCall');
  if (c.status === 'declined') return t('clDeclinedMsg');
  if (c.status === 'missed') return mine ? `${kind} · ${t('clNoAnswer')}` : c.video ? t('clMissedVideo') : t('clMissedVoice');
  return c.seconds ? `${kind} · ${callLength(t, c.seconds)}` : kind;
}
export const callEmoji = (c: { kind: string; video: boolean }) => (c.kind === 'meeting' ? '📅' : c.kind === 'huddle' ? '👥' : c.video ? '📹' : '📞');

/**
 * The chat list's preview when the server wrote it in English (e.g. "📹 Missed video call", "📞 Voice call · 3 min"):
 * the same thing in the agent's language. Anything else comes back unchanged.
 */
export function localCallPreview(t: TFn, preview: string): string {
  const m = /^\s*(📹|📞|👥|🎥|☎️?)\s*(.*)$/u.exec(preview);
  if (!m) return preview;
  const rest = m[2].toLowerCase();
  if (!/call|huddle/.test(rest)) return preview;
  const video = m[1] === '📹' || m[1] === '🎥' || rest.includes('video');
  const huddle = m[1] === '👥' || rest.includes('huddle');
  const min = /(\d+)\s*min/.exec(rest);
  const sec = /(\d+)\s*sec/.exec(rest);
  const seconds = min ? Number(min[1]) * 60 : sec ? Number(sec[1]) : 0;
  const status: CallStatus = rest.includes('missed') ? 'missed' : rest.includes('declined') ? 'declined' : 'ended';
  const note: CallNote = { id: '', kind: huddle ? 'huddle' : 'call', video, status, seconds };
  const line = rest.includes('no answer') ? `${video ? t('clVideoCall') : t('clVoiceCall')} · ${t('clNoAnswer')}` : callNoteText(t, note, false);
  return `${m[1]} ${line}`;
}

/** The toast for a call that could not start or be joined. */
export function callErrorText(t: TFn, e: unknown): string {
  const c = e instanceof CallError ? e : wrap(e);
  if (c.code === 'off') return t('clCallsOff');
  if (c.code === 'offline') return t('clOffline');
  if (c.code === 'busy') return t('clBusy');
  if (c.code === 'refused') return c.message && c.message !== 'refused' ? c.message : t('clCantJoin');
  return t('clCantStart');
}

// ─── Meetings planned in a chat ───

export interface Meeting {
  id: string; threadId: string; title: string; agenda?: string | null; startsAt: string; minutes: number; video: boolean;
  status: 'scheduled' | 'live' | 'done' | 'cancelled' | 'missed'; callId?: string | null;
  /** Being listened to for notes right now. */
  aiNotes: boolean; canJoin: boolean; createdByName: string;
}
export const meetingsIn = (threadId: string) => get<Meeting[]>(`/api/v1/meetings?threadId=${encodeURIComponent(threadId)}`);
export const meetingForCall = (callId: string) => get<Meeting>(`/api/v1/meetings/call/${callId}`);

/** Opens the meeting's room (the first person in starts it) and joins its call on this phone. */
export async function joinMeeting(id: string): Promise<CurrentCall> {
  const cur = currentCall();
  if (cur) throw new CallError('busy');
  const why = await cannotCall();
  if (why) throw why;
  let callId: string;
  try { callId = (await post<{ callId: string }>(`/api/v1/meetings/${id}/join`, {}, 20000)).callId; }
  catch (e) { throw wrap(e); }
  return joinCall(callId);
}
