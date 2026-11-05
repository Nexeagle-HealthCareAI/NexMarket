using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// The WhatsApp spending budget an admin sets (WhatsApp → Billing) and the hospital name for each sending number.
    /// Saved as one setting.
    /// </summary>
    public class WaBillingSettings
    {
        public const string Key = "whatsapp.billing";
        private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

        /// <summary>Monthly budget in the account's currency. 0 = no budget.</summary>
        public decimal MonthlyBudget { get; set; }
        /// <summary>Warn on the WhatsApp page once this share of the budget is spent.</summary>
        public int AlertPercent { get; set; } = 80;
        /// <summary>Hold template messages (broadcasts, follow-ups) once the budget is spent. Replies still go.</summary>
        public bool StopAtBudget { get; set; }
        /// <summary>Sending number (digits) → who it belongs to, for the per-hospital split.</summary>
        public Dictionary<string, string> NumberLabels { get; set; } = new();

        public static WaBillingSettings Load(IAppSettings settings)
        {
            var raw = settings.Get(Key);
            if (string.IsNullOrWhiteSpace(raw)) return new WaBillingSettings();
            try { return JsonSerializer.Deserialize<WaBillingSettings>(raw, Json) ?? new WaBillingSettings(); }
            catch (JsonException) { return new WaBillingSettings(); }
        }

        public Task SaveAsync(IAppSettings settings, string by, CancellationToken ct) =>
            settings.SetAsync(new Dictionary<string, string?> { [Key] = JsonSerializer.Serialize(this, Json) }, Array.Empty<string>(), by, ct);

        public static string MonthKey(DateTime utc) => utc.ToString("yyyy-MM", CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// The last spend figure read from Meta, so the outbox can check the budget without asking Meta on every message.
    /// Kept apart from the settings (and out of the activity log): it changes every few minutes.
    /// </summary>
    public class WaBillingSnapshot
    {
        public const string Key = "whatsapp.billing.snapshot";
        private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

        public string? Month { get; set; }
        public decimal Spent { get; set; }
        public string? Currency { get; set; }
        public DateTime? At { get; set; }

        /// <summary>This month's spend as last read, or 0 when the figure is from an earlier month.</summary>
        public decimal SpentThisMonth => Month == WaBillingSettings.MonthKey(DateTime.UtcNow) ? Spent : 0;

        public static WaBillingSnapshot Load(IAppSettings settings)
        {
            var raw = settings.Get(Key);
            if (string.IsNullOrWhiteSpace(raw)) return new WaBillingSnapshot();
            try { return JsonSerializer.Deserialize<WaBillingSnapshot>(raw, Json) ?? new WaBillingSnapshot(); }
            catch (JsonException) { return new WaBillingSnapshot(); }
        }

        public Task SaveAsync(IAppSettings settings, CancellationToken ct) =>
            settings.SetAsync(new Dictionary<string, string?> { [Key] = JsonSerializer.Serialize(this, Json) }, Array.Empty<string>(), "system", ct);
    }

    public class WaBillingDay { public string Date { get; set; } = ""; public decimal Cost { get; set; } public long Messages { get; set; } }
    public class WaBillingRow { public string Key { get; set; } = ""; public string Label { get; set; } = ""; public decimal Cost { get; set; } public long Messages { get; set; } }

    public class WaBillingReport
    {
        public string Month { get; set; } = "";
        public string? Currency { get; set; }
        public decimal Total { get; set; }
        public long Messages { get; set; }
        public List<WaBillingDay> Days { get; set; } = new();
        public List<WaBillingRow> Categories { get; set; } = new();
        public List<WaBillingRow> Numbers { get; set; } = new();
        public bool PaymentMethodAttached { get; set; }
        public string? AccountName { get; set; }
        public DateTime FetchedAt { get; set; }
        public string? Error { get; set; }
    }

    /// <summary>
    /// Reads what WhatsApp messages cost from Meta's pricing analytics for the WhatsApp Business Account. Meta does not
    /// let apps read the invoice, the balance due or the card, so this is the cost of messages sent, which is what the
    /// bill is made of; the bill itself stays in Meta's Billing &amp; payments.
    /// </summary>
    public class WaBillingService
    {
        private static readonly ConcurrentDictionary<string, WaBillingReport> Cache = new();
        private static readonly TimeSpan CacheFor = TimeSpan.FromMinutes(10);
        private static readonly SemaphoreSlim RefreshLock = new(1, 1);

        private readonly IWhatsAppSender _wa;
        private readonly IAppSettings _settings;
        private readonly IConfiguration _config;

        public WaBillingService(IWhatsAppSender wa, IAppSettings settings, IConfiguration config)
        {
            _wa = wa;
            _settings = settings;
            _config = config;
        }

        /// <summary>Forget the copies read in the last few minutes (e.g. after number names change).</summary>
        public static void ClearCache() => Cache.Clear();

        public static readonly Dictionary<string, string> CategoryLabels = new()
        {
            ["MARKETING"] = "Marketing (broadcasts, camp invites)",
            ["UTILITY"] = "Utility (follow-ups, reminders)",
            ["AUTHENTICATION"] = "Authentication (codes)",
            ["AUTHENTICATION_INTERNATIONAL"] = "Authentication (international)",
            ["SERVICE"] = "Service (replies to people who wrote in)",
            ["REFERRAL_CONVERSION"] = "Free (from ads or the QR)",
        };

        public async Task<WaBillingReport> ReportAsync(int year, int month, bool force, CancellationToken ct)
        {
            var key = $"{year:D4}-{month:D2}";
            if (!force && Cache.TryGetValue(key, out var hit) && DateTime.UtcNow - hit.FetchedAt < CacheFor) return hit;

            var cfg = LeadInbox.Wa(_settings, _config);
            var report = new WaBillingReport { Month = key, FetchedAt = DateTime.UtcNow };
            if (string.IsNullOrWhiteSpace(cfg.BusinessAccountId) || string.IsNullOrWhiteSpace(cfg.AccessToken))
            {
                report.Error = "Add the WhatsApp Business Account ID and access token in Setup first.";
                return report;
            }

            // The account: its name, currency, and whether a payment method or credit line is attached.
            var acc = await _wa.GraphGetAsync($"{cfg.BusinessAccountId}?fields=name,currency,primary_funding_id", ct: ct);
            if (acc.Ok && acc.Json != null)
            {
                using var doc = JsonDocument.Parse(acc.Json);
                var r = doc.RootElement;
                report.AccountName = Str(r, "name");
                report.Currency = Str(r, "currency");
                report.PaymentMethodAttached = !string.IsNullOrWhiteSpace(Str(r, "primary_funding_id"));
            }

            var start = new DateTime(year, month, 1, 0, 0, 0, DateTimeKind.Utc);
            var end = start.AddMonths(1);
            if (end > DateTime.UtcNow) end = DateTime.UtcNow;
            if (end <= start) { report.Error = "That month hasn't started yet."; return report; }

            var q = $"{cfg.BusinessAccountId}/pricing_analytics?start={new DateTimeOffset(start).ToUnixTimeSeconds()}&end={new DateTimeOffset(end).ToUnixTimeSeconds()}"
                + "&granularity=DAILY"
                + "&metric_types=" + Uri.EscapeDataString("[\"COST\",\"VOLUME\"]")
                + "&dimensions=" + Uri.EscapeDataString("[\"PRICING_CATEGORY\",\"PHONE\"]")
                + "&limit=1000";
            var res = await _wa.GraphGetAsync(q, ct: ct);
            if (!res.Ok || res.Json == null)
            {
                report.Error = $"Meta didn't return the spend: {res.Error}. The access token needs the whatsapp_business_management permission.";
                return report;
            }

            var labels = WaBillingSettings.Load(_settings).NumberLabels;
            var days = new SortedDictionary<string, WaBillingDay>();
            var cats = new Dictionary<string, WaBillingRow>();
            var nums = new Dictionary<string, WaBillingRow>();
            using (var doc = JsonDocument.Parse(res.Json))
            {
                foreach (var p in DataPoints(doc.RootElement))
                {
                    var cost = Num(p, "cost");
                    var vol = (long)Num(p, "volume");
                    var startSec = (long)Num(p, "start");
                    var date = DateTimeOffset.FromUnixTimeSeconds(startSec).UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                    if (!days.TryGetValue(date, out var d)) days[date] = d = new WaBillingDay { Date = date };
                    d.Cost += cost; d.Messages += vol;

                    var cat = Str(p, "pricing_category") ?? "OTHER";
                    if (!cats.TryGetValue(cat, out var c)) cats[cat] = c = new WaBillingRow { Key = cat, Label = CategoryLabels.GetValueOrDefault(cat, Title(cat)) };
                    c.Cost += cost; c.Messages += vol;

                    var phone = new string((Str(p, "phone_number") ?? "").Where(char.IsDigit).ToArray());
                    var nk = phone.Length > 0 ? phone : "unknown";
                    if (!nums.TryGetValue(nk, out var n))
                        nums[nk] = n = new WaBillingRow { Key = nk, Label = labels.GetValueOrDefault(nk) ?? (phone.Length > 0 ? "+" + phone : "Number not given") };
                    n.Cost += cost; n.Messages += vol;

                    report.Total += cost;
                    report.Messages += vol;
                }
            }
            // Fill the days with nothing sent, so the chart shows the whole month so far.
            for (var day = start; day < end; day = day.AddDays(1))
            {
                var k = day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                if (!days.ContainsKey(k)) days[k] = new WaBillingDay { Date = k };
            }
            report.Days = days.Values.ToList();
            report.Categories = cats.Values.OrderByDescending(x => x.Cost).ThenByDescending(x => x.Messages).ToList();
            report.Numbers = nums.Values.OrderByDescending(x => x.Cost).ThenByDescending(x => x.Messages).ToList();
            foreach (var r in report.Days.Cast<object>().Concat(report.Categories).Concat(report.Numbers))
            {
                if (r is WaBillingDay d) d.Cost = Math.Round(d.Cost, 2);
                if (r is WaBillingRow w) w.Cost = Math.Round(w.Cost, 2);
            }
            report.Total = Math.Round(report.Total, 2);

            Cache[key] = report;
            if (key == WaBillingSettings.MonthKey(DateTime.UtcNow)) await SaveSnapshotAsync(report, ct);
            return report;
        }

        /// <summary>
        /// This month's spend for the budget check: the saved figure while it is under 30 minutes old, otherwise a
        /// fresh read from Meta (at most one at a time). Null when it can't be read; the budget is then not enforced.
        /// </summary>
        public async Task<decimal?> SpentThisMonthAsync(CancellationToken ct)
        {
            var s = WaBillingSnapshot.Load(_settings);
            var month = WaBillingSettings.MonthKey(DateTime.UtcNow);
            if (s.Month == month && s.At > DateTime.UtcNow.AddMinutes(-30)) return s.Spent;
            if (!await RefreshLock.WaitAsync(0, ct)) return s.Month == month ? s.Spent : null;
            try
            {
                var now = DateTime.UtcNow;
                var r = await ReportAsync(now.Year, now.Month, true, ct);
                return r.Error == null ? r.Total : (s.Month == month ? s.Spent : null);
            }
            finally { RefreshLock.Release(); }
        }

        private async Task SaveSnapshotAsync(WaBillingReport r, CancellationToken ct)
        {
            if (r.Error != null) return;
            var s = new WaBillingSnapshot { Month = r.Month, Spent = r.Total, At = r.FetchedAt, Currency = r.Currency ?? WaBillingSnapshot.Load(_settings).Currency };
            await s.SaveAsync(_settings, ct);
        }

        /// <summary>Every data point in the response, wherever Meta nests it (data[].data_points[] or data[]).</summary>
        private static IEnumerable<JsonElement> DataPoints(JsonElement root)
        {
            var data = root.TryGetProperty("pricing_analytics", out var pa) && pa.TryGetProperty("data", out var d1) ? d1
                : root.TryGetProperty("data", out var d2) ? d2 : default;
            if (data.ValueKind != JsonValueKind.Array) yield break;
            foreach (var item in data.EnumerateArray())
            {
                if (item.TryGetProperty("data_points", out var pts) && pts.ValueKind == JsonValueKind.Array)
                    foreach (var p in pts.EnumerateArray()) yield return p;
                else if (item.TryGetProperty("cost", out _) || item.TryGetProperty("volume", out _))
                    yield return item;
            }
        }

        private static string? Str(JsonElement e, string name) =>
            e.TryGetProperty(name, out var v) ? (v.ValueKind == JsonValueKind.String ? v.GetString() : v.ValueKind == JsonValueKind.Number ? v.GetRawText() : null) : null;

        private static decimal Num(JsonElement e, string name)
        {
            if (!e.TryGetProperty(name, out var v)) return 0;
            if (v.ValueKind == JsonValueKind.Number && v.TryGetDecimal(out var n)) return n;
            if (v.ValueKind == JsonValueKind.String && decimal.TryParse(v.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var s)) return s;
            return 0;
        }

        private static string Title(string s) => s.Length == 0 ? s : char.ToUpperInvariant(s[0]) + s[1..].ToLowerInvariant().Replace('_', ' ');
    }
}
