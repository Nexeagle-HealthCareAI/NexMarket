using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// Runs every two minutes and does two things nobody should have to remember:
    /// <list type="bullet">
    /// <item>Reminds the desk about new leads nobody has contacted within the reply target (WhatsApp → Automation), and
    /// tells the managers if one is still waiting after an hour.</item>
    /// <item>Tells Meta how far each Facebook/Instagram form lead got (contacted, appointment, arrived, admitted), so the
    /// ads learn to find people who actually come to the hospital (Conversions API for CRM).</item>
    /// </list>
    /// </summary>
    public class LeadSignals : BackgroundService
    {
        private static readonly TimeSpan Every = TimeSpan.FromMinutes(2);
        private readonly IServiceScopeFactory _scopes;
        private readonly ILogger<LeadSignals> _log;

        public LeadSignals(IServiceScopeFactory scopes, ILogger<LeadSignals> log)
        {
            _scopes = scopes;
            _log = log;
        }

        protected override async Task ExecuteAsync(CancellationToken stop)
        {
            await Task.Delay(TimeSpan.FromSeconds(30), stop); // let the app start first
            while (!stop.IsCancellationRequested)
            {
                try { using var scope = _scopes.CreateScope(); await RemindAsync(scope.ServiceProvider, stop); }
                catch (Exception ex) when (ex is not OperationCanceledException) { _log.LogError(ex, "Lead reminders failed"); }
                try { using var scope = _scopes.CreateScope(); await ReportStagesAsync(scope.ServiceProvider, stop); }
                catch (Exception ex) when (ex is not OperationCanceledException) { _log.LogError(ex, "Sending lead stages to Meta failed"); }
                await Task.Delay(Every, stop);
            }
        }

        // ─── Reply reminders ───

        public const string FirstReminder = "sla1", ManagerReminder = "sla2";

        private static async Task RemindAsync(IServiceProvider sp, CancellationToken ct)
        {
            var db = sp.GetRequiredService<IMarketingDbContext>();
            var settings = sp.GetRequiredService<IAppSettings>();
            var perms = sp.GetRequiredService<IPermissionService>();
            var notifier = sp.GetRequiredService<INotifier>();
            var rules = WaAutomation.Load(settings);
            var now = DateTime.UtcNow;
            // Outside office hours nobody is there to call; the reminders go out when the desk opens.
            if (!rules.InOfficeHours(now)) return;

            var target = Math.Max(1, rules.ReplyTargetMinutes);
            var managerAfter = Math.Max(60, target * 4);
            var oldest = now.AddDays(-2);
            var waiting = await db.Leads.Where(l => l.Status == "new" && l.FirstResponseAt == null && l.CreatedAt < now.AddMinutes(-target) && l.CreatedAt > oldest)
                .OrderBy(l => l.CreatedAt).Take(100).ToListAsync(ct);
            if (waiting.Count == 0) return;

            var ids = waiting.Select(l => l.Id).ToList();
            var sent = await db.LeadActivities.AsNoTracking().Where(a => ids.Contains(a.LeadId) && (a.Kind == FirstReminder || a.Kind == ManagerReminder))
                .Select(a => new { a.LeadId, a.Kind }).ToListAsync(ct);
            List<string>? desk = null, managers = null;

            foreach (var l in waiting)
            {
                var mins = (int)(now - l.CreatedAt).TotalMinutes;
                var had1 = sent.Any(s => s.LeadId == l.Id && s.Kind == FirstReminder);
                var had2 = sent.Any(s => s.LeadId == l.Id && s.Kind == ManagerReminder);
                var src = LeadInbox.SourceLabel(l.Source);
                if (!had1)
                {
                    var to = l.OwnerId != null ? new List<string> { l.OwnerId } : desk ??= await LeadInbox.DeskPeopleAsync(db, perms, ct);
                    notifier.Notify(new NotifyJob
                    {
                        To = to, Kind = "lead", Title = $"Not contacted yet: {l.Name}",
                        Body = $"{src} lead waiting {Waited(mins)}. Call or message them now.", Link = $"lead:{l.Id}", RefId = l.Id.ToString(),
                    });
                    db.LeadActivities.Add(new LeadActivity { LeadId = l.Id, Kind = FirstReminder, CreatedAt = now, Text = $"Reminder sent: waiting {Waited(mins)} without a reply (target {target} min)" });
                }
                else if (!had2 && mins >= managerAfter)
                {
                    managers ??= await db.Agents.AsNoTracking().Where(a => a.IsActive && (a.Role == RoleChecks.Admin || a.Role == RoleChecks.MarketingManager)).Select(a => a.AgentId).ToListAsync(ct);
                    if (managers.Count == 0) continue;
                    var owner = l.OwnerId != null ? await db.Agents.AsNoTracking().Where(a => a.AgentId == l.OwnerId).Select(a => a.Name).FirstOrDefaultAsync(ct) : null;
                    notifier.Notify(new NotifyJob
                    {
                        To = managers, Kind = "lead", Title = $"Still waiting: {l.Name}",
                        Body = $"{src} lead, {Waited(mins)} and nobody has contacted them{(owner != null ? $" ({owner} has it)" : "")}.", Link = $"lead:{l.Id}", RefId = l.Id.ToString(),
                    });
                    db.LeadActivities.Add(new LeadActivity { LeadId = l.Id, Kind = ManagerReminder, CreatedAt = now, Text = $"Managers told: still no reply after {Waited(mins)}" });
                }
            }
            await db.SaveChangesAsync(ct);
        }

        private static string Waited(int mins) => mins < 90 ? $"{mins} min" : mins < 2880 ? $"{mins / 60} h {mins % 60} min" : $"{mins / 1440} days";

        // ─── Lead stages back to Meta ───

        /// <summary>
        /// CRM stages in order, with the neutral event name Meta sees. Nothing medical goes to Meta: "came to the hospital"
        /// and "admitted" are both just "Converted", and the department, doctor and notes never leave the CRM.
        /// </summary>
        public static readonly (string Status, string Event)[] Stages =
        {
            ("contacted", "Contacted"), ("appointment", "Qualified"), ("arrived", "Converted"),
        };

        public static int Rank(string? status) => status switch { "contacted" => 1, "appointment" => 2, "arrived" or "admitted" => 3, _ => 0 };

        private static async Task ReportStagesAsync(IServiceProvider sp, CancellationToken ct)
        {
            var settings = sp.GetRequiredService<IAppSettings>();
            var cfg = MetaConfig.Load(settings);
            if (string.IsNullOrWhiteSpace(cfg.DatasetId) || string.IsNullOrWhiteSpace(cfg.AccessToken)) return;
            var db = sp.GetRequiredService<IMarketingDbContext>();
            var graph = sp.GetRequiredService<MetaGraph>();
            var now = DateTime.UtcNow;
            var retryAfter = now.AddHours(-1);
            var since = now.AddDays(-90);

            var rows = await (from a in db.AdLeads
                              join l in db.Leads on a.LeadId equals (Guid?)l.Id
                              where a.CreatedAt > since && a.StageSent != l.Status && (a.StageError == null || a.StageSentAt < retryAfter)
                                    && (l.Status == "contacted" || l.Status == "appointment" || l.Status == "arrived" || l.Status == "admitted")
                              select new { Ad = a, l.Status, l.Phone }).Take(400).ToListAsync(ct);
            // Arrived → admitted is the same step for Meta: just note it, nothing to send.
            var same = rows.Where(r => Rank(r.Status) <= Rank(r.Ad.StageSent)).ToList();
            foreach (var r in same) r.Ad.StageSent = r.Status;
            var due = rows.Where(r => Rank(r.Status) > Rank(r.Ad.StageSent)).Take(50).ToList();
            if (due.Count == 0) { if (same.Count > 0) await db.SaveChangesAsync(ct); return; }

            // One event per stage the lead has passed since the last report (Meta builds the funnel from them).
            var events = new List<object>();
            foreach (var r in due)
            {
                if (!long.TryParse(r.Ad.LeadgenId, out var leadId)) continue;
                var ph = Sha256(r.Phone);
                var at = new DateTimeOffset(now).ToUnixTimeSeconds();
                for (var i = Rank(r.Ad.StageSent); i < Rank(r.Status); i++)
                {
                    events.Add(new
                    {
                        event_name = Stages[i].Event,
                        event_time = at,
                        event_id = $"{r.Ad.Id:N}-{Stages[i].Status}",
                        action_source = "system_generated",
                        user_data = new { lead_id = leadId, ph = new[] { ph } },
                        custom_data = new { event_source = "crm", lead_event_source = "NexEagle CRM" },
                    });
                }
            }
            if (events.Count == 0) return;

            var res = await graph.PostAsync(cfg.ApiVersion, $"{cfg.DatasetId}/events", cfg.AccessToken, new { data = events }, ct);
            res.Doc?.Dispose();
            foreach (var r in due)
            {
                r.Ad.StageSentAt = now;
                if (res.Ok) { r.Ad.StageSent = r.Status; r.Ad.StageError = null; }
                else r.Ad.StageError = LeadInbox.Shorten(res.Error, 300);
            }
            await db.SaveChangesAsync(ct);
        }

        /// <summary>SHA-256 of the phone number as Meta wants it: digits only, with the country code.</summary>
        private static string Sha256(string phone)
        {
            var digits = new string(phone.Where(char.IsDigit).ToArray());
            return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(digits))).ToLowerInvariant();
        }
    }
}
