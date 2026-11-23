using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// A morning reminder on the Team board: each person gets one notification saying what of theirs is due today and
    /// what is late (kind <c>work_due</c>, which they can turn off). Sent once a day, between 9 and 12 in India.
    /// </summary>
    public class WorkReminders : BackgroundService
    {
        private readonly IServiceScopeFactory _scopes;
        private readonly ILogger<WorkReminders> _logger;
        private readonly OrgDirectory _orgs;
        public WorkReminders(IServiceScopeFactory scopes, ILogger<WorkReminders> logger, OrgDirectory orgs) { _scopes = scopes; _logger = logger; _orgs = orgs; }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            try { await Task.Delay(TimeSpan.FromMinutes(3), stoppingToken); } catch (OperationCanceledException) { return; }
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    var hour = IstClock.NowIst.Hour;
                    if (hour >= 9 && hour < 12)
                    {
                        await _orgs.ForEachAsync(async _ =>
                        {
                            using var scope = _scopes.CreateScope();
                            var sp = scope.ServiceProvider;
                            await SweepAsync(sp.GetRequiredService<IMarketingDbContext>(), sp.GetRequiredService<INotifier>(), AttendanceService.TodayIst, stoppingToken);
                        });
                    }
                }
                catch (Exception ex) when (ex is not OperationCanceledException) { _logger.LogDebug(ex, "Team board reminders failed"); }
                try { await Task.Delay(TimeSpan.FromMinutes(30), stoppingToken); } catch (OperationCanceledException) { return; }
            }
        }

        /// <summary>One person's reminder: how many are due today, how many are late, and the first few, most urgent first.</summary>
        public record Digest(string AgentId, int DueToday, int Late, List<string> Top)
        {
            public string Title => DueToday > 0 && Late > 0 ? $"{DueToday} due today and {Late} late on the Team board"
                : DueToday > 0 ? $"{DueToday} due today on the Team board" : $"{Late} late on the Team board";
            public string Body => string.Join(" · ", Top) + (DueToday + Late > Top.Count ? $" · and {DueToday + Late - Top.Count} more" : "");
        }

        public record DueCard(int Number, string Title, DateOnly Due, string Priority, List<string> Assignees);

        private static readonly Dictionary<string, int> Rank = new() { ["urgent"] = 0, ["high"] = 1, ["normal"] = 2, ["low"] = 3 };

        /// <summary>Groups open cards due today or earlier by the people on them.</summary>
        public static List<Digest> Digests(IEnumerable<DueCard> cards, DateOnly today) =>
            cards.Where(c => c.Due <= today)
                .SelectMany(c => c.Assignees.Distinct().Select(a => (a, c)))
                .GroupBy(x => x.a)
                .Select(g =>
                {
                    var list = g.Select(x => x.c).OrderBy(c => c.Due == today ? 1 : 0).ThenBy(c => Rank.GetValueOrDefault(c.Priority, 2)).ThenBy(c => c.Due).ToList();
                    return new Digest(g.Key, list.Count(c => c.Due == today), list.Count(c => c.Due < today),
                        list.Take(3).Select(c => $"#{c.Number} {(c.Title.Length > 50 ? c.Title[..50] + "…" : c.Title)}").ToList());
                })
                .OrderBy(d => d.AgentId)
                .ToList();

        public static async Task<int> SweepAsync(IMarketingDbContext db, INotifier notifier, DateOnly today, CancellationToken ct)
        {
            var rows = await db.WorkCards.AsNoTracking()
                .Where(c => !c.Archived && c.Status != "done" && c.Status != "idea" && c.DueDate != null && c.DueDate <= today && c.AssigneesJson != "[]")
                .Select(c => new { c.Number, c.Title, c.DueDate, c.Priority, c.AssigneesJson })
                .Take(2000).ToListAsync(ct);
            var digests = Digests(rows.Select(r => new DueCard(r.Number, r.Title, r.DueDate!.Value, r.Priority, Parse(r.AssigneesJson))), today);
            if (digests.Count == 0) return 0;
            var tag = $"due:{today:yyyy-MM-dd}";
            var ids = digests.Select(d => d.AgentId).ToList();
            var already = (await db.Notifications.AsNoTracking().Where(n => n.Kind == "work_due" && n.RefId == tag && ids.Contains(n.UserId)).Select(n => n.UserId).ToListAsync(ct)).ToHashSet();
            var sent = 0;
            foreach (var d in digests.Where(d => !already.Contains(d.AgentId)))
            {
                notifier.Notify(new NotifyJob { To = new() { d.AgentId }, Kind = "work_due", Title = d.Title, Body = d.Body, Link = "work-day", RefId = tag });
                sent++;
            }
            return sent;
        }

        private static List<string> Parse(string? j) { try { return JsonSerializer.Deserialize<List<string>>(j ?? "[]") ?? new(); } catch (JsonException) { return new(); } }
    }
}
