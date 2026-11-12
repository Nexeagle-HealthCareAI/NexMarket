"""
Vita · Reporter & Coach — the evening report, and lessons from the day's corrections.

    8:00 pm   REPORT  today's totals + what each agent did + what happened to the leads that were answered
                      → a short report to the managers: what went well, what didn't, what to do tomorrow
    8:30 pm   COACH   the drafts people corrected or marked wrong this week (with their notes)
                      → at most two suggested lessons per agent, each one general sentence
                      → shown on the Lessons tab as "suggested"; an agent only reads a lesson after a person keeps it

Only totals and the (already name-free) draft texts go to the AI. The report's numbers are checked against the
totals it was given: a line with a number that isn't there is dropped. Without the AI the report is the plain
totals. The Reporter sends nothing outside the hospital.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from .. import actions, db, limits, llm, nexmarket
from ..limits import IST
from ..privacy import redact
from . import data_watcher

log = logging.getLogger("nexagents.reporter_coach")

AGENT_ID = "reporter_coach"
MAX_SUGGESTIONS = 2          # per agent per evening
MAX_OPEN_SUGGESTIONS = 6     # per agent: the Coach waits for people to decide before adding more


class Report(BaseModel):
    headline: str = Field(description="One plain sentence on how the day went.")
    went_well: list[str] = Field(default_factory=list, max_length=3, description="Each one sentence with its number.")
    problems: list[str] = Field(default_factory=list, max_length=3, description="Each one sentence with its number.")
    tomorrow: list[str] = Field(default_factory=list, max_length=3, description="Each one concrete thing to do.")


REPORT_SYSTEM = """You write the evening report for a hospital's marketing team in Bihar, India.

You are given today's TOTALS, what each Vita AGENT did today, the SIGNALS raised today, and OUTCOMES (what
happened to leads after they were answered, over 7 days). Write a short, honest report.

Rules:
- Use only numbers that appear in what you are given. Never estimate, add up, or work out percentages.
- Each line is one plain sentence a manager understands at a glance. No jargon, no praise, no filler.
- "tomorrow" lines are concrete actions for people, drawn from the problems and signals.
- If the day was ordinary, say so and keep the lists short or empty.

Today is {today}."""


def _numbers_in(obj: Any) -> set[str]:
    return set(re.findall(r"\d+", json.dumps(obj, ensure_ascii=False, default=str)))


def verify(r: Report, given: Any) -> Report:
    """Drops any line that contains a number the report was not given."""
    ok = _numbers_in(given)

    def keep(lines: list[str]) -> list[str]:
        return [x.strip()[:240] for x in lines if x.strip() and set(re.findall(r"\d+", x)) <= ok][:3]

    head = r.headline.strip()[:200]
    if not set(re.findall(r"\d+", head)) <= ok:
        head = "Here is today in numbers."
    return Report(headline=head, went_well=keep(r.went_well), problems=keep(r.problems), tomorrow=[x.strip()[:240] for x in r.tomorrow if x.strip()][:3])


def plain(n: dict[str, Any], agents: dict[str, dict[str, Any]], sigs: list[dict[str, Any]]) -> Report:
    """The report without AI: the totals, said plainly."""
    g = lambda *p: int(data_watcher._n(n, *p))  # noqa: E731
    well, bad = [], []
    well.append(f"{g('leads', 'today')} new leads today (yesterday {g('leads', 'yesterday')}).")
    if g("referrals", "today"):
        well.append(f"{g('referrals', 'today')} partner referrals today.")
    done = sum(int(a.get("done") or 0) for a in agents.values())
    if done:
        well.append(f"Vita's agents completed {done} actions.")
    for s in sigs[:3]:
        bad.append(str(s.get("title")))
    return Report(headline="Here is today in numbers.", went_well=well[:3], problems=bad, tomorrow=[str(s.get("todo")) for s in sigs[:3] if s.get("todo")])


def write_up(r: Report) -> str:
    out = [r.headline]
    for title, lines in (("Went well", r.went_well), ("Problems", r.problems), ("Tomorrow", r.tomorrow)):
        if lines:
            out.append(f"{title}:")
            out += [f"- {x}" for x in lines]
    return "\n".join(out)


async def report() -> dict[str, Any]:
    out: dict[str, Any] = {"sent": False, "ai": False}
    v = await limits.gate(AGENT_ID, outgoing=False)
    if not v.allowed:
        return out
    live = (await limits.agent_state(AGENT_ID)).get("mode") == "live"
    try:
        n = await nexmarket.numbers()
    except Exception as e:
        log.warning("reporter: NexMarket not reachable: %s", e)
        return out
    try:
        outcomes = await nexmarket.lead_outcomes(7)
    except Exception:
        outcomes = {}
    agents = await data_watcher.agents_state()
    sigs = [{k: v for k, v in s.items() if k != "at"} for s in await data_watcher.todays_signals()]
    given = {"totals": {k: v for k, v in n.items() if k != "analyst"}, "agents": agents, "signals": sigs, "outcomesLast7Days": outcomes}
    try:
        r: Report = await llm.chat(llm.Call(agent_id=AGENT_ID, tier="big", schema=Report),
                                   [SystemMessage(REPORT_SYSTEM.format(today=db.now().astimezone(IST).strftime("%A %d %B %Y"))),
                                    HumanMessage(json.dumps(given, ensure_ascii=False, default=str))])
        r = verify(r, given)
        out["ai"] = True
    except (llm.ModelUnavailable, llm.BudgetExceeded) as e:
        log.warning("Reporter could not use the AI: %s", e)
        r = plain(n, agents, sigs)
    text = write_up(r)
    if live:
        try:
            await nexmarket.notify_team("Vita's evening report", text[:900], "ai-agents", agent_id=AGENT_ID)
            out["sent"] = True
        except Exception:
            log.exception("could not send the evening report")
    await actions.record(AGENT_ID, "day_report", "done" if live else "shadow", ("Evening report: " if live else "Would send the evening report: ") + r.headline,
                         detail={"text": text, "outcomes": outcomes})
    return out


# ─── Coach ────────────────────────────────────────────────────────────────────

class Lessons(BaseModel):
    lessons: list[str] = Field(default_factory=list, max_length=MAX_SUGGESTIONS,
                               description="General rules of one sentence each that would have prevented these corrections. Empty when the corrections share no pattern.")


COACH_SYSTEM = """You coach an AI agent that works for a hospital's marketing team. Its job: {job}

