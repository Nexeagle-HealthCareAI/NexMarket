"""
Vita · Data Watcher — reads the numbers and says what changed.

No AI. Every hour in the working day it asks NexMarket for today's totals next to what is usual (counts only:
never a name, a phone number or a message) and applies plain rules. Each thing worth acting on becomes a
*signal*: a short sentence with its numbers. Signals go on the blackboard for the Chief of Staff, who turns them
into the day's plan. A serious one (leads nobody answered, WhatsApp failing, no messages arriving) is also told
to the managers at once, once a day.

The Data Watcher never sends anything outside and changes nothing in NexMarket.
"""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass
from typing import Any

from .. import actions, blackboard, db, limits, nexmarket
from ..limits import IST

log = logging.getLogger("nexagents.data_watcher")

AGENT_ID = "data_watcher"
TASK_KIND = "signal"


@dataclass(frozen=True)
class Signal:
    key: str            # stable id of the kind of problem, e.g. "leads_waiting"
    severity: str       # high | medium | low
    title: str          # one sentence with the numbers
    todo: str           # what would fix it
    who: str            # desk | marketing | field | an agent id


def _n(d: dict[str, Any], *path: str) -> float:
    cur: Any = d
    for p in path:
        cur = (cur or {}).get(p) if isinstance(cur, dict) else None
    try:
        return float(cur or 0)
    except (TypeError, ValueError):
        return 0.0


def _hours(minutes: float) -> str:
    return f"{minutes / 60:.0f} hours" if minutes >= 120 else f"{minutes:.0f} minutes"


