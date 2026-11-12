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
    built: bool = False       # its code is in this service (only built agents can be switched on)


AGENTS: tuple[AgentDef, ...] = (
    AgentDef("chief_of_staff", "Chief of Staff", "Turns the morning's numbers into the day's plan, and checks on it", "command", 2, "big",
             "7:15 am (the plan) and 2 pm (a check; silent when all is well)",
             "Send the plan to the managers; add Team board cards for people; hand work to other agents",
             "Sends nothing outside the hospital; at most 5 priorities and 3 cards a day; every priority must come from a signal, with the signal's own numbers",
             ("*",), built=True),
    AgentDef("compliance_guard", "Compliance Guard", "Checks every outgoing message, post and reply before it leaves", "command", 1, "safeguard",
             "Every outgoing action", "Block, or ask for a rewrite", "Cannot be switched off for outgoing actions",
             ("content_writer", "broadcast_manager", "social_publisher", "reputation", "lead_responder"), start_mode="live", built=True),
    AgentDef("data_watcher", "Data Watcher", "Reads the numbers and spots changes worth acting on", "command", 2, "small",
             "6:30 am, then every hour from 8 am to 8 pm", "Raise signals for the Chief of Staff; tell the managers at once about a serious one (once a day each)",
             "Read only; totals only, never patient details; fixed rules, no AI", ("chief_of_staff", "reporter_coach"), built=True),
    AgentDef("lead_responder", "Lead Responder", "Answers what a new lead asked on WhatsApp, from live records", "leads", 2, "small",
             "A lead writes on WhatsApp (after 3 minutes in office hours, so the desk can answer first)", "Reply inside the 24-hour window; set the department; hand to a person; emergency alert",
             "Answers only from doctor, OPD and camp records; never prices, complaints, reports or medical questions; 1 reply per lead per hour",
             ("lead_follow_up", "compliance_guard"), built=True),
    AgentDef("lead_follow_up", "Lead Follow-up", "Nudges leads that went quiet, then hands them to a person to call", "leads", 2, "small",
             "Every hour, 10 am to 6 pm: leads idle for a day, and web or ad leads nobody contacted in 30 minutes",
             "Send the approved follow-up template (day 1, 3 and 7); ask the owner to call; close the lead as lost after 10 more quiet days",
             "At most 3 follow-ups per lead and 40 a day; never after an opt-out; no AI-written text; a closed lead can be reopened by a person",
             ("lead_responder", "partner_network"), built=True),
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
    AgentDef("reporter_coach", "Reporter & Coach", "Evening report; suggests lessons from the day's corrections", "growth", 2, "big",
             "8 pm (report) and 8:30 pm (lessons)", "Report to the managers; suggest lessons, which an agent reads only after a person keeps them",
             "Sends nothing outside; a report line with a number it wasn't given is dropped; cannot change other agents' limits", ("*",), built=True),
)

BY_ID = {a.id: a for a in AGENTS}
WINGS = {"command": "Command room", "leads": "Leads wing", "studio": "Studio & channels", "growth": "Growth desk"}
