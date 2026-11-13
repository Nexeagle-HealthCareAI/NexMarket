import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { BackHandler, PermissionsAndroid, Platform, Pressable, View, type LayoutChangeEvent } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useKeepAwake } from 'expo-keep-awake';
import { AndroidAudioTypePresets, AudioSession, VideoTrack, type TrackReference } from '@livekit/react-native';
import { AudioPresets, ConnectionQuality, ConnectionState, Room, RoomEvent, Track, VideoPresets, type Participant } from 'livekit-client';
import { Avatar, T, toast } from '../../components/ui';
import { Icon, type IconName } from '../../components/Icon';
import { useSession } from '../../lib/session';
import { cachedThreads, isOfficeUser } from '../../lib/chat';
import { callErrorText, callLength, callsStatus, currentCall, fetchCall, isRoom, joinCall, leaveCall, meetingForCall, type Call, type CurrentCall, type Meeting } from '../../lib/calls';
import { C } from '../../theme';
import { holdOverLock } from '../../../modules/lock-screen';

type EndWhy = 'hangup' | 'remoteLeft' | 'declined' | 'missed' | 'ended' | 'failed' | 'mic';
type TFn = ReturnType<typeof useSession>['t'];

/** Weak 2G/3G/4G: video starts small (360p, 15 fps, a 180p layer for weak receivers) and voice uses the speech preset. */
const VIDEO_360 = { width: 640, height: 360, frameRate: 15 };

async function askPermissions(video: boolean): Promise<{ mic: boolean; cam: boolean }> {
  if (Platform.OS !== 'android') return { mic: true, cam: video };
  const P = PermissionsAndroid.PERMISSIONS;
  const want = [P.RECORD_AUDIO, ...(video ? [P.CAMERA] : []), ...(Number(Platform.Version) >= 31 ? [P.BLUETOOTH_CONNECT] : [])];
  try {
    const r = await PermissionsAndroid.requestMultiple(want);
    const ok = (p: string) => r[p as keyof typeof r] === PermissionsAndroid.RESULTS.GRANTED;
    return { mic: ok(P.RECORD_AUDIO), cam: video && ok(P.CAMERA) };
  } catch {
    return { mic: false, cam: false };
  }
}

/** Loudspeaker or the phone's earpiece (a headset or Bluetooth is used automatically when connected). */
async function routeAudio(speaker: boolean) {
  try {
    if (Platform.OS === 'ios') await AudioSession.selectAudioOutput(speaker ? 'force_speaker' : 'default');
    else await AudioSession.selectAudioOutput(speaker ? 'speaker' : 'earpiece');
  } catch { /* that output isn't there (e.g. a tablet with no earpiece) */ }
}

const camRef = (p: Participant): TrackReference | null => {
  const pub = p.getTrackPublication(Track.Source.Camera);
  if (!pub || !pub.track || pub.isMuted) return null;
  return { participant: p, publication: pub, source: Track.Source.Camera };
};
const nameOf = (p: Participant) => p.name || p.identity;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * The call itself, through the hospital's LiveKit server.
 * 1:1 video: the other person full screen, me small in the corner. Voice (or video off): big avatars with a ring while speaking.
 * Huddle: up to 6 tiles and "N more". Leaving this screen leaves the call.
 */
