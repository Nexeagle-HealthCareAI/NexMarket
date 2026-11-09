"""Settings from environment variables only. Nothing secret is ever read from a file in the repo."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


@dataclass(frozen=True)
class Config:
    # Postgres: the same database as the .NET API; everything here lives in the "agents" schema.
    database_url: str = field(default_factory=lambda: os.environ.get("AGENTS_DATABASE_URL", ""))
    # Shared secret between this service and the .NET API (both directions). Required.
    secret: str = field(default_factory=lambda: os.environ.get("AGENTS_SECRET", ""))
    # Where the .NET API is, for tools (notify, Team board cards, and later leads, WhatsApp, posts).
    nexmarket_url: str = field(default_factory=lambda: os.environ.get("NEXMARKET_API_URL", "http://localhost:5010").rstrip("/"))
    # Groq. The key comes from the environment only.
    groq_api_key: str = field(default_factory=lambda: os.environ.get("GROQ_API_KEY", ""))
    model_big: str = field(default_factory=lambda: os.environ.get("AGENTS_MODEL_BIG", "openai/gpt-oss-120b"))
    model_small: str = field(default_factory=lambda: os.environ.get("AGENTS_MODEL_SMALL", "openai/gpt-oss-20b"))
    model_safeguard: str = field(default_factory=lambda: os.environ.get("AGENTS_MODEL_SAFEGUARD", "openai/gpt-oss-safeguard-20b"))
    # Groq account limits. Defaults are deliberately low; raise them to your plan's limits.
    groq_rpm: int = field(default_factory=lambda: _int("GROQ_REQUESTS_PER_MINUTE", 60))
    groq_tpm: int = field(default_factory=lambda: _int("GROQ_TOKENS_PER_MINUTE", 100_000))
    port: int = field(default_factory=lambda: _int("AGENTS_PORT", 5020))
    # Run limits for every agent run (design: 25 steps, 10 minutes).
    max_steps: int = 25
    max_run_seconds: int = 600

    @property
    def groq_ready(self) -> bool:
        return bool(self.groq_api_key)


config = Config()
