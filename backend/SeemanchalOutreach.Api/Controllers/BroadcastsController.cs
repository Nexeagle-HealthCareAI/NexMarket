using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using SeemanchalOutreach.Api.Security;
using SeemanchalOutreach.Api.Services;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Controllers
{
    public class BroadcastRequestDto
    {
        /// <summary>doctor_availability | schedule_change | camp_invite | general_update | template (any approved template).</summary>
        public string Kind { get; set; } = "general_update";
        public string Language { get; set; } = "hi";
        public Dictionary<string, string> Params { get; set; } = new();
        public BroadcastAudience Audience { get; set; } = new();
        /// <summary>Null = send now.</summary>
        public DateTime? ScheduledAt { get; set; }
        /// <summary>A name for the list of broadcasts (optional; made from the message otherwise).</summary>
        public string? Title { get; set; }
    }

    public class TestBroadcastDto
    {
        public string Kind { get; set; } = "general_update";
        public string Language { get; set; } = "hi";
        public Dictionary<string, string> Params { get; set; } = new();
        public string Phone { get; set; } = string.Empty;
    }

    [ApiController]
    [Authorize]
    [PageAccess(Pages.WhatsApp)]
    [Route("api/v1/broadcasts")]
    public class BroadcastsController : ControllerBase
    {
        private static readonly Regex TemplateName = new(@"^[a-z0-9_]{1,100}$");
        private static readonly Regex LangCode = new(@"^[a-z]{2,3}(_[A-Z]{2})?$");
        private static readonly Regex MediaId = new(@"^\d{5,30}$");

        private readonly IMarketingDbContext _db;
        private readonly IWhatsAppSender _sender;
        private readonly WhatsAppOutbox _outbox;
        private readonly IHttpClientFactory _http;

        public BroadcastsController(IMarketingDbContext db, IWhatsAppSender sender, WhatsAppOutbox outbox, IHttpClientFactory http)
        {
            _db = db;
            _sender = sender;
            _outbox = outbox;
            _http = http;
        }

        [HttpGet("status")]
        public IActionResult Status() => Ok(new { connected = _sender.IsConfigured });

        /// <summary>How many people the chosen groups and places reach, by group and by partner type.</summary>
        [HttpPost("audience")]
        public async Task<IActionResult> Audience([FromBody] BroadcastAudience audience, CancellationToken ct)
        {
            var (_, counts) = await BroadcastPeople.ResolveAsync(_db, audience, ct);
            var types = await BroadcastPeople.TypeCountsAsync(_db, audience, ct);
            var blocks = await _db.Panchayats.AsNoTracking().Where(p => p.IsActiveForMarketing).Select(p => p.Block).Distinct().OrderBy(b => b).ToListAsync(ct);
            return Ok(new
            {
                total = counts.Total, byGroup = counts.ByGroup, byType = types.Select(t => new { type = t.Key, count = t.Value }),
                campNoConsent = counts.CampNoConsent, optedOut = counts.OptedOut, noPlace = counts.NoPlace, duplicates = counts.Duplicates,
                excluded = counts.OptedOut, blocks,
            });
        }

        /// <summary>Every district, block and panchayat, for the place picker.</summary>
        [HttpGet("places")]
        public async Task<IActionResult> Places(CancellationToken ct)
        {
            var list = await _db.Panchayats.AsNoTracking().OrderBy(p => p.District).ThenBy(p => p.Block).ThenBy(p => p.Name)
                .Select(p => new { id = p.PanchayatId, name = p.Name, block = p.Block, district = p.District, active = p.IsActiveForMarketing }).ToListAsync(ct);
            return Ok(list);
        }

        /// <summary>Health camps, newest first, with how many people with a phone each has (for "people from these camps").</summary>
        [HttpGet("camps")]
        public async Task<IActionResult> Camps(CancellationToken ct)
        {
            var camps = await _db.HealthCamps.AsNoTracking().Where(c => c.Status != "cancelled").OrderByDescending(c => c.Date).Take(60)
                .Select(c => new { c.Id, c.Title, c.Date, c.Venue, c.Block }).ToListAsync(ct);
            var ids = camps.Select(c => c.Id).ToList();
            var counts = await _db.CampPatients.AsNoTracking().Where(p => ids.Contains(p.CampId) && p.Phone != null && p.Status != "cancelled")
                .GroupBy(p => p.CampId).Select(g => new { g.Key, n = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.n, ct);
            return Ok(camps.Select(c => new { id = c.Id, title = c.Title, date = c.Date.ToString("yyyy-MM-dd"), venue = c.Venue, block = c.Block, people = counts.GetValueOrDefault(c.Id) }));
        }

        /// <summary>A picture, PDF or video for the top of a template message. Uploaded to WhatsApp; gives the media ID to send.</summary>
        [HttpPost("media")]
        [RequestSizeLimit(17 * 1024 * 1024)]
        public async Task<IActionResult> Media([FromForm] IFormFile? file, CancellationToken ct)
        {
            var cfg = _outbox.Config;
            if (!cfg.IsConfigured) return BadRequest(new { message = "WhatsApp isn't connected yet (WhatsApp → Account setup)." });
            if (file == null || file.Length == 0) return BadRequest(new { message = "Choose a file." });
            if (file.Length > 16L << 20) return BadRequest(new { message = "The file must be under 16 MB." });
            await using var ms = new MemoryStream();
            await file.CopyToAsync(ms, ct);
            var bytes = ms.ToArray();
            var mime = MetaUpload.Sniff(bytes);
            var type = mime == null ? null : MetaUpload.HeaderType(mime);
            if (mime == null || type == null) return BadRequest(new { message = "Use a JPG or PNG picture, a PDF, or an MP4 video." });
            if (bytes.Length > MetaUpload.MaxBytes(type)) return BadRequest(new { message = type == "image" ? "Pictures must be under 5 MB." : "The file must be under 16 MB." });
            var name = MetaUpload.SafeName(file.FileName, type == "document" ? "document.pdf" : type == "video" ? "video.mp4" : "picture.jpg");
            var (id, err) = await MetaUpload.MediaAsync(_http, cfg, bytes, mime, name, ct);
            if (id == null) return BadRequest(new { message = err });
            return Ok(new { mediaId = id, type, fileName = name, size = bytes.Length });
        }

        /// <summary>Checks a broadcast before it's sent or tested; null when it's fine.</summary>
        [NonAction]
        public static string? Check(string kind, Dictionary<string, string> p)
        {
            if (p.TryGetValue("campId", out var camp) && camp.Length > 0 && !Guid.TryParse(camp, out _)) return "Unknown health camp.";
            if (kind == BroadcastComposer.AnyTemplate)
            {
                if (!TemplateName.IsMatch(p.GetValueOrDefault("template") ?? "")) return "Pick a template.";
                if (!LangCode.IsMatch(p.GetValueOrDefault("templateLanguage") ?? "")) return "The template's language is missing.";
                if ((p.GetValueOrDefault("body") ?? "").Length > 1100) return "The template text is too long.";
                var values = BroadcastComposer.TemplateValues(p);
                var blanks = Regex.Matches(p.GetValueOrDefault("body") ?? "", @"\{\{\s*(\d+)\s*\}\}").Select(m => m.Groups[1].Value).Distinct().Count();
                if (values.Count != blanks) return "Fill in every blank.";
                if (values.Any(v => string.IsNullOrWhiteSpace(v))) return "Fill in every blank.";
                if (values.Any(v => v.Length > 1000)) return "A blank can be up to 1,000 characters.";
                if (values.Any(v => v.Contains('\n') || v.Contains('\t') || v.Contains("    "))) return "WhatsApp doesn't allow new lines, tabs or more than 4 spaces inside a blank.";
                var ht = p.GetValueOrDefault("headerType") ?? "";
                if (ht.Length > 0)
                {
                    if (ht is not ("image" or "document" or "video")) return "Unknown attachment.";
                    if (!MediaId.IsMatch(p.GetValueOrDefault("headerMediaId") ?? "")) return "Upload the picture or PDF for this template.";
                }
                return null;
            }
            if (!BroadcastComposer.Kinds.Contains(kind)) return "Unknown message type.";
            return null;
        }

        private static List<string> ValuesFor(string kind, Dictionary<string, string> p, string name) =>
            kind == BroadcastComposer.AnyTemplate ? BroadcastComposer.TemplateParams(p, name) : BroadcastComposer.BodyParams(kind, p, name);

        private static string PreviewFor(string kind, string lang, Dictionary<string, string> p, string name) =>
            kind == BroadcastComposer.AnyTemplate ? BroadcastComposer.TemplatePreview(p, name) : BroadcastComposer.Preview(kind, lang, p, name);

        [HttpPost("preview")]
        public IActionResult Preview([FromBody] BroadcastRequestDto dto)
        {
            return Ok(new { text = PreviewFor(dto.Kind, dto.Language, dto.Params, "") });
        }

        [HttpPost("test")]
        public async Task<IActionResult> Test([FromBody] TestBroadcastDto dto, CancellationToken ct)
        {
            var err = Check(dto.Kind, dto.Params);
            if (err != null) return BadRequest(err);
            var phone = LeadInbox.NormalizePhone(dto.Phone);
            if (phone == null) return BadRequest("Enter a 10-digit mobile number.");
            var lang = dto.Language == "en" ? "en" : "hi";
            var msg = dto.Kind == BroadcastComposer.AnyTemplate
                ? await _outbox.SendTemplateAsync(phone, dto.Params["template"], dto.Params["templateLanguage"], ValuesFor(dto.Kind, dto.Params, "Test"),
                    BroadcastComposer.HeaderOf(dto.Params), PreviewFor(dto.Kind, lang, dto.Params, "Test"), "test", User.AgentIdOf(), null, null, ct)
                : await _outbox.SendUseAsync(phone, dto.Kind, lang, ValuesFor(dto.Kind, dto.Params, "Test"), PreviewFor(dto.Kind, lang, dto.Params, "Test"), "test", User.AgentIdOf(), null, null, ct);
            await _db.SaveChangesAsync(ct);
            return msg.Status == "sent" ? Ok(new { sent = true }) : BadRequest(msg.Error ?? "Not sent.");
        }

        [HttpPost]
        public async Task<IActionResult> Create([FromBody] BroadcastRequestDto dto, CancellationToken ct)
        {
            var err = Check(dto.Kind, dto.Params);
            if (err != null) return BadRequest(err);
            if (BroadcastPeople.GroupsOf(dto.Audience).Count == 0) return BadRequest("Choose who to send it to.");
            var lang = dto.Language == "en" ? "en" : "hi";
            var (people, _) = await BroadcastPeople.ResolveAsync(_db, dto.Audience, ct);
            int count = people.Count;
            if (count == 0) return BadRequest("Nobody matches this audience.");
            if (dto.Params.TryGetValue("campId", out var cid) && Guid.TryParse(cid, out var campGuid)
                && !await _db.HealthCamps.AnyAsync(c => c.Id == campGuid && c.Status != "cancelled", ct)) return BadRequest("That health camp wasn't found.");
            if (dto.ScheduledAt is DateTime when && when.ToUniversalTime() > DateTime.UtcNow.AddDays(28) && dto.Params.ContainsKey("headerMediaId"))
                return BadRequest("WhatsApp keeps an attachment for 30 days, so schedule this within 4 weeks.");

            var title = (dto.Title ?? "").Trim();
            if (title.Length > 120) title = title[..120];
            var b = new Broadcast
            {
                Kind = dto.Kind,
                Language = lang,
                Title = title.Length > 0 ? title : dto.Kind == BroadcastComposer.AnyTemplate ? dto.Params["template"] : BroadcastComposer.TitleFor(dto.Kind, dto.Params),
                ParamsJson = JsonSerializer.Serialize(dto.Params),
                AudienceJson = JsonSerializer.Serialize(dto.Audience),
                PreviewText = PreviewFor(dto.Kind, lang, dto.Params, ""),
                RecipientCount = count,
                ScheduledAt = dto.ScheduledAt.HasValue ? DateTime.SpecifyKind(dto.ScheduledAt.Value.ToUniversalTime(), DateTimeKind.Utc) : DateTime.UtcNow,
                Status = "scheduled",
                CreatedBy = User.AgentIdOf(),
                CreatedAt = DateTime.UtcNow,
            };
            if (string.IsNullOrWhiteSpace(b.Title)) b.Title = dto.Kind.Replace('_', ' ');
            _db.Broadcasts.Add(b);
            await _db.SaveChangesAsync(ct);
            return Ok(new { b.Id, b.Status, b.ScheduledAt, b.RecipientCount });
        }

        [HttpGet]
        public async Task<IActionResult> List(CancellationToken ct)
        {
            var list = await _db.Broadcasts.AsNoTracking().OrderByDescending(b => b.CreatedAt).Take(50).ToListAsync(ct);
            // Leads each broadcast brought (replies within 7 days, see Attribution) and how many of them came.
            var ids = list.Select(b => b.Id).ToList();
            var touches = await _db.LeadTouches.AsNoTracking().Where(t => t.BroadcastId != null && ids.Contains(t.BroadcastId.Value)).Select(t => new { t.BroadcastId, t.LeadId }).ToListAsync(ct);
            var leadIds = touches.Select(t => t.LeadId).Distinct().ToList();
            var status = await _db.Leads.AsNoTracking().Where(l => leadIds.Contains(l.Id)).ToDictionaryAsync(l => l.Id, l => l.Status, ct);
            return Ok(list.Select(b =>
            {
                var mine = touches.Where(t => t.BroadcastId == b.Id).Select(t => t.LeadId).Distinct().ToList();
                return new
                {
                    b.Id, b.Kind, b.Title, b.Language, b.PreviewText, b.RecipientCount, b.ScheduledAt, b.Status, b.Error,
                    b.SentAt, b.SentCount, b.DeliveredCount, b.ReadCount, b.ReplyCount, b.FailedCount, b.CreatedAt,
                    audience = Describe(b.AudienceJson),
                    leads = mine.Count, came = mine.Count(i => status.GetValueOrDefault(i) is "arrived" or "admitted"),
                };
            }));
        }

        /// <summary>"Partners, Health camp people · Purnia, Kasba" for the list.</summary>
        [NonAction]
        public static string Describe(string json)
        {
            BroadcastAudience? a;
            try { a = JsonSerializer.Deserialize<BroadcastAudience>(json); } catch (JsonException) { a = null; }
            if (a == null) return "";
            var who = string.Join(", ", BroadcastPeople.GroupsOf(a).Select(g => BroadcastPeople.Groups.First(x => x.Code == g).Label));
            var places = a.Districts.Concat(a.Blocks).ToList();
            if (a.Panchayats.Count > 0) places.Add(a.Panchayats.Count == 1 ? "1 panchayat" : $"{a.Panchayats.Count} panchayats");
            return places.Count == 0 ? who + " · everywhere" : who + " · " + string.Join(", ", places.Take(4)) + (places.Count > 4 ? $" +{places.Count - 4}" : "");
        }

        [HttpPost("{id:guid}/cancel")]
        public async Task<IActionResult> Cancel(Guid id, CancellationToken ct)
        {
            var b = await _db.Broadcasts.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (b == null) return NotFound();
            if (b.Status != "scheduled") return BadRequest("Only scheduled broadcasts can be cancelled.");
            b.Status = "cancelled";
            await _db.SaveChangesAsync(ct);
            return Ok(new { b.Id, b.Status });
        }
    }

    /// <summary>
    /// WhatsApp Cloud API webhook: delivery/read receipts and replies.
    /// Configure WhatsApp__VerifyToken (any secret string, also entered in Meta's app settings)
    /// and WhatsApp__AppSecret (to check Meta's signature on every POST).
    /// </summary>
    [ApiController]
    [AllowAnonymous]
    [Route("api/v1/whatsapp/webhook")]
    public class WhatsAppWebhookController : ControllerBase
    {
        private readonly IMarketingDbContext _db;
        private readonly IConfiguration _config;
        private readonly ILiveEvents _live;
        private readonly IPermissionService _perms;
        private readonly INotifier _notifier;
        private readonly IWhatsAppSender _wa;
        private readonly IAppSettings _settings;
        private readonly WhatsAppOutbox _outbox;
        private readonly AgentEvents _agents;
        /// <summary>Leads that wrote in this request, told to the Vita agents once everything is saved.</summary>
        private readonly HashSet<Guid> _wroteIn = new();
        private readonly VoiceNotes _voiceNotes;
        /// <summary>Voice notes in this request: written out after the reply to Meta; the Vita agents are told then.</summary>
        private readonly List<VoiceNotes.Note> _voice = new();

        public WhatsAppWebhookController(IMarketingDbContext db, IConfiguration config, ILiveEvents live, IPermissionService perms, INotifier notifier, IWhatsAppSender wa, IAppSettings settings, WhatsAppOutbox outbox, AgentEvents agents, VoiceNotes voiceNotes)
        {
            _voiceNotes = voiceNotes;
            _agents = agents;
            _settings = settings;
            _outbox = outbox;
            _db = db;
            _config = config;
            _live = live;
            _perms = perms;
            _notifier = notifier;
            _wa = wa;
        }

        [HttpGet]
        public IActionResult Verify([FromQuery(Name = "hub.mode")] string? mode, [FromQuery(Name = "hub.verify_token")] string? token, [FromQuery(Name = "hub.challenge")] string? challenge)
        {
            var expected = LeadInbox.Wa(_settings, _config).VerifyToken;
            if (mode == "subscribe" && !string.IsNullOrEmpty(expected) && token == expected) return Content(challenge ?? "", "text/plain");
            return Forbid();
        }

        [HttpPost]
        public async Task<IActionResult> Receive(CancellationToken ct)
        {
            using var reader = new StreamReader(Request.Body, Encoding.UTF8);
            var body = await reader.ReadToEndAsync(ct);

            var secret = LeadInbox.Wa(_settings, _config).AppSecret;
            if (string.IsNullOrEmpty(secret)) return Unauthorized();
            var signature = Request.Headers["X-Hub-Signature-256"].ToString();
            using (var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret)))
            {
                var expected = "sha256=" + Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(body))).ToLowerInvariant();
                if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(signature)))
                    return Unauthorized();
            }

            JsonDocument doc;
            try { doc = JsonDocument.Parse(body); } catch (JsonException) { return BadRequest(); }

            using (doc)
            {
                if (!doc.RootElement.TryGetProperty("entry", out var entries) || entries.ValueKind != JsonValueKind.Array) return Ok();
                foreach (var entry in entries.EnumerateArray())
                {
                    if (!entry.TryGetProperty("changes", out var changes) || changes.ValueKind != JsonValueKind.Array) continue;
                    foreach (var change in changes.EnumerateArray())
                    {
                        if (!change.TryGetProperty("value", out var value)) continue;
                        if (value.TryGetProperty("statuses", out var statuses) && statuses.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var s in statuses.EnumerateArray()) await ApplyStatusAsync(s, ct);
                        }
                        if (value.TryGetProperty("messages", out var messages) && messages.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var m in messages.EnumerateArray()) await ApplyReplyAsync(m, value, ct);
                        }
                    }
                }
            }
            await _db.SaveChangesAsync(ct);
            // A lead whose only new message is a voice note is told to Vita once the note has been written out.
            foreach (var id in _wroteIn.Where(id => _voice.All(v => v.LeadId != id))) _agents.Publish("lead.message", id.ToString());
            _voiceNotes.Queue(_voice);
            return Ok();
        }

        private async Task ApplyStatusAsync(JsonElement s, CancellationToken ct)
        {
            var id = s.TryGetProperty("id", out var idp) ? idp.GetString() : null;
            var status = s.TryGetProperty("status", out var stp) ? stp.GetString() : null;
            if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(status)) return;

            // A message sent from the leads inbox.
            var wm = await _db.WaMessages.FirstOrDefaultAsync(x => x.WaMessageId == id && x.Direction == "out", ct);
            if (wm != null)
            {
                int rank(string st) => st switch { "sent" => 1, "delivered" => 2, "read" => 3, "failed" => 4, _ => 0 };
                if (rank(status) > rank(wm.Status)) wm.Status = status;
                if (status == "failed" && s.TryGetProperty("errors", out var errs) && errs.ValueKind == JsonValueKind.Array && errs.GetArrayLength() > 0)
                {
                    var e0 = errs[0];
                    wm.Error = e0.TryGetProperty("title", out var et) ? et.GetString() : "Not delivered";
                    if (e0.TryGetProperty("error_data", out var ed) && ed.TryGetProperty("details", out var det)) wm.Error = det.GetString() ?? wm.Error;
                }
                if (wm.BroadcastId == null) return; // broadcasts also keep their own per-recipient counts below
            }

            var r = await _db.BroadcastRecipients.FirstOrDefaultAsync(x => x.ProviderMessageId == id, ct);
            if (r == null) return;
            var b = await _db.Broadcasts.FirstOrDefaultAsync(x => x.Id == r.BroadcastId, ct);
            var now = DateTime.UtcNow;

            if (status == "delivered" && r.DeliveredAt == null)
            {
                r.DeliveredAt = now;
                if (r.Status == "sent") r.Status = "delivered";
                if (b != null) b.DeliveredCount++;
            }
            else if (status == "read" && r.ReadAt == null)
            {
                if (r.DeliveredAt == null) { r.DeliveredAt = now; if (b != null) b.DeliveredCount++; }
                r.ReadAt = now;
                r.Status = "read";
                if (b != null) b.ReadCount++;
            }
            else if (status == "failed" && r.Status != "failed")
            {
                r.Status = "failed";
                if (b != null) { b.FailedCount++; if (b.SentCount > 0) b.SentCount--; }
            }
        }

        /// <summary>What a message says, whatever kind it is: text, a tapped button, a photo's caption…</summary>
        private static (string Type, string Text) ReadMessage(JsonElement m)
        {
            string type = m.TryGetProperty("type", out var tp) ? tp.GetString() ?? "text" : "text";
            string? s(JsonElement e, params string[] path)
            {
                foreach (var p in path) { if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty(p, out e)) return null; }
                return e.ValueKind == JsonValueKind.String ? e.GetString() : null;
            }
            switch (type)
            {
                case "text": return ("text", s(m, "text", "body") ?? "");
                case "button": return ("button", s(m, "button", "text") ?? "");
                case "interactive": return ("button", s(m, "interactive", "button_reply", "title") ?? s(m, "interactive", "list_reply", "title") ?? "");
                case "image": return ("image", s(m, "image", "caption") ?? "📷 Photo");
                case "video": return ("other", s(m, "video", "caption") ?? "🎥 Video");
                case "audio": return ("audio", "🎤 Voice message");
                case "document": return ("document", "📄 " + (s(m, "document", "filename") ?? s(m, "document", "caption") ?? "Document"));
                case "location": return ("location", "📍 Location" + (s(m, "location", "name") is string n ? ": " + n : ""));
                case "sticker": return ("other", "Sticker");
                case "contacts": return ("other", "👤 Shared a contact");
                default: return ("other", "(" + type + ")");
            }
        }

        private async Task ApplyReplyAsync(JsonElement m, JsonElement value, CancellationToken ct)
        {
            var from = m.TryGetProperty("from", out var fp) ? fp.GetString() : null;
            if (string.IsNullOrEmpty(from)) return;
            var (type, text) = ReadMessage(m);
            if (m.TryGetProperty("referral", out var refl) && refl.ValueKind == JsonValueKind.Object && string.IsNullOrEmpty(text))
                text = "(came from an ad)";

            var since = DateTime.UtcNow.AddDays(-14);
            var r = await _db.BroadcastRecipients
                .Where(x => x.Phone == from && x.SentAt >= since)
                .OrderByDescending(x => x.SentAt)
                .FirstOrDefaultAsync(ct);
            if (r != null && r.RepliedAt == null)
            {
                r.RepliedAt = DateTime.UtcNow;
                var b = await _db.Broadcasts.FirstOrDefaultAsync(x => x.Id == r.BroadcastId, ct);
                if (b != null) b.ReplyCount++;
            }

            var isStop = _outbox.Rules.IsStop(text);
            var last10 = from.Length >= 10 ? from.Substring(from.Length - 10) : from;
            var contacts = await _db.Contacts.Where(c => c.Phone != null && c.Phone.EndsWith(last10)).ToListAsync(ct);
            if (isStop)
            {
                foreach (var c in contacts) c.WhatsappOptOut = true;
            }

            // Every message also lands in the leads inbox, where the desk can reply.
            string? profileName = null;
            if (value.TryGetProperty("contacts", out var wc) && wc.ValueKind == JsonValueKind.Array)
            {
                foreach (var c in wc.EnumerateArray())
                {
                    var waId = c.TryGetProperty("wa_id", out var wi) ? wi.GetString() : null;
                    if (waId == from && c.TryGetProperty("profile", out var prof) && prof.TryGetProperty("name", out var pn)) profileName = pn.GetString();
                }
            }
            string? adRef = null;
            if (m.TryGetProperty("referral", out var rf) && rf.ValueKind == JsonValueKind.Object)
            {
                adRef = (rf.TryGetProperty("headline", out var h) ? h.GetString() : null)
                    ?? (rf.TryGetProperty("source_id", out var sid) ? "Ad " + sid.GetString() : "Ad");
            }
            var res = await LeadInbox.IngestAsync(_db, _perms, _notifier, _outbox, new LeadInbox.Inbound
            {
                From = from, ProfileName = profileName, Type = type, Text = text,
                WaMessageId = m.TryGetProperty("id", out var mid) ? mid.GetString() : null, AdRef = adRef,
                AdId = ReferralPart(m, "source_id"), AdUrl = ReferralPart(m, "source_url"), AdClickId = ReferralPart(m, "ctwa_clid"),
                MediaId = MediaPart(m, "id"), MediaMime = MediaPart(m, "mime_type"), MediaFile = MediaPart(m, "filename"),
            }, ct);

            // A reply within 7 days of a broadcast credits the broadcast. A lead that came with nothing else to go on
            // ("whatsapp") takes it as its source.
            if (res.Lead != null && !isStop && r != null && r.SentAt >= DateTime.UtcNow.AddDays(-7))
            {
                var bc = await _db.Broadcasts.AsNoTracking().Where(x => x.Id == r.BroadcastId).Select(x => new { x.Id, x.Title }).FirstOrDefaultAsync(ct);
                if (bc != null)
                {
                    var content = await _db.TrackedLinks.AsNoTracking().FirstOrDefaultAsync(l => l.BroadcastId == bc.Id, ct);
                    await Attribution.TouchAsync(_db, res.Lead.Id, "whatsapp", "broadcast", ct, link: content, broadcastId: bc.Id, @ref: content?.Code ?? bc.Title);
                    if (res.Lead.Source == "whatsapp")
                    {
                        res.Lead.Source = "broadcast";
                        res.Lead.SourceRef = content != null ? LeadInbox.LinkRef(content) : bc.Title;
                        _db.LeadActivities.Add(new LeadActivity { LeadId = res.Lead.Id, Kind = "source", Text = $"Replied to the broadcast “{bc.Title}”" });
                    }
                }
            }

            // A reply to a broadcast linked to a health camp ("book", the booking button) books them and sends the token.
            var campBooking = isStop ? null : await CampReplies.TryBookAsync(_db, _outbox, r, from, type, text, profileName, res.Lead?.Id, ct);
            if (campBooking != null)
                await _live.PublishAsync(new LiveEvent { Kind = "lead", Text = campBooking == "booked" ? $"{profileName ?? from} booked a camp place from a WhatsApp reply" : $"{profileName ?? from} asked to book a camp ({campBooking})" });
            if (res.Lead != null && !isStop && campBooking == null && !string.IsNullOrWhiteSpace(text)) _wroteIn.Add(res.Lead.Id);
            if (type == "audio" && m.TryGetProperty("audio", out var au) && au.TryGetProperty("id", out var auId) && auId.GetString() is { Length: > 0 } mediaId
                && m.TryGetProperty("id", out var wamid) && wamid.GetString() is { Length: > 0 } wid)
                _voice.Add(new VoiceNotes.Note(wid, mediaId, res.Lead?.Id));
            var who = res.Lead?.Name ?? res.Conversation?.Name ?? contacts.FirstOrDefault()?.Name ?? from;
            await _live.PublishAsync(new LiveEvent
            {
                Kind = "lead",
                Text = isStop ? $"{who} unsubscribed from WhatsApp updates" : $"WhatsApp from {who}: {Shorten(text)}",
                RefId = res.Lead?.Id.ToString() ?? contacts.FirstOrDefault()?.ClientId,
            });
        }

        /// <summary>A field of a Click-to-WhatsApp ad's referral: source_id (the ad ID), source_url, ctwa_clid, source_type.</summary>
        public static string? ReferralPart(JsonElement m, string field)
        {
            if (!m.TryGetProperty("referral", out var rf) || rf.ValueKind != JsonValueKind.Object || !rf.TryGetProperty(field, out var v) || v.ValueKind != JsonValueKind.String) return null;
            var s = v.GetString()?.Trim();
            if (string.IsNullOrEmpty(s)) return null;
            if (field == "source_id") return Regex.IsMatch(s, @"^\d{3,40}$") ? s : null;
            return s.Length > 500 ? s[..500] : s;
        }

        /// <summary>A field of the message's photo, video, voice note, document or sticker ("id", "mime_type", "filename").</summary>
        public static string? MediaPart(JsonElement m, string field)
        {
            var type = m.TryGetProperty("type", out var tp) ? tp.GetString() : null;
            if (type is not ("image" or "video" or "audio" or "document" or "sticker") || !m.TryGetProperty(type, out var media) || media.ValueKind != JsonValueKind.Object) return null;
            var v = media.TryGetProperty(field, out var f) && f.ValueKind == JsonValueKind.String ? f.GetString() : null;
            if (v == null) return null;
            v = v.Trim();
            return field == "id" ? (Regex.IsMatch(v, @"^\d{5,40}$") ? v : null) : v.Length > 200 ? v[..200] : v;
        }

        private static string Shorten(string? s) => string.IsNullOrEmpty(s) ? "(media)" : s.Length > 80 ? s.Substring(0, 80) + "…" : s;
    }
}
