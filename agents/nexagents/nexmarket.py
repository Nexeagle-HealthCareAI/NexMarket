"""
The only way agents reach the world: NexMarket's own API, signed with the shared secret. The .NET side
decides what each call may do and logs it, exactly as for a person. Phase 1 tools: tell the admins and
marketing managers, and put a card on the Team board. Later phases add leads, WhatsApp, posts and reviews.
"""

from __future__ import annotations

from typing import Any

import httpx

from .config import config

HEADER = "X-Agents-Secret"


class NexMarketError(Exception):
    pass


async def _post(path: str, body: dict[str, Any]) -> dict[str, Any]:
    if not config.secret:
        raise NexMarketError("AGENTS_SECRET is not set.")
    async with httpx.AsyncClient(base_url=config.nexmarket_url, timeout=20) as c:
        r = await c.post(path, json=body, headers={HEADER: config.secret})
    if r.status_code >= 400:
        raise NexMarketError(f"{path} → {r.status_code}: {r.text[:300]}")
    return r.json() if r.content else {}


async def notify_team(title: str, body: str, link: str | None = None, *, agent_id: str) -> dict[str, Any]:
    """Bell + push to the people chosen on the Agents page (admins and marketing managers)."""
    from .limits import recipients

    roles = (await recipients()).get("roles", ["admin", "marketing_manager"])
    return await _post("/api/v1/internal/agent-tools/notify", {"title": title, "body": body, "link": link, "agentId": agent_id, "roles": roles})


async def board_card(title: str, description: str, *, agent_id: str, priority: str = "normal",
                     labels: list[str] | None = None, due_date: str | None = None) -> dict[str, Any]:
    """A Team board card with the AI label, for anything that needs a person ("when unsure, stop")."""
    return await _post("/api/v1/internal/agent-tools/board-card", {
        "title": title, "description": description, "agentId": agent_id, "priority": priority,
        "labels": labels or [], "dueDate": due_date,
    })


async def _get(path: str) -> dict[str, Any]:
    if not config.secret:
        raise NexMarketError("AGENTS_SECRET is not set.")
    async with httpx.AsyncClient(base_url=config.nexmarket_url, timeout=20) as c:
        r = await c.get(path, headers={HEADER: config.secret})
    if r.status_code >= 400:
        raise NexMarketError(f"{path} → {r.status_code}: {r.text[:300]}")
    return r.json()


# ─── Lead Responder ───────────────────────────────────────────────────────────

async def lead_context(lead_id: str) -> dict[str, Any]:
    """The lead (no name, no phone) and its last messages, each marked person / desk / vita / auto."""
    return await _get(f"/api/v1/internal/agent-tools/leads/{lead_id}/context")


async def directory() -> dict[str, Any]:
    """Departments, doctors with OPD days and timings, camps in the next 45 days, office hours."""
    return await _get("/api/v1/internal/agent-tools/directory")


async def lead_reply(lead_id: str, text: str, *, agent_id: str) -> dict[str, Any]:
    """Sends a WhatsApp reply inside the 24-hour window. NexMarket refuses it (409) if the desk answered meanwhile."""
    return await _post(f"/api/v1/internal/agent-tools/leads/{lead_id}/reply", {"text": text, "agentId": agent_id})


async def lead_update(lead_id: str, *, agent_id: str, department: str | None = None, note: str | None = None,
                      alert: str | None = None, urgent: bool = False) -> dict[str, Any]:
    return await _post(f"/api/v1/internal/agent-tools/leads/{lead_id}/update",
                       {"agentId": agent_id, "department": department, "note": note, "alert": alert, "urgent": urgent})


async def leads_waiting() -> dict[str, Any]:
    """Leads whose last WhatsApp message nobody (desk or Vita) has answered, still inside the 24-hour window."""
    return await _get("/api/v1/internal/agent-tools/leads/waiting")


# ─── Lead Follow-up ───────────────────────────────────────────────────────────

async def leads_idle() -> dict[str, Any]:
    """Open leads that have gone quiet, with how many follow-ups each has had. No names, no phone numbers."""
    return await _get("/api/v1/internal/agent-tools/leads/idle")


