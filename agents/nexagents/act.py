"""
The one way an agent does something that reaches people: gate (Stop all, switch, quiet hours, caps) →
Compliance Guard → send (or, in shadow mode, only record what would have been sent) → action log.
Phase 2 agents call `outgoing()` with their send function; nothing can skip these steps.
"""

from __future__ import annotations

import uuid
from typing import Any, Awaitable, Callable

from . import actions, limits
from .guard.check import GuardRequest, GuardResult, check as guard_check


async def guard(req: GuardRequest) -> GuardResult:
    """The Guard with the current policy and facts pack from the Agents page."""
    policy = await limits.get_setting("policy")
    facts = await limits.get_setting("facts")
    return await guard_check(req, policy_text=(policy or {}).get("text"), facts_pack=facts)


async def log_guard(result: GuardResult, req: GuardRequest, run_id: uuid.UUID | None = None) -> None:
    status = {"pass": "done", "fix": "blocked", "block": "blocked", "held": "held"}[result.outcome]
    from .agents.registry import BY_ID

    who = BY_ID[req.from_agent].name if req.from_agent in BY_ID else (req.from_agent or "a person")
    await actions.record(
        "compliance_guard", "guard_check", status,
        f"{'Passed' if result.outcome == 'pass' else 'Held' if result.outcome == 'held' else 'Blocked'} a {req.channel} message from {who}"
        + (" after one rewrite" if result.rewritten else ""),
        run_id=run_id, channel=req.channel, detail={"outcome": result.outcome, "rewritten": result.rewritten, "checkedBy": result.checked_by},
        reasons=result.issues + ([{"rule": "policy", "message": result.policy["explanation"]}] if result.policy and result.policy.get("violation") else []),
    )


async def outgoing(agent_id: str, *, kind: str, channel: str, text: str, summary: str, send: Callable[[str], Awaitable[dict[str, Any]]],
                   audience: str = "patient", sources: list[dict[str, Any]] | None = None, subject: tuple[str, str] | None = None,
                   opted_in: bool | None = None, inbound_reply: bool = False, cap: tuple[int, int] | None = None,
                   run_id: uuid.UUID | None = None, rules_only: bool = False) -> dict[str, Any]:
    """`rules_only`: a fixed text an admin approved (the emergency message) — checked by the rules, not held for the AI policy check."""
    v = await limits.gate(agent_id, outgoing=True, inbound_reply=inbound_reply, cap=cap)
    if not v.allowed:
        await actions.record(agent_id, kind, "skipped", f"Not sent: {v.reason}", run_id=run_id, subject=subject, channel=channel,
                             reasons=[{"rule": r, "message": v.reason} for r in v.rules])
        return {"sent": False, "reason": v.reason}
    req = GuardRequest(text=text, channel=channel, audience=audience, sources=sources or [], opted_in=opted_in,
                       allow_rewrite=not rules_only, rules_only=rules_only, from_agent=agent_id)
    g = await guard(req)
    await log_guard(g, req, run_id)
    if g.outcome != "pass":
        await actions.record(agent_id, kind, "blocked" if g.outcome != "held" else "held", f"Stopped by the Guard: {summary}",
                             run_id=run_id, subject=subject, channel=channel, detail={"text": text}, sources=sources, reasons=g.issues)
        return {"sent": False, "reason": "guard", "guard": g.model_dump()}
    if v.shadow:
        await actions.record(agent_id, kind, "shadow", f"Would send: {summary}", run_id=run_id, subject=subject, channel=channel,
                             detail={"text": g.text}, sources=sources)
        return {"sent": False, "shadow": True, "text": g.text}
    try:
        result = await send(g.text)
    except Exception as e:  # the send failed: logged, never retried blindly
        await actions.record(agent_id, kind, "failed", f"Send failed: {summary}", run_id=run_id, subject=subject, channel=channel,
                             detail={"text": g.text, "error": str(e)[:300]}, sources=sources)
        return {"sent": False, "reason": "failed"}
    await actions.record(agent_id, kind, "done", summary, run_id=run_id, subject=subject, channel=channel, detail={"text": g.text, "result": result}, sources=sources)
    return {"sent": True, "text": g.text, "result": result}
