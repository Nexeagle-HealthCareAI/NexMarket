"""Lead Responder rules, no AI: privacy, triage in four languages, timing, and checking the AI's answer."""

from datetime import datetime, timezone

import pytest

from nexagents.agents import lead_responder as lr
from nexagents.guard import rules
from nexagents.privacy import redact
from tests.fixtures import DIRECTORY, FACTS

# ─── Privacy ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("text,gone,kept", [
    ("Call me on 9876543210 please", "9876543210", "Call me"),
    ("mera number +91 98765 43210 hai", "98765 43210", "mera number"),
    ("Landline 06454-222333", "222333", "Landline"),
    ("My name is Ramesh Kumar, need eye doctor", "Ramesh", "need eye doctor"),
    ("mera naam Sunita hai, ankh ka doctor kab hai", "Sunita", "ankh ka doctor"),
    ("मेरा नाम सुनीता है, आंख के डॉक्टर कब हैं", "सुनीता", "आंख के डॉक्टर"),
    ("আমার নাম রহিম, চোখের ডাক্তার কবে", "রহিম", "চোখের ডাক্তার"),
    ("Aadhaar 1234 5678 9012", "1234 5678 9012", "Aadhaar"),
    ("PAN ABCDE1234F", "ABCDE1234F", "PAN"),
    ("email me at sunita.k@gmail.com", "sunita.k@gmail.com", "email me"),
    ("village Rampur, pin 854301", "854301", "village Rampur"),
    ("house no 45/B ward 7", "45/B", "house"),
    ("I am Rahul Singh from Kasba", "Rahul", "from Kasba"),
])
def test_redact_removes_identifiers(text, gone, kept):
    out = redact(text)
    assert gone not in out and kept in out, out


def test_redact_keeps_what_the_question_needs():
    t = "Mere papa ki age 65 hai, ghutne me dard, Saturday ko doctor milenge? 10 baje aa sakte?"
    assert redact(t) == t  # ages, days and times stay: they are the question, not who is asking


def test_redact_known_names():
    assert "Ramesh" not in redact("Ramesh here, eye camp kab hai", names=["Ramesh Kumar"])


# ─── Triage ───────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("text", [
    "chest pain since morning please help", "papa behosh ho gaye", "saans nahi aa rahi", "accident ho gaya hai road pe",
    "snake bite in field", "saanp ne kaat liya", "मेरी माँ बेहोश हो गई", "सीने में दर्द हो रहा है", "বুকে ব্যথা হচ্ছে",
    "khoon beh raha hai bahut", "labour pain started", "bachche ko mirgi ka daura pad raha hai", "she drank poison",
    "EMERGENCY please", "I want to kill myself",
    # Found by the live set: words between the parts.
    "सीने में बहुत तेज दर्द हो रहा है", "seene me bahut tej dard", "chest me bahut pain ho raha", "saans lene me bahut takleef",
    "साँस लेने में बहुत तकलीफ है", "बच्चे का खून बहुत बह रहा है", "বুকে খুব ব্যথা", "having chest tightness and pain",
])
def test_emergencies(text):
    t = lr.triage([text])
    assert t.emergency, text


@pytest.mark.parametrize("text", [
    "emergency number kya hai?", "is emergency open at night", "heart checkup camp kab hai", "heart doctor kab aate hain",
    "Is there a cardiology doctor?", "accident insurance claim help", "chest specialist kab aate hain",
])
def test_not_emergencies(text):
    assert not lr.triage([text]).emergency, text


@pytest.mark.parametrize("text,why", [
    ("operation ka kitna kharcha hoga?", "price"), ("What are the fees for eye checkup", "price"), ("Ayushman card chalega?", "price"),
    ("ऑपरेशन में कितना खर्च होगा", "price"), ("চোখ দেখাতে কত খরচ", None), ("checkup kitna lagega", "price"), ("kitne paise lagenge", "price"),
    ("I want to complain about the staff", "complaint"), ("bahut bekar service thi", "complaint"), ("मुझे शिकायत करनी है", "complaint"),
    ("meri report aa gayi kya", "report"), ("x-ray result kab milega", "report"),
])
def test_handoffs(text, why):
    t = lr.triage([text])
    if why is None:
        assert t.handoff is not None  # Bangla price words: any hand-off is fine
    else:
        assert t.handoff and why.split()[0] in t.handoff or why in (t.handoff or ""), (text, t)


@pytest.mark.parametrize("text", ["Eye doctor kab baithte hain?", "Saturday ko haddi ke doctor hain?", "camp kahan hai", "hello", "Is the hospital open on Sunday?",
                                  # Found by the live set: "kitne baje" is a time, not a price.
                                  "OPD kitne baje se kitne baje tak hai?", "doctor kitne baje aate hain", "कितने बजे तक खुला है"])
def test_ordinary_questions_go_to_the_ai(text):
    t = lr.triage([text])
    assert not t.emergency and t.handoff is None, (text, t)


def test_voice_note_is_handed_over():
    t = lr.triage(["🎤 Voice message"])
    assert t.media_only and t.handoff


# ─── Timing ───────────────────────────────────────────────────────────────────

