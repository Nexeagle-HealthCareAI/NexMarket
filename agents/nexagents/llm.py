"""
Groq models, one shared rate limiter, and a daily token budget per agent.

Three models only: gpt-oss-120b (plans, checks, hard calls), gpt-oss-20b (routine work) and
gpt-oss-safeguard-20b (the Compliance Guard's policy check). Every agent goes through `chat()`, so all of
them together stay under the Groq account's limits, and urgent work (a lead's first reply) goes first.
"""

from __future__ import annotations

import asyncio
import heapq
import itertools
import time
from collections import deque
from dataclasses import dataclass
from typing import Any, Literal

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import BaseMessage

from . import db
from .config import config
from .limits import IST, limits

Tier = Literal["big", "small", "safeguard"]


class BudgetExceeded(Exception):
    """This agent has used today's token budget; it pauses until tomorrow."""


class ModelUnavailable(Exception):
    """No Groq key, or Groq failed after retries. Callers must fail closed (send nothing)."""


class RateLimiter:
    """
    Requests and tokens per minute across every agent. Waiters are served by priority (0 = most urgent),
    then in arrival order. Token use is estimated before the call and corrected after it.
    """

    def __init__(self, rpm: int, tpm: int) -> None:
        self.rpm, self.tpm = max(1, rpm), max(1000, tpm)
        self._reqs: deque[float] = deque()
        self._toks: deque[tuple[float, int]] = deque()
        self._waiters: list[tuple[int, int, asyncio.Future[None]]] = []
        self._seq = itertools.count()
        self._lock = asyncio.Lock()

    def _trim(self, now: float) -> None:
        while self._reqs and now - self._reqs[0] >= 60:
            self._reqs.popleft()
        while self._toks and now - self._toks[0][0] >= 60:
            self._toks.popleft()

    def _room(self, tokens: int, now: float) -> float:
        """0 when a call of this size fits now, else seconds to wait."""
        self._trim(now)
        used = sum(t for _, t in self._toks)
        waits = []
        if len(self._reqs) >= self.rpm:
            waits.append(60 - (now - self._reqs[0]))
        if used + tokens > self.tpm and self._toks:
            # Wait until enough old usage falls out of the window.
            need, acc = used + tokens - self.tpm, 0
            for ts, t in self._toks:
                acc += t
                if acc >= need:
                    waits.append(60 - (now - ts))
                    break
        return max(waits) if waits else 0.0

    async def acquire(self, tokens: int, priority: int = 5) -> None:
        tokens = min(tokens, self.tpm)
        fut: asyncio.Future[None] = asyncio.get_running_loop().create_future()
        entry = (priority, next(self._seq), fut)
        heapq.heappush(self._waiters, entry)
        try:
            while True:
                async with self._lock:
                    if self._waiters and self._waiters[0] is entry:
                        now = time.monotonic()
                        wait = self._room(tokens, now)
                        if wait <= 0:
                            heapq.heappop(self._waiters)
                            self._reqs.append(now)
                            self._toks.append((now, tokens))
                            return
                    else:
                        wait = 0.05
                await asyncio.sleep(min(max(wait, 0.05), 2.0))
        except BaseException:
            if entry in self._waiters:
                self._waiters.remove(entry)
                heapq.heapify(self._waiters)
            raise

    def correct(self, estimated: int, actual: int) -> None:
        """After the call: replace the estimate with what was really used."""
        if actual > estimated:
            self._toks.append((time.monotonic(), actual - estimated))


limiter = RateLimiter(config.groq_rpm, config.groq_tpm)

_MODELS: dict[Tier, str] = {"big": config.model_big, "small": config.model_small, "safeguard": config.model_safeguard}
_cache: dict[tuple[Tier, float], BaseChatModel] = {}


def model(tier: Tier, temperature: float = 0.0) -> BaseChatModel:
    """The LangChain chat model for this tier. Swapping provider later only changes this function."""
    if not config.groq_ready:
        raise ModelUnavailable("GROQ_API_KEY is not set.")
    key = (tier, temperature)
    if key not in _cache:
        from langchain_groq import ChatGroq

        _cache[key] = ChatGroq(model=_MODELS[tier], api_key=config.groq_api_key, temperature=temperature, max_retries=0, timeout=60)
    return _cache[key]


def _estimate(messages: list[BaseMessage]) -> int:
    chars = sum(len(str(m.content)) for m in messages)
    return chars // 4 + 1500  # prompt + room for the answer


async def _usage_today(agent_id: str) -> int:
    day = db.now().astimezone(IST).date()
    row = await db.fetchone("SELECT tokens_in + tokens_out AS t FROM agents.usage WHERE day = %s AND agent_id = %s", day, agent_id)
    return int(row["t"]) if row else 0


async def _record_usage(agent_id: str, tin: int, tout: int) -> None:
    day = db.now().astimezone(IST).date()
    await db.execute(
        "INSERT INTO agents.usage (day, agent_id, requests, tokens_in, tokens_out) VALUES (%s, %s, 1, %s, %s) "
        "ON CONFLICT (day, agent_id) DO UPDATE SET requests = agents.usage.requests + 1, "
        "tokens_in = agents.usage.tokens_in + EXCLUDED.tokens_in, tokens_out = agents.usage.tokens_out + EXCLUDED.tokens_out",
        day, agent_id, tin, tout,
    )


@dataclass
class Call:
    agent_id: str
    tier: Tier = "small"
    priority: int = 5
    tools: list[Any] | None = None
    schema: type | None = None  # a Pydantic model: the answer must have this shape


async def chat(call: Call, messages: list[BaseMessage]) -> Any:
    """One model call for one agent: budget check, rate limit, retries with back-off, usage recorded."""
    budget = (await limits())["tokens"]["perAgentPerDay"]
    if await _usage_today(call.agent_id) >= budget:
        raise BudgetExceeded(f"{call.agent_id} used today's {budget:,} tokens.")
    m: Any = model(call.tier)
    if call.tools:
        m = m.bind_tools(call.tools)
    if call.schema is not None:
        m = m.with_structured_output(call.schema, method="json_schema", include_raw=True)
    est = _estimate(messages)
    delay = 2.0
    last: Exception | None = None
    for _attempt in range(4):
        await limiter.acquire(est, call.priority)
        try:
            out = await m.ainvoke(messages)
        except Exception as e:  # Groq errors, timeouts, 429s
            last = e
            await asyncio.sleep(delay)
            delay *= 2
            continue
        raw = out["raw"] if isinstance(out, dict) and "raw" in out else out
        meta = getattr(raw, "usage_metadata", None) or {}
        tin, tout = int(meta.get("input_tokens", 0)), int(meta.get("output_tokens", 0))
        limiter.correct(est, tin + tout)
        await _record_usage(call.agent_id, tin, tout)
        if isinstance(out, dict) and "parsed" in out:
            if out.get("parsing_error") or out.get("parsed") is None:
                last = ValueError(f"Answer did not have the required shape: {out.get('parsing_error')}")
                continue
            return out["parsed"]
        return out
    raise ModelUnavailable(f"Groq call failed: {last}")
