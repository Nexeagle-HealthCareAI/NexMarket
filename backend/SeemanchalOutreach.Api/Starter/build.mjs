// Builds the website from the files in content/ into dist/. No packages needed: `node build.mjs`.
// The NexMarket CRM writes content/*.json when something is published; this turns them into plain, fast HTML pages.
// A mistake in a content file stops the build with a plain message, so a broken page never goes live.
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(root, 'dist');
const read = (name, fallback) => {
  const file = path.join(root, 'content', name);
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { fail(name, `can't be read: ${e.message}`); }
};
function fail(file, message) { console.error(`content/${file}: ${message}`); process.exit(1); }
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slugOk = (s) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(s));
const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

const site = read('site.json', null);
if (!site || !text(site.name ?? site.description)) fail('site.json', 'needs at least the hospital name ("name") and a short "description".');
const SITE_URL = (process.env.SITE_URL || site.website || '').replace(/\/$/, '');
const NAME = site.name || 'Our hospital';
const doctors = read('doctors.json', []);
const faqs = read('faqs.json', []);
const posts = read('blog.json', []).filter((p) => p.status === 'published');
const camps = read('camps.json', []).filter((c) => c.date >= today).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
const notices = read('notices.json', []).filter((n) => (!n.startDate || n.startDate <= today) && (!n.endDate || n.endDate >= today));
const stories = read('testimonials.json', []).filter((t) => t.consentRecorded === true);
const locations = read('locations.json', []);
const redirects = read('redirects.json', []);
const departments = read('departments.json', []);

posts.forEach((p, i) => { if (!slugOk(p.slug) || !text(p.title)) fail('blog.json', `article ${i + 1} needs a "slug" and a "title".`); });
locations.forEach((l, i) => { if (!slugOk(l.slug) || !text(l.town)) fail('locations.json', `area ${i + 1} needs a "slug" and a "town".`); });
doctors.forEach((d, i) => { if (!text(d.name)) fail('doctors.json', `doctor ${i + 1} has no "name".`); });

const phone = site.phone ? `+91${site.phone}` : '';
const nav = [['/', 'Home'], ['/doctors', 'Doctors'], ...(departments.length ? [['/departments', 'Departments']] : []), ...(posts.length ? [['/blogs', 'Health articles']] : []),
  ...(camps.length ? [['/health-camps', 'Health camps']] : []), ['/faqs', 'Questions'], ['/contact', 'Contact']];
const routes = [];

function page(route, title, description, body, opts = {}) {
  routes.push({ route, noindex: !!opts.noindex });
  const canonical = SITE_URL + (route === '/' ? '/' : route);
  const html = `<!doctype html>
<html lang="${opts.lang || 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${opts.noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${esc(canonical)}">`}
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
${opts.noindex ? '' : `<meta property="og:url" content="${esc(canonical)}">`}
<link rel="stylesheet" href="/style.css">
${opts.schema ? `<script type="application/ld+json">${JSON.stringify(opts.schema).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${notices.map((n) => `<div class="notice ${n.tone === 'urgent' ? 'is-urgent' : ''}" role="${n.tone === 'urgent' ? 'alert' : 'status'}"><div class="wrap">${esc(n.text)}${n.link ? ` <a href="${esc(n.link.href)}">${esc(n.link.label)}</a>` : ''}</div></div>`).join('\n')}
<header class="top"><div class="wrap top-in">
<a class="brand" href="/">${esc(NAME)}</a>
<nav aria-label="Main"><ul>${nav.map(([h, l]) => `<li><a href="${h}"${h === route ? ' aria-current="page"' : ''}>${l}</a></li>`).join('')}</ul></nav>
${phone ? `<a class="call" href="tel:${phone}" data-track="call">Call ${esc(site.phone)}</a>` : ''}
</div></header>
<main id="main" class="wrap">
${body}
</main>
<footer class="foot"><div class="wrap">
<p><strong>${esc(NAME)}</strong></p>
${site.address ? `<p>${esc(site.address)}</p>` : ''}
${site.consultationTimings ? `<p>${esc(site.consultationTimings)}</p>` : ''}
<p>${locations.length ? '<a href="/areas">Areas we serve</a> · ' : ''}<a href="/privacy-policy">Privacy policy</a></p>
${site.medicalDisclaimer ? `<p class="small">${esc(site.medicalDisclaimer)}</p>` : ''}
</div></footer>
</body>
</html>
`;
  const dir = path.join(out, route === '/' ? '' : route);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, route === '/404' ? '../404.html' : 'index.html'), html);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(root, 'style.css'), path.join(out, 'style.css'));
