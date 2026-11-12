"""
Vita · Lead Responder — answers what a new lead actually asked on WhatsApp, from live records only.

NexMarket already sends a fixed instant reply ("thanks, we got your message"), applies keyword replies and shares
leads among the desk. The Lead Responder does the next step a person would do: reads the question and answers it
(which doctor, which days, OPD timings, the next camp), sets the lead's department, and hands anything it shouldn't
answer to a person.

    event → wait (3 min in office hours, so the desk can answer first) → checks → triage (rules, no AI)
          → decide (AI, typed answer) → verify (department, sources) → Compliance Guard → send or hand over

Never answers: prices, complaints, reports or medical questions (a person does). Emergencies are caught by rules
before any AI and get a fixed message plus an urgent alert. The AI sees the question with names, numbers and
addresses removed, never the lead's name or phone.
"""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

from .. import actions, act, blackboard, db, limits, llm, nexmarket
from ..limits import IST
from ..privacy import redact

log = logging.getLogger("nexagents.lead_responder")

AGENT_ID = "lead_responder"
TASK_KIND = "lead.message"
DESK_WAIT = timedelta(minutes=3)

Intent = Literal["doctor_timing", "department", "camp", "location_contact", "appointment", "price", "report", "complaint",
                 "medical_advice", "greeting", "other"]
# Intents a person must handle; Vita never writes the answer.
HANDOFF_INTENTS = {"appointment", "price", "report", "complaint", "medical_advice"}


# ─── Triage: plain rules, before any AI ───────────────────────────────────────

def _rx(*parts: str) -> re.Pattern[str]:
    return re.compile("|".join(parts), re.I | re.U)


B, E = r"(?<![\wऀ-৿])", r"(?![\wऀ-৿])"
# A few words may sit between the parts ("seene me bahut tej dard", "chest pain", "chest me pain").
GAP = r"[^.!?\n]{0,25}?"
EMERGENCY = _rx(
    B + r"(heart attack|unconscious|not breathing|can'?t breathe|breathless|bleeding (a lot|heavily|badly|too much)|heavy bleeding|"
    r"accident|snake ?bite|poison(ed|ing)?|seizure|fits|convulsion|stroke|paraly[sz]ed|burn(t|ed)? badly|suicid\w*|kill (my|him|her)self|"
    r"behosh|be-hosh|zeher|jahar|mirgi|labou?r pain|emergency)" + E,
    B + r"chest" + GAP + r"pain", B + r"(seene|sine|chhati|chati)" + GAP + r"(dard|pain)",
    B + r"saa?ns?" + GAP + r"(nahi|nahin|nhi|ruk|phool|taklee?f|dikkat|problem)", B + r"(breath|breathing)" + GAP + r"(problem|difficult|trouble)",
    B + r"khoo?n" + GAP + r"(beh|nikal|ruk nahi)", B + r"saa?np" + GAP + r"(kaat|kata|kat li)", B + r"daura" + GAP + r"(pad|aa)",
    r"बेहोश|ज़हर|जहर|मिर्गी|एक्सीडेंट|दुर्घटना|आत्महत्या|इमरजेंसी",
    r"(सीने|छाती)" + GAP + r"दर्द", r"(सांस|साँस|श्वास)" + GAP + r"(नहीं|रुक|फूल|तकलीफ|दिक्कत)", r"खून" + GAP + r"(बह|निकल)",
    r"(सांप|साँप)" + GAP + r"काट", r"दौरा" + GAP + r"पड़",
    r"অজ্ঞান|বিষ খে|দুর্ঘটনা|জরুরি|বুকে" + GAP + r"ব্যথা|শ্বাস" + GAP + r"(পারছে না|কষ্ট)|রক্ত" + GAP + r"পড়ছে|সাপে" + GAP + r"কেটেছে",
)
# Things that look like an emergency word but aren't one in a hospital enquiry ("heart check-up camp", "emergency number?").
NOT_EMERGENCY = _rx(r"emergency (number|no\.?|contact|ward timing|open|khula|khuli|available|service|department|ward|kab|timing)", r"heart (check|camp|doctor)",
                    r"(chest|heart) (specialist|doctor) (kab|when|kaun)", r"accident (insurance|claim)", r"poison(ous)? (plant|food) (camp|awareness)")
