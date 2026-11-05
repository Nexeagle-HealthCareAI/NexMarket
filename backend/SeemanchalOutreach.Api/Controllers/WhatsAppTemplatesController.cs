using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;

namespace SeemanchalOutreach.Api.Controllers
{
    public class WaTemplateButton
    {
        /// <summary>QUICK_REPLY | URL | PHONE_NUMBER</summary>
        public string Type { get; set; } = "QUICK_REPLY";
        public string Text { get; set; } = string.Empty;
        public string? Url { get; set; }
        public string? Phone { get; set; }
    }

    public class WaTemplateDto
    {
        public string Name { get; set; } = string.Empty;
        public string Language { get; set; } = "hi";
        /// <summary>MARKETING | UTILITY</summary>
        public string Category { get; set; } = "MARKETING";
        public string? Header { get; set; }
        public string Body { get; set; } = string.Empty;
        public string? Footer { get; set; }
        public List<WaTemplateButton> Buttons { get; set; } = new();
        /// <summary>Example values for {{1}}, {{2}}…, which Meta needs to review the template.</summary>
        public List<string> Examples { get; set; } = new();
    }

    /// <summary>
    /// WhatsApp message templates, managed from the CRM: list them with Meta's approval status, write new ones, edit,
    /// and install the NexEagle standard set (filled in with this hospital's name) in one go.
    /// </summary>
    [ApiController]
    [Route("api/v1/whatsapp/templates")]
    [Authorize]
    [PageAccess(Pages.WhatsApp, Pages.Desk)]
    public class WhatsAppTemplatesController : ControllerBase
    {
        private readonly IWhatsAppSender _wa;
        private readonly WhatsAppOutbox _outbox;
        private readonly IAppSettings _settings;

        public WhatsAppTemplatesController(IWhatsAppSender wa, WhatsAppOutbox outbox, IAppSettings settings)
        {
            _wa = wa;
            _outbox = outbox;
            _settings = settings;
        }

        private static readonly Regex Name = new(@"^[a-z0-9_]{1,100}$");
        private static readonly Regex Lang = new(@"^[a-z]{2,3}(_[A-Z]{2})?$");
        private static readonly Regex Var = new(@"\{\{\s*(\d+)\s*\}\}");
        private static readonly Regex Id = new(@"^\d{5,25}$");

        public class Parsed
        {
            public string? Id { get; set; }
            public string Name { get; set; } = "";
            public string Language { get; set; } = "";
            public string Status { get; set; } = "";
            public string Category { get; set; } = "";
            public string? Reason { get; set; }
            public string? Header { get; set; }
            public string? HeaderFormat { get; set; }
            public string Body { get; set; } = "";
            public string? Footer { get; set; }
            public List<WaTemplateButton> Buttons { get; set; } = new();
            public int Params { get; set; }
            public List<string> Examples { get; set; } = new();
            public List<string> UsedFor { get; set; } = new();
        }

