using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// The connection to the hospital's own Google accounts, made once by an admin in Google → Setup: the hospital's
    /// Google Cloud OAuth client (ID + secret) and the refresh token Google gives back when the hospital's Google account
    /// signs in. Secrets are stored encrypted. No outside service sits in between: NexMarket calls Google directly.
    /// </summary>
    public class GoogleConfig
    {
        public const string Prefix = "google.";
        public static readonly (string Key, bool Secret)[] Fields =
        {
            ("clientId", false), ("clientSecret", true), ("refreshToken", true), ("email", false), ("connectedAt", false),
            ("scopes", false), ("oauthState", true), ("oauthStateAt", false), ("returnTo", false),
            ("ga4Property", false), ("ga4Name", false), ("gscSite", false), ("gbpAccount", false), ("gbpLocation", false), ("gbpName", false),
            ("ytChannel", false), ("ytName", false), ("adsDeveloperToken", true), ("adsCustomer", false), ("adsLoginCustomer", false),
            ("adsName", false), ("adsCurrency", false), ("adsVersion", false), ("syncedAt", false), ("syncResult", false),
        };
        public static ICollection<string> SecretKeys => Fields.Where(f => f.Secret).Select(f => Prefix + f.Key).ToList();

        /// <summary>Everything NexMarket reads. Read-only scopes except Business Profile (Google has no read-only one; it is also
        /// what lets the desk answer reviews from the CRM) and Ads (Google has no read-only scope either; NexMarket only reads).</summary>
        public static readonly (string Scope, string For)[] Scopes =
        {
            ("openid", "Your sign-in"),
            ("email", "Which Google account is connected"),
            ("https://www.googleapis.com/auth/business.manage", "Google Business Profile: calls, directions, views, search terms, reviews and replies"),
            ("https://www.googleapis.com/auth/webmasters.readonly", "Search Console: what people search before they reach the website"),
            ("https://www.googleapis.com/auth/analytics.readonly", "Google Analytics 4: website visits"),
            ("https://www.googleapis.com/auth/yt-analytics.readonly", "YouTube: views and watch time"),
            ("https://www.googleapis.com/auth/youtube.readonly", "YouTube: which channel"),
            ("https://www.googleapis.com/auth/adwords", "Google Ads: spend, clicks, calls and conversions (read only in NexMarket)"),
        };

        public string? ClientId { get; set; }
        public string? ClientSecret { get; set; }
        public string? RefreshToken { get; set; }
        public string? Email { get; set; }
        public string? ConnectedAt { get; set; }
        public string? GrantedScopes { get; set; }
        public string? OauthState { get; set; }
        public string? OauthStateAt { get; set; }
        public string? ReturnTo { get; set; }
        /// <summary>properties/123456</summary>
        public string? Ga4Property { get; set; }
        public string? Ga4Name { get; set; }
        /// <summary>https://example.com/ or sc-domain:example.com</summary>
        public string? GscSite { get; set; }
        /// <summary>accounts/123</summary>
        public string? GbpAccount { get; set; }
        /// <summary>locations/123</summary>
        public string? GbpLocation { get; set; }
        public string? GbpName { get; set; }
        public string? YtChannel { get; set; }
        public string? YtName { get; set; }
        public string? AdsDeveloperToken { get; set; }
        /// <summary>Digits only, no dashes.</summary>
        public string? AdsCustomer { get; set; }
        public string? AdsLoginCustomer { get; set; }
        public string? AdsName { get; set; }
        public string? AdsCurrency { get; set; }
        public string AdsVersion { get; set; } = "v25";
        public string? SyncedAt { get; set; }
        public string? SyncResult { get; set; }

        public bool HasClient => !string.IsNullOrWhiteSpace(ClientId) && !string.IsNullOrWhiteSpace(ClientSecret);
        public bool Connected => HasClient && !string.IsNullOrWhiteSpace(RefreshToken);
        public bool AnySource => Ga4Property != null || GscSite != null || GbpLocation != null || YtChannel != null || AdsCustomer != null;

        public static GoogleConfig Load(IAppSettings s)
        {
            string? g(string k) { var v = s.Get(Prefix + k); return string.IsNullOrWhiteSpace(v) ? null : v.Trim(); }
            return new GoogleConfig
            {
                ClientId = g("clientId"), ClientSecret = g("clientSecret"), RefreshToken = g("refreshToken"), Email = g("email"),
                ConnectedAt = g("connectedAt"), GrantedScopes = g("scopes"), OauthState = g("oauthState"), OauthStateAt = g("oauthStateAt"),
                ReturnTo = g("returnTo"), Ga4Property = g("ga4Property"), Ga4Name = g("ga4Name"), GscSite = g("gscSite"),
                GbpAccount = g("gbpAccount"), GbpLocation = g("gbpLocation"), GbpName = g("gbpName"), YtChannel = g("ytChannel"), YtName = g("ytName"),
                AdsDeveloperToken = g("adsDeveloperToken"), AdsCustomer = g("adsCustomer"), AdsLoginCustomer = g("adsLoginCustomer"),
                AdsName = g("adsName"), AdsCurrency = g("adsCurrency"), AdsVersion = g("adsVersion") ?? "v25",
                SyncedAt = g("syncedAt"), SyncResult = g("syncResult"),
            };
        }

        public static Task SaveAsync(IAppSettings s, Dictionary<string, string?> values, string by, CancellationToken ct) =>
            s.SetAsync(values.ToDictionary(k => Prefix + k.Key, k => k.Value), SecretKeys, by, ct);
    }

    public sealed record GoogleResponse(bool Ok, JsonDocument? Doc, string? Error, int Status);

    /// <summary>Talks to Google's APIs with the hospital's refresh token. Access tokens (1 hour) are cached in memory.</summary>
    public class GoogleApi
    {
        private const string TokenUrl = "https://oauth2.googleapis.com/token";
        private readonly IHttpClientFactory _http;
        private readonly ILogger<GoogleApi> _log;
        private readonly ConcurrentDictionary<string, (string Token, DateTime Until)> _tokens = new();

        public GoogleApi(IHttpClientFactory http, ILogger<GoogleApi> log) { _http = http; _log = log; }

        public static string AuthUrl(GoogleConfig cfg, string redirectUri, string state) =>
            "https://accounts.google.com/o/oauth2/v2/auth?" + string.Join("&", new[]
            {
                "client_id=" + Uri.EscapeDataString(cfg.ClientId ?? ""),
                "redirect_uri=" + Uri.EscapeDataString(redirectUri),
                "response_type=code",
                "scope=" + Uri.EscapeDataString(string.Join(' ', GoogleConfig.Scopes.Select(s => s.Scope))),
                "access_type=offline",
                "prompt=consent",
                "include_granted_scopes=true",
                "state=" + Uri.EscapeDataString(state),
            });

        /// <summary>Swaps the code Google sent back for a refresh token, and reads which account signed in.</summary>
        public async Task<(string? RefreshToken, string? Email, string? Scopes, string? Error)> ExchangeCodeAsync(GoogleConfig cfg, string code, string redirectUri, CancellationToken ct)
        {
            var form = new Dictionary<string, string>
            {
                ["code"] = code, ["client_id"] = cfg.ClientId ?? "", ["client_secret"] = cfg.ClientSecret ?? "",
                ["redirect_uri"] = redirectUri, ["grant_type"] = "authorization_code",
            };
            var (ok, doc, err) = await PostFormAsync(form, ct);
            if (!ok || doc == null) return (null, null, null, err);
            using (doc)
            {
                var root = doc.RootElement;
                var refresh = Str(root, "refresh_token");
                var access = Str(root, "access_token");
                var scopes = Str(root, "scope");
                if (refresh == null) return (null, null, null, "Google didn't give a long-term key. Remove NexMarket from the Google account's third-party access and connect again.");
                string? email = null;
                if (access != null)
                {
                    var me = await SendRawAsync(HttpMethod.Get, "https://openidconnect.googleapis.com/v1/userinfo", access, null, null, ct);
                    if (me.Ok && me.Doc != null) using (me.Doc) email = Str(me.Doc.RootElement, "email");
                    _tokens[Key(refresh)] = (access, DateTime.UtcNow.AddMinutes(50));
                }
                return (refresh, email, scopes, null);
            }
        }

        public async Task RevokeAsync(string refreshToken, CancellationToken ct)
        {
            try
            {
                var client = _http.CreateClient("google");
                using var res = await client.PostAsync("https://oauth2.googleapis.com/revoke", new FormUrlEncodedContent(new Dictionary<string, string> { ["token"] = refreshToken }), ct);
            }
            catch (Exception ex) when (ex is HttpRequestException || ex is TaskCanceledException) { _log.LogWarning(ex, "Google revoke failed"); }
            _tokens.TryRemove(Key(refreshToken), out _);
        }

        private async Task<(string? Token, string? Error)> AccessTokenAsync(GoogleConfig cfg, bool fresh, CancellationToken ct)
        {
            if (!cfg.Connected) return (null, "Google isn't connected yet (Google → Setup).");
            var key = Key(cfg.RefreshToken!);
            if (!fresh && _tokens.TryGetValue(key, out var t) && t.Until > DateTime.UtcNow) return (t.Token, null);
            var (ok, doc, err) = await PostFormAsync(new Dictionary<string, string>
            {
                ["client_id"] = cfg.ClientId!, ["client_secret"] = cfg.ClientSecret!, ["refresh_token"] = cfg.RefreshToken!, ["grant_type"] = "refresh_token",
            }, ct);
            if (!ok || doc == null) return (null, err == "invalid_grant" ? "Google has withdrawn access. Connect the Google account again in Setup." : err);
            using (doc)
            {
                var access = Str(doc.RootElement, "access_token");
                if (access == null) return (null, "Google didn't return an access key.");
                var secs = doc.RootElement.TryGetProperty("expires_in", out var e) && e.TryGetInt32(out var n) ? n : 3600;
                _tokens[key] = (access, DateTime.UtcNow.AddSeconds(Math.Max(60, secs - 300)));
                return (access, null);
            }
        }

        public Task<GoogleResponse> GetAsync(GoogleConfig cfg, string url, CancellationToken ct, IDictionary<string, string>? headers = null) =>
            SendAsync(cfg, HttpMethod.Get, url, null, headers, ct);

        public Task<GoogleResponse> PostAsync(GoogleConfig cfg, string url, object body, CancellationToken ct, IDictionary<string, string>? headers = null) =>
            SendAsync(cfg, HttpMethod.Post, url, body, headers, ct);

        public Task<GoogleResponse> PutAsync(GoogleConfig cfg, string url, object body, CancellationToken ct) =>
            SendAsync(cfg, HttpMethod.Put, url, body, null, ct);

        public async Task<GoogleResponse> SendAsync(GoogleConfig cfg, HttpMethod method, string url, object? body, IDictionary<string, string>? headers, CancellationToken ct)
        {
            var (token, err) = await AccessTokenAsync(cfg, false, ct);
            if (token == null) return new GoogleResponse(false, null, err, 0);
            var r = await SendRawAsync(method, url, token, body, headers, ct);
            if (r.Status == 401)
            {
                (token, err) = await AccessTokenAsync(cfg, true, ct);
                if (token == null) return new GoogleResponse(false, null, err, 401);
                r = await SendRawAsync(method, url, token, body, headers, ct);
            }
            return r;
        }

        private async Task<GoogleResponse> SendRawAsync(HttpMethod method, string url, string token, object? body, IDictionary<string, string>? headers, CancellationToken ct)
        {
            try
            {
                using var req = new HttpRequestMessage(method, url);
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                if (headers != null) foreach (var h in headers) req.Headers.TryAddWithoutValidation(h.Key, h.Value);
                if (body != null) req.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
                var client = _http.CreateClient("google");
                using var res = await client.SendAsync(req, ct);
                var text = await res.Content.ReadAsStringAsync(ct);
                JsonDocument? doc = null;
                try { doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(text) ? "{}" : text); } catch (JsonException) { /* not JSON */ }
                if (res.IsSuccessStatusCode) return new GoogleResponse(true, doc ?? JsonDocument.Parse("{}"), null, (int)res.StatusCode);
                var msg = ErrorMessage(doc, (int)res.StatusCode);
                doc?.Dispose();
                return new GoogleResponse(false, null, msg, (int)res.StatusCode);
            }
            catch (Exception ex) when (ex is HttpRequestException || ex is TaskCanceledException)
            {
                _log.LogWarning(ex, "Google call failed: {Host}", new Uri(url).Host);
                return new GoogleResponse(false, null, "Could not reach Google.", 0);
            }
        }

        private async Task<(bool Ok, JsonDocument? Doc, string? Error)> PostFormAsync(Dictionary<string, string> form, CancellationToken ct)
        {
            try
            {
                var client = _http.CreateClient("google");
                using var res = await client.PostAsync(TokenUrl, new FormUrlEncodedContent(form), ct);
                var text = await res.Content.ReadAsStringAsync(ct);
                JsonDocument? doc = null;
                try { doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(text) ? "{}" : text); } catch (JsonException) { /* not JSON */ }
                if (res.IsSuccessStatusCode && doc != null) return (true, doc, null);
                var code = doc != null ? Str(doc.RootElement, "error") : null;
                var desc = doc != null ? Str(doc.RootElement, "error_description") : null;
                doc?.Dispose();
                return (false, null, code == "invalid_grant" ? "invalid_grant" : desc ?? code ?? $"Google said {(int)res.StatusCode}.");
            }
            catch (Exception ex) when (ex is HttpRequestException || ex is TaskCanceledException)
            {
                _log.LogWarning(ex, "Google token call failed");
                return (false, null, "Could not reach Google.");
            }
        }

        /// <summary>Google's error in plain words, with the usual fixes for the ones admins hit.</summary>
        private static string ErrorMessage(JsonDocument? doc, int status)
        {
            string? msg = null, reason = null;
            if (doc != null && doc.RootElement.ValueKind == JsonValueKind.Object && doc.RootElement.TryGetProperty("error", out var e))
            {
                if (e.ValueKind == JsonValueKind.String) msg = e.GetString();
                else if (e.ValueKind == JsonValueKind.Object)
                {
                    msg = Str(e, "message");
                    reason = Str(e, "status");
                    if (e.TryGetProperty("details", out var d) && d.ValueKind == JsonValueKind.Array)
                        foreach (var x in d.EnumerateArray())
                        {
                            if (Str(x, "reason") is string r) reason = r;
                            // Google Ads puts its real error deep inside.
                            if (x.TryGetProperty("errors", out var errs) && errs.ValueKind == JsonValueKind.Array)
                                foreach (var ae in errs.EnumerateArray()) if (Str(ae, "message") is string am) { msg = am; break; }
                        }
                }
            }
            if (reason == "SERVICE_DISABLED" || (msg?.Contains("has not been used in project") ?? false))
                return "This Google API is switched off in the hospital's Google Cloud project. Turn it on in Google Cloud → APIs & Services → Library, wait a few minutes, then try again.";
            if (status == 429 && (msg?.Contains("Quota", StringComparison.OrdinalIgnoreCase) ?? false))
                return "Google gives this API no quota yet. For Business Profile, the project must be approved by Google first (Google → Setup explains how).";
            if (status == 403 && msg == null) return "Google says this account doesn't have access.";
            return msg ?? $"Google said {status}.";
        }

        private static string Key(string refresh) => Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(refresh)))[..16];

        public static string? Str(JsonElement e, string name) =>
            e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v)
                ? v.ValueKind switch { JsonValueKind.String => v.GetString(), JsonValueKind.Number => v.GetRawText(), JsonValueKind.True => "true", JsonValueKind.False => "false", _ => null }
                : null;

        public static decimal Num(string? s) =>
            decimal.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : 0m;

        public static decimal Num(JsonElement e, string name) => Num(Str(e, name));
    }

    /// <summary>
    /// Fetches the day-by-day numbers from each Google account that was picked in Setup and keeps them in channel_metrics,
    /// updating rows in place (Google revises recent days, so every fetch looks back 10 days). Totals only.
    /// </summary>
    public class GoogleSyncService
    {
        public sealed record SourceResult(string Source, string Label, bool Ok, int Rows, string? Error);
        public sealed record SyncResult(DateTime At, DateOnly From, DateOnly To, List<SourceResult> Sources);

        public static readonly Dictionary<string, string> SourceLabels = new()
        {
            ["gbp"] = "Google Business Profile", ["gsc"] = "Search Console", ["ga4"] = "Google Analytics", ["youtube"] = "YouTube", ["google_ads"] = "Google Ads",
        };

        private static readonly (string Api, string Metric)[] GbpMetrics =
        {
            ("CALL_CLICKS", "calls"), ("BUSINESS_DIRECTION_REQUESTS", "directions"), ("WEBSITE_CLICKS", "website_clicks"),
            ("BUSINESS_CONVERSATIONS", "messages"), ("BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", "views_search"), ("BUSINESS_IMPRESSIONS_MOBILE_SEARCH", "views_search"),
            ("BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "views_maps"), ("BUSINESS_IMPRESSIONS_MOBILE_MAPS", "views_maps"),
        };

        private static readonly Dictionary<string, int> StarWords = new() { ["ONE"] = 1, ["TWO"] = 2, ["THREE"] = 3, ["FOUR"] = 4, ["FIVE"] = 5 };

        private readonly IMarketingDbContext _db;
        private readonly IAppSettings _settings;
        private readonly GoogleApi _api;
        private readonly ILogger<GoogleSyncService> _log;

        public GoogleSyncService(IMarketingDbContext db, IAppSettings settings, GoogleApi api, ILogger<GoogleSyncService> log)
        {
            _db = db; _settings = settings; _api = api; _log = log;
        }

        private sealed record Point(DateOnly Date, string Dimension, string? Label, string Metric, decimal Value);

        public async Task<SyncResult> SyncAsync(string by, CancellationToken ct, int? days = null)
        {
            var cfg = GoogleConfig.Load(_settings);
            var to = DateOnly.FromDateTime(IstClock.NowIst);
            var results = new List<SourceResult>();
            if (!cfg.Connected)
            {
                results.Add(new SourceResult("google", "Google", false, 0, "Google isn't connected yet (Google → Setup)."));
                return new SyncResult(DateTime.UtcNow, to, to, results);
            }
            // First fetch of a source: 16 months back (what Search Console keeps); afterwards 10 days to catch Google's revisions.
            async Task<DateOnly> FromFor(string source)
            {
                if (days is int d) return to.AddDays(-(Math.Clamp(d, 1, 540) - 1));
                var any = await _db.ChannelMetrics.AnyAsync(m => m.Source == source, ct);
                return any ? to.AddDays(-9) : to.AddDays(-480);
            }

            if (cfg.GbpLocation != null)
            {
                var from = await FromFor("gbp");
                results.Add(await RunAsync("gbp", cfg.GbpLocation, () => GbpAsync(cfg, from, to, ct), ct));
                results.Add(await ReviewsAsync(cfg, ct));
            }
            if (cfg.GscSite != null) { var from = await FromFor("gsc"); results.Add(await RunAsync("gsc", cfg.GscSite, () => GscAsync(cfg, from, to, ct), ct)); }
            if (cfg.Ga4Property != null) { var from = await FromFor("ga4"); results.Add(await RunAsync("ga4", cfg.Ga4Property, () => Ga4Async(cfg, from, to, ct), ct)); }
            if (cfg.YtChannel != null) { var from = await FromFor("youtube"); results.Add(await RunAsync("youtube", cfg.YtChannel, () => YoutubeAsync(cfg, from, to, ct), ct)); }
            if (cfg.AdsCustomer != null) { var from = await FromFor("google_ads"); results.Add(await RunAsync("google_ads", cfg.AdsCustomer, () => AdsAsync(cfg, from, to, ct), ct)); }

            var at = DateTime.UtcNow;
            await GoogleConfig.SaveAsync(_settings, new()
            {
                ["syncedAt"] = at.ToString("o"),
                ["syncResult"] = JsonSerializer.Serialize(results.Select(r => new { r.Source, r.Label, r.Ok, r.Rows, r.Error })),
            }, by, ct);
            return new SyncResult(at, to.AddDays(-9), to, results);
        }

        private async Task<SourceResult> RunAsync(string source, string account, Func<Task<(List<Point> Points, string? Error)>> fetch, CancellationToken ct)
        {
            var label = SourceLabels[source];
            try
            {
                var (points, error) = await fetch();
                var rows = points.Count > 0 ? await SaveAsync(source, account, points, ct) : 0;
                return new SourceResult(source, label, error == null, rows, error);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _log.LogError(ex, "Google sync failed for {Source}", source);
                return new SourceResult(source, label, false, 0, "Something went wrong reading this source. Try again later.");
            }
        }

        /// <summary>Adds new rows and updates existing ones in place (same day, dimension and metric).</summary>
        private async Task<int> SaveAsync(string source, string account, List<Point> points, CancellationToken ct)
        {
            // Same key twice (e.g. desktop + mobile views) → add them up.
            var merged = points.GroupBy(p => (p.Date, p.Dimension, p.Metric))
                .Select(g => new Point(g.Key.Date, g.Key.Dimension, g.Select(x => x.Label).FirstOrDefault(l => l != null), g.Key.Metric, g.Sum(x => x.Value)))
                .ToList();
            var from = merged.Min(p => p.Date);
            var to = merged.Max(p => p.Date);
            var existing = await _db.ChannelMetrics.Where(m => m.Source == source && m.Account == account && m.Date >= from && m.Date <= to).ToListAsync(ct);
            var map = existing.ToDictionary(m => (m.Date, m.Dimension, m.Metric));
            var now = DateTime.UtcNow;
            foreach (var p in merged)
            {
                var label = p.Label is { Length: > 300 } l ? l[..300] : p.Label;
                var dim = p.Dimension.Length > 400 ? p.Dimension[..400] : p.Dimension;
                if (map.TryGetValue((p.Date, dim, p.Metric), out var row))
                {
                    if (row.Value != p.Value || row.Label != label) { row.Value = p.Value; row.Label = label; row.UpdatedAt = now; }
                }
                else
                {
                    row = new ChannelMetric { Date = p.Date, Source = source, Account = account, Dimension = dim, Label = label, Metric = p.Metric, Value = p.Value, UpdatedAt = now };
                    _db.ChannelMetrics.Add(row);
                    map[(p.Date, dim, p.Metric)] = row;
                }
            }
            await _db.SaveChangesAsync(ct);
            return merged.Count;
        }

        // ─── Google Business Profile ───
        private async Task<(List<Point>, string?)> GbpAsync(GoogleConfig cfg, DateOnly from, DateOnly to, CancellationToken ct)
        {
            var points = new List<Point>();
            // Business Profile keeps 18 months.
            if (from < to.AddMonths(-18)) from = to.AddMonths(-18).AddDays(1);
            var qs = string.Join("&", GbpMetrics.Select(m => m.Api).Distinct().Select(m => "dailyMetrics=" + m))
                + $"&dailyRange.startDate.year={from.Year}&dailyRange.startDate.month={from.Month}&dailyRange.startDate.day={from.Day}"
                + $"&dailyRange.endDate.year={to.Year}&dailyRange.endDate.month={to.Month}&dailyRange.endDate.day={to.Day}";
            var r = await _api.GetAsync(cfg, $"https://businessprofileperformance.googleapis.com/v1/{cfg.GbpLocation}:fetchMultiDailyMetricsTimeSeries?{qs}", ct);
            if (!r.Ok || r.Doc == null) return (points, r.Error);
            using (r.Doc)
            {
                if (r.Doc.RootElement.TryGetProperty("multiDailyMetricTimeSeries", out var multi))
                    foreach (var group in multi.EnumerateArray())
                        if (group.TryGetProperty("dailyMetricTimeSeries", out var series))
                            foreach (var s in series.EnumerateArray())
                            {
                                var api = GoogleApi.Str(s, "dailyMetric");
                                var metric = GbpMetrics.FirstOrDefault(m => m.Api == api).Metric;
                                if (metric == null || !s.TryGetProperty("timeSeries", out var ts) || !ts.TryGetProperty("datedValues", out var vals)) continue;
                                foreach (var v in vals.EnumerateArray())
                                    if (v.TryGetProperty("date", out var d) && GDate(d) is DateOnly day)
                                        points.Add(new Point(day, "", null, metric, GoogleApi.Num(v, "value")));
                            }
            }

            // Search terms that showed the listing. Google gives these per month only, so each month is asked for
            // separately (up to 6 months back the first time; afterwards this month and last month).
            var first = new DateOnly(from.Year, from.Month, 1);
            var floor = new DateOnly(to.Year, to.Month, 1).AddMonths(-5);
            if (first < floor) first = floor;
            for (var month = first; month <= to; month = month.AddMonths(1))
            {
                string? token = null;
                for (int page = 0; page < 10; page++)
                {
                    var url = $"https://businessprofileperformance.googleapis.com/v1/{cfg.GbpLocation}/searchkeywords/impressions/monthly?pageSize=100"
                        + $"&monthlyRange.startMonth.year={month.Year}&monthlyRange.startMonth.month={month.Month}"
                        + $"&monthlyRange.endMonth.year={month.Year}&monthlyRange.endMonth.month={month.Month}"
                        + (token != null ? "&pageToken=" + Uri.EscapeDataString(token) : "");
                    var k = await _api.GetAsync(cfg, url, ct);
                    if (!k.Ok || k.Doc == null) break; // The daily numbers are what matter; search terms are a bonus.
                    using (k.Doc)
                    {
                        var root = k.Doc.RootElement;
                        if (root.TryGetProperty("searchKeywordsCounts", out var counts))
                            foreach (var c in counts.EnumerateArray())
                            {
                                var kw = GoogleApi.Str(c, "searchKeyword");
                                if (string.IsNullOrWhiteSpace(kw) || !c.TryGetProperty("insightsValue", out var iv)) continue;
                                var value = GoogleApi.Str(iv, "value");
                                var under = GoogleApi.Str(iv, "threshold");
                                // Small counts come only as "fewer than N"; kept as N with the label "under".
                                points.Add(new Point(month, "keyword:" + kw.Trim().ToLowerInvariant(), value == null && under != null ? "under" : null,
                                    "keyword_views", GoogleApi.Num(value ?? under)));
                            }
                        token = GoogleApi.Str(root, "nextPageToken");
                    }
                    if (token == null) break;
                }
            }
            return (points, null);
        }

        private async Task<SourceResult> ReviewsAsync(GoogleConfig cfg, CancellationToken ct)
        {
            const string label = "Google reviews";
            if (cfg.GbpAccount == null || cfg.GbpLocation == null) return new SourceResult("reviews", label, false, 0, "Pick the Business Profile again in Setup.");
            try
            {
                var known = await _db.GoogleReviews.ToDictionaryAsync(r => r.ReviewName, ct);
                var newest = known.Count == 0 ? (DateTime?)null : known.Values.Max(r => r.ReviewUpdatedAt ?? r.PostedAt);
                string? token = null;
                int seen = 0;
                decimal? average = null;
                int? total = null;
                for (int page = 0; page < 40; page++)
                {
                    var url = $"https://mybusiness.googleapis.com/v4/{cfg.GbpAccount}/{cfg.GbpLocation}/reviews?pageSize=50&orderBy=updateTime%20desc"
                        + (token != null ? "&pageToken=" + Uri.EscapeDataString(token) : "");
                    var r = await _api.GetAsync(cfg, url, ct);
                    if (!r.Ok || r.Doc == null) return new SourceResult("reviews", label, false, seen, r.Error);
                    bool older = false;
                    using (r.Doc)
                    {
                        var root = r.Doc.RootElement;
                        if (root.TryGetProperty("averageRating", out var avg) && avg.TryGetDecimal(out var a)) average = a;
                        if (root.TryGetProperty("totalReviewCount", out var tot) && tot.TryGetInt32(out var t)) total = t;
                        if (root.TryGetProperty("reviews", out var reviews))
                            foreach (var x in reviews.EnumerateArray())
                            {
                                var name = GoogleApi.Str(x, "name");
                                if (name == null) continue;
                                seen++;
                                var updated = ParseTime(GoogleApi.Str(x, "updateTime"));
                                if (newest != null && updated != null && updated < newest.Value.AddDays(-2)) older = true;
                                if (!known.TryGetValue(name, out var row))
                                {
                                    row = new GoogleReview { ReviewName = name, Location = cfg.GbpLocation };
                                    _db.GoogleReviews.Add(row);
                                    known[name] = row;
                                }
                                row.ReviewerName = x.TryGetProperty("reviewer", out var rv) ? GoogleApi.Str(rv, "displayName") : null;
                                row.Stars = StarWords.TryGetValue(GoogleApi.Str(x, "starRating") ?? "", out var st) ? st : 0;
                                row.Comment = TrimTranslation(GoogleApi.Str(x, "comment"));
                                row.PostedAt = ParseTime(GoogleApi.Str(x, "createTime")) ?? DateTime.UtcNow;
                                row.ReviewUpdatedAt = updated;
                                if (x.TryGetProperty("reviewReply", out var rep))
                                {
                                    row.ReplyText = GoogleApi.Str(rep, "comment");
                                    row.RepliedAt = ParseTime(GoogleApi.Str(rep, "updateTime")) ?? row.RepliedAt;
                                }
                                else { row.ReplyText = null; row.RepliedAt = null; }
                                row.SyncedAt = DateTime.UtcNow;
                            }
                        token = GoogleApi.Str(root, "nextPageToken");
                    }
                    // Already up to date past this page.
                    if (token == null || older) break;
                }
                await _db.SaveChangesAsync(ct);
                // Rating and count over time, so the trend can be shown.
                var today = DateOnly.FromDateTime(IstClock.NowIst);
                var pts = new List<Point>();
                if (average != null) pts.Add(new Point(today, "", null, "rating", average.Value));
                if (total != null) pts.Add(new Point(today, "", null, "review_count", total.Value));
                if (pts.Count > 0) await SaveAsync("gbp", cfg.GbpLocation, pts, ct);
                return new SourceResult("reviews", label, true, seen, null);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _log.LogError(ex, "Google reviews sync failed");
                return new SourceResult("reviews", label, false, 0, "Something went wrong reading reviews. Try again later.");
            }
        }

        /// <summary>Posts (or replaces) the hospital's reply to a review on Google.</summary>
        public async Task<string?> ReplyAsync(GoogleReview review, string text, string by, CancellationToken ct)
        {
            var cfg = GoogleConfig.Load(_settings);
            var r = await _api.PutAsync(cfg, $"https://mybusiness.googleapis.com/v4/{review.ReviewName}/reply", new { comment = text }, ct);
            r.Doc?.Dispose();
            if (!r.Ok) return r.Error;
            review.ReplyText = text;
            review.RepliedAt = DateTime.UtcNow;
            review.RepliedBy = by;
            await _db.SaveChangesAsync(ct);
            return null;
        }

        // ─── Search Console ───
        private async Task<(List<Point>, string?)> GscAsync(GoogleConfig cfg, DateOnly from, DateOnly to, CancellationToken ct)
        {
            var points = new List<Point>();
            var url = $"https://www.googleapis.com/webmasters/v3/sites/{Uri.EscapeDataString(cfg.GscSite!)}/searchAnalytics/query";
            var r = await _api.PostAsync(cfg, url, new { startDate = D(from), endDate = D(to), dimensions = new[] { "date" }, rowLimit = 1000, dataState = "all" }, ct);
            if (!r.Ok || r.Doc == null) return (points, r.Error);
            using (r.Doc)
                foreach (var row in Rows(r.Doc.RootElement))
                    if (Key(row, 0) is string k && DateOnly.TryParse(k, CultureInfo.InvariantCulture, out var day))
                    {
                        var impr = GoogleApi.Num(row, "impressions");
                        points.Add(new Point(day, "", null, "clicks", GoogleApi.Num(row, "clicks")));
                        points.Add(new Point(day, "", null, "impressions", impr));
                        // Kept as position × impressions so a period's average can be weighted correctly.
                        points.Add(new Point(day, "", null, "position_x_impr", GoogleApi.Num(row, "position") * impr));
                    }

            // Search terms per day, in slices so a long first fetch stays within Google's row limit.
            for (var start = from; start <= to; start = start.AddDays(30))
            {
                var end = start.AddDays(29) > to ? to : start.AddDays(29);
                for (int startRow = 0; startRow < 25000; startRow += 5000)
                {
                    var q = await _api.PostAsync(cfg, url, new { startDate = D(start), endDate = D(end), dimensions = new[] { "date", "query" }, rowLimit = 5000, startRow, dataState = "all" }, ct);
                    if (!q.Ok || q.Doc == null) return (points, q.Error);
                    int n = 0;
                    using (q.Doc)
                        foreach (var row in Rows(q.Doc.RootElement))
                        {
                            n++;
                            if (Key(row, 0) is not string k || !DateOnly.TryParse(k, CultureInfo.InvariantCulture, out var day) || Key(row, 1) is not string query) continue;
                            var dim = "query:" + query.Trim().ToLowerInvariant();
                            var impr = GoogleApi.Num(row, "impressions");
                            points.Add(new Point(day, dim, null, "clicks", GoogleApi.Num(row, "clicks")));
                            points.Add(new Point(day, dim, null, "impressions", impr));
                            points.Add(new Point(day, dim, null, "position_x_impr", GoogleApi.Num(row, "position") * impr));
                        }
                    if (n < 5000) break;
                }
            }
            return (points, null);
        }

        // ─── Google Analytics 4 ───
        private async Task<(List<Point>, string?)> Ga4Async(GoogleConfig cfg, DateOnly from, DateOnly to, CancellationToken ct)
        {
            var points = new List<Point>();
            var url = $"https://analyticsdata.googleapis.com/v1beta/{cfg.Ga4Property}:runReport";
            var totals = new[] { "sessions", "totalUsers", "newUsers", "keyEvents", "screenPageViews" };
            var names = new[] { "sessions", "users", "new_users", "key_events", "page_views" };

            async Task<string?> Report(string[] dims, string[] metrics, Func<string[], string?> dimension, Func<string[], string?> label)
            {
                for (int offset = 0; offset < 100000; offset += 10000)
                {
                    var r = await _api.PostAsync(cfg, url, new
                    {
                        dateRanges = new[] { new { startDate = D(from), endDate = D(to) } },
                        dimensions = dims.Select(d => new { name = d }).ToArray(),
                        metrics = metrics.Select(m => new { name = m }).ToArray(),
                        limit = 10000,
                        offset,
                    }, ct);
                    if (!r.Ok || r.Doc == null) return r.Error;
                    int n = 0;
                    using (r.Doc)
                        if (r.Doc.RootElement.TryGetProperty("rows", out var rows))
                            foreach (var row in rows.EnumerateArray())
                            {
                                n++;
                                var dv = row.GetProperty("dimensionValues").EnumerateArray().Select(x => GoogleApi.Str(x, "value") ?? "").ToArray();
                                var mv = row.GetProperty("metricValues").EnumerateArray().Select(x => GoogleApi.Str(x, "value")).ToArray();
                                if (!DateOnly.TryParseExact(dv[0], "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day)) continue;
                                var dim = dimension(dv);
                                if (dim == null) continue;
                                for (int i = 0; i < metrics.Length && i < mv.Length; i++)
                                    points.Add(new Point(day, dim, label(dv), names[Array.IndexOf(totals, metrics[i])], GoogleApi.Num(mv[i])));
                            }
                    if (n < 10000) break;
                }
                return null;
            }

            var err = await Report(new[] { "date" }, totals, _ => "", _ => null);
            if (err != null) return (points, err);
            err = await Report(new[] { "date", "sessionDefaultChannelGroup" }, new[] { "sessions", "totalUsers", "keyEvents" }, d => "channel:" + d[1], d => d[1]);
            if (err != null) return (points, err);
            // Campaigns from the UTM tags on links (utm_campaign); GA4's own placeholders are skipped.
            err = await Report(new[] { "date", "sessionCampaignName", "sessionSource" }, new[] { "sessions", "keyEvents" },
                d => d[1] is "" or "(not set)" or "(direct)" or "(organic)" or "(referral)" or "(none)" ? null : "campaign:" + d[1].Trim().ToLowerInvariant() + "|" + d[2].Trim().ToLowerInvariant(),
                d => $"{d[1]} ({d[2]})");
            return (points, err);
        }

        // ─── YouTube ───
        private async Task<(List<Point>, string?)> YoutubeAsync(GoogleConfig cfg, DateOnly from, DateOnly to, CancellationToken ct)
        {
            var points = new List<Point>();
            var metrics = "views,estimatedMinutesWatched,subscribersGained,subscribersLost,likes,comments,shares";
            var r = await _api.GetAsync(cfg, $"https://youtubeanalytics.googleapis.com/v2/reports?ids=channel%3D%3DMINE&startDate={D(from)}&endDate={D(to)}&dimensions=day&metrics={metrics}&sort=day", ct);
            if (!r.Ok || r.Doc == null) return (points, r.Error);
            using (r.Doc)
            {
                var root = r.Doc.RootElement;
                if (!root.TryGetProperty("columnHeaders", out var heads) || !root.TryGetProperty("rows", out var rows)) return (points, null);
                var cols = heads.EnumerateArray().Select(h => GoogleApi.Str(h, "name") ?? "").ToArray();
                var map = new Dictionary<string, string>
                {
                    ["views"] = "views", ["estimatedMinutesWatched"] = "watch_minutes", ["subscribersGained"] = "subscribers_gained",
                    ["subscribersLost"] = "subscribers_lost", ["likes"] = "likes", ["comments"] = "comments", ["shares"] = "shares",
                };
                foreach (var row in rows.EnumerateArray())
                {
                    var cells = row.EnumerateArray().ToArray();
                    if (cells.Length == 0 || !DateOnly.TryParse(cells[0].GetString(), CultureInfo.InvariantCulture, out var day)) continue;
                    for (int i = 1; i < cells.Length && i < cols.Length; i++)
                        if (map.TryGetValue(cols[i], out var m)) points.Add(new Point(day, "", null, m, cells[i].TryGetDecimal(out var v) ? v : 0));
                }
            }
            return (points, null);
        }

        // ─── Google Ads ───
        private async Task<(List<Point>, string?)> AdsAsync(GoogleConfig cfg, DateOnly from, DateOnly to, CancellationToken ct)
        {
            var points = new List<Point>();
            if (string.IsNullOrWhiteSpace(cfg.AdsDeveloperToken)) return (points, "Add the Google Ads developer token in Setup.");
            var query = "SELECT segments.date, campaign.id, campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.phone_calls "
                + $"FROM campaign WHERE segments.date BETWEEN '{D(from)}' AND '{D(to)}' AND metrics.impressions > 0";
            string? token = null;
            for (int page = 0; page < 50; page++)
            {
                var r = await _api.PostAsync(cfg, $"https://googleads.googleapis.com/{cfg.AdsVersion}/customers/{cfg.AdsCustomer}/googleAds:search",
                    token == null ? new { query } : new { query, pageToken = token }, ct, AdsHeaders(cfg));
                if (!r.Ok || r.Doc == null) return (points, r.Error);
                using (r.Doc)
                {
                    var root = r.Doc.RootElement;
                    if (root.TryGetProperty("results", out var results))
                        foreach (var x in results.EnumerateArray())
                        {
                            if (!x.TryGetProperty("segments", out var seg) || !DateOnly.TryParse(GoogleApi.Str(seg, "date"), CultureInfo.InvariantCulture, out var day)) continue;
                            var camp = x.GetProperty("campaign");
                            var id = GoogleApi.Str(camp, "id") ?? "";
                            var name = GoogleApi.Str(camp, "name") ?? id;
                            var m = x.GetProperty("metrics");
                            var values = new (string Metric, decimal Value)[]
                            {
                                ("cost", GoogleApi.Num(m, "costMicros") / 1_000_000m), ("impressions", GoogleApi.Num(m, "impressions")), ("clicks", GoogleApi.Num(m, "clicks")),
                                ("conversions", GoogleApi.Num(m, "conversions")), ("phone_calls", GoogleApi.Num(m, "phoneCalls")),
                            };
                            foreach (var (metric, value) in values)
                            {
                                points.Add(new Point(day, "campaign:" + id, name, metric, value));
                                points.Add(new Point(day, "", null, metric, value));
                            }
                        }
                    token = GoogleApi.Str(root, "nextPageToken");
                }
                if (token == null) break;
            }
            return (points, null);
        }

        public static Dictionary<string, string> AdsHeaders(GoogleConfig cfg, string? loginCustomer = null)
        {
            var h = new Dictionary<string, string> { ["developer-token"] = cfg.AdsDeveloperToken ?? "" };
            var login = loginCustomer ?? cfg.AdsLoginCustomer;
            if (!string.IsNullOrWhiteSpace(login)) h["login-customer-id"] = login;
            return h;
        }

        private static IEnumerable<JsonElement> Rows(JsonElement root) =>
            root.TryGetProperty("rows", out var rows) && rows.ValueKind == JsonValueKind.Array ? rows.EnumerateArray() : Enumerable.Empty<JsonElement>();

        private static string? Key(JsonElement row, int i) =>
            row.TryGetProperty("keys", out var keys) && keys.GetArrayLength() > i ? keys[i].GetString() : null;

        private static string D(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

        private static DateOnly? GDate(JsonElement d)
        {
            try
            {
                return new DateOnly(d.GetProperty("year").GetInt32(), d.GetProperty("month").GetInt32(), d.GetProperty("day").GetInt32());
            }
            catch (Exception ex) when (ex is KeyNotFoundException || ex is InvalidOperationException || ex is ArgumentOutOfRangeException) { return null; }
        }

        private static DateTime? ParseTime(string? s) =>
            DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var t) ? t : null;

        /// <summary>Google appends "(Translated by Google) …" to reviews in other languages; keep the original words only.</summary>
        private static string? TrimTranslation(string? s)
        {
            if (s == null) return null;
            var i = s.IndexOf("\n\n(Translated by Google)", StringComparison.Ordinal);
            if (i > 0) s = s[..i];
            if (s.StartsWith("(Translated by Google)", StringComparison.Ordinal))
            {
                var o = s.IndexOf("(Original)", StringComparison.Ordinal);
                if (o > 0) s = s[(o + "(Original)".Length)..].Trim();
            }
            return s.Length > 4000 ? s[..4000] : s;
        }
    }

    /// <summary>Fetches the Google numbers once a day, after 6 am IST, when Google is connected.</summary>
    public class GoogleSyncScheduler : BackgroundService
    {
        private readonly IServiceScopeFactory _scopes;
        private readonly ILogger<GoogleSyncScheduler> _log;
        private readonly OrgDirectory _orgs;
        public GoogleSyncScheduler(IServiceScopeFactory scopes, ILogger<GoogleSyncScheduler> log, OrgDirectory orgs) { _scopes = scopes; _log = log; _orgs = orgs; }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            try { await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken); } catch (OperationCanceledException) { return; }
            while (!stoppingToken.IsCancellationRequested)
            {
                await _orgs.ForEachAsync(async _ =>
                {
                    using var scope = _scopes.CreateScope();
                    var settings = scope.ServiceProvider.GetRequiredService<IAppSettings>();
                    var cfg = GoogleConfig.Load(settings);
                    var last = DateTime.TryParse(cfg.SyncedAt, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var t) ? t : (DateTime?)null;
                    var due = last == null || IstClock.StartOfDayUtc(last.Value) < IstClock.TodayStartUtc;
                    if (cfg.Connected && cfg.AnySource && due && IstClock.NowIst.Hour >= 6)
                        await scope.ServiceProvider.GetRequiredService<GoogleSyncService>().SyncAsync("auto", stoppingToken);
                });
                try { await Task.Delay(TimeSpan.FromMinutes(30), stoppingToken); }
                catch (OperationCanceledException) { break; }
            }
        }
    }
}
