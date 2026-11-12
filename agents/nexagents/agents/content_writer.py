"""
Vita · Content Writer — drafts posts from the hospital's own records. Drafts only.

    9:30 am → what is worth a post?
        each camp in the next 7 days that has no draft yet
        on Mondays, the OPD days of one department (a different one each week)
      → the AI writes a short Facebook post in Hindi from that record's facts and nothing else
      → the Compliance Guard checks every day, date, time and claim against the record
      → the draft waits in Activity → To check. A person marks it good, edits it, or marks it wrong.

A draft a person marked good (or edited) is what the Social Publisher may post. The Content Writer never posts,
and nothing about any patient reaches it: it reads only departments, doctors' OPD days and camps.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from .. import act, actions, db, limits, llm, nexmarket
from ..guard.check import GuardRequest
from ..limits import IST
from .lead_responder import _sources_for_guard

log = logging.getLogger("nexagents.content_writer")

AGENT_ID = "content_writer"
PER_RUN = 2


class Draft(BaseModel):
    text: str = Field(description="The post, in Hindi (Devanagari), 40 to 90 words, ready to publish on Facebook.")


SYSTEM = """You write Facebook posts for a hospital in Bihar, India. Write in simple, warm Hindi (Devanagari script)
that a villager understands. 40 to 90 words.

You are given ONE record (a health camp, or a department's doctors and OPD days) and the hospital's facts.

Rules:
- Every day, date, time, place, doctor's name and phone number must be copied exactly from the record or the facts.
  Never add one that is not there.
- No promises of cure or results, no "best", "no. 1", "100%", "guaranteed". No prices, discounts or offers unless
  the record itself says the camp is free.
- Never give medical advice or name medicines. You may say who the camp or OPD is for in plain words.
- No patient stories. No hashtags beyond two. One or two emojis at most.
- End with how to reach the hospital, using only a phone number from the facts if one is given.

Things to do better (lessons from people's corrections):
{lessons}

Hospital facts:
{facts}"""


def topics(directory: dict[str, Any], today: date) -> list[dict[str, Any]]:
    """What deserves a draft today, most urgent first."""
    out: list[dict[str, Any]] = []
    for c in directory.get("camps", []):
        try:
            when = date.fromisoformat(str(c.get("date"))[:10])
        except ValueError:
            continue
        if today <= when <= today + timedelta(days=7):
            out.append({"subject": ("camp", str(c["id"])), "source": f"camp:{c['id']}", "label": f"the camp “{c.get('title')}”", "expires": when.isoformat(),
                        "record": {k: c.get(k) for k in ("title", "type", "date", "start", "end", "venue", "block", "departments")}})
    if today.weekday() == 0:
        with_docs = [d for d in directory.get("departments", []) if any(x.get("department") == d.get("name") and x.get("opdDays") for x in directory.get("doctors", []))]
        if with_docs:
            dep = with_docs[today.isocalendar().week % len(with_docs)]
            docs = [x for x in directory.get("doctors", []) if x.get("department") == dep.get("name") and x.get("opdDays")]
            out.append({"subject": ("department", str(dep["id"])), "source": f"department:{dep['id']}", "label": f"the {dep.get('name')} OPD days",
                        "expires": (today + timedelta(days=7)).isoformat(), "also": [f"doctor:{x['id']}" for x in docs],
                        "record": {"department": dep.get("name"), "doctors": [{k: x.get(k) for k in ("name", "qualification", "opdDays", "opdTimings")} for x in docs]}})
    return out


async def _drafted(subject: tuple[str, str]) -> bool:
    row = await db.fetchone("SELECT count(*) AS n FROM agents.actions WHERE agent_id = %s AND kind = 'content_draft' AND subject_type = %s AND subject_id = %s "
                            "AND created_at > %s", AGENT_ID, subject[0], subject[1], db.now() - timedelta(days=6 if subject[0] == "department" else 14))
    return bool(row and row["n"] > 0)


async def tick(today: date | None = None) -> dict[str, int]:
    out = {"drafts": 0, "blocked": 0}
    v = await limits.gate(AGENT_ID, outgoing=False)
    if not v.allowed:
        return out
    from .base import runtime

    try:
        directory = await nexmarket.directory()
    except Exception as e:
        log.warning("content writer: NexMarket not reachable: %s", e)
        return out
    live = (await limits.agent_state(AGENT_ID)).get("mode") == "live"
    facts = (await limits.get_setting("facts")) or {}
    lessons = await runtime.lessons(AGENT_ID)
    today = today or db.now().astimezone(IST).date()
    for t in topics(directory, today):
        if out["drafts"] + out["blocked"] >= PER_RUN:
            break
        if await _drafted(t["subject"]):
            continue
        try:
            d: Draft = await llm.chat(llm.Call(agent_id=AGENT_ID, tier="small", schema=Draft),
                                      [SystemMessage(SYSTEM.format(lessons="\n".join(f"- {x['text']}" for x in lessons) or "- (none yet)", facts=facts.get("text") or "(none)")),
                                       HumanMessage("Today is " + datetime.combine(today, datetime.min.time()).strftime("%A %d %B %Y") + ".\nRecord:\n"
                                                    + json.dumps(t["record"], ensure_ascii=False, default=str))])
        except (llm.ModelUnavailable, llm.BudgetExceeded) as e:
            log.warning("Content Writer could not use the AI: %s", e)
            return out
        sources = _sources_for_guard([t["source"], *t.get("also", [])], directory)
        req = GuardRequest(text=d.text.strip(), channel="facebook", audience="public", sources=sources, from_agent=AGENT_ID)
        g = await act.guard(req)
        await act.log_guard(g, req)
        if g.outcome != "pass":
            await actions.record(AGENT_ID, "content_draft", "blocked", f"A draft about {t['label']} was stopped by the Guard", subject=t["subject"], channel="facebook",
                                 detail={"text": d.text.strip(), "practice": True}, sources=sources, reasons=g.issues)
            out["blocked"] += 1
            continue
        # Live: the draft waits for a person and can then be published. Shadow: a practice draft, never published.
        await actions.record(AGENT_ID, "content_draft", "held" if live else "shadow", f"Draft post about {t['label']}: check it before it is published",
                             subject=t["subject"], channel="facebook", detail={"text": g.text, "expires": t["expires"]}, sources=sources)
        out["drafts"] += 1
    return out
