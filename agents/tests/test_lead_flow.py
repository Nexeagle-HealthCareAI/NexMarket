"""
The Lead Responder end to end, against a real Postgres: a fake NexMarket (records what would be sent) and a
scripted stand-in model (records exactly what it was shown). Needs TEST_DATABASE_URL.
"""

import asyncio
import copy
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest

from nexagents import blackboard, db, limits, llm, nexmarket
from nexagents.agents import lead_responder as lr
from nexagents.guard.check import PolicyAnswer
from tests.fixtures import DIRECTORY, FACTS

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")
NOW = datetime.now(timezone.utc)


class FakeNexMarket:
    def __init__(self) -> None:
        self.leads: dict[str, dict[str, Any]] = {}
        self.sent: list[tuple[str, str]] = []
        self.updates: list[dict[str, Any]] = []
        self.reply_error: str | None = None
        self.directory_data = copy.deepcopy(DIRECTORY)

    def lead(self, lid: str, texts: list[str], *, opt_out=False, window=True, paused=False, history=None):
        msgs = list(history or []) + [{"direction": "in", "by": "person", "text": t, "at": NOW.isoformat()} for t in texts]
        self.leads[lid] = {"lead": {"id": lid, "status": "new", "source": "whatsapp", "department": None, "hasOwner": False,
                                    "optOut": opt_out, "windowOpen": window}, "messages": msgs,
                           "whatsapp": {"paused": paused, "inOfficeHours": True}}

    async def lead_context(self, lid):
        return copy.deepcopy(self.leads[lid])

    async def directory(self):
        return copy.deepcopy(self.directory_data)

    async def lead_reply(self, lid, text, *, agent_id):
        if self.reply_error:
            raise nexmarket.NexMarketError(self.reply_error)
        self.sent.append((lid, text))
        self.leads[lid]["messages"].append({"direction": "out", "by": "vita", "text": text})
        return {"status": "sent"}

    async def lead_update(self, lid, *, agent_id, department=None, note=None, alert=None, urgent=False):
        self.updates.append({"lead": lid, "department": department, "note": note, "alert": alert, "urgent": urgent})
        return {}


class FakeModel:
    """Scripted answers. `decisions` are returned in order; the policy check says `policy` (default: fine)."""

    def __init__(self, decisions=None, policy=True, rewrite=None, down=False):
        self.decisions = list(decisions or [])
        self.policy = policy
        self.rewrite = rewrite
        self.down = down
        self.seen: list[str] = []
        self.calls: list[str] = []

    async def __call__(self, call, messages):
        self.calls.append(call.tier if call.schema is None else call.schema.__name__)
        self.seen.append("\n".join(str(m.content) for m in messages))
        if self.down:
            raise llm.ModelUnavailable("Groq down")
        if call.schema is lr.Decision:
            return self.decisions.pop(0)
        if call.schema is PolicyAnswer:
            return PolicyAnswer(violation=not self.policy, explanation="test")
        return type("Msg", (), {"content": self.rewrite or messages[-1].content})()


def D(**kw):
    base = dict(intent="doctor_timing", language="hinglish", department="Eye",
                reply="Dr. Anjali Verma Tuesday aur Friday ko 10 am - 2 pm OPD me baithti hain.", sources=["doctor:doc-eye"])
    base.update(kw)
    return lr.Decision(**base)


def scenario(monkeypatch, fake_nm: FakeNexMarket, model: FakeModel, mode="live", body=None):
    for name in ("lead_context", "directory", "lead_reply", "lead_update"):
        monkeypatch.setattr(nexmarket, name, getattr(fake_nm, name))
    monkeypatch.setattr(llm, "chat", model)

    async def go():
        await db.open_pool(URL)
        try:
            await db.execute("TRUNCATE agents.actions, agents.tasks, agents.agent_state, agents.settings, agents.runs, agents.usage")
            await limits.ensure_agents({"lead_responder": mode, "compliance_guard": "live"})
            await limits.set_setting("facts", FACTS, "test")
            return await body()
        finally:
            await db.close_pool()

    return asyncio.run(go())


async def feed():
    return [(a["kind"], a["status"]) for a in await db.fetch("SELECT kind, status FROM agents.actions WHERE agent_id = 'lead_responder' ORDER BY created_at")]


# ─── Answering ────────────────────────────────────────────────────────────────

