# Vita · Reputation, Content Writer, Social Publisher, Broadcast Manager

*12 Nov 2026 · phases 3–4 · the studio*

| When (India time) | Agent | What it does | AI |
|---|---|---|---|
| every 30 min, 9 am–8 pm | Reputation | Thanks 4 and 5 star Google reviews; brings 3 stars or fewer to a person | none |
| 9:30 am | Content Writer | Drafts Facebook posts from camps and OPD days | writes the draft |
| 10 am, 6 pm | Social Publisher | Posts drafts a person approved | none |
| 11 am, 4 pm | Broadcast Manager | Gets the camp invitation ready and waits for your OK | none |

## What a person still decides

```
Content Writer drafts → Guard checks → YOU mark good / edit / wrong → Social Publisher posts
Broadcast Manager prepares → Guard checks → YOU press "Good, send it" → NexMarket schedules
```
Nothing reaches Facebook or a partner's WhatsApp without a person's click. Only the thank-you on a good Google
review goes out by itself.

## Reputation

NexMarket tells it only the stars, the date and the script of each unanswered review
(`/reviews/unanswered`). The reviewer's name and words never leave NexMarket, and no AI is used.

- **4–5 stars:** one of a few fixed thank-yous in Hindi, Bangla or English (`THANKS`), chosen by the review's id.
  At most 5 a run and 10 a day; not in quiet hours.
- **3 stars or fewer:** one high-priority Team board card and one alert. Vita never answers these.
- The wording never mentions illness, treatment, staff or bills, and never confirms the reviewer was a patient.

## Content Writer

Reads only the directory (departments, doctors' OPD days, camps) and the hospital facts. Topics: each camp in the
next 7 days; on Mondays one department's OPD days. At most 2 drafts a day, in Hindi.

The Compliance Guard checks each draft in full: every day, date, time, place and name against the record, plus
the claims rules. A draft that fails is logged as blocked and not shown for approval.

Live → the draft is *held* for a person. Shadow → a practice draft that can be judged but is never posted.
Corrections feed the Coach, so its lessons improve the next drafts.

## Social Publisher

Takes the oldest draft a person marked good or edited in the last 7 days. Skips a camp that is over. Runs the
Guard's rules again on the final text (a person's edit included). One post a run, two a day. After two failed
tries it stops and the failure stays in Activity.

Facebook **text** posts only. It needs the Facebook page connection (Marketing settings) to allow publishing;
if Facebook refuses, its reason is logged. Instagram needs a picture, which Vita does not make.

## Broadcast Manager

For a camp 2 to 5 days away with no invitation yet, it prepares the approved `camp_invite` template for the
partners of the camp's block. Skipped (and logged once) when nobody in the block can receive broadcasts or the
block had any broadcast in the last 7 days. NexMarket repeats these checks when a person presses send.

## Tests

`tests/test_studio.py` (12): every fixed thank-you against the public-reply rules; topics; each agent live, in
shadow, off; quiet hours and daily caps; a wrong date stopped by the Guard; nothing published without a
person's "good"; an unsafe edit stopped; Facebook refusing; the invitation sent only on a person's OK.

Not tested here: a real reply on Google, a real Facebook post, a real broadcast, and the real model's drafts.
