using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class BroadcastRequestDto
    {
        public string Kind { get; set; } = "general_update";
        public string Language { get; set; } = "hi";
        public Dictionary<string, string> Params { get; set; } = new();
        public BroadcastAudience Audience { get; set; } = new();
        /// <summary>Null = send now.</summary>
        public DateTime? ScheduledAt { get; set; }
    }

    public class TestBroadcastDto
    {
        public string Kind { get; set; } = "general_update";
        public string Language { get; set; } = "hi";
        public Dictionary<string, string> Params { get; set; } = new();
        public string Phone { get; set; } = string.Empty;
    }

    [ApiController]
    [Authorize]
    [PageAccess(Pages.WhatsApp)]
    [Route("api/v1/broadcasts")]
    public class BroadcastsController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly IWhatsAppSender _sender;

        public BroadcastsController(IMarketingDbContext db, IWhatsAppSender sender)
        {
            _db = db;
            _sender = sender;
        }

        [HttpGet("status")]
        public IActionResult Status() => Ok(new { connected = _sender.IsConfigured });

        /// <summary>How many people match each contact type for the current block/importance filter, and the total.</summary>
        [HttpPost("audience")]
        public async Task<IActionResult> Audience([FromBody] BroadcastAudience audience, CancellationToken ct)
        {
            var baseAudience = new BroadcastAudience { Blocks = audience.Blocks, ImportantOnly = audience.ImportantOnly };
            var byType = await BroadcastComposer.Audience(_db, baseAudience)
                .GroupBy(c => c.Role)
                .Select(g => new { type = g.Key, count = g.Count() })
                .ToListAsync(ct);
            int total = await BroadcastComposer.Audience(_db, audience).CountAsync(ct);

            // People left out of the chosen types because of a missing/wrong number or STOP.
            var excludedQ = _db.Contacts.Where(c => !c.IsMerged && (c.PhoneInvalid || c.WhatsappOptOut || c.Phone == null || c.Phone == ""));
            if (audience.ContactTypes.Count > 0) excludedQ = excludedQ.Where(c => audience.ContactTypes.Contains(c.Role));
            if (audience.ImportantOnly) excludedQ = excludedQ.Where(c => c.IsImportant);
            int excluded = await excludedQ.CountAsync(ct);

            var blocks = await _db.Panchayats.AsNoTracking().Where(p => p.IsActiveForMarketing).Select(p => p.Block).Distinct().OrderBy(b => b).ToListAsync(ct);
            return Ok(new { total, excluded, byType, blocks });
        }

        [HttpPost("preview")]
        public IActionResult Preview([FromBody] BroadcastRequestDto dto)
        {
            return Ok(new { text = BroadcastComposer.Preview(dto.Kind, dto.Language, dto.Params, "") });
        }

        [HttpPost("test")]
        public async Task<IActionResult> Test([FromBody] TestBroadcastDto dto, CancellationToken ct)
        {
            if (!BroadcastComposer.Kinds.Contains(dto.Kind)) return BadRequest("Unknown message type.");
            var res = await _sender.SendTemplateAsync(dto.Phone, dto.Kind, dto.Language, BroadcastComposer.BodyParams(dto.Kind, dto.Params, "Test"), ct);
            return res.Ok ? Ok(new { sent = true }) : BadRequest(res.Error);
        }

        [HttpPost]
        public async Task<IActionResult> Create([FromBody] BroadcastRequestDto dto, CancellationToken ct)
        {
            if (!BroadcastComposer.Kinds.Contains(dto.Kind)) return BadRequest("Unknown message type.");
            var lang = dto.Language == "en" ? "en" : "hi";
            int count = await BroadcastComposer.Audience(_db, dto.Audience).CountAsync(ct);
            if (count == 0) return BadRequest("Nobody matches this audience.");

            var b = new Broadcast
            {
                Kind = dto.Kind,
                Language = lang,
                Title = BroadcastComposer.TitleFor(dto.Kind, dto.Params),
                ParamsJson = JsonSerializer.Serialize(dto.Params),
                AudienceJson = JsonSerializer.Serialize(dto.Audience),
                PreviewText = BroadcastComposer.Preview(dto.Kind, lang, dto.Params, ""),
                RecipientCount = count,
                ScheduledAt = dto.ScheduledAt.HasValue ? DateTime.SpecifyKind(dto.ScheduledAt.Value.ToUniversalTime(), DateTimeKind.Utc) : DateTime.UtcNow,
                Status = "scheduled",
                CreatedBy = User.AgentIdOf(),
                CreatedAt = DateTime.UtcNow,
            };
            if (string.IsNullOrWhiteSpace(b.Title)) b.Title = dto.Kind.Replace('_', ' ');
            _db.Broadcasts.Add(b);
            await _db.SaveChangesAsync(ct);
            return Ok(new { b.Id, b.Status, b.ScheduledAt, b.RecipientCount });
        }

        [HttpGet]
        public async Task<IActionResult> List(CancellationToken ct)
        {
            var list = await _db.Broadcasts.AsNoTracking().OrderByDescending(b => b.CreatedAt).Take(50).ToListAsync(ct);
            return Ok(list.Select(b => new
            {
                b.Id, b.Kind, b.Title, b.Language, b.PreviewText, b.RecipientCount, b.ScheduledAt, b.Status, b.Error,
                b.SentAt, b.SentCount, b.DeliveredCount, b.ReadCount, b.ReplyCount, b.FailedCount, b.CreatedAt,
            }));
        }

        [HttpPost("{id:guid}/cancel")]
        public async Task<IActionResult> Cancel(Guid id, CancellationToken ct)
        {
            var b = await _db.Broadcasts.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (b == null) return NotFound();
            if (b.Status != "scheduled") return BadRequest("Only scheduled broadcasts can be cancelled.");
            b.Status = "cancelled";
            await _db.SaveChangesAsync(ct);
            return Ok(new { b.Id, b.Status });
        }
    }

    /// <summary>
    /// WhatsApp Cloud API webhook: delivery/read receipts and replies.
    /// Configure WhatsApp__VerifyToken (any secret string, also entered in Meta's app settings)
    /// and WhatsApp__AppSecret (to check Meta's signature on every POST).
    /// </summary>
    [ApiController]
    [AllowAnonymous]
    [Route("api/v1/whatsapp/webhook")]
    public class WhatsAppWebhookController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly IConfiguration _config;
        private readonly ILiveEvents _live;

        public WhatsAppWebhookController(IMarketingDbContext db, IConfiguration config, ILiveEvents live)
        {
            _db = db;
            _config = config;
            _live = live;
        }

        [HttpGet]
        public IActionResult Verify([FromQuery(Name = "hub.mode")] string? mode, [FromQuery(Name = "hub.verify_token")] string? token, [FromQuery(Name = "hub.challenge")] string? challenge)
        {
            var expected = _config["WhatsApp:VerifyToken"];
            if (mode == "subscribe" && !string.IsNullOrEmpty(expected) && token == expected) return Content(challenge ?? "", "text/plain");
            return Forbid();
        }

        [HttpPost]
        public async Task<IActionResult> Receive(CancellationToken ct)
        {
            using var reader = new StreamReader(Request.Body, Encoding.UTF8);
            var body = await reader.ReadToEndAsync(ct);

            var secret = _config["WhatsApp:AppSecret"];
            if (string.IsNullOrEmpty(secret)) return Unauthorized();
            var signature = Request.Headers["X-Hub-Signature-256"].ToString();
            using (var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret)))
            {
                var expected = "sha256=" + Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(body))).ToLowerInvariant();
                if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(signature)))
                    return Unauthorized();
            }

            JsonDocument doc;
            try { doc = JsonDocument.Parse(body); } catch (JsonException) { return BadRequest(); }

            using (doc)
            {
                if (!doc.RootElement.TryGetProperty("entry", out var entries) || entries.ValueKind != JsonValueKind.Array) return Ok();
                foreach (var entry in entries.EnumerateArray())
                {
                    if (!entry.TryGetProperty("changes", out var changes) || changes.ValueKind != JsonValueKind.Array) continue;
                    foreach (var change in changes.EnumerateArray())
                    {
                        if (!change.TryGetProperty("value", out var value)) continue;
                        if (value.TryGetProperty("statuses", out var statuses) && statuses.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var s in statuses.EnumerateArray()) await ApplyStatusAsync(s, ct);
                        }
                        if (value.TryGetProperty("messages", out var messages) && messages.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var m in messages.EnumerateArray()) await ApplyReplyAsync(m, ct);
                        }
                    }
                }
            }
            await _db.SaveChangesAsync(ct);
            return Ok();
        }

        private async Task ApplyStatusAsync(JsonElement s, CancellationToken ct)
        {
            var id = s.TryGetProperty("id", out var idp) ? idp.GetString() : null;
            var status = s.TryGetProperty("status", out var stp) ? stp.GetString() : null;
            if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(status)) return;

            var r = await _db.BroadcastRecipients.FirstOrDefaultAsync(x => x.ProviderMessageId == id, ct);
            if (r == null) return;
            var b = await _db.Broadcasts.FirstOrDefaultAsync(x => x.Id == r.BroadcastId, ct);
            var now = DateTime.UtcNow;

            if (status == "delivered" && r.DeliveredAt == null)
            {
                r.DeliveredAt = now;
                if (r.Status == "sent") r.Status = "delivered";
                if (b != null) b.DeliveredCount++;
            }
            else if (status == "read" && r.ReadAt == null)
            {
                if (r.DeliveredAt == null) { r.DeliveredAt = now; if (b != null) b.DeliveredCount++; }
                r.ReadAt = now;
                r.Status = "read";
                if (b != null) b.ReadCount++;
            }
            else if (status == "failed" && r.Status != "failed")
            {
                r.Status = "failed";
                if (b != null) { b.FailedCount++; if (b.SentCount > 0) b.SentCount--; }
            }
        }

        private async Task ApplyReplyAsync(JsonElement m, CancellationToken ct)
        {
            var from = m.TryGetProperty("from", out var fp) ? fp.GetString() : null;
            if (string.IsNullOrEmpty(from)) return;
            string? text = null;
            if (m.TryGetProperty("text", out var t) && t.TryGetProperty("body", out var tb)) text = tb.GetString();
            if (m.TryGetProperty("button", out var btn) && btn.TryGetProperty("text", out var bt)) text ??= bt.GetString();

            var since = DateTime.UtcNow.AddDays(-14);
            var r = await _db.BroadcastRecipients
                .Where(x => x.Phone == from && x.SentAt >= since)
                .OrderByDescending(x => x.SentAt)
                .FirstOrDefaultAsync(ct);
            if (r != null && r.RepliedAt == null)
            {
                r.RepliedAt = DateTime.UtcNow;
                var b = await _db.Broadcasts.FirstOrDefaultAsync(x => x.Id == r.BroadcastId, ct);
                if (b != null) b.ReplyCount++;
            }

            var isStop = text != null && new[] { "stop", "unsubscribe", "बंद" }.Contains(text.Trim().ToLowerInvariant());
            var last10 = from.Length >= 10 ? from.Substring(from.Length - 10) : from;
            var contacts = await _db.Contacts.Where(c => c.Phone != null && c.Phone.EndsWith(last10)).ToListAsync(ct);
            if (isStop)
            {
                foreach (var c in contacts) c.WhatsappOptOut = true;
            }
            var who = contacts.FirstOrDefault()?.Name ?? from;
            await _live.PublishAsync(new LiveEvent
            {
                Kind = "broadcast",
                Text = isStop ? $"{who} unsubscribed from WhatsApp updates" : $"WhatsApp reply from {who}: {Shorten(text)}",
                RefId = contacts.FirstOrDefault()?.ClientId,
            });
        }

        private static string Shorten(string? s) => string.IsNullOrEmpty(s) ? "(media)" : s.Length > 80 ? s.Substring(0, 80) + "…" : s;
    }
}
