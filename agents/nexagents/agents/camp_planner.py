"""
Vita · Camp Planner — suggests where a camp would be worth holding. It never books one or spends money.

No AI. Every Monday it asks NexMarket, block by block, how many patients partners referred in the last 90 days
(and for which departments), how many partners can be invited, and when a camp was last held there.

    a block with 5 or more referrals in 90 days, no camp planned, and none held in the last 60 days
        → ranked by referrals (reachable partners break ties) → the top two
        → a Team board card each: "Plan a camp in Amour?" with the numbers and the department most asked for

A block is not suggested again for 30 days. When a person creates the camp in NexMarket, the Content Writer drafts
its post and the Broadcast Manager prepares its invitation.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from .. import actions, db, limits, nexmarket

log = logging.getLogger("nexagents.camp_planner")

AGENT_ID = "camp_planner"
MIN_REFERRALS = 5
REST_DAYS = 60
PER_RUN = 2


def ideas(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Blocks worth a camp, best first, each with the sentence that explains why."""
    out = []
    for b in data.get("blocks") or []:
        n = int(b.get("referrals90Days") or 0)
        since = b.get("daysSinceCamp")
        if n < MIN_REFERRALS or b.get("nextCamp") or (since is not None and int(since) < REST_DAYS):
            continue
        deps = b.get("topDepartments") or []
        top = deps[0] if deps else None
        reach = int(b.get("partnersReachable") or 0)
        why = f"{n} patients were referred from {b['block']} in the last 90 days"
        why += f", most of them for {top['department']} ({top['referrals']})." if top else "."
        why += f" {reach} partners there can be invited on WhatsApp." if reach else " No partner there can be invited on WhatsApp yet."
        why += f" The last camp there was {int(since)} days ago ({b.get('lastCamp')})." if since is not None else " No camp has been held there yet."
        out.append({"block": str(b["block"]), "score": n + reach * 0.01, "referrals": n, "department": top["department"] if top else None, "why": why})
    return sorted(out, key=lambda x: -x["score"])


async def tick() -> dict[str, int]:
    out = {"cards": 0, "shadow": 0}
    v = await limits.gate(AGENT_ID, outgoing=False)
    if not v.allowed:
        return out
    try:
        data = await nexmarket.camp_demand()
    except Exception as e:
        log.warning("camp planner: NexMarket not reachable: %s", e)
        return out
    live = (await limits.agent_state(AGENT_ID)).get("mode") == "live"
    for idea in ideas(data):
        if out["cards"] + out["shadow"] >= PER_RUN:
            break
        row = await db.fetchone("SELECT count(*) AS n FROM agents.actions WHERE agent_id = %s AND kind = 'camp_idea' AND subject_type = 'block' AND subject_id = %s "
                                "AND status IN ('done', 'shadow') AND created_at > %s", AGENT_ID, idea["block"], db.now() - timedelta(days=30))
        if row and row["n"] > 0:
            continue
        title = f"Plan a camp in {idea['block']}?" + (f" ({idea['department']})" if idea["department"] else "")
        text = idea["why"] + " This is a suggestion from the numbers: Vita does not book camps or spend money."
        if live:
            try:
                await nexmarket.board_card(title, text, agent_id=AGENT_ID, priority="normal", labels=["Camp idea"])
            except Exception:
                log.exception("could not add a camp idea")
                continue
        await actions.record(AGENT_ID, "camp_idea", "done" if live else "shadow", ("Suggested a camp" if live else "Would suggest a camp") + f" in {idea['block']}: {idea['referrals']} referrals in 90 days",
                             subject=("block", idea["block"]), detail={"text": f"{title}\n{text}"})
        out["cards" if live else "shadow"] += 1
    return out
