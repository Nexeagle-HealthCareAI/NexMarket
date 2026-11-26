using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Controllers
{
    public class WhatsAppProfileDto
    {
        public string? About { get; set; }
        public string? Description { get; set; }
        public string? Address { get; set; }
        public string? Email { get; set; }
        public List<string>? Websites { get; set; }
        public string? Vertical { get; set; }
    }

    /// <summary>
    /// WhatsApp → Setup → Business profile: what patients see when they open the hospital's chat (photo, about line,
    /// description, address, email, websites, category), read from and saved to Meta. The display name itself can only
    /// be changed in Meta (it is reviewed), so it is shown with its review state and a link.
    /// </summary>
    [ApiController]
    [Route("api/v1/settings/whatsapp/profile")]
    [Authorize(Roles = "Admin,admin")]
    public class WhatsAppProfileController : ControllerBase
    {
        public const string AppIdKey = MetaUpload.AppIdKey;
        private const string Fields = "about,address,description,email,profile_picture_url,websites,vertical";
        private const long MaxPhoto = 5 * 1024 * 1024;
        private static readonly Regex Digits = new(@"^\d{5,25}$");
        private static readonly Regex EmailRx = new(@"^[^\s@]+@[^\s@]+\.[^\s@]+$");

        /// <summary>Meta's business categories, with the words shown in the CRM.</summary>
        public static readonly (string Code, string Label)[] Verticals =
        {
            ("HEALTH", "Medical and health"), ("PROF_SERVICES", "Professional services"), ("NONPROFIT", "Non-profit"), ("EDU", "Education"),
            ("GOVT", "Public service"), ("RETAIL", "Shopping and retail"), ("OTHER", "Other"),
        };

        private readonly IAppSettings _settings;
        private readonly IConfiguration _config;
        private readonly IWhatsAppSender _wa;
        private readonly IHttpClientFactory _http;

        public WhatsAppProfileController(IAppSettings settings, IConfiguration config, IWhatsAppSender wa, IHttpClientFactory http)
        {
            _settings = settings; _config = config; _wa = wa; _http = http;
        }

        private static string? Str(JsonElement e, string p) => e.TryGetProperty(p, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

        /// <summary>Trims, drops control characters, and checks the length Meta allows.</summary>
        [NonAction]
        public static string? Validate(WhatsAppProfileDto d, out Dictionary<string, object> body)
        {
            body = new Dictionary<string, object> { ["messaging_product"] = "whatsapp" };
            static string clean(string? s) => Regex.Replace((s ?? "").Replace("\r\n", "\n"), @"[\u0000-\u0009\u000b-\u001f]", " ").Trim();
            if (d.About != null)
            {
                var a = Regex.Replace(clean(d.About), @"\s+", " ");
                if (a.Length > 139) return "The 'About' line can be at most 139 characters.";
                if (a.Length > 0) body["about"] = a; // Meta won't take an empty one
            }
            if (d.Description != null)
            {
                var s = clean(d.Description);
                if (s.Length > 512) return "The description can be at most 512 characters.";
                body["description"] = s;
            }
            if (d.Address != null)
            {
                var s = clean(d.Address);
                if (s.Length > 256) return "The address can be at most 256 characters.";
                body["address"] = s;
            }
            if (d.Email != null)
            {
                var s = clean(d.Email);
                if (s.Length > 128 || (s.Length > 0 && !EmailRx.IsMatch(s))) return "That email address doesn't look right.";
                body["email"] = s;
            }
            if (d.Websites != null)
            {
                var list = d.Websites.Select(w => clean(w)).Where(w => w.Length > 0).ToList();
                if (list.Count > 2) return "WhatsApp shows at most two websites.";
                for (var i = 0; i < list.Count; i++)
                {
                    var w = list[i];
                    if (!w.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !w.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) w = "https://" + w;
                    if (w.Length > 256 || !Uri.TryCreate(w, UriKind.Absolute, out var u) || !u.Host.Contains('.')) return $"Website {i + 1} doesn't look like a web address.";
                    list[i] = w;
                }
                body["websites"] = list;
            }
            if (d.Vertical != null)
            {
                if (!Verticals.Any(v => v.Code == d.Vertical)) return "Pick a category.";
                body["vertical"] = d.Vertical;
            }
            return null;
        }

        [HttpGet]
        public async Task<IActionResult> Get(CancellationToken ct)
        {
            var cfg = LeadInbox.Wa(_settings, _config);
            if (!cfg.IsConfigured) return BadRequest(new { message = "Connect WhatsApp first (steps 1 and 2)." });
            var r = await _wa.GraphGetAsync($"{cfg.PhoneNumberId}/whatsapp_business_profile?fields={Fields}", null, null, ct);
            if (!r.Ok) return BadRequest(new { message = r.Error });
            using var doc = JsonDocument.Parse(r.Json!);
            var p = doc.RootElement.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array && data.GetArrayLength() > 0 ? data[0] : doc.RootElement;
            var sites = p.TryGetProperty("websites", out var ws) && ws.ValueKind == JsonValueKind.Array
                ? ws.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).ToList() : new List<string>();

            // The name patients see, and whether Meta has approved it.
            string? name = null, nameStatus = null, number = null;
            var ph = await _wa.GraphGetAsync($"{cfg.PhoneNumberId}?fields=display_phone_number,verified_name,name_status", null, null, ct);
            if (ph.Ok)
            {
                using var pd = JsonDocument.Parse(ph.Json!);
                name = Str(pd.RootElement, "verified_name"); nameStatus = Str(pd.RootElement, "name_status"); number = Str(pd.RootElement, "display_phone_number");
            }
            return Ok(new
            {
                about = Str(p, "about"), description = Str(p, "description"), address = Str(p, "address"), email = Str(p, "email"),
                websites = sites, vertical = Str(p, "vertical"), photoUrl = Str(p, "profile_picture_url"),
                name, nameStatus, number, hospitalName = cfg.HospitalName,
                verticals = Verticals.Select(v => new { code = v.Code, label = v.Label }),
                appIdSaved = !string.IsNullOrWhiteSpace(_settings.Get(AppIdKey)),
            });
        }

        [HttpPut]
        public async Task<IActionResult> Save([FromBody] WhatsAppProfileDto dto, CancellationToken ct)
        {
            var cfg = LeadInbox.Wa(_settings, _config);
            if (!cfg.IsConfigured) return BadRequest(new { message = "Connect WhatsApp first (steps 1 and 2)." });
            var err = Validate(dto, out var body);
            if (err != null) return BadRequest(new { message = err });
            var r = await _wa.GraphPostAsync($"{cfg.PhoneNumberId}/whatsapp_business_profile", body, ct);
            if (!r.Ok) return BadRequest(new { message = r.Error });
            return Ok(new { ok = true });
        }

        /// <summary>
        /// The profile photo: a square JPG or PNG (the page crops and sizes it to 640×640). Meta takes it in two steps,
        /// an upload to the app that gives a handle, then the handle on the profile.
        /// </summary>
        [HttpPost("photo")]
        [RequestSizeLimit(6 * 1024 * 1024)]
        public async Task<IActionResult> Photo([FromForm] IFormFile? file, [FromForm] string? appId, CancellationToken ct)
        {
            var cfg = LeadInbox.Wa(_settings, _config);
            if (!cfg.IsConfigured) return BadRequest(new { message = "Connect WhatsApp first (steps 1 and 2)." });
            if (file == null || file.Length == 0) return BadRequest(new { message = "Choose a picture." });
            if (file.Length > MaxPhoto) return BadRequest(new { message = "The picture must be under 5 MB." });

            await using var ms = new MemoryStream();
            await file.CopyToAsync(ms, ct);
            var bytes = ms.ToArray();
            var type = MetaUpload.Sniff(bytes);
            if (type is not ("image/jpeg" or "image/png")) return BadRequest(new { message = "Use a JPG or PNG picture." });

            var (handle, upErr, needApp) = await MetaUpload.HandleAsync(_http, _wa, _settings, cfg, bytes, type, type == "image/png" ? "profile.png" : "profile.jpg", appId, User.AgentIdOf(), ct);
            if (handle == null) return BadRequest(new { message = upErr, needAppId = needApp });

            // Then put it on the profile.
            var r = await _wa.GraphPostAsync($"{cfg.PhoneNumberId}/whatsapp_business_profile",
                new Dictionary<string, object> { ["messaging_product"] = "whatsapp", ["profile_picture_handle"] = handle! }, ct);
            if (!r.Ok) return BadRequest(new { message = r.Error });
            return Ok(new { ok = true });
        }
    }
}
