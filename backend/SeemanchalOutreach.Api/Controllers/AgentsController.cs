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
        [Required, MinLength(2), MaxLength(50)]
        public string FirstName { get; set; } = string.Empty;

        [MaxLength(50)]
        public string? MiddleName { get; set; }

        [Required, MinLength(1), MaxLength(50)]
        public string LastName { get; set; } = string.Empty;

        [Required, RegularExpression(@"^[0-9]{10}$", ErrorMessage = "Phone must be exactly 10 digits.")]
        public string Phone { get; set; } = string.Empty;

        [EmailAddress, MaxLength(120)]
        public string? Email { get; set; }

        [Required, MinLength(8), MaxLength(100)]
        public string Password { get; set; } = string.Empty;

        [Required, MaxLength(50)]
        public string Role { get; set; } = string.Empty;

        [Required, MaxLength(50)]
        public string District { get; set; } = string.Empty;

        [Required, MaxLength(50)]
        public string Block { get; set; } = string.Empty;

        public DateTime? DateOfBirth { get; set; }
        public string? Gender { get; set; }
        public string? Address { get; set; }

        [MaxLength(10)]
        public string? Pincode { get; set; }

        public string? Education { get; set; }
        public string? WorkExperience { get; set; }
        public string? EmergencyContactName { get; set; }
        public string? EmergencyContactPhone { get; set; }
        public string? PhotoUrl { get; set; } // optional — admin can upload now or the agent can add it later
    }

    // Fields a profile update may touch. Self-edit (agent editing their own profile) and
    // admin-edit share this DTO; Role/District/Block/IsActive are only applied when the
    // caller has the Admin role (see UpdateProfile).
    public class UpdateAgentProfileDto
    {
        public string? FirstName { get; set; }
        public string? MiddleName { get; set; }
        public string? LastName { get; set; }
        public string? Email { get; set; }
        public DateTime? DateOfBirth { get; set; }
        public string? Gender { get; set; }
        public string? Address { get; set; }
        public string? Pincode { get; set; }
        public string? Education { get; set; }
        public string? WorkExperience { get; set; }
        public string? EmergencyContactName { get; set; }
        public string? EmergencyContactPhone { get; set; }
        public string? PhotoUrl { get; set; }
        public string? PersonalDetails { get; set; }

        // Admin-only fields — ignored unless the caller is an Admin.
        public string? Role { get; set; }
        public string? District { get; set; }
        public string? Block { get; set; }
        public bool? IsActive { get; set; }
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

    public class AgentDetailDto
    {
        public string AgentId { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string? FirstName { get; set; }
        public string? MiddleName { get; set; }
        public string? LastName { get; set; }
        public string Phone { get; set; } = string.Empty;
        public string? Email { get; set; }
        public string Role { get; set; } = string.Empty;
        public string District { get; set; } = string.Empty;
        public string Block { get; set; } = string.Empty;
        public bool IsActive { get; set; }
        public bool MustChangePassword { get; set; }
        public bool ProfileCompleted { get; set; }

        public DateTime? DateOfBirth { get; set; }
        public int? Age { get; set; }
        public string? Gender { get; set; }
        public string? Address { get; set; }
        public string? Pincode { get; set; }
        public string? FullAddress { get; set; }
        public string? Education { get; set; }
        public string? WorkExperience { get; set; }
        public string? EmergencyContactName { get; set; }
        public string? EmergencyContactPhone { get; set; }
        public string? PhotoUrl { get; set; }
        public string? PersonalDetails { get; set; }

        public DateTime CreatedAt { get; set; }

        // Presence — same derivation as AgentSummaryDto.Status
        public string Status { get; set; } = "offline";
        public bool ActiveShift { get; set; }
        public double? LastSeenLat { get; set; }
        public double? LastSeenLng { get; set; }
        public string? LastSeenAt { get; set; }
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
        [Authorize(Roles = "Admin,admin")]
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
                string status = DerivePresenceStatus(hasActiveShift, lastPoint?.RecordedAt, now);

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
        [Authorize(Roles = "Admin,admin")]
        public async Task<ActionResult<object>> GetTrajectory(string agentId, [FromQuery] DateOnly? date, CancellationToken cancellationToken)
        {
            var day = date ?? DateOnly.FromDateTime(DateTime.UtcNow);
            // DateOnly.ToDateTime produces Kind=Unspecified, which Npgsql refuses to bind
            // against a `timestamp with time zone` column (RecordedAt) — it throws rather
            // than guess the offset. Every timestamp in this app is UTC, so say so explicitly.
            var start = DateTime.SpecifyKind(day.ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc);
            var end = start.AddDays(1);

            var points = await _db.TrajectoryPoints.AsNoTracking()
                .Where(t => t.AgentId == agentId && t.RecordedAt >= start && t.RecordedAt < end)
                .OrderBy(t => t.RecordedAt)
                .Select(t => new { t.Lat, t.Lng, t.RecordedAt, t.AccuracyM })
                .ToListAsync(cancellationToken);

            return Ok(points);
        }

        [HttpGet("{agentId}")]
        [Authorize]
        public async Task<ActionResult<AgentDetailDto>> GetAgentDetail(string agentId, CancellationToken cancellationToken)
        {
            // Admin can view anyone; an agent can view their own record.
            var currentAgentId = User.FindFirst("agentId")?.Value;
            var role = User.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value;
            if (currentAgentId != agentId && role != "Admin")
            {
                return Forbid();
            }

            var agent = await _db.Agents.AsNoTracking().FirstOrDefaultAsync(a => a.AgentId == agentId, cancellationToken);
            if (agent == null) return NotFound();

            var hasActiveShift = await _db.Shifts.AsNoTracking()
                .AnyAsync(s => s.AgentId == agentId && s.EndTime == null, cancellationToken);

            var lastPoint = await _db.TrajectoryPoints.AsNoTracking()
                .Where(t => t.AgentId == agentId)
                .OrderByDescending(t => t.RecordedAt)
                .FirstOrDefaultAsync(cancellationToken);

            var now = DateTime.UtcNow;
            var status = DerivePresenceStatus(hasActiveShift, lastPoint?.RecordedAt, now);

            var addressParts = new[] { agent.Address, agent.Block, agent.District, agent.Pincode }
                .Where(p => !string.IsNullOrWhiteSpace(p));
            var fullAddress = addressParts.Any() ? string.Join(", ", addressParts) : null;

            return Ok(new AgentDetailDto
            {
                AgentId = agent.AgentId,
                Name = agent.Name,
                FirstName = agent.FirstName,
                MiddleName = agent.MiddleName,
                LastName = agent.LastName,
                Phone = agent.Phone,
                Email = agent.Email,
                Role = agent.Role,
                District = agent.District,
                Block = agent.Block,
                IsActive = agent.IsActive,
                MustChangePassword = agent.MustChangePassword,
                ProfileCompleted = agent.ProfileCompleted,
                DateOfBirth = agent.DateOfBirth,
                Age = CalculateAge(agent.DateOfBirth, now),
                Gender = agent.Gender,
                Address = agent.Address,
                Pincode = agent.Pincode,
                FullAddress = fullAddress,
                Education = agent.Education,
                WorkExperience = agent.WorkExperience,
                EmergencyContactName = agent.EmergencyContactName,
                EmergencyContactPhone = agent.EmergencyContactPhone,
                PhotoUrl = agent.PhotoUrl,
                PersonalDetails = agent.PersonalDetails,
                CreatedAt = agent.CreatedAt,
                Status = status,
                ActiveShift = hasActiveShift,
                LastSeenLat = lastPoint?.Lat,
                LastSeenLng = lastPoint?.Lng,
                LastSeenAt = lastPoint?.RecordedAt.ToString("o"),
            });
        }

        private static string DerivePresenceStatus(bool hasActiveShift, DateTime? lastActivityAt, DateTime now)
        {
            // "online" / "low-connectivity" / "offline" are derived from recency of GPS
            // sync while on an active shift — there is no separate presence/heartbeat
            // system, so this is the best real signal available.
            if (!hasActiveShift || lastActivityAt is null) return "offline";
            var minutesSinceActivity = (now - lastActivityAt.Value).TotalMinutes;
            if (minutesSinceActivity <= 5) return "online";
            if (minutesSinceActivity <= 30) return "low-connectivity";
            return "offline";
        }

        private static int? CalculateAge(DateTime? dateOfBirth, DateTime now)
        {
            if (dateOfBirth is null) return null;
            var dob = dateOfBirth.Value;
            var age = now.Year - dob.Year;
            if (now.Month < dob.Month || (now.Month == dob.Month && now.Day < dob.Day)) age--;
            return age;
        }

        /// <summary>
        /// Onboards a new field agent with an admin-set password (BCrypt-hashed — the
        /// plaintext is never stored). The agent still starts with MustChangePassword=true
        /// so they're forced to set their own password on first login. Always requires a
        /// valid JWT — the seeded default Admin account (AdminSeeder) means there is always
        /// a real login available, so no anonymous bootstrap path is needed.
        /// </summary>
        [HttpPost]
        [Authorize(Roles = "Admin,admin")]
        public async Task<ActionResult<object>> Onboard([FromBody] OnboardAgentRequest request, CancellationToken cancellationToken)
        {
            if (!ModelState.IsValid) return ValidationProblem(ModelState);

            if (await _db.Agents.AnyAsync(a => a.Phone == request.Phone, cancellationToken))
            {
                return Conflict($"An agent with phone number {request.Phone} already exists.");
            }

            var email = string.IsNullOrWhiteSpace(request.Email) ? null : request.Email.Trim();
            if (email != null && await _db.Agents.AnyAsync(a => a.Email == email, cancellationToken))
            {
                return Conflict($"An agent with email {email} already exists.");
            }

            string prefix = request.Role.Trim().ToLowerInvariant() switch
            {
                "admin" => "ADM",
                "field officer" => "FLD",
                "marketing executive" => "MKT",
                "regional representative" => "REG",
                _ => "AGT",
            };

            var firstName = request.FirstName.Trim();
            var middleName = string.IsNullOrWhiteSpace(request.MiddleName) ? null : request.MiddleName.Trim();
            var lastName = request.LastName.Trim();
            var fullName = string.Join(" ", new[] { firstName, middleName, lastName }.Where(p => !string.IsNullOrWhiteSpace(p)));

            // Reading "max existing number, then +1" and inserting are two separate
            // steps with nothing locking between them — two concurrent onboards for
            // the same role prefix (or a double-clicked submit) can both compute the
            // same next number and race to insert the same AgentId. The unique index
            // on AgentId catches that at the DB level; retry with a freshly-computed
            // number instead of surfacing that as a raw 500.
            const int maxAttempts = 5;
            for (int attempt = 1; attempt <= maxAttempts; attempt++)
            {
                var existingNumbers = await _db.Agents.AsNoTracking()
                    .Where(a => a.AgentId.StartsWith(prefix + "-"))
                    .Select(a => a.AgentId)
                    .ToListAsync(cancellationToken);
                int nextNumber = existingNumbers
                    .Select(id => int.TryParse(id.Split('-').LastOrDefault(), out var n) ? n : 0)
                    .DefaultIfEmpty(1000)
                    .Max() + 1;
                string agentId = $"{prefix}-{nextNumber}";

                // Npgsql refuses DateTime with Kind=Unspecified for a
                // `timestamp with time zone` column — JSON deserialization
                // of a bare date like "1995-06-15" produces exactly that.
                // Normalize to UTC so the INSERT never throws.
                DateTime? normalizedDob = request.DateOfBirth.HasValue
                    ? DateTime.SpecifyKind(request.DateOfBirth.Value, DateTimeKind.Utc)
                    : null;

                var agent = new FieldAgent
                {
                    Id = Guid.NewGuid(),
                    AgentId = agentId,
                    Name = fullName,
                    FirstName = firstName,
                    MiddleName = middleName,
                    LastName = lastName,
                    Phone = request.Phone,
                    Email = email,
                    Role = request.Role.Trim(),
                    District = request.District.Trim(),
                    Block = request.Block.Trim(),
                    PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
                    MustChangePassword = true,
                    IsActive = true,
                    DateOfBirth = normalizedDob,
                    Gender = request.Gender,
                    Address = request.Address,
                    Pincode = request.Pincode,
                    Education = request.Education,
                    WorkExperience = request.WorkExperience,
                    EmergencyContactName = request.EmergencyContactName,
                    EmergencyContactPhone = request.EmergencyContactPhone,
                    PhotoUrl = request.PhotoUrl,
                    // The admin already collected everything the old self-onboarding wizard
                    // asked for — no need to force it again on first login.
                    ProfileCompleted = true,
                };

                _db.Agents.Add(agent);
                try
                {
                    await _db.SaveChangesAsync(cancellationToken);
                }
                catch (DbUpdateException ex)
                {
                    if (ex.InnerException != null && ex.InnerException.Message.Contains("ix_agents_phone"))
                    {
                        return Conflict($"An agent with phone number {request.Phone} already exists.");
                    }

                    if (attempt < maxAttempts)
                    {
                        _db.ChangeTracker.Clear();
                        continue;
                    }
                    throw;
                }

                return Ok(new
                {
                    agentId = agent.AgentId,
                    name = agent.Name,
                    role = agent.Role,
                    district = agent.District,
                    block = agent.Block,
                    password = request.Password, // echoed back once so the admin can copy/share it
                });
            }

            return Conflict("Could not allocate a unique agent ID — please try again.");
        }

        [HttpPut("{agentId}/profile")]
        [Authorize]
        public async Task<IActionResult> UpdateProfile(string agentId, [FromBody] UpdateAgentProfileDto dto, CancellationToken cancellationToken)
        {
            // Only allow the agent themselves to update their own profile, or an admin
            var currentAgentId = User.FindFirst("agentId")?.Value;
            var role = User.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value;
            var isAdmin = role == "Admin";

            if (currentAgentId != agentId && !isAdmin)
            {
                return Forbid();
            }

            var agent = await _db.Agents.FirstOrDefaultAsync(a => a.AgentId == agentId, cancellationToken);
            if (agent == null) return NotFound();

            if (dto.Email != null && await _db.Agents.AnyAsync(a => a.AgentId != agentId && a.Email == dto.Email, cancellationToken))
            {
                return Conflict($"An agent with email {dto.Email} already exists.");
            }

            var nameChanged = false;
            if (!string.IsNullOrEmpty(dto.FirstName)) { agent.FirstName = dto.FirstName; nameChanged = true; }
            if (dto.MiddleName != null) { agent.MiddleName = string.IsNullOrWhiteSpace(dto.MiddleName) ? null : dto.MiddleName; nameChanged = true; }
            if (!string.IsNullOrEmpty(dto.LastName)) { agent.LastName = dto.LastName; nameChanged = true; }
            if (nameChanged)
            {
                agent.Name = string.Join(" ", new[] { agent.FirstName, agent.MiddleName, agent.LastName }.Where(p => !string.IsNullOrWhiteSpace(p)));
            }

            // != null (not IsNullOrEmpty) for these — an empty string is a deliberate
            // "clear this field," distinct from omitting the property to leave it
            // untouched. These used to only ever accept a non-empty overwrite, so an
            // agent/admin could never actually clear Address, Education, etc. once set.
            if (!string.IsNullOrEmpty(dto.Email)) agent.Email = dto.Email;
            if (dto.DateOfBirth != null) agent.DateOfBirth = DateTime.SpecifyKind(dto.DateOfBirth.Value, DateTimeKind.Utc);
            if (dto.Gender != null) agent.Gender = dto.Gender;
            if (dto.Address != null) agent.Address = dto.Address;
            if (dto.Pincode != null) agent.Pincode = dto.Pincode;
            if (dto.Education != null) agent.Education = dto.Education;
            if (dto.WorkExperience != null) agent.WorkExperience = dto.WorkExperience;
            if (dto.EmergencyContactName != null) agent.EmergencyContactName = dto.EmergencyContactName;
            if (dto.EmergencyContactPhone != null) agent.EmergencyContactPhone = dto.EmergencyContactPhone;
            if (!string.IsNullOrEmpty(dto.PhotoUrl)) agent.PhotoUrl = dto.PhotoUrl;
            if (dto.PersonalDetails != null) agent.PersonalDetails = dto.PersonalDetails;

            // Admin-only fields — silently ignored for a self-edit so an agent can't
            // reassign their own role/district/block or reactivate themselves.
            if (isAdmin)
            {
                if (!string.IsNullOrEmpty(dto.Role)) agent.Role = dto.Role;
                if (!string.IsNullOrEmpty(dto.District)) agent.District = dto.District;
                if (!string.IsNullOrEmpty(dto.Block)) agent.Block = dto.Block;
                if (dto.IsActive != null) agent.IsActive = dto.IsActive.Value;
            }

            // Only a self-edit (the agent finishing their own onboarding wizard)
            // should complete onboarding. An admin editing one field on an agent's
            // profile before that agent has onboarded used to unconditionally flip
            // this too, silently skipping the rest of the wizard (photo, personal
            // details) for that agent.
            if (!isAdmin)
            {
                agent.ProfileCompleted = true;
            }

            await _db.SaveChangesAsync(cancellationToken);

            return Ok(new { success = true, profileCompleted = agent.ProfileCompleted });
        }
    }
}
