"""
The Compliance Guard's first layer: plain rules, no AI. Fast, predictable, and it cannot be talked out of
anything. Patterns cover English, Hinglish, Hindi and Bangla. Based on the Drugs and Magic Remedies
(Objectionable Advertisements) Act (no cure claims), the NMC's 2023 conduct rules (no doctor
self-promotion), the DPDP Act 2023 (no patient details) and Meta's WhatsApp and health ad policies.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any, Iterable, Literal

Severity = Literal["block", "fix"]

PUBLIC_CHANNELS = {"facebook", "instagram", "google_review", "whatsapp_status", "website"}
PATIENT_CHANNELS = {"whatsapp", "sms", "broadcast"} | PUBLIC_CHANNELS
MAX_LEN = {"sms": 480, "whatsapp": 2000, "broadcast": 1024, "google_review": 1500, "facebook": 2200, "instagram": 2200, "whatsapp_status": 700, "partner": 2000}


@dataclass
class Issue:
    rule: str
    severity: Severity
    message: str
    match: str | None = None
    fixable: bool = True

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Facts:
    """What the message may rely on: the facts pack (hospital) plus this task's source records."""

    text: str = ""                      # all source facts as one lower-cased string, for lookups
    phones: set[str] = field(default_factory=set)  # the hospital's own numbers
    domains: set[str] = field(default_factory=set)  # links allowed in messages


def _rx(*parts: str) -> re.Pattern[str]:
    return re.compile("|".join(parts), re.IGNORECASE | re.UNICODE)


# Word edges that also work next to Devanagari / Bangla.
B = r"(?<![\wऀ-৿])"
E = r"(?![\wऀ-৿])"

CURE = _rx(
    B + r"(cure[sd]?|curing|guarantee[sd]?|guaranteed|miracle|magic(al)? (cure|remedy|treatment)|permanent(ly)? (cure|relief|solution|treatment|fix)|"
    r"100\s?% (cure|result|relief|success|recovery|safe)|instant (relief|cure)|no side[- ]effects?|risk[- ]free|"
    r"jad se (khatam|theek|thik|mitaye|khatm)|pakka (ilaj|ilaaj|ilaz|theek)|ilaa?j ki guarantee|guarantee se|chamatkar(i)?)" + E,
    r"गारंटी|पक्का इलाज|जड़ से|जड से|चमत्कार|स्थायी इलाज|100\s?% इलाज|बिना साइड इफेक्ट",
    r"গ্যারান্টি|নিশ্চিত আরোগ্য|অলৌকিক|স্থায়ী সমাধান|চিরতরে সেরে",
)
SUPERLATIVE = _rx(
    B + r"(best|no\.?\s?1|number one|#1|top (hospital|doctors?|clinic|surgeon)|leading|finest|world[- ]class|unmatched|unbeatable|"
    r"sabse (best|accha|achha|acha|badhiya|behtar)|sabse bada)" + E,
    r"सबसे अच्छा|सबसे बेहतर|नंबर\s?1|नंबर वन|सर्वश्रेष्ठ",
    r"সেরা|সর্বশ্রেষ্ঠ|এক নম্বর",
)
COMPARISON = _rx(
    B + r"(better than|cheaper than|unlike other|other hospitals?|compared to (other|any)|doosr[ae] (hospital|aspatal)|baaki hospital)" + E,
    r"दूसरे अस्पताल|अन्य अस्पताल|से बेहतर",
    r"অন্য হাসপাতাল|চেয়ে ভালো",
)
DOCTOR_PROMO = _rx(
    B + r"(renowned|famous|celebrated|celebrity|award[- ]winning|gold medal(l?ist)?|most experienced|top[- ]rated|highly acclaimed|"
    r"mashhoor|mashoor|prasiddh)" + E,
    r"मशहूर|प्रसिद्ध डॉक्टर|गोल्ड मेडल",
    r"প্রখ্যাত|বিখ্যাত",
)
FEAR = _rx(
    B + r"(before it'?s too late|you (may|could|will) die|deadly|don'?t ignore or|last chance|warning:)" + E,
    r"जान का खतरा|देर हो जाएगी",
)
INDUCEMENT = _rx(
    B + r"(commission|cash ?back|cash reward|referral (bonus|fee|reward)|gift (for|on) (referring|every)|paisa milega|paise milenge|incentive per patient)" + E,
    r"कमीशन|इनाम मिलेगा",
    r"কমিশন",
)
PRICE = _rx(
    r"(₹|rs\.?|inr)\s?\d[\d,]*",
    B + r"\d[\d,]*\s?(rupees?|rupaye|rupaiye|rs" + E + r")",
    r"\d[\d,]*\s?(रुपये|रुपए|টাকা)",
    B + r"(\d{1,2}\s?% (off|discount|chhoot|chhut)|discount|cash ?back|offer price|sasta)" + E,
    r"छूट|ছাড়",
)
MEDICAL_ADVICE = _rx(
    B + r"(\d+\s?(mg|ml|mcg)" + E + r"|tablets? (daily|twice|thrice|roz)|stop (taking )?your (medicine|medication|tablets)|"
    r"you (have|are suffering from) (diabetes|cancer|tb|tuberculosis|hepatitis|hiv|typhoid|dengue|malaria)|dawa (band|chhod))" + E,
    r"दवा बंद|दवाई छोड़",
)
HEALTH_WORDS = _rx(
    B + r"(diagnos(is|ed)|surgery|operation|treatment|treated|report|bill|billing|admitted|admission|discharged?|medicines?|prescription|"
    r"illness|disease|condition|symptoms?|ilaj|ilaaj|bimari|beemari)" + E,
    r"इलाज|बीमारी|ऑपरेशन|रिपोर्ट|बिल|भर्ती|दवा",
    r"চিকিৎসা|অসুখ|অপারেশন|রিপোর্ট|বিল|ভর্তি|ওষুধ",
)
PHONE = re.compile(r"(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)")
AADHAAR = re.compile(r"(?<!\d)\d{4}\s?\d{4}\s?\d{4}(?!\d)")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
URL = re.compile(r"(https?://[^\s<>\"')]+|www\.[^\s<>\"')]+)", re.IGNORECASE)

