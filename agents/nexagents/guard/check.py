"""
The Compliance Guard, as a LangGraph graph. Every outgoing text goes through it:

    rules  →  policy (gpt-oss-safeguard-20b)  →  verdict  →  (one rewrite, then everything again)

Rules run first and need no AI. The policy check runs only if the rules passed or were fixable. It fails
closed: when the model can't be reached, a message to patients or the public is held, never sent.
"""

from __future__ import annotations

import json
from typing import Any, Literal, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

from .. import llm
from . import rules
from .policy import DEFAULT_POLICY, POLICY_PROMPT, REWRITE_PROMPT

AGENT_ID = "compliance_guard"

Outcome = Literal["pass", "fix", "block", "held"]


class GuardRequest(BaseModel):
    text: str = Field(max_length=6000)
    channel: str = "whatsapp"           # whatsapp | sms | broadcast | facebook | instagram | google_review | whatsapp_status | partner | internal
    audience: str = "patient"           # patient | public | partner | staff
    language: str | None = None
    sources: list[dict[str, Any]] = Field(default_factory=list)  # [{"type": "camp", "id": "...", "facts": {...}}]
    opted_in: bool | None = None
    allow_rewrite: bool = False
    rules_only: bool = False            # the "Try the Guard" box can ask for just the rule layer
    from_agent: str | None = None


class PolicyAnswer(BaseModel):
    violation: bool
    rules: list[str] = Field(default_factory=list)
    explanation: str = ""


class GuardResult(BaseModel):
    outcome: Outcome
    text: str                           # the text that was finally checked (the rewrite, if one was made)
    rewritten: bool = False
    issues: list[dict[str, Any]] = Field(default_factory=list)
    policy: dict[str, Any] | None = None
    checked_by: list[str] = Field(default_factory=list)
    note: str | None = None


class State(TypedDict, total=False):
    req: GuardRequest
    policy_text: str
    facts_pack: dict[str, Any]
    text: str
    issues: list[rules.Issue]
    policy: PolicyAnswer | None
    policy_error: str | None
    attempts: int
    rewritten: bool
    checked_by: list[str]
    outcome: Outcome


def _facts(state: State) -> rules.Facts:
    return rules.facts_from(state.get("facts_pack"), state["req"].sources)


async def rules_node(state: State) -> State:
    req = state["req"]
    issues = rules.check(state["text"], channel=req.channel, audience=req.audience, facts=_facts(state),
                         opted_in=req.opted_in, has_sources=bool(req.sources))
    return {"issues": issues, "checked_by": [*state.get("checked_by", []), "rules"]}


def after_rules(state: State) -> str:
    req = state["req"]
    if any(not i.fixable for i in state["issues"]):
        return "verdict"
    if req.rules_only or req.channel == "internal":
        return "verdict"
    return "policy"


async def policy_node(state: State) -> State:
    req = state["req"]
    system = POLICY_PROMPT.format(policy=state.get("policy_text") or DEFAULT_POLICY)
    user = json.dumps({"channel": req.channel, "audience": req.audience, "message": state["text"],
                       "sources": req.sources}, ensure_ascii=False)
    try:
        ans = await llm.chat(llm.Call(agent_id=AGENT_ID, tier="safeguard", priority=1, schema=PolicyAnswer),
                             [SystemMessage(system), HumanMessage(user)])
        return {"policy": ans, "policy_error": None, "checked_by": [*state["checked_by"], "policy"]}
    except (llm.ModelUnavailable, llm.BudgetExceeded) as e:
        return {"policy": None, "policy_error": str(e)}


def verdict_node(state: State) -> State:
    req = state["req"]
    issues = state.get("issues", [])
    pol = state.get("policy")
    if any(i.severity == "block" and not i.fixable for i in issues):
        outcome: Outcome = "block"
    elif issues or (pol and pol.violation):
        outcome = "block" if any(i.severity == "block" for i in issues) else "fix"
    elif state.get("policy_error") and req.channel in rules.PATIENT_CHANNELS and not req.rules_only:
        outcome = "held"  # couldn't run the policy check: never send to patients or the public unchecked
    else:
        outcome = "pass"
    return {"outcome": outcome}


def after_verdict(state: State) -> str:
    req = state["req"]
    can_fix = all(i.fixable for i in state.get("issues", []))
    if state["outcome"] in ("fix", "block") and can_fix and req.allow_rewrite and state.get("attempts", 0) < 1:
        return "rewrite"
    return END


async def rewrite_node(state: State) -> State:
    problems = [f"- {i.message}" + (f" (found: {i.match})" if i.match else "") for i in state.get("issues", [])]
    if state.get("policy") and state["policy"].violation:  # type: ignore[union-attr]
        problems.append(f"- Policy: {state['policy'].explanation}")  # type: ignore[union-attr]
    prompt = REWRITE_PROMPT.format(policy=state.get("policy_text") or DEFAULT_POLICY, problems="\n".join(problems),
                                   sources=json.dumps(state["req"].sources, ensure_ascii=False) + "\n" + str((state.get("facts_pack") or {}).get("text", "")))
    try:
        out = await llm.chat(llm.Call(agent_id=AGENT_ID, tier="small", priority=1), [SystemMessage(prompt), HumanMessage(state["text"])])
        text = str(getattr(out, "content", out)).strip()
    except (llm.ModelUnavailable, llm.BudgetExceeded):
        return {"attempts": state.get("attempts", 0) + 1}
    return {"text": text or state["text"], "attempts": state.get("attempts", 0) + 1, "rewritten": bool(text),
            "policy": None, "policy_error": None, "issues": [], "checked_by": [*state["checked_by"], "rewrite"]}


def build() -> Any:
    g = StateGraph(State)
    g.add_node("rules", rules_node)
    g.add_node("policy", policy_node)
    g.add_node("verdict", verdict_node)
    g.add_node("rewrite", rewrite_node)
    g.add_edge(START, "rules")
    g.add_conditional_edges("rules", after_rules, {"policy": "policy", "verdict": "verdict"})
    g.add_edge("policy", "verdict")
    g.add_conditional_edges("verdict", after_verdict, {"rewrite": "rewrite", END: END})
    g.add_edge("rewrite", "rules")
    return g.compile()


_graph = build()


async def check(req: GuardRequest, *, policy_text: str | None, facts_pack: dict[str, Any] | None) -> GuardResult:
    out: State = await _graph.ainvoke({"req": req, "text": req.text, "policy_text": policy_text or DEFAULT_POLICY,
                                       "facts_pack": facts_pack or {}, "attempts": 0, "checked_by": []},
                                      config={"recursion_limit": 12})
    note = None
    if out.get("policy_error") and not req.rules_only:
        note = "The AI policy check could not run (" + str(out["policy_error"]) + "). " + (
            "The message is held: nothing is sent to patients or the public unchecked." if out["outcome"] == "held" else "Only the rules were checked.")
    pol = out.get("policy")
    return GuardResult(outcome=out["outcome"], text=out["text"], rewritten=bool(out.get("rewritten")),
                       issues=[i.to_dict() for i in out.get("issues", [])], policy=pol.model_dump() if pol else None,
                       checked_by=out.get("checked_by", []), note=note)
