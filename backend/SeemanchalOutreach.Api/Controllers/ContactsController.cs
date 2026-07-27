using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Controllers
{
    public class ContactUpdateDto
    {
        public string? Status { get; set; }
        public DateTime? FollowUpDate { get; set; }
        public string? Comments { get; set; }
    }

    [ApiController]
    [Authorize] // Assume hospital rep has access
    [Route("api/v1/admin/[controller]")]
    public class ContactsController : ControllerBase
    {
        private readonly IMarketingDbContext _db;

        public ContactsController(IMarketingDbContext db)
        {
            _db = db;
        }

        [HttpGet]
        public async Task<IActionResult> GetAllContacts(CancellationToken cancellationToken)
        {
            var contacts = await _db.Contacts
                .AsNoTracking()
                .OrderByDescending(c => c.CreatedAt)
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
                    c.CreatedAt
                })
                .ToListAsync(cancellationToken);

            return Ok(contacts);
        }

        [HttpPut("{clientId}")]
        public async Task<IActionResult> UpdateContact(string clientId, [FromBody] ContactUpdateDto dto, CancellationToken cancellationToken)
        {
            var contact = await _db.Contacts.FirstOrDefaultAsync(c => c.ClientId == clientId, cancellationToken);
            if (contact == null)
            {
                return NotFound();
            }

            if (dto.Status != null) contact.Status = dto.Status;
            contact.FollowUpDate = dto.FollowUpDate; // Can be null to clear
            if (dto.Comments != null) contact.Comments = dto.Comments;

            await _db.SaveChangesAsync(cancellationToken);

            return Ok(new
            {
                contact.ClientId,
                contact.Status,
                contact.FollowUpDate,
                contact.Comments
            });
        }
    }
}
