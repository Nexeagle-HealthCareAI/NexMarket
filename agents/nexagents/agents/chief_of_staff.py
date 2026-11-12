"""
Vita · Chief of Staff — turns the morning's numbers into a short plan, and sees that it happens.

    7:15 am   signals from the Data Watcher + the analyst's open items + each agent's state
              → at most five priorities, each with its number, who should act, and the first step
              → a Team board card for the ones a person must do (at most three a day, never the same problem
                twice in three days) → work handed to the agents that can do it → the plan sent to the managers
    2:00 pm   a check: what is still open from the morning, and anything new and serious. Silent when all is well.

The AI only chooses and words the priorities from the signals it is given: every priority must point at one of
them, and its numbers are the signal's own. If the AI is not reachable the plan is simply the signals in order.
The Chief of Staff sends nothing outside the hospital: its messages go to the managers' bell, its cards to the
Team board. In shadow it writes the plan to Activity and does nothing else.
"""

from __future__ import annotations

import json
import logging
from datetime import timedelta
from typing import Any, Literal

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from .. import actions, blackboard, db, limits, llm, nexmarket
from ..limits import IST
from . import data_watcher, lead_responder

log = logging.getLogger("nexagents.chief_of_staff")

AGENT_ID = "chief_of_staff"
MAX_PRIORITIES = 5
MAX_CARDS_PER_DAY = 3
WHO = {"desk": "the desk", "marketing": "the marketing manager", "field": "the field team"}
# Signals an agent can act on straight away, and how.
AGENT_FOR = {"leads_waiting": "lead_responder", "leads_idle": "lead_follow_up"}


class Priority(BaseModel):
    signal: str = Field(description="The key of the signal or analyst item this is about, copied exactly.")
    title: str = Field(description="What to do, in under 12 words, plain language.")
    why: str = Field(description="One sentence with the numbers from the signal. No number that is not in the signal.")
    first_step: str = Field(description="The first concrete step, one sentence.")


class Plan(BaseModel):
    headline: str = Field(description="One plain sentence on how today looks.")
    priorities: list[Priority] = Field(default_factory=list, max_length=MAX_PRIORITIES)


SYSTEM = """You are Vita's Chief of Staff for a hospital's marketing team in Bihar, India. You plan the team's day.

You are given SIGNALS (problems found in today's totals by fixed rules) and ANALYST ITEMS (open issues from the
daily analysis). Choose the ones that matter most today, at most {max}, most serious first, and word each as a
priority the team can act on.

Rules:
- Every priority must copy the "key" of one signal or analyst item into "signal". Never invent a priority.
- Use only the numbers given in that signal or item. Never estimate, add or compare numbers yourself.
- Plain words a busy manager reads in ten seconds. No jargon, no praise, no filler.
- If there are no signals and no items, return no priorities and a headline saying things look normal.
- You are told what the team already has a card for; do not repeat those unless the signal is "high".

Today is {today}."""


def _fallback(sigs: list[dict[str, Any]]) -> Plan:
    """No AI: the signals themselves, most serious first."""
    if not sigs:
        return Plan(headline="Nothing unusual in today's numbers.", priorities=[])
    high = sum(1 for s in sigs if s.get("severity") == "high")
    head = f"{high} urgent {'thing' if high == 1 else 'things'} today." if high else f"{len(sigs)} {'thing' if len(sigs) == 1 else 'things'} to look at today, none urgent."
    return Plan(headline=head, priorities=[Priority(signal=s["key"], title=s["title"][:90], why=s["title"], first_step=s.get("todo") or "") for s in sigs[:MAX_PRIORITIES]])