# Things that must come from a source record: times, dates, weekdays, prices (prices handled above).
TIME = re.compile(r"(?<!\d)(\d{1,2})(?::|\.)?(\d{2})?\s?(am|pm|a\.m\.|p\.m\.|baje|बजे|টায়)", re.IGNORECASE)
DATE = re.compile(
    r"(?<!\d)(\d{1,2})\s?(st|nd|rd|th)?\s?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*|(?<!\d)(\d{1,2})[/-](\d{1,2})(?:[/-]\d{2,4})?(?!\d)",
    re.IGNORECASE,
)
WEEKDAY = _rx(B + r"(monday|tuesday|wednesday|thursday|friday|saturday|sunday|somvar|mangalvar|budhvar|guruvar|shukravar|shanivar|ravivar)" + E,
              r"सोमवार|मंगलवार|बुधवार|गुरुवार|शुक्रवार|शनिवार|रविवार",
              r"সোমবার|মঙ্গলবার|বুধবার|বৃহস্পতিবার|শুক্রবার|শনিবার|রবিবার")


# The same day in English, Hinglish, Hindi and Bangla.
_DAYS = [
    ("monday", "somvar", "सोमवार", "সোমবার"), ("tuesday", "mangalvar", "मंगलवार", "মঙ্গলবার"), ("wednesday", "budhvar", "बुधवार", "বুধবার"),
    ("thursday", "guruvar", "गुरुवार", "বৃহস্পতিবার"), ("friday", "shukravar", "शुक्रवार", "শুক্রবার"), ("saturday", "shanivar", "शनिवार", "শনিবার"),
    ("sunday", "ravivar", "रविवार", "রবিবার"),
]


def _day(word: str) -> int:
    w = word.lower()
    return next((i for i, names in enumerate(_DAYS) if w in names), -1)


def _digits(s: str) -> str:
    return re.sub(r"\D", "", s)


def _norm_phone(s: str) -> str:
    d = _digits(s)
    return d[-10:]


def _first(rx: re.Pattern[str], text: str) -> str | None:
    m = rx.search(text)
    return m.group(0) if m else None


def _norm_time(h: str, m: str | None, ap: str) -> str:
    ap = ap.lower().replace(".", "")
    ap = "pm" if ap == "pm" else "am" if ap == "am" else ""
    return f"{int(h)}:{m or '00'}{ap}"


def _times(text: str) -> set[str]:
    return {_norm_time(h, m, ap) for h, m, ap in TIME.findall(text)}


def unsupported_facts(text: str, facts: Facts) -> list[str]:
    """Times, dates, weekdays and numbers in the message that don't appear in any source."""
    src = facts.text.lower()
    src_times = _times(src)
    missing: list[str] = []
    for h, m, ap in TIME.findall(text):
        t = _norm_time(h, m, ap)
        bare = f"{int(h)}:{m or '00'}"
        if t not in src_times and not any(x.startswith(bare) for x in src_times):
            missing.append(f"{h}{':' + m if m else ''} {ap}".strip())
    for m in DATE.finditer(text):
        token = m.group(0).strip()
        if token.lower() not in src and _digits(token) not in _digits(src):
            missing.append(token)
    src_days = {_day(m.group(0)) for m in WEEKDAY.finditer(src)}
    for m in WEEKDAY.finditer(text):
        if _day(m.group(0)) not in src_days:
            missing.append(m.group(0))
    return missing


