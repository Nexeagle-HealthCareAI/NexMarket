'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { crm, API_ORIGIN } from '@/lib/sync/api-client';
import { useLiveEvents, type LiveNotification } from '@/lib/crm/live';
import {
  callState, clearNotice, declineCall, dropRinging, joinCall, loadCallStatus, noteIncoming, refreshActive, updateCall, useCalls, type Call,
} from '@/lib/crm/calls';
import { bindAudioUnlock, startRing, stopRing } from '@/lib/crm/ring';
import { friendlyError, initials } from '@/components/crm/ui';

// LiveKit is only downloaded when a call actually opens.
const CallWindow = dynamic(() => import('./CallWindow'), { ssr: false, loading: () => null });

const chatLabel = (c: Call) => (c.threadKind === 'agent' ? 'Field agent · office chat' : c.threadKind === 'team' ? 'Field team chat' : 'One-to-one chat');

/**
 * Calls on every admin page: rings for incoming calls (pop-up + sound) and keeps the call window
 * open while moving between pages. Mounted once in the admin layout.
 */
export default function CallLayer() {
  const { on, ringing, session, notice, ringSeconds } = useCalls();

  useEffect(() => {
    bindAudioUnlock();
    void loadCallStatus().then(() => refreshActive());
  }, []);

  // Pushes: a 'call' notification rings me; chat pings mean a call in some chat started, changed or ended.
  const chatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChat = useCallback(() => {
    if (chatTimer.current) clearTimeout(chatTimer.current);
    chatTimer.current = setTimeout(() => { chatTimer.current = null; void refreshActive(); }, 800);
  }, []);
  useEffect(() => () => { if (chatTimer.current) clearTimeout(chatTimer.current); }, []);
  const onNotify = useCallback((n: LiveNotification) => {
    if (n.kind === 'call' && n.link?.startsWith('call:')) void noteIncoming(n.link.slice(5));
  }, []);
  const noop = useCallback(() => {}, []);
  useLiveEvents(noop, undefined, onChat, onNotify);

  // Fallback when the socket is down: check every 10 s (also in a hidden tab, so calls still ring).
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => void refreshActive(), 10000);
    return () => clearInterval(t);
  }, [on]);

  // While something rings for me: check it every 2 s, so the ring stops when it is answered elsewhere or ends.
  const top = ringing[0] ?? null;
  useEffect(() => {
    if (!top) return;
    const id = top.id;
    const t = setInterval(async () => {
      try {
        const c = await crm.get<Call>(`/api/v1/calls/${id}`);
        if (c.status === 'ringing') {
          // The server gives up after ringSeconds; don't ring forever if it never says so.
          if (Date.now() - new Date(c.startedAt).getTime() > (ringSeconds + 20) * 1000) dropRinging(id);
          else updateCall(c);
          return;
        }
        const taker = c.status === 'active' ? c.people.find((p) => p.inCall && p.userId !== c.startedBy) : null;
        dropRinging(id, taker ? `${taker.name} answered ${c.startedByName}'s call.` : c.status === 'active' ? 'Someone else answered.' : undefined);
        updateCall(c);
      } catch { /* try again in 2 s */ }
    }, 2000);
    return () => clearInterval(t);
  }, [top, ringSeconds]);

  // The sound: a ring for incoming calls, a soft ringback while my own call is dialling.
  const dialling = !!session && session.call.mine && session.call.kind === 'call' && session.call.status === 'ringing';
  useEffect(() => {
    if (top && !session) startRing('incoming');
    else if (dialling) startRing('outgoing');
    else stopRing();
  }, [top, session, dialling]);
  useEffect(() => () => stopRing(), []);

  // Closing the tab mid-call: tell the server I left.
  useEffect(() => {
    const onHide = (e: PageTransitionEvent) => {
      if (e.persisted) return;
      const s = callState().session;
      if (!s) return;
      try { void fetch(`${API_ORIGIN}/api/v1/calls/${s.call.id}/leave`, { method: 'POST', credentials: 'include', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch { /* best effort */ }
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  // A notice ("Someone else answered") shows for a few seconds.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(clearNotice, 5000);
    return () => clearTimeout(t);
  }, [notice]);

  if (!on) return null;
  return (
    <>
      {top && !session && <IncomingCall key={top.id} call={top} />}
      {!top && notice && !session && <div className="cl-notice" role="status">{notice}</div>}
      {session && <CallWindow key={session.call.id} session={session} />}
    </>
  );
}

function IncomingCall({ call }: { call: Call }) {
  const answerRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const callRef = useRef(call);
  useEffect(() => { callRef.current = call; }, [call]);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    answerRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); void declineCall(callRef.current); } };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); before?.focus?.(); };
  }, []);

  const answer = async () => {
    setBusy(true);
    setError(null);
    try { await joinCall(call, call.startedByName); }
    catch (e) {
      // 409: it ended, or another office user took it.
      const msg = friendlyError(e, 'This call is no longer available.');
      dropRinging(call.id, msg);
      setBusy(false);
      setError(msg);
    }
  };
  const what = call.video ? 'Video call' : 'Voice call';
  return (
    <div className="cl-ring" role="alertdialog" aria-labelledby="cl-ring-title" aria-describedby="cl-ring-desc">
      <span className="cl-ring-avatar" aria-hidden>{initials(call.startedByName)}</span>
      <div className="cl-ring-text">
        <span className="cl-ring-kind">{call.video ? <Video size={13} aria-hidden /> : <Phone size={13} aria-hidden />} Incoming {what.toLowerCase()}</span>
        <strong id="cl-ring-title">{call.startedByName}</strong>
        <span id="cl-ring-desc">{chatLabel(call)}{call.threadKind === 'agent' ? ' · everyone in the office is being rung' : ''}</span>
        {error && <span className="cl-ring-error" role="alert">{error}</span>}
      </div>
      <div className="cl-ring-actions">
        <button type="button" className="cl-btn is-decline" onClick={() => void declineCall(call)} disabled={busy} aria-label={`Decline ${what.toLowerCase()} from ${call.startedByName}`}>
          <PhoneOff size={20} aria-hidden /><span>Decline</span>
        </button>
        <button ref={answerRef} type="button" className="cl-btn is-answer" onClick={() => void answer()} disabled={busy} aria-label={`Answer ${what.toLowerCase()} from ${call.startedByName}`}>
          {call.video ? <Video size={20} aria-hidden /> : <Phone size={20} aria-hidden />}<span>{busy ? 'Joining…' : 'Answer'}</span>
        </button>
      </div>
    </div>
  );
}
