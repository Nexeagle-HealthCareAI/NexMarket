"""
Vita · Field Coordinator — finds the panchayats nobody has visited, and asks the block's agent to go.

No AI. Every morning except Sunday it asks NexMarket how each field agent's block is covered:

    3 or more active panchayats with no check-in for 21 days, and the agent worked this week
        → one task: "Visit these panchayats this week: A, B, C, D" (the four longest without a visit)
    two agents in one block get different panchayats
    field agents who have not started work at all in 7 days → one Team board card a week for the manager (a count, no names)

One coverage task per agent per week, and never while the last one is still open (NexMarket refuses). The task is
always inside the agent's own block.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from .. import actions, db, limits, nexmarket
from ..limits import IST

log = logging.getLogger("nexagents.field_coordinator")

AGENT_ID = "field_coordinator"
MIN_STALE = 3
PER_TASK = 4


def plan(data: dict[str, Any]) -> tuple[list[dict[str, Any]], int]:
    """(tasks to give, how many agents have not worked this week). Agents sharing a block get different panchayats."""
    tasks: list[dict[str, Any]] = []
    idle = 0
    taken: dict[str, set[str]] = {}
    for a in sorted(data.get("agents") or [], key=lambda x: str(x.get("agentId"))):
        if int(a.get("shiftsLast7Days") or 0) == 0:
            idle += 1
            continue  # no point giving a list to someone who isn't in the field; the manager hears instead
        used = taken.setdefault(str(a.get("block")), set())
        stale = [p for p in (a.get("stale") or []) if str(p["id"]) not in used]
        total_stale = int(a.get("panchayats") or 0) - int(a.get("visitedIn21Days") or 0)
        if total_stale < MIN_STALE or not stale or int(a.get("openAiTasks") or 0) >= 5:
            continue
        chosen = stale[:PER_TASK]
        used.update(str(p["id"]) for p in chosen)
        tasks.append({"agent": str(a["agentId"]), "block": a.get("block"), "panchayats": [str(p["id"]) for p in chosen], "names": [str(p["name"]) for p in chosen],
                      "stale": total_stale, "of": int(a.get("panchayats") or 0)})
    return tasks, idle


async def _recent(kind: str, subject: tuple[str, str], days: int) -> bool:
    row = await db.fetchone("SELECT count(*) AS n FROM agents.actions WHERE agent_id = %s AND kind = %s AND subject_type = %s AND subject_id = %s "
                            "AND status IN ('done', 'shadow') AND created_at > %s", AGENT_ID, kind, subject[0], subject[1], db.now() - timedelta(days=days))
    return bool(row and row["n"] > 0)


async def tick() -> dict[str, int]:
    out = {"tasks": 0, "shadow": 0, "refused": 0, "idle": 0}
    v = await limits.gate(AGENT_ID, outgoing=False)
    if not v.allowed or db.now().astimezone(IST).weekday() == 6:
        return out
    try:
        data = await nexmarket.field_coverage()
    except Exception as e:
        log.warning("field coordinator: NexMarket not reachable: %s", e)
        return out
    live = (await limits.agent_state(AGENT_ID)).get("mode") == "live"
    tasks, idle = plan(data)
    out["idle"] = idle
    for t in tasks:
        subject = ("agent", t["agent"])
        if await _recent("coverage_task", subject, 6):
            continue
        summary = f"an agent in {t['block']} to visit {len(t['names'])} panchayats nobody has been to for 3 weeks ({t['stale']} of {t['of']} in the block are overdue)"
        if live:
            try:
                await nexmarket.make_task("coverage", for_agent=t["agent"], agent_id=AGENT_ID, panchayats=t["panchayats"])
            except nexmarket.NexMarketError:
                out["refused"] += 1
                continue
        await actions.record(AGENT_ID, "coverage_task", "done" if live else "shadow", ("Asked " if live else "Would ask ") + summary, subject=subject,
                             detail={"panchayats": t["names"], "block": t["block"]})
        out["tasks" if live else "shadow"] += 1
    if idle >= 1 and not await _recent("idle_agents", ("team", "field"), 7):
        title = f"{idle} field {'agent has' if idle == 1 else 'agents have'} not started work in the last 7 days"
        if live:
            try:
                await nexmarket.board_card(title, "They have no shift in the app this week, so Vita gave them no visit list. Check leave and attendance on the Team page.",
                                           agent_id=AGENT_ID, priority="normal", labels=["Field"])
            except Exception:
                log.exception("could not add the idle agents card")
                return out
        await actions.record(AGENT_ID, "idle_agents", "done" if live else "shadow", ("" if live else "Would tell the manager: ") + title, subject=("team", "field"))
    return out
