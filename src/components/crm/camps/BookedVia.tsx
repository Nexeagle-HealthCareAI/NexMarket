import { Footprints, Handshake, Headset, MessageCircle, QrCode, Smartphone, type LucideIcon } from 'lucide-react';
import type { CampPatient } from './shared';

/** How a person got into the camp's list: the channel, in the order they appear as filters. */
export const CHANNELS: { key: string; label: string; icon: LucideIcon; tone: string }[] = [
  { key: 'qr', label: 'QR code', icon: QrCode, tone: 'qr' },
  { key: 'agent', label: 'Field agent', icon: Smartphone, tone: 'agent' },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, tone: 'wa' },
  { key: 'partner', label: 'Partner', icon: Handshake, tone: 'partner' },
  { key: 'prebooked', label: 'Desk', icon: Headset, tone: 'desk' },
  { key: 'walk_in', label: 'Walk-in', icon: Footprints, tone: 'walk' },
];
export const channelOf = (source: string) => CHANNELS.find((c) => c.key === source) ?? { key: source, label: source, icon: Headset, tone: 'desk' };

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : null);

/** The "Booked by" cell: the channel as a badge, who (agent, partner or staff) and when. */
export function BookedVia({ p }: { p: CampPatient }) {
  const ch = channelOf(p.source);
  const Icon = ch.icon;
  const who = p.source === 'agent' ? p.bookedBy
    : p.source === 'partner' ? p.partnerName ?? p.addedBy
    : p.source === 'qr' || p.source === 'whatsapp' ? 'Booked themselves'
    : p.addedBy;
  const tokenSent = p.waStatus === 'sent' || p.waStatus === 'delivered' || p.waStatus === 'read';
  return (
    <div className="cp-via">
      <span className={`cp-via-badge is-${ch.tone}`}><Icon size={14} aria-hidden />{ch.label}</span>
      {who && <span className="cp-via-who">{who}{p.source !== 'partner' && p.partnerName ? ` · via ${p.partnerName}` : ''}</span>}
      <span className="cp-via-when">{[when(p.createdAt), p.slot ? `slot ${p.slot}` : null].filter(Boolean).join(' · ')}</span>
      {p.source === 'agent' && p.phone && p.waStatus && (
        tokenSent ? <span className="cp-wa is-ok" title="The token went on WhatsApp by itself">Token sent on WhatsApp ✓</span>
          : <span className="cp-wa is-bad" title={p.waError ?? undefined}>WhatsApp token not sent</span>
      )}
    </div>
  );
}