def test_answers_from_the_doctor_record(monkeypatch):
    nm, m = FakeNexMarket(), FakeModel([D()])
    nm.lead("L1", ["Aankh ke doctor kab baithte hain?"])

    async def body():
        r = await lr.run("L1")
        assert r["outcome"] == "sent", r
        assert nm.sent and "Tuesday" in nm.sent[0][1]
        assert {"lead": "L1", "department": "Eye", "note": None, "alert": None, "urgent": False} in nm.updates
        assert ("lead_reply", "done") in await feed()
    scenario(monkeypatch, nm, m, body=body)


def test_shadow_mode_never_sends(monkeypatch):
    nm, m = FakeNexMarket(), FakeModel([D()])
    nm.lead("L1", ["Aankh ke doctor kab baithte hain?"])

    async def body():
        r = await lr.run("L1")
        assert r["outcome"] == "shadow" and nm.sent == []
        assert ("lead_reply", "shadow") in await feed()
    scenario(monkeypatch, nm, m, mode="shadow", body=body)


def test_wrong_day_is_stopped_by_the_guard_and_handed_over(monkeypatch):
    bad = D(reply="Dr. Anjali Verma Wednesday ko 10 am baithti hain.")
    nm, m = FakeNexMarket(), FakeModel([bad])  # the rewrite returns the same wrong text
    nm.lead("L1", ["Eye doctor Wednesday ko hain?"])

    async def body():
        r = await lr.run("L1")
        assert r["outcome"] == "handoff" and nm.sent == []
        assert any(u["alert"] for u in nm.updates)
        f = await feed()
        assert ("lead_reply", "blocked") in f and ("handoff_person", "done") in f
    scenario(monkeypatch, nm, m, body=body)


def test_rewrite_that_fixes_the_reply_is_sent(monkeypatch):
    nm = FakeNexMarket()
    m = FakeModel([D(reply="Sabse best eye doctor Dr. Anjali Verma, Tuesday aur Friday 10 am - 2 pm.")],
                  rewrite="Dr. Anjali Verma Tuesday aur Friday 10 am - 2 pm OPD me hain.")
    nm.lead("L1", ["eye doctor?"])

    async def body():
        r = await lr.run("L1")
        assert r["outcome"] == "sent" and "best" not in nm.sent[0][1].lower()
    scenario(monkeypatch, nm, m, body=body)


def test_invented_doctor_is_not_sent(monkeypatch):
    nm, m = FakeNexMarket(), FakeModel([D(reply="Dr. Sharma Neurology Monday 9 am.", department="Neurology", sources=["doctor:doc-neuro"])])
    nm.lead("L1", ["nas ke doctor hain?"])

    async def body():
        r = await lr.run("L1")
        assert r["outcome"] == "handoff" and nm.sent == []
        assert all(u["department"] in (None,) for u in nm.updates)
    scenario(monkeypatch, nm, m, body=body)


def test_the_ai_classing_it_for_a_person_is_handed_over(monkeypatch):
    nm, m = FakeNexMarket(), FakeModel([D(intent="medical_advice", reply="ok")])
    nm.lead("L1", ["bukhar me kya khana chahiye", ])

    async def body():
        r = await lr.run("L1")
        assert r["outcome"] == "handoff" and nm.sent == []
    scenario(monkeypatch, nm, m, body=body)


def test_policy_model_says_no(monkeypatch):
    nm, m = FakeNexMarket(), FakeModel([D()], policy=False)
    nm.lead("L1", ["eye doctor?"])

    async def body():
        r = await lr.run("L1")
        assert r["outcome"] == "handoff" and nm.sent == []
    scenario(monkeypatch, nm, m, body=body)


def test_groq_down_hands_over_and_sends_nothing(monkeypatch):
    nm, m = FakeNexMarket(), FakeModel(down=True)
    nm.lead("L1", ["eye doctor?"])

    async def body():
        r = await lr.run("L1")
        assert r["outcome"] == "handoff" and nm.sent == [] and any(u["alert"] for u in nm.updates)
    scenario(monkeypatch, nm, m, body=body)


# ─── Never answering ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("setup,why", [
    (dict(opt_out=True), "opted_out"), (dict(window=False), "window_closed"), (dict(paused=True), "whatsapp_paused"),
])
def test_skips(monkeypatch, setup, why):
    nm, m = FakeNexMarket(), FakeModel([D()])
    nm.lead("L1", ["eye doctor?"], **setup)

    async def body():
        r = await lr.run("L1")
        assert r["outcome"] == f"skip:{why}" and nm.sent == [] and m.calls == []
    scenario(monkeypatch, nm, m, body=body)


