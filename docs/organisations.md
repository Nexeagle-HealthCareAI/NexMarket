# Organisations (many customers on one server)

NexMarket is being opened up so any healthcare organisation (hospital, clinic, diagnostic centre, lab, pharmacy,
dialysis centre…) can run its own account. This file describes the foundation that is in place.

## How it is separated

- Each organisation has **its own database** on the same Postgres server (`nm_<key>`).
- The **first organisation** is the server's own database (`ConnectionStrings:DefaultConnection`). It also holds the
  list of organisations, in `marketing.organisations`. That table exists in every database but is only used in the first.
- An organisation with branches in several cities is still **one organisation, one database**. Branches come next.

## How a request finds its database

1. Signed in: the `org` claim in the token decides. A header or cookie cannot change it.
   Tokens issued before this change have no claim and belong to the first organisation.
2. Not signed in (sign-in page, public form, webhook): the `X-Org` header, else the `nx_org` cookie left by the last
   sign-in, else the first organisation.
3. An unknown organisation is refused (404, or 401 when signed in). It never falls back to another one's data.

`OrgScope.Current` holds the organisation for the piece of work in hand; every database connection, the saved
settings and the in-memory cache follow it. Background work uses `OrgDirectory.ForEachAsync`.

## What is separated

- **Data:** every request and every background job uses the organisation's own database.
- **Background jobs:** call clean-up, hoarding reminders, Google sync, lead reminders, broadcasts and the daily AI
  briefing run once per organisation.
- **Notifications:** each one remembers its organisation from the moment it is queued.
- **Live updates:** dashboard, personal and map groups are per organisation (`org:<key>:…`).
- **Memory:** saved settings, the in-memory cache, presence ("online") and the WhatsApp bill are per organisation.
- **Files:** other organisations' files are saved under `org/<key>/…`, and a file opens only for its own organisation.
- **Webhooks and public forms:** add `?org=<key>` to the address (Meta webhook, web lead form). Google sign-in comes
  back through the browser, which carries the `nx_org` cookie.

## Sign-up and sign-in

- **Sign-up** (`/signup`, `POST api/v1/signup`): anyone can create an organisation. It reserves the short sign-in
  name, creates the database `nm_<name>`, and makes the person the admin (User ID `admin`, or their mobile number).
- **Limits:** 5 tries per 10 minutes per network, one sign-up at a time, and `Platform:MaxSignupsPerDay` (default 10)
  new organisations a day. `Platform:SignUpOpen=false` closes sign-up.
- **Not verified:** the phone number and email are not checked yet. There is no email or SMS sender on the server.
- **Sign-in:** the web page and the phone app have an Organisation field. Empty = the first organisation.
- **The database user needs the CREATEDB right**, and PostGIS must be installable in new databases.
- A browser or phone that holds field work from one organisation will not sign in to another (web), or starts
  clean (phone app), so two organisations' work never mixes.

## What is NOT separated yet

- **Vita agents service:** knows only the first organisation. Other organisations get "not available yet" on the
  Agents page and their events are not sent to it.
- **Setup screens** still show the webhook address without `?org=`.
- **New organisations start with no geography** (the Bihar panchayat list belongs to the first organisation), no
  branches, and the first organisation's wording on many screens.
- **Shared by all organisations on the server:** the Groq key and its daily allowance, Firebase (one phone app),
  LiveKit and Mapbox.
- **Scale:** each organisation adds its own database connections and its own pass of every background job. Fine for
  tens of organisations; hundreds will need pooling (PgBouncer) and staggered jobs.
