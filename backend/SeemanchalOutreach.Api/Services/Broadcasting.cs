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
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    public class BroadcastAudience
    {
        public List<string> ContactTypes { get; set; } = new();   // contact Role values, e.g. rmp_doctor, asha_worker
        public List<string> Blocks { get; set; } = new();         // block names; empty = all
        public bool ImportantOnly { get; set; }
    }

    /// <summary>
    /// Builds the per-recipient template values and the preview text for each broadcast kind.
    /// The approved WhatsApp template for a kind must take the same values in the same order:
    ///   doctor_availability: {{1}} name, {{2}} doctor, {{3}} department, {{4}} date, {{5}} timing, {{6}} note
    ///   schedule_change:     {{1}} name, {{2}} doctor, {{3}} department, {{4}} details
    ///   camp_invite:         {{1}} name, {{2}} place, {{3}} date, {{4}} details
    ///   general_update:      {{1}} name, {{2}} message
    /// </summary>
    public static class BroadcastComposer
    {
        public static readonly string[] Kinds = { "doctor_availability", "schedule_change", "camp_invite", "general_update" };

        private static string Get(Dictionary<string, string> p, string key) => p.TryGetValue(key, out var v) && !string.IsNullOrWhiteSpace(v) ? v.Trim() : "";

        public static Dictionary<string, string> ParseParams(string json)
        {
            try
            {
                return JsonSerializer.Deserialize<Dictionary<string, string>>(json) ?? new Dictionary<string, string>();
            }
            catch (JsonException)
            {
                return new Dictionary<string, string>();
            }
        }

        public static List<string> BodyParams(string kind, Dictionary<string, string> p, string recipientName)
        {
            var name = string.IsNullOrWhiteSpace(recipientName) ? "ji" : recipientName.Trim();
            return kind switch
            {
                "doctor_availability" => new List<string> { name, Get(p, "doctorName"), Get(p, "department"), Get(p, "date"), Get(p, "timing"), Get(p, "note") },
                "schedule_change" => new List<string> { name, Get(p, "doctorName"), Get(p, "department"), Get(p, "details") },
                "camp_invite" => new List<string> { name, Get(p, "place"), Get(p, "date"), Get(p, "details") },
                _ => new List<string> { name, Get(p, "message") },
            };
        }

        public static string Preview(string kind, string language, Dictionary<string, string> p, string recipientName)
        {
            var name = string.IsNullOrWhiteSpace(recipientName) ? "[Name]" : recipientName;
            bool hi = language != "en";
            string note = Get(p, "note");
            switch (kind)
            {
                case "doctor_availability":
                    return hi
                        ? $"नमस्ते {name} जी,\nग्लिसन अकबरी सुपर स्पेशलिटी हॉस्पिटल में {Get(p, "doctorName")} ({Get(p, "department")}) {Get(p, "date")} को {Get(p, "timing")} OPD में उपलब्ध रहेंगे।" + (note != "" ? $"\n{note}" : "")
                        : $"Hello {name},\n{Get(p, "doctorName")} ({Get(p, "department")}) will be available in OPD at Glisan Akbari Super Speciality Hospital on {Get(p, "date")}, {Get(p, "timing")}." + (note != "" ? $"\n{note}" : "");
                case "schedule_change":
                    return hi
                        ? $"नमस्ते {name} जी,\n{Get(p, "doctorName")} ({Get(p, "department")}) के OPD समय में बदलाव: {Get(p, "details")}"
                        : $"Hello {name},\nOPD change for {Get(p, "doctorName")} ({Get(p, "department")}): {Get(p, "details")}";
                case "camp_invite":
                    return hi
                        ? $"नमस्ते {name} जी,\nग्लिसन अकबरी हॉस्पिटल का स्वास्थ्य शिविर: {Get(p, "place")}, {Get(p, "date")}। {Get(p, "details")}"
                        : $"Hello {name},\nGlisan Akbari Hospital health camp: {Get(p, "place")}, {Get(p, "date")}. {Get(p, "details")}";
                default:
                    return hi ? $"नमस्ते {name} जी,\n{Get(p, "message")}" : $"Hello {name},\n{Get(p, "message")}";
            }
        }

        public static string TitleFor(string kind, Dictionary<string, string> p) => kind switch
        {
            "doctor_availability" => $"{Get(p, "doctorName")} available {Get(p, "date")}".Trim(),
            "schedule_change" => $"OPD change: {Get(p, "doctorName")}".Trim(),
            "camp_invite" => $"Health camp, {Get(p, "place")}".Trim(),
            _ => Get(p, "message").Length > 60 ? Get(p, "message").Substring(0, 60) + "…" : Get(p, "message"),
        };

        /// <summary>Contacts a broadcast goes to: matching type/block, has a valid phone, hasn't opted out.</summary>
        public static IQueryable<OutreachContact> Audience(IMarketingDbContext db, BroadcastAudience a)
        {
            var q = db.Contacts.Where(c => !c.IsMerged && !c.PhoneInvalid && !c.WhatsappOptOut && c.Phone != null && c.Phone != "");
            if (a.ContactTypes.Count > 0) q = q.Where(c => a.ContactTypes.Contains(c.Role));
            if (a.ImportantOnly) q = q.Where(c => c.IsImportant);
            if (a.Blocks.Count > 0)
            {
                var panchayatIds = db.Panchayats.Where(p => a.Blocks.Contains(p.Block)).Select(p => p.PanchayatId);
                q = q.Where(c => panchayatIds.Contains(c.PanchayatId));
            }
            return q;
        }
    }

    /// <summary>Sends broadcasts whose scheduled time has come. Runs every 30 seconds.</summary>
    public class BroadcastDispatcher : BackgroundService
    {
        private readonly IServiceScopeFactory _scopes;
        private readonly ILogger<BroadcastDispatcher> _logger;

        public BroadcastDispatcher(IServiceScopeFactory scopes, ILogger<BroadcastDispatcher> logger)
        {
            _scopes = scopes;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await RunOnceAsync(stoppingToken);
                }
                catch (Exception ex) when (!(ex is OperationCanceledException))
                {
                    _logger.LogError(ex, "Broadcast dispatcher run failed");
                }
                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
        }

        private async Task RunOnceAsync(CancellationToken ct)
        {
            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<IMarketingDbContext>();
            var sender = scope.ServiceProvider.GetRequiredService<IWhatsAppSender>();
            var live = scope.ServiceProvider.GetRequiredService<ILiveEvents>();

            var now = DateTime.UtcNow;
            var due = await db.Broadcasts
                .Where(b => b.Status == "scheduled" && (b.ScheduledAt == null || b.ScheduledAt <= now))
                .OrderBy(b => b.ScheduledAt)
                .Take(3)
                .ToListAsync(ct);

            foreach (var b in due)
            {
                b.Status = "sending";
                await db.SaveChangesAsync(ct);

                if (!sender.IsConfigured)
                {
                    b.Status = "failed";
                    b.Error = "WhatsApp is not connected yet. Add the hospital's WhatsApp Business number in the server settings.";
                    await db.SaveChangesAsync(ct);
                    continue;
                }

                var audience = JsonSerializer.Deserialize<BroadcastAudience>(b.AudienceJson) ?? new BroadcastAudience();
                var parameters = BroadcastComposer.ParseParams(b.ParamsJson);
                var contacts = await BroadcastComposer.Audience(db, audience)
                    .Select(c => new { c.ClientId, c.Name, c.Phone })
                    .ToListAsync(ct);

                int sent = 0, failed = 0;
                foreach (var c in contacts)
                {
                    if (ct.IsCancellationRequested) break;
                    var res = await sender.SendTemplateAsync(c.Phone!, b.Kind, b.Language, BroadcastComposer.BodyParams(b.Kind, parameters, c.Name), ct);
                    db.BroadcastRecipients.Add(new BroadcastRecipient
                    {
                        BroadcastId = b.Id,
                        ContactClientId = c.ClientId,
                        Name = c.Name,
                        Phone = SeemanchalOutreach.Infrastructure.Services.WhatsAppCloudSender.NormalizeIndianPhone(c.Phone) ?? c.Phone!,
                        Status = res.Ok ? "sent" : "failed",
                        ProviderMessageId = res.MessageId,
                        Error = res.Error,
                        SentAt = res.Ok ? DateTime.UtcNow : null,
                    });
                    if (res.Ok) sent++; else failed++;
                    // Stay well inside WhatsApp's per-second limits for a new business number.
                    await Task.Delay(120, ct);
                }

                b.RecipientCount = contacts.Count;
                b.SentCount = sent;
                b.FailedCount = failed;
                b.SentAt = DateTime.UtcNow;
                b.Status = sent > 0 || contacts.Count == 0 ? "sent" : "failed";
                if (b.Status == "failed" && b.Error == null) b.Error = "No message could be delivered.";
                await db.SaveChangesAsync(ct);

                await live.PublishAsync(new LiveEvent { Kind = "broadcast", Text = $"WhatsApp \"{b.Title}\" sent to {sent} people", RefId = b.Id.ToString() });
            }
        }
    }
}
