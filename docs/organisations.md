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

## What is NOT separated yet (so do not add a second real organisation yet)

- Background jobs (reminders, broadcasts, Google sync, notifications, analyst) still run for the first organisation only.
- Queued work (notifications, live events), SignalR groups and presence do not carry the organisation.
- Meta / Google webhooks and the web lead form always go to the first organisation.
- Uploaded files share one folder tree.
- The Vita agents service knows one organisation.
- There is no sign-up, and the sign-in page does not ask for the organisation.

## Trying a second organisation on a test server

Insert a row in the first database and restart the API; the database is created and updated on start:

    insert into marketing.organisations ("Id","Key","Name","Database","Status","CreatedAt")
    values (gen_random_uuid(), 'testlab', 'Test Lab', 'nm_testlab', 'active', now());

It has no users until sign-up is built.
