'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Download, ExternalLink, Printer, Share2 } from 'lucide-react';
import { Modal } from '@/components/crm/ui';
import { orgName } from '@/lib/crm/access';

/** A QR code as an inline SVG (generated here in the browser; nothing is sent anywhere). */
export function QrCode({ text, size = 200, label }: { text: string; size?: number; label: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0e1525', light: '#ffffff' } })
      .then((s) => { if (alive) setSvg(s); })
      .catch(() => { if (alive) setSvg(null); });
    return () => { alive = false; };
  }, [text]);
  if (!svg) return <div className="qr-box" style={{ width: size, height: size }} aria-label={label} />;
  // The SVG comes from the qrcode library, not from user input.
  return <div className="qr-box" role="img" aria-label={label} style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export interface QrPosterInfo {
  /** Big line on the poster, e.g. the partner's name or the camp. */
  title: string;
  /** Small line under it, e.g. "Referral code G7K2QX". */
  sub?: string;
  waLink: string | null;
  message: string;
  hospital?: string;
  displayPhone?: string | null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** QR code, link and a printable A5 poster for a partner or a camp. */
export function QrPosterModal({ info, onClose, intro }: { info: QrPosterInfo; onClose: () => void; intro?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const link = info.waLink;
  const hospital = info.hospital ?? orgName();

  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ }
  };
  const share = async () => {
    if (!link) return;
    const text = `${info.title}: WhatsApp ${hospital} → ${link}`;
    if (navigator.share) { try { await navigator.share({ title: hospital, text }); } catch { /* cancelled */ } }
    else await copy();
  };
  const png = async () => {
    if (!link) return;
    const url = await QRCode.toDataURL(link, { margin: 2, width: 1024, errorCorrectionLevel: 'M' });
    const a = document.createElement('a');
    a.href = url;
    a.download = `whatsapp-qr-${info.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
    a.click();
  };
  const print = async () => {
    if (!link) return;
    const svg = await QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    const w = window.open('', '_blank', 'width=720,height=960');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(info.title)} – WhatsApp QR</title>
<style>
@page { size: A5; margin: 12mm; }
body { font-family: system-ui, -apple-system, 'Segoe UI', 'Noto Sans Devanagari', sans-serif; margin: 0; color: #0e1525; }
.p { border: 3px solid #0e1525; border-radius: 22px; padding: 26px 24px; text-align: center; max-width: 520px; margin: 0 auto; }
.h { font-size: 15px; letter-spacing: .08em; text-transform: uppercase; color: #0a72d6; font-weight: 800; }
.hi { font-size: 30px; font-weight: 800; margin: 10px 0 2px; line-height: 1.2; }
.en { font-size: 18px; font-weight: 600; color: #3b4558; margin: 0 0 18px; }
.qr { width: 300px; height: 300px; margin: 0 auto; padding: 10px; border-radius: 16px; background: #fff; border: 1px solid #d5dbe6; }
.qr svg { width: 100%; height: 100%; }
.who { margin-top: 18px; font-size: 22px; font-weight: 800; }
.code { font-size: 15px; color: #3b4558; margin-top: 4px; }
.ph { margin-top: 16px; font-size: 16px; background: #e7f6ef; color: #0b6b4a; display: inline-block; padding: 8px 16px; border-radius: 999px; font-weight: 700; }
</style></head><body><div class="p">
<div class="h">${esc(hospital)}</div>
<div class="hi">स्कैन करें, WhatsApp पर बात करें</div>
<div class="en">Scan to message us on WhatsApp</div>
<div class="qr">${svg}</div>
<div class="who">${esc(info.title)}</div>
${info.sub ? `<div class="code">${esc(info.sub)}</div>` : ''}
${info.displayPhone ? `<div class="ph">WhatsApp: +${esc(info.displayPhone)}</div>` : ''}
</div><script>window.onload = () => { window.print(); };</script></body></html>`);
    w.document.close();
  };

  return (
    <Modal title="WhatsApp QR code" onClose={onClose} wide>
      {intro}
      {!link ? (
        <div className="crm-error" role="alert">
          The hospital&apos;s WhatsApp number isn&apos;t set yet, so there&apos;s no link to put in a QR code. An admin can add it in WhatsApp → <a href="/admin/whatsapp?tab=setup">Setup</a>.
        </div>
      ) : (
        <div className="qr-wrap">
          <QrCode text={link} size={220} label={`QR code that opens WhatsApp with ${hospital}`} />
          <div className="qr-side">
            <strong className="qr-title">{info.title}</strong>
            {info.sub && <span className="crm-sub">{info.sub}</span>}
            <span className="qr-msg-label">Their WhatsApp opens with this already typed:</span>
            <span className="qr-msg">{info.message}</span>
            <div className="qr-actions">
              <button type="button" className="crm-btn is-sm" onClick={() => void print()}><Printer size={15} aria-hidden /> Print poster</button>
              <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void png()}><Download size={15} aria-hidden /> QR image</button>
              <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void copy()}><Copy size={15} aria-hidden /> {copied ? 'Copied ✓' : 'Copy link'}</button>
              <button type="button" className="crm-btn is-secondary is-sm" onClick={() => void share()}><Share2 size={15} aria-hidden /> Share</button>
              <a className="crm-btn is-secondary is-sm" href={link} target="_blank" rel="noreferrer"><ExternalLink size={15} aria-hidden /> Test link</a>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
