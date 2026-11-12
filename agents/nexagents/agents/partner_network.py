"""
Vita · Partner Network — keeps partners active by sending the right agent to the right partner.

No AI and no messages to partners. Every morning it asks NexMarket which partners (ASHAs, RMP doctors,
chemists) need a visit, and puts a task on the phone of the field agent who looks after them:

    quiet    referred at least twice in the 60 days before, nothing in the last 30  → "Visit …: no referral for N days"
    thank    a patient of theirs came to the hospital in the last 7 days            → "Thank …: N of their patients came"

NexMarket writes the task (with the partner's name, which never leaves it) and refuses when the agent already
has 5 open Vita tasks or got 2 today. A partner is not asked about again for 30 days (quiet) or 14 days (thank).
The task text tells the agent never to offer money or commission.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from .. import actions, db, limits, nexmarket

log = logging.getLogger("nexagents.partner_network")

AGENT_ID = "partner_network"
PER_RUN = 12


async def _asked(contact: str, kind: str, days: int) -> bool:
    row = await db.fetchone("SELECT count(*) AS n FROM agents.actions WHERE agent_id = %s AND kind = %s AND subject_type = 'partner' AND subject_id = %s "
                            "AND status IN ('done', 'shadow') AND created_at > %s", AGENT_ID, kind, contact, db.now() - timedelta(days=days))
    return bool(row and row["n"] > 0)


def plan(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Who to send where, most valuable first: thank-yous (a patient came) before revivals, bigger referrers first."""
    thank = sorted(data.get("thank") or [], key=lambda x: -int(x.get("came") or 0))
    quiet = sorted(data.get("quiet") or [], key=lambda x: -int(x.get("before") or 0))
    out = [{"kind": "thank", "contact": str(t["contactClientId"]), "agent": str(t["agentId"]), "count": int(t.get("came") or 0)} for t in thank]
    thanked = {o["contact"] for o in out}
    out += [{"kind": "revive", "contact": str(q["contactClientId"]), "agent": str(q["agentId"]), "count": int(q.get("daysSinceLast") or 0), "before": int(q.get("before") or 0)}
            for q in quiet if str(q["contactClientId"]) not in thanked]
    return out


async def tick() -> dict[str, int]:
    out = {"tasks": 0, "shadow": 0, "refused": 0}
    v = await limits.gate(AGENT_ID, outgoing=False)
    if not v.allowed:
        return out
    try:
        data = await nexmarket.partners_watch()
    except Exception as e:
        log.warning("partner network: NexMarket not reachable: %s", e)
        return out
    live = (await limits.agent_state(AGENT_ID)).get("mode") == "live"
    full: set[str] = set()   # agents NexMarket said have enough for now
    for p in plan(data):
        if out["tasks"] + out["shadow"] >= PER_RUN:
            break
        kind = f"partner_{p['kind']}"
        if p["agent"] in full or await _asked(p["contact"], kind, 30 if p["kind"] == "revive" else 14):
            continue
        summary = (f"Asked an agent to thank a partner: {p['count']} of their patients came this week" if p["kind"] == "thank"
                   else f"Asked an agent to visit a partner who stopped referring ({p.get('before')} referrals before, quiet for {p['count']} days)")
        if live:
            try:
                await nexmarket.make_task(p["kind"], for_agent=p["agent"], agent_id=AGENT_ID, contact=p["contact"], count=p["count"])
            except nexmarket.NexMarketError as e:
                if "agent_has_enough" in str(e) or "two_today" in str(e):
                    full.add(p["agent"])
                out["refused"] += 1
                continue
        await actions.record(AGENT_ID, kind, "done" if live else "shadow", summary if live else "Would have: " + summary[0].lower() + summary[1:],
                             subject=("partner", p["contact"]), detail={"forAgent": p["agent"]})
        out["tasks" if live else "shadow"] += 1
    return out
