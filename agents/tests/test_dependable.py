"""
Step 1 and 2 of "automate the whole chain", against a real Postgres: the appointment acknowledgement and call
time, the catch-up sweep, failure alerts, a person checking shadow drafts (and sending them), lessons, the
unusual-volume pause, and the Lead Follow-up agent. Needs TEST_DATABASE_URL.
"""

import asyncio
import os
from datetime import datetime, timedelta, timezone

import pytest

from nexagents import actions, blackboard, db, limits, llm, nexmarket, review
from nexagents.agents import lead_follow_up as fu
from nexagents.agents import lead_responder as lr
from tests.fixtures import FACTS
from tests.test_lead_flow import D, FakeModel, FakeNexMarket, feed

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")
NOW = datetime.now(timezone.utc)
iso = lambda d: d.isoformat()  # noqa: E731


class Nm(FakeNexMarket):
    def __init__(self) -> None:
        super().__init__()
        self.waiting: list[dict] = []
        self.idle: dict = {"templateReady": True, "whatsappPaused": False, "templateText": "नमस्ते {{1}}, {{2}} से संपर्क करने के लिए धन्यवाद।", "items": []}
        self.follow_ups: list[str] = []
        self.notified: list[tuple[str, str]] = []
        self.context_error = False
        self.closed: list[str] = []
        self.close_refuse: set[str] = set()

    async def lead_context(self, lid):
        if self.context_error:
            raise nexmarket.NexMarketError("/context → 500: boom")
        return await super().lead_context(lid)

    async def leads_waiting(self):
        return {"items": self.waiting}

    async def leads_idle(self):
        return self.idle

    async def lead_follow_up(self, lid, *, agent_id):
        self.follow_ups.append(lid)
        return {"status": "sent"}

    async def lead_close_quiet(self, lid, *, agent_id):
        self.closed.append(lid)
        if lid in self.close_refuse:
            raise nexmarket.NexMarketError("/close-quiet → 409: too_soon")
        return {"status": "lost"}

    async def notify_team(self, title, body, link=None, *, agent_id):
        self.notified.append((title, body))
        return {"sent": 1}


def scenario(monkeypatch, nm: Nm, model: FakeModel, body, *, responder="live", follow="live", quiet=False):
    for name in ("lead_context", "directory", "lead_reply", "lead_update", "leads_waiting", "leads_idle", "lead_follow_up", "lead_close_quiet", "notify_team"):
        monkeypatch.setattr(nexmarket, name, getattr(nm, name))
    monkeypatch.setattr(llm, "chat", model)
    monkeypatch.setattr(limits, "in_quiet_hours", lambda q, at=None: quiet)

    async def go():
        from nexagents.agents.base import runtime
        await db.open_pool(URL)
        try:
            await runtime.open()
            await db.execute("TRUNCATE agents.actions, agents.tasks, agents.agent_state, agents.settings, agents.runs, agents.usage")
            await db.execute("DELETE FROM agents.store WHERE prefix LIKE 'lessons%%'")
            await limits.ensure_agents({"lead_responder": responder, "lead_follow_up": follow, "compliance_guard": "live"})
            await limits.set_setting("facts", FACTS, "test")
            return await body()
        finally:
            runtime.store = runtime.checkpointer = None   # they belong to this pool
            await db.close_pool()

    return asyncio.run(go())


async def kinds(agent="lead_responder"):
    return [(a["kind"], a["status"]) for a in await db.fetch("SELECT kind, status FROM agents.actions WHERE agent_id = %s ORDER BY created_at", agent)]


# ─── Appointments: thank, ask when to call, keep the time ────────────────────

def test_appointment_is_acknowledged_and_asks_for_a_call_time(monkeypatch):
    nm, m = Nm(), FakeModel([D(intent="appointment", language="hinglish", reply=None, sources=[])])
    nm.lead("L1", ["Aankh dikhani hai, appointment chahiye"])

    async def body():
        r = await lr.run("L1")
        assert r["outcome"] == "handoff"
        assert len(nm.sent) == 1 and "call karegi" in nm.sent[0][1] and "kaun sa samay" in nm.sent[0][1]
        alert = [u for u in nm.updates if u["alert"]][0]
        assert "appointment" in alert["alert"] and "Eye" in alert["alert"] and "asked what time" in alert["alert"]
    scenario(monkeypatch, nm, m, body)


