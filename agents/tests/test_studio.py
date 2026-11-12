"""
Step 4: the studio. Reputation (fixed thank-yous, low ratings to a person), Content Writer (drafts from records,
checked by the Guard), Social Publisher (only what a person approved), Broadcast Manager (ready, then your OK).
Needs TEST_DATABASE_URL, except the wording and topic checks.
"""

import asyncio
import os
from datetime import date

import pytest

from nexagents import actions, db, limits, llm, nexmarket, review
from nexagents.agents import broadcast_manager as bm
from nexagents.agents import content_writer as cw
from nexagents.agents import reputation as rp
from nexagents.agents import social_publisher as sp
from nexagents.guard import rules
from nexagents.guard.check import PolicyAnswer
from tests.fixtures import DIRECTORY, FACTS

URL = os.environ.get("TEST_DATABASE_URL")
needs_db = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")
TODAY = date(2026, 11, 9)   # a Monday; the sample camps are on the 14th and the 21st


# ─── Wording and topics (no database) ────────────────────────────────────────

def test_every_fixed_thank_you_passes_the_rules_for_a_public_google_reply():
    for lang, options in rp.THANKS.items():
        for text in options:
            issues = rules.check(text, channel="google_review", audience="public", facts={}, opted_in=None, has_sources=False)
            assert issues == [], (lang, text, issues)


def test_thank_you_matches_the_language_and_is_stable_per_review():
    assert rp.thank_you("r1", "bn") in rp.THANKS["bn"] and rp.thank_you("r1", "en") in rp.THANKS["en"]
    assert rp.thank_you("r1", "hi") == rp.thank_you("r1", "hi")
    assert rp.thank_you("r1", "xx") in rp.THANKS["hi"]
    assert len({rp.thank_you(f"r{i}", "hi") for i in range(40)}) == len(rp.THANKS["hi"]), "replies vary from review to review"


def test_topics_are_this_weeks_camps_and_on_monday_one_department():
    got = cw.topics(DIRECTORY, TODAY)
    assert [t["subject"][0] for t in got] == ["camp", "department"] and got[0]["subject"] == ("camp", "camp-amour")
    assert got[0]["expires"] == "2026-11-14" and "Amour High School" in str(got[0]["record"])
    assert got[1]["also"] and all(x.startswith("doctor:") for x in got[1]["also"])
    assert [t["subject"][0] for t in cw.topics(DIRECTORY, date(2026, 11, 10))] == ["camp"], "no department post on a Tuesday"
    assert cw.topics(DIRECTORY, date(2026, 12, 1)) == [], "the camps are over"


# ─── With the database ────────────────────────────────────────────────────────

class Nm:
    def __init__(self) -> None:
        self.reviews: list[dict] = []
        self.replies: list[tuple[str, str]] = []
        self.cards: list[str] = []
        self.notified: list[str] = []
        self.posts: list[str] = []
        self.post_error: str | None = None
        self.camps: dict = {"connected": True, "paused": False, "items": []}
        self.broadcasts: list[str] = []
        self.broadcast_error: str | None = None

    async def reviews_unanswered(self):
        return {"items": self.reviews}

    async def review_reply(self, rid, text, *, agent_id):
        self.replies.append((rid, text))
        return {"status": "replied"}

    async def board_card(self, title, description, *, agent_id, priority="normal", labels=None, due_date=None):
        self.cards.append(title)
        return {"id": "c"}

    async def notify_team(self, title, body, link=None, *, agent_id):
        self.notified.append(title)
        return {"sent": 1}

    async def directory(self):
        return DIRECTORY

    async def social_publish(self, text, *, agent_id):
        if self.post_error:
            raise nexmarket.NexMarketError(self.post_error)
        self.posts.append(text)
        return {"status": "published", "permalink": "https://www.facebook.com/1_2"}

    async def camp_candidates(self):
        return self.camps

    async def broadcast_camp(self, camp_id, *, agent_id):
        if self.broadcast_error:
            raise nexmarket.NexMarketError(self.broadcast_error)
        self.broadcasts.append(camp_id)
        return {"status": "scheduled", "recipients": 84}


class Model:
    def __init__(self, drafts=None, down=False, policy_ok=True):
        self.drafts, self.down, self.policy_ok, self.seen = list(drafts or []), down, policy_ok, []

    async def __call__(self, call, messages):
        self.seen.append("\n".join(str(m.content) for m in messages))
        if self.down:
            raise llm.ModelUnavailable("Groq down")
        if call.schema is PolicyAnswer:
            return PolicyAnswer(violation=not self.policy_ok, explanation="test")
        if call.schema is cw.Draft:
            return cw.Draft(text=self.drafts.pop(0))
        return type("Msg", (), {"content": messages[-1].content})()


