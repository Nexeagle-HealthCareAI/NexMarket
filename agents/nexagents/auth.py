"""Every call from the .NET API carries the shared secret. Compared in constant time; no secret = closed."""

from __future__ import annotations

import hmac

from fastapi import Header, HTTPException

from .config import config


async def require_secret(x_agents_secret: str | None = Header(default=None)) -> None:
    if not config.secret or not x_agents_secret or not hmac.compare_digest(x_agents_secret.encode(), config.secret.encode()):
        raise HTTPException(status_code=401, detail="Not allowed.")
