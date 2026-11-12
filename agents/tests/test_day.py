"""
Step 3: the day runs itself. Data Watcher (rules), Chief of Staff (plan and check), Reporter & Coach (report and
suggested lessons), against a real Postgres with a scripted model. Needs TEST_DATABASE_URL (the rule tables don't).
"""

import asyncio
import os
from datetime import timedelta

import pytest

from nexagents import actions, blackboard, db, limits, llm, nexmarket
from nexagents.agents import chief_of_staff as cos
from nexagents.agents import data_watcher as dw
from nexagents.agents import reporter_coach as rc

URL = os.environ.get("TEST_DATABASE_URL")
needs_db = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")


def N(**over):
    """A quiet day: nothing should be signalled."""
    n = {
        "istHour": 14, "weekday": "Wednesday",
        "leads": {"today": 9, "usualByNow": 8.0, "yesterday": 12, "last7": 70, "bySource": [{"source": "whatsapp", "today": 6, "usualByNow": 5.0}, {"source": "web", "today": 3, "usualByNow": 3.0}],
                  "waitingNoReply": 0, "oldestWaitingMinutes": 0, "openIdle3Days": 2, "arrivedThisWeek": 9, "arrivedPrevWeek": 10, "lostThisWeek": 3, "lostPrevWeek": 4},
        "whatsapp": {"configured": True, "paused": False, "sentToday": 40, "failedToday": 1, "inboundToday": 25, "inboundUsualByNow": 22.0},
        "referrals": {"today": 4, "usualByNow": 3.0, "thisWeek": 20, "prevWeek": 22},
        "field": {"visitsToday": 30, "agentsOnShiftToday": 6, "agentsOnShiftUsual": 6.0, "tasksOverdue": 1},
        "reviews": {"newThisWeek": 2, "unanswered": 1, "lowUnanswered": 0},
        "hoardings": {"waiting": 0, "endingSoon": 0, "rentMissing": 0},
        "analyst": {"openItems": []},
    }
    for path, v in over.items():
        a, b = path.split("__")
        n[a] = {**n[a], b: v}
    return n


def keys(n, agents=None):
    return [s.key for s in dw.signals(n, agents)]


# ─── The rules ────────────────────────────────────────────────────────────────

def test_a_quiet_day_raises_nothing():
    assert keys(N()) == []


@pytest.mark.parametrize("over, want", [
    ({"leads__waitingNoReply": 3, "leads__oldestWaitingMinutes": 50}, "leads_waiting"),
    ({"leads__waitingNoReply": 1, "leads__oldestWaitingMinutes": 130}, "leads_waiting"),
    ({"leads__today": 3}, "leads_down"),
    ({"leads__today": 20}, "leads_up"),
    ({"leads__bySource": [{"source": "web", "today": 0, "usualByNow": 3.0}]}, "source_silent:web"),
    ({"whatsapp__paused": True}, "whatsapp_paused"),
    ({"whatsapp__failedToday": 12}, "whatsapp_failing"),
    ({"whatsapp__inboundToday": 0}, "whatsapp_silent"),
    ({"referrals__thisWeek": 10}, "referrals_down"),
    ({"leads__arrivedThisWeek": 4}, "arrivals_down"),
    ({"leads__lostThisWeek": 9}, "leads_lost_up"),
    ({"field__agentsOnShiftToday": 2}, "field_thin"),
    ({"field__tasksOverdue": 7}, "tasks_overdue"),
    ({"reviews__lowUnanswered": 1}, "reviews_low"),
    ({"reviews__unanswered": 6}, "reviews_unanswered"),
    ({"hoardings__endingSoon": 2}, "hoardings_ending"),
    ({"hoardings__waiting": 4}, "hoardings_waiting"),
    ({"leads__openIdle3Days": 14}, "leads_idle"),
])
def test_each_rule(over, want):
    assert keys(N(**over)) == [want]


@pytest.mark.parametrize("over", [
    {"leads__waitingNoReply": 1, "leads__oldestWaitingMinutes": 40},          # one lead, 40 minutes: the desk's own reminder covers it
    {"leads__today": 5},                                                       # a bit low is not a signal
    {"whatsapp__failedToday": 4},
    {"whatsapp__configured": False, "whatsapp__inboundToday": 0},              # WhatsApp isn't set up: silence is expected
    {"referrals__thisWeek": 15},
    {"field__agentsOnShiftToday": 4},
])
def test_small_wobbles_are_not_signals(over):
    assert keys(N(**over)) == []


