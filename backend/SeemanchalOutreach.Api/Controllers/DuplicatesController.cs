using System;
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
    public class DuplicateRecordDto
    {
        public string ClientId { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string Role { get; set; } = string.Empty;
        public string? Phone { get; set; }
        public string AgentId { get; set; } = string.Empty;
        public string AgentName { get; set; } = string.Empty;
        public string PanchayatId { get; set; } = string.Empty;
        public string PanchayatName { get; set; } = string.Empty;
        public bool WhatsappAdded { get; set; }
        public bool CardGiven { get; set; }
        public string CreatedAt { get; set; } = string.Empty;
    }

    public class DuplicatePairDto
    {
        public string Id { get; set; } = string.Empty; // the flagged (candidate) contact's ClientId
        public DuplicateRecordDto RecordA { get; set; } = null!; // the original it was flagged against
        public DuplicateRecordDto RecordB { get; set; } = null!; // the flagged candidate
        public string Status { get; set; } = "pending"; // pending | merged | dismissed
    }

    [ApiController]
    [Authorize(Roles = "Admin,admin")]
    [Route("api/v1/[controller]")]
    public class DuplicatesController : ControllerBase
    {
        private readonly IMarketingDbContext _db;

        public DuplicatesController(IMarketingDbContext db)
        {
            _db = db;
        }

        [HttpGet]
        public async Task<ActionResult<List<DuplicatePairDto>>> GetDuplicates([FromQuery] string? status, CancellationToken cancellationToken)
        {
            var query = _db.Contacts.AsNoTracking()
                .Where(c => c.PotentialDuplicateOf != null && c.PotentialDuplicateOf != "");

            if (status == "pending")
            {
                query = query.Where(c => !c.IsMerged && c.DuplicateReviewedAt == null);
            }
            else if (status == "history")
            {
                query = query.Where(c => c.IsMerged || c.DuplicateReviewedAt != null)
                             .OrderByDescending(c => c.DuplicateReviewedAt ?? c.LastModifiedAt ?? c.CreatedAt)
                             .Take(100);
            }

            var flagged = await query.ToListAsync(cancellationToken);

            if (flagged.Count == 0) return Ok(new List<DuplicatePairDto>());

            var originalClientIds = flagged.Select(f => f.PotentialDuplicateOf!).Distinct().ToList();
            var originals = await _db.Contacts.AsNoTracking()
                .Where(c => originalClientIds.Contains(c.ClientId))
                .ToListAsync(cancellationToken);
            var originalsByClientId = originals.ToDictionary(c => c.ClientId);

            var agentIds = flagged.Select(f => f.AgentId).Concat(originals.Select(o => o.AgentId)).Distinct().ToList();
            var agentNames = await _db.Agents.AsNoTracking()
                .Where(a => agentIds.Contains(a.AgentId))
                .ToDictionaryAsync(a => a.AgentId, a => a.Name, cancellationToken);

            var panchayatIds = flagged.Select(f => f.PanchayatId).Concat(originals.Select(o => o.PanchayatId)).Distinct().ToList();
            var panchayatNames = await _db.Panchayats.AsNoTracking()
                .Where(p => panchayatIds.Contains(p.PanchayatId))
                .ToDictionaryAsync(p => p.PanchayatId, p => p.Name, cancellationToken);

            DuplicateRecordDto ToDto(Domain.Entities.OutreachContact c) => new()
            {
                ClientId = c.ClientId,
                Name = c.Name,
                Role = c.Role,
                Phone = c.Phone,
                AgentId = c.AgentId,
                AgentName = agentNames.GetValueOrDefault(c.AgentId, "Unknown"),
                PanchayatId = c.PanchayatId,
                PanchayatName = panchayatNames.GetValueOrDefault(c.PanchayatId, "Unknown"),
                WhatsappAdded = c.WhatsappAdded,
                CardGiven = c.CardGiven,
                CreatedAt = c.CreatedAt.ToString("o"),
            };

            var result = new List<DuplicatePairDto>();
            foreach (var candidate in flagged)
            {
                DuplicateRecordDto recordA;

                if (candidate.PotentialDuplicateOf == "in_batch_duplicate")
                {
                    recordA = new DuplicateRecordDto
                    {
                        ClientId = "in_batch_duplicate",
                        Name = "In-Batch Duplicate",
                        Role = candidate.Role,
                        Phone = candidate.Phone,
                        AgentId = candidate.AgentId,
                        AgentName = agentNames.GetValueOrDefault(candidate.AgentId, "Unknown"),
                        PanchayatId = candidate.PanchayatId,
                        PanchayatName = panchayatNames.GetValueOrDefault(candidate.PanchayatId, "Unknown"),
                        CreatedAt = candidate.CreatedAt.ToString("o")
                    };
                }
                else
                {
                    if (!originalsByClientId.TryGetValue(candidate.PotentialDuplicateOf!, out var original)) continue;
                    recordA = ToDto(original);
                }

                string currentStatus = candidate.IsMerged ? "merged"
                    : candidate.DuplicateReviewedAt != null ? "dismissed"
                    : "pending";

                result.Add(new DuplicatePairDto
                {
                    Id = candidate.ClientId,
                    RecordA = recordA,
                    RecordB = ToDto(candidate),
                    Status = currentStatus,
                });
            }

            return Ok(result);
        }

        [HttpPost("{clientId}/merge")]
        public async Task<IActionResult> Merge(string clientId, CancellationToken cancellationToken)
        {
            var contact = await _db.Contacts.FirstOrDefaultAsync(c => c.ClientId == clientId, cancellationToken);
            if (contact == null) return NotFound($"No contact with clientId '{clientId}'.");
            if (string.IsNullOrEmpty(contact.PotentialDuplicateOf))
            {
                return BadRequest("This contact was not flagged as a potential duplicate.");
            }

            contact.IsMerged = true;
            contact.MergedIntoClientId = contact.PotentialDuplicateOf;
            await _db.SaveChangesAsync(cancellationToken);

            return Ok(new { clientId, status = "merged", mergedIntoClientId = contact.MergedIntoClientId });
        }

        [HttpPost("{clientId}/dismiss")]
        public async Task<IActionResult> Dismiss(string clientId, CancellationToken cancellationToken)
        {
            var contact = await _db.Contacts.FirstOrDefaultAsync(c => c.ClientId == clientId, cancellationToken);
            if (contact == null) return NotFound($"No contact with clientId '{clientId}'.");
            if (string.IsNullOrEmpty(contact.PotentialDuplicateOf))
            {
                return BadRequest("This contact was not flagged as a potential duplicate.");
            }

            contact.DuplicateReviewedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(cancellationToken);

            return Ok(new { clientId, status = "dismissed" });
        }
    }
}
