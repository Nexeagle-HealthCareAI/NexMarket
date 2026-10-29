using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.SeedData;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// The business numbers behind the Analytics page and the AI analyst: how referrals turn into
    /// admissions, where they come from, what partners cost. Everything is aggregated — no phone
    /// numbers or patient names — so the same figures can be shown on screen or sent to the analyst.
    /// </summary>
    public class BusinessData
    {
        public static readonly string[] ArrivedStatuses = { "arrived", "opd", "admitted", "converted", "procedure", "discharged" };
        public static readonly string[] AdmittedStatuses = { "admitted", "converted", "procedure", "discharged" };

        private readonly IMarketingDbContext _db;
        public BusinessData(IMarketingDbContext db) => _db = db;

        public sealed record Ref(string ContactId, string AgentId, string Department, string Status, DateTime CreatedAt, DateTime? ArrivedAt, bool Urgent)
        {
            public bool Arrived => ArrivedAt != null || ArrivedStatuses.Contains(Status);
            public bool Admitted => AdmittedStatuses.Contains(Status);
        }
        public sealed record Partner(string Name, string Role, string PanchayatId, string AgentId, bool Champion, DateTime CreatedAt);
        public sealed record Place(string Name, string Block, string District);

        /// <summary>Everything loaded once so several views can be cut from it.</summary>
        public sealed class Snapshot
        {
            public DateTime From, To, PrevFrom;
            public List<Ref> Refs = new();          // from the earliest month in the trend up to To
            public Dictionary<string, Partner> Partners = new();
            public Dictionary<string, Place> Places = new();
            public Dictionary<string, string> Agents = new();
            public List<(string ContactId, decimal Amount, string Status, DateTime? PaidAt, DateTime CreatedAt)> Payments = new();
            public IEnumerable<Ref> InPeriod => Refs.Where(r => r.CreatedAt >= From && r.CreatedAt < To);
            public IEnumerable<Ref> InPrev => Refs.Where(r => r.CreatedAt >= PrevFrom && r.CreatedAt < From);
            public string BlockOf(string contactId) =>
                Partners.TryGetValue(contactId, out var p) && Places.TryGetValue(p.PanchayatId, out var pl) ? pl.Block : "Unknown";
        }

        public static (DateTime From, DateTime To) Days(int days)
        {
            var to = IstClock.TodayStartUtc.AddDays(1);
            return (to.AddDays(-Math.Clamp(days, 1, 730)), to);
        }

        public async Task<Snapshot> LoadAsync(DateTime from, DateTime to, CancellationToken ct)
        {
            var s = new Snapshot { From = from, To = to, PrevFrom = from - (to - from) };
            var trendStart = AttendanceService.StartUtc(new DateOnly(IstClock.NowIst.Year, IstClock.NowIst.Month, 1).AddMonths(-5));
            var earliest = new[] { trendStart, s.PrevFrom }.Min();

            s.Refs = (await _db.Referrals.AsNoTracking().Where(r => r.CreatedAt >= earliest && r.CreatedAt < to)
                    .Select(r => new { r.ContactId, r.AgentId, r.Department, r.Status, r.CreatedAt, r.ArrivedAt, r.Urgent }).ToListAsync(ct))
                .Select(r => new Ref(r.ContactId ?? "", r.AgentId ?? "", string.IsNullOrWhiteSpace(r.Department) ? "Not given" : r.Department.Trim(), r.Status ?? "pending", r.CreatedAt, r.ArrivedAt, r.Urgent)).ToList();

            s.Partners = (await _db.Contacts.AsNoTracking().Where(c => !c.IsMerged)
                    .Select(c => new { c.ClientId, c.Name, c.Role, c.PanchayatId, c.AgentId, c.IsChampion, c.CreatedAt }).ToListAsync(ct))
                .GroupBy(c => c.ClientId).ToDictionary(g => g.Key, g => { var c = g.First(); return new Partner(c.Name, c.Role, c.PanchayatId, c.AgentId, c.IsChampion, c.CreatedAt); });
            s.Places = (await _db.Panchayats.AsNoTracking().Select(p => new { p.PanchayatId, p.Name, p.Block, p.District }).ToListAsync(ct))
                .GroupBy(p => p.PanchayatId).ToDictionary(g => g.Key, g => new Place(g.First().Name, g.First().Block, g.First().District));
            s.Agents = (await _db.Agents.AsNoTracking().Select(a => new { a.AgentId, a.Name }).ToListAsync(ct))
                .GroupBy(a => a.AgentId).ToDictionary(g => g.Key, g => g.First().Name);
            s.Payments = (await _db.PartnerPayments.AsNoTracking().Where(p => p.Status != "rejected")
                    .Select(p => new { p.ContactClientId, p.Amount, p.Status, p.PaidAt, p.CreatedAt }).ToListAsync(ct))
                .Select(p => (p.ContactClientId, p.Amount, p.Status, p.PaidAt, p.CreatedAt)).ToList();
            return s;
        }

        private static object Funnel(IEnumerable<Ref> refs)
        {
            var list = refs.ToList();
            return new
            {
                referred = list.Count,
                arrived = list.Count(r => r.Arrived),
                admitted = list.Count(r => r.Admitted),
                discharged = list.Count(r => r.Status == "discharged"),
                lost = list.Count(r => r.Status == "lost"),
                waiting = list.Count(r => r.Status == "pending"),
                urgent = list.Count(r => r.Urgent),
            };
        }

        public object Overview(Snapshot s)
        {
            var now = s.InPeriod.ToList();
            var prev = s.InPrev.ToList();
            decimal paid = s.Payments.Where(p => p.Status == "paid" && p.PaidAt >= s.From && p.PaidAt < s.To).Sum(p => p.Amount);
            decimal owed = s.Payments.Where(p => p.Status is "pending_approval" or "approved").Sum(p => p.Amount);
            int admitted = now.Count(r => r.Admitted);

            var months = Enumerable.Range(0, 6).Select(i =>
            {
                var m = new DateOnly(IstClock.NowIst.Year, IstClock.NowIst.Month, 1).AddMonths(i - 5);
                var a = AttendanceService.StartUtc(m);
                var b = AttendanceService.StartUtc(m.AddMonths(1));
                var rs = s.Refs.Where(r => r.CreatedAt >= a && r.CreatedAt < b).ToList();
                return new { month = m.ToString("yyyy-MM"), referred = rs.Count, arrived = rs.Count(r => r.Arrived), admitted = rs.Count(r => r.Admitted) };
            }).ToList();

            return new
            {
                from = s.From,
                to = s.To,
                days = (int)Math.Round((s.To - s.From).TotalDays),
                now = Funnel(now),
                previous = Funnel(prev),
                activePartners = now.Select(r => r.ContactId).Where(id => id != "").Distinct().Count(),
                activePartnersPrev = prev.Select(r => r.ContactId).Where(id => id != "").Distinct().Count(),
                newPartners = s.Partners.Values.Count(p => p.CreatedAt >= s.From && p.CreatedAt < s.To),
                totalPartners = s.Partners.Count,
                paidToPartners = paid,
                owedToPartners = owed,
                costPerAdmission = admitted == 0 ? 0 : Math.Round(paid / admitted, 0),
                months,
            };
        }

        /// <summary>Referrals cut by block, partner type, agent or department.</summary>
        public List<BreakdownRow> Breakdown(Snapshot s, string by, int limit = 50)
        {
            string Key(Ref r) => by switch
            {
                "type" => s.Partners.TryGetValue(r.ContactId, out var p) ? p.Role : "unknown",
                "agent" => s.Agents.GetValueOrDefault(r.AgentId) ?? (r.AgentId == "" ? "Unknown" : r.AgentId),
                "department" => r.Department,
                _ => s.BlockOf(r.ContactId),
            };
            var paidBy = s.Payments.Where(p => p.Status == "paid" && p.PaidAt >= s.From && p.PaidAt < s.To)
                .GroupBy(p => by switch
                {
                    "type" => s.Partners.TryGetValue(p.ContactId, out var c) ? c.Role : "unknown",
                    "agent" => s.Partners.TryGetValue(p.ContactId, out var c2) ? s.Agents.GetValueOrDefault(c2.AgentId) ?? c2.AgentId : "Unknown",
                    "department" => "",
                    _ => s.BlockOf(p.ContactId),
                }).ToDictionary(g => g.Key, g => g.Sum(x => x.Amount));
            var prev = s.InPrev.GroupBy(Key).ToDictionary(g => g.Key, g => g.Count(r => r.Admitted));
            return s.InPeriod.GroupBy(Key).Select(g => new BreakdownRow
            {
                Name = g.Key,
                Referred = g.Count(),
                Arrived = g.Count(r => r.Arrived),
                Admitted = g.Count(r => r.Admitted),
                Lost = g.Count(r => r.Status == "lost"),
                AdmittedPrev = prev.GetValueOrDefault(g.Key),
                Paid = paidBy.GetValueOrDefault(g.Key),
                Partners = g.Select(r => r.ContactId).Distinct().Count(),
            }).OrderByDescending(r => r.Admitted).ThenByDescending(r => r.Referred).Take(limit).ToList();
        }

        public class BreakdownRow
        {
            public string Name { get; set; } = "";
            public int Referred { get; set; }
            public int Arrived { get; set; }
            public int Admitted { get; set; }
            public int Lost { get; set; }
            public int AdmittedPrev { get; set; }
            public decimal Paid { get; set; }
            public int Partners { get; set; }
        }

        public object TopPartners(Snapshot s, int limit = 10)
        {
            var paid = s.Payments.Where(p => p.Status == "paid" && p.PaidAt >= s.From && p.PaidAt < s.To)
                .GroupBy(p => p.ContactId).ToDictionary(g => g.Key, g => g.Sum(x => x.Amount));
            return s.InPeriod.Where(r => s.Partners.ContainsKey(r.ContactId)).GroupBy(r => r.ContactId)
                .Select(g =>
                {
                    var p = s.Partners[g.Key];
                    var pl = s.Places.GetValueOrDefault(p.PanchayatId);
                    return new
                    {
                        clientId = g.Key,
                        name = p.Name,
                        type = p.Role,
                        panchayat = pl?.Name,
                        block = pl?.Block,
                        champion = p.Champion,
                        referred = g.Count(),
                        admitted = g.Count(r => r.Admitted),
                        paid = paid.GetValueOrDefault(g.Key),
                    };
                })
                .OrderByDescending(x => x.admitted).ThenByDescending(x => x.referred).Take(limit).ToList();
        }

        /// <summary>Partners who used to send patients but sent none in the period.</summary>
        public object GoneQuiet(Snapshot s, int limit = 15)
        {
            var active = s.InPeriod.Select(r => r.ContactId).ToHashSet();
            return s.Refs.Where(r => r.CreatedAt < s.From && !active.Contains(r.ContactId) && s.Partners.ContainsKey(r.ContactId))
                .GroupBy(r => r.ContactId)
                .Select(g =>
                {
                    var p = s.Partners[g.Key];
                    var pl = s.Places.GetValueOrDefault(p.PanchayatId);
                    return new { clientId = g.Key, name = p.Name, type = p.Role, block = pl?.Block, champion = p.Champion, earlierReferrals = g.Count(), lastReferral = g.Max(r => r.CreatedAt) };
                })
                .OrderByDescending(x => x.earlierReferrals).Take(limit).ToList();
        }

        /// <summary>Field-work figures for the period: coverage, follow-ups, attendance-free counts.</summary>
        public async Task<object> FieldAsync(Snapshot s, CancellationToken ct)
        {
            var visits = await _db.Visits.AsNoTracking().Where(v => v.CheckInAt >= s.From && v.CheckInAt < s.To)
                .Select(v => new { v.AgentId, v.PanchayatId }).ToListAsync(ct);
            var inScope = await _db.Panchayats.AsNoTracking().Where(p => p.IsActiveForMarketing).Select(p => new { p.PanchayatId, p.Block }).ToListAsync(ct);
            var visited = visits.Select(v => v.PanchayatId).ToHashSet();
            var todayStart = IstClock.TodayStartUtc;
            int overdue = await _db.Contacts.CountAsync(c => !c.IsMerged && c.FollowUpDate != null && c.FollowUpDate < todayStart, ct);
            int escalations = await _db.Contacts.CountAsync(c => !c.IsMerged && c.AgentEscalated && !c.IsEscalationResolved, ct);
            int pendingLeave = await _db.LeaveRequests.CountAsync(l => l.Status == "pending", ct);

            var byBlock = inScope.GroupBy(p => p.Block).Select(g => new
            {
                block = g.Key,
                panchayats = g.Count(),
                visited = g.Count(p => visited.Contains(p.PanchayatId)),
            }).OrderBy(b => b.panchayats == 0 ? 1 : (double)b.visited / b.panchayats).ToList();

            var byAgent = visits.GroupBy(v => v.AgentId).Select(g => new
            {
                agent = s.Agents.GetValueOrDefault(g.Key) ?? g.Key,
                visits = g.Count(),
                panchayats = g.Select(v => v.PanchayatId).Distinct().Count(),
                newPartners = s.Partners.Values.Count(p => p.AgentId == g.Key && p.CreatedAt >= s.From && p.CreatedAt < s.To),
            }).OrderByDescending(a => a.visits).ToList();

            return new
            {
                panchayatsInScope = inScope.Count,
                panchayatsVisited = inScope.Count(p => visited.Contains(p.PanchayatId)),
                visits = visits.Count,
                overdueFollowUps = overdue,
                openEscalations = escalations,
                pendingLeaveRequests = pendingLeave,
                leastCoveredBlocks = byBlock.Take(8),
                agents = byAgent,
            };
        }

        /// <summary>What the six survey questions say across the region (or one block).</summary>
        public async Task<object> SurveyNeedsAsync(string? block, CancellationToken ct)
        {
            var q = _db.SurveyResponses.AsNoTracking().Where(r => !r.IsSkipped);
            if (!string.IsNullOrWhiteSpace(block))
            {
                var ids = _db.Panchayats.Where(p => p.Block == block).Select(p => p.PanchayatId);
                q = q.Where(r => r.PanchayatId != null && ids.Contains(r.PanchayatId));
            }
            var rows = await q.OrderByDescending(r => r.CreatedAt).Take(3000).Select(r => r.AnswersJson).ToListAsync(ct);
            var asked = await SurveyCore.ActiveAsync(_db, ct);
            var titles = asked.ToDictionary(x => x.QuestionId, SurveyCore.Title);
            var result = new Dictionary<string, Dictionary<string, int>>();
            foreach (var json in rows)
            {
                Dictionary<string, JsonElement>? d;
                try { d = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json); } catch (JsonException) { continue; }
                if (d == null) continue;
                foreach (var qid in titles.Keys)
                {
                    if (!d.TryGetValue(qid, out var el)) continue;
                    var vals = el.ValueKind == JsonValueKind.Array ? el.EnumerateArray().Select(x => x.ToString()) : new[] { el.ToString() };
                    var bucket = result.TryGetValue(qid, out var b) ? b : result[qid] = new Dictionary<string, int>();
                    foreach (var v in vals.Where(v => !string.IsNullOrWhiteSpace(v)))
                    {
                        var label = Controllers.GeoController.ShortLabel(v);
                        bucket[label] = bucket.GetValueOrDefault(label) + 1;
                    }
                }
            }
            return new
            {
                responses = rows.Count,
                block,
                questions = result.Select(kv => new
                {
                    question = titles[kv.Key],
                    top = kv.Value.OrderByDescending(x => x.Value).Take(5).Select(x => new { answer = x.Key, count = x.Value }),
                }),
            };
        }
    
        /// <summary>How well the survey is being done: answers per block, skips and missed surveys per agent.</summary>
        public async Task<object> SurveyCoverageAsync(CancellationToken ct)
        {
            var since = DateTime.UtcNow.AddDays(-30);
            var resp = await _db.SurveyResponses.AsNoTracking()
                .Select(r => new { r.PanchayatId, r.AgentId, r.ContactId, r.IsSkipped, r.CreatedAt }).ToListAsync(ct);
            var places = await _db.Panchayats.AsNoTracking().Where(p => p.IsActiveForMarketing).Select(p => new { p.PanchayatId, p.Block, p.District }).ToListAsync(ct);
            var blockOf = places.ToDictionary(p => p.PanchayatId, p => p.Block);
            var agents = (await _db.Agents.AsNoTracking().Select(a => new { a.AgentId, a.Name }).ToListAsync(ct)).GroupBy(a => a.AgentId).ToDictionary(g => g.Key, g => g.First().Name);
            var surveyed = resp.Where(r => r.ContactId != null).Select(r => r.ContactId!).ToHashSet();
            var newContacts = await _db.Contacts.AsNoTracking().Where(c => !c.IsMerged && c.CreatedAt >= since).Select(c => new { c.ClientId, c.AgentId }).ToListAsync(ct);

            var byBlock = places.GroupBy(p => p.Block).Select(g =>
            {
                var ids = g.Select(p => p.PanchayatId).ToHashSet();
                var rs = resp.Where(r => !r.IsSkipped && r.PanchayatId != null && ids.Contains(r.PanchayatId)).ToList();
                return new
                {
                    block = g.Key,
                    district = g.First().District,
                    panchayats = ids.Count,
                    panchayatsSurveyed = rs.Select(r => r.PanchayatId).Distinct().Count(),
                    responses = rs.Count,
                    last30Days = rs.Count(r => r.CreatedAt >= since),
                };
            }).OrderByDescending(b => b.responses).ToList();

            var byAgent = resp.Where(r => r.CreatedAt >= since).GroupBy(r => r.AgentId).Select(g => new
            {
                agent = agents.GetValueOrDefault(g.Key) ?? g.Key,
                answered = g.Count(r => !r.IsSkipped),
                skipped = g.Count(r => r.IsSkipped),
                newContactsWithoutSurvey = newContacts.Count(c => c.AgentId == g.Key && !surveyed.Contains(c.ClientId)),
            }).OrderByDescending(a => a.skipped + a.newContactsWithoutSurvey).ToList();

            return new
            {
                responsesTotal = resp.Count(r => !r.IsSkipped),
                responsesLast30Days = resp.Count(r => !r.IsSkipped && r.CreatedAt >= since),
                skippedLast30Days = resp.Count(r => r.IsSkipped && r.CreatedAt >= since),
                newContactsLast30Days = newContacts.Count,
                newContactsWithoutSurvey = newContacts.Count(c => !surveyed.Contains(c.ClientId)),
                panchayatsInScope = places.Count,
                panchayatsSurveyed = resp.Where(r => !r.IsSkipped && r.PanchayatId != null && blockOf.ContainsKey(r.PanchayatId)).Select(r => r.PanchayatId).Distinct().Count(),
                // Keep this compact: it goes to the AI, whose free plan allows few tokens a minute.
                byBlock = byBlock.Where(b => b.responses > 0).Take(15),
                blocksWithNoSurveys = byBlock.Where(b => b.responses == 0).Select(b => b.block),
                byAgent = byAgent.Take(12),
            };
        }
}
}
