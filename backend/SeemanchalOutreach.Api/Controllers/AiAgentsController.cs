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
using Microsoft.Extensions.Options;
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

    public class AiReasonDto { public string? Reason { get; set; } }
    public class AiModeDto { public string Mode { get; set; } = "off"; }
    public class AiSettingDto { public JsonElement Value { get; set; } }

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
                    try { message = JsonDocument.Parse(text).RootElement.GetProperty("detail").ToString(); } catch { /* not JSON */ }
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
                Action = action, Entity = "AI agents", EntityId = entityId, Summary = summary,
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
            return Change(HttpMethod.Post, "v1/stop-all", new { by = By, reason = d?.Reason }, "Stop", "all", "Stopped all AI agents", ct);
        }

        [HttpPost("resume-all")]
        public Task<IActionResult> ResumeAll(CancellationToken ct)
        {
            if (!CanView) return Task.FromResult<IActionResult>(Forbid());
            return Change(HttpMethod.Post, "v1/resume-all", new { by = By }, "Resume", "all", "Resumed all AI agents", ct);
        }

        [HttpPost("agents/{id}/pause")]
        public Task<IActionResult> Pause(string id, [FromBody] AiReasonDto? d, CancellationToken ct)
        {
            if (!CanView) return Task.FromResult<IActionResult>(Forbid());
            return Change(HttpMethod.Post, $"v1/agents/{Uri.EscapeDataString(id)}/pause", new { by = By, reason = d?.Reason }, "Pause", id, $"Paused AI agent {id}", ct);
        }

        [HttpPost("agents/{id}/resume")]
        public Task<IActionResult> Resume(string id, CancellationToken ct)
        {
            if (!CanView) return Task.FromResult<IActionResult>(Forbid());
            return Change(HttpMethod.Post, $"v1/agents/{Uri.EscapeDataString(id)}/resume", new { by = By }, "Resume", id, $"Resumed AI agent {id}", ct);
        }

        [HttpPut("agents/{id}/mode")]
        public Task<IActionResult> Mode(string id, [FromBody] AiModeDto d, CancellationToken ct)
        {
            if (!IsAdmin) return Task.FromResult<IActionResult>(StatusCode(403, new { message = "Only an admin can switch an agent on or off." }));
            return Change(HttpMethod.Put, $"v1/agents/{Uri.EscapeDataString(id)}/mode", new { by = By, mode = d.Mode }, "Update", id, $"Set AI agent {id} to {d.Mode}", ct);
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
            return Change(HttpMethod.Put, $"v1/settings/{key}", new { by = By, value = d.Value }, "Update", key, $"Changed AI agents {key}", ct);
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

        public AgentToolsController(IOptions<AgentsSettings> cfg, IMarketingDbContext db, INotifier notifier, ILiveEvents live)
        {
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
            _notifier.Notify(new NotifyJob { Kind = "note", Title = $"AI · {title}", Body = body, Link = d.Link ?? "ai-agents", To = people });
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
    }
}
