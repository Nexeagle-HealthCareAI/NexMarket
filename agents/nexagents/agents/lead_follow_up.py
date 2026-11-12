"""
Vita · Lead Follow-up — nudges leads that went quiet, then hands them to a person.

A lead who asked something and then stopped answering is usually lost because nobody remembers to write again.
This agent does the remembering. It writes no text of its own: it sends the follow-up template the hospital
chose and Meta approved (WhatsApp → Setup), on a fixed rhythm, and stops at three.

    every hour in the working day → ask NexMarket for quiet leads → plan (plain rules) → gate → Guard → send
      follow-up 1: a day after the last contact (web and ad leads nobody contacted: after 30 minutes)
      follow-up 2: two days after the first          follow-up 3: four days after the second
      still quiet three days later: the owner is asked, once, to call them
      still quiet ten days after the last follow-up (a limit; 0 = never): the lead is closed as lost, "no response"

A reply from the lead resets the count (NexMarket counts follow-ups since they last wrote) and goes to the Lead
Responder. Never after an opt-out. Every open lead is followed up, also the ones staff typed in.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from .. import act, actions, db, limits, nexmarket

log = logging.getLogger("nexagents.lead_follow_up")

AGENT_ID = "lead_follow_up"
FIRST_TOUCH = {"ad", "web"}          # never contacted yet: a first message after 30 minutes, so the form isn't met with silence
FIRST_TOUCH_AFTER = timedelta(minutes=30)
GAPS = (timedelta(days=1), timedelta(days=2), timedelta(days=4))   # before follow-up 1, 2 and 3
HAND_OVER_AFTER = timedelta(days=3)  # quiet this long after the last follow-up: a person decides
MAX_PER_RUN = 20
Step = Literal["send", "hand_over", "close"]


def _at(v: Any) -> datetime | None:
    if not v:
        return None
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def plan(lead: dict[str, Any], now: datetime, max_follow_ups: int = 3, close_days: int = 10) -> Step | None:
    """What this quiet lead needs now, if anything. Plain rules, no AI."""
    if lead.get("optOut") or lead.get("status") not in ("new", "contacted"):
        return None
    n = int(lead.get("followUps") or 0)
    last_touch = _at(lead.get("lastTouchAt")) or _at(lead.get("createdAt"))
    last_follow = _at(lead.get("lastFollowUpAt"))
    if last_touch is None:
        return None
    if n >= max_follow_ups:
        if not last_follow:
            return None
        if close_days > 0 and now - last_follow >= max(timedelta(days=close_days), HAND_OVER_AFTER):
            return "close"
        return "hand_over" if now - last_follow >= HAND_OVER_AFTER else None
    if n == 0:
        if not lead.get("contacted") and lead.get("source") in FIRST_TOUCH:
            return "send" if now - last_touch >= FIRST_TOUCH_AFTER else None
        return "send" if now - last_touch >= GAPS[0] else None
    since = last_follow or last_touch
    return "send" if now - since >= GAPS[min(n, len(GAPS) - 1)] else None


async def _recently(lead_id: str, kind: str, within: timedelta, statuses: tuple[str, ...] = ("done", "shadow")) -> bool:
    """Already sent, or (in shadow) already recorded, for this lead lately: the hourly run must not repeat itself."""
    row = await db.fetchone(
        "SELECT count(*) AS n FROM agents.actions WHERE agent_id = %s AND kind = %s AND subject_type = 'lead' AND subject_id = %s "
        "AND status = ANY(%s) AND created_at > %s", AGENT_ID, kind, lead_id, list(statuses), db.now() - within)
    return bool(row and row["n"] > 0)


async def _send(lead: dict[str, Any], template_text: str, cap: tuple[int, int]) -> dict[str, Any]:
    lead_id = str(lead["id"])
    n = int(lead.get("followUps") or 0) + 1

    async def do_send(_: str) -> dict[str, Any]:
        return await nexmarket.lead_follow_up(lead_id, agent_id=AGENT_ID)

    first = n == 1 and not lead.get("contacted") and lead.get("source") in FIRST_TOUCH
    return await act.outgoing(
        AGENT_ID, kind="lead_follow_up", channel="whatsapp", text=template_text, rules_only=True, opted_in=True, cap=cap,
        summary=("First message to a new web or ad lead nobody had contacted" if first else f"Follow-up {n} of 3 to a lead who went quiet"),
        send=do_send, subject=("lead", lead_id), sources=[{"type": "template", "id": "lead_followup", "facts": {}}])


async def _hand_over(lead: dict[str, Any], close_days: int) -> None:
    lead_id = str(lead["id"])
    st = await limits.agent_state(AGENT_ID)
    live = st.get("mode") == "live"
    if live:
        await nexmarket.lead_update(lead_id, agent_id=AGENT_ID,
                                    note="Vita: three follow-ups sent, no reply. Please call them once.",
                                    alert="Three follow-ups, no reply. Please call them once." + (" If they stay quiet, Vita closes the lead as lost." if close_days > 0 else ""))
    await actions.record(AGENT_ID, "follow_up_handover", "done" if live else "shadow", "Asked a person to call a lead that didn't answer three follow-ups",
                         subject=("lead", lead_id))


async def _close(lead: dict[str, Any], days: int) -> bool:
    """Closes a lead nobody could reach. Shadow only records it. NexMarket checks again and may refuse."""
    lead_id = str(lead["id"])
    st = await limits.agent_state(AGENT_ID)
    live = st.get("mode") == "live"
    summary = f"Closed a lead as lost: no reply to three follow-ups in {days} days"
    if not live:
        await actions.record(AGENT_ID, "lead_close", "shadow", "Would do: " + summary, subject=("lead", lead_id))
        return True
    try:
        await nexmarket.lead_close_quiet(lead_id, agent_id=AGENT_ID)
    except nexmarket.NexMarketError as e:
        await actions.record(AGENT_ID, "lead_close", "skipped", "Didn't close a lead: NexMarket said it isn't ready to close", subject=("lead", lead_id), detail={"why": str(e)[:200]})
        return False
    await actions.record(AGENT_ID, "lead_close", "done", summary, subject=("lead", lead_id))
    return True


async def tick(now: datetime | None = None) -> dict[str, int]:
    """One pass over the quiet leads. Returns what it did, for the log and the tests."""
    out = {"sent": 0, "shadow": 0, "handed": 0, "closed": 0, "stopped": 0}
    v = await limits.gate(AGENT_ID, outgoing=False)
    if not v.allowed:
        return out
    now = now or db.now()
    try:
        data = await nexmarket.leads_idle()
    except Exception as e:
        log.warning("follow-up: NexMarket not reachable: %s", e)
        return out
    lim = (await limits.limits())["lead"]
    max_n = int(lim.get("maxFollowUpsPerLead", 3))
    daily = int(lim.get("followUpsPerDay", 40))
    close_days = int(lim.get("closeAfterQuietDays", 10))
    template_ready = bool(data.get("templateReady"))
    template_text = str(data.get("templateText") or "Approved follow-up template")
    told_missing = False
    done_run = 0
    for lead in data.get("items", []):
        step = plan(lead, now, max_n, close_days)
        if step is None:
            continue
        lead_id = str(lead["id"])
        if step == "close":
            if not await _recently(lead_id, "lead_close", timedelta(days=30), ("done", "shadow", "skipped")) and await _close(lead, close_days):
                out["closed"] += 1
            continue
        if step == "hand_over":
            if not await _recently(lead_id, "follow_up_handover", timedelta(days=30)):
                await _hand_over(lead, close_days)
                out["handed"] += 1
            continue
        if await _recently(lead_id, "lead_follow_up", timedelta(hours=20)):
            continue
        if not template_ready or data.get("whatsappPaused"):
            if not told_missing:
                told_missing = True
                why = "WhatsApp sending is paused" if data.get("whatsappPaused") else "no follow-up template is chosen yet (WhatsApp → Setup)"
                if not await _recently("-", "follow_up_blocked", timedelta(hours=20), ("skipped",)):
                    await actions.record(AGENT_ID, "follow_up_blocked", "skipped", f"Follow-ups are waiting: {why}", subject=("lead", "-"))
            out["stopped"] += 1
            continue
        if done_run >= MAX_PER_RUN:
            break
        sent_today = await limits.count_today(AGENT_ID, ["lead_follow_up"])
        r = await _send(lead, template_text, (sent_today, daily))
        if r.get("sent"):
            out["sent"] += 1
            done_run += 1
        elif r.get("shadow"):
            out["shadow"] += 1
            done_run += 1
        else:
            out["stopped"] += 1
            if r.get("reason") and "limit" in str(r.get("reason")).lower():
                break  # today's cap: the rest wait for tomorrow
    return out