def signals(n: dict[str, Any], agents: dict[str, dict[str, Any]] | None = None) -> list[Signal]:
    """The rules. `n` is NexMarket's numbers; `agents` is each Vita agent's own state (mode, paused, waiting, failed)."""
    out: list[Signal] = []
    hour = int(_n(n, "istHour"))
    sunday = str(n.get("weekday") or "") == "Sunday"
    agents = agents or {}

    # Leads nobody has answered: the costliest thing on the page.
    waiting, oldest = _n(n, "leads", "waitingNoReply"), _n(n, "leads", "oldestWaitingMinutes")
    if waiting >= 3 or (waiting >= 1 and oldest >= 120):
        out.append(Signal("leads_waiting", "high", f"{waiting:.0f} new {'lead has' if waiting == 1 else 'leads have'} had no reply; the oldest has waited {_hours(oldest)}.",
                          "Reply to them from the Leads inbox now.", "desk"))

    today, usual = _n(n, "leads", "today"), _n(n, "leads", "usualByNow")
    if hour >= 12 and usual >= 4 and today <= usual * 0.5:
        out.append(Signal("leads_down", "medium", f"Fewer leads than usual: {today:.0f} so far today, usually {usual:.0f} by this time.",
                          "Check that ads, the website form and WhatsApp are all running.", "marketing"))
    elif usual >= 3 and today >= usual * 2 and today - usual >= 5:
        out.append(Signal("leads_up", "low", f"More leads than usual: {today:.0f} so far today, usually {usual:.0f} by this time.",
                          "Make sure the desk can keep up with replies.", "desk"))
    if hour >= 13:
        for s in (n.get("leads") or {}).get("bySource") or []:
            if _n(s, "usualByNow") >= 2 and _n(s, "today") == 0:
                out.append(Signal(f"source_silent:{s.get('source')}", "medium", f"No leads from {s.get('source')} today; usually {_n(s, 'usualByNow'):.0f} by this time.",
                                  "Check that this channel is still working.", "marketing"))

    # WhatsApp
    if (n.get("whatsapp") or {}).get("configured"):
        if (n.get("whatsapp") or {}).get("paused"):
            out.append(Signal("whatsapp_paused", "medium", "WhatsApp sending is paused, so no replies, follow-ups or broadcasts go out.",
                              "Resume it in WhatsApp → Automation when ready.", "marketing"))
        sent, failed = _n(n, "whatsapp", "sentToday"), _n(n, "whatsapp", "failedToday")
        if failed >= 5 and sent > 0 and failed / sent >= 0.2:
            out.append(Signal("whatsapp_failing", "high", f"{failed:.0f} of {sent:.0f} WhatsApp messages failed today.",
                              "Check the WhatsApp number's status and templates in WhatsApp → Setup.", "marketing"))
        if hour >= 13 and _n(n, "whatsapp", "inboundUsualByNow") >= 5 and _n(n, "whatsapp", "inboundToday") == 0:
            out.append(Signal("whatsapp_silent", "high", f"No WhatsApp message has arrived today; usually {_n(n, 'whatsapp', 'inboundUsualByNow'):.0f} by this time.",
                              "The connection from Meta may be down: check WhatsApp → Setup.", "marketing"))

    # Week on week
    this, prev = _n(n, "referrals", "thisWeek"), _n(n, "referrals", "prevWeek")
    if prev >= 5 and this <= prev * 0.6:
        out.append(Signal("referrals_down", "medium", f"Partner referrals fell: {this:.0f} in the last 7 days, {prev:.0f} the week before.",
                          "Call the partners who stopped referring.", "field"))
    this, prev = _n(n, "leads", "arrivedThisWeek"), _n(n, "leads", "arrivedPrevWeek")
    if prev >= 5 and this <= prev * 0.6:
        out.append(Signal("arrivals_down", "medium", f"Fewer leads came to the hospital: {this:.0f} in the last 7 days, {prev:.0f} the week before.",
                          "Look at where leads stop: no reply, no appointment, or no-show.", "marketing"))
    this, prev = _n(n, "leads", "lostThisWeek"), _n(n, "leads", "lostPrevWeek")
    if this >= 8 and this >= prev * 1.5:
        out.append(Signal("leads_lost_up", "low", f"More leads were closed as lost: {this:.0f} in the last 7 days, {prev:.0f} the week before.",
                          "Read the lost reasons on the Leads page.", "marketing"))

    # Field
    on, usual_on = _n(n, "field", "agentsOnShiftToday"), _n(n, "field", "agentsOnShiftUsual")
    if not sunday and hour >= 11 and usual_on >= 3 and on <= usual_on * 0.5:
        out.append(Signal("field_thin", "medium", f"Only {on:.0f} field {'agent has' if on == 1 else 'agents have'} started work today; usually {usual_on:.0f}.",
                          "Check attendance and leave on the Live map.", "field"))
    if _n(n, "field", "tasksOverdue") >= 5:
        out.append(Signal("tasks_overdue", "low", f"{_n(n, 'field', 'tasksOverdue'):.0f} tasks given to agents are past their date.", "Chase or re-plan them.", "field"))

    # Reviews, hoardings, quiet leads
    if _n(n, "reviews", "lowUnanswered") >= 1:
        k = _n(n, "reviews", "lowUnanswered")
        out.append(Signal("reviews_low", "medium", f"{k:.0f} Google {'review' if k == 1 else 'reviews'} of 3 stars or less {'has' if k == 1 else 'have'} no reply.",
                          "Reply from the Google page.", "marketing"))
    elif _n(n, "reviews", "unanswered") >= 5:
        out.append(Signal("reviews_unanswered", "low", f"{_n(n, 'reviews', 'unanswered'):.0f} Google reviews from the last 30 days have no reply.", "Reply from the Google page.", "marketing"))
    if _n(n, "hoardings", "endingSoon") >= 1:
        out.append(Signal("hoardings_ending", "low", f"{_n(n, 'hoardings', 'endingSoon'):.0f} hoarding {'rental ends' if _n(n, 'hoardings', 'endingSoon') == 1 else 'rentals end'} within 14 days.",
                          "Renew or end them on the Hoardings page.", "marketing"))
    if _n(n, "hoardings", "waiting") >= 3:
        out.append(Signal("hoardings_waiting", "low", f"{_n(n, 'hoardings', 'waiting'):.0f} hoarding places suggested by agents wait for an answer.", "Approve them or say why not.", "marketing"))
    follow_live = (agents.get("lead_follow_up") or {}).get("mode") == "live"
    if _n(n, "leads", "openIdle3Days") >= 10 and not follow_live:
        out.append(Signal("leads_idle", "low", f"{_n(n, 'leads', 'openIdle3Days'):.0f} open leads have not been touched for 3 days.",
                          "Switch Lead Follow-up to Live, or work through them in the Leads inbox.", "desk"))

    # Vita's own house
    for aid, a in agents.items():
        if a.get("paused"):
            out.append(Signal(f"agent_paused:{aid}", "medium", f"{a.get('name', aid)} is paused: {a.get('pausedReason') or 'no reason given'}.", "Look at its Activity, then resume it.", "marketing"))
        if int(a.get("failed") or 0) >= 3:
            out.append(Signal(f"agent_failing:{aid}", "medium", f"{a.get('name', aid)} failed {int(a['failed'])} times today.", "Look at its Activity for the error.", "marketing"))
    drafts = sum(int(a.get("waiting") or 0) for a in agents.values())
    if drafts >= 10:
        out.append(Signal("drafts_waiting", "low", f"{drafts} practice messages wait to be checked.", "Check them in Activity → To check.", "marketing"))

    order = {"high": 0, "medium": 1, "low": 2}
    return sorted(out, key=lambda s: order[s.severity])


