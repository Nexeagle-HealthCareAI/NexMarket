using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using SeemanchalOutreach.Application.Interfaces;
using SeemanchalOutreach.Domain.Entities;

namespace SeemanchalOutreach.Api.Services
{
    /// <summary>
    /// WhatsApp rules an admin or marketing manager sets in the CRM (WhatsApp → Automation): office hours, keyword
    /// replies, who new leads go to, the pause switch and the daily limit. Saved as one setting.
    /// </summary>
    public class WaAutomation
    {
        public const string Key = "whatsapp.automation";
        private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

        /// <summary>Stops every outgoing WhatsApp message (replies, auto-replies, broadcasts) until switched back on.</summary>
        public bool Paused { get; set; }
        public string? PausedBy { get; set; }
        public DateTime? PausedAt { get; set; }

        /// <summary>Most template messages (the paid ones: broadcasts, follow-ups) sent per day. 0 = no limit.</summary>
        public int DailyTemplateLimit { get; set; } = 500;

        public bool OfficeHoursOn { get; set; }
        /// <summary>IST days the desk works, 0 = Sunday … 6 = Saturday.</summary>
        public List<int> OfficeDays { get; set; } = new() { 1, 2, 3, 4, 5, 6 };
        public string OfficeStart { get; set; } = "09:00";
        public string OfficeEnd { get; set; } = "18:00";
        /// <summary>Sent instead of the normal instant reply when someone writes outside office hours.</summary>
        public string? AfterHoursReply { get; set; }

        public List<KeywordRule> Keywords { get; set; } = new();

        /// <summary>none = whoever replies first takes the lead; balance = the person with fewest open leads among <see cref="AssignTo"/>.</summary>
        public string AssignMode { get; set; } = "none";
        public List<string> AssignTo { get; set; } = new();

        /// <summary>When a partner (ASHA, RMP…) writes without a patient code: make a lead, or just a conversation in the inbox.</summary>
        public bool PartnerMessagesAreLeads { get; set; }

        public int ReplyTargetMinutes { get; set; } = 15;

        public List<string> StopWords { get; set; } = new() { "stop", "unsubscribe", "बंद", "band karo" };

        public class KeywordRule
        {
            public string Id { get; set; } = Guid.NewGuid().ToString("n")[..8];
            public List<string> Words { get; set; } = new();
            public string Reply { get; set; } = string.Empty;
            public bool On { get; set; } = true;
        }

        public static WaAutomation Load(IAppSettings settings)
        {
            var raw = settings.Get(Key);
            if (string.IsNullOrWhiteSpace(raw)) return new WaAutomation();
            try { return JsonSerializer.Deserialize<WaAutomation>(raw, Json) ?? new WaAutomation(); }
            catch (JsonException) { return new WaAutomation(); }
        }

        public Task SaveAsync(IAppSettings settings, string by, CancellationToken ct) =>
            settings.SetAsync(new Dictionary<string, string?> { [Key] = JsonSerializer.Serialize(this, Json) }, Array.Empty<string>(), by, ct);

        public static TimeSpan? ParseTime(string? s) => TimeSpan.TryParse(s, out var t) && t >= TimeSpan.Zero && t < TimeSpan.FromDays(1) ? t : null;

        public bool InOfficeHours(DateTime utc)
        {
            if (!OfficeHoursOn) return true;
            var ist = utc + IstClock.Offset;
            if (!OfficeDays.Contains((int)ist.DayOfWeek)) return false;
            var from = ParseTime(OfficeStart) ?? TimeSpan.FromHours(9);
            var to = ParseTime(OfficeEnd) ?? TimeSpan.FromHours(18);
            return ist.TimeOfDay >= from && ist.TimeOfDay < to;
        }

        public bool IsStop(string? text) =>
            !string.IsNullOrWhiteSpace(text) && StopWords.Any(w => string.Equals(w.Trim(), text.Trim(), StringComparison.OrdinalIgnoreCase));

