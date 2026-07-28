using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class ContactUpdateDto
    {
        public string? Status { get; set; }
        public DateTime? FollowUpDate { get; set; }
        public string? Comments { get; set; }
        public string? Relation { get; set; }
        public string? Complaints { get; set; }
        public string? Conflicts { get; set; }
    }

    [ApiController]
    [Authorize(Roles = "Admin")]
    [Route("api/v1/admin/[controller]")]
    public class ContactsController : ControllerBase
    {
        private readonly IMarketingDbContext _db;

        public ContactsController(IMarketingDbContext db)
        {
            _db = db;
        }

        [HttpGet]
        public async Task<IActionResult> GetAllContacts(
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 50,
            [FromQuery] string? districts = null,
            [FromQuery] string? blocks = null,
            [FromQuery] string? panchayats = null,
            CancellationToken cancellationToken = default)
        {
            page = Math.Max(page, 1);
            // Capped, not unbounded — a page this large is effectively "give me
            // everything matching the filters" for CSV export, without letting a
            // single request pull an unbounded number of rows as the table grows.
            pageSize = Math.Clamp(pageSize, 1, 2000);

            var districtList = ParseCsv(districts);
            var blockList = ParseCsv(blocks);
            var panchayatList = ParseCsv(panchayats);

            IQueryable<OutreachContact> contactsQuery = _db.Contacts.AsNoTracking();

            if (districtList.Count > 0 || blockList.Count > 0 || panchayatList.Count > 0)
            {
                var matchingPanchayatIds = await _db.Panchayats
                    .AsNoTracking()
                    .Where(p =>
                        (districtList.Count == 0 || districtList.Contains(p.District)) &&
                        (blockList.Count == 0 || blockList.Contains(p.Block)) &&
                        (panchayatList.Count == 0 || panchayatList.Contains(p.Name)))
                    .Select(p => p.PanchayatId)
                    .ToListAsync(cancellationToken);

                contactsQuery = contactsQuery.Where(c => matchingPanchayatIds.Contains(c.PanchayatId));
            }

            var totalCount = await contactsQuery.CountAsync(cancellationToken);

            var pageItems = await contactsQuery
                .OrderByDescending(c => c.CreatedAt)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(c => new
                {
                    c.ClientId,
                    c.Name,
                    c.Phone,
                    c.Role,
                    c.PanchayatId,
                    c.AgentId,
                    c.Status,
                    c.FollowUpDate,
                    c.Comments,
                    c.Relation,
                    c.Complaints,
                    c.Conflicts,
                    c.CreatedAt,
                    LastHistory = _db.ContactHistory
                        .Where(h => h.ContactClientId == c.ClientId)
                        .OrderByDescending(h => h.Timestamp)
                        .Select(h => new { h.Timestamp, h.UpdatedBy })
                        .FirstOrDefault()
                })
                .ToListAsync(cancellationToken);

            var items = pageItems.Select(c => new
            {
                c.ClientId,
                c.Name,
                c.Phone,
                c.Role,
                c.PanchayatId,
                c.AgentId,
                c.Status,
                c.FollowUpDate,
                c.Comments,
                c.Relation,
                c.Complaints,
                c.Conflicts,
                c.CreatedAt,
                LastUpdatedAt = c.LastHistory?.Timestamp,
                LastUpdatedBy = c.LastHistory?.UpdatedBy
            });

            return Ok(new { items, totalCount, page, pageSize });
        }

        private static List<string> ParseCsv(string? value) =>
            string.IsNullOrWhiteSpace(value)
                ? new List<string>()
                : value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();

        [HttpGet("{clientId}")]
        public async Task<IActionResult> GetContact(string clientId, CancellationToken cancellationToken)
        {
            var contact = await _db.Contacts
                .AsNoTracking()
                .Where(c => c.ClientId == clientId)
                .Select(c => new
                {
                    c.ClientId,
                    c.Name,
                    c.Phone,
                    c.Role,
                    c.PanchayatId,
                    c.AgentId,
                    c.Status,
                    c.FollowUpDate,
                    c.Comments,
                    c.Relation,
                    c.Complaints,
                    c.Conflicts,
                    c.CreatedAt
                })
                .FirstOrDefaultAsync(cancellationToken);

            if (contact == null)
            {
                return NotFound();
            }

            return Ok(contact);
        }

        [HttpPut("{clientId}")]
        public async Task<IActionResult> UpdateContact(string clientId, [FromBody] ContactUpdateDto dto, CancellationToken cancellationToken)
        {
            var contact = await _db.Contacts.FirstOrDefaultAsync(c => c.ClientId == clientId, cancellationToken);
            if (contact == null)
            {
                return NotFound();
            }

            var previousStatus = contact.Status;
            var previousComments = contact.Comments;

            if (dto.Status != null) contact.Status = dto.Status;
            contact.FollowUpDate = dto.FollowUpDate; // Can be null to clear
            if (dto.Comments != null) contact.Comments = dto.Comments;
            if (dto.Relation != null) contact.Relation = dto.Relation;
            if (dto.Complaints != null) contact.Complaints = dto.Complaints;
            if (dto.Conflicts != null) contact.Conflicts = dto.Conflicts;

            // Only log a history entry when status/comments actually changed — an
            // engagement-only save (relation/complaints/conflicts) shouldn't produce
            // a no-op "FollowUp -> FollowUp" entry in the follow-up audit trail.
            if (previousStatus != contact.Status || previousComments != contact.Comments)
            {
                _db.ContactHistory.Add(new ContactHistoryEntry
                {
                    ContactClientId = clientId,
                    UpdatedBy = User.FindFirst(ClaimTypes.Name)?.Value ?? User.FindFirst("agentId")?.Value ?? "Unknown",
                    PreviousStatus = previousStatus,
                    NewStatus = contact.Status,
                    Comments = contact.Comments
                });
            }

            await _db.SaveChangesAsync(cancellationToken);

            return Ok(new
            {
                contact.ClientId,
                contact.Status,
                contact.FollowUpDate,
                contact.Comments,
                contact.Relation,
                contact.Complaints,
                contact.Conflicts
            });
        }

        [HttpGet("{clientId}/history")]
        public async Task<IActionResult> GetHistory(string clientId, CancellationToken cancellationToken)
        {
            var history = await _db.ContactHistory
                .AsNoTracking()
                .Where(h => h.ContactClientId == clientId)
                .OrderBy(h => h.Timestamp)
                .Select(h => new
                {
                    h.Id,
                    h.Timestamp,
                    h.UpdatedBy,
                    h.PreviousStatus,
                    h.NewStatus,
                    h.Comments
                })
                .ToListAsync(cancellationToken);

            return Ok(history);
        }
    }
}
