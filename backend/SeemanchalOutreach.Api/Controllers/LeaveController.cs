using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Controllers
{
    /// <summary>
    /// CRM attendance and leave board. Anyone who can see the field force or the dashboard can
    /// view it; only an Admin or a Marketing manager can approve or reject leave.
    /// </summary>
    [ApiController]
    [Authorize]
    [PageAccess(Pages.Field, Pages.Dashboard)]
    [Route("api/v1/leave")]
    public class LeaveController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly AttendanceService _attendance;
        private readonly ILiveEvents _live;

        public LeaveController(IMarketingDbContext db, AttendanceService attendance, ILiveEvents live)
        {
            _db = db;
            _attendance = attendance;
            _live = live;
        }

        private bool CanDecide =>
            RoleChecks.CanonicalDashboardRole(User.RoleOf()) is RoleChecks.Admin or RoleChecks.MarketingManager;

        [HttpGet("board")]
        public async Task<IActionResult> Board([FromQuery] string? month, CancellationToken ct)
        {
            var today = AttendanceService.TodayIst;
            int year = today.Year, mon = today.Month;
            if (!string.IsNullOrWhiteSpace(month) && DateTime.TryParseExact(month, "yyyy-MM", CultureInfo.InvariantCulture, DateTimeStyles.None, out var m))
            {
                year = m.Year;
                mon = m.Month;
            }

            var agents = (await _db.Agents.AsNoTracking().Where(a => a.IsActive)
                    .Select(a => new { a.AgentId, a.Name, a.Role, a.Block, a.District }).ToListAsync(ct))
                .Where(a => !RoleChecks.IsDashboardRole(a.Role)).OrderBy(a => a.Name).ToList();
            var ids = agents.Select(a => a.AgentId).ToList();
            var month1 = await _attendance.MonthAsync(ids, year, mon, ct);

            var todayStart = IstClock.TodayStartUtc;
            var onShift = await _db.Shifts.AsNoTracking()
                .Where(s => ids.Contains(s.AgentId) && s.EndTime == null && s.StartTime >= todayStart.AddHours(-12))
                .Select(s => s.AgentId).Distinct().CountAsync(ct);

            var leaves = await _db.LeaveRequests.AsNoTracking()
                .Where(l => ids.Contains(l.AgentId) && (l.Status == "pending" || (l.Status == "approved" && l.ToDate >= today)))
                .OrderBy(l => l.FromDate).ToListAsync(ct);
            var names = agents.ToDictionary(a => a.AgentId, a => a.Name);
            var blocks = agents.ToDictionary(a => a.AgentId, a => a.Block);
            var deciders = await NamesAsync(leaves.Select(l => l.DecidedBy), ct);

            var pending = leaves.Where(l => l.Status == "pending")
                .OrderByDescending(l => l.Type == "urgent").ThenBy(l => l.FromDate).ToList();
            var awayNow = leaves.Where(l => l.Status == "approved" && l.FromDate <= today && l.ToDate >= today).ToList();

            // Remaining allowance for everyone with a pending request.
            var balances = new Dictionary<string, decimal>();
            foreach (var aid in pending.Select(p => p.AgentId).Distinct())
            {
                var (used, pend) = await _attendance.UsedAsync(aid, year, ct);
                balances[aid] = _attendance.YearlyAllowance - used - pend;
            }
            var followUps = new Dictionary<Guid, int>();
            foreach (var p in pending)
                followUps[p.Id] = await _attendance.FollowUpsDuring(p.AgentId, p.FromDate, p.ToDate).CountAsync(ct);

            var team = agents.Select(a =>
            {
                var days = month1[a.AgentId];
                return new
                {
                    agentId = a.AgentId,
                    name = a.Name,
                    block = a.Block,
                    days = days.Select(d => new { date = d.Date.ToString("yyyy-MM-dd"), status = d.Status, leaveType = d.LeaveType }),
                    worked = days.Count(d => d.Status == "worked"),
                    leave = days.Count(d => d.Status == "leave"),
                    absent = days.Count(d => d.Status == "absent"),
                };
            }).ToList();

            var first = new DateOnly(year, mon, 1);
            var lastCounted = new[] { first.AddMonths(1).AddDays(-1), today }.Min();
            int workingSoFar = 0;
            for (var d = first; d <= lastCounted; d = d.AddDays(1)) if (_attendance.IsWorkingDay(d)) workingSoFar++;

            return Ok(new
            {
                month = $"{year:D4}-{mon:D2}",
                allowance = _attendance.YearlyAllowance,
                canDecide = CanDecide,
                kpis = new
                {
                    onShiftToday = onShift,
                    totalAgents = agents.Count,
                    onLeaveToday = awayNow.Select(l => l.AgentId).Distinct().Count(),
                    pending = pending.Count,
                    urgentPending = pending.Count(p => p.Type == "urgent"),
                    avgDaysWorked = team.Count == 0 ? 0 : Math.Round(team.Average(t => (double)t.worked), 1),
                    workingDaysSoFar = workingSoFar,
                    noShowDays = team.Sum(t => t.absent),
                },
                requests = pending.Select(l => new
                {
                    id = l.Id,
                    agentId = l.AgentId,
                    name = names.GetValueOrDefault(l.AgentId) ?? l.AgentId,
                    block = blocks.GetValueOrDefault(l.AgentId),
                    type = l.Type,
                    fromDate = l.FromDate.ToString("yyyy-MM-dd"),
                    toDate = l.ToDate.ToString("yyyy-MM-dd"),
                    halfDay = l.HalfDay,
                    days = l.Days,
                    reason = l.Reason,
                    createdAt = l.CreatedAt,
                    remaining = balances.GetValueOrDefault(l.AgentId),
                    followUpsAffected = followUps.GetValueOrDefault(l.Id),
                }),
                away = leaves.Where(l => l.Status == "approved").Select(l => new
                {
                    id = l.Id,
                    agentId = l.AgentId,
                    name = names.GetValueOrDefault(l.AgentId) ?? l.AgentId,
                    block = blocks.GetValueOrDefault(l.AgentId),
                    type = l.Type,
                    fromDate = l.FromDate.ToString("yyyy-MM-dd"),
                    toDate = l.ToDate.ToString("yyyy-MM-dd"),
                    days = l.Days,
                    now = l.FromDate <= today,
                    decidedBy = l.DecidedBy == null ? null : deciders.GetValueOrDefault(l.DecidedBy) ?? l.DecidedBy,
                }),
                team,
            });
        }

        [HttpGet("requests")]
        public async Task<IActionResult> Requests([FromQuery] string? status, CancellationToken ct)
        {
            var q = _db.LeaveRequests.AsNoTracking();
            if (!string.IsNullOrWhiteSpace(status) && status != "all") q = q.Where(l => l.Status == status);
            var rows = await q.OrderByDescending(l => l.CreatedAt).Take(300).ToListAsync(ct);
            var names = await NamesAsync(rows.Select(r => r.AgentId).Concat(rows.Select(r => r.DecidedBy)), ct);
            return Ok(rows.Select(r => new
            {
                agentName = names.GetValueOrDefault(r.AgentId) ?? r.AgentId,
                agentId = r.AgentId,
                leave = MeController.Dto(r, names),
            }));
        }

        public class DecisionDto
        {
            public bool Approve { get; set; }
            public string? Note { get; set; }
        }

        [HttpPut("requests/{id:guid}/decision")]
        public async Task<IActionResult> Decide(Guid id, [FromBody] DecisionDto dto, CancellationToken ct)
        {
            if (!CanDecide) return StatusCode(403, new { message = "Only an admin or a marketing manager can approve leave." });
            var leave = await _db.LeaveRequests.FirstOrDefaultAsync(l => l.Id == id, ct);
            if (leave == null) return NotFound(new { message = "Leave request not found." });
            if (leave.Status != "pending") return Conflict(new { message = $"This request is already {leave.Status}." });

            leave.Status = dto.Approve ? "approved" : "rejected";
            leave.DecidedBy = User.AgentIdOf();
            leave.DecidedAt = DateTime.UtcNow;
            leave.DecisionNote = string.IsNullOrWhiteSpace(dto.Note) ? null : dto.Note.Trim();

            if (dto.Approve)
            {
                // Follow-ups that fall on leave days move to the first working day after it.
                var moveTo = AttendanceService.StartUtc(_attendance.NextWorkingDay(leave.ToDate)).AddHours(10);
                var contacts = await _attendance.FollowUpsDuring(leave.AgentId, leave.FromDate, leave.ToDate).ToListAsync(ct);
                foreach (var c in contacts)
                {
                    c.FollowUpDate = moveTo;
                    c.LastModifiedAt = DateTime.UtcNow;
                }
                leave.FollowUpsMoved = contacts.Count;
            }
            await _db.SaveChangesAsync(ct);

            var name = await _db.Agents.AsNoTracking().Where(a => a.AgentId == leave.AgentId).Select(a => a.Name).FirstOrDefaultAsync(ct) ?? leave.AgentId;
            await _live.PublishAsync(new LiveEvent
            {
                Kind = "leave",
                Text = $"{name}'s leave {leave.FromDate:d MMM}{(leave.ToDate != leave.FromDate ? " – " + leave.ToDate.ToString("d MMM") : "")} {(dto.Approve ? "approved" : "rejected")}",
                RefId = leave.Id.ToString(),
            });
            return Ok(new { id = leave.Id, status = leave.Status, followUpsMoved = leave.FollowUpsMoved });
        }

        private async Task<Dictionary<string, string>> NamesAsync(IEnumerable<string?> ids, CancellationToken ct)
        {
            var list = ids.Where(i => !string.IsNullOrEmpty(i)).Select(i => i!).Distinct().ToList();
            if (list.Count == 0) return new();
            return (await _db.Agents.AsNoTracking().Where(a => list.Contains(a.AgentId)).Select(a => new { a.AgentId, a.Name }).ToListAsync(ct))
                .GroupBy(a => a.AgentId).ToDictionary(g => g.Key, g => g.First().Name);
        }
    }
}
