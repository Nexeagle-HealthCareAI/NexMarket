using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Controllers
{
    public class MetaSettingsDto
    {
        public string? AppId { get; set; }
        public string? VerifyToken { get; set; }
        public string? ApiVersion { get; set; }
        /// <summary>Missing or null = keep the saved one, "" = remove it.</summary>
        public string? AppSecret { get; set; }
        public string? AccessToken { get; set; }
    }

    public class MetaConnectDto
    {
        public string? PageId { get; set; }
        /// <summary>act_… or "" for none.</summary>
        public string? AdAccountId { get; set; }
    }

    /// <summary>
    /// Facebook &amp; Instagram → Setup: an admin connects the hospital's Facebook app, Page, Instagram account and ad
    /// account from the CRM. Tokens are stored encrypted and only the last four characters are ever shown.
    /// </summary>
    [ApiController]
    [Route("api/v1/settings/meta")]
    [Authorize(Roles = "Admin,admin")]
    public class MetaSettingsController : ControllerBase
    {
        /// <summary>What the CRM needs the token to allow, and what each is for.</summary>
        public static readonly (string Scope, string For)[] Needed =
        {
            ("pages_show_list", "See the Page"),
            ("pages_read_engagement", "Read the Page"),
            ("pages_manage_metadata", "Receive Page events (webhook)"),
            ("leads_retrieval", "Read Lead Ads forms"),
            ("pages_messaging", "Read and answer Facebook messages"),
            ("instagram_basic", "See the Instagram account"),
            ("instagram_manage_messages", "Read and answer Instagram messages"),
            ("ads_read", "Ad spend and results"),
        };

        private static readonly Regex Digits = new(@"^\d{5,25}$");
        private static readonly Regex Version = new(@"^v\d{1,2}\.\d$");

        private readonly IAppSettings _settings;
        private readonly MetaGraph _graph;
        private readonly IMarketingDbContext _db;

        public MetaSettingsController(IAppSettings settings, MetaGraph graph, IMarketingDbContext db)
        {
            _settings = settings;
            _graph = graph;
            _db = db;
        }

        private MetaConfig Cfg => MetaConfig.Load(_settings);
        private static string? Hint(string? s) => string.IsNullOrEmpty(s) ? null : s.Length <= 6 ? "••••" : "••••" + s[^4..];

        private string WebhookUrl()
        {
            var host = Request.Host.Value ?? "";
            var local = host.StartsWith("localhost") || host.StartsWith("127.0.0.1");
            return $"{(local ? Request.Scheme : "https")}://{host}/api/v1/meta/webhook";
        }

        private Task SaveAsync(Dictionary<string, string?> values, CancellationToken ct) =>
            _settings.SetAsync(values.ToDictionary(k => MetaConfig.Prefix + k.Key, k => k.Value), MetaConfig.SecretKeys.ToList(), User.AgentIdOf(), ct);

        [HttpGet]
        public async Task<IActionResult> Get(CancellationToken ct)
        {
            var cfg = Cfg;
            // A verify token is needed before Meta will accept the webhook; make one the first time.
            if (string.IsNullOrEmpty(cfg.VerifyToken))
            {
                cfg.VerifyToken = "nx-" + Convert.ToHexString(RandomNumberGenerator.GetBytes(12)).ToLowerInvariant();
                await SaveAsync(new() { ["verifyToken"] = cfg.VerifyToken }, ct);
            }

            bool? receiving = null;
            string? receivingError = null;
            if (cfg.PageConnected && cfg.AppId != null)
            {
                var r = await _graph.GetAsync(cfg.ApiVersion, $"{cfg.PageId}/subscribed_apps", cfg.PageToken, ct);
                if (r.Ok && r.Doc != null)
                    using (r.Doc)
                        receiving = r.Doc.RootElement.TryGetProperty("data", out var d) && d.EnumerateArray().Any(a => MetaService.Str(a, "id") == cfg.AppId);
                else receivingError = r.Error;
            }

            var since = DateTime.UtcNow.AddDays(-7);
            var formLeads7 = await _db.AdLeads.AsNoTracking().CountAsync(x => x.ReceivedAt >= since, ct);
            var messages7 = await _db.SocialMessages.AsNoTracking().CountAsync(x => x.Direction == "in" && x.CreatedAt >= since, ct);
            var lastForm = await _db.AdLeads.AsNoTracking().OrderByDescending(x => x.ReceivedAt).Select(x => (DateTime?)x.ReceivedAt).FirstOrDefaultAsync(ct);
            var lastMsg = await _db.SocialMessages.AsNoTracking().Where(x => x.Direction == "in").OrderByDescending(x => x.CreatedAt).Select(x => (DateTime?)x.CreatedAt).FirstOrDefaultAsync(ct);

            return Ok(new
            {
                fields = new { appId = cfg.AppId, verifyToken = cfg.VerifyToken, apiVersion = cfg.ApiVersion },
                secrets = new
                {
                    appSecret = new { set = cfg.AppSecret != null, hint = Hint(cfg.AppSecret), unreadable = _settings.Unreadable(MetaConfig.Prefix + "appSecret") },
                    accessToken = new { set = cfg.AccessToken != null, hint = Hint(cfg.AccessToken), unreadable = _settings.Unreadable(MetaConfig.Prefix + "accessToken") },
                },
                connection = new
                {
                    pageId = cfg.PageId, pageName = cfg.PageName, igId = cfg.IgId, igUsername = cfg.IgUsername,
                    adAccountId = cfg.AdAccountId, adAccountName = cfg.AdAccountName, currency = cfg.Currency, connectedAt = cfg.ConnectedAt,
                    pageConnected = cfg.PageConnected, receiving, receivingError,
                },
                webhookUrl = WebhookUrl(),
                needed = Needed.Select(n => new { scope = n.Scope, @for = n.For }),
                activity = new { formLeads7d = formLeads7, messages7d = messages7, lastFormAt = lastForm, lastMessageAt = lastMsg },
            });
        }

        [HttpPut]
        public async Task<IActionResult> Save([FromBody] MetaSettingsDto dto, CancellationToken ct)
        {
            var v = new Dictionary<string, string?>();
            if (dto.AppId != null)
            {
                var a = dto.AppId.Trim();
                if (a.Length > 0 && !Digits.IsMatch(a)) return BadRequest(new { message = "App ID is the number from developers.facebook.com (digits only)." });
                v["appId"] = a;
            }
            if (dto.VerifyToken != null)
            {
                var t = dto.VerifyToken.Trim();
                if (t.Length < 8 || t.Length > 120) return BadRequest(new { message = "Verify token: 8 to 120 characters." });
                v["verifyToken"] = t;
            }
            if (dto.ApiVersion != null)
            {
                var ver = dto.ApiVersion.Trim();
                if (ver.Length > 0 && !Version.IsMatch(ver)) return BadRequest(new { message = "API version looks like v21.0." });
                v["apiVersion"] = ver;
            }
            if (dto.AppSecret != null)
            {
                var s = dto.AppSecret.Trim();
                if (s.Length > 0 && (s.Length < 16 || s.Length > 64)) return BadRequest(new { message = "That doesn't look like an app secret (32 characters from App settings → Basic)." });
                v["appSecret"] = s;
            }
            if (dto.AccessToken != null)
            {
                var s = dto.AccessToken.Trim();
                if (s.Length > 0 && (s.Length < 40 || s.Length > 1000 || s.Any(char.IsWhiteSpace))) return BadRequest(new { message = "That doesn't look like an access token." });
                v["accessToken"] = s;
                // A new token means picking the Page again (its own token comes from this one).
                if (s.Length == 0) { v["pageToken"] = ""; }
            }
            if (v.Count == 0) return Ok(new { ok = true });
            await SaveAsync(v, ct);
            return Ok(new { ok = true });
        }

        /// <summary>
        /// Checks the saved (or given) token: who it belongs to, what it allows and when it expires, and lists the Pages
        /// and ad accounts it can reach, to pick from.
        /// </summary>
        [HttpPost("test")]
        public async Task<IActionResult> Test([FromBody] MetaSettingsDto? dto, CancellationToken ct)
        {
            var cfg = Cfg;
            var token = string.IsNullOrWhiteSpace(dto?.AccessToken) ? cfg.AccessToken : dto!.AccessToken!.Trim();
            var ver = string.IsNullOrWhiteSpace(dto?.ApiVersion) ? cfg.ApiVersion : dto!.ApiVersion!.Trim();
            if (string.IsNullOrWhiteSpace(token)) return BadRequest(new { message = "Add the access token first." });

            var me = await _graph.GetAsync(ver, "me?fields=id,name", token, ct);
            if (!me.Ok || me.Doc == null) return BadRequest(new { message = $"Facebook didn't accept the token: {me.Error}" });
            string? who;
            using (me.Doc) who = MetaService.Str(me.Doc.RootElement, "name");

            // What the token allows and when it expires (needs the app ID and secret).
            List<string>? scopes = null;
            DateTime? expires = null;
            bool neverExpires = false;
            var appId = string.IsNullOrWhiteSpace(dto?.AppId) ? cfg.AppId : dto!.AppId!.Trim();
            var secret = string.IsNullOrWhiteSpace(dto?.AppSecret) ? cfg.AppSecret : dto!.AppSecret!.Trim();
            if (appId != null && secret != null)
            {
                var dbg = await _graph.GetAsync(ver, $"debug_token?input_token={Uri.EscapeDataString(token)}", $"{appId}|{secret}", ct);
                if (dbg.Ok && dbg.Doc != null)
                {
                    using (dbg.Doc)
                    {
                        if (dbg.Doc.RootElement.TryGetProperty("data", out var d))
                        {
                            if (d.TryGetProperty("scopes", out var sc)) scopes = sc.EnumerateArray().Select(x => x.GetString() ?? "").ToList();
                            if (d.TryGetProperty("expires_at", out var ea) && ea.TryGetInt64(out var secs))
                            {
                                if (secs == 0) neverExpires = true; else expires = DateTimeOffset.FromUnixTimeSeconds(secs).UtcDateTime;
                            }
                        }
                    }
                }
            }

            var pages = new List<object>();
            var pr = await _graph.GetAsync(ver, "me/accounts?fields=id,name,instagram_business_account{id,username}&limit=100", token, ct);
            if (pr.Ok && pr.Doc != null)
                using (pr.Doc)
                    if (pr.Doc.RootElement.TryGetProperty("data", out var d))
                        foreach (var p in d.EnumerateArray())
                        {
                            var ig = p.TryGetProperty("instagram_business_account", out var i) ? i : default;
                            pages.Add(new { id = MetaService.Str(p, "id"), name = MetaService.Str(p, "name"), igId = ig.ValueKind == JsonValueKind.Object ? MetaService.Str(ig, "id") : null, igUsername = ig.ValueKind == JsonValueKind.Object ? MetaService.Str(ig, "username") : null });
                        }

            var ads = new List<object>();
            var ar = await _graph.GetAsync(ver, "me/adaccounts?fields=id,name,currency,account_status&limit=100", token, ct);
            string? adsError = ar.Ok ? null : ar.Error;
            if (ar.Ok && ar.Doc != null)
                using (ar.Doc)
                    if (ar.Doc.RootElement.TryGetProperty("data", out var d))
                        foreach (var a in d.EnumerateArray())
                            ads.Add(new { id = MetaService.Str(a, "id"), name = MetaService.Str(a, "name"), currency = MetaService.Str(a, "currency"), active = MetaService.Str(a, "account_status") == "1" });

            return Ok(new
            {
                who, scopes, expiresAt = expires, neverExpires,
                missing = scopes == null ? null : Needed.Where(n => !scopes.Contains(n.Scope)).Select(n => new { scope = n.Scope, @for = n.For }),
                pages, adAccounts = ads, adsError,
            });
        }

        /// <summary>Picks the Page (and its Instagram account) and the ad account, and subscribes the Page to the webhook.</summary>
        [HttpPost("connect")]
        public async Task<IActionResult> Connect([FromBody] MetaConnectDto dto, CancellationToken ct)
        {
            var cfg = Cfg;
            if (string.IsNullOrWhiteSpace(cfg.AccessToken)) return BadRequest(new { message = "Save the access token first." });
            var v = new Dictionary<string, string?>();
            string? warning = null;

            if (!string.IsNullOrWhiteSpace(dto.PageId))
            {
                if (!Digits.IsMatch(dto.PageId)) return BadRequest(new { message = "Unknown Page." });
                var pr = await _graph.GetAsync(cfg.ApiVersion, $"{dto.PageId}?fields=id,name,access_token,instagram_business_account{{id,username}}", cfg.AccessToken, ct);
                if (!pr.Ok || pr.Doc == null) return BadRequest(new { message = $"Couldn't open that Page with this token: {pr.Error}" });
                string? pageToken, name, igId = null, igUser = null;
                using (pr.Doc)
                {
                    var p = pr.Doc.RootElement;
                    pageToken = MetaService.Str(p, "access_token");
                    name = MetaService.Str(p, "name");
                    if (p.TryGetProperty("instagram_business_account", out var ig) && ig.ValueKind == JsonValueKind.Object) { igId = MetaService.Str(ig, "id"); igUser = MetaService.Str(ig, "username"); }
                }
                if (string.IsNullOrWhiteSpace(pageToken)) return BadRequest(new { message = "The token can see the Page but can't act for it. Give the system user full control of the Page in Business settings." });
                v["pageId"] = dto.PageId; v["pageName"] = name; v["pageToken"] = pageToken; v["igId"] = igId ?? ""; v["igUsername"] = igUser ?? "";

                // Ask Meta to send this Page's lead forms and messages to the CRM.
                var sub = await _graph.PostAsync(cfg.ApiVersion, $"{dto.PageId}/subscribed_apps?subscribed_fields=leadgen,messages,message_echoes", pageToken, null, ct);
                sub.Doc?.Dispose();
                if (!sub.Ok) warning = $"Connected, but the Page couldn't be subscribed to events: {sub.Error}";
            }
            if (dto.AdAccountId != null)
            {
                var id = dto.AdAccountId.Trim();
                if (id.Length == 0) { v["adAccountId"] = ""; v["adAccountName"] = ""; v["currency"] = ""; }
                else
                {
                    if (!id.StartsWith("act_")) id = "act_" + id;
                    if (!Regex.IsMatch(id, @"^act_\d{5,25}$")) return BadRequest(new { message = "Ad account looks like act_1234567890." });
                    var ar = await _graph.GetAsync(cfg.ApiVersion, $"{id}?fields=name,currency", cfg.AccessToken, ct);
                    if (!ar.Ok || ar.Doc == null) return BadRequest(new { message = $"Couldn't open that ad account: {ar.Error}" });
                    using (ar.Doc) { v["adAccountId"] = id; v["adAccountName"] = MetaService.Str(ar.Doc.RootElement, "name"); v["currency"] = MetaService.Str(ar.Doc.RootElement, "currency"); }
                }
            }
            if (v.Count == 0) return BadRequest(new { message = "Pick a Page or an ad account." });
            v["connectedAt"] = DateTime.UtcNow.ToString("o");
            await SaveAsync(v, ct);
            return Ok(new { ok = true, warning });
        }

        /// <summary>Stops the CRM using the Page (the saved app details stay, so reconnecting is one click).</summary>
        [HttpPost("disconnect")]
        public async Task<IActionResult> Disconnect(CancellationToken ct)
        {
            await SaveAsync(new() { ["pageId"] = "", ["pageName"] = "", ["pageToken"] = "", ["igId"] = "", ["igUsername"] = "", ["adAccountId"] = "", ["adAccountName"] = "", ["currency"] = "" }, ct);
            return Ok(new { ok = true });
        }
    }
}
