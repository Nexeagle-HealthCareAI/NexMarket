"""
Limits an admin sets in the CRM, and the gate every action passes before it happens.

Agents can never change these. The gate is plain code, not the AI: Stop all, the agent's own switch
(off / shadow / live, paused), quiet hours and daily caps are checked here before anything is sent.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, time, timedelta, timezone
from typing import Any

from . import db

IST = timezone(timedelta(hours=5, minutes=30))

# "Careful start" (chosen 9 Nov 2026). Every number can be changed on the Agents page.
DEFAULT_LIMITS: dict[str, Any] = {
    "quietHours": {"from": "21:00", "to": "08:00", "allowRepliesToInbound": True},
    "lead": {"repliesPerLeadPerHour": 1, "maxFollowUpsPerLead": 3, "autoRepliesPerPersonPerDay": 1, "followUpsPerDay": 40, "closeAfterQuietDays": 10},
    "partner": {"messagesPerDay": 20},
    "broadcast": {"perListPerWeek": 1, "perPersonPerWeek": 1},
    "social": {"postsPerChannelPerDay": 2},
    "reviews": {"repliesPerDay": 20},
    "whatsapp": {"sendsPerDay": 300},
    # You run Google and Meta ads yourself: the Ads Optimiser only reads results and suggests changes.
    "ads": {"mode": "suggest", "monthlyCapMeta": 0, "monthlyCapGoogle": 0, "maxDailyChangePct": 20},
    "tokens": {"perAgentPerDay": 300_000},
    "anomaly": {"blocksPerHourToPause": 5, "volumeMultipleToPause": 3},
}

# Admins and marketing managers get the evening report and the alerts (chosen 9 Nov 2026).
DEFAULT_RECIPIENTS: dict[str, Any] = {"roles": ["admin", "marketing_manager"], "whatsapp": False}


@dataclass
class Verdict:
    """The gate's answer. allowed=False means nothing is done; shadow=True means record it but don't send."""

    allowed: bool
    shadow: bool = False
    reason: str | None = None
    rules: list[str] = field(default_factory=list)


# ─── Settings ─────────────────────────────────────────────────────────────────

async def get_setting(key: str, default: Any = None) -> Any:
    row = await db.fetchone("SELECT value FROM agents.settings WHERE key = %s", key)
    return row["value"] if row else default


async def set_setting(key: str, value: Any, by: str | None) -> None:
    await db.execute(
        "INSERT INTO agents.settings (key, value, updated_at, updated_by) VALUES (%s, %s, now(), %s) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by",
        key, db.jb(value), by,
    )
    await db.execute("INSERT INTO agents.settings_history (key, value, changed_by) VALUES (%s, %s, %s)", key, db.jb(value), by)


def merge(defaults: dict[str, Any], stored: dict[str, Any] | None) -> dict[str, Any]:
    """Stored values over the defaults, one level deep, so new default keys appear without a migration."""
    out = {k: (dict(v) if isinstance(v, dict) else v) for k, v in defaults.items()}
    for k, v in (stored or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k].update(v)
        else:
            out[k] = v
    return out


async def limits() -> dict[str, Any]:
    return merge(DEFAULT_LIMITS, await get_setting("limits"))


async def recipients() -> dict[str, Any]:
    return merge(DEFAULT_RECIPIENTS, await get_setting("recipients"))


# ─── Stop all and each agent's switch ───────────────────────────────────────

async def stop_all_state() -> dict[str, Any]:
    return await get_setting("stop_all", {"on": False})


async def set_stop_all(on: bool, by: str | None, reason: str | None = None) -> None:
    await set_setting("stop_all", {"on": on, "by": by, "reason": reason, "at": db.now().isoformat()}, by)


async def ensure_agents(defaults: dict[str, str]) -> None:
    """Creates a switch row for each agent, with its starting mode (existing rows are left alone)."""
    for agent_id, mode in defaults.items():
        await db.execute(
            "INSERT INTO agents.agent_state (agent_id, mode) VALUES (%s, %s) ON CONFLICT (agent_id) DO NOTHING", agent_id, mode
        )


async def agent_state(agent_id: str) -> dict[str, Any]:
    row = await db.fetchone("SELECT * FROM agents.agent_state WHERE agent_id = %s", agent_id)
    return row or {"agent_id": agent_id, "mode": "off", "paused": False}


async def set_mode(agent_id: str, mode: str, by: str | None) -> None:
    if mode not in ("off", "shadow", "live"):
        raise ValueError("mode must be off, shadow or live")
    await db.execute(
        "INSERT INTO agents.agent_state (agent_id, mode, updated_at) VALUES (%s, %s, now()) "
        "ON CONFLICT (agent_id) DO UPDATE SET mode = EXCLUDED.mode, updated_at = now()",
        agent_id, mode,
    )


async def set_paused(agent_id: str, paused: bool, by: str | None, reason: str | None = None) -> None:
    await db.execute(
        "INSERT INTO agents.agent_state (agent_id, paused, paused_reason, paused_by, paused_at, updated_at) "
        "VALUES (%s, %s, %s, %s, CASE WHEN %s THEN now() END, now()) "
        "ON CONFLICT (agent_id) DO UPDATE SET paused = EXCLUDED.paused, paused_reason = EXCLUDED.paused_reason, "
        "paused_by = EXCLUDED.paused_by, paused_at = EXCLUDED.paused_at, updated_at = now()",
        agent_id, paused, reason if paused else None, by if paused else None, paused,
    )


# ─── Quiet hours ──────────────────────────────────────────────────────────────

def _hm(s: str) -> time:
    h, m = s.split(":")
    return time(int(h), int(m))


def in_quiet_hours(quiet: dict[str, Any], at: datetime | None = None) -> bool:
    """True between "from" and "to" in India time (the window may cross midnight)."""
    t = (at or db.now()).astimezone(IST).time()
    start, end = _hm(quiet.get("from", "21:00")), _hm(quiet.get("to", "08:00"))
    return (start <= t or t < end) if start > end else (start <= t < end)


# ─── Caps ─────────────────────────────────────────────────────────────────────

async def count_today(agent_id: str, kinds: list[str], subject: tuple[str, str] | None = None, since: datetime | None = None) -> int:
    """Actions that were really sent (done) of these kinds, since the start of today in India (or `since`)."""
    if since is None:
        ist_now = db.now().astimezone(IST)
        since = ist_now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    sql = "SELECT count(*) AS n FROM agents.actions WHERE agent_id = %s AND kind = ANY(%s) AND status = 'done' AND created_at >= %s"
    args: list[Any] = [agent_id, kinds, since]
    if subject:
        sql += " AND subject_type = %s AND subject_id = %s"
        args += list(subject)
    row = await db.fetchone(sql, *args)
    return int(row["n"]) if row else 0


# ─── The gate ─────────────────────────────────────────────────────────────────

async def gate(agent_id: str, *, outgoing: bool, inbound_reply: bool = False, cap: tuple[int, int] | None = None,
               at: datetime | None = None) -> Verdict:
    """
    May this agent act now? `outgoing` = it reaches a person outside (message, post, reply).
    `inbound_reply` = an answer to someone who wrote first (allowed in quiet hours if the setting says so).
    `cap` = (already done, limit) for the cap that applies to this action.
    """
    stop = await stop_all_state()
    if stop.get("on"):
        return Verdict(False, reason="All agents are stopped.", rules=["stop_all"])
    st = await agent_state(agent_id)
    if st.get("paused"):
        return Verdict(False, reason=f"This agent is paused{': ' + st['paused_reason'] if st.get('paused_reason') else ''}.", rules=["paused"])
    mode = st.get("mode", "off")
    if mode == "off":
        return Verdict(False, reason="This agent is switched off.", rules=["off"])
    if outgoing:
        lim = await limits()
        quiet = lim["quietHours"]
        if in_quiet_hours(quiet, at) and not (inbound_reply and quiet.get("allowRepliesToInbound", True)):
            return Verdict(False, reason=f"Quiet hours ({quiet['from']}–{quiet['to']}).", rules=["quiet_hours"])
        if cap and cap[0] >= cap[1]:
            return Verdict(False, reason=f"Daily limit reached ({cap[1]}).", rules=["cap"])
    return Verdict(True, shadow=(mode == "shadow" and outgoing))
