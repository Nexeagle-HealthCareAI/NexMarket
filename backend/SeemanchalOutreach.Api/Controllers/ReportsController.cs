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
        public int Lab { get; set; }
        public int NursingHome { get; set; }
        public int IndependentDoctor { get; set; }
        public int Hospital { get; set; }
        public int Other { get; set; }
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
        public int Labs { get; set; }
        public int NursingHomes { get; set; }
        public int IndependentDoctors { get; set; }
        public int Hospitals { get; set; }
        public int Others { get; set; }
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

            var contactStatsByPanchayat = await _db.Contacts.AsNoTracking()
                .Where(c => !c.IsMerged && panchayatIds.Contains(c.PanchayatId))
                .GroupBy(c => c.PanchayatId)
                .Select(g => new
                {
                    PanchayatId = g.Key,
                    TotalContacts = g.Count(),
                    AshaWorkers = g.Count(c => c.Role == "asha_worker"),
                    RmpDoctors = g.Count(c => c.Role == "rmp_doctor"),
                    WardMembers = g.Count(c => c.Role == "ward_member"),
                    MedicineShops = g.Count(c => c.Role == "medicine_shop"),
                    Mukhiyas = g.Count(c => c.Role == "mukhiya"),
                    ProminentPersons = g.Count(c => c.Role == "prominent_person"),
                    Labs = g.Count(c => c.Role == "lab"),
                    NursingHomes = g.Count(c => c.Role == "nursing_home"),
                    IndependentDoctors = g.Count(c => c.Role == "independent_doctor"),
                    Hospitals = g.Count(c => c.Role == "hospital"),
                    Others = g.Count(c => c.Role == "other")
                })
                .ToDictionaryAsync(x => x.PanchayatId, cancellationToken);

            var visitStatsByPanchayat = await _db.Visits.AsNoTracking()
                .Where(v => panchayatIds.Contains(v.PanchayatId))
                .GroupBy(v => v.PanchayatId)
                .Select(g => new
                {
                    PanchayatId = g.Key,
                    TotalVisits = g.Count()
                })
                .ToDictionaryAsync(x => x.PanchayatId, cancellationToken);

            var referralStatsByPanchayat = await _db.Referrals.AsNoTracking()
                .Join(_db.Contacts.AsNoTracking().Where(c => !c.IsMerged && panchayatIds.Contains(c.PanchayatId)),
                      r => r.ContactId,
                      c => c.ClientId,
                      (r, c) => new { c.PanchayatId, r.Status })
                .GroupBy(x => x.PanchayatId)
                .Select(g => new
                {
                    PanchayatId = g.Key,
                    TotalReferrals = g.Count(),
                    ConvertedReferrals = g.Count(x => x.Status == "converted")
                })
                .ToDictionaryAsync(x => x.PanchayatId, cancellationToken);

            var agentCountsByBlock = await _db.Agents.AsNoTracking()
                .Where(a => district == null || a.District == district)
                .GroupBy(a => new { a.District, a.Block })
                .Select(g => new { g.Key.District, g.Key.Block, Count = g.Count() })
                .ToDictionaryAsync(x => (x.District, x.Block), x => x.Count, cancellationToken);

            var summary = new ReportSummaryDto
            {
                TotalContacts = contactStatsByPanchayat.Values.Sum(x => x.TotalContacts),
                AshaWorkers = contactStatsByPanchayat.Values.Sum(x => x.AshaWorkers),
                RmpDoctors = contactStatsByPanchayat.Values.Sum(x => x.RmpDoctors),
                WardMembers = contactStatsByPanchayat.Values.Sum(x => x.WardMembers),
                MedicineShops = contactStatsByPanchayat.Values.Sum(x => x.MedicineShops),
                Mukhiyas = contactStatsByPanchayat.Values.Sum(x => x.Mukhiyas),
                ProminentPersons = contactStatsByPanchayat.Values.Sum(x => x.ProminentPersons),
                Labs = contactStatsByPanchayat.Values.Sum(x => x.Labs),
                NursingHomes = contactStatsByPanchayat.Values.Sum(x => x.NursingHomes),
                IndependentDoctors = contactStatsByPanchayat.Values.Sum(x => x.IndependentDoctors),
                Hospitals = contactStatsByPanchayat.Values.Sum(x => x.Hospitals),
                Others = contactStatsByPanchayat.Values.Sum(x => x.Others),
                TotalVisits = visitStatsByPanchayat.Values.Sum(x => x.TotalVisits),
                TotalReferrals = referralStatsByPanchayat.Values.Sum(x => x.TotalReferrals),
                ConvertedReferrals = referralStatsByPanchayat.Values.Sum(x => x.ConvertedReferrals),
            };
            summary.ConversionRatePct = summary.TotalReferrals > 0
                ? System.Math.Round((double)summary.ConvertedReferrals / summary.TotalReferrals * 100, 1)
                : 0;

            summary.Blocks = panchayatList
                .GroupBy(p => new { p.District, p.Block })
                .Select(g =>
                {
                    var blockPanchayats = g.Select(p => p.PanchayatId).ToList();
                    
                    int bContacts = blockPanchayats.Sum(p => contactStatsByPanchayat.GetValueOrDefault(p)?.TotalContacts ?? 0);
                    int bAsha = blockPanchayats.Sum(p => contactStatsByPanchayat.GetValueOrDefault(p)?.AshaWorkers ?? 0);
                    int bRmp = blockPanchayats.Sum(p => contactStatsByPanchayat.GetValueOrDefault(p)?.RmpDoctors ?? 0);
                    int bWard = blockPanchayats.Sum(p => contactStatsByPanchayat.GetValueOrDefault(p)?.WardMembers ?? 0);
                    int bMed = blockPanchayats.Sum(p => contactStatsByPanchayat.GetValueOrDefault(p)?.MedicineShops ?? 0);
                    int bMukhiya = blockPanchayats.Sum(p => contactStatsByPanchayat.GetValueOrDefault(p)?.Mukhiyas ?? 0);
                    int bProminent = blockPanchayats.Sum(p => contactStatsByPanchayat.GetValueOrDefault(p)?.ProminentPersons ?? 0);
                    int bLab = blockPanchayats.Sum(p => contactStatsByPanchayat.GetValueOrDefault(p)?.Labs ?? 0);
                    int bNursingHome = blockPanchayats.Sum(p => contactStatsByPanchayat.GetValueOrDefault(p)?.NursingHomes ?? 0);
                    int bIndDoc = blockPanchayats.Sum(p => contactStatsByPanchayat.GetValueOrDefault(p)?.IndependentDoctors ?? 0);
                    int bHospital = blockPanchayats.Sum(p => contactStatsByPanchayat.GetValueOrDefault(p)?.Hospitals ?? 0);
                    int bOther = blockPanchayats.Sum(p => contactStatsByPanchayat.GetValueOrDefault(p)?.Others ?? 0);
                    int bVisits = blockPanchayats.Sum(p => visitStatsByPanchayat.GetValueOrDefault(p)?.TotalVisits ?? 0);
                    int bReferrals = blockPanchayats.Sum(p => referralStatsByPanchayat.GetValueOrDefault(p)?.TotalReferrals ?? 0);
                    int bConverted = blockPanchayats.Sum(p => referralStatsByPanchayat.GetValueOrDefault(p)?.ConvertedReferrals ?? 0);

                    return new BlockReportDto
                    {
                        District = g.Key.District,
                        Block = g.Key.Block,
                        Agents = agentCountsByBlock.GetValueOrDefault((g.Key.District, g.Key.Block)),
                        Asha = bAsha,
                        Rmp = bRmp,
                        Ward = bWard,
                        Med = bMed,
                        Mukhiya = bMukhiya,
                        Prominent = bProminent,
                        Lab = bLab,
                        NursingHome = bNursingHome,
                        IndependentDoctor = bIndDoc,
                        Hospital = bHospital,
                        Other = bOther,
                        Visits = bVisits,
                        Referrals = bReferrals,
                        Converted = bConverted,
                    };
                })
                .OrderByDescending(b => b.Asha + b.Rmp + b.Ward + b.Med + b.Mukhiya + b.Prominent + b.Lab + b.NursingHome + b.IndependentDoctor + b.Hospital + b.Other)
                .ToList();

            return Ok(summary);
        }
    }
}
