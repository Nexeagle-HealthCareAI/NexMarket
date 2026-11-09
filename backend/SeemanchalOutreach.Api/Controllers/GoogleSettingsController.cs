using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Controllers
{
    public class GoogleClientDto
    {
        public string? ClientId { get; set; }
        /// <summary>Missing or null = keep the saved one, "" = remove it.</summary>
        public string? ClientSecret { get; set; }
        public string? AdsDeveloperToken { get; set; }
        public string? AdsVersion { get; set; }
    }

    public class GoogleConnectDto
    {
        /// <summary>The CRM's own address (window.location.origin), so Google can send the admin back to it.</summary>
        public string? ReturnTo { get; set; }
    }

    public class GooglePickDto
    {
        /// <summary>Each: null = leave as is, "" = stop fetching it, else the id from /options.</summary>
        public string? Ga4Property { get; set; }
        public string? Ga4Name { get; set; }
        public string? GscSite { get; set; }
        public string? GbpLocation { get; set; }
        public string? GbpAccount { get; set; }
        public string? GbpName { get; set; }
        public string? YtChannel { get; set; }
        public string? YtName { get; set; }
        public string? AdsCustomer { get; set; }
        public string? AdsLoginCustomer { get; set; }
        public string? AdsName { get; set; }
        public string? AdsCurrency { get; set; }
    }

    /// <summary>
    /// Google → Setup: an admin enters the hospital's Google Cloud OAuth client once, signs in with the hospital's Google
    /// account, and picks which Business Profile, website, Analytics property, YouTube channel and Ads account to follow.
    /// NexMarket then reads them directly from Google: no third-party service, no monthly fee.
    /// </summary>
    [ApiController]
    [Route("api/v1/settings/google")]
    [Authorize(Roles = "Admin,admin")]
    public class GoogleSettingsController : ControllerBase
    {
        private static readonly Regex ClientIdRx = new(@"^[\w\-]+\.apps\.googleusercontent\.com$");
        private static readonly Regex AdsVersionRx = new(@"^v\d{2}$");
        private static readonly Regex Digits = new(@"^\d{6,12}$");

        private readonly IAppSettings _settings;
        private readonly GoogleApi _api;
        private readonly IConfiguration _config;

        public GoogleSettingsController(IAppSettings settings, GoogleApi api, IConfiguration config)
        {
            _settings = settings; _api = api; _config = config;
        }

        private GoogleConfig Cfg => GoogleConfig.Load(_settings);
        private static string? Hint(string? s) => string.IsNullOrEmpty(s) ? null : s.Length <= 6 ? "••••" : "••••" + s[^4..];
        private Task SaveAsync(Dictionary<string, string?> v, CancellationToken ct) => GoogleConfig.SaveAsync(_settings, v, User.AgentIdOf(), ct);

        /// <summary>Where Google sends the admin back after signing in. Must be listed in the OAuth client in Google Cloud.</summary>
        public static string RedirectUri(HttpRequest req)
        {
            var host = req.Host.Value ?? "";
            var local = host.StartsWith("localhost") || host.StartsWith("127.0.0.1");
            return $"{(local ? req.Scheme : "https")}://{host}/api/v1/google/oauth/callback";
        }

        [HttpGet]
        public IActionResult Get()
        {
            var c = Cfg;
            object? lastSync = null;
            if (c.SyncResult != null)
                try { lastSync = JsonSerializer.Deserialize<JsonElement>(c.SyncResult); } catch (JsonException) { /* old value */ }
            return Ok(new
            {
                clientId = c.ClientId,
                clientSecret = Hint(c.ClientSecret),
                hasClient = c.HasClient,
                connected = c.Connected,
                email = c.Email,
                connectedAt = c.ConnectedAt,
                redirectUri = RedirectUri(Request),
                missingScopes = c.Connected && c.GrantedScopes != null
                    ? GoogleConfig.Scopes.Where(s => s.Scope.StartsWith("https://") && !c.GrantedScopes.Split(' ').Contains(s.Scope)).Select(s => s.For).ToArray()
                    : Array.Empty<string>(),
                scopes = GoogleConfig.Scopes.Where(s => s.Scope.StartsWith("https://")).Select(s => new { scope = s.Scope, @for = s.For }),
                adsDeveloperToken = Hint(c.AdsDeveloperToken),
                adsVersion = c.AdsVersion,
                picked = new
                {
                    gbp = c.GbpLocation == null ? null : new { id = c.GbpLocation, account = c.GbpAccount, name = c.GbpName },
                    gsc = c.GscSite == null ? null : new { id = c.GscSite, name = c.GscSite },
                    ga4 = c.Ga4Property == null ? null : new { id = c.Ga4Property, name = c.Ga4Name },
                    youtube = c.YtChannel == null ? null : new { id = c.YtChannel, name = c.YtName },
                    ads = c.AdsCustomer == null ? null : new { id = c.AdsCustomer, login = c.AdsLoginCustomer, name = c.AdsName, currency = c.AdsCurrency },
                },
                syncedAt = c.SyncedAt,
                lastSync,
            });
        }

        [HttpPut]
        public async Task<IActionResult> SaveClient([FromBody] GoogleClientDto dto, CancellationToken ct)
        {
            var v = new Dictionary<string, string?>();
            if (dto.ClientId != null)
            {
                var id = dto.ClientId.Trim();
                if (id.Length > 0 && !ClientIdRx.IsMatch(id)) return BadRequest(new { message = "The client ID ends in .apps.googleusercontent.com — copy it from Google Cloud → APIs & Services → Credentials." });
                if (id != Cfg.ClientId) { v["clientId"] = id; v["refreshToken"] = null; v["email"] = null; v["connectedAt"] = null; }
            }
            if (dto.ClientSecret != null)
            {
                var sec = dto.ClientSecret.Trim();
                if (sec.Length > 0 && (sec.Length < 10 || sec.Length > 100 || sec.Contains(' '))) return BadRequest(new { message = "That doesn't look like a client secret." });
                v["clientSecret"] = sec;
            }
            if (dto.AdsDeveloperToken != null)
            {
                var t = dto.AdsDeveloperToken.Trim();
                if (t.Length > 0 && (t.Length < 10 || t.Length > 60 || t.Contains(' '))) return BadRequest(new { message = "That doesn't look like a Google Ads developer token." });
                v["adsDeveloperToken"] = t;
            }
            if (dto.AdsVersion != null)
            {
                var ver = dto.AdsVersion.Trim();
                if (ver.Length > 0 && !AdsVersionRx.IsMatch(ver)) return BadRequest(new { message = "Google Ads API version looks like v25." });
                v["adsVersion"] = ver;
            }
            if (v.Count > 0) await SaveAsync(v, ct);
            return Get();
        }

        /// <summary>Starts the Google sign-in: returns the address to send the admin to.</summary>
        [HttpPost("connect")]
        public async Task<IActionResult> Connect([FromBody] GoogleConnectDto dto, CancellationToken ct)
        {
            var c = Cfg;
            if (!c.HasClient) return BadRequest(new { message = "Save the Google client ID and secret first." });
            var allowed = (_config["Cors:AllowedOrigins"] ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            var returnTo = dto.ReturnTo?.TrimEnd('/');
            if (returnTo == null || !(allowed.Contains(returnTo, StringComparer.OrdinalIgnoreCase) || returnTo.StartsWith("http://localhost")))
                returnTo = allowed.FirstOrDefault() ?? "";
            var state = Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
            await SaveAsync(new() { ["oauthState"] = state, ["oauthStateAt"] = DateTime.UtcNow.ToString("o"), ["returnTo"] = returnTo }, ct);
            return Ok(new { url = GoogleApi.AuthUrl(c, RedirectUri(Request), state) });
        }

        [HttpPost("disconnect")]
        public async Task<IActionResult> Disconnect(CancellationToken ct)
        {
            var c = Cfg;
            if (c.RefreshToken != null) await _api.RevokeAsync(c.RefreshToken, ct);
            // The numbers already fetched stay; only the connection is removed.
            await SaveAsync(new() { ["refreshToken"] = null, ["email"] = null, ["connectedAt"] = null, ["scopes"] = null }, ct);
            return Get();
        }

        /// <summary>What the connected Google account can see, for the admin to pick from. Each part may fail on its own.</summary>
        [HttpGet("options")]
        public async Task<IActionResult> Options(CancellationToken ct)
        {
            var c = Cfg;
            if (!c.Connected) return BadRequest(new { message = "Connect the Google account first." });

            async Task<object> Part(Func<Task<List<object>>> f)
            {
                try { return new { items = await f(), error = (string?)null }; }
                catch (GoogleFail e) { return new { items = new List<object>(), error = e.Message }; }
            }
            async Task<JsonDocument> Fetch(string url, IDictionary<string, string>? h = null)
            {
                var r = await _api.GetAsync(c, url, ct, h);
                if (!r.Ok || r.Doc == null) throw new GoogleFail(r.Error ?? "Google didn't answer.");
                return r.Doc;
            }

            var gbp = Part(async () =>
            {
                var list = new List<object>();
                using var accounts = await Fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20");
                if (!accounts.RootElement.TryGetProperty("accounts", out var accs)) return list;
                foreach (var a in accs.EnumerateArray().Take(10))
                {
                    var acc = GoogleApi.Str(a, "name");
                    if (acc == null) continue;
                    using var locs = await Fetch($"https://mybusinessbusinessinformation.googleapis.com/v1/{acc}/locations?readMask=name,title,storefrontAddress&pageSize=100");
                    if (!locs.RootElement.TryGetProperty("locations", out var ls)) continue;
                    foreach (var l in ls.EnumerateArray())
                    {
                        var town = l.TryGetProperty("storefrontAddress", out var ad) ? GoogleApi.Str(ad, "locality") : null;
                        list.Add(new { id = GoogleApi.Str(l, "name"), account = acc, name = GoogleApi.Str(l, "title"), detail = town ?? GoogleApi.Str(a, "accountName") });
                    }
                }
                return list;
            });
            var gsc = Part(async () =>
            {
                using var d = await Fetch("https://www.googleapis.com/webmasters/v3/sites");
                return d.RootElement.TryGetProperty("siteEntry", out var s)
                    ? s.EnumerateArray().Where(x => GoogleApi.Str(x, "permissionLevel") != "siteUnverifiedUser")
                        .Select(x => (object)new { id = GoogleApi.Str(x, "siteUrl"), name = GoogleApi.Str(x, "siteUrl"), detail = GoogleApi.Str(x, "permissionLevel") }).ToList()
                    : new List<object>();
            });
            var ga4 = Part(async () =>
            {
                using var d = await Fetch("https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200");
                var list = new List<object>();
                if (d.RootElement.TryGetProperty("accountSummaries", out var sums))
                    foreach (var a in sums.EnumerateArray())
                        if (a.TryGetProperty("propertySummaries", out var ps))
                            foreach (var p in ps.EnumerateArray())
                                list.Add(new { id = GoogleApi.Str(p, "property"), name = GoogleApi.Str(p, "displayName"), detail = GoogleApi.Str(a, "displayName") });
                return list;
            });
            var yt = Part(async () =>
            {
                using var d = await Fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true");
                return d.RootElement.TryGetProperty("items", out var items)
                    ? items.EnumerateArray().Select(x => (object)new { id = GoogleApi.Str(x, "id"), name = x.TryGetProperty("snippet", out var sn) ? GoogleApi.Str(sn, "title") : null, detail = (string?)null }).ToList()
                    : new List<object>();
            });
            var ads = Part(async () =>
            {
                if (string.IsNullOrWhiteSpace(c.AdsDeveloperToken)) throw new GoogleFail("Add the Google Ads developer token above to see ad accounts.");
                using var d = await Fetch($"https://googleads.googleapis.com/{c.AdsVersion}/customers:listAccessibleCustomers", GoogleSyncService.AdsHeaders(c, ""));
                var list = new List<object>();
                if (!d.RootElement.TryGetProperty("resourceNames", out var names)) return list;
                foreach (var n in names.EnumerateArray().Take(15))
                {
                    var id = n.GetString()?.Replace("customers/", "");
                    if (id == null) continue;
                    var r = await _api.PostAsync(c, $"https://googleads.googleapis.com/{c.AdsVersion}/customers/{id}/googleAds:search",
                        new { query = "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager FROM customer" }, ct, GoogleSyncService.AdsHeaders(c, id));
                    string? name = null, currency = null; bool manager = false;
                    if (r.Ok && r.Doc != null)
                        using (r.Doc)
                            if (r.Doc.RootElement.TryGetProperty("results", out var res) && res.GetArrayLength() > 0 && res[0].TryGetProperty("customer", out var cu))
                            {
                                name = GoogleApi.Str(cu, "descriptiveName"); currency = GoogleApi.Str(cu, "currencyCode"); manager = GoogleApi.Str(cu, "manager") == "true";
                            }
                    list.Add(new { id, name = name ?? FormatCid(id), detail = manager ? "Manager account" : currency, currency, manager });
                }
                return list;
            });
            await Task.WhenAll(gbp, gsc, ga4, yt, ads);
            return Ok(new { gbp = gbp.Result, gsc = gsc.Result, ga4 = ga4.Result, youtube = yt.Result, ads = ads.Result });
        }

        [HttpPut("pick")]
        public async Task<IActionResult> Pick([FromBody] GooglePickDto dto, CancellationToken ct)
        {
            var v = new Dictionary<string, string?>();
            static string? Clean(string? s, int max) => s == null ? null : s.Trim().Length > max ? s.Trim()[..max] : s.Trim();
            if (dto.Ga4Property != null)
            {
                if (dto.Ga4Property.Length > 0 && !Regex.IsMatch(dto.Ga4Property, @"^properties/\d{3,15}$")) return BadRequest(new { message = "Pick the Analytics property from the list." });
                v["ga4Property"] = dto.Ga4Property; v["ga4Name"] = Clean(dto.Ga4Name, 120);
            }
            if (dto.GscSite != null)
            {
                if (dto.GscSite.Length > 0 && !(dto.GscSite.StartsWith("https://") || dto.GscSite.StartsWith("http://") || dto.GscSite.StartsWith("sc-domain:")) ) return BadRequest(new { message = "Pick the website from the list." });
                v["gscSite"] = Clean(dto.GscSite, 200);
            }
            if (dto.GbpLocation != null)
            {
                if (dto.GbpLocation.Length > 0 && (!Regex.IsMatch(dto.GbpLocation, @"^locations/\d{3,25}$") || !Regex.IsMatch(dto.GbpAccount ?? "", @"^accounts/\d{3,25}$")))
                    return BadRequest(new { message = "Pick the Business Profile from the list." });
                v["gbpLocation"] = dto.GbpLocation; v["gbpAccount"] = dto.GbpLocation.Length > 0 ? dto.GbpAccount : ""; v["gbpName"] = Clean(dto.GbpName, 120);
            }
            if (dto.YtChannel != null)
            {
                if (dto.YtChannel.Length > 0 && !Regex.IsMatch(dto.YtChannel, @"^UC[\w\-]{10,40}$")) return BadRequest(new { message = "Pick the YouTube channel from the list." });
                v["ytChannel"] = dto.YtChannel; v["ytName"] = Clean(dto.YtName, 120);
            }
            if (dto.AdsCustomer != null)
            {
                var cid = dto.AdsCustomer.Replace("-", "");
                var login = (dto.AdsLoginCustomer ?? "").Replace("-", "");
                if (cid.Length > 0 && (!Digits.IsMatch(cid) || (login.Length > 0 && !Digits.IsMatch(login)))) return BadRequest(new { message = "A Google Ads customer ID has 10 digits, like 123-456-7890." });
                v["adsCustomer"] = cid; v["adsLoginCustomer"] = login; v["adsName"] = Clean(dto.AdsName, 120); v["adsCurrency"] = Clean(dto.AdsCurrency, 3);
            }
            if (v.Count > 0) await SaveAsync(v, ct);
            return Get();
        }

        private static string FormatCid(string id) => id.Length == 10 ? $"{id[..3]}-{id[3..6]}-{id[6..]}" : id;

        private sealed class GoogleFail : Exception { public GoogleFail(string m) : base(m) { } }
    }

    /// <summary>Google sends the admin back here after they sign in. Not behind the CRM login (it's a browser redirect),
    /// so it only accepts the one-time state made by /connect within the last 15 minutes.</summary>
    [ApiController]
    [Route("api/v1/google/oauth")]
    [AllowAnonymous]
    public class GoogleOAuthController : ControllerBase
    {
        private readonly IAppSettings _settings;
        private readonly GoogleApi _api;
        public GoogleOAuthController(IAppSettings settings, GoogleApi api) { _settings = settings; _api = api; }

        [HttpGet("callback")]
        public async Task<IActionResult> Callback([FromQuery] string? code, [FromQuery] string? state, [FromQuery] string? error, CancellationToken ct)
        {
            var c = GoogleConfig.Load(_settings);
            var back = (c.ReturnTo ?? "") + "/admin/google?tab=setup";
            IActionResult Done(string? problem) => Redirect(back + (problem == null ? "&google=connected" : "&google_error=" + Uri.EscapeDataString(problem)));

            var at = DateTime.TryParse(c.OauthStateAt, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var t) ? t : DateTime.MinValue;
            var fresh = c.OauthState != null && state != null && at > DateTime.UtcNow.AddMinutes(-15)
                && CryptographicOperations.FixedTimeEquals(System.Text.Encoding.UTF8.GetBytes(c.OauthState), System.Text.Encoding.UTF8.GetBytes(state));
            if (!fresh) return Done("This sign-in link has expired. Press Connect again.");
            // One use only.
            await GoogleConfig.SaveAsync(_settings, new() { ["oauthState"] = null, ["oauthStateAt"] = null }, "google", ct);
            if (error != null) return Done(error == "access_denied" ? "Google sign-in was cancelled." : "Google said: " + error);
            if (string.IsNullOrWhiteSpace(code)) return Done("Google didn't send a sign-in code.");

            var (refresh, email, scopes, problem) = await _api.ExchangeCodeAsync(c, code, GoogleSettingsController.RedirectUri(Request), ct);
            if (refresh == null) return Done(problem ?? "Google sign-in didn't finish.");
            await GoogleConfig.SaveAsync(_settings, new()
            {
                ["refreshToken"] = refresh, ["email"] = email, ["scopes"] = scopes, ["connectedAt"] = DateTime.UtcNow.ToString("o"),
            }, email ?? "google", ct);
            return Done(null);
        }
    }
}
