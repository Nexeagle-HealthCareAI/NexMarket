using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
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

        public AccessController(IMarketingDbContext db, IPermissionService perms)
        {
            _db = db;
            _perms = perms;
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
                .Select(a => new { a.AgentId, a.Name, a.Phone, a.Email, a.Role, a.District, a.Block, a.IsActive, a.CreatedAt })
                .ToListAsync();

            var lastLogin = await _db.AgentRefreshTokens.AsNoTracking()
                .GroupBy(t => t.AgentId)
                .Select(g => new { AgentId = g.Key, At = g.Max(t => t.CreatedAt) })
                .ToDictionaryAsync(x => x.AgentId, x => x.At);

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
                    lastSignIn = lastLogin.TryGetValue(p.AgentId, out var at) ? at : (DateTime?)null,
                };
            }));
        }

        /// <summary>Signs a person out of every device (lost phone, person left).</summary>
        [HttpPost("people/{agentId}/sign-out")]
        [Authorize(Roles = "Admin,admin")]
        public async Task<IActionResult> SignOutEverywhere(string agentId)
        {
            var tokens = await _db.AgentRefreshTokens.Where(t => t.AgentId == agentId).ToListAsync();
            foreach (var t in tokens) t.ExpiresAt = DateTime.UtcNow.AddSeconds(-1);
            await _db.SaveChangesAsync();
            return Ok(new { signedOutDevices = tokens.Count });
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
    }
}
