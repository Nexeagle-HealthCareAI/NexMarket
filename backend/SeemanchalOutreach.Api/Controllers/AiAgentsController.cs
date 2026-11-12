using Microsoft.Extensions.DependencyInjection;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Logging;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    /// <summary>Where the agents service runs and the secret shared with it (environment: Agents__Url, Agents__Secret).</summary>
    public class AgentsSettings
    {
        public string Url { get; set; } = "http://localhost:5020";
        /// <summary>Long random string, the same value as the agents service's AGENTS_SECRET. Never in the repo.</summary>
        public string? Secret { get; set; }
    }

    /// <summary>
    /// Tells the Vita agents service that something happened (a lead wrote in). Fire and forget: a slow or stopped agents
    /// service never delays or breaks NexMarket. Does nothing until the shared secret is set.
    /// </summary>
    public class AgentEvents
    {
        private readonly IHttpClientFactory _http;
        private readonly AgentsSettings _cfg;
        private readonly ILogger<AgentEvents> _log;
        public AgentEvents(IHttpClientFactory http, IOptions<AgentsSettings> cfg, ILogger<AgentEvents> log) { _http = http; _cfg = cfg.Value; _log = log; }

        public void Publish(string kind, string refId, object? data = null)
        {
            if (string.IsNullOrWhiteSpace(_cfg.Secret)) return;
            _ = Task.Run(async () =>
            {
                try
                {
                    var c = _http.CreateClient("agents");
                    using var req = new HttpRequestMessage(HttpMethod.Post, _cfg.Url.TrimEnd('/') + "/v1/events") { Content = JsonContent.Create(new { kind, refId, data = data ?? new { } }) };
                    req.Headers.Add("X-Agents-Secret", _cfg.Secret);
                    using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                    using var res = await c.SendAsync(req, cts.Token);
                }
                catch (Exception ex) { _log.LogInformation("Vita agents not told about {Kind} {Ref}: {Error}", kind, refId, ex.Message); }
            });
        }
    }

    public class AiReasonDto { public string? Reason { get; set; } }
    public class AiModeDto { public string Mode { get; set; } = "off"; }
    public class AiSettingDto { public JsonElement Value { get; set; } }
    public class AiAskDto
    {
        public string? Question { get; set; }
        /// <summary>Where she is in the office right now ("at my desk", "floating in the pool"…), as the page shows it.</summary>
        public string? Where { get; set; }
    }

    /// <summary>
    /// The CRM's Agents page. Admins and marketing managers can watch the agents, stop or pause them and try
    /// the Compliance Guard. Only admins change limits, the policy, the facts pack or switch an agent on.
    /// Every change is in the audit log. The agents service itself is only reachable from this API.
    /// </summary>
    [ApiController]
    [Authorize]
    [Route("api/v1/ai-agents")]
    public class AiAgentsController : ControllerBase
    {
        private readonly IHttpClientFactory _http;
        private readonly AgentsSettings _cfg;
        private readonly IMarketingDbContext _db;
        private readonly IAuditActor _actor;

        public AiAgentsController(IHttpClientFactory http, IOptions<AgentsSettings> cfg, IMarketingDbContext db, IAuditActor actor)
        {
            _http = http;
            _cfg = cfg.Value;
            _db = db;
            _actor = actor;
        }

        private bool CanView => User.IsAdmin() || RoleChecks.CanonicalDashboardRole(User.RoleOf()) == RoleChecks.MarketingManager;
        private bool IsAdmin => User.IsAdmin();
        private string By => $"{User.FindFirst(ClaimTypes.Name)?.Value ?? User.AgentIdOf()} ({User.AgentIdOf()})";

        private HttpClient Client()
        {
            var c = _http.CreateClient("agents");
            c.BaseAddress = new Uri(_cfg.Url.TrimEnd('/') + "/");
            c.DefaultRequestHeaders.Remove("X-Agents-Secret");
            c.DefaultRequestHeaders.Add("X-Agents-Secret", _cfg.Secret ?? "");
            return c;
        }

        /// <summary>Calls the agents service and passes its answer (or a plain message if it can't be reached).</summary>
        private async Task<IActionResult> Forward(HttpMethod method, string path, object? body, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(_cfg.Secret))
                return StatusCode(503, new { message = "The agents service isn't set up yet (Agents__Secret is missing on the API).", offline = true });
            try
            {
                using var req = new HttpRequestMessage(method, path);
                if (body != null) req.Content = JsonContent.Create(body);
                using var res = await Client().SendAsync(req, ct);
                var text = await res.Content.ReadAsStringAsync(ct);
                if (!res.IsSuccessStatusCode)
                {
                    string message = "The agents service refused that.";
                    try
                    {
                        var detail = JsonDocument.Parse(text).RootElement.GetProperty("detail");
                        message = detail.ValueKind == JsonValueKind.Object && detail.TryGetProperty("message", out var dm) ? dm.ToString() : detail.ToString();
                    }
                    catch { /* not JSON */ }
                    return StatusCode((int)res.StatusCode >= 500 ? 502 : 400, new { message });
                }
                return Content(text, "application/json");
            }
            catch (Exception) when (!ct.IsCancellationRequested)
            {
                return StatusCode(503, new { message = "The agents service isn't answering. Nothing is being sent while it's down.", offline = true });
            }
        }

        private void Audit(string action, string entityId, string summary)
        {
            _db.AuditLogs.Add(new AuditLog
            {
                ActorId = _actor.ActorId, ActorName = _actor.ActorName, ActorRole = _actor.ActorRole, Source = _actor.Source,
                DeviceId = _actor.DeviceId, DeviceType = _actor.DeviceType, Ip = _actor.Ip, Request = _actor.Request,
                Action = action, Entity = "Vita marketing agents", EntityId = entityId, Summary = summary,
            });
        }

        private async Task<IActionResult> Change(HttpMethod method, string path, object body, string action, string entityId, string summary, CancellationToken ct)
        {
            var r = await Forward(method, path, body, ct);
            if (r is ContentResult)
            {
                Audit(action, entityId, summary);
                await _db.SaveChangesAsync(ct);
            }
            return r;
        }

        [HttpGet("overview")]
        public async Task<IActionResult> Overview(CancellationToken ct)
        {
            if (!CanView) return Forbid();
            var r = await Forward(HttpMethod.Get, "v1/overview", null, ct);
            if (r is not ContentResult c) return r;
            // Add what this person may do, so the page shows the right buttons.
            var node = JsonDocument.Parse(c.Content ?? "{}").RootElement;
            var dict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(node.GetRawText()) ?? new();
            return Ok(new { data = dict, me = new { isAdmin = IsAdmin, canStop = true, canEdit = IsAdmin } });
        }

        [HttpGet("actions")]
        public Task<IActionResult> Actions([FromQuery] string? agent, [FromQuery] int limit = 50, [FromQuery] string? before = null, CancellationToken ct = default)
        {
            if (!CanView) return Task.FromResult<IActionResult>(Forbid());
            var q = $"v1/actions?limit={Math.Clamp(limit, 1, 200)}" + (agent != null ? $"&agent={Uri.EscapeDataString(agent)}" : "") + (before != null ? $"&before={Uri.EscapeDataString(before)}" : "");
            return Forward(HttpMethod.Get, q, null, ct);
        }

        [HttpPost("stop-all")]
        public Task<IActionResult> StopAll([FromBody] AiReasonDto? d, CancellationToken ct)
        {
            if (!CanView) return Task.FromResult<IActionResult>(Forbid());
            return Change(HttpMethod.Post, "v1/stop-all", new { by = By, reason = d?.Reason }, "Stop", "all", "Stopped all Vita marketing agents", ct);
        }

        [HttpPost("resume-all")]
        public Task<IActionResult> ResumeAll(CancellationToken ct)
        {
            if (!CanView) return Task.FromResult<IActionResult>(Forbid());
            return Change(HttpMethod.Post, "v1/resume-all", new { by = By }, "Resume", "all", "Resumed all Vita marketing agents", ct);
        }

        [HttpPost("agents/{id}/pause")]
        public Task<IActionResult> Pause(string id, [FromBody] AiReasonDto? d, CancellationToken ct)
        {
            if (!CanView) return Task.FromResult<IActionResult>(Forbid());
            return Change(HttpMethod.Post, $"v1/agents/{Uri.EscapeDataString(id)}/pause", new { by = By, reason = d?.Reason }, "Pause", id, $"Paused Vita agent {id}", ct);
        }

        [HttpPost("agents/{id}/resume")]
        public Task<IActionResult> Resume(string id, CancellationToken ct)
        {
            if (!CanView) return Task.FromResult<IActionResult>(Forbid());
            return Change(HttpMethod.Post, $"v1/agents/{Uri.EscapeDataString(id)}/resume", new { by = By }, "Resume", id, $"Resumed Vita agent {id}", ct);
        }

        [HttpPut("agents/{id}/mode")]
        public Task<IActionResult> Mode(string id, [FromBody] AiModeDto d, CancellationToken ct)
        {
            if (!IsAdmin) return Task.FromResult<IActionResult>(StatusCode(403, new { message = "Only an admin can switch an agent on or off." }));
            return Change(HttpMethod.Put, $"v1/agents/{Uri.EscapeDataString(id)}/mode", new { by = By, mode = d.Mode }, "Update", id, $"Set Vita agent {id} to {d.Mode}", ct);
        }

        /// <summary>
        /// A typed question to one agent (the card in the 3D office). The answer is written by the AI in her voice from
        /// her own facts only: job, limits, state, today's numbers and latest action summaries. Names and numbers of
        /// people are hidden first, like everywhere else. The ready questions on the card never come here.
        /// </summary>
        [HttpPost("agents/{id}/ask")]
        public async Task<IActionResult> Ask(string id, [FromBody] AiAskDto dto, [FromServices] GroqClient groq, [FromServices] IOptions<AnalystSettings> ai,
            [FromServices] ChatAiService redaction, [FromServices] IMemoryCache cache, CancellationToken ct)
        {
            if (!CanView) return Forbid();
            var question = (dto.Question ?? "").Trim();
            if (question.Length < 2) return BadRequest(new { message = "Type a question first." });
            if (question.Length > 300) question = question[..300];
            if (!groq.Configured) return StatusCode(503, new { message = "Typed questions need the AI model: add the Groq API key on the API (Groq__ApiKey). The ready questions always work." });
            var dayKey = $"askagent:{User.AgentIdOf()}:{IstClock.NowIst:yyyyMMdd}";
            var used = cache.TryGetValue(dayKey, out int n) ? n : 0;
            if (used >= 150) return StatusCode(429, new { message = "That's enough typed questions for today. The ready questions always work." });

            var ov = await Forward(HttpMethod.Get, "v1/overview", null, ct);
            if (ov is not ContentResult oc) return ov;
            using var doc = JsonDocument.Parse(oc.Content ?? "{}");
            var root = doc.RootElement;
            JsonElement agent = default;
            var names = new Dictionary<string, string>();
            if (root.TryGetProperty("agents", out var list) && list.ValueKind == JsonValueKind.Array)
                foreach (var a in list.EnumerateArray())
                {
                    var aid = a.TryGetProperty("id", out var x) ? x.GetString() ?? "" : "";
                    names[aid] = a.TryGetProperty("name", out var nm) ? nm.GetString() ?? aid : aid;
                    if (aid == id) agent = a;
                }
            if (agent.ValueKind != JsonValueKind.Object) return NotFound(new { message = "There is no such agent." });
            static string S(JsonElement e, string key) => e.TryGetProperty(key, out var v) ? (v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : v.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined ? "" : v.ToString()) : "";
            static bool Flag(JsonElement e, string key) => e.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.True;
            var name = S(agent, "name");
            var facts = new StringBuilder();
            var stopped = root.TryGetProperty("stopAll", out var stop) && Flag(stop, "on");
            facts.AppendLine($"Name: {name}. Team: {S(agent, "wingName")}.");
            facts.AppendLine($"Job: {S(agent, "job")}.");
            facts.AppendLine($"Wakes up on: {S(agent, "wokenBy")}.");
            facts.AppendLine($"May do: {S(agent, "canDo")}.");
            facts.AppendLine($"Limits: {S(agent, "limits")}.");
            if (agent.TryGetProperty("talksTo", out var talks) && talks.ValueKind == JsonValueKind.Array)
                facts.AppendLine("Works with: " + string.Join(", ", talks.EnumerateArray().Select(t => t.GetString() == "*" ? "every agent" : names.GetValueOrDefault(t.GetString() ?? "", t.GetString() ?? ""))) + ".");
            facts.AppendLine(stopped ? "State: ALL agents are stopped by a person; nothing is sent."
                : !Flag(agent, "available") ? $"State: has not started work yet; arrives in build phase {S(agent, "phase")}."
                : Flag(agent, "paused") ? $"State: paused. Reason: {S(agent, "pausedReason")}."
                : S(agent, "mode") switch { "live" => "State: live (really sends).", "shadow" => "State: shadow (practises; does everything except send).", _ => "State: switched off." });
            var where = (dto.Where ?? "").Trim();
            if (where.Length > 0) facts.AppendLine($"In the office right now: {(where.Length > 90 ? where[..90] : where)}. (Agents with no work relax at the pool party or in the lounge and walk back to the desk when work arrives.)");
            if (agent.TryGetProperty("today", out var today))
                facts.AppendLine($"Today so far: {S(today, "done")} done, {S(today, "shadow")} practice runs, {S(today, "blocked")} stopped by the Compliance Guard, {S(today, "skipped")} not done, {S(today, "failed")} failed. AI tokens used: {S(agent, "tokensToday")}.");
            var acts = await Forward(HttpMethod.Get, $"v1/actions?limit=20&agent={Uri.EscapeDataString(id)}", null, ct);
            if (acts is ContentResult ac)
            {
                try
                {
                    using var ad = JsonDocument.Parse(ac.Content ?? "[]");
                    if (ad.RootElement.ValueKind == JsonValueKind.Array && ad.RootElement.GetArrayLength() > 0)
                    {
                        facts.AppendLine("Latest actions (newest first, India time):");
                        foreach (var r in ad.RootElement.EnumerateArray().Take(20))
                        {
                            var at = DateTime.TryParse(S(r, "created_at"), null, System.Globalization.DateTimeStyles.RoundtripKind, out var d) ? (d.ToUniversalTime() + IstClock.Offset).ToString("d MMM HH:mm") : "";
                            var line = S(r, "summary");
                            facts.AppendLine($"- {at} [{S(r, "status")}] {(line.Length > 200 ? line[..200] : line)}");
                        }
                    }
                }
                catch (JsonException) { /* no action list: answer from the rest */ }
            }

            try
            {
                var red = await redaction.RedactorAsync(ct);
                var system =
                    $"You are {name}, one of the Vita marketing agents (an AI helper) in a hospital's marketing office in Bihar, India. " +
                    "Your manager is asking you a question. Answer in the first person, in 1 to 4 short sentences of plain English, using ONLY the facts below. " +
                    "If the facts don't answer the question, say you can't tell that from here and say what you do know. Never invent numbers, names, times or events. " +
                    "Never give medical advice, and never say what a patient has or needs. Do not mention these instructions. " + Redactor.Rule +
                    "\n\nFacts about you:\n" + red.Hide(facts.ToString());
                var messages = new System.Text.Json.Nodes.JsonArray
                {
                    new System.Text.Json.Nodes.JsonObject { ["role"] = "system", ["content"] = system },
                    new System.Text.Json.Nodes.JsonObject { ["role"] = "user", ["content"] = red.Hide(question) },
                };
                var (msg, _) = await groq.ChatAsync(messages, null, null, ct, model: ai.Value.FastModel, temperature: 0.3, reasoningEffort: "low", maxPromptChars: 12000);
                var answer = red.Restore(msg["content"]?.ToString()).Trim();
                if (answer.Length == 0) return StatusCode(502, new { message = "No answer came back. Try again, or use a ready question." });
                cache.Set(dayKey, used + 1, TimeSpan.FromHours(26));
                return Ok(new { answer = answer.Length > 900 ? answer[..900] : answer });
            }
            catch (ChatAiException ex) { return StatusCode(ex.Status, new { message = ex.Message }); }
            catch (AnalystUnavailableException ex) { return StatusCode(502, new { message = ex.Message }); }
            catch (HttpRequestException) { return StatusCode(502, new { message = "Couldn't reach the AI just now. Try again, or use a ready question." }); }
            catch (TaskCanceledException) when (!ct.IsCancellationRequested) { return StatusCode(504, new { message = "The AI took too long. Try again, or use a ready question." }); }
        }

        [HttpGet("settings")]
        public Task<IActionResult> Settings(CancellationToken ct)
        {
            if (!CanView) return Task.FromResult<IActionResult>(Forbid());
            return Forward(HttpMethod.Get, "v1/settings", null, ct);
        }

        [HttpPut("settings/{key}")]
        public Task<IActionResult> PutSetting(string key, [FromBody] AiSettingDto d, CancellationToken ct)
        {
            if (!IsAdmin) return Task.FromResult<IActionResult>(StatusCode(403, new { message = "Only an admin can change the agents' limits, policy or facts." }));
            if (key is not ("limits" or "policy" or "facts" or "recipients")) return Task.FromResult<IActionResult>(NotFound());
            return Change(HttpMethod.Put, $"v1/settings/{key}", new { by = By, value = d.Value }, "Update", key, $"Changed Vita marketing agents {key}", ct);
        }

        [HttpPost("guard/check")]
        public Task<IActionResult> Guard([FromBody] JsonElement body, CancellationToken ct)
        {
            if (!CanView) return Task.FromResult<IActionResult>(Forbid());
            // Only the fields the Guard reads are passed on, and it's marked as coming from a person.
            string S(string k, string def) => body.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? def : def;
            var text = S("text", "");
            if (text.Length > 6000) text = text[..6000];
            var rulesOnly = body.TryGetProperty("rulesOnly", out var ro) && ro.ValueKind == JsonValueKind.True;
            return Forward(HttpMethod.Post, "v1/guard/check", new { text, channel = S("channel", "whatsapp"), audience = S("audience", "patient"), rules_only = rulesOnly, allow_rewrite = !rulesOnly, from_agent = (string?)null }, ct);
        }

        /// <summary>
        /// A person checks something an agent did or would have sent (shadow): good, edited (with the better text) or wrong,
        /// and can send it to the lead from here. The verdicts are the agent's accuracy; a note can be kept as a lesson.
        /// </summary>
        [HttpPost("actions/{id:guid}/review")]
        public Task<IActionResult> Review(Guid id, [FromBody] AiReviewDto d, CancellationToken ct)
        {
            if (!CanView) return Task.FromResult<IActionResult>(Forbid());
            var verdict = d.Verdict is "good" or "edited" or "wrong" ? d.Verdict : "";
            return Change(HttpMethod.Post, $"v1/actions/{id}/review",
                new { by = By, verdict, text = d.Text, note = d.Note, send = d.Send, remember = d.Remember },
                "Update", id.ToString(), $"Checked a Vita draft: {verdict}{(d.Send && verdict != "wrong" ? ", sent" : "")}", ct);
        }

        [HttpPost("lessons")]
        public Task<IActionResult> AddLesson([FromBody] AiLessonDto d, CancellationToken ct)
        {
            if (!CanView) return Task.FromResult<IActionResult>(Forbid());
            var text = (d.Text ?? "").Trim();
            if (text.Length < 8) return Task.FromResult<IActionResult>(BadRequest(new { message = "Write the lesson in one sentence." }));
            return Change(HttpMethod.Post, "v1/lessons", new { by = By, agent = d.Agent, text = text.Length > 400 ? text[..400] : text }, "Create", d.Agent, $"Gave Vita agent {d.Agent} a lesson", ct);
        }

        /// <summary>A lesson the Coach suggested is kept: the agent reads it from its next run.</summary>
        [HttpPost("lessons/{agent}/{key}/keep")]
        public Task<IActionResult> KeepLesson(string agent, string key, CancellationToken ct)
        {
            if (!CanView) return Task.FromResult<IActionResult>(Forbid());
            return Change(HttpMethod.Post, $"v1/lessons/{Uri.EscapeDataString(agent)}/{Uri.EscapeDataString(key)}/keep", new { by = By }, "Update", agent, $"Kept a suggested lesson for Vita agent {agent}", ct);
        }

        /// <summary>Runs one of the agents' daily jobs now instead of at its hour (the agent's own mode and limits still apply).</summary>
        [HttpPost("run")]
        public Task<IActionResult> RunNow([FromBody] AiRunDto d, CancellationToken ct)
        {
            if (!IsAdmin) return Task.FromResult<IActionResult>(StatusCode(403, new { message = "Only an admin can run an agent's job by hand." }));
            if (d.Job is not ("data_watcher" or "chief_plan" or "chief_check" or "evening_report" or "coach" or "lead_follow_up")) return Task.FromResult<IActionResult>(NotFound());
            return Change(HttpMethod.Post, "v1/run", new { by = By, job = d.Job }, "Update", d.Job, $"Ran the Vita job {d.Job} by hand", ct);
        }

        [HttpPost("lessons/{agent}/{key}/drop")]
        public Task<IActionResult> DropLesson(string agent, string key, CancellationToken ct)
        {
            if (!CanView) return Task.FromResult<IActionResult>(Forbid());
            return Change(HttpMethod.Post, $"v1/lessons/{Uri.EscapeDataString(agent)}/{Uri.EscapeDataString(key)}/drop", new { by = By }, "Delete", agent, $"Removed a lesson from Vita agent {agent}", ct);
        }

        [HttpGet("lessons")]
        public Task<IActionResult> Lessons([FromQuery] string? agent, CancellationToken ct)
        {
            if (!CanView) return Task.FromResult<IActionResult>(Forbid());
            return Forward(HttpMethod.Get, "v1/lessons" + (agent != null ? $"?agent={Uri.EscapeDataString(agent)}" : ""), null, ct);
        }

        [HttpGet("tasks")]
        public Task<IActionResult> Tasks([FromQuery] string? status, CancellationToken ct)
        {
            if (!CanView) return Task.FromResult<IActionResult>(Forbid());
            return Forward(HttpMethod.Get, "v1/tasks" + (status != null ? $"?status={Uri.EscapeDataString(status)}" : ""), null, ct);
        }
    }

    public class AgentNotifyDto
    {
        public string Title { get; set; } = "";
        public string Body { get; set; } = "";
        public string? Link { get; set; }
        public string AgentId { get; set; } = "";
        /// <summary>admin | marketing_manager (from the Agents page's report recipients).</summary>
        public List<string> Roles { get; set; } = new();
    }

    public class AiReviewDto
    {
        public string Verdict { get; set; } = "";
        public string? Text { get; set; }
        public string? Note { get; set; }
        public bool Send { get; set; }
        public bool Remember { get; set; }
    }
    public class AiRunDto { public string Job { get; set; } = ""; }
    public class AiLessonDto { public string Agent { get; set; } = ""; public string? Text { get; set; } }
    public class AgentIdDto { public string AgentId { get; set; } = ""; }

    public class AgentLeadReplyDto { public string Text { get; set; } = ""; public string AgentId { get; set; } = ""; }
    public class AgentLeadUpdateDto
    {
        public string AgentId { get; set; } = "";
        public string? Department { get; set; }
        public string? Note { get; set; }
        /// <summary>Tell the lead's owner (or the desk) now, e.g. an emergency or a question only a person can answer.</summary>
        public string? Alert { get; set; }
        public bool Urgent { get; set; }
    }

    public class AgentCardDto
    {
        public string Title { get; set; } = "";
        public string? Description { get; set; }
        public string AgentId { get; set; } = "";
        public string Priority { get; set; } = "normal";
        public List<string>? Labels { get; set; }
        public string? DueDate { get; set; }
    }

    /// <summary>
    /// The tools the agents service calls back. Not for people: only requests carrying the shared secret are
    /// served, and each tool does one narrow thing. Phase 1: alert the team, and put a card on the Team board.
    /// </summary>
    [ApiController]
    [AllowAnonymous]
    [Route("api/v1/internal/agent-tools")]
    public class AgentToolsController : ControllerBase
    {
        private readonly AgentsSettings _cfg;
        private readonly IMarketingDbContext _db;
        private readonly INotifier _notifier;
        private readonly ILiveEvents _live;
        private readonly WhatsAppOutbox _outbox;
        private readonly IPermissionService _perms;

        public AgentToolsController(IOptions<AgentsSettings> cfg, IMarketingDbContext db, INotifier notifier, ILiveEvents live, WhatsAppOutbox outbox, IPermissionService perms)
        {
            _outbox = outbox;
            _perms = perms;
            _cfg = cfg.Value;
            _db = db;
            _notifier = notifier;
            _live = live;
        }

        private bool Allowed()
        {
            var secret = _cfg.Secret;
            if (string.IsNullOrWhiteSpace(secret)) return false;
            var given = Request.Headers["X-Agents-Secret"].ToString();
            var a = Encoding.UTF8.GetBytes(given);
            var b = Encoding.UTF8.GetBytes(secret);
            return a.Length == b.Length && CryptographicOperations.FixedTimeEquals(a, b);
        }

        // ─── Reputation: Google reviews ────────────────────────────────────

        private static string ScriptOf(string? text)
        {
            foreach (var ch in text ?? "")
            {
                if (ch >= 0x0980 && ch <= 0x09FF) return "bn";
                if (ch >= 0x0900 && ch <= 0x097F) return "hi";
            }
            return string.IsNullOrWhiteSpace(text) ? "hi" : "en";
        }

        /// <summary>
        /// Google reviews from the last 30 days that have no reply. Only the stars, the date and which script the review
        /// is written in: the reviewer's name and words are not given out.
        /// </summary>
        [HttpGet("reviews/unanswered")]
        public async Task<IActionResult> ReviewsUnanswered(CancellationToken ct)
        {
            if (!Allowed()) return Unauthorized();
            var since = DateTime.UtcNow.AddDays(-30);
            var rows = await _db.GoogleReviews.AsNoTracking().Where(r => r.RepliedAt == null && r.ReplyText == null && r.PostedAt >= since)
                .OrderBy(r => r.PostedAt).Take(100).Select(r => new { r.Id, r.Stars, r.PostedAt, r.Comment }).ToListAsync(ct);
            return Ok(new { items = rows.Select(r => new { id = r.Id, stars = r.Stars, postedAt = r.PostedAt, hasComment = !string.IsNullOrWhiteSpace(r.Comment), language = ScriptOf(r.Comment) }) });
        }

        /// <summary>Posts the hospital's reply to a review on Google. Refused when the review already has a reply.</summary>
        [HttpPost("reviews/{id:guid}/reply")]
        public async Task<IActionResult> ReviewReply(Guid id, [FromBody] AgentLeadReplyDto d, CancellationToken ct)
        {
            if (!Allowed()) return Unauthorized();
            var text = (d.Text ?? "").Trim();
            if (text.Length == 0 || text.Length > 1500) return BadRequest(new { message = "bad_text" });
            var review = await _db.GoogleReviews.FirstOrDefaultAsync(r => r.Id == id, ct);
            if (review == null) return NotFound();
            if (review.RepliedAt != null || review.ReplyText != null) return Conflict(new { message = "already_replied" });
            var sync = HttpContext.RequestServices.GetRequiredService<GoogleSyncService>();
            var err = await sync.ReplyAsync(review, text, "ai:" + d.AgentId, ct);
            if (err != null) return Conflict(new { message = "google_refused", error = err });
            return Ok(new { status = "replied" });
        }

        // ─── Social Publisher: a post on the hospital's Facebook page ─────────

        /// <summary>
        /// Publishes a text post on the connected Facebook page and adds it to the Social page. Needs the page connection in
        /// Marketing settings to allow publishing; Facebook's own reason is passed back when it refuses.
        /// </summary>
        [HttpPost("social/publish")]
        public async Task<IActionResult> SocialPublish([FromBody] AgentLeadReplyDto d, CancellationToken ct)
        {
            if (!Allowed()) return Unauthorized();
            var text = (d.Text ?? "").Trim();
            if (text.Length < 20 || text.Length > 3000) return BadRequest(new { message = "bad_text" });
            var meta = MetaConfig.Load(HttpContext.RequestServices.GetRequiredService<IAppSettings>());
            if (!meta.PageConnected) return Conflict(new { message = "page_not_connected" });
            var graph = HttpContext.RequestServices.GetRequiredService<MetaGraph>();
            var r = await graph.PostAsync(meta.ApiVersion, $"{meta.PageId}/feed", meta.PageToken, new { message = text }, ct);
            if (!r.Ok || r.Doc == null) return Conflict(new { message = "facebook_refused", error = r.Error });
            string? postId;
            using (r.Doc) postId = r.Doc.RootElement.TryGetProperty("id", out var pid) ? pid.GetString() : null;
            var post = new SocialPost
            {
                Channel = "facebook", ExternalId = postId, Source = "manual", Text = text, MediaType = "text", PostedAt = DateTime.UtcNow,
                Permalink = postId != null ? $"https://www.facebook.com/{postId}" : null, CreatedBy = "ai:" + d.AgentId, Note = "Published by Vita",
            };
            _db.SocialPosts.Add(post);
            await _db.SaveChangesAsync(ct);
            return Ok(new { status = "published", id = post.Id, permalink = post.Permalink });
        }

        // ─── Broadcast Manager: a camp invitation to the partners of its block ─────

        private static string CampDate(HealthCamp c) => c.Date.ToString("d MMM (dddd)", System.Globalization.CultureInfo.InvariantCulture);

        /// <summary>
        /// Camps 2 to 5 days away that have had no invitation broadcast yet, with how many partners in the camp's block would
        /// get it (opted-out and wrong numbers already left out), and whether that block had any broadcast in the last 7 days.
        /// </summary>
        [HttpGet("broadcasts/camp-candidates")]
        public async Task<IActionResult> CampCandidates(CancellationToken ct)
        {
            if (!Allowed()) return Unauthorized();
            var today = AttendanceService.TodayIst;
            var camps = await _db.HealthCamps.AsNoTracking().Where(c => c.Date >= today.AddDays(2) && c.Date <= today.AddDays(5) && (c.Status == "planned" || c.Status == "confirmed") && c.Block != null && c.Block != "")
                .OrderBy(c => c.Date).Take(10).ToListAsync(ct);
            var recent = await _db.Broadcasts.AsNoTracking().Where(b => b.CreatedAt > DateTime.UtcNow.AddDays(-30) && b.Status != "cancelled" && b.Status != "failed")
                .Select(b => new { b.Kind, b.ParamsJson, b.AudienceJson, At = b.ScheduledAt ?? b.CreatedAt }).ToListAsync(ct);
            var items = new List<object>();
            foreach (var c in camps)
            {
                if (recent.Any(b => b.ParamsJson.Contains(c.Id.ToString()))) continue;
                var audience = new BroadcastAudience { Blocks = new() { c.Block! } };
                var count = await BroadcastComposer.Audience(_db, audience).CountAsync(ct);
                var blockBusy = recent.Any(b => b.At > DateTime.UtcNow.AddDays(-7) && (b.AudienceJson.Contains($"\"{c.Block}\"") || b.AudienceJson.Contains("\"Blocks\":[]")));
                var p = CampParams(c);
                items.Add(new
                {
                    campId = c.Id, title = c.Title, date = c.Date, block = c.Block, recipients = count, blockHadBroadcastThisWeek = blockBusy,
                    preview = BroadcastComposer.Preview("camp_invite", "hi", p, ""),
                    facts = new { place = p["place"], date = p["date"], start = c.StartTime, end = c.EndTime, venue = c.Venue, block = c.Block },
                });
            }
            return Ok(new { connected = _outbox.Config.IsConfigured, paused = _outbox.Rules.Paused, items });
        }

        private static Dictionary<string, string> CampParams(HealthCamp c) => new()
        {
            ["place"] = string.IsNullOrWhiteSpace(c.Venue) ? c.Block ?? "" : $"{c.Venue}, {c.Block}",
            ["date"] = CampDate(c),
            ["details"] = $"{c.Title}. समय: {c.StartTime} से {c.EndTime}.",
            ["campId"] = c.Id.ToString(),
        };

        /// <summary>
        /// Schedules the camp invitation (the approved camp template) to the partners of the camp's block, now. Refused when
        /// the camp already has one, when the block had a broadcast in the last 7 days, or when nobody would receive it.
        /// </summary>
        [HttpPost("broadcasts/camp/{campId:guid}")]
        public async Task<IActionResult> CampBroadcast(Guid campId, [FromBody] AgentIdDto d, CancellationToken ct)
        {
            if (!Allowed()) return Unauthorized();
            var c = await _db.HealthCamps.AsNoTracking().FirstOrDefaultAsync(x => x.Id == campId, ct);
            if (c == null) return NotFound();
            var today = AttendanceService.TodayIst;
            if (c.Date < today || c.Status == "cancelled" || c.Status == "done" || string.IsNullOrWhiteSpace(c.Block)) return Conflict(new { message = "camp_not_open" });
            if (!_outbox.Config.IsConfigured) return Conflict(new { message = "whatsapp_not_connected" });
            if (_outbox.Rules.Paused) return Conflict(new { message = "whatsapp_paused" });
            var recent = await _db.Broadcasts.AsNoTracking().Where(b => b.CreatedAt > DateTime.UtcNow.AddDays(-30) && b.Status != "cancelled" && b.Status != "failed")
                .Select(b => new { b.ParamsJson, b.AudienceJson, At = b.ScheduledAt ?? b.CreatedAt }).ToListAsync(ct);
            if (recent.Any(b => b.ParamsJson.Contains(c.Id.ToString()))) return Conflict(new { message = "already_sent" });
            if (recent.Any(b => b.At > DateTime.UtcNow.AddDays(-7) && (b.AudienceJson.Contains($"\"{c.Block}\"") || b.AudienceJson.Contains("\"Blocks\":[]")))) return Conflict(new { message = "block_had_broadcast_this_week" });
            var audience = new BroadcastAudience { Blocks = new() { c.Block! } };
            var count = await BroadcastComposer.Audience(_db, audience).CountAsync(ct);
            if (count == 0) return Conflict(new { message = "nobody" });
            var p = CampParams(c);
            var b = new Broadcast
            {
                Kind = "camp_invite", Language = "hi", Title = BroadcastComposer.TitleFor("camp_invite", p), ParamsJson = JsonSerializer.Serialize(p),
                AudienceJson = JsonSerializer.Serialize(audience), PreviewText = BroadcastComposer.Preview("camp_invite", "hi", p, ""), RecipientCount = count,
                ScheduledAt = DateTime.UtcNow, Status = "scheduled", CreatedBy = "ai:" + d.AgentId, CreatedAt = DateTime.UtcNow,
            };
            _db.Broadcasts.Add(b);
            await _db.SaveChangesAsync(ct);
            return Ok(new { status = "scheduled", id = b.Id, recipients = count });
        }

        // ─── Numbers for the Data Watcher, the Chief of Staff and the Reporter ─────────────────

        /// <summary>
        /// Today's totals next to what is usual, for the Data Watcher. Counts only: no names, no phone numbers, no message
        /// text. "usualByNow" is the average of the last 7 days up to this time of day, so a morning is compared with mornings.
        /// </summary>
        [HttpGet("numbers")]
        public async Task<IActionResult> Numbers(CancellationToken ct)
        {
            if (!Allowed()) return Unauthorized();
            var now = DateTime.UtcNow;
            var day0 = IstClock.TodayStartUtc;
            var into = now - day0;                         // how far into the India day we are
            var week0 = day0.AddDays(-7);
            var weekStart = day0.AddDays(-6);              // this week = today and the 6 days before
            var prevWeekStart = weekStart.AddDays(-7);
            double Usual(IEnumerable<DateTime> times) => Math.Round(times.Count(t => t >= week0 && t < day0 && (t - day0.AddDays(Math.Floor((t - day0).TotalDays))) <= into) / 7.0, 1);

            // Leads
            var leads = await _db.Leads.AsNoTracking().Where(l => l.CreatedAt >= prevWeekStart).Select(l => new { l.CreatedAt, l.Source, l.Status, l.FirstResponseAt, l.ClosedAt }).ToListAsync(ct);
            var leadsToday = leads.Where(l => l.CreatedAt >= day0).ToList();
            var sources = leads.Where(l => l.CreatedAt >= week0).GroupBy(l => l.Source).Select(g => new
            {
                source = g.Key, today = g.Count(l => l.CreatedAt >= day0), usualByNow = Usual(g.Select(l => l.CreatedAt)), last7 = g.Count(l => l.CreatedAt < day0),
            }).OrderByDescending(x => x.last7).ToList();
            var waiting = await _db.Leads.AsNoTracking().Where(l => l.Status == "new" && l.FirstResponseAt == null && !l.OptOut && l.CreatedAt > now.AddDays(-3) && l.CreatedAt < now.AddMinutes(-30))
                .Select(l => l.CreatedAt).ToListAsync(ct);
            var openIdle = await _db.Leads.AsNoTracking().CountAsync(l => (l.Status == "new" || l.Status == "contacted") && l.ClosedAt == null && l.LastActivityAt < now.AddDays(-3), ct);
            var moved = await _db.LeadActivities.AsNoTracking().Where(a => a.Kind == "status" && a.CreatedAt >= prevWeekStart).Select(a => new { a.CreatedAt, a.Text }).ToListAsync(ct);
            int Moved(string to, DateTime from, DateTime until) => moved.Count(m => m.CreatedAt >= from && m.CreatedAt < until && m.Text.Contains("→ " + LeadInbox.StatusLabel(to)));

            // WhatsApp
            var wa = await _db.WaMessages.AsNoTracking().Where(m => m.CreatedAt >= week0).Select(m => new { m.CreatedAt, m.Direction, m.Status }).ToListAsync(ct);
            var waOutToday = wa.Where(m => m.Direction == "out" && m.CreatedAt >= day0).ToList();
            var waOutWeek = wa.Where(m => m.Direction == "out" && m.CreatedAt < day0).ToList();

            // Referrals from partners
            var refs = await _db.Referrals.AsNoTracking().Where(r => r.CreatedAt >= prevWeekStart).Select(r => new { r.CreatedAt, r.ArrivedAt }).ToListAsync(ct);
            var arrived = await _db.Referrals.AsNoTracking().Where(r => r.ArrivedAt != null && r.ArrivedAt >= prevWeekStart).Select(r => r.ArrivedAt!.Value).ToListAsync(ct);

            // Field work
            var visits = await _db.Visits.AsNoTracking().Where(v => v.CheckInAt >= week0).Select(v => v.CheckInAt).ToListAsync(ct);
            var onShift = await _db.Shifts.AsNoTracking().Where(x => x.StartTime >= day0).Select(x => x.AgentId).Distinct().CountAsync(ct);
            var shiftsWeek = await _db.Shifts.AsNoTracking().Where(x => x.StartTime >= week0 && x.StartTime < day0).Select(x => new { x.AgentId, x.StartTime }).ToListAsync(ct);
            var usualOnShift = Math.Round(shiftsWeek.GroupBy(x => (int)Math.Floor((x.StartTime - week0).TotalDays)).Select(g => g.Select(x => x.AgentId).Distinct().Count()).DefaultIfEmpty(0).Average(), 1);

            var today = AttendanceService.TodayIst;
            var overdue = await _db.AgentTasks.AsNoTracking().CountAsync(t => t.Status == "open" && t.DueDate != null && t.DueDate < today, ct);
            var reviews = await _db.GoogleReviews.AsNoTracking().Where(r => r.PostedAt >= now.AddDays(-30)).Select(r => new { r.PostedAt, r.Stars, r.RepliedAt }).ToListAsync(ct);
            var hoard = await _db.Hoardings.AsNoTracking().Where(h => h.Status != "ended" && h.Status != "rejected").ToListAsync(ct);

            var brief = await _db.AiBriefings.AsNoTracking().Where(b => b.Status == "ok" && b.Scope == "business").OrderByDescending(b => b.CreatedAt)
                .Select(b => new { b.CreatedAt, b.Health, b.Summary }).FirstOrDefaultAsync(ct);
            var items = await _db.AiItems.AsNoTracking().Where(i => (i.Status == "open" || i.Status == "in_progress") && i.Scope == "business")
                .OrderBy(i => i.Severity == "high" ? 0 : i.Severity == "medium" ? 1 : 2).ThenByDescending(i => i.UpdatedAt).Take(6)
                .Select(i => new { i.Kind, i.Title, i.Area, i.Metric, i.Severity, i.Trend, i.Owner, due = i.DueDate }).ToListAsync(ct);

            return Ok(new
            {
                asOf = now, istHour = IstClock.NowIst.Hour, weekday = IstClock.NowIst.DayOfWeek.ToString(),
                leads = new
                {
                    today = leadsToday.Count, usualByNow = Usual(leads.Select(l => l.CreatedAt)),
                    yesterday = leads.Count(l => l.CreatedAt >= day0.AddDays(-1) && l.CreatedAt < day0),
                    last7 = leads.Count(l => l.CreatedAt >= week0 && l.CreatedAt < day0),
                    bySource = sources,
                    waitingNoReply = waiting.Count,
                    oldestWaitingMinutes = waiting.Count == 0 ? 0 : (int)(now - waiting.Min()).TotalMinutes,
                    openIdle3Days = openIdle,
                    appointmentsThisWeek = Moved("appointment", weekStart, now), appointmentsPrevWeek = Moved("appointment", prevWeekStart, weekStart),
                    arrivedThisWeek = Moved("arrived", weekStart, now), arrivedPrevWeek = Moved("arrived", prevWeekStart, weekStart),
                    lostThisWeek = Moved("lost", weekStart, now), lostPrevWeek = Moved("lost", prevWeekStart, weekStart),
                },
                whatsapp = new
                {
                    paused = _outbox.Rules.Paused, configured = _outbox.Config.IsConfigured,
                    sentToday = waOutToday.Count, failedToday = waOutToday.Count(m => m.Status == "failed"),
                    sentLast7 = waOutWeek.Count, failedLast7 = waOutWeek.Count(m => m.Status == "failed"),
                    inboundToday = wa.Count(m => m.Direction == "in" && m.CreatedAt >= day0), inboundUsualByNow = Usual(wa.Where(m => m.Direction == "in").Select(m => m.CreatedAt)),
                },
                referrals = new
                {
                    today = refs.Count(r => r.CreatedAt >= day0), usualByNow = Usual(refs.Select(r => r.CreatedAt)),
                    thisWeek = refs.Count(r => r.CreatedAt >= weekStart), prevWeek = refs.Count(r => r.CreatedAt >= prevWeekStart && r.CreatedAt < weekStart),
                    arrivedThisWeek = arrived.Count(t => t >= weekStart), arrivedPrevWeek = arrived.Count(t => t >= prevWeekStart && t < weekStart),
                },
                field = new
                {
                    visitsToday = visits.Count(v => v >= day0), visitsUsualByNow = Usual(visits),
                    agentsOnShiftToday = onShift, agentsOnShiftUsual = usualOnShift, tasksOverdue = overdue,
                },
                reviews = new
                {
                    newThisWeek = reviews.Count(r => r.PostedAt >= weekStart), unanswered = reviews.Count(r => r.RepliedAt == null),
                    lowUnanswered = reviews.Count(r => r.RepliedAt == null && r.Stars <= 3),
                },
                hoardings = new
                {
                    waiting = hoard.Count(h => h.Status == "suggested"),
                    endingSoon = hoard.Count(h => Hoardings.Stage(h, today) == "ending"),
                    rentMissing = hoard.Count(h => (h.Status == "approved" || Hoardings.Running(h)) && h.MonthlyRent == null),
                },
                analyst = new { lastBriefingAt = brief?.CreatedAt, health = brief?.Health, summary = brief?.Summary, openItems = items },
            });
        }

        /// <summary>
        /// What happened to leads after Vita or the desk wrote to them, as counts, for the Reporter & Coach: did they write
        /// back, did they get an appointment, did they come. No names, numbers or message text.
        /// </summary>
        [HttpGet("lead-outcomes")]
        public async Task<IActionResult> LeadOutcomes([FromQuery] int days = 7, CancellationToken ct = default)
        {
            if (!Allowed()) return Unauthorized();
            days = Math.Clamp(days, 1, 60);
            var from = IstClock.TodayStartUtc.AddDays(-days + 1);
            var outs = await _db.WaMessages.AsNoTracking()
                .Where(m => m.Direction == "out" && m.CreatedAt >= from && m.LeadId != null && !NotSent.Contains(m.Status) && m.SentBy != null
                    && (m.SentBy.StartsWith("ai:") || HumanSources.Contains(m.Source)))
                .Select(m => new { LeadId = m.LeadId!.Value, m.SentBy, m.Source, m.CreatedAt }).ToListAsync(ct);
            var ids = outs.Select(o => o.LeadId).Distinct().ToList();
            var leads = ids.Count == 0 ? new() : (await _db.Leads.AsNoTracking().Where(l => ids.Contains(l.Id)).Select(l => new { l.Id, l.Status, l.LastInboundAt }).ToListAsync(ct)).ToDictionary(l => l.Id);
            object Group(Func<string, string, bool> pick)
            {
                var first = outs.Where(o => pick(o.SentBy!, o.Source)).GroupBy(o => o.LeadId).Select(g => new { g.Key, At = g.Min(o => o.CreatedAt) }).Where(x => leads.ContainsKey(x.Key)).ToList();
                var rows = first.Select(x => new { L = leads[x.Key], x.At }).ToList();
                return new
                {
                    leads = rows.Count,
                    wroteBack = rows.Count(r => r.L.LastInboundAt != null && r.L.LastInboundAt > r.At),
                    appointmentOrCame = rows.Count(r => r.L.Status is "appointment" or "arrived" or "admitted"),
                    came = rows.Count(r => r.L.Status is "arrived" or "admitted"),
                    lost = rows.Count(r => r.L.Status == "lost"),
                };
            }
            return Ok(new
            {
                days,
                answeredByVita = Group((by, src) => by == "ai:lead_responder"),
                answeredByDesk = Group((by, src) => !by.StartsWith("ai:")),
                followedUp = Group((by, src) => src == "followup"),
            });
        }

        [HttpPost("notify")]
        public async Task<IActionResult> Notify([FromBody] AgentNotifyDto d, CancellationToken ct)
        {
            if (!Allowed()) return Unauthorized();
            var wanted = (d.Roles.Count == 0 ? new List<string> { "admin", "marketing_manager" } : d.Roles)
                .Select(RoleChecks.CanonicalDashboardRole).Where(r => r is RoleChecks.Admin or RoleChecks.MarketingManager).ToHashSet();
            var people = (await _db.Agents.AsNoTracking().Where(a => a.IsActive).Select(a => new { a.AgentId, a.Role }).ToListAsync(ct))
                .Where(a => wanted.Contains(RoleChecks.CanonicalDashboardRole(a.Role))).Select(a => a.AgentId).ToList();
            if (people.Count == 0) return Ok(new { sent = 0 });
            var title = d.Title.Length > 120 ? d.Title[..120] : d.Title;
            var body = d.Body.Length > 600 ? d.Body[..600] : d.Body;
            _notifier.Notify(new NotifyJob { Kind = "note", Title = $"Vita · {title}", Body = body, Link = d.Link ?? "ai-agents", To = people });
            return Ok(new { sent = people.Count });
        }

        [HttpPost("board-card")]
        public async Task<IActionResult> BoardCard([FromBody] AgentCardDto d, CancellationToken ct)
        {
            if (!Allowed()) return Unauthorized();
            if (string.IsNullOrWhiteSpace(d.Title)) return BadRequest(new { message = "A card needs a title." });
            var labels = (d.Labels ?? new()).Select(l => l.Trim().ToLowerInvariant()).Where(l => l.Length is > 0 and <= 24).Prepend("ai").Distinct().Take(6).ToList();
            var c = new WorkCard
            {
                Title = d.Title.Trim().Length > 200 ? d.Title.Trim()[..200] : d.Title.Trim(),
                Description = d.Description?.Length > 4000 ? d.Description[..4000] : d.Description,
                Status = "todo",
                Priority = d.Priority is "urgent" or "high" or "low" ? d.Priority : "normal",
                LabelsJson = JsonSerializer.Serialize(labels),
                DueDate = DateOnly.TryParse(d.DueDate, out var due) ? due : null,
                CreatedBy = "ai:" + (d.AgentId.Length > 40 ? d.AgentId[..40] : d.AgentId),
            };
            c.Number = (await _db.WorkCards.MaxAsync(x => (int?)x.Number, ct) ?? 0) + 1;
            c.Order = (await _db.WorkCards.Where(x => x.Status == "todo" && !x.Archived).MaxAsync(x => (double?)x.Order, ct) ?? 0) + 1000;
            _db.WorkCards.Add(c);
            _db.WorkNotes.Add(new WorkNote { CardId = c.Id, Kind = "activity", AgentId = c.CreatedBy, Text = "created the card (AI agent)" });
            await _db.SaveChangesAsync(ct);
            await _live.PublishAsync(new LiveEvent { Kind = "work", Text = $"New card from an AI agent: {c.Title}", RefId = c.Id.ToString() });
            return Ok(new { id = c.Id, number = c.Number });
        }

        // ─── Lead Responder ────────────────────────────────────────────────

        private static readonly string[] HumanSources = { "inbox", "lead", "resend" };

        /// <summary>
        /// What the Lead Responder needs about one lead. No name and no phone number: the agent never needs them.
        /// Messages are the conversation's last 15, oldest first, each marked who sent it (the person, a desk member, Vita or an automatic reply).
        /// </summary>
        [HttpGet("leads/{id:guid}/context")]
        public async Task<IActionResult> LeadContext(Guid id, CancellationToken ct)
        {
            if (!Allowed()) return Unauthorized();
            var l = await _db.Leads.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (l == null) return NotFound();
            var msgs = (await _db.WaMessages.AsNoTracking().Where(m => m.Phone == l.Phone).OrderByDescending(m => m.CreatedAt).Take(15).ToListAsync(ct))
                .OrderBy(m => m.CreatedAt).Select(m => new
                {
                    id = m.Id, at = m.CreatedAt, direction = m.Direction, type = m.Type, text = m.Text, status = m.Status,
                    by = m.Direction == "in" ? "person" : m.SentBy != null && m.SentBy.StartsWith("ai:") ? "vita" : HumanSources.Contains(m.Source) && m.SentBy != null ? "desk" : "auto",
                });
            var rules = _outbox.Rules;
            var conv = await _db.WaConversations.AsNoTracking().Where(c => c.Phone == l.Phone).Select(c => new { c.OptOut }).FirstOrDefaultAsync(ct);
            return Ok(new
            {
                lead = new
                {
                    id = l.Id, status = l.Status, source = l.Source, department = l.Department, hasOwner = l.OwnerId != null,
                    optOut = l.OptOut || conv?.OptOut == true, createdAt = l.CreatedAt, lastInboundAt = l.LastInboundAt,
                    windowOpen = l.LastInboundAt != null && l.LastInboundAt > DateTime.UtcNow.AddHours(-24),
                },
                messages = msgs,
                whatsapp = new { paused = rules.Paused, inOfficeHours = rules.InOfficeHours(DateTime.UtcNow) },
            });
        }

        /// <summary>The live facts the Lead Responder may use: departments, doctors and their OPD, upcoming camps, office hours.</summary>
        [HttpGet("directory")]
        public async Task<IActionResult> Directory(CancellationToken ct)
        {
            if (!Allowed()) return Unauthorized();
            var deps = await _db.Departments.AsNoTracking().Where(d => d.IsActive).OrderBy(d => d.Order).Select(d => new { id = d.Id, name = d.Name }).ToListAsync(ct);
            var depName = deps.ToDictionary(d => d.id, d => d.name);
            var docs = (await _db.Doctors.AsNoTracking().Where(d => d.IsActive).OrderBy(d => d.Name).ToListAsync(ct))
                .Select(d => new { id = d.Id, name = d.Name, department = d.DepartmentId != null && depName.TryGetValue(d.DepartmentId.Value, out var n) ? n : null, qualification = d.Qualification, opdDays = d.OpdDays, opdTimings = d.OpdTimings });
            var today = DateOnly.FromDateTime(IstClock.NowIst);
            var camps = await _db.HealthCamps.AsNoTracking().Where(c => c.Date >= today && c.Date <= today.AddDays(45) && c.Status != "cancelled" && c.Status != "done")
                .OrderBy(c => c.Date).Take(20)
                .Select(c => new { id = c.Id, title = c.Title, type = c.CampType, date = c.Date, start = c.StartTime, end = c.EndTime, venue = c.Venue, block = c.Block, district = c.District, departments = c.Departments, doctors = c.Doctors, code = c.Code })
                .ToListAsync(ct);
            var r = _outbox.Rules;
            return Ok(new
            {
                departments = deps, doctors = docs, camps,
                officeHours = new { on = r.OfficeHoursOn, days = r.OfficeDays, start = r.OfficeStart, end = r.OfficeEnd },
                hospitalWhatsApp = LeadInbox.DisplayPhone(_outbox.Config),
                todayIst = today,
            });
        }

        /// <summary>
        /// Sends the Lead Responder's reply on WhatsApp. Only inside the 24-hour window (the person wrote in), never to someone who
        /// said stop, never while WhatsApp is paused, and never when a desk member already answered their last message.
        /// </summary>
        [HttpPost("leads/{id:guid}/reply")]
        public async Task<IActionResult> LeadReply(Guid id, [FromBody] AgentLeadReplyDto d, CancellationToken ct)
        {
            if (!Allowed()) return Unauthorized();
            var text = (d.Text ?? "").Trim();
            if (text.Length == 0 || text.Length > 2000) return BadRequest(new { message = "Reply must be 1–2000 characters." });
            var l = await _db.Leads.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (l == null) return NotFound();
            if (l.OptOut) return Conflict(new { message = "opted_out" });
            if (l.LastInboundAt == null || l.LastInboundAt < DateTime.UtcNow.AddHours(-24)) return Conflict(new { message = "window_closed" });
            if (_outbox.Rules.Paused) return Conflict(new { message = "whatsapp_paused" });
            var lastIn = await _db.WaMessages.AsNoTracking().Where(m => m.Phone == l.Phone && m.Direction == "in").MaxAsync(m => (DateTime?)m.CreatedAt, ct);
            var deskSince = await _db.WaMessages.AsNoTracking().AnyAsync(m => m.Phone == l.Phone && m.Direction == "out" && m.CreatedAt > lastIn
                && m.SentBy != null && !m.SentBy.StartsWith("ai:") && HumanSources.Contains(m.Source), ct);
            if (deskSince) return Conflict(new { message = "desk_replied" });
            var agent = "ai:" + (d.AgentId.Length > 40 ? d.AgentId[..40] : d.AgentId);
            var msg = await _outbox.SendTextAsync(l.Phone, text, "vita", agent, l.Id, ct);
            l.LastActivityAt = DateTime.UtcNow;
            _db.LeadActivities.Add(new LeadActivity { LeadId = l.Id, Kind = "note", By = agent, Text = $"Vita replied on WhatsApp: {(text.Length > 300 ? text[..300] + "…" : text)}" });
            await _db.SaveChangesAsync(ct);
            await _live.PublishAsync(new LiveEvent { Kind = "lead", Text = $"Vita replied to {l.Name}", RefId = l.Id.ToString() });
            return Ok(new { status = msg.Status, error = msg.Error, messageId = msg.Id });
        }

        private static readonly string[] NotSent = { "failed", "blocked" };

        /// <summary>
        /// Leads whose last WhatsApp message nobody (desk or Vita) has answered, still inside the 24-hour window. The agents
        /// service asks every few minutes, so a message it was never told about (it was restarting) is still picked up.
        /// </summary>
        [HttpGet("leads/waiting")]
        public async Task<IActionResult> LeadsWaiting(CancellationToken ct)
        {
            if (!Allowed()) return Unauthorized();
            var since = DateTime.UtcNow.AddHours(-24);
            var leads = await _db.Leads.AsNoTracking()
                .Where(l => l.LastInboundAt != null && l.LastInboundAt > since && !l.OptOut && l.ClosedAt == null && l.Status != "lost")
                .OrderBy(l => l.LastInboundAt).Take(300).Select(l => new { l.Id, l.Phone, l.LastInboundAt }).ToListAsync(ct);
            if (leads.Count == 0) return Ok(new { items = Array.Empty<object>() });
            var phones = leads.Select(l => l.Phone).Distinct().ToList();
            var answered = (await _db.WaMessages.AsNoTracking()
                    .Where(m => phones.Contains(m.Phone) && m.Direction == "out" && m.CreatedAt > since && m.SentBy != null && !NotSent.Contains(m.Status)
                        && (m.SentBy.StartsWith("ai:") || HumanSources.Contains(m.Source)))
                    .GroupBy(m => m.Phone).Select(g => new { Phone = g.Key, At = g.Max(m => m.CreatedAt) }).ToListAsync(ct))
                .ToDictionary(x => x.Phone, x => x.At);
            var optedOut = (await _db.WaConversations.AsNoTracking().Where(c => phones.Contains(c.Phone) && c.OptOut).Select(c => c.Phone).ToListAsync(ct)).ToHashSet();
            return Ok(new
            {
                items = leads.Where(l => !optedOut.Contains(l.Phone) && (!answered.TryGetValue(l.Phone, out var at) || at < l.LastInboundAt))
                    .Select(l => new { id = l.Id, lastInboundAt = l.LastInboundAt }),
            });
        }

        // ─── Lead Follow-up ────────────────────────────────────────────────

        public const int MaxFollowUps = 3;

        /// <summary>
        /// Open leads that have gone quiet, for the Lead Follow-up agent: how many follow-ups each has had since they last
        /// wrote, and when anyone last touched it. No names and no phone numbers.
        /// </summary>
        [HttpGet("leads/idle")]
        public async Task<IActionResult> LeadsIdle(CancellationToken ct)
        {
            if (!Allowed()) return Unauthorized();
            var now = DateTime.UtcNow;
            var idleSince = now.AddMinutes(-25);
            var notOlder = now.AddDays(-60);
            var leads = await _db.Leads.AsNoTracking()
                .Where(l => (l.Status == "new" || l.Status == "contacted") && !l.OptOut && l.ClosedAt == null && l.LastActivityAt < idleSince && l.CreatedAt > notOlder)
                .OrderBy(l => l.LastActivityAt).Take(400).ToListAsync(ct);
            var phones = leads.Select(l => l.Phone).Distinct().ToList();
            var outs = phones.Count == 0 ? new() : await _db.WaMessages.AsNoTracking()
                .Where(m => phones.Contains(m.Phone) && m.Direction == "out" && m.CreatedAt > notOlder && !NotSent.Contains(m.Status) && m.BroadcastId == null)
                .Select(m => new { m.Phone, m.Source, m.SentBy, m.CreatedAt }).ToListAsync(ct);
            var byPhone = outs.ToLookup(m => m.Phone);
            var ids = leads.Select(l => l.Id).ToList();
            var called = ids.Count == 0 ? new HashSet<Guid>() : (await _db.LeadActivities.AsNoTracking().Where(a => ids.Contains(a.LeadId) && a.Kind == "call").Select(a => a.LeadId).Distinct().ToListAsync(ct)).ToHashSet();
            var optedOut = phones.Count == 0 ? new HashSet<string>() : (await _db.WaConversations.AsNoTracking().Where(c => phones.Contains(c.Phone) && c.OptOut).Select(c => c.Phone).ToListAsync(ct)).ToHashSet();
            var cfg = _outbox.Config;
            var template = cfg.Template("lead_followup");
            return Ok(new
            {
                templateReady = cfg.IsConfigured && template != null,
                // The wording itself is the template Meta approved; it is not rewritten here.
                templateText = template != null ? $"Approved WhatsApp follow-up template “{template}”" : null,
                whatsappPaused = _outbox.Rules.Paused,
                maxFollowUps = MaxFollowUps,
                items = leads.Where(l => !optedOut.Contains(l.Phone) && l.Phone.Length >= 10).Select(l =>
                {
                    var mine = byPhone[l.Phone].ToList();
                    var follow = mine.Where(m => m.Source == "followup" && (l.LastInboundAt == null || m.CreatedAt > l.LastInboundAt)).ToList();
                    var lastOut = mine.Count > 0 ? mine.Max(m => m.CreatedAt) : (DateTime?)null;
                    var touch = new[] { l.LastActivityAt, l.LastInboundAt ?? DateTime.MinValue, lastOut ?? DateTime.MinValue }.Max();
                    return new
                    {
                        id = l.Id, status = l.Status, source = l.Source, hasOwner = l.OwnerId != null, optOut = false,
                        // Anything already sent to them counts (also the automatic thank-you a form lead gets), so nobody gets two templates in an hour.
                        contacted = l.FirstResponseAt != null || called.Contains(l.Id) || mine.Count > 0,
                        followUps = follow.Count,
                        lastFollowUpAt = follow.Count > 0 ? follow.Max(m => m.CreatedAt) : (DateTime?)null,
                        lastTouchAt = touch, createdAt = l.CreatedAt, lastInboundAt = l.LastInboundAt,
                    };
                }),
            });
        }

        /// <summary>
        /// Sends the approved follow-up template for the Lead Follow-up agent. Refused after an opt-out, for a lead that is no
        /// longer open, after the third follow-up since they last wrote, within 20 hours of the last one, or when they have
        /// just written (then a person or the Lead Responder answers instead).
        /// </summary>
        [HttpPost("leads/{id:guid}/follow-up")]
        public async Task<IActionResult> LeadFollowUp(Guid id, [FromBody] AgentIdDto d, CancellationToken ct)
        {
            if (!Allowed()) return Unauthorized();
            var l = await _db.Leads.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (l == null) return NotFound();
            var now = DateTime.UtcNow;
            if (l.OptOut || await _db.WaConversations.AsNoTracking().AnyAsync(c => c.Phone == l.Phone && c.OptOut, ct)) return Conflict(new { message = "opted_out" });
            if (l.Status != "new" && l.Status != "contacted") return Conflict(new { message = "not_open" });
            if (_outbox.Rules.Paused) return Conflict(new { message = "whatsapp_paused" });
            if (l.LastInboundAt != null && l.LastInboundAt > now.AddHours(-20)) return Conflict(new { message = "fresh_reply" });
            var cfg = _outbox.Config;
            if (cfg.Template("lead_followup") == null) return Conflict(new { message = "no_template" });
            var since = l.LastInboundAt ?? DateTime.MinValue;
            var sent = await _db.WaMessages.AsNoTracking().Where(m => m.Phone == l.Phone && m.Direction == "out" && m.Source == "followup" && m.CreatedAt > since && !NotSent.Contains(m.Status))
                .Select(m => m.CreatedAt).ToListAsync(ct);
            if (sent.Count >= MaxFollowUps) return Conflict(new { message = "max_follow_ups" });
            if (sent.Count > 0 && sent.Max() > now.AddHours(-20)) return Conflict(new { message = "too_soon" });

            var agent = "ai:" + (d.AgentId.Length > 40 ? d.AgentId[..40] : d.AgentId);
            var first = l.Name.StartsWith("+") ? "" : l.Name.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "";
            var n = sent.Count + 1;
            var msg = await _outbox.SendUseAsync(l.Phone, "lead_followup", "hi", new[] { first.Length > 0 ? first : "जी", cfg.HospitalName },
                $"Follow-up {n} of {MaxFollowUps} ({cfg.Template("lead_followup")}) sent by Vita", "followup", agent, l.Id, null, ct);
            if (msg.Status == "sent")
                _db.LeadActivities.Add(new LeadActivity { LeadId = l.Id, Kind = "note", By = agent, Text = $"Vita sent follow-up {n} of {MaxFollowUps} on WhatsApp (the approved template)." });
            await _db.SaveChangesAsync(ct);
            if (msg.Status != "sent") return Conflict(new { message = "not_sent", error = msg.Error });
            await _live.PublishAsync(new LiveEvent { Kind = "lead", Text = $"Vita followed up with {l.Name}", RefId = l.Id.ToString() });
            return Ok(new { status = msg.Status, messageId = msg.Id, followUp = n });
        }

        /// <summary>
        /// Closes a lead as lost for the Lead Follow-up agent, only when it is still open, has had all its follow-ups since
        /// the person last wrote, and the last one was at least three days ago. A person can reopen it from the lead.
        /// </summary>
        [HttpPost("leads/{id:guid}/close-quiet")]
        public async Task<IActionResult> LeadCloseQuiet(Guid id, [FromBody] AgentIdDto d, CancellationToken ct)
        {
            if (!Allowed()) return Unauthorized();
            var l = await _db.Leads.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (l == null) return NotFound();
            if (l.Status != "new" && l.Status != "contacted") return Conflict(new { message = "not_open" });
            var now = DateTime.UtcNow;
            var since = l.LastInboundAt ?? DateTime.MinValue;
            var sent = await _db.WaMessages.AsNoTracking().Where(m => m.Phone == l.Phone && m.Direction == "out" && m.Source == "followup" && m.CreatedAt > since && !NotSent.Contains(m.Status))
                .Select(m => m.CreatedAt).ToListAsync(ct);
            if (sent.Count < MaxFollowUps) return Conflict(new { message = "follow_ups_not_done" });
            if (sent.Max() > now.AddDays(-3)) return Conflict(new { message = "too_soon" });
            var agent = "ai:" + (d.AgentId.Length > 40 ? d.AgentId[..40] : d.AgentId);
            var from = l.Status;
            l.Status = "lost";
            l.LostReason = $"No response after {MaxFollowUps} follow-ups";
            l.ClosedAt = now;
            l.LastActivityAt = now;
            _db.LeadActivities.Add(new LeadActivity { LeadId = l.Id, Kind = "status", By = agent, CreatedAt = now, Text = $"{LeadInbox.StatusLabel(from)} → {LeadInbox.StatusLabel("lost")} ({l.LostReason}). Closed by Vita; reopen it if they get in touch." });
            await _db.SaveChangesAsync(ct);
            await _live.PublishAsync(new LiveEvent { Kind = "lead", Text = $"Vita closed a lead that didn't answer: {l.Name}", RefId = l.Id.ToString() });
            return Ok(new { status = l.Status });
        }

        /// <summary>Sets the lead's department, adds a note, and when asked tells its owner (or the desk) straight away.</summary>
        [HttpPost("leads/{id:guid}/update")]
        public async Task<IActionResult> LeadUpdate(Guid id, [FromBody] AgentLeadUpdateDto d, CancellationToken ct)
        {
            if (!Allowed()) return Unauthorized();
            var l = await _db.Leads.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (l == null) return NotFound();
            var agent = "ai:" + (d.AgentId.Length > 40 ? d.AgentId[..40] : d.AgentId);
            if (!string.IsNullOrWhiteSpace(d.Department))
            {
                var dep = await _db.Departments.AsNoTracking().Where(x => x.IsActive && x.Name == d.Department).Select(x => x.Name).FirstOrDefaultAsync(ct);
                if (dep != null && l.Department != dep)
                {
                    _db.LeadActivities.Add(new LeadActivity { LeadId = l.Id, Kind = "note", By = agent, Text = l.Department == null ? $"Vita set the department: {dep}" : $"Vita thinks the department is {dep} (was {l.Department})" });
                    if (l.Department == null) l.Department = dep;
                }
            }
            if (!string.IsNullOrWhiteSpace(d.Note))
                _db.LeadActivities.Add(new LeadActivity { LeadId = l.Id, Kind = "note", By = agent, Text = d.Note.Length > 1000 ? d.Note[..1000] : d.Note });
            await _db.SaveChangesAsync(ct);
            if (!string.IsNullOrWhiteSpace(d.Alert))
            {
                var to = l.OwnerId != null ? new List<string> { l.OwnerId } : await LeadInbox.DeskPeopleAsync(_db, _perms, ct);
                _notifier.Notify(new NotifyJob
                {
                    To = to, Kind = "lead", Link = $"lead:{l.Id}", RefId = l.Id.ToString(),
                    Title = (d.Urgent ? "URGENT · " : "Vita · ") + l.Name,
                    Body = d.Alert.Length > 300 ? d.Alert[..300] : d.Alert,
                });
            }
            return Ok(new { department = l.Department });
        }
    }
}