def scenario(monkeypatch, nm: Nm, model: Model, body, modes=None, quiet=False):
    for name in ("reviews_unanswered", "review_reply", "board_card", "notify_team", "directory", "social_publish", "camp_candidates", "broadcast_camp"):
        monkeypatch.setattr(nexmarket, name, getattr(nm, name))
    monkeypatch.setattr(llm, "chat", model)
    monkeypatch.setattr(limits, "in_quiet_hours", lambda q, at=None: quiet)

    async def go():
        from nexagents.agents.base import runtime
        await db.open_pool(URL)
        try:
            await runtime.open()
            await db.execute("TRUNCATE agents.actions, agents.tasks, agents.agent_state, agents.settings, agents.runs, agents.usage")
            await limits.ensure_agents({"reputation": "live", "content_writer": "live", "social_publisher": "live", "broadcast_manager": "live", "compliance_guard": "live", **(modes or {})})
            await limits.set_setting("facts", FACTS, "test")
            return await body()
        finally:
            runtime.store = runtime.checkpointer = None
            await db.close_pool()

    return asyncio.run(go())


async def kinds(agent):
    return [(a["kind"], a["status"]) for a in await db.fetch("SELECT kind, status FROM agents.actions WHERE agent_id = %s ORDER BY created_at", agent)]


# Reputation

@needs_db
def test_good_reviews_are_thanked_once_and_low_ones_go_to_a_person_once(monkeypatch):
    nm = Nm()
    nm.reviews = [{"id": "r5", "stars": 5, "language": "hi"}, {"id": "r4", "stars": 4, "language": "en"}, {"id": "r2", "stars": 2, "language": "hi"}, {"id": "r3", "stars": 3, "language": "bn"}]

    async def body():
        assert await rp.tick() == {"thanked": 2, "shadow": 0, "low": 2}
        assert [r[0] for r in nm.replies] == ["r5", "r4"] and nm.replies[0][1] in rp.THANKS["hi"] and nm.replies[1][1] in rp.THANKS["en"]
        assert nm.cards == ["A 2-star Google review needs a personal reply", "A 3-star Google review needs a personal reply"] and len(nm.notified) == 2
        assert await rp.tick() == {"thanked": 0, "shadow": 0, "low": 0}, "Google may still list them for a while: nothing is repeated"
        assert len(nm.replies) == 2 and len(nm.cards) == 2
    scenario(monkeypatch, nm, Model(), body)


@needs_db
def test_reputation_shadow_quiet_hours_daily_cap_and_off(monkeypatch):
    def fresh(n=3):
        nm = Nm(); nm.reviews = [{"id": f"r{i}", "stars": 5, "language": "hi"} for i in range(n)] + [{"id": "low", "stars": 1, "language": "hi"}]
        return nm

    nm = fresh()

    async def shadow():
        assert await rp.tick() == {"thanked": 0, "shadow": 3, "low": 1} and nm.replies == [] and nm.cards == []
    scenario(monkeypatch, nm, Model(), shadow, {"reputation": "shadow"})

    nm2 = fresh()

    async def quiet():
        r = await rp.tick()
        assert r["thanked"] == 0 and nm2.replies == [] and r["low"] == 1, "no reply goes on Google at night; a low review is still raised"
    scenario(monkeypatch, nm2, Model(), quiet, quiet=True)

    nm3 = fresh(14)

    async def capped():
        total = 0
        for _ in range(4):
            total += (await rp.tick())["thanked"]
        assert total == 10 and len(nm3.replies) == 10, "5 a run, 10 a day"
    scenario(monkeypatch, nm3, Model(), capped)

    nm4 = fresh()

    async def off():
        assert await rp.tick() == {"thanked": 0, "shadow": 0, "low": 0}
    scenario(monkeypatch, nm4, Model(), off, {"reputation": "off"})


# Content Writer → a person → Social Publisher

GOOD_CAMP = "अमौर में निःशुल्क नेत्र जाँच शिविर। शनिवार 14 नवंबर, सुबह 10 बजे से दोपहर 2 बजे तक, Amour High School में। अपनी आँखों की जाँच करवाएँ। जानकारी के लिए 9431012345 पर कॉल करें।"
WRONG_DAY = "अमौर में निःशुल्क नेत्र जाँच शिविर रविवार 15 नवंबर को, सुबह 10 बजे से। जानकारी के लिए 9431012345 पर कॉल करें।"
GOOD_DEPT = "हमारे अस्पताल में ओपीडी की जानकारी के लिए 9431012345 पर कॉल करें। हम आपकी सेवा के लिए तैयार हैं।"