def verify(plan: Plan, known: dict[str, dict[str, Any]]) -> Plan:
    """Only priorities that point at a real signal survive, once each, and their numbers must be the signal's own."""
    import re

    seen: set[str] = set()
    kept: list[Priority] = []
    for p in plan.priorities:
        src = known.get(p.signal)
        if src is None or p.signal in seen:
            continue
        seen.add(p.signal)
        allowed = set(re.findall(r"\d+", json.dumps(src, ensure_ascii=False, default=str)))
        said = set(re.findall(r"\d+", f"{p.title} {p.why} {p.first_step}"))
        if not said <= allowed:
            # A number the signal doesn't have: use the signal's own words instead of the AI's.
            p = Priority(signal=p.signal, title=p.title if not set(re.findall(r"\d+", p.title)) - allowed else str(src.get("title", ""))[:90],
                         why=str(src.get("title") or src.get("detail") or ""), first_step=str(src.get("todo") or ""))
        kept.append(p)
    order = {"high": 0, "medium": 1, "low": 2}
    kept.sort(key=lambda p: order.get(str(known[p.signal].get("severity", "low")), 3))
    return Plan(headline=plan.headline.strip()[:200], priorities=kept[:MAX_PRIORITIES])


def write_up(plan: Plan, known: dict[str, dict[str, Any]]) -> str:
    lines = [plan.headline]
    for i, p in enumerate(plan.priorities, 1):
        who = known[p.signal].get("who") or "marketing"
        lines.append(f"{i}. {p.title} ({WHO.get(who, who)}). {p.why} {p.first_step}".strip())
    return "\n".join(lines)


async def _carded_recently(key: str) -> bool:
    row = await db.fetchone("SELECT count(*) AS n FROM agents.actions WHERE agent_id = %s AND kind = 'board_card' AND status IN ('done', 'shadow') "
                            "AND detail->>'signal' = %s AND created_at > now() - interval '3 days'", AGENT_ID, key)
    return bool(row and row["n"] > 0)


async def _gather() -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]], dict[str, Any]]:
    sigs = await data_watcher.todays_signals()
    try:
        n = await nexmarket.numbers()
    except Exception as e:
        log.warning("chief of staff: NexMarket not reachable: %s", e)
        n = {}
    items = [{"key": f"analyst:{i + 1}", "severity": x.get("severity") or "medium", "title": x.get("title"), "detail": x.get("metric"), "area": x.get("area"),
              "trend": x.get("trend"), "who": "marketing", "todo": ""} for i, x in enumerate(((n.get("analyst") or {}).get("openItems") or [])[:4]) if x.get("title")]
    known = {s["key"]: s for s in [*sigs, *items]}
    return sigs, known, n


