'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ConnectionQuality, MediaDeviceFailure, Room, RoomEvent, Track,
  type Participant, type RemoteTrack, type Track as AnyTrack,
} from 'livekit-client';
import { Maximize2, Mic, MicOff, Minimize2, MonitorUp, NotebookPen, PhoneOff, Signal, Square, Video, VideoOff, Volume2 } from 'lucide-react';
import { crm } from '@/lib/sync/api-client';
import { useNow } from '@/lib/crm/live';
import { clock, endSession, leaveCall, updateCall, useCalls, type Call, type CallSession } from '@/lib/crm/calls';
import { finishMeeting, meetingForCall, NotesListener, setAiNotes, type Meeting, type NotesState } from '@/lib/crm/meetings';
import { initials } from '@/components/crm/ui';

type Phase = 'connecting' | 'connected' | 'reconnecting' | 'failed';

const REFRESH: RoomEvent[] = [
  RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed,
  RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished,
  RoomEvent.ConnectionQualityChanged, RoomEvent.ActiveSpeakersChanged, RoomEvent.AudioPlaybackStatusChanged, RoomEvent.TrackPublished,
  RoomEvent.TrackUnpublished, RoomEvent.ParticipantNameChanged,
];

function mediaMessage(e: unknown, what: 'microphone' | 'camera' | 'screen'): string {
  const f = MediaDeviceFailure.getFailure(e);
  if (what === 'screen') return "Screen sharing didn't start. Pick a screen or window to share, or allow screen sharing for this site.";
  const name = what === 'camera' ? 'camera' : 'microphone';
  if (f === MediaDeviceFailure.PermissionDenied) return `The ${name} is blocked for this site. Click the lock icon in the address bar, allow the ${name}, then press "Try again".`;
  if (f === MediaDeviceFailure.NotFound) return `No ${name} was found on this computer.`;
  if (f === MediaDeviceFailure.DeviceInUse) return `The ${name} is being used by another app. Close it and press "Try again".`;
  return `Couldn't turn on the ${name}.`;
}

const ENDED_TEXT: Record<string, string> = { ended: 'Call ended', missed: 'No answer', declined: 'Call declined' };

