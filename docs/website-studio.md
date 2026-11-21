# Website (content, review, publish)

The CRM's **Website** page is where the hospital's website content is written, checked and published, without touching code:
articles, questions and answers, the hospital's details, doctors, health camps, notices, patient stories, the text of the service pages, and redirects.

## What it does

| Tab | For | What you do |
|---|---|---|
| Content | Writers | Every kind of content, filtered by kind; doctors and camps can be added from the CRM's own records |
| Waiting for review | Reviewer (a doctor or hospital person) | Read, approve, or send back with a note |
| Publish | Publisher | Tick what is ready, publish (or put on staging first), see what is scheduled, progress and history |
| Media | Writers | The picture library: add, describe, replace, see where each is used |
| Hospital details | Writers | Phone, WhatsApp, email, timings, emergency text, description, disclaimer; and the list of missing information |
| Developer | Developer | The exact files the website gets, how publishing works, build logs |
| Setup | Developer | Connect the website's GitHub repository, bring in current content, switches |

## The path of an article

Draft → Send for review → Approved (by a named reviewer) → Publish → Website checks → Accepted → Live

- Any change after it was sent for review puts it back to Draft: an approval is for the exact text that was read.
- An article that is live can be edited. The live copy stays as it is until the new version is approved and published.
- "Take off the website" removes it from the site but keeps it here. Archive hides a draft. Nothing is deleted.
- Every save, approval and publish is kept in History, and any older version can be put back.

## Kinds of content

| Kind | File | Review by default | Notes |
|---|---|---|---|
| Articles | `content/blog.json` | Always | Web address can be changed; the old one then redirects |
| Questions | `content/faqs.json` | No | Order set here |
| Hospital details | `content/site.json` | No | Can't be taken down |
| Doctors | `content/doctors.json` | No | "Add to the website" from Departments & doctors; "Update from the CRM record" later |
| Health camps | `content/camps.json` | No | "Put on the website" from Health camps; comes off by itself the day after |
| Notices | `content/notices.json` | No | Shown at the top of every page between their dates |
| Patient stories | `content/testimonials.json` | Yes | Never published without written consent noted (the note stays in the CRM) |
| Service pages | `content/services.json` | Yes | Text only; brought in from the website; can't be taken down |
| Redirects | `content/redirects.json` | No | Made by itself when an article's address changes |

Which kinds need a review is set in Setup (articles always do).

## Tools in the editor

- **Autosave**: a draft saves itself a few seconds after the last change.
- **Publish now**: for kinds that need no review, one step from draft to live.
- **Preview on the website**: opens the draft in the website's real design, for 30 minutes, from a link only you have.
- **Check before publishing**: every link and picture is tried; shows how the page looks in Google and when shared on WhatsApp.
- **Schedule**: go live and/or come off at a set time.
- **Put on staging first**: when a staging branch is set in Setup.
- **History**: every version; Compare with the draft; Put back as draft; Roll back the website to a version that was live (keeping the reviewer who approved it).
- **Edit as JSON** (developers): the same checks run.

## Rules the CRM enforces

1. A medical article is never published without a named reviewer. The reviewer's name shows on the article.
2. Nothing is deleted.
3. A failed check never changes the live website. The reason is shown in plain words.
4. AI writes drafts only. They are labelled, never published by themselves, and carry no references: a person adds real ones.
5. An article's web address is made once from its title and does not change afterwards.
6. One publish runs at a time.
7. A patient story is never published without written consent recorded.
8. A change made directly on GitHub is noticed within 10 minutes and recorded as a version; a draft open in the CRM is kept.
9. Link checks only ever reach public internet addresses.

## Four rights (Users & roles)

| Right | "Can edit" means | Default |
|---|---|---|
| Website: see and write | write drafts, send for review | Marketing manager, Digital marketing (Hospital rep: view) |
| Website: review | approve or send back | Hospital representative |
| Website: publish | publish and take down | Marketing manager, Digital marketing |
| Website: developer | setup, files, logs | Digital marketing |

Admins have all four.

## How publishing works (developer)

1. The CRM builds `content/blog.json`, `content/faqs.json` or `content/site.json` from what will be live. Only the files for the kinds of content in this publish are written. An article picture goes to `public/media/blogs/<slug>.<ext>`.
2. It commits them on a new branch `crm/publish-<time>` and opens a pull request.
3. The website's own GitHub workflow builds and checks the pull request.
4. All checks pass → the CRM merges (squash). A check fails → the CRM closes the pull request, the items go back to where they were, and the reason is read from the build log (the website prints `content/<file>: <reason>`).
5. The website deploys from the main branch as it always has. The CRM follows that run and then shows "Live".

If the repository requires a person's approval to merge, the CRM waits (up to a day) and carries on when someone approves on GitHub.

### Connect once (Setup tab)

1. Create a GitHub App: permissions **Contents** and **Pull requests** read and write, **Checks** and **Actions** read-only; webhook off. Install it on the website's repository only.
2. In Setup: repository, website address, App ID, the private key (.pem). The key is stored encrypted and never shown again (only its last 4 characters).
3. **Test the connection**.
4. **Bring in from the website**: reads the current files so the CRM starts from what is live. Publishing is blocked until this is done, so a first publish cannot wipe existing questions or details.

The website must already have its content files (`content/site.json`, `faqs.json`, `blog.json`) on the main branch.

