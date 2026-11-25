using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class SpendCampLinkDto
    {
        public List<Guid>? CampIds { get; set; }
    }

    /// <summary>
    /// Health camps inside Marketing spend projects: a project can hold one or more camps, and then shows what its camps
    /// brought (people seen, sent to the hospital, came, OPD, admitted, billed) beside what the project spent.
    /// </summary>
    public partial class SpendController
    {
        /// <summary>Camps to pick from when linking: the newest first, with the project each is already in.</summary>
        [HttpGet("camps")]
        public async Task<IActionResult> CampsToLink([FromQuery] string? q, CancellationToken ct)
        {
            var all = _db.HealthCamps.AsNoTracking().AsQueryable();
            if (!string.IsNullOrWhiteSpace(q))
            {
                var s = q.Trim().ToLower();
                all = all.Where(c => c.Title.ToLower().Contains(s) || c.Code.ToLower().Contains(s) || (c.Block != null && c.Block.ToLower().Contains(s)) || (c.Venue != null && c.Venue.ToLower().Contains(s)));
            }
            var camps = await all.OrderByDescending(c => c.Date).Take(200).ToListAsync(ct);
            var pids = camps.Where(c => c.SpendProjectId != null).Select(c => c.SpendProjectId!.Value).Distinct().ToList();
            var names = await _db.SpendProjects.AsNoTracking().Where(p => pids.Contains(p.Id)).Select(p => new { p.Id, p.Name }).ToListAsync(ct);
            return Ok(camps.Select(c => new
            {
                id = c.Id, title = c.Title, code = c.Code, date = c.Date.ToString("yyyy-MM-dd"), status = c.Status, place = c.Venue ?? c.Block ?? c.District,
                budget = c.Budget, projectId = c.SpendProjectId, projectName = names.FirstOrDefault(n => n.Id == c.SpendProjectId)?.Name,
            }));
        }

        /// <summary>Put camps in this project. A camp that was in another project moves here.</summary>
        [HttpPost("projects/{id:guid}/camps")]
        [PageAccess(Pages.Payments, Level = Pages.View)]
        public async Task<IActionResult> LinkCamps(Guid id, [FromBody] SpendCampLinkDto d, CancellationToken ct)
        {
            if (!await CanHandleAsync(ct)) return NotAllowed();
            if (!await _db.SpendProjects.AnyAsync(p => p.Id == id, ct)) return NotFound(new { message = "That project isn't here any more." });
            var n = await LinkAsync(id, d.CampIds, ct);
            if (n == 0) return BadRequest(new { message = "Pick at least one health camp." });
            await _db.SaveChangesAsync(ct);
            return Ok(new { linked = n });
        }

        /// <summary>Take a camp out of this project. Nothing else changes.</summary>
        [HttpPost("projects/{id:guid}/camps/{campId:guid}/unlink")]
        [PageAccess(Pages.Payments, Level = Pages.View)]
        public async Task<IActionResult> UnlinkCamp(Guid id, Guid campId, CancellationToken ct)
        {
            if (!await CanHandleAsync(ct)) return NotAllowed();
            var c = await _db.HealthCamps.FirstOrDefaultAsync(x => x.Id == campId && x.SpendProjectId == id, ct);
            if (c == null) return NotFound(new { message = "That camp isn't in this project." });
            c.SpendProjectId = null;
            c.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { ok = true });
        }

        private async Task<int> LinkAsync(Guid projectId, List<Guid>? campIds, CancellationToken ct)
        {
            var ids = (campIds ?? new()).Distinct().Take(100).ToList();
            if (ids.Count == 0) return 0;
            var camps = await _db.HealthCamps.Where(c => ids.Contains(c.Id)).ToListAsync(ct);
            foreach (var c in camps) { c.SpendProjectId = projectId; c.UpdatedAt = DateTime.UtcNow; }
            return camps.Count;
        }

        /// <summary>Names of the camps in each project, for the project cards.</summary>
        private async Task<Dictionary<Guid, List<string>>> CampNamesAsync(CancellationToken ct)
        {
            var rows = await _db.HealthCamps.AsNoTracking().Where(c => c.SpendProjectId != null).OrderBy(c => c.Date)
                .Select(c => new { P = c.SpendProjectId!.Value, c.Title }).ToListAsync(ct);
            return rows.GroupBy(r => r.P).ToDictionary(g => g.Key, g => g.Select(r => r.Title).ToList());
        }

        /// <summary>The project's camps with what each brought, and the totals against the project's money.</summary>
        private async Task<object> ProjectCampsAsync(Guid projectId, decimal spent, CancellationToken ct)
        {
            var camps = await _db.HealthCamps.AsNoTracking().Where(c => c.SpendProjectId == projectId).OrderBy(c => c.Date).ToListAsync(ct);
            var ids = camps.Select(c => c.Id).ToList();
            var pts = ids.Count == 0 ? new() : await _db.CampPatients.AsNoTracking().Where(p => ids.Contains(p.CampId) && p.Status != "cancelled")
                .Select(p => new { p.CampId, p.Status }).ToListAsync(ct);
            var refs = ids.Count == 0 ? new() : await _db.Referrals.AsNoTracking().Where(r => r.CampId != null && ids.Contains(r.CampId.Value)).ToListAsync(ct);
            var refIds = refs.Select(r => r.ClientId).ToList();
            var bills = refIds.Count == 0 ? new() : await _db.ReferralBills.AsNoTracking().Where(b => refIds.Contains(b.ReferralClientId) && b.Status == "active")
                .Select(b => new PatientResults.Bill(b.ReferralClientId, b.Kind, b.Amount, b.Collected)).ToListAsync(ct);
            var lines = PatientResults.Lines(refs, bills);

            var rows = camps.Select(c =>
            {
                var t = PatientResults.TallyOf(lines.Where(l => l.R.CampId == c.Id));
                var mine = pts.Where(p => p.CampId == c.Id).ToList();
                return new
                {
                    id = c.Id, title = c.Title, code = c.Code, date = c.Date.ToString("yyyy-MM-dd"), status = c.Status, place = c.Venue ?? c.Block ?? c.District,
                    booked = mine.Count, seen = mine.Count(p => p.Status == "attended"),
                    referred = t.Referred, came = t.Came, opd = t.Opd, admitted = t.Admitted, billed = t.Billed, collected = t.Collected,
                };
            }).ToList();
            var all = PatientResults.TallyOf(lines);
            var seen = rows.Sum(r => r.seen);
            return new
            {
                rows,
                total = new
                {
                    camps = rows.Count, booked = rows.Sum(r => r.booked), seen,
                    referred = all.Referred, came = all.Came, opd = all.Opd, admitted = all.Admitted, billed = all.Billed, collected = all.Collected,
                    perSeen = seen > 0 && spent > 0 ? Math.Round(spent / seen) : (decimal?)null,
                    perCame = all.Came > 0 && spent > 0 ? Math.Round(spent / all.Came) : (decimal?)null,
                    // Rupees billed at the hospital for every rupee the project spent.
                    returnX = spent > 0 && all.Billed > 0 ? Math.Round(all.Billed / spent, 1) : (decimal?)null,
                },
            };
        }
    }
}