# Money: price, fees, costs, insurance. "kitne baje" (what time) is NOT money; "kitna lagega/kharcha" is.
PRICE = _rx(B + r"(price|cost|costs|fees?|charges?|rate|paisa|paise|rupees?|rupay\w*|rs\.?|kharch\w*|discount|ayushman|insurance|bill|payment|"
            r"kitn[aei] (lagega|lagegi|lagta|lagti|paisa|paise|rupay\w*|kharch\w*|fees?|charge\w*))" + E, r"₹\s?\d",
            r"शुल्क|फीस|खर्च|पैसे|रुपये|रुपए|आयुष्मान|कितना लगेगा|कितने पैसे", r"দাম|খরচ|ফি|টাকা|কত লাগবে")
COMPLAINT = _rx(B + r"(complain\w*|shikayat|refund|bad (service|experience|behaviou?r)|rude|badtameez\w*|galat (ilaj|treatment|dawa)|bekar|worst|cheat\w*|fraud|negligen\w*)" + E,
                r"शिकायत|बदतमीज|लापरवाह|অভিযোগ")
REPORT = _rx(B + r"(report|result|test result|x-?ray|scan report|discharge (paper|summary)|prescription)" + E, r"रिपोर्ट|রিপোর্ট")
MEDIA = re.compile(r"^(🎤 Voice message|📷 Photo|🎥 Video|📄 .*|📍 Location.*|Sticker|👤 Shared a contact|\(.*\))$")


class Triage(BaseModel):
    emergency: bool = False
    handoff: str | None = None   # why a person must take it, before any AI
    media_only: bool = False


def triage(texts: list[str]) -> Triage:
    joined = "\n".join(t for t in texts if t)
    if texts and all(MEDIA.match(t.strip()) for t in texts if t):
        return Triage(media_only=True, handoff="sent a voice note, photo or file Vita can't read")
    if EMERGENCY.search(joined) and not NOT_EMERGENCY.search(joined):
        return Triage(emergency=True, handoff="may be an emergency")
    if COMPLAINT.search(joined):
        return Triage(handoff="a complaint")
    if PRICE.search(joined):
        return Triage(handoff="asked about price, fees or insurance")
    if REPORT.search(joined):
        return Triage(handoff="asked about a report or result")
    return Triage()


# ─── The AI's typed answer ────────────────────────────────────────────────────

class Decision(BaseModel):
    intent: Intent = Field(description="What the person wants.")
    language: Literal["hi", "en", "hinglish", "bn"] = Field(description="The language the person wrote in.")
    department: str | None = Field(default=None, description="Exactly one department name from the list, or null.")
    reply: str | None = Field(default=None, description="The WhatsApp reply, in the person's language, or null when a person must answer.")
    sources: list[str] = Field(default_factory=list, description="Record ids the reply relies on: doctor:<id>, camp:<id>, department:<id>, facts.")
    needs_person: str | None = Field(default=None, description="What a person must do or decide, or null.")
    callback_time: str | None = Field(default=None, description="For an appointment: the day or time the person said suits them, in their own words, or null.")


SYSTEM = """\
You are Vita, the hospital's WhatsApp assistant. A person wrote to the hospital. You answer ONLY what they asked,
using ONLY the HOSPITAL RECORDS and FACTS below. Today is {today}.

Rules:
- Facts (doctor names, days, timings, dates, places, phone numbers) must be copied from the records. Never guess.
  If the records don't answer the question, set reply to null and say what is missing in needs_person.
- Never give medical advice, never say what an illness is or what to take. For that, intent = medical_advice, reply = null.
- Never mention prices, fees, discounts, insurance. intent = price, reply = null.
- Booking an appointment: intent = appointment, reply = null (the desk confirms it). If they said which day or time
  suits them, copy their words into callback_time; never choose a time for them.
- Reply in the person's language and script: Hindi (Devanagari), Hinglish (Roman Hindi), Bangla or English.
- Short: 1 to 4 lines, polite, no "best", no promises, at most one emoji. Do not greet again if the hospital already greeted them.
- department: the one department their question is about, copied exactly from the list, or null.
- sources: the ids of every record your reply used (doctor:<id>, camp:<id>, department:<id>), or "facts" for the facts pack.

HOSPITAL RECORDS (JSON):
{directory}

FACTS PACK:
{facts}

CHECKED LESSONS:
{lessons}
"""


