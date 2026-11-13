'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  CalendarDays, Check, ClipboardList, Copy, Download, Languages, MapPin, MessagesSquare, PhoneCall, ShieldCheck, Sparkles,
  Stethoscope, Wallet, WifiOff,
} from 'lucide-react';
import { QrCode } from '@/components/crm/QrPoster';
import { API_ORIGIN, crm } from '@/lib/sync/api-client';
import { ErrorBox, PageHead, Pill, Skeleton, useLoader } from '@/components/crm/ui';

interface Release { version: string; build: number; builtAt?: string | null; commit?: string | null; notes?: string | null; size?: number | null; file: string }

const DOWNLOAD_PATH = '/api/v1/app/android/download';

const SHOTS = [
  { img: '/appshots/today.webp', title: 'Today', line: 'Where to go next, calls that are due, and the day’s numbers.' },
  { img: '/appshots/partners.webp', title: 'Partners', line: 'Late and due follow-ups first, with Call, WhatsApp and Route.' },
  { img: '/appshots/patients.webp', title: 'My patients', line: 'Every referred patient, step by step to admission.' },
  { img: '/appshots/partner.webp', title: 'One partner', line: 'Visit done, refer a patient, and the partner’s history.' },
];

const USES = [
  { icon: CalendarDays, title: 'Plan the day', line: 'Agents start a shift and see the next panchayat to visit, overdue calls and today’s targets.' },
  { icon: PhoneCall, title: 'Never miss a follow-up', line: 'Partners due today come first. One tap to call, WhatsApp or get directions.' },
  { icon: Stethoscope, title: 'Refer and track patients', line: 'Refer a patient in under a minute and follow them from the village to admission.' },
  { icon: MapPin, title: 'Visits with proof', line: 'Each check-in saves its time and place, so the office sees real visits on the live map.' },
  { icon: MessagesSquare, title: 'Talk to the office', line: 'Chat, voice and video calls, team huddles and meetings, without leaving the app.' },
  { icon: ClipboardList, title: 'Surveys and hoardings', line: 'Field mapping, camp surveys and banner places with photos, straight into the CRM.' },
  { icon: Wallet, title: 'Money and attendance', line: 'Partner payments with photo proof, shifts, attendance and leave requests.' },
  { icon: Sparkles, title: 'Vita assistant', line: 'Ask Vita what to do next, or how to answer a partner, in the agent’s own words.' },
];

const POINTS = [
  { icon: WifiOff, text: 'Works without signal: everything is saved on the phone and sent when the network is back.' },
  { icon: Languages, text: 'English, हिन्दी, বাংলা and Hinglish, with a text-size and sunlight mode.' },
  { icon: ShieldCheck, text: 'Signing in needs the organisation, agent ID and password; after that a quick unlock keeps the phone’s data safe.' },
];

function megabytes(n?: number | null) {
  return n ? `${Math.round(n / 1048576)} MB` : null;
}
const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** The field agents' Android app: what it is, what it's for, and the newest build to download or scan. */
export default function FieldAppPage() {
  const release = useLoader(() => crm.get<Release>('/api/v1/app/android'));
  const [copied, setCopied] = useState(false);
  const base = API_ORIGIN.startsWith('http') ? API_ORIGIN : typeof window !== 'undefined' ? window.location.origin + API_ORIGIN : API_ORIGIN;
  const link = `${base}${DOWNLOAD_PATH}`;
  const r = release.data;
  const notPublished = !r && !release.loading && !!release.error;

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked: the link is shown under the QR code */ }
  };

  return (
    <main className="crm-page">
      <PageHead title="Field app" sub="The NexEagle Android app your field agents use every day." badge={r ? <Pill tone="ok" dot>Version {r.version} · build {r.build}</Pill> : undefined} />

      <section className="crm-card app-hero" aria-label="Download the app">
        <div className="app-hero-text">
          <h2 className="crm-h2">Everything an agent needs, in their pocket</h2>
          <p className="crm-sub">
            Agents plan their day, visit partners, refer patients and stay in touch with the office from one app.
            What they do shows up here in the CRM straight away, even when they were out of signal.
          </p>
          {release.loading && !r ? <Skeleton h={44} w={260} /> : r ? (
            <>
              <div className="app-hero-actions">
                <a className="crm-btn" href={link} download={r.file}><Download size={18} aria-hidden /> Download for Android{megabytes(r.size) ? ` (${megabytes(r.size)})` : ''}</a>
                <button type="button" className="crm-btn is-secondary" onClick={copy}>{copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />} {copied ? 'Link copied' : 'Copy link'}</button>
              </div>
              <p className="app-meta">
                Updated {r.builtAt ? dateFmt.format(new Date(r.builtAt)) : '—'}
                {r.notes ? <><br /><span>Latest change: {r.notes}</span></> : null}
              </p>
            </>
          ) : notPublished ? (
            <ErrorBox message="The app hasn’t been published here yet. It appears after the next Android build finishes." onRetry={release.reload} />
          ) : null}
        </div>
        {r && (
          <figure className="app-qr">
            <QrCode text={link} size={168} label="QR code to download the app" />
            <figcaption>Scan with the agent’s phone to download</figcaption>
          </figure>
        )}
      </section>

      <section aria-labelledby="app-uses">
        <h2 className="crm-h2" id="app-uses" style={{ marginBottom: 12 }}>What agents use it for</h2>
        <div className="app-uses">
          {USES.map(({ icon: Icon, title, line }) => (
            <article key={title} className="crm-card app-use">
              <span className="app-use-icon" aria-hidden><Icon size={20} /></span>
              <h3>{title}</h3>
              <p>{line}</p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="app-screens">
        <h2 className="crm-h2" id="app-screens" style={{ marginBottom: 12 }}>A look inside</h2>
        <div className="app-shots">
          {SHOTS.map((s) => (
            <figure key={s.img}>
              {/* eslint-disable-next-line @next/next/no-img-element -- small local screenshots */}
              <img src={s.img} alt={`The app’s ${s.title} screen`} width={640} height={1385} loading="lazy" decoding="async" />
              <figcaption><strong>{s.title}</strong>{s.line}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <div className="app-two">
        <section className="crm-card" aria-labelledby="app-install">
          <h2 className="crm-h2" id="app-install">Install on a phone</h2>
          <ol className="app-steps">
            <li>On the agent’s Android phone, scan the QR code above or open the download link.</li>
            <li>Open the downloaded file. If Android asks, allow your browser to <em>install unknown apps</em>.</li>
            <li>Open NexEagle and sign in with the organisation, agent ID and password from <Link href="/admin/agents">Field agents</Link>.</li>
            <li>Allow location, camera, microphone and notifications when asked — check-ins, photos and calls need them.</li>
          </ol>
          <p className="crm-sub">To update, download again from this page and install over the old app. Nothing on the phone is lost.</p>
        </section>
        <section className="crm-card" aria-labelledby="app-points">
          <h2 className="crm-h2" id="app-points">Good to know</h2>
          <ul className="app-points">
            {POINTS.map(({ icon: Icon, text }) => <li key={text}><Icon size={18} aria-hidden /><span>{text}</span></li>)}
          </ul>
        </section>
      </div>
    </main>
  );
}
