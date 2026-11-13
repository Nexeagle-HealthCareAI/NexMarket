'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, CalendarPlus, NotebookPen, Video } from 'lucide-react';
import { friendlyError, Modal } from '@/components/crm/ui';
import {
  cancelMeeting, createMeeting, joinMeeting, listMeetings, meetingWhen, retryNotes, toLocalInput, updateMeeting, type Meeting,
} from '@/lib/crm/meetings';

const LENGTHS = [15, 30, 45, 60, 90, 120];

/** The server's own sentence when it sent one ("That time has already passed."), else the usual friendly error. */
const said = (e: unknown): string => /"message":"([^"]+)"/.exec(e instanceof Error ? e.message : '')?.[1] ?? friendlyError(e);

/** The next sensible start: the coming half hour, at least 20 minutes away. */
function nextSlot(): Date {
  const d = new Date(Date.now() + 20 * 60000);
  d.setMinutes(d.getMinutes() <= 30 ? 30 : 60, 0, 0);
  return d;
}

/**
 * A chat's meetings, under its header: the one going on (Join), the ones coming, and notes still being written.
 * The office plans, changes and cancels from here. `ping` goes up whenever something changes in the chat.
 */
export function MeetingStrip({ threadId, threadTitle, office, callsOn, inCall, ping, planOpen, onPlanClose, showToast }: {
  threadId: string; threadTitle: string; office: boolean; callsOn: boolean; inCall: boolean; ping: number; planOpen: boolean; onPlanClose: () => void;
  showToast: (msg: string) => void;
}) {
  const [rows, setRows] = useState<Meeting[]>([]);
  const [edit, setEdit] = useState<Meeting | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [, setTick] = useState(0);

  const load = useCallback(() => { listMeetings(threadId).then(setRows).catch(() => undefined); }, [threadId]);
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load, ping]);
  // "Join" appears 15 minutes before the start without anyone having to reload.
  useEffect(() => { const t = setInterval(() => { setTick((n) => n + 1); load(); }, 60000); return () => clearInterval(t); }, [load]);

  const join = async (m: Meeting) => {
    if (busy) return;
    setBusy(m.id);
    try { await joinMeeting(m, threadTitle); load(); }
    catch (e) { showToast(said(e)); }
    finally { setBusy(null); }
  };
  const cancel = async (m: Meeting) => {
    if (busy || !window.confirm(`Cancel the meeting “${m.title}”? Everyone in this chat is told.`)) return;
    setBusy(m.id);
    try { await cancelMeeting(m.id); showToast('Meeting cancelled.'); load(); }
    catch (e) { showToast(said(e)); }
    finally { setBusy(null); }
  };
  const again = async (m: Meeting) => {
    setBusy(m.id);
    try { await retryNotes(m.id); showToast('Writing the notes again.'); load(); }
    catch (e) { showToast(said(e)); }
    finally { setBusy(null); }
  };

  // What is worth a line: live, coming, and finished ones whose notes are being written or failed.
  const open = rows.filter((m) => m.status === 'live' || m.status === 'scheduled' || (m.status === 'done' && (m.notesStatus === 'writing' || (office && m.notesStatus === 'failed'))));
  const shown = all ? open : open.slice(0, 2);

  return (
    <>
      {open.length > 0 && (
        <section className="ch-meet" aria-label="Meetings in this chat">
          {shown.map((m) => {
            const live = m.status === 'live';
            const sub = live ? `Going on now${m.aiNotes ? ' · AI notes are on' : ''}`
              : m.status === 'done' ? (m.notesStatus === 'writing' ? 'Meeting over · the AI is writing the notes…' : `The notes could not be written. ${m.notesError ?? ''}`)
                : `${meetingWhen(m.startsAt)} · ${m.minutes} min · planned by ${m.createdByName}`;
            return (
              <div key={m.id} className={`ch-meet-row${live ? ' is-live' : ''}`}>
                {m.status === 'done' ? <NotebookPen size={16} aria-hidden /> : live ? <Video size={16} aria-hidden /> : <CalendarClock size={16} aria-hidden />}
                <span className="ch-meet-text"><strong>{m.title}</strong><span>{sub}</span></span>
                {m.status !== 'done' && m.canJoin && callsOn && !inCall && (
                  <button type="button" className="crm-btn is-sm is-ok" disabled={busy === m.id} onClick={() => void join(m)}>{live ? 'Join' : 'Start meeting'}</button>
                )}
                {m.status === 'scheduled' && office && (
                  <>
                    <button type="button" className="crm-btn is-sm" onClick={() => setEdit(m)}>Change</button>
                    <button type="button" className="crm-btn is-sm" disabled={busy === m.id} onClick={() => void cancel(m)}>Cancel</button>
                  </>
                )}
                {m.status === 'done' && m.notesStatus === 'failed' && office && (
                  <button type="button" className="crm-btn is-sm" disabled={busy === m.id} onClick={() => void again(m)}>Try again</button>
                )}
              </div>
            );
          })}
          {open.length > 2 && <button type="button" className="ch-meet-more" onClick={() => setAll((a) => !a)}>{all ? 'Show fewer' : `Show all ${open.length} meetings`}</button>}
        </section>
      )}
      {(planOpen || edit) && (
        <MeetingForm threadId={threadId} threadTitle={threadTitle} meeting={edit} callsOn={callsOn} showToast={showToast}
          onClose={() => { setEdit(null); onPlanClose(); }} onSaved={() => { setEdit(null); onPlanClose(); load(); }} />
      )}
    </>
  );
}