Below are messages it drafted, and how a person corrected each one: a better version, a note, or "wrong".
Write at most {max} lessons that would have prevented these corrections.

Rules:
- A lesson is one general sentence the agent can follow next time, not a description of one case.
- Never include a name, phone number, date, price, or anything about one patient.
- Never tell the agent to give medical advice, prices, or promises about results.
- Do not repeat a lesson it already has (listed below). If the corrections show no clear pattern, return none.

Lessons it already has:
{have}"""

BANNED = re.compile(r"\d{4,}|₹|rs\.?\s*\d|guarantee|100\s*%|cure", re.I)


async def coach() -> dict[str, Any]:
    """Suggests lessons from this week's corrections. A person keeps or drops each one on the Lessons tab."""
    from .base import runtime
    from .registry import AGENTS

    out: dict[str, Any] = {"suggested": 0}
    v = await limits.gate(AGENT_ID, outgoing=False)
    if not v.allowed or runtime.store is None:
        return out
    for a in AGENTS:
        if not a.built or a.id in ("compliance_guard", AGENT_ID):
            continue
        rows = await db.fetch(
            "SELECT detail->>'text' AS draft, review FROM agents.actions WHERE agent_id = %s AND reviewed_at > now() - interval '7 days' "
            "AND review->>'verdict' IN ('edited', 'wrong') AND NOT coalesce((review->>'coached')::boolean, false) ORDER BY reviewed_at DESC LIMIT 12", a.id)
        if len(rows) < 2:
            continue  # one correction is not a pattern
        have = await runtime.lessons(a.id, kept_only=False, limit=50)
        if sum(1 for x in have if x.get("status") == "proposed") >= MAX_OPEN_SUGGESTIONS:
            continue
        cases = [{"draft": redact(str(r["draft"] or ""))[:500], "verdict": r["review"].get("verdict"),
                  "betterVersion": redact(str(r["review"].get("text") or ""))[:500] or None, "note": redact(str(r["review"].get("note") or ""))[:300] or None} for r in rows]
        try:
            got: Lessons = await llm.chat(llm.Call(agent_id=AGENT_ID, tier="big", schema=Lessons),
                                          [SystemMessage(COACH_SYSTEM.format(job=a.job, max=MAX_SUGGESTIONS, have="\n".join(f"- {x['text']}" for x in have if x.get("status") != "dropped") or "- (none)")),
                                           HumanMessage(json.dumps(cases, ensure_ascii=False))])
        except (llm.ModelUnavailable, llm.BudgetExceeded) as e:
            log.warning("Coach could not use the AI: %s", e)
            return out
        known = {str(x.get("text", "")).strip().lower() for x in have}
        for text in got.lessons[:MAX_SUGGESTIONS]:
            text = redact(text.strip())[:400]
            if len(text) < 12 or text.lower() in known or BANNED.search(text) or "[" in text:
                continue
            await runtime.propose_lesson(a.id, text, cases=len(rows))
            await actions.record(AGENT_ID, "lesson_suggested", "done", f"Suggested a lesson for {a.name}: {text[:200]}", to_agent=a.id)
            out["suggested"] += 1
        # These corrections have been used; the Coach doesn't suggest from them again.
        await db.execute("UPDATE agents.actions SET review = review || '{\"coached\": true}'::jsonb WHERE agent_id = %s AND reviewed_at > now() - interval '7 days' "
                         "AND review->>'verdict' IN ('edited', 'wrong')", a.id)
    return out