def test_mornings_and_sundays_are_judged_fairly():
    early = N(leads__today=1, whatsapp__inboundToday=0, field__agentsOnShiftToday=0)
    early["istHour"] = 9
    assert keys(early) == [], "at 9 am it is too early to call the day slow"
    sunday = N(field__agentsOnShiftToday=0)
    sunday["weekday"] = "Sunday"
    assert keys(sunday) == []


def test_serious_first_and_agents_own_state():
    agents = {"lead_responder": {"name": "Lead Responder", "mode": "live", "paused": True, "pausedReason": "5 messages blocked", "failed": 0, "waiting": 12},
              "lead_follow_up": {"name": "Lead Follow-up", "mode": "live", "paused": False, "failed": 4, "waiting": 0}}
    got = dw.signals(N(hoardings__endingSoon=1, leads__waitingNoReply=5, leads__openIdle3Days=30), agents)
    assert [s.severity for s in got] == sorted([s.severity for s in got], key=["high", "medium", "low"].index)
    ks = [s.key for s in got]
    assert ks[0] == "leads_waiting" and "agent_paused:lead_responder" in ks and "agent_failing:lead_follow_up" in ks and "drafts_waiting" in ks
    assert "leads_idle" not in ks, "Lead Follow-up is live, so idle leads are already being handled"


def test_signal_sentences_carry_their_numbers():
    s = dw.signals(N(leads__waitingNoReply=4, leads__oldestWaitingMinutes=200))[0]
    assert s.title == "4 new leads have had no reply; the oldest has waited 3 hours." and s.who == "desk"


# ─── Plan and report checks (no database) ────────────────────────────────────

KNOWN = {"leads_waiting": {"key": "leads_waiting", "severity": "high", "title": "4 new leads have had no reply; the oldest has waited 3 hours.", "todo": "Reply to them from the Leads inbox now.", "who": "desk"},
         "hoardings_ending": {"key": "hoardings_ending", "severity": "low", "title": "2 hoarding rentals end within 14 days.", "todo": "Renew or end them on the Hoardings page.", "who": "marketing"}}


def test_plan_keeps_only_real_signals_with_their_own_numbers():
    plan = cos.Plan(headline="Busy day.", priorities=[
        cos.Priority(signal="hoardings_ending", title="Renew the hoardings", why="2 rentals end within 14 days.", first_step="Open the Hoardings page."),
        cos.Priority(signal="made_up", title="Launch a campaign", why="Leads are down 40%.", first_step="Spend more."),
        cos.Priority(signal="leads_waiting", title="Answer the waiting leads", why="17 leads are waiting.", first_step="Call all 17."),
        cos.Priority(signal="leads_waiting", title="Again", why="x", first_step="y"),
    ])
    got = cos.verify(plan, KNOWN)
    assert [p.signal for p in got.priorities] == ["leads_waiting", "hoardings_ending"], "invented and repeated ones go; serious first"
    assert got.priorities[0].why == KNOWN["leads_waiting"]["title"] and "17" not in cos.write_up(got, KNOWN)
    assert got.priorities[1].why == "2 rentals end within 14 days."


def test_report_drops_lines_with_numbers_it_was_not_given():
    given = {"totals": {"leads": {"today": 9, "yesterday": 12}}, "agents": {}, "signals": []}
    r = rc.verify(rc.Report(headline="A steady day with 9 new leads.", went_well=["9 new leads came in, against 12 yesterday.", "Conversion rose to 34%."],
                            problems=["3 reviews wait."], tomorrow=["Call the 5 partners who went quiet."]), given)
    assert r.went_well == ["9 new leads came in, against 12 yesterday."] and r.problems == []
    assert r.headline.startswith("A steady day") and r.tomorrow, "actions for tomorrow are kept as written"
    assert rc.verify(rc.Report(headline="Leads doubled to 400."), given).headline == "Here is today in numbers."


# ─── With the database ────────────────────────────────────────────────────────

