using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// Tells Google Ads which ad clicks became patients. A lead that came from a Google ad keeps Google's click ID (gclid);
    /// when the desk marks it Arrived or Admitted, that is sent to Google Ads as a conversion through Google's Data Manager
    /// API (the Google Ads API takes no new offline-conversion users since June 2026). Only the click ID, the time and the
    /// conversion action are sent: no name, phone number or health information. Google then learns which searches bring
    /// people who actually come, and shows cost per patient.
    /// </summary>
    public class GoogleConversions
    {
        public const string IngestUrl = "https://datamanager.googleapis.com/v1/events:ingest";
        /// <summary>Google accepts a click's conversions for 90 days; a day's margin.</summary>
        public const int ClickWindowDays = 89;
        private static readonly Regex ClickId = new(@"^[A-Za-z0-9_\-]{10,200}$");
        private static readonly Regex Digits = new(@"\D");

        public sealed record Pending(Guid LeadId, string Gclid, DateTime ClickAt, string Kind, DateTime At);
        public sealed record Result(bool Ok, int Sent, int Failed, int Waiting, string? Error, bool Validated);

        private readonly IMarketingDbContext _db;
        private readonly IAppSettings _settings;
        private readonly GoogleApi _api;

        public GoogleConversions(IMarketingDbContext db, IAppSettings settings, GoogleApi api) { _db = db; _settings = settings; _api = api; }

        /// <summary>A gclid as it arrives in a website address, or null if it doesn't look like one.</summary>
        public static string? CleanClickId(string? v)
        {
            var s = (v ?? "").Trim();
            return ClickId.IsMatch(s) ? s : null;
        }

        public static string AccountId(string? v) => Digits.Replace(v ?? "", "");

        /// <summary>The Data Manager request for one conversion action.</summary>
        public static object Request(GoogleConfig cfg, string conversionAction, IEnumerable<Pending> items, bool validateOnly)
        {
            var dest = new Dictionary<string, object>
            {
                ["operatingAccount"] = new { accountType = "GOOGLE_ADS", accountId = AccountId(cfg.AdsCustomer) },
                ["productDestinationId"] = AccountId(conversionAction),
            };
            if (!string.IsNullOrWhiteSpace(cfg.AdsLoginCustomer) && AccountId(cfg.AdsLoginCustomer) != AccountId(cfg.AdsCustomer))
                dest["loginAccount"] = new { accountType = "GOOGLE_ADS", accountId = AccountId(cfg.AdsLoginCustomer) };
            return new
            {
                destinations = new[] { dest },
                events = items.Select(p => new
                {
                    adIdentifiers = new { gclid = p.Gclid },
                    // After the click, as Google requires; in India time so it reads naturally in Google Ads.
                    eventTimestamp = new DateTimeOffset(DateTime.SpecifyKind(p.At < p.ClickAt ? p.ClickAt.AddMinutes(1) : p.At, DateTimeKind.Utc)).ToOffset(TimeSpan.FromHours(5.5)).ToString("yyyy-MM-dd'T'HH:mm:sszzz"),
                    transactionId = $"{p.LeadId:N}-{p.Kind}",
                    eventSource = "OTHER",
                }).ToArray(),
                validateOnly,
            };
        }

        /// <summary>Leads whose Arrived / Admitted hasn't been sent yet, still inside Google's 90-day window.</summary>
        public async Task<List<Pending>> PendingAsync(GoogleConfig cfg, int max, CancellationToken ct)
        {
            var since = DateTime.UtcNow.AddDays(-ClickWindowDays);
            var arrived = !string.IsNullOrWhiteSpace(cfg.ConvArrived);
            var admitted = !string.IsNullOrWhiteSpace(cfg.ConvAdmitted);
            if (!arrived && !admitted) return new();
            var leads = await _db.Leads.AsNoTracking()
                .Where(l => l.Gclid != null && l.GclidAt != null && l.GclidAt >= since && (l.Status == "arrived" || l.Status == "admitted")
                    && ((arrived && l.AdsArrivedSentAt == null) || (admitted && l.Status == "admitted" && l.AdsAdmittedSentAt == null)))
                .OrderBy(l => l.GclidAt).Take(max)
                .Select(l => new { l.Id, l.Gclid, l.GclidAt, l.Status, l.AdsArrivedSentAt, l.AdsAdmittedSentAt, l.LastActivityAt }).ToListAsync(ct);
            if (leads.Count == 0) return new();
            // When each stage was reached: the status change in the lead's history.
            var ids = leads.Select(l => l.Id).ToList();
            var moves = await _db.LeadActivities.AsNoTracking().Where(a => ids.Contains(a.LeadId) && a.Kind == "status")
                .Select(a => new { a.LeadId, a.Text, a.CreatedAt }).ToListAsync(ct);
            DateTime when(Guid id, string status, DateTime fallback)
            {
                var label = "→ " + LeadInbox.StatusLabel(status);
                var hit = moves.Where(m => m.LeadId == id && m.Text != null && m.Text.Contains(label)).OrderBy(m => m.CreatedAt).FirstOrDefault();
                return hit?.CreatedAt ?? fallback;
            }
            var list = new List<Pending>();
            foreach (var l in leads)
            {
                if (arrived && l.AdsArrivedSentAt == null)
                {
                    // Admitted without a separate Arrived step: they came, at the latest when admitted.
                    var at = when(l.Id, "arrived", when(l.Id, "admitted", l.LastActivityAt));
                    list.Add(new Pending(l.Id, l.Gclid!, l.GclidAt!.Value, "arrived", at));
                }
                if (admitted && l.Status == "admitted" && l.AdsAdmittedSentAt == null)
                    list.Add(new Pending(l.Id, l.Gclid!, l.GclidAt!.Value, "admitted", when(l.Id, "admitted", l.LastActivityAt)));
            }
            return list;
        }

        /// <summary>
        /// Sends what is waiting (or, with <paramref name="validateOnly"/>, asks Google to check it without recording anything).
        /// Google refuses a whole batch for one bad event, so a refused batch is retried one by one to find it.
        /// </summary>
        public async Task<Result> SendAsync(bool validateOnly, string by, CancellationToken ct)
        {
            var cfg = GoogleConfig.Load(_settings);
            if (!cfg.Connected) return new Result(false, 0, 0, 0, "Google isn't connected yet (Google → Setup).", validateOnly);
            if (string.IsNullOrWhiteSpace(cfg.AdsCustomer)) return new Result(false, 0, 0, 0, "Pick the Google Ads account first (Google → Setup, step 3).", validateOnly);
            if (string.IsNullOrWhiteSpace(cfg.ConvArrived) && string.IsNullOrWhiteSpace(cfg.ConvAdmitted))
                return new Result(false, 0, 0, 0, "Enter the conversion action ID for “came to the hospital” first.", validateOnly);

            var pending = await PendingAsync(cfg, validateOnly ? 20 : 500, ct);
            if (pending.Count == 0)
            {
                if (!validateOnly) await SaveResultAsync(new Result(true, 0, 0, 0, null, false), by, ct);
                return new Result(true, 0, 0, 0, validateOnly ? "Nothing to check yet: no lead from a Google ad has been marked Arrived or Admitted." : null, validateOnly);
            }

            int sent = 0, failed = 0;
            string? firstError = null;
            var leadIds = pending.Select(p => p.LeadId).Distinct().ToList();
            var leads = validateOnly ? new Dictionary<Guid, Lead>() : await _db.Leads.Where(l => leadIds.Contains(l.Id)).ToDictionaryAsync(l => l.Id, ct);
            var now = DateTime.UtcNow;

            foreach (var group in pending.GroupBy(p => p.Kind))
            {
                var action = group.Key == "arrived" ? cfg.ConvArrived! : cfg.ConvAdmitted!;
                foreach (var batch in group.Chunk(200))
                {
                    var r = await _api.PostAsync(cfg, IngestUrl, Request(cfg, action, batch, validateOnly), ct);
                    r.Doc?.Dispose();
                    if (r.Ok) { Mark(batch, null); continue; }
                    if (Fatal(r)) return new Result(false, sent, failed, pending.Count - sent, Explain(r), validateOnly);
                    // One bad click ID fails the whole batch: find it.
                    foreach (var one in batch)
                    {
                        var r1 = await _api.PostAsync(cfg, IngestUrl, Request(cfg, action, new[] { one }, validateOnly), ct);
                        r1.Doc?.Dispose();
                        Mark(new[] { one }, r1.Ok ? null : Explain(r1));
                    }
                }
            }
            if (!validateOnly) await _db.SaveChangesAsync(ct);
            var result = new Result(failed == 0, sent, failed, 0, firstError, validateOnly);
            if (!validateOnly) await SaveResultAsync(result, by, ct);
            return result;

            void Mark(IEnumerable<Pending> items, string? error)
            {
                foreach (var p in items)
                {
                    if (error == null) sent++; else { failed++; firstError ??= error; }
                    if (validateOnly || !leads.TryGetValue(p.LeadId, out var l)) continue;
                    if (error == null)
                    {
                        if (p.Kind == "arrived") l.AdsArrivedSentAt = now; else l.AdsAdmittedSentAt = now;
                        l.AdsUploadError = null;
                    }
                    else
                    {
                        l.AdsUploadError = error.Length > 300 ? error[..300] : error;
                        // Google won't take this one (an unknown or too-old click): don't try it every day.
                        if (p.Kind == "arrived") l.AdsArrivedSentAt = now; else l.AdsAdmittedSentAt = now;
                    }
                }
            }
        }

        /// <summary>Problems with the setup itself (access, account, conversion action), not with one lead's click.</summary>
        private static bool Fatal(GoogleResponse r) => r.Status is 0 or 401 or 403 or 404 or 429 or >= 500
            || (r.Error ?? "").Contains("productDestinationId", StringComparison.OrdinalIgnoreCase)
            || (r.Error ?? "").Contains("operating", StringComparison.OrdinalIgnoreCase);

        private static string Explain(GoogleResponse r)
        {
            var e = r.Error ?? "Google refused it.";
            if (r.Status == 403 && e.Contains("scope", StringComparison.OrdinalIgnoreCase))
                return "NexMarket needs one more permission from Google. Press “Connect Google again” in Setup and tick every box.";
            if (r.Status == 403 && (e.Contains("has not been used", StringComparison.OrdinalIgnoreCase) || e.Contains("disabled", StringComparison.OrdinalIgnoreCase)))
                return "Turn on the “Data Manager API” in the Google Cloud project (APIs & Services → Library), then try again.";
            if (r.Status == 403) return "Google says this account may not send conversions to that Google Ads account: " + e;
            return e;
        }

        private Task SaveResultAsync(Result r, string by, CancellationToken ct) => GoogleConfig.SaveAsync(_settings, new()
        {
            ["convSentAt"] = DateTime.UtcNow.ToString("o"),
            ["convResult"] = JsonSerializer.Serialize(new { r.Ok, r.Sent, r.Failed, r.Error }),
        }, by, ct);

        /// <summary>For Setup: how many are waiting, sent, and refused.</summary>
        public async Task<object> StatusAsync(CancellationToken ct)
        {
            var cfg = GoogleConfig.Load(_settings);
            var since = DateTime.UtcNow.AddDays(-ClickWindowDays);
            var fromAds = await _db.Leads.AsNoTracking().CountAsync(l => l.Gclid != null && l.GclidAt >= since, ct);
            var waiting = (await PendingAsync(cfg, 1000, ct)).Count;
            var sentArrived = await _db.Leads.AsNoTracking().CountAsync(l => l.AdsArrivedSentAt != null && l.AdsUploadError == null, ct);
            var sentAdmitted = await _db.Leads.AsNoTracking().CountAsync(l => l.AdsAdmittedSentAt != null && l.AdsUploadError == null, ct);
            var refused = await _db.Leads.AsNoTracking().Where(l => l.AdsUploadError != null).OrderByDescending(l => l.AdsArrivedSentAt)
                .Take(5).Select(l => new { id = l.Id, name = l.Name, error = l.AdsUploadError }).ToListAsync(ct);
            return new
            {
                convArrived = cfg.ConvArrived, convAdmitted = cfg.ConvAdmitted, sentAt = cfg.ConvSentAt, last = cfg.ConvResult,
                fromAds, waiting, sentArrived, sentAdmitted, refused,
                scopeOk = cfg.GrantedScopes == null || cfg.GrantedScopes.Contains("datamanager"),
            };
        }
    }
}
