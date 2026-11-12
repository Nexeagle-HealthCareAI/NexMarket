"""
Step 5: the field, camps and ads. Partner Network, Field Coordinator, Camp Planner, Ads Optimiser: all plain
rules, no AI. Needs TEST_DATABASE_URL, except the planning functions.
"""

import asyncio
import os

import pytest

from nexagents import db, limits, llm, nexmarket
from nexagents.agents import ads_optimiser as ao
from nexagents.agents import camp_planner as cp
from nexagents.agents import field_coordinator as fc
from nexagents.agents import partner_network as pn

URL = os.environ.get("TEST_DATABASE_URL")
needs_db = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")

WATCH = {
    "quiet": [{"contactClientId": "p-small", "agentId": "A1", "role": "asha_worker", "before": 2, "daysSinceLast": 41},
              {"contactClientId": "p-big", "agentId": "A2", "role": "rmp_doctor", "before": 9, "daysSinceLast": 33},
              {"contactClientId": "p-both", "agentId": "A1", "role": "rmp_doctor", "before": 4, "daysSinceLast": 31}],
    "thank": [{"contactClientId": "p-thank", "agentId": "A1", "role": "medicine_shop", "came": 1}, {"contactClientId": "p-both", "agentId": "A1", "role": "rmp_doctor", "came": 3}],
}


def P(i, name, days):
    return {"id": f"pan{i}", "name": name, "daysSinceVisit": days}


COVER = {"agents": [
    {"agentId": "A1", "block": "Amour", "agentsInBlock": 2, "panchayats": 12, "visitedIn21Days": 5, "shiftsLast7Days": 5, "openAiTasks": 0,
     "stale": [P(1, "Bishunpur", None), P(2, "Dalmalpur", 60), P(3, "Khari", 44), P(4, "Nitendra", 30), P(5, "Potia", 25), P(6, "Rangraiya", 22)]},
    {"agentId": "A2", "block": "Amour", "agentsInBlock": 2, "panchayats": 12, "visitedIn21Days": 5, "shiftsLast7Days": 3, "openAiTasks": 0,
     "stale": [P(1, "Bishunpur", None), P(2, "Dalmalpur", 60), P(3, "Khari", 44), P(4, "Nitendra", 30), P(5, "Potia", 25), P(6, "Rangraiya", 22)]},
    {"agentId": "A3", "block": "Kasba", "agentsInBlock": 1, "panchayats": 10, "visitedIn21Days": 8, "shiftsLast7Days": 6, "openAiTasks": 0, "stale": [P(7, "Gurhi", 30), P(8, "Sabdalpur", 25)]},
    {"agentId": "A4", "block": "Baisi", "agentsInBlock": 1, "panchayats": 9, "visitedIn21Days": 1, "shiftsLast7Days": 0, "openAiTasks": 0, "stale": [P(9, "Asja", None), P(10, "Chandwa", None), P(11, "Dhusmal", 50)]},
    {"agentId": "A5", "block": "Rauta", "agentsInBlock": 1, "panchayats": 9, "visitedIn21Days": 1, "shiftsLast7Days": 4, "openAiTasks": 5, "stale": [P(12, "X", None), P(13, "Y", None), P(14, "Z", 50)]},
]}

DEMAND = {"blocks": [
    {"block": "Amour", "referrals90Days": 14, "topDepartments": [{"department": "Eye", "referrals": 8}, {"department": "Orthopaedics", "referrals": 3}], "partners": 60, "partnersReachable": 48,
     "lastCamp": None, "daysSinceCamp": None, "nextCamp": None},
    {"block": "Kasba", "referrals90Days": 22, "topDepartments": [{"department": "Gynaecology", "referrals": 12}], "partners": 40, "partnersReachable": 30, "lastCamp": "2026-10-20", "daysSinceCamp": 20, "nextCamp": None},
    {"block": "Baisi", "referrals90Days": 9, "topDepartments": [], "partners": 10, "partnersReachable": 0, "lastCamp": "2026-07-01", "daysSinceCamp": 131, "nextCamp": None},
    {"block": "Rauta", "referrals90Days": 30, "topDepartments": [{"department": "Eye", "referrals": 20}], "partners": 50, "partnersReachable": 40, "lastCamp": None, "daysSinceCamp": None, "nextCamp": "2026-11-20"},
    {"block": "Dagarua", "referrals90Days": 3, "topDepartments": [], "partners": 80, "partnersReachable": 70, "lastCamp": None, "daysSinceCamp": None, "nextCamp": None},
]}

