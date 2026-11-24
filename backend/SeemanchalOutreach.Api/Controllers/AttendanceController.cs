using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    /// <summary>
    /// Team attendance on the CRM: everyone on the team (field agents and office staff), today and month by month.
    /// Days come from shifts in the app, the CRM being open (office staff) and approved leave; an admin or a marketing
    /// manager can mark any day by hand (present, half day, absent, leave, day off), which wins over the rest.
    /// </summary>
    [ApiController]
    [Authorize]
    [PageAccess(Pages.Field, Pages.Dashboard)]
    [Route("api/v1/attendance")]
    public class AttendanceController : ControllerBase
    {
        private const int MaxRangeDays = 62;
        private readonly IMarketingDbContext _db;
        private readonly AttendanceService _attendance;
        private readonly ILiveEvents _live;
        private readonly INotifier _notifier;
        private readonly PresenceTracker _presence;
        private readonly IAppSettings _settings;

        public AttendanceController(IMarketingDbContext db, AttendanceService attendance, ILiveEvents live, INotifier notifier, PresenceTracker presence, IAppSettings settings)
        {
            _db = db;
            _attendance = attendance;
            _live = live;
            _notifier = notifier;
            _presence = presence;
            _settings = settings;
        }

        private bool CanMark =>
            RoleChecks.CanonicalDashboardRole(User.RoleOf()) is RoleChecks.Admin or RoleChecks.MarketingManager;

        private static bool TryDate(string? s, out DateOnly d) =>
            DateOnly.TryParseExact(s ?? "", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out d);

        private static (int Year, int Month) ParseMonth(string? month)
        {
            var today = AttendanceService.TodayIst;
            if (!string.IsNullOrWhiteSpace(month) && DateTime.TryParseExact(month, "yyyy-MM", CultureInfo.InvariantCulture, DateTimeStyles.None, out var m))
                return (m.Year, m.Month);
            return (today.Year, today.Month);
        }

        private sealed record Person(string AgentId, string Name, string Role, string Block, string District, string? PhotoUrl, DateTime? LastActiveAt, string? LastActiveOn)
        {
            public bool Office => RoleChecks.IsDashboardRole(Role);
        }

        private async Task<List<Person>> TeamAsync(CancellationToken ct) =>
            (await _db.Agents.AsNoTracking().Where(a => a.IsActive)
                .Select(a => new Person(a.AgentId, a.Name, a.Role, a.Block, a.District, a.PhotoUrl, a.LastActiveAt, a.LastActiveOn)).ToListAsync(ct))
            .OrderBy(p => p.Name).ToList();

        /// <summary>Totals for a run of days: present counts a half day as ½.</summary>
        public static object Totals(IReadOnlyCollection<DayStatus> days) => new
        {
            present = days.Where(d => d.Status == "worked").Sum(d => d.Half ? 0.5m : 1m),
            half = days.Count(d => d.Status == "worked" && d.Half),
            leave = days.Count(d => d.Status == "leave"),
            absent = days.Count(d => d.Status == "absent"),
            late = days.Count(d => d.Late),
            off = days.Count(d => d.Status == "off"),
        };

        private static object Day(DayStatus d) => new
        {
            date = d.Date.ToString("yyyy-MM-dd"),
            status = d.Status,
            source = d.Source,
            half = d.Half,
            late = d.Late,
            inAt = d.InAt,
            outAt = d.OutAt,
            leaveType = d.LeaveType,
            mark = d.Mark,
            note = d.Note,
            markedBy = d.MarkedBy,
            auto = d.AutoSource,
            holiday = d.Holiday,
        };

        private object ConfigDto() => new
        {
            workStart = _attendance.Config.WorkStart,
            graceMinutes = _attendance.Config.GraceMinutes,
            weeklyOff = _attendance.Config.WeeklyOff,
            yearlyAllowance = _attendance.Config.YearlyAllowance,
            officeFromCrm = _attendance.Config.OfficeFromCrm,
            holidays = _attendance.Config.Holidays.Select(h => new { date = h.Date, name = h.Name }),
            saved = _attendance.Config.Saved,
        };

        [HttpGet("board")]
        public async Task<IActionResult> Board([FromQuery] string? month, CancellationToken ct)
        {
            var (year, mon) = ParseMonth(month);
            var today = AttendanceService.TodayIst;
            var team = await TeamAsync(ct);
            var ids = team.Select(p => p.AgentId).ToList();

            var monthDays = await _attendance.MonthAsync(ids, year, mon, ct);
            var todayDays = await _attendance.RangeAsync(ids, today, today, ct);
            var balances = await _attendance.UsedManyAsync(ids, year, ct);
            var openShifts = (await _db.Shifts.AsNoTracking()
                    .Where(s => ids.Contains(s.AgentId) && s.EndTime == null && s.StartTime >= IstClock.TodayStartUtc.AddHours(-12))
                    .Select(s => s.AgentId).ToListAsync(ct)).ToHashSet();
            var presence = _presence.Merge(team.Select(p => (p.AgentId, p.LastActiveAt, p.LastActiveOn)), DateTime.UtcNow);
            var pendingLeave = await _db.LeaveRequests.AsNoTracking().CountAsync(l => ids.Contains(l.AgentId) && l.Status == "pending", ct);

            var first = new DateOnly(year, mon, 1);
            var last = first.AddMonths(1).AddDays(-1);
            var lastCounted = last < today ? last : today;
            int workingSoFar = 0;
            for (var d = first; d <= lastCounted; d = d.AddDays(1)) if (_attendance.IsWorkingDay(d)) workingSoFar++;

            var todayRows = team.Select(p => (p, d: todayDays[p.AgentId][0])).ToList();
            bool presentToday(DayStatus d) => d.Status == "worked";

            var people = team.Select(p =>
            {
                var days = monthDays[p.AgentId];
                var t = todayDays[p.AgentId][0];
                var (used, pending) = balances.GetValueOrDefault(p.AgentId);
                var pr = presence.GetValueOrDefault(p.AgentId);
                return new
                {
                    agentId = p.AgentId,
                    name = p.Name,
                    role = p.Role,
                    group = p.Office ? "office" : "field",
                    block = string.IsNullOrWhiteSpace(p.Block) ? null : p.Block,
                    district = string.IsNullOrWhiteSpace(p.District) ? null : p.District,
                    photoUrl = p.PhotoUrl,
                    online = pr.Online,
                    lastSeenAt = pr.LastSeenAt,
                    onShift = openShifts.Contains(p.AgentId),
                    today = Day(t),
                    days = days.Select(Day),
                    totals = Totals(days),
                    leaveBalance = new { used, pending, remaining = Math.Max(0, _attendance.YearlyAllowance - used - pending) },
                };
            }).ToList();

            return Ok(new
            {
                month = $"{year:D4}-{mon:D2}",
                today = today.ToString("yyyy-MM-dd"),
                canMark = CanMark,
                config = ConfigDto(),
                workingDaysSoFar = workingSoFar,
                holidays = Enumerable.Range(0, last.Day).Select(i => first.AddDays(i))
                    .Where(d => _attendance.HolidayName(d) != null).Select(d => new { date = d.ToString("yyyy-MM-dd"), name = _attendance.HolidayName(d) }),
                kpis = new
                {
                    total = team.Count,
                    field = team.Count(p => !p.Office),
                    office = team.Count(p => p.Office),
                    present = todayRows.Count(r => presentToday(r.d)),
                    notIn = todayRows.Count(r => r.d.Status == "today"),
                    onLeave = todayRows.Count(r => r.d.Status == "leave"),
                    absent = todayRows.Count(r => r.d.Status == "absent"),
                    late = todayRows.Count(r => r.d.Late),
                    off = todayRows.Count(r => r.d.Status == "off"),
                    pendingLeave,
                    workingToday = _attendance.IsWorkingDay(today),
                },
                people,
            });
        }

        public class MarkDto
        {
            public List<string> AgentIds { get; set; } = new();
            public string? From { get; set; }
            public string? To { get; set; }
            /// <summary>present | half | absent | leave | off | clear (back to what the app or the CRM recorded).</summary>
            public string? Status { get; set; }
            public string? LeaveType { get; set; }
            public string? Note { get; set; }
            /// <summary>Tell each person in the app (absent, leave, half day).</summary>
            public bool Notify { get; set; }
            /// <summary>For a range: also mark weekly days off and holidays (normally skipped).</summary>
            public bool IncludeOffDays { get; set; }
        }

        /// <summary>Which days a mark applies to, or an error for the person at the CRM.</summary>
        public static (List<DateOnly> Days, string? Error) PlanDays(string? status, DateOnly from, DateOnly to, DateOnly today, Func<DateOnly, bool> isWorkingDay, bool includeOff)
        {
            if (to < from) return (new(), "The end date is before the start date.");
            if (to.DayNumber - from.DayNumber + 1 > MaxRangeDays) return (new(), $"Mark at most {MaxRangeDays} days at a time.");
            if (status is "present" or "half" or "absent" && to > today) return (new(), "Present, half day and absent can only be marked for today or earlier. Use leave or day off for days ahead.");
            if (from < today.AddDays(-400) || to > today.AddDays(366)) return (new(), "Pick dates within a year of today.");
            var days = new List<DateOnly>();
            for (var d = from; d <= to; d = d.AddDays(1))
                if (from == to || includeOff || status is "clear" or "off" || isWorkingDay(d)) days.Add(d);
            if (days.Count == 0) return (days, "Those dates are all days off. Tick “include days off” to mark them anyway.");
            return (days, null);
        }

        [HttpPut("marks")]
        public async Task<IActionResult> Mark([FromBody] MarkDto dto, CancellationToken ct)
        {
            if (!CanMark) return StatusCode(403, new { message = "Only an admin or a marketing manager can mark attendance." });
            var status = (dto.Status ?? "").Trim().ToLowerInvariant();
            if (status != "clear" && !AttendanceConfig.MarkStatuses.Contains(status)) return BadRequest(new { message = "Choose present, half day, absent, leave or day off." });
            if (!TryDate(dto.From, out var from)) return BadRequest(new { message = "Pick a date." });
            var to = TryDate(dto.To, out var t) ? t : from;
            var leaveType = status == "leave" ? (dto.LeaveType ?? "casual").Trim().ToLowerInvariant() : null;
            if (leaveType != null && !AttendanceConfig.LeaveTypes.Contains(leaveType)) return BadRequest(new { message = "Choose a kind of leave." });
            var note = string.IsNullOrWhiteSpace(dto.Note) ? null : dto.Note.Trim();
            if (note?.Length > 300) return BadRequest(new { message = "Keep the note under 300 characters." });

            var wanted = (dto.AgentIds ?? new()).Where(i => !string.IsNullOrWhiteSpace(i)).Select(i => i.Trim()).Distinct().ToList();
            if (wanted.Count == 0) return BadRequest(new { message = "Choose who to mark." });
            if (wanted.Count > 500) return BadRequest(new { message = "Mark at most 500 people at a time." });
            var people = await _db.Agents.AsNoTracking().Where(a => wanted.Contains(a.AgentId) && a.IsActive).Select(a => new { a.AgentId, a.Name }).ToListAsync(ct);
            if (people.Count != wanted.Count) return BadRequest(new { message = "Some of those people aren't on the team any more. Reload and try again." });

            var today = AttendanceService.TodayIst;
            var (days, error) = PlanDays(status, from, to, today, _attendance.IsWorkingDay, dto.IncludeOffDays);
            if (error != null) return BadRequest(new { message = error });

            var me = User.AgentIdOf();
            var myName = await _db.Agents.AsNoTracking().Where(a => a.AgentId == me).Select(a => a.Name).FirstOrDefaultAsync(ct) ?? me;
            var existing = await _db.AttendanceMarks.Where(m => wanted.Contains(m.AgentId) && m.Date >= days.Min() && m.Date <= days.Max()).ToListAsync(ct);
            var daySet = days.ToHashSet();
            int changed = 0;
            foreach (var p in people)
                foreach (var d in days)
                {
                    var row = existing.FirstOrDefault(m => m.AgentId == p.AgentId && m.Date == d);
                    if (status == "clear")
                    {
                        if (row != null) { _db.AttendanceMarks.Remove(row); changed++; }
                        continue;
                    }
                    if (row == null)
                    {
                        row = new AttendanceMark { AgentId = p.AgentId, Date = d };
                        _db.AttendanceMarks.Add(row);
                    }
                    else if (row.Status == status && row.LeaveType == leaveType && row.Note == note) continue;
                    row.Status = status;
                    row.LeaveType = leaveType;
                    row.Note = note;
                    row.MarkedBy = me;
                    row.MarkedByName = myName;
                    row.MarkedAt = DateTime.UtcNow;
                    changed++;
                }
            // Duplicates for the same day (shouldn't exist; the unique index stops them) are tidied too.
            foreach (var dup in existing.Where(m => daySet.Contains(m.Date)).GroupBy(m => (m.AgentId, m.Date)).SelectMany(g => g.Skip(1)))
                _db.AttendanceMarks.Remove(dup);
            await _db.SaveChangesAsync(ct);

            string range = from == to ? from.ToString("d MMM", CultureInfo.InvariantCulture) : $"{from.ToString("d MMM", CultureInfo.InvariantCulture)} – {to.ToString("d MMM", CultureInfo.InvariantCulture)}";
            string label = status switch
            {
                "present" => "present", "half" => "half day", "absent" => "absent", "leave" => $"{leaveType} leave", "off" => "day off", _ => "back to automatic",
            };
            var who = people.Count == 1 ? people[0].Name : $"{people.Count} people";
            await _live.PublishAsync(new LiveEvent { Kind = "attendance", Text = $"{who} marked {label} for {range} by {myName}", RefId = string.Join(",", wanted.Take(20)) });

            if (dto.Notify && status is "absent" or "leave" or "half")
                _notifier.Notify(new NotifyJob
                {
                    To = people.Select(p => p.AgentId).ToList(), Except = me, Kind = "leave",
                    Title = status switch { "absent" => "Marked absent", "leave" => "Leave recorded", _ => "Marked half day" },
                    Body = $"{range}: {label}, marked by {myName}.{(note != null ? " " + note : "")}",
                    Link = "leave",
                });
            return Ok(new { changed, days = days.Count, people = people.Count });
        }

        /// <summary>One person's marks and leave requests, newest first — the history behind their month.</summary>
        [HttpGet("people/{agentId}/history")]
        public async Task<IActionResult> History(string agentId, CancellationToken ct)
        {
            var marks = await _db.AttendanceMarks.AsNoTracking().Where(m => m.AgentId == agentId)
                .OrderByDescending(m => m.MarkedAt).Take(40).ToListAsync(ct);
            var leaves = await _db.LeaveRequests.AsNoTracking().Where(l => l.AgentId == agentId)
                .OrderByDescending(l => l.FromDate).Take(20).ToListAsync(ct);
            return Ok(new
            {
                marks = marks.Select(m => new { date = m.Date.ToString("yyyy-MM-dd"), status = m.Status, leaveType = m.LeaveType, note = m.Note, markedBy = m.MarkedByName, markedAt = m.MarkedAt }),
                leaves = leaves.Select(l => new { id = l.Id, type = l.Type, fromDate = l.FromDate.ToString("yyyy-MM-dd"), toDate = l.ToDate.ToString("yyyy-MM-dd"), days = l.Days, status = l.Status, reason = l.Reason }),
            });
        }

        public class SettingsDto
        {
            public string? WorkStart { get; set; }
            public int GraceMinutes { get; set; }
            public List<int>? WeeklyOff { get; set; }
            public int YearlyAllowance { get; set; }
            public bool OfficeFromCrm { get; set; }
            public List<AttendanceConfig.HolidayItem>? Holidays { get; set; }
        }

        [HttpPut("settings")]
        public async Task<IActionResult> SaveSettings([FromBody] SettingsDto dto, CancellationToken ct)
        {
            if (!CanMark) return StatusCode(403, new { message = "Only an admin or a marketing manager can change attendance settings." });
            var c = new AttendanceConfig
            {
                WorkStart = (dto.WorkStart ?? "").Trim(),
                GraceMinutes = dto.GraceMinutes,
                WeeklyOff = dto.WeeklyOff ?? new(),
                YearlyAllowance = dto.YearlyAllowance,
                OfficeFromCrm = dto.OfficeFromCrm,
                Holidays = (dto.Holidays ?? new()).Select(h => new AttendanceConfig.HolidayItem { Date = (h.Date ?? "").Trim(), Name = (h.Name ?? "").Trim() }).ToList(),
            };
            var error = c.Validate();
            if (error != null) return BadRequest(new { message = error });
            if (c.Holidays.Count > 120) return BadRequest(new { message = "At most 120 holidays." });
            if (c.Holidays.Any(h => h.Name.Length > 60)) return BadRequest(new { message = "Keep holiday names under 60 characters." });
            c.Clean();
            var json = System.Text.Json.JsonSerializer.Serialize(new { c.WorkStart, c.GraceMinutes, c.WeeklyOff, c.YearlyAllowance, c.OfficeFromCrm, c.Holidays }, AttendanceConfig.Json);
            await _settings.SetAsync(new Dictionary<string, string?> { [AttendanceConfig.Key] = json }, Array.Empty<string>(), User.AgentIdOf(), ct);
            await _live.PublishAsync(new LiveEvent { Kind = "attendance", Text = "Attendance settings changed" });
            return Ok(new { ok = true });
        }

        /// <summary>The month as a spreadsheet: one row per person, a code per day, totals at the end.</summary>
        [HttpGet("export")]
        public async Task<IActionResult> Export([FromQuery] string? month, CancellationToken ct)
        {
            var (year, mon) = ParseMonth(month);
            var team = await TeamAsync(ct);
            var ids = team.Select(p => p.AgentId).ToList();
            var days = await _attendance.MonthAsync(ids, year, mon, ct);
            var first = new DateOnly(year, mon, 1);
            var n = first.AddMonths(1).AddDays(-1).Day;
            static string c(string? v) => v == null ? "" : (v.IndexOfAny(new[] { ',', '"', '\n' }) >= 0 ? "\"" + v.Replace("\"", "\"\"") + "\"" : v);
            var sb = new StringBuilder();
            sb.Append("Name,User ID,Role,Team,Block");
            for (int i = 1; i <= n; i++) sb.Append(',').Append(i);
            sb.Append(",Present,Half days,Leave,Absent,Late\n");
            foreach (var p in team)
            {
                var dd = days[p.AgentId];
                sb.Append(string.Join(",", c(p.Name), c(p.AgentId), c(p.Role), p.Office ? "Office" : "Field", c(p.Block)));
                foreach (var d in dd) sb.Append(',').Append(Code(d));
                sb.Append(',').Append(dd.Where(d => d.Status == "worked").Sum(d => d.Half ? 0.5m : 1m).ToString(CultureInfo.InvariantCulture))
                  .Append(',').Append(dd.Count(d => d.Status == "worked" && d.Half))
                  .Append(',').Append(dd.Count(d => d.Status == "leave"))
                  .Append(',').Append(dd.Count(d => d.Status == "absent"))
                  .Append(',').Append(dd.Count(d => d.Late)).Append('\n');
            }
            sb.Append("\nP = present, H = half day, L = leave, A = absent, O = day off or holiday, * = late\n");
            return File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray(), "text/csv", $"attendance-{year:D4}-{mon:D2}.csv");
        }

        public static string Code(DayStatus d) => d.Status switch
        {
            "worked" => (d.Half ? "H" : "P") + (d.Late ? "*" : ""),
            "leave" => "L",
            "absent" => "A",
            "off" => "O",
            _ => "",
        };
    }
}
