"""The 50-case test set for the Guard's rule layer (25 messages that must pass, 25 that must be caught)."""

import json
from pathlib import Path

import pytest

from nexagents.guard import rules

DATA = json.loads((Path(__file__).parent / "guard_cases.json").read_text(encoding="utf-8"))
FACTS = rules.facts_from(DATA["facts"], [])


@pytest.mark.parametrize("case", DATA["cases"], ids=[c["id"] for c in DATA["cases"]])
def test_case(case):
    issues = rules.check(case["text"], channel=case["channel"], facts=FACTS, opted_in=case.get("optedIn"), has_sources=True)
    found = [i.rule for i in issues]
    if case["expect"] == "pass":
        assert found == [], f"{case['id']} should pass but got {[(i.rule, i.match) for i in issues]}"
    else:
        assert case["rule"] in found, f"{case['id']} should be caught by {case['rule']}, got {found}"


def test_prices_in_the_facts_pack_are_allowed():
    facts = rules.facts_from({"text": "Full body check-up ₹499 at the camp."}, [])
    assert rules.check("Full body check-up ₹499 at the camp.", channel="whatsapp", facts=facts) == []


def test_times_from_the_tasks_own_records_are_allowed():
    src = [{"type": "camp", "id": "45", "facts": {"when": "Sunday 16 Nov, 4 pm"}}]
    assert rules.check("Camp on Sunday 16 Nov at 4 pm.", channel="whatsapp", facts=rules.facts_from({}, src), has_sources=True) == []


def test_quiet_hours_cross_midnight():
    from datetime import datetime, timezone
    from nexagents.limits import in_quiet_hours

    q = {"from": "21:00", "to": "08:00"}
    assert in_quiet_hours(q, datetime(2026, 11, 9, 16, 0, tzinfo=timezone.utc))      # 21:30 IST
    assert in_quiet_hours(q, datetime(2026, 11, 9, 23, 0, tzinfo=timezone.utc))      # 04:30 IST
    assert not in_quiet_hours(q, datetime(2026, 11, 9, 3, 0, tzinfo=timezone.utc))   # 08:30 IST