        private static string? S(JsonElement e, string p) => e.TryGetProperty(p, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

        private async Task<(List<Parsed>? List, string? Error)> FetchAsync(CancellationToken ct)
        {
            var cfg = _outbox.Config;
            if (string.IsNullOrEmpty(cfg.BusinessAccountId)) return (null, "The WhatsApp Business Account ID isn't saved yet (WhatsApp → Setup).");
            var r = await _wa.GraphGetAsync($"{cfg.BusinessAccountId}/message_templates?fields=id,name,status,language,category,components,rejected_reason&limit=250", null, null, ct);
            if (!r.Ok) return (null, r.Error);
            using var doc = JsonDocument.Parse(r.Json!);
            var list = new List<Parsed>();
            if (!doc.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array) return (list, null);
            foreach (var t in data.EnumerateArray())
            {
                var p = new Parsed
                {
                    Id = S(t, "id"), Name = S(t, "name") ?? "", Language = S(t, "language") ?? "", Status = S(t, "status") ?? "",
                    Category = S(t, "category") ?? "", Reason = S(t, "rejected_reason") is string rr && rr != "NONE" ? rr : null,
                };
                if (t.TryGetProperty("components", out var comps) && comps.ValueKind == JsonValueKind.Array)
                {
                    foreach (var c in comps.EnumerateArray())
                    {
                        switch (S(c, "type"))
                        {
                            case "HEADER":
                                p.HeaderFormat = S(c, "format");
                                p.Header = S(c, "text");
                                break;
                            case "BODY":
                                p.Body = S(c, "text") ?? "";
                                if (c.TryGetProperty("example", out var ex) && ex.TryGetProperty("body_text", out var bt) && bt.ValueKind == JsonValueKind.Array && bt.GetArrayLength() > 0)
                                    p.Examples = bt[0].EnumerateArray().Select(x => x.GetString() ?? "").ToList();
                                break;
                            case "FOOTER":
                                p.Footer = S(c, "text");
                                break;
                            case "BUTTONS":
                                if (c.TryGetProperty("buttons", out var bs) && bs.ValueKind == JsonValueKind.Array)
                                    p.Buttons = bs.EnumerateArray().Select(b => new WaTemplateButton { Type = S(b, "type") ?? "", Text = S(b, "text") ?? "", Url = S(b, "url"), Phone = S(b, "phone_number") }).ToList();
                                break;
                        }
                    }
                }
                p.Params = Var.Matches(p.Body).Select(m => m.Groups[1].Value).Distinct().Count();
                list.Add(p);
            }
            var cfg2 = _outbox.Config;
            foreach (var (kind, label, _) in WhatsAppConfig.TemplateUses)
            {
                var chosen = cfg2.Template(kind);
                foreach (var p in list.Where(x => x.Name == chosen)) p.UsedFor.Add(label);
            }
            return (list.OrderBy(x => x.Status == "APPROVED" ? 0 : 1).ThenBy(x => x.Name).ToList(), null);
        }

        [HttpGet]
        public async Task<IActionResult> List(CancellationToken ct)
        {
            var (list, error) = await FetchAsync(ct);
            if (list == null) return BadRequest(new { message = error });
            return Ok(new { items = list, hospital = _outbox.Config.HospitalName });
        }

        /// <summary>Checks a template against WhatsApp's rules before sending it to Meta, so mistakes show at once.</summary>
        private static string? Validate(WaTemplateDto t, bool editing)
        {
            if (!editing && !Name.IsMatch(t.Name ?? "")) return "Name: lowercase letters, numbers and underscores only, e.g. opd_timing_update.";
            if (!Lang.IsMatch(t.Language ?? "")) return "Language looks like hi, en or en_US.";
            if (t.Category is not ("MARKETING" or "UTILITY")) return "Category is Marketing or Utility.";
            var body = (t.Body ?? "").Trim();
            if (body.Length == 0) return "Write the message.";
            if (body.Length > 1024) return "The message can be up to 1,024 characters.";
            var nums = Var.Matches(body).Select(m => int.Parse(m.Groups[1].Value)).Distinct().OrderBy(x => x).ToList();
            if (nums.Count > 0 && !nums.SequenceEqual(Enumerable.Range(1, nums.Count))) return "Number the blanks {{1}}, {{2}}, {{3}}… in order, with none skipped.";
            if (Regex.IsMatch(body, @"^\s*\{\{") || Regex.IsMatch(body, @"\}\}\s*$")) return "WhatsApp won't approve a message that starts or ends with a blank. Add some words before or after it.";
            if (nums.Count > 0 && body.Length / nums.Count < 12) return "Too many blanks for the amount of text. Add more fixed words.";
            if (t.Examples.Count != nums.Count || t.Examples.Any(string.IsNullOrWhiteSpace)) return "Give an example for every blank, so Meta can review it.";
            if ((t.Header ?? "").Length > 60) return "The heading can be up to 60 characters.";
            if (t.Header != null && Var.IsMatch(t.Header)) return "Keep the heading fixed (no blanks).";
            if ((t.Footer ?? "").Length > 60) return "The footer can be up to 60 characters.";
            if (t.Buttons.Count > 3) return "Up to 3 buttons.";
            foreach (var b in t.Buttons)
            {
                if (string.IsNullOrWhiteSpace(b.Text) || b.Text.Length > 25) return "Button text is 1–25 characters.";
                if (b.Type == "URL" && !Uri.TryCreate(b.Url, UriKind.Absolute, out var u)) return "A link button needs a full web address (https://…).";
                if (b.Type == "PHONE_NUMBER" && LeadInbox.NormalizePhone(b.Phone) == null) return "A call button needs a 10-digit phone number.";
                if (b.Type is not ("QUICK_REPLY" or "URL" or "PHONE_NUMBER")) return "Unknown button type.";
            }
            return null;
        }

        private static List<object> Components(WaTemplateDto t)
        {
            var list = new List<object>();
            if (!string.IsNullOrWhiteSpace(t.Header)) list.Add(new { type = "HEADER", format = "TEXT", text = t.Header.Trim() });
            var body = t.Body.Trim();
            list.Add(t.Examples.Count > 0
                ? new { type = "BODY", text = body, example = new { body_text = new[] { t.Examples.Select(e => e.Trim()).ToArray() } } }
                : (object)new { type = "BODY", text = body });
            if (!string.IsNullOrWhiteSpace(t.Footer)) list.Add(new { type = "FOOTER", text = t.Footer.Trim() });
            if (t.Buttons.Count > 0)
            {
                list.Add(new
                {
                    type = "BUTTONS",
                    buttons = t.Buttons.Select(b => b.Type switch
                    {
                        "URL" => (object)new { type = "URL", text = b.Text.Trim(), url = b.Url!.Trim() },
                        "PHONE_NUMBER" => new { type = "PHONE_NUMBER", text = b.Text.Trim(), phone_number = "+" + LeadInbox.NormalizePhone(b.Phone) },
                        _ => new { type = "QUICK_REPLY", text = b.Text.Trim() },
                    }).ToArray(),
                });
            }
            return list;
        }

        [HttpPost]
        [PageAccess(Pages.WhatsApp)]
        public async Task<IActionResult> Create([FromBody] WaTemplateDto dto, CancellationToken ct)
        {
            var err = Validate(dto, false);
            if (err != null) return BadRequest(new { message = err });
            var cfg = _outbox.Config;
            if (string.IsNullOrEmpty(cfg.BusinessAccountId)) return BadRequest(new { message = "The WhatsApp Business Account ID isn't saved yet (WhatsApp → Setup)." });
            var r = await _wa.GraphPostAsync($"{cfg.BusinessAccountId}/message_templates", new { name = dto.Name, language = dto.Language, category = dto.Category, components = Components(dto) }, ct);
            if (!r.Ok) return BadRequest(new { message = r.Error });
            using var doc = JsonDocument.Parse(r.Json!);
            return Ok(new { id = S(doc.RootElement, "id"), status = S(doc.RootElement, "status") });
        }

        /// <summary>Edits a template (Meta allows a few edits a day, and reviews it again).</summary>
        [HttpPost("{id}")]
        [PageAccess(Pages.WhatsApp)]
        public async Task<IActionResult> Edit(string id, [FromBody] WaTemplateDto dto, CancellationToken ct)
        {
            if (!Id.IsMatch(id)) return BadRequest(new { message = "Unknown template." });
            var err = Validate(dto, true);
            if (err != null) return BadRequest(new { message = err });
            var r = await _wa.GraphPostAsync(id, new { category = dto.Category, components = Components(dto) }, ct);
            if (!r.Ok) return BadRequest(new { message = r.Error });
            return Ok(new { ok = true });
        }

        // ─── NexEagle standard templates ───
        /// <summary>The NexEagle set, written for hospitals in Hindi, with this hospital's name filled in.</summary>
        public static List<(WaTemplateDto T, string? Use)> Pack(string hospital)
        {
            var h = hospital.Length > 60 ? hospital[..60] : hospital;
            const string stop = "संदेश बंद करने के लिए STOP लिखें";
            return new()
            {
                (new WaTemplateDto
                {
                    Name = "nx_lead_followup", Category = "UTILITY",
                    Body = "नमस्ते {{1}}, {{2}} से संपर्क करने के लिए धन्यवाद। क्या आप डॉक्टर से मिलने का समय तय करना चाहेंगे? इस संदेश का जवाब दें, हमारी टीम आपकी मदद करेगी।",
                    Examples = new() { "रीना", h },
                }, "lead_followup"),
                (new WaTemplateDto
                {
                    Name = "nx_doctor_availability", Category = "MARKETING", Header = h, Footer = stop,
                    Body = "नमस्ते {{1}},\n{{2}} ({{3}}) {{4}} को {{5}} OPD में उपलब्ध रहेंगे।\n{{6}}\nअपॉइंटमेंट के लिए इसी नंबर पर जवाब दें।",
                    Examples = new() { "रीना", "डॉ. अहमद", "हड्डी रोग", "12 नवंबर", "सुबह 10 से दोपहर 2 बजे तक", "पुरानी रिपोर्ट साथ लाएं।" },
                }, "doctor_availability"),
                (new WaTemplateDto
                {
                    Name = "nx_schedule_change", Category = "MARKETING", Header = h, Footer = stop,
                    Body = "नमस्ते {{1}},\n{{2}} ({{3}}) के OPD समय में बदलाव: {{4}}\nकिसी भी जानकारी के लिए इसी नंबर पर जवाब दें।",
                    Examples = new() { "रीना", "डॉ. अहमद", "हड्डी रोग", "इस शनिवार OPD बंद रहेगा" },
                }, "schedule_change"),
                (new WaTemplateDto
                {
                    Name = "nx_camp_invite", Category = "MARKETING", Header = h, Footer = stop,
                    Body = "नमस्ते {{1}},\n{{2}} में {{3}} को निःशुल्क स्वास्थ्य शिविर लगाया जा रहा है।\n{{4}}\nअपने परिवार और पड़ोसियों को भी बताएं।",
                    Examples = new() { "रीना", "कसबा पंचायत भवन", "12 नवंबर", "सुबह 9 से दोपहर 2 बजे तक, BP और शुगर जांच मुफ़्त।" },
                }, "camp_invite"),
                (new WaTemplateDto
                {
                    Name = "nx_general_update", Category = "MARKETING", Header = h, Footer = stop,
                    Body = "नमस्ते {{1}},\n{{2}}\nधन्यवाद, " + h + " टीम",
                    Examples = new() { "रीना", "अब अस्पताल में 24 घंटे इमरजेंसी सेवा उपलब्ध है।" },
                }, "general_update"),
                (new WaTemplateDto
                {
                    Name = "nx_form_thanks", Category = "UTILITY",
                    Body = "नमस्ते {{1}}, {{2}} का फ़ॉर्म भरने के लिए धन्यवाद। हमारी टीम जल्द ही आपको कॉल करेगी। डॉक्टर से मिलने का समय तय करने के लिए इसी संदेश का जवाब दें।",
                    Examples = new() { "रीना", h },
                }, "form_welcome"),
                (new WaTemplateDto
                {
                    Name = "nx_appointment_confirm", Category = "UTILITY",
                    Body = "नमस्ते {{1}}, " + h + " में आपका अपॉइंटमेंट {{2}} को {{3}} बजे {{4}} के साथ तय है। कृपया पुरानी रिपोर्ट और पर्चे साथ लाएं।",
                    Examples = new() { "रीना", "12 नवंबर", "11", "डॉ. अहमद" },
                }, null),
                (new WaTemplateDto
                {
                    Name = "nx_referral_update", Category = "UTILITY",
                    Body = "नमस्ते {{1}}, आपके द्वारा भेजे गए मरीज़ {{2}} की स्थिति: {{3}}। भरोसे के लिए धन्यवाद, " + h + "।",
                    Examples = new() { "सुनीता जी", "राम कुमार", "भर्ती हो गए हैं" },
                }, null),
            };
        }

        [HttpGet("pack")]
        public async Task<IActionResult> PackPreview(CancellationToken ct)
        {
            var cfg = _outbox.Config;
            var (list, _) = await FetchAsync(ct);
            return Ok(Pack(cfg.HospitalName).Select(p => new
            {
                p.T.Name, p.T.Category, p.T.Header, p.T.Body, p.T.Footer, p.T.Examples, use = p.Use,
                installed = list?.FirstOrDefault(x => x.Name == p.T.Name && x.Language == p.T.Language)?.Status,
            }));
        }

        /// <summary>
        /// Creates every NexEagle template this account doesn't have yet (Meta then reviews them, usually within minutes
        /// to a day), and picks each one for its use unless an admin has already chosen another.
        /// </summary>
        [HttpPost("install-pack")]
        [PageAccess(Pages.WhatsApp)]
        public async Task<IActionResult> InstallPack(CancellationToken ct)
        {
            var cfg = _outbox.Config;
            if (string.IsNullOrEmpty(cfg.BusinessAccountId)) return BadRequest(new { message = "The WhatsApp Business Account ID isn't saved yet (WhatsApp → Setup)." });
            var (existing, error) = await FetchAsync(ct);
            if (existing == null) return BadRequest(new { message = error });
            var results = new List<object>();
            var uses = new Dictionary<string, string?>();
            foreach (var (t, use) in Pack(cfg.HospitalName))
            {
                var have = existing.FirstOrDefault(x => x.Name == t.Name && x.Language == t.Language);
                string outcome;
                if (have != null) outcome = "already there (" + have.Status.ToLowerInvariant() + ")";
                else
                {
                    var r = await _wa.GraphPostAsync($"{cfg.BusinessAccountId}/message_templates", new { name = t.Name, language = t.Language, category = t.Category, components = Components(t) }, ct);
                    outcome = r.Ok ? "sent to Meta for approval" : "not created: " + r.Error;
                    if (!r.Ok) { results.Add(new { name = t.Name, ok = false, outcome }); continue; }
                }
                results.Add(new { name = t.Name, ok = true, outcome });
                // Use it unless a different template was chosen in the CRM.
                if (use != null && cfg.Sources.GetValueOrDefault("template." + use) != "crm") uses[WhatsAppConfig.Prefix + "template." + use] = t.Name;
            }
            if (uses.Count > 0) await _settings.SetAsync(uses, WhatsAppConfig.SecretKeys.ToList(), User.AgentIdOf(), ct);
            return Ok(new { results, mapped = uses.Count });
        }
    }
}