def test_the_time_they_give_goes_on_the_lead_even_when_the_desk_was_just_told(monkeypatch):
    nm = Nm()
    m = FakeModel([D(intent="appointment", reply=None, sources=[]), D(intent="appointment", reply=None, sources=[], callback_time="kal subah 10 baje")])
    nm.lead("L1", ["appointment chahiye"])

    async def body():
        await lr.run("L1")
        nm.leads["L1"]["messages"].append({"direction": "in", "by": "person", "text": "kal subah 10 baje"})
        r = await lr.run("L1")
        assert r["outcome"] == "handoff"
        assert len(nm.sent) == 1, "the thank-you goes once a day, not for every message"
        notes = [u["note"] for u in nm.updates if u["note"]]
        assert any("kal subah 10 baje" in n for n in notes)
        assert len([u for u in nm.updates if u["alert"]]) == 1, "the desk is alerted once per lead per hour"
    scenario(monkeypatch, nm, m, body)


def test_appointment_in_shadow_sends_and_changes_nothing(monkeypatch):
    nm, m = Nm(), FakeModel([D(intent="appointment", reply=None, sources=[], callback_time="shaam 5 baje")])
    nm.lead("L1", ["appointment chahiye shaam 5 baje"])

    async def body():
        await lr.run("L1")
        assert nm.sent == [] and nm.updates == []
        assert ("lead_ack", "shadow") in await kinds()
    scenario(monkeypatch, nm, m, body, responder="shadow")


def test_ai_cannot_invent_a_call_time_for_other_questions(monkeypatch):
    d = lr.verify(D(callback_time="tomorrow 9 am"), {"departments": [{"id": "dep-Eye", "name": "Eye"}], "doctors": [{"id": "doc-eye"}], "camps": []})
    assert d.callback_time is None


# ─── Catch-up: a message Vita was never told about ───────────────────────────

def test_catch_up_queues_a_missed_lead_once(monkeypatch):
    nm, m = Nm(), FakeModel([D()])
    nm.lead("L1", ["Aankh ke doctor kab baithte hain?"])
    nm.lead("L2", ["hello"])
    nm.waiting = [{"id": "L1", "lastInboundAt": iso(NOW - timedelta(minutes=20))}, {"id": "L2", "lastInboundAt": iso(NOW - timedelta(minutes=2))}]

    async def body():
        assert await lr.catch_up() == 1, "L2 wrote 2 minutes ago: the normal path is still in time"
        assert await lr.catch_up() == 0, "already queued"
        assert await lr.tick() == 1 and nm.sent and nm.sent[0][0] == "L1"
        assert await lr.catch_up() == 0, "answered: not queued again"
        assert ("catch_up", "done") in await kinds()
    scenario(monkeypatch, nm, m, body)


def test_catch_up_leaves_a_lead_vita_already_handed_to_a_person(monkeypatch):
    nm, m = Nm(), FakeModel([])
    nm.lead("L1", ["fees kitni hai?"])
    nm.waiting = [{"id": "L1", "lastInboundAt": iso(NOW - timedelta(minutes=30))}]

    async def body():
        await lr.run("L1")          # price → a person
        assert await lr.catch_up() == 0
    scenario(monkeypatch, nm, m, body)


def test_catch_up_does_nothing_when_off_or_nexmarket_is_down(monkeypatch):
    nm, m = Nm(), FakeModel([])
    nm.waiting = [{"id": "L1", "lastInboundAt": iso(NOW - timedelta(hours=1))}]

    async def body():
        assert await lr.catch_up() == 0
    scenario(monkeypatch, nm, m, body, responder="off")


# ─── A failed run never leaves the lead waiting silently ─────────────────────

def test_failed_run_tells_the_owner_and_the_managers_once(monkeypatch):
    nm, m = Nm(), FakeModel([])
    nm.lead("L1", ["hello"]); nm.lead("L2", ["hello"])
    nm.context_error = True

    async def body():
        await blackboard.post(lr.TASK_KIND, "L1", "x", for_agent=lr.AGENT_ID, created_by="t")
        await blackboard.post(lr.TASK_KIND, "L2", "x", for_agent=lr.AGENT_ID, created_by="t")
        assert await lr.tick() == 2
        alerts = [u for u in nm.updates if u["alert"]]
        assert {u["lead"] for u in alerts} == {"L1", "L2"} and "reply yourself" in alerts[0]["alert"]
        assert len(nm.notified) == 1, "managers hear once in 30 minutes, not per lead"
        assert (await kinds()).count(("lead_failed", "failed")) == 2
    scenario(monkeypatch, nm, m, body)


# ─── A person checks a shadow draft ──────────────────────────────────────────

async def _draft(nm):
    await lr.run("L1")
    row = await db.fetchone("SELECT id FROM agents.actions WHERE kind = 'lead_reply' AND status = 'shadow'")
    return str(row["id"])