ADS = {"days": 14, "currency": "INR", "meta": [
    {"id": "m1", "name": "Eye camp leads", "spend": 4200, "leads": 30, "came": 6, "clicks": 400},
    {"id": "m2", "name": "Ortho awareness", "spend": 3000, "leads": 0, "came": 0, "clicks": 200},
    {"id": "m3", "name": "Maternity form", "spend": 2500, "leads": 12, "came": 0, "clicks": 150},
    {"id": "m4", "name": "General OPD", "spend": 6000, "leads": 10, "came": 2, "clicks": 300},
    {"id": "m5", "name": "Tiny test", "spend": 300, "leads": 0, "came": 0, "clicks": 9},
], "google": [
    {"id": "campaign:1", "name": "Search - hospital near me", "cost": 5200, "clicks": 310, "conversions": 14, "calls": 9},
    {"id": "campaign:2", "name": "Search - ortho", "cost": 1800, "clicks": 75, "conversions": 0, "calls": 0},
    {"id": "campaign:3", "name": "Small", "cost": 400, "clicks": 40, "conversions": 0, "calls": 0},
]}


# ─── Planning (no database) ───────────────────────────────────────────────────

def test_partner_plan_thanks_first_then_the_biggest_quiet_referrers_and_never_both():
    got = pn.plan(WATCH)
    assert [(p["kind"], p["contact"]) for p in got] == [("thank", "p-both"), ("thank", "p-thank"), ("revive", "p-big"), ("revive", "p-small")]
    assert got[2]["count"] == 33 and got[0]["count"] == 3


def test_coverage_plan_splits_a_shared_block_and_skips_idle_busy_and_well_covered_agents():
    tasks, idle = fc.plan(COVER)
    assert idle == 1, "A4 has not worked this week: the manager hears, no list is given"
    assert [(t["agent"], t["names"]) for t in tasks] == [("A1", ["Bishunpur", "Dalmalpur", "Khari", "Nitendra"]), ("A2", ["Potia", "Rangraiya"])]
    assert "A3" not in [t["agent"] for t in tasks], "only 2 overdue panchayats in Kasba: not worth a task"
    assert "A5" not in [t["agent"] for t in tasks], "A5 already has 5 open Vita tasks"


def test_camp_ideas_rank_by_referrals_and_skip_recent_planned_and_thin_blocks():
    got = cp.ideas(DEMAND)
    assert [i["block"] for i in got] == ["Amour", "Baisi"]
    assert got[0]["why"] == ("14 patients were referred from Amour in the last 90 days, most of them for Eye (8). 48 partners there can be invited on WhatsApp. "
                             "No camp has been held there yet.")
    assert "131 days ago (2026-07-01)" in got[1]["why"] and "No partner there can be invited" in got[1]["why"]


def test_ads_rules_and_their_figures():
    got = {s["key"]: s["text"] for s in ao.suggestions(ADS)}
    assert set(got) == {"meta_no_leads:m2", "meta_no_show:m3", "meta_costly:m4", "meta_best:m1", "google_no_result:campaign:2"}
    assert got["meta_no_leads:m2"].startswith("Meta “Ortho awareness” spent ₹3,000 in 14 days and no lead reached the CRM.")
    assert "₹600 a lead (10 leads for ₹6,000); the middle campaign costs ₹208" in got["meta_costly:m4"]
    assert "6 patients came for ₹4,200, ₹700 each" in got["meta_best:m1"]
    assert "spent ₹1,800 on 75 clicks" in got["google_no_result:campaign:2"]
    assert ao.suggestions({"meta": [{"id": "x", "name": "Only one", "spend": 900, "leads": 9, "came": 3}], "google": []}) == [], "one healthy campaign: nothing to say"


# ─── With the database ────────────────────────────────────────────────────────

class Nm:
    def __init__(self) -> None:
        self.tasks: list[dict] = []
        self.cards: list[tuple[str, str]] = []
        self.refuse: dict[str, str] = {}
        self.watch, self.cover, self.demand, self.ads = WATCH, COVER, DEMAND, ADS

    async def partners_watch(self):
        return self.watch

    async def field_coverage(self):
        return self.cover

    async def camp_demand(self):
        return self.demand

    async def ads_results(self):
        return self.ads

    async def make_task(self, kind, *, for_agent, agent_id, contact=None, count=0, panchayats=None):
        if for_agent in self.refuse:
            raise nexmarket.NexMarketError(f"/tasks → 409: {self.refuse[for_agent]}")
        self.tasks.append({"kind": kind, "for": for_agent, "contact": contact, "count": count, "panchayats": panchayats})
        return {"status": "created"}

    async def board_card(self, title, description, *, agent_id, priority="normal", labels=None, due_date=None):
        self.cards.append((title, description))
        return {"id": "c"}


class NoModel:
    async def __call__(self, call, messages):
        raise AssertionError("these agents use no AI")


def scenario(monkeypatch, nm: Nm, body, mode="live", monday=True):
    for name in ("partners_watch", "field_coverage", "camp_demand", "ads_results", "make_task", "board_card"):
        monkeypatch.setattr(nexmarket, name, getattr(nm, name))
    monkeypatch.setattr(llm, "chat", NoModel())
    from datetime import datetime, timezone
    monkeypatch.setattr(db, "now", lambda: datetime(2026, 11, 9 if monday else 15, 6, 0, tzinfo=timezone.utc))   # a Monday, or a Sunday

    async def go():
        await db.open_pool(URL)
        try:
            await db.execute("TRUNCATE agents.actions, agents.tasks, agents.agent_state, agents.settings, agents.runs, agents.usage")
            await limits.ensure_agents({a: mode for a in ("partner_network", "field_coordinator", "camp_planner", "ads_optimiser")} | {"compliance_guard": "live"})
            return await body()
        finally:
            await db.close_pool()

    return asyncio.run(go())