async def plan_day() -> dict[str, Any]:
    """The morning run."""
    out: dict[str, Any] = {"priorities": 0, "cards": 0, "handed": 0, "sent": False}
    v = await limits.gate(AGENT_ID, outgoing=False)
    if not v.allowed:
        return out
    live = (await limits.agent_state(AGENT_ID)).get("mode") == "live"
    sigs, known, _ = await _gather()
    carded = [k for k in known if await _carded_recently(k)]
    plan: Plan
    try:
        if not known:
            plan = _fallback([])
        else:
            payload = {"signals": [{k: v for k, v in s.items() if k != "at"} for s in known.values()], "alreadyHasACard": carded}
            plan = await llm.chat(llm.Call(agent_id=AGENT_ID, tier="big", schema=Plan),
                                  [SystemMessage(SYSTEM.format(max=MAX_PRIORITIES, today=db.now().astimezone(IST).strftime("%A %d %B %Y"))),
                                   HumanMessage(json.dumps(payload, ensure_ascii=False, default=str))])
            plan = verify(plan, known)
            if not plan.priorities and any(s.get("severity") == "high" for s in sigs):
                plan = _fallback(sigs)  # the AI dropped something urgent: the rules win
    except (llm.ModelUnavailable, llm.BudgetExceeded) as e:
        log.warning("Chief of Staff could not use the AI: %s", e)
        plan = _fallback(sigs)
    out["priorities"] = len(plan.priorities)
    text = write_up(plan, known)

    # Cards for what a person must do; work for the agents that can do it themselves.
    cards_today = await limits.count_today(AGENT_ID, ["board_card"])
    for p in plan.priorities:
        src = known[p.signal]
        agent = AGENT_FOR.get(p.signal)
        if agent and (await limits.agent_state(agent)).get("mode") == "live":
            if live and agent == "lead_responder":
                await lead_responder.catch_up()
            await actions.record(AGENT_ID, "handoff", "done" if live else "shadow", f"Asked {agent.replace('_', ' ').title()} to deal with: {p.title}", to_agent=agent, detail={"signal": p.signal})
            out["handed"] += 1
            if src.get("severity") != "high":
                continue  # the agent has it; no card needed
        if src.get("severity") == "low" or cards_today + out["cards"] >= MAX_CARDS_PER_DAY or p.signal in carded:
            continue
        if live:
            try:
                await nexmarket.board_card(p.title, f"{p.why}\n\nFirst step: {p.first_step}\n\nFor: {WHO.get(src.get('who') or '', 'the marketing manager')}.",
                                           agent_id=AGENT_ID, priority="high" if src.get("severity") == "high" else "normal", labels=["Vita plan"])
            except Exception:
                log.exception("could not add a Team board card")
                continue
        await actions.record(AGENT_ID, "board_card", "done" if live else "shadow", f"{'Added' if live else 'Would add'} a Team board card: {p.title}", detail={"signal": p.signal})
        out["cards"] += 1

    # The signals are now planned.
    for t in await blackboard.claim(AGENT_ID, [data_watcher.TASK_KIND], limit=30):
        await blackboard.finish(t["id"], AGENT_ID, {"planned": True})

    if live and (plan.priorities or db.now().astimezone(IST).weekday() == 0):
        try:
            await nexmarket.notify_team("Vita's plan for today", text[:900], "ai-agents", agent_id=AGENT_ID)
            out["sent"] = True
        except Exception:
            log.exception("could not send the plan")
    await actions.record(AGENT_ID, "day_plan", "done" if live else "shadow", ("Today's plan: " if live else "Would send today's plan: ") + plan.headline,
                         detail={"text": text, "priorities": [p.model_dump() for p in plan.priorities]})
    return out


async def check_day() -> dict[str, Any]:
    """The 2 pm check: only speaks when something serious is new since the morning, or an agent is stuck."""
    out: dict[str, Any] = {"told": False, "open": 0}
    v = await limits.gate(AGENT_ID, outgoing=False)
    if not v.allowed:
        return out
    live = (await limits.agent_state(AGENT_ID)).get("mode") == "live"
    new = [t for t in await blackboard.claim(AGENT_ID, [data_watcher.TASK_KIND], limit=30)]
    for t in new:
        await blackboard.finish(t["id"], AGENT_ID, {"planned": True})
    fresh = [t["payload"] for t in new if (t.get("payload") or {}).get("severity") in ("high", "medium")]
    stuck = await db.fetch("SELECT for_agent, count(*) AS n FROM agents.tasks WHERE status = 'claimed' AND updated_at < %s AND kind <> %s GROUP BY for_agent",
                           db.now() - timedelta(hours=1), data_watcher.TASK_KIND)
    out["open"] = len(fresh)
    if not fresh and not stuck:
        return out
    lines = [f"- {s['title']} {s.get('todo') or ''}".strip() for s in fresh[:4]]
    lines += [f"- {r['for_agent'] or 'An agent'} has {r['n']} {'task' if r['n'] == 1 else 'tasks'} stuck for over an hour." for r in stuck]
    text = "Since this morning:\n" + "\n".join(lines)
    if live:
        try:
            await nexmarket.notify_team("Vita's afternoon check", text[:900], "ai-agents", agent_id=AGENT_ID)
            out["told"] = True
        except Exception:
            log.exception("could not send the afternoon check")
    await actions.record(AGENT_ID, "day_check", "done" if live else "shadow", f"Afternoon check: {len(lines)} {'thing needs' if len(lines) == 1 else 'things need'} attention", detail={"text": text})
    return out
