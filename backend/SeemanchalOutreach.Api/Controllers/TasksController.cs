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
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    /// <summary>Shared shaping of agent tasks for the CRM and the app.</summary>
    public static class TaskViews
    {
        public static List<string> Pids(string? json)
        {
            if (string.IsNullOrWhiteSpace(json)) return new();
            try { return JsonSerializer.Deserialize<List<string>>(json) ?? new(); } catch (JsonException) { return new(); }
        }

        public static bool Overdue(AgentTask t) => t.Status == "open" && t.DueDate != null && t.DueDate < AttendanceService.TodayIst;

        public static async Task<List<object>> ShapeAsync(IMarketingDbContext db, List<AgentTask> rows, CancellationToken ct)
        {
            var pids = rows.SelectMany(r => Pids(r.PanchayatIdsJson)).Distinct().ToList();
            var pnames = pids.Count == 0 ? new() : await db.Panchayats.AsNoTracking().Where(p => pids.Contains(p.PanchayatId))
                .ToDictionaryAsync(p => p.PanchayatId, p => new { p.Name, Latitude = p.ManualLat ?? p.CentroidLat, Longitude = p.ManualLng ?? p.CentroidLng }, ct);
            var cids = rows.Where(r => r.ContactClientId != null).Select(r => r.ContactClientId!).Distinct().ToList();
            var partners = cids.Count == 0 ? new() : await db.Contacts.AsNoTracking().Where(c => cids.Contains(c.ClientId))
                .ToDictionaryAsync(c => c.ClientId, c => new { c.Name, c.Role }, ct);
            var people = rows.Select(r => r.AgentId).Concat(rows.Select(r => r.CreatedBy)).Distinct().ToList();
            var names = (await db.Agents.AsNoTracking().Where(a => people.Contains(a.AgentId)).Select(a => new { a.AgentId, a.Name }).ToListAsync(ct))
                .GroupBy(a => a.AgentId).ToDictionary(g => g.Key, g => g.First().Name);
            return rows.Select(t => (object)new
            {
                id = t.Id,
                groupId = t.GroupId,
                agentId = t.AgentId,
                agentName = names.GetValueOrDefault(t.AgentId) ?? t.AgentId,
                title = t.Title,
                detail = t.Detail,
                priority = t.Priority,
                dueDate = t.DueDate?.ToString("yyyy-MM-dd"),
                overdue = Overdue(t),
                district = t.District,
                block = t.Block,
                panchayats = Pids(t.PanchayatIdsJson).Where(pnames.ContainsKey)
                    .Select(id => new { id, name = pnames[id].Name, lat = pnames[id].Latitude, lng = pnames[id].Longitude }),
                partner = t.ContactClientId != null && partners.TryGetValue(t.ContactClientId, out var p)
                    ? new { clientId = t.ContactClientId, name = p.Name, type = p.Role } : null,
                aiItemId = t.AiItemId,
                status = t.Status,
                createdBy = names.GetValueOrDefault(t.CreatedBy) ?? t.CreatedBy,
                createdAt = t.CreatedAt,
                seenAt = t.SeenAt,
                doneAt = t.DoneAt,
                doneNote = t.DoneNote,
            }).ToList();
        }
    }

    /// <summary>Tasks for field agents, given from Block assignments. Viewing needs the Field page; changes need Edit.</summary>
    [ApiController]
    [Authorize]
    [PageAccess(Pages.Field, AlsoRoles = RoleChecks.MarketingManager)]
    [Route("api/v1/tasks")]
    public class TasksController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly ILiveEvents _live;

        public TasksController(IMarketingDbContext db, ILiveEvents live)
        {
            _db = db;
            _live = live;
        }

        [HttpGet]
        public async Task<IActionResult> List([FromQuery] string? status, [FromQuery] string? agentId, [FromQuery] string? district, [FromQuery] string? block, CancellationToken ct)
        {
            var today = AttendanceService.TodayIst;
            var baseQ = _db.AgentTasks.AsNoTracking().AsQueryable();
            if (!string.IsNullOrWhiteSpace(agentId)) baseQ = baseQ.Where(t => t.AgentId == agentId);
            if (!string.IsNullOrWhiteSpace(block)) baseQ = baseQ.Where(t => t.Block == block && (district == null || t.District == district));
            else if (!string.IsNullOrWhiteSpace(district)) baseQ = baseQ.Where(t => t.District == district);

            var weekAgo = DateTime.UtcNow.AddDays(-7);
            var counts = new
            {
                open = await baseQ.CountAsync(t => t.Status == "open", ct),
                overdue = await baseQ.CountAsync(t => t.Status == "open" && t.DueDate != null && t.DueDate < today, ct),
                doneWeek = await baseQ.CountAsync(t => t.Status == "done" && t.DoneAt >= weekAgo, ct),
                done = await baseQ.CountAsync(t => t.Status == "done", ct),
            };

            var q = status switch
            {
                "overdue" => baseQ.Where(t => t.Status == "open" && t.DueDate != null && t.DueDate < today),
                "done" => baseQ.Where(t => t.Status == "done"),
                "cancelled" => baseQ.Where(t => t.Status == "cancelled"),
                "all" => baseQ,
                _ => baseQ.Where(t => t.Status == "open"),
            };
            q = status is "done" or "cancelled"
                ? q.OrderByDescending(t => t.DoneAt ?? t.UpdatedAt)
                : q.OrderBy(t => t.DueDate == null).ThenBy(t => t.DueDate).ThenBy(t => t.Priority == "high" ? 0 : t.Priority == "normal" ? 1 : 2).ThenByDescending(t => t.CreatedAt);
            var rows = await q.Take(300).ToListAsync(ct);
            return Ok(new { counts, tasks = await TaskViews.ShapeAsync(_db, rows, ct) });
        }

        public class TaskDto
        {
            public List<string> AgentIds { get; set; } = new();
            public string Title { get; set; } = string.Empty;
            public string? Detail { get; set; }
            public string? Priority { get; set; }
            /// <summary>yyyy-MM-dd or empty.</summary>
            public string? DueDate { get; set; }
            public string? District { get; set; }
            public string? Block { get; set; }
            public List<string>? PanchayatIds { get; set; }
            public string? ContactClientId { get; set; }
            public Guid? AiItemId { get; set; }
        }

        private static string Prio(string? p) => p is "high" or "low" ? p : "normal";

        private static bool TryDate(string? s, out DateOnly? d)
        {
            d = null;
            if (string.IsNullOrWhiteSpace(s)) return true;
            if (!DateOnly.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var x)) return false;
            d = x;
            return true;
        }

        [HttpPost]
        public async Task<IActionResult> Create([FromBody] TaskDto dto, CancellationToken ct)
        {
            var title = (dto.Title ?? "").Trim();
            if (title.Length == 0) return BadRequest(new { message = "Write what the agent should do." });
            if (title.Length > 200) return BadRequest(new { message = "Keep the task title under 200 characters; put the rest in the details." });
            var ids = (dto.AgentIds ?? new()).Where(a => !string.IsNullOrWhiteSpace(a)).Distinct().ToList();
            if (ids.Count == 0) return BadRequest(new { message = "Choose at least one agent." });
            if (!TryDate(dto.DueDate, out var due)) return BadRequest(new { message = "Pick a valid due date." });
            if (due != null && due < AttendanceService.TodayIst) return BadRequest(new { message = "The due date is in the past." });

            var agents = await _db.Agents.AsNoTracking().Where(a => ids.Contains(a.AgentId) && a.IsActive).Select(a => new { a.AgentId, a.Name }).ToListAsync(ct);
            if (agents.Count != ids.Count) return BadRequest(new { message = "One of the agents wasn't found or is switched off." });

            List<string>? pids = null;
            if (dto.PanchayatIds is { Count: > 0 })
            {
                if (string.IsNullOrWhiteSpace(dto.Block)) return BadRequest(new { message = "Pick the block for these panchayats." });
                var want = dto.PanchayatIds.Distinct().ToList();
                var found = await _db.Panchayats.AsNoTracking()
                    .Where(p => want.Contains(p.PanchayatId) && p.Block == dto.Block && (dto.District == null || p.District == dto.District))
                    .Select(p => p.PanchayatId).ToListAsync(ct);
                if (found.Count != want.Count) return BadRequest(new { message = "Some panchayats aren't in this block." });
                pids = want;
            }
            if (!string.IsNullOrWhiteSpace(dto.ContactClientId) && !await _db.Contacts.AnyAsync(c => c.ClientId == dto.ContactClientId, ct))
                return BadRequest(new { message = "That partner wasn't found." });

            AiItem? item = null;
            if (dto.AiItemId != null)
            {
                item = await _db.AiItems.FirstOrDefaultAsync(i => i.Id == dto.AiItemId, ct);
                if (item == null) return BadRequest(new { message = "That analyst item wasn't found." });
            }

            var group = Guid.NewGuid();
            var me = User.AgentIdOf() ?? "";
            var now = DateTime.UtcNow;
            var made = ids.Select(a => new AgentTask
            {
                GroupId = group,
                AgentId = a,
                Title = title,
                Detail = string.IsNullOrWhiteSpace(dto.Detail) ? null : dto.Detail.Trim(),
                Priority = Prio(dto.Priority),
                DueDate = due,
                District = string.IsNullOrWhiteSpace(dto.District) ? null : dto.District,
                Block = string.IsNullOrWhiteSpace(dto.Block) ? null : dto.Block,
                PanchayatIdsJson = pids == null ? null : JsonSerializer.Serialize(pids),
                ContactClientId = string.IsNullOrWhiteSpace(dto.ContactClientId) ? null : dto.ContactClientId,
                AiItemId = dto.AiItemId,
                CreatedBy = me,
                CreatedAt = now,
                UpdatedAt = now,
            }).ToList();
            foreach (var t in made) _db.AgentTasks.Add(t);

            if (item != null)
            {
                if (item.Status == "open") item.Status = "in_progress";
                item.Owner = string.Join(", ", agents.Select(a => a.Name));
                if (due != null) item.DueDate = due;
                item.UpdatedAt = now;
                item.UpdatedBy = me;
            }
            await _db.SaveChangesAsync(ct);

            await _live.PublishAsync(new LiveEvent
            {
                Kind = "task",
                Text = $"Task for {string.Join(", ", agents.Select(a => a.Name))}: {title}",
                RefId = group.ToString(),
            });
            return Ok(new { groupId = group, created = made.Count });
        }

        public class EditDto
        {
            public string? Title { get; set; }
            public string? Detail { get; set; }
            public string? Priority { get; set; }
            public string? DueDate { get; set; }
        }

        [HttpPut("{id:guid}")]
        public async Task<IActionResult> Edit(Guid id, [FromBody] EditDto dto, CancellationToken ct)
        {
            var t = await _db.AgentTasks.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (t == null) return NotFound(new { message = "Task not found." });
            if (dto.Title != null)
            {
                var title = dto.Title.Trim();
                if (title.Length == 0 || title.Length > 200) return BadRequest(new { message = "Write a title under 200 characters." });
                t.Title = title;
            }
            if (dto.Detail != null) t.Detail = string.IsNullOrWhiteSpace(dto.Detail) ? null : dto.Detail.Trim();
            if (dto.Priority != null) t.Priority = Prio(dto.Priority);
            if (dto.DueDate != null)
            {
                if (!TryDate(dto.DueDate, out var due)) return BadRequest(new { message = "Pick a valid due date." });
                t.DueDate = due;
            }
            t.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { id = t.Id });
        }

        /// <summary>Cancel (the agent no longer needs to do it) or reopen. Nothing is deleted.</summary>
        [HttpPost("{id:guid}/status")]
        public async Task<IActionResult> SetStatus(Guid id, [FromQuery] string to, CancellationToken ct)
        {
            if (to is not ("open" or "cancelled")) return BadRequest(new { message = "Unknown status." });
            var t = await _db.AgentTasks.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (t == null) return NotFound(new { message = "Task not found." });
            t.Status = to;
            if (to == "open") { t.DoneAt = null; }
            t.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { id = t.Id, status = t.Status });
        }
    }

    /// <summary>The signed-in agent's own tasks, for the app.</summary>
    [ApiController]
    [Authorize]
    [Route("api/v1/me/tasks")]
    public class MyTasksController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly ILiveEvents _live;

        public MyTasksController(IMarketingDbContext db, ILiveEvents live)
        {
            _db = db;
            _live = live;
        }

        [HttpGet]
        public async Task<IActionResult> Mine(CancellationToken ct)
        {
            var me = User.AgentIdOf();
            if (string.IsNullOrEmpty(me)) return Unauthorized();
            var since = DateTime.UtcNow.AddDays(-14);
            var rows = await _db.AgentTasks.Where(t => t.AgentId == me && (t.Status == "open" || (t.Status == "done" && t.DoneAt >= since)))
                .OrderBy(t => t.DueDate == null).ThenBy(t => t.DueDate).ThenByDescending(t => t.CreatedAt).Take(100).ToListAsync(ct);
            var unseen = rows.Where(t => t.SeenAt == null).ToList();
            if (unseen.Count > 0)
            {
                foreach (var t in unseen) t.SeenAt = DateTime.UtcNow;
                await _db.SaveChangesAsync(ct);
            }
            return Ok(new { tasks = await TaskViews.ShapeAsync(_db, rows, ct) });
        }

        public class DoneDto
        {
            public string? Note { get; set; }
            /// <summary>When the agent tapped Done (the app may send it later from the outbox).</summary>
            public DateTime? DoneAt { get; set; }
            public bool Undo { get; set; }
        }

        [HttpPost("{id:guid}/done")]
        public async Task<IActionResult> Done(Guid id, [FromBody] DoneDto dto, CancellationToken ct)
        {
            var me = User.AgentIdOf();
            if (string.IsNullOrEmpty(me)) return Unauthorized();
            var t = await _db.AgentTasks.FirstOrDefaultAsync(x => x.Id == id && x.AgentId == me, ct);
            if (t == null) return NotFound(new { message = "Task not found." });
            if (t.Status == "cancelled") return Ok(new { id = t.Id, status = t.Status });
            if (dto.Undo)
            {
                t.Status = "open";
                t.DoneAt = null;
            }
            else
            {
                if (t.Status == "done") return Ok(new { id = t.Id, status = t.Status }); // sent twice from the outbox
                t.Status = "done";
                var at = dto.DoneAt?.ToUniversalTime() ?? DateTime.UtcNow;
                t.DoneAt = at > DateTime.UtcNow ? DateTime.UtcNow : at;
                t.DoneNote = string.IsNullOrWhiteSpace(dto.Note) ? null : dto.Note.Trim()[..Math.Min(dto.Note.Trim().Length, 1000)];
            }
            t.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            if (!dto.Undo)
            {
                var name = await _db.Agents.AsNoTracking().Where(a => a.AgentId == me).Select(a => a.Name).FirstOrDefaultAsync(ct) ?? me;
                await _live.PublishAsync(new LiveEvent { Kind = "task", Text = $"{name} finished a task: {t.Title}", RefId = t.Id.ToString() });
            }
            return Ok(new { id = t.Id, status = t.Status });
        }
    }
}
