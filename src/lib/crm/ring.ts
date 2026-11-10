'use client';

/**
 * Ringing with the Web Audio API (no audio files).
 * Browsers only let a page make sound after the person has clicked or typed on it, so the
 * audio context is created (or resumed) on the first interaction; until then the pop-up shows silently.
 */

type Kind = 'incoming' | 'outgoing';

let ctx: AudioContext | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let playing: Kind | null = null;
let unlockBound = false;

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      ctx = new Ctx();
    }
    return ctx;
  } catch { return null; }
}

function unlock() {
  const c = context();
  if (c && c.state === 'suspended') void c.resume().catch(() => undefined);
}

/** Lets the ring start as soon as the person interacts with the page. Safe to call many times. */
export function bindAudioUnlock() {
  if (unlockBound || typeof window === 'undefined') return;
  unlockBound = true;
  const opts = { capture: true, passive: true } as const;
  window.addEventListener('pointerdown', unlock, opts);
  window.addEventListener('keydown', unlock, opts);
  window.addEventListener('touchstart', unlock, opts);
}

function tone(c: AudioContext, freq: number, at: number, len: number, vol: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.03);
  g.gain.setValueAtTime(vol, at + len - 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  o.connect(g).connect(c.destination);
  o.start(at);
  o.stop(at + len + 0.02);
}

function burst(kind: Kind) {
  const c = context();
  if (!c || c.state !== 'running') return; // no sound allowed yet: try again next cycle
  const t = c.currentTime + 0.02;
  if (kind === 'incoming') {
    // A bright two-note ring, twice.
    [0, 0.5].forEach((d) => { tone(c, 880, t + d, 0.2, 0.12); tone(c, 1175, t + d + 0.2, 0.22, 0.12); });
  } else {
    // A soft ringback for the caller: "ring-ring", then a pause.
    tone(c, 425, t, 0.4, 0.05);
    tone(c, 425, t + 0.6, 0.4, 0.05);
  }
}

export function startRing(kind: Kind) {
  if (playing === kind) return;
  stopRing();
  bindAudioUnlock();
  unlock();
  playing = kind;
  burst(kind);
  timer = setInterval(() => burst(kind), kind === 'incoming' ? 2600 : 3000);
}

export function stopRing() {
  if (timer) clearInterval(timer);
  timer = null;
  playing = null;
}
