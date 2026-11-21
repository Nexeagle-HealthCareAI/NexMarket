# Starter website

Made by the NexMarket CRM from your organisation's records. It is a small, fast website built from the files in `content/`:
the CRM's Website page writes those files whenever something is published, and this site turns them into pages.

## Build

    node build.mjs

Needs Node 18 or newer, no packages. The pages go into `dist/`. Set `SITE_URL` (for example `https://yourhospital.in`) so links and the sitemap use your address.

Optional:
- `CRM_EVENTS_URL`: your CRM's click counter, `https://<crm-api>/api/v1/public/web-event?org=<your org>`. When set, the site counts call, WhatsApp and booking clicks per page (no names, numbers or addresses) so the CRM can show which pages bring patients.
- `PREVIEW_API`: your CRM's API address, for preview links (default `https://nexmarket-api.nexeagle.com`).

## Publish

Any static host works (Netlify, Cloudflare Pages, GitHub Pages, or nginx). An example GitHub Actions workflow is in `deploy-example.yml`:
it builds on every pull request (so a mistake in a content file is caught before it goes live) and deploys from `main`.
Copy it to `.github/workflows/deploy.yml` and fill in your host's step.

## Content files

The same files as every NexMarket website: `site.json`, `doctors.json`, `faqs.json`, `blog.json`, `camps.json`, `notices.json`,
`testimonials.json`, `locations.json`, `redirects.json`, and `departments.json`. A mistake stops the build with a plain message naming the file.