def test_good_draft_is_sent_and_counted(monkeypatch):
    nm, m = Nm(), FakeModel([D()])
    nm.lead("L1", ["Aankh ke doctor kab baithte hain?"])

    async def body():
        aid = await _draft(nm)
        assert nm.sent == []
        assert (await actions.waiting_review()) == {"lead_responder": 1}
        r = await review.review(aid, by="Priya", verdict="good", send=True)
        assert r["sent"] and nm.sent[0][0] == "L1" and "Tuesday" in nm.sent[0][1]
        assert review.score((await actions.review_counts())["lead_responder"]) == {"good": 1, "edited": 0, "wrong": 0, "checked": 1, "percent": 100}
        assert (await actions.waiting_review()) == {}
        with pytest.raises(review.ReviewError) as e:
            await review.review(aid, by="Amit", verdict="wrong")
        assert e.value.status == 409 and "Priya" in str(e.value)
    scenario(monkeypatch, nm, m, body, responder="shadow")


def test_edited_draft_sends_the_persons_text_and_keeps_the_lesson(monkeypatch):
    nm, m = Nm(), FakeModel([D(), D()])
    nm.lead("L1", ["Aankh ke doctor kab baithte hain?"])

    async def body():
        from nexagents.agents.base import runtime
        aid = await _draft(nm)
        better = "Dr. Anjali Verma Tuesday aur Friday ko 10 am - 2 pm milti hain. Aap aa sakte hain."
        r = await review.review(aid, by="Priya", verdict="edited", text=better, send=True, remember=True, note="End with an invitation to come, not just the timing.")
        assert r["sent"] and nm.sent == [("L1", better)] and r["lesson"]
        assert review.score((await actions.review_counts())["lead_responder"])["percent"] == 0
        assert [x["text"] for x in await runtime.lessons("lead_responder")] == ["End with an invitation to come, not just the timing."]
        # The next run is shown the lesson.
        nm.lead("L2", ["Eye doctor timing?"])
        await lr.run("L2")
        assert any("End with an invitation to come" in x and "You are Vita" in x for x in m.seen)
        key = (await runtime.lessons("lead_responder"))[0]["key"]
        assert await runtime.drop_lesson("lead_responder", key, "Priya") and await runtime.lessons("lead_responder") == []
    scenario(monkeypatch, nm, m, body, responder="shadow")


def test_edit_with_a_wrong_day_or_a_personal_number_is_stopped(monkeypatch):
    nm, m = Nm(), FakeModel([D()])
    nm.lead("L1", ["Aankh ke doctor kab baithte hain?"])

    async def body():
        aid = await _draft(nm)
        for bad in ["Dr. Anjali Verma Sunday ko 10 am - 2 pm milti hain.", "Mujhe 9876543210 par call karein."]:
            with pytest.raises(review.ReviewError) as e:
                await review.review(aid, by="Priya", verdict="edited", text=bad, send=True)
            assert e.value.status == 422 and e.value.issues
        assert nm.sent == []
        assert (await actions.waiting_review()) == {"lead_responder": 1}, "a stopped edit leaves the draft open to fix"
    scenario(monkeypatch, nm, m, body, responder="shadow")


def test_wrong_draft_is_not_sent(monkeypatch):
    nm, m = Nm(), FakeModel([D()])
    nm.lead("L1", ["Aankh ke doctor kab baithte hain?"])

    async def body():
        aid = await _draft(nm)
        r = await review.review(aid, by="Priya", verdict="wrong", note="They asked about a child, not eyes")
        assert not r["sent"] and nm.sent == []
        assert review.score((await actions.review_counts())["lead_responder"])["wrong"] == 1
    scenario(monkeypatch, nm, m, body, responder="shadow")


def test_send_refused_by_nexmarket_is_explained(monkeypatch):
    nm, m = Nm(), FakeModel([D()])
    nm.lead("L1", ["Aankh ke doctor kab baithte hain?"])

    async def body():
        aid = await _draft(nm)
        nm.reply_error = "/reply → 409: {\"message\":\"desk_replied\"}"
        r = await review.review(aid, by="Priya", verdict="good", send=True)
        assert not r["sent"] and "already replied" in r["reason"]
    scenario(monkeypatch, nm, m, body, responder="shadow")


def test_nothing_is_sent_from_a_review_during_stop_all(monkeypatch):
    nm, m = Nm(), FakeModel([D()])
    nm.lead("L1", ["Aankh ke doctor kab baithte hain?"])

    async def body():
        aid = await _draft(nm)
        await limits.set_stop_all(True, "admin")
        with pytest.raises(review.ReviewError):
            await review.review(aid, by="Priya", verdict="good", send=True)
        assert nm.sent == []
    scenario(monkeypatch, nm, m, body, responder="shadow")


