using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Controllers
{
    /// <summary>Analytics: the business view and the AI analyst (briefings, tracked items, questions).</summary>
    [ApiController]
    [Authorize]
    [PageAccess(Pages.Analytics)]
    [Route("api/v1/analytics")]
    public class AnalyticsController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly BusinessData _data;
        private readonly AnalystAgent _agent;
        private readonly IServiceScopeFactory _scopes;
        private readonly IHostApplicationLifetime _life;
        private readonly ILogger<AnalyticsController> _logger;

        public AnalyticsController(IMarketingDbContext db, BusinessData data, AnalystAgent agent, IServiceScopeFactory scopes, IHostApplicationLifetime life, ILogger<AnalyticsController> logger)
        {
            _db = db;
            _data = data;
            _agent = agent;
            _scopes = scopes;
            _life = life;
            _logger = logger;
        }

        [HttpGet("overview")]
        public async Task<IActionResult> Overview([FromQuery] int days = 30, [FromQuery] string? group = "block", CancellationToken ct = default)
        {
            var (from, to) = BusinessData.Days(days);
            var s = await _data.LoadAsync(from, to, ct);
            var by = group is "type" or "agent" or "department" ? group : "block";
            return Ok(new
            {
                overview = _data.Overview(s),
                group = by,
                breakdown = _data.Breakdown(s, by, 60),
                departments = _data.Breakdown(s, "department", 12),
                topPartners = _data.TopPartners(s, 8),
                goneQuiet = _data.GoneQuiet(s, 8),
            });
        }

        // ─── AI analyst ────────────────────────────────────────────────────────

        private static object BriefingDto(Domain.Entities.AiBriefing b) => new
        {
            id = b.Id,
            createdAt = b.CreatedAt,
            createdBy = b.CreatedBy,
            scope = b.Scope,
            periodFrom = b.PeriodFrom,
            periodTo = b.PeriodTo,
            model = b.Model,
            status = b.Status,
            error = b.Error,
            health = b.Health,
            summary = b.Summary,
            result = b.ResultJson == null ? (JsonElement?)null : JsonSerializer.Deserialize<JsonElement>(b.ResultJson),
            toolCalls = b.ToolCalls,
            finishedAt = b.FinishedAt,
        };

        [HttpGet("analyst")]
        public async Task<IActionResult> Analyst([FromQuery] string? scope, CancellationToken ct)
        {
            var sc = AnalystAreas.Normalize(scope);
            var latest = await _db.AiBriefings.AsNoTracking().Where(b => b.Scope == sc && b.Status == "ok").OrderByDescending(b => b.CreatedAt).FirstOrDefaultAsync(ct);
            var running = await _db.AiBriefings.AsNoTracking()
                .Where(b => b.Scope == sc && b.Status == "running" && b.CreatedAt > DateTime.UtcNow.AddMinutes(-10)).OrderByDescending(b => b.CreatedAt).FirstOrDefaultAsync(ct);
            var lastFailed = await _db.AiBriefings.AsNoTracking().Where(b => b.Scope == sc && b.Status == "failed").OrderByDescending(b => b.CreatedAt).FirstOrDefaultAsync(ct);
            var history = await _db.AiBriefings.AsNoTracking().Where(b => b.Scope == sc && b.Status == "ok").OrderByDescending(b => b.CreatedAt).Take(20)
                .Select(b => new { b.Id, b.CreatedAt, b.CreatedBy, b.Health, b.Summary }).ToListAsync(ct);
            var names = await NamesAsync(history.Select(h => h.CreatedBy), ct);
            return Ok(new
            {
                configured = _agent.Configured,
                model = _agent.Model,
                latest = latest == null ? null : BriefingDto(latest),
                running = running != null,
                lastError = lastFailed != null && (latest == null || lastFailed.CreatedAt > latest.CreatedAt) ? lastFailed.Error : null,
                history = history.Select(h => new { h.Id, h.CreatedAt, by = h.CreatedBy == "auto" ? "Daily run" : names.GetValueOrDefault(h.CreatedBy) ?? h.CreatedBy, h.Health, h.Summary }),
            });
        }

        /// <summary>Each analyst area with its latest briefing's health, whether one is being written, and open items, for the area tabs.</summary>
        [HttpGet("analyst/areas")]
        public async Task<IActionResult> Areas(CancellationToken ct)
        {
            var today = AttendanceService.TodayIst;
            var latest = (await _db.AiBriefings.AsNoTracking().Where(b => b.Status == "ok")
                    .GroupBy(b => b.Scope).Select(g => g.OrderByDescending(b => b.CreatedAt).Select(b => new { b.Scope, b.CreatedAt, b.Health, b.Summary }).First())
                    .ToListAsync(ct)).ToDictionary(x => x.Scope);
            var running = await _db.AiBriefings.AsNoTracking().Where(b => b.Status == "running" && b.CreatedAt > DateTime.UtcNow.AddMinutes(-10))
                .Select(b => b.Scope).Distinct().ToListAsync(ct);
            var items = await _db.AiItems.AsNoTracking().Where(i => i.Status == "open" || i.Status == "in_progress")
                .GroupBy(i => i.Scope).Select(g => new { Scope = g.Key, open = g.Count(), overdue = g.Count(i => i.DueDate != null && i.DueDate < today), high = g.Count(i => i.Severity == "high") })
                .ToDictionaryAsync(x => x.Scope, ct);
            return Ok(new
            {
                configured = _agent.Configured,
                areas = AnalystAreas.All.Select(a => new
                {
                    key = a.Key,
                    label = a.Label,
                    autoEveryDays = a.AutoEveryDays,
                    latestAt = latest.TryGetValue(a.Key, out var l) ? l.CreatedAt : (DateTime?)null,
                    health = l?.Health,
                    summary = l?.Summary,
                    running = running.Contains(a.Key),
                    open = items.TryGetValue(a.Key, out var it) ? it.open : 0,
                    overdue = it?.overdue ?? 0,
                    high = it?.high ?? 0,
                }),
            });
        }

        [HttpGet("analyst/briefings/{id:guid}")]
        public async Task<IActionResult> Briefing(Guid id, CancellationToken ct)
        {
            var b = await _db.AiBriefings.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            return b == null ? NotFound(new { message = "Briefing not found." }) : Ok(BriefingDto(b));
        }

        /// <summary>
        /// Start a briefing now. It runs in the background (it can take a few minutes on Groq's free plan,
        /// which allows few tokens a minute); the page checks back until it is finished.
        /// </summary>
        [HttpPost("analyst/run")]
        public async Task<IActionResult> Run([FromQuery] string? scope, CancellationToken ct)
        {
            if (!_agent.Configured) return StatusCode(503, new { message = "The AI analyst isn't switched on yet. Add the Groq API key on the server (Groq__ApiKey)." });
            var sc = AnalystAreas.Normalize(scope);
            var busy = await _db.AiBriefings.AnyAsync(b => b.Scope == sc && b.Status == "running" && b.CreatedAt > DateTime.UtcNow.AddMinutes(-10), ct);
            if (busy) return Conflict(new { message = "A briefing is already being written. It will show here when it's ready." });
            var by = User.AgentIdOf() ?? "";
            var stopping = _life.ApplicationStopping;
            _ = Task.Run(async () =>
            {
                try
                {
                    using var scopeSvc = _scopes.CreateScope();
                    var agent = scopeSvc.ServiceProvider.GetRequiredService<AnalystAgent>();
                    await agent.RunBriefingAsync(by, stopping, sc);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    _logger.LogError(ex, "Background AI briefing failed");
                }
            });
            return Accepted(new { running = true });
        }

        [HttpGet("analyst/items")]
        public async Task<IActionResult> Items([FromQuery] string? status, [FromQuery] string? scope, CancellationToken ct)
        {
            var sc = AnalystAreas.Normalize(scope);
            var q = _db.AiItems.AsNoTracking().Where(i => i.Scope == sc);
            if (status == "active" || string.IsNullOrWhiteSpace(status)) q = q.Where(i => i.Status == "open" || i.Status == "in_progress");
            else if (status != "all") q = q.Where(i => i.Status == status);
            var rows = await q.OrderBy(i => i.Status == "in_progress" ? 0 : i.Status == "open" ? 1 : 2)
                .ThenBy(i => i.Severity == "high" ? 0 : i.Severity == "medium" ? 1 : 2)
                .ThenByDescending(i => i.UpdatedAt).Take(200).ToListAsync(ct);
            var counts = await _db.AiItems.AsNoTracking().Where(i => i.Scope == sc).GroupBy(i => i.Status).Select(g => new { g.Key, n = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.n, ct);
            var today = AttendanceService.TodayIst;
            return Ok(new
            {
                counts = new
                {
                    open = counts.GetValueOrDefault("open"),
                    inProgress = counts.GetValueOrDefault("in_progress"),
                    done = counts.GetValueOrDefault("done"),
                    dismissed = counts.GetValueOrDefault("dismissed"),
                },
                items = rows.Select(i => new
                {
                    id = i.Id, kind = i.Kind, title = i.Title, detail = i.Detail, area = i.Area, metric = i.Metric, severity = i.Severity,
                    status = i.Status, owner = i.Owner, dueDate = i.DueDate?.ToString("yyyy-MM-dd"),
                    overdue = i.DueDate != null && i.DueDate < today && i.Status is "open" or "in_progress",
                    trend = i.Trend, trendNote = i.TrendNote, note = i.Note, timesRaised = i.TimesRaised,
                    createdAt = i.CreatedAt, updatedAt = i.UpdatedAt, closedAt = i.ClosedAt,
                }),
            });
        }

        public class ItemUpdateDto
        {
            public string? Status { get; set; }
            public string? Owner { get; set; }
            /// <summary>yyyy-MM-dd, or "" to clear.</summary>
            public string? DueDate { get; set; }
            public string? Note { get; set; }
        }

        [HttpPut("analyst/items/{id:guid}")]
        public async Task<IActionResult> UpdateItem(Guid id, [FromBody] ItemUpdateDto dto, CancellationToken ct)
        {
            var i = await _db.AiItems.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (i == null) return NotFound(new { message = "Item not found." });
            if (dto.Status != null)
            {
                if (dto.Status is not ("open" or "in_progress" or "done" or "dismissed")) return BadRequest(new { message = "Unknown status." });
                i.Status = dto.Status;
                i.ClosedAt = dto.Status is "done" or "dismissed" ? DateTime.UtcNow : null;
            }
            if (dto.Owner != null) i.Owner = string.IsNullOrWhiteSpace(dto.Owner) ? null : dto.Owner.Trim();
            if (dto.DueDate != null)
            {
                if (dto.DueDate == "") i.DueDate = null;
                else if (DateOnly.TryParseExact(dto.DueDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) i.DueDate = d;
                else return BadRequest(new { message = "Pick a valid date." });
            }
            if (dto.Note != null) i.Note = string.IsNullOrWhiteSpace(dto.Note) ? null : dto.Note.Trim();
            i.UpdatedAt = DateTime.UtcNow;
            i.UpdatedBy = User.AgentIdOf();
            await _db.SaveChangesAsync(ct);
            return Ok(new { id = i.Id, status = i.Status });
        }

        public class AskDto
        {
            public string Question { get; set; } = string.Empty;
            public List<AnalystAgent.ChatTurn> History { get; set; } = new();
            public string? Scope { get; set; }
        }

        /// <summary>Ask the analyst a question; it looks up the numbers before answering. (POST but read-only.)</summary>
        [HttpPost("analyst/ask")]
        [PageAccess(Pages.Analytics, Level = Pages.View)]
        public async Task<IActionResult> Ask([FromBody] AskDto dto, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(dto.Question)) return BadRequest(new { message = "Type a question first." });
            if (!_agent.Configured) return StatusCode(503, new { message = "The AI analyst isn't switched on yet. Add the Groq API key on the server (Groq__ApiKey)." });
            try
            {
                var (answer, tools) = await _agent.AskAsync(dto.Question.Trim(), dto.History ?? new(), ct, dto.Scope ?? "business");
                return Ok(new { answer, lookedUp = tools });
            }
            catch (AnalystUnavailableException ex)
            {
                return StatusCode(502, new { message = ex.Message });
            }
        }

        private async Task<Dictionary<string, string>> NamesAsync(IEnumerable<string> ids, CancellationToken ct)
        {
            var list = ids.Where(i => !string.IsNullOrEmpty(i) && i != "auto").Distinct().ToList();
            if (list.Count == 0) return new();
            return (await _db.Agents.AsNoTracking().Where(a => list.Contains(a.AgentId)).Select(a => new { a.AgentId, a.Name }).ToListAsync(ct))
                .GroupBy(a => a.AgentId).ToDictionary(g => g.Key, g => g.First().Name);
        }
    }
}
