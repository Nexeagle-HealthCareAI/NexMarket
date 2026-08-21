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
        // FollowUpDate == null is ambiguous between "field omitted" and "clear it" —
        // every other field on this DTO treats null as "don't touch," so FollowUpDate
        // needs its own explicit opt-in to clear rather than silently wiping it
        // whenever a caller's payload just doesn't happen to include it.
        public bool ClearFollowUpDate { get; set; } = false;
        public string? Comments { get; set; }
        public string? Relation { get; set; }
        public string? Complaints { get; set; }
        public string? Conflicts { get; set; }
        public string? PhotoUrl { get; set; }
        public string? Name { get; set; }
        public string? Phone { get; set; }
        public string? PanchayatId { get; set; }
        public bool? AgentEscalationResolved { get; set; }
        public string? AgentEscalationResolution { get; set; }
    }

    [ApiController]
    [Authorize(Roles = "Admin,admin")]
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
            [FromQuery] string? statuses = null,
            [FromQuery] DateTime? startDate = null,
            [FromQuery] DateTime? endDate = null,
            [FromQuery] DateTime? maxFollowUpDate = null,
            [FromQuery] DateTime? updatedAfter = null,
            [FromQuery] bool? agentEscalated = null,
            [FromQuery] string? search = null,
            [FromQuery] string? sortBy = null,
            [FromQuery] string? sortOrder = null,
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
            var statusList = ParseCsv(statuses);

            // Excludes merged duplicates — otherwise a contact an admin just merged
            // in the Duplicates tab keeps showing up here as a separate, live entry
            // (ReportsController already excludes these; this list didn't).
            IQueryable<OutreachContact> contactsQuery = _db.Contacts.AsNoTracking().Where(c => !c.IsMerged);

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

            if (statusList.Count > 0)
            {
                contactsQuery = contactsQuery.Where(c => statusList.Contains(c.Status));
            }

            if (startDate.HasValue)
            {
                contactsQuery = contactsQuery.Where(c => c.CreatedAt >= startDate.Value);
            }

            if (endDate.HasValue)
            {
                contactsQuery = contactsQuery.Where(c => c.CreatedAt <= endDate.Value);
            }

            if (maxFollowUpDate.HasValue)
            {
                contactsQuery = contactsQuery.Where(c => c.FollowUpDate == null || c.FollowUpDate <= maxFollowUpDate.Value);
            }

            if (updatedAfter.HasValue)
            {
                contactsQuery = contactsQuery.Where(c => c.CreatedAt >= updatedAfter.Value || _db.ContactHistory.Any(h => h.ContactClientId == c.ClientId && h.Timestamp >= updatedAfter.Value));
            }

            if (agentEscalated.HasValue && agentEscalated.Value)
            {
                contactsQuery = contactsQuery.Where(c => c.AgentEscalated);
            }

            if (!string.IsNullOrWhiteSpace(search))
            {
                var lowerSearch = search.ToLowerInvariant();
                contactsQuery = contactsQuery.Where(c => c.Name.ToLower().Contains(lowerSearch) || c.Phone.Contains(search));
            }

            var totalCount = await contactsQuery.CountAsync(cancellationToken);

            bool isDesc = string.Equals(sortOrder, "desc", StringComparison.OrdinalIgnoreCase);

            contactsQuery = sortBy?.ToLowerInvariant() switch
            {
                "name" => isDesc ? contactsQuery.OrderByDescending(c => c.Name) : contactsQuery.OrderBy(c => c.Name),
                "location" => isDesc ? contactsQuery.OrderByDescending(c => c.PanchayatId) : contactsQuery.OrderBy(c => c.PanchayatId),
                "status" => isDesc ? contactsQuery.OrderByDescending(c => c.Status) : contactsQuery.OrderBy(c => c.Status),
                "followupdate" => isDesc ? contactsQuery.OrderByDescending(c => c.FollowUpDate) : contactsQuery.OrderBy(c => c.FollowUpDate),
                "addedby" => isDesc ? contactsQuery.OrderByDescending(c => c.AgentId) : contactsQuery.OrderBy(c => c.AgentId),
                "comments" => isDesc ? contactsQuery.OrderByDescending(c => c.Comments) : contactsQuery.OrderBy(c => c.Comments),
                "complaints" => isDesc ? contactsQuery.OrderByDescending(c => c.Complaints) : contactsQuery.OrderBy(c => c.Complaints),
                "conflicts" => isDesc ? contactsQuery.OrderByDescending(c => c.Conflicts) : contactsQuery.OrderBy(c => c.Conflicts),
                "lastupdated" => isDesc ? contactsQuery.OrderByDescending(c => _db.ContactHistory.Where(h => h.ContactClientId == c.ClientId).Max(h => (DateTime?)h.Timestamp) ?? c.CreatedAt) : contactsQuery.OrderBy(c => _db.ContactHistory.Where(h => h.ContactClientId == c.ClientId).Max(h => (DateTime?)h.Timestamp) ?? c.CreatedAt),
                _ => isDesc ? contactsQuery.OrderByDescending(c => c.CreatedAt) : contactsQuery.OrderBy(c => c.CreatedAt)
            };

            var pageItems = await contactsQuery
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(c => new
                {
                    c.ClientId,
                    c.Name,
                    c.Phone,
                    c.Role,
                    c.Profession,
                    c.PanchayatId,
                    c.AgentId,
                    c.Latitude,
                    c.Longitude,
                    AgentName = _db.Agents.Where(a => a.AgentId == c.AgentId).Select(a => a.Name).FirstOrDefault(),
                    c.Status,
                    c.FollowUpDate,
                    c.Comments,
                    c.Relation,
                    c.Complaints,
                    c.Conflicts,
                    c.PhotoUrl,
                    c.AgentEscalated,
                    c.AgentEscalationNote,
                    c.IsEscalationResolved,
                    c.AgentEscalationResolution,
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
                c.Profession,
                c.PanchayatId,
                c.AgentId,
                c.Latitude,
                c.Longitude,
                c.AgentName,
                c.Status,
                c.FollowUpDate,
                c.Comments,
                c.Relation,
                c.Complaints,
                c.Conflicts,
                c.PhotoUrl,
                c.AgentEscalated,
                c.AgentEscalationNote,
                c.IsEscalationResolved,
                c.AgentEscalationResolution,
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
                    c.Profession,
                    c.PanchayatId,
                    c.AgentId,
                    c.Latitude,
                    c.Longitude,
                    c.Status,
                    c.FollowUpDate,
                    c.Comments,
                    c.Relation,
                    c.Complaints,
                    c.Conflicts,
                    c.PhotoUrl,
                    c.AgentEscalated,
                    c.AgentEscalationNote,
                    c.IsEscalationResolved,
                    c.AgentEscalationResolution,
                    c.CreatedAt,
                    Documents = _db.ContactDocuments
                        .Where(d => d.ContactClientId == c.ClientId)
                        .Select(d => new { d.Id, d.Url, d.MimeType, d.Label, d.CreatedAt })
                        .OrderBy(d => d.CreatedAt)
                        .ToList()
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
            var previousFollowUpDate = contact.FollowUpDate;
            var previousComplaints = contact.Complaints;
            var previousConflicts = contact.Conflicts;

            if (dto.Status != null) contact.Status = dto.Status;
            if (dto.ClearFollowUpDate) contact.FollowUpDate = null;
            else if (dto.FollowUpDate != null) contact.FollowUpDate = dto.FollowUpDate;
            if (dto.Comments != null) contact.Comments = dto.Comments;
            if (dto.Relation != null) contact.Relation = dto.Relation;
            if (dto.Complaints != null) contact.Complaints = dto.Complaints;
            if (dto.Conflicts != null) contact.Conflicts = dto.Conflicts;
            if (dto.PhotoUrl != null) contact.PhotoUrl = dto.PhotoUrl;
            if (dto.Name != null) contact.Name = dto.Name;
            if (dto.Phone != null) contact.Phone = dto.Phone;
            if (dto.PanchayatId != null) contact.PanchayatId = dto.PanchayatId;
            
            if (dto.AgentEscalationResolved == true)
            {
                contact.AgentEscalated = false;
                contact.IsEscalationResolved = true;
                if (dto.AgentEscalationResolution != null)
                {
                    contact.AgentEscalationResolution = dto.AgentEscalationResolution;
                }
            }

            if (previousStatus != contact.Status ||
                previousComments != contact.Comments ||
                previousFollowUpDate != contact.FollowUpDate ||
                previousComplaints != contact.Complaints ||
                previousConflicts != contact.Conflicts ||
                dto.AgentEscalationResolved == true)
            {
                // Marks this as the newest write to Status/FollowUpDate/Comments —
                // a stale queued sync from an agent's device that later arrives
                // claiming an older edit time than this will skip overwriting them.
                contact.LastModifiedAt = DateTime.UtcNow;

                _db.ContactHistory.Add(new ContactHistoryEntry
                {
                    ContactClientId = clientId,
                    UpdatedBy = User.FindFirst(ClaimTypes.Name)?.Value ?? User.FindFirst("agentId")?.Value ?? "Unknown",
                    PreviousStatus = previousStatus,
                    NewStatus = contact.Status,
                    Comments = dto.AgentEscalationResolved == true 
                        ? $"Escalation Resolved: {dto.AgentEscalationResolution}\n\n{contact.Comments}"
                        : contact.Comments,
                    FollowUpDate = contact.FollowUpDate,
                    Complaints = contact.Complaints,
                    Conflicts = contact.Conflicts
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
                contact.Conflicts,
                contact.PhotoUrl
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
                    h.Comments,
                    h.FollowUpDate,
                    h.Complaints,
                    h.Conflicts
                })
                .ToListAsync(cancellationToken);

            return Ok(history);
        }
        [HttpDelete("{clientId}")]
        public async Task<IActionResult> DeleteContact(string clientId, CancellationToken cancellationToken)
        {
            var contact = await _db.Contacts.FirstOrDefaultAsync(c => c.ClientId == clientId, cancellationToken);
            if (contact == null)
            {
                return NotFound();
            }

            // Manually cascade delete related history
            var history = await _db.ContactHistory.Where(h => h.ContactClientId == clientId).ToListAsync(cancellationToken);
            if (history.Any())
            {
                _db.ContactHistory.RemoveRange(history);
            }

            // Manually cascade delete related referrals
            var referrals = await _db.Referrals.Where(r => r.ContactId == clientId).ToListAsync(cancellationToken);
            if (referrals.Any())
            {
                _db.Referrals.RemoveRange(referrals);
            }

            // Manually cascade delete related documents
            var documents = await _db.ContactDocuments.Where(d => d.ContactClientId == clientId).ToListAsync(cancellationToken);
            if (documents.Any())
            {
                _db.ContactDocuments.RemoveRange(documents);
            }

            // Manually cascade delete related survey responses
            var surveys = await _db.SurveyResponses.Where(s => s.ContactId == clientId).ToListAsync(cancellationToken);
            if (surveys.Any())
            {
                _db.SurveyResponses.RemoveRange(surveys);
            }

            // Finally, delete the contact
            _db.Contacts.Remove(contact);
            await _db.SaveChangesAsync(cancellationToken);

            return NoContent();
        }
    }
}