# ─── Unusual volume ───────────────────────────────────────────────────────────

def test_volume_far_above_usual_pauses_the_agent(monkeypatch):
    nm, m = Nm(), FakeModel([])

    async def body():
        from nexagents import app
        for day in range(1, 8):          # 5 a day for the last week
            for _ in range(5):
                aid = await actions.record("lead_follow_up", "lead_follow_up", "done", "x", channel="whatsapp")
                await db.execute("UPDATE agents.actions SET created_at = now() - make_interval(days => %s) WHERE id = %s", day, aid)
        for _ in range(29):
            await actions.record("lead_follow_up", "lead_follow_up", "done", "x", channel="whatsapp")
        await app.watch_anomalies()
        assert not (await limits.agent_state("lead_follow_up")).get("paused"), "29 today is under the floor of 30"
        await actions.record("lead_follow_up", "lead_follow_up", "done", "x", channel="whatsapp")
        await app.watch_anomalies()
        st = await limits.agent_state("lead_follow_up")
        assert st.get("paused") and "30 messages today" in st["paused_reason"] and nm.notified
    scenario(monkeypatch, nm, m, body)


# ─── Lead Follow-up: the rules ────────────────────────────────────────────────

def L(**kw):
    base = {"id": "L1", "status": "contacted", "source": "whatsapp", "optOut": False, "contacted": True, "followUps": 0,
            "lastTouchAt": iso(NOW - timedelta(days=2)), "lastFollowUpAt": None, "createdAt": iso(NOW - timedelta(days=5))}
    base.update(kw)
    return base


@pytest.mark.parametrize("lead, want", [
    (L(), "send"),
    (L(lastTouchAt=iso(NOW - timedelta(hours=20))), None),
    (L(optOut=True), None),
    (L(status="appointment"), None), (L(status="lost"), None),
    (L(source="desk"), "send"), (L(source="walk_in"), "send"), (L(source="agent"), "send"),
    (L(source="desk", status="new", contacted=False, lastTouchAt=iso(NOW - timedelta(minutes=45))), None),
    (L(source="web", status="new", contacted=False, lastTouchAt=iso(NOW - timedelta(minutes=45))), "send"),
    (L(source="web", status="new", contacted=False, lastTouchAt=iso(NOW - timedelta(minutes=10))), None),
    (L(source="web", status="new", contacted=True, lastTouchAt=iso(NOW - timedelta(minutes=45))), None),
    (L(source="whatsapp", status="new", contacted=False, lastTouchAt=iso(NOW - timedelta(minutes=45))), None),
    (L(followUps=1, lastFollowUpAt=iso(NOW - timedelta(days=1))), None),
    (L(followUps=1, lastFollowUpAt=iso(NOW - timedelta(days=2, hours=1))), "send"),
    (L(followUps=2, lastFollowUpAt=iso(NOW - timedelta(days=3))), None),
    (L(followUps=2, lastFollowUpAt=iso(NOW - timedelta(days=4, hours=1))), "send"),
    (L(followUps=3, lastFollowUpAt=iso(NOW - timedelta(days=2))), None),
    (L(followUps=3, lastFollowUpAt=iso(NOW - timedelta(days=3, hours=1))), "hand_over"),
    (L(followUps=3, lastFollowUpAt=iso(NOW - timedelta(days=9, hours=23))), "hand_over"),
    (L(followUps=3, lastFollowUpAt=iso(NOW - timedelta(days=10, hours=1))), "close"),
    (L(followUps=7, lastFollowUpAt=iso(NOW - timedelta(days=30))), "close"),
])
def test_plan(lead, want):
    assert fu.plan(lead, NOW) == want


def test_plan_never_closes_when_the_limit_is_zero():
    assert fu.plan(L(followUps=3, lastFollowUpAt=iso(NOW - timedelta(days=60))), NOW, close_days=0) == "hand_over"