@needs_db
def test_writer_drafts_from_records_and_the_guard_stops_a_wrong_date(monkeypatch):
    nm, m = Nm(), Model([WRONG_DAY, GOOD_DEPT])

    async def body():
        r = await cw.tick(TODAY)
        assert r == {"drafts": 1, "blocked": 1}
        got = await kinds("content_writer")
        assert got == [("content_draft", "blocked"), ("content_draft", "held")]
        assert "Amour High School" in m.seen[0] and "patient" not in m.seen[0].lower().replace("patient stories", "")
        assert await cw.tick(TODAY) == {"drafts": 0, "blocked": 0}, "the same topics are not drafted again"
        assert (await actions.waiting_review()) == {"content_writer": 1}
    scenario(monkeypatch, nm, m, body)


@needs_db
def test_writer_without_ai_writes_nothing_and_in_shadow_makes_practice_drafts(monkeypatch):
    async def down():
        assert await cw.tick(TODAY) == {"drafts": 0, "blocked": 0} and await kinds("content_writer") == []
    scenario(monkeypatch, Nm(), Model(down=True), down)

    async def shadow():
        assert (await cw.tick(date(2026, 11, 10)))["drafts"] == 1
        assert await kinds("content_writer") == [("content_draft", "shadow")]
        assert await sp.tick(TODAY) == {"published": 0, "shadow": 0, "skipped": 0}
    scenario(monkeypatch, Nm(), Model([GOOD_CAMP]), shadow, {"content_writer": "shadow"})


async def _draft_id():
    return str((await db.fetchone("SELECT id FROM agents.actions WHERE kind = 'content_draft' AND status = 'held'"))["id"])


@needs_db
def test_nothing_is_published_until_a_person_says_good_and_then_only_once(monkeypatch):
    nm, m = Nm(), Model([GOOD_CAMP])

    async def body():
        await cw.tick(date(2026, 11, 10))
        assert await sp.tick(TODAY) == {"published": 0, "shadow": 0, "skipped": 0} and nm.posts == [], "an unchecked draft is never published"
        aid = await _draft_id()
        with pytest.raises(review.ReviewError):
            await review.review(aid, by="Priya", verdict="good", send=True)   # a draft is approved, not "sent", from the review
        r = await review.review(aid, by="Priya", verdict="edited", text=GOOD_CAMP + " आप सभी आमंत्रित हैं।")
        assert r["ok"] and not r["sent"]
        assert await sp.tick(TODAY) == {"published": 1, "shadow": 0, "skipped": 0}
        assert nm.posts == [GOOD_CAMP + " आप सभी आमंत्रित हैं।"], "the person's version is what goes out"
        assert await sp.tick(TODAY) == {"published": 0, "shadow": 0, "skipped": 0} and len(nm.posts) == 1
    scenario(monkeypatch, nm, m, body)


@needs_db
def test_publisher_skips_wrong_expired_and_unsafe_drafts_and_gives_up_after_two_failures(monkeypatch):
    nm, m = Nm(), Model([GOOD_CAMP])

    async def wrong_then_expired():
        await cw.tick(date(2026, 11, 10))
        aid = await _draft_id()
        await review.review(aid, by="Priya", verdict="good")
        assert await sp.tick(date(2026, 11, 15)) == {"published": 0, "shadow": 0, "skipped": 1} and nm.posts == [], "the camp is over"
        assert await sp.tick(TODAY) == {"published": 0, "shadow": 0, "skipped": 0}
    scenario(monkeypatch, nm, m, wrong_then_expired)

    nm2, m2 = Nm(), Model([GOOD_CAMP])

    async def marked_wrong():
        await cw.tick(date(2026, 11, 10))
        await review.review(await _draft_id(), by="Priya", verdict="wrong")
        assert await sp.tick(TODAY) == {"published": 0, "shadow": 0, "skipped": 0}
    scenario(monkeypatch, nm2, m2, marked_wrong)

    nm3, m3 = Nm(), Model([GOOD_CAMP])

    async def unsafe_edit():
        await cw.tick(date(2026, 11, 10))
        await review.review(await _draft_id(), by="Priya", verdict="edited", text=GOOD_CAMP.replace("शनिवार 14", "रविवार 15"))
        assert await sp.tick(TODAY) == {"published": 0, "shadow": 0, "skipped": 1} and nm3.posts == [], "the rules catch a date the record doesn't have, even in a person's edit"
    scenario(monkeypatch, nm3, m3, unsafe_edit)

    nm4, m4 = Nm(), Model([GOOD_CAMP])
    nm4.post_error = "/social/publish → 409: facebook_refused"

    async def facebook_refuses():
        await cw.tick(date(2026, 11, 10))
        await review.review(await _draft_id(), by="Priya", verdict="good")
        assert (await sp.tick(TODAY))["skipped"] == 1 and (await sp.tick(TODAY))["skipped"] == 1
        assert await sp.tick(TODAY) == {"published": 0, "shadow": 0, "skipped": 0}, "after two failures it stops trying"
        assert (await kinds("social_publisher")).count(("social_post", "failed")) == 2
    scenario(monkeypatch, nm4, m4, facebook_refuses)


