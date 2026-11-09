'use client';

import { useMemo, useState } from 'react';
import { Copy, Link2 } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000';
const ADS_SUFFIX = 'utm_source=google&utm_medium=cpc&utm_campaign={campaignid}';
const SOURCES = [
  { k: 'facebook', l: 'Facebook' }, { k: 'instagram', l: 'Instagram' }, { k: 'whatsapp', l: 'WhatsApp' },
  { k: 'youtube', l: 'YouTube' }, { k: 'poster', l: 'Poster / QR code' }, { k: 'sms', l: 'SMS' }, { k: 'google', l: 'Google (not an ad)' },
];

/** Lower-case words joined by underscores: "Cardiology Nov" → "cardiology_nov". */
const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);

function formHtml(api: string) {
  return `<form action="${api}/api/v1/public/web-lead" method="post">
  <input name="name" placeholder="Your name" required>
  <input name="phone" type="tel" placeholder="Mobile number" required>
  <select name="department">
    <option value="">Which department?</option>
    <option>Orthopaedics</option><option>Cardiology</option><option>Dialysis</option>
  </select>
  <textarea name="message" placeholder="How can we help?"></textarea>
  <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
  <input type="hidden" name="next" value="https://YOUR-SITE/thank-you">
  <input type="hidden" name="utm_source"><input type="hidden" name="utm_medium">
  <input type="hidden" name="utm_campaign"><input type="hidden" name="gclid"><input type="hidden" name="page">
  <button type="submit">Request a call back</button>
</form>
<script>
(function () {
  var q = new URLSearchParams(location.search), keep = ['utm_source', 'utm_medium', 'utm_campaign', 'gclid'];
  keep.forEach(function (k) { if (q.get(k)) try { sessionStorage.setItem(k, q.get(k)); } catch (e) {} });
  document.querySelectorAll('form[action$="/web-lead"]').forEach(function (f) {
    keep.forEach(function (k) { var v = q.get(k); try { v = v || sessionStorage.getItem(k); } catch (e) {} if (v) f.elements[k].value = v; });
    f.elements.page.value = location.pathname;
  });
})();
</script>`;
}

/**
 * How Google numbers get matched to real patients when the ads are run by hand in Google Ads: one setting in Google Ads,
 * tagged links for everything else, and the website form that drops enquiries straight into the Leads inbox.
 */
export function GoogleTracking({ toast }: { toast: (m: string) => void }) {
  const [url, setUrl] = useState('');
  const [src, setSrc] = useState('facebook');
  const [name, setName] = useState('');
  const [showForm, setShowForm] = useState(false);
  const link = useMemo(() => {
    const u = url.trim();
    if (!u || !slug(name)) return '';
    try {
      const full = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`);
      full.searchParams.set('utm_source', src);
      full.searchParams.set('utm_medium', src === 'poster' ? 'offline' : src === 'sms' ? 'sms' : 'social');
      full.searchParams.set('utm_campaign', slug(name));
      return full.toString();
    } catch { return ''; }
  }, [url, src, name]);
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast(`${what} copied.`); } catch { toast('Copy blocked by the browser. Select and copy it instead.'); }
  };

  return (
    <section className="crm-card so-card gg-track">
      <h2 className="crm-h2" style={{ margin: 0 }}><Link2 size={17} aria-hidden /> Tracking: matching Google to real patients</h2>

      <div className="gg-track-step">
        <strong>1. Google Ads, once for the whole account</strong>
        <span className="crm-sub">In Google Ads → Admin → Account settings → <em>Tracking</em> → <em>Final URL suffix</em>, paste this and save. Every ad then tells the website which campaign the visitor came from, and website enquiries are matched to the campaign by themselves.</span>
        <span className="gg-copy"><code>{ADS_SUFFIX}</code><button type="button" className="crm-btn is-secondary is-sm" onClick={() => void copy(ADS_SUFFIX, 'Suffix')}><Copy size={13} aria-hidden /> Copy</button></span>
        <span className="crm-sub">For calls from ads: when the desk adds a lead who says &ldquo;I saw a Google ad&rdquo;, pick <strong>Google ad</strong> and choose the campaign from the list.</span>
      </div>

      <div className="gg-track-step">
        <strong>2. Links you share anywhere else</strong>
        <span className="crm-sub">Facebook posts, WhatsApp messages, posters with a QR code: tag the link so its visits and enquiries show under its own name.</span>
        <div className="gg-form">
          <label className="crm-field">Page on the website
            <input className="crm-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="glisanhospital.com/dialysis" spellCheck={false} />
          </label>
          <label className="crm-field">Where you&apos;ll share it
            <select className="crm-input" value={src} onChange={(e) => setSrc(e.target.value)}>{SOURCES.map((s) => <option key={s.k} value={s.k}>{s.l}</option>)}</select>
          </label>
          <label className="crm-field">Campaign name
            <input className="crm-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Dialysis November" maxLength={60} />
          </label>
        </div>
        {link ? (
          <span className="gg-copy"><code>{link}</code><button type="button" className="crm-btn is-sm" onClick={() => void copy(link, 'Link')}><Copy size={13} aria-hidden /> Copy link</button></span>
        ) : <span className="crm-sub">Fill in the page and a campaign name to get the link.</span>}
      </div>

      <div className="gg-track-step">
        <strong>3. The website&apos;s enquiry form</strong>
        <span className="crm-sub">Give this to whoever runs the website. Enquiries then arrive in the Leads inbox by themselves (as <strong>Website</strong>, or <strong>Google ad</strong> when the visitor came from an ad), with the campaign filled in and a notification to the desk. Change the departments and the thank-you page; keep the field names.</span>
        <button type="button" className="wa-link" style={{ alignSelf: 'flex-start' }} aria-expanded={showForm} onClick={() => setShowForm((v) => !v)}>{showForm ? 'Hide the form code' : 'Show the form code'}</button>
        {showForm && (
          <>
            <pre className="gg-code">{formHtml(API)}</pre>
            <button type="button" className="crm-btn is-secondary is-sm" style={{ alignSelf: 'flex-start' }} onClick={() => void copy(formHtml(API), 'Form code')}><Copy size={13} aria-hidden /> Copy form code</button>
          </>
        )}
      </div>
    </section>
  );
}
