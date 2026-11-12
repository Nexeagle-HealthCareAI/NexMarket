"""
Vita · Social Publisher — posts the drafts a person approved, on the hospital's Facebook page.

    10 am and 6 pm → the oldest draft a person marked good (or edited) in the last 7 days, not yet posted
      → not past its date (a camp that is over is skipped) → the Guard's rules once more on the final text
      → published on the Facebook page, and added to the Social page of the CRM

At most 2 posts a day, one per run. It publishes only what a person approved: there is no path from the AI's draft
to the page without a person's "good". Text posts on Facebook only: Instagram needs a picture, which Vita does
not make.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any

from .. import act, db, limits, nexmarket
from ..limits import IST

log = logging.getLogger("nexagents.social_publisher")

AGENT_ID = "social_publisher"
PER_DAY = 2
MAX_TRIES = 2


async def _mark(action_id: Any, patch: str) -> None:
    await db.execute("UPDATE agents.actions SET review = review || %s::jsonb WHERE id = %s", patch, action_id)


async def tick(today: date | None = None) -> dict[str, int]:
    out = {"published": 0, "shadow": 0, "skipped": 0}
    v = await limits.gate(AGENT_ID, outgoing=False)
    if not v.allowed:
        return out
    today = today or db.now().astimezone(IST).date()
    rows = await db.fetch(
        "SELECT id, detail, review, sources, subject_type, subject_id FROM agents.actions WHERE agent_id = 'content_writer' AND kind = 'content_draft' AND status = 'held' "
        "AND review->>'verdict' IN ('good', 'edited') AND reviewed_at > now() - interval '7 days' AND NOT (review ? 'published') "
        "AND coalesce((review->>'tries')::int, 0) < %s ORDER BY reviewed_at LIMIT 10", MAX_TRIES)
    for a in rows:
        expires = str((a["detail"] or {}).get("expires") or "")
        if expires and expires < today.isoformat():
            await _mark(a["id"], '{"published": "expired"}')
            out["skipped"] += 1
            continue
        text = str((a["review"] or {}).get("text") or (a["detail"] or {}).get("text") or "").strip()
        if not text:
            continue

        async def do_send(t: str) -> dict[str, Any]:
            return await nexmarket.social_publish(t, agent_id=AGENT_ID)

        sent_today = await limits.count_today(AGENT_ID, ["social_post"])
        subject = (a["subject_type"], a["subject_id"]) if a["subject_type"] else None
        res = await act.outgoing(AGENT_ID, kind="social_post", channel="facebook", audience="public", text=text, rules_only=True, cap=(sent_today, PER_DAY),
                                 summary="Published an approved post on the Facebook page", send=do_send, subject=subject, sources=a["sources"] or [])
        if res.get("sent"):
            await _mark(a["id"], '{"published": "yes"}')
            out["published"] += 1
        elif res.get("shadow"):
            await _mark(a["id"], '{"published": "practice"}')
            out["shadow"] += 1
        elif res.get("reason") in ("failed", "guard"):
            tries = int((a["review"] or {}).get("tries") or 0) + 1
            await _mark(a["id"], f'{{"tries": {tries}}}')
            out["skipped"] += 1
        break  # one post per run, whatever happened: the next slot takes the next one
    return out