### Server pieces

- `Services/Website.cs`: `SiteConfig` (settings, prefix `site.`), `SiteRules` (validation, moves, file generation; tested), `GitHubClient`, `SitePublisher`, `SitePublishWorker` (one step every 20 seconds per organisation).
- `Controllers/WebsiteController.cs`: `api/v1/website`.
- `Services/WebsiteTypes.cs`: the kinds of content and their fields (`SiteTypes`). `Services/WebsiteChecks.cs`: the link checker.
- `Controllers/WebsiteController.More.cs`: rename, schedule, roll back, preview, checks, missing information, sync, media library, CRM records; `WebsitePreviewController` (`api/v1/website-preview/{key}`, no sign-in, 30-minute keys held in memory).
- Tables: `site_contents`, `site_content_versions`, `site_publishes`, `site_media` (migrations `AddWebsiteStudio`, `AddWebsitePhase2`).
- AI: `ChatAiService.ArticleDraftAsync`, `ArticleSuggestAsync`, `ArticleClaimsAsync`; switch `site.ai` in Setup; shares the daily AI allowance.

`SiteRules.Problems` mirrors the website's `src/data/content.ts`. If the content shape changes, change both.

## The website side

The website reads each file in `content/` and checks it when it builds (`src/data/content.ts`); see `content/README.md` in the website repository. It also has:

- a **Health camps** page and footer link, only while a camp is upcoming, with event details for Google;
- a **notice bar** at the top of every page while a notice is current;
- **patient stories** on the home page, only when there is at least one;
- a **/preview** page (never indexed) that shows a draft from the CRM;
- `/_content/services.json`, the service pages' current text, which the CRM reads when it brings content in.

With no camps, notices or stories, every existing page is built exactly as before.

## Search & results (phase 3)

The **Search & results** tab shows every page for the last 28 days with complete figures (Google stops at three days ago) against the 28 days before: visits from Google, times shown, average place, page views (Google Analytics), and enquiries, admissions, calls, WhatsApp taps and bookings for that page.

- **What to work on first** lists pages losing visits (down by 30% or more from at least 10), pages almost on page 1 (place 8 to 20, shown 50+ times) and pages competing for the same search.
- In the editor, the **Search & results** box shows the page's own figures, what people searched, questions people ask (**Answer it** adds a section to write), suggested **pages to link to** (**Add** puts them under Related reading), and AI suggestions of questions (only the page's public text and searches go to the AI).
- **Enquiries per page** come from the Leads inbox: each website enquiry now records the page it came from.
- **Calls, WhatsApp taps and bookings per page** are counted only if the website build turns it on (`VITE_CRM_EVENTS_URL`). Only the page and the kind of tap are counted, one number per page per day: no names, phone numbers or IP addresses.
- **Writing checks** appear under "Worth improving for Google": long paragraphs and sentences, repeated headings, and hard English (reading ease under 50). They never block publishing.

## Translations

On an approved English article, **Hindi** or **Bengali** makes an AI draft at `/blogs/<slug>-hi` or `-bn`, labelled as AI, linked to the original. It goes through the same review by a named doctor; nothing is published automatically.

## Re-review

An article or medical page reviewed more than 12 months ago (change it in Setup) is listed under **Waiting for review → Due for a fresh look**, and the office gets one reminder a month. The page stays live. A doctor reviews it again and the new date shows on the website.

## Areas served

**Areas served** pages (`/areas/<town>`) say how to reach the hospital from a nearby town and which services people from there come for. To stop thin copies, each needs at least 120 words of its own and the town named in the text, and cannot be more than half the same as another area page.

## Chains (head office and branches)

In Setup, a branch names its head office and the head office lists its branches; both sides must agree. The head office ticks **Share with branches** on a page. The branch sees it under **From the head office** and adopts it as its own draft (still reviewed there). When the head office changes the page, the branch can **take the latest**; fields the branch changed itself are kept.

## Starter website

For a new organisation without a website: **Setup → Starter website** downloads a small static website (Node builder, no framework) filled from the CRM's doctors, departments and camps, or opens a pull request into an **empty** GitHub repository (it refuses a repository that already has a website). `README.md` inside says how to build and host it.

## Developer: webhooks and read API

- **Webhooks** (up to three): after each publish the CRM sends `content.published` to your address, signed: header `X-NexMarket-Signature: sha256=<HMAC-SHA256 of the body with your secret>`. Failed sends are retried after 1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours. Only public, non-private addresses are allowed.
- **API keys**: shown once when made, stored only as a hash; the list shows the last 4 characters. Revoke any time.
- `GET /api/v1/public/website/content?type=<kind>` and `/website/content/<kind>/<key>` with header `X-Api-Key` return the live public content only.
- Click counting: `POST /api/v1/public/web-event?org=<id>` (rate limited).

Server pieces: `Services/WebsiteInsights.cs` (figures, fixes, writing checks, related pages), `Services/WebsitePlatform.cs` (webhooks, keys, chains), `Services/WebsiteStarter.cs` and `Starter/` (starter website), `Controllers/WebsiteController.Growth.cs`. Tables `site_events`, `site_api_keys`, `site_webhook_deliveries` (migration `AddWebsitePhase34`).

## Not built

- AI descriptions of pictures (the AI cannot see the picture; write them yourself).
- More than one website per organisation (use one organisation per website).