async def agents_state() -> dict[str, dict[str, Any]]:
    """Each built agent's own state, from this service's tables."""
    from .registry import AGENTS

    rows = {r["agent_id"]: r for r in await db.fetch("SELECT * FROM agents.agent_state")}
    counts = await actions.today_counts()
    waiting = await actions.waiting_review()
    return {a.id: {"name": a.name, "mode": rows.get(a.id, {}).get("mode", "off"), "paused": bool(rows.get(a.id, {}).get("paused")),
                   "pausedReason": rows.get(a.id, {}).get("paused_reason"), "failed": counts.get(a.id, {}).get("failed", 0),
                   "done": counts.get(a.id, {}).get("done", 0), "shadow": counts.get(a.id, {}).get("shadow", 0),
                   "blocked": counts.get(a.id, {}).get("blocked", 0), "waiting": waiting.get(a.id, 0)}
            for a in AGENTS if a.built and a.id != "compliance_guard"}


async def todays_signals() -> list[dict[str, Any]]:
    """Every signal raised since midnight India time, newest state of each key."""
    start = db.now().astimezone(IST).replace(hour=0, minute=0, second=0, microsecond=0)
    rows = await db.fetch("SELECT DISTINCT ON (subject_key) subject_key, goal, payload, created_at FROM agents.tasks "
                          "WHERE kind = %s AND created_at >= %s ORDER BY subject_key, created_at DESC", TASK_KIND, start)
    order = {"high": 0, "medium": 1, "low": 2}
    return sorted([{**(r["payload"] or {}), "at": r["created_at"]} for r in rows], key=lambda s: order.get(s.get("severity", "low"), 3))


async def tick() -> dict[str, Any]:
    """One look at the numbers. New signals go to the blackboard; serious ones also to the managers, once a day each."""
    out: dict[str, Any] = {"signals": 0, "new": 0, "alerted": 0}
    v = await limits.gate(AGENT_ID, outgoing=False)
    if not v.allowed:
        return out
    try:
        n = await nexmarket.numbers()
    except Exception as e:
        log.warning("data watcher: NexMarket not reachable: %s", e)
        return out
    found = signals(n, await agents_state())
    out["signals"] = len(found)
    # Yesterday's signals nobody picked up are closed, so a problem that is still there is raised afresh today.
    start = db.now().astimezone(IST).replace(hour=0, minute=0, second=0, microsecond=0)
    await db.execute("UPDATE agents.tasks SET status = 'done', result = '{\"expired\": true}'::jsonb, updated_at = now() "
                     "WHERE kind = %s AND status = 'open' AND created_at < %s", TASK_KIND, start)
    already = {s["key"] for s in await todays_signals()}
    live = (await limits.agent_state(AGENT_ID)).get("mode") == "live"
    for s in found:
        if s.key in already:
            continue
        if await blackboard.post(TASK_KIND, s.key, s.title, for_agent="chief_of_staff", created_by=AGENT_ID, payload=asdict(s)) is None:
            continue
        out["new"] += 1
        told = False
        if s.severity == "high" and live:
            try:
                await nexmarket.notify_team(s.title, s.todo, "ai-agents", agent_id=AGENT_ID)
                told = True
                out["alerted"] += 1
            except Exception:
                log.exception("could not alert the managers")
        await actions.record(AGENT_ID, "signal", "done" if live else "shadow", s.title, detail={"key": s.key, "severity": s.severity, "todo": s.todo, "who": s.who, "alerted": told},
                             to_agent="chief_of_staff")
    return out
