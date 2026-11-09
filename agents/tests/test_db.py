"""Database parts: the gate, Stop all, the blackboard and shadow sends. Needs TEST_DATABASE_URL (skipped otherwise)."""

import asyncio
import os

import pytest

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")


def test_everything_in_one_loop(monkeypatch):
    from nexagents import act, actions, blackboard, db, limits, llm
    from nexagents.guard.check import PolicyAnswer

    async def fake_chat(call, messages):
        if call.tier == "safeguard":
            return PolicyAnswer(violation=False)
        # The rewrite step: a model that keeps the banned word, so the second check must stop it again.
        return type("Msg", (), {"content": "We have the best doctors, come today."})()

    monkeypatch.setattr(llm, "chat", fake_chat)

    async def go():
        await db.open_pool(URL)
        await db.execute("TRUNCATE agents.actions, agents.tasks, agents.agent_state, agents.settings")
        await limits.ensure_agents({"lead_responder": "shadow", "reputation": "off"})
        await limits.set_setting("facts", {"text": "Free eye camp Saturday 14 Nov at Amour High School, 10 am."}, "test")
        noon = __import__("datetime").datetime(2026, 11, 9, 6, 30, tzinfo=__import__("datetime").timezone.utc)  # 12:00 IST

        # Switched off: nothing.
        v = await limits.gate("reputation", outgoing=True, at=noon)
        assert not v.allowed and v.rules == ["off"]
        # Shadow: allowed, but only recorded.
        v = await limits.gate("lead_responder", outgoing=True, at=noon)
        assert v.allowed and v.shadow
        # Quiet hours, unless replying to someone who wrote first.
        late = noon.replace(hour=17)  # 22:30 IST
        assert not (await limits.gate("lead_responder", outgoing=True, at=late)).allowed
        assert (await limits.gate("lead_responder", outgoing=True, inbound_reply=True, at=late)).allowed
        # Caps.
        assert not (await limits.gate("lead_responder", outgoing=True, cap=(20, 20), at=noon)).allowed

        sent = []

        async def send(text):
            sent.append(text)
            return {"id": "wa-1"}

        r = await act.outgoing("lead_responder", kind="whatsapp_reply", channel="whatsapp", text="Free eye camp Saturday 14 Nov at Amour High School, 10 am.",
                               summary="Camp details to a lead", send=send, inbound_reply=True, subject=("lead", "1"))
        assert r.get("shadow") and sent == []  # shadow mode never sends
        await limits.set_mode("lead_responder", "live", "test")
        r = await act.outgoing("lead_responder", kind="whatsapp_reply", channel="whatsapp", text="Free eye camp Saturday 14 Nov at Amour High School, 10 am.",
                               summary="Camp details to a lead", send=send, inbound_reply=True)
        assert r["sent"] and len(sent) == 1
        r = await act.outgoing("lead_responder", kind="whatsapp_reply", channel="whatsapp", text="We have the best doctors.",
                               summary="Bad message", send=send, inbound_reply=True)
        assert not r["sent"] and len(sent) == 1  # the Guard stopped it

        # Stop all stops everything.
        await limits.set_stop_all(True, "test")
        r = await act.outgoing("lead_responder", kind="whatsapp_reply", channel="whatsapp", text="Hello", summary="x", send=send, inbound_reply=True)
        assert not r["sent"] and len(sent) == 1
        await limits.set_stop_all(False, "test")

        # Blackboard: one open task per subject; claims are exclusive and expire.
        t1 = await blackboard.post("lead.new", "lead-9", "reply", for_agent="lead_responder", created_by="test")
        assert t1 and await blackboard.post("lead.new", "lead-9", "reply", for_agent="lead_responder", created_by="test") is None
        a, b = await asyncio.gather(blackboard.claim("lead_responder"), blackboard.claim("lead_responder"))
        assert len(a) + len(b) == 1
        await db.execute("UPDATE agents.tasks SET claim_expires = now() - interval '1 minute'")
        assert await blackboard.release_expired() == 1
        got = await blackboard.claim("lead_responder")
        assert await blackboard.finish(got[0]["id"], "lead_responder", {"ok": True})

        kinds = [x["status"] for x in await actions.feed("lead_responder")]
        assert "shadow" in kinds and "done" in kinds and "blocked" in kinds and "skipped" in kinds
        await db.close_pool()

    asyncio.run(go())