async def lead_follow_up(lead_id: str, *, agent_id: str) -> dict[str, Any]:
    """Sends the approved follow-up template. NexMarket refuses (409) after an opt-out, the third follow-up, or a fresh reply."""
    return await _post(f"/api/v1/internal/agent-tools/leads/{lead_id}/follow-up", {"agentId": agent_id})


async def lead_close_quiet(lead_id: str, *, agent_id: str) -> dict[str, Any]:
    """Closes a lead as lost (no response). NexMarket refuses (409) unless all follow-ups were sent and none in the last 3 days."""
    return await _post(f"/api/v1/internal/agent-tools/leads/{lead_id}/close-quiet", {"agentId": agent_id})


# ─── Data Watcher, Chief of Staff, Reporter & Coach ──────────────────────────

async def numbers() -> dict[str, Any]:
    """Today's totals next to what is usual (leads, WhatsApp, referrals, field, reviews, hoardings). Counts only."""
    return await _get("/api/v1/internal/agent-tools/numbers")


async def lead_outcomes(days: int = 7) -> dict[str, Any]:
    """What happened to leads after Vita or the desk wrote to them, as counts."""
    return await _get(f"/api/v1/internal/agent-tools/lead-outcomes?days={days}")


# ─── Reputation, Social Publisher, Broadcast Manager ─────────────────────────

async def reviews_unanswered() -> dict[str, Any]:
    """Google reviews without a reply: stars, date, and the script they are written in. Never the reviewer or their words."""
    return await _get("/api/v1/internal/agent-tools/reviews/unanswered")


async def review_reply(review_id: str, text: str, *, agent_id: str) -> dict[str, Any]:
    return await _post(f"/api/v1/internal/agent-tools/reviews/{review_id}/reply", {"text": text, "agentId": agent_id})


async def social_publish(text: str, *, agent_id: str) -> dict[str, Any]:
    """A text post on the hospital's Facebook page."""
    return await _post("/api/v1/internal/agent-tools/social/publish", {"text": text, "agentId": agent_id})


async def camp_candidates() -> dict[str, Any]:
    """Camps 2–5 days away with no invitation broadcast yet, and how many partners of the block would get it."""
    return await _get("/api/v1/internal/agent-tools/broadcasts/camp-candidates")


async def broadcast_camp(camp_id: str, *, agent_id: str) -> dict[str, Any]:
    return await _post(f"/api/v1/internal/agent-tools/broadcasts/camp/{camp_id}", {"agentId": agent_id})


# ─── Partner Network, Field Coordinator, Camp Planner, Ads Optimiser ─────────

async def partners_watch() -> dict[str, Any]:
    """Partners who went quiet, and partners whose patients came this week. Ids only."""
    return await _get("/api/v1/internal/agent-tools/partners/watch")


async def field_coverage() -> dict[str, Any]:
    """Per field agent: their block's panchayats, how many were visited lately, and the ones longest without a visit."""
    return await _get("/api/v1/internal/agent-tools/field/coverage")


async def make_task(kind: str, *, for_agent: str, agent_id: str, contact: str | None = None, count: int = 0, panchayats: list[str] | None = None) -> dict[str, Any]:
    """A task on a field agent's phone. NexMarket writes the wording (and the partner's name) and refuses (409) when the agent has enough."""
    return await _post("/api/v1/internal/agent-tools/tasks", {"agentId": agent_id, "forAgent": for_agent, "kind": kind, "contactClientId": contact,
                                                              "count": count, "panchayatIds": panchayats or []})


async def camp_demand() -> dict[str, Any]:
    """Per block: referrals in 90 days and for which departments, partners, last and next camp. Counts only."""
    return await _get("/api/v1/internal/agent-tools/camps/demand")


async def ads_results() -> dict[str, Any]:
    """The last 14 days of Meta and Google ads per campaign: money spent, leads, and who came."""
    return await _get("/api/v1/internal/agent-tools/ads/results")
