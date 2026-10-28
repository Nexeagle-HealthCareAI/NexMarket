using System;
using System.Collections.Generic;
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
    /// <summary>Command centre: today's numbers, the referral funnel, alerts, field force and live activity.</summary>
    [ApiController]
    [Authorize]
    [PageAccess(Pages.Dashboard)]
    [Route("api/v1/dashboard")]
    public class DashboardController : ControllerBase
    {
        private static readonly string[] AdmittedStatuses = { "admitted", "converted", "procedure", "discharged" };
        private static readonly string[] ArrivedStatuses = { "arrived", "opd", "admitted", "converted", "procedure", "discharged" };

        private readonly IMarketingDbContext _db;
        private readonly CallCycleService _cycles;
        private readonly IWhatsAppSender _wa;

        public DashboardController(IMarketingDbContext db, CallCycleService cycles, IWhatsAppSender wa)
        {
            _db = db;
            _cycles = cycles;
            _wa = wa;
        }

        [HttpGet("summary")]
        public async Task<IActionResult> Summary(CancellationToken ct)
        {
            var now = DateTime.UtcNow;
            var today = IstClock.TodayStartUtc;
            var month = IstClock.MonthStartUtc;
            var lastMonth = DateTime.SpecifyKind((IstClock.NowIst.AddMonths(-1)).Date, DateTimeKind.Utc);
            var lastMonthStart = DateTime.SpecifyKind(new DateTime(lastMonth.Year, lastMonth.Month, 1) - IstClock.Offset, DateTimeKind.Utc);

            // ─── Field force ───
            var agents = await _db.Agents.AsNoTracking().Where(a => a.IsActive).Select(a => new { a.AgentId, a.Name, a.Role, a.Block }).ToListAsync(ct);
            var fieldAgents = agents.Where(a => !RoleChecks.IsDashboardRole(a.Role)).ToList();
            var openShifts = await _db.Shifts.AsNoTracking().Where(s => s.EndTime == null && s.StartTime >= today.AddHours(-12)).Select(s => s.AgentId).Distinct().ToListAsync(ct);
            var visitsToday = await _db.Visits.AsNoTracking().Where(v => v.CheckInAt >= today).Select(v => new { v.AgentId, v.CheckOutAt }).ToListAsync(ct);
            var referralsTodayRows = await _db.Referrals.AsNoTracking().Where(r => r.CreatedAt >= today).Select(r => r.AgentId).ToListAsync(ct);
            var lastPoints = await _db.TrajectoryPoints.AsNoTracking().Where(t => t.RecordedAt >= today)
                .GroupBy(t => t.AgentId).Select(g => new { AgentId = g.Key, At = g.Max(t => t.RecordedAt) }).ToListAsync(ct);
            var lastPointMap = lastPoints.ToDictionary(p => p.AgentId, p => p.At);

            var fieldForce = fieldAgents.Select(a =>
            {
                bool onShift = openShifts.Contains(a.AgentId);
                bool onVisit = visitsToday.Any(v => v.AgentId == a.AgentId && v.CheckOutAt == null);
                DateTime? last = lastPointMap.TryGetValue(a.AgentId, out var lp) ? lp : null;
                string status = !onShift ? "Not checked in"
                    : onVisit ? "On visit"
                    : last.HasValue && (now - last.Value).TotalMinutes > 40 ? $"Idle {(int)(now - last.Value).TotalMinutes} min"
                    : "Travelling";
                string tone = !onShift ? "off" : status.StartsWith("Idle") ? "idle" : "on";
                return new
                {
                    a.AgentId, a.Name, a.Block, status, tone,
                    visits = visitsToday.Count(v => v.AgentId == a.AgentId),
                    referrals = referralsTodayRows.Count(r => r == a.AgentId),
                };
            })
            .OrderBy(a => a.tone == "on" ? 0 : a.tone == "idle" ? 1 : 2).ThenByDescending(a => a.visits)
            .ToList();

            // ─── Referral funnel (this month) ───
            var monthRefs = await _db.Referrals.AsNoTracking().Where(r => r.CreatedAt >= month).Select(r => r.Status).ToListAsync(ct);
            int referred = monthRefs.Count;
            int arrived = monthRefs.Count(s => ArrivedStatuses.Contains(s));
            int opd = monthRefs.Count(s => s == "opd" || AdmittedStatuses.Contains(s));
            int admitted = monthRefs.Count(s => AdmittedStatuses.Contains(s));
            int discharged = monthRefs.Count(s => s == "discharged");
            int lost = monthRefs.Count(s => s == "lost");
            int admittedLastMonth = await _db.Referrals.CountAsync(r => r.CreatedAt >= lastMonthStart && r.CreatedAt < month && AdmittedStatuses.Contains(r.Status), ct);

            // ─── Alerts ───
            var cutoff48 = now.AddHours(-48);
            int notArrived48 = await _db.Referrals.CountAsync(r => r.Status == "pending" && r.CreatedAt < cutoff48 && r.CreatedAt >= today.AddDays(-30), ct);
            int overdueFollowUps = await _cycles.Callable().CountAsync(c => c.NextCallAt != null && c.NextCallAt < today, ct);
            int needsVisit = await _db.Contacts.CountAsync(c => c.NeedsVisit && !c.IsMerged, ct);
            int openEscalations = await _db.Contacts.CountAsync(c => c.AgentEscalated && !c.IsEscalationResolved && !c.IsMerged, ct);

            // ─── Latest referrals ───
            var latest = await _db.Referrals.AsNoTracking().OrderByDescending(r => r.CreatedAt).Take(8)
                .Select(r => new { r.ClientId, r.PatientName, r.PatientAge, r.PatientSex, r.Department, r.ContactId, r.AgentId, r.Status, r.Urgent, r.CreatedAt })
                .ToListAsync(ct);
            var contactIds = latest.Select(r => r.ContactId).Distinct().ToList();
            var contacts = await _db.Contacts.AsNoTracking().Where(c => contactIds.Contains(c.ClientId))
                .Select(c => new { c.ClientId, c.Name, c.Role, c.PanchayatId }).ToListAsync(ct);
            var pids = contacts.Select(c => c.PanchayatId).Distinct().ToList();
            var blocks = await _db.Panchayats.AsNoTracking().Where(p => pids.Contains(p.PanchayatId)).ToDictionaryAsync(p => p.PanchayatId, p => p.Block, ct);
            var cmap = contacts.ToDictionary(c => c.ClientId);
            var nameMap = agents.ToDictionary(a => a.AgentId, a => a.Name);

            // ─── Top partners (90 days) ───
            var since90 = today.AddDays(-90);
            var partnerStats = await _db.Referrals.AsNoTracking().Where(r => r.CreatedAt >= since90)
                .GroupBy(r => r.ContactId)
                .Select(g => new { ContactId = g.Key, Referred = g.Count(), Admitted = g.Count(r => AdmittedStatuses.Contains(r.Status)) })
                .OrderByDescending(x => x.Admitted).ThenByDescending(x => x.Referred)
                .Take(5)
                .ToListAsync(ct);
            var topIds = partnerStats.Select(p => p.ContactId).ToList();
            var topContacts = await _db.Contacts.AsNoTracking().Where(c => topIds.Contains(c.ClientId))
                .ToDictionaryAsync(c => c.ClientId, c => new { c.Name, c.Role, c.IsImportant }, ct);

            // ─── Today's work ───
            var cycle = await _cycles.EnsureCurrentCycleAsync(ct);
            var endOfToday = CallCycleService.EndOfTodayUtc;
            int callsDue = await _cycles.Callable().CountAsync(c => c.NextCallAt == null || c.NextCallAt < endOfToday, ct);
            int callsDone = await _db.CallLogs.CountAsync(l => l.CreatedAt >= today, ct);
            int retryToday = await _cycles.Callable().CountAsync(c => c.LastCallOutcome == "no_answer" && c.NextCallAt != null && c.NextCallAt < endOfToday, ct);
            int cycleTotal = await _cycles.Callable().CountAsync(ct);
            int cycleCalled = await _db.CallLogs.Where(l => l.CycleNumber == cycle.Number).Select(l => l.ContactClientId).Distinct().CountAsync(ct);

            int expected = await _db.Referrals.CountAsync(r => r.Status == "pending" && r.CreatedAt >= today.AddDays(-7), ct);
            int arrivedToday = await _db.Referrals.CountAsync(r => r.ArrivedAt >= today, ct);

            var payments = await _db.PartnerPayments.AsNoTracking().Where(p => p.Status == "approved" || p.Status == "pending_approval")
                .Select(p => new { p.Status, p.Amount, p.ApprovedAt, p.DueDate }).ToListAsync(ct);
            var overdueBefore = now.AddDays(-7);

            var lastBroadcast = await _db.Broadcasts.AsNoTracking().Where(b => b.Status == "sent").OrderByDescending(b => b.SentAt)
                .Select(b => new { b.Title, b.SentCount, b.ReadCount, b.ReplyCount }).FirstOrDefaultAsync(ct);
            int scheduledBroadcasts = await _db.Broadcasts.CountAsync(b => b.Status == "scheduled", ct);

            return Ok(new
            {
                generatedAt = now,
                kpis = new
                {
                    agentsOnShift = openShifts.Count(id => fieldAgents.Any(a => a.AgentId == id)),
                    totalAgents = fieldAgents.Count,
                    visitsToday = visitsToday.Count,
                    referralsToday = referralsTodayRows.Count,
                    arrivedMonth = arrived,
                    admissionsMonth = admitted,
                    admissionsLastMonth = admittedLastMonth,
                },
                funnel = new[]
                {
                    new { stage = "Referred", count = referred },
                    new { stage = "Arrived", count = arrived },
                    new { stage = "Seen in OPD", count = opd },
                    new { stage = "Admitted", count = admitted },
                    new { stage = "Discharged", count = discharged },
                },
                lost,
                alerts = new
                {
                    notArrived48,
                    overdueFollowUps,
                    needsVisit,
                    openEscalations,
                },
                latestReferrals = latest.Select(r =>
                {
                    cmap.TryGetValue(r.ContactId, out var c);
                    return new
                    {
                        r.ClientId, r.PatientName, r.PatientAge, r.PatientSex, r.Department, r.Urgent, r.CreatedAt,
                        status = r.Status == "converted" ? "admitted" : r.Status,
                        stageLabel = ReferralsController.StageLabel(r.Status),
                        waitingHours = r.Status == "pending" ? (int)(now - r.CreatedAt).TotalHours : 0,
                        partner = c?.Name, partnerType = c?.Role,
                        block = c != null ? blocks.GetValueOrDefault(c.PanchayatId) : null,
                        agent = nameMap.GetValueOrDefault(r.AgentId, r.AgentId),
                    };
                }),
                topPartners = partnerStats.Select(p => new
                {
                    clientId = p.ContactId,
                    name = topContacts.TryGetValue(p.ContactId, out var tc) ? tc.Name : "Unknown partner",
                    type = topContacts.TryGetValue(p.ContactId, out var tc2) ? tc2.Role : null,
                    important = topContacts.TryGetValue(p.ContactId, out var tc3) && tc3.IsImportant,
                    referred = p.Referred,
                    admitted = p.Admitted,
                }),
                fieldForce,
                work = new
                {
                    calls = new { cycle = cycle.Number, due = callsDue, done = callsDone, retry = retryToday, cycleTotal, cycleCalled },
                    desk = new { expected, arrivedToday, late = notArrived48 },
                    payments = new
                    {
                        toPay = payments.Where(p => p.Status == "approved").Sum(p => p.Amount),
                        waitingApproval = payments.Where(p => p.Status == "pending_approval").Sum(p => p.Amount),
                        overdue = payments.Count(p => p.Status == "approved" && (p.DueDate ?? p.ApprovedAt ?? now) < overdueBefore),
                    },
                    whatsapp = new
                    {
                        connected = _wa.IsConfigured,
                        scheduled = scheduledBroadcasts,
                        lastTitle = lastBroadcast?.Title,
                        lastReadPct = lastBroadcast != null && lastBroadcast.SentCount > 0 ? (int)Math.Round(100.0 * lastBroadcast.ReadCount / lastBroadcast.SentCount) : (int?)null,
                        lastReplies = lastBroadcast?.ReplyCount,
                    },
                },
            });
        }

        /// <summary>Recent activity for the live feed, newest first (the live hub streams new items after this).</summary>
        [HttpGet("activity")]
        public async Task<IActionResult> Activity([FromQuery] int take = 20, CancellationToken ct = default)
        {
            take = Math.Clamp(take, 5, 50);
            var since = DateTime.UtcNow.AddDays(-2);
            var items = new List<(string kind, string text, DateTime at)>();

            var agents = await _db.Agents.AsNoTracking().ToDictionaryAsync(a => a.AgentId, a => a.Name, ct);
            string Who(string id) => agents.GetValueOrDefault(id, id);

            var visits = await _db.Visits.AsNoTracking().Where(v => v.CheckInAt >= since).OrderByDescending(v => v.CheckInAt).Take(take)
                .Select(v => new { v.AgentId, v.PanchayatId, v.CheckInAt }).ToListAsync(ct);
            var vp = visits.Select(v => v.PanchayatId).Distinct().ToList();
            var pNames = await _db.Panchayats.AsNoTracking().Where(p => vp.Contains(p.PanchayatId)).ToDictionaryAsync(p => p.PanchayatId, p => p.Name, ct);
            items.AddRange(visits.Select(v => ("visit", $"{Who(v.AgentId)} checked in at {pNames.GetValueOrDefault(v.PanchayatId, "a panchayat")}", v.CheckInAt)));

            var refs = await _db.Referrals.AsNoTracking().Where(r => r.CreatedAt >= since).OrderByDescending(r => r.CreatedAt).Take(take)
                .Select(r => new { r.PatientName, r.Department, r.AgentId, r.CreatedAt }).ToListAsync(ct);
            items.AddRange(refs.Select(r => ("referral", $"New referral: {r.PatientName}{(string.IsNullOrEmpty(r.Department) ? "" : " → " + r.Department)}, by {Who(r.AgentId)}", r.CreatedAt)));

            var stageChanges = await _db.ReferralStatusEntries.AsNoTracking().Where(e => e.ChangedAt >= since).OrderByDescending(e => e.ChangedAt).Take(take).ToListAsync(ct);
            var scIds = stageChanges.Select(e => e.ReferralClientId).Distinct().ToList();
            var scNames = await _db.Referrals.AsNoTracking().Where(r => scIds.Contains(r.ClientId)).ToDictionaryAsync(r => r.ClientId, r => r.PatientName, ct);
            items.AddRange(stageChanges.Select(e => (
                e.Status == "arrived" ? "arrived" : e.Status == "admitted" || e.Status == "procedure" ? "admit" : e.Status == "lost" ? "lost" : "referral",
                $"{scNames.GetValueOrDefault(e.ReferralClientId, "A patient")} marked {ReferralsController.StageLabel(e.Status).ToLower()}",
                e.ChangedAt)));

            var contacts = await _db.Contacts.AsNoTracking().Where(c => c.CreatedAt >= since && !c.IsMerged).OrderByDescending(c => c.CreatedAt).Take(take)
                .Select(c => new { c.Name, c.AgentId, c.CreatedAt }).ToListAsync(ct);
            items.AddRange(contacts.Select(c => ("partner", $"{Who(c.AgentId)} added a partner: {c.Name}", c.CreatedAt)));

            var calls = await _db.CallLogs.AsNoTracking().Where(l => l.CreatedAt >= since).OrderByDescending(l => l.CreatedAt).Take(take).ToListAsync(ct);
            var callIds = calls.Select(l => l.ContactClientId).Distinct().ToList();
            var callNames = await _db.Contacts.AsNoTracking().Where(c => callIds.Contains(c.ClientId)).ToDictionaryAsync(c => c.ClientId, c => c.Name, ct);
            items.AddRange(calls.Select(l => ("call",
                $"Call to {callNames.GetValueOrDefault(l.ContactClientId, "a partner")}: {(l.Outcome == "connected" ? "connected" : l.Outcome == "no_answer" ? "not reachable" : l.Outcome == "call_later" ? "call back later" : "wrong number")}",
                l.CreatedAt)));

            var shifts = await _db.Shifts.AsNoTracking().Where(s => s.StartTime >= since).OrderByDescending(s => s.StartTime).Take(take)
                .Select(s => new { s.AgentId, s.StartTime }).ToListAsync(ct);
            items.AddRange(shifts.Select(s => ("shift", $"{Who(s.AgentId)} started a shift", s.StartTime)));

            return Ok(items.OrderByDescending(i => i.at).Take(take).Select(i => new { kind = i.kind, text = i.text, at = i.at }));
        }
    }
}