        /// <summary>The first switched-on keyword rule whose word appears in the message (as a whole word).</summary>
        public KeywordRule? Match(string? text)
        {
            if (string.IsNullOrWhiteSpace(text)) return null;
            foreach (var r in Keywords.Where(k => k.On && !string.IsNullOrWhiteSpace(k.Reply)))
            {
                foreach (var w in r.Words.Where(w => !string.IsNullOrWhiteSpace(w)))
                {
                    var pattern = @"(^|[^\p{L}\p{N}])" + Regex.Escape(w.Trim()) + @"($|[^\p{L}\p{N}])";
                    if (Regex.IsMatch(text, pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)) return r;
                }
            }
            return null;
        }
    }

    /// <summary>
    /// Every WhatsApp message the hospital sends goes through here: it checks the pause switch, the daily limit and
    /// opt-outs, sends, and records the message in the conversation and the message log. Callers save the context.
    /// </summary>
    public class WhatsAppOutbox
    {
        private readonly IMarketingDbContext _db;
        private readonly IWhatsAppSender _wa;
        private readonly IAppSettings _settings;
        private readonly IConfiguration _config;
        private int? _templatesToday;

        public WhatsAppOutbox(IMarketingDbContext db, IWhatsAppSender wa, IAppSettings settings, IConfiguration config)
        {
            _db = db;
            _wa = wa;
            _settings = settings;
            _config = config;
        }

        public WhatsAppConfig Config => LeadInbox.Wa(_settings, _config);
        public WaAutomation Rules => WaAutomation.Load(_settings);

        /// <summary>The conversation for a number, created if it's the first message either way.</summary>
        public async Task<WaConversation> ConversationAsync(string phone, string? name, CancellationToken ct)
        {
            var c = _db.WaConversations.Local.FirstOrDefault(x => x.Phone == phone)
                ?? await _db.WaConversations.FirstOrDefaultAsync(x => x.Phone == phone, ct);
            if (c != null)
            {
                if ((string.IsNullOrEmpty(c.Name) || c.Name.StartsWith("+")) && !string.IsNullOrWhiteSpace(name)) c.Name = name!.Trim();
                return c;
            }
            c = new WaConversation { Phone = phone, Name = string.IsNullOrWhiteSpace(name) ? "+" + phone : name!.Trim(), CreatedAt = DateTime.UtcNow, LastMessageAt = DateTime.UtcNow };
            // Link to what we already know about this number.
            var last10 = LeadInbox.Last10(phone);
            c.LeadId = (_db.Leads.Local.FirstOrDefault(l => l.Phone == phone) ?? await _db.Leads.AsNoTracking().FirstOrDefaultAsync(l => l.Phone == phone, ct))?.Id;
            c.PartnerClientId = await _db.Contacts.AsNoTracking().Where(x => x.Phone != null && x.Phone.EndsWith(last10) && !x.IsMerged).Select(x => x.ClientId).FirstOrDefaultAsync(ct);
            _db.WaConversations.Add(c);
            return c;
        }

        /// <summary>Why a message can't go out right now, or null when it can.</summary>
        public async Task<string?> BlockedAsync(string phone, bool template, CancellationToken ct)
        {
            if (!_wa.IsConfigured) return "WhatsApp isn't connected yet (Settings → WhatsApp setup).";
            var rules = Rules;
            if (rules.Paused) return "WhatsApp sending is paused (WhatsApp → Automation).";
            var conv = _db.WaConversations.Local.FirstOrDefault(x => x.Phone == phone) ?? await _db.WaConversations.AsNoTracking().FirstOrDefaultAsync(x => x.Phone == phone, ct);
            if (conv?.OptOut == true) return "They asked not to get WhatsApp messages.";
            if (template && rules.DailyTemplateLimit > 0)
            {
                _templatesToday ??= await _db.WaMessages.CountAsync(m => m.Direction == "out" && m.TemplateName != null && m.Status != "failed" && m.Status != "blocked" && m.CreatedAt >= IstClock.TodayStartUtc, ct);
                if (_templatesToday >= rules.DailyTemplateLimit) return $"Today's limit of {rules.DailyTemplateLimit} template messages is reached. Raise it in WhatsApp → Automation.";
            }
            return null;
        }

