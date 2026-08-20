using System;
using System.Collections.Generic;
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
        public int Page { get; set; } = 1;
        public int PageSize { get; set; } = 500;
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

            var skip = (request.Page - 1) * request.PageSize;
            var take = request.PageSize;

            var contacts = await _db.Contacts.AsNoTracking()
                .Where(c => c.AgentId == request.AgentId && c.ServerReceivedAt >= request.Since)
                .OrderBy(c => c.Id)
                .Skip(skip).Take(take)
                .ToListAsync(cancellationToken);
            var visits = await _db.Visits.AsNoTracking()
                .Where(v => v.AgentId == request.AgentId && v.ServerReceivedAt >= request.Since)
                .OrderBy(v => v.Id)
                .Skip(skip).Take(take)
                .ToListAsync(cancellationToken);
            var shifts = await _db.Shifts.AsNoTracking()
                .Where(s => s.AgentId == request.AgentId && s.ServerReceivedAt >= request.Since)
                .OrderBy(s => s.Id)
                .Skip(skip).Take(take)
                .ToListAsync(cancellationToken);
            var referrals = await _db.Referrals.AsNoTracking()
                .Where(r => r.AgentId == request.AgentId && r.ServerReceivedAt >= request.Since)
                .OrderBy(r => r.Id)
                .Skip(skip).Take(take)
                .ToListAsync(cancellationToken);
            var panchayats = await _db.Panchayats.AsNoTracking()
                .OrderBy(p => p.PanchayatId)
                .Skip(skip).Take(take)
                .ToListAsync(cancellationToken);
            var surveys = await _db.SurveyResponses.AsNoTracking()
                .Where(s => s.AgentId == request.AgentId && s.SyncedAt >= request.Since)
                .OrderBy(s => s.Id)
                .Skip(skip).Take(take)
                .ToListAsync(cancellationToken);
            var surveyQuestions = await _db.SurveyQuestions.AsNoTracking()
                .Where(q => q.CreatedAt >= request.Since || q.IsActive == true)
                .OrderBy(q => q.Id)
                .Skip(skip).Take(take)
                .ToListAsync(cancellationToken);
                
            bool hasMore = contacts.Count == take || visits.Count == take || shifts.Count == take || referrals.Count == take || panchayats.Count == take || surveys.Count == take || surveyQuestions.Count == take;

            return Ok(new
            {
                hasMore,
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
                surveys = surveys.Select(s => new
                    {
                        clientId = s.ClientId,
                        deviceId = s.DeviceId,
                        agentId = s.AgentId,
                        contactId = s.ContactId,
                        panchayatId = s.PanchayatId,
                        answersJson = s.AnswersJson,
                        createdAt = s.CreatedAt.ToString("o")
                    }),
                surveyQuestions = surveyQuestions.Select(q => new
                    {
                        id = q.Id.ToString(),
                        questionId = q.QuestionId,
                        text = q.Text,
                        type = q.Type,
                        optionsJson = q.OptionsJson,
                        section = q.Section,
                        isOptional = q.IsOptional,
                        isActive = q.IsActive,
                        order = q.Order
                    })
            });
        }

        // Panchayats and the questionnaire are reference data every agent device
        // needs to stay current — but Pull (above) only ever runs once, at first
        // login on an empty local DB. An admin adding a panchayat or a survey
        // question (or deactivating one) previously never reached a device that
        // was already set up, since nothing re-fetched this after that first pull.
        // Cheap enough (bounded reference tables, not per-agent transactional data)
        // to call this on every login and periodically while the app is open.
        [HttpGet("reference-data")]
        public async Task<ActionResult<object>> GetReferenceData(CancellationToken cancellationToken)
        {
            var panchayats = await _db.Panchayats.AsNoTracking().ToListAsync(cancellationToken);
            var questions = await _db.SurveyQuestions.AsNoTracking().Where(q => q.IsActive).ToListAsync(cancellationToken);

            return Ok(new
            {
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
                surveyQuestions = questions.Select(q => new
                {
                    id = q.Id.ToString(),
                    questionId = q.QuestionId,
                    text = q.Text,
                    type = q.Type,
                    optionsJson = q.OptionsJson,
                    section = q.Section,
                    isOptional = q.IsOptional,
                    isActive = q.IsActive,
                    order = q.Order
                })
            });
        }

        // The admin Sync Analytics page used to render entirely hardcoded/fake
        // numbers (a literal "Mock Sync Data" array) that never reflected real
        // activity. Everything here is computed from actual synced records —
        // there's no server-side concept of "items still queued on a device"
        // or "failed sync attempts" (those only ever exist client-side, before
        // or if a sync never reaches the server), so this reports what the
        // server actually can know: throughput and how long data sat on a
        // device before it synced.
        [HttpGet("analytics")]
        [Authorize(Roles = "Admin")]
        public async Task<ActionResult<object>> GetSyncAnalytics(CancellationToken cancellationToken)
        {
            var todayUtc = DateTime.UtcNow.Date;
            var weekStartUtc = todayUtc.AddDays(-6);

            var contacts = await _db.Contacts.AsNoTracking()
                .Where(c => c.ServerReceivedAt >= weekStartUtc)
                .Select(c => new { c.AgentId, Client = c.CreatedAt, Server = c.ServerReceivedAt })
                .ToListAsync(cancellationToken);
            var visits = await _db.Visits.AsNoTracking()
                .Where(v => v.ServerReceivedAt >= weekStartUtc)
                .Select(v => new { v.AgentId, Client = v.CheckInAt, Server = v.ServerReceivedAt })
                .ToListAsync(cancellationToken);
            var referrals = await _db.Referrals.AsNoTracking()
                .Where(r => r.ServerReceivedAt >= weekStartUtc)
                .Select(r => new { r.AgentId, Client = r.CreatedAt, Server = r.ServerReceivedAt })
                .ToListAsync(cancellationToken);

            // Kept to the same 3 record types as the throughput chart below —
            // a KPI total that counts more than the chart it sits next to
            // breaks down exactly like the report-summary role/total mismatch
            // this same pass fixed elsewhere.
            var allRecords = contacts.Select(c => (c.AgentId, c.Client, c.Server))
                .Concat(visits.Select(v => (v.AgentId, v.Client, v.Server)))
                .Concat(referrals.Select(r => (r.AgentId, r.Client, r.Server)))
                .ToList();

            var todayRecords = allRecords.Where(r => r.Server >= todayUtc).ToList();

            double AvgDelayMinutes(IEnumerable<(string AgentId, DateTime Client, DateTime Server)> records)
            {
                var list = records.ToList();
                if (list.Count == 0) return 0;
                return Math.Round(list.Average(r => (r.Server - r.Client).TotalMinutes), 1);
            }

            var currentHour = DateTime.UtcNow.Hour;
            var hourlyBreakdown = Enumerable.Range(0, currentHour + 1).Select(hour =>
            {
                var hourStart = todayUtc.AddHours(hour);
                var hourEnd = hourStart.AddHours(1);
                bool InHour(DateTime t) => t >= hourStart && t < hourEnd;

                return new
                {
                    Hour = hourStart.ToString("HH:00"),
                    Contacts = contacts.Count(c => InHour(c.Server)),
                    Visits = visits.Count(v => InHour(v.Server)),
                    Referrals = referrals.Count(r => InHour(r.Server)),
                    AvgDelayMinutes = AvgDelayMinutes(todayRecords.Where(r => InHour(r.Server))),
                };
            }).ToList();

            return Ok(new
            {
                recordsSyncedToday = todayRecords.Count,
                activeOfficersToday = todayRecords.Select(r => r.AgentId).Distinct().Count(),
                avgSyncDelayMinutesToday = AvgDelayMinutes(todayRecords),
                recordsSyncedThisWeek = allRecords.Count,
                hourlyBreakdown,
            });
        }
    }
}
