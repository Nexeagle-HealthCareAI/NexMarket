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