class Nm:
    def __init__(self, n=None) -> None:
        self.n = n or N()
        self.notified: list[tuple[str, str]] = []
        self.cards: list[dict] = []
        self.waiting: list[dict] = []
        self.down = False

    async def numbers(self):
        if self.down:
            raise nexmarket.NexMarketError("down")
        return self.n

    async def lead_outcomes(self, days=7):
        return {"days": days, "answeredByVita": {"leads": 11, "wroteBack": 6, "came": 2}, "answeredByDesk": {"leads": 20, "wroteBack": 9, "came": 5}}

    async def notify_team(self, title, body, link=None, *, agent_id):
        self.notified.append((title, body))
        return {"sent": 1}

    async def board_card(self, title, description, *, agent_id, priority="normal", labels=None, due_date=None):
        self.cards.append({"title": title, "description": description, "priority": priority})
        return {"id": "c"}

    async def leads_waiting(self):
        return {"items": self.waiting}


class Model:
    def __init__(self, answers=None, down=False):
        self.answers, self.down, self.seen = list(answers or []), down, []

    async def __call__(self, call, messages):
        self.seen.append("\n".join(str(m.content) for m in messages))
        if self.down:
            raise llm.ModelUnavailable("Groq down")
        return self.answers.pop(0)


def scenario(monkeypatch, nm: Nm, model: Model, body, modes=None):
    for name in ("numbers", "lead_outcomes", "notify_team", "board_card", "leads_waiting"):
        monkeypatch.setattr(nexmarket, name, getattr(nm, name))
    monkeypatch.setattr(llm, "chat", model)

    async def go():
        from nexagents.agents.base import runtime
        await db.open_pool(URL)
        try:
            await runtime.open()
            await db.execute("TRUNCATE agents.actions, agents.tasks, agents.agent_state, agents.settings, agents.runs, agents.usage")
            await db.execute("DELETE FROM agents.store WHERE prefix LIKE 'lessons%%'")
            await limits.ensure_agents({"data_watcher": "live", "chief_of_staff": "live", "reporter_coach": "live", "lead_responder": "live", "lead_follow_up": "off",
                                        "compliance_guard": "live", **(modes or {})})
            return await body()
        finally:
            runtime.store = runtime.checkpointer = None
            await db.close_pool()

    return asyncio.run(go())


async def kinds(agent):
    return [(a["kind"], a["status"]) for a in await db.fetch("SELECT kind, status FROM agents.actions WHERE agent_id = %s ORDER BY created_at", agent)]


BAD_DAY = dict(leads__waitingNoReply=4, leads__oldestWaitingMinutes=200, reviews__lowUnanswered=1, hoardings__endingSoon=2)


@needs_db
def test_watcher_raises_each_signal_once_a_day_and_alerts_only_the_serious_one(monkeypatch):
    nm = Nm(N(**BAD_DAY))

    async def body():
        assert await dw.tick() == {"signals": 3, "new": 3, "alerted": 1}
        assert nm.notified == [("4 new leads have had no reply; the oldest has waited 3 hours.", "Reply to them from the Leads inbox now.")]
        assert await dw.tick() == {"signals": 3, "new": 0, "alerted": 0}, "the next hour repeats nothing"
        assert [s["key"] for s in await dw.todays_signals()] == ["leads_waiting", "reviews_low", "hoardings_ending"]
        # Tomorrow the same problem is raised afresh, even though nobody planned yesterday's.
        await db.execute("UPDATE agents.tasks SET created_at = created_at - interval '1 day'")
        assert (await dw.tick())["new"] == 3
        nm.down = True
        assert await dw.tick() == {"signals": 0, "new": 0, "alerted": 0}
    scenario(monkeypatch, nm, Model(), body)


@needs_db
def test_watcher_in_shadow_records_but_alerts_nobody_and_off_does_nothing(monkeypatch):
    nm = Nm(N(**BAD_DAY))

    async def shadow():
        assert (await dw.tick())["alerted"] == 0 and nm.notified == []
        assert ("signal", "shadow") in await kinds("data_watcher")
    scenario(monkeypatch, nm, Model(), shadow, {"data_watcher": "shadow"})

    async def off():
        assert await dw.tick() == {"signals": 0, "new": 0, "alerted": 0}
    scenario(monkeypatch, nm, Model(), off, {"data_watcher": "off"})