def test_desk_already_answered(monkeypatch):
    nm, m = FakeNexMarket(), FakeModel([D()])
    nm.lead("L1", ["eye doctor?"])
    nm.leads["L1"]["messages"].append({"direction": "out", "by": "desk", "text": "Tuesday aur Friday"})

    async def body():
        r = await lr.run("L1")
        assert r["outcome"] == "skip:already_answered" and m.calls == []
    scenario(monkeypatch, nm, m, body=body)


def test_desk_answers_while_vita_is_sending(monkeypatch):
    nm, m = FakeNexMarket(), FakeModel([D()])
    nm.lead("L1", ["eye doctor?"])
    nm.reply_error = "409: desk_replied"

    async def body():
        r = await lr.run("L1")
        assert nm.sent == [] and ("lead_reply", "failed") in await feed()
    scenario(monkeypatch, nm, m, body=body)


@pytest.mark.parametrize("text", ["operation ka kitna kharcha?", "staff ki shikayat karni hai", "report kab milegi", "🎤 Voice message"])
def test_rule_handoffs_never_reach_the_ai(monkeypatch, text):
    nm, m = FakeNexMarket(), FakeModel([])
    nm.lead("L1", [text])

    async def body():
        r = await lr.run("L1")
        assert r["outcome"] == "handoff" and m.calls == [] and nm.sent == []
        assert nm.updates[-1]["alert"]
    scenario(monkeypatch, nm, m, body=body)


def test_one_reply_per_lead_per_hour(monkeypatch):
    nm, m = FakeNexMarket(), FakeModel([D(), D()])
    nm.lead("L1", ["eye doctor?"])

    async def body():
        assert (await lr.run("L1"))["outcome"] == "sent"
        nm.leads["L1"]["messages"].append({"direction": "in", "by": "person", "text": "aur Saturday?"})
        r = await lr.run("L1")
        assert r["outcome"].startswith("skip") and len(nm.sent) == 1
    scenario(monkeypatch, nm, m, body=body)


def test_stop_all(monkeypatch):
    nm, m = FakeNexMarket(), FakeModel([D()])
    nm.lead("L1", ["eye doctor?"])

    async def body():
        await limits.set_stop_all(True, "test")
        assert await lr.tick() == 0
        r = await lr.run("L1")  # even a direct run sends nothing
        assert nm.sent == [] and r["outcome"] == "skip:stop_all"
        assert m.calls == []  # stopped before any AI call, not just before sending
    scenario(monkeypatch, nm, m, body=body)


# ─── Emergencies ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("text", ["papa behosh ho gaye help", "सीने में दर्द हो रहा है"])
def test_emergency_without_any_ai(monkeypatch, text):
    nm, m = FakeNexMarket(), FakeModel(down=True)  # even with Groq down
    nm.lead("L1", [text])

    async def body():
        r = await lr.run("L1")
        assert r["outcome"] == "emergency_sent", r
        assert "112" in nm.sent[0][1] and "06454 222333" in nm.sent[0][1]
        assert any(u["urgent"] for u in nm.updates)
        assert m.calls == []
    scenario(monkeypatch, nm, m, body=body)


def test_emergency_in_quiet_hours_still_goes(monkeypatch):
    nm, m = FakeNexMarket(), FakeModel([])
    nm.lead("L1", ["accident ho gaya"])

    async def body():
        await limits.set_setting("limits", {"quietHours": {"from": "00:00", "to": "23:59"}}, "test")
        r = await lr.run("L1")
        assert r["outcome"] == "emergency_sent"
    scenario(monkeypatch, nm, m, body=body)


# ─── Privacy ──────────────────────────────────────────────────────────────────

def test_the_model_never_sees_numbers_or_names(monkeypatch):
    nm, m = FakeNexMarket(), FakeModel([D()])
    nm.lead("L1", ["mera naam Sunita Devi hai, number 9876543210, aankh ke doctor kab?"])

    async def body():
        await lr.run("L1")
        everything = "\n".join(m.seen)
        assert "9876543210" not in everything and "Sunita" not in everything
        assert "aankh ke doctor kab" in everything
    scenario(monkeypatch, nm, m, body=body)