export default function CallScreen() {
  useKeepAwake();
  const { t, agent } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [cur, setCur] = useState<CurrentCall | null>(() => (currentCall()?.id === id ? currentCall() : null));
  const [server, setServer] = useState<Call | null>(cur?.call ?? null);
  const [room, setRoom] = useState<Room | null>(null);
  const roomRef = useRef<Room | null>(null);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [front, setFront] = useState(true);
  const [speaker, setSpeaker] = useState(false);
  const [weak, setWeak] = useState(false);
  const [ended, setEnded] = useState<{ why: EndWhy; secs: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const talkingSince = useRef<number | null>(null);
  const hadRemote = useRef(false);
  const done = useRef(false);
  const mounted = useRef(true);
  const openedAt = useRef(Date.now());
  const mineRef = useRef(false);
  mineRef.current = (server ?? cur?.call)?.mine ?? false;
  const kind = cur?.kind ?? server?.kind ?? 'call';
  // A meeting: its name, and whether AI notes are on (everyone in it must be able to see that).
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  useEffect(() => {
    if (kind !== 'meeting' || !id) return;
    let live = true;
    const load = () => meetingForCall(id).then((m) => { if (live) setMeeting(m); }).catch(() => undefined);
    void load();
    const timer = setInterval(load, 6000);
    return () => { live = false; clearInterval(timer); };
  }, [kind, id]);
  const video = cur?.video ?? server?.video ?? false;

  const goBack = () => { if (!mounted.current) return; if (router.canGoBack()) router.back(); else router.replace('/chat'); };

  // A call answered on the lock screen carries on over it; the rest of the app still needs the phone unlocked.
  useEffect(() => holdOverLock(), []);

  /** Ends the call on this phone: disconnect, tell the server, show "Call ended · 3 min" briefly, then close. */
  const finish = useCallback((why: EndWhy) => {
    if (done.current) return;
    done.current = true;
    const secs = talkingSince.current ? (Date.now() - talkingSince.current) / 1000 : 0;
    const r = roomRef.current;
    roomRef.current = null;
    void r?.disconnect().catch(() => undefined);
    void AudioSession.stopAudioSession().catch(() => undefined);
    void leaveCall(id);
    setEnded({ why, secs });
    setTimeout(goBack, why === 'hangup' ? 1300 : 2300);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Join (if the incoming screen or a banner didn't already), ask for the mic/camera, connect, publish.
  useEffect(() => {
    mounted.current = true;
    let alive = true;
    (async () => {
      let c = currentCall()?.id === id ? currentCall() : null;
      if (!c) {
        try { c = await joinCall(id); } catch (e) {
          if (alive) { toast(callErrorText(t, e), { ms: 3500 }); done.current = true; goBack(); }
          return;
        }
      }
      if (!alive) return;
      setCur(c);
      setServer(c.call);
      const perm = await askPermissions(c.video);
      if (!alive) return;
      if (!perm.mic) { toast(t('clMicDenied'), { ms: 4000 }); finish('mic'); return; }
      if (c.video && !perm.cam) toast(t('clCamDenied'), { ms: 3500 });

      try {
        await AudioSession.configureAudio({
          android: {
            preferredOutputList: c.video ? ['bluetooth', 'headset', 'speaker', 'earpiece'] : ['bluetooth', 'headset', 'earpiece', 'speaker'],
            audioTypeOptions: AndroidAudioTypePresets.communication,
          },
          ios: { defaultOutput: c.video ? 'speaker' : 'earpiece' },
        });
        await AudioSession.startAudioSession();
      } catch { /* the call still works with the phone's default route */ }

      const r = new Room({
        adaptiveStream: { pixelDensity: 'screen' },
        dynacast: true,
        disconnectOnPageLeave: false,
        stopLocalTrackOnUnpublish: true,
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        videoCaptureDefaults: { resolution: VIDEO_360, facingMode: 'user' },
        publishDefaults: {
          audioPreset: AudioPresets.speech, dtx: true, red: true,
          videoEncoding: { maxBitrate: 350_000, maxFramerate: 15 },
          simulcast: true, videoSimulcastLayers: [VideoPresets.h180],
          degradationPreference: 'maintain-framerate',
        },
      });
      roomRef.current = r;
      const remoteGone = () => {
        // 1:1: when the other side leaves, the call is over (a short wait covers a phone switching towers).
        if (c!.kind !== 'call' || r.remoteParticipants.size > 0 || !hadRemote.current) return;
        setTimeout(() => { if (roomRef.current === r && r.remoteParticipants.size === 0) finish('remoteLeft'); }, 3000);
      };
      const someoneHere = () => {
        if (r.remoteParticipants.size > 0) {
          hadRemote.current = true;
          talkingSince.current ??= Date.now();
        }
      };
      r.on(RoomEvent.ParticipantConnected, () => { someoneHere(); bump(); })
        .on(RoomEvent.ParticipantDisconnected, () => { remoteGone(); bump(); })
        .on(RoomEvent.ConnectionStateChanged, () => bump())
        .on(RoomEvent.TrackSubscribed, () => bump())
        .on(RoomEvent.TrackUnsubscribed, () => bump())
        .on(RoomEvent.TrackMuted, () => bump())
        .on(RoomEvent.TrackUnmuted, () => bump())
        .on(RoomEvent.LocalTrackPublished, () => bump())
        .on(RoomEvent.LocalTrackUnpublished, () => bump())
        .on(RoomEvent.ActiveSpeakersChanged, () => bump())
        .on(RoomEvent.ConnectionQualityChanged, (q, p) => {
          if (p === r.localParticipant) setWeak(q === ConnectionQuality.Poor || q === ConnectionQuality.Lost);
        })
        .on(RoomEvent.Disconnected, () => { if (roomRef.current === r) finish('ended'); });
      setRoom(r);

      try {
        await r.connect(c.join.url, c.join.token, { autoSubscribe: true, peerConnectionTimeout: 25_000, websocketTimeout: 25_000, maxRetries: 2 });
      } catch {
        if (alive && roomRef.current === r) { toast(t('clCantConnect'), { ms: 3500 }); finish('failed'); }
        return;
      }
      if (!alive || roomRef.current !== r) { void r.disconnect(); return; }
      if (isRoom(c.kind)) talkingSince.current = Date.now();
      someoneHere();
      try { await r.localParticipant.setMicrophoneEnabled(true); } catch { setMicOn(false); toast(t('clMicDenied'), { ms: 4000 }); }
      // Voice calls and huddles without video never publish the camera.
      if (c.video && perm.cam) {
        try { await r.localParticipant.setCameraEnabled(true, { resolution: VIDEO_360, facingMode: 'user' }); setCamOn(true); } catch { toast(t('clCamDenied'), { ms: 3500 }); }
      }
      setSpeaker(c.video);
      void routeAudio(c.video);
      bump();
    })();
    return () => {
      alive = false;
      mounted.current = false;
      // Left the screen without hanging up (Back, or another screen replaced it): leave the call too.
      if (!done.current) {
        done.current = true;
        const r = roomRef.current;
        roomRef.current = null;
        void r?.disconnect().catch(() => undefined);
        void AudioSession.stopAudioSession().catch(() => undefined);
        void leaveCall(id);
      }
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The server's view (who joined, ringing, declined, ended) every 3 s; plus the ring timeout for my own 1:1 call.
  useEffect(() => {
    const iv = setInterval(() => {
      setNow(Date.now());
      if (done.current) return;
      // Only my own outgoing call times out; after answering, a slow connect on 2G is not "no answer".
      if (kind === 'call' && mineRef.current && !hadRemote.current && Date.now() - openedAt.current > (callsStatus().ringSeconds + 10) * 1000) finish('missed');
    }, 1000);
    const poll = setInterval(() => {
      if (done.current) return;
      fetchCall(id).then((c) => {
        if (done.current || !mounted.current) return;
        setServer(c);
        if (c.status === 'declined') finish('declined');
        else if (c.status === 'missed') finish('missed');
        else if (c.status === 'ended') finish('ended');
      }).catch(() => undefined);
    }, 3000);
    return () => { clearInterval(iv); clearInterval(poll); };
  }, [id, kind, finish]);

  // Android Back hangs up (the call can't keep running without this screen).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (done.current) return false; finish('hangup'); return true; });
    return () => sub.remove();
  }, [finish]);

  const lp = room?.localParticipant;
  const toggleMic = () => {
    if (!lp) return;
    const next = !micOn;
    setMicOn(next);
    lp.setMicrophoneEnabled(next).catch(() => setMicOn(!next));
  };
  const toggleCam = () => {
    if (!lp) return;
    const next = !camOn;
    setCamOn(next);
    lp.setCameraEnabled(next, next ? { resolution: VIDEO_360, facingMode: front ? 'user' : 'environment' } : undefined).then(() => bump()).catch(() => { setCamOn(!next); toast(t('clCamDenied')); });
  };
  const flip = async () => {
    const track = lp?.getTrackPublication(Track.Source.Camera)?.track?.mediaStreamTrack as (MediaStreamTrack & { _switchCamera?: () => void }) | undefined;
    if (!track) return;
    try {
      if (track._switchCamera) track._switchCamera();
      else await track.applyConstraints({ facingMode: front ? 'environment' : 'user' });
      setFront(!front);
    } catch { /* one camera only */ }
  };
  const toggleSpeaker = () => { const next = !speaker; setSpeaker(next); void routeAudio(next); };

  // ─── What to show ───
  const remotes: Participant[] = room ? [...room.remoteParticipants.values()] : [];
  const state = room?.state ?? ConnectionState.Connecting;
  const myId = agent?.agentId;
  const thread = cachedThreads().find((x) => x.id === (cur?.threadId ?? server?.threadId));
  const otherName = remotes[0] ? nameOf(remotes[0])
    : server ? (server.mine ? server.people.find((p) => p.userId !== myId)?.name ?? threadName(t, thread) : server.startedByName) : threadName(t, thread);
  const title = kind === 'meeting' ? meeting?.title ?? t('mtMeeting') : kind === 'huddle' ? t('clTeamHuddle') : otherName;
  const secs = talkingSince.current ? (now - talkingSince.current) / 1000 : 0;

  let line: string;
  if (ended) line = endedLine(t, ended.why, ended.secs);
  else if (!room || state === ConnectionState.Connecting) line = t('clConnecting');
  else if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) line = t('clReconnecting');
  else if (kind === 'call' && remotes.length === 0) line = server?.mine ? (server.status === 'ringing' ? t('clRinging') : t('clCalling')) : t('clConnecting');
  else if (isRoom(kind) && remotes.length === 0) line = t('clWaiting');
  else line = mmss(secs);
  const warn = !ended && (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting);

  const remoteVideo = kind === 'call' && remotes[0] ? camRef(remotes[0]) : null;
  const myVideo = lp && camOn ? camRef(lp) : null;
  const full = !!remoteVideo && !ended;

  return (
    <View style={{ flex: 1, backgroundColor: C.ink }}>
      <StatusBar style="light" />
      {full ? <VideoTrack trackRef={remoteVideo!} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} objectFit="cover" zOrder={0} /> : null}
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom', 'left', 'right']}>
        {/* Name and state */}
        <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, alignItems: 'center', gap: 4, backgroundColor: full ? 'rgba(14,21,37,0.55)' : 'transparent' }}
          accessible accessibilityLiveRegion="polite" accessibilityLabel={`${title}. ${line}`}>
          <T style={{ color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center' }} numberOfLines={1}>{title}</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {warn ? <Icon name="alert" size={16} color="#ffd38a" /> : null}
            <T style={{ color: warn ? '#ffd38a' : ended ? C.mint : C.sideText, fontSize: 17, fontWeight: '700', textAlign: 'center' }}>{line}</T>
          </View>
          {meeting?.aiNotes && !ended ? (
            <View accessible accessibilityRole="alert" accessibilityLabel={t('mtNotesOn')}
              style={{ marginTop: 6, flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: '#3b1d12', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#ff6b4a', marginTop: 5 }} />
              <T style={{ color: '#ffd9c7', fontSize: 14, lineHeight: 19, flexShrink: 1 }}>{t('mtNotesOn')}</T>
            </View>
          ) : null}
          {weak && camOn && !ended && !warn ? (
            <Pressable onPress={toggleCam} accessibilityRole="button" accessibilityLabel={t('clWeak')}
              style={{ marginTop: 6, flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: C.warnSoft, borderRadius: 16, paddingHorizontal: 12, minHeight: 36 }}>
              <Icon name="videoOff" size={16} color={C.warnInk} />
              <T style={{ color: C.warnInk, fontWeight: '700', fontSize: 14, flexShrink: 1 }}>{t('clWeak')}</T>
            </Pressable>
          ) : null}
        </View>

        {/* Middle: avatars, or the huddle grid */}
        <View style={{ flex: 1 }}>
          {isRoom(kind) && room ? (
            <HuddleGrid room={room} remotes={remotes} t={t} camOn={camOn} front={front} />
          ) : !full ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <SpeakingAvatar name={otherName} size={150} speaking={!!remotes[0]?.isSpeaking} photo={thread?.kind === 'direct' ? thread.photoUrl : null} />
              {remotes[0] && !remotes[0].isMicrophoneEnabled ? <MutedTag t={t} /> : null}
            </View>
          ) : null}
          {kind === 'call' && myVideo && !ended ? (
            <View style={{ position: 'absolute', top: 8, right: 14, width: 108, height: 150, borderRadius: 16, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)', backgroundColor: C.ink2 }}
              accessibilityLabel={t('clYou')}>
              <VideoTrack trackRef={myVideo} style={{ flex: 1 }} objectFit="cover" mirror={front} zOrder={1} />
            </View>
          ) : null}
        </View>

        {/* Controls */}
        {!ended ? (
          <View style={{ paddingHorizontal: 12, paddingBottom: 18, paddingTop: 12, gap: 18, backgroundColor: full ? 'rgba(14,21,37,0.55)' : 'transparent' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-evenly' }}>
              <Ctl icon={micOn ? 'mic' : 'micOff'} label={micOn ? t('clMute') : t('clUnmute')} a11y={micOn ? t('clMuteA11y') : t('clUnmuteA11y')} on={!micOn} onPress={toggleMic} disabled={!lp} />
              {video ? <Ctl icon={camOn ? 'video' : 'videoOff'} label={camOn ? t('clVideoOff') : t('clVideoOn')} a11y={camOn ? t('clVideoOnA11y') : t('clVideoOffA11y')} on={!camOn} onPress={toggleCam} disabled={!lp} /> : null}
              {video && camOn ? <Ctl icon="cameraFlip" label={t('clFlip')} a11y={t('clFlipA11y')} onPress={() => void flip()} /> : null}
              <Ctl icon={speaker ? 'volume' : 'speaker'} label={speaker ? t('clSpeaker') : t('clEarpiece')} a11y={speaker ? t('clSpeakerOnA11y') : t('clSpeakerOffA11y')} on={speaker} onPress={toggleSpeaker} />
            </View>
            <View style={{ alignItems: 'center', gap: 6 }}>
              <Pressable onPress={() => finish('hangup')} accessibilityRole="button" accessibilityLabel={t('clHangUpA11y')} hitSlop={8}
                style={({ pressed }) => [{ width: 72, height: 72, borderRadius: 36, backgroundColor: C.bad, alignItems: 'center', justifyContent: 'center', elevation: 6 }, pressed && { opacity: 0.8 }]}>
                <Icon name="phoneOff" size={32} color="#fff" strokeWidth={2.4} />
              </Pressable>
              <T style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{t('clHangUp')}</T>
            </View>
          </View>
        ) : <View style={{ height: 120 }} />}
      </SafeAreaView>
    </View>
  );
}

function threadName(t: TFn, th?: { kind: string; title: string }) {
  if (!th) return '';
  if (th.kind === 'team') return t('chatTeam');
  if (th.kind === 'agent' && !isOfficeUser()) return t('chatOffice');
  return th.title;
}

function endedLine(t: TFn, why: EndWhy, secs: number) {
  if (why === 'declined') return t('clDeclinedMsg');
  if (why === 'missed') return t('clNoAnswer');
  if (why === 'failed') return t('clCantConnect');
  if (why === 'mic') return t('clEnded');
  return secs >= 1 ? t('clEndedDur', { d: callLength(t, secs) }) : t('clEnded');
}

/** 64 px round control with its label underneath. `on` = highlighted (muted, video off, loudspeaker). */
function Ctl({ icon, label, a11y, onPress, on, disabled }: { icon: IconName; label: string; a11y: string; onPress: () => void; on?: boolean; disabled?: boolean }) {
  return (
    <View style={{ alignItems: 'center', gap: 6, width: 78 }}>
      <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ disabled: !!disabled, selected: !!on }}
        style={({ pressed }) => [{ width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? '#ffffff' : 'rgba(255,255,255,0.14)',
          borderWidth: 1, borderColor: on ? '#ffffff' : 'rgba(255,255,255,0.25)', opacity: disabled ? 0.45 : 1 }, pressed && { opacity: 0.7 }]}>
        <Icon name={icon} size={28} color={on ? C.ink : '#fff'} />
      </Pressable>
      <T style={{ color: '#fff', fontSize: 14, fontWeight: '700', textAlign: 'center' }} numberOfLines={1}>{label}</T>
    </View>
  );
}

function SpeakingAvatar({ name, size, speaking, photo }: { name: string; size: number; speaking: boolean; photo?: string | null }) {
  return (
    <View style={{ padding: 6, borderRadius: size, borderWidth: 4, borderColor: speaking ? C.mint : 'transparent' }}>
      <Avatar name={name || '?'} size={size} bg={C.blueInk} uri={photo} />
    </View>
  );
}

function MutedTag({ t }: { t: TFn }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 }}>
      <Icon name="micOff" size={14} color="#fff" />
      <T style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{t('clMutedTag')}</T>
    </View>
  );
}

/** Huddle: me + everyone else, up to 6 tiles (video when on, else avatar with a ring while speaking), then "+N more". */
function HuddleGrid({ room, remotes, t, camOn, front }: { room: Room; remotes: Participant[]; t: TFn; camOn: boolean; front: boolean }) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const all: Participant[] = [room.localParticipant, ...remotes];
  const shown = all.slice(0, 6);
  const more = all.length - shown.length;
  const cols = shown.length <= 1 ? 1 : 2;
  const rows = Math.ceil(shown.length / cols);
  const gap = 10;
  const w = box.w ? (box.w - gap * (cols - 1)) / cols : 0;
  const h = box.h ? Math.min(w * 1.2, (box.h - (more > 0 ? 34 : 0) - gap * (rows - 1)) / rows) : 0;
  const onLayout = (e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  return (
    <View style={{ flex: 1, paddingHorizontal: 14 }} onLayout={onLayout}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap, justifyContent: 'center' }}>
        {w > 0 ? shown.map((p) => {
          const me = p === room.localParticipant;
          const v = me ? (camOn ? camRef(p) : null) : camRef(p);
          const label = me ? t('clYou') : nameOf(p);
          return (
            <View key={p.identity} accessible accessibilityLabel={[label, p.isSpeaking ? t('clSpeakingTag') : '', !p.isMicrophoneEnabled ? t('clMutedTag') : ''].filter(Boolean).join(', ')}
              style={{ width: w, height: h, borderRadius: 18, overflow: 'hidden', backgroundColor: C.ink2, alignItems: 'center', justifyContent: 'center',
                borderWidth: 3, borderColor: p.isSpeaking ? C.mint : 'transparent' }}>
              {v ? <VideoTrack trackRef={v} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} objectFit="cover" mirror={me && front} />
                : <Avatar name={label} size={Math.min(84, h * 0.5)} bg={C.blueInk} />}
              <View style={{ position: 'absolute', left: 8, right: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                {!p.isMicrophoneEnabled ? <Icon name="micOff" size={14} color="#fff" /> : null}
                <T style={{ color: '#fff', fontSize: 14, fontWeight: '700', flexShrink: 1, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 }} numberOfLines={1}>{label}</T>
              </View>
            </View>
          );
        }) : null}
      </View>
      {more > 0 ? <T style={{ color: C.sideText, fontSize: 16, fontWeight: '700', textAlign: 'center', marginTop: 10 }}>{t('clMore', { n: more })}</T> : null}
    </View>
  );
}
