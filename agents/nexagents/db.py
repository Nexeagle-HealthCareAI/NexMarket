"""Database: one async pool for the agents schema, plus LangGraph's Postgres checkpointer and store."""

from __future__ import annotations

import json
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from .config import config

_pool: AsyncConnectionPool | None = None

# The service always works in its own schema; LangGraph's tables land there too.
CONNECT_KWARGS = {"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row, "options": "-c search_path=agents,public"}


def now() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> uuid.UUID:
    return uuid.uuid4()


def jb(value: Any) -> Jsonb:
    return Jsonb(value)


async def open_pool(url: str | None = None) -> AsyncConnectionPool:
    """Opens the pool and creates the schema (idempotent)."""
    global _pool
    if _pool is not None:
        return _pool
    dsn = url or config.database_url
    if not dsn:
        raise RuntimeError("AGENTS_DATABASE_URL is not set.")
    pool = AsyncConnectionPool(dsn, min_size=1, max_size=10, kwargs=CONNECT_KWARGS, open=False)
    await pool.open(wait=True)
    sql = (Path(__file__).parent / "schema.sql").read_text(encoding="utf-8")
    async with pool.connection() as conn:
        await conn.execute(sql, prepare=False)  # several statements: never prepared
    _pool = pool
    return pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> AsyncConnectionPool:
    if _pool is None:
        raise RuntimeError("Database pool is not open.")
    return _pool


@asynccontextmanager
async def conn() -> AsyncIterator[Any]:
    async with pool().connection() as c:
        yield c


async def fetch(sql: str, *args: Any) -> list[dict[str, Any]]:
    async with conn() as c:
        cur = await c.execute(sql, args)
        return list(await cur.fetchall()) if cur.description else []


async def fetchone(sql: str, *args: Any) -> dict[str, Any] | None:
    rows = await fetch(sql, *args)
    return rows[0] if rows else None


async def execute(sql: str, *args: Any) -> int:
    async with conn() as c:
        cur = await c.execute(sql, args)
        return cur.rowcount


def to_json(value: Any) -> Any:
    """Rows → JSON-safe dicts for the API."""
    return json.loads(json.dumps(value, default=lambda o: o.isoformat() if isinstance(o, datetime) else str(o)))
