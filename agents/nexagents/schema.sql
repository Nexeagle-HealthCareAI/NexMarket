-- NexMarket Agents: its own schema in the NexMarket database. Created on start-up; safe to run again.
-- LangGraph's checkpoint and store tables are created in this schema too (by their own setup()).
CREATE SCHEMA IF NOT EXISTS agents;

-- Limits, policy, facts pack, report recipients, Stop all. One row per key; every change keeps who and when.
CREATE TABLE IF NOT EXISTS agents.settings (
    key         text PRIMARY KEY,
    value       jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  text
);
CREATE TABLE IF NOT EXISTS agents.settings_history (
    id          bigserial PRIMARY KEY,
    key         text NOT NULL,
    value       jsonb NOT NULL,
    changed_at  timestamptz NOT NULL DEFAULT now(),
    changed_by  text
);

-- Each agent's switch: off (does nothing), shadow (does everything except send), live; plus pause.
CREATE TABLE IF NOT EXISTS agents.agent_state (
    agent_id      text PRIMARY KEY,
    mode          text NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'shadow', 'live')),
    paused        boolean NOT NULL DEFAULT false,
    paused_reason text,
    paused_by     text,
    paused_at     timestamptz,
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One run of one agent (a LangGraph thread can have many runs).
CREATE TABLE IF NOT EXISTS agents.runs (
    id          uuid PRIMARY KEY,
    agent_id    text NOT NULL,
    thread_id   text NOT NULL,
    trigger     text NOT NULL,
    status      text NOT NULL DEFAULT 'running',
    steps       int NOT NULL DEFAULT 0,
    tokens      int NOT NULL DEFAULT 0,
    error       text,
    started_at  timestamptz NOT NULL DEFAULT now(),
    ended_at    timestamptz
);
CREATE INDEX IF NOT EXISTS runs_agent_started ON agents.runs (agent_id, started_at DESC);

-- Everything an agent did or would have done (shadow), or was stopped from doing. These are the episodes:
-- the outcome is filled in later from NexMarket (replied, came in, reach) and the Coach learns from them.
CREATE TABLE IF NOT EXISTS agents.actions (
    id            uuid PRIMARY KEY,
    agent_id      text NOT NULL,
    run_id        uuid,
    kind          text NOT NULL,            -- e.g. guard_check, whatsapp_reply, post, card, notify, handoff
    status        text NOT NULL,            -- done | shadow | blocked | held | failed | skipped
    summary       text NOT NULL,
    subject_type  text,
    subject_id    text,
    channel       text,
    detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
    sources       jsonb NOT NULL DEFAULT '[]'::jsonb,
    reasons       jsonb NOT NULL DEFAULT '[]'::jsonb,
    to_agent      text,                     -- hand-offs
    outcome       jsonb,
    outcome_at    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS actions_created ON agents.actions (created_at DESC);
CREATE INDEX IF NOT EXISTS actions_agent_created ON agents.actions (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS actions_subject ON agents.actions (subject_type, subject_id);

-- The blackboard: open goals, who claimed them, results. A subject can only have one open task of a kind,
-- so two agents never work on the same lead or post. Claims expire, so a crashed run frees its task.
CREATE TABLE IF NOT EXISTS agents.tasks (
    id             uuid PRIMARY KEY,
    kind           text NOT NULL,
    subject_key    text NOT NULL,
    for_agent      text,
    goal           text NOT NULL,
    payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
    status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'done', 'failed', 'cancelled')),
    claimed_by     text,
    claimed_at     timestamptz,
    claim_expires  timestamptz,
    attempts       int NOT NULL DEFAULT 0,
    result         jsonb,
    created_by     text NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
-- One WAITING task per subject and kind (a new one may wait while the previous is being worked on).
DROP INDEX IF EXISTS agents.tasks_one_open;
CREATE UNIQUE INDEX IF NOT EXISTS tasks_one_waiting ON agents.tasks (kind, subject_key) WHERE status = 'open';
-- Tasks can wait: the Lead Responder gives the desk 3 minutes first in office hours.
ALTER TABLE agents.tasks ADD COLUMN IF NOT EXISTS not_before timestamptz;
CREATE INDEX IF NOT EXISTS tasks_for_status ON agents.tasks (for_agent, status, created_at);

-- Groq use per agent per day, for the daily token budget and the cost line on the Agents page.
CREATE TABLE IF NOT EXISTS agents.usage (
    day         date NOT NULL,
    agent_id    text NOT NULL,
    requests    int NOT NULL DEFAULT 0,
    tokens_in   int NOT NULL DEFAULT 0,
    tokens_out  int NOT NULL DEFAULT 0,
    PRIMARY KEY (day, agent_id)
);

-- A person's verdict on something an agent did or would have done (shadow): good, edited (with the better text) or
-- wrong. This is how an agent's accuracy is measured before it goes live, and where its lessons come from.
ALTER TABLE agents.actions ADD COLUMN IF NOT EXISTS review jsonb;
ALTER TABLE agents.actions ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE agents.actions ADD COLUMN IF NOT EXISTS reviewed_by text;
CREATE INDEX IF NOT EXISTS actions_reviewed ON agents.actions (agent_id, reviewed_at) WHERE reviewed_at IS NOT NULL;
