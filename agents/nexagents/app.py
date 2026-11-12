"""
NexMarket Agents — internal HTTP API. Only the .NET API calls it (shared secret); people reach it through
the CRM's Agents page, which checks who they are and what they may change.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import timedelta
from typing import Any, AsyncIterator

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from . import __version__, actions, blackboard, db, limits, nexmarket, review as reviews
from .act import guard, log_guard
from .agents import (broadcast_manager, chief_of_staff, content_writer, data_watcher, lead_follow_up, lead_responder, reporter_coach, reputation,
                     social_publisher)
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
EVENT_AGENT = {"lead.idle": "lead_follow_up", "review.new": "reputation", "referral.arrived": "partner_network"}


# ─── Background jobs ──────────────────────────────────────────────────────────

async def housekeeping() -> None:
    try:
        n = await blackboard.release_expired()
        if n:
            log.info("Released %s expired claims", n)
        # Tasks given up on after three tries: a person hears about it once, instead of the work vanishing.
        lost = await db.fetch("UPDATE agents.tasks SET result = result || '{\"told\": true}'::jsonb WHERE status = 'failed' AND result->>'error' LIKE 'gave up%%' "
                              "AND NOT (result ? 'told') AND updated_at > now() - interval '1 day' RETURNING for_agent, goal")
        if lost:
            who = BY_ID[lost[0]["for_agent"]].name if lost[0]["for_agent"] in BY_ID else "An agent"
            await nexmarket.notify_team(f"{who} gave up on {len(lost)} {'task' if len(lost) == 1 else 'tasks'}",
                                        f"Tried three times and stopped: {lost[0]['goal'][:120]}. See Activity on the Agents page.", "ai-agents", agent_id=lost[0]["for_agent"] or "chief_of_staff")
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
            today, usual = await actions.volume(a.id)
            reason = None
            if blocks >= lim["blocksPerHourToPause"]:
                reason = f"{blocks} messages blocked by the Guard in the last hour"
            # Far more messages than this agent normally sends in a day (and enough of them to matter).
            elif lim.get("volumeMultipleToPause", 0) > 0 and today >= VOLUME_FLOOR and usual >= 1 and today >= usual * lim["volumeMultipleToPause"]:
                reason = f"it sent {today} messages today, {today / usual:.0f} times its usual {usual:.0f} a day"
            if reason:
                await limits.set_paused(a.id, True, "system", reason)
                await actions.record(a.id, "pause", "done", f"Paused automatically: {reason}")
                try:
                    await nexmarket.notify_team(f"{a.name} paused", f"{reason}. Check it on the Agents page.", "ai-agents", agent_id=a.id)
                except Exception:
                    log.exception("could not send the pause alert")
    except Exception:
        log.exception("anomaly watch failed")


# The unusual-volume pause only counts once an agent has sent this many messages in the day.
VOLUME_FLOOR = 30


async def catch_up_leads() -> None:
    try:
        n = await lead_responder.catch_up()
        if n:
            log.info("Catch-up queued %s missed leads", n)
    except Exception:
        log.exception("lead catch-up failed")


async def follow_up_leads() -> None:
    try:
        await lead_follow_up.tick()
    except Exception:
        log.exception("lead follow-up failed")


def _job(name: str, fn: Any) -> Any:
    """A scheduled run that never takes the scheduler down with it."""
    async def run() -> None:
        try:
            r = await fn()
            if r and any(r.values()):
                log.info("%s: %s", name, r)
        except Exception:
            log.exception("%s failed", name)
    run.__name__ = name
    return run


async def work_leads() -> None:
    try:
        await lead_responder.tick()
    except Exception:
        log.exception("lead responder tick failed")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await db.open_pool()
    await runtime.open()
    await limits.ensure_agents({a.id: a.start_mode for a in AGENTS})
    sched = AsyncIOScheduler(timezone="Asia/Kolkata")
    sched.add_job(housekeeping, "interval", minutes=5, id="housekeeping")
    sched.add_job(watch_anomalies, "interval", minutes=10, id="anomalies")
    sched.add_job(work_leads, "interval", seconds=15, id="lead_responder", max_instances=1, coalesce=True)
    sched.add_job(catch_up_leads, "interval", minutes=3, id="lead_catch_up", max_instances=1, coalesce=True)
    # Follow-ups go out in the working day only: every hour from 10 am to 6 pm India time.
    sched.add_job(follow_up_leads, "cron", hour="10-18", minute=20, id="lead_follow_up", max_instances=1, coalesce=True)
    # The day, in India time: numbers → plan → check → report → lessons. A run missed by up to an hour (a restart) still happens.
    late = {"max_instances": 1, "coalesce": True, "misfire_grace_time": 3600}
    sched.add_job(_job("data_watcher", data_watcher.tick), "cron", hour=6, minute=30, id="data_watcher_early", **late)
    sched.add_job(_job("data_watcher", data_watcher.tick), "cron", hour="8-20", minute=5, id="data_watcher", **late)
    sched.add_job(_job("chief_plan", chief_of_staff.plan_day), "cron", hour=7, minute=15, id="chief_plan", **late)
    sched.add_job(_job("chief_check", chief_of_staff.check_day), "cron", hour=14, minute=10, id="chief_check", **late)
    sched.add_job(_job("evening_report", reporter_coach.report), "cron", hour=20, minute=10, id="evening_report", **late)
    sched.add_job(_job("coach", reporter_coach.coach), "cron", hour=20, minute=30, id="coach", **late)
    # The studio: reviews, drafts, posts, camp invitations.
    sched.add_job(_job("reputation", reputation.tick), "cron", hour="9-20", minute="15,45", id="reputation", **late)
    sched.add_job(_job("content_writer", content_writer.tick), "cron", hour=9, minute=30, id="content_writer", **late)
    sched.add_job(_job("social_publisher", social_publisher.tick), "cron", hour="10,18", minute=0, id="social_publisher", **late)
    sched.add_job(_job("broadcast_manager", broadcast_manager.tick), "cron", hour="11,16", minute=0, id="broadcast_manager", **late)
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
    judged = await actions.review_counts()
    waiting = await actions.waiting_review()
    lessons_week = 0
    week_ago = (db.now() - timedelta(days=7)).isoformat()
    for a in AGENTS:
        if a.built:
            lessons_week += sum(1 for x in await runtime.lessons(a.id, limit=50) if str(x.get("at") or "") >= week_ago)
    out = []
    for a in AGENTS:
        st = states.get(a.id, {})
        c = counts.get(a.id, {})
        out.append({
            "id": a.id, "name": a.name, "job": a.job, "wing": a.wing, "wingName": WINGS[a.wing], "phase": a.phase,
            "wokenBy": a.woken_by, "canDo": a.can_do, "limits": a.limits,
            "talksTo": [BY_ID[x].name for x in a.talks_to if x in BY_ID] or (["Every agent"] if "*" in a.talks_to else []),
            "mode": st.get("mode", a.start_mode), "paused": bool(st.get("paused")), "pausedReason": st.get("paused_reason"),
            "pausedBy": st.get("paused_by"), "available": a.built,
            "today": {"done": c.get("done", 0), "shadow": c.get("shadow", 0), "blocked": c.get("blocked", 0) + c.get("held", 0),
                      "skipped": c.get("skipped", 0), "failed": c.get("failed", 0)},
            "tokensToday": int(usage.get(a.id, {}).get("tokens", 0) or 0),
            # How people judged its drafts in the last 30 days, and how many drafts still wait to be checked.
            "reviews": {**reviews.score(judged.get(a.id, {})), "waiting": waiting.get(a.id, 0)},
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
    if body.mode != "off" and not a.built:
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


# ─── Checking an agent's work ────────────────────────────────────────────────

class ReviewBody(By):
    verdict: str
    text: str | None = Field(default=None, max_length=2000)
    note: str | None = Field(default=None, max_length=400)
    send: bool = False
    remember: bool = False


@app.post("/v1/actions/{action_id}/review", dependencies=secured)
async def review_action(action_id: str, body: ReviewBody) -> dict[str, Any]:
    try:
        return await reviews.review(action_id, by=body.by, verdict=body.verdict, text=body.text, note=body.note, send=body.send, remember=body.remember)
    except reviews.ReviewError as e:
        raise HTTPException(e.status, {"message": str(e), "issues": e.issues})


class LessonBody(By):
    agent: str
    text: str = Field(min_length=8, max_length=400)


@app.post("/v1/lessons", dependencies=secured)
async def add_lesson(body: LessonBody) -> dict[str, Any]:
    a = _agent(body.agent)
    if not a.built:
        raise HTTPException(400, f"{a.name} isn't built yet, so it can't use lessons.")
    key = await runtime.add_lesson(a.id, body.text, body.by)
    await actions.record(a.id, "lesson", "done", f"New lesson from {body.by}: {body.text[:200]}")
    return {"ok": True, "key": key}


@app.post("/v1/lessons/{agent_id}/{key}/keep", dependencies=secured)
async def keep_lesson(agent_id: str, key: str, body: By) -> dict[str, Any]:
    a = _agent(agent_id)
    if not await runtime.keep_lesson(a.id, key, body.by):
        raise HTTPException(404, "No such lesson.")
    await actions.record(a.id, "lesson", "done", f"Suggested lesson kept by {body.by}")
    return {"ok": True}


class RunBody(By):
    job: str


@app.post("/v1/run", dependencies=secured)
async def run_now(body: RunBody) -> dict[str, Any]:
    """Runs one of the daily jobs now (the button on an agent's card), instead of waiting for its hour."""
    jobs = {"data_watcher": data_watcher.tick, "chief_plan": chief_of_staff.plan_day, "chief_check": chief_of_staff.check_day,
            "evening_report": reporter_coach.report, "coach": reporter_coach.coach, "lead_follow_up": lead_follow_up.tick,
            "reputation": reputation.tick, "content_writer": content_writer.tick, "social_publisher": social_publisher.tick, "broadcast_manager": broadcast_manager.tick}
    if body.job not in jobs:
        raise HTTPException(404, "No such job.")
    return {"ok": True, "result": await jobs[body.job]()}


@app.post("/v1/lessons/{agent_id}/{key}/drop", dependencies=secured)
async def drop_lesson(agent_id: str, key: str, body: By) -> dict[str, Any]:
    a = _agent(agent_id)
    if not await runtime.drop_lesson(a.id, key, body.by):
        raise HTTPException(404, "No such lesson.")
    await actions.record(a.id, "lesson", "done", f"Lesson removed by {body.by}")
    return {"ok": True}


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
    if body.kind == "lead.message":
        return await lead_responder.on_message(body.ref_id)
    agent_id = EVENT_AGENT.get(body.kind)
    if not agent_id:
        return {"accepted": False, "reason": "No agent handles this event."}
    st = await limits.agent_state(agent_id)
    if st.get("mode", "off") == "off":
        return {"accepted": False, "reason": f"{BY_ID[agent_id].name} is off."}
    tid = await blackboard.post(body.kind, body.ref_id, f"{body.kind} {body.ref_id}", for_agent=agent_id, created_by="nexmarket", payload=body.data)
    return {"accepted": tid is not None, "taskId": str(tid) if tid else None}