@needs_db
def test_publisher_posts_at_most_one_a_run_and_two_a_day(monkeypatch):
    nm = Nm()

    async def body():
        for i in range(3):
            aid = await actions.record("content_writer", "content_draft", "held", "Draft", subject=("department", f"d{i}"), channel="facebook",
                                       detail={"text": f"हमारे अस्पताल में ओपीडी सेवा उपलब्ध है। संदेश {'क' * (i + 1)}। जानकारी के लिए 9431012345 पर कॉल करें।", "expires": "2026-11-30"})
            await actions.set_review(aid, {"verdict": "good"}, "Priya")
        assert [(await sp.tick(TODAY))["published"] for _ in range(4)] == [1, 1, 0, 0] and len(nm.posts) == 2
    scenario(monkeypatch, nm, Model(), body)


# Broadcast Manager

def _camp(**kw):
    c = {"campId": "camp-amour", "title": "Free eye check-up camp, Amour", "date": "2026-11-14", "block": "Amour", "recipients": 84, "blockHadBroadcastThisWeek": False,
         "preview": "नमस्ते [Name] जी,\nग्लिसन अकबरी हॉस्पिटल का स्वास्थ्य शिविर: Amour High School, Amour, 14 Nov (Saturday)। Free eye check-up camp, Amour. समय: 10:00 से 14:00.",
         "facts": {"place": "Amour High School, Amour", "date": "14 Nov (Saturday)", "start": "10:00", "end": "14:00", "venue": "Amour High School", "block": "Amour"}}
    c.update(kw)
    return c


@needs_db
def test_camp_invitation_waits_for_a_person_and_is_sent_only_on_their_ok(monkeypatch):
    nm = Nm(); nm.camps["items"] = [_camp(), _camp(campId="c2", title="Bone camp", block="Kasba", blockHadBroadcastThisWeek=True), _camp(campId="c3", title="Empty", recipients=0)]

    async def body():
        assert await bm.tick() == {"ready": 1, "skipped": 2}
        assert nm.broadcasts == [], "the Broadcast Manager never sends on its own"
        assert nm.notified == ["A camp invitation is ready to send"]
        assert await bm.tick() == {"ready": 0, "skipped": 0}, "asked once per camp"
        assert (await actions.waiting_review()) == {"broadcast_manager": 1}
        aid = str((await db.fetchone("SELECT id FROM agents.actions WHERE kind = 'camp_broadcast' AND status = 'held'"))["id"])
        with pytest.raises(review.ReviewError) as e:
            await review.review(aid, by="Priya", verdict="edited", text="Come to the camp!", send=True)
        assert "approved template" in str(e.value)
        r = await review.review(aid, by="Priya", verdict="good", send=True)
        assert r["sent"] and nm.broadcasts == ["camp-amour"]
        assert ("camp_broadcast", "done") in await kinds("broadcast_manager")
    scenario(monkeypatch, nm, Model(), body)


@needs_db
def test_camp_invitation_refused_by_nexmarket_shadow_and_whatsapp_paused(monkeypatch):
    nm = Nm(); nm.camps["items"] = [_camp()]; nm.broadcast_error = "/broadcasts/camp → 409: block_had_broadcast_this_week"

    async def refused():
        await bm.tick()
        aid = str((await db.fetchone("SELECT id FROM agents.actions WHERE kind = 'camp_broadcast' AND status = 'held'"))["id"])
        r = await review.review(aid, by="Priya", verdict="good", send=True)
        assert not r["sent"] and "last 7 days" in r["reason"]
    scenario(monkeypatch, nm, Model(), refused)

    nm2 = Nm(); nm2.camps["items"] = [_camp()]

    async def shadow():
        assert await bm.tick() == {"ready": 1, "skipped": 0} and nm2.notified == []
        aid = str((await db.fetchone("SELECT id FROM agents.actions WHERE kind = 'camp_broadcast'"))["id"])
        with pytest.raises(review.ReviewError) as e:
            await review.review(aid, by="Priya", verdict="good", send=True)
        assert "practice" in str(e.value) and nm2.broadcasts == []
    scenario(monkeypatch, nm2, Model(), shadow, {"broadcast_manager": "shadow"})

    nm3 = Nm(); nm3.camps = {"connected": True, "paused": True, "items": [_camp()]}

    async def paused():
        assert await bm.tick() == {"ready": 0, "skipped": 0}
    scenario(monkeypatch, nm3, Model(), paused)
