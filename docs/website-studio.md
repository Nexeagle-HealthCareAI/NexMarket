# Website (content, review, publish)

The CRM's **Website** page is where the hospital's website content is written, checked and published, without touching code.
This is phase 1: articles, questions and answers, and the hospital's details.

## What it does

| Tab | For | What you do |
|---|---|---|
| Content | Writers | Write articles and questions, save drafts, send for review |
| Waiting for review | Reviewer (a doctor or hospital person) | Read, approve, or send back with a note |
| Publish | Publisher | Tick what is ready, publish, see progress and history |
| Hospital details | Writers | Phone, WhatsApp, email, timings, emergency text, description, disclaimer |
| Developer | Developer | The exact files the website gets, how publishing works, build logs |
| Setup | Developer | Connect the website's GitHub repository, bring in current content, switches |

## The path of an article

Draft → Send for review → Approved (by a named reviewer) → Publish → Website checks → Accepted → Live

- Any change after it was sent for review puts it back to Draft: an approval is for the exact text that was read.
- An article that is live can be edited. The live copy stays as it is until the new version is approved and published.
- "Take off the website" removes it from the site but keeps it here. Archive hides a draft. Nothing is deleted.
- Every save, approval and publish is kept in History, and any older version can be put back.

## Rules the CRM enforces

1. A medical article is never published without a named reviewer. The reviewer's name shows on the article.
2. Nothing is deleted.
3. A failed check never changes the live website. The reason is shown in plain words.
4. AI writes drafts only. They are labelled, never published by themselves, and carry no references: a person adds real ones.
5. An article's web address is made once from its title and does not change afterwards.
6. One publish runs at a time.

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
- Tables: `site_contents`, `site_content_versions`, `site_publishes` (migration `AddWebsiteStudio`).
- AI: `ChatAiService.ArticleDraftAsync`, `ArticleSuggestAsync`, `ArticleClaimsAsync`; switch `site.ai` in Setup; shares the daily AI allowance.

`SiteRules.Problems` mirrors the website's `src/data/content.ts`. If the content shape changes, change both.

## Not in phase 1

Search-engine tools (per-page titles and descriptions for all pages, redirects, sitemap and schema views, Search Console numbers per article), scheduling, doctors and departments pages, more than one website per organisation.