def _plan():
    return cos.Plan(headline="Leads are waiting; deal with those first.", priorities=[
        cos.Priority(signal="reviews_low", title="Reply to the low Google review", why="1 review of 3 stars or less has no reply.", first_step="Open the Google page."),
        cos.Priority(signal="leads_waiting", title="Answer the waiting leads", why="4 new leads have had no reply.", first_step="Open the Leads inbox."),
        cos.Priority(signal="hoardings_ending", title="Decide on the hoardings", why="2 rentals end within 14 days.", first_step="Open the Hoardings page."),
        cos.Priority(signal="ghost", title="Invented", why="99 things.", first_step="x"),
    ])


@needs_db
def test_chief_plans_cards_hands_over_and_tells_the_managers(monkeypatch):
    nm, m = Nm(N(**BAD_DAY)), Model([_plan()])

    async def body():
        await dw.tick(); nm.notified.clear()
        r = await cos.plan_day()
        assert r == {"priorities": 3, "cards": 2, "handed": 1, "sent": True}
        assert [c["title"] for c in nm.cards] == ["Answer the waiting leads", "Reply to the low Google review"], "serious first; the low one gets no card"
        assert nm.cards[0]["priority"] == "high" and "the desk" in nm.cards[0]["description"]
        title, text = nm.notified[0]
        assert title == "Vita's plan for today" and text.splitlines()[1].startswith("1. Answer the waiting leads (the desk).") and "99" not in text and "Invented" not in text
        assert await db.fetch("SELECT 1 FROM agents.tasks WHERE kind = 'signal' AND status = 'open'") == [], "the signals are planned"
        assert ("handoff", "done") in await kinds("chief_of_staff") and ("day_plan", "done") in await kinds("chief_of_staff")
        assert '"alreadyHasACard": []' in m.seen[0] and "leads_waiting" in m.seen[0]
        # Tomorrow: the same problems get no second card.
        await db.execute("UPDATE agents.tasks SET created_at = created_at - interval '1 day'")
        await dw.tick(); m.answers.append(_plan())
        assert (await cos.plan_day())["cards"] == 0 and len(nm.cards) == 2
    scenario(monkeypatch, nm, m, body)


@needs_db
def test_chief_without_ai_uses_the_signals_and_in_shadow_touches_nothing(monkeypatch):
    nm = Nm(N(**BAD_DAY))

    async def no_ai():
        await dw.tick(); nm.notified.clear()
        r = await cos.plan_day()
        assert r["priorities"] == 3 and r["sent"] and nm.notified[0][1].startswith("1 urgent thing today.")
    scenario(monkeypatch, nm, Model(down=True), no_ai)

    nm2 = Nm(N(**BAD_DAY))

    async def shadow():
        await dw.tick(); nm2.notified.clear()
        r = await cos.plan_day()
        assert r["priorities"] == 3 and not r["sent"] and nm2.cards == [] and nm2.notified == []
        got = await kinds("chief_of_staff")
        assert ("day_plan", "shadow") in got and ("board_card", "shadow") in got
        assert (await actions.waiting_review()).get("chief_of_staff") == 1, "the plan can be checked in Activity"
    scenario(monkeypatch, nm2, Model([_plan()]), shadow, {"chief_of_staff": "shadow"})


@needs_db
def test_chief_on_a_quiet_day_sends_nothing_and_uses_no_ai(monkeypatch):
    nm, m = Nm(), Model()

    async def body():
        await dw.tick()
        r = await cos.plan_day()
        assert r["priorities"] == 0 and nm.cards == [] and m.seen == []
        assert r["sent"] == (db.now().astimezone(limits.IST).weekday() == 0), "a quiet day is only announced on Mondays"
    scenario(monkeypatch, nm, m, body)


