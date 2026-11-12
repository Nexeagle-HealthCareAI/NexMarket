"""The action log. Every action, shadow action, block and hand-off is one row; these rows are the episodes
the agents learn from once NexMarket reports the outcome (replied, came in, reach, cost per patient)."""

from __future__ import annotations

import uuid
from typing import Any

from . import db


async def record(agent_id: str, kind: str, status: str, summary: str, *, run_id: uuid.UUID | None = None,
                 subject: tuple[str, str] | None = None, channel: str | None = None, detail: dict[str, Any] | None = None,
                 sources: list[dict[str, Any]] | None = None, reasons: list[dict[str, Any]] | None = None,
                 to_agent: str | None = None) -> uuid.UUID:
    aid = db.new_id()
    await db.execute(
        "INSERT INTO agents.actions (id, agent_id, run_id, kind, status, summary, subject_type, subject_id, channel, detail, sources, reasons, to_agent) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        aid, agent_id, run_id, kind, status, summary[:500], subject[0] if subject else None, subject[1] if subject else None,
        channel, db.jb(detail or {}), db.jb(sources or []), db.jb(reasons or []), to_agent,
    )
    return aid


async def set_outcome(action_id: uuid.UUID, outcome: dict[str, Any]) -> None:
    await db.execute("UPDATE agents.actions SET outcome = %s, outcome_at = now() WHERE id = %s", db.jb(outcome), action_id)


async def feed(agent_id: str | None = None, limit: int = 50, before: str | None = None) -> list[dict[str, Any]]:
    sql = ("SELECT id, agent_id, kind, status, summary, subject_type, subject_id, channel, detail, sources, reasons, to_agent, outcome, created_at, "
           "review, reviewed_at, reviewed_by FROM agents.actions WHERE true")
    args: list[Any] = []
    if agent_id:
        sql += " AND agent_id = %s"
        args.append(agent_id)
    if before:
        sql += " AND created_at < %s"
        args.append(before)
    sql += " ORDER BY created_at DESC LIMIT %s"
    args.append(max(1, min(limit, 200)))
    return await db.fetch(sql, *args)


async def today_counts() -> dict[str, dict[str, int]]:
    """Per agent: today's actions by status (India day)."""
    rows = await db.fetch(
        "SELECT agent_id, status, count(*) AS n FROM agents.actions "
        "WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata' "
        # Switches people flip (mode, pause, Stop all, settings) are in the log but aren't the agent's work.
        "AND kind NOT IN ('mode', 'pause', 'resume', 'stop_all', 'resume_all', 'settings', 'lesson') GROUP BY agent_id, status"
    )
    out: dict[str, dict[str, int]] = {}
    for r in rows:
        out.setdefault(r["agent_id"], {})[r["status"]] = int(r["n"])
    return out


async def blocks_last_hour(agent_id: str) -> int:
    row = await db.fetchone(
        "SELECT count(*) AS n FROM agents.actions WHERE agent_id = %s AND status IN ('blocked', 'held') AND created_at > now() - interval '1 hour'",
        agent_id,
    )
    return int(row["n"]) if row else 0


async def get(action_id: uuid.UUID | str) -> dict[str, Any] | None:
    return await db.fetchone("SELECT * FROM agents.actions WHERE id = %s", action_id)


async def set_review(action_id: uuid.UUID | str, review: dict[str, Any], by: str) -> None:
    await db.execute("UPDATE agents.actions SET review = %s, reviewed_at = now(), reviewed_by = %s WHERE id = %s", db.jb(review), by, action_id)


async def review_counts(days: int = 30) -> dict[str, dict[str, int]]:
    """Per agent: how people judged its drafts and messages in the last `days` days (good / edited / wrong)."""
    rows = await db.fetch(
        "SELECT agent_id, review->>'verdict' AS verdict, count(*) AS n FROM agents.actions "
        "WHERE reviewed_at > now() - make_interval(days => %s) GROUP BY agent_id, review->>'verdict'", days)
    out: dict[str, dict[str, int]] = {}
    for r in rows:
        out.setdefault(r["agent_id"], {})[r["verdict"] or "good"] = int(r["n"])
    return out


async def waiting_review(agent_id: str | None = None) -> dict[str, int]:
    """Shadow drafts from the last 7 days nobody has looked at yet, per agent."""
    rows = await db.fetch(
        "SELECT agent_id, count(*) AS n FROM agents.actions WHERE status IN ('shadow', 'held') AND reviewed_at IS NULL AND detail ? 'text' "
        "AND created_at > now() - interval '7 days' GROUP BY agent_id")
    return {r["agent_id"]: int(r["n"]) for r in rows if not agent_id or r["agent_id"] == agent_id}


async def volume(agent_id: str) -> tuple[int, float]:
    """Messages really sent today, and the average per day over the 7 days before (India days)."""
    row = await db.fetchone(
        "WITH d AS (SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::date AS day, count(*) AS n FROM agents.actions "
        "WHERE agent_id = %s AND status = 'done' AND channel IS NOT NULL AND created_at > now() - interval '9 days' GROUP BY 1) "
        "SELECT coalesce((SELECT n FROM d WHERE day = (now() AT TIME ZONE 'Asia/Kolkata')::date), 0) AS today, "
        "coalesce((SELECT sum(n) FROM d WHERE day < (now() AT TIME ZONE 'Asia/Kolkata')::date "
        "AND day >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 7), 0) / 7.0 AS usual", agent_id)
    return (int(row["today"]), float(row["usual"])) if row else (0, 0.0)
