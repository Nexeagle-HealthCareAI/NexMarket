using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class OnboardAgentRequest
    {
        [Required, MinLength(2), MaxLength(80)]
        public string Name { get; set; } = string.Empty;

        [Required, RegularExpression(@"^[0-9]{10}$", ErrorMessage = "Phone must be exactly 10 digits.")]
        public string Phone { get; set; } = string.Empty;

        [Required, MaxLength(50)]
        public string Role { get; set; } = string.Empty;

        [Required, MaxLength(50)]
        public string District { get; set; } = string.Empty;

        [Required, MaxLength(50)]
        public string Block { get; set; } = string.Empty;
    }

    public class AgentSummaryDto
    {
        public string AgentId { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string Phone { get; set; } = string.Empty;
        public string Role { get; set; } = string.Empty;
        public string District { get; set; } = string.Empty;
        public string Block { get; set; } = string.Empty;
        public bool IsActive { get; set; }
        public string Status { get; set; } = "offline"; // online | low-connectivity | offline
        public bool ActiveShift { get; set; }
        public double? LastSeenLat { get; set; }
        public double? LastSeenLng { get; set; }
        public string? LastSeenAt { get; set; }
        public int TodayContacts { get; set; }
        public int TodayVisits { get; set; }
        public int TodayReferrals { get; set; }
    }

    [ApiController]
    [Authorize]
    [Route("api/v1/[controller]")]
    public class AgentsController : ControllerBase
    {
        private readonly IMarketingDbContext _db;

        public AgentsController(IMarketingDbContext db)
        {
            _db = db;
        }

        [HttpGet]
        public async Task<ActionResult<List<AgentSummaryDto>>> GetAgents(CancellationToken cancellationToken)
        {
            var agents = await _db.Agents.AsNoTracking().OrderBy(a => a.Name).ToListAsync(cancellationToken);
            if (agents.Count == 0) return Ok(new List<AgentSummaryDto>());

            var agentIds = agents.Select(a => a.AgentId).ToList();
            var todayUtc = DateTime.UtcNow.Date;

            var activeShiftAgentIds = await _db.Shifts.AsNoTracking()
                .Where(s => agentIds.Contains(s.AgentId) && s.EndTime == null)
                .Select(s => s.AgentId)
                .Distinct()
                .ToListAsync(cancellationToken);

            var lastTrajectoryByAgent = await _db.TrajectoryPoints.AsNoTracking()
                .Where(t => agentIds.Contains(t.AgentId))
                .GroupBy(t => t.AgentId)
                .Select(g => g.OrderByDescending(t => t.RecordedAt).First())
                .ToListAsync(cancellationToken);
            var lastTrajectoryMap = lastTrajectoryByAgent.ToDictionary(t => t.AgentId);

            var todayContactCounts = await _db.Contacts.AsNoTracking()
                .Where(c => agentIds.Contains(c.AgentId) && c.CreatedAt >= todayUtc)
                .GroupBy(c => c.AgentId)
                .Select(g => new { AgentId = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.AgentId, x => x.Count, cancellationToken);

            var todayVisitCounts = await _db.Visits.AsNoTracking()
                .Where(v => agentIds.Contains(v.AgentId) && v.CheckInAt >= todayUtc)
                .GroupBy(v => v.AgentId)
                .Select(g => new { AgentId = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.AgentId, x => x.Count, cancellationToken);

            var todayReferralCounts = await _db.Referrals.AsNoTracking()
                .Where(r => agentIds.Contains(r.AgentId) && r.CreatedAt >= todayUtc)
                .GroupBy(r => r.AgentId)
                .Select(g => new { AgentId = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.AgentId, x => x.Count, cancellationToken);

            var activeShiftSet = activeShiftAgentIds.ToHashSet();
            var now = DateTime.UtcNow;

            var result = agents.Select(a =>
            {
                var hasActiveShift = activeShiftSet.Contains(a.AgentId);
                lastTrajectoryMap.TryGetValue(a.AgentId, out var lastPoint);
                var minutesSinceActivity = lastPoint != null ? (now - lastPoint.RecordedAt).TotalMinutes : (double?)null;

                // "online" / "low-connectivity" / "offline" are derived from recency of GPS
                // sync while on an active shift — there is no separate presence/heartbeat
                // system, so this is the best real signal available.
                string status = "offline";
                if (hasActiveShift && minutesSinceActivity is not null)
                {
                    if (minutesSinceActivity <= 5) status = "online";
                    else if (minutesSinceActivity <= 30) status = "low-connectivity";
                }

                return new AgentSummaryDto
                {
                    AgentId = a.AgentId,
                    Name = a.Name,
                    Phone = a.Phone,
                    Role = a.Role,
                    District = a.District,
                    Block = a.Block,
                    IsActive = a.IsActive,
                    Status = status,
                    ActiveShift = hasActiveShift,
                    LastSeenLat = lastPoint?.Lat,
                    LastSeenLng = lastPoint?.Lng,
                    LastSeenAt = lastPoint?.RecordedAt.ToString("o"),
                    TodayContacts = todayContactCounts.GetValueOrDefault(a.AgentId),
                    TodayVisits = todayVisitCounts.GetValueOrDefault(a.AgentId),
                    TodayReferrals = todayReferralCounts.GetValueOrDefault(a.AgentId),
                };
            }).ToList();

            return Ok(result);
        }

        [HttpGet("{agentId}/trajectory")]
        public async Task<ActionResult<object>> GetTrajectory(string agentId, [FromQuery] DateOnly? date, CancellationToken cancellationToken)
        {
            var day = date ?? DateOnly.FromDateTime(DateTime.UtcNow);
            var start = day.ToDateTime(TimeOnly.MinValue);
            var end = start.AddDays(1);

            var points = await _db.TrajectoryPoints.AsNoTracking()
                .Where(t => t.AgentId == agentId && t.RecordedAt >= start && t.RecordedAt < end)
                .OrderBy(t => t.RecordedAt)
                .Select(t => new { t.Lat, t.Lng, t.RecordedAt, t.AccuracyM })
                .ToListAsync(cancellationToken);

            return Ok(points);
        }

        /// <summary>
        /// Onboards a new field agent with a real, randomly generated password (BCrypt-hashed,
        /// returned in the response exactly once — it is never stored or retrievable again).
        /// Always requires a valid JWT — the seeded default Admin account (AdminSeeder) means
        /// there is always a real login available, so no anonymous bootstrap path is needed.
        /// </summary>
        [HttpPost]
        public async Task<ActionResult<object>> Onboard([FromBody] OnboardAgentRequest request, CancellationToken cancellationToken)
        {
            if (!ModelState.IsValid) return ValidationProblem(ModelState);

            if (await _db.Agents.AnyAsync(a => a.Phone == request.Phone, cancellationToken))
            {
                return Conflict($"An agent with phone number {request.Phone} already exists.");
            }

            string prefix = request.Role.Trim().ToLowerInvariant() switch
            {
                "admin" => "ADM",
                "field officer" => "FLD",
                "marketing executive" => "MKT",
                "regional representative" => "REG",
                _ => "AGT",
            };

            var existingNumbers = await _db.Agents.AsNoTracking()
                .Where(a => a.AgentId.StartsWith(prefix + "-"))
                .Select(a => a.AgentId)
                .ToListAsync(cancellationToken);
            int nextNumber = existingNumbers
                .Select(id => int.TryParse(id.Split('-').LastOrDefault(), out var n) ? n : 0)
                .DefaultIfEmpty(1000)
                .Max() + 1;
            string agentId = $"{prefix}-{nextNumber}";

            string password = GenerateRandomPassword();

            var agent = new FieldAgent
            {
                Id = Guid.NewGuid(),
                AgentId = agentId,
                Name = request.Name.Trim(),
                Phone = request.Phone,
                Role = request.Role.Trim(),
                District = request.District.Trim(),
                Block = request.Block.Trim(),
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
                MustChangePassword = true,
                IsActive = true,
            };

            _db.Agents.Add(agent);
            await _db.SaveChangesAsync(cancellationToken);

            return Ok(new
            {
                agentId = agent.AgentId,
                name = agent.Name,
                role = agent.Role,
                district = agent.District,
                block = agent.Block,
                password, // shown once — caller is responsible for delivering it securely
            });
        }

        private static string GenerateRandomPassword()
        {
            const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
            var bytes = System.Security.Cryptography.RandomNumberGenerator.GetBytes(12);
            var sb = new System.Text.StringBuilder(12);
            foreach (var b in bytes) sb.Append(chars[b % chars.Length]);
            return sb.ToString();
        }

        public class CompleteProfileDto
        {
            public string? PhotoUrl { get; set; }
            public string? Education { get; set; }
            public string? PersonalDetails { get; set; }
        }

        [HttpPut("{agentId}/onboarding")]
        [Authorize]
        public async Task<IActionResult> CompleteProfile(string agentId, [FromBody] CompleteProfileDto dto, CancellationToken cancellationToken)
        {
            // Only allow the agent themselves to update their own profile, or an admin
            var currentAgentId = User.FindFirst("agentId")?.Value;
            var role = User.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value;

            if (currentAgentId != agentId && role != "admin")
            {
                return Forbid();
            }

            var agent = await _db.Agents.FirstOrDefaultAsync(a => a.AgentId == agentId, cancellationToken);
            if (agent == null) return NotFound();

            if (!string.IsNullOrEmpty(dto.PhotoUrl)) agent.PhotoUrl = dto.PhotoUrl;
            if (!string.IsNullOrEmpty(dto.Education)) agent.Education = dto.Education;
            if (!string.IsNullOrEmpty(dto.PersonalDetails)) agent.PersonalDetails = dto.PersonalDetails;
            
            agent.ProfileCompleted = true;

            await _db.SaveChangesAsync(cancellationToken);

            return Ok(new { success = true, profileCompleted = true });
        }
    }
}
