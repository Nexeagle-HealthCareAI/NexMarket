using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>Config section "Leave" — used until attendance settings are saved from the CRM.</summary>
    public class LeaveSettings
    {
        /// <summary>Days per calendar year, urgent and holiday leave together.</summary>
        public int YearlyAllowance { get; set; } = 24;
        /// <summary>Hospital holidays (yyyy-MM-dd) — not counted as working days or absences.</summary>
        public List<string> Holidays { get; set; } = new();
    }

    /// <summary>
    /// One day for one person. Status: worked | leave | absent | off | today | future (the phone app knows these).
    /// The rest says where it came from and when they started and finished.
    /// </summary>
    public record DayStatus(DateOnly Date, string Status, string? LeaveType)
    {
        /// <summary>shift (the app) | crm (had the CRM open) | mark (set by hand on the CRM) | leave (an approved request) | null.</summary>
        public string? Source { get; init; }
        /// <summary>Marked as a half day (counts as half a day worked).</summary>
        public bool Half { get; init; }
        public DateTime? InAt { get; init; }
        public DateTime? OutAt { get; init; }
        /// <summary>Started after the work start time plus the grace minutes.</summary>
        public bool Late { get; init; }
        /// <summary>The hand-set status (present | half | absent | leave | off), when there is one.</summary>
        public string? Mark { get; init; }
        public string? Note { get; init; }
        public string? MarkedBy { get; init; }
        /// <summary>What the app or the CRM recorded, under a hand-set mark: shift | crm | null.</summary>
        public string? AutoSource { get; init; }
        public string? Holiday { get; init; }
    }

    /// <summary>Attendance rules an admin sets on the CRM (Team attendance → Settings).</summary>
    public class AttendanceConfig
    {
        public const string Key = "attendance.config";
        public static readonly string[] MarkStatuses = { "present", "half", "absent", "leave", "off" };
        public static readonly string[] LeaveTypes = { "casual", "sick", "urgent", "holiday", "unpaid" };

        /// <summary>When the working day starts, India time, "HH:mm".</summary>
        public string WorkStart { get; set; } = "10:00";
        /// <summary>Minutes after the start before someone counts as late.</summary>
        public int GraceMinutes { get; set; } = 15;
        /// <summary>Weekly days off (0 = Sunday … 6 = Saturday).</summary>
        public List<int> WeeklyOff { get; set; } = new() { 0 };
        /// <summary>Leave days per calendar year (every kind except unpaid).</summary>
        public int YearlyAllowance { get; set; } = 24;
        /// <summary>Office staff (CRM users) count as present on days they had the CRM open.</summary>
        public bool OfficeFromCrm { get; set; } = true;
        public List<HolidayItem> Holidays { get; set; } = new();
        /// <summary>True once saved from the CRM (before that, the server's Leave settings are used).</summary>
        public bool Saved { get; set; }

        public class HolidayItem
        {
            public string Date { get; set; } = string.Empty;
            public string Name { get; set; } = string.Empty;
        }

        public TimeOnly StartTime => TimeOnly.TryParseExact(WorkStart ?? "", "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var t) ? t : new TimeOnly(10, 0);

        public static AttendanceConfig Load(IAppSettings? app, LeaveSettings server)
        {
            var raw = app?.Get(Key);
            if (!string.IsNullOrWhiteSpace(raw))
            {
                try
                {
                    var c = System.Text.Json.JsonSerializer.Deserialize<AttendanceConfig>(raw, Json);
                    if (c != null) { c.Saved = true; return c.Clean(); }
                }
                catch (System.Text.Json.JsonException) { /* fall back to the server settings */ }
            }
            return new AttendanceConfig
            {
                YearlyAllowance = server.YearlyAllowance,
                Holidays = server.Holidays.Select(h => new HolidayItem { Date = h, Name = "Holiday" }).ToList(),
            }.Clean();
        }

        public static readonly System.Text.Json.JsonSerializerOptions Json = new(System.Text.Json.JsonSerializerDefaults.Web);

        /// <summary>Drops bad values; returns an error message for the first one, or null.</summary>
        public string? Validate()
        {
            if (!TimeOnly.TryParseExact(WorkStart ?? "", "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out _)) return "Work start must be a time like 10:00.";
            if (GraceMinutes is < 0 or > 240) return "Grace must be between 0 and 240 minutes.";
            if (YearlyAllowance is < 0 or > 365) return "Leave days a year must be between 0 and 365.";
            if ((WeeklyOff ?? new()).Any(d => d is < 0 or > 6)) return "Weekly off days must be Sunday to Saturday.";
            if ((WeeklyOff ?? new()).Distinct().Count() > 3) return "At most 3 weekly days off.";
            foreach (var h in Holidays ?? new())
                if (!DateOnly.TryParseExact(h.Date ?? "", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _)) return $"\"{h.Date}\" isn't a date.";
            return null;
        }

        public AttendanceConfig Clean()
        {
            WeeklyOff = (WeeklyOff ?? new()).Where(d => d is >= 0 and <= 6).Distinct().OrderBy(d => d).ToList();
            Holidays = (Holidays ?? new())
                .Where(h => DateOnly.TryParseExact(h.Date ?? "", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
                .GroupBy(h => h.Date).Select(g => new HolidayItem { Date = g.Key, Name = string.IsNullOrWhiteSpace(g.First().Name) ? "Holiday" : g.First().Name.Trim() })
                .OrderBy(h => h.Date).ToList();
            GraceMinutes = Math.Clamp(GraceMinutes, 0, 240);
            return this;
        }
    }

    /// <summary>
    /// Who worked which day. In order: a day marked by hand on the CRM; a shift started in the app that India day (anyone),
    /// or the CRM open that day (office staff); weekly days off and holidays; approved leave. A past working day with none
    /// of these is an absence.
    /// </summary>
    public class AttendanceService
    {
        private readonly IMarketingDbContext _db;
        private readonly AttendanceConfig _config;
        private readonly HashSet<DateOnly> _holidays;
        private readonly Dictionary<DateOnly, string> _holidayNames;

        public AttendanceService(IMarketingDbContext db, IOptions<LeaveSettings> settings, IAppSettings? app = null)
        {
            _db = db;
            _config = AttendanceConfig.Load(app, settings.Value);
            _holidayNames = new();
            foreach (var h in _config.Holidays)
                if (DateOnly.TryParseExact(h.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) _holidayNames[d] = h.Name;
            _holidays = _holidayNames.Keys.ToHashSet();
        }

        public AttendanceConfig Config => _config;
        public int YearlyAllowance => _config.YearlyAllowance;

        public static DateOnly TodayIst => DateOnly.FromDateTime(IstClock.NowIst);
        public static DateOnly IstDate(DateTime utc) => DateOnly.FromDateTime(utc + IstClock.Offset);
        public static DateTime StartUtc(DateOnly d) => DateTime.SpecifyKind(d.ToDateTime(TimeOnly.MinValue) - IstClock.Offset, DateTimeKind.Utc);

        public bool IsWorkingDay(DateOnly d) => !_config.WeeklyOff.Contains((int)d.DayOfWeek) && !_holidays.Contains(d);
        public string? HolidayName(DateOnly d) => _holidayNames.GetValueOrDefault(d);

        /// <summary>Late when the first start (India time) is after the work start plus grace.</summary>
        public bool IsLate(DateTime? inAtUtc)
        {
            if (inAtUtc == null) return false;
            var t = TimeOnly.FromDateTime(inAtUtc.Value + IstClock.Offset);
            return t > _config.StartTime.AddMinutes(_config.GraceMinutes);
        }

        public decimal WorkingDays(DateOnly from, DateOnly to, bool halfDay)
        {
            if (to < from) return 0;
            int n = 0;
            for (var d = from; d <= to; d = d.AddDays(1)) if (IsWorkingDay(d)) n++;
            if (halfDay && from == to && n == 1) return 0.5m;
            return n;
        }

        public DateOnly NextWorkingDay(DateOnly after)
        {
            var d = after.AddDays(1);
            for (int i = 0; i < 60 && !IsWorkingDay(d); i++) d = d.AddDays(1);
            return d;
        }

        public async Task<(decimal Used, decimal Pending)> UsedAsync(string agentId, int year, CancellationToken ct)
        {
            var all = await UsedManyAsync(new[] { agentId }, year, ct);
            return all.GetValueOrDefault(agentId);
        }

        /// <summary>
        /// Leave used and waiting this year: approved and pending requests, plus leave marked on the CRM on days no
        /// approved request covers (unpaid leave isn't counted against the allowance).
        /// </summary>
        public async Task<Dictionary<string, (decimal Used, decimal Pending)>> UsedManyAsync(IReadOnlyCollection<string> agentIds, int year, CancellationToken ct)
        {
            var start = new DateOnly(year, 1, 1);
            var end = new DateOnly(year, 12, 31);
            var rows = await _db.LeaveRequests.AsNoTracking()
                .Where(l => agentIds.Contains(l.AgentId) && l.FromDate <= end && l.ToDate >= start && (l.Status == "approved" || l.Status == "pending"))
                .Select(l => new { l.AgentId, l.Status, l.Days, l.FromDate, l.ToDate }).ToListAsync(ct);
            var marks = await _db.AttendanceMarks.AsNoTracking()
                .Where(m => agentIds.Contains(m.AgentId) && m.Date >= start && m.Date <= end && m.Status == "leave")
                .Select(m => new { m.AgentId, m.Date, m.LeaveType }).ToListAsync(ct);
            var result = new Dictionary<string, (decimal, decimal)>();
            foreach (var id in agentIds)
            {
                var mine = rows.Where(r => r.AgentId == id).ToList();
                var approved = mine.Where(r => r.Status == "approved").ToList();
                decimal marked = marks.Count(m => m.AgentId == id && m.LeaveType != "unpaid"
                                                  && !approved.Any(r => r.FromDate <= m.Date && r.ToDate >= m.Date));
                result[id] = (approved.Sum(r => r.Days) + marked, mine.Where(r => r.Status == "pending").Sum(r => r.Days));
            }
            return result;
        }

        /// <summary>Every agent's day-by-day status for one month.</summary>
        public Task<Dictionary<string, List<DayStatus>>> MonthAsync(IReadOnlyCollection<string> agentIds, int year, int month, CancellationToken ct)
        {
            var first = new DateOnly(year, month, 1);
            return RangeAsync(agentIds, first, first.AddMonths(1).AddDays(-1), ct);
        }

        /// <summary>Every agent's day-by-day status from <paramref name="first"/> to <paramref name="last"/> (India days).</summary>
        public async Task<Dictionary<string, List<DayStatus>>> RangeAsync(IReadOnlyCollection<string> agentIds, DateOnly first, DateOnly last, CancellationToken ct)
        {
            var today = TodayIst;
            var fromUtc = StartUtc(first);
            var toUtc = StartUtc(last.AddDays(1));

            var office = (await _db.Agents.AsNoTracking().Where(a => agentIds.Contains(a.AgentId)).Select(a => new { a.AgentId, a.Role }).ToListAsync(ct))
                .Where(a => RoleChecks.IsDashboardRole(a.Role)).Select(a => a.AgentId).ToHashSet();

            var shifts = (await _db.Shifts.AsNoTracking()
                    .Where(s => agentIds.Contains(s.AgentId) && s.StartTime >= fromUtc && s.StartTime < toUtc)
                    .Select(s => new { s.AgentId, s.StartTime, s.EndTime }).ToListAsync(ct))
                .GroupBy(s => (s.AgentId, IstDate(s.StartTime)))
                .ToDictionary(g => g.Key, g => (In: g.Min(s => s.StartTime), Out: g.Any(s => s.EndTime == null) ? (DateTime?)null : g.Max(s => s.EndTime)));
            var activity = office.Count == 0 || !_config.OfficeFromCrm
                ? new Dictionary<(string, DateOnly), (DateTime In, DateTime? Out)>()
                : (await _db.ActivityDays.AsNoTracking()
                        .Where(a => office.Contains(a.AgentId) && a.Date >= first && a.Date <= last)
                        .Select(a => new { a.AgentId, a.Date, a.FirstAt, a.LastAt }).ToListAsync(ct))
                    .GroupBy(a => (a.AgentId, a.Date))
                    .ToDictionary(g => g.Key, g => (In: g.Min(a => a.FirstAt), Out: (DateTime?)g.Max(a => a.LastAt)));
            var marks = (await _db.AttendanceMarks.AsNoTracking()
                    .Where(m => agentIds.Contains(m.AgentId) && m.Date >= first && m.Date <= last).ToListAsync(ct))
                .GroupBy(m => (m.AgentId, m.Date)).ToDictionary(g => g.Key, g => g.OrderByDescending(m => m.MarkedAt).First());
            var leaves = await _db.LeaveRequests.AsNoTracking()
                .Where(l => agentIds.Contains(l.AgentId) && l.Status == "approved" && l.FromDate <= last && l.ToDate >= first)
                .Select(l => new { l.AgentId, l.FromDate, l.ToDate, l.Type }).ToListAsync(ct);

            var result = new Dictionary<string, List<DayStatus>>();
            foreach (var agentId in agentIds.Distinct())
            {
                var mine = leaves.Where(l => l.AgentId == agentId).ToList();
                var days = new List<DayStatus>();
                for (var d = first; d <= last; d = d.AddDays(1))
                {
                    var leave = mine.FirstOrDefault(l => l.FromDate <= d && l.ToDate >= d);
                    // Earliest start and latest finish from the app's shifts, or from the CRM for office staff.
                    string? auto = null; DateTime? inAt = null, outAt = null;
                    if (shifts.TryGetValue((agentId, d), out var sh)) { auto = "shift"; inAt = sh.In; outAt = sh.Out; }
                    if (activity.TryGetValue((agentId, d), out var ac))
                    {
                        if (auto == null) { auto = "crm"; inAt = ac.In; outAt = ac.Out; }
                        else { if (ac.In < inAt) inAt = ac.In; }
                    }
                    var holiday = HolidayName(d);
                    DayStatus day;
                    if (marks.TryGetValue((agentId, d), out var m))
                    {
                        var (status, half) = m.Status switch
                        {
                            "present" => ("worked", false),
                            "half" => ("worked", true),
                            "leave" => ("leave", false),
                            "off" => ("off", false),
                            _ => ("absent", false),
                        };
                        day = new DayStatus(d, status, status == "leave" ? m.LeaveType ?? "casual" : null)
                        {
                            Source = "mark", Half = half, Mark = m.Status, Note = m.Note, MarkedBy = m.MarkedByName, AutoSource = auto,
                            InAt = inAt, OutAt = outAt,
                            Late = status == "worked" && !half && IsLate(inAt), Holiday = holiday,
                        };
                    }
                    else if (auto != null) day = new DayStatus(d, "worked", null) { Source = auto, InAt = inAt, OutAt = outAt, Late = IsWorkingDay(d) && IsLate(inAt), Holiday = holiday };
                    else if (!IsWorkingDay(d)) day = new DayStatus(d, "off", null) { Holiday = holiday };
                    else if (leave != null) day = new DayStatus(d, "leave", leave.Type) { Source = "leave" };
                    else if (d == today) day = new DayStatus(d, "today", null);
                    else if (d > today) day = new DayStatus(d, "future", null);
                    else day = new DayStatus(d, "absent", null);
                    days.Add(day);
                }
                result[agentId] = days;
            }
            return result;
        }

        /// <summary>The agent's partners whose follow-up falls inside the leave.</summary>
        public IQueryable<OutreachContact> FollowUpsDuring(string agentId, DateOnly from, DateOnly to)
        {
            var fromUtc = StartUtc(from);
            var toUtc = StartUtc(to.AddDays(1));
            return _db.Contacts.Where(c => c.AgentId == agentId && !c.IsMerged && c.FollowUpDate != null
                                           && c.FollowUpDate >= fromUtc && c.FollowUpDate < toUtc);
        }
    }
}
