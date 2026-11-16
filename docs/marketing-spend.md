# Marketing spend

A CRM page (Money & growth → **Marketing spend**) and a phone-app screen (Me → **My expenses**) for what marketing
costs each day, and for who holds the organisation's money.

## What is recorded

**Expenses.** One entry is an amount, a day, a kind and a few words. Kinds: Marketing agents (pay), Food, Petrol,
Banners, Digital marketing, Room rent, Other. An entry is paid either

- by the organisation directly ("office"): it counts in the daily spend and in nobody's balance, or
- by a person, from their advance or their own pocket: it also counts in that person's balance.

**Money given and returned.** Money handed to a person (an advance, or paying back what they spent) and money they
hand back.

## Who can do what

| | Where | What |
|---|---|---|
| Office staff with the **Payments** page | CRM | See everything. With "Can edit": add and correct expenses, approve or reject what agents send, give and take back money. |
| Field agents | Phone app | Add their own expenses with a photo of the bill (all kinds except pay), see their own entries and balance. Never anyone else's. |

An expense added by the office counts at once. One sent from the phone waits under **Waiting for approval** and counts
only once approved. Rejecting needs a reason, which the agent sees. Pay is typed in by the office (kind "Marketing
agents"); it is not worked out from attendance.

## Balance of a person

    balance = money given − money returned − their approved expenses

- above zero: they **hold** that much (an advance not yet spent or returned)
- below zero: **we owe** them that much (they spent their own money)
- zero: settled

So both ways of working use the same page:

1. **Advance first.** Give money → the person spends → each approved expense comes off what they hold → "Took back"
   records anything returned.
2. **Spend first, settle later.** The person adds expenses → approve them → the balance shows "We owe ₹…" →
   when funds come, **Settle** records the payment and the balance returns to zero.

## Rules

- An amount is above zero and at most ₹10,00,000, with two digits after the point at most.
- No day in the future. Agents can go 31 days back, the office two years.
- Nothing is deleted. "Take out" hides an entry from the totals and keeps the row (`Removed`).
- Bill photos are private files, read only through the API by the office or by the agent who sent them.
- The phone keeps a new expense until there is signal; sending twice makes one entry (`ClientId`).

## Server

- Tables `marketing.marketing_expenses` and `marketing.marketing_money_moves` (migration `AddMarketingSpend`).
- `api/v1/spend` (Payments page): the page's data for a range of days, create, correct, `decide`, `remove`, `bill`,
  `people/{agentId}`, `moves`, `moves/{id}/remove`.
- `api/v1/me/spend` (any signed-in person, own rows only): list with balance, add, `bill`, `remove` while waiting.
- The arithmetic is in `Services/Spend.cs`, tested in `SpendTests.cs`.
