using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;
using System;
using System.Linq;
using System.Threading.Tasks;

namespace SeemanchalOutreach.Api.Controllers
{
    [ApiController]
    [Route("api/v1/[controller]")]
    [Authorize(Roles = "Admin,admin")]
    public class ReferralsController : ControllerBase
    {
        private readonly IMarketingDbContext _context;

        public ReferralsController(IMarketingDbContext context)
        {
            _context = context;
        }

        public class UpdateReferralStatusDto
        {
            public string Status { get; set; } = string.Empty;
            public string? Notes { get; set; }
        }

        [HttpGet]
        public async Task<IActionResult> GetReferrals([FromQuery] string? status)
        {
            var query = _context.Referrals.AsNoTracking().AsQueryable();

            if (!string.IsNullOrEmpty(status))
            {
                query = query.Where(r => r.Status == status);
            }

            var referrals = await query
                .OrderByDescending(r => r.ReferralDate ?? r.CreatedAt)
                .Select(r => new
                {
                    r.Id,
                    r.ClientId,
                    r.ContactId,
                    r.AgentId,
                    r.PatientName,
                    r.Department,
                    r.Notes,
                    r.ClientPhone,
                    r.ReferralDate,
                    r.Status,
                    r.CreatedAt
                })
                .ToListAsync();

            // Enrich with Agent and Contact info
            var agentIds = referrals.Select(r => r.AgentId).Distinct().ToList();
            var agents = await _context.Agents.AsNoTracking()
                .Where(a => agentIds.Contains(a.AgentId))
                .ToDictionaryAsync(a => a.AgentId, a => new { a.FirstName, a.LastName });

            var contactIds = referrals.Select(r => r.ContactId).Distinct().ToList();
            var contacts = await _context.Contacts.AsNoTracking()
                .Where(c => contactIds.Contains(c.ClientId))
                .ToDictionaryAsync(c => c.ClientId, c => c.Name);

            var result = referrals.Select(r => new
            {
                r.Id,
                r.ClientId,
                r.ContactId,
                ContactName = contacts.GetValueOrDefault(r.ContactId, "Unknown Contact"),
                r.AgentId,
                AgentName = agents.TryGetValue(r.AgentId, out var agent) ? $"{agent.FirstName} {agent.LastName}" : "Unknown Agent",
                r.PatientName,
                r.Department,
                r.Notes,
                r.ClientPhone,
                r.ReferralDate,
                r.Status,
                r.CreatedAt
            });

            return Ok(result);
        }

        [HttpPut("{clientId}/status")]
        public async Task<IActionResult> UpdateStatus(string clientId, [FromBody] UpdateReferralStatusDto dto)
        {
            var referral = await _context.Referrals.FirstOrDefaultAsync(r => r.ClientId == clientId);
            if (referral == null) return NotFound("Referral not found");

            referral.Status = dto.Status;
            
            // If they are appending notes, we can add it
            if (!string.IsNullOrEmpty(dto.Notes))
            {
                var prefix = string.IsNullOrEmpty(referral.Notes) ? "" : referral.Notes + "\n\n";
                referral.Notes = prefix + $"[Hospital Admin - {DateTime.UtcNow:yyyy-MM-dd}]: {dto.Notes}";
            }

            referral.UpdatedAt = DateTime.UtcNow;

            await _context.SaveChangesAsync();

            return Ok(new { message = "Status updated successfully" });
        }
    }
}
