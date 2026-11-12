"""
A person's verdict on what an agent did or would have done.

In shadow mode an agent writes its message but sends nothing. Here the person reading it says: good (send it as
it is), edited (send my better version), or wrong (don't send). The verdicts are the agent's accuracy score, the
better versions and notes become its lessons, and the lead still gets an answer today.
"""

from __future__ import annotations

from typing import Any

from . import actions, limits, nexmarket
from .act import guard
from .guard.check import GuardRequest

# What NexMarket says when it refuses a send, in plain words for the reviewer.
REFUSED = {
    "window_closed": "It's more than 24 hours since they last wrote, so WhatsApp no longer allows a free reply. Use the follow-up template from the lead.",
    "desk_replied": "Someone at the desk has already replied to this lead.",
    "opted_out": "They asked not to get WhatsApp messages.",
    "whatsapp_paused": "WhatsApp sending is paused (WhatsApp → Automation).",
    "already_sent": "This camp already has an invitation broadcast.",
    "block_had_broadcast_this_week": "The partners of this block already got a broadcast in the last 7 days.",
    "camp_not_open": "The camp is over or cancelled.",
    "nobody": "Nobody in this block can receive WhatsApp broadcasts.",
    "whatsapp_not_connected": "WhatsApp is not connected yet.",
}
VERDICTS = ("good", "edited", "wrong")
# What "send" does for each kind a person can release from a review, and in which state the entry must be:
# a lead reply drafted in shadow goes to the lead; a camp broadcast held for approval is scheduled.
SENDABLE = {"lead_reply": ("lead", "shadow"), "camp_broadcast": ("camp", "held")}
# Kinds whose wording a person may change (the others are approved templates).
EDITABLE = {"lead_reply", "content_draft"}


class ReviewError(Exception):
    def __init__(self, message: str, status: int = 400, issues: list[dict[str, Any]] | None = None) -> None:
        super().__init__(message)
        self.status, self.issues = status, issues or []


async def review(action_id: str, *, by: str, verdict: str, text: str | None = None, note: str | None = None,
                 send: bool = False, remember: bool = False) -> dict[str, Any]:
    from .agents.base import runtime

    a = await actions.get(action_id)
    if a is None:
        raise ReviewError("That entry isn't in the log any more.", 404)
    if a.get("reviewed_at"):
        raise ReviewError(f"Already checked by {a.get('reviewed_by') or 'someone'}.", 409)
    if verdict not in VERDICTS:
        raise ReviewError("Say whether it was good, needed editing, or was wrong.")
    draft = str((a.get("detail") or {}).get("text") or "").strip()
    final = (text or "").strip() if verdict == "edited" else draft
    if verdict == "edited" and (not final or final == draft):
        raise ReviewError("Write the better version first.")
    if verdict == "edited" and a["kind"] not in EDITABLE:
        raise ReviewError("This wording is an approved template and can't be changed here.")
    note = (note or "").strip()[:400] or None
    if remember and not note:
        raise ReviewError("Write the lesson to remember, in one sentence.")

    result: dict[str, Any] = {"sent": False}
    if send and verdict != "wrong":
        subject_type, state = SENDABLE.get(a["kind"], ("", ""))
        if not subject_type or a.get("subject_type") != subject_type or not final:
            raise ReviewError("This entry can't be sent from here.")
        if a["status"] != state:
            raise ReviewError("This was a practice run, so it can't be sent from here." if a["status"] == "shadow" else "Only something that wasn't sent yet can be sent from here.")
        if (await limits.stop_all_state()).get("on"):
            raise ReviewError("All agents are stopped. Resume them first, or reply from the lead yourself.")
        # A person owns this text, so only the fixed rules are checked (numbers, links, claims, times against the records).
        g = await guard(GuardRequest(text=final, channel=a.get("channel") or "whatsapp", audience="patient", sources=a.get("sources") or [],
                                     rules_only=True, allow_rewrite=False))
        if g.outcome != "pass":
            raise ReviewError("The Compliance Guard stopped this text: " + "; ".join(str(i.get("message")) for i in g.issues[:3]), 422, g.issues)
        subject_id = str(a["subject_id"])
        try:
            if a["kind"] == "camp_broadcast":
                sent = await nexmarket.broadcast_camp(subject_id, agent_id=a["agent_id"])
                summary = f"Camp invitation scheduled to {sent.get('recipients', '?')} partners after {by} approved it"
            else:
                sent = await nexmarket.lead_reply(subject_id, final, agent_id=a["agent_id"])
                summary = f"Sent after {by} checked it" + (" and edited it" if verdict == "edited" else "")
            result = {"sent": True, "status": sent.get("status")}
            await actions.record(a["agent_id"], a["kind"], "done", summary, subject=(subject_type, subject_id), channel=a.get("channel"),
                                 detail={"text": final, "reviewOf": str(a["id"])}, sources=a.get("sources") or [])
        except nexmarket.NexMarketError as e:
            reason = next((v for k, v in REFUSED.items() if k in str(e)), "NexMarket didn't accept it. Do it from the CRM page instead.")
            result = {"sent": False, "reason": reason}

    lesson = None
    if remember and note:
        lesson = await runtime.add_lesson(a["agent_id"], note, by, source=f"review:{a['id']}")
    await actions.set_review(a["id"], {"verdict": verdict, "text": final if verdict == "edited" else None, "note": note,
                                       "sent": result.get("sent", False), "lesson": lesson}, by)
    return {"ok": True, **result, "lesson": lesson}


def score(counts: dict[str, int]) -> dict[str, Any]:
    """good ÷ everything checked, as a percentage; None until at least one draft has been checked."""
    good, edited, wrong = counts.get("good", 0), counts.get("edited", 0), counts.get("wrong", 0)
    total = good + edited + wrong
    return {"good": good, "edited": edited, "wrong": wrong, "checked": total, "percent": round(100 * good / total) if total else None}
