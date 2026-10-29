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
    /// The CRM Field agents page: how each agent is doing in a month (visits, new partners,
    /// surveys, referrals that became admissions) next to their attendance.
    /// </summary>
    [ApiController]
    [Authorize]
    [PageAccess(Pages.Field)]
    [Route("api/v1/team")]
    public class TeamController : ControllerBase
    {
        private static readonly string[] AdmittedStatuses = { "admitted", "converted", "procedure", "discharged" };
        private readonly IMarketingDbContext _db;
        private readonly AttendanceService _attendance;

        public TeamController(IMarketingDbContext db, AttendanceService attendance)
        {
            _db = db;
            _attendance = attendance;
        }

        private static (int Year, int Month) ParseMonth(string? month)
        {
            var today = AttendanceService.TodayIst;
            if (!string.IsNullOrWhiteSpace(month) && DateTime.TryParseExact(month, "yyyy-MM", CultureInfo.InvariantCulture, DateTimeStyles.None, out var m))
                return (m.Year, m.Month);
            return (today.Year, today.Month);
        }

        private sealed record Counts(int Visits, int Partners, int Surveys, int Referrals, int Admitted);

        private async Task<Dictionary<string, Counts>> CountsAsync(List<string> ids, DateTime from, DateTime to, CancellationToken ct)
        {
            var visits = await _db.Visits.AsNoTracking().Where(v => ids.Contains(v.AgentId) && v.CheckInAt >= from && v.CheckInAt < to)
                .GroupBy(v => v.AgentId).Select(g => new { g.Key, n = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.n, ct);
            var partners = await _db.Contacts.AsNoTracking().Where(c => ids.Contains(c.AgentId) && !c.IsMerged && c.CreatedAt >= from && c.CreatedAt < to)
                .GroupBy(c => c.AgentId).Select(g => new { g.Key, n = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.n, ct);
            var surveys = await _db.SurveyResponses.AsNoTracking().Where(s => ids.Contains(s.AgentId) && !s.IsSkipped && s.CreatedAt >= from && s.CreatedAt < to)
                .GroupBy(s => s.AgentId).Select(g => new { g.Key, n = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.n, ct);
            var refs = await _db.Referrals.AsNoTracking().Where(r => ids.Contains(r.AgentId) && r.CreatedAt >= from && r.CreatedAt < to)
                .GroupBy(r => r.AgentId).Select(g => new { g.Key, n = g.Count(), adm = g.Count(r => AdmittedStatuses.Contains(r.Status)) })
                .ToDictionaryAsync(x => x.Key, ct);
            return ids.ToDictionary(id => id, id => new Counts(
                visits.GetValueOrDefault(id), partners.GetValueOrDefault(id), surveys.GetValueOrDefault(id),
                refs.TryGetValue(id, out var r) ? r.n : 0, refs.TryGetValue(id, out var r2) ? r2.adm : 0));
        }

        /// <summary>Panchayats in each agent's active blocks, and how many of those they visited in the last 30 days.</summary>
        private async Task<Dictionary<string, (int Total, int Visited)>> CoverageAsync(List<string> ids, CancellationToken ct)
        {
            var assigned = await _db.BlockAssignments.AsNoTracking().Where(a => ids.Contains(a.AgentId) && a.Status == "Active")
                .Select(a => new { a.AgentId, a.Block, a.District, a.PanchayatIdsJson }).ToListAsync(ct);
            var agents = await _db.Agents.AsNoTracking().Where(a => ids.Contains(a.AgentId)).Select(a => new { a.AgentId, a.Block, a.District }).ToListAsync(ct);
            var blocksByAgent = ids.ToDictionary(id => id, id =>
            {
                var b = assigned.Where(a => a.AgentId == id).Select(a => (a.Block, a.District)).ToList();
                if (b.Count == 0)
                {
                    var me = agents.FirstOrDefault(a => a.AgentId == id);
                    if (me != null && !string.IsNullOrWhiteSpace(me.Block)) b.Add((me.Block, me.District));
                }
                return b;
            });
            var blocks = blocksByAgent.Values.SelectMany(b => b.Select(x => x.Block)).Distinct().ToList();
            var panchayats = await _db.Panchayats.AsNoTracking().Where(p => blocks.Contains(p.Block) && p.IsActiveForMarketing)
                .Select(p => new { p.PanchayatId, p.Block, p.District }).ToListAsync(ct);
            var since = DateTime.UtcNow.AddDays(-30);
            var visited = (await _db.Visits.AsNoTracking().Where(v => ids.Contains(v.AgentId) && v.CheckInAt >= since)
                .Select(v => new { v.AgentId, v.PanchayatId }).Distinct().ToListAsync(ct))
                .GroupBy(v => v.AgentId).ToDictionary(g => g.Key, g => g.Select(x => x.PanchayatId).ToHashSet());

            return ids.ToDictionary(id => id, id =>
            {
                var mine = panchayats.Where(p => blocksByAgent[id].Any(b => b.Block == p.Block && (string.IsNullOrEmpty(b.District) || b.District == p.District)))
                    .Select(p => p.PanchayatId).ToHashSet();
                // A block split between agents: count only this agent's share.
                foreach (var a in assigned.Where(a => a.AgentId == id && !string.IsNullOrWhiteSpace(a.PanchayatIdsJson)))
                {
                    var sc = AssignmentsController.Scope(new Domain.Entities.BlockAssignment { PanchayatIdsJson = a.PanchayatIdsJson });
                    if (sc != null) mine.RemoveWhere(pid => panchayats.Any(p => p.PanchayatId == pid && p.Block == a.Block && p.District == a.District) && !sc.Contains(pid));
                }
                var seen = visited.GetValueOrDefault(id) ?? new HashSet<string>();
                return (mine.Count, mine.Count(seen.Contains));
            });
        }

        [HttpGet]
        public async Task<IActionResult> List([FromQuery] string? month, CancellationToken ct)
        {
            var (year, mon) = ParseMonth(month);
            var first = new DateOnly(year, mon, 1);
            var from = AttendanceService.StartUtc(first);
            var to = AttendanceService.StartUtc(first.AddMonths(1));

            var agents = (await _db.Agents.AsNoTracking().Where(a => a.IsActive)
                    .Select(a => new { a.AgentId, a.Name, a.Role, a.Block, a.District, a.Phone, a.PhotoUrl }).ToListAsync(ct))
                .Where(a => !RoleChecks.IsDashboardRole(a.Role)).OrderBy(a => a.Name).ToList();
            var ids = agents.Select(a => a.AgentId).ToList();

            var counts = await CountsAsync(ids, from, to, ct);
            var days = await _attendance.MonthAsync(ids, year, mon, ct);
            var coverage = await CoverageAsync(ids, ct);
            var status = await StatusAsync(ids, ct);

            var today = AttendanceService.TodayIst;
            var lastCounted = new[] { first.AddMonths(1).AddDays(-1), today }.Min();
            int workingSoFar = 0;
            for (var d = first; d <= lastCounted; d = d.AddDays(1)) if (_attendance.IsWorkingDay(d)) workingSoFar++;

            var rows = agents.Select(a =>
            {
                var c = counts[a.AgentId];
                var dd = days[a.AgentId];
                var cov = coverage[a.AgentId];
                var st = status.GetValueOrDefault(a.AgentId);
                int worked = dd.Count(x => x.Status == "worked" || (x.Status == "today" && st.OnShift));
                return new
                {
                    agentId = a.AgentId,
                    name = a.Name,
                    block = a.Block,
                    district = a.District,
                    phone = a.Phone,
                    photoUrl = a.PhotoUrl,
                    status = st.OnShift ? "shift" : st.OnLeave ? "leave" : "off",
                    lastSeenAt = st.LastSeen,
                    visits = c.Visits,
                    partners = c.Partners,
                    surveys = c.Surveys,
                    referrals = c.Referrals,
                    admitted = c.Admitted,
                    daysWorked = worked,
                    absent = dd.Count(x => x.Status == "absent"),
                    leave = dd.Count(x => x.Status == "leave"),
                    panchayats = cov.Total,
                    visited30 = cov.Visited,
                };
            }).ToList();

            int totalWorked = rows.Sum(r => r.daysWorked);
            return Ok(new
            {
                month = $"{year:D4}-{mon:D2}",
                workingDaysSoFar = workingSoFar,
                kpis = new
                {
                    totalAgents = rows.Count,
                    onShift = rows.Count(r => r.status == "shift"),
                    onLeave = rows.Count(r => r.status == "leave"),
                    visitsPerDay = totalWorked == 0 ? 0 : Math.Round(rows.Sum(r => r.visits) / (double)totalWorked, 1),
                    partners = rows.Sum(r => r.partners),
                    referrals = rows.Sum(r => r.referrals),
                    admitted = rows.Sum(r => r.admitted),
                    avgDaysWorked = rows.Count == 0 ? 0 : Math.Round(rows.Average(r => (double)r.daysWorked), 1),
                },
                agents = rows,
            });
        }

        [HttpGet("{agentId}")]
        public async Task<IActionResult> Detail(string agentId, [FromQuery] string? month, CancellationToken ct)
        {
            var a = await _db.Agents.AsNoTracking().FirstOrDefaultAsync(x => x.AgentId == agentId, ct);
            if (a == null) return NotFound(new { message = "Agent not found." });
            var (year, mon) = ParseMonth(month);
            var first = new DateOnly(year, mon, 1);
            var from = AttendanceService.StartUtc(first);
            var to = AttendanceService.StartUtc(first.AddMonths(1));
            var prevFrom = AttendanceService.StartUtc(first.AddMonths(-1));
            var ids = new List<string> { agentId };

            var now = (await CountsAsync(ids, from, to, ct))[agentId];
            var prev = (await CountsAsync(ids, prevFrom, from, ct))[agentId];
            var days = (await _attendance.MonthAsync(ids, year, mon, ct))[agentId];
            var cov = (await CoverageAsync(ids, ct))[agentId];
            var st = (await StatusAsync(ids, ct)).GetValueOrDefault(agentId);
            var (used, pending) = await _attendance.UsedAsync(agentId, year, ct);

            // Visits per week of the month (weeks start on the 1st, 8th, 15th, 22nd, 29th).
            var visitTimes = await _db.Visits.AsNoTracking().Where(v => v.AgentId == agentId && v.CheckInAt >= from && v.CheckInAt < to)
                .Select(v => v.CheckInAt).ToListAsync(ct);
            int daysInMonth = DateTime.DaysInMonth(year, mon);
            var weeks = Enumerable.Range(0, (daysInMonth + 6) / 7).Select(w =>
            {
                int startDay = w * 7 + 1, endDay = Math.Min(startDay + 6, daysInMonth);
                int n = visitTimes.Count(t => { var d = AttendanceService.IstDate(t).Day; return d >= startDay && d <= endDay; });
                return new { label = $"{startDay}–{endDay}", visits = n };
            }).ToList();

            var shifts = await _db.Shifts.AsNoTracking().Where(s => s.AgentId == agentId && s.StartTime >= from && s.StartTime < to && s.EndTime != null)
                .Select(s => new { s.StartTime, s.EndTime }).ToListAsync(ct);
            int? avgShiftMinutes = shifts.Count == 0 ? null : (int)Math.Round(shifts.Average(s => (s.EndTime!.Value - s.StartTime).TotalMinutes));

            var todayStart = IstClock.TodayStartUtc;
            int overdue = await _db.Contacts.CountAsync(c => c.AgentId == agentId && !c.IsMerged && c.FollowUpDate != null && c.FollowUpDate < todayStart.AddDays(-3), ct);
            int dueToday = await _db.Contacts.CountAsync(c => c.AgentId == agentId && !c.IsMerged && c.FollowUpDate != null && c.FollowUpDate >= todayStart && c.FollowUpDate < todayStart.AddDays(1), ct);
            int skippedSurveys = await _db.SurveyResponses.CountAsync(s => s.AgentId == agentId && s.IsSkipped && s.CreatedAt >= from && s.CreatedAt < to, ct);

            var flags = new List<object>();
            if (overdue > 0) flags.Add(new { tone = "bad", text = $"{overdue} follow-up{(overdue == 1 ? "" : "s")} overdue by more than 3 days", link = $"/admin/partners?tab=follow" });
            if (dueToday > 0) flags.Add(new { tone = "warn", text = $"{dueToday} follow-up{(dueToday == 1 ? "" : "s")} due today", link = "/admin/partners?tab=follow" });
            if (cov.Total > cov.Visited) flags.Add(new { tone = "warn", text = $"{cov.Total - cov.Visited} of {cov.Total} panchayats not visited in 30 days", link = "/admin/coverage" });
            int absent = days.Count(d => d.Status == "absent");
            if (absent > 0) flags.Add(new { tone = "neutral", text = $"{absent} day{(absent == 1 ? "" : "s")} with no shift and no leave this month", link = "/admin/leave" });
            if (skippedSurveys > 0) flags.Add(new { tone = "neutral", text = $"Skipped the survey for {skippedSurveys} new contact{(skippedSurveys == 1 ? "" : "s")}", link = "/admin/surveys" });

            return Ok(new
            {
                agentId = a.AgentId,
                name = a.Name,
                phone = a.Phone,
                block = a.Block,
                district = a.District,
                role = a.Role,
                photoUrl = a.PhotoUrl,
                status = st.OnShift ? "shift" : st.OnLeave ? "leave" : "off",
                shiftStartedAt = st.ShiftStart,
                lastSeenAt = st.LastSeen,
                month = $"{year:D4}-{mon:D2}",
                perf = new
                {
                    visits = now.Visits, visitsPrev = prev.Visits,
                    partners = now.Partners, partnersPrev = prev.Partners,
                    surveys = now.Surveys, surveysPrev = prev.Surveys,
                    referrals = now.Referrals, referralsPrev = prev.Referrals,
                    admitted = now.Admitted, admittedPrev = prev.Admitted,
                },
                weeks,
                days = days.Select(d => new { date = d.Date.ToString("yyyy-MM-dd"), status = d.Status, leaveType = d.LeaveType }),
                attendance = new
                {
                    worked = days.Count(d => d.Status == "worked" || (d.Status == "today" && st.OnShift)),
                    absent,
                    leave = days.Count(d => d.Status == "leave"),
                    avgShiftMinutes,
                    leaveUsedYear = used,
                    leavePendingYear = pending,
                    allowance = _attendance.YearlyAllowance,
                },
                coverage = new { total = cov.Total, visited30 = cov.Visited },
                flags,
            });
        }

        private readonly record struct AgentNow(bool OnShift, bool OnLeave, DateTime? LastSeen, DateTime? ShiftStart);

        private async Task<Dictionary<string, AgentNow>> StatusAsync(List<string> ids, CancellationToken ct)
        {
            var todayStart = IstClock.TodayStartUtc;
            var today = AttendanceService.TodayIst;
            var open = await _db.Shifts.AsNoTracking().Where(s => ids.Contains(s.AgentId) && s.EndTime == null && s.StartTime >= todayStart.AddHours(-12))
                .GroupBy(s => s.AgentId).Select(g => new { g.Key, start = g.Max(s => s.StartTime) }).ToDictionaryAsync(x => x.Key, x => x.start, ct);
            var onLeave = (await _db.LeaveRequests.AsNoTracking()
                .Where(l => ids.Contains(l.AgentId) && l.Status == "approved" && l.FromDate <= today && l.ToDate >= today)
                .Select(l => l.AgentId).ToListAsync(ct)).ToHashSet();
            var since = DateTime.UtcNow.AddDays(-14);
            var seen = await _db.TrajectoryPoints.AsNoTracking().Where(t => ids.Contains(t.AgentId) && t.RecordedAt >= since)
                .GroupBy(t => t.AgentId).Select(g => new { g.Key, at = g.Max(t => t.RecordedAt) }).ToDictionaryAsync(x => x.Key, x => x.at, ct);
            return ids.ToDictionary(id => id, id => new AgentNow(
                open.ContainsKey(id), onLeave.Contains(id),
                seen.TryGetValue(id, out var s) ? s : null,
                open.TryGetValue(id, out var o) ? o : null));
        }
    }
}
