"""The 14 agents, in build order. Each knows only its own job and gets only the tools that job needs."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

Tier = Literal["big", "small", "safeguard"]


@dataclass(frozen=True)
class AgentDef:
    id: str
    name: str
    job: str
    wing: str            # command | leads | studio | growth (the rooms on the Agents page)
    phase: int           # build phase it arrives in (1 = foundation)
    tier: Tier
    woken_by: str
    can_do: str
    limits: str
    talks_to: tuple[str, ...] = field(default_factory=tuple)
    start_mode: str = "off"   # off until its phase ships; then shadow first, live after a clean trial


AGENTS: tuple[AgentDef, ...] = (
    AgentDef("chief_of_staff", "Chief of Staff", "Plans the day, hands work to agents, checks they finished", "command", 2, "big",
             "7 am, 2 pm; any agent asking for help", "Create and assign Team board cards; start other agents", "Cannot send anything outside",
             ("*",)),
    AgentDef("compliance_guard", "Compliance Guard", "Checks every outgoing message, post and reply before it leaves", "command", 1, "safeguard",
             "Every outgoing action", "Block, or ask for a rewrite", "Cannot be switched off for outgoing actions",
             ("content_writer", "broadcast_manager", "social_publisher", "reputation", "lead_responder"), start_mode="live"),
    AgentDef("data_watcher", "Data Watcher", "Reads the numbers and spots changes worth acting on", "command", 2, "small",
             "6:30 am, hourly", "Raise alerts for other agents", "Read only; totals only, never patient details", ("chief_of_staff", "reporter_coach")),
    AgentDef("lead_responder", "Lead Responder", "First reply to every new lead within a minute; assigns an owner", "leads", 2, "small",
             "New lead (WhatsApp, form, Facebook, website)", "Send an approved template; assign the lead; set a follow-up",
             "Templates only; 1 auto-reply per person per day", ("lead_follow_up", "compliance_guard")),
    AgentDef("lead_follow_up", "Lead Follow-up", "Moves leads towards a visit: reminders, call queue, lost reasons", "leads", 2, "small",
             "2 pm; lead idle 24 h", "Template follow-ups; add to the call queue", "At most 3 follow-ups per lead; never after an opt-out",
             ("lead_responder", "partner_network")),
    AgentDef("partner_network", "Partner Network", "Keeps ASHAs, RMPs and chemists active: who went quiet, who to thank", "leads", 3, "small",
             "Daily 9 am", "Field tasks; thank-you templates to partners", "Never offers money or commission; 20 messages a day",
             ("field_coordinator", "content_writer")),
    AgentDef("field_coordinator", "Field Coordinator", "Plans field work: coverage gaps, visit lists, field mapping surveys", "leads", 3, "small",
             "Daily 9 am; coverage alerts", "Agent tasks; occasional field surveys", "Within each agent's assigned block",
             ("chief_of_staff", "camp_planner")),
    AgentDef("camp_planner", "Camp Planner", "Picks where and when to hold camps from disease patterns and demand", "studio", 4, "big",
             "Weekly; disease alerts", "Draft camp plans as board cards; invite lists", "Doesn't book camps or spend money",
             ("content_writer", "field_coordinator")),
    AgentDef("content_writer", "Content Writer", "Writes posts, posters and messages in Hindi, Hinglish, Bangla and English", "studio", 3, "small",
             "Content calendar; requests from other agents", "Drafts only", "Hands every draft to Compliance Guard", ("compliance_guard",)),
    AgentDef("social_publisher", "Social Publisher", "Publishes on Facebook and Instagram at the best times", "studio", 3, "small",
             "10 am, 6 pm", "Publish checked posts", "Up to 2 posts a day per channel", ("content_writer", "compliance_guard")),
    AgentDef("broadcast_manager", "Broadcast Manager", "Sends WhatsApp broadcasts to the right people at the right time", "studio", 4, "small",
             "Weekly plan; camps", "Send approved-template broadcasts", "Opted-in only; 1 broadcast a week per list and per person",
             ("compliance_guard", "camp_planner")),
    AgentDef("reputation", "Reputation", "Answers Google reviews; watches the rating", "studio", 3, "small",
             "New review", "Reply with safe wording; card for the desk on low ratings", "Never mentions illness, treatment or bills",
             ("compliance_guard", "reporter_coach")),
    AgentDef("ads_optimiser", "Ads Optimiser", "Reads ad results against patients who came, and suggests changes to you", "growth", 5, "big",
             "5 pm daily", "Suggestions only (you run Google and Meta ads yourself)", "Read only", ("chief_of_staff", "data_watcher")),
    AgentDef("reporter_coach", "Reporter & Coach", "Evening report; writes lessons from results", "growth", 2, "big",
             "8 pm, 11 pm", "Report to admins and marketing managers; save checked lessons", "Cannot change other agents' limits", ("*",)),
)

BY_ID = {a.id: a for a in AGENTS}
WINGS = {"command": "Command room", "leads": "Leads wing", "studio": "Studio & channels", "growth": "Growth desk"}
