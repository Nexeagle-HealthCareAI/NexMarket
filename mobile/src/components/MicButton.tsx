import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState, RecordingPresets, type RecordingOptions } from 'expo-audio';
import { C } from '../theme';
import { Icon } from './Icon';
import { Field, toast } from './ui';
import { useSession } from '../lib/session';
import { joinSpoken, SPEECH_MAX_SECONDS, transcribe, type SpeechField } from '../lib/speech';

/** Small, mono, speech-quality AAC: about 240 KB a minute, so it sends on a weak signal. */
const VOICE: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
};

/**
 * Tap to speak, tap again to stop: the words are written into the field in the app's language.
 * Stops by itself after a minute. Needs signal (it says so when there is none).
 */
export function MicButton({ field, onText, size = 48, dark }: { field: SpeechField; onText: (text: string) => void; size?: number; dark?: boolean }) {
  const { lang, t } = useSession();
  const recorder = useAudioRecorder(VOICE);
  const state = useAudioRecorderState(recorder, 250);
  const [phase, setPhase] = useState<'idle' | 'rec' | 'busy'>('idle');
  const stopping = useRef(false);

  const finish = async () => {
    if (stopping.current) return;
    stopping.current = true;
    setPhase('busy');
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) { setPhase('idle'); return; }
      const r = await transcribe(uri, lang, field);
      if (r.ok) onText(r.text);
      else toast(r.reason === 'offline' ? t('micOffline') : r.reason === 'empty' ? t('micEmpty') : r.reason === 'off' ? t('micOff') : r.reason === 'limit' ? t('micLimit') : t('micError'));
    } catch {
      toast(t('micError'));
    } finally {
      stopping.current = false;
      setPhase('idle');
      void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    }
  };

  const start = async () => {
    try {
      const p = await requestRecordingPermissionsAsync();
      if (!p.granted) { toast(t('micNoPerm')); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase('rec');
    } catch {
      toast(t('micError'));
      setPhase('idle');
    }
  };

  // A minute at most: stop and write it down.
  const secs = Math.floor((state.durationMillis ?? 0) / 1000);
  useEffect(() => {
    if (phase === 'rec' && secs >= SPEECH_MAX_SECONDS) void finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, secs]);

  // Leaving the screen while recording: stop quietly, nothing is sent.
  useEffect(() => () => { if (recorder.isRecording) void recorder.stop().catch(() => undefined); }, [recorder]);

  const rec = phase === 'rec';
  const busy = phase === 'busy';
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={rec ? t('micStop') : t('micA11y')}
        accessibilityState={{ busy, selected: rec }}
        disabled={busy}
        hitSlop={6}
        onPress={() => (rec ? void finish() : void start())}
        style={({ pressed }) => [
          st.btn,
          { width: size, height: size, borderRadius: size / 2 },
          { backgroundColor: rec ? C.bad : dark ? '#1a2236' : C.blueSoft },
          rec && st.ring,
          pressed && { opacity: 0.8 },
        ]}
      >
        {busy ? <ActivityIndicator color={dark ? '#fff' : C.blue} />
          : <Icon name={rec ? 'stop' : 'mic'} size={Math.round(size * 0.46)} color={rec ? '#fff' : dark ? '#fff' : C.blue} strokeWidth={2.2} />}
      </Pressable>
      {rec ? <Text style={st.timer} accessibilityLiveRegion="polite">{t('micListening', { s: secs })}</Text>
        : busy ? <Text style={st.timerMuted}>{t('micWorking')}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  btn: { alignItems: 'center', justifyContent: 'center' },
  ring: { borderWidth: 4, borderColor: '#f7c5c0' },
  timer: { fontSize: 12, fontWeight: '700', color: C.bad },
  timerMuted: { fontSize: 12, fontWeight: '600', color: C.text2 },
});

/**
 * A text field with a microphone beside it: spoken words are added to what is typed (or replace it, for a name).
 * Same props as Field, plus what the words are for.
 */
export function VoiceField({ voice, ...props }: React.ComponentProps<typeof Field> & { voice: SpeechField }) {
  const value = String(props.value ?? '');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
      <View style={{ flex: 1, minWidth: 0 }}><Field {...props} /></View>
      <View style={{ paddingBottom: props.error || props.hint ? 22 : 2 }}>
        <MicButton field={voice} onText={(spoken) => props.onChangeText?.(joinSpoken(value, spoken, voice))} />
      </View>
    </View>
  );
}