@needs_db
def test_afternoon_check_is_silent_unless_something_is_new(monkeypatch):
    nm = Nm()

    async def body():
        assert await cos.check_day() == {"told": False, "open": 0} and nm.notified == []
        nm.n = N(whatsapp__inboundToday=0, hoardings__endingSoon=1)
        await dw.tick(); nm.notified.clear()
        r = await cos.check_day()
        assert r == {"told": True, "open": 1}, "the low one is not worth an afternoon message"
        assert nm.notified[0][0] == "Vita's afternoon check" and "No WhatsApp message has arrived today" in nm.notified[0][1]
        assert await cos.check_day() == {"told": False, "open": 0}
    scenario(monkeypatch, nm, Model(), body)


@needs_db
def test_evening_report_with_ai_without_ai_and_in_shadow(monkeypatch):
    nm = Nm(N(**BAD_DAY))
    good = rc.Report(headline="A normal day, with 4 leads still unanswered.", went_well=["9 new leads came in.", "Sales rose 80%."],
                     problems=["4 new leads have had no reply."], tomorrow=["Reply to the waiting leads first thing."])

    async def with_ai():
        await dw.tick(); nm.notified.clear()
        r = await rc.report()
        assert r == {"sent": True, "ai": True}
        text = nm.notified[0][1]
        assert "9 new leads came in." in text and "80%" not in text and "Tomorrow:" in text
    m = Model([good])
    scenario(monkeypatch, nm, m, with_ai)
    assert "outcomesLast7Days" in m.seen[0] and "wroteBack" in m.seen[0]

    nm2 = Nm(N(**BAD_DAY))

    async def no_ai():
        await dw.tick(); nm2.notified.clear()
        r = await rc.report()
        assert r == {"sent": True, "ai": False} and "9 new leads today (yesterday 12)." in nm2.notified[0][1]
    scenario(monkeypatch, nm2, Model(down=True), no_ai)

    nm3 = Nm()

    async def shadow():
        assert (await rc.report())["sent"] is False and nm3.notified == []
        assert await kinds("reporter_coach") == [("day_report", "shadow")]
    scenario(monkeypatch, nm3, Model(down=True), shadow, {"reporter_coach": "shadow"})


async def _corrections(n):
    for i in range(n):
        aid = await actions.record("lead_responder", "lead_reply", "shadow", "Would send", subject=("lead", f"L{i}"), detail={"text": f"Doctor Tuesday ko milte hain {i}. Call 9876543210."})
        await actions.set_review(aid, {"verdict": "edited", "text": "Doctor Tuesday ko milte hain. Aap aa sakte hain.", "note": "Invite them to come"}, "Priya")


@needs_db
def test_coach_suggests_lessons_that_wait_for_a_person(monkeypatch):
    nm = Nm()
    m = Model([rc.Lessons(lessons=["End every answer with an invitation to visit.", "Always quote the fee of ₹500."])])

    async def body():
        from nexagents.agents.base import runtime
        await _corrections(3)
        assert await rc.coach() == {"suggested": 1}, "the price lesson is refused"
        assert "9876543210" not in m.seen[0] and "[phone]" in m.seen[0], "phone numbers never reach the AI"
        all_ = await runtime.lessons("lead_responder", kept_only=False)
        assert [(x["text"], x["status"]) for x in all_] == [("End every answer with an invitation to visit.", "proposed")]
        assert await runtime.lessons("lead_responder") == [], "the agent does not read it yet"
        assert await runtime.keep_lesson("lead_responder", all_[0]["key"], "Priya")
        assert [x["text"] for x in await runtime.lessons("lead_responder")] == ["End every answer with an invitation to visit."]
        assert await rc.coach() == {"suggested": 0} and len(m.seen) == 1, "the same corrections are not used twice"
    scenario(monkeypatch, nm, m, body)


@needs_db
def test_coach_needs_a_pattern_and_the_ai(monkeypatch):
    async def one():
        await _corrections(1)
        assert await rc.coach() == {"suggested": 0}
    m = Model()
    scenario(monkeypatch, Nm(), m, one)
    assert m.seen == [], "one correction is not a pattern: the AI isn't asked"

    async def down():
        await _corrections(3)
        assert await rc.coach() == {"suggested": 0}
        row = await db.fetchone("SELECT count(*) AS n FROM agents.actions WHERE review->>'coached' = 'true'")
        assert row["n"] == 0, "nothing is marked used when the AI could not be asked"
    scenario(monkeypatch, Nm(), Model(down=True), down)
