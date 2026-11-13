'use client';

import { Room, RoomEvent, Track } from 'livekit-client';
import { crm } from '@/lib/sync/api-client';
import { joinCall, type Call } from '@/lib/crm/calls';

// ─── Types (the server's /api/v1/meetings) ────────────────────────────────

export interface Meeting {
  id: string; threadId: string; title: string; agenda?: string | null; startsAt: string; minutes: number; video: boolean;
  status: 'scheduled' | 'live' | 'done' | 'cancelled' | 'missed';
  callId?: string | null;
  /** Being listened to for notes right now. */
  aiNotes: boolean;
  notesStatus: 'none' | 'listening' | 'writing' | 'ready' | 'failed';
  notesError?: string | null; summary?: string | null; docId?: string | null;
  createdBy: string; createdByName: string; startedAt?: string | null; endedAt?: string | null;
  canJoin: boolean; heardMinutes: number;
  /** I am in the office, so I may plan, change, end and take AI notes. */
  office: boolean;
  /** AI notes are on and my browser is the one listening. */
  iTakeNotes: boolean;
}
export interface MeetingInput { threadId: string; title: string; agenda?: string; startsAt: string; minutes: number; video: boolean }

export const listMeetings = (threadId: string) => crm.get<Meeting[]>(`/api/v1/meetings?threadId=${encodeURIComponent(threadId)}`);
export const meetingForCall = (callId: string) => crm.get<Meeting>(`/api/v1/meetings/call/${callId}`);
export const createMeeting = (m: MeetingInput) => crm.post<Meeting>('/api/v1/meetings', m);
export const updateMeeting = (id: string, m: MeetingInput) => crm.put<Meeting>(`/api/v1/meetings/${id}`, m);
export const cancelMeeting = (id: string) => crm.post<{ ok: boolean }>(`/api/v1/meetings/${id}/cancel`, {});
export const setAiNotes = (id: string, on: boolean) => crm.post<Meeting>(`/api/v1/meetings/${id}/ai-notes`, { on });
export const finishMeeting = (id: string) => crm.post<Meeting>(`/api/v1/meetings/${id}/finish`, {});
export const retryNotes = (id: string) => crm.post<Meeting>(`/api/v1/meetings/${id}/notes/retry`, {});

/** Opens the meeting's room (the first person in starts it) and joins its call in this tab. */
export async function joinMeeting(m: Meeting, threadTitle?: string | null): Promise<void> {
  const r = await crm.post<{ callId: string }>(`/api/v1/meetings/${m.id}/join`, {});
  const call = await crm.get<Call>(`/api/v1/calls/${r.callId}`);
  await joinCall(call, threadTitle ?? m.title);
}

const dayFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
/** "Today, 4:30 pm" · "Tomorrow, 10:00 am" · "Fri 20 Nov, 4:30 pm". */
export function meetingWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
  const day = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days === -1 ? 'Yesterday' : dayFmt.format(d);
  return `${day}, ${timeFmt.format(d)}`;
}
/** The value a <input type="datetime-local"> wants, in this computer's own time. */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ─── Listening for AI notes ──────────────────────────────────────────────

export interface NotesState { listening: boolean; sent: number; failed: number; error?: string | null }

/**
 * Listens to a meeting for AI notes, in the browser of the office person who turned them on: everyone's voice in the
 * call is mixed into one sound, cut into one-minute pieces, and each piece is sent to the server to be turned into
 * text. Nothing is kept in the browser, and the server doesn't keep the sound either.
 */
export class NotesListener {
  private ctx: AudioContext | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private sources = new Map<string, MediaStreamAudioSourceNode>();
  private rec: MediaRecorder | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private pieceAt = 0;
  private queue: Promise<void> = Promise.resolve();
  private state: NotesState = { listening: false, sent: 0, failed: 0 };
  private readonly rewire = () => this.wire();

  constructor(private room: Room, private meetingId: string, private onState: (s: NotesState) => void, private pieceSeconds = 60) {}

  static supported(): boolean {
    return typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && typeof AudioContext !== 'undefined';
  }

  private set(patch: Partial<NotesState>) { this.state = { ...this.state, ...patch }; this.onState(this.state); }

  /** Connects every voice in the call (mine and everyone else's) to the one sound being listened to. */
  private wire() {
    if (!this.ctx || !this.dest) return;
    const tracks: MediaStreamTrack[] = [];
    const mine = this.room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack;
    if (mine) tracks.push(mine);
    for (const p of this.room.remoteParticipants.values())
      for (const pub of p.audioTrackPublications.values()) if (pub.track?.mediaStreamTrack) tracks.push(pub.track.mediaStreamTrack);
    const wanted = new Set(tracks.map((t) => t.id));
    for (const [id, node] of this.sources) if (!wanted.has(id)) { node.disconnect(); this.sources.delete(id); }
    for (const t of tracks) {
      if (this.sources.has(t.id)) continue;
      const node = this.ctx.createMediaStreamSource(new MediaStream([t]));
      node.connect(this.dest);
      this.sources.set(t.id, node);
    }
  }

  private newPiece() {
    if (!this.dest) return;
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(this.dest.stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32000 });
    const at = this.pieceAt;
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size > 0) parts.push(e.data); };
    // Each piece is a whole recording of its own, so the server can read it without the ones before it.
    rec.onstop = () => {
      const blob = new Blob(parts, { type: rec.mimeType || 'audio/webm' });
      if (blob.size > 2000) this.queue = this.queue.then(() => this.send(blob, at));
    };
    rec.start();
    this.rec = rec;
  }

  private async send(blob: Blob, at: number) {
    const form = new FormData();
    form.append('file', blob, blob.type.includes('mp4') ? 'meeting.m4a' : 'meeting.webm');
    form.append('at', String(Math.round(at)));
    try {
      await crm.upload(`/api/v1/meetings/${this.meetingId}/audio`, form);
      this.set({ sent: this.state.sent + 1, error: null });
    } catch (e) {
      const text = e instanceof Error ? e.message : '';
      const said = /"message":"([^"]+)"/.exec(text)?.[1];
      this.set({ failed: this.state.failed + 1, error: said ?? 'A minute of the meeting could not be turned into text.' });
    }
  }

  async start() {
    if (this.state.listening) return;
    this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => undefined);
    this.dest = this.ctx.createMediaStreamDestination();
    this.wire();
    [RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.ParticipantDisconnected]
      .forEach((e) => this.room.on(e, this.rewire));
    this.startedAt = Date.now();
    this.pieceAt = 0;
    this.newPiece();
    this.timer = setInterval(() => {
      const old = this.rec;
      this.pieceAt = (Date.now() - this.startedAt) / 1000;
      this.newPiece();
      if (old && old.state !== 'inactive') old.stop();
    }, this.pieceSeconds * 1000);
    this.set({ listening: true, error: null });
  }

  /** Stops listening and waits until the last piece has been sent. */
  async stop() {
    if (!this.state.listening) return;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    [RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.ParticipantDisconnected]
      .forEach((e) => this.room.off(e, this.rewire));
    const rec = this.rec;
    this.rec = null;
    if (rec && rec.state !== 'inactive') {
      await new Promise<void>((done) => { rec.addEventListener('stop', () => done(), { once: true }); rec.stop(); });
    }
    this.set({ listening: false });
    await this.queue;
    for (const node of this.sources.values()) node.disconnect();
    this.sources.clear();
    await this.ctx?.close().catch(() => undefined);
    this.ctx = null; this.dest = null;
  }
}
