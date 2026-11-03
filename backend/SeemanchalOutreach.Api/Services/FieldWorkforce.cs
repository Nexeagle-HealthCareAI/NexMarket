using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// Who counts as doing field marketing: every field-role agent, plus anyone in another role
    /// (manager, admin, hospital rep…) who has a block assigned or started a shift in the app recently.
    /// </summary>
    public static class FieldWorkforce
    {
        public static async Task<HashSet<string>> ActiveIdsAsync(IMarketingDbContext db, CancellationToken ct)
        {
            var people = await db.Agents.AsNoTracking().Where(a => a.IsActive).Select(a => new { a.AgentId, a.Role }).ToListAsync(ct);
            var ids = people.Where(a => !RoleChecks.IsDashboardRole(a.Role)).Select(a => a.AgentId).ToHashSet();
            var dashboard = people.Where(a => RoleChecks.IsDashboardRole(a.Role)).Select(a => a.AgentId).ToList();
            if (dashboard.Count == 0) return ids;
            var since = DateTime.UtcNow.AddDays(-30);
            var assigned = await db.BlockAssignments.AsNoTracking().Where(b => b.Status == "Active" && dashboard.Contains(b.AgentId)).Select(b => b.AgentId).ToListAsync(ct);
            var shifted = await db.Shifts.AsNoTracking().Where(s => s.StartTime >= since && dashboard.Contains(s.AgentId)).Select(s => s.AgentId).Distinct().ToListAsync(ct);
            ids.UnionWith(assigned);
            ids.UnionWith(shifted);
            return ids;
        }
    }
}