def ist(day, hh, mm=0):
    return datetime(2026, 11, day, hh - 5, mm - 30 if mm >= 30 else mm + 30, tzinfo=timezone.utc) if False else \
        datetime(2026, 11, day, hh, mm, tzinfo=lr.IST).astimezone(timezone.utc)


def test_desk_gets_three_minutes_in_office_hours():
    assert lr.wait_for(DIRECTORY, emergency=False, now=ist(9, 11)).total_seconds() == 180   # Monday 11 am
    assert lr.wait_for(DIRECTORY, emergency=False, now=ist(9, 20)).total_seconds() == 0     # Monday 8 pm
    assert lr.wait_for(DIRECTORY, emergency=False, now=ist(8, 11)).total_seconds() == 0     # Sunday
    assert lr.wait_for(DIRECTORY, emergency=True, now=ist(9, 11)).total_seconds() == 0      # emergency: never wait


def test_office_hours_off_means_always_office():
    d = {**DIRECTORY, "officeHours": {"on": False}}
    assert lr.wait_for(d, emergency=False, now=ist(8, 23)).total_seconds() == 180


def test_new_inbound_counts_only_unanswered_messages():
    msgs = [{"direction": "in", "by": "person", "text": "a"}, {"direction": "out", "by": "auto", "text": "thanks"},
            {"direction": "in", "by": "person", "text": "b"}]
    assert [m["text"] for m in lr.new_inbound(msgs)] == ["a", "b"]  # the automatic thanks doesn't count as an answer
    msgs.append({"direction": "out", "by": "desk", "text": "hi"})
    assert lr.new_inbound(msgs) == []
    msgs.append({"direction": "in", "by": "person", "text": "c"})
    assert [m["text"] for m in lr.new_inbound(msgs)] == ["c"]


# ─── Checking the AI's answer ─────────────────────────────────────────────────

def D(**kw):
    base = dict(intent="doctor_timing", language="hinglish", department="Eye", reply="Dr. Anjali Verma Tuesday aur Friday 10 am - 2 pm.", sources=["doctor:doc-eye"])
    base.update(kw)
    return lr.Decision(**base)


def test_verify_keeps_a_good_answer():
    v = lr.verify(D(), DIRECTORY)
    assert v.reply and v.department == "Eye" and v.sources == ["doctor:doc-eye"]


def test_verify_drops_invented_department_and_records():
    v = lr.verify(D(department="Neurology", sources=["doctor:doc-neuro"]), DIRECTORY)
    assert v.department is None and v.reply is None and v.needs_person  # no real record behind it → not sent


def test_verify_department_case_insensitive():
    assert lr.verify(D(department="eye"), DIRECTORY).department == "Eye"


@pytest.mark.parametrize("intent", ["price", "appointment", "report", "complaint", "medical_advice"])
def test_verify_never_lets_the_ai_answer_these(intent):
    v = lr.verify(D(intent=intent, reply="Sure, it costs 500"), DIRECTORY)
    assert v.reply is None and v.needs_person


def guard_issues(reply, ids):
    src = lr._sources_for_guard(ids, DIRECTORY)
    return [i.rule for i in rules.check(reply, channel="whatsapp", facts=rules.facts_from(FACTS, src), has_sources=True)]


def test_guard_accepts_times_and_days_from_the_doctor_record():
    assert guard_issues("Dr. Anjali Verma Tuesday aur Friday ko 10 am - 2 pm baithti hain.", ["doctor:doc-eye"]) == []


def test_guard_catches_a_wrong_day():
    assert "unsupported_fact" in guard_issues("Dr. Anjali Verma Wednesday ko 10 am baithti hain.", ["doctor:doc-eye"])


def test_guard_catches_a_wrong_time():
    assert "unsupported_fact" in guard_issues("Dr. Anjali Verma Tuesday ko 4 pm baithti hain.", ["doctor:doc-eye"])


def test_guard_accepts_camp_date_written_different_ways():
    for r in ["Camp Saturday 14 Nov, 10 am to 2 pm, Amour High School.", "Camp 14 November ko 10 baje se, Amour High School.",
              "शनिवार 14 Nov को 10 am से 2 pm तक कैंप है।"]:
        assert guard_issues(r, ["camp:camp-amour"]) == [], r


def test_guard_catches_a_wrong_camp_date():
    assert "unsupported_fact" in guard_issues("Camp 15 Nov ko hai.", ["camp:camp-amour"])


@pytest.mark.parametrize("wrong", ["Camp 1 Nov ko hai.", "Camp 4 Nov ko hai.", "Camp 14 Dec ko hai.", "Camp 14/12 ko hai.", "Camp 11/14 ko."])
def test_guard_compares_day_and_month_not_digits(wrong):
    # Before the fix, any digit found anywhere in the record passed ("1" is in "14").
    assert "unsupported_fact" in guard_issues(wrong, ["camp:camp-amour"]), wrong


def test_guard_accepts_iso_dates_in_records():
    facts = rules.facts_from({}, [{"type": "camp", "id": "x", "facts": {"date": "2026-11-21"}}])
    assert rules.check("Camp 21 Nov ko.", channel="whatsapp", facts=facts, has_sources=True) == []
    assert rules.check("Camp 21/11 ko.", channel="whatsapp", facts=facts, has_sources=True) == []
