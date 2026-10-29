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
    /// <summary>Config section "Leave".</summary>
    public class LeaveSettings
    {
        /// <summary>Days per calendar year, urgent and holiday leave together.</summary>
        public int YearlyAllowance { get; set; } = 24;
        /// <summary>Hospital holidays (yyyy-MM-dd) — not counted as working days or absences.</summary>
        public List<string> Holidays { get; set; } = new();
    }

    public record DayStatus(DateOnly Date, string Status, string? LeaveType);

    /// <summary>
    /// Days worked come from shifts: any shift started on an IST day counts that day as worked.
    /// Sundays and configured holidays are off. A past working day with no shift and no
    /// approved leave is an absence.
    /// </summary>
    public class AttendanceService
    {
        private readonly IMarketingDbContext _db;
        private readonly LeaveSettings _settings;
        private readonly HashSet<DateOnly> _holidays;

        public AttendanceService(IMarketingDbContext db, IOptions<LeaveSettings> settings)
        {
            _db = db;
            _settings = settings.Value;
            _holidays = _settings.Holidays
                .Select(h => DateOnly.TryParseExact(h, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : (DateOnly?)null)
                .Where(d => d.HasValue).Select(d => d!.Value).ToHashSet();
        }

        public int YearlyAllowance => _settings.YearlyAllowance;

        public static DateOnly TodayIst => DateOnly.FromDateTime(IstClock.NowIst);
        public static DateOnly IstDate(DateTime utc) => DateOnly.FromDateTime(utc + IstClock.Offset);
        public static DateTime StartUtc(DateOnly d) => DateTime.SpecifyKind(d.ToDateTime(TimeOnly.MinValue) - IstClock.Offset, DateTimeKind.Utc);

        public bool IsWorkingDay(DateOnly d) => d.DayOfWeek != DayOfWeek.Sunday && !_holidays.Contains(d);

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
            while (!IsWorkingDay(d)) d = d.AddDays(1);
            return d;
        }

        public async Task<(decimal Used, decimal Pending)> UsedAsync(string agentId, int year, CancellationToken ct)
        {
            var start = new DateOnly(year, 1, 1);
            var end = new DateOnly(year, 12, 31);
            var rows = await _db.LeaveRequests.AsNoTracking()
                .Where(l => l.AgentId == agentId && l.FromDate <= end && l.ToDate >= start && (l.Status == "approved" || l.Status == "pending"))
                .Select(l => new { l.Status, l.Days }).ToListAsync(ct);
            return (rows.Where(r => r.Status == "approved").Sum(r => r.Days), rows.Where(r => r.Status == "pending").Sum(r => r.Days));
        }

        /// <summary>Every agent's day-by-day status for one month.</summary>
        public async Task<Dictionary<string, List<DayStatus>>> MonthAsync(IReadOnlyCollection<string> agentIds, int year, int month, CancellationToken ct)
        {
            var first = new DateOnly(year, month, 1);
            var last = first.AddMonths(1).AddDays(-1);
            var today = TodayIst;
            var fromUtc = StartUtc(first);
            var toUtc = StartUtc(last.AddDays(1));

            var shiftDays = (await _db.Shifts.AsNoTracking()
                    .Where(s => agentIds.Contains(s.AgentId) && s.StartTime >= fromUtc && s.StartTime < toUtc)
                    .Select(s => new { s.AgentId, s.StartTime }).ToListAsync(ct))
                .GroupBy(s => s.AgentId)
                .ToDictionary(g => g.Key, g => g.Select(s => IstDate(s.StartTime)).ToHashSet());
            var leaves = await _db.LeaveRequests.AsNoTracking()
                .Where(l => agentIds.Contains(l.AgentId) && l.Status == "approved" && l.FromDate <= last && l.ToDate >= first)
                .Select(l => new { l.AgentId, l.FromDate, l.ToDate, l.Type }).ToListAsync(ct);

            var result = new Dictionary<string, List<DayStatus>>();
            foreach (var agentId in agentIds)
            {
                var worked = shiftDays.GetValueOrDefault(agentId) ?? new HashSet<DateOnly>();
                var mine = leaves.Where(l => l.AgentId == agentId).ToList();
                var days = new List<DayStatus>();
                for (var d = first; d <= last; d = d.AddDays(1))
                {
                    var leave = mine.FirstOrDefault(l => l.FromDate <= d && l.ToDate >= d);
                    string status;
                    if (worked.Contains(d)) status = "worked";
                    else if (!IsWorkingDay(d)) status = "off";
                    else if (leave != null) status = "leave";
                    else if (d == today) status = "today";
                    else if (d > today) status = "future";
                    else status = "absent";
                    days.Add(new DayStatus(d, status, leave?.Type));
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
