# NexMarket Agents

The autonomous marketing agents: a Python service (FastAPI + LangGraph + LangChain, Groq models) that runs
next to the .NET API and works only through it. Design: *NexMarket Autonomous Agents — design* (Project doc).

**Phase 1 (this code) is the foundation every agent shares:**

| Part | Where |
|---|---|
| Service, schedules, internal API | `nexagents/app.py` |
| Groq models, shared rate limiter (urgent first), daily token budget per agent | `nexagents/llm.py` |
| Limits, quiet hours, caps, Stop all, each agent's off / shadow / live switch and pause | `nexagents/limits.py` |
| The only path to the outside: gate → Compliance Guard → send (or record, in shadow) → log | `nexagents/act.py` |
| Compliance Guard (rules → policy model → one rewrite), as a LangGraph graph | `nexagents/guard/` |
| The shared agent graph (context → think ⇄ tools → typed answer), Postgres memory, `ask_agent` | `nexagents/agents/base.py` |
| The 14 agents and the phase each arrives in | `nexagents/agents/registry.py` |
| Blackboard (claims, no duplicates, expiry) | `nexagents/blackboard.py` |
| Action log = the episodes agents learn from | `nexagents/actions.py` |
| Tools that call NexMarket (alerts, Team board cards) | `nexagents/nexmarket.py` |
| Lead Responder (answers WhatsApp questions) and Lead Follow-up (nudges quiet leads) | `nexagents/agents/lead_responder.py`, `lead_follow_up.py` |
| A person checking an agent's drafts: verdicts, sending, lessons | `nexagents/review.py` |
| The day: numbers → signals → plan → report → suggested lessons | `nexagents/agents/data_watcher.py`, `chief_of_staff.py`, `reporter_coach.py` |

Built so far: Compliance Guard, Lead Responder, Lead Follow-up, Data Watcher, Chief of Staff, Reporter & Coach (`docs/`). The other agents appear on the Agents page with the phase they
arrive in, and can't be switched on until their code ships (each starts in shadow mode).

## Run it

Environment (never put these in the repo):

| Variable | |
|---|---|
| `AGENTS_DATABASE_URL` | The NexMarket Postgres, e.g. `postgresql://postgres:…@localhost:5433/nexmarket`. Everything goes in the `agents` schema. |
| `AGENTS_SECRET` | Long random string. **The API needs the same value as `Agents__Secret`.** |
| `GROQ_API_KEY` | Groq key (Developer plan). Without it, the Guard checks rules only and **holds** messages to patients. |
| `NEXMARKET_API_URL` | Default `http://localhost:5010`. |
| `GROQ_REQUESTS_PER_MINUTE`, `GROQ_TOKENS_PER_MINUTE` | Your Groq plan's limits (defaults 60 and 100,000). |

```bash
pip install -r requirements.txt
uvicorn nexagents.app:app --host 127.0.0.1 --port 5020
```

**On the API**, add to its environment: `Agents__Secret=<same secret>` (and `Agents__Url` if not
`http://localhost:5020`). `.github/workflows` is protected, so add these lines to `api-deploy.yml` yourself:

```
printf 'Agents__Secret=%s\n' "$AGENTS_SECRET"
```

and copy `deploy/agents-deploy.yml.example` to `.github/workflows/agents-deploy.yml` (secrets `DEV_AGENTS_SECRET`,
`DEV_GROQ_API_KEY`). The service binds to 127.0.0.1 only; nothing outside the VM can reach it.

## Tests

```bash
pip install pytest
pytest -q                                   # 50-case Guard test set, Guard graph, rate limiter
TEST_DATABASE_URL=postgresql://… pytest -q  # + gate, Stop all, shadow sends, blackboard (needs Postgres)
```

`scripts/collect_real_cases.py` pulls the hospital's real past posts, review replies and broadcasts (text only)
with what the rules say about each, for a person to label and add to `tests/guard_cases.json`.

## Rules that never change on a form

- Agents act only through NexMarket's API, with the shared secret; every action is logged with its reasons.
- Every outgoing text passes the Compliance Guard. No Groq = held, never sent unchecked.
- Shadow mode records what would be sent and sends nothing.
- Stop all and pause are checked before every action. The Guard can't be paused or switched off.
- Ads stay suggestions-only; agents can't change their own limits; no patient details go to the model.