def check(text: str, *, channel: str, audience: str = "patient", facts: Facts | None = None,
          opted_in: bool | None = None, has_sources: bool = False) -> list[Issue]:
    """All rule problems in one outgoing text. An empty list means the rules passed."""
    facts = facts or Facts()
    t = (text or "").strip()
    issues: list[Issue] = []
    if not t:
        return [Issue("empty", "block", "The message is empty.", fixable=False)]
    if opted_in is False and channel in {"whatsapp", "broadcast", "sms"}:
        issues.append(Issue("not_opted_in", "block", "This person has not agreed to messages, or opted out.", fixable=False))

    if m := _first(CURE, t):
        issues.append(Issue("cure_claim", "block", "Cure, guarantee or miracle claims are not allowed (Drugs and Magic Remedies Act).", m))
    if m := _first(SUPERLATIVE, t):
        issues.append(Issue("superlative", "fix", "No 'best', 'No. 1' or similar claims.", m))
    if m := _first(COMPARISON, t):
        issues.append(Issue("comparison", "fix", "No comparisons with other hospitals or doctors.", m))
    if m := _first(DOCTOR_PROMO, t):
        issues.append(Issue("doctor_promo", "fix", "No promotional praise of doctors (NMC conduct rules).", m))
    if m := _first(FEAR, t):
        issues.append(Issue("fear", "fix", "No scare wording.", m))
    if m := _first(INDUCEMENT, t):
        issues.append(Issue("inducement", "block", "Never offer money, commission or gifts for referrals.", m))
    if m := _first(MEDICAL_ADVICE, t):
        issues.append(Issue("medical_advice", "block", "No medical advice, doses or diagnoses in messages.", m))

    price = _first(PRICE, t)
    if price and _digits(price) and _digits(price) not in _digits(facts.text):
        issues.append(Issue("price", "block", "Prices and offers must come from the facts pack or the task's records.", price))
    elif price and not _digits(price) and price.lower() not in facts.text.lower():
        issues.append(Issue("price", "fix", "Discounts and offers need to be in the facts pack.", price))

    for p in PHONE.findall(t):
        if _norm_phone(p) not in {_norm_phone(x) for x in facts.phones}:
            issues.append(Issue("personal_number", "block", "Only the hospital's own numbers may appear in messages.", p))
            break
    if AADHAAR.search(t):
        issues.append(Issue("id_number", "block", "No ID numbers in messages.", AADHAAR.search(t).group(0)))  # type: ignore[union-attr]
    if (e := EMAIL.search(t)) and e.group(0).split("@")[-1].lower() not in facts.domains:
        issues.append(Issue("personal_email", "block", "Only the hospital's own email may appear.", e.group(0)))
    for u in URL.findall(t):
        host = re.sub(r"^(https?://)?(www\.)?", "", u.lower()).split("/")[0]
        if not any(host == d or host.endswith("." + d) for d in facts.domains):
            issues.append(Issue("link", "block", "Links only to the hospital's own sites.", u))
            break

    if channel == "google_review" and (m := _first(HEALTH_WORDS, t)):
        issues.append(Issue("review_health", "block", "Review replies never mention illness, treatment, reports or bills.", m))
    if channel in PUBLIC_CHANNELS and audience != "staff" and re.search(r"\b(?i:patient|mareez|marij|marīz)\s+[A-Z][a-z]+", t):
        issues.append(Issue("patient_named", "block", "Never name a patient in public.", None))

    words = re.findall(r"[A-Za-z]{3,}", t)
    if len(words) >= 6 and sum(w.isupper() for w in words) / len(words) > 0.3:
        issues.append(Issue("shouting", "fix", "Too many capital letters.", None))
    if "!!!" in t:
        issues.append(Issue("shouting", "fix", "Too many exclamation marks.", "!!!"))
    limit = MAX_LEN.get(channel)
    if limit and len(t) > limit:
        issues.append(Issue("length", "fix", f"Too long for {channel} ({len(t)} of {limit} characters).", None))

    missing = unsupported_facts(t, facts)
    if missing:
        issues.append(Issue(
            "unsupported_fact", "block",
            "Every time, date and day in a message must come from a source record" + ("" if has_sources else " — none were given") + ".",
            ", ".join(dict.fromkeys(missing)),
        ))
    return issues


def facts_from(pack: dict[str, Any] | None, sources: Iterable[dict[str, Any]] | None) -> Facts:
    """The facts pack (from the Agents page) plus this task's records, flattened for the checks."""
    pack = pack or {}
    parts: list[str] = [str(pack.get("text", ""))]
    for s in sources or []:
        parts.append(" ".join(f"{k}: {v}" for k, v in (s.get("facts") or {}).items()))
        if s.get("text"):
            parts.append(str(s["text"]))
    phones = {str(p) for p in pack.get("phones", [])}
    domains = {str(d).lower().removeprefix("www.") for d in pack.get("domains", [])}
    return Facts(text="\n".join(parts), phones=phones, domains=domains)
