"""
Vita · Broadcast Manager — gets the camp invitation ready, and waits for your OK.

    11 am and 4 pm → camps 2 to 5 days away that have had no invitation yet
      → the partners of the camp's block (people who opted out or have a wrong number are already left out)
      → not if that block got any broadcast in the last 7 days
      → the Guard's rules on the wording (the approved camp template, filled from the camp's record)
      → held in Activity → To check: "Camp invitation ready for 84 partners in Amour". A person presses
        "Good, send it" and NexMarket schedules it; the checks above are made again at that moment.

It never sends a broadcast on its own. No AI: the wording is the approved template.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from .. import act, actions, db, limits, nexmarket
from ..guard.check import GuardRequest

log = logging.getLogger("nexagents.broadcast_manager")

AGENT_ID = "broadcast_manager"


async def _proposed(camp_id: str) -> bool:
    row = await db.fetchone("SELECT count(*) AS n FROM agents.actions WHERE agent_id = %s AND kind IN ('camp_broadcast', 'camp_broadcast_skip') AND subject_type = 'camp' AND subject_id = %s "
                            "AND created_at > %s", AGENT_ID, camp_id, db.now() - timedelta(days=14))
    return bool(row and row["n"] > 0)


async def tick() -> dict[str, int]:
    out = {"ready": 0, "skipped": 0}
    v = await limits.gate(AGENT_ID, outgoing=False)
    if not v.allowed:
        return out
    try:
        data = await nexmarket.camp_candidates()
    except Exception as e:
        log.warning("broadcast manager: NexMarket not reachable: %s", e)
        return out
    if not data.get("connected") or data.get("paused"):
        return out
    live = (await limits.agent_state(AGENT_ID)).get("mode") == "live"
    for c in data.get("items", []):
        camp_id = str(c.get("campId"))
        if await _proposed(camp_id):
            continue
        n = int(c.get("recipients") or 0)
        subject = ("camp", camp_id)
        if n == 0 or c.get("blockHadBroadcastThisWeek"):
            why = "nobody in its block can receive broadcasts" if n == 0 else f"the partners of {c.get('block')} already got a broadcast in the last 7 days"
            await actions.record(AGENT_ID, "camp_broadcast_skip", "skipped", f"No invitation for “{c.get('title')}”: {why}", subject=subject)
            out["skipped"] += 1
            continue
        text = str(c.get("preview") or "")
        sources: list[dict[str, Any]] = [{"type": "camp", "id": camp_id, "facts": c.get("facts") or {}}]
        req = GuardRequest(text=text, channel="broadcast", audience="partner", sources=sources, opted_in=True, rules_only=True, allow_rewrite=False, from_agent=AGENT_ID)
        g = await act.guard(req)
        await act.log_guard(g, req)
        if g.outcome != "pass":
            await actions.record(AGENT_ID, "camp_broadcast", "blocked", f"The invitation for “{c.get('title')}” was stopped by the Guard", subject=subject, channel="broadcast",
                                 detail={"text": text}, sources=sources, reasons=g.issues)
            out["skipped"] += 1
            continue
        await actions.record(AGENT_ID, "camp_broadcast", "held" if live else "shadow",
                             f"Camp invitation ready for {n} partners in {c.get('block')} (“{c.get('title')}”): needs your OK", subject=subject, channel="broadcast",
                             detail={"text": text, "recipients": n, "block": c.get("block")}, sources=sources)
        out["ready"] += 1
        if live:
            try:
                await nexmarket.notify_team("A camp invitation is ready to send", f"{n} partners in {c.get('block')} for “{c.get('title')}”. Open Activity → To check and press “Good, send it”.",
                                            "ai-agents", agent_id=AGENT_ID)
            except Exception:
                log.exception("could not tell the managers")
    return out
