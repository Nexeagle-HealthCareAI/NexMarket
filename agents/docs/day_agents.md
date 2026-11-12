# Vita · Data Watcher, Chief of Staff, Reporter & Coach

*11 Nov 2026 · phase 2 · the day runs itself*

```
6:30, then hourly 8–20   Data Watcher     numbers → signals (fixed rules, no AI)
7:15                     Chief of Staff   signals → plan → cards for people, work for agents, plan to the managers
14:10                    Chief of Staff   a check: silent unless something serious is new
20:10                    Reporter         the evening report to the managers
20:30                    Coach            suggested lessons from the week's corrections
```
India time. A run missed by up to an hour (a restart) still happens. An admin can run any of them now from the
agent's card.

## Data Watcher

Asks NexMarket for `GET /api/v1/internal/agent-tools/numbers`: today's totals next to what is usual **by this
time of day** (the average of the last 7 days up to the same clock time), plus week-on-week totals. Counts only.

| Signal | When | Severity |
|---|---|---|
| Leads with no reply | 3 or more waiting over 30 minutes, or one waiting 2 hours | high |
| WhatsApp failing | 5+ failed today and at least 1 in 5 | high |
| No WhatsApp arriving | none by 1 pm when 5+ are usual | high |
| Fewer leads / a channel silent | half the usual by noon; a source at 0 by 1 pm | medium |
| Referrals, arrivals down | 40% below the week before | medium |
| Few agents in the field | half the usual by 11 am (not Sundays) | medium |
| Low Google review unanswered, WhatsApp paused, an agent paused or failing | any | medium |
| More leads than usual, lost leads up, overdue tasks, hoardings ending or waiting, idle leads, drafts to check | see `signals()` | low |

Each signal is raised once a day. A high one is also sent to the managers at once (live mode only).

## Chief of Staff

Gives the AI the signals and the analyst's open items, and asks for at most five priorities. Then checks the
answer itself: a priority that points at no real signal is dropped, and one that contains a number the signal
doesn't have gets the signal's own sentence instead. With no AI the plan is the signals in order.

- **Cards:** one Team board card per high or medium priority, at most 3 a day, and not for a problem that got a
  card in the last 3 days.
- **Agents:** "leads with no reply" starts the Lead Responder's catch-up when it is live.
- **Managers:** the plan goes to the bell. On a day with no signals nothing is sent, except Mondays.
- **Shadow:** the plan is written to Activity (and can be checked there); no card, no message.

## Reporter & Coach

**Report:** totals + what each agent did + today's signals + what happened to leads after they were answered
(`/lead-outcomes`: wrote back, appointment, came; Vita's answers next to the desk's). A line with a number the
report was not given is dropped. With no AI the report is the plain totals.

**Coach:** needs at least two drafts a person edited or marked wrong in the last 7 days. Phone numbers and names
are removed before the AI sees them. It suggests at most two lessons per agent; a suggestion with a price, a
long number, a promise or a name is refused. Suggestions wait on the Lessons tab: **an agent reads a lesson
only after a person presses Keep.** Used corrections are not used again.

## Tests

`tests/test_day.py` (39): every rule, the small wobbles that must not signal, mornings and Sundays, the plan
and report checks, and each agent live, in shadow, off, and without the AI.

Not tested here: the wording the real Groq model writes, and the numbers endpoint against the real database.
