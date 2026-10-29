using System;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Controllers
{
    /// <summary>The activity log: who added, changed or removed what, when, and from which device. Admin only.</summary>
    [ApiController]
    [Authorize(Roles = "Admin,admin")]
    [Route("api/v1/audit")]
    public class AuditController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        public AuditController(IMarketingDbContext db) => _db = db;

        private static object Shape(SeemanchalOutreach.Domain.Entities.AuditLog a) => new
        {
            a.Id, a.At, a.ActorId, a.ActorName, a.ActorRole, a.Source, a.DeviceType, a.DeviceId, a.Ip, a.Request,
            a.Action, a.Entity, a.EntityId, a.Summary,
            changes = a.ChangesJson == null ? (JsonElement?)null : JsonSerializer.Deserialize<JsonElement>(a.ChangesJson),
        };

        /// <summary>Newest first. Filters: person, kind of record, record id, action, source, device type, dates (IST yyyy-MM-dd) and free text.</summary>
        [HttpGet]
        public async Task<IActionResult> List(
            [FromQuery] string? actor, [FromQuery] string? entity, [FromQuery] string? entityId, [FromQuery] string? action,
            [FromQuery] string? source, [FromQuery] string? device, [FromQuery] string? from, [FromQuery] string? to,
            [FromQuery] string? q, [FromQuery] int page = 1, [FromQuery] int size = 50, CancellationToken ct = default)
        {
            size = Math.Clamp(size, 10, 200);
            page = Math.Max(1, page);
            var ist = TimeSpan.FromHours(5.5);
            var rows = _db.AuditLogs.AsNoTracking().AsQueryable();
            if (!string.IsNullOrWhiteSpace(actor)) rows = rows.Where(a => a.ActorId == actor);
            if (!string.IsNullOrWhiteSpace(entity)) rows = rows.Where(a => a.Entity == entity);
            if (!string.IsNullOrWhiteSpace(entityId)) rows = rows.Where(a => a.EntityId == entityId);
            if (!string.IsNullOrWhiteSpace(action)) rows = rows.Where(a => a.Action == action);
            if (!string.IsNullOrWhiteSpace(source)) rows = rows.Where(a => a.Source == source);
            if (!string.IsNullOrWhiteSpace(device)) rows = rows.Where(a => a.DeviceType == device);
            if (DateOnly.TryParse(from, out var f)) { var at = f.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc) - ist; rows = rows.Where(a => a.At >= at); }
            if (DateOnly.TryParse(to, out var t)) { var at = t.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc) - ist; rows = rows.Where(a => a.At < at); }
            if (!string.IsNullOrWhiteSpace(q))
            {
                var term = q.Trim().ToLower();
                rows = rows.Where(a => (a.Summary ?? "").ToLower().Contains(term) || (a.ActorName ?? "").ToLower().Contains(term)
                    || (a.EntityId ?? "").ToLower().Contains(term) || (a.ChangesJson ?? "").ToLower().Contains(term));
            }
            var total = await rows.CountAsync(ct);
            var items = await rows.OrderByDescending(a => a.At).Skip((page - 1) * size).Take(size).ToListAsync(ct);
            return Ok(new { total, page, size, items = items.Select(Shape) });
        }

        /// <summary>The full history of one record, oldest first.</summary>
        [HttpGet("record")]
        public async Task<IActionResult> Record([FromQuery] string entity, [FromQuery] string id, CancellationToken ct)
        {
            var items = await _db.AuditLogs.AsNoTracking().Where(a => a.Entity == entity && a.EntityId == id)
                .OrderBy(a => a.At).Take(500).ToListAsync(ct);
            return Ok(items.Select(Shape));
        }

        /// <summary>Values for the filter menus: who has done things, and which kinds of record appear.</summary>
        [HttpGet("filters")]
        public async Task<IActionResult> Filters(CancellationToken ct)
        {
            var since = DateTime.UtcNow.AddDays(-90);
            var recent = _db.AuditLogs.AsNoTracking().Where(a => a.At >= since);
            var actors = await recent.GroupBy(a => new { a.ActorId, a.ActorName })
                .Select(g => new { id = g.Key.ActorId, name = g.Key.ActorName, count = g.Count() }).ToListAsync(ct);
            var entities = await recent.GroupBy(a => a.Entity).Select(g => new { name = g.Key, count = g.Count() }).ToListAsync(ct);
            return Ok(new
            {
                actors = actors.GroupBy(a => a.id).Select(g => new { id = g.Key, name = g.Select(x => x.name).FirstOrDefault(n => n != null) ?? g.Key, count = g.Sum(x => x.count) })
                    .OrderByDescending(a => a.count),
                entities = entities.OrderByDescending(e => e.count),
            });
        }
    }
}
