"""
The graph every agent shares, and the runtime that runs them.

    context → think ⇄ tools → answer

- context: the agent's job, the facts pack, and its checked lessons (LangGraph Store), loaded fresh each run.
- think/tools: the model may only state facts it read through a tool in this run.
- answer: a typed object (Pydantic) with the record ids it relied on; a missing field is an error, not a guess.

Each run has its own thread (agent + subject, e.g. "lead_responder:lead-123"), saved by LangGraph's
Postgres checkpointer, so the agent keeps the full history of that lead or camp. Runs are limited to
25 steps and 10 minutes; hand-offs between the same two agents at most twice.
"""

from __future__ import annotations

import asyncio
import contextvars
import json
from dataclasses import dataclass
from typing import Annotated, Any, Awaitable, Callable, TypedDict

from langchain_core.messages import AIMessage, AnyMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import BaseTool, tool
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from pydantic import BaseModel, Field

from .. import actions, db, limits, llm
from ..config import config
from .registry import BY_ID, AgentDef

GROUNDING = """\
Rules you always follow:
- State only facts (numbers, names, times, prices, places) that appear in a tool result in THIS run or in the facts pack below. Your own general knowledge is never a source.
- Every answer lists the record ids it relied on in "sources".
- If a needed fact is missing, do not guess: set "needs_person" with what is missing.
- Never give medical advice. Never put a patient's health details in anything public.
- Anything that reaches people outside goes through the Compliance Guard; you cannot skip it.
"""


class Answer(BaseModel):
    """What every agent returns. Agents extend this with their own fields."""

    summary: str = Field(description="One or two plain sentences: what was done or decided.")
    sources: list[str] = Field(default_factory=list, description="Record ids relied on, e.g. lead:123, camp:45.")
    needs_person: str | None = Field(default=None, description="What a person must decide or supply, if anything.")


class AgentState(TypedDict, total=False):
    messages: Annotated[list[AnyMessage], add_messages]
    subject: str
    answer: dict[str, Any] | None
    steps: int
    system: str


@dataclass
class Spec:
    defn: AgentDef
    tools: list[BaseTool]
    instructions: str
    schema: type[Answer] = Answer


# Hand-off chain of the current run (caller → callee pairs), so agents can't bounce a task forever.
_chain: contextvars.ContextVar[tuple[tuple[str, str], ...]] = contextvars.ContextVar("chain", default=())


