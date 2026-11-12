"""
Vita · Reputation — thanks people for good Google reviews, and brings low ones to a person.

No AI, and the review's words never leave NexMarket: this agent is told only the stars, the date and which
script the review is written in.

    every 30 minutes, 9 am to 8 pm → reviews without a reply
      4 or 5 stars → a short thank-you in fixed wording (Hindi, Bangla or English, to match the review),
                     checked by the Guard's rules, posted on Google. At most 10 a day.
      3 stars or fewer → never answered by Vita. One Team board card and one alert, so a person replies personally.

The thank-you never says anything about illness, treatment, staff by name or bills, and never confirms that the
reviewer was a patient.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import timedelta
from typing import Any

from .. import act, actions, db, limits, nexmarket

log = logging.getLogger("nexagents.reputation")

AGENT_ID = "reputation"
PER_DAY = 10
PER_RUN = 5

THANKS: dict[str, list[str]] = {
    "hi": [
        "आपके अच्छे शब्दों के लिए बहुत धन्यवाद। आपका भरोसा हमारे लिए बहुत मायने रखता है।",
        "समय निकालकर अपनी राय लिखने के लिए धन्यवाद। हम इसी तरह सेवा करते रहने की कोशिश करेंगे।",
        "आपकी सराहना के लिए हार्दिक धन्यवाद। आपकी शुभकामनाएँ हमारी पूरी टीम तक पहुँचा दी गई हैं।",
        "धन्यवाद। आपकी राय से हमें और बेहतर करने का हौसला मिलता है।",
    ],
    "bn": [
        "আপনার সুন্দর কথার জন্য অনেক ধন্যবাদ। আপনার আস্থা আমাদের কাছে খুব মূল্যবান।",
        "সময় করে মতামত লেখার জন্য ধন্যবাদ। আমরা এভাবেই সেবা দিয়ে যাওয়ার চেষ্টা করব।",
        "আপনার প্রশংসার জন্য আন্তরিক ধন্যবাদ। আপনার শুভেচ্ছা আমাদের পুরো দলকে জানানো হয়েছে।",
    ],
    "en": [
        "Thank you very much for your kind words. Your trust means a great deal to us.",
        "Thank you for taking the time to share your feedback. We will keep working to serve you well.",
        "We are grateful for your appreciation. Your good wishes have been passed on to our whole team.",
        "Thank you. Feedback like yours encourages us to keep improving.",
    ],
}


def thank_you(review_id: str, language: str) -> str:
    """One of the fixed thank-yous, chosen by the review's id so replies vary but the same review always gets the same one."""
    options = THANKS.get(language) or THANKS["hi"]
    return options[int(hashlib.sha256(review_id.encode()).hexdigest(), 16) % len(options)]


async def _handled(review_id: str, kind: str) -> bool:
    row = await db.fetchone("SELECT count(*) AS n FROM agents.actions WHERE agent_id = %s AND kind = %s AND subject_type = 'review' AND subject_id = %s "
                            "AND status IN ('done', 'shadow', 'blocked') AND created_at > %s", AGENT_ID, kind, review_id, db.now() - timedelta(days=45))
    return bool(row and row["n"] > 0)


async def tick() -> dict[str, int]:
    out = {"thanked": 0, "shadow": 0, "low": 0}
    v = await limits.gate(AGENT_ID, outgoing=False)
    if not v.allowed:
        return out
    try:
        reviews = (await nexmarket.reviews_unanswered()).get("items", [])
    except Exception as e:
        log.warning("reputation: NexMarket not reachable: %s", e)
        return out
    live = (await limits.agent_state(AGENT_ID)).get("mode") == "live"
    done = 0
    stop_thanks = False
    for r in reviews:
        rid, stars = str(r.get("id")), int(r.get("stars") or 0)
        if stars <= 0:
            continue
        if stars <= 3:
            if await _handled(rid, "review_low"):
                continue
            if live:
                try:
                    await nexmarket.board_card(f"A {stars}-star Google review needs a personal reply",
                                               "Reply from Google → Reviews in the CRM. Vita does not answer low ratings itself: this needs a person who can look into what happened.",
                                               agent_id=AGENT_ID, priority="high", labels=["Review"])
                    await nexmarket.notify_team(f"A {stars}-star Google review came in", "Please reply to it personally from Google → Reviews.", "google", agent_id=AGENT_ID)
                except Exception:
                    log.exception("could not raise a low review")
                    continue
            await actions.record(AGENT_ID, "review_low", "done" if live else "shadow", f"Brought a {stars}-star review to a person", subject=("review", rid))
            out["low"] += 1
            continue
        if stop_thanks or done >= PER_RUN or await _handled(rid, "review_reply"):
            continue
        text = thank_you(rid, str(r.get("language") or "hi"))

        async def do_send(t: str, rid: str = rid) -> dict[str, Any]:
            return await nexmarket.review_reply(rid, t, agent_id=AGENT_ID)

        sent_today = await limits.count_today(AGENT_ID, ["review_reply"])
        res = await act.outgoing(AGENT_ID, kind="review_reply", channel="google_review", audience="public", text=text, rules_only=True, cap=(sent_today, PER_DAY),
                                 summary=f"Thanked a {stars}-star Google review", send=do_send, subject=("review", rid))
        if res.get("sent"):
            out["thanked"] += 1
            done += 1
        elif res.get("shadow"):
            out["shadow"] += 1
            done += 1
        elif "limit" in str(res.get("reason") or "").lower() or "quiet" in str(res.get("reason") or "").lower():
            stop_thanks = True  # no more thank-yous this run; low reviews further down the list are still raised
    return out
