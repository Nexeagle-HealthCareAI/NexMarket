# Vita · Lead Responder — analysis and test report

*9 Nov 2026 · phase 2, first agent*

## What it is for

NexMarket already does three things the moment a lead writes on WhatsApp: a fixed instant reply ("thanks, we got
your message"), keyword replies, and sharing new leads among the desk. What it can't do is **answer the actual
question** ("Is the eye doctor in on Saturday?") — today that waits for a person, sometimes for hours, at night
until morning.

The Lead Responder does that one step: it reads the question, answers it **only from live records** (doctors and
their OPD days and timings, upcoming camps, the facts pack), sets the lead's department, and hands everything it
should not answer to a person.

## Decisions (9 Nov 2026)

| Question | Decision |
|---|---|
| What may go to the AI (Groq)? | The question text only, with names, phone numbers, emails, ID numbers, PIN codes and house numbers removed first. Never the lead's name or phone (NexMarket doesn't even send them to the agent). |
| When does it answer? | In office hours it waits **3 minutes** so the desk can answer first; outside office hours at once. Emergencies never wait. |
| Limits | 1 reply per lead per hour; quiet hours don't apply to replies to people who wrote first. |

## How it works

```
lead writes → NexMarket tells Vita (after saving) → task waits (3 min in office hours)
→ checks → triage (rules) → decide (AI) → verify → Compliance Guard → send, or hand to a person
```

1. **Checks (no AI):** Stop all / paused / off; lead said STOP; WhatsApp's 24-hour window closed; WhatsApp paused;
   someone (desk or Vita) already answered the latest messages.
2. **Triage (no AI), four languages:**
   - *Emergency* (unconscious, chest pain, not breathing, bleeding, accident, snake bite, poison, seizure, labour,
     suicide…) → fixed emergency message (hospital number and 112) and an **urgent** alert. Once per 30 minutes per
     lead; the desk is alerted every time.
   - *Price, fees, insurance, Ayushman · complaints · reports · voice notes/photos* → a person. The AI never sees these.
3. **Decide (AI, `gpt-oss-20b`):** a typed answer — intent, language, department, reply, the record ids it used.
4. **Verify (code):** department must be a real one; record ids must exist; appointments, prices, reports,
   complaints and medical questions never get an AI reply; a factual reply with no record behind it isn't sent.
5. **Compliance Guard:** every time, day and date in the reply must appear in the records it cited (a wrong day or
   date is blocked), plus the hospital policy check. One rewrite; if it still fails, a person gets it.
6. **Send** through NexMarket, which refuses if the lead opted out, the window closed, WhatsApp is paused, or a desk
   member replied in the meantime.
7. **Hand to a person:** a note on the lead and one alert per lead per hour to its owner (or the desk).

Shadow mode runs every step and records what it *would* send, sending nothing.

## Tests

| Layer | Tests | What they prove |
|---|---|---|
| Rules | 82 | Redaction (13 identifier types; ages, days and times kept); emergencies in English, Hinglish, Hindi and Bangla, and look-alikes that are *not* emergencies; hand-offs; office-hours waiting; checking the AI's answer; the Guard catching wrong days, times and dates. |
| Pipeline (real Postgres) | 30 | Answers from records; shadow sends nothing; wrong day → blocked → person; a rewrite that fixes it is sent; invented doctor/department not sent; Groq down → person, nothing sent; opt-out, closed window, paused, already answered → no AI call at all; desk answers mid-send; caps; Stop all stops before the AI; emergencies without AI and in quiet hours; repeated emergencies; one desk alert per hour; the model never sees numbers or names; 3-minute wait, emergencies jump the queue; many messages → one task. |
| End to end over HTTP | 1 run | The real service with a NexMarket stand-in that answers in the .NET JSON shapes: events, waiting tasks, the 15-second worker, emergency, price hand-off, no-AI hand-off. |
| Live (real Groq) | 40 cases | `scripts/eval_lead_responder.py` — run when Groq is reachable. Not run yet. |

### Bugs the tests found (fixed)

1. **Missed emergency:** "सीने में बहुत तेज दर्द" (very sharp chest pain) wasn't caught — the rule needed the words
   side by side. Now a few words may sit between them, in all four languages.
2. **Timing question sent to the desk as a price question:** "OPD kitne baje se kitne baje tak hai?" — "kitne"
   (how many) was on the money list.
3. **Guard date check too loose:** a date passed if its digits appeared anywhere in the record ("1 Nov" passed for a
   14 Nov camp). Now day and month are compared.
4. During Stop all a run still called the AI before being stopped at sending; now it stops first.
5. Repeated emergency messages would each send the emergency text; now once per 30 minutes, alerts every time.
6. Every unanswerable message alerted the desk; now once per lead per hour.

## Known limits

- It answers WhatsApp leads only. Web-form and Facebook-form leads have no 24-hour window (a template is needed); the
  Lead Follow-up agent covers them.
- A name written in an unusual way ("Ramesh here") may reach the AI; numbers, IDs and "my name is…" never do.
- Its answers are only as good as the doctor list and OPD timings in NexMarket (Departments page) and the facts pack.

## Switching it on

Admin → Vita marketing agents → Lead Responder → Mode **Shadow** for a week; read Activity; then **Live**.
