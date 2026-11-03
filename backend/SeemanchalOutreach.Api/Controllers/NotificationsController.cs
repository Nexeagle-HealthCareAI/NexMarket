using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class RegisterDeviceDto { public string Token { get; set; } = ""; public string? Platform { get; set; } public string? DeviceId { get; set; } }
    public class NotificationSettingsDto { public List<string> Muted { get; set; } = new(); }

    public class PushTokenDto
    {
        public string Token { get; set; } = string.Empty;
        public DateTime ExpiresAt { get; set; }
    }

    /// <summary>
    /// Web-push subscriptions are stored by the Next.js app (src/app/api/notifications/
    /// subscribe), which runs on a different origin from this API and so never sees the
    /// httpOnly auth cookies. Instead of trusting a client-supplied agentId, the browser
    /// first asks this (authenticated) endpoint for a short-lived token signed with a
    /// secret shared only between the two servers (Push:TokenSecret here,
    /// PUSH_TOKEN_SECRET in the web app). The web app verifies the signature and takes
    /// the agentId from the token — so an agent can only register a subscription for
    /// themselves.
    /// </summary>
    [ApiController]
    [Authorize]
    [Route("api/v1/[controller]")]
    public class NotificationsController : ControllerBase
    {
        private static readonly TimeSpan TokenLifetime = TimeSpan.FromMinutes(10);
        private readonly IConfiguration _config;
        private readonly IMarketingDbContext _db;
        private readonly INotifier _notifier;
        private readonly FcmSender _fcm;

        public NotificationsController(IConfiguration config, IMarketingDbContext db, INotifier notifier, FcmSender fcm)
        {
            _config = config;
            _db = db;
            _notifier = notifier;
            _fcm = fcm;
        }

        private string Me => User.AgentIdOf();

        private static object Shape(Notification n) => new
        {
            id = n.Id, kind = n.Kind, title = n.Title, body = n.Body, link = n.Link, refId = n.RefId, createdAt = n.CreatedAt, read = n.ReadAt != null,
        };

        // ─── Inbox ───────────────────────────────────────────────────────────

        /// <summary>My notifications, newest first (30 a page; <c>before</c> for older). Also the unread count.</summary>
        [HttpGet]
        public async Task<IActionResult> List([FromQuery] DateTime? before, [FromQuery] bool unreadOnly = false, [FromQuery] int limit = 30, CancellationToken ct = default)
        {
            var me = Me;
            limit = Math.Clamp(limit, 1, 100);
            var q = _db.Notifications.AsNoTracking().Where(n => n.UserId == me);
            if (unreadOnly) q = q.Where(n => n.ReadAt == null);
            if (before != null) q = q.Where(n => n.CreatedAt < before.Value.ToUniversalTime());
            var list = await q.OrderByDescending(n => n.CreatedAt).Take(limit).ToListAsync(ct);
            var unread = await _db.Notifications.CountAsync(n => n.UserId == me && n.ReadAt == null, ct);
            return Ok(new { items = list.Select(Shape), unread, hasMore = list.Count == limit });
        }

        [HttpGet("unread")]
        public async Task<IActionResult> Unread(CancellationToken ct)
        {
            var me = Me;
            return Ok(new { total = await _db.Notifications.CountAsync(n => n.UserId == me && n.ReadAt == null, ct) });
        }

        [HttpPost("{id:guid}/read")]
        public async Task<IActionResult> Read(Guid id, CancellationToken ct)
        {
            var me = Me;
            var n = await _db.Notifications.FirstOrDefaultAsync(x => x.Id == id && x.UserId == me, ct);
            if (n == null) return NotFound();
            n.ReadAt ??= DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { read = true });
        }

        [HttpPost("read-all")]
        public async Task<IActionResult> ReadAll(CancellationToken ct)
        {
            var me = Me;
            var now = DateTime.UtcNow;
            var list = await _db.Notifications.Where(x => x.UserId == me && x.ReadAt == null).ToListAsync(ct);
            foreach (var n in list) n.ReadAt = now;
            await _db.SaveChangesAsync(ct);
            return Ok(new { read = list.Count });
        }

        // ─── Phones ──────────────────────────────────────────────────────────

        /// <summary>The app registers its push token after sign-in. A token moves with whoever signed in last on that phone.</summary>
        [HttpPost("devices")]
        public async Task<IActionResult> RegisterDevice([FromBody] RegisterDeviceDto dto, CancellationToken ct)
        {
            var token = (dto.Token ?? "").Trim();
            if (token.Length < 20 || token.Length > 4096) return BadRequest(new { message = "Invalid push token." });
            var d = await _db.PushDevices.FirstOrDefaultAsync(x => x.Token == token, ct);
            if (d == null)
            {
                d = new PushDevice { Token = token };
                _db.PushDevices.Add(d);
            }
            d.UserId = Me;
            d.Platform = string.IsNullOrWhiteSpace(dto.Platform) ? "android" : dto.Platform.Trim().ToLowerInvariant();
            d.DeviceId = dto.DeviceId;
            d.LastSeenAt = DateTime.UtcNow;
            d.Enabled = true;
            await _db.SaveChangesAsync(ct);
            return Ok(new { registered = true, pushConfigured = _fcm.Configured });
        }

        /// <summary>Signing out: this phone stops getting my notifications.</summary>
        [HttpPost("devices/remove")]
        public async Task<IActionResult> RemoveDevice([FromBody] RegisterDeviceDto dto, CancellationToken ct)
        {
            var me = Me;
            var token = (dto.Token ?? "").Trim();
            var d = await _db.PushDevices.FirstOrDefaultAsync(x => x.Token == token && x.UserId == me, ct);
            if (d != null) { d.Enabled = false; await _db.SaveChangesAsync(ct); }
            return Ok(new { removed = d != null });
        }

        // ─── Settings ────────────────────────────────────────────────────────

        [HttpGet("settings")]
        public async Task<IActionResult> Settings(CancellationToken ct)
        {
            var me = Me;
            var s = await _db.NotificationSettings.AsNoTracking().FirstOrDefaultAsync(x => x.UserId == me, ct);
            var muted = new HashSet<string>((s?.MutedKinds ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries));
            var phones = await _db.PushDevices.CountAsync(d => d.UserId == me && d.Enabled, ct);
            return Ok(new
            {
                // Leads only reach the office, so field agents don't see that switch.
                kinds = NotificationKinds.All.Where(k => k.Kind != "lead" || User.IsDashboardUser()).Select(k => new { kind = k.Kind, label = k.Label, on = !muted.Contains(k.Kind) }),
                pushConfigured = _fcm.Configured,
                phones,
            });
        }

        [HttpPut("settings")]
        public async Task<IActionResult> SaveSettings([FromBody] NotificationSettingsDto dto, CancellationToken ct)
        {
            var me = Me;
            var muted = (dto.Muted ?? new()).Where(NotificationKinds.IsKnown).Distinct().ToList();
            var s = await _db.NotificationSettings.FirstOrDefaultAsync(x => x.UserId == me, ct);
            if (s == null) { s = new NotificationSetting { UserId = me }; _db.NotificationSettings.Add(s); }
            s.MutedKinds = string.Join(',', muted);
            s.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { muted });
        }

        /// <summary>Sends me a test notification (inbox, CRM and phone), to check everything is connected.</summary>
        [HttpPost("test")]
        public IActionResult Test()
        {
            _notifier.Notify(new NotifyJob
            {
                To = new() { Me }, Kind = "note", Title = "Test notification",
                Body = "Notifications are working on this device. 🎉", Link = "notifications",
            });
            return Ok(new { queued = true, pushConfigured = _fcm.Configured });
        }

        [HttpGet("push-token")]
        public ActionResult<PushTokenDto> GetPushToken()
        {
            var secret = _config["Push:TokenSecret"];
            if (string.IsNullOrEmpty(secret) || secret.Length < 32)
            {
                return StatusCode(StatusCodes.Status503ServiceUnavailable,
                    "Push notifications are not configured on the server.");
            }

            var agentId = User.FindFirst("agentId")?.Value;
            if (string.IsNullOrEmpty(agentId)) return Unauthorized();

            var expiresAt = DateTime.UtcNow.Add(TokenLifetime);
            var payloadJson = JsonSerializer.Serialize(new
            {
                agentId,
                exp = new DateTimeOffset(expiresAt).ToUnixTimeSeconds(),
            });
            var payloadPart = Base64Url(Encoding.UTF8.GetBytes(payloadJson));

            using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
            var signaturePart = Base64Url(hmac.ComputeHash(Encoding.UTF8.GetBytes(payloadPart)));

            return Ok(new PushTokenDto
            {
                Token = $"{payloadPart}.{signaturePart}",
                ExpiresAt = expiresAt,
            });
        }

        private static string Base64Url(byte[] bytes) =>
            Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }
}
