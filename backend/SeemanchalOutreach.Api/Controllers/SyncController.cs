using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Hubs;
using SeemanchalOutreach.Application.Commands;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Controllers
{
    public class SyncPullRequestDto
    {
        public string AgentId { get; set; } = string.Empty;
        public string DeviceId { get; set; } = string.Empty;
        public DateTime Since { get; set; }
    }

    [ApiController]
    [Authorize]
    [Route("api/v1/[controller]")]
    public class SyncController : ControllerBase
    {
        private readonly IMediator _mediator;
        private readonly IPhotoUploadService _photoUploadService;
        private readonly IHubContext<LocationHub> _locationHub;
        private readonly IMarketingDbContext _db;

        public SyncController(IMediator mediator, IPhotoUploadService photoUploadService, IHubContext<LocationHub> locationHub, IMarketingDbContext db)
        {
            _mediator = mediator;
            _photoUploadService = photoUploadService;
            _locationHub = locationHub;
            _db = db;
        }

        [HttpPost("batch")]
        public async Task<ActionResult<SyncBatchResponse>> SyncBatch([FromBody] SyncBatchCommand command, CancellationToken cancellationToken)
        {
            if (command == null || command.Items == null)
            {
                return BadRequest("Invalid sync batch payload.");
            }

            // Never trust a client-supplied AgentId — every record this batch creates
            // (contacts, visits, shifts, referrals, trajectory points) gets attributed
            // to it, so a spoofed value would let one agent forge data under another
            // agent's identity. Always use the caller's own identity from the JWT.
            var callerAgentId = User.FindFirst("agentId")?.Value;
            if (string.IsNullOrEmpty(callerAgentId)) return Unauthorized();
            command.AgentId = callerAgentId;

            var response = await _mediator.Send(command, cancellationToken);

            int syncedCount = response.Results.Count(r => r.Status == "created" || r.Status == "already_exists");

            // Notify real-time admin dashboard if any items processed successfully
            if (syncedCount > 0)
            {
                await _locationHub.Clients.All.SendAsync("ReceiveSyncNotification", new
                {
                    AgentId = command.AgentId,
                    DeviceId = command.DeviceId,
                    SyncedCount = syncedCount,
                    DuplicateFlags = response.DuplicateWarnings.Count
                }, cancellationToken);
            }

            return Ok(response);
        }

        private static readonly string[] AllowedPhotoContentTypes = { "image/jpeg", "image/png", "image/webp" };
        private const long MaxPhotoBytes = 10 * 1024 * 1024; // 10 MB

        [HttpPost("photo")]
        public async Task<ActionResult<object>> UploadPhoto([FromForm] IFormFile file, CancellationToken cancellationToken)
        {
            if (file == null || file.Length == 0)
            {
                return BadRequest("No photo file uploaded.");
            }
            if (file.Length > MaxPhotoBytes)
            {
                return BadRequest($"Photo exceeds the {MaxPhotoBytes / (1024 * 1024)}MB limit.");
            }
            if (!AllowedPhotoContentTypes.Contains(file.ContentType))
            {
                return BadRequest($"Unsupported content type '{file.ContentType}'. Allowed: {string.Join(", ", AllowedPhotoContentTypes)}.");
            }

            using var stream = file.OpenReadStream();
            string url = await _photoUploadService.UploadPhotoAsync(file.FileName, stream, file.ContentType, cancellationToken);

            return Ok(new { url, fileName = file.FileName });
        }

        [HttpPost("pull")]
        public async Task<ActionResult<object>> Pull([FromBody] SyncPullRequestDto request, CancellationToken cancellationToken)
        {
            // Never trust a client-supplied AgentId here either — it would let any
            // authenticated agent read another agent's contacts/visits/GPS trajectory
            // (all PII) just by naming their ID, which is trivially guessable
            // (sequential, e.g. "MKT-1001", "MKT-1002", ...). Always scope to the
            // caller's own identity from the JWT.
            var callerAgentId = User.FindFirst("agentId")?.Value;
            if (string.IsNullOrEmpty(callerAgentId)) return Unauthorized();
            request.AgentId = callerAgentId;

            var contacts = await _db.Contacts.AsNoTracking()
                .Where(c => c.AgentId == request.AgentId && c.ServerReceivedAt >= request.Since)
                .ToListAsync(cancellationToken);
            var visits = await _db.Visits.AsNoTracking()
                .Where(v => v.AgentId == request.AgentId && v.ServerReceivedAt >= request.Since)
                .ToListAsync(cancellationToken);
            var shifts = await _db.Shifts.AsNoTracking()
                .Where(s => s.AgentId == request.AgentId && s.ServerReceivedAt >= request.Since)
                .ToListAsync(cancellationToken);
            var contactClientIds = contacts.Select(c => c.ClientId).ToList();
            var referrals = await _db.Referrals.AsNoTracking()
                .Where(r => r.AgentId == request.AgentId && r.ServerReceivedAt >= request.Since)
                .ToListAsync(cancellationToken);
            var panchayats = await _db.Panchayats.AsNoTracking().ToListAsync(cancellationToken);

            return Ok(new
            {
                contacts = contacts.Select(c => new
                {
                    clientId = c.ClientId,
                    deviceId = c.DeviceId,
                    agentId = c.AgentId,
                    panchayatId = c.PanchayatId,
                    role = c.Role,
                    name = c.Name,
                    phone = c.Phone,
                    whatsappAdded = c.WhatsappAdded,
                    cardGiven = c.CardGiven,
                    createdAt = c.CreatedAt.ToString("o"),
                    updatedAt = c.CreatedAt.ToString("o"),
                    potentialDuplicateOf = c.PotentialDuplicateOf,
                }),
                visits = visits.Select(v => new
                {
                    clientId = v.ClientId,
                    deviceId = v.DeviceId,
                    agentId = v.AgentId,
                    panchayatId = v.PanchayatId,
                    checkInAt = v.CheckInAt.ToString("o"),
                    checkInLat = v.CheckInLat,
                    checkInLng = v.CheckInLng,
                    checkOutAt = v.CheckOutAt?.ToString("o"),
                    checkOutLat = v.CheckOutLat,
                    checkOutLng = v.CheckOutLng,
                }),
                shifts = shifts.Select(s => new
                {
                    clientId = s.ClientId,
                    deviceId = s.DeviceId,
                    agentId = s.AgentId,
                    startAt = s.StartTime.ToString("o"),
                    endAt = s.EndTime?.ToString("o"),
                }),
                referrals = referrals.Select(r => new
                {
                    clientId = r.ClientId,
                    deviceId = r.DeviceId,
                    contactId = r.ContactId,
                    referralDate = r.CreatedAt.ToString("yyyy-MM-dd"),
                    status = r.Status,
                    notes = r.Notes,
                    createdAt = r.CreatedAt.ToString("o"),
                }),
                panchayats = panchayats.Select(p => new
                {
                    id = p.PanchayatId,
                    lgdCode = p.LgdCode,
                    name = p.Name,
                    block = p.Block,
                    district = p.District,
                    state = p.State,
                    centroidLat = p.CentroidLat,
                    centroidLng = p.CentroidLng,
                }),
                surveys = (await _db.SurveyResponses.AsNoTracking()
                    .Where(s => s.AgentId == request.AgentId && s.SyncedAt >= request.Since)
                    .ToListAsync(cancellationToken))
                    .Select(s => new
                    {
                        clientId = s.ClientId,
                        deviceId = s.DeviceId,
                        agentId = s.AgentId,
                        contactId = s.ContactId,
                        panchayatId = s.PanchayatId,
                        answersJson = s.AnswersJson,
                        createdAt = s.CreatedAt.ToString("o")
                    })
            });
        }
    }
}