def _compact_directory(d: dict[str, Any]) -> dict[str, Any]:
    return {
        "departments": [{"id": x["id"], "name": x["name"]} for x in d.get("departments", [])],
        "doctors": [{k: x.get(k) for k in ("id", "name", "department", "qualification", "opdDays", "opdTimings")} for x in d.get("doctors", [])],
        "camps": [{k: x.get(k) for k in ("id", "title", "type", "date", "start", "end", "venue", "block", "departments", "doctors")} for x in d.get("camps", [])],
    }


def _sources_for_guard(ids: list[str], directory: dict[str, Any]) -> list[dict[str, Any]]:
    """The records the reply relies on, as facts the Guard checks every time, day and date against."""
    by_id: dict[str, tuple[str, dict[str, Any]]] = {}
    for d in directory.get("doctors", []):
        by_id[f"doctor:{d['id']}"] = ("doctor", {"name": d.get("name"), "department": d.get("department"), "opd days": d.get("opdDays"), "opd timings": d.get("opdTimings")})
    for c in directory.get("camps", []):
        when = c.get("date")
        try:
            dt = datetime.fromisoformat(str(when))
            when = f"{dt.strftime('%A')} {dt.day} {dt.strftime('%b')} {dt.strftime('%B')} {dt.strftime('%d/%m')}"
        except ValueError:
            pass
        by_id[f"camp:{c['id']}"] = ("camp", {"title": c.get("title"), "date": when, "time": f"{_t(c.get('start'))} to {_t(c.get('end'))}", "venue": c.get("venue"), "block": c.get("block")})
    for x in directory.get("departments", []):
        by_id[f"department:{x['id']}"] = ("department", {"name": x.get("name")})
    out = []
    for i in ids:
        if i in by_id:
            kind, facts = by_id[i]
            out.append({"type": kind, "id": i.split(":", 1)[1], "facts": facts})
    return out


def _t(hhmm: Any) -> str:
    """"14:00" → "2:00 pm 14:00" so either way of writing the time matches."""
    try:
        h, m = [int(x) for x in str(hhmm).split(":")[:2]]
    except ValueError:
        return str(hhmm)
    ap = "am" if h < 12 else "pm"
    h12 = h % 12 or 12
    return f"{h12}:{m:02d} {ap} {h12} {ap} {hhmm}"


# ─── The pipeline ─────────────────────────────────────────────────────────────

class State(TypedDict, total=False):
    lead_id: str
    task_at: str
    ctx: dict[str, Any]
    directory: dict[str, Any]
    texts: list[str]
    triage: Triage
    decision: Decision | None
    outcome: str
    detail: dict[str, Any]


def _in_office(directory: dict[str, Any] | None, now: datetime | None = None) -> bool:
    oh = (directory or {}).get("officeHours") or {}
    if oh.get("on") is False:
        return True  # NexMarket: office hours not set means the desk counts as always working
    t = (now or db.now()).astimezone(IST)
    days = oh.get("days") or [1, 2, 3, 4, 5, 6]
    if (t.isoweekday() % 7) not in days:  # NexMarket counts 0 = Sunday … 6 = Saturday
        return False
    start, end = oh.get("start") or "09:00", oh.get("end") or "18:00"
    hm = t.strftime("%H:%M")
    return start <= hm < end


def wait_for(directory: dict[str, Any] | None, *, emergency: bool, now: datetime | None = None) -> timedelta:
    """In office hours the desk gets 3 minutes to answer first; outside office hours, and for emergencies, no wait."""
    if emergency:
        return timedelta(0)
    return DESK_WAIT if _in_office(directory, now) else timedelta(0)


