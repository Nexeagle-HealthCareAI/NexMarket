using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SeemanchalOutreach.Api.Security;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace SeemanchalOutreach.Api.Controllers
{
    [ApiController]
    [Route("api/v1/[controller]")]
    [Authorize]
    [PageAccess(Pages.Pipeline, Pages.Desk)]
    public class ReferralsController : ControllerBase
    {
        private readonly IMarketingDbContext _context;
        private readonly ILiveEvents _live;

        public ReferralsController(IMarketingDbContext context, ILiveEvents live)
        {
            _context = context;
            _live = live;
        }

        /// <summary>Stages a referral moves through. "pending" = referred; "converted" is the old name for admitted.</summary>
        public static readonly string[] Stages = { "pending", "arrived", "opd", "admitted", "procedure", "discharged", "lost" };

        public static string StageLabel(string? status) => status switch
        {
            "pending" => "Referred",
            "arrived" => "Arrived",
            "opd" => "Seen in OPD",
            "admitted" or "converted" => "Admitted",
            "procedure" => "Procedure done",
            "discharged" => "Discharged",
            "lost" => "Did not come",
            _ => status ?? "",
        };

        public class UpdateReferralStatusDto
        {
            public string Status { get; set; } = string.Empty;
            public string? Notes { get; set; }
        }

        [HttpGet]
        public async Task<IActionResult> GetReferrals(
            [FromQuery] string? status,
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 50,
            [FromQuery] string? search = null,
            [FromQuery] string? department = null)
        {
            page = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize, 1, 1000);

            var query = _context.Referrals.AsNoTracking().AsQueryable();

            if (!string.IsNullOrEmpty(status))
            {
                var statuses = status.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
                if (statuses.Contains("admitted")) statuses.Add("converted");
                query = query.Where(r => statuses.Contains(r.Status));
            }

            if (!string.IsNullOrWhiteSpace(department))
            {
                query = query.Where(r => r.Department == department);
            }

            if (!string.IsNullOrWhiteSpace(search))
            {
                var searchLower = search.ToLower();
                query = query.Where(r => r.PatientName.ToLower().Contains(searchLower) || r.ClientPhone != null && r.ClientPhone.Contains(searchLower));
            }

            var totalCount = await query.CountAsync();

            var referrals = await query
                .OrderByDescending(r => r.ReferralDate ?? r.CreatedAt)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync();

            return Ok(new { TotalCount = totalCount, Items = await EnrichAsync(referrals) });
        }

        /// <summary>Front desk: find a referred patient by phone, name or referral code.</summary>
        [HttpGet("search")]
        public async Task<IActionResult> Search([FromQuery] string q)
        {
            if (string.IsNullOrWhiteSpace(q) || q.Trim().Length < 3) return Ok(Array.Empty<object>());
            var term = q.Trim().ToLower();
            var digits = new string(term.Where(char.IsDigit).ToArray());

            var query = _context.Referrals.AsNoTracking().Where(r =>
                r.PatientName.ToLower().Contains(term)
                || r.ClientId.ToLower().StartsWith(term)
                || (digits.Length >= 4 && r.ClientPhone != null && r.ClientPhone.Contains(digits)));

            var list = await query.OrderByDescending(r => r.CreatedAt).Take(20).ToListAsync();
            return Ok(await EnrichAsync(list));
        }

        /// <summary>Front desk: referrals from the last 7 days whose patient hasn't arrived yet.</summary>
        [HttpGet("expected")]
        public async Task<IActionResult> Expected()
        {
            var since = IstClock.TodayStartUtc.AddDays(-7);
            var list = await _context.Referrals.AsNoTracking()
                .Where(r => r.Status == "pending" && r.CreatedAt >= since)
                .OrderByDescending(r => r.Urgent).ThenBy(r => r.CreatedAt)
                .Take(50)
                .ToListAsync();
            var arrivedToday = await _context.Referrals.CountAsync(r => r.ArrivedAt >= IstClock.TodayStartUtc);
            return Ok(new { arrivedToday, items = await EnrichAsync(list) });
        }

        [HttpGet("{clientId}/history")]
        public async Task<IActionResult> History(string clientId)
        {
            var referral = await _context.Referrals.AsNoTracking().FirstOrDefaultAsync(r => r.ClientId == clientId);
            if (referral == null) return NotFound("Referral not found");

            var entries = await _context.ReferralStatusEntries.AsNoTracking()
                .Where(e => e.ReferralClientId == clientId)
                .OrderByDescending(e => e.ChangedAt)
                .ToListAsync();
            var names = await NamesAsync(entries.Select(e => e.ChangedBy).Append(referral.AgentId));

            var items = entries.Select(e => new
            {
                status = e.Status,
                label = StageLabel(e.Status),
                note = e.Note,
                by = names.GetValueOrDefault(e.ChangedBy, e.ChangedBy),
                at = e.ChangedAt,
            }).ToList<object>();
            items.Add(new
            {
                status = "pending",
                label = "Referred",
                note = (string?)null,
                by = names.GetValueOrDefault(referral.AgentId, referral.AgentId),
                at = referral.CreatedAt,
            });
            return Ok(items);
        }

        [HttpPut("{clientId}/status")]
        public async Task<IActionResult> UpdateStatus(string clientId, [FromBody] UpdateReferralStatusDto dto)
        {
            var status = (dto.Status ?? "").Trim().ToLowerInvariant();
            if (status == "converted") status = "admitted";
            if (status == "referred") status = "pending";
            if (!Stages.Contains(status)) return BadRequest("Unknown status.");

            var referral = await _context.Referrals.FirstOrDefaultAsync(r => r.ClientId == clientId);
            if (referral == null) return NotFound("Referral not found");

            var now = DateTime.UtcNow;
            referral.Status = status;
            if (status == "arrived" && referral.ArrivedAt == null) referral.ArrivedAt = now;
            if ((status == "opd" || status == "admitted" || status == "procedure" || status == "discharged") && referral.ArrivedAt == null) referral.ArrivedAt = now;
            if ((status == "admitted" || status == "procedure" || status == "discharged") && referral.AdmittedAt == null) referral.AdmittedAt = now;

            if (!string.IsNullOrEmpty(dto.Notes))
            {
                var prefix = string.IsNullOrEmpty(referral.Notes) ? "" : referral.Notes + "\n\n";
                referral.Notes = prefix + $"[Hospital - {IstClock.NowIst:yyyy-MM-dd}]: {dto.Notes}";
            }

            referral.UpdatedAt = now;

            _context.ReferralStatusEntries.Add(new ReferralStatusEntry
            {
                ReferralClientId = clientId,
                Status = status,
                Note = dto.Notes,
                ChangedBy = User.AgentIdOf(),
                ChangedAt = now,
            });

            await _context.SaveChangesAsync();

            string kind = status switch
            {
                "arrived" => "arrived",
                "opd" => "opd",
                "admitted" or "procedure" => "admit",
                "discharged" => "discharged",
                "lost" => "lost",
                _ => "referral",
            };
            string dept = string.IsNullOrWhiteSpace(referral.Department) ? "" : $" ({referral.Department})";
            await _live.PublishAsync(new LiveEvent
            {
                Kind = kind,
                Text = $"{referral.PatientName}{dept} marked {StageLabel(status).ToLower()}",
                RefId = clientId,
            });

            return Ok(new { message = "Status updated successfully" });
        }

        private async Task<Dictionary<string, string>> NamesAsync(IEnumerable<string> agentIds)
        {
            var ids = agentIds.Where(i => !string.IsNullOrEmpty(i)).Distinct().ToList();
            return await _context.Agents.AsNoTracking()
                .Where(a => ids.Contains(a.AgentId))
                .ToDictionaryAsync(a => a.AgentId, a => a.Name);
        }

        private async Task<List<object>> EnrichAsync(List<PatientReferral> referrals)
        {
            var agents = await NamesAsync(referrals.Select(r => r.AgentId));

            var contactIds = referrals.Select(r => r.ContactId).Distinct().ToList();
            var contacts = await _context.Contacts.AsNoTracking()
                .Where(c => contactIds.Contains(c.ClientId))
                .Select(c => new { c.ClientId, c.Name, c.Role, c.PanchayatId })
                .ToListAsync();
            var panchayatIds = contacts.Select(c => c.PanchayatId).Distinct().ToList();
            var blocks = await _context.Panchayats.AsNoTracking()
                .Where(p => panchayatIds.Contains(p.PanchayatId))
                .ToDictionaryAsync(p => p.PanchayatId, p => p.Block);
            var contactMap = contacts.ToDictionary(c => c.ClientId);

            return referrals.Select(r =>
            {
                contactMap.TryGetValue(r.ContactId, out var c);
                return (object)new
                {
                    r.Id,
                    r.ClientId,
                    r.ContactId,
                    ContactName = c?.Name ?? "Unknown contact",
                    ContactRole = c?.Role,
                    Block = c != null ? blocks.GetValueOrDefault(c.PanchayatId) : null,
                    r.AgentId,
                    AgentName = agents.GetValueOrDefault(r.AgentId, "Unknown agent"),
                    r.PatientName,
                    r.PatientAge,
                    r.PatientSex,
                    r.Urgent,
                    r.Department,
                    r.Notes,
                    r.ClientPhone,
                    r.ReferralDate,
                    Status = r.Status == "converted" ? "admitted" : r.Status,
                    StageLabel = StageLabel(r.Status),
                    r.ArrivedAt,
                    r.AdmittedAt,
                    r.CreatedAt,
                };
            }).ToList();
        }
    }
}
