import { api, ApiError, OfflineError } from './api';
import type { Lang } from '../i18n';

/**
 * Speech to text: a short recording goes to the NexMarket server, which has it written out by Groq's Whisper model and
 * sends the text back. Nothing is stored on the server; the recording file on the phone is the app's own temporary copy.
 */
export type SpeechField = 'note' | 'name' | 'chat' | 'question';

export type SpeechResult = { ok: true; text: string } | { ok: false; reason: 'offline' | 'empty' | 'off' | 'limit' | 'error'; message?: string };

const LONGEST_MS = 60_000;
export const SPEECH_MAX_SECONDS = LONGEST_MS / 1000;

export async function transcribe(uri: string, lang: Lang, field: SpeechField): Promise<SpeechResult> {
  const name = uri.split('/').pop() || 'clip.m4a';
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '.m4a';
  const mime = ext === '.3gp' ? 'audio/3gpp' : ext === '.webm' ? 'audio/webm' : ext === '.wav' ? 'audio/wav' : 'audio/mp4';
  const form = new FormData();
  form.append('file', { uri, name: `clip${ext}`, type: mime } as unknown as Blob);
  form.append('lang', lang);
  form.append('field', field);
  try {
    const r = await api<{ text: string; message?: string }>('/api/v1/speech/transcribe', { method: 'POST', body: form, timeoutMs: 45_000 });
    const text = (r.text ?? '').trim();
    return text ? { ok: true, text } : { ok: false, reason: 'empty', message: r.message };
  } catch (e) {
    if (e instanceof OfflineError) return { ok: false, reason: 'offline' };
    if (e instanceof ApiError) {
      if (e.status === 503) return { ok: false, reason: 'off' };
      if (e.status === 429) return { ok: false, reason: 'limit' };
      return { ok: false, reason: 'error', message: e.message };
    }
    return { ok: false, reason: 'error' };
  }
}

/** Adds spoken text to what is already typed: a new sentence for notes, a replacement for names. */
export function joinSpoken(current: string, spoken: string, field: SpeechField): string {
  if (field === 'name') return spoken.replace(/[.।!?]+$/u, '').trim();
  const before = current.trimEnd();
  if (!before) return spoken;
  return `${before}${/[.।!?]$/u.test(before) ? '' : '.'} ${spoken}`;
}
