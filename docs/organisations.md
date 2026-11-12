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

## What is NOT separated yet

- **Vita agents service:** knows only the first organisation. Other organisations get "not available yet" on the
  Agents page and their events are not sent to it.
- **No sign-up**, and the sign-in page and the phone app do not send the organisation yet (`X-Org`).
- **Setup screens** still show the webhook address without `?org=`.
- **Shared by all organisations on the server:** the Groq key and its daily allowance, Firebase (one phone app),
  LiveKit, Mapbox, and the Bihar panchayat list that is loaded into every new database.
- **Scale:** each organisation adds its own database connections and its own pass of every background job. Fine for
  tens of organisations; hundreds will need pooling (PgBouncer) and staggered jobs.

## Trying a second organisation on a test server

Insert a row in the first database and restart the API; the database is created and updated on start:

    insert into marketing.organisations ("Id","Key","Name","Database","Status","CreatedAt")
    values (gen_random_uuid(), 'testlab', 'Test Lab', 'nm_testlab', 'active', now());

It has no users until sign-up is built.