export default function CallWindow({ session }: { session: CallSession }) {
  const { call, join } = session;
  const { ringSeconds } = useCalls();
  const [room, setRoom] = useState<Room | null>(null);
  const [phase, setPhase] = useState<Phase>('connecting');
  const [tick, setTick] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow(1000);
  const hadRemote = useRef(false);
  const leaving = useRef(false);
  // A huddle or a meeting: a room people walk into, not a call that rings.
  const isHuddle = call.kind === 'huddle' || call.kind === 'meeting';
  const isMeeting = call.kind === 'meeting';
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [notes, setNotes] = useState<NotesState>({ listening: false, sent: 0, failed: 0 });
  const [notesBusy, setNotesBusy] = useState(false);
  const listener = useRef<NotesListener | null>(null);

  // Connect once; leave the room when the window closes.
  useEffect(() => {
    let cancelled = false;
    const r = new Room({ adaptiveStream: true, dynacast: true });
    const bump = () => setTick((n) => n + 1);
    REFRESH.forEach((e) => r.on(e, bump));
    r.on(RoomEvent.ParticipantConnected, () => { hadRemote.current = true; });
    // A 1:1 call ends when the other person leaves.
    r.on(RoomEvent.ParticipantDisconnected, () => {
      if (!isHuddle && hadRemote.current && r.remoteParticipants.size === 0 && !leaving.current) {
        leaving.current = true;
        setEnded('Call ended');
        setTimeout(() => void leaveCall(), 1500);
      }
    });
    r.on(RoomEvent.Reconnecting, () => setPhase('reconnecting'));
    r.on(RoomEvent.Reconnected, () => setPhase('connected'));
    r.on(RoomEvent.Disconnected, () => {
      if (cancelled || leaving.current) return;
      leaving.current = true;
      setEnded('Disconnected');
      setTimeout(() => void leaveCall(), 1500);
    });
    (async () => {
      try {
        await r.connect(join.url, join.token);
      } catch {
        if (!cancelled) setPhase('failed');
        return;
      }
      if (cancelled) { void r.disconnect(); return; }
      if (r.remoteParticipants.size > 0) hadRemote.current = true;
      setRoom(r);
      setPhase('connected');
      setConnectedAt(Date.now());
      try { await r.localParticipant.setMicrophoneEnabled(true); }
      catch (e) { if (!cancelled) setMediaError(mediaMessage(e, 'microphone')); }
      if (session.video) {
        try { await r.localParticipant.setCameraEnabled(true); }
        catch (e) { if (!cancelled) setMediaError((m) => m ?? mediaMessage(e, 'camera')); }
      }
    })();
    return () => {
      cancelled = true;
      r.removeAllListeners();
      void r.disconnect();
    };
    // The window is keyed by the call id: connect exactly once per call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the call's status fresh: ringing → answered, or ended / missed / declined elsewhere.
  const ringingNow = call.status === 'ringing';
  useEffect(() => {
    if (ended) return;
    const t = setInterval(async () => {
      try {
        const c = await crm.get<Call>(`/api/v1/calls/${call.id}`);
        updateCall(c);
        if (c.status === 'ended' || c.status === 'missed' || c.status === 'declined') {
          leaving.current = true;
          setEnded(ENDED_TEXT[c.status]);
          setTimeout(() => endSession(c.id), 2000);
        } else if (c.status === 'ringing' && c.mine && Date.now() - new Date(c.startedAt).getTime() > (ringSeconds + 10) * 1000) {
          leaving.current = true;
          setEnded('No answer');
          setTimeout(() => void leaveCall(), 1500);
        }
      } catch { /* try again */ }
    }, ringingNow ? 2000 : 5000);
    return () => clearInterval(t);
  }, [call.id, ringingNow, ended, ringSeconds]);

  // A meeting: its name, and whether AI notes are on (everyone in the call must be able to see that).
  useEffect(() => {
    if (!isMeeting || ended) return;
    let live = true;
    const load = () => meetingForCall(call.id).then((m) => { if (live) setMeeting(m); }).catch(() => undefined);
    void load();
    const t = setInterval(load, 6000);
    return () => { live = false; clearInterval(t); };
  }, [isMeeting, call.id, ended]);

  // My browser is the one listening: start when AI notes are on and I turned them on, stop when someone turns them off.
  const iListen = !!meeting?.aiNotes && !!meeting.iTakeNotes;
  useEffect(() => {
    if (!room || !meeting) return;
    if (iListen && !listener.current && NotesListener.supported()) {
      const l = new NotesListener(room, meeting.id, setNotes);
      listener.current = l;
      void l.start().catch(() => setNotes((n) => ({ ...n, error: 'This browser could not start listening for AI notes.' })));
    } else if (!iListen && listener.current) {
      const l = listener.current;
      listener.current = null;
      void l.stop();
    }
    // Only the on/off state matters here, not every refresh of the meeting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, iListen, meeting?.id]);
  // The window closing for any reason: send what was heard so far.
  useEffect(() => () => { void listener.current?.stop(); listener.current = null; }, []);

  const toggleNotes = async () => {
    if (!meeting || notesBusy) return;
    setNotesBusy(true);
    try { setMeeting(await setAiNotes(meeting.id, !meeting.aiNotes)); setMediaError(null); }
    catch (e) { setMediaError(/"message":"([^"]+)"/.exec(e instanceof Error ? e.message : '')?.[1] ?? "AI notes couldn't be changed just now."); }
    finally { setNotesBusy(false); }
  };
  const endForAll = async () => {
    if (!meeting || notesBusy) return;
    setNotesBusy(true);
    leaving.current = true;
    try {
      // Send the last piece first, so the notes include the end of the meeting.
      if (listener.current) { const l = listener.current; listener.current = null; await l.stop(); }
      await finishMeeting(meeting.id);
    } catch { /* leaving still works */ }
    void leaveCall();
  };

  // Escape leaves full screen.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const lp = room?.localParticipant ?? null;
  const micOn = !!lp?.isMicrophoneEnabled;
  const camOn = !!lp?.isCameraEnabled;
  const sharing = !!lp?.isScreenShareEnabled;
  const remotes = room ? [...room.remoteParticipants.values()] : [];
  const canShare = typeof navigator !== 'undefined' && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices;
  const quality = lp?.connectionQuality;
  const weak = phase === 'reconnecting' || quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost;
  const audioBlocked = !!room && !room.canPlaybackAudio;

  const toggle = async (what: 'mic' | 'cam' | 'screen') => {
    if (!lp) return;
    setBusy(true);
    try {
      if (what === 'mic') await lp.setMicrophoneEnabled(!micOn);
      else if (what === 'cam') await lp.setCameraEnabled(!camOn);
      else await lp.setScreenShareEnabled(!sharing, { audio: false });
      setMediaError(null);
    } catch (e) {
      // Cancelling the screen picker isn't an error worth showing.
      if (!(what === 'screen' && e instanceof Error && e.name === 'NotAllowedError')) setMediaError(mediaMessage(e, what === 'mic' ? 'microphone' : what === 'cam' ? 'camera' : 'screen'));
    } finally { setBusy(false); setTick((n) => n + 1); }
  };
  const retryMedia = async () => {
    if (!lp) return;
    setMediaError(null);
    try { await lp.setMicrophoneEnabled(true); } catch (e) { setMediaError(mediaMessage(e, 'microphone')); return; }
    if (session.video || camOn) { try { await lp.setCameraEnabled(true); } catch (e) { setMediaError(mediaMessage(e, 'camera')); } }
    setTick((n) => n + 1);
  };
  const hangUp = async () => {
    leaving.current = true;
    // I was the one listening: send the last piece and tell everyone AI notes are off, then leave.
    if (listener.current && meeting) {
      const l = listener.current;
      listener.current = null;
      try { await l.stop(); await setAiNotes(meeting.id, false); } catch { /* the meeting's end closes it anyway */ }
    }
    void leaveCall();
  };

  // What the header says.
  const other = call.people.find((p) => p.userId !== call.startedBy)?.name;
  const title = isMeeting ? (meeting?.title ?? session.threadTitle ?? 'Meeting') : isHuddle ? 'Huddle · Field team' : call.mine ? (session.threadTitle ?? other ?? 'Call') : call.startedByName;
  const started = call.answeredAt ? new Date(call.answeredAt).getTime() : connectedAt;
  const status = ended ?? (phase === 'connecting' ? 'Connecting…' : phase === 'failed' ? "Couldn't connect to the call server"
    : phase === 'reconnecting' ? 'Reconnecting…'
      : !isHuddle && call.status === 'ringing' && remotes.length === 0 ? 'Ringing…'
        : !isHuddle && remotes.length === 0 ? 'Waiting for the other person…'
          : started ? clock((now - started) / 1000) : '');

  // Tiles: for a 1:1 call the other person fills the window and I'm a small preview; a huddle is a grid.
  const tiles: { p: Participant; local: boolean }[] = [...remotes.map((p) => ({ p, local: false })), ...(lp ? [{ p: lp as Participant, local: true }] : [])];
  const oneToOne = !isHuddle && remotes.length <= 1;
  const cols = tiles.length <= 1 ? 1 : tiles.length <= 4 ? 2 : tiles.length <= 9 ? 3 : 4;

  return (
    <section className={`cl-win${expanded ? ' is-full' : ''}`} role="region" aria-label={isMeeting ? `Meeting: ${title}` : `${isHuddle ? 'Huddle' : call.video ? 'Video call' : 'Voice call'} with ${title}`}>
      <header className="cl-head">
        <span className="cl-head-text">
          <strong>{title}</strong>
          <span className="cl-status" aria-live="polite">{status}</span>
        </span>
        {weak && !ended && <span className="cl-weak" title="Weak connection: video may freeze"><Signal size={14} aria-hidden /> Weak connection</span>}
        <button type="button" className="cl-icon" onClick={() => setExpanded((x) => !x)} aria-label={expanded ? 'Exit full screen' : 'Full screen'} title={expanded ? 'Exit full screen' : 'Full screen'}>
          {expanded ? <Minimize2 size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />}
        </button>
      </header>

      {meeting?.aiNotes && !ended && (
        <div className="cl-notes" role="status">
          <span className="cl-notes-dot" aria-hidden />
          <span>
            <strong>AI notes are on.</strong> What is said is being turned into text for the minutes. The sound is not kept.
            {meeting.iTakeNotes && notes.listening ? ` ${notes.sent} min sent${notes.failed ? `, ${notes.failed} missed` : ''}.` : ''}
            {meeting.iTakeNotes && !NotesListener.supported() ? ' This browser cannot listen: use Chrome or Edge.' : ''}
          </span>
        </div>
      )}
      {meeting?.iTakeNotes && notes.error && !ended && <div className="cl-alert" role="alert"><span>{notes.error}</span></div>}

      <div className={`cl-stage${oneToOne ? ' is-one' : ''}`} style={oneToOne ? undefined : { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {oneToOne ? (
          <>
            {remotes[0] ? <Tile p={remotes[0]} local={false} tick={tick} />
              : <div className="cl-tile is-wait"><span className="cl-avatar is-big" aria-hidden>{initials(title)}</span><span className="cl-wait-text">{status}</span></div>}
            {lp && <div className="cl-pip"><Tile p={lp} local tick={tick} small /></div>}
          </>
        ) : tiles.map(({ p, local }) => <Tile key={p.identity} p={p} local={local} tick={tick} />)}
        {/* Everyone's voice, played in hidden audio elements. */}
        {remotes.map((p) => [...p.audioTrackPublications.values()].map((pub) => pub.track && <AudioTrack key={pub.trackSid} track={pub.track as RemoteTrack} />))}
      </div>

      {(mediaError || audioBlocked) && (
        <div className="cl-alert" role="alert">
          {mediaError && <><span>{mediaError}</span><button type="button" className="cl-link" onClick={() => void retryMedia()}>Try again</button></>}
          {!mediaError && audioBlocked && <><span>Your browser paused the sound.</span><button type="button" className="cl-link" onClick={() => void room?.startAudio().then(() => setTick((n) => n + 1))}><Volume2 size={14} aria-hidden /> Turn sound on</button></>}
        </div>
      )}

      <footer className="cl-bar">
        <button type="button" className={`cl-ctl${micOn ? '' : ' is-off'}`} onClick={() => void toggle('mic')} disabled={!lp || busy}
          aria-pressed={!micOn} aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'} title={micOn ? 'Mute' : 'Unmute'}>
          {micOn ? <Mic size={18} aria-hidden /> : <MicOff size={18} aria-hidden />}
        </button>
        <button type="button" className={`cl-ctl${camOn ? '' : ' is-off'}`} onClick={() => void toggle('cam')} disabled={!lp || busy}
          aria-pressed={camOn} aria-label={camOn ? 'Turn camera off' : 'Turn camera on'} title={camOn ? 'Camera off' : 'Camera on'}>
          {camOn ? <Video size={18} aria-hidden /> : <VideoOff size={18} aria-hidden />}
        </button>
        {canShare && (
          <button type="button" className={`cl-ctl${sharing ? ' is-on' : ''}`} onClick={() => void toggle('screen')} disabled={!lp || busy}
            aria-pressed={sharing} aria-label={sharing ? 'Stop sharing your screen' : 'Share your screen'} title={sharing ? 'Stop sharing' : 'Share screen'}>
            <MonitorUp size={18} aria-hidden />
          </button>
        )}
        {meeting?.office && (
          <button type="button" className={`cl-ctl is-wide${meeting.aiNotes ? ' is-on' : ''}`} onClick={() => void toggleNotes()} disabled={!lp || notesBusy}
            aria-pressed={meeting.aiNotes} title={meeting.aiNotes ? 'Stop AI notes' : 'Everyone in the meeting is told. The sound is not kept.'}>
            <NotebookPen size={17} aria-hidden /> {meeting.aiNotes ? 'Stop AI notes' : 'AI notes'}
          </button>
        )}
        <button type="button" className="cl-ctl is-hangup" onClick={() => void hangUp()} aria-label={isMeeting ? 'Leave the meeting' : isHuddle ? 'Leave huddle' : 'Hang up'} title={isMeeting ? 'Leave the meeting' : isHuddle ? 'Leave huddle' : 'Hang up'}>
          <PhoneOff size={18} aria-hidden />
        </button>
        {meeting?.office && (
          <button type="button" className="cl-ctl is-wide is-end" onClick={() => void endForAll()} disabled={notesBusy} title="Ends the meeting for everyone">
            <Square size={14} aria-hidden /> End for all
          </button>
        )}
      </footer>
    </section>
  );
}

/** One person: their screen share or camera if on, otherwise their initials. */
function Tile({ p, local, small }: { p: Participant; local: boolean; tick: number; small?: boolean }) {
  const screen = p.getTrackPublication(Track.Source.ScreenShare);
  const cam = p.getTrackPublication(Track.Source.Camera);
  const pub = screen?.track && !screen.isMuted ? screen : cam?.track && !cam.isMuted ? cam : null;
  const name = local ? 'You' : p.name || p.identity;
  const isScreen = !!pub && pub === screen;
  return (
    <div className={`cl-tile${p.isSpeaking ? ' is-speaking' : ''}${small ? ' is-small' : ''}`}>
      {pub?.track ? <VideoTrack track={pub.track} mirror={local && !isScreen} contain={isScreen} />
        : <span className={`cl-avatar${small ? '' : ' is-big'}`} aria-hidden>{initials(local ? p.name || 'You' : name)}</span>}
      <span className="cl-name">
        {!p.isMicrophoneEnabled && <MicOff size={12} aria-label="Muted" />}
        {name}{isScreen ? ' · screen' : ''}
      </span>
    </div>
  );
}

function VideoTrack({ track, mirror, contain }: { track: AnyTrack; mirror?: boolean; contain?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track]);
  return <video ref={ref} className={`cl-video${mirror ? ' is-mirror' : ''}${contain ? ' is-contain' : ''}`} autoPlay playsInline muted />;
}

function AudioTrack({ track }: { track: RemoteTrack }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track]);
  return <audio ref={ref} autoPlay hidden />;
}