async def kinds(agent):
    return [(a["kind"], a["status"]) for a in await db.fetch("SELECT kind, status FROM agents.actions WHERE agent_id = %s ORDER BY id", agent)]


@needs_db
def test_partner_tasks_go_to_the_owning_agent_once_and_respect_a_full_agent(monkeypatch):
    nm = Nm(); nm.refuse = {"A2": "agent_has_enough"}

    async def body():
        r = await pn.tick()
        assert r == {"tasks": 3, "shadow": 0, "refused": 1}
        assert [(t["kind"], t["for"], t["contact"], t["count"]) for t in nm.tasks] == [("thank", "A1", "p-both", 3), ("thank", "A1", "p-thank", 1), ("revive", "A1", "p-small", 41)]
        nm.refuse = {}
        assert await pn.tick() == {"tasks": 1, "shadow": 0, "refused": 0}, "only the one that was refused is tried again"
        assert nm.tasks[-1]["contact"] == "p-big"
        assert await pn.tick() == {"tasks": 0, "shadow": 0, "refused": 0}
    scenario(monkeypatch, nm, body)


@needs_db
def test_coverage_tasks_live_shadow_sunday_and_the_idle_card(monkeypatch):
    nm = Nm()

    async def live():
        assert await fc.tick() == {"tasks": 2, "shadow": 0, "refused": 0, "idle": 1}
        assert [(t["for"], t["panchayats"]) for t in nm.tasks] == [("A1", ["pan1", "pan2", "pan3", "pan4"]), ("A2", ["pan5", "pan6"])]
        assert nm.cards[0][0] == "1 field agent has not started work in the last 7 days"
        assert await fc.tick() == {"tasks": 0, "shadow": 0, "refused": 0, "idle": 1} and len(nm.tasks) == 2 and len(nm.cards) == 1, "one list a week, one card a week"
    scenario(monkeypatch, nm, live)

    nm2 = Nm()

    async def shadow():
        assert await fc.tick() == {"tasks": 0, "shadow": 2, "refused": 0, "idle": 1} and nm2.tasks == [] and nm2.cards == []
        assert ("coverage_task", "shadow") in await kinds("field_coordinator")
    scenario(monkeypatch, nm2, shadow, mode="shadow")

    nm3 = Nm()

    async def sunday():
        assert await fc.tick() == {"tasks": 0, "shadow": 0, "refused": 0, "idle": 0} and nm3.tasks == []
    scenario(monkeypatch, nm3, sunday, monday=False)


@needs_db
def test_camp_ideas_become_cards_once_a_month_and_only_recorded_in_shadow(monkeypatch):
    nm = Nm()

    async def live():
        assert await cp.tick() == {"cards": 2, "shadow": 0}
        assert [c[0] for c in nm.cards] == ["Plan a camp in Amour? (Eye)", "Plan a camp in Baisi?"] and "does not book camps or spend money" in nm.cards[0][1]
        assert await cp.tick() == {"cards": 0, "shadow": 0} and len(nm.cards) == 2
    scenario(monkeypatch, nm, live)

    nm2 = Nm()

    async def shadow():
        assert await cp.tick() == {"cards": 0, "shadow": 2} and nm2.cards == []
    scenario(monkeypatch, nm2, shadow, mode="shadow")


@needs_db
def test_ads_card_at_most_every_three_days_and_silent_when_all_is_well(monkeypatch):
    nm = Nm()

    async def live():
        assert await ao.tick() == {"suggestions": 5, "card": 1}
        title, text = nm.cards[0]
        assert title == "Ads: 5 things to look at (last 14 days)" and text.count("\n- ") == 4 and "you run the ads, Vita changes nothing" in text
        assert await ao.tick() == {"suggestions": 5, "card": 0} and len(nm.cards) == 1
    scenario(monkeypatch, nm, live)

    nm2 = Nm(); nm2.ads = {"days": 14, "meta": [{"id": "x", "name": "Only one", "spend": 900, "leads": 9, "came": 3}], "google": []}

    async def quiet():
        assert await ao.tick() == {"suggestions": 0, "card": 0} and nm2.cards == [] and await kinds("ads_optimiser") == []
    scenario(monkeypatch, nm2, quiet)

    nm3 = Nm()

    async def off():
        assert await ao.tick() == {"suggestions": 0, "card": 0} and await pn.tick() == {"tasks": 0, "shadow": 0, "refused": 0} and await cp.tick() == {"cards": 0, "shadow": 0}
    scenario(monkeypatch, nm3, off, mode="off")
