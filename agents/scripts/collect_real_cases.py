"""
Builds a review file of REAL past messages (posts, review replies, broadcasts) from the NexMarket database,
with what the Guard's rules say about each. A person marks each one "ok" or "not ok"; the marked file then
joins tests/guard_cases.json, so the Guard is tested on the hospital's own messages before any agent goes live.

Read-only. Only message text is read — no names, phone numbers or patient records.

    AGENTS_DATABASE_URL=... python scripts/collect_real_cases.py --limit 50 > real_cases.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nexagents import db, limits  # noqa: E402
from nexagents.guard import rules  # noqa: E402

# NexMarket's tables (EF Core: PascalCase column names, "marketing" schema).
QUERIES = {
    "post": ('SELECT "Channel" AS channel, "Text" AS text FROM marketing.social_posts WHERE "Text" IS NOT NULL AND length("Text") > 20 '
             'ORDER BY "PostedAt" DESC LIMIT %s',
             lambda r: (r["channel"] if r["channel"] in rules.MAX_LEN else "facebook", r["text"])),
    "review_reply": ('SELECT "ReplyText" AS text FROM marketing.google_reviews WHERE "ReplyText" IS NOT NULL LIMIT %s',
                     lambda r: ("google_review", r["text"])),
    "broadcast": ('SELECT "PreviewText" AS text FROM marketing.broadcasts WHERE "Status" = \'sent\' AND length("PreviewText") > 20 '
                  'ORDER BY "CreatedAt" DESC LIMIT %s',
                  lambda r: ("broadcast", r["text"])),
}


async def main(limit: int) -> None:
    await db.open_pool()
    facts = rules.facts_from(await limits.get_setting("facts"), [])
    out = []
    for kind, (sql, shape) in QUERIES.items():
        try:
            rows = await db.fetch(sql, limit)
        except Exception as e:
            print(f"Skipped {kind}: {e}", file=sys.stderr)
            rows = []
        for r in rows:
            channel, text = shape(r)
            issues = rules.check(text, channel=channel, facts=facts, has_sources=True)
            out.append({"kind": kind, "channel": channel, "text": text, "rules": [(i.rule, i.match) for i in issues],
                        "label": "", "note": "Mark label as ok or not ok, then add to tests/guard_cases.json"})
    json.dump(out[: limit * 3], sys.stdout, ensure_ascii=False, indent=1)
    await db.close_pool()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=50)
    asyncio.run(main(p.parse_args().limit))
