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

## Not built yet (phase 3 and 4)

Search Console figures per page, enquiries per page, translations, re-review reminders, more than one website per organisation, chains, starter websites.
