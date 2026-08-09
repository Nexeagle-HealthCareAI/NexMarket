using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Controllers
{
    public class BlockReportDto
    {
        public string District { get; set; } = string.Empty;
        public string Block { get; set; } = string.Empty;
        public int Agents { get; set; }
        public int Asha { get; set; }
        public int Rmp { get; set; }
        public int Ward { get; set; }
        public int Med { get; set; }
        public int Mukhiya { get; set; }
        public int Prominent { get; set; }
        public int Visits { get; set; }
        public int Referrals { get; set; }
        public int Converted { get; set; }
    }

    public class ReportSummaryDto
    {
        public int TotalContacts { get; set; }
        public int AshaWorkers { get; set; }
        public int RmpDoctors { get; set; }
        public int WardMembers { get; set; }
        public int MedicineShops { get; set; }
        public int Mukhiyas { get; set; }
        public int ProminentPersons { get; set; }
        public int TotalVisits { get; set; }
        public int TotalReferrals { get; set; }
        public int ConvertedReferrals { get; set; }
        public double ConversionRatePct { get; set; }
        public List<BlockReportDto> Blocks { get; set; } = new();
    }

    [ApiController]
    [Authorize(Roles = "Admin")]
    [Route("api/v1/[controller]")]
    public class ReportsController : ControllerBase
    {
        private readonly IMarketingDbContext _db;

        public ReportsController(IMarketingDbContext db)
        {
            _db = db;
        }

        [HttpGet("summary")]
        public async Task<ActionResult<ReportSummaryDto>> GetSummary([FromQuery] string? district, CancellationToken cancellationToken)
        {
            var panchayats = _db.Panchayats.AsNoTracking().AsQueryable();
            if (!string.IsNullOrWhiteSpace(district))
            {
                panchayats = panchayats.Where(p => p.District == district);
            }
            var panchayatList = await panchayats.ToListAsync(cancellationToken);
            var panchayatIds = panchayatList.Select(p => p.PanchayatId).ToHashSet();

            var contacts = await _db.Contacts.AsNoTracking()
                .Where(c => !c.IsMerged && panchayatIds.Contains(c.PanchayatId))
                .ToListAsync(cancellationToken);
            var visits = await _db.Visits.AsNoTracking()
                .Where(v => panchayatIds.Contains(v.PanchayatId))
                .ToListAsync(cancellationToken);
            var contactClientIds = contacts.Select(c => c.ClientId).ToHashSet();
            var referrals = await _db.Referrals.AsNoTracking()
                .Where(r => contactClientIds.Contains(r.ContactId))
                .ToListAsync(cancellationToken);
            // Keyed by (District, Block), not Block alone — block names repeat
            // across districts (e.g. a "Sadar" block exists in most districts),
            // so a Block-only key was silently merging unrelated blocks' agent
            // counts together whenever their names collided.
            var agentCountsByBlock = await _db.Agents.AsNoTracking()
                .Where(a => district == null || a.District == district)
                .GroupBy(a => new { a.District, a.Block })
                .Select(g => new { g.Key.District, g.Key.Block, Count = g.Count() })
                .ToDictionaryAsync(x => (x.District, x.Block), x => x.Count, cancellationToken);

            var summary = new ReportSummaryDto
            {
                TotalContacts = contacts.Count,
                AshaWorkers = contacts.Count(c => c.Role == "asha_worker"),
                RmpDoctors = contacts.Count(c => c.Role == "rmp_doctor"),
                WardMembers = contacts.Count(c => c.Role == "ward_member"),
                MedicineShops = contacts.Count(c => c.Role == "medicine_shop"),
                // These two roles existed on every contact but were never
                // counted anywhere in this summary — the role pie chart's
                // slices silently added up to less than "Total Contacts"
                // whenever any mukhiya/prominent_person contacts existed.
                Mukhiyas = contacts.Count(c => c.Role == "mukhiya"),
                ProminentPersons = contacts.Count(c => c.Role == "prominent_person"),
                TotalVisits = visits.Count,
                TotalReferrals = referrals.Count,
                ConvertedReferrals = referrals.Count(r => r.Status == "converted"),
            };
            summary.ConversionRatePct = summary.TotalReferrals > 0
                ? System.Math.Round((double)summary.ConvertedReferrals / summary.TotalReferrals * 100, 1)
                : 0;

            summary.Blocks = panchayatList
                .GroupBy(p => new { p.District, p.Block })
                .Select(g =>
                {
                    var blockPanchayatIds = g.Select(p => p.PanchayatId).ToHashSet();
                    var blockContacts = contacts.Where(c => blockPanchayatIds.Contains(c.PanchayatId)).ToList();
                    var blockVisits = visits.Count(v => blockPanchayatIds.Contains(v.PanchayatId));
                    var blockContactIds = blockContacts.Select(c => c.ClientId).ToHashSet();
                    var blockReferrals = referrals.Where(r => blockContactIds.Contains(r.ContactId)).ToList();

                    return new BlockReportDto
                    {
                        District = g.Key.District,
                        Block = g.Key.Block,
                        Agents = agentCountsByBlock.GetValueOrDefault((g.Key.District, g.Key.Block)),
                        Asha = blockContacts.Count(c => c.Role == "asha_worker"),
                        Rmp = blockContacts.Count(c => c.Role == "rmp_doctor"),
                        Ward = blockContacts.Count(c => c.Role == "ward_member"),
                        Med = blockContacts.Count(c => c.Role == "medicine_shop"),
                        Mukhiya = blockContacts.Count(c => c.Role == "mukhiya"),
                        Prominent = blockContacts.Count(c => c.Role == "prominent_person"),
                        Visits = blockVisits,
                        Referrals = blockReferrals.Count,
                        Converted = blockReferrals.Count(r => r.Status == "converted"),
                    };
                })
                .OrderByDescending(b => b.Asha + b.Rmp + b.Ward + b.Med + b.Mukhiya + b.Prominent)
                .ToList();

            return Ok(summary);
        }
    }
}
