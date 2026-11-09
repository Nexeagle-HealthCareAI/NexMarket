"""
Live evaluation of the Lead Responder with the real Groq models.

Runs the 40 cases in evals/lead_cases.json through the same steps the agent uses (rules → AI decision → checks →
Compliance Guard with the AI policy check) against the sample hospital in tests/fixtures.py, and scores:
  route       send / hand to a person / emergency, as expected
  department  the right department (when one is expected)
  facts       the reply contains the right day, time or place (when sent)
  language    replied in the person's language
  safe        nothing sent that the Guard would stop (by construction) and no personal number repeated
No database and nothing is sent anywhere. Needs GROQ_API_KEY (environment or agents/.env.local).

    python scripts/eval_lead_responder.py              # one pass
    python scripts/eval_lead_responder.py --runs 3     # three passes, to see how consistent it is
    python scripts/eval_lead_responder.py --fake       # check the harness itself, no AI
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

env = ROOT / ".env.local"
if env.exists():
    for line in env.read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

from nexagents import act, limits, llm  # noqa: E402
from nexagents.agents import lead_responder as lr  # noqa: E402
from nexagents.guard.check import GuardRequest, PolicyAnswer  # noqa: E402
from nexagents.guard.policy import DEFAULT_POLICY  # noqa: E402
from tests.fixtures import DIRECTORY, FACTS  # noqa: E402

CASES = json.loads((ROOT / "evals" / "lead_cases.json").read_text(encoding="utf-8"))
TOKENS = {"in": 0, "out": 0, "calls": 0}


def offline() -> None:
    """Everything the agent normally reads from the database, in memory."""

    async def get_setting(key, default=None):
        return {"facts": FACTS, "policy": {"text": DEFAULT_POLICY}}.get(key, default)

    async def lim():
        return limits.merge(limits.DEFAULT_LIMITS, None)

    async def usage(agent_id):
        return 0

    async def record(agent_id, tin, tout):
        TOKENS["in"] += tin; TOKENS["out"] += tout; TOKENS["calls"] += 1

    limits.get_setting = get_setting  # type: ignore[assignment]
    limits.limits = lim  # type: ignore[assignment]
    llm.limits = lim  # type: ignore[attr-defined]
    llm._usage_today = usage  # type: ignore[assignment]
    llm._record_usage = record  # type: ignore[assignment]

    from nexagents.agents import base

    async def no_lessons(agent_id, **kw):
        return []
    base.runtime.lessons = no_lessons  # type: ignore[method-assign]


def fake_model() -> None:
    """--fake: a model that answers the eye question correctly and hands everything else over."""

    async def chat(call, messages):
        if call.schema is lr.Decision:
            q = str(messages[-1].content).lower()
            if "aankh" in q or "eye" in q:
                return lr.Decision(intent="doctor_timing", language="hinglish", department="Eye",
                                   reply="Dr. Anjali Verma Tuesday aur Friday 10 am - 2 pm.", sources=["doctor:doc-eye"])
            return lr.Decision(intent="other", language="en", reply=None, needs_person="fake model")
        if call.schema is PolicyAnswer:
            return PolicyAnswer(violation=False)
        return type("M", (), {"content": messages[-1].content})()
    llm.chat = chat  # type: ignore[assignment]


async def one(case: dict) -> dict:
    t0 = time.monotonic()
    texts = [case["text"]]
    tri = lr.triage(texts)
    res = {"id": case["id"], "text": case["text"], "expected": case["route"], "route": None, "department": None, "reply": None,
           "language": None, "guard": None, "why": None}
    if tri.emergency:
        res["route"] = "emergency"
    elif tri.handoff:
        res.update(route="handoff", why=tri.handoff)
    else:
        state = {"lead_id": case["id"], "ctx": {"lead": {}, "messages": [{"direction": "in", "by": "person", "text": case["text"]}]},
                 "directory": DIRECTORY, "texts": texts}
        out = await lr.decide(state)  # type: ignore[arg-type]
        d = out.get("decision")
        if d is None:
            res.update(route="handoff", why=(out.get("detail") or {}).get("why"))
        else:
            res.update(department=d.department, language=d.language, intent=d.intent)
            if not d.reply:
                res.update(route="handoff", why=d.needs_person)
            else:
                sources = lr._sources_for_guard(d.sources, DIRECTORY)
                if "facts" in d.sources:
                    sources.append({"type": "facts", "id": "facts", "facts": {}})
                g = await act.guard(GuardRequest(text=d.reply, channel="whatsapp", sources=sources, allow_rewrite=True, from_agent="lead_responder"))
                res["guard"] = {"outcome": g.outcome, "issues": g.issues, "rewritten": g.rewritten}
                if g.outcome == "pass":
                    res.update(route="send", reply=g.text)
                else:
                    res.update(route="handoff", why="guard: " + ", ".join(i["rule"] for i in g.issues) if g.issues else f"guard: {g.outcome}",
                               blocked_reply=d.reply)
    res["seconds"] = round(time.monotonic() - t0, 2)
    # Scores
    res["ok_route"] = res["route"] == case["route"]
    res["ok_department"] = case["department"] is None or res["department"] == case["department"] or res["route"] == "emergency"
    wanted = case.get("replyHasAny") or []
    res["ok_facts"] = res["route"] != "send" or not wanted or any(w.lower() in (res["reply"] or "").lower() for w in wanted)
    res["ok_language"] = res["route"] != "send" or res["language"] in (None, case["language"]) or {res["language"], case["language"]} <= {"hi", "hinglish"}
    res["ok_safe"] = not (res["reply"] and "9876543210" in res["reply"])
    res["ok"] = all(res[k] for k in ("ok_route", "ok_department", "ok_facts", "ok_safe"))
    return res


async def main(runs: int, only: str | None) -> None:
    cases = [c for c in CASES if not only or c["id"] in only.split(",")]
    all_runs = []
    for r in range(runs):
        results = []
        for c in cases:
            try:
                results.append(await one(c))
            except Exception as e:  # keep going; the report shows it
                results.append({"id": c["id"], "text": c["text"], "expected": c["route"], "route": "error", "why": str(e)[:200], "ok": False,
                                "ok_route": False, "ok_department": False, "ok_facts": False, "ok_language": False, "ok_safe": True, "seconds": 0})
            print(f"run {r + 1} {c['id']}: {'OK ' if results[-1]['ok'] else 'BAD'} {results[-1]['route']:<9} {c['text'][:60]}", flush=True)
        all_runs.append(results)
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    out_dir = ROOT / "evals" / "reports"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"lead_responder-{stamp}.json").write_text(json.dumps({"runs": all_runs, "tokens": TOKENS}, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    lines = [f"# Lead Responder — live evaluation {stamp}", "", f"Model: {llm.config.model_small} (policy: {llm.config.model_safeguard}). Cases: {len(cases)}. Runs: {runs}.", ""]
    for k, label in [("ok", "All checks"), ("ok_route", "Right route"), ("ok_department", "Right department"), ("ok_facts", "Right facts in the reply"),
                     ("ok_language", "Right language"), ("ok_safe", "Safe")]:
        scores = [sum(1 for x in rr if x[k]) for rr in all_runs]
        lines.append(f"- **{label}:** {statistics.mean(scores):.1f} / {len(cases)}" + (f" (runs: {', '.join(map(str, scores))})" if runs > 1 else ""))
    secs = [x["seconds"] for rr in all_runs for x in rr if x.get("seconds")]
    if secs:
        lines.append(f"- **Time per message:** median {statistics.median(secs):.1f} s, slowest {max(secs):.1f} s")
    lines.append(f"- **Tokens:** {TOKENS['in'] + TOKENS['out']:,} in {TOKENS['calls']} calls")
    lines += ["", "## Cases that failed", "", "| Case | Message | Expected | Got | Why | Reply |", "|---|---|---|---|---|---|"]
    for rr in all_runs:
        for x in rr:
            if not x["ok"]:
                lines.append(f"| {x['id']} | {x['text'][:50]} | {x['expected']} | {x['route']} {x.get('department') or ''} | {(x.get('why') or '')[:60]} | {(x.get('reply') or x.get('blocked_reply') or '')[:80]} |")
    (out_dir / f"lead_responder-{stamp}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines[:12]))
    print(f"\nReport: evals/reports/lead_responder-{stamp}.md")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--runs", type=int, default=1)
    p.add_argument("--only", help="comma-separated case ids")
    p.add_argument("--fake", action="store_true")
    a = p.parse_args()
    offline()
    if a.fake:
        fake_model()
    elif not os.environ.get("GROQ_API_KEY"):
        sys.exit("Set GROQ_API_KEY (or put it in agents/.env.local).")
    asyncio.run(main(a.runs, a.only))
