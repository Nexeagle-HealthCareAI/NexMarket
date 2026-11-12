"""
Vita · Ads Optimiser — reads what the ads cost against who came, and suggests changes to you.

Read only, and no AI. You run Google and Meta ads yourself; this agent never touches them. Every day at 5 pm it
reads the last 14 days per campaign and applies plain rules:

    Meta    spent ₹1,000 or more and no lead reached the CRM          → check the form and audience, or pause
            8 or more leads and nobody came to the hospital            → the leads are not the right people
            cost per lead more than twice the middle campaign's        → costly
            the lowest cost per patient who came (2 or more came)      → your best: consider moving budget to it
    Google  spent ₹1,000 or more, 30+ clicks, no conversion and no call → check the landing page and keywords

When there is something to say it adds one Team board card, at most once in 3 days. Every figure on the card is
copied from the ad accounts and the CRM; nothing is estimated.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from statistics import median
from typing import Any

from .. import actions, db, limits, nexmarket

log = logging.getLogger("nexagents.ads_optimiser")

AGENT_ID = "ads_optimiser"
MIN_SPEND = 1000


def _money(v: Any) -> str:
    return f"₹{int(round(float(v or 0))):,}"


def suggestions(data: dict[str, Any]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    meta = [m for m in (data.get("meta") or []) if float(m.get("spend") or 0) > 0]
    days = int(data.get("days") or 14)
    with_leads = [m for m in meta if int(m.get("leads") or 0) > 0]
    cpls = [float(m["spend"]) / int(m["leads"]) for m in with_leads]
    mid = median(cpls) if len(cpls) >= 3 else None
    for m in meta:
        spend, leads, came, name = float(m.get("spend") or 0), int(m.get("leads") or 0), int(m.get("came") or 0), str(m.get("name") or "A campaign")
        if spend >= MIN_SPEND and leads == 0:
            out.append({"key": f"meta_no_leads:{m.get('id')}", "text": f"Meta “{name}” spent {_money(spend)} in {days} days and no lead reached the CRM. Check its form and audience, or pause it."})
        elif leads >= 8 and came == 0:
            out.append({"key": f"meta_no_show:{m.get('id')}", "text": f"Meta “{name}” brought {leads} leads for {_money(spend)} but none came to the hospital. The audience or the offer may be wrong."})
        elif mid and leads > 0 and spend / leads > 2 * mid and spend >= MIN_SPEND:
            out.append({"key": f"meta_costly:{m.get('id')}", "text": f"Meta “{name}” costs {_money(spend / leads)} a lead ({leads} leads for {_money(spend)}); the middle campaign costs {_money(mid)}."})
    winners = [m for m in meta if int(m.get("came") or 0) >= 2]
    if len(meta) >= 2 and winners:
        best = min(winners, key=lambda m: float(m["spend"]) / int(m["came"]))
        out.append({"key": f"meta_best:{best.get('id')}", "text": f"Meta “{best.get('name')}” is your best: {int(best['came'])} patients came for {_money(best['spend'])}, "
                                                                 f"{_money(float(best['spend']) / int(best['came']))} each. Consider moving budget to it from the weakest."})
    for g in data.get("google") or []:
        cost, clicks = float(g.get("cost") or 0), int(g.get("clicks") or 0)
        if cost >= MIN_SPEND and clicks >= 30 and float(g.get("conversions") or 0) == 0 and int(g.get("calls") or 0) == 0:
            out.append({"key": f"google_no_result:{g.get('id')}", "text": f"Google Ads “{g.get('name')}” spent {_money(cost)} on {clicks} clicks in {days} days with no conversion and no call. "
                                                                         "Check the landing page and the keywords."})
    return out


async def tick() -> dict[str, int]:
    out = {"suggestions": 0, "card": 0}
    v = await limits.gate(AGENT_ID, outgoing=False)
    if not v.allowed:
        return out
    try:
        data = await nexmarket.ads_results()
    except Exception as e:
        log.warning("ads optimiser: NexMarket not reachable: %s", e)
        return out
    found = suggestions(data)
    out["suggestions"] = len(found)
    if not found:
        return out
    recent = await db.fetchone("SELECT count(*) AS n FROM agents.actions WHERE agent_id = %s AND kind = 'ads_advice' AND status IN ('done', 'shadow') AND created_at > %s",
                               AGENT_ID, db.now() - timedelta(days=3))
    if recent and recent["n"] > 0:
        return out
    live = (await limits.agent_state(AGENT_ID)).get("mode") == "live"
    title = f"Ads: {len(found)} {'thing' if len(found) == 1 else 'things'} to look at (last {int(data.get('days') or 14)} days)"
    text = "\n".join(f"- {s['text']}" for s in found[:6]) + "\n\nSuggestions only: you run the ads, Vita changes nothing."
    if live:
        try:
            await nexmarket.board_card(title, text, agent_id=AGENT_ID, priority="normal", labels=["Ads"])
        except Exception:
            log.exception("could not add the ads card")
            return out
    await actions.record(AGENT_ID, "ads_advice", "done" if live else "shadow", title if live else "Would suggest: " + title, detail={"text": text, "keys": [s["key"] for s in found]})
    out["card"] = 1
    return out
