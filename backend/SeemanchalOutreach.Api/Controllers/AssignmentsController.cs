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
    public class CreateAssignmentRequest
    {
        [Required] public string AgentId { get; set; } = string.Empty;
        [Required] public string District { get; set; } = string.Empty;
        [Required] public string Block { get; set; } = string.Empty;
        public string? Notes { get; set; }
    }

    public class UpdateAssignmentStatusRequest
    {
        [Required] public string Status { get; set; } = string.Empty; // Active | Completed | Cancelled
    }

    public class AssignmentSummaryDto
    {
        public Guid Id { get; set; }
        public string AgentId { get; set; } = string.Empty;
        public string AgentName { get; set; } = string.Empty;
        public string District { get; set; } = string.Empty;
        public string Block { get; set; } = string.Empty;
        public string Status { get; set; } = string.Empty;
        public string? Notes { get; set; }
        public DateTime AssignedAt { get; set; }
        public DateTime? CompletedAt { get; set; }
        public int TotalPanchayats { get; set; }
        public int VisitedPanchayats { get; set; }
    }

    public class AssignmentPanchayatDto
    {
        public string PanchayatId { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public bool Visited { get; set; }
        public DateTime? LastVisitedAt { get; set; }
        public double? CentroidLat { get; set; }
        public double? CentroidLng { get; set; }
    }

    public class MyAssignmentDto
    {
        public Guid? AssignmentId { get; set; }
        public string? District { get; set; }
        public string? Block { get; set; }
        public DateTime? AssignedAt { get; set; }
        public string? Notes { get; set; }
        public List<AssignmentPanchayatDto> Panchayats { get; set; } = new();
    }

    [ApiController]
    [Authorize]
    [Route("api/v1/assignments")]
    public class AssignmentsController : ControllerBase
    {
        private static readonly string[] ValidStatuses = { "Active", "Completed", "Cancelled" };

        private readonly IMarketingDbContext _db;

        public AssignmentsController(IMarketingDbContext db)
        {
            _db = db;
        }

        [HttpGet]
        [Authorize(Roles = "Admin,admin")]
        public async Task<ActionResult<List<AssignmentSummaryDto>>> GetAssignments(CancellationToken cancellationToken)
        {
            var assignments = await _db.BlockAssignments.AsNoTracking()
                .OrderByDescending(a => a.AssignedAt)
                .ToListAsync(cancellationToken);
            if (assignments.Count == 0) return Ok(new List<AssignmentSummaryDto>());

            var agentIds = assignments.Select(a => a.AgentId).Distinct().ToList();
            var agentNames = await _db.Agents.AsNoTracking()
                .Where(a => agentIds.Contains(a.AgentId))
                .ToDictionaryAsync(a => a.AgentId, a => a.Name, cancellationToken);

            // Only active-for-marketing panchayats count toward a block's total —
            // a panchayat an admin has deliberately taken out of scope shouldn't
            // still inflate "X of Y visited" for a block assignment.
            var totalByBlock = (await _db.Panchayats.AsNoTracking()
                .Where(p => p.IsActiveForMarketing)
                .GroupBy(p => new { p.District, p.Block })
                .Select(g => new { g.Key.District, g.Key.Block, Count = g.Count() })
                .ToListAsync(cancellationToken))
                .ToDictionary(x => (x.District, x.Block), x => x.Count);

            var panchayatBlockMap = (await _db.Panchayats.AsNoTracking()
                .Where(p => p.IsActiveForMarketing)
                .Select(p => new { p.PanchayatId, p.District, p.Block })
                .ToListAsync(cancellationToken))
                .ToDictionary(p => p.PanchayatId, p => (p.District, p.Block));

            // AgentId + CheckInAt (not just AgentId + PanchayatId) — progress must be
            // scoped to visits made on/after THIS assignment's AssignedAt, otherwise
            // reassigning an agent to a block they (or a prior assignment) already
            // touched shows inflated progress from day one, and two assignments to
            // the same block for the same agent can't be told apart at all.
            var visits = await _db.Visits.AsNoTracking()
                .Where(v => agentIds.Contains(v.AgentId))
                .Select(v => new { v.AgentId, v.PanchayatId, v.CheckInAt })
                .ToListAsync(cancellationToken);

            var result = assignments.Select(a =>
            {
                var blockPanchayatIds = panchayatBlockMap
                    .Where(kv => kv.Value.District == a.District && kv.Value.Block == a.Block)
                    .Select(kv => kv.Key)
                    .ToHashSet();

                var visited = visits
                    .Where(v => v.AgentId == a.AgentId && v.CheckInAt >= a.AssignedAt && blockPanchayatIds.Contains(v.PanchayatId))
                    .Select(v => v.PanchayatId)
                    .Distinct()
                    .Count();

                return new AssignmentSummaryDto
                {
                    Id = a.Id,
                    AgentId = a.AgentId,
                    AgentName = agentNames.GetValueOrDefault(a.AgentId, a.AgentId),
                    District = a.District,
                    Block = a.Block,
                    Status = a.Status,
                    Notes = a.Notes,
                    AssignedAt = a.AssignedAt,
                    CompletedAt = a.CompletedAt,
                    TotalPanchayats = totalByBlock.GetValueOrDefault((a.District, a.Block), 0),
                    VisitedPanchayats = visited,
                };
            }).ToList();

            return Ok(result);
        }

        [HttpPost]
        [Authorize(Roles = "Admin,admin")]
        public async Task<ActionResult<AssignmentSummaryDto>> CreateAssignment([FromBody] CreateAssignmentRequest request, CancellationToken cancellationToken)
        {
            if (!ModelState.IsValid) return ValidationProblem(ModelState);

            var agent = await _db.Agents.FirstOrDefaultAsync(a => a.AgentId == request.AgentId, cancellationToken);
            if (agent == null) return NotFound($"Agent {request.AgentId} not found.");

            var district = request.District.Trim();
            var block = request.Block.Trim();

            // Superseding a prior active assignment counts as done with that task.
            var previousActive = await _db.BlockAssignments
                .Where(x => x.AgentId == request.AgentId && x.Status == "Active")
                .ToListAsync(cancellationToken);
            foreach (var prev in previousActive)
            {
                prev.Status = "Completed";
                prev.CompletedAt = DateTime.UtcNow;
            }

            var assignedBy = User.FindFirst("agentId")?.Value;

            var assignment = new BlockAssignment
            {
                AgentId = request.AgentId,
                District = district,
                Block = block,
                Notes = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim(),
                AssignedByAgentId = assignedBy,
            };
            _db.BlockAssignments.Add(assignment);

            // Keep FieldAgent.District/Block in sync — used elsewhere (reports, agent roster).
            agent.District = district;
            agent.Block = block;

            await _db.SaveChangesAsync(cancellationToken);

            var total = await _db.Panchayats.CountAsync(p => p.District == district && p.Block == block && p.IsActiveForMarketing, cancellationToken);
            var blockPanchayatIds = await _db.Panchayats.AsNoTracking()
                .Where(p => p.District == district && p.Block == block && p.IsActiveForMarketing)
                .Select(p => p.PanchayatId)
                .ToListAsync(cancellationToken);
            // Scoped to visits on/after this brand-new assignment's AssignedAt — a
            // fresh assignment starts at 0, not inflated by whatever the agent did
            // under a previous assignment to the same block.
            var visitedPanchayatIds = await _db.Visits.AsNoTracking()
                .Where(v => v.AgentId == request.AgentId && v.CheckInAt >= assignment.AssignedAt)
                .Select(v => v.PanchayatId)
                .Distinct()
                .ToListAsync(cancellationToken);
            var visited = visitedPanchayatIds.Intersect(blockPanchayatIds).Count();

            return Ok(new AssignmentSummaryDto
            {
                Id = assignment.Id,
                AgentId = assignment.AgentId,
                AgentName = agent.Name,
                District = assignment.District,
                Block = assignment.Block,
                Status = assignment.Status,
                Notes = assignment.Notes,
                AssignedAt = assignment.AssignedAt,
                CompletedAt = assignment.CompletedAt,
                TotalPanchayats = total,
                VisitedPanchayats = visited,
            });
        }

        [HttpPatch("{id:guid}")]
        [Authorize(Roles = "Admin,admin")]
        public async Task<IActionResult> UpdateStatus(Guid id, [FromBody] UpdateAssignmentStatusRequest request, CancellationToken cancellationToken)
        {
            if (!ValidStatuses.Contains(request.Status))
            {
                return BadRequest($"Status must be one of: {string.Join(", ", ValidStatuses)}.");
            }

            var assignment = await _db.BlockAssignments.FirstOrDefaultAsync(a => a.Id == id, cancellationToken);
            if (assignment == null) return NotFound();

            assignment.Status = request.Status;
            assignment.CompletedAt = request.Status == "Completed" ? DateTime.UtcNow : null;

            await _db.SaveChangesAsync(cancellationToken);
            return Ok(new { success = true });
        }

        [HttpGet("mine")]
        public async Task<ActionResult<MyAssignmentDto>> GetMyAssignment(CancellationToken cancellationToken)
        {
            var agentId = User.FindFirst("agentId")?.Value;
            if (string.IsNullOrEmpty(agentId)) return Unauthorized();

            var assignment = await _db.BlockAssignments.AsNoTracking()
                .Where(a => a.AgentId == agentId && a.Status == "Active")
                .OrderByDescending(a => a.AssignedAt)
                .FirstOrDefaultAsync(cancellationToken);

            if (assignment == null)
            {
                return Ok(new MyAssignmentDto());
            }

            // Only panchayats an admin has curated as "active for marketing" (via
            // Manage Panchayat) show up on the agent's task list — everything
            // defaults active, so this only changes anything once a block has
            // actually been curated.
            var panchayats = await _db.Panchayats.AsNoTracking()
                .Where(p => p.District == assignment.District && p.Block == assignment.Block && p.IsActiveForMarketing)
                .OrderBy(p => p.Name)
                .ToListAsync(cancellationToken);

            // Scoped to visits on/after this assignment's AssignedAt — otherwise an
            // agent reassigned to a block they'd previously worked (under an earlier,
            // now-Completed assignment) sees it as already partly done.
            var visits = await _db.Visits.AsNoTracking()
                .Where(v => v.AgentId == agentId && v.CheckInAt >= assignment.AssignedAt)
                .GroupBy(v => v.PanchayatId)
                .Select(g => new { PanchayatId = g.Key, LastVisitedAt = g.Max(v => v.CheckInAt) })
                .ToListAsync(cancellationToken);
            var visitMap = visits.ToDictionary(v => v.PanchayatId, v => v.LastVisitedAt);

            return Ok(new MyAssignmentDto
            {
                AssignmentId = assignment.Id,
                District = assignment.District,
                Block = assignment.Block,
                AssignedAt = assignment.AssignedAt,
                Notes = assignment.Notes,
                Panchayats = panchayats.Select(p => new AssignmentPanchayatDto
                {
                    PanchayatId = p.PanchayatId,
                    Name = p.Name,
                    Visited = visitMap.ContainsKey(p.PanchayatId),
                    LastVisitedAt = visitMap.GetValueOrDefault(p.PanchayatId),
                    CentroidLat = p.CentroidLat,
                    CentroidLng = p.CentroidLng,
                }).ToList(),
            });
        }
    }
}