        /// <summary>A free-text message (only delivered within 24 hours of their last message).</summary>
        public async Task<WaMessage> SendTextAsync(string phone, string text, string source, string? by, Guid? leadId, CancellationToken ct)
        {
            var msg = new WaMessage { Phone = phone, LeadId = leadId, Direction = "out", Type = "text", Text = text, SentBy = by, Source = source, CreatedAt = DateTime.UtcNow };
            var blocked = await BlockedAsync(phone, false, ct);
            if (blocked != null) { msg.Status = "blocked"; msg.Error = blocked; }
            else
            {
                var r = await _wa.SendTextAsync(phone, text, ct);
                msg.Status = r.Ok ? "sent" : "failed";
                msg.WaMessageId = r.MessageId;
                msg.Error = r.Error;
            }
            await RecordAsync(msg, ct);
            return msg;
        }

        /// <summary>An approved template by name. <paramref name="preview"/> is what the log and inbox show.</summary>
        public async Task<WaMessage> SendTemplateAsync(string phone, string template, string language, IReadOnlyList<string> values, string preview,
            string source, string? by, Guid? leadId, Guid? broadcastId, CancellationToken ct)
        {
            var msg = new WaMessage
            {
                Phone = phone, LeadId = leadId, Direction = "out", Type = "template", Text = preview, SentBy = by, Source = source,
                TemplateName = template, TemplateLanguage = language, ParamsJson = JsonSerializer.Serialize(values), BroadcastId = broadcastId, CreatedAt = DateTime.UtcNow,
            };
            var blocked = await BlockedAsync(phone, true, ct);
            if (blocked != null) { msg.Status = "blocked"; msg.Error = blocked; }
            else
            {
                var r = await _wa.SendNamedTemplateAsync(phone, template, language, values, ct);
                msg.Status = r.Ok ? "sent" : "failed";
                msg.WaMessageId = r.MessageId;
                msg.Error = r.Error;
                if (r.Ok) _templatesToday = (_templatesToday ?? 0) + 1;
            }
            await RecordAsync(msg, ct);
            return msg;
        }

        /// <summary>A template chosen for a use (lead_followup, camp_invite…) in Settings → WhatsApp setup.</summary>
        public async Task<WaMessage> SendUseAsync(string phone, string use, string lang, IReadOnlyList<string> values, string preview,
            string source, string? by, Guid? leadId, Guid? broadcastId, CancellationToken ct)
        {
            var cfg = Config;
            var name = cfg.Template(use);
            if (name == null)
            {
                var msg = new WaMessage
                {
                    Phone = phone, LeadId = leadId, Direction = "out", Type = "template", Text = preview, Source = source, SentBy = by, BroadcastId = broadcastId,
                    Status = "blocked", Error = "No approved template is chosen for this message yet (Settings → WhatsApp setup).", CreatedAt = DateTime.UtcNow,
                };
                await RecordAsync(msg, ct);
                return msg;
            }
            return await SendTemplateAsync(phone, name, lang == "en" ? cfg.EnglishCode : cfg.HindiCode, values, preview, source, by, leadId, broadcastId, ct);
        }

        private async Task RecordAsync(WaMessage msg, CancellationToken ct)
        {
            _db.WaMessages.Add(msg);
            if (msg.Status == "blocked" && msg.Source == "broadcast") return; // don't fill the inbox with broadcasts that never left
            var conv = await ConversationAsync(msg.Phone, null, ct);
            if (msg.LeadId != null && conv.LeadId == null) conv.LeadId = msg.LeadId;
            if (msg.Status != "blocked" && msg.Status != "failed")
            {
                conv.LastMessage = (msg.Source == "broadcast" ? "Broadcast: " : "You: ") + LeadInbox.Shorten(msg.Text, 150);
                conv.LastDirection = "out";
                conv.LastMessageAt = msg.CreatedAt;
                if (msg.Source is "inbox" or "lead") conv.Unread = 0;
            }
        }
    }
}