class Runtime:
    def __init__(self) -> None:
        self.specs: dict[str, Spec] = {}
        self.graphs: dict[str, Any] = {}
        self.checkpointer: Any = None
        self.store: Any = None

    async def open(self) -> None:
        """LangGraph's Postgres checkpointer and store, in the agents schema of the same database."""
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
        from langgraph.store.postgres.aio import AsyncPostgresStore

        self.checkpointer = AsyncPostgresSaver(db.pool())  # type: ignore[arg-type]
        await self.checkpointer.setup()
        self.store = AsyncPostgresStore(db.pool())  # type: ignore[arg-type]
        await self.store.setup()

    def register(self, spec: Spec) -> None:
        self.specs[spec.defn.id] = spec
        self.graphs[spec.defn.id] = self._build(spec)

    # ─── Lessons (LangGraph Store, one namespace per agent) ──────────────────

    async def lessons(self, agent_id: str, *, kept_only: bool = True, limit: int = 8) -> list[dict[str, Any]]:
        if self.store is None:
            return []
        items = await self.store.asearch(("lessons", agent_id), limit=50)
        out = [{"key": i.key, **i.value} for i in items]
        if kept_only:
            out = [x for x in out if x.get("status") == "kept"]
        out.sort(key=lambda x: x.get("score", 0), reverse=True)
        return out[:limit]

    async def add_lesson(self, agent_id: str, text: str, by: str, *, source: str = "person") -> str:
        """A lesson a person wrote (so it is already checked): the agent reads it on every run from now on."""
        from datetime import datetime, timezone
        key = str(db.new_id())
        await self.store.aput(("lessons", agent_id), key, {"text": text.strip()[:400], "status": "kept", "score": 1, "by": by, "source": source,
                                                            "at": datetime.now(timezone.utc).isoformat()})
        return key

    async def propose_lesson(self, agent_id: str, text: str, *, cases: int = 0) -> str:
        """A lesson the Coach suggests. The agent does not read it until a person keeps it."""
        from datetime import datetime, timezone
        key = str(db.new_id())
        await self.store.aput(("lessons", agent_id), key, {"text": text.strip()[:400], "status": "proposed", "score": 0, "by": "Vita's Coach", "source": "coach",
                                                            "episodes": cases, "at": datetime.now(timezone.utc).isoformat()})
        return key

    async def keep_lesson(self, agent_id: str, key: str, by: str) -> bool:
        item = await self.store.aget(("lessons", agent_id), key)
        if item is None:
            return False
        await self.store.aput(("lessons", agent_id), key, {**item.value, "status": "kept", "score": 1, "keptBy": by})
        return True

    async def drop_lesson(self, agent_id: str, key: str, by: str) -> bool:
        item = await self.store.aget(("lessons", agent_id), key)
        if item is None:
            return False
        await self.store.aput(("lessons", agent_id), key, {**item.value, "status": "dropped", "droppedBy": by})
        return True

    # ─── The graph ───────────────────────────────────────────────────────────

    def _build(self, spec: Spec) -> Any:
        tools_by_name = {t.name: t for t in spec.tools}
        agent_id = spec.defn.id

        async def context(state: AgentState) -> AgentState:
            facts = await limits.get_setting("facts", {}) or {}
            lessons = await self.lessons(agent_id)
            lesson_text = "\n".join(f"- {x['text']}" for x in lessons) or "- (none yet)"
            system = (
                f"You are {spec.defn.name} for the hospital's marketing team. Your one job: {spec.defn.job}.\n"
                f"You may: {spec.defn.can_do}. Limits: {spec.defn.limits}.\n\n{spec.instructions}\n\n{GROUNDING}\n"
                f"FACTS PACK (from the hospital):\n{facts.get('text', '(empty)')}\n\nCHECKED LESSONS:\n{lesson_text}"
            )
            # Kept apart from the history and rebuilt every run (facts and lessons may have changed).
            return {"system": system, "steps": 0}

        async def think(state: AgentState) -> AgentState:
            out = await llm.chat(llm.Call(agent_id=agent_id, tier=spec.defn.tier, tools=spec.tools or None),
                                 [SystemMessage(state["system"]), *state["messages"]])
            return {"messages": [out], "steps": state.get("steps", 0) + 1}

        async def run_tools(state: AgentState) -> AgentState:
            last = state["messages"][-1]
            results: list[ToolMessage] = []
            for call in getattr(last, "tool_calls", []) or []:
                t = tools_by_name.get(call["name"])
                if t is None:
                    content = json.dumps({"error": f"No tool called {call['name']}."})
                else:
                    try:
                        content = json.dumps(await t.ainvoke(call["args"]), ensure_ascii=False, default=str)
                    except Exception as e:  # a tool error goes back to the model, which must not guess around it
                        content = json.dumps({"error": str(e)[:500]})
                results.append(ToolMessage(content=content[:20000], tool_call_id=call["id"], name=call["name"]))
            return {"messages": results}

        async def answer(state: AgentState) -> AgentState:
            ask = HumanMessage("Give your final answer now, in the required shape. Only facts from this run's tool results or the facts pack.")
            parsed = await llm.chat(llm.Call(agent_id=agent_id, tier=spec.defn.tier, schema=spec.schema), [SystemMessage(state["system"]), *state["messages"], ask])
            return {"answer": parsed.model_dump() if hasattr(parsed, "model_dump") else dict(parsed)}

        def route(state: AgentState) -> str:
            last = state["messages"][-1]
            if isinstance(last, AIMessage) and last.tool_calls and state.get("steps", 0) < config.max_steps - 2:
                return "tools"
            return "answer"

        g = StateGraph(AgentState)
        g.add_node("context", context)
        g.add_node("think", think)
        g.add_node("tools", run_tools)
        g.add_node("answer", answer)
        g.add_edge(START, "context")
        g.add_edge("context", "think")
        g.add_conditional_edges("think", route, {"tools": "tools", "answer": "answer"})
        g.add_edge("tools", "think")
        g.add_edge("answer", END)
        return g.compile(checkpointer=self.checkpointer, store=self.store)

    # ─── Running ─────────────────────────────────────────────────────────────

    async def run(self, agent_id: str, *, subject: str, trigger: str, task: str) -> dict[str, Any]:
        """One run of one agent on one subject. Returns its typed answer (or an error)."""
        if agent_id not in self.graphs:
            raise KeyError(f"{agent_id} is not available yet.")
        v = await limits.gate(agent_id, outgoing=False)
        if not v.allowed:
            return {"ok": False, "reason": v.reason}
        run_id = db.new_id()
        thread = f"{agent_id}:{subject}"
        await db.execute("INSERT INTO agents.runs (id, agent_id, thread_id, trigger) VALUES (%s, %s, %s, %s)", run_id, agent_id, thread, trigger)
        status, error, answer = "done", None, None
        try:
            out = await asyncio.wait_for(
                self.graphs[agent_id].ainvoke({"messages": [HumanMessage(task)], "subject": subject},
                                              config={"configurable": {"thread_id": thread, "run_id": str(run_id)}, "recursion_limit": config.max_steps}),
                timeout=config.max_run_seconds,
            )
            answer = out.get("answer")
        except asyncio.TimeoutError:
            status, error = "timeout", f"Stopped after {config.max_run_seconds // 60} minutes."
        except llm.BudgetExceeded as e:
            status, error = "budget", str(e)
            await limits.set_paused(agent_id, True, "system", "Today's token budget is used up")
        except Exception as e:
            status, error = "failed", str(e)[:500]
        await db.execute("UPDATE agents.runs SET status = %s, error = %s, ended_at = now() WHERE id = %s", status, error, run_id)
        return {"ok": status == "done", "runId": str(run_id), "status": status, "error": error, "answer": answer}

    def ask_tool(self, caller: str) -> BaseTool:
        """ask_agent(name, question): ask another agent and wait for its typed answer."""
        runtime = self

        @tool("ask_agent")
        async def ask_agent(name: str, question: str) -> dict[str, Any]:
            """Ask another agent a question and wait for its answer. name = the agent's id."""
            if name == caller:
                return {"error": "You cannot ask yourself."}
            if name not in BY_ID:
                return {"error": f"There is no agent called {name}."}
            allowed = BY_ID[caller].talks_to
            if "*" not in allowed and name not in allowed:
                return {"error": f"{BY_ID[caller].name} does not work with {BY_ID[name].name}."}
            chain = _chain.get()
            if len(chain) >= 3 or sum(1 for p in chain if set(p) == {caller, name}) >= 2:
                return {"error": "Too many hand-offs for this task; decide with what you have, or ask a person."}
            token = _chain.set(chain + ((caller, name),))
            try:
                await actions.record(caller, "handoff", "done", f"Asked {BY_ID[name].name}: {question[:200]}", to_agent=name)
                return await runtime.run(name, subject=f"ask-from-{caller}", trigger=f"ask:{caller}", task=question)
            finally:
                _chain.reset(token)

        return ask_agent


runtime = Runtime()

Sender = Callable[[str], Awaitable[dict[str, Any]]]