def test_quiet_lead_is_closed_once_live_and_only_recorded_in_shadow(monkeypatch):
    nm, m = Nm(), FakeModel([])
    nm.idle["items"] = [L(id="A", followUps=3, lastFollowUpAt=iso(NOW - timedelta(days=11))), L(id="B", followUps=3, lastFollowUpAt=iso(NOW - timedelta(days=11)))]
    nm.close_refuse = {"B"}

    async def live():
        assert (await fu.tick())["closed"] == 1 and nm.closed == ["A", "B"][:2]
        assert (await fu.tick())["closed"] == 0 and len(nm.closed) == 2, "neither is tried again"
        assert await kinds("lead_follow_up") == [("lead_close", "done"), ("lead_close", "skipped")]
    scenario(monkeypatch, nm, m, live)

    nm2 = Nm(); nm2.idle["items"] = [L(id="A", followUps=3, lastFollowUpAt=iso(NOW - timedelta(days=11)))]

    async def shadow():
        assert (await fu.tick())["closed"] == 1 and nm2.closed == []
        await fu.tick()
        assert await kinds("lead_follow_up") == [("lead_close", "shadow")]
    scenario(monkeypatch, nm2, m, shadow, follow="shadow")


def test_follow_up_live_sends_once_and_hands_over_once(monkeypatch):
    nm, m = Nm(), FakeModel([])
    nm.idle["items"] = [L(id="A"), L(id="B", lastTouchAt=iso(NOW - timedelta(hours=3))), L(id="C", followUps=3, lastFollowUpAt=iso(NOW - timedelta(days=4))),
                        L(id="D", optOut=True), L(id="E", source="desk", lastTouchAt=iso(NOW - timedelta(hours=5)))]

    async def body():
        assert await fu.tick() == {"sent": 1, "shadow": 0, "handed": 1, "closed": 0, "stopped": 0}
        assert nm.follow_ups == ["A"]
        assert [u["lead"] for u in nm.updates if u["alert"]] == ["C"] and "call them once" in nm.updates[0]["alert"]
        assert await fu.tick() == {"sent": 0, "shadow": 0, "handed": 0, "closed": 0, "stopped": 0}, "the next hourly run repeats nothing"
        assert nm.follow_ups == ["A"] and m.calls == [], "no AI is used"
        assert await kinds("lead_follow_up") == [("lead_follow_up", "done"), ("follow_up_handover", "done")]
    scenario(monkeypatch, nm, m, body)


def test_follow_up_shadow_records_once_and_sends_nothing(monkeypatch):
    nm, m = Nm(), FakeModel([])
    nm.idle["items"] = [L(id="A"), L(id="C", followUps=3, lastFollowUpAt=iso(NOW - timedelta(days=4)))]

    async def body():
        assert await fu.tick() == {"sent": 0, "shadow": 1, "handed": 1, "closed": 0, "stopped": 0}
        await fu.tick()
        assert nm.follow_ups == [] and nm.updates == []
        assert await kinds("lead_follow_up") == [("lead_follow_up", "shadow"), ("follow_up_handover", "shadow")]
    scenario(monkeypatch, nm, m, body, follow="shadow")


def test_follow_up_respects_quiet_hours_daily_cap_and_off(monkeypatch):
    nm, m = Nm(), FakeModel([])
    nm.idle["items"] = [L(id=f"L{i}") for i in range(5)]

    async def quiet():
        assert (await fu.tick())["sent"] == 0 and nm.follow_ups == []
    scenario(monkeypatch, nm, m, quiet, quiet=True)

    async def capped():
        await limits.set_setting("limits", {"lead": {"followUpsPerDay": 2}}, "test")
        r = await fu.tick()
        assert r["sent"] == 2 and len(nm.follow_ups) == 2
    scenario(monkeypatch, nm, m, capped)

    nm2 = Nm(); nm2.idle["items"] = [L(id="A")]

    async def off():
        assert await fu.tick() == {"sent": 0, "shadow": 0, "handed": 0, "closed": 0, "stopped": 0} and nm2.follow_ups == []
    scenario(monkeypatch, nm2, m, off, follow="off")


def test_follow_up_waits_when_no_template_is_chosen_and_says_so_once(monkeypatch):
    nm, m = Nm(), FakeModel([])
    nm.idle["templateReady"] = False
    nm.idle["items"] = [L(id="A"), L(id="B")]

    async def body():
        assert (await fu.tick())["stopped"] == 2 and nm.follow_ups == []
        await fu.tick()
        assert await kinds("lead_follow_up") == [("follow_up_blocked", "skipped")]
    scenario(monkeypatch, nm, m, body)


def test_follow_up_template_with_a_banned_claim_is_stopped_by_the_guard(monkeypatch):
    nm, m = Nm(), FakeModel([])
    nm.idle["templateText"] = "Hamare yahan 100% guaranteed cure milta hai, aaj hi aayein."
    nm.idle["items"] = [L(id="A")]

    async def body():
        assert (await fu.tick())["sent"] == 0 and nm.follow_ups == []
        assert ("lead_follow_up", "blocked") in await kinds("lead_follow_up")
    scenario(monkeypatch, nm, m, body)
