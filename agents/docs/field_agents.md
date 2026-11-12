# Vita · Partner Network, Field Coordinator, Camp Planner, Ads Optimiser

*12 Nov 2026 · phases 3–5 · all 14 agents are now built*

None of these four uses AI or sends anything outside the hospital. They read counts from NexMarket, apply plain
rules, and give work to people: a task on a field agent's phone, or a Team board card.

| When (India time) | Agent | Reads | Makes |
|---|---|---|---|
| 9:00 am | Partner Network | partners who went quiet; partners whose patients came | tasks for the partner's own agent |
| 9:10 am, not Sundays | Field Coordinator | panchayats with no check-in for 21 days, per agent's block | one visit list per agent per week |
| Mondays 10 am | Camp Planner | referrals per block in 90 days, partners, last and next camp | up to two "Plan a camp in …?" cards |
| 5:00 pm | Ads Optimiser | Meta and Google campaigns, last 14 days: spend, leads, who came | one card, at most every 3 days |

## Partner Network

- **Quiet:** referred at least twice in the 60 days before and nothing in the last 30 → "Visit … : no referral for N days".
- **Thank:** a patient of theirs came in the last 7 days → "Thank … : N of their patients came this week".
- Thank-yous first, then the biggest past referrers. At most 12 a day.
- NexMarket writes the task, with the partner's name, so the name never leaves it. It refuses when the agent has
  5 open Vita tasks, got 2 today, or the partner belongs to another agent.
- Not the same partner again for 30 days (quiet) or 14 days (thank).
- Every task says: do not offer money or any commission. No WhatsApp message goes to a partner from this agent.

## Field Coordinator

- An agent gets a list when 3 or more active panchayats in their block had no check-in for 21 days, and they
  worked at least once this week. The list is the four longest without a visit.
- Two agents in one block get different panchayats.
- One list per agent per week, never while the last one is open, always inside the agent's own block.
- Agents with no shift in 7 days get no list; the manager gets one card a week with the count (no names).

## Camp Planner

A block is suggested when it had 5 or more referrals in 90 days, has no camp planned, and none in the last 60
days. Ranked by referrals. The card gives the numbers and the department most referred for. A block is not
suggested again for 30 days. It does not book camps or spend money. Once a person creates the camp, the Content
Writer drafts its post and the Broadcast Manager prepares its invitation.

## Ads Optimiser

| Rule | Suggestion |
|---|---|
| Meta: ₹1,000+ spent, no lead in the CRM | check the form and audience, or pause |
| Meta: 8+ leads, nobody came | the audience or offer may be wrong |
| Meta: cost per lead over twice the middle campaign's (3+ campaigns with leads) | costly |
| Meta: lowest cost per patient who came (2+ came) | your best; consider moving budget to it |
| Google: ₹1,000+ and 30+ clicks, no conversion, no call | check the landing page and keywords |

Read only: you run the ads. Every figure is copied from the ad accounts and the CRM.

## Tests

`tests/test_field.py` (8): each plan and its exact wording and figures; tasks to the owning agent once; a full
agent respected; a shared block split; Sunday; shadow; off; cards not repeated.

Not tested here: the four new NexMarket endpoints against the real database, and tasks arriving on a real phone.
