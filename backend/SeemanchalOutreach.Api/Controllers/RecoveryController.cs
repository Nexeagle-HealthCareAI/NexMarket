using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Controllers
{
    public class ForgotDto { public string? UserId { get; set; } }
    public class ResetDto { public string? UserId { get; set; } public string? Code { get; set; } public string? NewPassword { get; set; } }

    /// <summary>
    /// "Forgot password" for everyone, in every organisation. A code goes to the person's own email and WhatsApp number
    /// (the ones already saved on their account), sent from the platform's mail account and WhatsApp number.
    /// The answers never say whether an account exists.
    /// </summary>
    [ApiController]
    [AllowAnonymous]
    [Route("api/v1/auth")]
    [EnableRateLimiting("auth")]
    public class RecoveryController : ControllerBase
    {
        private const string Sent = "If this account exists, a 6-digit code has been sent to its email and WhatsApp number. It works for 10 minutes.";
        private const string BadCode = "That code is wrong or has expired. Ask for a new one.";

        private readonly IMarketingDbContext _db;
        private readonly IMemoryCache _cache;
        private readonly CodeSender _codes;

        public RecoveryController(IMarketingDbContext db, IMemoryCache cache, CodeSender codes)
        {
            _db = db; _cache = cache; _codes = codes;
        }

        /// <summary>Which ways a code can be sent on this server, so the page can say so honestly.</summary>
        [HttpGet("recovery/options")]
        public IActionResult Options() => Ok(new { email = _codes.EmailReady, whatsapp = _codes.WhatsAppReady });

        [HttpPost("forgot")]
        public async Task<IActionResult> Forgot([FromBody] ForgotDto dto, CancellationToken ct)
        {
            var typed = (dto?.UserId ?? "").Trim();
            if (typed.Length == 0 || typed.Length > 120) return BadRequest(new { message = "Enter your User ID, phone or email." });
            if (!_codes.Ready)
                return StatusCode(503, new { message = "Codes can't be sent from this server yet. Ask your admin to reset your password." });

            var agent = await _db.Agents.FirstOrDefaultAsync(a => a.AgentId == typed || a.Phone == typed || (a.Email != null && a.Email == typed), ct);
            if (agent == null || !agent.IsActive) return Ok(new { message = Sent });

            // At most three codes an hour for one account, however many times the button is pressed.
            var sends = _cache.TryGetValue<int>(Recovery.SendsKey(agent.AgentId), out var n) ? n : 0;
            if (sends >= Recovery.MaxSendsPerHour) return Ok(new { message = Sent });
            _cache.Set(Recovery.SendsKey(agent.AgentId), sends + 1, TimeSpan.FromHours(1));

            var code = Recovery.NewCode();
            _cache.Set(Recovery.CacheKey(agent.AgentId), new Recovery.Pending(Recovery.Hash(agent.AgentId, code), DateTime.UtcNow.AddMinutes(Recovery.CodeMinutes), 0),
                TimeSpan.FromMinutes(Recovery.CodeMinutes + 1));

            var org = OrgScope.Current?.Name ?? "NexEagle";
            var (byEmail, byWhatsApp) = await _codes.SendAsync(agent.Email, agent.Phone, code, $"Your NexEagle code: {code}", Recovery.EmailText(code, org), ct);
            _db.AuditLogs.Add(AuthAudit.Event(HttpContext, agent, "password_code_sent",
                byEmail || byWhatsApp ? $"Forgot-password code sent by {string.Join(" and ", new[] { byEmail ? "email" : null, byWhatsApp ? "WhatsApp" : null }.Where(x => x != null))}"
                    : "Forgot-password code could not be sent (no email or WhatsApp number on the account, or sending failed)", null, DeviceKinds.Detect(Request)));
            await _db.SaveChangesAsync(ct);
            return Ok(new { message = Sent });
        }

        [HttpPost("reset")]
        public async Task<IActionResult> Reset([FromBody] ResetDto dto, CancellationToken ct)
        {
            var typed = (dto?.UserId ?? "").Trim();
            var pw = dto?.NewPassword ?? "";
            if (typed.Length == 0 || typed.Length > 120) return BadRequest(new { message = BadCode });
            if (pw.Length < 8 || pw.Length > 200) return BadRequest(new { message = "Use a password of at least 8 characters." });

            var agent = await _db.Agents.FirstOrDefaultAsync(a => a.AgentId == typed || a.Phone == typed || (a.Email != null && a.Email == typed), ct);
            if (agent == null || !agent.IsActive) return BadRequest(new { message = BadCode });

            var key = Recovery.CacheKey(agent.AgentId);
            _cache.TryGetValue<Recovery.Pending>(key, out var pending);
            var result = Recovery.Check(pending, agent.AgentId, dto?.Code, DateTime.UtcNow);
            if (result != Recovery.Result.Ok)
            {
                // Count the wrong try; after five the code is finished.
                if (pending != null && result == Recovery.Result.Wrong)
                    _cache.Set(key, pending with { Tries = pending.Tries + 1 }, pending.Expires - DateTime.UtcNow + TimeSpan.FromMinutes(1));
                return BadRequest(new { message = BadCode });
            }
            if (LoginGuard.Weak(pw, agent.AgentId, agent.Phone, agent.Name) is { } why) return BadRequest(new { message = why });

            agent.PasswordHash = BCrypt.Net.BCrypt.HashPassword(pw);
            agent.MustChangePassword = false;
            _cache.Remove(key);
            var sessions = await _db.AgentRefreshTokens.Where(t => t.AgentId == agent.AgentId && t.RevokedAt == null && t.ExpiresAt > DateTime.UtcNow).ToListAsync(ct);
            foreach (var t in sessions) SessionGuard.End(t, "Your password was changed. Sign in with the new password.", _cache);
            foreach (var id in new[] { agent.AgentId, agent.Phone, agent.Email }.Where(x => !string.IsNullOrWhiteSpace(x))) LoginGuard.Reset(_cache, LoginGuard.Key(id!));
            _db.AuditLogs.Add(AuthAudit.Event(HttpContext, agent, "password_reset", "New password set with a forgot-password code", null, DeviceKinds.Detect(Request)));
            await _db.SaveChangesAsync(ct);
            return Ok(new { message = "Your password has been changed. Sign in with the new one." });
        }
    }
}
