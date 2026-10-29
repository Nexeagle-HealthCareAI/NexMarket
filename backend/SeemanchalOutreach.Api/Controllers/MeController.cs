using System;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    /// <summary>The signed-in agent's own attendance and leave (used by the phone app).</summary>
    [ApiController]
    [Authorize]
    [Route("api/v1/me")]
    public class MeController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly AttendanceService _attendance;
        private readonly ILiveEvents _live;

        public MeController(IMarketingDbContext db, AttendanceService attendance, ILiveEvents live)
        {
            _db = db;
            _attendance = attendance;
            _live = live;
        }

        private string Me => User.AgentIdOf();

        private static bool TryDate(string? s, out DateOnly d) =>
            DateOnly.TryParseExact(s ?? "", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out d);

        [HttpGet("attendance")]
        public async Task<IActionResult> Attendance([FromQuery] string? month, CancellationToken ct)
        {
            var today = AttendanceService.TodayIst;
            int year = today.Year, mon = today.Month;
            if (!string.IsNullOrWhiteSpace(month) && DateTime.TryParseExact(month, "yyyy-MM", CultureInfo.InvariantCulture, DateTimeStyles.None, out var m))
            {
                year = m.Year;
                mon = m.Month;
            }
            var days = (await _attendance.MonthAsync(new[] { Me }, year, mon, ct))[Me];
            var (used, pending) = await _attendance.UsedAsync(Me, year, ct);
            return Ok(new
            {
                month = $"{year:D4}-{mon:D2}",
                days = days.Select(d => new { date = d.Date.ToString("yyyy-MM-dd"), status = d.Status, leaveType = d.LeaveType }),
                summary = new
                {
                    worked = days.Count(d => d.Status == "worked"),
                    leave = days.Count(d => d.Status == "leave"),
                    absent = days.Count(d => d.Status == "absent"),
                },
                allowance = new
                {
                    year,
                    total = _attendance.YearlyAllowance,
                    used,
                    pending,
                    remaining = Math.Max(0, _attendance.YearlyAllowance - used - pending),
                },
            });
        }

        [HttpGet("leaves")]
        public async Task<IActionResult> Leaves(CancellationToken ct)
        {
            var rows = await _db.LeaveRequests.AsNoTracking().Where(l => l.AgentId == Me)
                .OrderByDescending(l => l.FromDate).Take(100).ToListAsync(ct);
            var names = await DeciderNamesAsync(rows.Select(r => r.DecidedBy), ct);
            return Ok(rows.Select(r => Dto(r, names)));
        }

        [HttpGet("leaves/preview")]
        public async Task<IActionResult> Preview([FromQuery] string from, [FromQuery] string to, [FromQuery] bool halfDay, CancellationToken ct)
        {
            if (!TryDate(from, out var f) || !TryDate(to, out var t) || t < f)
                return BadRequest(new { message = "Pick a start and end date." });
            int affected = await _attendance.FollowUpsDuring(Me, f, t).CountAsync(ct);
            return Ok(new
            {
                days = _attendance.WorkingDays(f, t, halfDay),
                followUpsAffected = affected,
                moveTo = _attendance.NextWorkingDay(t).ToString("yyyy-MM-dd"),
            });
        }

        public class ApplyDto
        {
            public string Type { get; set; } = "holiday";
            public string FromDate { get; set; } = string.Empty;
            public string ToDate { get; set; } = string.Empty;
            public bool HalfDay { get; set; }
            public string? Reason { get; set; }
        }

        [HttpPost("leaves")]
        public async Task<IActionResult> Apply([FromBody] ApplyDto dto, CancellationToken ct)
        {
            var type = (dto.Type ?? "").Trim().ToLowerInvariant();
            if (type is not ("urgent" or "holiday")) return BadRequest(new { message = "Choose urgent or holiday leave." });
            if (!TryDate(dto.FromDate, out var from) || !TryDate(dto.ToDate, out var to) || to < from)
                return BadRequest(new { message = "Pick a start and end date." });
            var today = AttendanceService.TodayIst;
            if (from < today.AddDays(-7)) return BadRequest(new { message = "Leave can't start more than a week ago." });
            if (to > today.AddDays(365)) return BadRequest(new { message = "Leave can be requested up to a year ahead." });
            if (type == "urgent" && from > today.AddDays(1)) return BadRequest(new { message = "Urgent leave is for today or tomorrow. Use holiday leave for later dates." });
            if (string.IsNullOrWhiteSpace(dto.Reason)) return BadRequest(new { message = "Please give a reason." });

            bool halfDay = dto.HalfDay && from == to;
            decimal days = _attendance.WorkingDays(from, to, halfDay);
            if (days <= 0) return BadRequest(new { message = "Those dates are all Sundays or holidays — no leave needed." });

            bool overlaps = await _db.LeaveRequests.AnyAsync(l => l.AgentId == Me && (l.Status == "pending" || l.Status == "approved")
                                                                  && l.FromDate <= to && l.ToDate >= from, ct);
            if (overlaps) return Conflict(new { message = "You already have leave on some of these days." });

            var (used, pending) = await _attendance.UsedAsync(Me, from.Year, ct);
            decimal remaining = _attendance.YearlyAllowance - used - pending;
            if (days > remaining) return Conflict(new { message = $"Only {remaining:0.#} leave days are left this year." });

            var leave = new LeaveRequest
            {
                AgentId = Me,
                Type = type,
                FromDate = from,
                ToDate = to,
                HalfDay = halfDay,
                Days = days,
                Reason = dto.Reason!.Trim().Length > 500 ? dto.Reason.Trim()[..500] : dto.Reason.Trim(),
            };
            _db.LeaveRequests.Add(leave);
            await _db.SaveChangesAsync(ct);

            var name = await _db.Agents.AsNoTracking().Where(a => a.AgentId == Me).Select(a => a.Name).FirstOrDefaultAsync(ct) ?? Me;
            await _live.PublishAsync(new LiveEvent
            {
                Kind = "leave",
                Text = $"{name} asked for {(type == "urgent" ? "urgent" : "holiday")} leave: {from:d MMM}{(to != from ? " – " + to.ToString("d MMM") : "")} ({days:0.#} day{(days == 1 ? "" : "s")})",
                RefId = leave.Id.ToString(),
            });
            return Ok(Dto(leave, new()));
        }

        [HttpPost("leaves/{id:guid}/cancel")]
        public async Task<IActionResult> Cancel(Guid id, CancellationToken ct)
        {
            var leave = await _db.LeaveRequests.FirstOrDefaultAsync(l => l.Id == id && l.AgentId == Me, ct);
            if (leave == null) return NotFound(new { message = "Leave not found." });
            if (leave.Status is not ("pending" or "approved")) return BadRequest(new { message = "This leave can't be cancelled." });
            if (leave.Status == "approved" && leave.FromDate <= AttendanceService.TodayIst)
                return BadRequest(new { message = "Leave that has started can't be cancelled here. Ask your manager." });
            leave.Status = "cancelled";
            await _db.SaveChangesAsync(ct);
            return Ok(Dto(leave, new()));
        }

        private async Task<System.Collections.Generic.Dictionary<string, string>> DeciderNamesAsync(System.Collections.Generic.IEnumerable<string?> ids, CancellationToken ct)
        {
            var list = ids.Where(i => !string.IsNullOrEmpty(i)).Select(i => i!).Distinct().ToList();
            if (list.Count == 0) return new();
            return (await _db.Agents.AsNoTracking().Where(a => list.Contains(a.AgentId)).Select(a => new { a.AgentId, a.Name }).ToListAsync(ct))
                .GroupBy(a => a.AgentId).ToDictionary(g => g.Key, g => g.First().Name);
        }

        internal static object Dto(LeaveRequest r, System.Collections.Generic.Dictionary<string, string> names) => new
        {
            id = r.Id,
            type = r.Type,
            fromDate = r.FromDate.ToString("yyyy-MM-dd"),
            toDate = r.ToDate.ToString("yyyy-MM-dd"),
            halfDay = r.HalfDay,
            days = r.Days,
            reason = r.Reason,
            status = r.Status,
            decidedBy = r.DecidedBy == null ? null : names.GetValueOrDefault(r.DecidedBy) ?? r.DecidedBy,
            decidedAt = r.DecidedAt,
            decisionNote = r.DecisionNote,
            followUpsMoved = r.FollowUpsMoved,
            createdAt = r.CreatedAt,
        };
    }
}