if (fs.existsSync(path.join(root, 'public'))) fs.cpSync(path.join(root, 'public'), out, { recursive: true });

const hospital = { '@context': 'https://schema.org', '@type': 'Hospital', name: NAME, url: SITE_URL || undefined, telephone: phone || undefined, description: site.description,
  areaServed: locations.map((l) => ({ '@type': 'Place', name: l.district ? `${l.town}, ${l.district}` : l.town })) };
const doctorCard = (d) => `<article class="card"><h3>${esc(d.name)}</h3><p class="muted">${esc([d.specialty || d.department, d.qualifications].filter(Boolean).join(' · '))}</p>${d.biography ? `<p>${esc(d.biography)}</p>` : ''}${d.consultationTimings ? `<p class="small">${esc(d.consultationTimings)}</p>` : ''}${d.bookingUrl ? `<p><a class="btn" href="${esc(d.bookingUrl)}" data-track="booking">Book an appointment</a></p>` : ''}</article>`;
const campCard = (c) => `<article class="card" id="${esc(c.slug)}"><p class="muted">${esc(new Date(c.date + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }))}, ${esc(c.startTime)}–${esc(c.endTime)}</p><h3>${esc(c.title)}${c.free ? ' <span class="tag">Free</span>' : ''}</h3><p>${esc(c.place)}${c.address ? `, ${esc(c.address)}` : ''}</p><p>${esc(c.description)}</p>${(c.services || []).length ? `<ul>${c.services.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}</article>`;

page('/', `${NAME}`, site.description, `
<section class="hero"><h1>${esc(NAME)}</h1><p class="lead">${esc(site.description)}</p>
<p>${phone ? `<a class="btn" href="tel:${phone}" data-track="call">Call us</a> ` : ''}${site.whatsappNumber ? `<a class="btn is-alt" href="https://wa.me/91${esc(site.whatsappNumber)}" data-track="whatsapp">WhatsApp</a>` : ''}</p></section>
${doctors.length ? `<section><h2>Our doctors</h2><div class="grid">${doctors.slice(0, 6).map(doctorCard).join('')}</div><p><a href="/doctors">All doctors</a></p></section>` : ''}
${camps.length ? `<section><h2>Upcoming health camps</h2><div class="grid">${camps.slice(0, 3).map(campCard).join('')}</div></section>` : ''}
${stories.length ? `<section><h2>Patient stories</h2><div class="grid">${stories.slice(0, 6).map((s) => `<figure class="card"><blockquote>${esc(s.quote)}</blockquote><figcaption>${esc(s.name)}${s.place ? `, ${esc(s.place)}` : ''}</figcaption></figure>`).join('')}</div><p class="small">Shared with each patient's written consent.</p></section>` : ''}
${posts.length ? `<section><h2>Health articles</h2><ul class="list">${posts.slice(0, 5).map((p) => `<li><a href="/blogs/${p.slug}">${esc(p.title)}</a></li>`).join('')}</ul></section>` : ''}`, { schema: hospital });

page('/doctors', `Doctors | ${NAME}`, `The doctors at ${NAME}.`, `<h1>Our doctors</h1><div class="grid">${doctors.map(doctorCard).join('')}</div>`);
if (departments.length) page('/departments', `Departments | ${NAME}`, `Departments at ${NAME}.`, `<h1>Departments</h1><ul class="list">${departments.map((d) => `<li><strong>${esc(d.name)}</strong>${d.description ? ` – ${esc(d.description)}` : ''}</li>`).join('')}</ul>`);
page('/faqs', `Questions | ${NAME}`, `Answers to common questions about ${NAME}.`, `<h1>Questions and answers</h1>${faqs.map((f) => `<details><summary>${esc(f.question)}</summary><p>${esc(f.answer)}</p></details>`).join('') || '<p>No questions yet.</p>'}`,
  { schema: faqs.length ? { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })) } : null });
page('/contact', `Contact | ${NAME}`, `How to reach ${NAME}.`, `<h1>Contact</h1>${phone ? `<p>Phone: <a href="tel:${phone}" data-track="call">${esc(site.phone)}</a></p>` : ''}${site.whatsappNumber ? `<p>WhatsApp: <a href="https://wa.me/91${esc(site.whatsappNumber)}" data-track="whatsapp">${esc(site.whatsappNumber)}</a></p>` : ''}${site.email ? `<p>Email: <a href="mailto:${esc(site.email)}">${esc(site.email)}</a></p>` : ''}${site.address ? `<p>${esc(site.address)}</p>` : ''}${site.consultationTimings ? `<p>${esc(site.consultationTimings)}</p>` : ''}${site.emergencyInfo ? `<p><strong>${esc(site.emergencyInfo)}</strong></p>` : ''}`);
page('/privacy-policy', `Privacy policy | ${NAME}`, `How ${NAME} uses information.`, `<h1>Privacy policy</h1><p>${esc(NAME)} uses the details you give us (name, phone number and your message) only to reply and arrange your care. We don't sell them. The website counts clicks on call, WhatsApp and booking buttons per page, without names, numbers or addresses. To have your information removed, contact us at ${esc(site.email || site.phone || 'the hospital')}.</p>`);
if (posts.length) {
  page('/blogs', `Health articles | ${NAME}`, `Patient-education articles from ${NAME}.`, `<h1>Health articles</h1><ul class="list">${posts.map((p) => `<li><a href="/blogs/${p.slug}">${esc(p.title)}</a><br><span class="muted">${esc(p.excerpt)}</span></li>`).join('')}</ul>`);
  for (const p of posts) {
    page(`/blogs/${p.slug}`, `${p.title} | ${NAME}`, p.excerpt, `<article lang="${p.language || 'en'}"><h1>${esc(p.title)}</h1><p class="muted">${esc(p.author)}${p.reviewedBy ? ` · Medically reviewed by ${esc(p.reviewedBy)}${p.reviewedOn ? ` on ${esc(p.reviewedOn)}` : ''}` : ''}</p>
${p.image ? `<img src="${esc(p.image.src)}" alt="${esc(p.image.alt)}" loading="lazy">` : ''}<p class="lead">${esc(p.excerpt)}</p>
${(p.sections || []).map((s) => `<h2>${esc(s.heading)}</h2>${(s.paragraphs || []).map((x) => `<p>${esc(x)}</p>`).join('')}${(s.points || []).length ? `<ul>${s.points.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`).join('\n')}
${(p.related || []).length ? `<h2>Related reading</h2><ul>${p.related.map((r) => `<li><a href="${esc(r.href)}">${esc(r.label)}</a></li>`).join('')}</ul>` : ''}
${(p.references || []).length ? `<h2>References</h2><ol>${p.references.map((r) => `<li><a href="${esc(r.url)}" rel="noopener">${esc(r.label)}</a></li>`).join('')}</ol>` : ''}
${site.medicalDisclaimer ? `<p class="small">${esc(site.medicalDisclaimer)}</p>` : ''}</article>`,
      { lang: p.language || 'en', schema: { '@context': 'https://schema.org', '@type': 'MedicalWebPage', headline: p.title, description: p.excerpt, datePublished: p.publishedAt, ...(p.reviewedBy ? { reviewedBy: { '@type': 'Person', name: p.reviewedBy }, lastReviewed: p.reviewedOn } : {}) } });
  }
}
if (camps.length) page('/health-camps', `Health camps | ${NAME}`, `Upcoming health camps by ${NAME}.`, `<h1>Health camps</h1><div class="grid">${camps.map(campCard).join('')}</div>`,
  { schema: { '@context': 'https://schema.org', '@graph': camps.map((c) => ({ '@type': 'Event', name: c.title, startDate: `${c.date}T${c.startTime}:00+05:30`, endDate: `${c.date}T${c.endTime}:00+05:30`, location: { '@type': 'Place', name: c.place }, eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode' })) } });
if (locations.length) {
  page('/areas', `Areas we serve | ${NAME}`, `Towns and areas ${NAME} serves.`, `<h1>Areas we serve</h1><ul class="list">${locations.map((l) => `<li><a href="/areas/${l.slug}">${esc(l.town)}</a>${l.distance ? ` <span class="muted">${esc(l.distance)}</span>` : ''}</li>`).join('')}</ul>`);
  for (const l of locations) page(`/areas/${l.slug}`, `${NAME} for patients from ${l.town}`, `${l.town}${l.district ? `, ${l.district}` : ''}: how to reach ${NAME} and the care people from here come for.`,
    `<h1>For patients from ${esc(l.town)}</h1>${l.distance ? `<p class="muted">${esc(l.distance)}</p>` : ''}<p>${esc(l.intro).replace(/\n+/g, '</p><p>')}</p><h2>How to reach us</h2><p>${esc(l.howToReach).replace(/\n+/g, '</p><p>')}</p>
${(l.services || []).length ? `<h2>Care people from ${esc(l.town)} often come for</h2><ul>${l.services.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
${(l.faqs || []).length ? `<h2>Questions</h2>${l.faqs.map((f) => `<details><summary>${esc(f.question)}</summary><p>${esc(f.answer)}</p></details>`).join('')}` : ''}`);
}
for (const r of redirects) {
  if (routes.some((x) => x.route === r.from)) fail('redirects.json', `"${r.from}" is a page on this site, so it can't be redirected.`);
  const dir = path.join(out, r.from); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><link rel="canonical" href="${esc(SITE_URL + r.to)}"><meta http-equiv="refresh" content="0; url=${esc(r.to)}"><title>Moved</title><p>This page has moved: <a href="${esc(r.to)}">${esc(r.to)}</a></p>`);
}
page('/404', `Page not found | ${NAME}`, 'This page could not be found.', `<h1>Page not found</h1><p><a href="/">Go to the home page</a></p>`, { noindex: true });
page('/preview', `Preview | ${NAME}`, 'A preview of a page that is not published yet.', `<div id="preview"><p>Loading the preview…</p></div>
<script>
(function(){var p=new URLSearchParams(location.hash.slice(1)),t=p.get('t')||'',o=p.get('o')||'',api=${JSON.stringify(process.env.PREVIEW_API || 'https://nexmarket-api.nexeagle.com')};
var el=document.getElementById('preview');function e(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
if(!/^[A-Za-z0-9_-]{20,80}$/.test(t)){el.innerHTML='<p>This preview link is not complete.</p>';return}
fetch(api+'/api/v1/website-preview/'+t+(o?'?org='+encodeURIComponent(o):'')).then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(x){var d=x.data,h='<p class="tag">Preview, not published</p>';
if(x.type==='article'){h+='<h1>'+e(d.title)+'</h1><p class="lead">'+e(d.excerpt)+'</p>'+(d.sections||[]).map(function(s){return '<h2>'+e(s.heading)+'</h2>'+(s.paragraphs||[]).map(function(q){return '<p>'+e(q)+'</p>'}).join('')+((s.points||[]).length?'<ul>'+s.points.map(function(q){return '<li>'+e(q)+'</li>'}).join('')+'</ul>':'')}).join('')}
else if(x.type==='location'){h+='<h1>For patients from '+e(d.town)+'</h1><p>'+e(d.intro)+'</p><h2>How to reach us</h2><p>'+e(d.howToReach)+'</p>'}
else{h+='<h1>'+e(x.title)+'</h1><pre>'+e(JSON.stringify(d,null,2))+'</pre>'}el.innerHTML=h}).catch(function(){el.innerHTML='<p>This preview has expired. Open a new one from the CRM.</p>'})})();
</script>`, { noindex: true });

// Count call, WhatsApp and booking clicks per page (no names, numbers or addresses), when the CRM address is set.
if (process.env.CRM_EVENTS_URL) {
  const js = `document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('[data-track]');if(!a||!navigator.sendBeacon)return;navigator.sendBeacon(${JSON.stringify(process.env.CRM_EVENTS_URL)},new Blob([JSON.stringify({kind:a.getAttribute('data-track'),page:location.pathname})],{type:'text/plain'}))});`;
  fs.writeFileSync(path.join(out, 'track.js'), js);
  for (const r of routes) { const f = r.route === '/404' ? path.join(out, '404.html') : path.join(out, r.route, 'index.html'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('</body>', '<script src="/track.js" defer></script>\n</body>')); }
}

const indexed = routes.filter((r) => !r.noindex && r.route !== '/404');
fs.writeFileSync(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexed.map((r) => `  <url><loc>${esc(SITE_URL + r.route)}</loc></url>`).join('\n')}\n</urlset>\n`);
fs.writeFileSync(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /preview\n${SITE_URL ? `Sitemap: ${SITE_URL}/sitemap.xml\n` : ''}`);
console.log(`Built ${routes.length} pages into dist/.`);