# ─── Waiting for the desk, and the queue ──────────────────────────────────────

def test_event_waits_three_minutes_in_office_hours_but_not_for_emergencies(monkeypatch):
    nm, m = FakeNexMarket(), FakeModel([])
    nm.lead("L1", ["eye doctor?"])
    nm.lead("L2", ["papa behosh ho gaye"])
    monkeypatch.setattr(lr, "_in_office", lambda d, now=None: True)
    lr._dir_cache = None

    async def body():
        a = await lr.on_message("L1")
        b = await lr.on_message("L2")
        due_a = datetime.fromisoformat(a["due"]); due_b = datetime.fromisoformat(b["due"])
        assert timedelta(minutes=2, seconds=50) < due_a - db.now() <= timedelta(minutes=3)
        assert due_b <= db.now()
        # Only the emergency is due now.
        got = await blackboard.claim("lead_responder", ["lead.message"], 5)
        assert [g["subject_key"] for g in got] == ["L2"]
    scenario(monkeypatch, nm, m, body=body)


def test_many_messages_one_task_and_an_emergency_brings_it_forward(monkeypatch):
    nm, m = FakeNexMarket(), FakeModel([])
    nm.lead("L1", ["eye doctor?"])
    monkeypatch.setattr(lr, "_in_office", lambda d, now=None: True)
    lr._dir_cache = None

    async def body():
        await lr.on_message("L1")
        await lr.on_message("L1")
        nm.leads["L1"]["messages"].append({"direction": "in", "by": "person", "text": "papa behosh ho gaye"})
        await lr.on_message("L1")
        rows = await db.fetch("SELECT status, not_before FROM agents.tasks WHERE subject_key = 'L1'")
        assert len(rows) == 1 and rows[0]["not_before"] <= db.now()
    scenario(monkeypatch, nm, m, body=body)


def test_switched_off_ignores_events(monkeypatch):
    nm, m = FakeNexMarket(), FakeModel([])
    nm.lead("L1", ["eye doctor?"])

    async def body():
        r = await lr.on_message("L1")
        assert r["accepted"] is False
    scenario(monkeypatch, nm, m, mode="off", body=body)


def test_tick_works_through_the_queue(monkeypatch):
    nm, m = FakeNexMarket(), FakeModel([D(), D(reply="Dr. Imtiyaz Alam Monday, Wednesday, Saturday 11 am - 4 pm.", department="Orthopaedics", sources=["doctor:doc-ortho"])])
    nm.lead("L1", ["eye doctor?"])
    nm.lead("L2", ["haddi ke doctor?"])
    monkeypatch.setattr(lr, "_in_office", lambda d, now=None: False)
    lr._dir_cache = None

    async def body():
        await lr.on_message("L1")
        await lr.on_message("L2")
        assert await lr.tick() == 2
        assert sorted(x[0] for x in nm.sent) == ["L1", "L2"]
        done = await db.fetch("SELECT status FROM agents.tasks")
        assert {r["status"] for r in done} == {"done"}
    scenario(monkeypatch, nm, m, body=body)


def test_repeated_emergency_messages_send_once_but_alert_every_time(monkeypatch):
    nm, m = FakeNexMarket(), FakeModel([])
    nm.lead("L1", ["papa behosh ho gaye"])

    async def body():
        assert (await lr.run("L1"))["outcome"] == "emergency_sent"
        for _ in range(3):
            nm.leads["L1"]["messages"].append({"direction": "in", "by": "person", "text": "jaldi karo behosh hain"})
            r = await lr.run("L1")
            assert r["outcome"] == "emergency_alerted"
        assert len(nm.sent) == 1
        assert sum(1 for u in nm.updates if u["urgent"]) == 4
    scenario(monkeypatch, nm, m, body=body)


def test_desk_is_told_once_per_hour_not_per_message(monkeypatch):
    nm, m = FakeNexMarket(), FakeModel([])
    nm.lead("L1", ["operation ka kitna kharcha?"])

    async def body():
        await lr.run("L1")
        for t in ["batao na kitna", "rate kya hai", "fees?"]:
            nm.leads["L1"]["messages"].append({"direction": "in", "by": "person", "text": t})
            await lr.run("L1")
        assert sum(1 for u in nm.updates if u["alert"]) == 1
    scenario(monkeypatch, nm, m, body=body)
