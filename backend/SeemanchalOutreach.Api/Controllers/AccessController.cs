using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class UpdateRoleAccessDto
    {
        public Dictionary<string, int> Pages { get; set; } = new();
    }

    /// <summary>Users &amp; roles: which dashboard pages each role can open.</summary>
    [ApiController]
    [Authorize]
    [Route("api/v1/access")]
    public class AccessController : ControllerBase
    {
        private static readonly string[] EditableRoles = { RoleChecks.MarketingManager, RoleChecks.HospitalRep };

        private readonly IMarketingDbContext _db;
        private readonly IPermissionService _perms;
        private readonly IMemoryCache _cache;
        private readonly IAuditActor _actor;

        public AccessController(IMarketingDbContext db, IPermissionService perms, IMemoryCache cache, IAuditActor actor)
        {
            _db = db;
            _perms = perms;
            _cache = cache;
            _actor = actor;
        }

        /// <summary>Sign-in changes an admin makes for someone else, in the activity log under the admin's name.</summary>
        private async Task LogAdminAsync(string agentId, string action, string what)
        {
            var name = await _db.Agents.AsNoTracking().Where(a => a.AgentId == agentId).Select(a => a.Name).FirstOrDefaultAsync();
            _db.AuditLogs.Add(new AuditLog
            {
                ActorId = _actor.ActorId, ActorName = _actor.ActorName, ActorRole = _actor.ActorRole, Source = _actor.Source,
                DeviceId = _actor.DeviceId, DeviceType = _actor.DeviceType, Ip = _actor.Ip, Request = _actor.Request,
                Action = action, Entity = "Sign-in", EntityId = agentId, Summary = $"{name ?? agentId}: {what}",
            });
        }

        /// <summary>Ends one signed-in device (for example a lost phone).</summary>
        [HttpPost("people/{agentId}/sessions/{sessionId:guid}/sign-out")]
        [Authorize(Roles = "Admin,admin")]
        public async Task<IActionResult> SignOutSession(string agentId, Guid sessionId)
        {
            var t = await _db.AgentRefreshTokens.FirstOrDefaultAsync(x => x.Id == sessionId && x.AgentId == agentId);
            if (t == null) return NotFound();
            if (t.RevokedAt == null) SessionGuard.End(t, "An admin signed you out of this device. Please sign in again.", _cache);
            await LogAdminAsync(agentId, "sign_out", $"Signed out of their {DeviceKinds.Label(t.DeviceType)} by an admin");
            await _db.SaveChangesAsync();
            return Ok(new { signedOut = true });
        }

        /// <summary>The signed-in user's role and page access — drives the dashboard menu.</summary>
        [HttpGet("me")]
        public async Task<IActionResult> Me()
        {
            var role = User.RoleOf();
            var canonical = RoleChecks.CanonicalDashboardRole(role);
            return Ok(new
            {
                agentId = User.AgentIdOf(),
                role = canonical ?? role,
                isAdmin = User.IsAdmin(),
                isDashboardUser = canonical != null,
                pages = await _perms.GetLevelsAsync(role),
            });
        }

        [HttpGet("roles")]
        [PageAccess(Pages.Users)]
        public async Task<IActionResult> Roles()
        {
            var counts = await _db.Agents.AsNoTracking()
                .Where(a => a.IsActive)
                .GroupBy(a => a.Role)
                .Select(g => new { Role = g.Key, Count = g.Count() })
                .ToListAsync();

            int CountOf(string canonical) => counts.Where(c => RoleChecks.CanonicalDashboardRole(c.Role) == canonical).Sum(c => c.Count);
            int fieldCount = counts.Where(c => RoleChecks.CanonicalDashboardRole(c.Role) == null).Sum(c => c.Count);

            var roles = new List<object>
            {
                new { role = RoleChecks.Admin, label = "Admin", users = CountOf(RoleChecks.Admin), editable = false, pages = await _perms.GetLevelsAsync(RoleChecks.Admin) },
                new { role = RoleChecks.MarketingManager, label = "Marketing manager", users = CountOf(RoleChecks.MarketingManager), editable = true, pages = await _perms.GetLevelsAsync(RoleChecks.MarketingManager) },
                new { role = RoleChecks.HospitalRep, label = "Hospital representative", users = CountOf(RoleChecks.HospitalRep), editable = true, pages = await _perms.GetLevelsAsync(RoleChecks.HospitalRep) },
            };
            return Ok(new { pages = Pages.All, roles, fieldAgents = fieldCount });
        }

        /// <summary>Only Admin changes what other roles can see.</summary>
        [HttpPut("roles/{role}")]
        [Authorize(Roles = "Admin,admin")]
        public async Task<IActionResult> UpdateRole(string role, [FromBody] UpdateRoleAccessDto dto)
        {
            var canonical = RoleChecks.CanonicalDashboardRole(role);
            if (canonical == null || !EditableRoles.Contains(canonical)) return BadRequest("This role's access can't be changed.");

            var existing = await _db.RolePermissions.Where(r => r.Role == canonical).ToListAsync();
            var current = await _perms.GetLevelsAsync(canonical); // includes defaults when nothing is stored yet
            var now = DateTime.UtcNow;

            foreach (var page in Pages.All)
            {
                int level = dto.Pages.TryGetValue(page, out var l) ? Math.Clamp(l, 0, 2) : current[page];
                var row = existing.FirstOrDefault(r => r.PageKey == page);
                if (row == null)
                {
                    _db.RolePermissions.Add(new RolePermission { Role = canonical, PageKey = page, Level = level, UpdatedAt = now, UpdatedBy = User.AgentIdOf() });
                }
                else
                {
                    row.Level = level;
                    row.UpdatedAt = now;
                    row.UpdatedBy = User.AgentIdOf();
                }
            }
            await _db.SaveChangesAsync();
            _perms.Invalidate();
            return Ok(await _perms.GetLevelsAsync(canonical));
        }

        /// <summary>Everyone with a login: dashboard users and field agents.</summary>
        [HttpGet("people")]
        [PageAccess(Pages.Users)]
        public async Task<IActionResult> People()
        {
            var people = await _db.Agents.AsNoTracking()
                .OrderBy(a => a.Name)
                .Select(a => new { a.AgentId, a.Name, a.Phone, a.Email, a.Role, a.District, a.Block, a.IsActive, a.CreatedAt, a.MustChangePassword })
                .ToListAsync();

            var lastLogin = await _db.AgentRefreshTokens.AsNoTracking()
                .GroupBy(t => t.AgentId)
                .Select(g => new { AgentId = g.Key, At = g.Max(t => t.CreatedAt) })
                .ToDictionaryAsync(x => x.AgentId, x => x.At);
            var nowUtc = DateTime.UtcNow;
            var active = (await _db.AgentRefreshTokens.AsNoTracking()
                    .Where(t => t.RevokedAt == null && t.ExpiresAt > nowUtc)
                    .Select(t => new { t.Id, t.AgentId, t.DeviceType, t.CreatedAt, t.LastSeenAt, t.UserAgent, t.Ip })
                    .ToListAsync())
                .GroupBy(t => t.AgentId)
                .ToDictionary(g => g.Key, g => g.OrderBy(t => t.DeviceType).Select(t => new
                {
                    id = t.Id, deviceType = t.DeviceType ?? DeviceKinds.Desktop, signedInAt = t.CreatedAt, lastSeenAt = t.LastSeenAt,
                    device = DescribeAgent(t.UserAgent), t.Ip,
                }).ToList());

            return Ok(people.Select(p =>
            {
                var canonical = RoleChecks.CanonicalDashboardRole(p.Role);
                return new
                {
                    p.AgentId,
                    p.Name,
                    p.Phone,
                    p.Email,
                    role = canonical ?? p.Role,
                    kind = canonical == null ? "field" : "dashboard",
                    p.District,
                    p.Block,
                    p.IsActive,
                    p.CreatedAt,
                    // Still on the one-time password an admin gave them (they haven't set their own yet).
                    onOneTimePassword = p.MustChangePassword,
                    lastSignIn = lastLogin.TryGetValue(p.AgentId, out var at) ? at : (DateTime?)null,
                    // Signed in right now: at most one phone, one tablet and one laptop/desktop.
                    sessions = active.TryGetValue(p.AgentId, out var ss) ? (object)ss : Array.Empty<object>(),
                };
            }));
        }

        /// <summary>Signs a person out of every device (lost phone, person left).</summary>
        [HttpPost("people/{agentId}/sign-out")]
        [Authorize(Roles = "Admin,admin")]
        public async Task<IActionResult> SignOutEverywhere(string agentId)
        {
            var tokens = await _db.AgentRefreshTokens.Where(t => t.AgentId == agentId && t.RevokedAt == null && t.ExpiresAt > DateTime.UtcNow).ToListAsync();
            foreach (var t in tokens) SessionGuard.End(t, "An admin signed you out. Please sign in again.", _cache);
            await LogAdminAsync(agentId, "sign_out", $"Signed out of every device by an admin ({tokens.Count})");
            await _db.SaveChangesAsync();
            return Ok(new { signedOutDevices = tokens.Count });
        }

        /// <summary>
        /// Gives a person a new one-time password (passwords are stored hashed, so an existing one can never be shown).
        /// Signs them out of every device; they set their own password at the next sign-in. The new password is
        /// returned once, for the admin to send.
        /// </summary>
        [HttpPost("people/{agentId}/reset-password")]
        [Authorize(Roles = "Admin,admin")]
        public async Task<IActionResult> ResetPassword(string agentId)
        {
            if (agentId == User.AgentIdOf()) return BadRequest("Change your own password from your profile instead.");
            var agent = await _db.Agents.FirstOrDefaultAsync(a => a.AgentId == agentId);
            if (agent == null) return NotFound();
            const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
            var bytes = System.Security.Cryptography.RandomNumberGenerator.GetBytes(10);
            var password = new string(bytes.Select(b => chars[b % chars.Length]).ToArray()) + "#" + (2 + bytes[0] % 8);
            agent.PasswordHash = BCrypt.Net.BCrypt.HashPassword(password);
            agent.MustChangePassword = true;
            var sessions = await _db.AgentRefreshTokens.Where(t => t.AgentId == agentId && t.RevokedAt == null && t.ExpiresAt > DateTime.UtcNow).ToListAsync();
            foreach (var t in sessions) SessionGuard.End(t, "Your password was reset by an admin. Sign in with the new password.", _cache);
            await LogAdminAsync(agentId, "password_reset", "New one-time password given by an admin");
            await _db.SaveChangesAsync();
            return Ok(new { agent.AgentId, agent.Name, agent.Phone, password, signedOutDevices = sessions.Count });
        }

        [HttpPost("people/{agentId}/active")]
        [Authorize(Roles = "Admin,admin")]
        public async Task<IActionResult> SetActive(string agentId, [FromQuery] bool value)
        {
            if (agentId == User.AgentIdOf() && !value) return BadRequest("You can't deactivate your own account.");
            var agent = await _db.Agents.FirstOrDefaultAsync(a => a.AgentId == agentId);
            if (agent == null) return NotFound();
            agent.IsActive = value;
            await _db.SaveChangesAsync();
            return Ok(new { agent.AgentId, agent.IsActive });
        }

        /// <summary>"Chrome on Windows", "NexMarket app on Android"… from a user agent.</summary>
        private static string? DescribeAgent(string? ua)
        {
            if (string.IsNullOrWhiteSpace(ua)) return null;
            string os = ua.Contains("Windows") ? "Windows" : ua.Contains("iPad") ? "iPad" : ua.Contains("iPhone") ? "iPhone"
                : ua.Contains("Android") ? "Android" : ua.Contains("Mac OS") ? "Mac" : ua.Contains("Linux") ? "Linux" : "";
            if (ua.Contains("okhttp") || ua.Contains("Expo") || ua.Contains("NexMarket")) return $"NexMarket app{(os == "" ? "" : " on " + os)}";
            string br = ua.Contains("Edg/") ? "Edge" : ua.Contains("OPR/") ? "Opera" : ua.Contains("Chrome/") ? "Chrome"
                : ua.Contains("Firefox/") ? "Firefox" : ua.Contains("Safari/") ? "Safari" : "Browser";
            return os == "" ? br : $"{br} on {os}";
        }
    }
}
