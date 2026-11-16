# Marketing spend

A CRM page (Money & growth → **Marketing spend**) and a phone-app screen (Me → **My expenses**) for what marketing
costs each day, and for who holds the organisation's money.

## What is recorded

**Expenses.** One entry is an amount, a day, a kind and a few words. Kinds: Salaries, Food, Petrol, Stay,
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
only once approved. Rejecting needs a reason, which the agent sees. Salaries are recorded by the office under **Team and salaries** (below); they are not worked out from attendance.

## Team and salaries

The **Team and salaries** tab is the marketing payroll.

- **Add a person to the team** with a monthly salary and the month it starts from. Only people with a login can be
  added. A raise is "Change salary … from month": earlier months keep the salary they had.
- **Pay salary** records a payment for a person and a month, all of it or a part, with the day, how it was paid and a
  note or reference. A month is then *Not paid*, *Partly paid*, *Fully paid* or *Paid extra*.
- Each payment also counts in the daily spend under **Salaries**, on the day it was paid.
- **Details** on a person shows the salary over time, every month since they joined (due, paid, left), every payment,
  and the other costs on them.
- **Take off the payroll** stops salaries after a last month. The record and its payments are kept.
- A first month is due in full; for someone who joined late in it, record the smaller payment and note why.

## Costs per person

An expense can be tagged to the person it was spent on (their petrol, food, stay…):

- an expense a person paid themselves is theirs automatically;
- for one the organisation paid, pick the person under **Spent on** in Add expense.

**Analytics → By person** shows the spend on each person by kind for the days picked, salary included. A person's
Details shows all of it.

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

- Tables `marketing.marketing_expenses` and `marketing.marketing_money_moves` (migration `AddMarketingSpend`);
  `marketing.marketing_staff`, `marketing.marketing_salary_rates` and four more expense columns (`AddMarketingSalaries`).
- `api/v1/spend` (Payments page): the page's data for a range of days, create, correct, `decide`, `remove`, `bill`,
  `people/{agentId}`, `moves`, `moves/{id}/remove`, `team`, `team/{agentId}`, `team/{agentId}/off`, `salary`.
- `api/v1/me/spend` (any signed-in person, own rows only): list with balance, add, `bill`, `remove` while waiting.
- The arithmetic is in `Services/Spend.cs`, tested in `SpendTests.cs`.
