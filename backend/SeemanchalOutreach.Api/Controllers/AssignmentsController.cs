using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Api.Security;
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
        /// <summary>manual | field | villages | hq-village | block — "block" means only the block centre is known.</summary>
        public string LocationSource { get; set; } = "block";
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
        [PageAccess(Pages.Field)]
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
                var scope = Scope(a);
                if (scope != null) blockPanchayatIds.IntersectWith(scope);

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
                    TotalPanchayats = Scope(a) == null ? totalByBlock.GetValueOrDefault((a.District, a.Block), 0) : blockPanchayatIds.Count,
                    VisitedPanchayats = visited,
                };
            }).ToList();

            return Ok(result);
        }

        [HttpPost]
        [PageAccess(Pages.Field)]
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
        [PageAccess(Pages.Field)]
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
            var myScope = Scope(assignment);
            if (myScope != null) panchayats = panchayats.Where(p => myScope.Contains(p.PanchayatId)).ToList();

            // Scoped to visits on/after this assignment's AssignedAt — otherwise an
            // agent reassigned to a block they'd previously worked (under an earlier,
            // now-Completed assignment) sees it as already partly done.
            var visits = await _db.Visits.AsNoTracking()
                .Where(v => v.AgentId == agentId && v.CheckInAt >= assignment.AssignedAt)
                .GroupBy(v => v.PanchayatId)
                .Select(g => new { PanchayatId = g.Key, LastVisitedAt = g.Max(v => v.CheckInAt) })
                .ToListAsync(cancellationToken);
            var visitMap = visits.ToDictionary(v => v.PanchayatId, v => v.LastVisitedAt);
            var checkIns = await PanchayatLocator.CheckInsAsync(_db, panchayats.Select(p => p.PanchayatId).ToList(), cancellationToken);
            var spots = panchayats.ToDictionary(p => p.PanchayatId, p => PanchayatLocator.Resolve(p, checkIns.GetValueOrDefault(p.PanchayatId)));

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
                    CentroidLat = spots[p.PanchayatId].Lat,
                    CentroidLng = spots[p.PanchayatId].Lng,
                    LocationSource = spots[p.PanchayatId].Source,
                }).ToList(),
            });
        }
    
        // ─── Board: blocks, who covers them, and splitting a block between agents ───

        /// <summary>The panchayats an assignment covers, or null when it covers the whole block.</summary>
        public static HashSet<string>? Scope(BlockAssignment a)
        {
            if (string.IsNullOrWhiteSpace(a.PanchayatIdsJson)) return null;
            try { return System.Text.Json.JsonSerializer.Deserialize<List<string>>(a.PanchayatIdsJson)?.ToHashSet(); }
            catch (System.Text.Json.JsonException) { return null; }
        }

        private static string? ScopeJson(IEnumerable<string>? ids) =>
            ids == null ? null : System.Text.Json.JsonSerializer.Serialize(ids.Distinct().OrderBy(x => x).ToList());

        private async Task<List<(string AgentId, string Name, string Block, string District)>> FieldAgentsAsync(CancellationToken ct)
        {
            var list = await _db.Agents.AsNoTracking().Where(a => a.IsActive)
                .Select(a => new { a.AgentId, a.Name, a.Role, a.Block, a.District }).ToListAsync(ct);
            return list.Where(a => !RoleChecks.IsDashboardRole(a.Role)).OrderBy(a => a.Name)
                .Select(a => (a.AgentId, a.Name, a.Block, a.District)).ToList();
        }

        [HttpGet("board")]
        [PageAccess(Pages.Field)]
        public async Task<IActionResult> Board(CancellationToken ct)
        {
            var panchayats = await _db.Panchayats.AsNoTracking().Where(p => p.IsActiveForMarketing)
                .Select(p => new { p.PanchayatId, p.District, p.Block }).ToListAsync(ct);
            var active = await _db.BlockAssignments.AsNoTracking().Where(a => a.Status == "Active").ToListAsync(ct);
            var agents = await FieldAgentsAsync(ct);
            var names = agents.ToDictionary(a => a.AgentId, a => a.Name);
            var since = DateTime.UtcNow.AddDays(-30);
            var visited30 = (await _db.Visits.AsNoTracking().Where(v => v.CheckInAt >= since).Select(v => v.PanchayatId).Distinct().ToListAsync(ct)).ToHashSet();

            var blocks = panchayats.GroupBy(p => (p.District, p.Block)).Select(g =>
            {
                var ids = g.Select(p => p.PanchayatId).ToHashSet();
                var here = active.Where(a => a.District == g.Key.District && a.Block == g.Key.Block && names.ContainsKey(a.AgentId)).ToList();
                var covered = new HashSet<string>();
                var who = here.Select(a =>
                {
                    var sc = Scope(a);
                    var mine = sc == null ? ids : ids.Where(sc.Contains).ToHashSet();
                    covered.UnionWith(mine);
                    return new { agentId = a.AgentId, name = names[a.AgentId], panchayats = mine.Count, whole = sc == null };
                }).OrderByDescending(x => x.panchayats).ToList();
                return new
                {
                    district = g.Key.District,
                    block = g.Key.Block,
                    panchayats = ids.Count,
                    assigned = covered.Count,
                    visited30 = ids.Count(visited30.Contains),
                    agents = who,
                };
            }).OrderBy(b => b.district).ThenBy(b => b.block).ToList();

            var withBlock = active.Where(a => names.ContainsKey(a.AgentId)).Select(a => a.AgentId).ToHashSet();
            return Ok(new
            {
                kpis = new
                {
                    blocks = blocks.Count,
                    blocksWithAgent = blocks.Count(b => b.agents.Count > 0),
                    panchayats = blocks.Sum(b => b.panchayats),
                    panchayatsAssigned = blocks.Sum(b => b.assigned),
                    agentsWithoutBlock = agents.Count(a => !withBlock.Contains(a.AgentId)),
                },
                districts = blocks.Select(b => b.district).Distinct().ToList(),
                blocks,
                agents = agents.Select(a =>
                {
                    var cur = active.Where(x => x.AgentId == a.AgentId).OrderByDescending(x => x.AssignedAt).FirstOrDefault();
                    return new { agentId = a.AgentId, name = a.Name, block = cur?.Block, district = cur?.District, partial = cur != null && Scope(cur) != null };
                }),
            });
        }

        [HttpGet("block")]
        [PageAccess(Pages.Field)]
        public async Task<IActionResult> BlockDetail([FromQuery] string district, [FromQuery] string block, CancellationToken ct)
        {
            var panchayats = await _db.Panchayats.AsNoTracking()
                .Where(p => p.District == district && p.Block == block && p.IsActiveForMarketing)
                .OrderBy(p => p.Name).Select(p => new { p.PanchayatId, p.Name }).ToListAsync(ct);
            var ids = panchayats.Select(p => p.PanchayatId).ToList();
            var active = await _db.BlockAssignments.AsNoTracking()
                .Where(a => a.Status == "Active" && a.District == district && a.Block == block).ToListAsync(ct);
            var agentIds = active.Select(a => a.AgentId).Distinct().ToList();
            var names = await _db.Agents.AsNoTracking().Where(a => agentIds.Contains(a.AgentId) && a.IsActive)
                .ToDictionaryAsync(a => a.AgentId, a => a.Name, ct);
            var lastVisit = await _db.Visits.AsNoTracking().Where(v => ids.Contains(v.PanchayatId))
                .GroupBy(v => v.PanchayatId).Select(g => new { g.Key, at = g.Max(v => v.CheckInAt) }).ToDictionaryAsync(x => x.Key, x => x.at, ct);
            var partners = await _db.Contacts.AsNoTracking().Where(c => ids.Contains(c.PanchayatId) && !c.IsMerged)
                .GroupBy(c => c.PanchayatId).Select(g => new { g.Key, n = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.n, ct);

            string? Owner(string pid)
            {
                foreach (var a in active.Where(a => names.ContainsKey(a.AgentId)).OrderByDescending(a => a.AssignedAt))
                {
                    var sc = Scope(a);
                    if (sc == null || sc.Contains(pid)) return a.AgentId;
                }
                return null;
            }

            return Ok(new
            {
                district,
                block,
                panchayats = panchayats.Select(p =>
                {
                    var owner = Owner(p.PanchayatId);
                    return new
                    {
                        panchayatId = p.PanchayatId,
                        name = p.Name,
                        agentId = owner,
                        agentName = owner == null ? null : names[owner],
                        lastVisitAt = lastVisit.TryGetValue(p.PanchayatId, out var lv) ? lv : (DateTime?)null,
                        partners = partners.GetValueOrDefault(p.PanchayatId),
                    };
                }),
            });
        }

        public class AssignBlockDto
        {
            [Required] public string District { get; set; } = string.Empty;
            [Required] public string Block { get; set; } = string.Empty;
            /// <summary>Agent to give the panchayats to; empty = take them away from whoever has them.</summary>
            public string? AgentId { get; set; }
            /// <summary>Null = the whole block.</summary>
            public List<string>? PanchayatIds { get; set; }
            public string? Notes { get; set; }
        }

        /// <summary>
        /// Give a whole block, or some of its panchayats, to one agent. Whoever covered those panchayats
        /// before loses them (an assignment left with none is closed). An agent works one block at a time,
        /// so giving them a different block closes their old one.
        /// </summary>
        [HttpPost("assign")]
        [PageAccess(Pages.Field)]
        public async Task<IActionResult> Assign([FromBody] AssignBlockDto dto, CancellationToken ct)
        {
            if (!ModelState.IsValid) return ValidationProblem(ModelState);
            var blockIds = await _db.Panchayats.AsNoTracking()
                .Where(p => p.District == dto.District && p.Block == dto.Block && p.IsActiveForMarketing)
                .Select(p => p.PanchayatId).ToListAsync(ct);
            if (blockIds.Count == 0) return NotFound(new { message = "That block has no active panchayats." });
            var moving = dto.PanchayatIds == null ? blockIds.ToHashSet() : dto.PanchayatIds.Where(blockIds.Contains).ToHashSet();
            if (moving.Count == 0) return BadRequest(new { message = "Pick at least one panchayat." });
            bool whole = moving.Count == blockIds.Count;

            Domain.Entities.FieldAgent? agent = null;
            if (!string.IsNullOrWhiteSpace(dto.AgentId))
            {
                agent = await _db.Agents.FirstOrDefaultAsync(a => a.AgentId == dto.AgentId && a.IsActive, ct);
                if (agent == null) return NotFound(new { message = "Agent not found." });
            }
            var now = DateTime.UtcNow;
            var by = User.FindFirst("agentId")?.Value;

            // Take the panchayats away from everyone else on this block.
            var others = await _db.BlockAssignments
                .Where(a => a.Status == "Active" && a.District == dto.District && a.Block == dto.Block && a.AgentId != (dto.AgentId ?? ""))
                .ToListAsync(ct);
            foreach (var o in others)
            {
                var left = (Scope(o) ?? blockIds.ToHashSet()).Where(id => blockIds.Contains(id) && !moving.Contains(id)).ToList();
                if (left.Count == 0) { o.Status = "Completed"; o.CompletedAt = now; }
                else o.PanchayatIdsJson = left.Count == blockIds.Count ? null : ScopeJson(left);
            }

            if (agent != null)
            {
                var mine = await _db.BlockAssignments.Where(a => a.AgentId == agent.AgentId && a.Status == "Active").ToListAsync(ct);
                var same = mine.FirstOrDefault(a => a.District == dto.District && a.Block == dto.Block);
                foreach (var m in mine.Where(m => m != same)) { m.Status = "Completed"; m.CompletedAt = now; }
                if (same != null)
                {
                    var had = Scope(same) ?? blockIds.ToHashSet();
                    var union = had.Concat(moving).Where(blockIds.Contains).ToHashSet();
                    same.PanchayatIdsJson = union.Count == blockIds.Count ? null : ScopeJson(union);
                    if (!string.IsNullOrWhiteSpace(dto.Notes)) same.Notes = dto.Notes.Trim();
                }
                else
                {
                    _db.BlockAssignments.Add(new BlockAssignment
                    {
                        AgentId = agent.AgentId,
                        District = dto.District,
                        Block = dto.Block,
                        PanchayatIdsJson = whole ? null : ScopeJson(moving),
                        Notes = string.IsNullOrWhiteSpace(dto.Notes) ? null : dto.Notes.Trim(),
                        AssignedByAgentId = by,
                    });
                }
                agent.District = dto.District;
                agent.Block = dto.Block;
            }

            await _db.SaveChangesAsync(ct);
            return Ok(new { moved = moving.Count, whole, agentId = agent?.AgentId });
        }
}
}
