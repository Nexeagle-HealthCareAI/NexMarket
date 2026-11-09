"""The Guard's graph with a stand-in model: policy flags → one rewrite → checked again; no model → held."""

import asyncio

import pytest

from nexagents import llm
from nexagents.guard import check as g
from nexagents.guard.check import GuardRequest, PolicyAnswer


class Fake:
    def __init__(self, policy_answers, rewrite="Free eye check-up camp at Amour High School."):
        self.policy_answers = list(policy_answers)
        self.rewrite = rewrite
        self.calls = []

    async def __call__(self, call, messages):
        self.calls.append(call.tier)
        if call.tier == "safeguard":
            return self.policy_answers.pop(0)
        return type("Msg", (), {"content": self.rewrite})()


def run(req, fake, monkeypatch):
    monkeypatch.setattr(llm, "chat", fake)
    return asyncio.run(g.check(req, policy_text=None, facts_pack={"text": "Free eye check-up camp at Amour High School."}))


def test_passes_when_rules_and_policy_agree(monkeypatch):
    fake = Fake([PolicyAnswer(violation=False)])
    r = run(GuardRequest(text="Free eye check-up camp at Amour High School.", channel="facebook"), fake, monkeypatch)
    assert r.outcome == "pass" and r.checked_by == ["rules", "policy"]


def test_policy_violation_is_rewritten_once_then_passes(monkeypatch):
    fake = Fake([PolicyAnswer(violation=True, rules=["pressure"], explanation="Pushy."), PolicyAnswer(violation=False)])
    r = run(GuardRequest(text="Come now, everyone must come to the camp.", channel="facebook", allow_rewrite=True), fake, monkeypatch)
    assert r.outcome == "pass" and r.rewritten and fake.calls == ["safeguard", "small", "safeguard"]


def test_still_failing_after_one_rewrite_is_not_sent(monkeypatch):
    fake = Fake([PolicyAnswer(violation=True), PolicyAnswer(violation=True)])
    r = run(GuardRequest(text="Come now to the camp.", channel="facebook", allow_rewrite=True), fake, monkeypatch)
    assert r.outcome == "fix" and r.rewritten


def test_rule_blocks_never_reach_the_model_when_not_fixable(monkeypatch):
    fake = Fake([])
    r = run(GuardRequest(text="Free camp Saturday.", channel="broadcast", opted_in=False), fake, monkeypatch)
    assert r.outcome == "block" and fake.calls == []


def test_no_model_means_held_for_patients(monkeypatch):
    async def down(call, messages):
        raise llm.ModelUnavailable("no key")
    monkeypatch.setattr(llm, "chat", down)
    r = asyncio.run(g.check(GuardRequest(text="Free eye check-up camp at Amour High School.", channel="whatsapp"), policy_text=None,
                            facts_pack={"text": "Free eye check-up camp at Amour High School."}))
    assert r.outcome == "held" and r.note


def test_rate_limiter_serves_urgent_first():
    async def go():
        lim = llm.RateLimiter(rpm=1, tpm=100000)
        await lim.acquire(10)  # uses the only slot this minute
        lim._reqs[0] -= 59.8   # the slot frees in 0.2 s
        order = []

        async def take(name, prio):
            await lim.acquire(10, prio)
            order.append(name)

        low = asyncio.create_task(take("routine", 5))
        await asyncio.sleep(0.01)
        high = asyncio.create_task(take("lead reply", 0))
        await asyncio.wait_for(asyncio.wait([low, high], return_when=asyncio.FIRST_COMPLETED), 3)
        low.cancel(); high.cancel()
        return order

    assert asyncio.run(go()) == ["lead reply"]
