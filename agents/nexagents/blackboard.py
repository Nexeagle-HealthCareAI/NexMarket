"""
The blackboard: a shared list of open goals. An agent claims a task before it starts, so two agents never
work on the same lead or post; a claim expires after 30 minutes, so a crashed run frees its task.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from psycopg.errors import UniqueViolation

from . import db

CLAIM_MINUTES = 30
MAX_ATTEMPTS = 3


async def post(kind: str, subject_key: str, goal: str, *, for_agent: str | None, created_by: str,
               payload: dict[str, Any] | None = None, not_before: datetime | None = None) -> uuid.UUID | None:
    """
    Adds a task; returns None when the same kind of task for this subject is already waiting (no duplicates).
    `not_before`: nobody picks it up before then. A waiting task that is due later is brought forward when an
    earlier time is asked for (an emergency message after an ordinary one).
    """
    tid = db.new_id()
    try:
        await db.execute(
            "INSERT INTO agents.tasks (id, kind, subject_key, for_agent, goal, payload, created_by, not_before) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            tid, kind, subject_key, for_agent, goal, db.jb(payload or {}), created_by, not_before,
        )
    except UniqueViolation:
        if not_before is not None:
            await db.execute(
                "UPDATE agents.tasks SET not_before = %s, updated_at = now() WHERE kind = %s AND subject_key = %s AND status = 'open' "
                "AND (not_before IS NULL OR not_before > %s)", not_before, kind, subject_key, not_before)
        return None
    return tid


async def claim(agent_id: str, kinds: list[str] | None = None, limit: int = 1) -> list[dict[str, Any]]:
    """Claims the oldest open tasks for this agent. SKIP LOCKED so parallel runs never take the same task."""
    sql = (
        "UPDATE agents.tasks SET status = 'claimed', claimed_by = %s, claimed_at = now(), "
        f"claim_expires = now() + interval '{CLAIM_MINUTES} minutes', attempts = attempts + 1, updated_at = now() "
        "WHERE id IN (SELECT t.id FROM agents.tasks t WHERE t.status = 'open' AND (t.for_agent = %s OR t.for_agent IS NULL) "
        "AND (t.not_before IS NULL OR t.not_before <= now()) "
        # never two at once for the same lead or post
        "AND NOT EXISTS (SELECT 1 FROM agents.tasks c WHERE c.kind = t.kind AND c.subject_key = t.subject_key AND c.status = 'claimed')"
    )
    args: list[Any] = [agent_id, agent_id]
    if kinds:
        sql += " AND t.kind = ANY(%s)"
        args.append(kinds)
    sql += " ORDER BY t.created_at LIMIT %s FOR UPDATE SKIP LOCKED) RETURNING *"
    args.append(limit)
    return await db.fetch(sql, *args)


async def finish(task_id: uuid.UUID, agent_id: str, result: dict[str, Any], ok: bool = True) -> bool:
    n = await db.execute(
        "UPDATE agents.tasks SET status = %s, result = %s, updated_at = now() WHERE id = %s AND claimed_by = %s AND status = 'claimed'",
        "done" if ok else "failed", db.jb(result), task_id, agent_id,
    )
    return n == 1


async def release_expired() -> int:
    """Claims past their expiry go back to open (or fail after 3 attempts)."""
    await db.execute(
        f"UPDATE agents.tasks SET status = 'failed', result = jsonb_build_object('error', 'gave up after {MAX_ATTEMPTS} attempts'), updated_at = now() "
        "WHERE status = 'claimed' AND claim_expires < now() AND attempts >= %s",
        MAX_ATTEMPTS,
    )
    return await db.execute(
        "UPDATE agents.tasks SET status = 'open', claimed_by = NULL, claimed_at = NULL, claim_expires = NULL, updated_at = now() "
        "WHERE status = 'claimed' AND claim_expires < now()"
    )


async def listing(status: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    sql = "SELECT * FROM agents.tasks"
    args: list[Any] = []
    if status:
        sql += " WHERE status = %s"
        args.append(status)
    sql += " ORDER BY created_at DESC LIMIT %s"
    args.append(limit)
    return await db.fetch(sql, *args)