def new_inbound(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The person's messages since anyone (desk or Vita) last answered them. Automatic instant replies don't count."""
    out: list[dict[str, Any]] = []
    for m in reversed(messages):
        if m.get("direction") == "out" and m.get("by") in ("desk", "vita"):
            break
        if m.get("direction") == "in":
            out.append(m)
    return list(reversed(out))


async def load(state: State) -> State:
    ctx = await nexmarket.lead_context(state["lead_id"])
    directory = await nexmarket.directory()
    return {"ctx": ctx, "directory": directory}


async def check(state: State) -> State:
    """Plain reasons not to answer at all. Each one is logged."""
    lead = state["ctx"]["lead"]
    msgs = state["ctx"].get("messages", [])
    v = await limits.gate(AGENT_ID, outgoing=False)
    if not v.allowed:
        return {"outcome": "skip:" + (v.rules[0] if v.rules else "not_allowed")}
    if lead.get("optOut"):
        return {"outcome": "skip:opted_out"}
    if not lead.get("windowOpen"):
        return {"outcome": "skip:window_closed"}
    if state["ctx"].get("whatsapp", {}).get("paused"):
        return {"outcome": "skip:whatsapp_paused"}
    fresh = new_inbound(msgs)
    if not fresh:
        return {"outcome": "skip:already_answered"}
    texts = [str(m.get("text") or "") for m in fresh][-5:]
    return {"texts": texts}


def after_check(state: State) -> str:
    return END if state.get("outcome") else "triage"


async def triage_node(state: State) -> State:
    return {"triage": triage(state["texts"])}


def after_triage(state: State) -> str:
    t = state["triage"]
    if t.emergency:
        return "emergency"
    if t.handoff:
        return "handoff"
    return "decide"


async def decide(state: State) -> State:
    facts = (await limits.get_setting("facts")) or {}
    from .base import runtime

    lessons = await runtime.lessons(AGENT_ID)
    now_ist = db.now().astimezone(IST)
    system = SYSTEM.format(
        today=now_ist.strftime("%A %d %B %Y, %I:%M %p IST"),
        directory=json.dumps(_compact_directory(state["directory"]), ensure_ascii=False, default=str),
        facts=facts.get("text") or "(empty)",
        lessons="\n".join(f"- {x['text']}" for x in lessons) or "- (none yet)",
    )
    convo = []
    for m in state["ctx"].get("messages", [])[-8:]:
        who = {"person": "PERSON", "desk": "HOSPITAL STAFF", "vita": "VITA", "auto": "HOSPITAL (automatic)"}.get(m.get("by"), "HOSPITAL")
        convo.append(f"{who}: {redact(str(m.get('text') or ''))}")
    try:
        d: Decision = await llm.chat(llm.Call(agent_id=AGENT_ID, tier="small", priority=0, schema=Decision),
                                     [SystemMessage(system), HumanMessage("Conversation so far, oldest first:\n" + "\n".join(convo))])
    except (llm.ModelUnavailable, llm.BudgetExceeded) as e:
        log.warning("Lead Responder could not use the AI: %s", e)
        why = "Vita's AI isn't reachable right now" if isinstance(e, llm.ModelUnavailable) else "Vita used up today's AI allowance"
        return {"decision": None, "outcome": "handoff", "detail": {"why": why}}
    return {"decision": verify(d, state["directory"])}


def verify(d: Decision, directory: dict[str, Any]) -> Decision:
    """The AI's answer, made safe: real department only, real record ids only, no reply where a person must answer."""
    names = {x["name"].lower(): x["name"] for x in directory.get("departments", [])}
    dep = names.get((d.department or "").strip().lower())
    valid = {f"doctor:{x['id']}" for x in directory.get("doctors", [])} | {f"camp:{x['id']}" for x in directory.get("camps", [])} \
        | {f"department:{x['id']}" for x in directory.get("departments", [])} | {"facts"}
    sources = [s for s in d.sources if s in valid]
    reply = (d.reply or "").strip() or None
    needs = d.needs_person
    if d.intent in HANDOFF_INTENTS:
        needs = needs or {"appointment": "wants an appointment", "price": "asked about price", "report": "asked about a report",
                          "complaint": "has a complaint", "medical_advice": "asked a medical question"}[d.intent]
        reply = None
    if reply and not sources and d.intent not in ("greeting",):
        # A factual answer with no record behind it is not sent.
        needs, reply = needs or "the answer wasn't in the hospital records", None
    callback = (d.callback_time or "").strip()[:80] or None if d.intent == "appointment" else None
    return d.model_copy(update={"department": dep, "sources": sources, "reply": reply, "needs_person": needs, "callback_time": callback})


def after_decide(state: State) -> str:
    if state.get("outcome") == "handoff":
        return "handoff"
    d = state["decision"]
    return "send" if d and d.reply else "handoff"


async def _caps(lead_id: str) -> tuple[int, int] | None:
    lim = (await limits.limits())["lead"]
    hour = await limits.count_today(AGENT_ID, ["lead_reply"], ("lead", lead_id), since=db.now() - timedelta(hours=1))
    day = await limits.count_today(AGENT_ID, ["lead_reply"], ("lead", lead_id))
    if hour >= lim["repliesPerLeadPerHour"]:
        return (hour, lim["repliesPerLeadPerHour"])
    return (day, max(lim["autoRepliesPerPersonPerDay"], 1))


async def send(state: State) -> State:
    d: Decision = state["decision"]  # type: ignore[assignment]
    lead_id = state["lead_id"]
    sources = _sources_for_guard(d.sources, state["directory"])
    if "facts" in d.sources:
        sources.append({"type": "facts", "id": "facts", "facts": {}})

    async def do_send(text: str) -> dict[str, Any]:
        return await nexmarket.lead_reply(lead_id, text, agent_id=AGENT_ID)

    r = await act.outgoing(AGENT_ID, kind="lead_reply", channel="whatsapp", text=d.reply or "", summary=f"Answered a lead's question ({d.intent.replace('_', ' ')})",
                           send=do_send, sources=sources, subject=("lead", lead_id), inbound_reply=True, cap=await _caps(lead_id))
    if d.department:
        await nexmarket.lead_update(lead_id, agent_id=AGENT_ID, department=d.department)
    if r.get("sent") or r.get("shadow"):
        return {"outcome": "shadow" if r.get("shadow") else "sent", "detail": r}
    if r.get("reason") == "guard":
        return {"outcome": "handoff", "detail": {"why": "Vita's answer didn't pass the Compliance Guard", **r}}
    return {"outcome": "skip:" + str(r.get("reason", "not sent")), "detail": r}


def after_send(state: State) -> str:
    return "handoff" if state.get("outcome") == "handoff" else END


# Fixed wording (no AI) for someone who wants an appointment: the desk will call; when would suit them?
APPOINTMENT_ACK = {
    "hi": ("धन्यवाद। अपॉइंटमेंट तय करने के लिए हमारी टीम आपको कॉल करेगी।", " कॉल के लिए कौन सा समय ठीक रहेगा?"),
    "hinglish": ("Dhanyavaad. Appointment tay karne ke liye hamari team aapko call karegi.", " Call ke liye kaun sa samay theek rahega?"),
    "bn": ("ধন্যবাদ। অ্যাপয়েন্টমেন্ট ঠিক করতে আমাদের টিম আপনাকে কল করবে।", " কল করার জন্য কোন সময়টা সুবিধাজনক?"),
    "en": ("Thank you. Our team will call you to fix the appointment.", " What time suits you for the call?"),
}


async def _appointment(state: State, d: Decision) -> str:
    """
    Someone wants an appointment. Vita never books: it thanks them, asks when to call (unless they already said),
    and puts the time they gave on the lead, so the desk calls once at the right time instead of chasing.
    """
    lead_id = state["lead_id"]
    first, ask = APPOINTMENT_ACK.get(d.language, APPOINTMENT_ACK["hi"])
    text = first + ("" if d.callback_time else ask)

    async def do_send(t: str) -> dict[str, Any]:
        return await nexmarket.lead_reply(lead_id, t, agent_id=AGENT_ID)

    sent_today = await limits.count_today(AGENT_ID, ["lead_ack"], ("lead", lead_id))
    await act.outgoing(AGENT_ID, kind="lead_ack", cap=(sent_today, 1), channel="whatsapp", text=text, rules_only=True, inbound_reply=True,
                       summary="Told a lead the desk will call about their appointment" + ("" if d.callback_time else ", and asked when"),
                       send=do_send, subject=("lead", lead_id))
    why = "wants an appointment" + (f" ({d.department})" if d.department else "")
    if d.callback_time:
        why += f"; said this time suits them: “{d.callback_time}”"
        st = await limits.agent_state(AGENT_ID)
        # The time they gave always goes on the lead, even when the desk was already told about this lead within the hour.
        if st.get("mode") == "live":
            await nexmarket.lead_update(lead_id, agent_id=AGENT_ID, department=d.department, note=f"Vita: for the appointment call, they said “{d.callback_time}”.")
    else:
        why += "; Vita asked what time suits them for a call"
    return why


async def handoff(state: State) -> State:
    """A person takes it: a note on the lead and an alert to its owner, or the desk. Shadow mode only records it."""
    lead_id = state["lead_id"]
    t = state.get("triage") or Triage()
    d = state.get("decision")
    why = (state.get("detail") or {}).get("why") or t.handoff or (d.needs_person if d else None) or "needs a person"
    if d and d.intent == "appointment" and not (state.get("detail") or {}).get("why"):
        why = await _appointment(state, d)
    st = await limits.agent_state(AGENT_ID)
    # The desk is told once per lead per hour, not for every message.
    recent = await db.fetchone("SELECT count(*) AS n FROM agents.actions WHERE agent_id = %s AND kind = 'handoff_person' AND subject_id = %s "
                               "AND status = 'done' AND created_at > now() - interval '1 hour'", AGENT_ID, lead_id)
    if recent and recent["n"] > 0:
        await actions.record(AGENT_ID, "handoff_person", "skipped", f"Already with a person (told within the hour): {why}", subject=("lead", lead_id))
        return {"outcome": "handoff"}
    if st.get("mode") == "live":
        await nexmarket.lead_update(lead_id, agent_id=AGENT_ID, department=d.department if d else None,
                                    note=f"Vita handed this to a person: {why}.", alert=f"Needs a person: {why}.")
    await actions.record(AGENT_ID, "handoff_person", "done" if st.get("mode") == "live" else "shadow", f"Handed a lead to a person: {why}",
                         subject=("lead", lead_id), detail={"intent": d.intent if d else None})
    return {"outcome": "handoff"}


async def emergency(state: State) -> State:
    """Fixed message (no AI) and an urgent alert, at once, whatever the hour."""
    lead_id = state["lead_id"]
    facts = (await limits.get_setting("facts")) or {}
    phones = facts.get("phones") or []
    num_hi = f"{phones[0]} या 112" if phones else "112"
    num_en = f"{phones[0]} or 112" if phones else "112"
    text = (f"यह आपातकाल लग रहा है। कृपया तुरंत अस्पताल के इमरजेंसी विभाग आएं, या {num_hi} पर कॉल करें।\n"
            f"This sounds like an emergency. Please come to the hospital's emergency department now, or call {num_en}.")

    async def do_send(t: str) -> dict[str, Any]:
        return await nexmarket.lead_reply(lead_id, t, agent_id=AGENT_ID)

    # The emergency message goes once per 30 minutes per lead; the desk is alerted every time.
    sent = await limits.count_today(AGENT_ID, ["lead_emergency"], ("lead", lead_id), since=db.now() - timedelta(minutes=30))
    r = await act.outgoing(AGENT_ID, kind="lead_emergency", cap=(sent, 1), channel="whatsapp", text=text, summary="Possible emergency: sent the emergency message",
                           send=do_send, subject=("lead", lead_id), inbound_reply=True, rules_only=True,
                           sources=[{"type": "facts", "id": "facts", "facts": {"phones": ", ".join(phones)}}])
    st = await limits.agent_state(AGENT_ID)
    if st.get("mode") == "live":
        await nexmarket.lead_update(lead_id, agent_id=AGENT_ID, note="Vita: the message looks like an emergency; sent the emergency message.",
                                    alert="Possible EMERGENCY on WhatsApp. Call them now.", urgent=True)
    if st.get("mode") == "live" and sent > 0:
        await actions.record(AGENT_ID, "emergency_alert", "done", "Possible emergency again: desk alerted (message already sent)", subject=("lead", lead_id))
    return {"outcome": "emergency_sent" if r.get("sent") else ("shadow" if r.get("shadow") else "emergency_alerted"), "detail": r}


def build() -> Any:
    g = StateGraph(State)
    g.add_node("load", load)
    g.add_node("check", check)
    g.add_node("triage", triage_node)
    g.add_node("decide", decide)
    g.add_node("send", send)
    g.add_node("handoff", handoff)
    g.add_node("emergency", emergency)
    g.add_edge(START, "load")
    g.add_edge("load", "check")
    g.add_conditional_edges("check", after_check, {"triage": "triage", END: END})
    g.add_conditional_edges("triage", after_triage, {"emergency": "emergency", "handoff": "handoff", "decide": "decide"})
    g.add_conditional_edges("decide", after_decide, {"send": "send", "handoff": "handoff"})
    g.add_conditional_edges("send", after_send, {"handoff": "handoff", END: END})
    g.add_edge("handoff", END)
    g.add_edge("emergency", END)
    return g.compile()


_graph = build()


async def run(lead_id: str) -> dict[str, Any]:
    """One pass for one lead (also used by tests and the live evaluation)."""
    run_id = db.new_id()
    await db.execute("INSERT INTO agents.runs (id, agent_id, thread_id, trigger) VALUES (%s, %s, %s, %s)", run_id, AGENT_ID, f"{AGENT_ID}:lead-{lead_id}", TASK_KIND)
    status, error, out = "done", None, {}
    try:
        out = await _graph.ainvoke({"lead_id": lead_id}, config={"recursion_limit": 20})
    except nexmarket.NexMarketError as e:
        status, error = "failed", str(e)[:400]
    except Exception as e:  # never crash the worker
        log.exception("lead responder failed")
        status, error = "failed", str(e)[:400]
    await db.execute("UPDATE agents.runs SET status = %s, error = %s, ended_at = now() WHERE id = %s", status, error, run_id)
    outcome = out.get("outcome") or ("error" if error else "done")
    if str(outcome).startswith("skip:"):
        await actions.record(AGENT_ID, "lead_skip", "skipped", f"Didn't answer: {outcome[5:].replace('_', ' ')}", subject=("lead", lead_id))
    return {"outcome": outcome, "error": error, "decision": out["decision"].model_dump() if out.get("decision") else None,
            "triage": out["triage"].model_dump() if out.get("triage") else None}


# ─── Events and the worker ────────────────────────────────────────────────────

_dir_cache: tuple[float, dict[str, Any]] | None = None


async def _directory_cached() -> dict[str, Any] | None:
    global _dir_cache
    if _dir_cache and time.monotonic() - _dir_cache[0] < 300:
        return _dir_cache[1]
    try:
        d = await nexmarket.directory()
    except Exception:
        return _dir_cache[1] if _dir_cache else None
    _dir_cache = (time.monotonic(), d)
    return d


async def on_message(lead_id: str) -> dict[str, Any]:
    """A lead wrote in. Emergencies are due at once; otherwise the desk gets its 3 minutes in office hours."""
    st = await limits.agent_state(AGENT_ID)
    if st.get("mode", "off") == "off":
        return {"accepted": False, "reason": "Lead Responder is off."}
    emergency_now = False
    try:
        ctx = await nexmarket.lead_context(lead_id)
        emergency_now = triage([str(m.get("text") or "") for m in new_inbound(ctx.get("messages", []))]).emergency
    except Exception:
        pass
    due = db.now() + wait_for(await _directory_cached(), emergency=emergency_now)
    tid = await blackboard.post(TASK_KIND, lead_id, "Answer a lead on WhatsApp", for_agent=AGENT_ID, created_by="nexmarket",
                                payload={"emergency": emergency_now}, not_before=due)
    return {"accepted": True, "taskId": str(tid) if tid else None, "due": due.isoformat()}


async def tick(max_tasks: int = 5) -> int:
    """Called every few seconds: works through due tasks, one lead at a time."""
    st = await limits.agent_state(AGENT_ID)
    if st.get("mode", "off") == "off" or st.get("paused") or (await limits.stop_all_state()).get("on"):
        return 0
    done = 0
    for _ in range(max_tasks):
        got = await blackboard.claim(AGENT_ID, [TASK_KIND], 1)
        if not got:
            break
        task = got[0]
        res = await run(task["subject_key"])
        await blackboard.finish(task["id"], AGENT_ID, res, ok=res.get("error") is None)
        if res.get("error"):
            await _failed(task["subject_key"], str(res["error"]))
        done += 1
    return done


async def _failed(lead_id: str, error: str) -> None:
    """A run broke: the lead must not sit unanswered because of it. Its owner (or the desk) is told now; the managers once in 30 minutes."""
    st = await limits.agent_state(AGENT_ID)
    live = st.get("mode") == "live"
    await actions.record(AGENT_ID, "lead_failed", "failed", "Couldn't work on a lead; a person has been told", subject=("lead", lead_id), detail={"error": error[:300]})
    try:
        if live:
            await nexmarket.lead_update(lead_id, agent_id=AGENT_ID, alert="Vita couldn't answer this lead (a technical problem). Please reply yourself.")
        recent = await db.fetchone("SELECT count(*) AS n FROM agents.actions WHERE agent_id = %s AND kind = 'failure_alert' AND created_at > now() - interval '30 minutes'", AGENT_ID)
        if not recent or recent["n"] == 0:
            await nexmarket.notify_team("Lead Responder had a problem", f"A run failed: {error[:200]}. " + ("The lead's owner was told to reply." if live else "It is in shadow, so nothing was due to be sent."),
                                        "ai-agents", agent_id=AGENT_ID)
            await actions.record(AGENT_ID, "failure_alert", "done", "Told the managers about a failed run")
    except Exception:
        log.exception("could not report a failed run")


CATCH_UP_AFTER = timedelta(minutes=6)


async def catch_up() -> int:
    """
    The safety net. NexMarket tells Vita about each message once; if Vita was restarting or unreachable at that
    moment, the message was never queued. Every few minutes this asks NexMarket which leads are still waiting for
    an answer and queues any that Vita has not looked at since they wrote.
    """
    st = await limits.agent_state(AGENT_ID)
    if st.get("mode", "off") == "off" or st.get("paused") or (await limits.stop_all_state()).get("on"):
        return 0
    try:
        waiting = (await nexmarket.leads_waiting()).get("items", [])
    except Exception as e:
        log.warning("catch-up: NexMarket not reachable: %s", e)
        return 0
    picked = 0
    for w in waiting:
        lead_id, at = str(w.get("id")), w.get("lastInboundAt")
        try:
            wrote = datetime.fromisoformat(str(at).replace("Z", "+00:00"))
            if wrote.tzinfo is None:
                wrote = wrote.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if db.now() - wrote < CATCH_UP_AFTER:
            continue  # the normal path (event → 3-minute wait → answer) is still in time
        seen = await db.fetchone(
            "SELECT (SELECT count(*) FROM agents.tasks WHERE kind = %s AND subject_key = %s AND (status IN ('open', 'claimed') OR created_at >= %s)) "
            "+ (SELECT count(*) FROM agents.actions WHERE agent_id = %s AND subject_type = 'lead' AND subject_id = %s AND created_at >= %s) AS n",
            TASK_KIND, lead_id, wrote, AGENT_ID, lead_id, wrote)
        if seen and seen["n"] > 0:
            continue
        tid = await blackboard.post(TASK_KIND, lead_id, "Answer a lead on WhatsApp (missed earlier)", for_agent=AGENT_ID, created_by="catch-up", payload={"missed": True})
        if tid:
            picked += 1
            await actions.record(AGENT_ID, "catch_up", "done", "Picked up a lead that had been missed", subject=("lead", lead_id))
    return picked
