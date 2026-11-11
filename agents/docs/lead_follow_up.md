# Vita · Lead Follow-up, and making the Lead Responder dependable

*11 Nov 2026 · phase 2, second agent*

## What changed

| Gap | Now |
|---|---|
| A lead could be missed if the agents service was restarting when it wrote | Every 3 minutes Vita asks NexMarket which leads are still waiting for an answer and queues any it has not looked at (`catch_up`). |
| A failed run alerted nobody | The lead's owner (or the desk) is told to reply; managers are told once in 30 minutes. A task given up on after three tries is reported once. |
| Shadow drafts could only be read | Activity → **To check**: *Good, send it* · *Send my version* · *Wrong*. The verdicts are the agent's score on its card. |
| Nothing wrote lessons | Tick **Teach this** on a correction, or add a lesson on the Lessons tab. The agent reads up to 8 on every run. |
| Voice notes always went to a person | NexMarket writes the voice note out (the app's speech service) and the Lead Responder reads it like text. |
| Appointment requests were only handed over | Vita thanks them, asks what time suits for a call (fixed wording, no AI), and puts the time they give on the lead. |
| "Unusual volume" limit was stored but not checked | An agent sending 30+ messages in a day at 3× its usual is paused and the managers told. |
| Leads that went quiet were forgotten | The Lead Follow-up agent (below). |

## Lead Follow-up

No AI. It sends the follow-up template chosen in WhatsApp → Setup (the wording Meta approved), on a fixed rhythm:

```
quiet lead → follow-up 1 (after 1 day) → follow-up 2 (2 days later) → follow-up 3 (4 days later)
           → still quiet 3 days later: the owner is asked, once, to call them
           → still quiet 10 days after the last follow-up: closed as lost, "No response after 3 follow-ups"
```

- A web-form lead that nobody has contacted, and that has been sent nothing, gets its first message after 30 minutes.
- Every open lead is followed up, also the ones staff typed in (decided 11 Nov 2026). Those people did not write to
  the hospital first, so the template they get should make sense to someone who only gave their number at the desk.
- A reply from the lead resets the count and goes to the Lead Responder.
- Never after an opt-out, never to a lead that is no longer open, never within 20 hours of the last follow-up.
  NexMarket enforces these again when sending.
- Runs every hour from 10 am to 6 pm; quiet hours apply; at most 40 a day (Limits tab) and 20 a run.
- It does not change the lead's status and does not count as the desk's first response.
- Closing: "Close a quiet lead after this many days" on the Limits tab (10; 0 = never). NexMarket refuses to close a
  lead that has written again, is no longer open, or had a follow-up in the last 3 days. A person can reopen it.

Switch it on: Admin → Vita marketing agents → Lead Follow-up → **Shadow** first. In shadow it records each
follow-up it would send (once per lead per day) and sends nothing.

## Tests

`TEST_DATABASE_URL=… pytest` — 223 tests. New in `tests/test_dependable.py` (44): appointment acknowledgement and
call time; catch-up; failure alerts; checking a draft (good, edited, wrong, refused by the rules, refused by
NexMarket, Stop all); lessons reaching the next run; the volume pause; the follow-up rules (19 cases) and runs
(live, shadow, quiet hours, daily cap, off, no template, Guard block).

Not tested here: a real voice note from Meta, a real template send, and answers from the real Groq model.