function MeetingForm({ threadId, threadTitle, meeting, callsOn, showToast, onClose, onSaved }: {
  threadId: string; threadTitle: string; meeting: Meeting | null; callsOn: boolean; showToast: (msg: string) => void; onClose: () => void; onSaved: () => void;
}) {
  const [title, setTitle] = useState(meeting?.title ?? '');
  const [agenda, setAgenda] = useState(meeting?.agenda ?? '');
  const [when, setWhen] = useState(() => toLocalInput(meeting ? new Date(meeting.startsAt) : nextSlot()));
  const [minutes, setMinutes] = useState(meeting?.minutes ?? 30);
  const [video, setVideo] = useState(meeting?.video ?? true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const starts = new Date(when);
    if (title.trim().length < 3) { setError('Give the meeting a name of at least 3 letters.'); document.getElementById('mt-title')?.focus(); return; }
    if (Number.isNaN(starts.getTime())) { setError('Pick the day and time.'); document.getElementById('mt-when')?.focus(); return; }
    if (starts.getTime() < Date.now() - 5 * 60000) { setError('That time has already passed.'); document.getElementById('mt-when')?.focus(); return; }
    setError(''); setSaving(true);
    const body = { threadId, title: title.trim(), agenda: agenda.trim() || undefined, startsAt: starts.toISOString(), minutes, video };
    try {
      if (meeting) await updateMeeting(meeting.id, body); else await createMeeting(body);
      showToast(meeting ? 'Meeting changed.' : 'Meeting planned. Everyone in this chat has been told.');
      onSaved();
    } catch (err) { setError(said(err)); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={meeting ? 'Change the meeting' : `Plan a meeting · ${threadTitle}`} onClose={onClose}
      actions={<>
        <button type="button" className="crm-btn" onClick={onClose}>Close</button>
        <button type="submit" form="mt-form" className="crm-btn is-primary" disabled={saving}><CalendarPlus size={16} aria-hidden /> {saving ? 'Saving…' : meeting ? 'Save changes' : 'Plan meeting'}</button>
      </>}>
      <form id="mt-form" className="ch-meet-form" onSubmit={save} noValidate>
        <label className="crm-field is-all">What is it about?
          <input id="mt-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Weekly field review" required autoFocus />
        </label>
        <label className="crm-field">Day and time
          <input id="mt-when" type="datetime-local" value={when} min={toLocalInput(new Date())} onChange={(e) => setWhen(e.target.value)} required />
        </label>
        <label className="crm-field">How long
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {LENGTHS.map((n) => <option key={n} value={n}>{n < 60 ? `${n} minutes` : n === 60 ? '1 hour' : `${n / 60} hours`}</option>)}
          </select>
        </label>
        <label className="crm-field is-all">Points to cover <span className="crm-cell-sub">optional</span>
          <textarea value={agenda} onChange={(e) => setAgenda(e.target.value)} rows={3} maxLength={2000} placeholder="One point per line" />
        </label>
        <label className="is-all" style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14 }}><input type="checkbox" checked={video} onChange={(e) => setVideo(e.target.checked)} style={{ width: 18, height: 18 }} /> Video meeting (untick for voice only)</label>
        <p className="ch-meet-note is-all">
          Everyone in this chat is told now and reminded 10 minutes before. The meeting is a call inside NexEagle and opens 15 minutes early.
          AI notes are off unless someone in the office turns them on during the meeting.
          {!callsOn && ' Calling is not switched on yet on this server, so nobody will be able to join until it is.'}
        </p>
        {error && <div className="crm-error is-all" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}
