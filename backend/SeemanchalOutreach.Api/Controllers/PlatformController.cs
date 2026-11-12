using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class OrgStatusDto { public string? Status { get; set; } }

    /// <summary>Who runs the platform: an admin of the first organisation (the one whose database holds the list of the others).</summary>
    public static class Platform
    {
        public static bool IsOwner(ClaimsPrincipal? user, OrgInfo? org) => user.IsAdmin() && org != null && org.Database == null;

        /// <summary>A one-time password: easy to read out on the phone, no look-alike letters.</summary>
        public static string OneTimePassword()
        {
            const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
            var bytes = RandomNumberGenerator.GetBytes(10);
            return new string(bytes.Select(b => chars[b % chars.Length]).ToArray()) + "#" + (2 + bytes[0] % 8);
        }

        /// <summary>Only the last four digits of a phone are shown to the platform owner.</summary>
        public static string PhoneEnd(string? phone)
        {
            var d = new string((phone ?? "").Where(char.IsDigit).ToArray());
            return d.Length >= 4 ? "…" + d[^4..] : "";
        }
    }

    /// <summary>
    /// For the people who run the platform: see every organisation, pause or resume one, and give an organisation's
    /// admin a new one-time password when they are locked out. It shows counts and admins' names only: never an
    /// organisation's patients, leads or messages.
    /// </summary>
    [ApiController]
    [Authorize(Roles = "Admin,admin")]
    [Route("api/v1/platform")]
    public class PlatformController : ControllerBase
    {
        private readonly IServiceScopeFactory _scopes;
        private readonly OrgDirectory _orgs;
        private readonly ILogger<PlatformController> _log;

        public PlatformController(IServiceScopeFactory scopes, OrgDirectory orgs, ILogger<PlatformController> log)
        {
            _scopes = scopes; _orgs = orgs; _log = log;
        }

        private bool Owner => Platform.IsOwner(User, OrgScope.Current);
        // Hidden, not "forbidden": other organisations' admins should not learn that this exists.
        private IActionResult Hidden() => NotFound();

        [HttpGet("orgs")]
        public async Task<IActionResult> List(CancellationToken ct)
        {
            if (!Owner) return Hidden();
            using var platform = OrgScope.Enter(null);
            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<IMarketingDbContext>();
            var rows = await db.Organisations.AsNoTracking().OrderByDescending(o => o.CreatedAt).ToListAsync(ct);
            var first = new { key = _orgs.Default.Key, name = _orgs.Default.Name, kinds = Array.Empty<string>(), status = "active", createdAt = (DateTime?)null, first = true };
            var others = rows.Select(o => new
            {
                key = o.Key, name = o.Name, kinds = (o.Kinds ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries),
                status = o.Status, createdAt = (DateTime?)o.CreatedAt, first = false,
            });
            return Ok(new { items = new[] { first }.Concat(others), kinds = Signup.Kinds.ToDictionary(k => k.Key, k => k.Label) });
        }

        private async Task<Organisation?> RowAsync(string key, CancellationToken ct)
        {
            var k = OrgNames.Key(key);
            if (k == null) return null;
            using var platform = OrgScope.Enter(null);
            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<IMarketingDbContext>();
            return await db.Organisations.AsNoTracking().FirstOrDefaultAsync(o => o.Key == k, ct);
        }

        private static OrgInfo? InfoOf(Organisation? row) =>
            row == null || string.IsNullOrWhiteSpace(row.Database) ? null : new OrgInfo(row.Key, row.Name, row.Database, row.Kinds);

        /// <summary>How many people use an organisation, when someone was last active, and who its admins are.</summary>
        [HttpGet("orgs/{key}")]
        public async Task<IActionResult> Detail(string key, CancellationToken ct)
        {
            if (!Owner) return Hidden();
            var org = InfoOf(await RowAsync(key, ct));
            if (org == null) return NotFound(new { message = "That organisation was not found." });
            try
            {
                using var enter = OrgScope.Enter(org);
                using var scope = _scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<IMarketingDbContext>();
                var people = await db.Agents.AsNoTracking().Select(a => new { a.AgentId, a.Name, a.Phone, a.Role, a.IsActive, a.MustChangePassword, a.LastActiveAt }).ToListAsync(ct);
                return Ok(new
                {
                    users = people.Count,
                    activeUsers = people.Count(p => p.IsActive),
                    lastActiveAt = people.Max(p => p.LastActiveAt),
                    admins = people.Where(p => RoleChecks.CanonicalDashboardRole(p.Role) == RoleChecks.Admin).OrderBy(p => p.Name)
                        .Select(p => new { agentId = p.AgentId, name = p.Name, phoneEnd = Platform.PhoneEnd(p.Phone), isActive = p.IsActive, mustChangePassword = p.MustChangePassword, lastActiveAt = p.LastActiveAt }),
                });
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _log.LogWarning(ex, "Could not read organisation {Org}", org.Key);
                return StatusCode(502, new { message = "This organisation's database could not be read just now." });
            }
        }

        /// <summary>Pause (nobody can sign in, nothing is sent, no data is touched) or resume an organisation.</summary>
        [HttpPost("orgs/{key}/status")]
        public async Task<IActionResult> SetStatus(string key, [FromBody] OrgStatusDto dto, CancellationToken ct)
        {
            if (!Owner) return Hidden();
            var want = (dto?.Status ?? "").Trim().ToLowerInvariant();
            if (want != "active" && want != "paused") return BadRequest(new { message = "Choose active or paused." });
            var k = OrgNames.Key(key);
            using var platform = OrgScope.Enter(null);
            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<IMarketingDbContext>();
            var row = k == null ? null : await db.Organisations.FirstOrDefaultAsync(o => o.Key == k, ct);
            if (row == null) return NotFound(new { message = "That organisation was not found." });
            if (row.Status != "active" && row.Status != "paused") return BadRequest(new { message = "This organisation never finished setting up. It can be signed up again with the same name." });
            row.Status = want;
            await db.SaveChangesAsync(ct);
            _orgs.Refresh();
            _log.LogInformation("Organisation {Org} set to {Status} by {Who}", row.Key, want, User.AgentIdOf());
            return Ok(new { key = row.Key, status = row.Status });
        }

        /// <summary>
        /// Gives one admin of an organisation a new one-time password, for when they are locked out and nobody in their
        /// organisation can reset it. The password is shown once here; they must change it at the next sign-in. It is
        /// written in that organisation's own activity log, and all their devices are signed out.
        /// </summary>
        [HttpPost("orgs/{key}/admins/{agentId}/reset-password")]
        public async Task<IActionResult> ResetAdmin(string key, string agentId, CancellationToken ct)
        {
            if (!Owner) return Hidden();
            var by = User.AgentIdOf();
            var org = InfoOf(await RowAsync(key, ct));
            if (org == null) return NotFound(new { message = "That organisation was not found." });
            using var enter = OrgScope.Enter(org);
            using var scope = _scopes.CreateScope();
            var sp = scope.ServiceProvider;
            var db = sp.GetRequiredService<IMarketingDbContext>();
            var cache = sp.GetRequiredService<IMemoryCache>();
            var agent = await db.Agents.FirstOrDefaultAsync(a => a.AgentId == agentId, ct);
            if (agent == null || RoleChecks.CanonicalDashboardRole(agent.Role) != RoleChecks.Admin)
                return NotFound(new { message = "That admin was not found. Only an organisation's admins can be reset from here; they reset everyone else." });

            var password = Platform.OneTimePassword();
            agent.PasswordHash = BCrypt.Net.BCrypt.HashPassword(password);
            agent.MustChangePassword = true;
            agent.IsActive = true;
            var sessions = await db.AgentRefreshTokens.Where(t => t.AgentId == agentId && t.RevokedAt == null && t.ExpiresAt > DateTime.UtcNow).ToListAsync(ct);
            foreach (var t in sessions) SessionGuard.End(t, "Your password was reset by NexEagle support. Sign in with the new password.", cache);
            foreach (var id in new[] { agent.AgentId, agent.Phone, agent.Email }.Where(x => !string.IsNullOrWhiteSpace(x))) LoginGuard.Reset(cache, LoginGuard.Key(id!));
            db.AuditLogs.Add(AuthAudit.Event(HttpContext, agent, "password_reset", "New one-time password given by NexEagle support (platform admin)", null, null));
            await db.SaveChangesAsync(ct);
            _log.LogInformation("Platform admin {Who} reset the password of admin {Agent} in organisation {Org}", by, agentId, org.Key);
            return Ok(new { agentId = agent.AgentId, name = agent.Name, password, signedOutDevices = sessions.Count });
        }
    }
}
