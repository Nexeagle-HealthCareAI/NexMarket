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
using Microsoft.Extensions.Configuration;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Controllers
{
    public class WhatsAppSettingsDto
    {
        /// <summary>Plain settings by key (phoneNumberId, businessAccountId, displayPhone…). "" clears one; missing keys are left alone.</summary>
        public Dictionary<string, string?>? Fields { get; set; }
        /// <summary>accessToken / appSecret. Missing or null = keep the saved one, "" = remove it.</summary>
        public Dictionary<string, string?>? Secrets { get; set; }
        /// <summary>Use (lead_followup, camp_invite…) → approved template name. "" = none.</summary>
        public Dictionary<string, string?>? Templates { get; set; }
    }

    public class WhatsAppTestDto
    {
        public string? PhoneNumberId { get; set; }
        public string? BusinessAccountId { get; set; }
        public string? AccessToken { get; set; }
    }

    public class WhatsAppSendTestDto
    {
        public string To { get; set; } = string.Empty;
        public string? Template { get; set; }
        public string? Language { get; set; }
        public int Params { get; set; }
    }

    /// <summary>
    /// WhatsApp → Setup: an admin connects the hospital's WhatsApp Business number from the CRM, checks it works,
    /// picks the approved templates and writes the automatic messages. No server changes needed.
    /// </summary>
    [ApiController]
    [Route("api/v1/settings/whatsapp")]
    [Authorize(Roles = "Admin,admin")]
    public class WhatsAppSettingsController : ControllerBase
    {
        private readonly IAppSettings _settings;
        private readonly IConfiguration _config;
        private readonly IWhatsAppSender _wa;
        private readonly IMarketingDbContext _db;

        public WhatsAppSettingsController(IAppSettings settings, IConfiguration config, IWhatsAppSender wa, IMarketingDbContext db)
        {
            _settings = settings;
            _config = config;
            _wa = wa;
            _db = db;
        }

        private static readonly Regex Digits = new(@"^\d{5,25}$");
        private static readonly Regex Version = new(@"^v\d{1,2}\.\d$");
        private static readonly Regex LangCode = new(@"^[a-z]{2,3}(_[A-Z]{2})?$");
        private static readonly Regex TemplateName = new(@"^[a-z0-9_]{1,100}$");

        private static readonly Dictionary<string, int> MaxLen = new()
        {
            ["phoneNumberId"] = 25, ["businessAccountId"] = 25, ["verifyToken"] = 120, ["displayPhone"] = 20, ["hospitalName"] = 80,
            ["apiVersion"] = 6, ["hindiCode"] = 6, ["englishCode"] = 6, ["autoReply"] = 1000, ["qrGreeting"] = 300,
        };

        private string WebhookUrl()
        {
            var host = Request.Host.Value ?? "";
            var local = host.StartsWith("localhost") || host.StartsWith("127.0.0.1");
            return $"{(local ? Request.Scheme : "https")}://{host}/api/v1/whatsapp/webhook";
        }

        private static string? Hint(string? secret) => string.IsNullOrEmpty(secret) ? null : secret.Length <= 6 ? "••••" : "••••" + secret[^4..];

        [HttpGet]
        public async Task<IActionResult> Get(CancellationToken ct)
        {
            var cfg = LeadInbox.Wa(_settings, _config);
            var since = DateTime.UtcNow.AddDays(-7);
            var lastIn = await _db.WaMessages.AsNoTracking().Where(m => m.Direction == "in").OrderByDescending(m => m.CreatedAt).Select(m => (DateTime?)m.CreatedAt).FirstOrDefaultAsync(ct);
            var in7 = await _db.WaMessages.AsNoTracking().CountAsync(m => m.Direction == "in" && m.CreatedAt >= since, ct);
            var out7 = await _db.WaMessages.AsNoTracking().CountAsync(m => m.Direction == "out" && m.CreatedAt >= since, ct);
            var failed7 = await _db.WaMessages.AsNoTracking().CountAsync(m => m.Direction == "out" && m.Status == "failed" && m.CreatedAt >= since, ct);

            object secret(string key, string? value) => new
            {
                set = !string.IsNullOrEmpty(value),
                hint = Hint(value),
                source = cfg.Sources.GetValueOrDefault(key, "none"),
                unreadable = _settings.Unreadable(WhatsAppConfig.Prefix + key),
            };

            return Ok(new
            {
                connected = cfg.IsConfigured,
                fields = new Dictionary<string, string?>
                {
                    ["phoneNumberId"] = cfg.PhoneNumberId, ["businessAccountId"] = cfg.BusinessAccountId, ["displayPhone"] = cfg.DisplayPhone,
                    ["verifyToken"] = cfg.VerifyToken, ["hospitalName"] = cfg.HospitalName, ["apiVersion"] = cfg.ApiVersion,
                    ["hindiCode"] = cfg.HindiCode, ["englishCode"] = cfg.EnglishCode, ["autoReply"] = cfg.AutoReply, ["qrGreeting"] = cfg.QrGreeting,
                },
                sources = cfg.Sources,
                secrets = new { accessToken = secret("accessToken", cfg.AccessToken), appSecret = secret("appSecret", cfg.AppSecret) },
                templates = WhatsAppConfig.TemplateUses.ToDictionary(u => u.Kind, u => cfg.Sources.GetValueOrDefault("template." + u.Kind) == "none" ? null : cfg.Template(u.Kind)),
                uses = WhatsAppConfig.TemplateUses.Select(u => new { kind = u.Kind, label = u.Label, @params = u.Params }),
                webhookUrl = WebhookUrl(),
                activity = new { lastInboundAt = lastIn, inbound7d = in7, outbound7d = out7, failed7d = failed7 },
                updatedAt = WhatsAppConfig.Fields.Select(f => _settings.UpdatedAt(WhatsAppConfig.Prefix + f.Key)).Where(d => d != null).DefaultIfEmpty().Max(),
            });
        }

        [HttpPut]
        public async Task<IActionResult> Save([FromBody] WhatsAppSettingsDto dto, CancellationToken ct)
        {
            var values = new Dictionary<string, string?>();
            foreach (var (key, raw) in dto.Fields ?? new())
            {
                if (!MaxLen.TryGetValue(key, out var max)) return BadRequest(new { message = $"Unknown setting: {key}." });
                var v = (raw ?? "").Trim();
                if (v.Length > max) return BadRequest(new { message = $"{key} is too long." });
                if (v.Length > 0)
                {
                    switch (key)
                    {
                        case "phoneNumberId" or "businessAccountId" when !Digits.IsMatch(v):
                            return BadRequest(new { message = key == "phoneNumberId" ? "Phone number ID is the long number from Meta (digits only), not the phone number." : "WhatsApp Business Account ID is digits only." });
                        case "displayPhone" when LeadInbox.NormalizePhone(v) == null:
                            return BadRequest(new { message = "Enter the hospital's WhatsApp number as a 10-digit Indian mobile number." });
                        case "apiVersion" when !Version.IsMatch(v):
                            return BadRequest(new { message = "API version looks like v21.0." });
                        case "hindiCode" or "englishCode" when !LangCode.IsMatch(v):
                            return BadRequest(new { message = "Language codes look like hi, en or en_US." });
                        case "verifyToken" when v.Any(char.IsWhiteSpace):
                            return BadRequest(new { message = "The verify token can't contain spaces." });
                    }
                    if (key == "displayPhone") v = LeadInbox.NormalizePhone(v)!;
                }
                values[WhatsAppConfig.Prefix + key] = v;
            }
            foreach (var (key, raw) in dto.Secrets ?? new())
            {
                if (key != "accessToken" && key != "appSecret") return BadRequest(new { message = $"Unknown secret: {key}." });
                if (raw == null) continue; // keep
                var v = raw.Trim();
                if (v.Length > 1000 || v.Any(char.IsWhiteSpace)) return BadRequest(new { message = key == "accessToken" ? "That doesn't look like an access token." : "That doesn't look like an app secret." });
                values[WhatsAppConfig.Prefix + key] = v;
            }
            foreach (var (kind, raw) in dto.Templates ?? new())
            {
                if (!WhatsAppConfig.TemplateUses.Any(u => u.Kind == kind)) return BadRequest(new { message = $"Unknown template use: {kind}." });
                var v = (raw ?? "").Trim();
                if (v.Length > 0 && !TemplateName.IsMatch(v)) return BadRequest(new { message = "Template names are lowercase letters, numbers and underscores, exactly as in Meta." });
                values[WhatsAppConfig.Prefix + "template." + kind] = v;
            }
            if (values.Count == 0) return Ok(new { ok = true });
            await _settings.SetAsync(values, WhatsAppConfig.SecretKeys.ToList(), User.AgentIdOf(), ct);
            return Ok(new { ok = true });
        }

        /// <summary>A fresh random verify token (saved), to paste into Meta's webhook settings.</summary>
        [HttpPost("verify-token")]
        public async Task<IActionResult> NewVerifyToken(CancellationToken ct)
        {
            var token = "nx_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
            await _settings.SetAsync(new Dictionary<string, string?> { [WhatsAppConfig.Prefix + "verifyToken"] = token }, WhatsAppConfig.SecretKeys.ToList(), User.AgentIdOf(), ct);
            return Ok(new { verifyToken = token });
        }

        /// <summary>
        /// Checks the connection with Meta: the phone number (name, quality, verification) and, with the business
        /// account ID, whether this app receives its messages. Uses the values typed in, or the saved ones.
        /// </summary>
        [HttpPost("test")]
        public async Task<IActionResult> Test([FromBody] WhatsAppTestDto dto, CancellationToken ct)
        {
            var cfg = LeadInbox.Wa(_settings, _config);
            var pnid = string.IsNullOrWhiteSpace(dto.PhoneNumberId) ? cfg.PhoneNumberId : dto.PhoneNumberId.Trim();
            var waba = string.IsNullOrWhiteSpace(dto.BusinessAccountId) ? cfg.BusinessAccountId : dto.BusinessAccountId.Trim();
            var token = string.IsNullOrWhiteSpace(dto.AccessToken) ? null : dto.AccessToken.Trim();
            if (string.IsNullOrEmpty(pnid) || !Digits.IsMatch(pnid)) return BadRequest(new { message = "Enter the phone number ID first." });
            if (!string.IsNullOrEmpty(waba) && !Digits.IsMatch(waba)) return BadRequest(new { message = "The business account ID is digits only." });

            var phone = await _wa.GraphGetAsync($"{pnid}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,name_status,messaging_limit_tier", token, null, ct);
            if (!phone.Ok) return Ok(new { ok = false, step = "phone", message = phone.Error });
            using var pd = JsonDocument.Parse(phone.Json!);
            string? str(JsonElement e, string p) => e.TryGetProperty(p, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
            var root = pd.RootElement;

            object? account = null;
            bool? subscribed = null;
            string? accountError = null;
            if (!string.IsNullOrEmpty(waba))
            {
                var acc = await _wa.GraphGetAsync($"{waba}?fields=name,message_template_namespace", token, null, ct);
                if (acc.Ok)
                {
                    using var ad = JsonDocument.Parse(acc.Json!);
                    account = new { name = str(ad.RootElement, "name") };
                    var subs = await _wa.GraphGetAsync($"{waba}/subscribed_apps", token, null, ct);
                    if (subs.Ok)
                    {
                        using var sd = JsonDocument.Parse(subs.Json!);
                        subscribed = sd.RootElement.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array && data.GetArrayLength() > 0;
                    }
                }
                else accountError = acc.Error;
            }

            return Ok(new
            {
                ok = true,
                phone = new
                {
                    number = str(root, "display_phone_number"),
                    name = str(root, "verified_name"),
                    quality = str(root, "quality_rating"),
                    verification = str(root, "code_verification_status"),
                    nameStatus = str(root, "name_status"),
                    limit = str(root, "messaging_limit_tier"),
                },
                account, accountError, subscribed,
            });
        }

        /// <summary>The message templates in the business account, with their status and how many values each takes.</summary>
        [HttpGet("templates")]
        public async Task<IActionResult> Templates(CancellationToken ct)
        {
            var cfg = LeadInbox.Wa(_settings, _config);
            if (string.IsNullOrEmpty(cfg.BusinessAccountId)) return BadRequest(new { message = "Save the WhatsApp Business Account ID first." });
            var r = await _wa.GraphGetAsync($"{cfg.BusinessAccountId}/message_templates?fields=name,status,language,category,components&limit=250", null, null, ct);
            if (!r.Ok) return BadRequest(new { message = r.Error });
            using var doc = JsonDocument.Parse(r.Json!);
            var list = new List<object>();
            if (doc.RootElement.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
            {
                foreach (var t in data.EnumerateArray())
                {
                    string body = "";
                    if (t.TryGetProperty("components", out var comps) && comps.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var c in comps.EnumerateArray())
                        {
                            if (c.TryGetProperty("type", out var ty) && ty.GetString() == "BODY" && c.TryGetProperty("text", out var tx)) body = tx.GetString() ?? "";
                        }
                    }
                    var count = Regex.Matches(body, @"\{\{\s*[^}]+\s*\}\}").Select(m => m.Value).Distinct().Count();
                    list.Add(new
                    {
                        name = t.TryGetProperty("name", out var n) ? n.GetString() : null,
                        language = t.TryGetProperty("language", out var l) ? l.GetString() : null,
                        status = t.TryGetProperty("status", out var s) ? s.GetString() : null,
                        category = t.TryGetProperty("category", out var cat) ? cat.GetString() : null,
                        body,
                        @params = count,
                    });
                }
            }
            return Ok(list);
        }

        /// <summary>Sends one message to check everything works: a chosen template, or Meta's ready-made hello_world.</summary>
        [HttpPost("send-test")]
        public async Task<IActionResult> SendTest([FromBody] WhatsAppSendTestDto dto, CancellationToken ct)
        {
            if (LeadInbox.NormalizePhone(dto.To) == null) return BadRequest(new { message = "Enter a 10-digit mobile number to send the test to." });
            var name = string.IsNullOrWhiteSpace(dto.Template) ? "hello_world" : dto.Template.Trim();
            if (!TemplateName.IsMatch(name)) return BadRequest(new { message = "Pick a template." });
            var lang = string.IsNullOrWhiteSpace(dto.Language) ? (name == "hello_world" ? "en_US" : "hi") : dto.Language.Trim();
            if (!LangCode.IsMatch(lang)) return BadRequest(new { message = "Unknown language code." });
            var values = Enumerable.Range(1, Math.Clamp(dto.Params, 0, 10)).Select(i => i == 1 ? "Test" : $"Test {i}").ToList();
            var r = await _wa.SendNamedTemplateAsync(dto.To, name, lang, values, ct);
            if (!r.Ok) return BadRequest(new { message = r.Error });
            return Ok(new { ok = true, id = r.MessageId });
        }
    }
}
