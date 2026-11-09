"""
What leaves NexMarket for the AI model. Chosen 9 Nov 2026: a lead's question text may be sent, but never their
name, phone number, email, ID numbers or exact address. Everything sent to Groq passes through `redact()`.
"""

from __future__ import annotations

import re

_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "[email]"),
    (re.compile(r"https?://\S+|www\.\S+", re.I), "[link]"),
    (re.compile(r"(?<!\d)\d{4}\s?\d{4}\s?\d{4}(?!\d)"), "[id number]"),             # Aadhaar-like
    (re.compile(r"(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)"), "[phone]"),  # Indian mobiles
    (re.compile(r"(?<!\d)0\d{2,4}[\s-]?\d{6,8}(?!\d)"), "[phone]"),                 # landlines
    (re.compile(r"(?<!\d)[1-9]\d{2}\s?\d{3}(?!\d)(?=\s*(?:$|[,.\s]))"), "[pin code]"),  # 6-digit PIN
    (re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b"), "[id number]"),                          # PAN
    # "my name is X", "mera naam X hai", "मेरा नाम X", "আমার নাম X", "I am X" (only a capitalised name after I am)
    (re.compile(r"(?i)(my name is|name is|mera naam|mera nam|naam hai|मेरा नाम|मेरा नाम है|আমার নাম)\s*[:\-]?\s*[^\s,.;!?]+(\s+[A-Zऀ-ॿঀ-৿][^\s,.;!?]*)?"), r"\1 [name]"),
    (re.compile(r"\bI am ([A-Z][a-z]+)(\s+[A-Z][a-z]+)?\b"), "I am [name]"),
    (re.compile(r"(?i)\b(house|h\.?\s?no\.?|ghar|makan|ward)\s*(no\.?|number|नं)?\s*[:#]?\s*\d+[\w/-]*"), r"\1 [number]"),
]


def redact(text: str, names: list[str] | None = None) -> str:
    """The text with personal identifiers replaced by [name], [phone] and so on. Known names are removed too."""
    out = text or ""
    for n in names or []:
        for part in {n.strip(), *n.split()}:
            if len(part) >= 3 and not part.startswith("+"):
                out = re.sub(rf"(?<![\wऀ-৿]){re.escape(part)}(?![\wऀ-৿])", "[name]", out, flags=re.I)
    for rx, rep in _RULES:
        out = rx.sub(rep, out)
    return out
