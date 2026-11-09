"""
NexMarket Agents — internal HTTP API. Only the .NET API calls it (shared secret); people reach it through
the CRM's Agents page, which checks who they are and what they may change.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from . import __version__, actions, blackboard, db, limits, nexmarket
from .act import guard, log_guard
from .agents.base import runtime
from .agents.registry import AGENTS, BY_ID, WINGS
from .auth import require_secret
from .config import config
from .guard.check import GuardRequest
from .guard.policy import DEFAULT_POLICY

log = logging.getLogger("nexagents")

DEFAULT_FACTS: dict[str, Any] = {
    "text": "",       # departments, doctors, OPD timings, address, emergency number — filled in on the Agents page
    "phones": [],     # the hospital's own numbers, allowed in messages
    "domains": [],    # the hospital's own websites, allowed as links
}

# Events from NexMarket and the agent that handles each (agents that are off ignore them).
EVENT_AGENT = {"lead.new": "lead_responder", "lead.idle": "lead_follow_up", "review.new": "reputation", "referral.arrived": "partner_network"}


# ─── Background jobs ──────────────────────────────────────────────────────────

async def housekeeping() -> None:
    try:
        n = await blackboard.release_expired()
        if n:
            log.info("Released %s expired claims", n)
    except Exception:
        log.exception("housekeeping failed")


async def watch_anomalies() -> None:
    """A burst of blocks pauses that agent and tells the admins and marketing managers."""
    try:
        lim = (await limits.limits())["anomaly"]
        for a in AGENTS:
            if a.id == "compliance_guard":
                continue
            st = await limits.agent_state(a.id)
            if st.get("mode") == "off" or st.get("paused"):
                continue
            blocks = await actions.blocks_last_hour(a.id)
            if blocks >= lim["blocksPerHourToPause"]:
                reason = f"{blocks} messages blocked by the Guard in the last hour"
                await limits.set_paused(a.id, True, "system", reason)
                await actions.record(a.id, "pause", "done", f"Paused automatically: {reason}")
                try:
                    await nexmarket.notify_team(f"{a.name} paused", f"{reason}. Check it on the Agents page.", "ai-agents", agent_id=a.id)
                except Exception:
                    log.exception("could not send the pause alert")
    except Exception:
        log.exception("anomaly watch failed")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await db.open_pool()
    await runtime.open()
    await limits.ensure_agents({a.id: a.start_mode for a in AGENTS})
    sched = AsyncIOScheduler(timezone="Asia/Kolkata")
    sched.add_job(housekeeping, "interval", minutes=5, id="housekeeping")
    sched.add_job(watch_anomalies, "interval", minutes=10, id="anomalies")
    sched.start()
    log.info("NexMarket Agents %s started (Groq %s)", __version__, "ready" if config.groq_ready else "NOT configured")
    try:
        yield
    finally:
        sched.shutdown(wait=False)
        await db.close_pool()


app = FastAPI(title="NexMarket Agents", version=__version__, lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
secured = [Depends(require_secret)]


@app.get("/health")
async def health() -> dict[str, Any]:
    ok = True
    try:
        await db.fetchone("SELECT 1 AS one")
    except Exception:
        ok = False
    return {"ok": ok, "version": __version__, "groq": config.groq_ready}


# ─── Overview for the Agents page ───────────────────────────────────────────

@app.get("/v1/overview", dependencies=secured)
async def overview() -> dict[str, Any]:
    states = {r["agent_id"]: r for r in await db.fetch("SELECT * FROM agents.agent_state")}
    counts = await actions.today_counts()
    usage = {r["agent_id"]: r for r in await db.fetch(
        "SELECT agent_id, requests, tokens_in + tokens_out AS tokens FROM agents.usage WHERE day = (now() AT TIME ZONE 'Asia/Kolkata')::date")}
    last = {r["agent_id"]: r for r in await db.fetch(
        "SELECT DISTINCT ON (agent_id) agent_id, summary, status, created_at FROM agents.actions ORDER BY agent_id, created_at DESC")}
    handoffs = await db.fetchone(
        "SELECT count(*) AS n FROM agents.actions WHERE kind = 'handoff' AND created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'")
    stop = await limits.stop_all_state()
    lessons_week = 0
    out = []
    for a in AGENTS:
        st = states.get(a.id, {})
        c = counts.get(a.id, {})
        out.append({
            "id": a.id, "name": a.name, "job": a.job, "wing": a.wing, "wingName": WINGS[a.wing], "phase": a.phase,
            "wokenBy": a.woken_by, "canDo": a.can_do, "limits": a.limits,
            "talksTo": [BY_ID[x].name for x in a.talks_to if x in BY_ID] or (["Every agent"] if "*" in a.talks_to else []),
            "mode": st.get("mode", a.start_mode), "paused": bool(st.get("paused")), "pausedReason": st.get("paused_reason"),
            "pausedBy": st.get("paused_by"), "available": a.phase <= 1,
            "today": {"done": c.get("done", 0), "shadow": c.get("shadow", 0), "blocked": c.get("blocked", 0) + c.get("held", 0),
                      "skipped": c.get("skipped", 0), "failed": c.get("failed", 0)},
            "tokensToday": int(usage.get(a.id, {}).get("tokens", 0) or 0),
            "last": db.to_json(last.get(a.id)) if last.get(a.id) else None,
        })
    total = {k: sum(x["today"][k] for x in out) for k in ("done", "shadow", "blocked", "skipped", "failed")}
    return {"version": __version__, "groq": config.groq_ready, "stopAll": db.to_json(stop), "agents": out, "today": total,
            "handoffsToday": int(handoffs["n"]) if handoffs else 0, "lessonsThisWeek": lessons_week,
            "tokensToday": sum(x["tokensToday"] for x in out)}


@app.get("/v1/actions", dependencies=secured)
async def get_actions(agent: str | None = None, limit: int = 50, before: str | None = None) -> list[dict[str, Any]]:
    return db.to_json(await actions.feed(agent, limit, before))


# ─── Switches ─────────────────────────────────────────────────────────────────

class By(BaseModel):
    by: str = Field(max_length=200)
    reason: str | None = Field(default=None, max_length=300)


class ModeBody(By):
    mode: str


@app.post("/v1/stop-all", dependencies=secured)
async def stop_all(body: By) -> dict[str, Any]:
    await limits.set_stop_all(True, body.by, body.reason)
    await actions.record("chief_of_staff", "stop_all", "done", f"All agents stopped by {body.by}")
    return {"ok": True}


@app.post("/v1/resume-all", dependencies=secured)
async def resume_all(body: By) -> dict[str, Any]:
    await limits.set_stop_all(False, body.by)
    await actions.record("chief_of_staff", "resume_all", "done", f"All agents resumed by {body.by}")
    return {"ok": True}


def _agent(agent_id: str) -> Any:
    if agent_id not in BY_ID:
        raise HTTPException(404, "No such agent.")
    return BY_ID[agent_id]


@app.post("/v1/agents/{agent_id}/pause", dependencies=secured)
async def pause(agent_id: str, body: By) -> dict[str, Any]:
    a = _agent(agent_id)
    if a.id == "compliance_guard":
        raise HTTPException(400, "The Compliance Guard can't be paused: it is what keeps the others safe. Use Stop all instead.")
    await limits.set_paused(a.id, True, body.by, body.reason or "Paused from the Agents page")
    await actions.record(a.id, "pause", "done", f"Paused by {body.by}")
    return {"ok": True}


@app.post("/v1/agents/{agent_id}/resume", dependencies=secured)
async def resume(agent_id: str, body: By) -> dict[str, Any]:
    a = _agent(agent_id)
    await limits.set_paused(a.id, False, body.by)
    await actions.record(a.id, "resume", "done", f"Resumed by {body.by}")
    return {"ok": True}


@app.put("/v1/agents/{agent_id}/mode", dependencies=secured)
async def set_mode(agent_id: str, body: ModeBody) -> dict[str, Any]:
    a = _agent(agent_id)
    if a.id == "compliance_guard" and body.mode != "live":
        raise HTTPException(400, "The Compliance Guard is always on.")
    if body.mode != "off" and a.phase > 1:
        raise HTTPException(400, f"{a.name} arrives in phase {a.phase}; it can't be switched on yet.")
    if body.mode not in ("off", "shadow", "live"):
        raise HTTPException(400, "Mode must be off, shadow or live.")
    await limits.set_mode(a.id, body.mode, body.by)
    await actions.record(a.id, "mode", "done", f"Switched to {body.mode} by {body.by}")
    return {"ok": True}


# ─── Settings: limits, policy, facts pack, report recipients ──────────────────

SETTING_KEYS = {"limits", "policy", "facts", "recipients"}


@app.get("/v1/settings", dependencies=secured)
async def get_settings() -> dict[str, Any]:
    rows = {r["key"]: r for r in await db.fetch("SELECT key, updated_at, updated_by FROM agents.settings")}
    meta = {k: {"updatedAt": db.to_json(rows[k]["updated_at"]), "updatedBy": rows[k]["updated_by"]} for k in rows if k in SETTING_KEYS}
    return {
        "limits": await limits.limits(),
        "policy": limits.merge({"text": DEFAULT_POLICY, "isDefault": True}, await limits.get_setting("policy")),
        "facts": limits.merge(DEFAULT_FACTS, await limits.get_setting("facts")),
        "recipients": await limits.recipients(),
        "meta": meta,
    }


class SettingBody(By):
    value: dict[str, Any]


@app.put("/v1/settings/{key}", dependencies=secured)
async def put_setting(key: str, body: SettingBody) -> dict[str, Any]:
    if key not in SETTING_KEYS:
        raise HTTPException(404, "No such setting.")
    value = body.value
    if key == "limits":
        value = limits.merge(limits.DEFAULT_LIMITS, value)
        for group in value.values():
            if isinstance(group, dict):
                for k, v in group.items():
                    if isinstance(v, (int, float)) and not isinstance(v, bool) and v < 0:
                        raise HTTPException(400, f"{k} can't be negative.")
        value["ads"]["mode"] = "suggest"  # Ads stay read-only until you decide otherwise in code review, not on a form.
    if key == "policy":
        text = str(value.get("text", "")).strip()
        if len(text) < 80:
            raise HTTPException(400, "The policy is too short to check messages against.")
        value = {"text": text[:20000], "isDefault": False}
    if key == "facts":
        value = {"text": str(value.get("text", ""))[:20000],
                 "phones": [str(p).strip() for p in value.get("phones", []) if str(p).strip()][:20],
                 "domains": [str(d).strip().lower() for d in value.get("domains", []) if str(d).strip()][:20]}
    if key == "recipients":
        roles = [r for r in value.get("roles", []) if r in ("admin", "marketing_manager")] or ["admin"]
        value = {"roles": roles, "whatsapp": bool(value.get("whatsapp", False))}
    await limits.set_setting(key, value, body.by)
    await actions.record("chief_of_staff", "settings", "done", f"{key.capitalize()} changed by {body.by}")
    return {"ok": True, "value": value}


# ─── Compliance Guard ─────────────────────────────────────────────────────────

@app.post("/v1/guard/check", dependencies=secured)
async def guard_check(req: GuardRequest) -> dict[str, Any]:
    result = await guard(req)
    await log_guard(result, req)
    return result.model_dump()


# ─── Lessons, blackboard, events ─────────────────────────────────────────────

@app.get("/v1/lessons", dependencies=secured)
async def lessons(agent: str | None = None) -> list[dict[str, Any]]:
    ids = [agent] if agent else [a.id for a in AGENTS]
    out = []
    for i in ids:
        for x in await runtime.lessons(i, kept_only=False, limit=50):
            out.append({"agentId": i, **x})
    return db.to_json(out)


@app.get("/v1/tasks", dependencies=secured)
async def tasks(status: str | None = None) -> list[dict[str, Any]]:
    return db.to_json(await blackboard.listing(status))


class EventBody(BaseModel):
    kind: str
    ref_id: str = Field(alias="refId")
    data: dict[str, Any] = Field(default_factory=dict)


@app.post("/v1/events", dependencies=secured)
async def event(body: EventBody) -> dict[str, Any]:
    """NexMarket tells us something happened (a new lead, a review). It becomes a task for the right agent."""
    agent_id = EVENT_AGENT.get(body.kind)
    if not agent_id:
        return {"accepted": False, "reason": "No agent handles this event."}
    st = await limits.agent_state(agent_id)
    if st.get("mode", "off") == "off":
        return {"accepted": False, "reason": f"{BY_ID[agent_id].name} is off."}
    tid = await blackboard.post(body.kind, body.ref_id, f"{body.kind} {body.ref_id}", for_agent=agent_id, created_by="nexmarket", payload=body.data)
    return {"accepted": tid is not None, "taskId": str(tid) if tid else None}
